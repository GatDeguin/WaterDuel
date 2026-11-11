"""Author the three campaign rivals on the V4 physical skeleton in one GLB.

Run with Blender in background mode. The original boss file is read only.
"""
import json
import struct
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets/characters/water-mannequin/v4'
OUTPUT = ASSETS / 'water-mannequin-rivals.glb'
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'docs/assets/characters/v4/water-mannequin-boss.blend'))
character = bpy.data.collections['WaterDuel_Character']
rig = bpy.data.objects['WD_Mannequin_Rig']


def finish(name, rgb, metallic, roughness):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*rgb, 1)
    nodes = material.node_tree.nodes
    nodes.clear()
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    output = nodes.new('ShaderNodeOutputMaterial')
    material.node_tree.links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    shader.inputs['Base Color'].default_value = material.diffuse_color
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    return material


def rigid(obj, name, bone, material, style):
    obj.name = name
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    character.objects.link(obj)
    obj.data.materials.append(material)
    obj['rival_style'] = style
    obj.parent = rig
    weights = obj.vertex_groups.new(name=bone)
    weights.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    obj.modifiers.new('Rigid attachment', 'ARMATURE').object = rig
    return obj


def plate(style, name, bone, outline, back, thickness, metal, edge=None, bevel=.012):
    """Cast a closed plate from its front outline in bind-space X/Z."""
    count = len(outline)
    x0 = sum(x for x, _ in outline) / count
    z0 = sum(z for _, z in outline) / count
    vertices = [(x, back, z) for x, z in outline]
    vertices += [(x, back - thickness * .68, z) for x, z in outline]
    vertices += [(x0 + (x - x0) * .86, back - thickness, z0 + (z - z0) * .86) for x, z in outline]
    faces = [tuple(reversed(range(count))), tuple(range(count * 2, count * 3))]
    for i in range(count):
        j = (i + 1) % count
        faces.extend([(i, j, j + count, i + count), (i + count, j + count, j + 2 * count, i + 2 * count)])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = rigid(bpy.data.objects.new(name, mesh), name, bone, metal, style)
    if edge:
        mesh.materials.append(edge)
        for face in mesh.polygons:
            face.material_index = int(face.index >= 2 and face.index % 2 == 1)
    if bevel:
        modifier = obj.modifiers.new('Soft forged corners', 'BEVEL')
        modifier.width, modifier.segments = bevel, 2
        obj.modifiers.move(len(obj.modifiers) - 1, 0)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def rivets(style, name, bone, points, y, metal, radius=.017):
    for i, (x, z) in enumerate(points):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=radius, location=(x, y, z))
        obj = bpy.context.object
        obj.scale.y = .54
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        rigid(obj, f'{name}_{i}', bone, metal, style)


def limb_plates(style, bone, width, stations, metal, edge):
    joint = rig.data.bones[bone]
    start, end = joint.head_local, joint.tail_local
    perpendicular = Vector((end.z - start.z, 0, start.x - end.x)).normalized()
    for i, (lo, hi) in enumerate(stations):
        a, b = start.lerp(end, lo), start.lerp(end, hi)
        contour = (a + perpendicular * width * .77, b + perpendicular * width,
                   b - perpendicular * width, a - perpendicular * width * .77)
        plate(style, f'{bone}_plate_{i}', bone, [(p.x, p.z) for p in contour],
              min(a.y, b.y) - .064, .066, metal, edge, .006)


def marshal():
    gold = finish('Marshal hand-burnished brass', (.51, .29, .085), .76, .32)
    pearl = finish('Marshal champagne bevel', (.78, .54, .24), .78, .28)
    black = finish('Marshal dark enamel', (.027, .035, .036), .40, .36)
    plate('sword', 'Tapered cuirass', 'chest',
          [(-.225, 2.19), (0, 2.24), (.225, 2.19), (.145, 1.89), (0, 1.73), (-.145, 1.89)],
          -.173, .085, gold, pearl)
    plate('sword', 'Gorget', 'chest', [(-.164, 2.201), (-.11, 2.31), (.11, 2.31), (.164, 2.201)],
          -.139, .076, black, pearl, .007)
    plate('sword', 'Inlaid diamond', 'chest', [(0, 2.155), (.067, 2.04), (0, 1.92), (-.067, 2.04)],
          -.253, .016, black, pearl, .003)
    plate('sword', 'Dagger shoulder', 'upper_arm.L',
          [(-.27, 2.17), (-.32, 2.32), (-.51, 2.31), (-.60, 2.22), (-.49, 2.13)],
          -.070, .112, black, pearl)
    limb_plates('sword', 'forearm.R', .060, [(.58, .88)], gold, pearl)
    rivets('sword', 'Cuirass clasps', 'chest', [(-.16, 2.14), (.16, 2.14)], -.260, pearl, .013)


def sentinel():
    blue = finish('Sentinel cobalt gunmetal', (.046, .15, .26), .62, .38)
    edge = finish('Sentinel brushed nickel', (.44, .58, .65), .80, .30)
    dark = finish('Sentinel blued iron', (.021, .047, .065), .67, .42)
    plate('spear', 'Tall breast shell', 'chest',
          [(-.265, 2.185), (0, 2.265), (.265, 2.185), (.218, 1.867), (0, 1.77), (-.218, 1.867)],
          -.157, .092, blue, edge)
    plate('spear', 'Keel', 'chest', [(-.047, 2.219), (.047, 2.219), (.071, 1.924), (0, 1.819), (-.071, 1.924)],
          -.241, .052, dark, edge)
    plate('spear', 'Raised nickel gorget', 'chest',
          [(-.194, 2.178), (-.148, 2.301), (-.109, 2.371), (-.071, 2.247), (.071, 2.247), (.109, 2.371), (.148, 2.301), (.194, 2.178)],
          -.112, .062, dark, edge, .007)
    for side, sign in [('L', -1), ('R', 1)]:
        outline = [(.274, 2.14), (.273, 2.347), (.36, 2.405), (.442, 2.284), (.476, 2.154), (.393, 2.111)]
        plate('spear', f'{side} upright fin', 'upper_arm.' + side, [(sign * x, z) for x, z in outline],
              -.071, .108, blue, edge)
        plate('spear', f'{side} belt scale', 'pelvis',
              [(sign * x, z) for x, z in [(0.104, 1.552), (.219, 1.58), (.221, 1.395), (.164, 1.339), (.122, 1.405)]],
              -.094, .063, dark, edge)
    limb_plates('spear', 'forearm.R', .078, [(.17, .48), (.46, .72), (.70, .92)], blue, edge)
    limb_plates('spear', 'thigh.L', .069, [(.15, .69)], dark, edge)
    rivets('spear', 'Belted upper shell', 'chest', [(-.178, 2.126), (.178, 2.126), (-.153, 1.953), (.153, 1.953)], -.250, edge, .013)


def axe_guardian():
    red = finish('Serradora lacquered iron', (.285, .044, .034), .50, .39)
    iron = finish('Serradora hammered iron', (.112, .106, .096), .80, .44)
    copper = finish('Serradora copper rivets', (.51, .207, .067), .75, .36)
    plate('axe', 'Wide riveted breastplate', 'chest',
          [(-.31, 2.15), (-.23, 2.227), (.225, 2.227), (.325, 2.14), (.291, 1.906), (.179, 1.79), (-.22, 1.81), (-.294, 1.91)],
          -.160, .116, red, iron, .017)
    plate('axe', 'Diagonal iron strap', 'chest', [(-.226, 2.14), (-.167, 2.191), (.235, 1.931), (.178, 1.877)],
          -.269, .033, iron, copper, .006)
    plate('axe', 'Raised anvil yoke', 'chest',
          [(-.36, 2.152), (-.335, 2.341), (-.205, 2.391), (-.125, 2.313), (-.123, 2.231)],
          -.097, .107, iron, copper, .015)
    plate('axe', 'Anvil shoulder', 'upper_arm.R',
          [(.223, 2.183), (.28, 2.382), (.518, 2.423), (.637, 2.319), (.639, 2.207), (.499, 2.106), (.335, 2.119)],
          -.058, .156, iron, copper, .021)
    plate('axe', 'Overlapping shoulder lame', 'upper_arm.R',
          [(.31, 2.177), (.44, 2.27), (.611, 2.254), (.567, 2.114), (.45, 2.057)],
          -.179, .070, red, iron, .012)
    plate('axe', 'Shield shoulder', 'upper_arm.L',
          [(-.228, 2.175), (-.283, 2.297), (-.455, 2.291), (-.531, 2.228), (-.497, 2.128), (-.322, 2.133)],
          -.055, .124, red, iron)
    for sign in [-1, 1]:
        outline = [(0.101, 1.564), (.249, 1.595), (.291, 1.471), (.258, 1.342), (.157, 1.326), (.109, 1.395)]
        plate('axe', 'Flared hip plate', 'pelvis', [(sign * x, z) for x, z in outline], -.092, .081, iron, copper, .013)
    limb_plates('axe', 'forearm.R', .092, [(.20, .49), (.52, .86)], iron, copper)
    limb_plates('axe', 'thigh.R', .116, [(.14, .44), (.40, .77)], red, iron)
    rivets('axe', 'Breast rivets', 'chest', [(-.227, 2.098), (.236, 2.093), (-.194, 1.954), (.192, 1.95)], -.275, copper)
    rivets('axe', 'Anvil pins', 'upper_arm.R', [(.365, 2.311), (.495, 2.352), (.565, 2.30)], -.212, copper)


removed = ('Boss_Shoulder_', 'Boss_Chest_', 'Boss_Vambrace_', 'Boss_Thigh_Plate_', 'Boss_Crown_', 'Boss_Laurel_', 'Boss_Crest_')
for obj in list(character.objects):
    if obj.type == 'MESH' and (obj.name.startswith(removed) or 'Balloon' in obj.name or 'Water' in obj.name
                               or obj.name.startswith(('Rapier_', 'Leather_Grip_Wrap_')) and obj.name != 'Rapier_Blade'):
        bpy.data.objects.remove(obj, do_unlink=True)
preview = bpy.data.objects['Rapier_Blade']
preview.data.materials.clear()
preview.data.materials.append(finish('Grip axis reference', (.4, .4, .4), .8, .3))

marshal()
sentinel()
axe_guardian()

groups = {}
for obj in character.objects:
    if obj.type != 'MESH':
        continue
    prefix = 'Preview_Rapier' if obj == preview else ('Rival_' + obj['rival_style'] if obj.get('rival_style') else 'WD_Boss')
    # Preserve the variant on the exported node. Faces with secondary edge
    # materials become additional primitives of that same node.
    key = (prefix, tuple(slot.material.name for slot in obj.material_slots))
    groups.setdefault(key, []).append(obj)

meshes = []
for (prefix, materials), objects in groups.items():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = prefix + '_' + materials[0]
    meshes.append(merged)

bpy.ops.object.select_all(action='DESELECT')
for obj in meshes + [rig] + [obj for obj in character.objects if obj.type == 'EMPTY']:
    obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True, export_yup=True,
                         export_skins=True, export_animations=False, export_rest_position_armature=False,
                         export_current_frame=True, export_texcoords=True, export_normals=True, export_extras=True)


def glb_json(path):
    data = path.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20 + size]), data[20 + size:]


# Keep the V4 woven atlas tint and sheen contract after Blender flattens its
# source multiply node. Geometry and image payloads are unchanged by this step.
document, payload = glb_json(OUTPUT)
original, _ = glb_json(ASSETS / 'water-mannequin-boss.glb')
cloth_name = 'Boss_Burgundy_Woven_Cloth'
old = next(m for m in original['materials'] if m['name'] == cloth_name)
cloth = next(m for m in document['materials'] if m['name'] == cloth_name)
cloth['pbrMetallicRoughness']['baseColorFactor'] = old['pbrMetallicRoughness']['baseColorFactor']
cloth.setdefault('extensions', {})['KHR_materials_sheen'] = old['extensions']['KHR_materials_sheen']
encoded = json.dumps(document, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 4)
chunks = struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + payload
OUTPUT.write_bytes(struct.pack('<III', 0x46546c67, 2, 12 + len(chunks)) + chunks)
print('WD_RIVAL_GLTF', OUTPUT.stat().st_size, 'bytes')
