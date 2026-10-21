"""Restore scaled authoring cameras/lights in the editable runtime-v2 copy only."""
import bpy
import os
import json
import math
from mathutils import Matrix, Vector
from bpy_extras.anim_utils import action_get_channelbag_for_slot

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'output', 'blender', 'WaterDuel_Atelier_v2.blend')
assert os.path.normcase(bpy.data.filepath) == os.path.normcase(PATH)
scene = bpy.context.scene
assert not scene.get('workshop_v2_lights_restored'), 'Already finalized; do not scale twice'
S, TY = 95 / 147, .3245 - 1.15 * 95 / 147
transform = Matrix.Translation((0, 0, TY)) @ Matrix.Diagonal((S, S, S, 1))
lights, cameras = [], []
for obj in scene.objects:
    if obj.type not in {'CAMERA', 'LIGHT'}:
        continue
    position, rotation, _ = (transform @ obj.matrix_world).decompose()
    obj.matrix_world = Matrix.Translation(position) @ rotation.to_matrix().to_4x4()
    obj.hide_render = False
    obj.hide_set(False)
    if obj.type == 'LIGHT':
        obj.data.energy *= S * S
        if obj.data.type == 'AREA':
            obj.data.size *= S
            obj.data.size_y *= S
        if hasattr(obj.data, 'shadow_soft_size'):
            obj.data.shadow_soft_size *= S
        lights.append(obj.name)
    else:
        obj.data.clip_start *= S
        obj.data.clip_end *= S
        obj.data.dof.focus_distance *= S
        cameras.append(obj.name)
scene.camera = bpy.data.objects['01 | Duel view / w1']
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.frame_start = 1
scene.frame_end = 120
scene.frame_set(1)
rotor = bpy.data.objects['Workshop_FanRotor']
assert rotor.animation_data and rotor.animation_data.action, 'Editable fan animation missing'
assert rotor.data.uv_layers and len(rotor.data.materials) == 1
bag = action_get_channelbag_for_slot(rotor.animation_data.action, rotor.animation_data.action_slot)
curves = [f for f in bag.fcurves if f.data_path == 'rotation_axis_angle' and f.array_index == 0]
assert len(curves) == 1 and len(curves[0].keyframe_points) == 2, 'Expected one two-key angular curve'
curve = curves[0]
points = sorted(curve.keyframe_points, key=lambda p: p.co.x)
fps = scene.render.fps / scene.render.fps_base
points[0].co = (1, 0)
points[1].co = (1 + 2 * math.pi / 7.2 * fps, 2 * math.pi)
for point in points:
    point.interpolation = 'LINEAR'
if not any(mod.type == 'CYCLES' for mod in curve.modifiers):
    curve.modifiers.new('CYCLES')
curve.update()
rest_origin = rotor.matrix_world.translation.copy()
samples = []
for degrees in (0, 90, 180, 360, 450):
    frame = 1 + math.radians(degrees) / 7.2 * fps
    scene.frame_set(math.floor(frame), subframe=frame - math.floor(frame))
    bpy.context.view_layer.update()
    drift = (rotor.matrix_world.translation - rest_origin).length
    angle = float(rotor.rotation_axis_angle[0])
    expected = math.radians(degrees % 360) if degrees >= 360 else math.radians(degrees)
    # At the cycle endpoint Blender can report either 0 or 2*pi.
    angular_error = abs(math.atan2(math.sin(angle - expected), math.cos(angle - expected)))
    assert drift < 1e-6 and angular_error < 1e-5, 'Editable fan loop drift/speed mismatch'
    samples.append({'degrees': degrees, 'frame': frame, 'pivotDrift': drift, 'angularError': angular_error})
scene.frame_set(1)
wear = json.loads(scene['workshop_runtime_v2_wear'])
for report in wear['changed'].values():
    report['mask'] = 'primary sparse contact mask; cavity deposition listed separately'
scene['workshop_runtime_v2_wear'] = json.dumps(wear)
scene['workshop_v2_lights_restored'] = True
scene['Delivery_v2'] = 'Editable runtime geometry, packed PBR wear maps, source cameras/lights rescaled once. Linear fan loop 7.2 rad/s. Original full-detail source remains in the separate unchanged WaterDuel_Atelier.blend.'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.shading.type = 'MATERIAL'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=PATH)
report = {'passed': len(lights) == 22 and len(cameras) == 3,
    'file': PATH, 'lights': len(lights), 'cameras': len(cameras),
    'fanRotor': rotor.name, 'animationPresent': True, 'linearCyclicLoop': True,
    'angularSpeed': 7.2, 'samples': samples,
    'originalSourceModified': False,
    'scope': 'Editable optimized v2 scene with restored authoring lighting; GLB verified separately.'}
with open(os.path.join(ROOT, 'output', 'blender', 'verification-editable-v2.json'), 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2)
print('WORKSHOP_EDITABLE_V2', json.dumps(report), flush=True)
assert report['passed']
