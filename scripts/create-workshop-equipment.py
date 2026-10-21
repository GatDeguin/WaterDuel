"""Build detailed, socketed GLB equipment and editable Blender source.

Run with Blender --background --factory-startup --python this file.
Only the new workshop asset namespaces are written. No game runtime is edited.
"""
import bpy
import math
import json
import sys
import hashlib
from pathlib import Path
from mathutils import Vector, Matrix

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from equipment_common import EquipmentContext,make_materials
from equipment_weapons import build_weapons
from equipment_defenses import build_defenses

OUT=ROOT/'public/assets/equipment/workshop'
SOURCE=ROOT/'docs/assets/equipment'
PREVIEWS=OUT/'previews'
for directory in (OUT,SOURCE,PREVIEWS):directory.mkdir(parents=True,exist_ok=True)
NO_RENDER='--no-render' in sys.argv

# Background factory startup is deliberately isolated from open artist scenes.
for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
scene=bpy.context.scene
bpy.context.preferences.filepaths.save_version=0
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
ctx=EquipmentContext(make_materials(SOURCE/'textures'))
build_weapons(ctx);build_defenses(ctx)
bpy.context.view_layer.update()

def export_asset(b):
    bpy.ops.object.select_all(action='DESELECT')
    temp=bpy.data.collections.new('Export_'+b.id);scene.collection.children.link(temp)
    exported=[];depsgraph=bpy.context.evaluated_depsgraph_get()
    for source in b.objects:
        evaluated=source.evaluated_get(depsgraph)
        data=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=depsgraph)
        obj=bpy.data.objects.new('Export_'+source.name,data);temp.objects.link(obj)
        obj.matrix_world=source.matrix_world.copy();obj.select_set(True);exported.append(obj)
    bpy.context.view_layer.objects.active=exported[0]
    bpy.ops.object.join();joined=bpy.context.object;joined.name='Render_'+b.id
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    # Consolidate repeated material slots; source pieces remain separate/editable.
    original=list(joined.data.materials);unique=[];indices={}
    for mat in original:
        if mat.name not in indices:indices[mat.name]=len(unique);unique.append(mat)
    remap=[indices[m.name] for m in original]
    face_materials=[remap[p.material_index] for p in joined.data.polygons]
    joined.data.materials.clear()
    for mat in unique:joined.data.materials.append(mat)
    for polygon,index in zip(joined.data.polygons,face_materials):polygon.material_index=index
    root=bpy.data.objects.new('WD_'+b.id+'_Asset',None);temp.objects.link(root)
    for k in b.root.keys():root[k]=b.root[k]
    joined.parent=root
    socket_data=[]
    for source in b.sockets:
        socket_name=source.get('socket_name',source.name)
        socket=bpy.data.objects.new(socket_name,None);temp.objects.link(socket);socket.parent=root
        socket.location=source.location
        for k in source.keys():socket[k]=source[k]
        socket.select_set(True)
        x,y,z=source.location;socket_data.append({'name':socket_name,'position_source':[x,y,z],'position_glb':[x,z,-y]})
    root.select_set(True);joined.select_set(True)
    bpy.context.view_layer.objects.active=joined
    joined.data.calc_loop_triangles()
    triangles=len(joined.data.loop_triangles)
    if triangles>25000:raise RuntimeError(f'{b.id}: {triangles} exceeds 25000 triangle budget')
    bounds=[tuple(joined.matrix_world@Vector(c)) for c in joined.bound_box]
    source_bounds={'min':[min(p[i] for p in bounds) for i in range(3)],'max':[max(p[i] for p in bounds) for i in range(3)]}
    target=OUT/(b.id+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,
        export_apply=True,export_extras=True,export_animations=False,export_yup=True,
        export_materials='EXPORT',export_normals=True,export_texcoords=True,
        export_cameras=False,export_lights=False)
    asset={'id':b.id,'label':b.label,'role':b.role,'file':target.name,'triangles':triangles,
        'source_parts':len(b.objects),'materials':[m.name for m in unique],
        'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
        'sockets':socket_data,'source_bounds':source_bounds}
    for obj in list(temp.objects):bpy.data.objects.remove(obj,do_unlink=True)
    bpy.data.collections.remove(temp)
    print('EQUIPMENT_EXPORTED '+json.dumps(asset,ensure_ascii=False),flush=True)
    return asset

assets=[export_asset(b) for b in ctx.assets]
contract={
    'version':1,'asset_set':'WaterDuel · Piezas del taller','date':'2026-10-17',
    'references':['docs/referencias/w1.png','docs/referencias/w2.png','docs/referencias/w3.png','docs/referencias/w4.png'],
    'source':'docs/assets/equipment/workshop-arsenal.blend',
    'author_script':'scripts/create-workshop-equipment.py',
    'source_axes':{'across':'+X','front':'-Y','long_axis':'+Z','units':'metres','origin':'hand grip centre'},
    'glb_axes':{'across':'+X','front':'+Z','long_axis':'+Y','units':'metres','conversion':'(x,y,z) source -> (x,z,-y) glTF'},
    'attachment':{
        'primary':'Align GLB +Y with tip-mainHand; attach Socket_Grip_Main to character Socket_MainHand.',
        'secondary':'Attach Socket_Grip_Secondary to character Socket_SecondaryHand; shield front GLB +Z.',
        'maul':'Both hands required; secondary grip local GLB (0,-0.22,0). Hide shield/dagger.',
        'knife':'Secondary parry only; do not equip as primary or award an independent attack.',
        'none':'Intentional absence of a model and collider; no none.glb.',
        'character_preview':'Hide character nodes Preview_Rapier_* before attaching a primary asset.',
        'character_contract':'public/assets/characters/water-mannequin/rig-contract.json'
    },
    'collision':{
        'authority':'public/equipment.js and physical rig remain authoritative; render meshes never become colliders automatically.',
        'weapons':'Socket_Strike marks nominal rest contact reach; broad axe/maul head edges are documented separately from decorative bevels.',
        'shields':'Nominal short radius .23; long radii .22/.36; active guard scaling follows current engine catalog.',
        'scale':'World metres are authored scale; compare grip-to-strike length before retargeting character.'
    },
    'rendering':{'materials':'glTF metallic-roughness PBR; embedded basecolor and tangent normal textures; dynamic lighting',
        'textures':'512px shared sources, embedded in each self-contained GLB',
        'optimization':'Evaluated geometry joined per asset, duplicate material slots consolidated, static rigid models; no external decoder required.',
        'compression':'No Draco/Meshopt runtime dependency added. GLB uses uncompressed indexed triangles.',
        'lod':'Single detailed tier; existing procedural geometry remains available as low-cost fallback.'},
    'runtime_integrated':False,'assets':assets
}
(OUT/'asset-contract.json').write_text(json.dumps(contract,indent=2,ensure_ascii=False),encoding='utf-8')

# A genuine rendered inspection board; all display objects are excluded from GLB.
studio=bpy.data.collections.new('Presentation_Only');scene.collection.children.link(studio)
def studio_object(obj):
    for col in list(obj.users_collection):col.objects.unlink(obj)
    studio.objects.link(obj);return obj

def display_text(name,text,loc,size,color):
    data=bpy.data.curves.new(name,'FONT');data.body=text;data.size=size;data.align_x='CENTER'
    data.extrude=.0001;obj=bpy.data.objects.new(name,data);studio.objects.link(obj)
    obj.location=loc;obj.rotation_euler=(math.pi/2,0,0);data.materials.append(ctx.materials[color]);return obj

def area(name,position,color,power,size,target=(0,0,1.3)):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);studio.objects.link(obj);obj.location=position
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler();return obj

boardmat=bpy.data.materials.new('Presentation_Petrol');boardmat.diffuse_color=(.016,.042,.036,1);boardmat.use_nodes=True
bs=boardmat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.016,.042,.036,1);bs.inputs['Roughness'].default_value=.72
bpy.ops.mesh.primitive_cube_add(size=1,location=(0,.22,1.36));board=studio_object(bpy.context.object);board.name='Preview_Workshop_Board';board.scale=(4.6,.10,3.08);board.data.materials.append(boardmat)
for x in (-2.28,2.28):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(x,.13,1.36));obj=studio_object(bpy.context.object);obj.name='Board_Frame_Vertical_'+str(x);obj.scale=(.024,.05,3.08);obj.data.materials.append(ctx.materials['brass_dark'])
for z in (-.17,2.89):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,.13,z));obj=studio_object(bpy.context.object);obj.name='Board_Frame_Horizontal_'+str(z);obj.scale=(4.58,.05,.024);obj.data.materials.append(ctx.materials['brass_dark'])
layout={'sword':(-1.68,0,1.32),'spear':(-.56,0,1.15),'axe':(.56,0,1.33),'maul':(1.68,0,1.27),
    'short':(-1.40,-.02,.30),'long':(0,-.02,.33),'knife':(1.40,-.02,.22)}
for b in ctx.assets:
    b.root.location=layout[b.id]
    display_text('Plate_'+b.id,b.label.upper(),(layout[b.id][0],-.145,.76 if b.role=='primary' else -.14),.058,'ivory')
display_text('Board_Title','WATERDUEL  /  PIEZAS DEL TALLER',(0,-.04,2.70),.10,'brass')
display_text('Board_Subtitle','MADERA · LATON · ACERO · CUERO',(0,-.04,2.58),.040,'ivory')
camera_data=bpy.data.cameras.new('Inspection_Camera');camera=bpy.data.objects.new('Inspection_Camera',camera_data);studio.objects.link(camera)
camera.location=(3,-10,4.0);camera.rotation_euler=(Vector((0,0,1.3))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=5.45;scene.camera=camera
area('Warm_Workshop_Key',(-3,-4,5),(1,.77,.48),600,4)
area('Neutral_Steel_Fill',(3,-3,3),(.70,.86,1),430,3)
area('Edge_Kicker',(0,.0,5),(1,.92,.71),350,2)
world=bpy.data.worlds.new('Workshop_Studio_World');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.08,.11,.105,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.32;scene.world=world
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_percentage=100;scene.render.resolution_x=2200;scene.render.resolution_y=1500
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
source_path=SOURCE/'workshop-arsenal.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
if not NO_RENDER:
    scene.render.filepath=str(OUT/'workshop-arsenal-preview.png');bpy.ops.render.render(write_still=True)
    # Per-piece previews use the same neutral studio materials and real meshes.
    board.hide_render=True
    for obj in studio.objects:
        if obj.name.startswith(('Plate_','Board_','Preview_')):obj.hide_render=True
    for b in ctx.assets:
        for other in ctx.assets:
            for obj in [other.root,*other.objects]:obj.hide_render=other is not b
        b.root.location=(0,0,0);bpy.context.view_layer.update()
        corners=[obj.matrix_world@Vector(c) for obj in b.objects if obj.type=='MESH' for c in obj.bound_box]
        low=Vector([min(p[i] for p in corners) for i in range(3)]);high=Vector([max(p[i] for p in corners) for i in range(3)])
        target=(low+high)/2;size=max(high-low)
        camera.location=target+Vector((size*.38,-size*3,size*.30));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
        camera.data.ortho_scale=size*1.35
        scene.render.resolution_x=850;scene.render.resolution_y=1050
        scene.render.filepath=str(PREVIEWS/(b.id+'.png'));bpy.ops.render.render(write_still=True)
        b.root.location=layout[b.id]
    for b in ctx.assets:
        for obj in [b.root,*b.objects]:obj.hide_render=False
    for obj in studio.objects:obj.hide_render=False
    camera.location=(3,-10,4.0);camera.rotation_euler=(Vector((0,0,1.3))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=5.45
    scene.render.resolution_x=2200;scene.render.resolution_y=1500
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
print('WORKSHOP_ASSETS_COMPLETE '+str(OUT),flush=True)
