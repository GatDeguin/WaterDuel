import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const folder=path.resolve(import.meta.dirname,'../.runtime/perf-collision-1.13.1');
try{await fs.access(path.join(folder,'baseline/public/engine.js'));}catch{throw Error('Run node benchmarks/weapon-collisions-1.13.1.mjs verify first');}
async function api(base){return {...await import(pathToFileURL(path.join(base,'public/physics/articulated-rig.js')).href),...await import(pathToFileURL(path.join(base,'public/physics/weapon-bind.js')).href)};}
const [A,B]=await Promise.all([api(path.join(folder,'baseline')),api(path.join(folder,'graphs/collision-1.13.1'))]);
function make(module,dir,scale){
 const a=new module.ArticulatedRig({dir,scale,baseX:-dir*1.53*scale,gravity:0}),b=new module.ArticulatedRig({dir:-dir,scale,baseX:dir*1.53*scale,gravity:0});
 b.q[1]+=.025;for(const r of [a,b])r.previousQ=r.q.slice();const c=module.firstWeaponContact(a,b);assert.ok(c);const n=c.normal,t={x:-n.y,y:n.x};
 a.reactImpulse({body:'weapon',point:c.pointA,impulse:{x:n.x*.06+t.x*.035,y:n.y*.06+t.y*.035}});b.reactImpulse({body:'weapon',point:c.pointB,impulse:{x:-n.x*.06-t.x*.035,y:-n.y*.06-t.y*.035}});
 const snapshots=[a,b].map(r=>({velocity:r.velocity.slice(),contacts:structuredClone(r.contacts),lastImpulse:structuredClone(r.lastImpulse)}));
 return {a,b,snapshots,dir,scale};
}
function reset(run){[run.a,run.b].forEach((r,i)=>{const s=run.snapshots[i];r.velocity.set(s.velocity);for(let j=0;j<r.contacts.length;j++)Object.assign(r.contacts[j],s.contacts[j]);r.lastImpulse=s.lastImpulse;});}
const sample=(module,run)=>{reset(run);const before=performance.now(),result=module.resolveWeaponBind(run.a,run.b,{project:false,observeVelocities:true}),ms=performance.now()-before;return {ms,result,state:[run.a,run.b].map(r=>({q:r.q.slice(),velocity:r.velocity.slice(),target:r.target.slice(),contacts:structuredClone(r.contacts),lastImpulse:structuredClone(r.lastImpulse)}))};};
const specs=[[-1,1],[-1,1.18],[1,1],[1,1.18]],cases=specs.map(([dir,scale])=>({A:make(A,dir,scale),B:make(B,dir,scale)}));
const expected=cases.map(run=>{const a=sample(A,run.A),b=sample(B,run.B);assert.ok(a.result.impulse>0);assert.deepEqual(b.result,a.result);assert.deepEqual(b.state,a.state);return a;});
for(let warm=0;warm<64;warm++)for(const [i,r]of cases.entries())for(const [module,run]of [[A,r.A],[B,r.B]]){const s=sample(module,run);assert.deepEqual(s.result,expected[i].result);assert.deepEqual(s.state,expected[i].state);}
const records=[];
for(let round=0;round<4;round++)for(const branch of ['A','B','B','A']){
 const module=branch==='A'?A:B;let ms=0;
 for(const [i,r]of cases.entries())for(let call=0;call<64;call++){const s=sample(module,r[branch]);ms+=s.ms;assert.deepEqual(s.result,expected[i].result);assert.deepEqual(s.state,expected[i].state);}
 records.push({round,branch,calls:256,ms});
}
const rounds=Array.from({length:4},(_,round)=>{const group=records.filter(r=>r.round===round),mean=b=>group.filter(r=>r.branch===b).reduce((s,r)=>s+r.ms,0)/2;return {round,A:mean('A'),B:mean('B'),reduction:1-mean('B')/mean('A')};});
const receipt={scope:'Isolated real resolveWeaponBind signed forcejeo, project:false, 4 mirror/scale cases, native methods unwrapped, resets and assertions outside timer. Not whole engine or FPS.',warmupCallsPerCasePerBranch:64,calls:4096,records,rounds,pass:true};
await fs.writeFile(path.join(folder,'query-component.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({rounds,calls:4096}));
