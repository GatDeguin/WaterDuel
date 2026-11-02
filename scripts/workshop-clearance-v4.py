"""Strict geometry clearance checks on the v4 GLB reimport.

Only verify_geometric_clearance() writes, and only geometric-reimport-v4.json.
Importing this module does not open Blender files, execute v3 code, or write.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from mathutils.bvhtree import BVHTree

OUT = Path(__file__).resolve().parents[1] / 'public/assets/environment/workshop'
DEPTH_IDS = ('drafting-board', 'apron-left', 'apron-right', 'rear-pennant-left', 'rear-pennant-right')
FLOOR_IDS = ('apron-left-floor', 'apron-right-floor')
BOUNDS_TOLERANCE = 1e-5
SAT_TOLERANCE = 1e-7
DEGENERATE_AXIS = 1e-12
COMPONENT_WELD_TOLERANCE = 1e-5


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def bounds(points):
    return {'min': points.min(axis=0).tolist(), 'max': points.max(axis=0).tolist()}


def sat(a, b):
    # Same axes and numerical thresholds as the frozen v3 implementation.
    ea = np.roll(a, -1, axis=0) - a
    eb = np.roll(b, -1, axis=0) - b
    na, nb = np.cross(ea[0], ea[1]), np.cross(eb[0], eb[1])
    axes = [na, nb] + [np.cross(x, y) for x in ea for y in eb]
    axes += [np.cross(n, edge) for n in (na, nb) for edge in list(ea) + list(eb)]
    for axis in axes:
        length = np.linalg.norm(axis)
        if length < DEGENERATE_AXIS:
            continue
        axis /= length
        pa, pb = a @ axis, b @ axis
        if pa.max() < pb.min() - SAT_TOLERANCE or pb.max() < pa.min() - SAT_TOLERANCE:
            return False
    return True


def validate_checks(contract):
    require(contract.get('version') == 4 and contract.get('asset') == 'workshop-runtime-v4.glb',
            'Expected v4 asset contract')
    proof = contract.get('crossingClearance', {})
    require(proof.get('coordinateSpace') == 'runtime world', 'Expected runtime world clearance coordinates')
    checks = proof.get('checks')
    require(isinstance(checks, list) and checks, 'Missing clearance checks')
    identifiers = [item.get('id') for item in checks]
    require(all(isinstance(identifier, str) and identifier for identifier in identifiers)
            and len(set(identifiers)) == len(identifiers), 'Missing or repeated clearance ID')
    for identifier in DEPTH_IDS + FLOOR_IDS:
        require(identifier in identifiers, 'Missing required clearance ID ' + identifier)
    for item in checks:
        axis = 1 if item['id'] in FLOOR_IDS else 2
        require(type(item.get('axis')) is int and item['axis'] == axis,
                item['id'] + ': incorrect clearance axis')
        minimum, measured = item.get('minClearance'), item.get('measuredClearance')
        require(isinstance(minimum, (int, float)) and not isinstance(minimum, bool)
                and np.isfinite(minimum) and minimum > BOUNDS_TOLERANCE,
                item['id'] + ': invalid minimum clearance')
        require(isinstance(measured, (int, float)) and not isinstance(measured, bool)
                and np.isfinite(measured), item['id'] + ': invalid measured clearance')
        require(isinstance(item.get('front'), dict) and isinstance(item.get('back'), dict),
                item['id'] + ': missing explicit front/back selectors')
    return checks


def _component_groups(entry):
    if '_component_groups' in entry:
        return entry['_component_groups']
    parent = list(range(len(entry['indices'])))
    positions = {}

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for ordinal, face in enumerate(entry['indices']):
        for vertex in entry['points'][face]:
            # Match Math.round(position/1e-5) used by the independent Node QA.
            key = tuple(np.floor(vertex / COMPONENT_WELD_TOLERANCE + .5).astype(np.int64))
            if key in positions:
                parent[find(ordinal)] = find(positions[key])
            else:
                positions[key] = ordinal
    groups, roots = {}, []
    for ordinal in range(len(parent)):
        root = find(ordinal)
        roots.append(root)
        groups.setdefault(root, set()).add(ordinal)
    entry['_component_groups'] = groups, roots
    return groups, roots


def _expected_bounds(selector, label):
    expected = selector.get('componentBounds')
    require(isinstance(expected, dict), label + ': missing componentBounds')
    for side in ('min', 'max'):
        values = expected.get(side)
        require(isinstance(values, (list, tuple)) and len(values) == 3
                and all(isinstance(value, (int, float)) and not isinstance(value, bool)
                        and np.isfinite(value) for value in values), label + ': non-finite componentBounds')
    require(all(expected['min'][i] <= expected['max'][i] for i in range(3)),
            label + ': reversed componentBounds')
    tolerance = expected.get('tolerance', BOUNDS_TOLERANCE)
    require(isinstance(tolerance, (int, float)) and not isinstance(tolerance, bool)
            and np.isfinite(tolerance) and 0 < tolerance <= BOUNDS_TOLERANCE,
            label + ': cannot weaken componentBounds tolerance')
    return expected


def select_geometry(data, selector, label):
    names = selector.get('nodeNames')
    require(isinstance(names, list) and names and all(isinstance(name, str) and name for name in names)
            and len(set(names)) == len(names), label + ': invalid nodeNames')
    has_by_node = 'triangleIndicesByNode' in selector
    by_node = selector.get('triangleIndicesByNode')
    if has_by_node:
        require(isinstance(by_node, dict) and set(by_node) == set(names),
                label + ': explicit triangleIndicesByNode must cover exactly nodeNames')
    else:
        require(len(names) == 1, label + ': triangleIndices requires one node')
    expected = _expected_bounds(selector, label)
    selected, triangles = {}, []
    for name in names:
        require(name in data, label + ': selected exported mesh missing: ' + name)
        ordinals = by_node[name] if has_by_node else selector.get('triangleIndices')
        require(isinstance(ordinals, list) and ordinals
                and all(type(index) is int and 0 <= index < len(data[name]['indices']) for index in ordinals)
                and len(set(ordinals)) == len(ordinals), label + ': invalid explicit triangle ordinals for ' + name)
        ids = set(ordinals)
        groups, roots = _component_groups(data[name])
        for root in {roots[index] for index in ids}:
            require(groups[root].issubset(ids), label + ': selection omits faces of a complete component: ' + name)
        points = data[name]['points'][data[name]['indices'][np.array(ordinals, dtype=np.int32)]]
        triangles.append(points)
        selected[name] = ids
    triangles = np.concatenate(triangles)
    measured = bounds(triangles.reshape((-1, 3)))
    require(max(abs(measured[side][i] - expected[side][i])
                for side in ('min', 'max') for i in range(3)) < expected.get('tolerance', BOUNDS_TOLERANCE),
            label + ': reimported componentBounds differ by at least 1e-5 m')
    return triangles, measured, selected


def validate_meshes(scene, meshes):
    require(meshes and all(obj.type == 'MESH' for obj in meshes), 'Expected exported MESH objects')
    names = [obj.name for obj in meshes]
    require(len(names) == len(set(names)), 'Repeated exported mesh objects')
    all_meshes = {obj.name for obj in scene.objects if obj.type == 'MESH'}
    require(set(names) == all_meshes, 'Exported mesh coverage differs from scene MESH objects; v4 extras cannot be omitted')


def verify_geometric_clearance(scene, contract, meshes):
    glb = OUT / 'workshop-runtime-v4.glb'
    glb_sha256 = hashlib.sha256(glb.read_bytes()).hexdigest()
    checks = validate_checks(contract)
    meshes = list(meshes)
    # Run before adding QA render helpers: all imported MESH objects are tested.
    validate_meshes(scene, meshes)
    data = {}
    for obj in meshes:
        mesh = obj.data
        mesh.calc_loop_triangles()
        local = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get('co', local)
        matrix = np.array(obj.matrix_world, dtype=np.float64)
        require(np.isfinite(local).all() and np.isfinite(matrix).all(), 'Non-finite reimport geometry: ' + obj.name)
        world = local.reshape((-1, 3)) @ matrix[:3, :3].T + matrix[:3, 3]
        points = world[:, [0, 2, 1]].copy()
        points[:, 2] *= -1
        indices = np.array([tuple(triangle.vertices) for triangle in mesh.loop_triangles], dtype=np.int32)
        require(len(points) > 0 and len(indices) > 0 and np.isfinite(points).all(), 'Empty/non-finite exported mesh: ' + obj.name)
        data[obj.name] = {'points': points, 'indices': indices,
            'bvh': BVHTree.FromPolygons(points.tolist(), indices.tolist(), all_triangles=True)}
    gaps, external = [], []
    for item in checks:
        front, front_bounds, selected = select_geometry(data, item['front'], item['id'] + '.front')
        _, back_bounds, _ = select_geometry(data, item['back'], item['id'] + '.back')
        gap = front_bounds['min'][item['axis']] - back_bounds['max'][item['axis']]
        require(gap >= item['minClearance'] - BOUNDS_TOLERANCE
                and abs(gap - item['measuredClearance']) < BOUNDS_TOLERANCE,
                item['id'] + ': measured clearance is insufficient or differs from contract')
        gaps.append({'id': item['id'], 'axis': item['axis'], 'measuredClearance': gap,
                     'frontBounds': front_bounds, 'backBounds': back_bounds, 'passed': True})
        if item['axis'] != 2:
            continue
        flat = front.reshape((-1, 3))
        indices = np.arange(len(flat), dtype=np.int32).reshape((-1, 3))
        front_bvh = BVHTree.FromPolygons(flat.tolist(), indices.tolist(), all_triangles=True)
        count, examples = 0, []
        for name, other in data.items():
            excluded = selected.get(name, set())
            for front_triangle, other_triangle in front_bvh.overlap(other['bvh']):
                if other_triangle in excluded:
                    continue
                if sat(front[front_triangle], other['points'][other['indices'][other_triangle]]):
                    count += 1
                    if len(examples) < 8:
                        examples.append({'otherMesh': name, 'otherTriangle': other_triangle, 'frontTriangle': front_triangle})
        external.append({'id': item['id'], 'externalTriangleCrossings': count, 'examples': examples})
    report = {'passed': all(row['passed'] for row in gaps)
              and all(row['externalTriangleCrossings'] == 0 for row in external),
        'version': 4, 'file': 'workshop-runtime-v4.glb', 'glbSha256': glb_sha256,
        'meshObjects': len(data), 'exportedMeshes': sorted(data),
        'checks': gaps, 'allOtherExportedGeometry': external,
        'tolerances': {'componentBounds': BOUNDS_TOLERANCE, 'triangleSAT': SAT_TOLERANCE,
                       'degenerateAxis': DEGENERATE_AXIS, 'componentWeld': COMPONENT_WELD_TOLERANCE},
        'scope': 'Actual v4 GLB reimport. Seven required axis checks, explicit complete-component selections and exact bounds; five coherent assemblies tested with BVH/triangle-SAT against every exported mesh including v4 extras. Only triangles explicitly selected within the same assembly are excluded as intentional intra-assembly contacts.'}
    require(hashlib.sha256(glb.read_bytes()).hexdigest() == glb_sha256, 'GLB changed during geometric verification')
    (OUT / 'geometric-reimport-v4.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    return report


def _self_test():
    a = np.array(((0, 0, 0), (1, 0, 0), (0, 1, 0)), dtype=np.float64)
    assert sat(a, a + (.1, .1, 0))
    assert not sat(a, a + (2, 2, 0))
    assert not sat(a, a + (0, 0, .01))
    assert sat(a, np.array(((.2, .2, -1), (.2, .2, 1), (.3, .3, 0)), dtype=np.float64))
    selector = {'nodeNames': ['Piece'], 'triangleIndices': [0],
                'componentBounds': {'min': [0, 0, 0], 'max': [1, 1, 0], 'tolerance': BOUNDS_TOLERANCE}}
    contract = {'version': 4, 'asset': 'workshop-runtime-v4.glb', 'crossingClearance': {
        'coordinateSpace': 'runtime world', 'checks': [
            {'id': identifier, 'axis': 1 if identifier in FLOOR_IDS else 2,
             'minClearance': .01, 'measuredClearance': .02, 'front': selector, 'back': selector}
            for identifier in DEPTH_IDS + FLOOR_IDS]}}
    assert len(validate_checks(contract)) == 7
    invalid = {**contract, 'crossingClearance': {**contract['crossingClearance'], 'checks': contract['crossingClearance']['checks'][:-1]}}
    try:
        validate_checks(invalid)
    except RuntimeError as error:
        assert 'Missing required' in str(error)
    else:
        raise AssertionError('Missing floor check accepted')
    for identifier, wrong_axis in (('drafting-board', 1), ('apron-left-floor', 2), ('apron-right-floor', 0)):
        invalid = {**contract, 'crossingClearance': {**contract['crossingClearance'], 'checks': [
            {**item, 'axis': wrong_axis} if item['id'] == identifier else item
            for item in contract['crossingClearance']['checks']]}}
        try:
            validate_checks(invalid)
        except RuntimeError as error:
            assert 'incorrect clearance axis' in str(error)
        else:
            raise AssertionError('Wrong clearance axis accepted')
    data = {'Piece': {'points': a.copy(), 'indices': np.array(((0, 1, 2),), dtype=np.int32)}}
    triangles, measured, selected = select_geometry(data, selector, 'test')
    assert triangles.shape == (1, 3, 3) and selected['Piece'] == {0}
    assert measured == {'min': [0., 0., 0.], 'max': [1., 1., 0.]}
    square = np.array(((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 0, 0), (1, 1, 0), (0, 1, 0)), dtype=np.float64)
    split = {'Piece': {'points': square, 'indices': np.array(((0, 1, 2), (3, 4, 5)), dtype=np.int32)}}
    try:
        select_geometry(split, selector, 'partial')
    except RuntimeError as error:
        assert 'complete component' in str(error)
    else:
        raise AssertionError('Partial component across UV seams accepted')
    for invalid in ({**selector, 'triangleIndices': [99]},
                    {**selector, 'triangleIndices': [True]},
                    {**selector, 'triangleIndicesByNode': None},
                    {**selector, 'componentBounds': {**selector['componentBounds'], 'tolerance': 1e-4}}):
        try:
            select_geometry(data, invalid, 'invalid')
        except RuntimeError:
            pass
        else:
            raise AssertionError('Invalid or weakened selection accepted')
    first = type('Mesh', (), {'name': 'A', 'type': 'MESH'})()
    extra = type('Mesh', (), {'name': 'ExtraV4', 'type': 'MESH'})()
    scene = type('Scene', (), {'objects': [first, extra]})()
    validate_meshes(scene, [first, extra])
    try:
        validate_meshes(scene, [first])
    except RuntimeError as error:
        assert 'coverage' in str(error)
    else:
        raise AssertionError('Omitted v4 geometry accepted')
    return {'ok': True, 'SAT_cases': 4, 'selection_and_contract_cases': 13}
