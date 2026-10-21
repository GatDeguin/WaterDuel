"""Versioned workshop export: local material wear and one pivoted fan rotor.

Run in a private Blender background process, opening the v1 evaluated checkpoint.
The original authoring file, v1 asset and v1 textures are read-only inputs.
"""
import bpy
import os
import json
import math
import time
import hashlib
import runpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'assets', 'environment', 'workshop')
TEX = os.path.join(OUT, 'textures-v2')
CACHE = os.path.join(ROOT, 'output', 'blender', 'runtime-bake-cache-v2')
SOURCE = os.path.join(ROOT, 'output', 'blender', 'WaterDuel_Atelier.blend')
V1 = os.path.join(OUT, 'workshop-runtime.glb')
SOURCE_SHA = '2e92513be1f17a2e2d5cc357dddc8cd8d0e1dd62abbde226f4ec09c3a717b755'
V1_SHA = '1eb31ceef5913e3cce87cdc4397b5223ad678028957933de78e9b930c950c66d'
S = 95 / 147
TY = .3245 - 1.15 * S
BRASS = 'brass-tarnish-patina-polished-edges'
BLADE_NAMES = ['Fan swept brass blade %02d' % i for i in range(1, 6)]
PIVOT_SOURCE = (-6.5, 3.445, 3.3)
PIVOT_BLENDER = Vector((S * PIVOT_SOURCE[0], S * PIVOT_SOURCE[1], S * PIVOT_SOURCE[2] + TY))
PIVOT_RUNTIME = [PIVOT_BLENDER.x, PIVOT_BLENDER.z, -PIVOT_BLENDER.y]
REV = '2026-10-17-runtime-v2-rotor-atlas-1'
scene = bpy.context.scene
start = time.time()

def log(*args):
    print('WORKSHOP_V2', *args, flush=True)

def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()

def write(path, value):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)

def select(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.hide_set(False)
    obj.hide_render = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)

assert sha(SOURCE) == SOURCE_SHA and sha(V1) == V1_SHA, 'Frozen input changed'
assert scene.get('workshop_runtime_prepared'), 'Open WaterDuel_Runtime_Working.blend'
assert not scene.get('workshop_runtime_v2_prepared'), 'Start from the clean v1 checkpoint'
for folder in (TEX, CACHE):
    os.makedirs(folder, exist_ok=True)
v1_contract = json.load(open(os.path.join(OUT, 'asset-contract.json'), encoding='utf-8'))
prior = {r['object']: r for r in v1_contract['materials']}
configs = json.loads(scene['workshop_runtime_configs'])
objects = {key: bpy.data.objects[c['object']] for key, c in configs.items()}
mats = {}
for key, c in configs.items():
    m = bpy.data.materials[c['sourceBakeMaterial']].copy()
    m.name = 'WD_SOURCE_V2_' + key
    m.use_fake_user = True
    mats[key] = m
    objects[key].data.materials.clear()
    objects[key].data.materials.append(m)

# Recreate only the brass group, carrying a blade membership attribute through
# simplification and UV projection. Static and moving brass share a single atlas.
originals = [o for o in scene.objects if o.type in {'MESH', 'CURVE', 'FONT'}
             and not o.name.startswith('Workshop_') and len(o.data.materials) == 1
             and o.data.materials[0]
             and o.data.materials[0].name == 'Brass | tarnish, patina, polished edges']
assert set(BLADE_NAMES).issubset({o.name for o in originals}), 'Five source blades missing'
for o in originals:
    o.hide_set(False)
    o.hide_render = False
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()
col = objects[BRASS].users_collection[0]
parts = []
source_brass_triangles = 0
for original in sorted(originals, key=lambda o: o.name):
    data = bpy.data.meshes.new_from_object(original.evaluated_get(deps),
                                         preserve_all_data_layers=True, depsgraph=deps)
    if not data.polygons:
        bpy.data.meshes.remove(data)
        continue
    positions = np.empty(len(data.vertices) * 3, dtype=np.float32)
    data.vertices.foreach_get('co', positions)
    positions = positions.reshape((-1, 3))
    bounds = np.array(original.bound_box, dtype=np.float32)
    span = np.maximum(bounds.max(axis=0) - bounds.min(axis=0), 1e-9)
    for name, values in [('wd_generated', (positions - bounds.min(axis=0)) / span),
                         ('wd_object', positions)]:
        old = data.attributes.get(name)
        if old:
            data.attributes.remove(old)
        attr = data.attributes.new(name, 'FLOAT_VECTOR', 'POINT')
        attr.data.foreach_set('vector', np.ascontiguousarray(values).ravel())
    membership = data.attributes.new('wd_fan_rotor', 'INT', 'POINT')
    membership.data.foreach_set('value', np.full(len(data.vertices), int(original.name in BLADE_NAMES), dtype=np.int32))
    data.materials.clear()
    data.materials.append(mats[BRASS])
    data.transform(Matrix.Translation((0, 0, TY)) @ Matrix.Diagonal((S, S, S, 1)) @ original.matrix_world)
    data.update()
    part = bpy.data.objects.new('V2 evaluated | ' + original.name, data)
    col.objects.link(part)
    parts.append(part)
    source_brass_triangles += triangles(part)
for o in originals:
    o.hide_set(True)
    o.hide_render = True
old = objects[BRASS]
old_name = old.name
bpy.data.objects.remove(old, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
brass = bpy.context.object
brass.name = old_name
mod = brass.modifiers.new('Preserve blade membership; same runtime ratio', 'DECIMATE')
mod.ratio = .6
mod.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=mod.name)
select(brass)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.151917, island_margin=.006, area_weight=0,
                        correct_aspect=True, scale_to_bounds=False)
bpy.ops.object.mode_set(mode='OBJECT')
brass.data.uv_layers.active.name = 'UVMap'
objects[BRASS] = brass
configs[BRASS].update(trianglesBefore=source_brass_triangles, trianglesAfter=triangles(brass))
membership = np.empty(len(brass.data.vertices), dtype=np.int32)
brass.data.attributes['wd_fan_rotor'].data.foreach_get('value', membership)
rotor_faces, static_faces = [], []
for face in brass.data.polygons:
    values = membership[list(face.vertices)]
    assert np.all(values == values[0]) and values[0] in (0, 1), 'Mixed rotor/static polygon'
    (rotor_faces if values[0] else static_faces).append(face.index)
assert rotor_faces and static_faces
log('BRASS_REBUILT', source_brass_triangles, triangles(brass), 'rotor faces', len(rotor_faces))

wear = runpy.run_path(os.path.join(ROOT, 'scripts', 'workshop-wear-v2.py'))['apply_workshop_wear'](mats, objects)
for key, change in wear['changed'].items():
    configs[key]['procedural'] = True
    if 'Normal' in change['channels']:
        configs[key]['hasBump'] = True
scene['workshop_runtime_v2_prepared'] = True
scene['workshop_runtime_v2_wear'] = json.dumps(wear)
scene['workshop_runtime_configs'] = json.dumps(configs)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'output', 'blender', 'WaterDuel_Runtime_v2_Working.blend'))
write(os.path.join(OUT, 'wear-report-v2.json'), wear)

# Other objects still occlude AO rays, but their color shader is irrelevant to
# baking the selected mesh. Avoid recompiling every procedural graph each pass.
occluder = bpy.data.materials.new('V2 bake occluder; geometry only')
occluder.use_nodes = True
for obj in objects.values():
    obj.data.materials.clear()
    obj.data.materials.append(occluder)

scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 4
scene.render.bake.use_selected_to_active = False
scene.render.bake.use_clear = True
scene.render.bake.margin = 6
# Measured on this host: this exact 512px/16-sample bake takes 1.42 s on
# CPU versus ~140 s on OptiX with its unavailable driver cache. Quality is
# identical; prefer the measured CPU path and keep the shared GPU responsive.
scene.cycles.device = 'CPU'
scene.render.threads_mode = 'AUTO'
cache_path = os.path.join(CACHE, 'texture-cache-v2.json')
cache = json.load(open(cache_path, encoding='utf-8')) if os.path.exists(cache_path) else {}

def image(name, res, data=False):
    im = bpy.data.images.new(name, width=res, height=res, alpha=True)
    im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return im

def load(path, data=False):
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return im

def save(im, path):
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()

def target(mat, img):
    for node in mat.node_tree.nodes:
        node.select = False
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    node.select = True
    mat.node_tree.nodes.active = node
    return node

def map_sizes(c):
    name = c['sourceMaterial']
    floor = '/ floor' in name
    base = 1024 if name.startswith(('Oak |', 'Walnut |', 'Stage |', 'Wall |', 'Brass |', 'Window |')) and not floor else 512
    normal = 512 if name.startswith(('Oak |', 'Walnut |', 'Stage |', 'Wall |', 'Brass |', 'Forest green', 'Ivy | waxy', 'Blackened iron')) and not floor else 256
    orm = 512 if name.startswith(('Oak |', 'Walnut |', 'Stage |')) and not floor else 256
    if name.startswith(('Gold thread', 'Steel |')):
        base, orm = 256, 128
    return {'basecolor': base, 'normal': normal, 'orm': orm}

def bake_delta(key, c, channels):
    obj, mat = objects[key], mats[key]
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    positions = np.empty(len(obj.data.vertices) * 3, np.float32)
    obj.data.vertices.foreach_get('co', positions)
    uvs = np.empty(len(obj.data.loops) * 2, np.float32)
    obj.data.uv_layers.active.data.foreach_get('uv', uvs)
    sizes = map_sizes(c)
    checksum = hashlib.sha256((SOURCE_SHA + REV + wear['revision'] + key + json.dumps(sizes)
                              + json.dumps(wear['changed'].get(key), sort_keys=True)).encode()
                              + positions.tobytes() + uvs.tobytes()).hexdigest()
    files = {channel: 'textures-v2/' + key + '-' + channel + '.png' for channel in channels}
    paths = {channel: os.path.join(OUT, path) for channel, path in files.items()}
    if cache.get(key, {}).get('checksum') == checksum and all(os.path.isfile(p) for p in paths.values()):
        log('REUSE_DELTA', key)
        return {ch: load(p, ch != 'basecolor') for ch, p in paths.items()}, files
    select(obj)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    p = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
    surface = output.inputs['Surface'].links[0].from_socket
    emit = nodes.new('ShaderNodeEmission')
    emit.inputs['Strength'].default_value = 1
    result = {}
    for channel in ('basecolor', 'orm', 'normal'):
        if channel not in channels:
            continue
        res = sizes[channel]
        im = image('V2 ' + key + ' ' + channel, res, channel != 'basecolor')
        node = target(mat, im)
        if channel == 'normal':
            links.new(surface, output.inputs['Surface'])
            bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', normal_r='POS_X', normal_g='POS_Y', normal_b='POS_Z')
            pixels = np.empty(res * res * 4, np.float32)
            im.pixels.foreach_get(pixels)
            pixels = pixels.reshape((-1, 4))
            vec = pixels[:, :3] * 2 - 1
            vec /= np.maximum(np.linalg.norm(vec, axis=1, keepdims=True), 1e-8)
            pixels[:, :3] = vec * .5 + .5
            im.pixels.foreach_set(pixels.ravel())
        else:
            for link in list(emit.inputs['Color'].links):
                links.remove(link)
            src = p.inputs['Base Color' if channel == 'basecolor' else 'Roughness']
            if src.is_linked:
                links.new(src.links[0].from_socket, emit.inputs['Color'])
            else:
                value = src.default_value
                emit.inputs['Color'].default_value = tuple(value) if hasattr(value, '__len__') else (float(value),) * 3 + (1,)
            links.new(emit.outputs[0], output.inputs['Surface'])
            bpy.ops.object.bake(type='EMIT')
            if channel == 'orm':
                pixels = np.empty(res * res * 4, np.float32)
                im.pixels.foreach_get(pixels)
                pixels = pixels.reshape((-1, 4))
                packed = np.ones_like(pixels)
                packed[:, 1] = pixels[:, 0]
                packed[:, 2] = c['metallic']
                im.pixels.foreach_set(packed.ravel())
        nodes.remove(node)
        save(im, paths[channel])
        result[channel] = im
        log('BAKED_CHANNEL', key, channel, res)
    links.new(surface, output.inputs['Surface'])
    nodes.remove(emit)
    cache[key] = {'checksum': checksum, 'files': files, 'sizes': {ch: sizes[ch] for ch in channels}}
    write(cache_path, cache)
    return result, files

def runtime_material(key, c, imgs):
    mat = bpy.data.materials.new('Workshop v2 PBR | ' + key)
    mat.use_nodes = True
    mat.use_backface_culling = False
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = c['baseColorLinear']
    p.inputs['Roughness'].default_value = c['roughness']
    p.inputs['Metallic'].default_value = c['metallic']
    mat.diffuse_color = tuple(c['baseColorLinear'])
    if 'basecolor' in imgs:
        base = nodes.new('ShaderNodeTexImage')
        base.image = imgs['basecolor']
        links.new(base.outputs['Color'], p.inputs['Base Color'])
    if 'orm' in imgs:
        orm = nodes.new('ShaderNodeTexImage')
        orm.image = imgs['orm']
        split = nodes.new('ShaderNodeSeparateColor')
        split.mode = 'RGB'
        links.new(orm.outputs['Color'], split.inputs[0])
        links.new(split.outputs['Green'], p.inputs['Roughness'])
        links.new(split.outputs['Blue'], p.inputs['Metallic'])
    if 'normal' in imgs:
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = imgs['normal']
        normal = nodes.new('ShaderNodeNormalMap')
        links.new(texture.outputs['Color'], normal.inputs['Color'])
        links.new(normal.outputs['Normal'], p.inputs['Normal'])
    if c['emissionOnly'] and 'basecolor' in imgs:
        links.new(base.outputs['Color'], p.inputs['Emission Color'])
        p.inputs['Emission Strength'].default_value = .65
    if c['bulb']:
        p.inputs['Emission Color'].default_value = (1, .49, .15, 1)
        p.inputs['Emission Strength'].default_value = 1
    if c['glass']:
        p.inputs['Alpha'].default_value = .30
        p.inputs['Roughness'].default_value = .18
        mat.surface_render_method = 'DITHERED'
    return mat

records = []
runtime_mats = {}
for index, key in enumerate(sorted(configs)):
    c = configs[key]
    previous = prior[c['object']]
    files = dict(previous['textures'])
    imgs = {channel: load(os.path.join(OUT, path), channel != 'basecolor') for channel, path in files.items()}
    change = wear['changed'].get(key)
    if change or key == BRASS:
        channels = ['basecolor', 'orm']
        if key == BRASS or (change and 'Normal' in change['channels']):
            channels.append('normal')
        delta, deltafiles = bake_delta(key, c, channels)
        imgs.update(delta)
        files.update(deltafiles)
    mat = runtime_material(key, c, imgs)
    runtime_mats[key] = mat
    objects[key].data.materials.clear()
    objects[key].data.materials.append(occluder)
    records.append({**c, 'runtimeMaterial': mat.name, 'textures': files,
                    'textureDimensions': {ch: list(img.size) for ch, img in imgs.items()},
                    'normalConvention': '+Y / OpenGL',
                    'colorSpace': {'basecolor': 'sRGB', 'normal': 'linear', 'orm': 'linear'},
                    'wearRevision': wear['revision'] if change else None})
    log('MATERIAL_DONE', index + 1, len(configs), key)

for key, obj in objects.items():
    obj.data.materials.clear()
    obj.data.materials.append(runtime_mats[key])

def subset(source, faces, name, pivot=None):
    mesh = source.data
    used = sorted({v for i in faces for v in mesh.polygons[i].vertices})
    remap = {old: new for new, old in enumerate(used)}
    vertices = [mesh.vertices[i].co - pivot if pivot is not None else mesh.vertices[i].co for i in used]
    polygons = [[remap[v] for v in mesh.polygons[i].vertices] for i in faces]
    loops = [loop for i in faces for loop in mesh.polygons[i].loop_indices]
    data = bpy.data.meshes.new(name + ' mesh')
    data.from_pydata(vertices, [], polygons)
    data.materials.append(mesh.materials[0])
    data.update()
    uv = data.uv_layers.new(name='UVMap')
    old_uv = mesh.uv_layers.active.data
    uv.data.foreach_set('uv', np.array([old_uv[i].uv[:] for i in loops], np.float32).ravel())
    for new, old in zip(data.polygons, faces):
        new.use_smooth = mesh.polygons[old].use_smooth
    data.normals_split_custom_set([mesh.corner_normals[i].vector[:] for i in loops])
    obj = bpy.data.objects.new(name, data)
    col.objects.link(obj)
    if pivot is not None:
        obj.location = pivot
    return obj

static = subset(brass, static_faces, 'Workshop_StaticBrass')
rotor = subset(brass, rotor_faces, 'Workshop_FanRotor', PIVOT_BLENDER)
combined_brass_triangles = triangles(static) + triangles(rotor)
assert combined_brass_triangles == triangles(brass), 'Splitting changed triangle count'
bpy.data.objects.remove(brass, do_unlink=True)
objects[BRASS] = static
groups = list(objects.values()) + [rotor]
assert sum(triangles(o) for o in groups) <= 500000 and len(groups) <= 60
for r in records:
    if r['object'] == old_name:
        r['object'] = static.name
        r['additionalObjects'] = [rotor.name]
        r['trianglesAfter'] = combined_brass_triangles

# Editable copy: a slow, linear rotor loop is useful in Blender as well. glTF
# export deliberately contains only the rest pose; runtime uses sidecar speed.
rotor.rotation_mode = 'AXIS_ANGLE'
rotor.rotation_axis_angle = (0, 0, -1, 0)
rotor.keyframe_insert(data_path='rotation_axis_angle', index=0, frame=1)
duration = 2 * math.pi / 7.2
end_frame = 1 + duration * scene.render.fps
rotor.rotation_axis_angle[0] = 2 * math.pi
rotor.keyframe_insert(data_path='rotation_axis_angle', index=0, frame=end_frame)
try:
    action = rotor.animation_data.action
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for point in curve.keyframe_points:
                        point.interpolation = 'LINEAR'
                    curve.modifiers.new('CYCLES')
except Exception as error:
    log('ANIMATION_LOOP_API', str(error))
scene.frame_set(1)
for o in groups:
    o.hide_render = False
    o.hide_set(False)
bpy.ops.object.select_all(action='DESELECT')
for o in groups:
    o.select_set(True)
bpy.context.view_layer.objects.active = static
target_path = os.path.join(OUT, 'workshop-runtime-v2.glb')
bpy.ops.export_scene.gltf(filepath=target_path, export_format='GLB', use_selection=True,
    export_current_frame=True, export_yup=True, export_apply=True, export_normals=True, export_tangents=True,
    export_texcoords=True, export_materials='EXPORT', export_cameras=False,
    export_lights=False, export_animations=False, export_extras=False,
    export_attributes=False, export_image_format='AUTO')
assert sha(SOURCE) == SOURCE_SHA and sha(V1) == V1_SHA, 'Frozen input changed during export'
lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
for obj in groups:
    coords = np.array([obj.matrix_world @ v.co for v in obj.data.vertices])
    runtime = coords[:, [0, 2, 1]]
    runtime[:, 2] *= -1
    lo, hi = np.minimum(lo, runtime.min(axis=0)), np.maximum(hi, runtime.max(axis=0))
contract = {**v1_contract, 'asset': 'workshop-runtime-v2.glb', 'version': 2,
    'ready': False, 'stable': False, 'verification': 'Pending independent parser, reimport and preview inspection',
    'bounds': {'min': lo.tolist(), 'max': hi.tolist()},
    'coordinateTransform': {**v1_contract['coordinateTransform'],
        'nodeTransformRequired': True,
        'nodeTransformNote': 'Static nodes are identity. Apply the fan node translation once; do not reapply source scale.'},
    'budgets': {'maxTriangles': 500000, 'maxDrawGroups': 60,
        'measuredTriangles': sum(triangles(o) for o in groups), 'measuredGroups': len(groups)},
    'materials': records,
    'fanRotor': {'name': rotor.name, 'pivot': PIVOT_RUNTIME, 'axis': [0, 0, 1],
        'angularSpeed': 7.2, 'angularSpeedUnit': 'radians/second',
        'coordinateSpace': 'runtime world', 'sourceObjects': BLADE_NAMES,
        'expectedRadiusRange': [.64, .72], 'triangles': triangles(rotor),
        'restTransform': 'translation(pivot)', 'motion': 'translation(pivot) * rotationZ(angularSpeed*time)',
        'staticComponents': 'Cage, badge, motor, yoke and pedestal remain static; no duplicated static blades.'},
    'wear': {'report': 'wear-report-v2.json', 'revision': wear['revision'],
        'changedMaterials': len(wear['changed']), 'geometryDisplacement': False,
        'glassProtected': True, 'illuminationBaked': False},
    'textureBudget': {'maxFileMiB': 64, 'maxRGBA8WithMipsMiB': 200,
        'policy': 'Reuse unchanged v1 maps; bake changed channels only. No compression decoder required.'},
    'export': {'blenderVersion': bpy.app.version_string, 'pipeline': REV,
        'fileBytes': os.path.getsize(target_path), 'seconds': time.time() - start},
    'validation': {'parser': 'verification-v2.json', 'reimport': 'reimport-verification-v2.json',
        'preview': 'preview-glb-v2-eevee.png', 'runtimeIntegration': 'Principal validates separately'}}
write(os.path.join(OUT, 'asset-contract-v2.json'), contract)
write(os.path.join(OUT, 'export-receipt-v2.json'), {'file': contract['asset'],
    'sha256': sha(target_path), 'bytes': os.path.getsize(target_path),
    'triangles': contract['budgets']['measuredTriangles'], 'groups': len(groups),
    'sourceSha256': SOURCE_SHA, 'v1Sha256': V1_SHA, 'sourcePreserved': True,
    'seconds': time.time() - start, 'ready': False})
# Keep a compact, editable version with all textures packed. Original source
# objects remain hidden for provenance; no originals are removed from disk.
for img in bpy.data.images:
    if img.source == 'FILE' and img.filepath and os.path.isfile(bpy.path.abspath(img.filepath)):
        try:
            img.pack()
        except RuntimeError:
            pass
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'output', 'blender', 'WaterDuel_Atelier_v2.blend'))
log('EXPORTED', target_path, contract['budgets'], os.path.getsize(target_path), sha(target_path))
