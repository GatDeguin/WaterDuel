"""Render material-only v2 from the exact delivered GLBs, not a geometry export."""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
V1=ROOT/'public/assets/equipment/workshop'
OUT=V1/'v2'
SOURCE=ROOT/'docs/assets/equipment/v2'
PREVIEWS=OUT/'previews'
PREVIEWS.mkdir(parents=True,exist_ok=True)
contract=json.loads((OUT/'asset-contract.json').read_text(encoding='utf-8'))
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'docs/assets/equipment/workshop-arsenal.blend'))
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.cycles.samples=24
layout={}
for asset in contract['assets']:
    layout[asset['id']]=bpy.data.objects['WD_'+asset['id']].location.copy()
# Keep only the inspection stage; import each frozen v2 GLB as the source mesh.
for collection in list(bpy.data.collections):
    if collection.name.startswith('Equipment_'):
        for obj in list(collection.objects):bpy.data.objects.remove(obj,do_unlink=True)
        bpy.data.collections.remove(collection)
for material in list(bpy.data.materials):
    if material.users==0:bpy.data.materials.remove(material)
    elif material.name.startswith('WD_'):material.name='Presentation_'+material.name
groups={};records=[]
for asset in contract['assets']:
    existing=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(OUT/asset['file']))
    imported=[obj for obj in bpy.data.objects if obj not in existing];groups[asset['id']]=imported
    root=next(obj for obj in imported if obj.name=='WD_'+asset['id']+'_Asset')
    bpy.context.view_layer.update()
    meshes=[obj for obj in imported if obj.type=='MESH']
    points=[obj.matrix_world@Vector(corner) for obj in meshes for corner in obj.bound_box]
    bounds={'min':[min(v[i] for v in points) for i in range(3)],'max':[max(v[i] for v in points) for i in range(3)]}
    error=max(abs(bounds[key][i]-asset['source_bounds'][key][i]) for key in ('min','max') for i in range(3))
    triangles=0
    for obj in meshes:obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
    if error>1e-5 or triangles!=asset['triangles']:raise RuntimeError('Material import changed geometry for '+asset['id'])
    records.append({'id':asset['id'],'bounds_max_error':error,'triangles':triangles})
    root.location=layout[asset['id']]
    for obj in imported:
        if obj.get('socket'):obj.name=asset['id']+'__'+obj.get('socket_name',obj.name.split('.')[0])
# Give the lower captions room inside the inspection board. Presentation only.
board=bpy.data.objects['Preview_Workshop_Board']
board.location.z=1.285;board.scale.z=3.23
for obj in bpy.data.collections['Presentation_Only'].objects:
    if obj.name.startswith('Board_Frame_Vertical_'):
        obj.location.z=1.285;obj.scale.z=3.23
    elif obj.name.startswith('Board_Frame_Horizontal_') and obj.location.z<0:
        obj.location.z=-.32
scene.render.resolution_x=2200;scene.render.resolution_y=1500
scene.render.filepath=str(OUT/'workshop-materials-v2-preview.png')
bpy.ops.render.render(write_still=True)
camera=scene.camera;camera_matrix=camera.matrix_world.copy();ortho=camera.data.ortho_scale
studio=bpy.data.collections['Presentation_Only']
for obj in studio.objects:
    if obj.type not in ('CAMERA','LIGHT'):obj.hide_render=True
for identifier in ('sword','maul','long','knife'):
    for key,objects in groups.items():
        for obj in objects:obj.hide_render=key!=identifier
    root=next(obj for obj in groups[identifier] if obj.name=='WD_'+identifier+'_Asset')
    root.location=(0,0,0)
    asset=next(a for a in contract['assets'] if a['id']==identifier)
    low=Vector(asset['source_bounds']['min']);high=Vector(asset['source_bounds']['max'])
    # These closeups make normal and roughness variation legible on real parts.
    if identifier=='sword':low=Vector((-.20,-.18,-.23));high=Vector((.20,.18,.24))
    if identifier=='maul':low=Vector((-.30,-.19,.66));high=Vector((.30,.19,1.10))
    target=(low+high)/2;size=max(high-low)
    camera.location=target+Vector((size*.38,-size*3,size*.30));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=size*1.3
    scene.render.resolution_x=900;scene.render.resolution_y=1050
    scene.render.filepath=str(PREVIEWS/(identifier+'-detail.png'));bpy.ops.render.render(write_still=True)
    root.location=layout[identifier]
for objects in groups.values():
    for obj in objects:obj.hide_render=False
for obj in studio.objects:obj.hide_render=False
camera.matrix_world=camera_matrix;camera.data.ortho_scale=ortho
scene.render.resolution_x=2200;scene.render.resolution_y=1500
# This is an editable v2 material inspection source. No GLB is re-exported.
for image in bpy.data.images:
    if image.source=='FILE' and not image.packed_file:
        try:image.pack()
        except RuntimeError:pass
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'workshop-arsenal-materials-v2.blend'))
(OUT/'roundtrip-validation.json').write_text(json.dumps({'ok':True,'assets':records,'source':'Exact v2 GLBs imported through Blender; no geometry export','preview':'workshop-materials-v2-preview.png'},indent=2),encoding='utf-8')
print('MATERIALS_V2_RENDER_OK '+str(len(records)),flush=True)
