import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter} from '../public/rendering/asset-rig.js';
import {splitApronParts} from '../public/rendering/apron-parts.js';
import {APRON_GEOMETRY} from '../public/physics/apron-geometry.js';

const split=splitApronParts;
const cached=new Map();
async function character(boss=false){
  const name=boss?'water-mannequin-boss':'water-mannequin';
  if(!cached.has(name))cached.set(name,fs.readFile(new URL(`../public/assets/characters/water-mannequin/v2/${name}.glb`,import.meta.url)).then(bytes=>prepareCharacter(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)))));
  return cached.get(name);
}
const triangles=parts=>parts.reduce((sum,p)=>sum+p.indices.length/3,0);
const cloth=p=>/Woven_(Sash|Cloth)/.test(p.nodeName)&&p.boneName==='pelvis';
const brass=p=>/Brass/.test(p.nodeName)&&p.boneName==='pelvis';
const vertex=(part,i)=>[...part.positions.subarray(i*3,i*3+3),...part.normals.subarray(i*3,i*3+3),...part.uv.subarray(i*2,i*2+2),...(part.uv1?.subarray(i*2,i*2+2)??[]),...(part.colors?.subarray(i*4,i*4+4)??[])];
const triangleMultiset=parts=>{
  const result=new Map();for(const p of parts)for(let t=0;t<p.indices.length;t+=3){const key=`${p.nodeName}/${p.boneName}/${p.material}:`+[0,1,2].map(k=>vertex(p,p.indices[t+k]).join(',')).join(';');result.set(key,(result.get(key)??0)+1);}return result;
};

test('normal: solo los 20 triángulos de tela reciben bisagra; la hebilla queda en pelvis y el origen no se modifica',async()=>{
  const c=await character(),before=c.parts.map(p=>p.accessory),result=split(c.parts,c.bones,c.source);
  assert.equal(triangles(result.parts.filter(p=>p.accessory==='apron')),20);
  assert.ok(result.parts.filter(p=>p.accessory==='apron').every(cloth));
  assert.equal(triangles(result.parts.filter(brass)),188);
  assert.ok(result.parts.filter(brass).every(p=>!p.accessory));
  assert.deepEqual(c.parts.map(p=>p.accessory),before);
  assert.equal(triangles(result.parts),c.triangleCount);
});

test('jefe: 22 componentes heráldicos y orlas completos siguen al paño; los 188 triángulos de hebilla siguen la pelvis',async()=>{
  const c=await character(true),result=split(c.parts,c.bones,c.source);
  assert.equal(triangles(result.parts.filter(p=>p.accessory==='apron'&&cloth(p))),516);
  assert.equal(triangles(result.parts.filter(p=>p.accessory==='apron'&&brass(p))),2684);
  assert.equal(triangles(result.parts.filter(p=>!p.accessory&&brass(p))),188);
  assert.equal(result.report.brassComponents,23);
  assert.equal(result.report.apronBrassComponents,22);
  assert.equal(triangles(result.parts),c.triangleCount);
});

test('la partición conserva por triángulo posición, normal, material, UV0, UV1 y RGBA, incluso en costuras duplicadas',async()=>{
  const source=await character(true);
  const parts=source.parts.map(p=>{
    const count=p.positions.length/3,uv1=new Float32Array(count*2),colors=new Float32Array(count*4);
    for(let v=0;v<count;v++){uv1.set([v*.25,.75],v*2);colors.set([v*.125,.2,.3,.4],v*4);}
    return {...p,uv1,colors};
  });
  const before=triangleMultiset(parts),result=split(parts,source.bones,source.source);
  assert.deepEqual(triangleMultiset(result.parts),before);
  assert.equal(triangles(result.parts),triangles(parts));
  assert.ok(result.parts.every(p=>p.boneName===parts.find(s=>s.nodeName===p.nodeName&&s.boneName===p.boneName)?.boneName));
});

test('las costuras UV se sueldan solo para conectividad: un componente que cruza la cintura no se corta ni se une al faldón',()=>{
  const matrix=new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const part=(nodeName,positions,indices)=>({nodeName,boneName:'pelvis',positions:new Float32Array(positions),normals:new Float32Array(positions.length).fill(0),uv:new Float32Array(positions.length/3*2),indices:new Uint32Array(indices),material:2});
  const fabric=part('WD_Boss_Woven_Cloth',[-.1,.1,.17,.1,.1,.17,0,-.5,.18],[0,1,2]);
  const gold=part('WD_Boss_Brass',[-.02,.09,.18,.02,.09,.18,0,.07,.18,0,.07,.18,.02,.09,.18,0,.2,.18],[0,1,2,3,4,5]);
  gold.uv.set([0,0,1,0,.5,1,.8,.8,.1,.1,.5,0]);
  const result=split([fabric,gold],new Map([['pelvis',{worldMatrix:matrix}]]),{hip:[0,0,0],authoredScale:1,torsoFrame:matrix});
  assert.equal(result.report.brassComponents,1,'duplicated UV seam vertices belong to one geometric component');
  assert.equal(result.report.apronBrassComponents,0);
  assert.equal(triangles(result.parts.filter(p=>brass(p)&&!p.accessory)),2);
  assert.deepEqual(triangleMultiset(result.parts),triangleMultiset([fabric,gold]));
});

test('los descriptores canónicos contienen todos los vértices reales y su caja conservadora tiene ocho esquinas',async()=>{
  assert.ok(APRON_GEOMETRY,'physics must receive source-derived geometry');
  for(const [kind,boss] of [['normal',false],['boss',true]]){
    const c=await character(boss),result=split(c.parts,c.bones,c.source),d=result.descriptor,canonical=APRON_GEOMETRY[kind];
    assert.equal(d.space,'source-world-relative-hip-normalized');
    assert.equal(d.corners.length,8);assert.equal(canonical.corners.length,8);
    assert.equal(d.sourceTorsoFrame.length,16);assert.equal(canonical.sourceTorsoFrame.length,16);
    for(const p of result.parts.filter(p=>p.accessory==='apron'))for(let v=0;v<p.positions.length;v+=3)for(let a=0;a<3;a++){
      // Delivered pelvis axes are identity; its local positions are already hip-relative.
      const coordinate=p.positions[v+a]/c.source.authoredScale;
      assert.ok(coordinate>=d.bounds.min[a]-1e-7&&coordinate<=d.bounds.max[a]+1e-7);
      assert.ok(coordinate>=canonical.bounds.min[a]-1e-6&&coordinate<=canonical.bounds.max[a]+1e-6,`${kind}: conservative ${a} bounds`);
    }
    for(let a=0;a<3;a++)assert.ok(Math.abs(d.bounds.min[a]-canonical.bounds.min[a])<1e-6&&Math.abs(d.bounds.max[a]-canonical.bounds.max[a])<1e-6);
    assert.ok(Math.abs(d.pivot[1]-d.bounds.max[1])<.001);
  }
});

test('sin tela no se inventa accesorio; aplicar la separación dos veces no duplica geometría',async()=>{
  const c=await character(true),first=split(c.parts,c.bones,c.source),second=split(first.parts,c.bones,c.source);
  assert.deepEqual(triangleMultiset(second.parts),triangleMultiset(first.parts));
  assert.equal(triangles(second.parts.filter(p=>p.accessory==='apron')),3200);
  const unrelated=c.parts.filter(p=>p.boneName!=='pelvis'),none=split(unrelated,c.bones,c.source);
  assert.equal(none.descriptor,null);assert.deepEqual(none.parts,unrelated);
});
