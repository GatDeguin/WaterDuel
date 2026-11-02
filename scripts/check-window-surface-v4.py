"""Read-only regression: broad glass faces must not inherit bevel normals."""
import bpy,math,json
import numpy as np
obj=bpy.data.objects['Workshop_window-cold-diffuse-daylight'];me=obj.data
g=np.empty(len(me.vertices)*3,np.float32);me.attributes['wd_generated'].data.foreach_get('vector',g);g=g.reshape((-1,3))
tilts=[]
for face in me.polygons:
 flag=me.attributes.get('wd_v4_glass_broad')
 broad=bool(flag.data[face.index].value) if flag else abs(face.normal.y)>.90
 if broad:
  for loop in face.loop_indices:
   n=me.corner_normals[loop].vector;tilts.append(math.degrees(math.acos(min(1,abs(n.y)))))
print('WINDOW_SURFACE',json.dumps({'samples':len(tilts),'maxBroadFaceTiltDegrees':max(tilts)}),flush=True)
assert max(tilts)<5,'Broad pane normals inherited bevel faceting (>5 degrees)'
assert me.attributes.get('wd_v4_glass_phase'),'Per-pane phase attribute missing'
assert obj.data.materials[0].use_backface_culling,'Closed alpha pane must render one facing skin'
