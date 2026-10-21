"""Read-only Blender asset verification; writes a small evidence report."""
import bpy
import os
import json
import math
import hashlib
import struct
from mathutils import Vector

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'output','blender')
scene=bpy.context.scene
checks={}
checks['file_loaded']=os.path.basename(bpy.data.filepath)=='WaterDuel_Atelier.blend'
checks['cycles_renderer']=scene.render.engine=='CYCLES'
checks['three_cameras']=sum(o.type=='CAMERA' for o in scene.objects)==3
checks['native_editable_geometry']=sum(o.type=='MESH' for o in scene.objects)>1500
checks['references_packed']=all(bpy.data.images.get('w%d.png'%i) and bpy.data.images['w%d.png'%i].packed_file for i in range(1,5))
external=[bpy.path.abspath(im.filepath) for im in bpy.data.images if im.source=='FILE' and im.users and not im.packed_file]
checks['no_external_image_dependencies']=not external
checks['finite_object_transforms']=all(math.isfinite(v) for o in scene.objects for row in o.matrix_world for v in row)
checks['finite_mesh_vertices']=all(math.isfinite(v) for me in bpy.data.meshes if me.users for vert in me.vertices for v in vert.co)
checks['visible_banner_lettering']=any(o.name.startswith('Embroidery | Grand standard lettering') and not o.hide_render for o in scene.objects)
checks['references_hidden_from_render']=all(o.hide_render for o in scene.objects if o.name.startswith(('w1 |','w2 |','w3 |','w4 |')))
intersections=[]
for o in scene.objects:
    if o.type!='MESH' or o.hide_render or o.name=='Workshop air':continue
    b=[o.matrix_world@Vector(v) for v in o.bound_box]
    lo=[min(v[i] for v in b) for i in range(3)];hi=[max(v[i] for v in b) for i in range(3)]
    if hi[0]>-4.8 and lo[0]<4.8 and hi[1]>-1.8 and lo[1]<1.8 and hi[2]>1.20 and lo[2]<5.15:
        intersections.append(o.name)
checks['central_combat_volume_clear_above_wetting']=not intersections
renders={}
for name in ['WaterDuel_Atelier_duelo.png','WaterDuel_Atelier_taller.png']:
    path=os.path.join(OUT,name)
    if os.path.isfile(path):
        with open(path,'rb') as f:data=f.read()
        dims=list(struct.unpack('>II',data[16:24])) if data.startswith(b'\x89PNG\r\n\x1a\n') else None
        renders[name]={'dimensions':dims,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        checks[name+'_1920x1080']=dims==[1920,1080]
    else:checks[name+'_1920x1080']=False
with open(bpy.data.filepath,'rb') as f:blendhash=hashlib.sha256(f.read()).hexdigest()
result={'passed':all(checks.values()),'checks':checks,'objects':len(scene.objects),'external_images':external,'combat_volume_intersections':intersections,'renders':renders,'blend_sha256':blendhash,'scope':'Read-only Blender asset verification. Render images are offline Cycles output; no game runtime claim.'}
with open(os.path.join(OUT,'verification.json'),'w',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
print('ASSET_VERIFICATION',json.dumps(result),flush=True)
if not result['passed']:raise RuntimeError('Asset verification failed; see verification.json')
