import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root));
const bodyMaterials=new Set(['Beech_Wood_Grain','Endgrain_Joints','Satin_Brass','Recessed_Steel','Wrapped_Brown_Leather','Mint_Woven_Sash','Boss_Burgundy_Woven_Cloth']);
async function glb(version,name){
  const bytes=await read(`public/assets/characters/water-mannequin/${version}/${name}.glb`);
  assert.equal(bytes.readUInt32LE(0),0x46546c67);
  const size=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+size));
  const bin=bytes.subarray(28+size);
  function values(index){
    const a=json.accessors[index],v=json.bufferViews[a.bufferView],width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type];
    const [step,method]={5121:[1,'readUInt8'],5123:[2,'readUInt16LE'],5125:[4,'readUInt32LE'],5126:[4,'readFloatLE']}[a.componentType];
    const out=[];
    for(let i=0;i<a.count;i++)for(let j=0;j<width;j++)out.push(bin[method]((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??width*step)+j*step));
    return out;
  }
  return {json,values};
}
test('v3 proporciona el RED físico y UV; v4 tiene suela plana y roundtrip certificado',async()=>{
  const baseline=JSON.parse(await read('tests/fixtures/water-mannequin-v3-baseline.json'));
  assert.ok(baseline.wood_uv0_degenerate_triangles>0);
  assert.ok(Object.values(baseline.feet).every(f=>f.coplanar_sole_vertices===1&&f.sole_span.every(x=>x===0)));
  for(const name of ['water-mannequin','water-mannequin-amber','water-mannequin-boss']){
    const r=JSON.parse(await read(`public/assets/characters/water-mannequin/v4/${name}-roundtrip.json`));
    assert.equal(r.ok,true);assert.equal(r.wood_uv0_degenerate_triangles,0);assert.equal(r.uv1_degenerate_triangles,0);
    assert.ok(Object.values(r.feet).every(f=>f.coplanar_sole_vertices>=24&&f.sole_span.every(x=>x>.08)));
    assert.ok(r.max_bounds_error_metres<=.0002);assert.ok(Object.values(r.socket_error_metres).every(x=>x<=.0002));
  }
});
test('atlas v4 reserva regiones únicas con gutters reales y testas independientes',async()=>{
  const layout=JSON.parse(await read('docs/assets/characters/v4/atlas-layout.json'));
  assert.equal(layout.schema,4);assert.equal(layout.size,1024);assert.equal(layout.origin,'top-left');
  assert.equal(new Set(layout.regions.map(r=>r.id)).size,layout.regions.length);
  assert.ok(layout.regions.filter(r=>r.id.includes(':endgrain:')).length>=20);
  for(let i=0;i<layout.regions.length;i++){
    const r=layout.regions[i],[x,y,w,h]=r.rect;
    assert.ok(x>=0&&y>=0&&x+w<=1024&&y+h<=1024);assert.ok(r.padding>=4&&w>2*r.padding&&h>2*r.padding);
    for(const b of layout.regions.slice(i+1)){
      const [xx,yy,ww,hh]=b.rect;
      assert.ok(x+w<=xx||xx+ww<=x||y+h<=yy||yy+hh<=y,`${r.id} overlaps ${b.id}`);
    }
  }
});
for(const name of ['water-mannequin','water-mannequin-amber','water-mannequin-boss'])test(`${name}: contrato GLB independiente, ownership rígido, UV1 y tangentes`,async()=>{
  const {json:g,values}=await glb('v4',name),{json:old}=await glb('v3',name);
  assert.equal(g.skins.length,1);assert.equal(g.skins[0].joints.length,18);assert.ok(g.meshes.length<=18);
  assert.deepEqual(g.skins[0].joints.map(i=>g.nodes[i].name).sort(),old.skins[0].joints.map(i=>old.nodes[i].name).sort());
  assert.equal(g.nodes.filter(n=>n.name?.startsWith('Socket_')).length,5);
  assert.ok(g.images.every(im=>im.bufferView!==undefined&&!im.uri));
  let triangles=0,rendered=0;
  for(const node of g.nodes.filter(n=>n.mesh!==undefined))for(const p of g.meshes[node.mesh].primitives){
    const ix=values(p.indices),pos=values(p.attributes.POSITION),norm=values(p.attributes.NORMAL);triangles+=ix.length/3;
    if(!/Water|Latex|Preview_Rapier/i.test(node.name))rendered+=ix.length/3;
    assert.ok(pos.every(Number.isFinite)&&norm.every(Number.isFinite));
    const weights=values(p.attributes.WEIGHTS_0),joints=values(p.attributes.JOINTS_0);
    const owners=[];
    for(let i=0;i<weights.length;i+=4){
      const w=weights.slice(i,i+4),active=w.findIndex(x=>x>.99999);
      assert.ok(active>=0&&w.filter(x=>x>1e-6).length===1);owners.push(joints[i+active]);
    }
    for(let i=0;i<ix.length;i+=3)assert.ok(owners[ix[i]]===owners[ix[i+1]]&&owners[ix[i]]===owners[ix[i+2]],'triangle crosses rigid owners');
    const mat=g.materials[p.material];
    if(!bodyMaterials.has(mat.name))continue;
    assert.ok(p.attributes.TEXCOORD_1!==undefined&&p.attributes.TANGENT!==undefined,mat.name);
    for(const slot of [mat.pbrMetallicRoughness.baseColorTexture,mat.pbrMetallicRoughness.metallicRoughnessTexture,mat.normalTexture,mat.occlusionTexture])assert.equal(slot?.texCoord,1);
    const uv=values(p.attributes.TEXCOORD_1),tan=values(p.attributes.TANGENT);assert.ok(uv.every(x=>x>=0&&x<=1));assert.ok(tan.every(Number.isFinite));
    for(let i=0;i<ix.length;i+=3){
      const [a,b,c]=ix.slice(i,i+3).map(v=>uv.slice(v*2,v*2+2));
      assert.ok(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))>1e-14,mat.name+' UV1 zero area');
    }
  }
  assert.ok(triangles<=(name.endsWith('boss')?90000:65000));assert.ok(rendered>28000);
  assert.ok(g.materials.some(m=>m.name==='Satin_Brass'));
});
