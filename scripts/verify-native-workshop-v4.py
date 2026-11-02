"""Read-only native v4 day/night rig and camera checks; no scene saves."""
import bpy,json,math,hashlib
from pathlib import Path
from bpy_extras.anim_utils import action_get_channelbag_for_slot
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output/blender'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def cameras(scene):return {o.name:{'matrix':[list(v) for v in o.matrix_world],'lens':o.data.lens,'sensorWidth':o.data.sensor_width,'focus':o.data.dof.focus_distance,'fstop':o.data.dof.aperture_fstop} for o in scene.objects if o.type=='CAMERA'}
bpy.ops.wm.open_mainfile(filepath=str(OUT/'WaterDuel_Atelier_v3.blend'));baseline=cameras(bpy.context.scene)
references={im.name for im in bpy.data.images if any(Path(im.filepath).stem.lower()==f'w{i}' for i in range(1,5))}
assert len(references)==4,'Expected all four packed source references'
reports=[]
for file in ('WaterDuel_Atelier_v4.blend','WaterDuel_Atelier_v4_noche.blend'):
 path=OUT/file;before=sha(path);bpy.ops.wm.open_mainfile(filepath=str(path));scene=bpy.context.scene
 assert cameras(scene)==baseline,'Original cameras changed'
 lights=[o for o in scene.objects if o.type=='LIGHT'];meshes=[o for o in scene.objects if o.type=='MESH' and not o.hide_render]
 assert len(lights)==22 and len(meshes)==56
 images=[im for im in bpy.data.images if im.source=='FILE' and im.filepath]
 assert all(im.packed_file or len(im.packed_files) for im in images),'Editable depends on external images'
 assert references.issubset({im.name for im in images}),'Lost reference image'
 rotor=bpy.data.objects['Workshop_FanRotor'];animation=rotor.animation_data
 bag=action_get_channelbag_for_slot(animation.action,animation.action_slot)
 curves=[c for c in bag.fcurves if c.data_path=='rotation_axis_angle' and c.array_index==0]
 assert len(curves)==1 and all(p.interpolation=='LINEAR' for p in curves[0].keyframe_points)
 assert any(m.type=='CYCLES' for m in curves[0].modifiers)
 scene.frame_set(1);pivot=rotor.matrix_world.translation.copy();samples=[];fps=scene.render.fps/scene.render.fps_base
 for degrees in (0,90,180,360,450):
  frame=1+math.radians(degrees)/7.2*fps;scene.frame_set(math.floor(frame),subframe=frame%1);bpy.context.view_layer.update()
  drift=(rotor.matrix_world.translation-pivot).length;error=abs(math.atan2(math.sin(rotor.rotation_axis_angle[0]-math.radians(degrees)),math.cos(rotor.rotation_axis_angle[0]-math.radians(degrees))))
  assert drift<1e-6 and error<1e-5;samples.append({'degrees':degrees,'pivotDrift':drift,'angularError':error})
 glass=bpy.data.materials['Workshop v4 PBR | old undulating window glass'];p=next(n for n in glass.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 assert abs(p.inputs['Alpha'].default_value-.66)<1e-5
 assert glass.use_backface_culling,'Closed alpha glass must cull its rear skin'
 window=bpy.data.objects['Workshop_window-cold-diffuse-daylight'];mesh=window.data
 assert mesh.attributes.get('wd_v4_glass_phase') and mesh.attributes.get('wd_v4_glass_broad'),'Continuous glass domain missing'
 tilt=max(math.degrees(math.acos(min(1,abs(mesh.corner_normals[i].vector.y)))) for face in mesh.polygons if mesh.attributes['wd_v4_glass_broad'].data[face.index].value for i in face.loop_indices)
 assert tilt<5,'Bevel normals leaked into broad glass faces'
 assert sha(path)==before
 reports.append({'file':file,'sha256':before,'lights':22,'visibleMeshes':56,'camerasPreserved':True,'linearCyclicFan':True,'samples':samples,'windowAlpha':p.inputs['Alpha'].default_value,'glassMaxBroadFaceTiltDegrees':tilt,'packedFileImages':len(images),'referencesPreserved':sorted(references),'sourceUnchanged':True})
report={'passed':True,'variants':reports,'scope':'Native day/night source, evaluated fan loop and original v3 cameras. No saving or rendering.'}
(OUT/'verification-editable-v4.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('WORKSHOP_V4_NATIVE_VERIFIED',json.dumps(report),flush=True)
