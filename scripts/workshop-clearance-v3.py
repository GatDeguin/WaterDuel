"""Independent checks on Blender's reimport of the final GLB.

Uses exact final GLB triangle selections, then BVH + triangle SAT against every
other exported mesh, not just the original obstructing architecture.
"""
import json
from pathlib import Path
import numpy as np
from mathutils.bvhtree import BVHTree

OUT=Path(__file__).resolve().parents[1]/'public/assets/environment/workshop'
def bounds(points):return {'min':points.min(axis=0).tolist(),'max':points.max(axis=0).tolist()}
def sat(a,b):
 ea=np.roll(a,-1,axis=0)-a;eb=np.roll(b,-1,axis=0)-b
 na=np.cross(ea[0],ea[1]);nb=np.cross(eb[0],eb[1])
 axes=[na,nb]+[np.cross(x,y) for x in ea for y in eb]
 axes += [np.cross(n,e) for n in (na,nb) for e in list(ea)+list(eb)]
 for axis in axes:
  length=np.linalg.norm(axis)
  if length<1e-12:continue
  axis/=length;pa=a@axis;pb=b@axis
  if pa.max()<pb.min()-1e-7 or pb.max()<pa.min()-1e-7:return False
 return True
def verify_geometric_clearance(scene,contract,meshes):
 data={}
 for obj in meshes:
  me=obj.data;me.calc_loop_triangles()
  local=np.empty(len(me.vertices)*3,np.float32);me.vertices.foreach_get('co',local)
  matrix=np.array(obj.matrix_world,np.float64)
  world=local.reshape((-1,3))@matrix[:3,:3].T+matrix[:3,3]
  points=world[:,[0,2,1]].copy();points[:,2]*=-1
  indices=np.array([tuple(t.vertices) for t in me.loop_triangles],np.int32)
  data[obj.name]={'points':points,'indices':indices,
   'bvh':BVHTree.FromPolygons(points.tolist(),indices.tolist(),all_triangles=True)}
 def select(selector):
  selected={};triangles=[]
  for name in selector['nodeNames']:
   ordinals=selector.get('triangleIndicesByNode',{}).get(name,selector.get('triangleIndices'))
   assert ordinals and name in data,'Missing explicit triangle selection'
   ids=np.array(ordinals,np.int32);assert ids.min()>=0 and ids.max()<len(data[name]['indices'])
   faces=data[name]['indices'][ids]
   pts=data[name]['points'][faces]
   triangles.append(pts);selected[name]=set(ordinals)
  tris=np.concatenate(triangles);b=bounds(tris.reshape((-1,3)))
  expected=selector['componentBounds']
  assert max(abs(b[side][i]-expected[side][i]) for side in ('min','max') for i in range(3))<1e-5
  return tris,b,selected
 checks=[];external=[]
 for item in contract['crossingClearance']['checks']:
  front,fb,selected=select(item['front']);_,bb,_=select(item['back'])
  gap=fb['min'][item['axis']]-bb['max'][item['axis']]
  assert gap>=item['minClearance']-1e-5 and abs(gap-item['measuredClearance'])<1e-5
  checks.append({'id':item['id'],'axis':item['axis'],'measuredClearance':gap,
   'frontBounds':fb,'backBounds':bb,'passed':True})
  if item['axis']!=2:continue
  flat=front.reshape((-1,3));ix=np.arange(len(flat),dtype=np.int32).reshape((-1,3))
  bvh=BVHTree.FromPolygons(flat.tolist(),ix.tolist(),all_triangles=True)
  count=0;examples=[]
  for name,other in data.items():
   excluded=selected.get(name,set())
   for fa,ob in bvh.overlap(other['bvh']):
    if ob in excluded:continue
    if sat(front[fa],other['points'][other['indices'][ob]]):
     count+=1
     if len(examples)<8:examples.append({'otherMesh':name,'otherTriangle':ob,'frontTriangle':fa})
  external.append({'id':item['id'],'externalTriangleCrossings':count,'examples':examples})
 report={'passed':all(c['passed'] for c in checks) and all(c['externalTriangleCrossings']==0 for c in external),
  'checks':checks,'allOtherExportedGeometry':external,
  'scope':'Actual reimported GLB. Positive full-component axis gaps plus BVH/triangle-SAT against all exported geometry outside each coherent assembly; intentional intra-assembly embroidery/hardware contacts excluded.'}
 (OUT/'geometric-reimport-v3.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
 return report
