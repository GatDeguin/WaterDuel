import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {WorkshopEffects,EFFECT_LIMITS} from '../public/workshop-effects.js';

const bytes=await fs.readFile(new URL('./fixtures/workshop-effects-pre-opt-1.7.2.js.txt',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'10d661b94af9c44e9c0360cafed24a5a745cd8e9f6fac08ace9638c7ca8a1880','The 1.7.2 reference is a pinned, unmodified source oracle.');
const airBytes=await fs.readFile(new URL('./fixtures/workshop-air-pre-opt-1.7.2.js.txt',import.meta.url));
assert.equal(createHash('sha256').update(airBytes).digest('hex'),'2048d0534ebf223822d26bd6575b326e0c7099a28891a1c33bcf33e315d56c76','The reference also keeps the original air sampler, independently of future optimizations.');
const air=`data:text/javascript;base64,${airBytes.toString('base64')}`;
const source=bytes.toString('utf8').replace("'./workshop-air.js'",JSON.stringify(air));
const {WorkshopEffects:Reference}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const state=fx=>({particles:fx.particles,free:fx.free,stats:fx.stats(),snapshot:fx.snapshot(),seed:fx.state,accumulator:fx.accumulator,time:fx.time,dustCredit:fx.dustCredit,smokeCredit:fx.smokeCredit});
const at={x:-2.8,y:2.1,z:-3.9},normal={x:.2,y:.5,z:-.3};
const fan={pivot:[-3.5,2.2,-4],axis:[1,0,.2],radius:.6,angularSpeed:18};

test('Particle emission, retirement and integration remain bit-exact against 1.7.2 in mixed seeded traces',()=>{
 for(const seed of [0,17,0xffffffff,NaN])for(const ambient of [false,true]){
  const options={seed,ambient,fanRotor:fan,combustionSources:[{kind:'oilLamp',...at},{kind:'candle',x:2,y:1.1,z:-4}]};
  const a=new Reference(options),b=new WorkshopEffects(options);
  assert.deepEqual(state(b),state(a));
  const events=[['clang',{at,normal,impulse:.35}],['material-contact',{at,normal,impulse:.15,material:'wood'}],['material-contact',{at,normal,impulse:.15,material:'latex'}],['burst',{contact:true,draw:true,impacts:[at,{x:2,y:1.9,z:.2}]}],['joint-damage',{at,normal,slot:1,damage:.2}],['joint-break',{at,normal,slot:2,damage:.7}]];
  for(let frame=0;frame<720;frame++){
   if(frame%3===0){const [event,data]=events[Math.floor(frame/3)%events.length];assert.equal(b.emit(event,data),a.emit(event,data));}
   if(frame%97===0)assert.equal(b.emit('reset'),a.emit('reset'));
   if(frame===250){const environment={windows:[{x:0,y:2,z:-4}],combustionSources:[{kind:'candle',...at}],fanRotor:null};a.configureEnvironment(environment);b.configureEnvironment(environment);}
   if(frame===500){const environment={fanRotor:fan,windows:[],combustionSources:[]};a.configureEnvironment(environment);b.configureEnvironment(environment);}
   const dt=[1/120,1/60,1/30,.25,NaN,0,-1,Infinity][frame%8];
   assert.equal(b.step(dt),a.step(dt));assert.deepEqual(state(b),state(a),`seed ${seed}, ambient ${ambient}, frame ${frame}`);
  }
 }
});

test('Saturation keeps every 1.7.2 spark parameter, pool limit and caller-owned snapshot',()=>{
 assert.equal(EFFECT_LIMITS.spark,56);assert.equal(EFFECT_LIMITS.total,176);
 const a=new Reference({seed:29,ambient:false}),b=new WorkshopEffects({seed:29,ambient:false});
 const impulses=[0,.0001,.00011,.02,.15,.35,.75,1,NaN];
 for(let round=0;round<40;round++){
  for(const impulse of impulses){const data={at,normal,impulse};assert.equal(b.emit('clang',data),a.emit('clang',data));}
  assert.deepEqual(state(b),state(a));
  const saved=b.snapshot(),json=JSON.stringify(saved);b.step(.25);a.step(.25);assert.equal(JSON.stringify(saved),json);assert.deepEqual(state(b),state(a));
 }
});
