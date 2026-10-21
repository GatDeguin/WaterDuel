"""Verify the actual exported GLB in a new Blender scene; optional Eevee preview."""
import bpy
import os
import json
import math
import sys
import numpy as np
from mathutils import Vector

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'public','assets','environment','workshop')
contract=json.load(open(os.path.join(OUT,'asset-contract.json'),encoding='utf-8'))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT,'workshop-runtime.glb'))
scene=bpy.context.scene
lo=np.full(3,np.inf);hi=-lo
triangles=vertices=0;intersections=[];normal_images=[]
boxcenter=np.array((0,(.36+3.5)/2,0));half=np.array((3.7,(3.5-.36)/2,1.31))

def triangle_box(tri):
    t=tri-boxcenter
    if np.any(t.min(axis=0)>half+1e-7) or np.any(t.max(axis=0)<-half-1e-7):return False
    edges=[t[1]-t[0],t[2]-t[1],t[0]-t[2]]
    axes=[np.cross(edges[0],edges[1])]
    for edge in edges:
        axes.extend([np.cross(edge,axis) for axis in np.eye(3)])
    for axis in axes:
        if np.dot(axis,axis)<1e-18:continue
        p=t@axis;r=np.abs(axis)@half
        if p.min()>r+1e-7 or p.max()<-r-1e-7:return False
    return True

for o in scene.objects:
    if o.type!='MESH':continue
    me=o.data;me.calc_loop_triangles();vertices+=len(me.vertices);triangles+=len(me.loop_triangles)
    coords=np.empty(len(me.vertices)*3,dtype=np.float32);me.vertices.foreach_get('co',coords);coords=coords.reshape((-1,3))
    m=np.array(o.matrix_world,dtype=np.float64);coords=coords@m[:3,:3].T+m[:3,3]
    world=coords[:,[0,2,1]];world[:,2]*=-1
    lo=np.minimum(lo,world.min(axis=0));hi=np.maximum(hi,world.max(axis=0))
    index=np.empty(len(me.loop_triangles)*3,dtype=np.int32);me.loop_triangles.foreach_get('vertices',index);pts=world[index.reshape((-1,3))]
    mask=np.all(pts.max(axis=1)>boxcenter-half,axis=1)&np.all(pts.min(axis=1)<boxcenter+half,axis=1)
    count=sum(triangle_box(p) for p in pts[mask])
    if count:intersections.append({'mesh':o.name,'trianglesTouchingActiveVolume':count})
    for p in me.vertices:
        if not all(math.isfinite(v) for v in p.co):raise RuntimeError('Non-finite reimport vertex')
    if not me.uv_layers:raise RuntimeError('GLB reimport lost UVs: '+o.name)
for m in bpy.data.materials:
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type=='TEX_IMAGE' and n.image:
                normal_images.append({'material':m.name,'image':n.image.name,'size':list(n.image.size),'packed':bool(n.image.packed_file)})
expected=contract['bounds']
bounds_error=max(float(np.max(np.abs(lo-np.array(expected['min'])))),float(np.max(np.abs(hi-np.array(expected['max'])))))
stage_objects=[o for o in scene.objects if o.type=='MESH' and o.name.startswith('Workshop_stage-wet-oak-')]
stage_heights=[(o.matrix_world@v.co).z for o in stage_objects for v in o.data.vertices]
stage_top=max(stage_heights)
report={'passed':bounds_error<1e-4 and triangles<=500000 and abs(stage_top-.3245)<.002,
    'importer':'Blender '+bpy.app.version_string,'file':'workshop-runtime.glb','triangles':triangles,'vertices':vertices,
    'meshObjects':sum(o.type=='MESH' for o in scene.objects),'boundsRuntimeYUp':{'min':lo.tolist(),'max':hi.tolist()},'boundsMaxError':bounds_error,
    'stageTopMeasured':stage_top,'stageTopNominal':.3245,'stageTopTolerance':.002,
    'materialImageBindings':normal_images,
    'activeVolume':{'x':[-3.7,3.7],'y':[.36,3.5],'z':[-1.31,1.31]},'activeVolumeIntersections':intersections,
    'scope':'Actual GLB reimport with embedded texture decoding, no original source mesh. Optional image is Eevee, not game runtime.'}
with open(os.path.join(OUT,'reimport-verification.json'),'w',encoding='utf-8') as f:json.dump(report,f,indent=2)
print('WORKSHOP_REIMPORT',json.dumps({k:v for k,v in report.items() if k!='materialImageBindings'}),flush=True)
if not report['passed']:raise RuntimeError('Reimport verification failed')

if '--preview' in sys.argv:
    S=95/147;TY=.3245-1.15*S
    def mapped(p):return Vector((p[0]*S,p[1]*S,p[2]*S+TY))
    def area(name,p,target,power,color,size):
        d=bpy.data.lights.new(name,'AREA');d.energy=power*S*S;d.color=color;d.shape='DISK';d.size=size*S
        o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=mapped(p);o.rotation_euler=(mapped(target)-o.location).to_track_quat('-Z','Y').to_euler()
    area('Preview warm key',(-3.5,-2.5,7.8),(0,0,1.2),650,(1,.71,.4),4)
    area('Preview cool left window',(-4.65,7.05,6.4),(-2,0,1.8),1100,(.47,.67,1),3)
    area('Preview cool right window',(4.65,7.05,6.8),(2,-1,1.5),1450,(.5,.72,1),3)
    area('Preview table warm reflection',(6,1.5,4),(-1,-1,1.1),580,(1,.7,.4),3)
    area('Preview soft return',(0,-8,5.5),(0,1,2.4),130,(.65,.8,.8),6)
    for hint in contract['lighting']['hints']:
        if hint['type']!='POINT':continue
        d=bpy.data.lights.new(hint['name'],'POINT');d.energy=hint['scaledWatts'];d.color=hint['colorLinear'];d.shadow_soft_size=.1*S
        o=bpy.data.objects.new(hint['name'],d);scene.collection.objects.link(o);p=hint['position'];o.location=(p[0],-p[2],p[1])
    c=bpy.data.cameras.new('GLB inspection camera');o=bpy.data.objects.new('GLB inspection camera',c);scene.collection.objects.link(o)
    o.location=mapped((.15,-17.8,3.2));o.rotation_euler=(mapped((0,2.3,3.7))-o.location).to_track_quat('-Z','Y').to_euler();c.lens=42;scene.camera=o
    scene.render.engine='BLENDER_EEVEE'
    scene.render.resolution_x=1280;scene.render.resolution_y=720;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.filepath=os.path.join(OUT,'preview-glb-eevee.png')
    scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.2,.24,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.25
    scene.view_settings.view_transform='AgX';scene.view_settings.exposure=-.15
    try:scene.view_settings.look='AgX - Medium High Contrast'
    except Exception:pass
    bpy.ops.render.render(write_still=True)
    print('WORKSHOP_GLB_PREVIEW_DONE',flush=True)
