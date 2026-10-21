"""Render the delivered GLBs together, using their exported meshes and materials."""
import bpy, math
from pathlib import Path
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets/characters/water-mannequin/v2'
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'docs/assets/characters/v2/water-mannequin.blend'))
scene=bpy.context.scene
for obj in list(bpy.data.collections['WaterDuel_Character'].objects):bpy.data.objects.remove(obj,do_unlink=True)
all_meshes=[]
for filename,x,mirror in [('water-mannequin.glb',-1.72,False),('water-mannequin-boss.glb',1.72,True)]:
    bpy.ops.import_scene.gltf(filepath=str(OUT/filename));objects=list(bpy.context.selected_objects)
    anchor=bpy.data.objects.new('Presentation_'+filename,None);scene.collection.objects.link(anchor)
    for obj in objects:
        if obj.parent is None:
            old=obj.matrix_world.copy();obj.parent=anchor;obj.matrix_world=old
        if obj.type=='MESH':all_meshes.append(obj)
    anchor.location.x=x
    if mirror:anchor.scale.x=-1
light=bpy.data.lights.new('Boss_Front_Softbox','AREA');light.energy=400;light.shape='DISK';light.size=3
obj=bpy.data.objects.new('Boss_Front_Softbox',light);scene.collection.objects.link(obj);obj.location=(3,-4,4.5)
obj.rotation_euler=(Vector((1.4,0,1.5))-obj.location).to_track_quat('-Z','Y').to_euler()
light.color=(1,.84,.61)
camera=scene.camera;camera.location=(2.5,-11,3.4);camera.rotation_euler=(Vector((0,0,1.5))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.resolution_x=1800;scene.render.resolution_y=1150;scene.render.resolution_percentage=100
bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();pp=[]
for obj in all_meshes:
    evaluated=obj.evaluated_get(dg);mesh=evaluated.to_mesh();pp.extend(evaluated.matrix_world@v.co for v in mesh.vertices);evaluated.to_mesh_clear()
inverse=camera.matrix_world.inverted();pp=[inverse@p for p in pp]
xmin=min(p.x for p in pp);xmax=max(p.x for p in pp);ymin=min(p.y for p in pp);ymax=max(p.y for p in pp)
camera.location+=camera.rotation_euler.to_matrix()@Vector(((xmin+xmax)/2,(ymin+ymax)/2,0))
camera.data.ortho_scale=max(xmax-xmin,(ymax-ymin)*1800/1150)*1.12
scene.cycles.samples=64;scene.cycles.use_denoising=True
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    for d in prefs.devices:d.use=d.type!='CPU'
    if any(d.use for d in prefs.devices):scene.cycles.device='GPU'
except Exception:pass
scene.render.filepath=str(OUT/'waterduel-models-v2.png')
scene['presentation_note']='Independent studio render of delivered GLBs; mirrored boss for comparison. Not game runtime.'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'docs/assets/characters/v2/models-preview.blend'))
bpy.ops.render.render(write_still=True)
print('WD_V2_PRESENTATION_READY',flush=True)
