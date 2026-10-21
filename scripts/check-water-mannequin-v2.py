"""Independently import a v2 GLB, compare source pose/bounds/sockets, exercise rig."""
import bpy, json, sys, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
variant=next((a.split('=',1)[1] for a in sys.argv if a.startswith('--variant=')),'water-mannequin')
OUT=ROOT/'public/assets/characters/water-mannequin/v2';SOURCE=ROOT/'docs/assets/characters/v2'
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/(variant+'.blend')))
scene=bpy.context.scene;collection=bpy.data.collections['WaterDuel_Character']
source_rig=bpy.data.objects['WD_Mannequin_Rig']
def coords(p):return [float(c) for c in p]
def points(obj):
    dg=bpy.context.evaluated_depsgraph_get();evaluated=obj.evaluated_get(dg);mesh=evaluated.to_mesh()
    result=[evaluated.matrix_world@v.co for v in mesh.vertices];evaluated.to_mesh_clear()
    assert all(math.isfinite(c) for p in result for c in p)
    return result
def bounds(objects):
    pp=[p for obj in objects if obj.type=='MESH' for p in points(obj)]
    return {'min':[min(p[i] for p in pp) for i in range(3)],'max':[max(p[i] for p in pp) for i in range(3)]}
bpy.context.view_layer.update()
expected=bounds(list(collection.objects))
expected_sockets={o.name:coords(o.matrix_world.translation) for o in collection.objects if o.name.startswith('Socket_')}
source_bones=[{'name':b.name,'parent':b.parent.name if b.parent else None,'bind_head':coords(b.head_local),'bind_tail':coords(b.tail_local),'pose_head':coords(source_rig.pose.bones[b.name].head),'pose_tail':coords(source_rig.pose.bones[b.name].tail)} for b in source_rig.data.bones]
for obj in list(collection.objects):bpy.data.objects.remove(obj,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=str(OUT/(variant+'.glb')))
imported=list(bpy.context.selected_objects);rig=next(o for o in imported if o.type=='ARMATURE');meshes=[o for o in imported if o.type=='MESH']
actual=bounds(imported);error=max(abs(expected[k][i]-actual[k][i]) for k in ['min','max'] for i in range(3))
assert error<.0002,f'GLB changed the authored pose: max bounds discrepancy {error}; source {expected}; GLB {actual}'
assert len(rig.data.bones)==18
socket_errors={}
for name,pos in expected_sockets.items():
    assert bpy.data.objects.get(name),f'Missing socket {name}'
    socket_errors[name]=(bpy.data.objects[name].matrix_world.translation-Vector(pos)).length
    if socket_errors[name]>=.0002:
        print('WD_SOCKET_MISMATCH',json.dumps({'name':name,'source':pos,'imported':coords(bpy.data.objects[name].matrix_world.translation),'error':socket_errors[name]}),flush=True)
    assert socket_errors[name]<.0002,f'Socket {name} moved by {socket_errors[name]}'
head=bpy.data.objects['Balloon_Latex'];body=next(o for o in meshes if 'Beech_Wood_Grain' in o.name)
head_before=points(head);body_before=points(body)
pb=rig.pose.bones['head'];original=pb.matrix_basis.copy();pb.rotation_mode='XYZ';pb.rotation_euler.z+=.25;bpy.context.view_layer.update()
head_motion=max((a-b).length for a,b in zip(head_before,points(head)));body_motion=max((a-b).length for a,b in zip(body_before,points(body)))
assert head_motion>.03 and body_motion<.00001,(head_motion,body_motion)
pb.matrix_basis=original;bpy.context.view_layer.update()
report={'ok':True,'variant':variant,'rig_bones':18,'meshes':len(meshes),'source_bounds_Z_up':expected,'import_bounds_Z_up':actual,'max_bounds_error_metres':error,'sockets':expected_sockets,'socket_error_metres':socket_errors,'head_test_displacement_metres':head_motion,'body_test_displacement_metres':body_motion,'source_bones':source_bones,'glb_bind_pose':'Current authored fencing pose; Blender source retains v1 rest skeleton plus pose','runtime_integrated':False,'static_fluid':True}
(OUT/(variant+'-roundtrip.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
print('WD_V2_ROUNDTRIP',json.dumps({k:v for k,v in report.items() if k!='source_bones'}),flush=True)
if '--render' in sys.argv:
    scene.render.filepath=str(OUT/(variant+'-glb-preview.png'));scene.render.resolution_percentage=70;scene.cycles.samples=32
    bpy.ops.render.render(write_still=True)
