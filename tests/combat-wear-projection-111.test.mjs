import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms} from '../public/rendering/asset-rig.js';
import {bodyForBone} from '../public/rendering/joint-damage.js';
import {DuelEngine} from '../public/engine.js';
import {projectionModule,wearCorpus,patchValue,drawLog} from './fixtures/combat-wear-corpus-1.11.mjs';
const [reference,current]=await Promise.all([projectionModule(true),projectionModule()]);

test('triangle misses avoid per-triangle typed-array slices while retaining exact projection',()=>{
  const positions=new Float32Array([-.2,-.2,.2,.2,-.2,.2,0,.2,.2]),indices=new Uint32Array([0,1,2]);let slices=0;
  for(const values of [positions,indices]){const original=values.subarray;values.subarray=function(...args){slices++;return original.apply(this,args);};}
  const prepared={parts:[{boneName:'forearm.R',material:0,positions,indices}],asset:{materials:[{pbrMetallicRoughness:{metallicFactor:0}}]}},matrices=[new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])];
  const mark={body:'mainForearm',key:'mainForearm',position:{x:3,y:0,z:.18},normal:{x:0,y:0,z:1}};
  assert.equal(current.projectForOracle(mark,{prepared,matrices}),null);assert.equal(slices,0,'a missed triangle must not allocate source slices');
});

test('scalar projection keeps edge hits, misses, ordering ties and mutable geometry exact for both scratch and direct vertices',()=>{
  const positions=new Float32Array([-.2,-.2,.2,.2,-.2,.2,0,.2,.2]),indices=new Uint32Array([0,1,2,0,1,2]);
  const matrix=new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),part={boneName:'forearm.R',material:0,positions,indices};
  const prepared={id:'sword',parts:[part],asset:{materials:[{pbrMetallicRoughness:{metallicFactor:1}}]}};
  const base={body:'mainForearm',key:'mainForearm',position:{x:0,y:0,z:.18},normal:{x:0,y:0,z:1},length:.012};
  for(const deform of [null,{matrix,extension:0,deformStart:0,deformEnd:1,flexOffset:0,flexLength:1,flexDirection:1}]){
    const geometry=deform?{equipment:[{prepared,transform:deform}]}:{prepared,matrices:[matrix]};
    for(const x of [-.2,-0,0,.2,3])for(const y of [-.2,0,.2])for(const nz of [1,-1,0]){
      const mark={...base,body:deform?'weapon':'mainForearm',position:{x,y,z:.18},normal:{x:0,y:0,z:nz}};
      assert.deepEqual(patchValue(current.projectForOracle(mark,geometry)),patchValue(reference.projectForOracle(mark,geometry)));
      assert.deepEqual(patchValue(current.projectForOracle(mark,geometry,true)),patchValue(reference.projectForOracle(mark,geometry,true)));
    }
    // Prepared arrays are usually immutable, but the scratch must not retain
    // stale values when a caller updates positions or deformation in place.
    positions[2]=.21;if(deform)deform.extension=.07;
    const mark={...base,body:deform?'weapon':'mainForearm'};
    assert.deepEqual(patchValue(current.projectForOracle(mark,geometry)),patchValue(reference.projectForOracle(mark,geometry)));positions[2]=.2;
  }
});

test('real character bones, material selection and oil projections retain exact barycentrics and draw frames',async()=>{
  const game=new DuelEngine();let hits=0;
  for(const file of ['water-mannequin.glb','water-mannequin-amber.glb','water-mannequin-boss.glb']){
    const bytes=await fs.readFile(new URL('../public/assets/characters/water-mannequin/v3/'+file,import.meta.url)),prepared=prepareCharacter(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
    for(const fighter of game.fighters){
      const matrices=characterTransforms(prepared,{...fighter,boss:file.includes('boss')}),geometry={prepared,matrices};
      for(const boneName of ['forearm.R','upper_arm.L','hand.R','thigh.R','shin.L','chest']){
        const pi=prepared.parts.findIndex(p=>!p.accessory&&p.boneName===boneName);if(pi<0)continue;const part=prepared.parts[pi],m=matrices[pi],ids=Array.from(part.indices.subarray(0,3));
        const vertices=ids.map(j=>[0,1,2].map(i=>m[i]*part.positions[j*3]+m[i+4]*part.positions[j*3+1]+m[i+8]*part.positions[j*3+2]+m[i+12])),[a,b,c]=vertices,e=b.map((v,i)=>v-a[i]),f=c.map((v,i)=>v-a[i]);
        const n=[e[1]*f[2]-e[2]*f[1],e[2]*f[0]-e[0]*f[2],e[0]*f[1]-e[1]*f[0]],length=Math.hypot(...n);if(length<1e-10)continue;for(let i=0;i<3;i++)n[i]/=length;
        const center=a.map((v,i)=>(v+b[i]+c[i])/3),mark={id:1,body:bodyForBone(boneName),key:'main-palm',position:{x:center[0]-n[0]*.002,y:center[1]-n[1]*.002,z:center[2]-n[2]*.002},normal:{x:n[0],y:n[1],z:n[2]},length:.012,impulse:.1};
        for(const oil of [false,true]){const expected=reference.projectForOracle(mark,geometry,oil);assert.deepEqual(patchValue(current.projectForOracle(mark,geometry,oil)),patchValue(expected),file+'/'+boneName+'/'+oil);if(expected)hits++;}
        const entry={fighter:{slot:fighter.slot,pose:{surface:{marks:[mark]},joints:{}}},geometry,mark};assert.deepEqual(drawLog(current,entry),drawLog(reference,entry));
      }
    }
  }
  assert.ok(hits>=18,'real character surface patches must be exercised');
});

test('all real equipment, mirrored sides, extension, flex, draw frames and fragment transforms remain exact against the pinned 1.10 projector',async()=>{
  const corpus=await wearCorpus();assert.ok(corpus.length>300);let hits=0;
  for(const entry of corpus){
    const expected=reference.projectForOracle(entry.mark,entry.geometry),actual=current.projectForOracle(entry.mark,entry.geometry);
    assert.deepEqual(patchValue(actual),patchValue(expected),entry.label);if(expected)hits++;
    const oldOwner={},newOwner={};assert.deepEqual(drawLog(current,entry,{owner:newOwner}),drawLog(reference,entry,{owner:oldOwner}),entry.label+' initial');
    const delta=new Float64Array([0,1,0,0,-1,0,0,0,0,0,1,0,.3,-.2,0,1]);
    assert.deepEqual(drawLog(current,entry,{owner:newOwner,transform:delta}),drawLog(reference,entry,{owner:oldOwner,transform:delta}),entry.label+' detached frame');
    const miss={...entry,mark:{...entry.mark,id:2,position:{x:999,y:999,z:999}}};assert.deepEqual(drawLog(current,miss,{owner:newOwner}),drawLog(reference,miss,{owner:oldOwner}),entry.label+' miss');
  }
  assert.ok(hits>200,'the corpus must exercise actual selected triangles and barycentric patches');
});
