"""Reference-led v2: honey timber, crafted joints, fencing pose and clear water."""
import bpy, math, json, sys
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'docs/assets/characters/v2'
OUT=ROOT/'public/assets/characters/water-mannequin/v2'
SOURCE.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'docs/assets/characters/water-mannequin.blend'))
scene=bpy.context.scene;character=bpy.data.collections['WaterDuel_Character'];studio=bpy.data.collections['Presentation_Only']
rig=bpy.data.objects['WD_Mannequin_Rig']
wood=bpy.data.materials['Beech_Wood_Grain'];brass=bpy.data.materials['Satin_Brass'];steel=bpy.data.materials['Polished_Rapier_Steel']
dark=bpy.data.materials['Recessed_Steel'];leather=bpy.data.materials['Wrapped_Brown_Leather'];cloth=bpy.data.materials['Mint_Woven_Sash']
latex=bpy.data.materials['Mint_Latex_Transmission'];water=bpy.data.materials['Water_IOR_1.333']
def bs(mat):return mat.node_tree.nodes.get('Principled BSDF')

# Texture pixels are scene-linear. V1's much higher values produced ivory wood.
rng=np.random.default_rng(412);n=1024
y,x=np.mgrid[0:n,0:n].astype(np.float32);u=x/n;v=y/n
warp=u+.015*np.sin(v*8+u*4)+.005*np.sin(v*31)
grain=.022*np.sin(warp*290+np.sin(v*5)*2)+.009*np.sin(warp*1050+v*7)
grain-=.042*np.maximum(0,np.sin(warp*180+v*3))**18
grain+=rng.normal(0,.004,(n,n))
grain+=.017*np.sin(v*4+u*3)
color=np.ones((n,n,4),dtype=np.float32)
for i,b in enumerate((.36,.185,.075)):color[:,:,i]=np.clip(b+grain*(1 if i==0 else .72 if i==1 else .43),.01,1)
def image(name,pixels,color_space='sRGB'):
    h,w=pixels.shape[:2]
    im=bpy.data.images.new(name,w,h);im.colorspace_settings.name=color_space
    im.pixels.foreach_set(pixels.astype(np.float32).ravel());im.filepath_raw=str(SOURCE/(name+'.png'));im.file_format='PNG';im.save();im.pack();return im
tex=image('Honey_Wood_Grain_1k',color)
old=next(nd for nd in wood.node_tree.nodes if nd.type=='TEX_IMAGE');old.image=tex
rough=np.ones_like(color);rough[:,:,:3]=np.clip(.43+grain[:,:,None]*2,.29,.65)
rtex=wood.node_tree.nodes.new('ShaderNodeTexImage');rtex.image=image('Wood_Pore_Roughness_512',rough.reshape(512,2,512,2,4).mean(axis=(1,3)),'Non-Color')
wood.node_tree.links.new(rtex.outputs['Color'],bs(wood).inputs['Roughness'])
gy,gx=np.gradient(grain);normal=np.stack((-gx*22,-gy*22,np.ones_like(gx)),axis=-1);normal/=np.linalg.norm(normal,axis=-1)[:,:,None]
normal_rgba=np.ones_like(color);normal_rgba[:,:,:3]=normal*.5+.5
nt=wood.node_tree.nodes.new('ShaderNodeTexImage');nt.image=image('Wood_Pore_Normal_512',normal_rgba.reshape(512,2,512,2,4).mean(axis=(1,3)),'Non-Color')
nm=wood.node_tree.nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.16
wood.node_tree.links.new(nt.outputs['Color'],nm.inputs['Color']);wood.node_tree.links.new(nm.outputs['Normal'],bs(wood).inputs['Normal'])
bs(brass).inputs['Base Color'].default_value=(.46,.245,.07,1);bs(brass).inputs['Roughness'].default_value=.32;bs(brass).inputs['Metallic'].default_value=.92
bs(dark).inputs['Base Color'].default_value=(.028,.035,.033,1);bs(dark).inputs['Roughness'].default_value=.37
bs(leather).inputs['Roughness'].default_value=.53
bs(bpy.data.materials['Endgrain_Joints']).inputs['Base Color'].default_value=(.16,.075,.025,1)
bs(latex).inputs['Base Color'].default_value=(.39,.93,.75,1)
latex.node_tree.nodes['Volume Absorption'].inputs['Density'].default_value=24
latex.node_tree.nodes['Volume Absorption'].inputs['Color'].default_value=(.035,.66,.43,1)
bs(water).inputs['Base Color'].default_value=(.72,.98,.91,1)
water.node_tree.nodes['Volume Absorption'].inputs['Density'].default_value=.16

def weight(obj,bone):
    obj.parent=rig
    for group in list(obj.vertex_groups):obj.vertex_groups.remove(group)
    group=obj.vertex_groups.new(name=bone);group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    if not any(m.type=='ARMATURE' for m in obj.modifiers):obj.modifiers.new('Rigid_Articulation','ARMATURE').object=rig
    obj['rig_bone']=bone

def finish(obj,name,mat,bone):
    obj.name=name
    for c in list(obj.users_collection):c.objects.unlink(obj)
    character.objects.link(obj);obj.data.materials.clear();obj.data.materials.append(mat)
    for p in obj.data.polygons:p.use_smooth=True
    weight(obj,bone);return obj

def sphere(name,pos,r,mat,bone):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=10,location=pos)
    obj=bpy.context.object;obj.scale=r;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(obj,name,mat,bone)

def rod(name,a,b,r,mat,bone,r2=None):
    a,b=Vector(a),Vector(b);d=b-a
    bpy.ops.mesh.primitive_cone_add(vertices=20,radius1=r,radius2=r if r2 is None else r2,depth=d.length,location=(a+b)/2)
    obj=bpy.context.object;obj.rotation_mode='QUATERNION';obj.rotation_quaternion=d.to_track_quat('Z','Y')
    return finish(obj,name,mat,bone)

def box(name,pos,size,mat,bone,bevel=.006):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos);obj=bpy.context.object;obj.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod=obj.modifiers.new('Crafted_Edge','BEVEL');mod.width=bevel;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
    mod=obj.modifiers.new('Corner_Normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(obj,name,mat,bone)

def torus(name,pos,r,t,mat,bone,axis='Y'):
    bpy.ops.mesh.primitive_torus_add(major_radius=r,minor_radius=t,major_segments=32,minor_segments=8,location=pos)
    obj=bpy.context.object
    if axis=='Y':obj.rotation_euler.x=math.pi/2
    return finish(obj,name,mat,bone)

# Clear hierarchy: timber links, recessed hinge core, thin brass retaining rings.
for obj in list(character.objects):
    if obj.name.startswith(('Hydraulic_','Rapier_','Leather_Grip_Wrap_','Grip_Finger_','Chest_Brass_Edge_','Chest_Rivet_')):
        bpy.data.objects.remove(obj,do_unlink=True)
    elif obj.name.endswith('_Core') and obj.type=='MESH':
        obj.scale.y*=.64
for name,bone,r in [('Shoulder_L','upper_arm.L',.085),('Shoulder_R','upper_arm.R',.085),('Elbow_L','forearm.L',.059),('Elbow_R','forearm.R',.059),('Knee_L','shin.L',.058),('Knee_R','shin.R',.058)]:
    p=rig.data.bones[bone].head_local
    torus(name+'_Bearing_Rim',(p.x,p.y-.112,p.z),r,.007,brass,bone)
    # A readable screw slot is cut visually into the recessed pin.
    box(name+'_Axle_Slot',(p.x,p.y-.133,p.z),(.019,.004,.0035),dark,bone,.001)

for xx in [-.155,.155]:
    box('Chest_Retaining_Strap_'+str(xx),(xx,-.137,1.785),(.025,.018,.31),brass,'chest')
    for zz in [1.66,1.90]:
        rod('Chest_Strap_Rivet_'+str(xx)+str(zz),(xx,-.153,zz),(xx,-.161,zz),.011,brass,'chest')
        box('Chest_Screw_Slot_'+str(xx)+str(zz),(xx,-.163,zz),(.012,.003,.002),dark,'chest',.0008)
for side in ['L','R']:
    b=rig.data.bones['forearm.'+side]
    a=b.head_local.lerp(b.tail_local,.17)+Vector((0,.087,0));end=b.head_local.lerp(b.tail_local,.82)+Vector((0,.087,0));mid=a.lerp(end,.55)
    rod('Hydraulic_Barrel_'+side,a,mid,.019,brass,'forearm.'+side)
    rod('Hydraulic_Piston_'+side,mid,end,.009,steel,'forearm.'+side)
    for i,p in enumerate([a,end]):sphere('Hydraulic_Clevis_'+side+str(i),p,(.024,.025,.024),dark,'forearm.'+side)

# Folded top knot: compressed latex fan with a pinched, curved lip, not a vase.
old=bpy.data.objects.get('Balloon_Pleated_Tie');bpy.data.objects.remove(old,do_unlink=True)
verts=[];faces=[];segments=40
for k,(r,flat) in enumerate([(.018,.6),(.027,.45),(.050,.26),(.058,.18),(.039,.14)]):
    t=k/4
    for j in range(segments):
        a=j*2*math.pi/segments
        verts.append((r*math.cos(a)*(1+.16*math.cos(a*5))+.035*t*t,r*math.sin(a)*flat,2.790+.083*t+.010*math.cos(a*5)*t))
for k in range(4):
    for j in range(segments):
        a=k*segments+j;b=k*segments+(j+1)%segments;faces.append((a,b,b+segments,a+segments))
mesh=bpy.data.meshes.new('Folded_Knot_Mesh');mesh.from_pydata(verts,[],faces);mesh.update()
obj=bpy.data.objects.new('Balloon_Pleated_Tie',mesh);character.objects.link(obj);finish(obj,obj.name,latex,'head')
mod=obj.modifiers.new('Thin_Latex','SOLIDIFY');mod.thickness=.0015;bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=mod.name)

# Slosh is authored in the head's bind space; the surface remains inside the skin.
liquid=bpy.data.objects['Water_Contained']
for vert in liquid.data.vertices:
    z=vert.co.z
    if z>.03:
        blend=min(1,max(0,(z-.03)/.035))
        vert.co.z+=blend*(.095*vert.co.x+.004*math.sin(vert.co.x*26+vert.co.y*9))
for name in ['Water_Meniscus_Rim','Water_Surface_Crest']:
    obj=bpy.data.objects[name]
    for vert in obj.data.vertices:vert.co.z+=.095*vert.co.x
for i in range(12):
    a=i*2.399;rad=.11+.10*((i*5)%12)/12
    sphere('Fine_Air_Bubble_'+str(i),(rad*math.cos(a),rad*.65*math.sin(a),2.18+.19*((i*7)%12)/12),(.0035+i%3*.0015,)*3,water,'head')

def update():bpy.context.view_layer.update()
def aim(name,direction):
    update();p=rig.pose.bones[name];m=p.matrix.copy()
    # All hinge axles share the workshop mannequin's depth axis. A world-Y
    # rotation preserves that mechanical axis instead of introducing bone roll.
    rest=p.bone.tail_local-p.bone.head_local;direction=Vector(direction)
    angle=math.atan2(direction.x,direction.z)-math.atan2(rest.x,rest.z)
    q=Quaternion((0,1,0),angle)
    target=(q.to_matrix()@p.bone.matrix_local.to_3x3()).to_4x4();target.translation=m.translation
    p.matrix=target;update()
def two_bone(upper,lower,target,bend=1):
    update();s=rig.pose.bones[upper].head.copy();target=Vector(target)
    a1=rig.data.bones[upper];a2=rig.data.bones[lower]
    r1=a1.tail_local-a1.head_local;r2=a2.tail_local-a2.head_local
    l1=math.hypot(r1.x,r1.z);l2=math.hypot(r2.x,r2.z)
    delta=Vector((target.x-s.x,0,target.z-s.z));distance=min(delta.length,l1+l2-.0005);u=delta.normalized()
    a=(l1*l1-l2*l2+distance*distance)/(2*distance);h=math.sqrt(max(0,l1*l1-a*a))
    perp=Vector((-u.z,0,u.x));perp.normalize()
    elbow=s+u*a+perp*h*bend
    aim(upper,elbow-s);aim(lower,target-rig.pose.bones[lower].head)

# Strongly separated feet, bent lead knee and a forward-driving torso (W1).
p=rig.pose.bones['pelvis'];p.matrix=Matrix.Translation((0,0,-.21))@p.matrix;update()
aim('chest',(.17,0,1))
two_bone('thigh.L','shin.L',(-.64,.035,.115),1)
two_bone('thigh.R','shin.R',(.47,-.025,.115),1)
aim('foot.L',(0,-.17,-.05));aim('foot.R',(0,-.17,-.05))
for name in ['foot.L','foot.R']:
    # Preserve flat soles by fixing the complete world orientation, including roll.
    p=rig.pose.bones[name];m=rig.data.bones[name].matrix_local.copy();m.translation=p.head.copy();p.matrix=m;update()
two_bone('upper_arm.R','forearm.R',(1.13,-.08,1.66),-1)
two_bone('upper_arm.L','forearm.L',(-.97,.025,1.70),1)
aim('hand.R',(.19,-.015,.015));aim('hand.L',(-.17,-.015,.055))
aim('head',(-.12,0,1))
rig['v2_pose']='W1 fencing guard; v1 rest/bind skeleton retained. No dynamic simulation.'
update()

def from_pose(point,bone):
    delta=rig.pose.bones[bone].matrix@rig.data.bones[bone].matrix_local.inverted()
    return delta.inverted()@Vector(point)
def posed_geometry(obj,bone):
    # Primitives were made at posed world points. Rebase their mesh into bind
    # coordinates so skinning applies the current head/hand transform once.
    update();world=obj.matrix_world.copy()
    for v in obj.data.vertices:v.co=from_pose(world@v.co,bone)
    obj.matrix_world=Matrix.Identity(4);update();return obj

# Replace awkward v1 finger blocks by rounded wooden phalanges around the grip.
hand=rig.pose.bones['hand.R'].head.copy();direction=Vector((1,-.015,.075)).normalized()
grip=hand+direction*.065+Vector((0,-.015,0));guard=grip+direction*.095;handle=grip-direction*.13
for name in ['Grip_Hand_R','Open_Mitten_Hand_L']:
    obj=bpy.data.objects.get(name)
    if obj:bpy.data.objects.remove(obj,do_unlink=True)
posed_geometry(sphere('Grip_Hand_R',grip+Vector((0,.024,0)),(.073,.040,.061),wood,'hand.R'),'hand.R')
for i in range(4):
    xx=grip.x+(i-1.5)*.029
    a=(xx,grip.y-.008,grip.z+.051);b=(xx,grip.y-.055,grip.z+.025);c=(xx,grip.y-.048,grip.z-.027)
    posed_geometry(rod('Grip_Phalange_'+str(i)+'a',a,b,.014,wood,'hand.R'),'hand.R')
    posed_geometry(rod('Grip_Phalange_'+str(i)+'b',b,c,.013,wood,'hand.R'),'hand.R')
    posed_geometry(sphere('Grip_Knuckle_'+str(i),b,(.016,)*3,brass,'hand.R'),'hand.R')
posed_geometry(rod('Grip_Thumb',grip+Vector((-.055,-.01,-.025)),grip+Vector((.012,-.063,-.030)),.020,wood,'hand.R'),'hand.R')
off=rig.pose.bones['hand.L'].head.copy()+Vector((-.065,0,.015))
posed_geometry(sphere('Balance_Hand_Palm',off,(.075,.042,.052),wood,'hand.L'),'hand.L')
for i in range(4):
    a=off+Vector((-.035,-.022,(i-1.5)*.019));b=a+Vector((-.06,-.025,.015))
    posed_geometry(rod('Balance_Finger_'+str(i),a,b,.0115,wood,'hand.L'),'hand.L')

posed_geometry(rod('Rapier_Leather_Grip',handle,guard,.022,leather,'hand.R'),'hand.R')
for i in range(9):
    a=handle.lerp(guard,(i+.2)/9);b=a+direction*.006
    posed_geometry(rod('Leather_Grip_Wrap_'+str(i),a,b,.024,leather,'hand.R'),'hand.R')
posed_geometry(sphere('Rapier_Pommel',handle,(.032,)*3,brass,'hand.R'),'hand.R')
cup=sphere('Rapier_Cup_Guard',guard,(.026,.093,.093),brass,'hand.R');posed_geometry(cup,'hand.R')
tip=guard+direction*1.0
posed_geometry(rod('Rapier_Blade',guard,tip,.008,steel,'hand.R',.0018),'hand.R')
posed_geometry(sphere('Rapier_Point',tip,(.004,)*3,steel,'hand.R'),'hand.R')
# Set attachment points in posed coordinates, retaining bone parenting.
for name,point in [('Socket_MainHand',grip),('Socket_SecondaryHand',off),('Socket_Foot_L',(-.64,-.03,0)),('Socket_Foot_R',(.47,-.09,0))]:
    bpy.data.objects[name].matrix_world=Matrix.Translation(point)
update()

# Balanced cinematic studio. Narrow softboxes avoid the huge oval head glare.
for name,energy,size in [('Key_Softbox',420,2.6),('Cool_Fill',190,2.2),('Warm_Rim',780,1.5),('Mint_Rim',340,1.15),('Head_Strip',90,.22)]:
    light=bpy.data.lights[name];light.energy=energy;light.size=size
camera=scene.camera;camera.location=(3.1,-8.6,2.65);target=Vector((.35,0,1.28))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=3.20
scene.render.resolution_x=1500;scene.render.resolution_y=1150;scene.render.resolution_percentage=100
# Fit the actual deformed meshes so both the knot and the rapier point are visible.
update();dg=bpy.context.evaluated_depsgraph_get();points=[]
for obj in character.objects:
    if obj.type!='MESH':continue
    evaluated=obj.evaluated_get(dg);mesh=evaluated.to_mesh()
    points.extend(evaluated.matrix_world@v.co for v in mesh.vertices);evaluated.to_mesh_clear()
inverse=camera.matrix_world.inverted();projected=[inverse@p for p in points]
xmin=min(p.x for p in projected);xmax=max(p.x for p in projected);ymin=min(p.y for p in projected);ymax=max(p.y for p in projected)
camera.location+=camera.rotation_euler.to_matrix()@Vector(((xmin+xmax)/2,(ymin+ymax)/2,0))
aspect=scene.render.resolution_x/scene.render.resolution_y
camera.data.ortho_scale=max(xmax-xmin,(ymax-ymin)*aspect)*1.12
scene.cycles.samples=48;scene.cycles.use_denoising=True
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    for d in prefs.devices:d.use=d.type!='CPU'
    if any(d.use for d in prefs.devices):scene.cycles.device='GPU'
except Exception:pass
scene.render.filepath=str(OUT/'water-mannequin-preview.png')
scene['v2_improvements']='W1 fencing pose; W2 timber pores, satin brass, hand grip and folded knot. Static modeled water.'
scene['runtime_integrated']=False
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'

def export(filename):
    temp=bpy.data.collections.new('V2_Export');scene.collection.children.link(temp);groups={};merged=[]
    meshes=[o for o in character.objects if o.type=='MESH'];head=bpy.data.objects['Balloon_Latex'];waterobj=bpy.data.objects['Water_Contained']
    for obj in meshes:
        if obj in [head,waterobj]:continue
        dup=obj.copy();dup.data=obj.data.copy();temp.objects.link(dup)
        optional=obj.name.startswith(('Rapier_','Leather_Grip_Wrap_'))
        groups.setdefault((obj.data.materials[0].name,optional),[]).append(dup)
    for (matname,optional),objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
        obj=bpy.context.object;obj.name=('Preview_Rapier_' if optional else 'WD_')+matname;merged.append(obj)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in merged+[head,waterobj,rig]+[o for o in character.objects if o.type=='EMPTY']:obj.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=str(OUT/filename),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_skins=True,export_animations=False,export_rest_position_armature=False,export_current_frame=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
    for obj in list(temp.objects):
        data=obj.data;bpy.data.objects.remove(obj,do_unlink=True)
        if data.users==0:bpy.data.meshes.remove(data)
    bpy.data.collections.remove(temp)

export('water-mannequin.glb')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'water-mannequin.blend'))
print('WD_V2_SOURCE_READY',flush=True)
if '--no-render' not in sys.argv:bpy.ops.render.render(write_still=True)
print('WD_V2_MINT_RENDERED',flush=True)
bs(latex).inputs['Base Color'].default_value=(1,.53,.13,1);latex.node_tree.nodes['Volume Absorption'].inputs['Color'].default_value=(1,.22,.012,1)
bs(water).inputs['Base Color'].default_value=(1,.88,.67,1);water.node_tree.nodes['Volume Absorption'].inputs['Color'].default_value=(1,.76,.34,1)
bs(cloth).inputs['Base Color'].default_value=(.27,.022,.008,1)
export('water-mannequin-amber.glb')
scene.render.filepath=str(OUT/'water-mannequin-amber-preview.png')
if '--no-render' not in sys.argv:bpy.ops.render.render(write_still=True)
print('WD_V2_DONE',flush=True)
