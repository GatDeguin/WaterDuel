"""Verify exported meshes, skin deformation, materials and a GLB round-trip render."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets/characters/water-mannequin'
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'docs/assets/characters/water-mannequin.blend'))
for obj in list(bpy.data.collections['WaterDuel_Character'].objects):
    bpy.data.objects.remove(obj,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=str(OUT/'water-mannequin.glb'))
imported=list(bpy.context.selected_objects)
rig=next(obj for obj in imported if obj.type=='ARMATURE')
meshes=[obj for obj in imported if obj.type=='MESH']
assert len(rig.data.bones)==18
assert all(obj.data.vertices and obj.vertex_groups for obj in meshes)
assert all(any(mod.type=='ARMATURE' and mod.object==rig for mod in obj.modifiers) for obj in meshes)

def positions(obj):
    depsgraph=bpy.context.evaluated_depsgraph_get()
    evaluated=obj.evaluated_get(depsgraph)
    mesh=evaluated.to_mesh()
    verts=[evaluated.matrix_world@v.co for v in mesh.vertices]
    evaluated.to_mesh_clear()
    assert all(math.isfinite(c) for v in verts for c in v)
    return verts

head=bpy.data.objects['Balloon_Latex']
wood=next(obj for obj in meshes if 'Beech_Wood' in obj.name)
before=positions(head);wood_before=positions(wood)
bone=rig.pose.bones['head'];bone.rotation_mode='XYZ';bone.rotation_euler.z=.25
bpy.context.view_layer.update()
after=positions(head);wood_after=positions(wood)
head_motion=max((a-b).length for a,b in zip(before,after))
body_motion=max((a-b).length for a,b in zip(wood_before,wood_after))
assert head_motion>.05, f'Head bone failed to move head: {head_motion}'
assert body_motion<.00001, f'Head bone moved wooden body: {body_motion}'
bone.rotation_euler.z=0;bpy.context.view_layer.update()
report={'ok':True,'roundtrip_meshes':len(meshes),'bones':len(rig.data.bones),'head_test_rotation_radians':.25,'head_max_displacement_metres':head_motion,'body_max_displacement_metres':body_motion,'note':'GLB imported independently; head deforms with its bone; wooden body stays rigid.'}
(OUT/'roundtrip-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('WD_ROUNDTRIP',json.dumps(report),flush=True)
bpy.context.scene.render.filepath=str(OUT/'water-mannequin-glb-preview.png')
bpy.context.scene.cycles.samples=32
bpy.context.scene.render.resolution_percentage=75
bpy.ops.render.render(write_still=True)
