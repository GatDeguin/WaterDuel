"""Source-material refinements for the WaterDuel workshop, revision 4.

API: apply_material_refinements(materials_by_key, objects_by_key) -> JSON-safe report.
Materials must be private WD_SOURCE_V4_ copies. Objects are the evaluated v3/v4
meshes in Blender Z-up/runtime scale, keyed like the source material contract.
A mapping value may be one mesh or a sequence of meshes sharing that material.
The module never opens/saves a file, bakes an image or changes mesh positions,
topology, UVs, normals, object transforms, lights, cameras or protected materials.

Wood coordinates are original per-piece wd_generated/wd_object attributes.
Endgrain is classified from each polygon's actual normal in wd_object space,
not its location in a bounding box. Only authoring attributes are added.
The caller must bake changed Metallic into ORM blue where listed. Native Coat
inputs are authored too; the standard PBR approximation is correlated albedo,
roughness and tangent normal unless a clearcoat-capable renderer is used.
"""
import hashlib
import json
import math

import numpy as np


REVISION = 'workshop-materials-v4.1'
MAX_JOINTS = 8
ALL_CHANNELS = ['Base Color', 'Roughness', 'Normal']


class _Graph:
    def __init__(self, material):
        self.nodes, self.links = material.node_tree.nodes, material.node_tree.links
        self.frame = self.nodes.new('NodeFrame')
        self.frame.name = 'WD_MATERIALS_V4'
        self.frame.label = 'V4 | piece grain, real end faces, physical finish layers'

    def node(self, kind, label):
        node = self.nodes.new(kind)
        node.parent, node.label = self.frame, label
        return node

    def connect(self, value, socket):
        if hasattr(value, 'node'):
            self.links.new(value, socket)
        else:
            socket.default_value = value

    def math(self, operation, a, b=0.0):
        node = self.node('ShaderNodeMath', operation)
        node.operation = operation
        self.connect(a, node.inputs[0])
        self.connect(b, node.inputs[1])
        return node.outputs[0]

    def remap(self, value, low, high, out_low=0.0, out_high=1.0):
        node = self.node('ShaderNodeMapRange', 'Clamped material mask')
        node.interpolation_type, node.clamp = 'SMOOTHSTEP', True
        self.connect(value, node.inputs['Value'])
        for name, v in [('From Min', low), ('From Max', high), ('To Min', out_low), ('To Max', out_high)]:
            node.inputs[name].default_value = v
        return node.outputs['Result']

    def attr(self, name, scalar=False):
        node = self.node('ShaderNodeAttribute', name)
        node.attribute_name = name
        return node.outputs['Fac' if scalar else 'Vector']

    def vector(self, operation, a, b):
        node = self.node('ShaderNodeVectorMath', operation)
        node.operation = operation
        self.connect(a, node.inputs[0])
        self.connect(b, node.inputs[1])
        return node.outputs['Value' if operation in {'DISTANCE', 'DOT_PRODUCT'} else 'Vector']

    def noise(self, vector, scale, detail=3.0):
        node = self.node('ShaderNodeTexNoise', 'Piece-local nonperiodic finish')
        self.connect(vector, node.inputs['Vector'])
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = .64
        return node.outputs['Fac']

    def source(self, socket, color=False):
        if socket.is_linked:
            return socket.links[0].from_socket
        node = self.node('ShaderNodeRGB' if color else 'ShaderNodeValue', 'Retained source constant')
        node.outputs[0].default_value = tuple(socket.default_value) if color else float(socket.default_value)
        return node.outputs[0]

    def mix(self, a, b, factor, mode='MIX'):
        node = self.node('ShaderNodeMixRGB', 'Material layer ' + mode)
        node.blend_type = mode
        self.connect(factor, node.inputs[0])
        self.connect(a, node.inputs[1])
        self.connect(b, node.inputs[2])
        return node.outputs[0]

    def scalar_mix(self, a, b, factor):
        return self.math('ADD', self.math('MULTIPLY', a, self.math('SUBTRACT', 1.0, factor)),
                         self.math('MULTIPLY', b, factor))

    def bump(self, p, height, distance, strength):
        node = self.node('ShaderNodeBump', 'Material film relief; no geometry displacement')
        node.inputs['Distance'].default_value = distance
        node.inputs['Strength'].default_value = strength
        self.connect(height, node.inputs['Height'])
        if p.inputs['Normal'].is_linked:
            self.links.new(p.inputs['Normal'].links[0].from_socket, node.inputs['Normal'])
        self.links.new(node.outputs['Normal'], p.inputs['Normal'])


def _objects(value):
    if value is None:
        return []
    return [value] if hasattr(value, 'type') else list(value)


def _array(mesh, name):
    attr = mesh.attributes.get(name)
    if attr is None or attr.data_type != 'FLOAT_VECTOR' or attr.domain != 'POINT':
        raise ValueError('Missing original per-piece POINT vector attribute: ' + name)
    result = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    attr.data.foreach_get('vector', result)
    return result.reshape((-1, 3)).astype(np.float64)


def _put(mesh, name, values, domain='POINT'):
    scalar = values.ndim == 1
    kind = 'FLOAT' if scalar else 'FLOAT_VECTOR'
    attr = mesh.attributes.get(name)
    if attr and (attr.data_type != kind or attr.domain != domain):
        raise ValueError('Conflicting authoring attribute: ' + name)
    if attr is None:
        attr = mesh.attributes.new(name, kind, domain)
    attr.data.foreach_set('value' if scalar else 'vector', np.ascontiguousarray(values, dtype=np.float32).ravel())


def _components(obj):
    mesh = obj.data
    local = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', local)
    local = local.reshape((-1, 3)).astype(np.float64)
    transform = np.asarray(obj.matrix_world, dtype=np.float64)
    world = local @ transform[:3, :3].T + transform[:3, 3]
    parent = np.arange(len(local), dtype=np.int32)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = int(parent[i])
        return i

    for edge in mesh.edges:
        a, b = map(int, edge.vertices)
        parent[find(a)] = find(b)
    groups = {}
    for i in range(len(local)):
        groups.setdefault(find(i), []).append(i)
    rows = []
    for ids in sorted(groups.values(), key=min):
        ids = np.asarray(ids, dtype=np.int32)
        points = world[ids]
        rows.append({'obj': obj, 'ids': ids, 'points': points,
                     'center': points.mean(axis=0), 'size': np.ptp(points, axis=0)})
    return world, rows


def _normal(points):
    if len(points) < 3:
        return np.zeros(3)
    normal = np.cross(points - points[0], np.roll(points, -1, axis=0) - points[0]).sum(axis=0)
    length = np.linalg.norm(normal)
    return normal / length if length > 1e-12 else np.zeros(3)


def _smooth(value, low, high):
    value = min(1.0, max(0.0, (value - low) / (high - low)))
    return value * value * (3.0 - 2.0 * value)


def _grain_axis(key):
    return 1 if 'grain-y' in key else 2 if 'grain-z' in key else 0


def _prepare(key, objects):
    rows, evidence = [], []
    axis = _grain_axis(key)
    for obj in objects:
        if obj.type != 'MESH' or not obj.data.uv_layers:
            raise ValueError('A UV-mapped evaluated mesh is required: ' + obj.name)
        mesh = obj.data
        original = _array(mesh, 'wd_object')
        _array(mesh, 'wd_generated')
        world, pieces = _components(obj)
        seed = np.empty(len(mesh.vertices), np.float32)
        shift = np.empty((len(mesh.vertices), 3), np.float32)
        for piece in pieces:
            token = '%s|%s|%d|%s' % (key, obj.name, int(piece['ids'].min()),
                                      ','.join('%.4f' % v for v in piece['center']))
            digest = hashlib.sha256(token.encode()).digest()
            random = np.array([int.from_bytes(digest[i:i+4], 'big') / 4294967295.0 for i in (0, 4, 8)])
            seed[piece['ids']] = random[0]
            shift[piece['ids']] = random * 7.0 - 3.5
            piece['seed'] = float(random[0])
        end = np.zeros(len(mesh.loops), np.float32)
        up = np.zeros(len(mesh.loops), np.float32)
        plane = np.zeros((len(mesh.loops), 3), np.float32)
        end_faces = 0
        for face in mesh.polygons:
            ids = list(face.vertices)
            n_local, n_world = _normal(original[ids]), _normal(world[ids])
            end_value = _smooth(abs(n_local[axis]), .78, .97)
            up_value = _smooth(n_world[2], .72, .98)
            end_faces += int(end_value > .5)
            dominant = int(np.argmax(np.abs(n_local)))
            plane_axes = (1, 2) if dominant == 0 else (0, 2) if dominant == 1 else (0, 1)
            for loop in face.loop_indices:
                vertex = mesh.loops[loop].vertex_index
                end[loop], up[loop] = end_value, up_value
                plane[loop, :2] = original[vertex, list(plane_axes)]
        _put(mesh, 'wd_piece_seed', seed)
        _put(mesh, 'wd_piece_shift', shift)
        _put(mesh, 'wd_v4_endgrain', end, 'CORNER')
        _put(mesh, 'wd_v4_face_up', up, 'CORNER')
        if key.startswith('wall'):
            _put(mesh, 'wd_v4_surface', plane, 'CORNER')
        evidence.append({'object': obj.name, 'connectedPieces': len(pieces), 'endgrainFaces': end_faces,
                         'grainLocalAxis': 'XYZ'[axis], 'seedSha256': hashlib.sha256(seed.tobytes()).hexdigest(),
                         'uniqueSeeds': len(np.unique(seed)), 'topologyPositionsUVsUntouched': True})
        rows.extend(pieces)
    return rows, evidence


def _seed_existing_grain(g, material):
    # Modify only the original timber mapping, not the v2 wear/contact masks.
    mappings = [node for node in list(material.node_tree.nodes)
                if node.type == 'VECT_MATH' and node.operation == 'MULTIPLY'
                and sorted(round(float(v), 3) for v in node.inputs[1].default_value) == [1.2, 23.0, 38.0]]
    for node in mappings:
        if not node.inputs[0].is_linked:
            continue
        original = node.inputs[0].links[0].from_socket
        shifted = g.vector('ADD', original, g.attr('wd_piece_shift'))
        # Same physical orientation; only phase varies between pieces.
        g.links.new(shifted, node.inputs[0])
    return len(mappings)


def _wood(g, p, key, material):
    mappings = _seed_existing_grain(g, material)
    if not mappings:
        raise ValueError('Expected source timber procedural mapping; do not pass a baked runtime material for ' + key)
    seed = g.attr('wd_piece_seed', True)
    shift = g.attr('wd_piece_shift')
    local = g.attr('wd_object')
    gen = g.attr('wd_generated')
    end = g.attr('wd_v4_endgrain', True)
    coords = g.vector('ADD', local, shift)
    base = g.source(p.inputs['Base Color'], True)
    rough = g.source(p.inputs['Roughness'])
    tone = g.mix((.93, .945, .965, 1), (1.055, 1.03, .995, 1), seed)
    base = g.mix(base, tone, 1.0, 'MULTIPLY')
    axis = _grain_axis(key)
    sep = g.node('ShaderNodeSeparateXYZ', 'Cross-section coordinates in original piece frame')
    g.connect(local, sep.inputs[0])
    transverse = [i for i in range(3) if i != axis]
    u = g.math('SUBTRACT', sep.outputs[transverse[0]], g.math('ADD', .11, g.math('MULTIPLY', seed, .15)))
    v = g.math('SUBTRACT', sep.outputs[transverse[1]], g.math('ADD', .05, g.math('MULTIPLY', seed, .09)))
    radius = g.math('SQRT', g.math('ADD', g.math('MULTIPLY', u, u), g.math('MULTIPLY', v, v)))
    ring_phase = g.math('ADD', g.math('MULTIPLY', radius, g.math('ADD', 260.0, g.math('MULTIPLY', seed, 100.0))),
                        g.math('MULTIPLY', g.noise(coords, 7.0), .7))
    rings = g.math('MULTIPLY_ADD', g.math('SINE', ring_phase), .5)
    # MULTIPLY_ADD has a third input: set explicitly for a 0..1 ring mask.
    rings.node.inputs[2].default_value = .5
    ring_tint = g.mix((.61, .54, .44, 1), (1.11, 1.055, .94, 1), rings)
    cross_section = g.mix(base, ring_tint, 1.0, 'MULTIPLY')
    base = g.mix(base, cross_section, g.math('MULTIPLY', end, .74))
    rough = g.math('ADD', rough, g.math('MULTIPLY', end, .055))
    finish_coords = g.vector('ADD', gen, g.vector('MULTIPLY', shift, (.18, .18, .18)))
    varnish = g.remap(g.noise(finish_coords, 3.8), .32, .70)
    base = g.mix(base, (.86, .81, .75, 1), g.math('MULTIPLY', varnish, .10), 'MULTIPLY')
    rough = g.scalar_mix(rough, .235, g.math('MULTIPLY', varnish, .28))
    rough = g.math('ADD', rough, g.math('MULTIPLY', g.math('SUBTRACT', 1.0, varnish), .035))
    g.bump(p, g.math('MULTIPLY', rings, end), .00048, .14)
    coat = g.math('ADD', .10, g.math('MULTIPLY', varnish, .25))
    coat_rough = g.scalar_mix(.32, .17, varnish)
    params = {'features': [11, 12, 19], 'grainLocalAxis': 'XYZ'[axis],
              'originalTimberMappingsSeeded': mappings, 'perPieceToneMultiplierRange': [.93, 1.055],
              'endgrainMask': 'CORNER-constant abs(actual polygon normal in original wd_object frame dot local grain axis)',
              'growthRingPeriodSourceM': [math.tau / 360, math.tau / 260],
              'endgrainReliefWorldM': .00048,
              'varnish': 'Correlated per-piece warm absorption, finish roughness and native coat; no lighting baked.',
              'sourceOnlyChannels': ['Coat Weight', 'Coat Roughness'],
              'standardPBRApproximation': 'Varnish appearance retained in Base Color/Roughness/Normal; separate clearcoat BRDF requires renderer support.'}
    if key.startswith('stage'):
        geom = g.node('ShaderNodeNewGeometry', 'Continuous tabletop material wetness field')
        # World coordinates are intentional only for moisture continuity across
        # board seams. Timber grain remains exclusively in original piece space.
        noise = g.noise(g.vector('MULTIPLY', geom.outputs['Position'], (1.0, 1.0, 2.1)), 1.9)
        wet = g.math('MULTIPLY', g.remap(noise, .44, .69), g.attr('wd_v4_face_up', True))
        breakup = g.remap(g.noise(geom.outputs['Position'], 7.2), .2, .8, .72, 1.0)
        wet = g.math('MULTIPLY', wet, breakup)
        dry_rough = g.math('ADD', .20, g.math('MULTIPLY', rough, .60))
        wet_rough = g.remap(noise, .44, .69, .215, .125)
        rough = g.scalar_mix(dry_rough, wet_rough, g.math('MULTIPLY', wet, .88))
        base = g.mix(base, (.62, .66, .67, 1), g.math('MULTIPLY', wet, .18), 'MULTIPLY')
        coat = g.math('ADD', .12, g.math('MULTIPLY', wet, .39))
        coat_rough = g.scalar_mix(.25, .10, wet)
        params.update({'features': [11, 12, 14, 19], 'wetnessMask': 'Continuous sparse tabletop field × actual upward-facing polygons',
                       'wetnessNoiseScaleRuntime': 1.9, 'wetnessThreshold': [.44, .69],
                       'wetColorLayerMax': .18, 'wetRoughnessTarget': [.125, .215],
                       'staticWaterGeometry': False, 'opacityChanged': False})
    if 'Coat Weight' in p.inputs:
        g.links.new(coat, p.inputs['Coat Weight'])
        g.links.new(coat_rough, p.inputs['Coat Roughness'])
    return base, rough, params


def _copper_joints(g, p, rows, objects_by_key):
    brass = []
    for key, value in objects_by_key.items():
        if not key.startswith('brass'):
            continue
        for obj in _objects(value):
            if obj.name == 'Workshop_FanRotor':
                continue
            _, components = _components(obj)
            brass.extend(piece for piece in components if .008 < np.max(piece['size']) < .23)
    per_object = {}
    for piece in rows:
        obj = piece['obj']
        per_object.setdefault(obj.name, (obj, np.full((len(obj.data.vertices), MAX_JOINTS, 3), 10000.0, np.float32)))
    piece_counts, total, truncated = [], 0, 0
    for piece in rows:
        points, center = piece['points'], piece['center']
        centered = points - center
        values, vectors = np.linalg.eigh(centered.T @ centered / max(1, len(points)))
        axis = vectors[:, -1]
        projection = centered @ axis
        radius = float(np.percentile(np.linalg.norm(centered - np.outer(projection, axis), axis=1), 75))
        anchors = []
        if np.ptp(projection) > .30 and values[-1] > max(values[-2], 1e-12) * 6 and radius < .095:
            for fitting in brass:
                delta = fitting['center'] - center
                along = float(delta @ axis)
                radial = float(np.linalg.norm(delta - along * axis))
                if projection.min() - .05 <= along <= projection.max() + .05 and radial < radius + .026:
                    anchor = center + along * axis
                    if not any(np.linalg.norm(anchor - old) < .018 for old in anchors):
                        anchors.append(anchor)
        anchors.sort(key=lambda point: float((point - center) @ axis))
        if len(anchors) > MAX_JOINTS:
            truncated += len(anchors) - MAX_JOINTS
        anchors = anchors[:MAX_JOINTS]
        for index, anchor in enumerate(anchors):
            per_object[obj.name][1][piece['ids'], index] = anchor
        total += len(anchors)
        piece_counts.append(len(anchors))
    for obj, values in per_object.values():
        for index in range(MAX_JOINTS):
            _put(obj.data, 'wd_v4_joint_%d' % index, values[:, index])
    geom = g.node('ShaderNodeNewGeometry', 'Physical proximity to copper/brass union centers')
    mask = 0.0
    for index in range(MAX_JOINTS):
        distance = g.vector('DISTANCE', geom.outputs['Position'], g.attr('wd_v4_joint_%d' % index))
        mask = g.math('MAXIMUM', mask, g.remap(distance, .045, .13, 1.0, 0.0))
    coords = g.vector('ADD', g.attr('wd_object'), g.attr('wd_piece_shift'))
    deposit = g.math('MULTIPLY', mask, g.remap(g.noise(coords, 19.0), .32, .72))
    base = g.mix(g.source(p.inputs['Base Color'], True), (.035, .15, .105, 1), g.math('MULTIPLY', deposit, .48))
    rough = g.scalar_mix(g.source(p.inputs['Roughness']), .72, g.math('MULTIPLY', deposit, .68))
    metallic = g.math('MULTIPLY', g.source(p.inputs['Metallic']), g.math('SUBTRACT', 1.0, g.math('MULTIPLY', deposit, .82)))
    g.links.new(metallic, p.inputs['Metallic'])
    g.bump(p, g.math('MULTIPLY', deposit, g.noise(coords, 48.0)), .00024, .12)
    return base, rough, {'features': [17], 'jointAnchors': total, 'pipePiecesWithJoints': sum(n > 0 for n in piece_counts),
                         'unmatchedPiecesUnchanged': sum(n == 0 for n in piece_counts), 'anchorsTruncated': truncated,
                         'jointDetection': 'Small brass components near the centerline of elongated copper components; no fan/brass material edit.',
                         'depositDistanceRuntimeM': [.045, .13], 'depositColorMixMax': .48,
                         'depositRoughnessTarget': .72, 'metallicReductionMax': .82,
                         'ormBlueMustBakeMetallicInput': True, 'noUniformMetalOxidation': True}


def _wall(g, p):
    plane = g.attr('wd_v4_surface')
    sep = g.node('ShaderNodeSeparateXYZ', 'Wall face plane in original source metres')
    g.connect(plane, sep.inputs[0])
    x, z = sep.outputs['X'], sep.outputs['Y']
    row = g.math('FLOOR', g.math('DIVIDE', z, .22))
    offset = g.math('MULTIPLY', g.math('PINGPONG', row, 1.0), .25)
    u = g.math('FRACT', g.math('DIVIDE', g.math('ADD', x, offset), .50))
    v = g.math('FRACT', g.math('DIVIDE', z, .22))
    edge_x = g.math('MULTIPLY', g.math('MINIMUM', u, g.math('SUBTRACT', 1.0, u)), .50)
    edge_y = g.math('MULTIPLY', g.math('MINIMUM', v, g.math('SUBTRACT', 1.0, v)), .22)
    mortar = g.math('MAXIMUM', g.remap(edge_x, .005, .018, 1, 0), g.remap(edge_y, .005, .018, 1, 0))
    variation = g.noise(plane, 4.7)
    brick = g.mix((.105, .065, .042, 1), (.19, .12, .073, 1), variation)
    masonry = g.mix(brick, (.19, .175, .145, 1), mortar)
    shifted = g.vector('ADD', plane, g.attr('wd_piece_shift'))
    patch_noise = g.noise(shifted, .65, 2.0)
    exposed = g.remap(patch_noise, .64, .79)
    repair = g.remap(patch_noise, .20, .38, 1.0, 0.0)
    base = g.source(p.inputs['Base Color'], True)
    base = g.mix(base, masonry, g.math('MULTIPLY', exposed, .78))
    base = g.mix(base, (.235, .24, .205, 1), g.math('MULTIPLY', repair, .23))
    rough = g.scalar_mix(g.source(p.inputs['Roughness']), .84, g.math('MULTIPLY', exposed, .75))
    rough = g.scalar_mix(rough, .91, g.math('MULTIPLY', repair, .25))
    relief = g.math('MULTIPLY', g.math('SUBTRACT', 1.0, mortar), exposed)
    g.bump(p, relief, .0015, .23)
    return base, rough, {'features': [20], 'surfaceProjection': 'Per-polygon original local face plane; no global triplanar smear',
                         'brickSizeSourceM': [.50, .22], 'mortarHalfWidthSourceM': [.005, .018],
                         'masonryExposureThreshold': [.64, .79], 'masonryExposureMax': .78,
                         'limewashRepairMixMax': .23, 'mortarReliefWorldM': .0015,
                         'scope': 'Localized exposed joints and feathered limewash repairs; no new geometry or structural fractures.'}


def apply_material_refinements(materials_by_key, objects_by_key):
    """Prepare bakeable material layers on private source copies; never bake/save.

    Base Color/Roughness/Normal are standard outputs. Copper also lists Metallic
    because deposited mineral is a dielectric mixture and ORM blue must vary.
    Brass, rotor, glass, leaves, emissive surfaces, text and fabrics are untouched.
    """
    report = {'revision': REVISION, 'changed': {}, 'skipped': {}, 'geometryChanged': False,
              'authoringAttributesAdded': True, 'lightingBaked': False,
              'bakePolicy': {'albedoMax': 1024, 'normalRoughnessMetallicMax': 512,
                             'newTextureChannels': False, 'ormBlue': 'Bake Principled Metallic where listed.'}}
    for key, material in sorted(materials_by_key.items()):
        kind = 'wood' if key.startswith(('oak', 'walnut', 'stage')) else 'copper' if key.startswith('copper') else 'wall' if key.startswith('wall') else None
        if kind is None:
            report['skipped'][key] = 'Protected or outside selected material proposals'
            continue
        if not material.name.startswith('WD_SOURCE_V4_'):
            raise ValueError('Only private WD_SOURCE_V4_ material copies may be edited: ' + material.name)
        saved = material.get('wd_material_refinements_v4')
        if saved:
            previous = json.loads(saved)
            if previous['revision'] != REVISION:
                raise ValueError('Load a clean v3 source before changing v4 material revision')
            report['changed'][key] = previous
            continue
        objects = _objects(objects_by_key.get(key))
        if not objects:
            raise ValueError('Missing evaluated mesh for material: ' + key)
        p = next((node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None)
        if p is None:
            raise ValueError('A Principled bake source is required for ' + key)
        rows, evidence = _prepare(key, objects)
        before = len(material.node_tree.nodes)
        g = _Graph(material)
        if kind == 'wood':
            base, rough, params = _wood(g, p, key, material)
        elif kind == 'copper':
            base, rough, params = _copper_joints(g, p, rows, objects_by_key)
        else:
            base, rough, params = _wall(g, p)
        g.links.new(base, p.inputs['Base Color'])
        g.links.new(g.math('MINIMUM', g.math('MAXIMUM', rough, .105), .965), p.inputs['Roughness'])
        change = {**params, 'revision': REVISION, 'material': material.name, 'profile': kind,
                  'channels': ALL_CHANNELS + (['Metallic'] if kind == 'copper' else []),
                  'objects': [obj.name for obj in objects], 'pieces': evidence,
                  'nodesAdded': len(material.node_tree.nodes) - before,
                  'alphaTransmissionEmissionUntouched': True, 'lightingBaked': False}
        material['wd_material_refinements_v4'] = json.dumps(change, sort_keys=True)
        report['changed'][key] = change
    return report
