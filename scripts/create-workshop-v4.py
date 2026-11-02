"""Build the selected v4 atelier details in a private Blender process.
Open the immutable v3 editable. Material baking/export is a separate stage.
"""
import bpy, bmesh, json, math, hashlib, runpy, re
from pathlib import Path
from collections import defaultdict
import numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets/environment/workshop'
V3=ROOT/'output/blender/WaterDuel_Atelier_v3.blend'
V3_SHA='8a693a0c42e75f3f1316ca4f22d687ea3df6ce30c0fbb600991c5803b54544ff'
GLB3_SHA='1a947c7e2a5b2387e5a0db4cd55169445dad91d2a0fda59bac5c51c0751bb930'
S=95/147;TY=.3245-1.15*S
scene=bpy.context.scene
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def log(*v):print('WORKSHOP_V4_BUILD',*v,flush=True)
def write(p,v):Path(p).write_text(json.dumps(v,indent=2),encoding='utf-8')
def safe(s):return re.sub('[^a-z0-9]+','-',s.lower()).strip('-')
def mapped(p):return Vector((S*p[0],S*p[1],S*p[2]+TY))
def source(p):return (p[0]/S,p[1]/S,(p[2]-TY)/S)
def select(o):
 bpy.ops.object.select_all(action='DESELECT');o.hide_set(False);o.hide_render=False;o.select_set(True);bpy.context.view_layer.objects.active=o
def triangles(o):o.data.calc_loop_triangles();return len(o.data.loop_triangles)
assert Path(bpy.data.filepath).resolve()==V3.resolve() and sha(V3)==V3_SHA
assert sha(OUT/'workshop-runtime-v3.glb')==GLB3_SHA
assert not scene.get('workshop_v4_built'),'Start from fresh v3'
contract=json.loads((OUT/'asset-contract-v3.json').read_text())
records={safe(c['sourceMaterial']):dict(c) for c in contract['materials']}
objects={key:bpy.data.objects[c['object']] for key,c in records.items()}
base=list(objects.values())+[bpy.data.objects['Workshop_FanRotor']]
new=bpy.data.collections.new('V4 | exterior and selected details');scene.collection.children.link(new)
def material(name,color,rough=.7,metal=0,emit=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 if emit:p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emit
 m.diffuse_color=(*color,1);return m
def mesh(name,verts,faces,mat):
 me=bpy.data.meshes.new(name+' mesh');me.from_pydata([mapped(p) for p in verts],[],faces);me.update()
 o=bpy.data.objects.new(name,me);new.objects.link(o);me.materials.append(mat);return o
def box(name,p,d,mat):
 x,y,z=p;a,b,c=(v/2 for v in d)
 return mesh(name,[(x+sx*a,y+sy*b,z+sz*c) for sz in(-1,1) for sy in(-1,1) for sx in(-1,1)],
 [(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)],mat)
def coords(o):
 a=np.empty(len(o.data.vertices)*3,np.float32);o.data.vertices.foreach_get('co',a);return a.reshape((-1,3))
def components(o):
 parent=list(range(len(o.data.vertices)))
 def find(i):
  while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
  return i
 for e in o.data.edges:a,b=map(int,e.vertices);parent[find(a)]=find(b)
 groups=defaultdict(list)
 for i in range(len(parent)):groups[find(i)].append(i)
 return list(groups.values())

# Open actual wall apertures. Existing framing remains in front of them.
wall=objects['wall-limewash-soot-and-age']
wall_before=triangles(wall)
for x in(-4.65,4.65):
 cutter=box('TEMP v4 window opening',(x,8.15,6.28),(3.60,2.3,7.10),wall.data.materials[0])
 select(wall);mod=wall.modifiers.new('V4 physical window aperture','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
 bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
assert wall.data.uv_layers.active

# The old deep reveals were opaque solid backing boxes. Remove only these
# two connected components; retain all other black hardware and its UVs.
black=objects['carbon-black'];old=black.data;pos=coords(black)
remove=set();reveal_count=0
for ids in components(black):
 p=np.array([source(v) for v in pos[ids]]);lo=p.min(0);hi=p.max(0)
 if hi[2]-lo[2]>7 and hi[0]-lo[0]>3.2 and lo[1]>7.67 and hi[1]<7.87:
  remove.update(ids);reveal_count+=1
assert reveal_count==2,'Expected exactly two opaque reveal backing boxes'
keep=[poly for poly in old.polygons if not any(i in remove for i in poly.vertices)]
used=sorted({i for f in keep for i in f.vertices});remap={v:i for i,v in enumerate(used)}
me=bpy.data.meshes.new('V4 Carbon hardware without opaque window backing')
me.from_pydata([old.vertices[i].co[:] for i in used],[],[[remap[i] for i in f.vertices] for f in keep]);me.update()
me.materials.append(old.materials[0]);uv=me.uv_layers.new(name='UVMap')
uv.data.foreach_set('uv',np.array([old.uv_layers.active.data[i].uv[:] for f in keep for i in f.loop_indices],np.float32).ravel())
for a,b in zip(me.polygons,keep):a.use_smooth=b.use_smooth
black.data=me
reveal_mat=material('WD_V4_EXT_recessed_window_reveal',(.018,.022,.024),.76)
reveals=[]
for index,x in enumerate((-4.65,4.65)):
 for sx in(-1,1):reveals.append(box('V4 window reveal jamb %s %s'%(index,sx),(x+sx*1.83,7.89,6.28),(.06,.47,7.20),reveal_mat))
 for z in(2.69,9.87):reveals.append(box('V4 window reveal head sill %s %s'%(index,z),(x,7.89,z),(3.72,.47,.06),reveal_mat))

# Subdivide existing atlas geometry once and warp it inside every pane. Edge
# positions are pinned by the original Generated coordinates, preserving frames.
window=objects['window-cold-diffuse-daylight'];select(window)
before_window=triangles(window)
sub=window.modifiers.new('V4 old glass gentle subdivisions','SUBSURF');sub.subdivision_type='SIMPLE';sub.levels=1;sub.render_levels=1
bpy.ops.object.modifier_apply(modifier=sub.name)
gen=window.data.attributes.get('wd_generated');assert gen
g=np.empty(len(window.data.vertices)*3,np.float32);gen.data.foreach_get('vector',g);g=g.reshape((-1,3))
p=coords(window);sp=np.column_stack((p[:,0]/S,p[:,1]/S,(p[:,2]-TY)/S))
phase=np.zeros(len(p),np.float32);u=np.zeros(len(p),np.float32);v=np.zeros(len(p),np.float32);width=np.zeros(len(p),np.float32);height=np.zeros(len(p),np.float32)
broad_sides=[-1 if f.normal.y<-.90 else 1 if f.normal.y>.90 else 0 for f in window.data.polygons]
for ids in components(window):
 part=sp[ids];center=part.mean(0);span=np.ptp(part,axis=0);phase[ids]=center[0]*1.873+center[2]*.719
 u[ids]=(part[:,0]-part[:,0].min())/span[0];v[ids]=(part[:,2]-part[:,2].min())/span[2];width[ids]=span[0];height[ids]=span[2]
phase_attr=window.data.attributes.new('wd_v4_glass_phase','FLOAT','POINT');phase_attr.data.foreach_set('value',phase)
wave=.0042*np.sin(np.pi*u)*np.sin(np.pi*v)*np.sin(u*6.2+v*4.9+phase)
p[:,1]+=wave*S;window.data.vertices.foreach_set('co',p.ravel());window.data.update()
# Analytical face normals keep broad panes from inheriting 45-degree bevel
# normals. Each pane has one continuous phase; no phase step can cross a pane.
theta=u*6.2+v*4.9+phase
du=.0042*(np.pi*np.cos(np.pi*u)*np.sin(np.pi*v)*np.sin(theta)+6.2*np.sin(np.pi*u)*np.sin(np.pi*v)*np.cos(theta))/width
dv=.0042*(np.pi*np.sin(np.pi*u)*np.cos(np.pi*v)*np.sin(theta)+4.9*np.sin(np.pi*u)*np.sin(np.pi*v)*np.cos(theta))/height
analytic=np.column_stack((-du,np.ones(len(p)),-dv));analytic/=np.linalg.norm(analytic,axis=1,keepdims=True)
normals=[]
for face in window.data.polygons:
 side=broad_sides[face.index]
 face.use_smooth=True
 for loop in face.loop_indices:
  index=window.data.loops[loop].vertex_index
  normals.append(tuple(analytic[index]*side) if side else tuple(face.normal))
window.data.normals_split_custom_set(normals)
face_attr=window.data.attributes.new('wd_v4_glass_broad','INT','FACE');face_attr.data.foreach_set('value',broad_sides)
window_mat=window.data.materials[0].copy();window_mat.name='Workshop v4 PBR | old undulating window glass'
window.data.materials.clear();window.data.materials.append(window_mat)
wp=next(n for n in window_mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
wp.inputs['Alpha'].default_value=.66;wp.inputs['Roughness'].default_value=.21
wp.inputs['Specular IOR Level'].default_value=.5;wp.inputs['IOR'].default_value=1.47
wp.inputs['Emission Strength'].default_value=.10
window_mat.surface_render_method='DITHERED'
# A closed tinted pane must contribute its facing skin once. Export as
# single-sided PBR so alpha blending does not accumulate the triangulated
# rear skin over the front (repeated diagonal chevrons in glTF renderers).
window_mat.use_backface_culling=True

# Actual small dents, constrained to the front brass table protection.
brass=objects['brass-tarnish-patina-polished-edges']
bm=bmesh.new();bm.from_mesh(brass.data)
long_edges=[e for e in bm.edges if abs(e.verts[0].co.x-e.verts[1].co.x)>10*S
 and -2.80<((e.verts[0].co.y+e.verts[1].co.y)/2/S)<-2.675]
assert long_edges,'Missing front brass protection span'
bmesh.ops.subdivide_edges(bm,edges=long_edges,cuts=48,use_grid_fill=True)
bm.to_mesh(brass.data);bm.free();brass.data.update()
bp=coords(brass);bs=np.array([source(v) for v in bp]);dent=np.zeros(len(bp),np.float32)
for cx,cz,amp in((-5.35,.985,.012),(1.55,.97,.009),(5.25,.99,.015)):
 r=((bs[:,0]-cx)/.19)**2+((bs[:,2]-cz)/.105)**2
 mask=(bs[:,1]<-2.675)&(bs[:,1]>-2.80)&(r<1)
 dent[mask]+=amp*(1-r[mask])**2
bp[:,1]+=dent*S;bp[:,2]-=dent*.35*S;brass.data.vertices.foreach_set('co',bp.ravel());brass.data.update()
assert np.count_nonzero(dent)>6,'No protection vertices reached by dents'

# A distant courtyard, real geometry beyond the open windows.
facade=material('WD_V4_EXT_distant_slate',(.075,.098,.12),.94)
roof=material('WD_V4_EXT_distant_roofs',(.028,.042,.058),.88)
trees=material('WD_V4_EXT_distant_foliage',(.035,.063,.047),.95)
sky=material('WD_V4_EXT_overcast_sky',(.22,.31,.43),1,emit=.75)
exterior=[]
for i,(x,y,w,h) in enumerate(((-10,19,5.0,8.6),(-3.5,22,5.5,6.6),(3.4,24,6.0,9.8),(10,21,4.3,7.5))):
 exterior.append(box('V4 exterior courtyard building %02d'%i,(x,y,h/2-.4),(w,2,h),facade))
 exterior.append(mesh('V4 exterior pitched roof %02d'%i,[(x-w*.56,y-1.25,h-.4),(x+w*.56,y-1.25,h-.4),(x,y-1.25,h+.9),(x-w*.56,y+1.25,h-.4),(x+w*.56,y+1.25,h-.4),(x,y+1.25,h+.9)],[(0,1,2),(3,5,4),(0,3,4,1),(0,2,5,3),(1,4,5,2)],roof))
 exterior.append(box('V4 exterior chimney %02d'%i,(x+w*.27,y,h+.7),(.42,.43,1.3),roof))
for i,(x,y,z,r) in enumerate(((-7.5,15,7.8,1.0),(-6.6,15.5,8.7,1.1),(-8.4,16,9.0,.9),(7.6,18,8.9,1.25),(8.7,18.5,9.5,1.0))):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=1,location=mapped((x,y,z)))
 o=bpy.context.object;o.name='V4 exterior tree canopy %02d'%i;o.scale=(r*S,r*.72*S,r*1.2*S)
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 for col in list(o.users_collection):col.objects.unlink(o)
 new.objects.link(o);o.data.materials.append(trees);exterior.append(o)
exterior.append(box('V4 exterior sky backdrop',(0,29,9),(45,.12,25),sky))

# Reuse two unmodelled ambient emitters, retaining the 22+2 room light budget.
roof_lights=[]
for name,position,energy,color in(
 ('Background amber pool.004',(-6.0,4.8,9.55),80,(1,.62,.34)),
 ('Background amber pool.005',(6.2,7.05,9.55),110,(.38,.58,1))):
 o=bpy.data.objects[name];o.location=mapped(position);o.data.energy=energy*S*S;o.data.color=color;o.data.shadow_soft_size=.65*S;roof_lights.append(name)
assert sum(o.type=='LIGHT' for o in scene.objects)==22

prop_report=runpy.run_path(str(ROOT/'scripts/workshop-props-v4.py'))['build_v4_details'](scene,{m.name:m for m in bpy.data.materials},S,TY)
prop_objects=prop_report.pop('objects')

def consolidate(items,name):
 deps=bpy.context.evaluated_depsgraph_get();copies=[]
 for original in items:
  evaluated=original.evaluated_get(deps)
  data=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=deps)
  data.transform(original.matrix_world);data.update()
  o=bpy.data.objects.new('V4 merge '+original.name,data);new.objects.link(o);copies.append(o)
 for o in items:bpy.data.objects.remove(o,do_unlink=True)
 bpy.ops.object.select_all(action='DESELECT')
 for o in copies:o.select_set(True)
 bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();o=bpy.context.object;o.name=name
 if not o.data.uv_layers:o.data.uv_layers.new(name='UVMap')
 return o
extra=[];feature_nodes=defaultdict(list)
category_items={category:[o for o in prop_objects if o.name in detail['objectNames']] for category,detail in prop_report['categories'].items()}
for category,detail in prop_report['categories'].items():
 bymat=defaultdict(list)
 for original in category_items[category]:bymat[original.data.materials[0].name].append(original)
 for mat,items in bymat.items():
  o=consolidate(items,'Workshop_V4_P'+category+'_'+safe(mat));extra.append(o);feature_nodes[category].append(o.name)
exterior_materials=defaultdict(list)
for o in exterior+reveals:exterior_materials[o.data.materials[0].name].append(o)
for mat,items in sorted(exterior_materials.items()):
 o=consolidate(items,'Workshop_V4_Exterior_'+safe(mat));extra.append(o)
 feature_nodes['7'].append(o.name)

# Material copies have explicit original per-piece attributes. No original
# shader or packed v3 texture is modified. New bakes replace only their users.
source_mats={}
for key,obj in objects.items():
 if key.startswith(('oak','walnut','stage','copper','wall')):
  name='WD_SOURCE_V2_'+key
  original=bpy.data.materials.get(name)
  if original is None:original=next((m for m in bpy.data.materials if m.name.startswith(name)),None)
  assert original,'Missing preserved procedural material '+key
  mat=original.copy();mat.name='WD_SOURCE_V4_'+key;mat.use_fake_user=True;source_mats[key]=mat
material_report=runpy.run_path(str(ROOT/'scripts/workshop-materials-v4.py'))['apply_material_refinements'](source_mats,objects)
for key in material_report['changed']:
 objects[key].data.materials.clear();objects[key].data.materials.append(source_mats[key])
 records[key]['sourceBakeMaterial']=source_mats[key].name
all_groups=base+extra
total=sum(triangles(o) for o in all_groups)
assert total<500000 and len(all_groups)<=60,(total,len(all_groups))
feature_nodes.update({'13':[brass.name],'18':[window.name]})
build={'version':4,'selected':[4,6,7,10,11,12,13,14,15,16,17,18,19,20,21,22],
 'baseObjects':[o.name for o in base],'extraObjects':[o.name for o in extra],
 'records':records,'materialReport':material_report,'propsReport':prop_report,
 'featureNodes':dict(feature_nodes),'roofLightNames':roof_lights,
 'window':{'removedOpaqueBackings':reveal_count,'wallTrianglesBefore':wall_before,'wallTrianglesAfter':triangles(wall),
  'glassTrianglesBefore':before_window,'glassTrianglesAfter':triangles(window),'maxWarpSourceM':float(np.abs(wave).max()),'alpha':.66},
 'dents':{'vertices':int(np.count_nonzero(dent)),'maxDepthSourceM':float(dent.max()),'object':brass.name},
 'triangles':total,'groups':len(all_groups),'originalsPreserved':True}
scene['workshop_v4_built']=True;scene['workshop_v4_build']=json.dumps(build)
bpy.context.preferences.filepaths.save_version=0
write(OUT/'build-report-v4.json',build)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'output/blender/WaterDuel_v4_Working.blend'))
assert sha(V3)==V3_SHA and sha(OUT/'workshop-runtime-v3.glb')==GLB3_SHA
log('PREPARED',total,len(all_groups),list(material_report['changed']))
