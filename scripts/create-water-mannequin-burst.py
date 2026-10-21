"""Author a static W3-inspired burst from the existing rigged mannequin source.

Run with Blender 5.2 --background --python scripts/create-water-mannequin-burst.py.
This is an art-directed frozen state, not a physical fluid simulation.
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/assets/characters'
OUT = ROOT / 'public/assets/characters/water-mannequin'
bpy.ops.wm.open_mainfile(filepath=str(SOURCE / 'water-mannequin.blend'))
scene = bpy.context.scene
character = bpy.data.collections['WaterDuel_Character']
rig = bpy.data.objects['WD_Mannequin_Rig']
center = Vector((0, 0, 2.405))
rx, ry, rz = .327, .293, .354
rng = np.random.default_rng(7331)

# Keep every wooden part, rig and pose; replace only the head's intact vessels.
for obj in list(character.objects):
    if obj.name in {'Balloon_Latex', 'Water_Contained', 'Water_Meniscus_Rim', 'Water_Surface_Crest'} or obj.name.startswith('Water_Air_Bubble_'):
        bpy.data.objects.remove(obj, do_unlink=True)
latex = bpy.data.materials['Mint_Latex_Transmission']
water = bpy.data.materials['Water_IOR_1.333']
cloth = bpy.data.materials['Mint_Woven_Sash']
latex.name = 'Amber_Torn_Latex'
lbs = latex.node_tree.nodes['Principled BSDF']
lbs.inputs['Base Color'].default_value = (1, .27, .025, 1)
lbs.inputs['Transmission Weight'].default_value = .36
lbs.inputs['Roughness'].default_value = .12
lbs.inputs['Coat Weight'].default_value = .25
latex.diffuse_color = (1, .27, .025, 1)
latex.node_tree.nodes['Volume Absorption'].inputs['Color'].default_value = (1, .17, .008, 1)
latex.node_tree.nodes['Volume Absorption'].inputs['Density'].default_value = 32
wbs = water.node_tree.nodes['Principled BSDF']
wbs.inputs['Base Color'].default_value = (.94, .985, 1, 1)
wbs.inputs['Transmission Weight'].default_value = 1
wbs.inputs['Roughness'].default_value = .025
water.diffuse_color = (.94, .985, 1, 1)
water.node_tree.nodes['Volume Absorption'].inputs['Color'].default_value = (.80, .95, 1, 1)
water.node_tree.nodes['Volume Absorption'].inputs['Density'].default_value = .035
for node in water.node_tree.nodes:
    if node.type == 'GROUP' and 'Thickness' in node.inputs:
        node.inputs['Thickness'].default_value = .024
cloth.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.30, .025, .01, 1)

def finish(obj, name, material):
    obj.name = name
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    character.objects.link(obj)
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.parent = rig
    obj['rig_bone'] = 'head'
    obj['state'] = 'Art-directed static burst; not a fluid simulation'
    group = obj.vertex_groups.new(name='head')
    group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    mod = obj.modifiers.new('Rigid_Articulation', 'ARMATURE')
    mod.object = rig
    return obj

def mesh_object(name, verts, faces, material, thickness=0):
    mesh = bpy.data.meshes.new(name + '_Mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    character.objects.link(obj)
    if thickness:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        mod = obj.modifiers.new('Actual_Film_Thickness', 'SOLIDIFY')
        mod.thickness = thickness
        mod.offset = 0
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(obj, name, material)

def strand(name, points, radius, material, radii=None):
    data = bpy.data.curves.new(name + '_Curve', 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 2
    data.bevel_depth = radius
    data.bevel_resolution = 1
    data.use_fill_caps = True
    spline = data.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for i, point in enumerate(points):
        spline.points[i].co = (*point, 1)
        if radii is not None:
            spline.points[i].radius = radii[i]
    obj = bpy.data.objects.new(name, data)
    character.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return finish(bpy.context.object, name, material)

# Eight disjoint membrane petals curl away from the former ellipsoid. Their
# separated edges and open centers deliberately never reconstruct a closed head.
for petal in range(8):
    angle = 2 * math.pi * petal / 8 + .18
    length = 1.22 + .33 * math.sin(petal * 2.1)
    verts, faces = [], []
    rows, columns = 23, 9
    for i in range(rows):
        t = i / (rows - 1)
        phi = -1.18 + length * t
        width = (.37 + .06 * math.sin(petal)) * (.42 + .58 * math.sin(math.pi * t) ** .7)
        for j in range(columns):
            v = 2 * j / (columns - 1) - 1
            theta = angle + v * width + .14 * math.sin(t * 5 + petal) * t
            flare = .09 * t * t + .18 * t ** 4
            x = (rx * math.cos(phi) + flare) * math.cos(theta) + .19 * t ** 3
            y = (ry * math.cos(phi) + flare * .72) * math.sin(theta)
            z = center.z + rz * math.sin(phi) + .08 * t ** 2 + .035 * v * math.sin(t * 7 + petal)
            y += .055 * math.sin(t * 7 + v * 2 + petal) * t ** 2
            verts.append((x, y, z))
    for i in range(rows - 1):
        for j in range(columns - 1):
            a = i * columns + j
            faces.append((a, a + 1, a + columns + 1, a + columns))
    obj = mesh_object('Balloon_Latex' if petal == 0 else 'Latex_Curled_Petal_%02d' % petal, verts, faces, latex, .003)

# One airborne ribbon carries the original tied neck and pleated knot above.
verts, faces = [], []
for i in range(25):
    t = i / 24
    for side in [-1, 1]:
        width = .055 * math.sin(math.pi * (.08 + .88 * t))
        verts.append((.11 + .27 * t + side * width, .045 + .06 * math.sin(t * 4) + side * .015, 2.67 + .25 * t + .045 * math.sin(t * 7)))
for i in range(24):
    a = i * 2
    faces.append((a, a + 1, a + 3, a + 2))
mesh_object('Latex_Flying_Knot_Ribbon', verts, faces, latex, .0025)
for name in ['Balloon_Tied_Neck', 'Balloon_Knot', 'Balloon_Pleated_Tie']:
    obj = bpy.data.objects.get(name)
    if obj:
        # Source tie spans z2.746..2.884; the detached piece remains above.
        obj.location += Vector((.37, .055, .13))

# Additional broad, curled flying shreds at the outer edge of the water fan.
for fragment, base in enumerate([(0.81, -.01, 2.93), (.62, .12, 2.25), (-.36, -.04, 2.46)]):
    verts, faces = [], []
    for i in range(15):
        t = i / 14
        for j in range(5):
            v = j / 4 * 2 - 1
            width = .048 * math.sin(math.pi * (.08 + .88 * t))
            verts.append((base[0] + .16 * t + v * width, base[1] + .055 * math.sin(t * 5) + v * .01, base[2] + .13 * t + .055 * math.sin(t * 6) + .02 * v))
    for i in range(14):
        for j in range(4):
            a = i * 5 + j
            faces.append((a, a + 1, a + 6, a + 5))
    mesh_object('Latex_Airborne_Shred_%02d' % fragment, verts, faces, latex, .0025)

# The main splash is a broad corrugated, perforated liquid sheet rather than a
# cloud of spheres. The lobed outer edge expands diagonally toward +X and +Z.
holes = [(.29, -.22, .055, .17), (.47, .37, .065, .17), (.62, -.25, .065, .15), (.76, .38, .058, .18), (.84, -.43, .045, .15)]
def sheet_point(u, v):
    width = .10 + .34 * u ** .7
    lobe = 1 + .12 * math.sin(u * 24) + .055 * math.sin(u * 51 + 1)
    x = -.14 + 1.04 * u + .028 * math.sin(v * 10 + u * 9) * u
    y = -.025 + .064 * math.sin(u * 12 + v * 4) + .025 * math.sin(v * 19) * u
    z = center.z + .40 * u + v * width * lobe + .027 * math.sin(u * 29 + v * 8) * u
    return (x, y, z)

nu, nv = 69, 43
verts = [sheet_point(i / (nu - 1), 2 * j / (nv - 1) - 1) for i in range(nu) for j in range(nv)]
faces = []
for i in range(nu - 1):
    for j in range(nv - 1):
        u, v = (i + .5) / (nu - 1), 2 * (j + .5) / (nv - 1) - 1
        if any(((u - hu) / ru) ** 2 + ((v - hv) / rv) ** 2 < 1 for hu, hv, ru, rv in holes):
            continue
        a = i * nv + j
        faces.append((a, a + nv, a + nv + 1, a + 1))
sheet = mesh_object('Water_Contained', verts, faces, water, .005)
sheet['state'] = 'Open perforated water sheet, no intact contained volume'
for edge in [-1, 1]:
    points = [sheet_point(i / 62, edge) for i in range(63)]
    strand('Splash_Thickened_Outer_Lip_' + str(edge), points, .0065, water,
           [.65 + .38 * math.sin(i / 62 * math.pi) for i in range(63)])
for index, (hu, hv, ru, rv) in enumerate(holes):
    points = [sheet_point(hu + ru * math.cos(a), hv + rv * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 49)]
    strand('Splash_Perforation_Rim_%02d' % index, points, .0035, water)

# A second lifted curtain curves out of the lower head, creating depth and a
# visible liquid fold behind the membrane petals instead of a planar splash.
verts, faces = [], []
for i in range(39):
    u = i / 38
    for j in range(15):
        v = j / 14 * 2 - 1
        x = -.20 + .90 * u + .055 * math.sin(u * 9 + v * 2)
        y = .10 + .18 * math.sin(math.pi * u) + .05 * v * math.sin(u * 8)
        z = 2.20 + .32 * u + .10 * math.sin(u * 7) + v * (.08 + .09 * u)
        verts.append((x, y, z))
for i in range(38):
    for j in range(14):
        a = i * 15 + j
        faces.append((a, a + 1, a + 16, a + 15))
mesh_object('Splash_Lifted_Liquid_Curtain', verts, faces, water, .006)

# Trailing filaments curve away from the perforated sheet. Each narrows into a
# bead; a separate low arc flows toward the shoulder without hiding the body.
for index in range(13):
    angle = -1.17 + index / 12 * 2.25
    origin = Vector((.04, -.005, 2.39))
    length = .48 + .48 * ((index * 7) % 13) / 12
    points = []
    for k in range(35):
        t = k / 34
        points.append(tuple(origin + Vector((length * t, .11 * math.sin(t * 3.7 + index) * t, length * math.sin(angle) * t + .15 * math.sin(t * math.pi) - .13 * t * t))))
    strand('Splash_Tapered_Filament_%02d' % index, points, .0068, water,
           [1.2 - .85 * (k / 34) for k in range(35)])

for index in range(96):
    # Concentrate the large drops close to the sheet; scatter smaller satellites
    # over its diagonal trajectory, keeping the wood silhouette easy to inspect.
    t = float(rng.uniform(.10, 1))
    angle = float(rng.uniform(-1.15, 1.22))
    x = -.12 + 1.26 * t
    y = float(rng.uniform(-.28, .31)) * (.45 + t)
    z = center.z + .35 * t + math.sin(angle) * (.20 + .43 * t) - .11 * t * t
    radius = float(rng.uniform(.008, .025)) * (1.12 - .45 * t)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, location=(x, y, z))
    obj = bpy.context.object
    obj.scale = (radius * (1.25 + t), radius * .8, radius * (1.06 + .65 * t))
    obj.rotation_euler.y = -.55
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, 'Splash_Projected_Drop_%03d' % index, water)

scene['authoring_note'] = 'W3-inspired artistic static burst. Original mannequin body, skeleton and pose preserved. No physical simulation or runtime integration.'
scene['burst_direction'] = '+X with an upward diagonal in Blender Z-up space'
scene.render.resolution_x = 1120
scene.render.resolution_y = 1400
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = str(OUT / 'water-mannequin-burst-preview.png')
scene.camera.data.ortho_scale = 3.72
target = Vector((.11, 0, 1.61))
scene.camera.rotation_euler = (target - scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 12
scene.cycles.transmission_bounces = 10
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type != 'CPU'
    if any(device.use for device in prefs.devices):
        scene.cycles.device = 'GPU'
except Exception as exc:
    print('WD_BURST_GPU_FALLBACK', str(exc), flush=True)

def export_glb():
    temp = bpy.data.collections.new('WD_Burst_Export_Temporary')
    scene.collection.children.link(temp)
    originals = [obj for obj in character.objects if obj.type == 'MESH']
    reserved = {}
    for name in ['Balloon_Latex', 'Water_Contained']:
        obj = bpy.data.objects.get(name)
        if obj:
            reserved[name] = obj
            obj.name = '__WD_Source_' + name
    groups, merged = {}, []
    for obj in originals:
        dup = obj.copy()
        dup.data = obj.data.copy()
        temp.objects.link(dup)
        groups.setdefault(obj.data.materials[0].name, []).append(dup)
    for matname, objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = 'Balloon_Latex' if matname == latex.name else 'Water_Contained' if matname == water.name else 'WD_' + matname
        merged.append(obj)
    triangles = sum(sum(len(p.vertices) - 2 for p in obj.data.polygons) for obj in merged)
    assert len(merged) <= 15, 'Burst exceeds mesh budget: ' + str(len(merged))
    assert triangles <= 90000, 'Burst exceeds triangle budget: ' + str(triangles)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in merged + [rig]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'water-mannequin-burst.glb'), export_format='GLB', use_selection=True, export_yup=True,
                             export_apply=False, export_animations=False, export_skins=True, export_texcoords=True, export_normals=True,
                             export_materials='EXPORT', export_extras=True, export_cameras=False, export_lights=False)
    for obj in list(temp.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data.users == 0:
            bpy.data.meshes.remove(data)
    bpy.data.collections.remove(temp)
    for name, obj in reserved.items():
        obj.name = name
    print('WD_BURST_GEOMETRY', json.dumps({'meshes': len(merged), 'triangles': triangles, 'bones': len(rig.data.bones), 'static_artistic_state': True}), flush=True)

export_glb()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'water-mannequin-burst.blend'))
print('WD_BURST_ASSET_SAVED', flush=True)
bpy.ops.render.render(write_still=True)
print('WD_BURST_COMPLETE', flush=True)
