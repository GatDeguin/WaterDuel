"""Per-piece grain on the newly modelled finish samples and carpentry repairs."""
import bpy,hashlib
from collections import defaultdict
import numpy as np
def prepare_detail_wood(objects,scale=95/147):
 entries=[]
 for obj in objects:
  original=obj.data.materials[0]
  if not original.name.startswith('WD_V4_DETAIL_wood_'):continue
  key='detail-'+obj.name.lower().replace(' ','-')
  mat=original.copy();mat.name='WD_SOURCE_V4_'+key;mat.use_fake_user=True
  nodes,links=mat.node_tree.nodes,mat.node_tree.links;p=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
  color=list(p.inputs['Base Color'].default_value);rough=float(p.inputs['Roughness'].default_value);coat=float(p.inputs['Coat Weight'].default_value)
  me=obj.data;parent=list(range(len(me.vertices)))
  def find(i):
   while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
   return i
  for edge in me.edges:a,b=map(int,edge.vertices);parent[find(a)]=find(b)
  groups=defaultdict(list)
  for i in range(len(parent)):groups[find(i)].append(i)
  values=np.zeros((len(parent),3),np.float32)
  for ids in groups.values():
   points=np.array([me.vertices[i].co[:] for i in ids],np.float32)/scale
   span=np.ptp(points,axis=0);long=int(np.argmax(span));axes=[long]+[a for a in range(3) if a!=long]
   seed=int(hashlib.sha256(np.mean(points,axis=0).tobytes()).hexdigest()[:8],16)/2**32
   values[ids]=(points-points.mean(0))[:,axes]+np.array((seed*9.7,seed*3.1,seed*7.3))
  old=me.attributes.get('wd_v4_detail')
  if old:me.attributes.remove(old)
  attr=me.attributes.new('wd_v4_detail','FLOAT_VECTOR','POINT');attr.data.foreach_set('vector',values.ravel())
  a=nodes.new('ShaderNodeAttribute');a.attribute_name='wd_v4_detail'
  vec=nodes.new('ShaderNodeVectorMath');vec.operation='MULTIPLY';vec.inputs[1].default_value=(1.5,82,29);links.new(a.outputs['Vector'],vec.inputs[0])
  noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=1;noise.inputs['Detail'].default_value=3;noise.inputs['Roughness'].default_value=.68;links.new(vec.outputs['Vector'],noise.inputs['Vector'])
  ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.24;ramp.color_ramp.elements[0].color=(.42,.37,.31,1);ramp.color_ramp.elements[1].position=.76;ramp.color_ramp.elements[1].color=(1.2,1.14,1.05,1);links.new(noise.outputs['Fac'],ramp.inputs[0])
  mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[1].default_value=color;links.new(ramp.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],p.inputs['Base Color'])
  bump=nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.00035;bump.inputs['Strength'].default_value=.14;links.new(noise.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],p.inputs['Normal'])
  obj.data.materials.clear();obj.data.materials.append(mat)
  entries.append({'key':key,'object':obj.name,'sourceMaterial':'V4 detail wood / '+obj.name,
   'sourceBakeMaterial':mat.name,'detailWood':True,'baseColorLinear':color,'roughness':rough,'metallic':0,'coat':coat,
   'channels':['Base Color','Roughness','Normal'],'revision':'detail-wood-v4.1','pieces':len(groups)})
 return {'entries':entries,'revision':'detail-wood-v4.1'}
