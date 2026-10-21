import bpy,json,collections,os
deps=bpy.context.evaluated_depsgraph_get();rows=[];by=collections.Counter()
for o in bpy.context.scene.objects:
    if o.type not in {'MESH','CURVE','FONT'} or o.hide_render:continue
    if o.name=='Workshop air' or any(c.name.startswith('05 | Water') for c in o.users_collection):continue
    e=o.evaluated_get(deps);me=e.to_mesh();me.calc_loop_triangles();count=len(me.loop_triangles)
    mats=[m.name if m else 'NONE' for m in me.materials]
    rows.append({'object':o.name,'triangles':count,'materials':mats,'type':o.type})
    for tri in me.loop_triangles:by[mats[tri.material_index] if mats else 'NONE']+=1
    e.to_mesh_clear()
report={'triangles':sum(by.values()),'materials':dict(by),'largest_objects':sorted(rows,key=lambda x:-x['triangles'])[:45],'objects':len(rows)}
root=os.path.dirname(os.path.dirname(__file__))
with open(os.path.join(root,'output','blender','runtime-profile.json'),'w') as f:json.dump(report,f,indent=2)
print('RUNTIME_PROFILE',json.dumps(report),flush=True)
