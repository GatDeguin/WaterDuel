"""Author the WaterDuel reference mannequin in Blender; no external dependencies.

Run: blender --background --factory-startup --python scripts/create-water-mannequin.py
Source Z-up, facing -Y; glTF export converts to Y-up, facing +Z.
"""
import bpy
import math
import json
import os
import sys
from pathlib import Path
from mathutils import Vector
import numpy as np
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/characters/water-mannequin'
SOURCE = ROOT / 'docs/assets/characters'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for collection in list(bpy.data.collections):
    if collection.name != 'Collection':
        bpy.data.collections.remove(collection)
scene = bpy.context.scene
character = bpy.data.collections.new('WaterDuel_Character')
scene.collection.children.link(character)
studio = bpy.data.collections.new('Presentation_Only')
scene.collection.children.link(studio)
parts = []
sockets = []
SKIP_RENDERS = '--no-render' in sys.argv

def move_to(obj, collection=character):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)

def material(name, color, roughness=.35, metallic=0, transmission=0, ior=1.45):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bs = mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Metallic'].default_value = metallic
    bs.inputs['Transmission Weight'].default_value = transmission
    bs.inputs['IOR'].default_value = ior
    return mat

wood = material('Beech_Wood_Grain', (.65,.43,.22), .42)
rng = np.random.default_rng(1801)
height, width = 1024, 512
y, x = np.mgrid[0:height,0:width].astype(np.float32)
u, v = x / width, y / height
warp = u + .014*np.sin(v*13) + .006*np.sin(v*34+u*8)
grain = .012*np.sin(warp*410 + np.sin(v*10)*2)
grain += .006*np.sin(warp*1140 + v*3) + rng.normal(0,.003,(height,width))
grain -= .024*np.maximum(0,np.sin(warp*190+v*2))**20
rgba = np.ones((height,width,4),dtype=np.float32)
for i, base in enumerate((.79,.625,.407)):
    rgba[:,:,i] = np.clip(base+grain,0,1)
texture = bpy.data.images.new('Beech_Grain_512x1024', width, height)
texture.pixels.foreach_set(rgba.ravel())
texture.filepath_raw = str(SOURCE/'beech-grain.png')
texture.file_format = 'PNG'
texture.save()
texture.pack()
texnode = wood.node_tree.nodes.new('ShaderNodeTexImage')
texnode.image = texture
wood.node_tree.links.new(texnode.outputs['Color'],wood.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
jointwood = material('Endgrain_Joints',(.36,.22,.105),.4)
brass = material('Satin_Brass',(.56,.32,.095),.24,.82)
dark = material('Recessed_Steel',(.035,.045,.044),.25,.8)
steel = material('Polished_Rapier_Steel',(.58,.68,.7),.16,.95)
leather = material('Wrapped_Brown_Leather',(.105,.036,.016),.46)
cloth = material('Mint_Woven_Sash',(.012,.20,.17),.65)
latex = material('Mint_Latex_Transmission',(.78,.98,.91),.055,0,.97,1.42)
water = material('Water_IOR_1.333',(.68,.95,.90),.018,0,1,1.333)
for mat, depth, tint in [(latex,.008,(.08,.68,.49)),(water,.70,(.30,.87,.74))]:
    bs=mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Coat Weight'].default_value = .06 if mat==latex else 0
    bs.inputs['Coat Roughness'].default_value = .08
    volume=mat.node_tree.nodes.new('ShaderNodeVolumeAbsorption')
    volume.inputs['Color'].default_value=(*tint,1)
    volume.inputs['Density'].default_value=35 if mat==latex else .3
    mat.node_tree.links.new(volume.outputs['Volume'],mat.node_tree.nodes.get('Material Output').inputs['Volume'])
    # Blender's glTF material extension node carries actual shell thickness.
    group=bpy.data.node_groups.new('glTF Material Output '+mat.name,'ShaderNodeTree')
    # The 5.2 exporter checks Occlusion before choosing its inline shader path.
    # Keep this official group socket so that disconnected Thickness survives.
    group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
    group.interface.new_socket(name='Thickness',in_out='INPUT',socket_type='NodeSocketFloat')
    group.nodes.new('NodeGroupInput');group.nodes.new('NodeGroupOutput')
    gn=mat.node_tree.nodes.new('ShaderNodeGroup'); gn.node_tree=group
    gn.label='glTF Material Output'; gn.name='glTF Material Output'
    gn.inputs['Thickness'].default_value=depth

def finish(obj, name, mat, bone=None):
    obj.name=name
    move_to(obj)
    if mat: obj.data.materials.append(mat)
    if obj.type=='MESH':
        for p in obj.data.polygons: p.use_smooth=True
    if bone:
        obj['rig_bone']=bone
        parts.append(obj)
    return obj

def sphere(name, pos, scale, mat, bone, segments=24, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=pos)
    obj=bpy.context.object; obj.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(obj,name,mat,bone)

def lathe(name, profile, pos, mat, bone, segments=32, aspect=1):
    verts=[]; faces=[]
    for radius,z in profile:
        for j in range(segments):
            angle=2*math.pi*j/segments
            verts.append((radius*math.cos(angle),radius*math.sin(angle)*aspect,z))
    for i in range(len(profile)-1):
        for j in range(segments):
            a=i*segments+j; b=i*segments+(j+1)%segments
            faces.append((a,b,b+segments,a+segments))
    faces.extend([tuple(reversed(range(segments))), tuple((len(profile)-1)*segments+j for j in range(segments))])
    mesh=bpy.data.meshes.new(name+'_Mesh');mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh); character.objects.link(obj);obj.location=pos
    uv=mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi=mesh.loops[li].vertex_index
            uu=(vi%segments)/segments
            if poly.index<(len(profile)-1)*segments and poly.index%segments==segments-1 and vi%segments==0: uu=1
            uv.data[li].uv=(uu, (vi//segments)/(len(profile)-1))
    return finish(obj,name,mat,bone)

def rod(name, a, b, radius, mat, bone, r2=None, vertices=20):
    a,b=Vector(a),Vector(b); direction=b-a
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=radius if r2 is None else r2,depth=direction.length,location=(a+b)/2)
    obj=bpy.context.object;obj.rotation_mode='QUATERNION';obj.rotation_quaternion=direction.to_track_quat('Z','Y')
    return finish(obj,name,mat,bone)

def torus(name,pos,major,minor,mat,bone,axis='Z'):
    bpy.ops.mesh.primitive_torus_add(major_segments=40,minor_segments=8,location=pos,major_radius=major,minor_radius=minor)
    obj=bpy.context.object
    if axis=='Y':obj.rotation_euler.x=math.pi/2
    return finish(obj,name,mat,bone)

def box(name,pos,scale,mat,bone,bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos)
    obj=bpy.context.object;obj.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=obj.modifiers.new('Soft_Crafted_Edges','BEVEL');mod.width=bevel;mod.segments=3
        bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=obj.modifiers.new('Weighted_Corner_Normals','WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(obj,name,mat,bone)

def link(name,a,b,radius,bone):
    a,b=Vector(a),Vector(b); d=b-a; length=d.length
    profile=[(.001,0),(radius*.68,length*.035),(radius*.9,length*.12),(radius,length*.34),(radius*.9,length*.70),(radius*.65,length*.94),(.001,length)]
    obj=lathe(name,profile,a,wood,bone,24,.85)
    obj.rotation_mode='QUATERNION';obj.rotation_quaternion=d.to_track_quat('Z','Y')
    return obj

def hinge(name,pos,radius,bone):
    sphere(name+'_Core',pos,(radius,radius*.8,radius),jointwood,bone)
    x,y,z=pos
    rod(name+'_Axle',(x,y-.105,z),(x,y+.09,z),radius*.48,dark,bone)
    rod(name+'_Brass_Cap',(x,y-.116,z),(x,y-.102,z),radius*.82,brass,bone)
    rod(name+'_Inset',(x,y-.124,z),(x,y-.117,z),radius*.36,dark,bone)
    rod(name+'_Pin',(x,y-.127,z),(x,y-.124,z),radius*.18,brass,bone)

# Rounded artist's mannequin silhouette from the attached photograph.
lathe('Torso_Rounded_Beech',[(.11,0),(.145,.025),(.174,.17),(.235,.40),(.23,.47),(.17,.50)],(0,0,1.48),wood,'chest',40,.69)
sphere('Waist_Ball',(0,0,1.445),(.112,.09,.10),jointwood,'spine')
lathe('Pelvis_Beech',[(.13,0),(.17,.035),(.18,.13),(.15,.225),(.11,.245)],(0,0,1.19),wood,'pelvis',32,.72)
rod('Neck_Wooden_Peg',(0,0,1.96),(0,0,2.105),.075,wood,'neck')
torus('Neck_Brass_Collar',(0,0,2.035),.084,.012,brass,'neck')

hipL=(-.11,0,1.19); kneeL=(-.16,-.005,.665); ankleL=(-.24,-.015,.115)
hipR=(.11,0,1.19); kneeR=(.18,.02,.665); ankleR=(.25,.005,.115)
shoulderL=(-.275,0,1.90); elbowL=(-.76,-.015,1.88); wristL=(-.84,-.025,2.34)
shoulderR=(.275,0,1.90); elbowR=(.385,-.025,1.43); wristR=(-.035,-.20,1.38)
bones={
    'root':((0,0,0),(0,0,.20),None),
    'pelvis':((0,0,1.19),(0,0,1.40),'root'),
    'spine':((0,0,1.40),(0,0,1.60),'pelvis'),
    'chest':((0,0,1.60),(0,0,1.95),'spine'),
    'neck':((0,0,1.95),(0,0,2.10),'chest'),
    'head':((0,0,2.10),(0,0,2.72),'neck'),
    'upper_arm.L':(shoulderL,elbowL,'chest'),
    'forearm.L':(elbowL,wristL,'upper_arm.L'),
    'hand.L':(wristL,(-1.025,-.025,2.43),'forearm.L'),
    'upper_arm.R':(shoulderR,elbowR,'chest'),
    'forearm.R':(elbowR,wristR,'upper_arm.R'),
    'hand.R':(wristR,(-.195,-.21,1.27),'forearm.R'),
    'thigh.L':(hipL,kneeL,'pelvis'),'shin.L':(kneeL,ankleL,'thigh.L'),
    'foot.L':(ankleL,(-.24,-.19,.065),'shin.L'),
    'thigh.R':(hipR,kneeR,'pelvis'),'shin.R':(kneeR,ankleR,'thigh.R'),
    'foot.R':(ankleR,(.25,-.17,.065),'shin.R'),
}
for side,hip,knee,ankle in [('L',hipL,kneeL,ankleL),('R',hipR,kneeR,ankleR)]:
    hinge('Hip_'+side,hip,.079,'thigh.'+side)
    link('Thigh_'+side,Vector(hip)+Vector((0,0,-.03)),Vector(knee)+Vector((0,0,.055)),.099,'thigh.'+side)
    hinge('Knee_'+side,knee,.071,'shin.'+side)
    link('Shin_'+side,Vector(knee)+Vector((0,0,-.05)),Vector(ankle)+Vector((0,0,.035)),.073,'shin.'+side)
    hinge('Ankle_'+side,ankle,.054,'foot.'+side)
    sphere('Foot_'+side,(ankle[0],ankle[1]-.065,.055),(.095,.175,.055),wood,'foot.'+side)
    # W4 brass retaining bands, integrated into the softer wooden silhouette.
    rod('Shin_Band_'+side,(knee[0],knee[1],knee[2]-.12),(knee[0],knee[1],knee[2]-.10),.071,brass,'shin.'+side)

for side,shoulder,elbow,wrist in [('L',shoulderL,elbowL,wristL),('R',shoulderR,elbowR,wristR)]:
    hinge('Shoulder_'+side,shoulder,.10,'upper_arm.'+side)
    a,b=Vector(shoulder),Vector(elbow);d=(b-a).normalized()
    link('Upper_Arm_'+side,a+d*.055,b-d*.07,.080,'upper_arm.'+side)
    hinge('Elbow_'+side,elbow,.072,'forearm.'+side)
    a,b=Vector(elbow),Vector(wrist);d=(b-a).normalized()
    link('Forearm_'+side,a+d*.055,b-d*.045,.071,'forearm.'+side)
    hinge('Wrist_'+side,wrist,.049,'hand.'+side)
    # Brass barrel and polished telescoping rod from W2/W4.
    start=Vector(shoulder)*.76+Vector(elbow)*.24+Vector((0,.085,0))
    end=Vector(elbow)*.25+Vector(wrist)*.75+Vector((0,.085,0))
    mid=start.lerp(end,.53)
    rod('Hydraulic_Barrel_'+side,start,mid,.019,brass,'upper_arm.'+side)
    rod('Hydraulic_Piston_'+side,mid,end,.010,steel,'forearm.'+side)
    sphere('Hydraulic_Anchor_'+side,end,(.027,.027,.027),brass,'forearm.'+side,16,8)
    # Small rounded shoulder plates recall W4 without replacing the mannequin.
    cap=sphere('Shoulder_Guard_'+side,(shoulder[0],.01,shoulder[2]+.052),(.12,.10,.052),brass,'upper_arm.'+side)

handL=link('Open_Mitten_Hand_L',wristL,(-1.025,-.025,2.43),.067,'hand.L')
handL.scale.y=.65
link('Grip_Hand_R',wristR,(-.195,-.21,1.27),.066,'hand.R')
for i in range(3):
    box('Grip_Finger_'+str(i),(-.13+i*.025,-.267,1.315+i*.017),(.022,.033,.062),wood,'hand.R',.009)

# Chest framing, screws, maker's medallion and cloth from the workshop references.
for xx in [-.145,.145]:
    box('Chest_Brass_Edge_'+str(xx),(xx,-.134,1.78),(.018,.016,.30),brass,'chest',.006)
    for zz in [1.665,1.875]:
        rod('Chest_Rivet_'+str(xx)+'_'+str(zz),(xx,-.154,zz),(xx,-.143,zz),.014,brass,'chest',vertices=16)
rod('Chest_Medallion',(0,-.160,1.79),(0,-.140,1.79),.058,brass,'chest',vertices=40)
rod('Medallion_Enamel',(0,-.168,1.79),(0,-.160,1.79),.043,cloth,'chest',vertices=40)
for xx,zz,hh in [(-.018,1.79,.042),(0,1.802,.063),(.018,1.79,.042)]:
    box('Crest_Hydraulic_Bar_'+str(xx),(xx,-.173,zz),(.007,.006,hh),brass,'chest',.002)
box('Waist_Leather_Belt',(0,-.112,1.37),(.28,.035,.065),leather,'pelvis',.012)
box('Belt_Buckle',(0,-.14,1.37),(.075,.022,.055),brass,'pelvis',.009)
verts=[(-.095,-.139,1.32),(.095,-.139,1.32),(.10,-.155,1.05),(.065,-.17,.99),(0,-.16,1.035),(-.09,-.15,1.01)]
mesh=bpy.data.meshes.new('Sash_Mesh');mesh.from_pydata(verts,[],[(0,1,2,3,4,5)]);mesh.update()
obj=bpy.data.objects.new('Workshop_Sash',mesh);character.objects.link(obj)
finish(obj,'Workshop_Sash',cloth,'pelvis')
mod=obj.modifiers.new('Woven_Thickness','SOLIDIFY');mod.thickness=.007
bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)

# Slender rapier with leather grip, brass cup and ring guard: W1/W2.
grip=Vector((-.17,-.235,1.30)); direction=Vector((.88,-.04,.48)).normalized()
handleA=grip-direction*.12; guard=grip+direction*.10; tip=guard+direction*.95
rod('Rapier_Leather_Grip',handleA,guard,.025,leather,'hand.R')
for i in range(8):
    center=handleA.lerp(guard,(i+.5)/8)
    ring=torus('Leather_Grip_Wrap_'+str(i),center,.026,.004,leather,'hand.R')
    ring.rotation_mode='QUATERNION';ring.rotation_quaternion=direction.to_track_quat('Z','Y')
sphere('Rapier_Pommel',handleA,(.041,.041,.041),brass,'hand.R')
cup=sphere('Rapier_Cup_Guard',guard,(.105,.105,.026),brass,'hand.R',32,12)
cup.rotation_mode='QUATERNION';cup.rotation_quaternion=direction.to_track_quat('Z','Y')
rod('Rapier_Blade',guard,tip,.011,steel,'hand.R',.0025,vertices=8)
sphere('Rapier_Point',tip,(.006,.006,.009),steel,'hand.R',12,6)

# Separate closed latex shell and liquid volume, with the knot ABOVE as in W1-W4.
center=Vector((0,0,2.405)); rx,ry,rz=.327,.293,.354
profile=[]
for i in range(41):
    phi=-math.pi/2+math.pi*i/40
    z=rz*math.sin(phi)
    r=max(.0004,rx*math.cos(phi)*(1-.09*math.sin(phi)))
    profile.append((r,z))
head=lathe('Balloon_Latex',profile,center,latex,'head',64,ry/rx)
mod=head.modifiers.new('Actual_Latex_Shell_4mm','SOLIDIFY');mod.thickness=.004;mod.offset=-1
bpy.context.view_layer.objects.active=head;bpy.ops.object.modifier_apply(modifier=mod.name)
head['reference']='w1 w2 w3 w4: translucent latex, top knot, independent from contained water'
head['shell_thickness_metres']=.004
rod('Balloon_Tied_Neck',(0,0,2.746),(0,0,2.793),.026,latex,'head',.020,32)
torus('Balloon_Knot',(0,0,2.776),.027,.011,latex,'head')
# Flared pinched top with pleats instead of an opaque cone.
verts=[];faces=[]
for j in range(25):
    a=2*math.pi*j/24
    for k in range(4):
        t=k/3; r=.017+t*.049*(1+.19*math.cos(a*5))
        verts.append((r*math.cos(a),r*math.sin(a)*.55,2.791+t*.085+.008*math.cos(a*5)*t))
for j in range(24):
    for k in range(3):
        a=j*4+k;faces.append((a,a+4,a+5,a+1))
mesh=bpy.data.meshes.new('Pleated_Latex_Tie_Mesh');mesh.from_pydata(verts,[],faces);mesh.update()
obj=bpy.data.objects.new('Balloon_Pleated_Tie',mesh);character.objects.link(obj)
finish(obj,'Balloon_Pleated_Tie',latex,'head')
mod=obj.modifiers.new('Tie_Thickness','SOLIDIFY');mod.thickness=.002
bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)

fraction=.65
capheight=2*math.sin(math.asin(2*fraction-1)/3)
water_top=rz*capheight
theta_end=math.asin(capheight)
liquid_profile=[]
for i in range(29):
    phi=-math.pi/2+(theta_end+math.pi/2)*i/28
    liquid_profile.append((max(.0003,rx*.969*math.cos(phi)*(1-.09*math.sin(phi))),rz*.97*math.sin(phi)))
liquid=lathe('Water_Contained',liquid_profile,center,water,'head',64,ry/rx)
liquid['fill_fraction']=fraction
liquid['note']='Closed static liquid volume; runtime fluid simulation is separate.'
# Replace the flat cap with a rippled, welded surface: one closed liquid mesh.
top_z=center.z+liquid_profile[-1][1]; top_radius=liquid_profile[-1][0]
verts=[tuple(v.co) for v in liquid.data.vertices]
faces=[tuple(p.vertices) for p in liquid.data.polygons][:-1]
segments=64;rings=9
previous=(len(liquid_profile)-1)*segments
for k in range(rings-1,0,-1):
    r=top_radius*k/rings
    start=len(verts)
    for j in range(segments):
        a=2*math.pi*j/segments
        wave=.009*math.sin(r*34+a*2)*math.sin(math.pi*r/top_radius)
        verts.append((r*math.cos(a),r*math.sin(a)*ry/rx,top_z-center.z+wave))
    for j in range(segments):
        jj=(j+1)%segments
        faces.append((previous+j,previous+jj,start+jj,start+j))
    previous=start
ci=len(verts);verts.append((0,0,top_z-center.z))
for j in range(segments):faces.append((previous+j,previous+(j+1)%segments,ci))
mesh=bpy.data.meshes.new('Liquid_Closed_Rippled_Mesh');mesh.from_pydata(verts,[],faces);mesh.update()
liquid.data=mesh;mesh.materials.append(water)
for poly in mesh.polygons:poly.use_smooth=True
rim=torus('Water_Meniscus_Rim',(0,0,top_z-.0005),top_radius-.002,.0035,water,'head')
rim.scale.y=ry/rx
# Thin curved crests make the free water surface readable through the shell.
crest=material('Water_Surface_Crest',(.64,.95,.88),.065,0,.68,1.333)
verts=[];faces=[]
for j in range(97):
    a=2*math.pi*j/96
    rad=top_radius-.008
    z=top_z+.012*math.sin(a*3+.4)+.004*math.sin(a*7)
    for k in range(8):
        b=2*math.pi*k/8
        rr=rad+.004*math.cos(b)
        verts.append((rr*math.cos(a),rr*math.sin(a)*ry/rx,z+.004*math.sin(b)))
for j in range(96):
    for k in range(8):
        a=j*8+k;b=j*8+(k+1)%8;faces.append((a,a+8,b+8,b))
mesh=bpy.data.meshes.new('Water_Crest_Mesh');mesh.from_pydata(verts,[],faces);mesh.update()
obj=bpy.data.objects.new('Water_Surface_Crest',mesh);character.objects.link(obj)
finish(obj,'Water_Surface_Crest',crest,'head')
# Discrete tiny air bubbles: modeled cavities with inward normals.
for i in range(13):
    a=i*2.399; r=.09+.11*((i*7)%13)/13
    z=center.z-.22+.24*((i*5)%13)/13
    bubble=sphere('Water_Air_Bubble_%02d'%i,(r*math.cos(a),r*math.sin(a)*.75,z),(.006+i%3*.002,)*3,water,'head',12,8)
    for polygon in bubble.data.polygons: polygon.flip()

# A few external wet beads convey W2/W3 without baking a full burst into the mesh.
for i,(x,y,z,r) in enumerate([(-.207,-.208,1.87,.014),(.13,-.152,1.68,.009),(.30,-.089,1.87,.012),(-.70,-.065,1.91,.010)]):
    sphere('Surface_Water_Bead_'+str(i),(x,y,z),(r,r,r*1.3),water,'chest' if i<3 else 'upper_arm.L',16,8)

# Rigid weights preserve independent wooden pieces under an 18-joint skeleton.
armdata=bpy.data.armatures.new('WD_Mannequin_Skeleton')
rig=bpy.data.objects.new('WD_Mannequin_Rig',armdata);character.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,(headpos,tailpos,parent) in bones.items():
    bone=armdata.edit_bones.new(name);bone.head=headpos;bone.tail=tailpos
    if parent:bone.parent=armdata.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
rig.show_in_front=True;armdata.display_type='OCTAHEDRAL'
rig['asset']='WaterDuel / Water Mannequin'
rig['references']='Attached artist mannequin + docs/referencias/w1.png, w2.png, w3.png, w4.png'
for obj in parts:
    obj.parent=rig
    group=obj.vertex_groups.new(name=obj['rig_bone']);group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    mod=obj.modifiers.new('Rigid_Articulation','ARMATURE');mod.object=rig

# Bone-parented attachment points for equipment and the procedural game rig.
for name,bone,pos in [
    ('Socket_MainHand','hand.R',tuple(grip)),
    ('Socket_SecondaryHand','hand.L',(-1.00,-.025,2.42)),
    ('Socket_Neck','neck',(0,0,2.10)),
    ('Socket_Foot_L','foot.L',(-.24,-.08,0)),
    ('Socket_Foot_R','foot.R',(.25,-.06,0)),
]:
    socket=bpy.data.objects.new(name,None);character.objects.link(socket)
    socket.empty_display_type='ARROWS';socket.empty_display_size=.06
    socket.parent=rig;socket.parent_type='BONE';socket.parent_bone=bone
    bpy.context.view_layer.update();socket.matrix_world=Matrix.Translation(pos)
    socket['purpose']='Attachment point; metres; rest position in source Z-up'
    sockets.append(socket)

# Presentation is deliberately excluded from GLB.
floor=material('Studio_Charcoal',(.024,.037,.035),.32)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.001))
finish(bpy.context.object,'Studio_Floor',floor);move_to(bpy.context.object,studio)
scene.world.color=(.12,.12,.12)
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.11,.16,.15,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.35

def area(name,pos,energy,color,size,target=(0,0,1.5),size_y=None):
    data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.color=color
    data.shape='DISK' if size_y is None else 'RECTANGLE';data.size=size
    if size_y is not None:data.size_y=size_y
    obj=bpy.data.objects.new(name,data);studio.objects.link(obj);obj.location=pos
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
area('Key_Softbox',(-3.4,-4.5,5.0),650,(1,.83,.62),3.4)
area('Cool_Fill',(3,-2.4,3.6),480,(.55,.84,1),3)
area('Warm_Rim',(2.2,2.0,4.0),1050,(1,.56,.22),2.2)
area('Mint_Rim',(-2.2,1.5,3),700,(.28,1,.78),1.8)
area('Head_Strip',(-1.8,-1.8,3.5),110,(1,1,1),.32,target=(0,0,2.4),size_y=2.0)
camdata=bpy.data.cameras.new('Character_Camera');camera=bpy.data.objects.new('Character_Camera',camdata);studio.objects.link(camera)
camera.location=(3.4,-7.7,3.1);target=Vector((-.08,0,1.43))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camdata.type='ORTHO';camdata.ortho_scale=3.28;camdata.lens=60;scene.camera=camera
scene.render.resolution_x=1120;scene.render.resolution_y=1400;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
try:
    scene.render.engine='CYCLES'
    scene.cycles.samples=40
    scene.cycles.use_denoising=True
    scene.cycles.max_bounces=12
    scene.cycles.transmission_bounces=10
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type='OPTIX';prefs.get_devices()
        for device in prefs.devices:device.use=device.type!='CPU'
        if any(device.use for device in prefs.devices):scene.cycles.device='GPU'
    except Exception:pass
except Exception:
    scene.render.engine='BLENDER_EEVEE'
    if hasattr(scene.eevee,'use_raytracing'):scene.eevee.use_raytracing=True
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
scene.render.filepath=str(OUT/'water-mannequin-preview.png')
scene.render.image_settings.color_mode='RGBA'
scene['authoring_note']='Model only: no game renderer or fluid physics was changed.'

def export_glb(filename):
    # Merge like materials only in a temporary export collection. Rigid bone
    # weights survive the join; the editable source retains every separate part.
    temp=bpy.data.collections.new('WD_Export_Temporary');scene.collection.children.link(temp)
    groups={};merged=[]
    for obj in parts:
        if obj.name in {'Balloon_Latex','Water_Contained'}:continue
        dup=obj.copy();dup.data=obj.data.copy();temp.objects.link(dup)
        optional_weapon=obj.name.startswith(('Rapier_','Leather_Grip_Wrap_'))
        groups.setdefault((obj.data.materials[0].name,optional_weapon),[]).append(dup)
    for (matname,optional_weapon),objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        bpy.ops.object.join()
        obj=bpy.context.object;obj.name=('Preview_Rapier_' if optional_weapon else 'WD_')+matname;merged.append(obj)
        if optional_weapon:obj['optional_preview_equipment']=True
    bpy.ops.object.select_all(action='DESELECT')
    for obj in merged+[head,liquid,rig]+sockets:obj.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=str(OUT/filename),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_animations=False,export_skins=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
    for obj in list(temp.objects):
        data=obj.data;bpy.data.objects.remove(obj,do_unlink=True)
        if data.users==0:bpy.data.meshes.remove(data)
    bpy.data.collections.remove(temp)

export_glb('water-mannequin.glb')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'water-mannequin.blend'))
print('WD_ASSET_SAVED',flush=True)
if not SKIP_RENDERS:bpy.ops.render.render(write_still=True)
print('WD_PREVIEW_SAVED',flush=True)

# Amber palette from W1/W3/W4 shares the same mesh and rig.
latex.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(1,.70,.28,1)
latex.node_tree.nodes.get('Volume Absorption').inputs['Color'].default_value=(1,.25,.015,1)
water.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(1,.83,.49,1)
water.node_tree.nodes.get('Volume Absorption').inputs['Color'].default_value=(1,.65,.17,1)
cloth.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.30,.025,.01,1)
export_glb('water-mannequin-amber.glb')
scene.render.filepath=str(OUT/'water-mannequin-amber-preview.png')
if not SKIP_RENDERS:bpy.ops.render.render(write_still=True)
# Restore Mint so the saved source and preview agree.
latex.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.78,.98,.91,1)
latex.node_tree.nodes.get('Volume Absorption').inputs['Color'].default_value=(.08,.68,.49,1)
water.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.68,.95,.90,1)
water.node_tree.nodes.get('Volume Absorption').inputs['Color'].default_value=(.30,.87,.74,1)
cloth.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.012,.20,.17,1)
stats={'name':'WaterDuel Water Mannequin','bones':len(bones),'mesh_objects':len(parts),'triangles_source':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in parts),'height_metres':2.884,'fill_fraction':.65,'source_axes':'Z up, -Y forward','glb_axes':'Y up, +Z forward','references':['artist mannequin attachment','w1.png','w2.png','w3.png','w4.png'],'static_fluid':True,'runtime_integrated':False}
(OUT/'asset-info.json').write_text(json.dumps(stats,indent=2),encoding='utf-8')
print('WD_COMPLETE',json.dumps(stats),flush=True)
