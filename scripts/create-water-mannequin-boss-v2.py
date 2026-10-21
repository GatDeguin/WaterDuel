"""Create the W4 workshop champion from the improved, posed mannequin source.

Run only after the improved mannequin generator has saved its v2 source:
  blender --background --python scripts/create-water-mannequin-boss-v2.py
Add --no-render to author and export without occupying the render device.

All added armor is authored in the unchanged mannequin bind space, with one
rigid bone weight per vertex. The inherited fencing pose stays editable. This
script opens its own file and never connects to an interactive Blender session.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/assets/characters/v2'
OUT = ROOT / 'public/assets/characters/water-mannequin/v2'
INPUT = SOURCE / 'water-mannequin.blend'
BOSS_SCALE = 1.15
SKIP_RENDER = '--no-render' in sys.argv

if not INPUT.is_file():
    raise FileNotFoundError('Build the improved v2 mannequin first: ' + str(INPUT))
bpy.ops.wm.open_mainfile(filepath=str(INPUT))
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
character = bpy.data.collections['WaterDuel_Character']
rig = bpy.data.objects['WD_Mannequin_Rig']
assert len(rig.data.bones) == 18, 'The boss must retain the 18-bone skeleton.'
assert all(abs(s - 1.0) < 1e-6 for s in rig.scale), 'Expected an unscaled v2 source rig.'


def existing_material(object_name):
    obj = bpy.data.objects.get(object_name)
    if obj is None or not obj.data.materials:
        raise RuntimeError('Missing source material on ' + object_name)
    return obj.data.materials[0]


wood = existing_material('Torso_Rounded_Beech')
brass = bpy.data.materials['Satin_Brass']
dark = bpy.data.materials['Recessed_Steel']
latex = existing_material('Balloon_Latex')
water = existing_material('Water_Contained')


def material(name, color, roughness=.4, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    node = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    node.name = 'Principled BSDF'
    node.inputs['Base Color'].default_value = (*color, 1)
    node.inputs['Roughness'].default_value = roughness
    node.inputs['Metallic'].default_value = metallic
    return mat


cloth = material('Boss_Burgundy_Woven_Cloth', (.185, .009, .023), .74)
cloth.node_tree.nodes['Principled BSDF'].inputs['Sheen Weight'].default_value = .18


def move_to_character(obj):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    character.objects.link(obj)


def attach(obj, name, mat, bone):
    """Assign a rigid armature group without baking the current pose."""
    obj.name = name
    move_to_character(obj)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = world
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    modifier = obj.modifiers.new('Rigid_Articulation', 'ARMATURE')
    modifier.object = rig
    obj['rig_bone'] = bone
    obj['reference'] = 'w4: rounded workshop champion armor'
    return obj


def mesh_object(name, verts, faces, mat, bone, thickness=0):
    mesh = bpy.data.meshes.new(name + '_Mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    character.objects.link(obj)
    # Planar coordinates also give added wooden plates a packed grain texture.
    uv = mesh.uv_layers.new(name='UVMap')
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (co.x * 2.5 + .5, co.z * 1.4)
    if thickness:
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new('Forged_Plate_Thickness', 'SOLIDIFY')
        modifier.thickness = thickness
        modifier.offset = -1
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return attach(obj, name, mat, bone)


def sphere(name, pos, scale, mat, bone, segments=20, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=pos)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return attach(obj, name, mat, bone)


def rod(name, a, b, radius, mat, bone, vertices=16):
    a, b = Vector(a), Vector(b)
    direction = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius,
                                      depth=direction.length, location=(a + b) / 2)
    obj = bpy.context.object
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = direction.to_track_quat('Z', 'Y')
    return attach(obj, name, mat, bone)


def tube(name, points, radius, mat, bone, segments=8, closed=False):
    """A small mesh tube used for hems and heraldry, avoiding curve exports."""
    points = [Vector(p) for p in points]
    verts, faces = [], []
    for i, point in enumerate(points):
        prev = points[(i - 1) % len(points)] if closed or i else points[i]
        nex = points[(i + 1) % len(points)] if closed or i < len(points) - 1 else points[i]
        tangent = (nex - prev).normalized()
        normal = tangent.cross(Vector((0, 1, 0)))
        if normal.length < .001:
            normal = tangent.cross(Vector((1, 0, 0)))
        normal.normalize()
        bitangent = tangent.cross(normal).normalized()
        for j in range(segments):
            angle = math.tau * j / segments
            verts.append(tuple(point + radius * (normal * math.cos(angle) + bitangent * math.sin(angle))))
    span = len(points) if closed else len(points) - 1
    for i in range(span):
        for j in range(segments):
            a = i * segments + j
            b = i * segments + (j + 1) % segments
            c = ((i + 1) % len(points)) * segments + (j + 1) % segments
            d = ((i + 1) % len(points)) * segments + j
            faces.append((a, b, c, d))
    if not closed:
        faces.extend([tuple(reversed(range(segments))),
                      tuple((len(points) - 1) * segments + j for j in range(segments))])
    return mesh_object(name, verts, faces, mat, bone)


def limb_frame(bone):
    data = rig.data.bones[bone]
    a, b = data.head_local.copy(), data.tail_local.copy()
    axis = (b - a).normalized()
    front = Vector((0, -1, 0))
    front = (front - axis * axis.dot(front)).normalized()
    across = axis.cross(front).normalized()
    return a, b, front, across


def limb_panel(name, bone, t0, t1, radius, angle0, angle1, mat, thickness=.009):
    """Curved shield segment follows a limb while its round core remains visible."""
    a, b, front, across = limb_frame(bone)
    verts, faces = [], []
    steps, columns = 4, 16
    for i in range(steps + 1):
        t = i / steps
        center = a.lerp(b, t0 + (t1 - t0) * t)
        # Shaped ends and a broad middle keep the guard recognizably crafted.
        taper = .91 + .09 * math.sin(math.pi * t)
        for j in range(columns + 1):
            angle = angle0 + (angle1 - angle0) * j / columns
            radial = front * math.cos(angle) + across * math.sin(angle)
            verts.append(tuple(center + radial * radius * taper))
    for i in range(steps):
        for j in range(columns):
            k = i * (columns + 1) + j
            faces.append((k, k + 1, k + columns + 2, k + columns + 1))
    return mesh_object(name, verts, faces, mat, bone, thickness)


def armor_limb(bone, label, radius, t0=.18, t1=.83):
    # Three readable thicknesses: recessed mount, wooden shell, brass edgework.
    limb_panel('Boss_' + label + '_Recessed_Mount', bone, t0 - .025, t1 + .025,
               radius * .95, -1.34, 1.34, dark, .008)
    limb_panel('Boss_' + label + '_Rounded_Wood', bone, t0, t1,
               radius, -1.26, 1.26, wood, .014)
    for edge, lo, hi in [('Left', -1.29, -1.13), ('Right', 1.13, 1.29)]:
        limb_panel('Boss_' + label + '_Brass_Edge_' + edge, bone, t0, t1,
                   radius + .003, lo, hi, brass, .005)
    for index, t in enumerate([t0 + .045, t1 - .045]):
        limb_panel('Boss_' + label + '_Retaining_Band_' + str(index), bone,
                   t - .02, t + .02, radius + .004, -1.29, 1.29, brass, .006)
        a, b, front, across = limb_frame(bone)
        for side, angle in enumerate([-.95, .95]):
            normal = (front * math.cos(angle) + across * math.sin(angle)).normalized()
            pos = a.lerp(b, t) + normal * (radius + .004)
            rod('Boss_' + label + '_Rivet_%d_%d' % (index, side),
                pos, pos + normal * .009, .009, brass, bone, 12)


def shoulder_cap(side):
    bone = 'upper_arm.' + side
    pos = rig.data.bones[bone].head_local + Vector((0, .008, .025))
    verts, faces = [], []
    rings, segments = 7, 32
    for i in range(rings + 1):
        phi = .035 + (math.pi / 2 - .035) * i / rings
        for j in range(segments):
            angle = math.tau * j / segments
            verts.append(tuple(pos + Vector((.174 * math.sin(phi) * math.cos(angle),
                                              .145 * math.sin(phi) * math.sin(angle),
                                              .103 * math.cos(phi)))))
    for i in range(rings):
        for j in range(segments):
            a = i * segments + j
            b = i * segments + (j + 1) % segments
            faces.append((a, a + segments, b + segments, b))
    mesh_object('Boss_Shoulder_' + side + '_Domed_Wood', verts, faces, wood, bone, .014)
    ring = [tuple(pos + Vector((.174 * math.cos(math.tau * j / 48),
                                .145 * math.sin(math.tau * j / 48), 0))) for j in range(48)]
    tube('Boss_Shoulder_' + side + '_Heavy_Brass_Rim', ring, .010, brass, bone, closed=True)
    # A top reinforcing strap hugs the curved cap, instead of a cuboid plate.
    strap = []
    for j in range(25):
        angle = -math.pi / 2 + math.pi * j / 24
        strap.append(tuple(pos + Vector((.174 * math.sin(angle), 0,
                                         .104 * math.cos(angle) + .003))))
    tube('Boss_Shoulder_' + side + '_Crown_Strap', strap, .013, brass, bone)
    for j in range(5):
        angle = math.pi * (1.14 + .18 * j)
        rivet = pos + Vector((.171 * math.cos(angle), .143 * math.sin(angle), .013))
        sphere('Boss_Shoulder_' + side + '_Rivet_' + str(j), rivet,
               (.010, .010, .008), brass, bone, 12, 6)


# W4 is visibly broader while keeping the rounded artist's mannequin core.
broaden = Matrix.Diagonal((1.25, 1.12, 1.0, 1.0))
for obj in list(character.objects):
    if obj.type == 'MESH' and obj.get('rig_bone') == 'chest':
        obj.matrix_world = broaden @ obj.matrix_world
    if obj.type == 'MESH' and obj.name.startswith('Foot_'):
        obj.scale.x *= 1.15
        obj.scale.y *= 1.06

# Replace the normal fighter's turquoise round badge with the W4 dark heraldry.
for obj in list(character.objects):
    if obj.name in {'Chest_Medallion', 'Medallion_Enamel'} or obj.name.startswith('Crest_Hydraulic_Bar_'):
        bpy.data.objects.remove(obj, do_unlink=True)
shield_outline = [(-.069, -.202, 1.872), (.069, -.202, 1.872),
                  (.069, -.202, 1.751), (0, -.202, 1.715), (-.069, -.202, 1.751)]
mesh_object('Boss_Chest_Dark_Heraldic_Shield', shield_outline,
            [tuple(reversed(range(len(shield_outline))))], dark, 'chest', .012)
tube('Boss_Chest_Shield_Brass_Border', shield_outline, .0055, brass, 'chest', closed=True)
for side in [-1, 1]:
    for z in [1.856, 1.762]:
        rod('Boss_Chest_Shield_Rivet_%s_%s' % (side, z),
            (side * .055, -.209, z), (side * .055, -.215, z), .0065, brass, 'chest', 12)
shield_crown = [(-.029, 1.811), (-.036, 1.844), (-.015, 1.830), (0, 1.857),
                (.015, 1.830), (.036, 1.844), (.029, 1.811)]
mesh_object('Boss_Chest_Gold_Crown', [(x, -.216, z) for x, z in shield_crown],
            [tuple(reversed(range(len(shield_crown))))], brass, 'chest', .003)
tube('Boss_Chest_Crown_Gold_Base', [(-.03, -.216, 1.808), (.03, -.216, 1.808)], .0035, brass, 'chest')
for index, x in enumerate([-.018, 0, .018]):
    rod('Boss_Chest_Gold_Hydraulic_Column_' + str(index),
        (x, -.216, 1.752), (x, -.216, 1.796 if index == 1 else 1.782), .0035, brass, 'chest', 8)
tube('Boss_Chest_Gold_Hydraulic_Base', [(-.030, -.216, 1.752), (.030, -.216, 1.752)],
     .0035, brass, 'chest')

for side in ['L', 'R']:
    shoulder_cap(side)
    armor_limb('forearm.' + side, 'Vambrace_' + side, .098, .18, .84)
    armor_limb('shin.' + side, 'Greave_' + side, .102, .15, .86)
    armor_limb('thigh.' + side, 'Thigh_Plate_' + side, .116, .16, .64)

# A long, folded burgundy tabard carries physical gold embroidery geometry.
old_sash = bpy.data.objects.get('Workshop_Sash')
if old_sash is not None:
    bpy.data.objects.remove(old_sash, do_unlink=True)
verts, faces = [], []
rows, columns = 9, 12
for i in range(rows + 1):
    t = i / rows
    half_width = .137 - .020 * t
    for j in range(columns + 1):
        u = j / columns
        x = (2 * u - 1) * half_width
        y = -.169 - .020 * t + .010 * math.cos(u * math.tau * 2.5) * (.25 + .75 * t)
        z = 1.333 - .637 * t
        if i == rows:
            z += .044 * abs(2 * u - 1) + .016 * math.cos(u * math.tau * 4)
        verts.append((x, y, z))
for i in range(rows):
    for j in range(columns):
        k = i * (columns + 1) + j
        faces.append((k, k + columns + 1, k + columns + 2, k + 1))
tabard = mesh_object('Boss_Long_Burgundy_Tabard', verts, faces, cloth, 'pelvis', .007)
tabard['cloth_behavior'] = 'Static folded cloth, rigidly attached to pelvis; no cloth solver.'
for edge in [0, columns]:
    edge_points = [Vector(verts[i * (columns + 1) + edge]) + Vector((0, -.006, 0))
                   for i in range(rows + 1)]
    tube('Boss_Tabard_Gold_Edge_' + str(edge), edge_points, .0045, brass, 'pelvis')
hem = [Vector(verts[rows * (columns + 1) + j]) + Vector((0, -.006, 0))
       for j in range(columns + 1)]
tube('Boss_Tabard_Scalloped_Gold_Hem', hem, .004, brass, 'pelvis')

# The crown and laurel are deliberate low relief geometry, readable at game size.
crest_y, crest_z = -.194, .948
crown = [(-.044, .028), (-.055, .080), (-.023, .058), (0, .101),
         (.023, .058), (.055, .080), (.044, .028)]
mesh_object('Boss_Crown_Emblem', [(x, crest_y, crest_z + z) for x, z in crown],
            [tuple(reversed(range(len(crown))))], brass, 'pelvis', .004)
tube('Boss_Crown_Gold_Base', [(-.045, crest_y - .003, crest_z + .024),
                             (.045, crest_y - .003, crest_z + .024)], .005, brass, 'pelvis')
for side in [-1, 1]:
    points = []
    for j in range(25):
        angle = -.70 + 1.90 * j / 24
        points.append((side * (.055 + .029 * math.cos(angle)), crest_y,
                       crest_z - .039 + .092 * math.sin(angle)))
    tube('Boss_Laurel_Stem_' + str(side), points, .0028, brass, 'pelvis', segments=6)
    for j in range(6):
        angle = -.55 + .29 * j
        x = side * (.055 + .029 * math.cos(angle))
        z = crest_z - .039 + .092 * math.sin(angle)
        leaf = sphere('Boss_Laurel_Leaf_%d_%d' % (side, j), (x, crest_y, z),
                      (.009, .0035, .018), brass, 'pelvis', 12, 6)
        leaf.rotation_euler.y = side * (.65 + .22 * j)
for i, x in enumerate([-.022, 0, .022]):
    rod('Boss_Crest_Hydraulic_Column_' + str(i), (x, crest_y, crest_z - .051),
        (x, crest_y, crest_z + (.012 if i == 1 else -.008)), .004, brass, 'pelvis', 8)

# Recolor independent latex and liquid. The air pocket and waterline remain.
for mat, base, absorption in [
        (latex, (1.0, .715, .325, 1), (1.0, .29, .035, 1)),
        (water, (1.0, .855, .535, 1), (1.0, .69, .21, 1))]:
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = base
    mat.diffuse_color = base
    for node in mat.node_tree.nodes:
        if node.type == 'VOLUME_ABSORPTION':
            node.inputs['Color'].default_value = absorption
crest_mat = bpy.data.materials.get('Water_Surface_Crest')
if crest_mat:
    crest_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1, .91, .65, 1)

# Grow the complete character, then normalize its armature object transform.
# Blender 5.2's importer subtracts an unscaled bone-tail offset for bone-parented
# empties while dividing the generated bone length by the armature scale. A
# scaled armature therefore round-trips meshes correctly but shifts sockets.
# Normalize rest lengths, pose translations and child transforms together;
# preserve and compare every evaluated vertex instead of compensating the GLB.
rig.scale = (BOSS_SCALE,) * 3
rig['asset'] = 'WaterDuel / El Maestro Hidraulico / W4 boss v2'
rig['boss_uniform_scale'] = BOSS_SCALE
rig['boss_torso_width_ratio'] = 1.25
rig['boss_torso_depth_ratio'] = 1.12
rig.show_in_front = False
bpy.context.view_layer.update()


def normalized_armature_scale():
    children = [obj for obj in character.objects if obj != rig]
    child_world = {obj: obj.matrix_world.copy() for obj in children}
    pose_targets = {}
    for bone in rig.pose.bones:
        target = bone.matrix.copy()
        target.translation *= BOSS_SCALE
        pose_targets[bone.name] = target

    def evaluated_positions():
        positions = {}
        graph = bpy.context.evaluated_depsgraph_get()
        for obj in children:
            if obj.type != 'MESH':
                continue
            evaluated = obj.evaluated_get(graph)
            mesh = evaluated.to_mesh()
            positions[obj.name] = [evaluated.matrix_world @ v.co for v in mesh.vertices]
            evaluated.to_mesh_clear()
        return positions

    before = evaluated_positions()
    rig.data.transform(Matrix.Scale(BOSS_SCALE, 4))
    rig.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    # Bones are stored parent-before-child; update after each matrix assignment
    # so Blender calculates its basis against the normalized parent pose.
    for bone in rig.pose.bones:
        bone.matrix = pose_targets[bone.name]
        bpy.context.view_layer.update()
    for obj in children:
        obj.matrix_world = child_world[obj]
    bpy.context.view_layer.update()
    after = evaluated_positions()
    max_error = 0.0
    for name, points in before.items():
        assert len(points) == len(after[name]), 'Normalization changed topology: ' + name
        max_error = max(max_error, max((a - b).length for a, b in zip(points, after[name])))
    assert max_error < .00002, 'Rig scale normalization changed geometry: ' + str(max_error)
    for obj in children:
        if obj.name.startswith('Socket_'):
            error = (obj.matrix_world.translation - child_world[obj].translation).length
            assert error < .00002, 'Normalization changed socket: ' + obj.name
    rig['boss_scale_normalized'] = True
    rig['normalization_max_vertex_error_metres'] = max_error
    print('WD_BOSS_NORMALIZED_SCALE', max_error, flush=True)


normalized_armature_scale()
for image in bpy.data.images:
    if image.source == 'FILE' and image.has_data:
        image.pack()
bpy.context.view_layer.update()


def export_glb():
    originals = [obj for obj in character.objects if obj.type == 'MESH']
    separate = [bpy.data.objects['Balloon_Latex'], bpy.data.objects['Water_Contained']]
    sockets = [obj for obj in character.objects if obj.name.startswith('Socket_')]
    assert len(sockets) == 5, 'The boss must preserve all five equipment sockets.'
    temp = bpy.data.collections.new('WD_Boss_Export_Temporary')
    scene.collection.children.link(temp)
    groups, merged = {}, []
    for obj in originals:
        if obj in separate:
            continue
        assert len(obj.data.materials) == 1, 'Expected a single material on ' + obj.name
        optional = obj.name.startswith(('Rapier_', 'Leather_Grip_Wrap_', 'Preview_Rapier_'))
        optional = optional or bool(obj.get('optional_preview_equipment'))
        duplicate = obj.copy()
        duplicate.data = obj.data.copy()
        temp.objects.link(duplicate)
        groups.setdefault((obj.data.materials[0].name, optional), []).append(duplicate)
    try:
        for (matname, optional), objects in groups.items():
            bpy.ops.object.select_all(action='DESELECT')
            for obj in objects:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = objects[0]
            bpy.ops.object.join()
            obj = bpy.context.object
            obj.name = ('Preview_Rapier_' if optional else 'WD_Boss_') + matname
            if optional:
                obj['optional_preview_equipment'] = True
            merged.append(obj)
        meshes = merged + separate
        triangles = sum(sum(len(p.vertices) - 2 for p in obj.data.polygons) for obj in meshes)
        assert len(meshes) <= 20, 'Boss exceeds mesh budget: ' + str(len(meshes))
        assert triangles <= 120000, 'Boss exceeds triangle budget: ' + str(triangles)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in meshes + [rig] + sockets:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.export_scene.gltf(filepath=str(OUT / 'water-mannequin-boss.glb'),
                                 export_format='GLB', use_selection=True, export_yup=True,
                                 export_apply=False, export_animations=False, export_skins=True,
                                 export_rest_position_armature=False, export_current_frame=True,
                                 export_texcoords=True, export_normals=True, export_materials='EXPORT',
                                 export_extras=True, export_cameras=False, export_lights=False)
        return {'export_meshes': len(meshes), 'export_triangles': triangles}
    finally:
        for obj in list(temp.objects):
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if data.users == 0:
                bpy.data.meshes.remove(data)
        bpy.data.collections.remove(temp)


stats = export_glb()
# Frame the actual posed model, including its optional rapier, without floors.
depsgraph = bpy.context.evaluated_depsgraph_get()
points = []
for obj in character.objects:
    if obj.type == 'MESH':
        evaluated = obj.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ vertex.co for vertex in evaluated_mesh.vertices)
        evaluated.to_mesh_clear()
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
target = (low + high) / 2
camera = scene.camera
camera.location = target + Vector((3.7, -8.4, 1.9))
camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
rotation = camera.rotation_euler.to_matrix().transposed()
projected = [rotation @ (p - target) for p in points]
scene.render.resolution_x = 1600
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
aspect = scene.render.resolution_x / scene.render.resolution_y
camera.data.ortho_scale = max(2 * max(abs(p.x) for p in projected),
                             2 * max(abs(p.y) for p in projected) * aspect) * 1.10
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = str(OUT / 'water-mannequin-boss-preview.png')
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
try:
    if SKIP_RENDER:
        raise RuntimeError('Render intentionally skipped; no GPU initialization needed.')
    preferences = bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type = 'OPTIX'
    preferences.get_devices()
    for device in preferences.devices:
        device.use = device.type != 'CPU'
    scene.cycles.device = 'GPU' if any(d.use for d in preferences.devices) else 'CPU'
    print('WD_BOSS_RENDER_DEVICE', scene.cycles.device,
          [(d.name, d.use) for d in preferences.devices], flush=True)
except Exception as exc:
    if not SKIP_RENDER:
        scene.cycles.device = 'CPU'
        print('WD_BOSS_GPU_FALLBACK', str(exc), flush=True)
scene['authoring_note'] = 'W4 boss asset v2: rounded mannequin core, heavier articulated armor, amber water balloon, top knot, burgundy heraldic tabard. Static fluid and cloth; no runtime integration.'
scene['boss_scale_relative_normal'] = BOSS_SCALE
notes = bpy.data.texts.get('LEEME_Boss_WaterDuel') or bpy.data.texts.new('LEEME_Boss_WaterDuel')
notes.clear()
notes.write('''WATERDUEL · EL MAESTRO HIDRÁULICO · V2
Referencia principal: docs/referencias/w4.png; conserva las formas redondeadas.
Silueta: altura global 115%, torso 125% de ancho y 112% de profundidad.
Hombreras abovedadas, brazales, espinilleras y musleras de madera remachada/latón.
Faldón largo borgoña con corona y laureles de geometría en relieve.
Rig de 18 huesos y pose de esgrima heredados, sin hornear la pose en las mallas.
Las piezas nuevas se crearon en bind space y usan peso rígido 1.0 por pieza.
Altura global 115%, aplicada a huesos, pose y mallas; escala del rig normalizada a 1.
Los cinco Socket_* conservan sus matrices visuales y siguen ligados a huesos.
Preview_Rapier_* en GLB es equipo de muestra opcional; ocultarlo para equipar Items.
Fuente: Rapier_* y Leather_Grip_Wrap_* se pueden ocultar independientemente.
Balloon_Latex y Water_Contained permanecen separados. Nudo superior.
Agua y faldón estáticos; no contiene simulación ni integración de runtime.
Presentation_Only se excluye del GLB. Textura de madera empaquetada.
Metros, origen al suelo; Blender Z arriba/-Y frente; GLB Y arriba/+Z frente.
''')
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = bpy.data.objects['Torso_Rounded_Beech']
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_perspective = 'CAMERA'
            area.spaces.active.shading.type = 'MATERIAL'
            area.spaces.active.overlay.show_overlays = False
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'water-mannequin-boss.blend'))
stats.update({'asset': 'water-mannequin-boss-v2', 'reference': 'w4.png',
              'bones': len(rig.data.bones), 'sockets': 5, 'uniform_scale': BOSS_SCALE,
              'rig_object_scale_normalized': True,
              'scale_normalization_max_vertex_error_metres': rig['normalization_max_vertex_error_metres'],
              'torso_width_relative_normal': 1.25, 'torso_depth_relative_normal': 1.12,
              'posed_height_metres': round(float(high.z - low.z), 6),
              'source_axes': 'Z up, -Y forward', 'glb_axes': 'Y up, +Z forward',
              'pose_baked': False, 'fluid_static': True, 'cloth_static': True,
              'runtime_integrated': False,
              'optional_equipment_prefix': 'Preview_Rapier_',
              'source': 'docs/assets/characters/v2/water-mannequin-boss.blend'})
(OUT / 'water-mannequin-boss-info.json').write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding='utf-8')
print('WD_BOSS_ASSET_SAVED', json.dumps(stats), flush=True)
if not SKIP_RENDER:
    bpy.ops.render.render(write_still=True)
print('WD_BOSS_COMPLETE', flush=True)
