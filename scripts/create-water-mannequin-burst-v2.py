"""Build the W3-inspired static rupture variant from the posed v2 source.

New geometry is authored in the source skeleton's original bind coordinates,
then rigidly weighted to head. No pose is reset or baked into the source meshes.
This is an art-directed frozen instant, not a physical water/latex simulation.
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/assets/characters/v2'
OUT = ROOT / 'public/assets/characters/water-mannequin/v2'
bpy.ops.wm.open_mainfile(filepath=str(SOURCE / 'water-mannequin.blend'))
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
character = bpy.data.collections['WaterDuel_Character']
rig = bpy.data.objects['WD_Mannequin_Rig']
center = Vector((0, 0, 2.405))
rng = np.random.default_rng(7332)
assert 'head' in rig.data.bones, 'Expected original head bone'
original_pose = {bone.name: tuple(tuple(row) for row in bone.matrix_basis) for bone in rig.pose.bones}

for obj in list(character.objects):
    if obj.name in {'Balloon_Latex', 'Water_Contained', 'Water_Meniscus_Rim', 'Water_Surface_Crest'} or obj.name.startswith(('Water_Air_Bubble_', 'Fine_Air_Bubble_')):
        bpy.data.objects.remove(obj, do_unlink=True)
latex = bpy.data.materials['Mint_Latex_Transmission']
water = bpy.data.materials['Water_IOR_1.333']
latex.name = 'Amber_Elastic_Torn_Latex'
lbs = latex.node_tree.nodes['Principled BSDF']
lbs.inputs['Base Color'].default_value = (1, .095, .0025, 1)
lbs.inputs['Transmission Weight'].default_value = .14
lbs.inputs['Roughness'].default_value = .22
lbs.inputs['Coat Weight'].default_value = .07
if 'Specular IOR Level' in lbs.inputs:
    lbs.inputs['Specular IOR Level'].default_value = .32
latex.diffuse_color = (1, .095, .0025, 1)
absorption = latex.node_tree.nodes.get('Volume Absorption')
if absorption:
    absorption.inputs['Color'].default_value = (1, .12, .002, 1)
    absorption.inputs['Density'].default_value = 55
wbs = water.node_tree.nodes['Principled BSDF']
wbs.inputs['Base Color'].default_value = (.955, .985, 1, 1)
wbs.inputs['Transmission Weight'].default_value = 1
wbs.inputs['Roughness'].default_value = .045
water.diffuse_color = (.955, .985, 1, 1)
absorption = water.node_tree.nodes.get('Volume Absorption')
if absorption:
    absorption.inputs['Color'].default_value = (.84, .96, 1, 1)
    absorption.inputs['Density'].default_value = .025
for material, thickness in [(latex, .0012), (water, .018)]:
    for node in material.node_tree.nodes:
        if node.type == 'GROUP' and 'Thickness' in node.inputs:
            node.inputs['Thickness'].default_value = thickness
cloth = bpy.data.materials.get('Mint_Woven_Sash')
if cloth:
    cloth.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.25, .018, .006, 1)

def finish(obj, name, material):
    obj.name = name
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    character.objects.link(obj)
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    # Geometry and transforms are bind coordinates in rig local space. The
    # unchanged pose's head deformation is therefore applied exactly once.
    obj.parent = rig
    obj['rig_bone'] = 'head'
    obj['state'] = 'Art-directed static rupture v2, no fluid simulation'
    group = obj.vertex_groups.new(name='head')
    group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    modifier = obj.modifiers.new('Rigid_Articulation', 'ARMATURE')
    modifier.object = rig
    return obj

def mesh_object(name, vertices, faces, material, thickness=0):
    mesh = bpy.data.meshes.new(name + '_Mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    character.objects.link(obj)
    if thickness:
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new('Thin_Elastic_Film', 'SOLIDIFY')
        modifier.thickness = thickness
        modifier.offset = 0
        bpy.ops.object.modifier_apply(modifier=modifier.name)
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
    for index, point in enumerate(points):
        spline.points[index].co = (*point, 1)
        if radii is not None:
            spline.points[index].radius = radii[index]
    obj = bpy.data.objects.new(name, data)
    character.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return finish(bpy.context.object, name, material)

def catmull(controls, t):
    vectors = [Vector(point) for point in controls]
    u = min(t * (len(vectors) - 1), len(vectors) - 1 - 1e-7)
    index, f = int(u), u - int(u)
    p0, p1 = vectors[max(0, index - 1)], vectors[index]
    p2, p3 = vectors[index + 1], vectors[min(len(vectors) - 1, index + 2)]
    return .5 * ((2 * p1) + (-p0 + p2) * f + (2*p0 - 5*p1 + 4*p2 - p3) * f*f + (-p0 + 3*p1 - 3*p2 + p3) * f*f*f)

def rubber_strip(name, controls, width, twist, phase):
    # A flexible centerline plus a rolled cross section makes a thin rubber
    # ribbon. No radial petals or rigid cup-shaped shell are retained.
    width *= .77
    vertices, faces = [], []
    rows, columns = 53, 17
    for i in range(rows):
        t = i / (rows - 1)
        position = center + catmull(controls, t)
        tangent = (catmull(controls, min(1, t+.001)) - catmull(controls, max(0, t-.001))).normalized()
        side = tangent.cross(Vector((0, -1, .12))).normalized()
        normal = side.cross(tangent).normalized()
        rotation = twist * math.sin(t * math.pi) + .30 * math.sin(t * 6 + phase)
        side, normal = side * math.cos(rotation) + normal * math.sin(rotation), normal * math.cos(rotation) - side * math.sin(rotation)
        half_width = width * (.30 + .70 * math.sin(math.pi * (.06 + .88*t)) ** .55)
        for j in range(columns):
            v = 2*j/(columns-1)-1
            across = v * half_width
            fold = .009 * math.sin(v * 5 + t * 10 + phase) + .014 * (v*v-.35) * math.sin(t*7+phase)
            if abs(v) > .72:
                a = (abs(v)-.72)/.28 * math.pi * 1.55
                radius = min(.016, half_width*.20)
                across = math.copysign(.72 * half_width + radius * math.sin(a), v)
                fold += radius * (1-math.cos(a))
            p = position + side * across + normal * fold
            vertices.append(tuple(p))
    for i in range(rows-1):
        for j in range(columns-1):
            a = i*columns+j
            faces.append((a, a+1, a+columns+1, a+columns))
    return mesh_object(name, vertices, faces, latex, .0012)

rubber_strip('Balloon_Latex', [(-.02,.04,-.30),(-.24,-.10,-.18),(-.33,-.12,.02),(-.24,-.01,.20),(-.08,.06,.28)], .145, .85, .3)
rubber_strip('Latex_Long_Recoiling_Strip', [(-.02,.06,-.29),(.14,-.11,-.19),(.32,-.10,-.08),(.47,-.06,.06),(.52,.01,.21)], .115, -.65, 1.7)
rubber_strip('Latex_Soft_Back_Fold', [(-.19,.12,-.06),(-.31,.16,.12),(-.18,.13,.31),(.02,.10,.22),(.15,.04,.36)], .083, -.85, 2.8)
rubber_strip('Latex_Airborne_Knot_Strip', [(.40,.10,.25),(.48,.08,.38),(.60,.04,.46),(.66,.07,.61),(.56,.06,.70)], .054, 1.1, .7)
for name in ['Balloon_Tied_Neck', 'Balloon_Knot', 'Balloon_Pleated_Tie']:
    obj = bpy.data.objects.get(name)
    if obj:
        # Existing tie is already weighted to head, so this offset is bind-space.
        obj.location += Vector((.56, .06, .23))

# Two folded water leaves overlap at the source of the jet. Their perforations
# and thickened irregular borders remain joined by real curved liquid ligaments.
holes = [(.30,-.18,.055,.14),(.49,.31,.070,.17),(.67,-.25,.065,.17),(.82,.18,.046,.15)]
def leaf_point(u, v):
    width = .075 + .29 * math.sin(math.pi*(.11+.78*u)) ** .7
    scallop = 1 + .10 * math.sin(u*11+.4) + .035 * math.sin(u*23)
    return (-.12+.93*u+.026*math.sin(v*8+u*5)*u,
            -.025+.076*math.sin(u*5+v*3)+.020*math.sin(v*11+u*7)*u,
            center.z+.02+.30*u+v*width*scallop+.020*math.sin(u*9+v*4))

nu, nv = 67, 41
vertices = [leaf_point(i/(nu-1),2*j/(nv-1)-1) for i in range(nu) for j in range(nv)]
faces = []
for i in range(nu-1):
    for j in range(nv-1):
        u, v = (i+.5)/(nu-1),2*(j+.5)/(nv-1)-1
        if any(((u-hu)/ru)**2+((v-hv)/rv)**2 < 1 for hu,hv,ru,rv in holes):
            continue
        a = i*nv+j
        faces.append((a,a+nv,a+nv+1,a+1))
mesh_object('Water_Contained', vertices, faces, water, .0045)
for sign in [-1,1]:
    points = [leaf_point(i/58,sign) for i in range(59)]
    strand('Water_Curled_Leaf_Lip_'+str(sign),points,.0065,water,[.65+.5*math.sin(i/58*math.pi) for i in range(59)])
for index,(hu,hv,ru,rv) in enumerate(holes):
    points = [leaf_point(hu+ru*math.cos(a),hv+rv*math.sin(a)) for a in np.linspace(0,2*math.pi,45)]
    strand('Water_Perforated_Film_Rim_%02d'%index,points,.0034,water)

vertices, faces = [], []
for i in range(43):
    u=i/42
    for j in range(17):
        v=2*j/16-1
        vertices.append((-.23+.87*u+.052*math.sin(u*6+v),
                         .07+.21*math.sin(math.pi*u)+v*.032*math.sin(u*5),
                         2.18+.27*u+.065*math.sin(u*6)+v*(.075+.065*math.sin(u*math.pi))))
for i in range(42):
    for j in range(16):
        a=i*17+j
        faces.append((a,a+1,a+18,a+17))
mesh_object('Water_Folded_Lower_Leaf',vertices,faces,water,.005)

def drop(name, point, radius, elongation=1, direction=(1,0,.4), detailed=False):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16 if detailed else 12,ring_count=10 if detailed else 8,location=point)
    obj=bpy.context.object
    # A rounded pear variation rather than uniformly stretched bead geometry.
    for vertex in obj.data.vertices:
        taper=1-.16*max(0,vertex.co.z)
        vertex.co.x*=taper
        vertex.co.y*=taper
    obj.scale=(radius,radius*.88,radius*elongation)
    obj.rotation_mode='QUATERNION'
    obj.rotation_quaternion=Vector(direction).to_track_quat('Z','Y')
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(obj,name,water)

for index in range(10):
    u=.23+.058*index
    sign=-1 if index%2 else 1
    start=Vector(leaf_point(u,sign))
    length=.20+.15*((index*7)%10)/9
    controls=[start,
              start+Vector((length*.18,.075*math.sin(index),sign*.11)),
              start+Vector((length*.65,.13*math.sin(index+.6),sign*.12+.035)),
              start+Vector((length,.06*math.sin(index+1),sign*.055-.065))]
    points=[tuple(catmull(controls,k/38)) for k in range(39)]
    strand('Water_Curved_Ligament_%02d'%index,points,.0085,water,[1.22-.74*(k/38)+.13*math.sin(k/38*math.pi*3) for k in range(39)])
    drop('Water_Ligament_Terminal_Bead_%02d'%index,points[-1],.011+index%3*.003,1.18,(.7,.1,-.2))

for index in range(86):
    t=float(rng.uniform(.09,1))
    angle=float(rng.uniform(-1.05,1.15))
    point=(-.14+1.18*t,float(rng.uniform(-.27,.31))*(.50+t),center.z+.23*t+math.sin(angle)*(.16+.39*t)-.08*t*t)
    if index<6:
        radius=float(rng.uniform(.026,.038));elongation=float(rng.uniform(1.05,1.35))
    elif index<29:
        radius=float(rng.uniform(.013,.024));elongation=float(rng.uniform(1.05,1.8))
    else:
        radius=float(rng.uniform(.005,.013));elongation=float(rng.uniform(1.0,2.0))
    drop('Water_Ballistic_Drop_%03d'%index,point,radius,elongation,(.7,float(rng.uniform(-.25,.25)),.3+math.sin(angle)),index<6)

bpy.context.view_layer.update()
assert original_pose == {bone.name: tuple(tuple(row) for row in bone.matrix_basis) for bone in rig.pose.bones}, 'Source pose was modified'
scene['authoring_note']='W3-inspired v2: thin elastic amber strips, rolled lips, folded liquid leaves and curved ligaments. Frozen artistic state, not physics. Source combat pose, rig and sockets preserved.'
scene.render.resolution_x=1500
scene.render.resolution_y=1150
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.image_settings.color_mode='RGBA'
scene.render.filepath=str(OUT/'water-mannequin-burst-preview.png')
# Fit the actual deformed pose and spray in the existing studio's camera angle.
depsgraph=bpy.context.evaluated_depsgraph_get()
corners=[]
for obj in character.objects:
    if obj.type=='MESH' and not obj.hide_render:
        evaluated=obj.evaluated_get(depsgraph)
        corners.extend(evaluated.matrix_world@Vector(corner) for corner in evaluated.bound_box)
camera=scene.camera
rotation=camera.rotation_euler.to_matrix()
right,up,back=(rotation@Vector(axis) for axis in [(1,0,0),(0,1,0),(0,0,1)])
projected=[[point.dot(axis) for point in corners] for axis in [right,up,back]]
middle=[(min(values)+max(values))/2 for values in projected]
target=right*middle[0]+up*middle[1]+back*middle[2]
camera.location=target+back*8
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'
aspect=scene.render.resolution_x/scene.render.resolution_y
span_x=max(projected[0])-min(projected[0])
span_y=max(projected[1])-min(projected[1])
camera.data.ortho_scale=(max(span_x,span_y*aspect) if aspect>=1 else max(span_y,span_x/aspect))*1.12
scene.render.engine='CYCLES'
scene.cycles.samples=56
scene.cycles.use_denoising=True
scene.cycles.max_bounces=12
scene.cycles.transmission_bounces=10
# White photographic panels behind and beside the spray broaden the real
# reflected/transmitted highlights. The water remains non-emissive.
studio=bpy.data.collections.get('Presentation_Only') or scene.collection
head_deformation=rig.matrix_world@rig.pose.bones['head'].matrix@rig.data.bones['head'].matrix_local.inverted()
head_world=head_deformation@center
for name,offset,energy,size,size_y in [
    ('Burst_White_Back_Softbox',(1.15,1.85,1.05),1050,2.0,2.7),
    ('Burst_White_Side_Strip',(-1.65,.55,.65),520,.8,2.1),
]:
    data=bpy.data.lights.new(name,'AREA')
    data.energy=energy
    data.color=(1,1,1)
    data.shape='RECTANGLE'
    data.size=size
    data.size_y=size_y
    light=bpy.data.objects.new(name,data)
    studio.objects.link(light)
    light.location=head_world+Vector(offset)
    light.rotation_euler=(head_world-light.location).to_track_quat('-Z','Y').to_euler()
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='OPTIX'
    prefs.get_devices()
    for device in prefs.devices:
        device.use=device.type!='CPU'
    if any(device.use for device in prefs.devices):
        scene.cycles.device='GPU'
except Exception as exc:
    print('WD_BURST_V2_GPU_FALLBACK',str(exc),flush=True)

def export_glb():
    temp=bpy.data.collections.new('WD_Burst_V2_Export_Temporary')
    scene.collection.children.link(temp)
    originals=[obj for obj in character.objects if obj.type=='MESH']
    sockets=[obj for obj in character.objects if obj.name.startswith('Socket_')]
    reserved={}
    for name in ['Balloon_Latex','Water_Contained']:
        obj=bpy.data.objects.get(name)
        if obj:
            reserved[name]=obj
            obj.name='__WD_Source_'+name
    groups,merged={},[]
    for obj in originals:
        duplicate=obj.copy()
        duplicate.data=obj.data.copy()
        temp.objects.link(duplicate)
        optional=obj.name.startswith(('Rapier_','Leather_Grip_Wrap_','Preview_Rapier_')) or bool(obj.get('optional_preview_equipment'))
        groups.setdefault((obj.data.materials[0].name,optional),[]).append(duplicate)
    for (material,optional),objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        bpy.ops.object.join()
        obj=bpy.context.object
        obj.name='Balloon_Latex' if material==latex.name else 'Water_Contained' if material==water.name else ('Preview_Rapier_' if optional else 'WD_')+material
        if optional:
            obj['optional_preview_equipment']=True
        merged.append(obj)
    triangles=sum(sum(len(p.vertices)-2 for p in obj.data.polygons) for obj in merged)
    assert len(merged)<=19,'Burst v2 exceeds mesh budget: '+str(len(merged))
    assert triangles<=110000,'Burst v2 exceeds triangle budget: '+str(triangles)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in merged+[rig]+sockets:
        obj.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=str(OUT/'water-mannequin-burst.glb'),export_format='GLB',use_selection=True,export_yup=True,
                             export_apply=False,export_animations=False,export_skins=True,export_texcoords=True,export_normals=True,
                             export_rest_position_armature=False,export_current_frame=True,
                             export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
    for obj in list(temp.objects):
        data=obj.data
        bpy.data.objects.remove(obj,do_unlink=True)
        if data.users==0:
            bpy.data.meshes.remove(data)
    bpy.data.collections.remove(temp)
    for name,obj in reserved.items():
        obj.name=name
    print('WD_BURST_V2_GEOMETRY',json.dumps({'meshes':len(merged),'triangles':triangles,'bones':len(rig.data.bones),'sockets':len(sockets),'static_artistic_state':True}),flush=True)

export_glb()
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'water-mannequin-burst.blend'))
print('WD_BURST_V2_ASSET_SAVED',flush=True)
bpy.ops.render.render(write_still=True)
print('WD_BURST_V2_COMPLETE',flush=True)
