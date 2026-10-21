"""Read authored light directions and cameras without saving the source scene.

Run a separate process, never the shared interactive Blender scene:
  blender --background --factory-startup output/blender/WaterDuel_Atelier.blend \
    --python scripts/extract-workshop-light-directions.py

The runtime GLB and its frozen contract are read only. Directions map Blender
local -Z (emission/view forward) to runtime world X, Z, -Y. Lengths use exactly
the uniform runtime scale documented by export-workshop-runtime.py.
"""
import bpy
import hashlib
import json
import math
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'assets', 'environment', 'workshop')
SOURCE = os.path.join(ROOT, 'output', 'blender', 'WaterDuel_Atelier.blend')
CONTRACT = os.path.join(OUT, 'asset-contract.json')
GLB = os.path.join(OUT, 'workshop-runtime.glb')
EXPECTED_SOURCE = '2e92513be1f17a2e2d5cc357dddc8cd8d0e1dd62abbde226f4ec09c3a717b755'
S = 95 / 147
TY = .3245 - 1.15 * S


def sha(path):
    with open(path, 'rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def world_vector(vector):
    return Vector((vector.x, vector.z, -vector.y))


def unit(vector):
    require(all(math.isfinite(value) for value in vector), 'Non-finite direction')
    require(vector.length > 1e-8, 'Degenerate orientation')
    return world_vector(vector.normalized())


def position(vector):
    return [S * vector.x, S * vector.z + TY, -S * vector.y]


def write_json(filename, value):
    with open(os.path.join(OUT, filename), 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write('\n')


before = {path: sha(path) for path in (SOURCE, CONTRACT, GLB)}
require(before[SOURCE] == EXPECTED_SOURCE, 'Authored source changed; inspect before extraction')
require(os.path.normcase(os.path.realpath(bpy.data.filepath)) == os.path.normcase(os.path.realpath(SOURCE)),
        'Open the specified authored source in a separate background process')
with open(CONTRACT, encoding='utf-8') as handle:
    contract = json.load(handle)
require(contract['source']['sha256'] == before[SOURCE], 'Contract source hash mismatch')
require(abs(contract['coordinateTransform']['scale'] - S) < 1e-12, 'Contract scale mismatch')
require(abs(contract['coordinateTransform']['translationRuntimeY'] - TY) < 1e-12,
        'Contract vertical translation mismatch')

source_lights = {obj.name: obj for obj in bpy.context.scene.objects if obj.type == 'LIGHT'}
hints = contract['lighting']['hints']
require(len(source_lights) == len(hints) == 22, 'Expected exactly 22 source and contract lights')
require(set(source_lights) == {hint['name'] for hint in hints}, 'Light names differ from frozen contract')
lights = []
maximum_position_error = 0.0
maximum_orthogonality_error = 0.0
for hint in hints:
    obj = source_lights[hint['name']]
    data = obj.data
    require(data.type in {'AREA', 'POINT'}, 'Unsupported source light: ' + obj.name)
    require(data.type == hint['type'], 'Source/contract light type mismatch: ' + obj.name)
    origin = position(obj.matrix_world.translation)
    error = max(abs(a - b) for a, b in zip(origin, hint['position']))
    maximum_position_error = max(maximum_position_error, error)
    require(error < 1e-6, 'Source/contract position mismatch: ' + obj.name)
    linear = obj.matrix_world.to_3x3()
    basis_x = linear @ Vector((1, 0, 0))
    basis_y = linear @ Vector((0, 1, 0))
    basis_z = linear @ Vector((0, 0, 1))
    require(min(basis_x.length, basis_y.length, basis_z.length) > 1e-8, 'Zero light scale')
    record = {'name': obj.name, 'type': data.type, 'position': origin,
              'direction': [0.0, 0.0, 0.0], 'axisU': [0.0, 0.0, 0.0],
              'axisV': [0.0, 0.0, 0.0], 'sizeRuntime': 0.0, 'sizeYRuntime': 0.0,
              'shape': None, 'spreadRadians': None,
              'sourceObjectScale': [basis_x.length, basis_y.length, basis_z.length]}
    if data.type == 'AREA':
        axis_u, axis_v = unit(basis_x), unit(basis_y)
        # Normal to the transformed emitting rectangle. This is robust to
        # nonuniform scale and is exactly local -Z for the authored TRS lights.
        normal = -axis_u.cross(axis_v).normalized()
        authored_forward = unit(linear @ Vector((0, 0, -1)))
        require(normal.dot(authored_forward) > .999999, 'Sheared/reflected light frame: ' + obj.name)
        orthogonality = abs(axis_u.dot(axis_v))
        maximum_orthogonality_error = max(maximum_orthogonality_error, orthogonality)
        require(orthogonality < 1e-6, 'Non-orthogonal area frame: ' + obj.name)
        size_y = data.size_y if data.shape in {'RECTANGLE', 'ELLIPSE'} else data.size
        record.update(direction=list(normal), axisU=list(axis_u), axisV=list(axis_v),
                      sizeRuntime=float(data.size) * S * basis_x.length,
                      sizeYRuntime=float(size_y) * S * basis_y.length,
                      shape=data.shape, spreadRadians=float(data.spread))
        require(record['sizeRuntime'] > 0 and record['sizeYRuntime'] > 0, 'Zero area extent')
        require(0 <= record['spreadRadians'] <= math.pi + 1e-6, 'Invalid area spread')
    else:
        record['radiusRuntime'] = float(data.shadow_soft_size) * S
    lights.append(record)

maximum_direction_norm_error = 0.0
for light in lights:
    norm = math.sqrt(sum(value * value for value in light['direction']))
    expected = 1.0 if light['type'] == 'AREA' else 0.0
    maximum_direction_norm_error = max(maximum_direction_norm_error, abs(norm - expected))
    require(abs(norm - expected) < 1e-6, 'Invalid exported direction norm: ' + light['name'])

render = bpy.context.scene.render
aspect = (render.resolution_x * render.pixel_aspect_x) / (render.resolution_y * render.pixel_aspect_y)
camera_records = []
for obj in sorted((obj for obj in bpy.context.scene.objects if obj.type == 'CAMERA'), key=lambda item: item.name):
    data = obj.data
    rotation = obj.matrix_world.to_quaternion()
    forward = unit(rotation @ Vector((0, 0, -1)))
    up = unit(rotation @ Vector((0, 1, 0)))
    right = unit(rotation @ Vector((1, 0, 0)))
    origin = Vector(position(obj.matrix_world.translation))
    frame = data.view_frame(scene=bpy.context.scene)
    if data.type == 'PERSP':
        horizontal_angles = [math.atan2(corner.x, -corner.z) for corner in frame]
        vertical_angles = [math.atan2(corner.y, -corner.z) for corner in frame]
        horizontal_bounds = [min(horizontal_angles), max(horizontal_angles)]
        vertical_bounds = [min(vertical_angles), max(vertical_angles)]
        effective_fov = {'horizontalRadians': horizontal_bounds[1] - horizontal_bounds[0],
                         'verticalRadians': vertical_bounds[1] - vertical_bounds[0],
                         'horizontalBoundsRadians': horizontal_bounds,
                         'verticalBoundsRadians': vertical_bounds}
    else:
        effective_fov = None
    # One runtime unit along view forward; this is not an invented authored
    # look-at target. A separate focus target uses the camera's focus distance.
    camera_records.append({
        'name': obj.name, 'type': data.type, 'position': list(origin),
        'forward': list(forward), 'up': list(up), 'right': list(right),
        'targetOneUnitAhead': list(origin + forward),
        'focusTarget': list(origin + forward * float(data.dof.focus_distance) * S),
        'focusDistanceRuntime': float(data.dof.focus_distance) * S,
        'lensMillimeters': float(data.lens), 'sensorWidthMillimeters': float(data.sensor_width),
        'sensorHeightMillimeters': float(data.sensor_height), 'sensorFit': data.sensor_fit,
        'angleRadians': float(data.angle), 'angleXRadians': float(data.angle_x),
        'angleYRadians': float(data.angle_y),
        'effectiveRenderFov': effective_fov,
        'viewFrameCameraLocal': [list(corner) for corner in frame],
        'orthographicScaleRuntime': float(data.ortho_scale) * S,
        'shiftX': float(data.shift_x), 'shiftY': float(data.shift_y),
        'clipStartRuntime': float(data.clip_start) * S, 'clipEndRuntime': float(data.clip_end) * S,
        'depthOfFieldEnabled': bool(data.dof.use_dof),
        'focusObject': data.dof.focus_object.name if data.dof.focus_object else None,
        'fStop': float(data.dof.aperture_fstop), 'renderAspect': aspect,
    })
require(len(camera_records) == 3, 'Expected exactly 3 authored cameras')
maximum_camera_frame_error = 0.0
maximum_camera_aspect_error = 0.0
for camera in camera_records:
    axes = [Vector(camera[key]) for key in ('forward', 'up', 'right')]
    frame_error = max(abs(axis.length - 1) for axis in axes)
    frame_error = max(frame_error, *(abs(a.dot(b)) for a, b in
                                    ((axes[0], axes[1]), (axes[0], axes[2]), (axes[1], axes[2]))))
    maximum_camera_frame_error = max(maximum_camera_frame_error, frame_error)
    require(frame_error < 1e-6, 'Invalid camera frame: ' + camera['name'])
    if camera['type'] == 'PERSP' and camera['shiftX'] == camera['shiftY'] == 0:
        fov = camera['effectiveRenderFov']
        ratio = math.tan(fov['horizontalRadians'] / 2) / math.tan(fov['verticalRadians'] / 2)
        maximum_camera_aspect_error = max(maximum_camera_aspect_error, abs(ratio - aspect))
        require(abs(ratio - aspect) < 1e-6, 'Effective camera FOV disagrees with render aspect')

after = {path: sha(path) for path in (SOURCE, CONTRACT, GLB)}
require(before == after, 'Extraction changed a frozen input')
provenance = {'path': 'output/blender/WaterDuel_Atelier.blend', 'sha256': before[SOURCE],
              'preserved': True, 'blenderVersion': bpy.app.version_string}
coordinates = {'runtimeUp': 'Y', 'runtimeFront': '+Z', 'sourceToRuntimeVector': ['x', 'z', '-y'],
               'scale': S, 'translationRuntimeY': TY,
               'directionMeaning': 'Normalized light-ray/view travel direction, from local -Z',
               'areaAxesMeaning': 'Local +X and +Y of the emitting surface in runtime world space',
               'areaDimensionsMeaning': 'Full width/height or full ellipse diameters, including object scale'}
write_json('light-directions.json', {'version': 1, 'source': provenance,
           'frozenContractSHA256': before[CONTRACT], 'coordinates': coordinates,
           'count': len(lights), 'lights': lights})
write_json('cameras.json', {'version': 1, 'source': provenance, 'coordinates': coordinates,
           'render': {'resolutionX': render.resolution_x, 'resolutionY': render.resolution_y,
                      'resolutionPercentage': render.resolution_percentage,
                      'pixelAspectX': render.pixel_aspect_x, 'pixelAspectY': render.pixel_aspect_y,
                      'aspect': aspect, 'activeCamera': bpy.context.scene.camera.name if bpy.context.scene.camera else None},
           'targetNote': 'targetOneUnitAhead is derived; it is not a stored authored look-at target.',
           'cameras': camera_records})
receipt = {'passed': True, 'lightCount': len(lights),
           'areaCount': sum(light['type'] == 'AREA' for light in lights),
           'pointCount': sum(light['type'] == 'POINT' for light in lights),
           'cameraCount': len(camera_records), 'maximumPositionError': maximum_position_error,
           'maximumAreaAxisOrthogonalityError': maximum_orthogonality_error,
           'maximumDirectionNormError': maximum_direction_norm_error,
           'maximumCameraFrameError': maximum_camera_frame_error,
           'maximumCameraAspectError': maximum_camera_aspect_error,
           'frozenInputs': [{'path': os.path.relpath(path, ROOT).replace('\\', '/'),
                             'sha256Before': before[path], 'sha256After': after[path],
                             'preserved': before[path] == after[path]} for path in (SOURCE, CONTRACT, GLB)],
           'outputs': {filename: sha(os.path.join(OUT, filename)) for filename in ('light-directions.json', 'cameras.json')}}
with open(os.path.join(ROOT, 'audit', 'EXTRACCION_LUCES_CAMARAS.json'), 'w', encoding='utf-8', newline='\n') as handle:
    json.dump(receipt, handle, ensure_ascii=False, indent=2, allow_nan=False)
    handle.write('\n')
print('WORKSHOP_LIGHT_CAMERA_EXTRACTION', json.dumps(receipt, ensure_ascii=False), flush=True)
