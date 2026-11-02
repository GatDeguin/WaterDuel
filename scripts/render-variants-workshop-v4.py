"""Render native day/night and capture the actual atelier as portable RGBE HDR."""
import bpy,json,math,hashlib,time
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets/environment/workshop';NATIVE=ROOT/'output/blender'
scene=bpy.context.scene;assert scene.get('workshop_v4_built')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,v):Path(p).write_text(json.dumps(v,indent=2),encoding='utf-8')
def world(p):return [p[0],p[2],-p[1]]
source_sha=sha(NATIVE/'WaterDuel_Atelier_v4.blend')
camera=scene.camera;scene.frame_set(1)
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=1280;scene.render.resolution_y=720;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.color_depth='8'
scene.render.filepath=str(NATIVE/'WaterDuel_Atelier_v4_dia.png')
started=time.time();bpy.ops.render.render(write_still=True)
day_seconds=time.time()-started

# Equirectangular radiance from the stage, with no dynamic characters present.
data=bpy.data.cameras.new('Temporary V4 reflection capture');data.type='PANO';data.panorama_type='EQUIRECTANGULAR'
probe=bpy.data.objects.new('Temporary V4 reflection capture',data);scene.collection.objects.link(probe)
S=95/147;TY=.3245-1.15*S;probe.location=(0,-.2*S,2.5*S+TY);probe.rotation_euler=(math.pi/2,0,0)
scene.camera=probe;scene.cycles.samples=16;scene.cycles.use_denoising=False
scene.render.resolution_x=1024;scene.render.resolution_y=512
scene.render.image_settings.file_format='HDR';scene.render.image_settings.color_mode='RGB'
scene.render.filepath=str(OUT/'reflection-v4.hdr');bpy.ops.render.render(write_still=True)
write(OUT/'reflection-v4.json',{'version':4,'file':'reflection-v4.hdr','sha256':sha(OUT/'reflection-v4.hdr'),
 'projection':'equirectangular','resolution':[1024,512],'encoding':'Radiance RGBE','probePositionRuntime':world(probe.location),
 'basis':'Captured in native Blender Z-up; runtime geometry maps (x,z,-y).',
 'scope':'Actual static v4 atelier radiance. The existing runtime uses its own dynamic cubemap capture; HDR is portable authored reference.'})
scene.camera=camera;bpy.data.objects.remove(probe,do_unlink=True);bpy.data.cameras.remove(data)

lights=[]
for obj in scene.objects:
 if obj.type!='LIGHT':continue
 d=obj.data;name=obj.name
 if name.startswith('Key |'):factor=.27
 elif 'tall window' in name:factor=.20;d.color=(.24,.40,.82)
 elif 'Soft front' in name:factor=.38;d.color=(.28,.42,.70)
 elif 'glancing' in name:factor=.50
 elif name=='Background amber pool.005':factor=.33;d.color=(.20,.34,.78)
 elif name=='Background amber pool.004':factor=.58
 elif 'banner wash' in name:factor=.65
 else:factor=.85
 d.energy*=factor
 lights.append({'name':name,'type':d.type,'position':world(obj.matrix_world.translation),'scaledWatts':d.energy,'colorLinear':list(d.color)})
assert len(lights)==22
overrides=[]
for name,color,strength in(
 ('WD_V4_EXT_overcast_sky',(.012,.025,.065),.42),
 ('Workshop v4 PBR | old undulating window glass',None,.025)):
 mat=bpy.data.materials.get(name);assert mat
 p=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 if color:
  p.inputs['Base Color'].default_value=(*color,1);p.inputs['Emission Color'].default_value=(*color,1)
 p.inputs['Emission Strength'].default_value=strength
 emission=[strength]*3 if p.inputs['Emission Color'].is_linked else [float(v)*strength for v in p.inputs['Emission Color'].default_value[:3]]
 base=list(p.inputs['Base Color'].default_value);base[3]=float(p.inputs['Alpha'].default_value)
 overrides.append({'materialName':name,'emissiveFactor':emission,
 'baseColorFactor':base,'emissionStrength':strength})
scene.world.use_nodes=True;bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs[0].default_value=(.025,.045,.09,1);bg.inputs[1].default_value=.065
scene['workshop_v4_variant']='night'
write(OUT/'lighting-night-v4.json',{'version':4,'variant':'night','lights':lights,'materialOverrides':overrides,
 'world':{'color':[.025,.045,.09],'strength':.065},'source':'output/blender/WaterDuel_Atelier_v4_noche.blend',
 'scope':'Authored native night scene and portable lighting/material preset; runtime integration is separate.'})
scene.render.resolution_x=1920;scene.render.resolution_y=1080;scene.cycles.samples=64;scene.cycles.use_denoising=True
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.color_depth='8'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(NATIVE/'WaterDuel_Atelier_v4_noche.blend'))
night_sha=sha(NATIVE/'WaterDuel_Atelier_v4_noche.blend')
scene.render.resolution_x=1280;scene.render.resolution_y=720;scene.cycles.samples=24
scene.render.filepath=str(NATIVE/'WaterDuel_Atelier_v4_noche.png');started=time.time();bpy.ops.render.render(write_still=True)
assert sha(NATIVE/'WaterDuel_Atelier_v4.blend')==source_sha
assert sha(NATIVE/'WaterDuel_Atelier_v4_noche.blend')==night_sha
write(NATIVE/'preview-variants-v4.json',{'passed':True,'day':{'path':'output/blender/WaterDuel_Atelier_v4.blend','sha256':source_sha,'preview':'output/blender/WaterDuel_Atelier_v4_dia.png','previewSha256':sha(NATIVE/'WaterDuel_Atelier_v4_dia.png'),'renderSeconds':day_seconds},
 'night':{'path':'output/blender/WaterDuel_Atelier_v4_noche.blend','sha256':night_sha,'preview':'output/blender/WaterDuel_Atelier_v4_noche.png','previewSha256':sha(NATIVE/'WaterDuel_Atelier_v4_noche.png'),'renderSeconds':time.time()-started},
 'resolution':[1280,720],'lightsPerVariant':22,'cameraPreserved':True,'renderer':'Cycles CPU 24 samples; actual scene materials',
 'reflectionFile':'public/assets/environment/workshop/reflection-v4.hdr','sourceFilesUnchangedDuringRender':True})
print('WORKSHOP_V4_VARIANTS_READY',source_sha,night_sha,flush=True)
