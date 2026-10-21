"""Reimport v3 GLB in a dedicated Blender process; never open the authoring file.

blender --background --factory-startup --python-exit-code 1 \
  --python scripts/reimport-workshop-runtime-v3.py -- --preview --fan-preview
Optional previews are offline Eevee renders from the actual GLB, not the game.
"""
import bpy
import json
import math
import runpy
import sys
from pathlib import Path

import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/environment/workshop'
GLB = OUT / 'workshop-runtime-v3.glb'
CONTRACT = OUT / 'asset-contract-v3.json'
REPORT = OUT / 'reimport-verification-v3.json'
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
    """Optional root-owned geometric proof, always explicit when not installed.

    scripts/workshop-clearance-v3.py should expose
    verify_geometric_clearance(scene, contract, meshes) -> {passed: bool, ...}.
    No source scene is opened; meshes are the actual GLB import. The root may
    replace this adapter with its finalized proof implementation.
    """
    module = ROOT / 'scripts/workshop-clearance-v3.py'
    if not module.is_file():
        return {'status': 'not-run', 'passed': None,
                'reason': 'Optional root-owned geometric clearance hook is not installed.',
                'expectedModule': str(module.relative_to(ROOT)),
                'scope': 'No geometric-clearance approval is inferred from this missing hook.'}
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
        raise RuntimeError('Rotor name/coordinateSpace does not match v3 contract')
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


def setup_preview(scene, contract):
    # Close inspection sees many small brass casters. The default 128 MiB
    # shadow pool overflows with the authored point practicals in this view.
    settings = scene.eevee
    if hasattr(settings, 'shadow_pool_size'):
        prop = settings.bl_rna.properties['shadow_pool_size']
        values = sorted(int(item.identifier) for item in prop.enum_items if item.identifier.isdigit())
        settings.shadow_pool_size = str(next(value for value in values if value >= 512))
    scale = 95 / 147
    offset = .3245 - 1.15 * scale

    def mapped(point):
        return Vector((point[0] * scale, point[1] * scale, point[2] * scale + offset))

    def area(name, position, target, power, color, size):
        data = bpy.data.lights.new(name, 'AREA')
        data.energy, data.color, data.shape, data.size = power * scale * scale, color, 'DISK', size * scale
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = mapped(position)
        obj.rotation_euler = (mapped(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()

    area('Preview v3 warm key', (-3.5, -2.5, 7.8), (0, 0, 1.2), 650, (1, .71, .4), 4)
    area('Preview v3 cool left window', (-4.65, 7.05, 6.4), (-2, 0, 1.8), 1100, (.47, .67, 1), 3)
    area('Preview v3 cool right window', (4.65, 7.05, 6.8), (2, -1, 1.5), 1450, (.5, .72, 1), 3)
    area('Preview v3 table warm reflection', (6, 1.5, 4), (-1, -1, 1.1), 580, (1, .7, .4), 3)
    area('Preview v3 soft return', (0, -8, 5.5), (0, 1, 2.4), 130, (.65, .8, .8), 6)
    for hint in contract.get('lighting', {}).get('hints', []):
        if hint['type'] != 'POINT':
            continue
        data = bpy.data.lights.new('Preview v3 ' + hint['name'], 'POINT')
        data.energy, data.color, data.shadow_soft_size = hint['scaledWatts'], hint['colorLinear'], .1 * scale
        obj = bpy.data.objects.new(data.name, data)
        scene.collection.objects.link(obj)
        obj.location = blender_vector(hint['position'])
    data = bpy.data.cameras.new('GLB v3 inspection camera')
    camera = bpy.data.objects.new(data.name, data)
    scene.collection.objects.link(camera)
    camera.location = mapped((.15, -17.8, 3.2))
    camera.rotation_euler = (mapped((0, 2.3, 3.7)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    data.lens = 42
    scene.camera = camera
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1280, 720, 100
    scene.render.image_settings.file_format, scene.render.image_settings.color_mode = 'PNG', 'RGB'
    if scene.world is None:
        scene.world = bpy.data.worlds.new('GLB v3 preview world')
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get('Background')
    background.inputs[0].default_value, background.inputs[1].default_value = (.16, .2, .24, 1), .25
    scene.view_settings.view_transform, scene.view_settings.exposure = 'AgX', -.15
    try:
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except (TypeError, ValueError):
        pass
    return camera


def render_previews(scene, contract, rotor, rest_matrix):
    requested = '--preview' in sys.argv or '--fan-preview' in sys.argv
    if not requested:
        return []
    camera, outputs = setup_preview(scene, contract), []

    def render(filename, description, source_pose=None):
        scene.render.filepath = str(OUT / filename)
        bpy.ops.render.render(write_still=True)
        outputs.append({'file': filename, 'width': 1280, 'height': 720, 'engine': 'Eevee',
            'description': description, 'cameraSourceZUp': source_pose,
            'cameraBlenderRuntimeScaleZUp': list(camera.location), 'lensMm': camera.data.lens,
            'pointLightShadowCount': sum(light.type == 'LIGHT' and light.data.type == 'POINT'
                and light.data.use_shadow for light in scene.objects),
            'scope': 'Offline inspection of actual v3 GLB geometry/materials; no source scene, characters or game UI.'})

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
        render('preview-glb-v3-eevee.png', 'Full scene from reimported v3 GLB; same frontal camera and lighting as v1/v2 QA.', frontal)
        oblique = pose((7.5, -16.5, 5.1), (0, 3.7, 4.1), 42)
        render('preview-glb-v3-oblique.png', 'Oblique full scene from actual v3 GLB, showing workshop depth and moved groups.', oblique)
        disable_point_shadows()
        details = [
            ('preview-board-v3.png', (9.5, 5.0, 5.0), (7.3, 6.7, 4.95), 40,
             'Lateral inspection of the drafting board and timber separation in actual v3 GLB.'),
            ('preview-apron-left-v3.png', (-5.4, -4.7, .7), (-3.8, -2.9, .6), 45,
             'Lateral inspection of the left apron banner and table-front separation in actual v3 GLB.'),
            ('preview-apron-right-v3.png', (5.4, -4.7, .7), (3.8, -2.9, .6), 45,
             'Lateral inspection of the right apron banner and table-front separation in actual v3 GLB.'),
        ]
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
                render('preview-fan-v3-%03d.png' % degrees, 'Reimported fan at %s degrees, fixed camera and lighting.' % degrees)
        finally:
            rotor.matrix_world = rest_matrix
            bpy.context.view_layer.update()
    return outputs


def write_report(report):
    REPORT.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    compact = {key: value for key, value in report.items() if key not in ('materialImageBindings', 'rotor')}
    print('WORKSHOP_REIMPORT_V3 ' + json.dumps(compact, allow_nan=False), flush=True)


def main():
    missing = [str(file) for file in (GLB, CONTRACT) if not file.is_file()]
    if missing:
        print('WORKSHOP_REIMPORT_V3 ' + json.dumps({'status': 'pending', 'missing': missing}), flush=True)
        return
    report = {'passed': False, 'file': GLB.name, 'version': 3, 'importer': 'Blender ' + bpy.app.version_string,
        'errors': [], 'previews': [], 'scope': 'Actual v3 GLB import and Blender CPU transforms. Optional Eevee renders are offline QA, not game runtime.'}
    try:
        contract = json.loads(CONTRACT.read_text(encoding='utf-8'))
        if contract.get('version') != 3 or contract.get('asset') != GLB.name:
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
        checks = {'bounds': bounds_error < 1e-4, 'triangleBudget': triangles <= 500000,
            'drawGroupBudget': groups <= 60, 'stageHeight': abs(stage_top - .3245) < .002,
            'activeVolumeClear': len(intersections) == 0, 'rotorLocalGeometry': rotor_report['localGeometry']['ok'],
            'rotorMotion': rotor_report['motion']['ok'], 'embeddedImagesDecoded': all(image['decoded'] for image in images)}
        if clearance['passed'] is not None:
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
            report['previews'] = render_previews(scene, contract, rotor, rest_matrix)
        report['passed'] = not report['errors']
    except Exception as error:
        report['errors'].append(type(error).__name__ + ': ' + str(error))
    write_report(report)
    if not report['passed']:
        raise RuntimeError('V3 reimport verification failed: ' + '; '.join(report['errors']))


if __name__ == '__main__':
    main()
