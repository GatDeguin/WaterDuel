// CPU-only paired native volume queries/leak, separate A/B processes.
// node benchmarks/fluid-volume-paired-1.13.2.mjs --output <new receipt.json>
// --candidate accepts a pinned archived source; completed receipts are never overwritten.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(projectRoot,arg('--output')??'benchmarks/results/fluid-volume-paired-1.13.2.json'),progress=output+'.progress.json';
await fs.mkdir(dirname(output),{recursive:true});
try{await fs.access(output);throw Error('Refusing to overwrite an existing benchmark receipt: '+output);}catch(error){if(error.code!=='ENOENT')throw error;}
const sha=v=>createHash('sha256').update(v).digest('hex'),origin=pathToFileURL(resolve(projectRoot,arg('--candidate')??'public/physics/fluid.js')),initialHash=sha(await fs.readFile(origin));
assert.equal(initialHash,'12df4bee2cda985fb64b38e4108370d8ed157b0e041897a36e596415815bb31f');
await fs.writeFile(progress,JSON.stringify({})+String.fromCharCode(10),{flag:'wx'});
const median=values=>{const s=values.toSorted((a,b)=>a-b),n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
function worker(variant,spec){
  const child=fork(new URL('fluid-volume-paired-worker-1.13.2.mjs',import.meta.url),[variant,spec.kind,spec.recipe,String(spec.fraction??0),origin.href],{silent:true,windowsHide:true});let serial=0,stderr='';child.stderr.on('data',d=>{stderr+=d;});const pending=new Map();
  let resolveReady,rejectReady;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  child.on('error',rejectReady);child.on('exit',code=>{if(code){const e=Error('worker failed '+code+' '+stderr);rejectReady(e);for(const p of pending.values())p.reject(e);}});
  child.on('message',message=>{if(message.type==='ready'){resolveReady(message);return;}const p=pending.get(message.id);if(!p)return;pending.delete(message.id);message.error?p.reject(Error(message.error)):p.resolve(message);});
  return {ready,run:()=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});child.send({id,command:'run'});}),close:()=>{if(child.connected)child.send({command:'close'});}};
}
const specs=[...['normal','boss260'].flatMap(recipe=>[.15,.7].map(fraction=>({kind:'readings',recipe,fraction}))),...['normal','boss260','original260'].map(recipe=>({kind:'physical',recipe}))],results=[];
for(const spec of specs){
  const workers={A:worker('A',spec),B:worker('B',spec)},ready={A:await workers.A.ready,B:await workers.B.ready};
  try{
    assert.equal(ready.A.sourceHash,'cc52b342969598de6d4757894b54e4e8ff26af0bbe1afe0f8447f0a40af7673a','pinned complete baseline');
    assert.equal(ready.B.sourceHash,initialHash,'worker receives the pinned candidate');
    assert.deepEqual(ready.A.fixture,ready.B.fixture);assert.deepEqual(ready.A.recipe,ready.B.recipe);
    let expectedHash=null,expectedInitial=null,expectedFinal=null,expectedSum=null;
    const run=async variant=>{const r=await workers[variant].run();if(expectedHash===null){expectedHash=r.stateHash;expectedInitial=r.initial;expectedFinal=r.final;expectedSum=r.sum;}
      else{assert.equal(r.stateHash,expectedHash,'same native complete end-state');assert.deepEqual(r.initial,expectedInitial);assert.deepEqual(r.final,expectedFinal);assert.equal(r.sum,expectedSum);}return r;};
    for(let warm=0;warm<4;warm++)for(const v of warm%2?['B','A']:['A','B'])await run(v);
    const rounds=[];
    for(let round=0;round<4;round++){
      const samples=[];for(const variant of round%2?['B','A','A','B']:['A','B','B','A'])samples.push({variant,...await run(variant)});
      const controls=[await run('A'),await run('A')],A=samples.filter(s=>s.variant==='A').reduce((sum,s)=>sum+s.ms,0),B=samples.filter(s=>s.variant==='B').reduce((sum,s)=>sum+s.ms,0);
      rounds.push({round,samples,controls,A,B,ratio:B/A,noise:Math.abs(controls[1].ms/controls[0].ms-1)});
      await fs.writeFile(progress,JSON.stringify({completed:results,current:{spec,ready,rounds}},null,2)+'\n');
    }
    results.push({...spec,ready,rounds,medianRatio:median(rounds.map(r=>r.ratio)),ratioRange:[Math.min(...rounds.map(r=>r.ratio)),Math.max(...rounds.map(r=>r.ratio))],maxNoise:Math.max(...rounds.map(r=>r.noise))});
  }finally{workers.A.close();workers.B.close();}
}
const aggregate=items=>{const rounds=Array.from({length:4},(_,i)=>{const A=items.reduce((sum,r)=>sum+r.rounds[i].A,0),B=items.reduce((sum,r)=>sum+r.rounds[i].B,0),a0=items.reduce((sum,r)=>sum+r.rounds[i].controls[0].ms,0),a1=items.reduce((sum,r)=>sum+r.rounds[i].controls[1].ms,0);return {round:i,A,B,ratio:B/A,a0,a1,noise:Math.abs(a1/a0-1)};});return {rounds,medianRatio:median(rounds.map(r=>r.ratio)),ratioRange:[Math.min(...rounds.map(r=>r.ratio)),Math.max(...rounds.map(r=>r.ratio))],maxNoise:Math.max(...rounds.map(r=>r.noise))};};
assert.equal(sha(await fs.readFile(origin)),initialHash,'source stable');
const readings=aggregate(results.filter(r=>r.kind==='readings')),physical=aggregate(results.filter(r=>r.kind==='physical'&&r.recipe!=='original260'));
const report={scope:'Corrected native physical/query components, separate persistent Node process for each A/B/component/recipe; uninstrumented product bodies, native API-evolved parcels in BOTH branches, no trace or shared JIT. No full engine, solids, membrane, renderer/GPU/browser/FPS.',sourceHash:initialHash,
  methodology:{warmupPairs:4,rounds:4,stepsPerPhysicalSample:72,physicalSeconds:.6,readPairs:4000,order:'ABBA/BAAB alternating; independent AA each round/recipe',median:'conventional',gate:'UNCHANGED: readings saving > max aggregate AA and every reading case wins; physical no aggregate regression beyond AA; original1.18 is separate diagnostic only'},results,readings,physical,
  keep:1-readings.medianRatio>readings.maxNoise&&results.filter(r=>r.kind==='readings').every(r=>r.medianRatio<1)&&physical.medianRatio<=1+physical.maxNoise,
  physicalCaseFlags:results.filter(r=>r.kind==='physical'&&r.recipe!=='original260').map(r=>({recipe:r.recipe,withinControl:r.medianRatio<=1+r.maxNoise}))};
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({sourceHash:report.sourceHash,results:results.map(({ready,rounds,...r})=>({...r,recipeInputs:ready.A.recipe,initial:rounds[0].samples[0].initial,final:rounds[0].samples[0].final})),readings,physical,keep:report.keep,physicalCaseFlags:report.physicalCaseFlags},null,2));
