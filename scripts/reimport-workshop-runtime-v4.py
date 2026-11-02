"""Reimport v4 GLB in a dedicated Blender process; never open the authoring file.

blender --background --factory-startup --python-exit-code 1 \
  --python scripts/reimport-workshop-runtime-v4.py -- --preview --fan-preview
Optional previews are offline Eevee renders from the actual GLB, not the game.
"""
import bpy
import hashlib
import json
import math
import runpy
import sys
from pathlib import Path

import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/environment/workshop'
GLB = OUT / 'workshop-runtime-v4.glb'
CONTRACT = OUT / 'asset-contract-v4.json'
REPORT = OUT / 'reimport-verification-v4.json'
BOX_CENTER = np.array((0, (.36 + 3.5) / 2, 0))
BOX_HALF = np.array((3.7, (3.5 - .36) / 2, 1.31))
TOLERANCE = 1e-5
SOURCE_SCALE = 95 / 147
SOURCE_OFFSET = .3245 - 1.15 * SOURCE_SCALE


def source_vector(point):
    """Source-authoring Z-up metres to imported GLB Blender Z-up coordinates."""
    return Vector((point[0] * SOURCE_SCALE, point[1] * SOURCE_SCALE,
                   point[2] * SOURCE_SCALE + SOURCE_OFFSET))


def geometric_clearance_hook(scene, contract, meshes):
    """Required v4 proof against every mesh in the actual GLB reimport.

    scripts/workshop-clearance-v4.py should expose
    verify_geometric_clearance(scene, contract, meshes) -> {passed: bool, ...}.
    No source scene is opened. Missing proof cannot approve the reimport.
    """
    module = ROOT / 'scripts/workshop-clearance-v4.py'
    if not module.is_file():
        raise RuntimeError('Required v4 geometric-clearance module is not installed')
    verify = runpy.run_path(str(module)).get('verify_geometric_clearance')
    if not callable(verify):
        raise RuntimeError('Geometric clearance module lacks verify_geometric_clearance(scene, contract, meshes)')
    result = verify(scene, contract, meshes)
    if not isinstance(result, dict):
        raise RuntimeError('Geometric clearance hook must return a JSON-safe dictionary')
    passed = result.get('passed', result.get('ok'))
    if not isinstance(passed, bool):
        raise RuntimeError('Geometric clearance hook must declare passed/ok as a boolean')
    return {**result, 'passed': passed, 'module': str(module.relative_to(ROOT))}


def runtime_array(blender_points):
    points = np.asarray(blender_points, dtype=np.float64)
    result = points[:, [0, 2, 1]].copy()
    result[:, 2] *= -1
    return result


def blender_vector(runtime_point):
    return Vector((runtime_point[0], -runtime_point[2], runtime_point[1]))


def mesh_local(obj):
    points = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertices.foreach_get('co', points)
    points = points.reshape((-1, 3)).astype(np.float64)
    if not np.isfinite(points).all():
        raise RuntimeError('Non-finite reimport vertex: ' + obj.name)
    return points


def transform_points(points, matrix):
    matrix = np.array(matrix, dtype=np.float64)
    return points @ matrix[:3, :3].T + matrix[:3, 3]


def mesh_world_runtime(obj):
    return runtime_array(transform_points(mesh_local(obj), obj.matrix_world))


def bounds(points):
    low, high = points.min(axis=0), points.max(axis=0)
    return {'min': low.tolist(), 'max': high.tolist(), 'size': (high - low).tolist()}


def triangle_box(triangle):
    points = triangle - BOX_CENTER
    if np.any(points.min(axis=0) > BOX_HALF + 1e-7) or np.any(points.max(axis=0) < -BOX_HALF - 1e-7):
        return False
    edges = [points[1] - points[0], points[2] - points[1], points[0] - points[2]]
    axes = [np.cross(edges[0], edges[1])]
    for edge in edges:
        axes.extend(np.cross(edge, axis) for axis in np.eye(3))
    for axis in axes:
        if np.dot(axis, axis) < 1e-18:
            continue
        projections, radius = points @ axis, np.abs(axis) @ BOX_HALF
        if projections.min() > radius + 1e-7 or projections.max() < -radius - 1e-7:
            return False
    return True


def active_intersection(obj, world_points=None):
    mesh = obj.data
    mesh.calc_loop_triangles()
    indices = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get('vertices', indices)
    points = mesh_world_runtime(obj) if world_points is None else world_points
    triangles = points[indices.reshape((-1, 3))]
    candidates = np.all(triangles.max(axis=1) > BOX_CENTER - BOX_HALF, axis=1)
    candidates &= np.all(triangles.min(axis=1) < BOX_CENTER + BOX_HALF, axis=1)
    return sum(triangle_box(triangle) for triangle in triangles[candidates])


def verify_rotor(scene, fan):
    if fan.get('name') != 'Workshop_FanRotor' or fan.get('coordinateSpace') != 'runtime world':
        raise RuntimeError('Rotor name/coordinateSpace does not match v4 contract')
    pivot = np.array(fan['pivot'], dtype=np.float64)
    axis = np.array(fan['axis'], dtype=np.float64)
    if pivot.shape != (3,) or axis.shape != (3,) or not np.isfinite(pivot).all() or not np.isfinite(axis).all():
        raise RuntimeError('Rotor pivot/axis must be finite VEC3')
    if not np.allclose(axis, (0, 0, 1), atol=1e-8, rtol=0):
        raise RuntimeError('Rotor axis must be runtime world +Z')
    if not math.isfinite(fan['angularSpeed']) or abs(fan['angularSpeed'] - 7.2) > 1e-8:
        raise RuntimeError('Rotor angularSpeed must be 7.2 radians/second')
    objects = [obj for obj in scene.objects if obj.name == fan['name']]
    if len(objects) != 1 or objects[0].type != 'MESH':
        raise RuntimeError('Expected exactly one imported mesh named Workshop_FanRotor')
    rotor = objects[0]
    local = mesh_local(rotor)
    rest_matrix = rotor.matrix_world.copy()
    rest_world = runtime_array(transform_points(local, rest_matrix))
    imported_origin = runtime_array(np.array([rest_matrix.translation]))[0]
    pivot_error = float(np.max(np.abs(imported_origin - pivot)))
    # Remove only the imported origin; do not accidentally hide world-baked local
    # coordinates by subtracting the centroid of the geometry itself.
    relative = runtime_array(local @ np.array(rest_matrix, dtype=np.float64)[:3, :3].T)
    radial_radius = float(np.linalg.norm(relative[:, :2], axis=1).max())
    expected_radius = fan.get('expectedRadiusRange', [.64, .72])
    local_bounds = bounds(relative)
    local_ok = (pivot_error < TOLERANCE and expected_radius[0] <= radial_radius <= expected_radius[1]
                and local_bounds['min'][0] < 0 < local_bounds['max'][0]
                and local_bounds['min'][1] < 0 < local_bounds['max'][1]
                and max(abs(local_bounds['min'][2]), abs(local_bounds['max'][2])) < radial_radius * .5)
    if not local_ok:
        raise RuntimeError('Imported rotor geometry is not local to its declared pivot: ' + json.dumps({
            'pivotMaxError': pivot_error, 'radialRadius': radial_radius, 'bounds': local_bounds}))
    pivot_blender, axis_blender = blender_vector(pivot), blender_vector(axis)
    to_pivot, from_pivot = Matrix.Translation(pivot_blender), Matrix.Translation(-pivot_blender)
    samples, intersections = [], []
    max_pivot_error = max_radius_error = max_depth_error = max_restore_error = 0.0
    rest_radii = np.linalg.norm(rest_world[:, :2] - pivot[:2], axis=1)
    outermost = int(np.argmax(rest_radii))
    try:
        for degrees in (0, 90, 180, 360):
            angle = math.radians(degrees)
            rotor.matrix_world = to_pivot @ Matrix.Rotation(angle, 4, axis_blender) @ from_pivot @ rest_matrix
            bpy.context.view_layer.update()
            points = mesh_world_runtime(rotor)
            origin = runtime_array(np.array([rotor.matrix_world.translation]))[0]
            pivot_drift = float(np.max(np.abs(origin - pivot)))
            radius_drift = float(np.max(np.abs(np.linalg.norm(points[:, :2] - pivot[:2], axis=1) - rest_radii)))
            depth_drift = float(np.max(np.abs(points[:, 2] - rest_world[:, 2])))
            displacement = float(np.linalg.norm(points - rest_world, axis=1).max())
            max_pivot_error = max(max_pivot_error, pivot_drift)
            max_radius_error = max(max_radius_error, radius_drift)
            max_depth_error = max(max_depth_error, depth_drift)
            if degrees == 360:
                max_restore_error = displacement
            if degrees in (90, 180) and displacement <= radial_radius * .1:
                raise RuntimeError('Rotor did not move at %s degrees' % degrees)
            touching = active_intersection(rotor, points)
            if touching:
                intersections.append({'mesh': rotor.name, 'degrees': degrees, 'trianglesTouchingActiveVolume': touching})
            samples.append({'degrees': degrees, 'secondsAtAngularSpeed': angle / fan['angularSpeed'],
                'matrixBlenderRowMajor': [list(row) for row in rotor.matrix_world],
                'originRuntime': origin.tolist(), 'boundsRuntimeYUp': bounds(points),
                'outermostVertexRuntime': points[outermost].tolist(), 'maxVertexDisplacement': displacement,
                'activeVolumeIntersections': touching})
    finally:
        rotor.matrix_world = rest_matrix
        bpy.context.view_layer.update()
    motion_ok = max(max_pivot_error, max_radius_error, max_depth_error, max_restore_error) < TOLERANCE
    if not motion_ok:
        raise RuntimeError('Imported rotor moved its pivot, changed radius/depth, or did not restore the rest pose')
    result = {'passed': True, 'name': rotor.name, 'pivotRuntime': pivot.tolist(), 'axisRuntime': axis.tolist(),
        'pivotBlender': list(pivot_blender), 'axisBlender': list(axis_blender), 'angularSpeed': fan['angularSpeed'],
        'localGeometry': {'ok': local_ok, 'importedOriginRuntime': imported_origin.tolist(), 'pivotMaxError': pivot_error,
            'boundsRelativeRuntimeAxes': local_bounds, 'radialRadius': radial_radius, 'expectedRadiusRange': expected_radius,
            'rawMeshLocalMaxDistance': float(np.linalg.norm(local, axis=1).max()),
            'scope': 'Mesh vertices relative to the imported object origin, expressed in runtime axes without centroid recentering.'},
        'motion': {'ok': motion_ok, 'maxPivotError': max_pivot_error, 'maxRadiusError': max_radius_error,
            'maxDepthError': max_depth_error, 'maxRestoreError': max_restore_error, 'samples': samples,
            'engineFormula': 'T(pivot)*Rz(theta)*T(-pivot)*restWorld; theta=7.2*seconds',
            'blenderFormula': 'T(pivotB)*R(axisB,theta)*T(-pivotB)*restWorldB; axisB=(0,-1,0)'}}
    return rotor, rest_matrix, result, intersections


def native_area_frame(record):
    """Build emitting local X/Y/+Z columns in Blender axes without rescaling."""
    convert = lambda p: np.array((p[0], -p[2], p[1]), dtype=np.float64)
    direction = convert(record['direction'])
    u, v = convert(record['axisU']), convert(record['axisV'])
    frame = np.column_stack((u, v, -direction))
    if not np.isfinite(frame).all() or np.max(np.abs(frame.T @ frame - np.eye(3))) > 1e-5 or np.linalg.det(frame) < .99999:
        raise RuntimeError('Invalid native area-light frame: ' + record['name'])
    return frame


def native_light_records(contract):
    relative = contract['lighting'].get('directions', 'light-directions-v4.json')
    filename = (OUT / relative).resolve()
    if not filename.is_relative_to(OUT.resolve()) or not filename.is_file():
        raise RuntimeError('Native v4 light-directions file missing or outside workshop namespace')
    raw = filename.read_bytes()
    directions = json.loads(raw)
    if directions.get('version') != 4 or directions.get('coordinateSpace') != 'runtime world':
        raise RuntimeError('Expected runtime-world v4 light directions')
    hints, rows = contract['lighting']['hints'], directions['lights']
    indexed = {row['name']: row for row in rows}
    if not (0 < len(hints) <= 24) or len(indexed) != len(rows) or len({hint['name'] for hint in hints}) != len(hints):
        raise RuntimeError('Invalid native v4 light count or repeated names')
    if set(indexed) != {hint['name'] for hint in hints}:
        raise RuntimeError('Native light hints and directions do not match by name')
    for hint in hints:
        row = indexed[hint['name']]
        if row['type'] != hint['type'] or row['type'] not in {'AREA', 'POINT'}:
            raise RuntimeError('Unsupported/mismatched native light type: ' + hint['name'])
        position = np.array(hint['position'], dtype=np.float64)
        color = np.array(hint['colorLinear'], dtype=np.float64)
        if position.shape != (3,) or color.shape != (3,) or not np.isfinite(position).all() or not np.isfinite(color).all():
            raise RuntimeError('Non-finite native light position/color: ' + hint['name'])
        if np.max(np.abs(position - np.array(row['position']))) > 1e-5 or np.any(color < 0):
            raise RuntimeError('Native light position/color disagreement: ' + hint['name'])
        if not math.isfinite(hint['scaledWatts']) or hint['scaledWatts'] < 0:
            raise RuntimeError('Invalid native scaledWatts: ' + hint['name'])
        if row['type'] == 'AREA':
            native_area_frame(row)
            if not all(math.isfinite(row[key]) and row[key] > 0 for key in ('sizeRuntime', 'sizeYRuntime')):
                raise RuntimeError('Invalid native area dimensions: ' + hint['name'])
        elif not math.isfinite(row['radiusRuntime']) or row['radiusRuntime'] < 0:
            raise RuntimeError('Invalid native point radius: ' + hint['name'])
    return filename, raw, hints, indexed


def setup_preview(scene, contract):
    # Eevee QA only. No HDR/irradiance/cubemap bake is added here.
    settings = scene.eevee
    if hasattr(settings, 'shadow_pool_size'):
        prop = settings.bl_rna.properties['shadow_pool_size']
        values = sorted(int(item.identifier) for item in prop.enum_items if item.identifier.isdigit())
        if values:
            settings.shadow_pool_size = str(next((value for value in values if value >= 1024), values[-1]))
    filename, raw, hints, records = native_light_records(contract)
    for hint in hints:
        record = records[hint['name']]
        data = bpy.data.lights.new('QA v4 | ' + hint['name'], hint['type'])
        data.energy, data.color = hint['scaledWatts'], hint['colorLinear']
        obj = bpy.data.objects.new(data.name, data)
        scene.collection.objects.link(obj)
        obj.location = blender_vector(hint['position'])
        if data.type == 'AREA':
            data.shape = record['shape']
            data.size = record['sizeRuntime']
            if data.shape in {'RECTANGLE', 'ELLIPSE'}:
                data.size_y = record['sizeYRuntime']
            data.spread = min(math.pi, max(0.0, record.get('spreadRadians', math.pi)))
            rotation = Matrix(native_area_frame(record).tolist()).to_4x4()
            rotation.translation = obj.location
            obj.matrix_world = rotation
        else:
            data.shadow_soft_size = record['radiusRuntime']
    data = bpy.data.cameras.new('GLB v4 inspection camera')
    camera = bpy.data.objects.new(data.name, data)
    scene.collection.objects.link(camera)
    camera.location = source_vector((.15, -17.8, 3.2))
    camera.rotation_euler = (source_vector((0, 2.3, 3.7)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    data.lens = 42
    scene.camera = camera
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1280, 720, 100
    scene.render.image_settings.file_format, scene.render.image_settings.color_mode = 'PNG', 'RGB'
    if scene.world is None:
        scene.world = bpy.data.worlds.new('GLB v4 preview world')
    scene.world.use_nodes = True
    world_nodes = scene.world.node_tree.nodes
    background = next((node for node in world_nodes if node.type == 'BACKGROUND'), None)
    if background is None:
        background = world_nodes.new('ShaderNodeBackground')
        output = next((node for node in world_nodes if node.type == 'OUTPUT_WORLD'), None)
        if output is None:
            output = world_nodes.new('ShaderNodeOutputWorld')
        scene.world.node_tree.links.new(background.outputs[0], output.inputs[0])
    background.inputs[0].default_value, background.inputs[1].default_value = (.16, .2, .24, 1), .25
    scene.view_settings.view_transform, scene.view_settings.exposure = 'AgX', -.15
    try:
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except (TypeError, ValueError):
        pass
    lighting_report = {'mode': 'native v4 day lights from authored hint/frame records',
        'file': filename.name, 'sha256': hashlib.sha256(raw).hexdigest(), 'lightCount': len(hints),
        'areaCount': sum(hint['type'] == 'AREA' for hint in hints),
        'pointCount': sum(hint['type'] == 'POINT' for hint in hints),
        'names': [hint['name'] for hint in hints],
        'units': 'Positions, dimensions, radii and scaledWatts already runtime; no extra source scale applied.',
        'worldStrength': .25, 'environmentMapOrProbeBaked': False,
        'shadowPoolSizeMiB': int(settings.shadow_pool_size) if hasattr(settings, 'shadow_pool_size') else None,
        'scope': 'Offline Eevee QA. Native source Cycles variants and HDR are delivered/verified separately.'}
    return camera, lighting_report


def render_previews(scene, contract, rotor, rest_matrix):
    requested = any(flag in sys.argv for flag in ('--preview', '--fan-preview', '--exterior-preview', '--ceiling-preview', '--detail-fixes'))
    if not requested:
        return [], None
    camera, lighting_report = setup_preview(scene, contract)
    glb_sha256 = hashlib.sha256(GLB.read_bytes()).hexdigest()
    outputs = []

    def render(filename, description, source_pose=None):
        scene.render.filepath = str(OUT / filename)
        bpy.ops.render.render(write_still=True)
        image_bytes = (OUT / filename).read_bytes()
        outputs.append({'file': filename, 'sha256': hashlib.sha256(image_bytes).hexdigest(),
            'glbSha256': glb_sha256, 'bytes': len(image_bytes), 'width': 1280, 'height': 720, 'engine': 'Eevee',
            'description': description, 'cameraSourceZUp': source_pose,
            'cameraBlenderRuntimeScaleZUp': list(camera.location), 'lensMm': camera.data.lens,
            'lightingFile': lighting_report['file'], 'nativeLightCount': lighting_report['lightCount'],
            'pointLightShadowCount': sum(light.type == 'LIGHT' and light.data.type == 'POINT'
                and light.data.use_shadow for light in scene.objects),
            'scope': 'Offline inspection of actual v4 GLB geometry/materials; no source scene, characters or game UI.'})

    def pose(position, target, lens):
        camera.location = source_vector(position)
        camera.rotation_euler = (source_vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.lens = lens
        return {'position': list(position), 'target': list(target), 'lensMm': lens}

    def disable_point_shadows():
        # Close views of many brass casters can exhaust Eevee's shadow pool.
        # Keep area-light shadows and point illumination; disable only the
        # six-face point-light shadow allocations in this private QA scene.
        for light in scene.objects:
            if light.type == 'LIGHT' and light.data.type == 'POINT':
                light.data.use_shadow = False

    rotor.matrix_world = rest_matrix
    if '--preview' in sys.argv:
        frontal = pose((.15, -17.8, 3.2), (0, 2.3, 3.7), 42)
        render('preview-glb-v4-eevee.png', 'Actual v4 GLB with native v4 day lights; unchanged 42mm frontal composition.', frontal)
        oblique = pose((7.5, -16.5, 5.1), (0, 3.7, 4.1), 42)
        render('preview-glb-v4-oblique.png', 'Actual v4 GLB oblique view, including ceiling depth, workshop layers and exterior.', oblique)
    if '--preview' in sys.argv or '--detail-fixes' in sys.argv:
        disable_point_shadows()
        details = [
            ('preview-v4-materials.png', (7.1, -5.6, 2.45), (4.8, -1.35, 1.1), 60,
             'Table right endgrain, wet/dry timber, worn corner and dented brass protection from the actual v4 GLB.'),
            ('preview-v4-details.png', (-4.85, 4.95, 2.35), (-4.85, 6.25, 1.95), 32,
             'The actual v4 finish samples and their CERA / ACEITE / GOMA LACA labels.'),
            ('preview-v4-tools.png', (2.4, 6.25, 4.6), (2.4, 6.85, 3.45), 40,
             'The actual v4 tool shadow-board, painted silhouettes and intentionally empty pegs.'),
            ('preview-v4-copper.png', (-7.0, 6.0, 3.85), (-7.45, 7.35, 3.3), 55,
             'Copper/brass union and local verdigris seen from inside the workshop wall, with portable v4 PBR.'),
            ('preview-v4-glass.png', (-2.7, 5.4, 6.9), (-4.65, 7.65, 6.85), 70,
             'Old window pane geometry, grazing highlights and exterior visibility in the actual v4 GLB.'),
        ]
        if '--preview' not in sys.argv:
            recapture = {'preview-v4-details.png', 'preview-v4-tools.png', 'preview-v4-copper.png'}
            details = [item for item in details if item[0] in recapture]
        for filename, position, target, lens, description in details:
            source_pose = pose(position, target, lens)
            render(filename, description, source_pose)
    if '--fan-preview' in sys.argv:
        # Keep the area-light shadows on the brass. Distant practical point
        # lights contribute illumination but need no extra six-face shadows
        # in this close view (Eevee's shadow buffer otherwise overflows).
        disable_point_shadows()
        pivot = blender_vector(contract['fanRotor']['pivot'])
        axis = blender_vector(contract['fanRotor']['axis'])
        # A fixed camera and unchanged lighting make the two blade poses comparable.
        camera.location = pivot + Vector((.12, -6.2, .10))
        camera.rotation_euler = (pivot - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.lens = 75
        try:
            for degrees in (0, 90):
                rotor.matrix_world = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(degrees), 4, axis) @ Matrix.Translation(-pivot) @ rest_matrix
                bpy.context.view_layer.update()
                render('preview-fan-v4-%03d.png' % degrees, 'Reimported fan at %s degrees, fixed camera and lighting.' % degrees)
        finally:
            rotor.matrix_world = rest_matrix
            bpy.context.view_layer.update()
    if '--exterior-preview' in sys.argv:
        disable_point_shadows()
        source_pose = pose((-4.65, 3.4, 6.3), (-4.65, 14.5, 6.9), 55)
        render('preview-v4-exterior.png', 'Courtyard geometry seen through the actual v4 window opening and glass.', source_pose)
    if '--ceiling-preview' in sys.argv:
        disable_point_shadows()
        source_pose = pose((0, -2, 6.5), (0, 5.6, 9.5), 30)
        render('preview-v4-ceiling.png', 'Native v4 ceiling light pools, high joists and gallery layers from the actual GLB.', source_pose)
    return outputs, lighting_report


def write_report(report):
    REPORT.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    compact = {key: value for key, value in report.items() if key not in ('materialImageBindings', 'rotor')}
    print('WORKSHOP_REIMPORT_V4 ' + json.dumps(compact, allow_nan=False), flush=True)


def main():
    missing = [str(file) for file in (GLB, CONTRACT) if not file.is_file()]
    if missing:
        print('WORKSHOP_REIMPORT_V4 ' + json.dumps({'status': 'pending', 'missing': missing}), flush=True)
        return
    report = {'passed': False, 'file': GLB.name, 'version': 4, 'importer': 'Blender ' + bpy.app.version_string,
        'errors': [], 'previews': [], 'scope': 'Actual v4 GLB import and Blender CPU transforms. Optional Eevee renders are offline QA, not game runtime.'}
    try:
        report['glbSha256'] = hashlib.sha256(GLB.read_bytes()).hexdigest()
        previous = None
        if '--detail-fixes' in sys.argv:
            previous_bytes = REPORT.read_bytes()
            previous = json.loads(previous_bytes)
            if previous.get('passed') is not True or previous.get('glbSha256') != report['glbSha256']:
                raise RuntimeError('Detail-only recapture requires a passed reimport receipt for this exact GLB')
        contract = json.loads(CONTRACT.read_text(encoding='utf-8'))
        if contract.get('version') != 4 or contract.get('asset') != GLB.name:
            raise RuntimeError('Contract version/asset name mismatch')
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        bpy.ops.import_scene.gltf(filepath=str(GLB))
        scene = bpy.context.scene
        meshes = [obj for obj in scene.objects if obj.type == 'MESH']
        if not meshes:
            raise RuntimeError('GLB reimport contains no mesh objects')
        world_points, intersections, images, material_set = [], [], [], set()
        triangles = vertices = groups = 0
        for obj in meshes:
            mesh = obj.data
            mesh.calc_loop_triangles()
            vertices += len(mesh.vertices)
            triangles += len(mesh.loop_triangles)
            groups += len({triangle.material_index for triangle in mesh.loop_triangles})
            world = mesh_world_runtime(obj)
            world_points.append(world)
            touching = active_intersection(obj, world)
            if touching:
                intersections.append({'mesh': obj.name, 'degrees': 0, 'trianglesTouchingActiveVolume': touching})
            for material in mesh.materials:
                if material is not None:
                    material_set.add(material)
            textured = any(material and material.use_nodes and any(node.type == 'TEX_IMAGE' and node.image
                for node in material.node_tree.nodes) for material in mesh.materials)
            if textured and not mesh.uv_layers:
                raise RuntimeError('GLB reimport lost UVs for textured mesh: ' + obj.name)
        for material in material_set:
            if not material.use_nodes:
                continue
            for node in material.node_tree.nodes:
                if node.type != 'TEX_IMAGE' or node.image is None:
                    continue
                image = node.image
                width, height = image.size[:]
                decoded = bool(image.has_data and width > 0 and height > 0)
                images.append({'material': material.name, 'image': image.name, 'size': [width, height],
                    'packed': bool(image.packed_file), 'decoded': decoded, 'colorSpace': image.colorspace_settings.name})
                if not decoded:
                    raise RuntimeError('Embedded image was not decoded: ' + image.name)
        measured_bounds = bounds(np.concatenate(world_points))
        expected = contract['bounds']
        bounds_error = max(abs(measured_bounds[key][axis] - expected[key][axis]) for key in ('min', 'max') for axis in range(3))
        stage_objects = [obj for obj in meshes if obj.name.startswith('Workshop_stage-wet-oak-')]
        if not stage_objects:
            raise RuntimeError('Named stage meshes missing after reimport')
        stage_top = max(float(mesh_world_runtime(obj)[:, 1].max()) for obj in stage_objects)
        rotor, rest_matrix, rotor_report, rotor_intersections = verify_rotor(scene, contract['fanRotor'])
        intersections.extend(rotor_intersections)
        clearance = geometric_clearance_hook(scene, contract, meshes)
        if clearance.get('glbSha256') != report['glbSha256']:
            raise RuntimeError('Geometric clearance receipt is not bound to the imported GLB')
        checks = {'bounds': bounds_error < 1e-4, 'triangleBudget': triangles <= 500000,
            'drawGroupBudget': groups <= 60, 'stageHeight': abs(stage_top - .3245) < .002,
            'activeVolumeClear': len(intersections) == 0, 'rotorLocalGeometry': rotor_report['localGeometry']['ok'],
            'rotorMotion': rotor_report['motion']['ok'], 'embeddedImagesDecoded': all(image['decoded'] for image in images)}
        checks['geometricClearance'] = clearance['passed']
        report.update({'triangles': triangles, 'vertices': vertices, 'meshObjects': len(meshes), 'drawGroups': groups,
            'materialCount': len(material_set), 'materialNames': sorted(material.name for material in material_set),
            'boundsRuntimeYUp': measured_bounds, 'boundsMaxError': bounds_error, 'stageTopMeasured': stage_top,
            'stageTopNominal': .3245, 'stageTopTolerance': .002, 'materialImageBindings': images,
            'activeVolume': {'x': [-3.7, 3.7], 'y': [.36, 3.5], 'z': [-1.31, 1.31]},
            'activeVolumeIntersections': intersections, 'rotor': rotor_report,
            'geometricClearance': clearance, 'checks': checks})
        report['errors'].extend('Failed check: ' + name for name, ok in checks.items() if not ok)
        if not report['errors']:
            report['previews'], report['previewLighting'] = render_previews(scene, contract, rotor, rest_matrix)
            if previous is not None:
                if previous.get('previewLighting', {}).get('sha256') != report['previewLighting']['sha256']:
                    raise RuntimeError('Native light directions changed since the passed preview receipt')
                current = {item['file']: item for item in report['previews']}
                for item in previous.get('previews', []):
                    if (item.get('glbSha256') != report['glbSha256'] or not (OUT / item['file']).is_file()
                        or item.get('sha256') != hashlib.sha256((OUT / item['file']).read_bytes()).hexdigest()):
                        # Updated images were just rendered and are replaced below.
                        if item['file'] not in current:
                            raise RuntimeError('Retained preview is stale or unbound: ' + item['file'])
                retained = {item['file']: item for item in previous.get('previews', []) if (OUT / item['file']).is_file()}
                retained.update(current)
                report['previews'] = list(retained.values())
                report['detailRecapture'] = {'previousReceiptSha256': hashlib.sha256(previous_bytes).hexdigest(),
                    'updatedFiles': list(current), 'retainedFiles': [name for name in retained if name not in current],
                    'sceneGeometryOrLightsChanged': False}
            if report['previewLighting']:
                lighting_file = OUT / report['previewLighting']['file']
                if hashlib.sha256(lighting_file.read_bytes()).hexdigest() != report['previewLighting']['sha256']:
                    report['errors'].append('Native light directions changed during preview rendering')
        if hashlib.sha256(GLB.read_bytes()).hexdigest() != report['glbSha256']:
            report['errors'].append('GLB changed during reimport/preview verification')
        report['passed'] = not report['errors']
    except Exception as error:
        report['errors'].append(type(error).__name__ + ': ' + str(error))
    write_report(report)
    if not report['passed']:
        raise RuntimeError('V4 reimport verification failed: ' + '; '.join(report['errors']))


if __name__ == '__main__':
    main()
