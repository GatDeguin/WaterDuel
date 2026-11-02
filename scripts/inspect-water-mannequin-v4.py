"""CPU-only geometry contract and independent GLB roundtrip inspection."""
import bpy, json, sys, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
variant=next((x.split('=',1)[1] for x in sys.argv if x.startswith('--variant=')),'water-mannequin')
version='v3' if '--baseline' in sys.argv else 'v4'
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'docs/assets/characters'/version/(variant+'.blend')))
collection=bpy.data.collections['WaterDuel_Character'];rig=bpy.data.objects['WD_Mannequin_Rig']
def positions(obj):
    dg=bpy.context.evaluated_depsgraph_get();ev=obj.evaluated_get(dg);mesh=ev.to_mesh()
    pp=[ev.matrix_world@v.co for v in mesh.vertices];ev.to_mesh_clear();return pp
def bounds(objects):
    pp=[p for o in objects if o.type=='MESH' for p in positions(o)]
    return {k:[f(p[i] for p in pp) for i in range(3)] for k,f in [('min',min),('max',max)]}
def uv_bad(obj,index=0):
    mesh=obj.data;mesh.calc_loop_triangles()
    if len(mesh.uv_layers)<=index:return len(mesh.loop_triangles)
    uv=mesh.uv_layers[index].data
    return sum(abs((uv[t.loops[1]].uv-uv[t.loops[0]].uv).cross(uv[t.loops[2]].uv-uv[t.loops[0]].uv))<1e-12 for t in mesh.loop_triangles)
wood=[o for o in collection.objects if o.type=='MESH' and o.data.materials[0].name=='Beech_Wood_Grain']
feet={}
for side in ['L','R']:
    o=bpy.data.objects['Foot_'+side];pp=positions(o);low=min(p.z for p in pp);bottom=[p for p in pp if p.z<=low+.0001]
    feet[side]={'minimum':low,'coplanar_sole_vertices':len(bottom),'sole_span':[max(p[i] for p in bottom)-min(p[i] for p in bottom) for i in [0,1]],'bounds':bounds([o])}
report={'variant':variant,'version':version,'bones':len(rig.data.bones),'sockets':len([o for o in collection.objects if o.name.startswith('Socket_')]),'wood_uv0_degenerate_triangles':sum(uv_bad(o) for o in wood),'feet':feet}
if '--inventory' in sys.argv:
    report['objects']=[{'name':o.name,'bone':o.get('rig_bone'),'material':o.data.materials[0].name,'triangles':sum(len(p.vertices)-2 for p in o.data.polygons),'vertices':len(o.data.vertices),'matrix':[list(r) for r in o.matrix_world]} for o in collection.objects if o.type=='MESH']
    print('WD_V4_INVENTORY',json.dumps(report),flush=True)
if '--baseline' in sys.argv:
    out=ROOT/'.superpowers/sdd/personajes-selected-v4';out.mkdir(parents=True,exist_ok=True)
    (out/(variant+'-baseline.json')).write_text(json.dumps(report,indent=2))
    assert all(f['coplanar_sole_vertices']>=4 and min(f['sole_span'])>.08 for f in feet.values()),'RED: v3 feet have no planar supporting polygon'
    assert report['wood_uv0_degenerate_triangles']==0,'RED: v3 wood cap UVs degenerate'
else:
    assert report['bones']==18 and report['sockets']==5
    assert all(f['coplanar_sole_vertices']>=4 and min(f['sole_span'])>.08 for f in feet.values()),feet
    assert report['wood_uv0_degenerate_triangles']==0,report
    report['uv1_degenerate_triangles']=sum(uv_bad(o,1) for o in collection.objects if o.type=='MESH' and o.get('v4_atlas'))
    assert report['uv1_degenerate_triangles']==0,report
    axes=[]
    for o in collection.objects:
        if o.type!='MESH' or not(o.name.endswith('_Axle') or o.name.startswith('V4_') and ('Clevis' in o.name or 'Bushing' in o.name)):continue
        bone=rig.data.bones[o.get('rig_bone')]
        # Parent-owned cheeks share the child's pivot; infer it from the label.
        if o.name.startswith('V4_'):
            _,label,side,*_=o.name.split('_');child={'Shoulder':'upper_arm.','Elbow':'forearm.','Knee':'shin.','Ankle':'foot.'}[label]+side;bone=rig.data.bones[child]
            pp=[o.matrix_world@v.co for v in o.data.vertices];center=sum(pp,Vector())/len(pp)
            a,b,c=pp[:3];axis=(b-a).cross(c-a).normalized()
        else:
            center=o.matrix_world.translation;axis=o.matrix_world.to_3x3()@Vector((0,0,1));axis.normalize()
        error=math.hypot(center.x-bone.head_local.x,center.z-bone.head_local.z);angle=math.degrees(math.acos(min(1,abs(axis.y))))
        axes.append({'object':o.name,'center_to_axis_metres':error,'axis_error_degrees':angle})
    report['joint_axes']=axes
    assert max(x['center_to_axis_metres'] for x in axes)<=.0005,axes
    assert max(x['axis_error_degrees'] for x in axes)<=.5,axes
    expected=bounds(collection.objects);expected_sockets={o.name:list(o.matrix_world.translation) for o in collection.objects if o.name.startswith('Socket_')}
    for o in list(collection.objects):bpy.data.objects.remove(o,do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/assets/characters/water-mannequin/v4'/(variant+'.glb')))
    imported=list(bpy.context.selected_objects);actual=bounds(imported)
    report['max_bounds_error_metres']=max(abs(expected[k][i]-actual[k][i]) for k in expected for i in range(3))
    report['socket_error_metres']={n:(bpy.data.objects[n].matrix_world.translation-Vector(p)).length for n,p in expected_sockets.items()}
    assert report['max_bounds_error_metres']<=.0002,report
    assert max(report['socket_error_metres'].values())<=.0002,report
    report['ok']=True
    (ROOT/'public/assets/characters/water-mannequin/v4'/(variant+'-roundtrip.json')).write_text(json.dumps(report,indent=2))
print('WD_V4_INSPECT',json.dumps(report),flush=True)
