"""Bake selected material channels on CPU and export an immutable v4 GLB."""
import bpy,json,hashlib,math,time,runpy
from pathlib import Path
import numpy as np
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets/environment/workshop'
TEX=OUT/'textures-v4';TEX.mkdir(exist_ok=True)
scene=bpy.context.scene;assert scene.get('workshop_v4_built')
build=json.loads(scene['workshop_v4_build']);records=build['records']
objects={k:bpy.data.objects[c['object']] for k,c in records.items()}
groups=[bpy.data.objects[n] for n in build['baseObjects']+build['extraObjects']]
detail=runpy.run_path(str(ROOT/'scripts/workshop-detail-wood-v4.py'))['prepare_detail_wood']([bpy.data.objects[n] for n in build['extraObjects']])
for entry in detail['entries']:
 key=entry['key'];records[key]=entry;objects[key]=bpy.data.objects[entry['object']]
 build['materialReport']['changed'][key]=entry
build['detailWoodReport']=detail
source_mats={k:bpy.data.materials[c['sourceBakeMaterial']] for k,c in records.items() if k in build['materialReport']['changed']}
contract=json.loads((OUT/'asset-contract-v3.json').read_text())
cachepath=ROOT/'output/blender/runtime-bake-cache-v4.json'
cache=json.loads(cachepath.read_text()) if cachepath.exists() else {}
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,v):Path(p).write_text(json.dumps(v,indent=2),encoding='utf-8')
def log(*v):print('WORKSHOP_V4_BAKE',*v,flush=True)
def select(o):
 bpy.ops.object.select_all(action='DESELECT');o.hide_set(False);o.hide_render=False;o.select_set(True);bpy.context.view_layer.objects.active=o
def load(path,data=False):
 im=bpy.data.images.load(str(path),check_existing=True);im.colorspace_settings.name='Non-Color' if data else 'sRGB';return im
def image(name,n,data=False):
 im=bpy.data.images.new(name,width=n,height=n,alpha=True);im.colorspace_settings.name='Non-Color' if data else 'sRGB';return im
def save(im,p):im.filepath_raw=str(p);im.file_format='PNG';im.save()
def target(mat,img):
 for node in mat.node_tree.nodes:node.select=False
 node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=img;node.select=True;mat.node_tree.nodes.active=node;return node
def capture(emit,socket,links):
 for link in list(emit.inputs['Color'].links):links.remove(link)
 if socket.is_linked:links.new(socket.links[0].from_socket,emit.inputs['Color'])
 else:
  value=socket.default_value;emit.inputs['Color'].default_value=tuple(value) if hasattr(value,'__len__') else (float(value),)*3+(1,)
# Boolean openings and subdivided protection strips create n-gons. Make the
# exact tessellation explicit before both tangent-normal baking and export.
for o in groups:
 if any(len(p.vertices)>4 for p in o.data.polygons):
  select(o);mod=o.modifiers.new('V4 explicit tangent triangulation','TRIANGULATE');mod.quad_method='FIXED';mod.ngon_method='BEAUTY'
  if hasattr(mod,'keep_custom_normals'):mod.keep_custom_normals=True
  bpy.ops.object.modifier_apply(modifier=mod.name)
 if o.name in build['extraObjects'] or o==objects['wall-limewash-soot-and-age']:
  select(o);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
  bpy.ops.uv.smart_project(angle_limit=1.151917,island_margin=.012,correct_aspect=True,scale_to_bounds=False)
  bpy.ops.object.mode_set(mode='OBJECT')
def sizes(c):
 floor='/ floor' in c['sourceMaterial']
 if c.get('detailWood'):return {'basecolor':512,'normal':256,'orm':256}
 if c['sourceMaterial'].startswith('Wall |'):return {'basecolor':2048,'normal':1024,'orm':512}
 return {'basecolor':512 if floor or c['sourceMaterial'].startswith('Copper') else 1024,
 'normal':256 if floor or c['sourceMaterial'].startswith('Copper') else 512,
 'orm':512 if c['sourceMaterial'].startswith(('Oak','Walnut','Stage')) and not floor else 256}
occluder=bpy.data.materials.new('V4 bake geometry occluder');occluder.use_nodes=True
assigned={o.name:list(o.data.materials) for o in groups}
for o in groups:o.data.materials.clear();o.data.materials.append(occluder)
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16;scene.cycles.use_denoising=False
scene.render.bake.use_selected_to_active=False;scene.render.bake.use_clear=True;scene.render.bake.margin=6
runtime_mats={}
for index,(key,c) in enumerate(sorted(records.items())):
 if key not in source_mats:continue
 mat=source_mats[key];o=objects[key];res=sizes(c)
 co=np.empty(len(o.data.vertices)*3,np.float32);o.data.vertices.foreach_get('co',co)
 uv=np.empty(len(o.data.loops)*2,np.float32);o.data.uv_layers.active.data.foreach_get('uv',uv)
 change=build['materialReport']['changed'][key]
 checksum=hashlib.sha256(json.dumps(change,sort_keys=True).encode()+co.tobytes()+uv.tobytes()+json.dumps(res).encode()).hexdigest()
 files={ch:'textures-v4/'+key+'-'+ch+'.png' for ch in res}
 if cache.get(key,{}).get('checksum')==checksum and all((OUT/f).is_file() for f in files.values()):
  imgs={ch:load(OUT/f,ch!='basecolor') for ch,f in files.items()};log('REUSE',key)
 else:
  o.data.materials.clear();o.data.materials.append(mat);select(o)
  nodes,links=mat.node_tree.nodes,mat.node_tree.links
  p=next(n for n in nodes if n.type=='BSDF_PRINCIPLED');output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL' and n.is_active_output)
  surface=output.inputs['Surface'].links[0].from_socket;emit=nodes.new('ShaderNodeEmission');emit.inputs['Strength'].default_value=1
  imgs={}
  for ch in ('basecolor','orm','normal'):
   n=res[ch];im=image('V4 '+key+' '+ch,n,ch!='basecolor');node=target(mat,im)
   if ch=='normal':
    links.new(surface,output.inputs['Surface']);bpy.ops.object.bake(type='NORMAL',normal_space='TANGENT',normal_r='POS_X',normal_g='POS_Y',normal_b='POS_Z')
    pix=np.empty(n*n*4,np.float32);im.pixels.foreach_get(pix);pix=pix.reshape((-1,4));v=pix[:,:3]*2-1;v/=np.maximum(np.linalg.norm(v,axis=1,keepdims=True),1e-8);pix[:,:3]=v*.5+.5;im.pixels.foreach_set(pix.ravel())
   else:
    capture(emit,p.inputs['Base Color' if ch=='basecolor' else 'Roughness'],links);links.new(emit.outputs[0],output.inputs['Surface']);bpy.ops.object.bake(type='EMIT')
    if ch=='orm':
     rough=np.empty(n*n*4,np.float32);im.pixels.foreach_get(rough);rough=rough.reshape((-1,4))[:,0].copy()
     metallic=np.full(n*n,float(p.inputs['Metallic'].default_value),np.float32)
     if 'Metallic' in change['channels']:
      capture(emit,p.inputs['Metallic'],links);bpy.ops.object.bake(type='EMIT');metal=np.empty(n*n*4,np.float32);im.pixels.foreach_get(metal);metallic=metal.reshape((-1,4))[:,0].copy()
     packed=np.ones((n*n,4),np.float32);packed[:,1]=rough;packed[:,2]=metallic;im.pixels.foreach_set(packed.ravel())
   nodes.remove(node);save(im,OUT/files[ch]);imgs[ch]=im;log('CHANNEL',key,ch,n)
  links.new(surface,output.inputs['Surface']);nodes.remove(emit)
  cache[key]={'checksum':checksum,'files':files,'sizes':res};write(cachepath,cache)
 runtime=bpy.data.materials.new('Workshop v4 PBR | '+key);runtime.use_nodes=True
 nodes,links=runtime.node_tree.nodes,runtime.node_tree.links;p=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
 p.inputs['Base Color'].default_value=c['baseColorLinear'];p.inputs['Metallic'].default_value=c['metallic'];p.inputs['Roughness'].default_value=c['roughness']
 p.inputs['Coat Weight'].default_value=c.get('coat',0)
 for ch,im in imgs.items():
  tex=nodes.new('ShaderNodeTexImage');tex.image=im
  if ch=='basecolor':links.new(tex.outputs['Color'],p.inputs['Base Color'])
  elif ch=='normal':
   nm=nodes.new('ShaderNodeNormalMap');links.new(tex.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs['Normal'],p.inputs['Normal'])
  else:
   sep=nodes.new('ShaderNodeSeparateColor');links.new(tex.outputs['Color'],sep.inputs[0]);links.new(sep.outputs['Green'],p.inputs['Roughness']);links.new(sep.outputs['Blue'],p.inputs['Metallic'])
 runtime_mats[key]=runtime;c.update(runtimeMaterial=runtime.name,textures=files,textureDimensions={ch:[n,n] for ch,n in res.items()},v4Revision=build['materialReport']['revision'])
 o.data.materials.clear();o.data.materials.append(occluder)
 log('MATERIAL_DONE',index+1,len(records),key)
for o in groups:
 o.data.materials.clear()
 key=next((k for k,v in objects.items() if v==o),None)
 for m in ([runtime_mats[key]] if key in runtime_mats else assigned[o.name]):o.data.materials.append(m)
for key,o in objects.items():
 if key not in runtime_mats:records[key]['runtimeMaterial']=o.data.materials[0].name
 if key.startswith('window-'):records[key].update(emissionOnly=False,glass=True,alpha=.66,roughness=.21)
def world(v):return [v.x,v.z,-v.y]
def light_records():
 hints=[];frames=[]
 for o in scene.objects:
  if o.type!='LIGHT':continue
  d=o.data;position=world(o.matrix_world.translation);rotation=o.matrix_world.to_3x3()
  hints.append({'name':o.name,'type':d.type,'position':position,'sourceWatts':d.energy/(95/147)**2,'scaledWatts':d.energy,'colorLinear':list(d.color)})
  f={'name':o.name,'type':d.type,'position':position,'direction':[0,0,0],'axisU':[0,0,0],'axisV':[0,0,0]}
  if d.type=='AREA':
   f.update(direction=world((rotation@Vector((0,0,-1))).normalized()),axisU=world((rotation@Vector((1,0,0))).normalized()),axisV=world((rotation@Vector((0,1,0))).normalized()),sizeRuntime=d.size,sizeYRuntime=d.size_y if d.shape in {'RECTANGLE','ELLIPSE'} else d.size,shape=d.shape,spreadRadians=d.spread)
  else:f['radiusRuntime']=d.shadow_soft_size
  frames.append(f)
 return hints,frames
hints,frames=light_records();assert len(hints)==22
write(OUT/'light-directions-v4.json',{'version':4,'coordinateSpace':'runtime world','lights':frames})
write(OUT/'lighting-day-v4.json',{'version':4,'variant':'day','lights':hints,'materialOverrides':[]})
bpy.ops.object.select_all(action='DESELECT');scene.frame_set(1)
for o in groups:o.hide_render=False;o.hide_set(False);o.select_set(True)
bpy.context.view_layer.objects.active=groups[0]
target_path=OUT/'workshop-runtime-v4.glb'
bpy.ops.export_scene.gltf(filepath=str(target_path),export_format='GLB',use_selection=True,export_current_frame=True,
 export_yup=True,export_apply=True,export_normals=True,export_tangents=True,export_texcoords=True,
 export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False,export_extras=False,export_attributes=False,export_image_format='AUTO')
points=np.concatenate([np.array([world(o.matrix_world@v.co) for v in o.data.vertices]) for o in groups])
contract.update(asset=target_path.name,version=4,ready=False,stable=False,verification='Pending v4 actual GLB QA and selected-feature renders',
 bounds={'min':points.min(0).tolist(),'max':points.max(0).tolist()},materials=list(records.values()))
contract['budgets'].update(measuredTriangles=build['triangles'],measuredGroups=len(groups))
contract['lighting'].update(hints=hints,directions='light-directions-v4.json',nightPreset='lighting-night-v4.json')
contract['reflection']={'asset':'reflection-v4.hdr','projection':'equirectangular','runtimeCaptureAlreadySupported':True,'note':'HDR is an authored reference capture; integration is validated by Principal.'}
contract['validation']={'parser':'verification-v4.json','reimport':'reimport-verification-v4.json','runtimeIntegrationVerified':False}
contract['export']={'pipeline':'2026-11-02-selected-v4','blenderVersion':bpy.app.version_string,'fileBytes':target_path.stat().st_size}
write(OUT/'asset-contract-v4.json',contract)
write(OUT/'export-receipt-v4.json',{'file':target_path.name,'sha256':sha(target_path),'bytes':target_path.stat().st_size,'triangles':build['triangles'],'groups':len(groups),'ready':False})
# Retain full procedural layers for the primary editable. The GLB above keeps
# portable baked PBR, while the editable retains its native coat and grain nodes.
for key,mat in source_mats.items():objects[key].data.materials.clear();objects[key].data.materials.append(mat)
scene['workshop_v4_build']=json.dumps(build)
for im in bpy.data.images:
 if im.source=='FILE' and im.filepath:
  try:im.pack()
  except RuntimeError:pass
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=64;scene.cycles.use_denoising=True
scene.render.resolution_x=1920;scene.render.resolution_y=1080;scene.render.resolution_percentage=100
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'output/blender/WaterDuel_Atelier_v4.blend'))
log('EXPORTED',sha(target_path),target_path.stat().st_size,len(groups))
