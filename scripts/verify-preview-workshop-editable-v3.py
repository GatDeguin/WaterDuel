"""Read-only editable-v3 verification and one native Cycles CPU preview.

blender --background --factory-startup --python-exit-code 1 \
  --python scripts/verify-preview-workshop-editable-v3.py
Reads v2/v3 .blend files; never saves either, changes lighting or edits materials.
"""
import bpy
import hashlib
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/blender'
V2 = OUT / 'WaterDuel_Atelier_v2.blend'
V3 = OUT / 'WaterDuel_Atelier_v3.blend'
VERIFY = OUT / 'verification-editable-v3.json'
RECEIPT = OUT / 'preview-editable-v3.json'
PREVIEW = OUT / 'WaterDuel_Atelier_v3_duelo.png'
TOLERANCE = 1e-5


def sha(path):
    with path.open('rb') as source:
        return hashlib.sha256(source.read()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def enabled(obj):
    return not obj.hide_render and any(not collection.hide_render for collection in obj.users_collection)


def snapshot(scene):
    result = {'lights': {}, 'cameras': {}, 'activeCamera': scene.camera.name if scene.camera else None}
    for obj in scene.objects:
        if obj.type not in {'LIGHT', 'CAMERA'}:
            continue
        data = obj.data
        row = {'matrixWorld': [list(r) for r in obj.matrix_world], 'hideRender': obj.hide_render,
               'hideViewport': obj.hide_viewport, 'hideSet': obj.hide_get(), 'type': data.type}
        if obj.type == 'LIGHT':
            row.update({'energy': data.energy, 'colorLinear': list(data.color), 'useShadow': data.use_shadow})
            for field in ('shape', 'size', 'size_y', 'shadow_soft_size', 'spot_size', 'spot_blend', 'spread'):
                if hasattr(data, field):
                    row[field] = getattr(data, field)
            result['lights'][obj.name] = row
        else:
            row.update({'lensMm': data.lens, 'sensorWidth': data.sensor_width, 'sensorHeight': data.sensor_height,
                        'sensorFit': data.sensor_fit, 'clipStart': data.clip_start, 'clipEnd': data.clip_end,
                        'dofEnabled': data.dof.use_dof, 'focusDistance': data.dof.focus_distance,
                        'fStop': data.dof.aperture_fstop})
            result['cameras'][obj.name] = row
    return result


def action_curves(action):
    curves = []
    if hasattr(action, 'layers'):
        for layer in action.layers:
            for strip in layer.strips:
                if hasattr(strip, 'channelbags'):
                    for bag in strip.channelbags:
                        curves.extend(bag.fcurves)
    if not curves and hasattr(action, 'fcurves'):
        curves.extend(action.fcurves)
    return curves


def verify_loop(scene):
    rotor = scene.objects.get('Workshop_FanRotor')
    assert rotor and rotor.type == 'MESH', 'Missing editable fan rotor mesh'
    assert rotor.animation_data and rotor.animation_data.action, 'Missing native rotor animation'
    assert rotor.rotation_mode == 'AXIS_ANGLE', 'Expected native axis-angle rotor animation'
    curves = [curve for curve in action_curves(rotor.animation_data.action)
              if curve.data_path == 'rotation_axis_angle' and curve.array_index == 0]
    assert len(curves) == 1, 'Expected exactly one native angle FCurve'
    curve = curves[0]
    points = sorted(curve.keyframe_points, key=lambda point: point.co.x)
    assert len(points) >= 2 and all(point.interpolation == 'LINEAR' for point in points), 'Rotor loop must be LINEAR'
    cycles = [modifier for modifier in curve.modifiers if modifier.type == 'CYCLES' and not modifier.mute]
    assert cycles and cycles[0].mode_after == 'REPEAT', 'Rotor loop must repeat beyond its first revolution'
    fps = scene.render.fps / scene.render.fps_base
    start_frame, end_frame = float(points[0].co.x), float(points[-1].co.x)
    speed = (float(points[-1].co.y) - float(points[0].co.y)) / (end_frame - start_frame) * fps
    assert abs(speed - 7.2) < TOLERANCE, 'Native loop angular speed is not 7.2 radians/second'
    initial_frame, initial_subframe = scene.frame_current, scene.frame_subframe
    scene.frame_set(math.floor(start_frame), subframe=start_frame % 1)
    rest = rotor.matrix_world.copy()
    pivot = rest.translation.copy()
    axis = Vector(rotor.rotation_axis_angle[1:])
    assert (axis - Vector((0, -1, 0))).length < TOLERANCE, 'Native rotor axis must be Blender -Y / runtime +Z'
    local = np.array([v.co[:] for v in rotor.data.vertices], dtype=np.float64)
    samples = []
    try:
        for degrees in (0, 90, 180, 360, 450):
            angle = math.radians(degrees)
            frame = start_frame + angle / 7.2 * fps
            scene.frame_set(math.floor(frame), subframe=frame % 1)
            bpy.context.view_layer.update()
            evaluated = rotor.evaluated_get(bpy.context.evaluated_depsgraph_get())
            actual = evaluated.matrix_world.copy()
            expected = Matrix.Translation(pivot) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-pivot) @ rest
            matrix_error = float(np.max(np.abs(np.array(actual) - np.array(expected))))
            drift = (actual.translation - pivot).length
            angular_error = abs((float(rotor.rotation_axis_angle[0]) - angle + math.pi) % math.tau - math.pi)
            points_world = local @ np.array(actual)[:3, :3].T + np.array(actual.translation)
            samples.append({'degrees': degrees, 'frame': frame, 'pivotDrift': drift,
                            'angularError': angular_error, 'matrixMaxError': matrix_error,
                            'boundsBlenderZUp': {'min': points_world.min(axis=0).tolist(),
                                                'max': points_world.max(axis=0).tolist()}})
            assert max(drift, angular_error, matrix_error) < TOLERANCE, 'Rotor pose failed at %s degrees' % degrees
    finally:
        scene.frame_set(initial_frame, subframe=initial_subframe)
    return {'name': rotor.name, 'animationPresent': True, 'linearCyclicLoop': True,
            'action': rotor.animation_data.action.name, 'angularSpeed': speed, 'angularSpeedUnit': 'radians/second',
            'axisBlender': list(axis), 'pivotBlender': list(pivot), 'fpsEffective': fps,
            'startFrame': start_frame, 'endFrame': end_frame, 'samples': samples,
            'checks': {'linear': True, 'cyclicRepeat': True, 'angularSpeed': True, 'pivotFixed': True,
                       'actualEvaluatedTransforms': True, 'beyondFirstRevolution': True}}


started = time.perf_counter()
hashes_before = {'v2': sha(V2), 'v3': sha(V3)}
verification = {'passed': False, 'file': str(V3.relative_to(ROOT)), 'version': 3,
                'blenderVersion': bpy.app.version_string, 'timestampUTC': datetime.now(timezone.utc).isoformat(),
                'sourceHashesBefore': hashes_before, 'errors': [],
                'scope': 'Native editable v3 lighting/cameras and evaluated native fan animation. GLB verified separately.'}
receipt = {'status': 'pending', 'source': str(V3.relative_to(ROOT)), 'sourceSha256': hashes_before['v3'],
           'preview': str(PREVIEW.relative_to(ROOT)), 'engine': 'CYCLES', 'device': 'CPU',
           'resolution': [960, 540], 'samples': 24, 'denoising': True,
           'lightingChanged': False, 'materialsChanged': False, 'blendSaved': False}
try:
    bpy.ops.wm.open_mainfile(filepath=str(V2))
    baseline = snapshot(bpy.context.scene)
    bpy.ops.wm.open_mainfile(filepath=str(V3))
    scene = bpy.context.scene
    current = snapshot(scene)
    lights = sum(obj.type == 'LIGHT' and enabled(obj) for obj in scene.objects)
    cameras = sum(obj.type == 'CAMERA' for obj in scene.objects)
    meshes = sum(obj.type == 'MESH' and enabled(obj) for obj in scene.objects)
    assert (lights, cameras, meshes) == (22, 3, 36), 'Unexpected render-enabled light/mesh or camera counts'
    assert current == baseline, 'Camera/light settings or transforms differ from frozen v2'
    assert scene.camera and scene.camera.name.startswith('01'), 'Expected the current 01 duel camera'
    rotor = verify_loop(scene)
    assert snapshot(scene) == baseline, 'Loop verification changed camera/light settings'
    verification.update({'lights': lights, 'cameras': cameras, 'visibleMeshes': meshes,
                         'camera': scene.camera.name, 'fanRotor': rotor,
                         'camerasAndLightsUnchangedFromV2': True, 'cameraLightSnapshot': current,
                         'checks': {'counts': True, 'camerasLightsMatchV2': True, 'nativeRotorLoop': True}})
    scene.frame_set(1)
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 960, 540, 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.filepath = str(PREVIEW)
    render_started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    receipt.update({'status': 'passed', 'renderSeconds': time.perf_counter() - render_started,
                    'camera': scene.camera.name, 'frame': 1, 'renderEnabledLights': lights,
                    'renderEnabledMeshes': meshes, 'cameraCount': cameras,
                    'previewBytes': PREVIEW.stat().st_size, 'previewSha256': sha(PREVIEW)})
    verification['passed'] = True
except Exception as error:
    verification['errors'].append(type(error).__name__ + ': ' + str(error))
    receipt.update({'status': 'failed', 'error': verification['errors'][-1]})
finally:
    hashes_after = {'v2': sha(V2), 'v3': sha(V3)}
    preserved = hashes_before == hashes_after
    verification.update({'sourceHashesAfter': hashes_after, 'sourceFilesUnchanged': preserved,
                         'blendSaved': False, 'totalSeconds': time.perf_counter() - started})
    receipt.update({'sourceSha256After': hashes_after['v3'], 'sourcePreserved': preserved,
                    'warmTotalSeconds': time.perf_counter() - started})
    if not preserved:
        verification['passed'] = False
        verification['errors'].append('Frozen input file changed during read-only verification')
        receipt['status'] = 'failed'
    write(VERIFY, verification)
    write(RECEIPT, receipt)
    print('WORKSHOP_EDITABLE_V3', json.dumps({'passed': verification['passed'], 'errors': verification['errors'],
          'receipt': receipt}, allow_nan=False), flush=True)
if not verification['passed']:
    raise RuntimeError('; '.join(verification['errors']))
