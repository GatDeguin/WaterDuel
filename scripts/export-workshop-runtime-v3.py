"""Rigidly separate complete textile/board assemblies, preserving v2 PBR/rig.

Open WaterDuel_Atelier_v2.blend in a private background Blender process.
The read-only BVH source audit supplies exact complete component memberships.
"""
import bpy
import json
import hashlib
import time
from pathlib import Path
from collections import defaultdict
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/environment/workshop'
MAP = ROOT / 'audit/workshop-v3-selection-map.json'
V2 = ROOT / 'output/blender/WaterDuel_Atelier_v2.blend'
S = 95 / 147
TY = .3245 - 1.15 * S
EXPECTED = {
 'output/blender/WaterDuel_Atelier.blend':'2e92513be1f17a2e2d5cc357dddc8cd8d0e1dd62abbde226f4ec09c3a717b755',
 'output/blender/WaterDuel_Atelier_v2.blend':'d9c9f0bdbd58bc59c1ab1ee16422ac8ff9b7315c8ecd7436795248d47fcc2117',
 'public/assets/environment/workshop/workshop-runtime.glb':'1eb31ceef5913e3cce87cdc4397b5223ad678028957933de78e9b930c950c66d',
 'public/assets/environment/workshop/workshop-runtime-v2.glb':'cec471597e48f5df50d23a2b7c894d01c44bce4402c607d6b001e7dd8d8d99b5'}
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path, value):Path(path).write_text(json.dumps(value, indent=2), encoding='utf-8')
def log(*args):print('WORKSHOP_V3',*args,flush=True)
def coords(obj):
 a=np.empty(len(obj.data.vertices)*3,np.float32);obj.data.vertices.foreach_get('co',a);return a.reshape((-1,3))
def runtime(points):return np.column_stack((points[:,0],points[:,2],-points[:,1]))
def bounds(points):return {'min':points.min(axis=0).tolist(),'max':points.max(axis=0).tolist()}
def triangles(obj):obj.data.calc_loop_triangles();return len(obj.data.loop_triangles)
def fingerprint(obj):
 me=obj.data;uv=np.empty(len(me.loops)*2,np.float32)
 me.uv_layers.active.data.foreach_get('uv',uv)
 loop=np.empty(len(me.loops),np.int32);me.loops.foreach_get('vertex_index',loop)
 return {'vertices':len(me.vertices),'polygons':len(me.polygons),'loops':len(me.loops),
 'uv':hashlib.sha256(uv.tobytes()).hexdigest(),'topology':hashlib.sha256(loop.tobytes()).hexdigest(),
 'materials':[m.name for m in me.materials]}
def components(obj):
 n=len(obj.data.vertices);parent=list(range(n))
 def find(i):
  while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
  return i
 for edge in obj.data.edges:
  a,b=map(int,edge.vertices);parent[find(a)]=find(b)
 result=defaultdict(list)
 for i in range(n):result[find(i)].append(i)
 return {min(ids):ids for ids in result.values()}
assert Path(bpy.data.filepath).resolve()==V2.resolve(),'Open clean v2 editable'
for path,expected in EXPECTED.items():assert sha(ROOT/path)==expected,path+' changed'
mapping=json.loads(MAP.read_text(encoding='utf-8'))
contract=json.loads((OUT/'asset-contract-v2.json').read_text(encoding='utf-8'))
scene=bpy.context.scene;scene.frame_set(1)
names={r['object'] for r in contract['materials']}
for r in contract['materials']:names.update(r.get('additionalObjects',[]))
groups={name:bpy.data.objects[name] for name in names}
assert len(groups)==36 and 'Workshop_FanRotor' in groups
before={name:fingerprint(obj) for name,obj in groups.items()}
original={name:coords(obj).copy() for name,obj in groups.items()}
rig={obj.name:([list(row) for row in obj.matrix_world],obj.data.energy if obj.type=='LIGHT' else obj.data.lens)
     for obj in scene.objects if obj.type in {'CAMERA','LIGHT'}}
members={name:components(obj) for name,obj in groups.items()}
assigned={name:{} for name in groups}
evidence=[]
idmap={'rear_blueprint':'drafting-board','side_pennant_left_rear':'rear-pennant-left',
 'side_pennant_right_rear':'rear-pennant-right','apron_left':'apron-left','apron_right':'apron-right'}
for assembly in mapping['assemblies']:
 old_id=assembly['id'];check_id=idmap.get(old_id,old_id)
 delta=np.array(assembly['sourceDelta'],np.float32)
 if old_id=='rear_blueprint':
  # The full GLB scan finds shrub foliage and shelf hardware below the board.
  # Highest overlapping lower obstacle is Z=2.3600042; backing minZ=2.1200002.
  # Raise backing, paper, tacks and drawing together, leaving >4 cm source gap.
  delta[2]=.281
 if not np.any(delta):continue
 assert old_id in idmap,'Unexpected moved assembly '+old_id
 bd=np.array((delta[0]*S,delta[1]*S,delta[2]*S),np.float32)
 front={};back={};floor={};moved_count=0
 for row in assembly['runtimeSelections']:
  name=row['nodeName'];ids=list(map(int,row['vertexIndices']));obj=groups[name]
  assert name!='Workshop_FanRotor'
  expanded=sorted({v for c in row['componentList'] for v in members[name][int(c.get('minVertex',c.get('component_id_min_vertex')))]})
  assert expanded==sorted(ids),'Incomplete component selection '+check_id+' '+name
  for v in ids:
   assert v not in assigned[name],'Assembly overlap at '+name+' '+str(v)
   assigned[name][v]=check_id
  values=coords(obj);values[ids]+=bd;obj.data.vertices.foreach_set('co',values.ravel());obj.data.update()
  # The position samples identify all final GLB components, including UV seams.
  front[name]=runtime(values[ids]).tolist();moved_count+=len(ids)
 for row in assembly['blockerSelections']:
  name=row['nodeName'];depth_ids=set();floor_ids=set()
  for component in row['componentList']:
   key=int(component.get('minVertex',component.get('component_id_min_vertex')))
   ids=members[name][key]
   (floor_ids if component.get('sourceObject')=='Workshop floor' else depth_ids).update(ids)
  if depth_ids:back[name]=runtime(original[name][sorted(depth_ids)]).tolist()
  if floor_ids:floor[name]=runtime(original[name][sorted(floor_ids)]).tolist()
 assert front and back,'Empty assembly or blockers '+check_id
 # Move its individually editable hidden authoring counterparts as well.
 for source_name in assembly['sourceObjects']:
  source=bpy.data.objects.get(source_name)
  assert source and source_name not in groups,source_name
  source.matrix_world=Matrix.Translation(Vector(delta))@source.matrix_world
 fb=bounds(np.array([v for points in front.values() for v in points]))
 bb=bounds(np.array([v for points in back.values() for v in points]))
 gap=fb['min'][2]-bb['max'][2]
 assert gap>.01,'Conservative depth clearance failed '+check_id+' '+str(gap)
 item={'id':check_id,'sourceDelta':delta.tolist(),'v2BlenderDelta':bd.tolist(),
  'runtimeDelta':[float(bd[0]),float(bd[2]),float(-bd[1])],
  'front':front,'back':back,'floor':floor,'depthGap':gap,
  'sourceObjects':assembly['sourceObjects'],'movedVertices':moved_count}
 if floor:
  fl=bounds(np.array([v for points in floor.values() for v in points]))
  item['floorGap']=fb['min'][1]-fl['max'][1]
  assert item['floorGap']>.003,'Cloth floor clearance failed'
 evidence.append(item);log('MOVED',check_id,moved_count,'depthGap',gap,'floorGap',item.get('floorGap'))
assert len(evidence)==5
for name,obj in groups.items():
 assert fingerprint(obj)==before[name],'UV/topology/material changed '+name
 after=coords(obj);mask=np.ones(len(after),bool);mask[list(assigned[name])]=False
 assert np.array_equal(original[name][mask],after[mask]),'Unselected geometry changed '+name
 for face in obj.data.polygons:
  labels={assigned[name].get(int(v),'static') for v in face.vertices}
  assert len(labels)==1,'A face was deformed instead of translated rigidly'
assert np.array_equal(original['Workshop_FanRotor'],coords(groups['Workshop_FanRotor']))
for obj in scene.objects:
 if obj.type in {'CAMERA','LIGHT'}:
  assert rig[obj.name]==([list(row) for row in obj.matrix_world],obj.data.energy if obj.type=='LIGHT' else obj.data.lens)
scene['workshop_geometry_v3']='Whole assemblies separated from architecture; v2 UV/materials/rotor/cameras/lights preserved.'
scene['workshop_geometry_v3_deltas']=json.dumps([{k:v for k,v in e.items() if k in {'id','sourceDelta','runtimeDelta','depthGap','floorGap','sourceObjects'}} for e in evidence])
bpy.ops.object.select_all(action='DESELECT')
for obj in groups.values():obj.hide_set(False);obj.hide_render=False;obj.select_set(True)
bpy.context.view_layer.objects.active=groups['Workshop_StaticBrass']
bpy.context.view_layer.update();scene.frame_set(1)
target=OUT/'workshop-runtime-v3.glb'
bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,
 export_current_frame=True,export_yup=True,export_apply=True,export_normals=True,
 export_tangents=True,export_texcoords=True,export_materials='EXPORT',export_cameras=False,
 export_lights=False,export_animations=False,export_extras=False,export_attributes=False,export_image_format='AUTO')
points=np.concatenate([runtime(np.array([obj.matrix_world@v.co for v in obj.data.vertices])) for obj in groups.values()])
contract.update(asset=target.name,version=3,ready=False,stable=False,
 verification='Pending independent v3 clearance checks and GLB reimport previews',bounds=bounds(points))
contract['validation']={'parser':'verification-v3.json','reimport':'reimport-verification-v3.json',
 'preview':'preview-glb-v3-eevee.png','geometryReport':'geometry-verification-v3.json','runtimeIntegration':'Principal validates separately'}
contract['geometryCorrection']={'rigidAssemblies':5,'sourceUnits':'unscaled authoring metres',
 'transforms':[{k:v for k,v in e.items() if k in {'id','sourceDelta','runtimeDelta','depthGap','floorGap','movedVertices','sourceObjects'}} for e in evidence],
 'uvTopologyMaterialsPreserved':True,'rotorPreserved':True,'camerasLightsPreserved':True,
 'baselineAudit':'audit/workshop-crossings-v2.json'}
contract['export']={'blenderVersion':bpy.app.version_string,'pipeline':'2026-10-18-runtime-v3-rigid-clearance',
 'fileBytes':target.stat().st_size}
write(OUT/'asset-contract-v3.json',contract)
write(OUT/'selection-evidence-v3.json',{'coordinateSpace':'runtime world','assemblies':evidence})
write(OUT/'export-receipt-v3.json',{'file':target.name,'sha256':sha(target),'bytes':target.stat().st_size,
 'triangles':sum(triangles(o) for o in groups.values()),'groups':len(groups),'ready':False,
 'uvTopologyMaterialsPreserved':True,'immutableBaselines':EXPECTED})
write(OUT/'geometry-preservation-v3.json',{'passed':True,'meshFingerprints':before,
 'rotorVerticesIdentical':True,'unselectedVerticesIdentical':True,'uvsTopologyMaterialsIdentical':True,
 'cameraLightTransformsIdentical':True,'sourceAssembliesAlsoMoved':True})
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'output/blender/WaterDuel_Atelier_v3.blend'))
for path,expected in EXPECTED.items():assert sha(ROOT/path)==expected,path+' changed'
log('EXPORTED',target.stat().st_size,sha(target))
