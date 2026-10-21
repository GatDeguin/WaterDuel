"""Reimport shipped GLBs and render the inspection board from those files.

Run after create-workshop-equipment.py. Leaves game runtime untouched.
"""
import bpy
import json
import math
import shutil
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets/equipment/workshop'
SOURCE=ROOT/'docs/assets/equipment/workshop-arsenal.blend'
contract=json.loads((OUT/'asset-contract.json').read_text(encoding='utf-8'))
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene=bpy.context.scene
bpy.context.preferences.filepaths.save_version=0
for collection in bpy.data.collections:
    if collection.name.startswith('Equipment_'):collection.hide_render=True
for asset in contract['assets']:
    plate=bpy.data.objects.get('Plate_'+asset['id'])
    if asset['role']=='primary' and plate:plate.location.z=.76
records=[];imported_all=[];groups={};initial_materials=set(bpy.data.materials);initial_images=set(bpy.data.images);initial_meshes=set(bpy.data.meshes)
for asset in contract['assets']:
    identifier=asset['id'];existing=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(OUT/asset['file']))
    imported=[obj for obj in bpy.data.objects if obj not in existing]
    imported_all.extend(imported)
    groups[identifier]=imported
    root=next(obj for obj in imported if obj.name=='WD_'+identifier+'_Asset')
    meshes=[obj for obj in imported if obj.type=='MESH']
    bpy.context.view_layer.update()
    points=[obj.matrix_world@Vector(corner) for obj in meshes for corner in obj.bound_box]
    bounds={'min':[min(v[i] for v in points) for i in range(3)],'max':[max(v[i] for v in points) for i in range(3)]}
    expected=asset['source_bounds']
    error=max(abs(bounds[key][i]-expected[key][i]) for key in ('min','max') for i in range(3))
    if error>1e-4:raise RuntimeError(f'{identifier}: roundtrip dimensions changed by {error}')
    socket_names=[obj.get('socket_name',obj.name) for obj in imported if obj.type=='EMPTY' and obj.get('socket')]
    triangles=0
    for obj in meshes:obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
    if triangles!=asset['triangles']:raise RuntimeError(f'{identifier}: roundtrip triangle mismatch')
    records.append({'id':identifier,'bounds_max_error':error,'triangles':triangles,'sockets':socket_names,'material_slots':sum(len(obj.data.materials) for obj in meshes)})
    root.location=bpy.data.objects['WD_'+identifier].location
scene.render.resolution_x=2200;scene.render.resolution_y=1500
scene.render.filepath=str(OUT/'workshop-arsenal-glb-preview.png')
bpy.ops.render.render(write_still=True)
shutil.copyfile(OUT/'workshop-arsenal-glb-preview.png',OUT/'workshop-arsenal-preview.png')
# The shield closeups also come from the shipped meshes after UV inspection.
camera=scene.camera;camera_matrix=camera.matrix_world.copy();ortho=camera.data.ortho_scale
for identifier in ('short','long'):
    for obj in imported_all:obj.hide_render=obj not in groups[identifier]
    for obj in bpy.data.collections['Presentation_Only'].objects:
        if obj.type not in ('CAMERA','LIGHT'):obj.hide_render=True
    root=next(obj for obj in groups[identifier] if obj.name=='WD_'+identifier+'_Asset')
    position=root.location.copy();root.location=(0,0,0)
    asset=next(asset for asset in contract['assets'] if asset['id']==identifier)
    low=Vector(asset['source_bounds']['min']);high=Vector(asset['source_bounds']['max']);target=(low+high)/2;size=max(high-low)
    camera.location=target+Vector((size*.38,-size*3,size*.30));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=size*1.35
    scene.render.resolution_x=850;scene.render.resolution_y=1050
    scene.render.filepath=str(OUT/'previews'/(identifier+'.png'));bpy.ops.render.render(write_still=True)
    root.location=position
camera.matrix_world=camera_matrix;camera.data.ortho_scale=ortho
scene.render.resolution_x=2200;scene.render.resolution_y=1500
for obj in bpy.data.collections['Presentation_Only'].objects:obj.hide_render=False
(OUT/'roundtrip-validation.json').write_text(json.dumps({'ok':True,'source':'Shipped GLBs imported through Blender glTF importer','assets':records,'preview':'workshop-arsenal-glb-preview.png'},indent=2),encoding='utf-8')
# Remove only newly imported delivery meshes; preserve the editable authoring source.
for obj in reversed(imported_all):bpy.data.objects.remove(obj,do_unlink=True)
for mesh in list(bpy.data.meshes):
    if mesh not in initial_meshes and mesh.users==0:bpy.data.meshes.remove(mesh)
for material in list(bpy.data.materials):
    if material not in initial_materials and material.users==0:bpy.data.materials.remove(material)
for image in list(bpy.data.images):
    if image not in initial_images and image.users==0:bpy.data.images.remove(image)
for collection in bpy.data.collections:
    if collection.name.startswith('Equipment_'):collection.hide_render=False
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE))
print('ROUNDTRIP_EQUIPMENT_OK '+str(len(records)),flush=True)
