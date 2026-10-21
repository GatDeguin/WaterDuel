import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as current from '../public/physics/fluid-solids.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
const frozen=await readFile(new URL('./fixtures/fluid-solids-pre-local-probe-1.7.4.js.txt',import.meta.url));
assert.equal(createHash('sha256').update(frozen).digest('hex'),'6f080caa0efad73b5ac4392748a5f9ec5d28243c482461442e2ebc380e5c950a','The complete 1.7.4 liquid/solid collision oracle is immutable.');
const source=frozen.toString().replace("'./detached-fluid-colliders.js'",JSON.stringify(new URL('../public/physics/detached-fluid-colliders.js',import.meta.url).href));
const oracle=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const rng=()=>{let state=0x175f101d;return ()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);};
const board=(extra={})=>({center:{x:0,y:1,z:0},axes:[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}],half:[.3,.003,.3],...extra});
function movingBoard(trace,retained,{angle=.11,translation=0}={}){
 return board({motion:{centerBound:Math.abs(translation)+.000001,angleRate:angle,halfBound:0,translation:{x:translation,y:0,z:0},angularBound:0,centerExtension:0},motionAt:t=>{
  trace.push(t);const a=-angle/2+angle*t,c=Math.cos(a),s=Math.sin(a);return board({center:{x:translation*t,y:1,z:0},axes:[{x:c,y:s,z:0},{x:-s,y:c,z:0},{x:0,y:0,z:1}]});
 },velocityAt:point=>{retained.push(point);return {vx:translation*120,vy:.03*point.x,vz:0};}});
}
function sameQuery(a,b,parcel,from,radius,options={}){
 const pa=structuredClone(parcel),pb=structuredClone(parcel),saved=structuredClone(from);
 const ra=current.resolveLiquidSolid(pa,from,radius,1/120,a,options),rb=oracle.resolveLiquidSolid(pb,from,radius,1/120,b,options);
 assert.deepEqual(ra,rb);assert.deepEqual(pa,pb);assert.deepEqual(Object.keys(pa),Object.keys(pb));assert.deepEqual(from,saved);assert.equal(pa.volume,parcel.volume);
 return {parcel:pa,result:ra,changed:JSON.stringify(pa)!==JSON.stringify(parcel)};
}

test('Liquid CCD keeps every moving-shape query, tangency, corner response and retained callback point exact',()=>{
 const random=rng();let longQueries=0,changed=0;
 for(let i=0;i<240;i++){
  const radius=[.002,.005,.015][i%3],from=i===0?{x:0,y:1+.003+radius+.000013,z:0}:{x:random()*.9-.45,y:.99+random()*.08,z:random()*.8-.4};
  const parcel={x:from.x+(i===0?0:(random()-.5)*.12),y:from.y+(i===0?0:(random()-.5)*.12),z:from.z,vx:i===0?0:random()*8-4,vy:i===0?0:-random()*8,vz:0,volume:1e-7};
  const traceA=[],traceB=[],retainedA=[],retainedB=[],config={angle:[.11,.4,1.1][i%3],translation:i%4===0?.02:0};if(i===0)config.translation=0;
  const a=movingBoard(traceA,retainedA,config),b=movingBoard(traceB,retainedB,config);
  const result=sameQuery([a],[b],parcel,from,radius,i%5===0?{timeFrom:.13,timeTo:.88}:{});changed+=result.changed;longQueries+=traceA.length>96;
  assert.deepEqual(traceA,traceB,'every CCD time and its order must be identical');assert.deepEqual(retainedA,retainedB);
  const saved=structuredClone(retainedA);sameQuery([a],[b],{...parcel,x:parcel.x+.1},from,radius);assert.deepEqual(retainedA.slice(0,saved.length),saved,'later probes cannot mutate prior velocity callback points');
 }
 assert.ok(changed>0);assert.ok(longQueries>0,'the corpus must reach interval-search fallback beyond 96 advances');
});

test('Real liquid proxies keep exact collisions across weapons, flex, both directions, scales and substep intervals',()=>{
 const random=rng();let queries=0,changed=0;
 for(const dir of [-1,1])for(const scale of [1,1.18])for(const weapon of ['sword','spear','axe','maul']){
  const rig=new ArticulatedRig({dir,scale,gravity:0,flexibleWeapons:true});rig.equipment={weapon,defense:'none'};rig.twoHanded=weapon==='maul';rig.gripOffset=rig.twoHanded?.22:0;
  rig.swordLength=1.69;rig.previousSwordLength=1.03;rig.previousQ=rig.q.slice();
  for(let i=0;i<rig.q.length;i++){rig.q[i]=Math.max(rig.limits[i][0],Math.min(rig.limits[i][1],rig.q[i]+.09*Math.sin(i+2)));rig.velocity[i]=.2*Math.cos(i);}
  if(rig.weaponFlex?.maximum){rig.weaponFlex.offset=.023;rig.weaponFlex.previousOffset=-.017;}
  const saved={q:[...rig.q],previous:[...rig.previousQ],velocity:[...rig.velocity]},a=current.fluidSolidColliders([{rig}]),b=oracle.fluidSolidColliders([{rig}]);
  for(const index of [0,2,4,a.length-2,a.length-1])for(let n=0;n<4;n++){
   const solid=a[index],from={x:solid.center.x+(random()-.5)*.1,y:solid.center.y+(random()-.5)*.1,z:solid.center.z+(n===3?.8:0)};
   const parcel={x:from.x+.02,y:from.y-.04,z:from.z,vx:2.4,vy:-4.8,vz:0,volume:1e-6};
   changed+=sameQuery(a,b,parcel,from,.008,n%2?{timeFrom:.25,timeTo:.75}:{}).changed;queries++;
  }
  assert.deepEqual({q:[...rig.q],previous:[...rig.previousQ],velocity:[...rig.velocity]},saved,'CCD must not change rig state');
 }
 assert.equal(queries,320);assert.ok(changed>0);
});

test('Detached liquid proxies preserve exact parcel inventory and contact without sharing scratch across queries',()=>{
 for(const dir of [-1,1])for(const scale of [1,1.18]){
  const rig=new ArticulatedRig({dir,scale,gravity:0});rig.damageJoint('mainElbow',1);const fragment=rig.fragments[0];
  fragment.previous={x:fragment.x-.03,y:fragment.y+.02,angle:fragment.angle-.08};fragment.vx=1;fragment.vy=-.5;fragment.omega=.3;
  const a=current.fluidSolidColliders([{rig}]),b=oracle.fluidSolidColliders([{rig}]);
  for(const index of a.map((solid,i)=>solid.fragmentId?i:-1).filter(i=>i>=0)){
   const s=a[index],from={x:s.center.x,y:s.center.y+.06,z:s.center.z},parcel={...from,y:from.y-.1,vx:0,vy:-12,vz:0,volume:1e-7};
   sameQuery(a,b,parcel,from,.005);sameQuery(a,b,parcel,from,.005,{timeFrom:.1,timeTo:.9});
  }
 }
});
