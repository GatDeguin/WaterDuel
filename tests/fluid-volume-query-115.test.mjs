import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {FluidVolume} from '../public/physics/fluid.js';
const origin=new URL('../public/physics/fluid.js',import.meta.url),source=await fs.readFile(new URL('./fixtures/fluid-pre-volume-query-1.15.js.txt',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),'cc52b342969598de6d4757894b54e4e8ff26af0bbe1afe0f8447f0a40af7673a');
const code=source.replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_m,p,q,path)=>p+q+new URL(path,origin).href+q),Before=(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).FluidVolume;
const H=1/120,head={x:0,y:2.4,z:.025},impact={x:-.422,y:2.4,z:.025};
test('native partial-phase volume queries avoid filtered arrays while list getters stay fresh and owned',()=>{
  for(const Class of [Before,FluidVolume]){
    let filters=0;class CountedParticles extends Array{filter(...args){filters++;return super.filter(...args);}}
    const f=new Class(1,200);f.released=f.leaking=true;f.particles=CountedParticles.from(f.particles);f.particles.forEach((p,i)=>{p.free=i%3===0;});
    const expected={free:f.particles.filter(p=>p.free).reduce((s,p)=>s+p.volume,0),retained:f.particles.filter(p=>!p.free).reduce((s,p)=>s+p.volume,0)};
    filters=0;for(let i=0;i<12;i++){assert.equal(f.releasedVolume,expected.free);assert.equal(f.retainedVolume,expected.retained);}
    if(Class===Before)assert.equal(filters,24,'the frozen oracle actually allocates both filtered arrays per query');
    else assert.equal(filters,0,'native volume-only reads must not allocate filtered particle lists');
    const a=f.releasedParticles,b=f.releasedParticles,c=f.retainedParticles,d=f.retainedParticles;
    assert.notEqual(a,b);assert.notEqual(c,d);assert.deepEqual(a,b);assert.deepEqual(c,d);
    a.length=0;c.length=0;assert.ok(b.length>0&&d.length>0);assert.equal(f.particles.length,200);
  }
});
test('native reductions retain original order, excluded parcels, holes, signed zero and every phase branch',()=>{
  for(const leaking of [false,true])for(const released of [false,true]){
    const particles=[];particles[1]={free:true,volume:1e16};particles[3]={free:false,volume:NaN};particles[4]={free:true,volume:1};
    particles[7]={free:true,volume:-1e16};particles[9]={free:false,volume:-0};particles[11]={free:0,volume:.001};
    const a=new Before(1,12),b=new FluidVolume(1,12);for(const f of [a,b]){f.particles=particles;f.leaking=leaking;f.released=released;}
    assert.equal(b.releasedVolume,a.releasedVolume);assert.equal(b.retainedVolume,a.retainedVolume);
    assert.deepEqual(b.releasedParticles,a.releasedParticles);assert.deepEqual(b.retainedParticles,a.retainedParticles);
  }
});
test('own, data, subclass and later prototype overrides of the public lists retain their original volume semantics',()=>{
  for(const key of ['releasedParticles','retainedParticles']){
    const volumeKey=key==='releasedParticles'?'releasedVolume':'retainedVolume',custom=[{volume:.125},{volume:.25}];
    for(const Class of [Before,FluidVolume]){
      for(const kind of ['getter','data']){
        const f=new Class(1,20);f.released=f.leaking=true;Object.defineProperty(f,key,kind==='getter'?{get:()=>custom}:{value:custom});assert.equal(f[volumeKey],.375);
      }
      class Sub extends Class{}Object.defineProperty(Sub.prototype,key,{get:()=>custom});const sub=new Sub(1,20);sub.leaking=true;assert.equal(sub[volumeKey],.375);
      const original=Object.getOwnPropertyDescriptor(Class.prototype,key);
      try{Object.defineProperty(Class.prototype,key,{configurable:true,get:()=>custom});const f=new Class(1,20);f.leaking=true;assert.equal(f[volumeKey],.375);}
      finally{Object.defineProperty(Class.prototype,key,original);}
    }
  }
});
test('real progressive leaks at normal/boss counts preserve each parcel, ledger and momentum across all caller clocks',()=>{
  for(const count of [200,260])for(const dt of [H,1/30]){
    const pair=[new Before(1,count,count===260?1.18:1),new FluidVolume(1,count,count===260?1.18:1)];
    for(const f of pair){f.keepContained(head,H,.03,0);f.beginLeak({head,impact,attackDir:1,thrust:.8});}
    const iterations=dt===H?90:23;
    for(let i=0;i<iterations;i++){
      for(const f of pair)f.advanceLeak(dt,{head:{x:.01*i,y:2.4,z:.025},apertureArea:i<12?.02:.05,pressure:.6,containmentCapacity:i<iterations-5?Infinity:0,time:i*dt});
      assert.deepEqual(pair[1].particles,pair[0].particles);assert.deepEqual(pair[1].leakState,pair[0].leakState);assert.deepEqual(pair[1].stats(),pair[0].stats());
      assert.equal(pair[1].releasedVolume,pair[0].releasedVolume);assert.equal(pair[1].retainedVolume,pair[0].retainedVolume);
    }
  }
});
