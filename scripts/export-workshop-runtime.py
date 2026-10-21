"""Export the authored atelier as a self-contained, measured glTF runtime asset.

Blender 5.2, no downloads/add-ons beyond Blender's bundled glTF exporter.
blender -b --factory-startup output/blender/WaterDuel_Atelier.blend --python scripts/export-workshop-runtime.py
The source .blend is never saved. Work occurs on evaluated copies.
"""
import bpy
import os
import re
import json
import math
import hashlib
import time
import shutil
import numpy as np
from mathutils import Vector, Matrix

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE=os.path.join(ROOT,'output','blender','WaterDuel_Atelier.blend')
OUT=os.path.join(ROOT,'public','assets','environment','workshop')
TEX=os.path.join(OUT,'textures')
BAKE=os.path.join(ROOT,'output','blender','runtime-bake-cache')
WORK=os.path.join(ROOT,'output','blender','WaterDuel_Runtime_Working.blend')
os.makedirs(TEX,exist_ok=True)
os.makedirs(BAKE,exist_ok=True)
S=95/147
TY=.3245-1.15*S
REV='2026-10-17-runtime-v1'
SOURCE_HASH=hashlib.sha256(open(SOURCE,'rb').read()).hexdigest()
EXPECTED_SOURCE='2e92513be1f17a2e2d5cc357dddc8cd8d0e1dd62abbde226f4ec09c3a717b755'
if SOURCE_HASH!=EXPECTED_SOURCE:raise RuntimeError('Authored source changed; inspect before exporting')
scene=bpy.context.scene
start=time.time()
cachepath=os.path.join(BAKE,'texture-cache.json')
legacy=os.path.join(OUT,'texture-cache.json')
if not os.path.isfile(cachepath) and os.path.isfile(legacy):
    prior=json.load(open(legacy,encoding='utf-8'))
    for entry in prior.values():
        for file in entry['files'].values():
            source=os.path.join(OUT,file);dest=os.path.join(BAKE,os.path.basename(file))
            if os.path.isfile(source):shutil.copy2(source,dest)
        entry['files']={kind:os.path.basename(file) for kind,file in entry['files'].items()}
    with open(cachepath,'w',encoding='utf-8') as f:json.dump(prior,f,indent=2)
cache=json.load(open(cachepath,encoding='utf-8')) if os.path.isfile(cachepath) else {}

def log(*args):print('WORKSHOP_RUNTIME',*args,flush=True)
def safe(name):return re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')
def write_json(name,data):
    with open(os.path.join(OUT,name),'w',encoding='utf-8') as f:json.dump(data,f,ensure_ascii=False,indent=2)
def triangles(o):
    o.data.calc_loop_triangles();return len(o.data.loop_triangles)
def ratio_for(name):
    if name.startswith('Gold thread'):return .045
    if name.startswith('Paper |'):return .065
    if name.startswith('Technical drawing'):return .12
    if name.startswith('Forest green'):return .24
    if name.startswith('Stage |'):return .85
    if name.startswith(('Ivy | waxy','Ivy | pale')):return .7
    return .60
def resolution_for(name):
    if name.startswith(('Oak |','Walnut |','Wall |','Brass |')):return 2048 if '/ floor' not in name else 1024
    if name.startswith(('Stage |','Forest green','Window |','Ivy | waxy','Blackened iron')):return 1024
    return 512
def new_collection(name):
    c=bpy.data.collections.new(name);scene.collection.children.link(c);return c
def select(obj):
    bpy.ops.object.select_all(action='DESELECT');obj.hide_set(False);obj.hide_render=False;obj.select_set(True);bpy.context.view_layer.objects.active=obj
def color_or_default(p,key,default):
    return list(p.inputs[key].default_value) if p and key in p.inputs and hasattr(p.inputs[key].default_value,'__len__') else default

if not scene.get('workshop_runtime_prepared'):
    col=new_collection('RUNTIME | evaluated, scaled and atlased')
    deps=bpy.context.evaluated_depsgraph_get()
    source_objects=[o for o in scene.objects if o.type in {'MESH','CURVE','FONT'} and not o.hide_render and o.name!='Workshop air' and not any(c.name.startswith('05 | Water') for c in o.users_collection)]
    original_objects=list(scene.objects)
    original_lights=[]
    for o in original_objects:
        if o.type=='LIGHT':
            p=o.matrix_world.translation
            original_lights.append({'name':o.name,'type':o.data.type,'position':[S*p.x,S*p.z+TY,-S*p.y],'sourceWatts':o.data.energy,'scaledWatts':o.data.energy*S*S,'colorLinear':list(o.data.color)})
    grouped={};configs={};bake_mats={};source_tris=0
    for n,o in enumerate(sorted(source_objects,key=lambda x:x.name)):
        ev=o.evaluated_get(deps);data=bpy.data.meshes.new_from_object(ev,preserve_all_data_layers=True,depsgraph=deps)
        if not data or not data.polygons:continue
        if len(data.materials)!=1:raise RuntimeError('Expected one source material per authored object: '+o.name)
        mat=data.materials[0]
        if mat is None:raise RuntimeError('Missing authored material: '+o.name)
        label=mat.name+(' / floor' if o.name=='Workshop floor' else '')
        key=safe(label)
        if key not in bake_mats:
            bm=mat.copy();bm.name='WD_SOURCE_'+key;bm.use_fake_user=True
            p=next((x for x in bm.node_tree.nodes if x.type=='BSDF_PRINCIPLED'),None)
            em=next((x for x in bm.node_tree.nodes if x.type=='EMISSION'),None)
            has_texture=any(x.type.startswith('TEX_') and x.type!='TEX_COORD' for x in bm.node_tree.nodes)
            configs[key]={'sourceMaterial':label,'sourceBakeMaterial':bm.name,'resolution':resolution_for(label),'procedural':has_texture,
                'baseColorLinear':color_or_default(p,'Base Color',[1,1,1,1]),
                'roughness':float(p.inputs['Roughness'].default_value) if p else .6,
                'metallic':float(p.inputs['Metallic'].default_value) if p else 0,
                'hasBump':bool(p and p.inputs['Normal'].is_linked),
                'emissionOnly':p is None and em is not None,
                'bulb':label.startswith('Lamp |'), 'glass':label.startswith('Bottle glass'),
                'decimationRatio':ratio_for(label)}
            # Preserve each original object's procedural coordinates through joining.
            for node in list(bm.node_tree.nodes):
                if node.type=='TEX_COORD':
                    for socket,attr in [('Generated','wd_generated'),('Object','wd_object')]:
                        a=bm.node_tree.nodes.new('ShaderNodeAttribute');a.attribute_name=attr
                        for link in list(node.outputs[socket].links):bm.node_tree.links.new(a.outputs['Vector'],link.to_socket)
                elif node.type in {'TEX_NOISE','TEX_VORONOI','TEX_WAVE','TEX_GRADIENT'} and not node.inputs['Vector'].is_linked:
                    a=bm.node_tree.nodes.new('ShaderNodeAttribute');a.attribute_name='wd_generated';bm.node_tree.links.new(a.outputs['Vector'],node.inputs['Vector'])
            bake_mats[key]=bm
        data.materials.clear();data.materials.append(bake_mats[key])
        pos=np.empty(len(data.vertices)*3,dtype=np.float32);data.vertices.foreach_get('co',pos);pos=pos.reshape((-1,3))
        bounds=np.array([list(v) for v in o.bound_box],dtype=np.float32);lo=bounds.min(axis=0);span=bounds.max(axis=0)-lo;span[span<1e-9]=1
        gen=(pos-lo)/span
        object_pos=pos.copy()
        # A reference-object coordinate system (the cold windows) is global.
        explicit=next((x.object for x in mat.node_tree.nodes if x.type=='TEX_COORD' and x.object),None)
        if explicit:
            m=np.array(explicit.matrix_world.inverted()@o.matrix_world,dtype=np.float32)
            object_pos=pos@m[:3,:3].T+m[:3,3]
        for attr,values in [('wd_generated',gen),('wd_object',object_pos)]:
            a=data.attributes.new(attr,'FLOAT_VECTOR','POINT');a.data.foreach_set('vector',np.ascontiguousarray(values).ravel())
        transform=Matrix.Translation((0,0,TY))@Matrix.Diagonal((S,S,S,1))@o.matrix_world
        data.transform(transform);data.update();data.calc_loop_triangles();source_tris+=len(data.loop_triangles)
        copy=bpy.data.objects.new('TEMP | '+o.name,data);col.objects.link(copy);grouped.setdefault(key,[]).append(copy)
        if n%250==0:log('EVALUATED',n,'/',len(source_objects))
    # Authoring data remains in memory for provenance, excluded from bake/export.
    for o in original_objects:o.hide_render=True;o.hide_set(True)
    groups=[]
    for i,key in enumerate(sorted(grouped)):
        bpy.ops.object.select_all(action='DESELECT')
        for o in grouped[key]:o.select_set(True)
        bpy.context.view_layer.objects.active=grouped[key][0]
        bpy.ops.object.join();o=bpy.context.object;o.name='Workshop_'+key
        before=triangles(o)
        mod=o.modifiers.new('Measured runtime simplification','DECIMATE');mod.ratio=configs[key]['decimationRatio'];mod.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        after=triangles(o)
        select(o);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.151917,island_margin=.006,area_weight=.0,correct_aspect=True,scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        o.data.uv_layers.active.name='UVMap'
        configs[key].update({'object':o.name,'trianglesBefore':before,'trianglesAfter':after})
        groups.append(o);log('PREPARED',i+1,len(grouped),key,before,'->',after)
    total=sum(triangles(o) for o in groups)
    if total>500000 or len(groups)>60:raise RuntimeError('Runtime geometry exceeds the declared budget: '+str((total,len(groups))))
    scene['workshop_runtime_prepared']=True;scene['workshop_runtime_configs']=json.dumps(configs);scene['workshop_runtime_lights']=json.dumps(original_lights);scene['workshop_runtime_input_triangles']=source_tris
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=WORK)
    log('PREPARED_CHECKPOINT',total,len(groups),WORK)
else:
    configs=json.loads(scene['workshop_runtime_configs']);groups=[bpy.data.objects[c['object']] for c in configs.values()]
    bake_mats={key:bpy.data.materials[c['sourceBakeMaterial']] for key,c in configs.items()}

# Baking is limited to material data. No lighting/shadows are baked into albedo.
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=False
scene.cycles.max_bounces=4
scene.render.bake.use_selected_to_active=False;scene.render.bake.use_clear=True;scene.render.bake.margin=8
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    for d in prefs.devices:d.use=(d.type=='OPTIX')
    scene.cycles.device='GPU'
except Exception as e:log('CPU_BAKING_FALLBACK',str(e));scene.cycles.device='CPU'

def image(name,res,data=False):
    im=bpy.data.images.new(name,width=res,height=res,alpha=True,float_buffer=False)
    im.colorspace_settings.name='Non-Color' if data else 'sRGB';return im
def save_image(im,path):
    im.filepath_raw=path;im.file_format='PNG';im.save()
def load_image(path,data=False):
    im=bpy.data.images.load(path,check_existing=True);im.colorspace_settings.name='Non-Color' if data else 'sRGB';return im
def set_active_target(mat,img):
    for node in mat.node_tree.nodes:node.select=False
    node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=img;node.select=True;mat.node_tree.nodes.active=node;return node
def capture_input(emit,p,key,links):
    if p and key in p.inputs:
        src=p.inputs[key]
        if src.is_linked:links.new(src.links[0].from_socket,emit.inputs['Color'])
        else:
            v=src.default_value
            emit.inputs['Color'].default_value=tuple(v) if hasattr(v,'__len__') else (float(v),float(v),float(v),1)

def bake_set(o,key,c):
    mat=bake_mats[key];o.data.materials.clear();o.data.materials.append(mat)
    p=next((x for x in mat.node_tree.nodes if x.type=='BSDF_PRINCIPLED'),None)
    original_em=next((x for x in mat.node_tree.nodes if x.type=='EMISSION'),None)
    out=next((x for x in mat.node_tree.nodes if x.type=='OUTPUT_MATERIAL' and x.is_active_output),None)
    surface=out.inputs['Surface'].links[0].from_socket
    coords=np.empty(len(o.data.vertices)*3,dtype=np.float32);o.data.vertices.foreach_get('co',coords)
    uvs=np.empty(len(o.data.loops)*2,dtype=np.float32);o.data.uv_layers.active.data.foreach_get('uv',uvs)
    checksum=hashlib.sha256((SOURCE_HASH+REV+key).encode()+coords.tobytes()+uvs.tobytes()).hexdigest()
    paths={kind:os.path.join(BAKE,key+'-'+kind+'.png') for kind in ['basecolor','normal','orm']}
    needed=['basecolor','orm']+(['normal'] if c['hasBump'] else [])
    if cache.get(key,{}).get('key')==checksum and all(os.path.isfile(paths[k]) for k in needed):
        log('REUSE_BAKE',key);return {k:load_image(paths[k],k!='basecolor') for k in needed}
    select(o)
    imgs={};nodes=mat.node_tree.nodes;links=mat.node_tree.links
    emit=nodes.new('ShaderNodeEmission');emit.inputs['Strength'].default_value=1
    base=image('Baked albedo | '+key,c['resolution'])
    node=set_active_target(mat,base)
    capture_input(emit,p if p else original_em,'Base Color' if p else 'Color',links)
    links.new(emit.outputs[0],out.inputs['Surface'])
    bpy.ops.object.bake(type='EMIT');save_image(base,paths['basecolor']);imgs['basecolor']=base;nodes.remove(node)
    rough=image('Linear roughness | '+key,c['resolution'],True);node=set_active_target(mat,rough)
    for link in list(emit.inputs['Color'].links):links.remove(link)
    capture_input(emit,p,'Roughness',links)
    if p is None:emit.inputs['Color'].default_value=(c['roughness'],)*3+(1,)
    bpy.ops.object.bake(type='EMIT');nodes.remove(node)
    pixels=np.empty(c['resolution']**2*4,dtype=np.float32);rough.pixels.foreach_get(pixels);pixels=pixels.reshape((-1,4))
    packed=np.ones_like(pixels);packed[:,1]=pixels[:,0];packed[:,2]=c['metallic']
    orm=image('ORM | '+key,c['resolution'],True);orm.pixels.foreach_set(packed.ravel());save_image(orm,paths['orm']);imgs['orm']=orm
    bpy.data.images.remove(rough)
    links.new(surface,out.inputs['Surface']);nodes.remove(emit)
    if c['hasBump']:
        normal=image('Tangent normal | '+key,c['resolution'],True);node=set_active_target(mat,normal)
        bpy.ops.object.bake(type='NORMAL',normal_space='TANGENT',normal_r='POS_X',normal_g='POS_Y',normal_b='POS_Z')
        save_image(normal,paths['normal']);imgs['normal']=normal;nodes.remove(node)
    cache[key]={'key':checksum,'files':{k:os.path.basename(paths[k]) for k in needed},'resolution':c['resolution'],'sourceMaterial':c['sourceMaterial']}
    with open(cachepath,'w',encoding='utf-8') as f:json.dump(cache,f,indent=2)
    log('BAKED',key,needed,c['resolution']);return imgs

def optimized_maps(key,c,raw):
    mat=bake_mats[key];p=next((x for x in mat.node_tree.nodes if x.type=='BSDF_PRINCIPLED'),None)
    em=next((x for x in mat.node_tree.nodes if x.type=='EMISSION'),None)
    needed=[]
    if (p and p.inputs['Base Color'].is_linked) or (not p and em and em.inputs['Color'].is_linked):needed.append('basecolor')
    if p and p.inputs['Roughness'].is_linked:needed.append('orm')
    if c['hasBump']:needed.append('normal')
    result={};files={};sizes={}
    name=c['sourceMaterial']
    for channel in needed:
        if channel=='basecolor':
            res=1024 if name.startswith(('Oak |','Walnut |','Stage |','Wall |','Brass |','Window |')) and '/ floor' not in name else 512
            if name.startswith(('Gold thread','Steel |')):res=256
        elif channel=='normal':
            res=512 if name.startswith(('Oak |','Walnut |','Stage |','Wall |','Brass |','Forest green','Ivy | waxy','Blackened iron')) and '/ floor' not in name else 256
        else:
            res=512 if name.startswith(('Oak |','Walnut |','Stage |')) and '/ floor' not in name else 256
            if name.startswith(('Gold thread','Steel |')):res=128
        source=raw[channel];before=tuple(source.size);small=source.copy();small.name='Runtime '+channel+' | '+key;small.scale(res,res)
        if tuple(source.size)!=before:raise RuntimeError('Resizing changed the retained full bake')
        if channel=='normal':
            pixels=np.empty(res*res*4,dtype=np.float32);small.pixels.foreach_get(pixels);pixels=pixels.reshape((-1,4))
            vec=pixels[:,:3]*2-1;vec/=np.maximum(np.linalg.norm(vec,axis=1,keepdims=True),1e-8);pixels[:,:3]=vec*.5+.5
            small.pixels.foreach_set(pixels.ravel())
        path=os.path.join(TEX,key+'-'+channel+'.png');save_image(small,path)
        result[channel]=small;files[channel]=os.path.relpath(path,OUT).replace('\\','/');sizes[channel]=[res,res]
    return result,files,sizes

def runtime_material(key,c,imgs):
    mat=bpy.data.materials.new('Workshop PBR | '+key);mat.use_nodes=True;mat.use_backface_culling=False
    nodes,links=mat.node_tree.nodes,mat.node_tree.links;p=nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=c['baseColorLinear'];p.inputs['Roughness'].default_value=c['roughness'];p.inputs['Metallic'].default_value=c['metallic']
    mat.diffuse_color=tuple(c['baseColorLinear'])
    if 'basecolor' in imgs:
        b=nodes.new('ShaderNodeTexImage');b.image=imgs['basecolor'];b.label='sRGB albedo, no lighting';links.new(b.outputs['Color'],p.inputs['Base Color'])
    if 'orm' in imgs:
        orm=nodes.new('ShaderNodeTexImage');orm.image=imgs['orm'];sep=nodes.new('ShaderNodeSeparateColor');sep.mode='RGB';links.new(orm.outputs['Color'],sep.inputs[0]);links.new(sep.outputs['Green'],p.inputs['Roughness']);links.new(sep.outputs['Blue'],p.inputs['Metallic'])
    if 'normal' in imgs:
        t=nodes.new('ShaderNodeTexImage');t.image=imgs['normal'];n=nodes.new('ShaderNodeNormalMap');n.space='TANGENT';links.new(t.outputs['Color'],n.inputs['Color']);links.new(n.outputs['Normal'],p.inputs['Normal'])
    if c['emissionOnly'] and 'basecolor' in imgs:
        links.new(b.outputs['Color'],p.inputs['Emission Color']);p.inputs['Emission Strength'].default_value=.65
    if c['bulb']:
        p.inputs['Emission Color'].default_value=(1,.49,.15,1);p.inputs['Emission Strength'].default_value=1
    if c['glass']:
        p.inputs['Alpha'].default_value=.30;p.inputs['Roughness'].default_value=.18
        mat.surface_render_method='DITHERED'
    return mat

records=[]
for i,key in enumerate(sorted(configs)):
    c=configs[key];o=bpy.data.objects[c['object']]
    log('MATERIAL',i+1,len(configs),key)
    raw=bake_set(o,key,c) if c['procedural'] else {}
    imgs,files,sizes=optimized_maps(key,c,raw) if raw else ({},{},{})
    mat=runtime_material(key,c,imgs);o.data.materials.clear();o.data.materials.append(mat)
    # Only standard runtime attributes are serialized; procedural attributes are authoring data.
    records.append({**c,'runtimeMaterial':mat.name,'textures':files,'textureDimensions':sizes,'normalConvention':'+Y / OpenGL','colorSpace':{'basecolor':'sRGB','normal':'linear','orm':'linear'}})

bpy.ops.object.select_all(action='DESELECT')
for o in groups:o.hide_render=False;o.hide_set(False);o.select_set(True)
bpy.context.view_layer.objects.active=groups[0]
target=os.path.join(OUT,'workshop-runtime.glb')
bpy.ops.export_scene.gltf(filepath=target,export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_normals=True,export_tangents=True,export_texcoords=True,export_materials='EXPORT',export_cameras=False,export_lights=False,export_animations=False,export_extras=False,export_attributes=False,export_image_format='AUTO')
if hashlib.sha256(open(SOURCE,'rb').read()).hexdigest()!=SOURCE_HASH:raise RuntimeError('Source changed during export')
lo=[math.inf]*3;hi=[-math.inf]*3
for o in groups:
    for v in o.data.vertices:
        p=(v.co.x,v.co.z,-v.co.y)
        for k in range(3):lo[k]=min(lo[k],p[k]);hi[k]=max(hi[k],p[k])
contract={
    'asset':'workshop-runtime.glb','version':1,'stable':False,'verification':'pending independent GLB parser and reimport',
    'source':{'path':'output/blender/WaterDuel_Atelier.blend','sha256':SOURCE_HASH,'preserved':True},
    'coordinateTransform':{'sourceUp':'Z','runtimeUp':'Y','sourceDepth':'+Y','runtimeDepth':'-Z','scale':S,'translationRuntimeY':TY,'appliedToGeometry':True,'nodeTransformRequired':False,'formula':['x=s*source.x','y=s*source.z+t','z=-s*source.y']},
    'stage':{'sourceTopZ':1.15,'runtimeTopY':.3245,'runtimeBoardWidth':7.6,'nominalBoardX':[-3.8,3.8],'nominalDepthZ':[-2.6*S,2.6*S]},
    'bounds':{'min':lo,'max':hi},
    'budgets':{'maxTriangles':500000,'maxDrawGroups':60,'measuredTriangles':sum(triangles(o) for o in groups),'measuredGroups':len(groups)},
    'materials':records,'texturesEmbedded':True,'externalNetworkRequired':False,
    'lighting':{'mode':'dynamic runtime lighting; albedo contains no baked illumination','hints':json.loads(scene['workshop_runtime_lights']),'note':'Emissive surfaces do not light a raster scene without runtime lights. No cameras or lights are exported.'},
    'physics':{'staticWaterRemoved':True,'collisionProxies':False,'tableTopMustUseRuntimePhysics':True,'note':'Do not derive new simulation collision from the decorative GLB.'},
    'limitations':['Mesh geometry and procedural material detail are simplified and baked for runtime.','No Cycles lighting, volume fog, DOF or static fluid is exported.','Plain glTF 2.0 without Draco/Meshopt/KTX2; runtime loader handles embedded PNG metallic-roughness and tangent normals.'],
    'export':{'blenderVersion':bpy.app.version_string,'sourceTrianglesAfterExclusions':scene['workshop_runtime_input_triangles'],'fileBytes':os.path.getsize(target),'seconds':time.time()-start,'pipeline':REV}
}
write_json('asset-contract.json',contract)
write_json('export-receipt.json',{'file':'workshop-runtime.glb','sha256':hashlib.sha256(open(target,'rb').read()).hexdigest(),'bytes':os.path.getsize(target),'triangles':contract['budgets']['measuredTriangles'],'groups':len(groups),'sourceSha256':SOURCE_HASH,'sourcePreserved':True,'seconds':time.time()-start})
# Full-resolution bakes belong to the authoring cache, not the shipped namespace.
keep={os.path.basename(file) for r in records for file in r['textures'].values()}
for file in os.listdir(TEX):
    if file.endswith('.png') and file not in keep:os.remove(os.path.join(TEX,file))
if os.path.isfile(legacy):os.remove(legacy)
log('EXPORTED',target,contract['budgets'],os.path.getsize(target))
