"""Read-only crossing audit of the authored workshop and its optimized v2 copy.

Run in an isolated Blender background process. Never saves a .blend or exports.
Writes only audit/workshop-crossings-v2.json and the authorized
audit/workshop-v3-selection-map.json. Geometry tests use evaluated world-space
triangles; the SAT check rejects BVH bounding-box false positives.
"""
import bpy
import json
import math
import hashlib
from pathlib import Path
from collections import defaultdict
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'output/blender/WaterDuel_Atelier.blend'
V2 = ROOT / 'output/blender/WaterDuel_Atelier_v2.blend'
REPORT = ROOT / 'audit/workshop-crossings-v2.json'
SELECTION_MAP = ROOT / 'audit/workshop-v3-selection-map.json'
S = 95 / 147
TY = .3245 - 1.15 * S
EPS = 1e-7


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bounds(points):
    a = np.asarray(points, dtype=np.float64)
    return {'min': a.min(axis=0).tolist(), 'max': a.max(axis=0).tolist()}


def runtime_points(source):
    p = np.asarray(source, dtype=np.float64)
    return np.column_stack((p[:, 0] * S, p[:, 2] * S + TY, -p[:, 1] * S))


def source_points(v2_blender):
    p = np.asarray(v2_blender, dtype=np.float64)
    return np.column_stack((p[:, 0] / S, p[:, 1] / S, (p[:, 2] - TY) / S))


def corners(b):
    return np.array([[b['min'][0] if i == 0 else b['max'][0],
                      b['min'][1] if j == 0 else b['max'][1],
                      b['min'][2] if k == 0 else b['max'][2]]
                     for i in range(2) for j in range(2) for k in range(2)])


def intersects(a, b, axes=(0, 1, 2), margin=0):
    return all(a['min'][i] <= b['max'][i] + margin and
               a['max'][i] >= b['min'][i] - margin for i in axes)


def merged(rows):
    return bounds([p for row in rows for p in corners(row['bbox_source_z_up'])])


def geometry(obj, deps):
    evaluated = obj.evaluated_get(deps)
    me = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=deps)
    if me is None:
        return None
    me.calc_loop_triangles()
    local = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', local)
    local = local.reshape((-1, 3))
    mat = np.array(obj.matrix_world, dtype=np.float64)
    p = local @ mat[:3, :3].T + mat[:3, 3]
    t = np.array([tuple(tri.vertices) for tri in me.loop_triangles], dtype=np.int32)
    evaluated.to_mesh_clear()
    if not len(t):
        return None
    return p, t


def tri_sat(a, b):
    ea = np.roll(a, -1, axis=0) - a
    eb = np.roll(b, -1, axis=0) - b
    na = np.cross(ea[0], ea[1])
    nb = np.cross(eb[0], eb[1])
    axes = [na, nb]
    axes.extend(np.cross(x, y) for x in ea for y in eb)
    # Additional in-plane axes handle coplanar thin cloth/linework triangles.
    axes.extend(np.cross(na, e) for e in list(ea) + list(eb))
    axes.extend(np.cross(nb, e) for e in list(ea) + list(eb))
    for axis in axes:
        length = np.linalg.norm(axis)
        if length < 1e-12:
            continue
        axis = axis / length
        pa, pb = a @ axis, b @ axis
        if pa.max() < pb.min() - EPS or pb.max() < pa.min() - EPS:
            return False
    return True


def family(name):
    if name.startswith(('Drafting board', 'Puppet construction drawing', 'Blueprint |', 'Drawing board brass tack')):
        return 'rear_blueprint'
    if name.startswith(('Grand WaterDuel', 'Grand embroidered', 'Grand standard', 'Grand banner', 'Embroidery | Grand')):
        return 'grand_banner'
    if name.startswith(('Arena apron pennant', 'Apron woven insignia')):
        return 'apron'
    if name.startswith(('Workshop pennant', 'Pennant woven emblem', 'Pennant serial', 'Embroidery | Pennant')):
        return 'side_pennant'
    return None


def physical_pair(a, b):
    if not intersects(a['bbox_source_z_up'], b['bbox_source_z_up']):
        return {'triangle_crossing': False, 'bvh_candidates': 0, 'sat_confirmed': 0}
    pairs = a['_bvh'].overlap(b['_bvh'])
    confirmed = 0
    examples = []
    for ia, ib in pairs:
        ta, tb = a['_p'][a['_t'][ia]], b['_p'][b['_t'][ib]]
        if tri_sat(ta, tb):
            confirmed += 1
            if len(examples) < 3:
                examples.append({'triangle_a': int(ia), 'triangle_b': int(ib),
                                 'center_a_source': ta.mean(axis=0).tolist(),
                                 'center_b_source': tb.mean(axis=0).tolist()})
    return {'triangle_crossing': confirmed > 0, 'bvh_candidates': len(pairs),
            'sat_confirmed': confirmed, 'examples': examples}


def ray_occlusion(a, b):
    ba, bb = a['bbox_source_z_up'], b['bbox_source_z_up']
    xs = np.linspace(max(ba['min'][0], bb['min'][0]), min(ba['max'][0], bb['max'][0]), 9)
    zs = np.linspace(max(ba['min'][2], bb['min'][2]), min(ba['max'][2], bb['max'][2]), 9)
    front = min(ba['min'][1], bb['min'][1]) - 1
    hits = []
    for x in xs:
        for z in zs:
            origin = Vector((float(x), front, float(z)))
            ha = a['_bvh'].ray_cast(origin, Vector((0, 1, 0)), 30)[0]
            hb = b['_bvh'].ray_cast(origin, Vector((0, 1, 0)), 30)[0]
            if ha is not None and hb is not None and hb.y < ha.y - 1e-5:
                hits.append({'x': float(x), 'z': float(z), 'panel_front_y': ha.y,
                             'obstacle_front_y': hb.y, 'obstacle_in_front_by': ha.y - hb.y})
    return {'sample_count': 81, 'front_occlusion_hits': len(hits), 'examples': hits[:3]}


initial_hashes = {str(p.relative_to(ROOT)): sha(p) for p in (SOURCE, V2)}
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene
deps = bpy.context.evaluated_depsgraph_get()
original = {}
groups = defaultdict(list)
for obj in scene.objects:
    if obj.type not in {'MESH', 'CURVE', 'FONT'} or obj.hide_render or obj.name == 'Workshop air':
        continue
    f = family(obj.name)
    arch = any(c.name.startswith(('01 |', '02 |', '03 |', '04 |')) for c in obj.users_collection)
    if not f and not arch:
        continue
    g = geometry(obj, deps)
    if not g:
        continue
    p, t = g
    row = {'name': obj.name, 'type': obj.type,
           'materials': [m.name for m in obj.data.materials if m],
           'collections': [c.name for c in obj.users_collection],
           'vertices': len(p), 'triangles': len(t),
           'bbox_source_z_up': bounds(p), 'bbox_runtime_y_up': bounds(runtime_points(p)),
           '_p': p, '_t': t, '_bvh': BVHTree.FromPolygons(p.tolist(), t.tolist(), all_triangles=True)}
    original[obj.name] = row
    if f:
        cx = float((p[:, 0].min() + p[:, 0].max()) / 2)
        if f == 'apron':
            f += '_left' if cx < 0 else '_right'
        elif f == 'side_pennant':
            cy = float((p[:, 1].min() + p[:, 1].max()) / 2)
            f += '_left_front' if cy < 6 else ('_left_rear' if cx < 0 else '_right_rear')
        row['family'] = f
        groups[f].append(row)

panel_names = {r['name'] for rows in groups.values() for r in rows}
obstacles = [r for name, r in original.items() if name not in panel_names and
             any(m.startswith(('Oak |', 'Walnut |', 'Blackened iron |', 'Brass |')) for m in r['materials'])]
findings = []
group_reports = []
for group_id, rows in sorted(groups.items()):
    gb = merged(rows)
    projected = [r for r in obstacles if intersects(gb, r['bbox_source_z_up'], axes=(0, 2)) and
                 r['bbox_source_z_up']['min'][1] <= gb['max'][1] + .5 and
                 r['bbox_source_z_up']['max'][1] >= gb['min'][1] - 3]
    hits = []
    blockers = {}
    for a in rows:
        for b in obstacles:
            ba, bb = a['bbox_source_z_up'], b['bbox_source_z_up']
            if not intersects(ba, bb, axes=(0, 2)):
                continue
            # Keep foreground galleries/shelves in scope: they may occlude a
            # panel even when they do not touch its present rear plane.
            if bb['min'][1] > ba['max'][1] + .5 or bb['max'][1] < ba['min'][1] - 3:
                continue
            physical = physical_pair(a, b)
            occlusion = ray_occlusion(a, b)
            if physical['triangle_crossing'] or occlusion['front_occlusion_hits']:
                record = {'group': group_id, 'panel': a['name'], 'obstacle': b['name'],
                          'physical': physical, 'ray_depth': occlusion}
                findings.append(record)
                hits.append(record)
                blockers[b['name']] = b
    clearance = .04
    # A floor contact is a vertical support issue, not a reason to move cloth
    # past the front edge of the 25m-long room floor.
    depth_blockers = [r for r in blockers.values() if r['name'] != 'Workshop floor']
    delta = min([0] + [r['bbox_source_z_up']['min'][1] - gb['max'][1] - clearance for r in depth_blockers])
    suggested = math.floor(delta * 100) / 100 if delta < 0 else 0
    lift = math.ceil((.01 - gb['min'][2]) * 1000) / 1000 if 'Workshop floor' in blockers else 0
    row = {'id': group_id, 'source_names': sorted(r['name'] for r in rows),
           'bbox_source_z_up': gb, 'bbox_runtime_y_up': bounds(runtime_points(corners(gb))),
           'source_materials': sorted({m for r in rows for m in r['materials']}),
           'affected_pair_count': len(hits), 'triangle_crossing_pairs': sum(h['physical']['triangle_crossing'] for h in hits),
           'blocking_architecture_names': sorted(blockers),
           'projected_architecture_names': sorted(r['name'] for r in projected),
           'recommended_rigid_delta_source': [0, suggested, lift],
           'recommended_rigid_delta_v2_blender': [0, suggested * S, lift * S],
           'recommended_rigid_delta_runtime': [0, lift * S, -suggested * S],
           'clearance_source_m': clearance,
           'method': 'Rigidly move every named cloth/paper/backing/embroidery/pole/tack in this coherent group towards the camera (-source Y). Conservative group rear bound clears all diagnosed obstacles.'}
    group_reports.append(row)
    print('CROSSING_GROUP', group_id, row['triangle_crossing_pairs'], row['affected_pair_count'], 'deltaY', suggested, flush=True)

# Store source-target geometry for nearest-surface mapping after opening v2.
source_target_rows = [r for rows in groups.values() for r in rows]
source_by_material = defaultdict(list)
for r in source_target_rows:
    for m in r['materials']:
        source_by_material[m].append(r)
projected_names = {name for gr in group_reports for name in gr['projected_architecture_names']}
blocker_by_material = defaultdict(list)
for name in projected_names:
    r = original[name]
    for m in r['materials']:
        blocker_by_material[m].append(r)

bpy.ops.wm.open_mainfile(filepath=str(V2))
scene = bpy.context.scene
scene.frame_set(1)
deps = bpy.context.evaluated_depsgraph_get()
configs = json.loads(scene.get('workshop_runtime_configs', '{}'))
config_by_object = {v['object']: v for v in configs.values()}
runtime_components = []
blocker_components = []
containment_audit = []
runtime_mesh_hashes = {}
runtime_geometries = {}
for obj in scene.objects:
    if obj.type != 'MESH' or not obj.name.startswith('Workshop_') or obj.name == 'Workshop_FanRotor':
        continue
    config = config_by_object.get(obj.name, {})
    label = config.get('sourceMaterial')
    if obj.name == 'Workshop_StaticBrass':
        label = 'Brass | tarnish, patina, polished edges'
    if label and label.endswith(' / floor'):
        label = label[:-8]
    candidates = source_by_material.get(label, [])
    blocker_candidates = blocker_by_material.get(label, [])
    if not candidates and not blocker_candidates:
        continue
    me = obj.data
    local = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get('co', local)
    local = local.reshape((-1, 3))
    matrix = np.asarray(obj.matrix_world, dtype=np.float64)
    world = local @ matrix[:3, :3].T + matrix[:3, 3]
    authored = source_points(world)
    me.calc_loop_triangles()
    runtime_geometries[obj.name] = (authored, np.array([tuple(t.vertices) for t in me.loop_triangles], dtype=np.int32))
    uv_hashes = {}
    for uv in me.uv_layers:
        values = np.empty(len(uv.data) * 2, dtype=np.float32)
        uv.data.foreach_get('uv', values)
        uv_hashes[uv.name] = hashlib.sha256(values.tobytes()).hexdigest()
    edge_values = np.array([tuple(e.vertices) for e in me.edges], dtype=np.int32)
    runtime_mesh_hashes[obj.name] = {'vertices': len(me.vertices), 'edges': len(me.edges),
        'polygons': len(me.polygons), 'loops': len(me.loops), 'uv_sha256': uv_hashes,
        'vertex_coords_float64_sha256': hashlib.sha256(local.tobytes()).hexdigest(),
        'edge_indices_int32_sha256': hashlib.sha256(edge_values.tobytes()).hexdigest()}
    parent = list(range(len(local)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for e in me.edges:
        a, b = map(int, e.vertices)
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
    components = defaultdict(list)
    for i in range(len(local)):
        components[find(i)].append(i)
    for ids in components.values():
        pts = authored[ids]
        cb = bounds(pts)
        # Architectural components are mapped independently. They are never
        # folded into a panel selection merely because a prism contains them.
        near_blockers = [r for r in blocker_candidates if
                         all(cb['min'][i] >= r['bbox_source_z_up']['min'][i] - .005 and
                             cb['max'][i] <= r['bbox_source_z_up']['max'][i] + .005 for i in range(3))]
        blocker_scores = []
        for candidate in near_blockers:
            sample_ids = np.linspace(0, len(ids) - 1, min(9, len(ids)), dtype=int)
            distances = [candidate['_bvh'].find_nearest(Vector(pts[j]))[3] for j in sample_ids]
            if all(d is not None for d in distances):
                blocker_scores.append((float(max(distances)), float(np.mean(distances)), candidate))
        if blocker_scores:
            blocker_scores.sort(key=lambda x: (x[0], x[1]))
            best_blocker = blocker_scores[0]
            if best_blocker[0] <= .035:
                blocker_components.append({'runtime_object': obj.name, 'source_material': label,
                    'component_id_min_vertex': min(ids), 'vertex_indices': ids,
                    'vertex_count': len(ids), 'closest_original': best_blocker[2]['name'],
                    'bbox_source_z_up': cb, 'bbox_runtime_y_up': bounds(runtime_points(pts)),
                    'max_sample_distance_source_m': best_blocker[0],
                    'source_name_ambiguous': len([s for s in blocker_scores if s[0] < best_blocker[0] + .0001]) > 1})
        containment = [gr['id'] for gr in group_reports if label in gr['source_materials'] and
                       all(cb['min'][i] >= gr['bbox_source_z_up']['min'][i] - .002 and
                           cb['max'][i] <= gr['bbox_source_z_up']['max'][i] + .002 for i in range(3))]
        containment_record = None
        if containment:
            containment_record = {'runtime_object': obj.name, 'component_id_min_vertex': min(ids),
                                  'vertex_count': len(ids), 'bbox_source_z_up': cb,
                                  'contained_groups': containment, 'nearest_surface_group': None}
            containment_audit.append(containment_record)
        near = [r for r in candidates if intersects(cb, r['bbox_source_z_up'], margin=.035)]
        if not near:
            continue
        sample_ids = np.linspace(0, len(ids) - 1, min(9, len(ids)), dtype=int)
        scores = []
        for candidate in near:
            dist = [candidate['_bvh'].find_nearest(Vector(pts[j]))[3] for j in sample_ids]
            if all(d is not None for d in dist):
                scores.append((float(max(dist)), float(np.mean(dist)), candidate))
        if not scores:
            continue
        scores.sort(key=lambda x: (x[0], x[1]))
        best = scores[0]
        if best[0] > .035:
            continue
        chosen = best[2]
        if containment_record is not None:
            containment_record['nearest_surface_group'] = chosen['family']
        competing_families = sorted({s[2]['family'] for s in scores if s[0] < best[0] + .004})
        source_name = chosen['name']
        runtime_components.append({'runtime_object': obj.name, 'source_material': label,
             'component_id_min_vertex': min(ids), 'vertex_count': len(ids),
             'vertex_indices': ids,
             'bbox_source_z_up': cb, 'bbox_runtime_y_up': bounds(runtime_points(pts)),
             'closest_original': source_name, 'group': chosen['family'],
             'max_sample_distance_source_m': best[0], 'mean_sample_distance_source_m': best[1],
             'competing_families': competing_families,
             'group_match_unambiguous': len(competing_families) == 1,
             'bbox_contained_group_candidates': containment,
             'uv_layer_names': [uv.name for uv in me.uv_layers]})
    print('COMPONENTS_MAPPED', obj.name, len(runtime_components), flush=True)


def combined_runtime_geometry(components):
    by_node = defaultdict(list)
    for comp in components:
        by_node[comp['runtime_object']].append(comp)
    all_p, all_t, offset = [], [], 0
    for node, comps in by_node.items():
        p, t = runtime_geometries[node]
        mask = np.zeros(len(p), dtype=bool)
        for comp in comps:
            mask[comp['vertex_indices']] = True
        chosen = t[np.all(mask[t], axis=1)]
        if not len(chosen):
            continue
        ids = np.unique(chosen)
        remap = np.full(len(p), -1, dtype=np.int32)
        remap[ids] = np.arange(len(ids), dtype=np.int32)
        all_p.append(p[ids])
        all_t.append(remap[chosen] + offset)
        offset += len(ids)
    if not all_p:
        return None
    p, t = np.concatenate(all_p), np.concatenate(all_t)
    return {'_p': p, '_t': t, 'bbox_source_z_up': bounds(p),
            '_bvh': BVHTree.FromPolygons(p.tolist(), t.tolist(), all_triangles=True)}


v2_baseline = []
for gr in group_reports:
    target = combined_runtime_geometry([c for c in runtime_components if c['group'] == gr['id']])
    for name in gr['projected_architecture_names']:
        blocker = combined_runtime_geometry([c for c in blocker_components if c['closest_original'] == name])
        if target is None or blocker is None:
            continue
        physical = physical_pair(target, blocker)
        if physical['triangle_crossing']:
            v2_baseline.append({'group': gr['id'], 'obstacle_original': name, 'physical': physical,
                                'floor_contact': name == 'Workshop floor'})
    print('V2_BASELINE_GROUP', gr['id'], sum(r['group'] == gr['id'] for r in v2_baseline), flush=True)

after_hashes = {str(p.relative_to(ROOT)): sha(p) for p in (SOURCE, V2)}
public_rows = []
for row in original.values():
    public_rows.append({k: v for k, v in row.items() if not k.startswith('_')})
report = {
    'scope': 'Read-only evaluated geometry audit. No scene saves, GLB exports, renders, runtime changes or texture writes.',
    'blender_version': bpy.app.version_string,
    'source_hashes_before': initial_hashes, 'source_hashes_after': after_hashes,
    'source_files_unchanged': initial_hashes == after_hashes,
    'coordinate_mapping': {'scale': S, 'translation_runtime_y': TY,
        'source_to_runtime': ['x=s*x', 'y=s*z+t', 'z=-s*y'],
        'source_to_v2_native_blender': ['x=s*x', 'y=s*y', 'z=s*z+t'],
        'depth_delta': 'A source -Y rigid displacement becomes v2-native Blender -Y*s and runtime +Z*s.'},
    'physical_test': 'BVHTree overlap followed by triangle SAT on normals, all edge-cross-edge axes, and coplanar in-plane axes; epsilon=1e-7m. 9x9 parallel +Y rays additionally test front occlusion. Triangle crossing proves surface intersection, not only AABB overlap.',
    'groups': group_reports, 'crossings': findings,
    'original_objects': public_rows,
    'v2_component_mapping': runtime_components,
    'v2_blocker_component_mapping': blocker_components,
    'runtime_mesh_hashes': runtime_mesh_hashes,
    'v2_evaluated_surface_crossing_baseline': v2_baseline,
    'bbox_containment_audit': {
        'tolerance_source_m': .002,
        'contained_components': len(containment_audit),
        'ambiguities': [r for r in containment_audit if len(r['contained_groups']) != 1],
        'contained_without_nearest_match': [r for r in containment_audit if r['nearest_surface_group'] is None],
        'disagreement': [r for r in containment_audit if r['nearest_surface_group'] is not None and
                         r['nearest_surface_group'] not in r['contained_groups']],
        'nearest_components_not_contained': [{k: c[k] for k in ('runtime_object', 'component_id_min_vertex', 'group', 'closest_original', 'bbox_source_z_up')}
                                             for c in runtime_components if c['group'] not in c['bbox_contained_group_candidates']],
        'all_contained_components': containment_audit},
    'component_mapping_summary': {
        'mapped_components': len(runtime_components),
        'ambiguous_group_components': sum(not c['group_match_unambiguous'] for c in runtime_components),
        'groups': {r['id']: sum(c['group'] == r['id'] for c in runtime_components) for r in group_reports}},
    'transfer_recommendation': [
        'Use connected geometry islands in material-joined v2 meshes, not UV islands: glyph contours, hardware and disconnected curves create several islands per original.',
        'Select whole connected components matched to the original evaluated surfaces by material plus inverse-transformed spatial bounds and nearest-BVH distance. Reject cross-family ambiguous components.',
        'Apply source delta through the known scale to all vertices of every component in a coherent panel group. Preserve object identity, polygon/loop order, UV coordinates, material slots, images and fan rig.',
        'No rebake is needed for a pure translation because v2 uses baked albedo/ORM/tangent normal maps and the UVs/tangent orientation do not change.',
        'Validate source hashes, UV hashes, unchanged topology and textures, then run fresh intersection and projected-occlusion tests after deltas; also inspect the final camera render.'
    ]}
REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


def selections(components):
    by_node = defaultdict(list)
    for comp in components:
        by_node[comp['runtime_object']].append(comp)
    return [{'nodeName': node, 'vertexIndices': sorted({i for c in comps for i in c['vertex_indices']}),
             'componentList': [{'minVertex': c['component_id_min_vertex'], 'vertexCount': c['vertex_count'],
                                'vertexIndices': c['vertex_indices'],
                                'sourceObject': c['closest_original']} for c in comps]}
            for node, comps in sorted(by_node.items())]


assemblies = []
for gr in group_reports:
    selected = [c for c in runtime_components if c['group'] == gr['id']]
    projected_blockers = [c for c in blocker_components if c['closest_original'] in gr['projected_architecture_names']]
    recommended = gr['recommended_rigid_delta_source']
    chosen = [0, -.14, .025] if gr['id'].startswith('apron_') else recommended
    assemblies.append({'id': gr['id'], 'sourceObjects': gr['source_names'],
        'sourceBounds': gr['bbox_source_z_up'], 'runtimeBounds': gr['bbox_runtime_y_up'],
        'sourceDelta': chosen, 'v2BlenderDelta': [d * S for d in chosen],
        'runtimeDelta': [chosen[0] * S, chosen[2] * S, -chosen[1] * S],
        'runtimeSelections': selections(selected),
        'blockerSourceObjects': gr['projected_architecture_names'],
        'blockerSelections': selections(projected_blockers),
        'sourceBlockerBounds': {name: original[name]['bbox_source_z_up'] for name in gr['projected_architecture_names']},
        'confirmedCrossingBlockers': gr['blocking_architecture_names'],
        'allPanelGroupsUnambiguous': all(c['group_match_unambiguous'] for c in selected)})
selection_doc = {'scope': 'Exact connected-component vertex selections for a v3 copy. Does not authorize or perform mutation.',
    'input': str(V2.relative_to(ROOT)), 'inputSha256': initial_hashes[str(V2.relative_to(ROOT))],
    'vertexIndexSpace': 'Object mesh vertex indices in WaterDuel_Atelier_v2.blend, before export and before any topology change.',
    'coordinateTransform': report['coordinate_mapping'], 'runtimeMeshHashes': runtime_mesh_hashes,
    'assemblies': assemblies,
    'v2_evaluated_surface_crossing_baseline': v2_baseline,
    'selectionWarnings': report['bbox_containment_audit'],
    'source_files_unchanged': report['source_files_unchanged']}
SELECTION_MAP.write_text(json.dumps(selection_doc, ensure_ascii=False, indent=2), encoding='utf-8')
assert report['source_files_unchanged'], 'Input file bytes changed unexpectedly'
print('CROSSING_AUDIT_READY', str(REPORT), len(findings), 'pairs', len(runtime_components), 'panel components', len(blocker_components), 'blocker components', flush=True)
