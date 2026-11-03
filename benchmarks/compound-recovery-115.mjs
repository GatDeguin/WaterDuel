import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
const root=new URL('../',import.meta.url),logicalRig=new URL('public/physics/articulated-rig.js',root),logicalBind=new URL('public/physics/weapon-bind.js',root);
const sha=b=>createHash('sha256').update(b).digest('hex'),encode=(k,v)=>ArrayBuffer.isView(v)?{$typed:v.constructor.name,data:Array.from(v)}:v instanceof Set?{$set:[...v]}:v;
const decode=(_k,v)=>v?.$typed?new globalThis[v.$typed](v.data):v?.$set?new Set(v.$set):v;
const relocation=(s,url,override={})=>s.replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_m,p,q,path)=>p+q+(override[path]??new URL(path,url).href)+q);
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const [rig,baselineBind,fixedBind]=await Promise.all([fs.readFile(logicalRig),fs.readFile(new URL('fixtures/weapon-bind-pre-compound-1.13.1.js.txt',import.meta.url)),fs.readFile(logicalBind)]);
assert.equal(sha(rig),'378248716a14da0a662929e2d04c26c416d334f8863c132eb2c7561e4fc76adb');
assert.equal(sha(baselineBind),'0f2b848742107375ed135658ad5d7eace1ae6beb45e65a487f90ee728759e351');
const variants={};
for(const [name,source]of [['baseline',baselineBind],['fixed',fixedBind]]){
  const rigURL=data(relocation(rig.toString('utf8'),logicalRig)+'\n// recovery measurement '+name),module=await import(rigURL);
  const bind=await import(data(relocation(source.toString('utf8'),logicalBind,{'./articulated-rig.js':rigURL})+'\n// '+name));variants[name]={...module,bind};
}
// Portable captured input, never regenerated from the fixed spawn and never
// moved to obtain a desired performance result. Baseline and fix restore the
// exact same typed coordinates/velocities/targets/supports for every run.
const raw=await fs.readFile(new URL('fixtures/compound-recovery-inputs-1.13.1.json',import.meta.url));
const captured=JSON.parse(raw,decode),cases=captured.cases,inputJSON=raw.toString('utf8');
assert.equal(captured.capturedEngineSHA,'ab55912da7216cdb3e8a5c8c52d5fcf9f68026e6981f3e19c8471b33f7dd9d2d');
assert.deepEqual(cases.map(c=>c.weapons),[['sword','axe'],['axe','sword'],['sword','sword']]);
const tableTop=(await import(new URL('public/physics/dimensions.js',root))).TABLE_TOP;
const radii=(await import(new URL('public/physics/dimensions.js',root))).BALLOON_RADII;
function restore(module,spec){return spec.rigs.map(({state,pose,flex})=>{const r=new module.ArticulatedRig({dir:state.dir,scale:state.scale,baseX:state.q[0],pose,gravity:state.gravity,flexibleWeapons:true});Object.assign(r,structuredClone(state));Object.assign(r.weaponFlex,structuredClone(flex));return r;});}
function steelPenetration(pair){let deepest=0;const steel=r=>r.collisionPanels().filter(p=>p.body==='weapon'&&p.material!=='wood');for(const a of steel(pair[0]))for(const b of steel(pair[1])){
  if(Math.abs(a.z-b.z)>=(a.depth+b.depth)/2)continue;let depth=Infinity;for(const n of [...a.axes,...b.axes]){const A=a.vertices.map(p=>p.x*n.x+p.y*n.y),B=b.vertices.map(p=>p.x*n.x+p.y*n.y);depth=Math.min(depth,Math.max(...A)-Math.min(...B),Math.max(...B)-Math.min(...A));}deepest=Math.max(deepest,depth);
}return Math.max(0,deepest);}
const signature=pair=>sha(JSON.stringify(pair.map(r=>({q:r.q,velocity:r.velocity,target:r.target,contacts:r.contacts,depth:r.depth,waterLoad:r.waterLoad,equipment:r.equipment,swordLength:r.swordLength,flex:{...r.weaponFlex}})),encode));
function run(name,spec,ticks){const module=variants[name],pair=restore(module,spec),initial=signature(pair),initialPenetration=steelPenetration(pair),targets=pair.map(r=>r.target.slice());
  const start=performance.now();let last=null,contactTicks=0;
  for(let tick=0;tick<ticks;tick++){
    for(const r of pair)r.step(1/120);
    const contact=module.bind.resolveWeaponBind(...pair,{dt:1/120,project:false});contactTicks+=!!contact.at;
    last=module.ArticulatedRig.resolvePair(...pair,{headRadiiA:radii,headRadiiB:radii,extraContacts:contact.at?()=>module.bind.weaponBindManifold(...pair,contact):undefined});
  }
  const elapsedMs=performance.now()-start;
  for(let i=0;i<2;i++){assert.deepEqual(pair[i].target,targets[i]);assert.ok(pair[i].q.every(Number.isFinite)&&pair[i].velocity.every(Number.isFinite));}
  return {name,weapons:spec.weapons,ticks,initialSignature:initial,initialPenetration,elapsedMs,contactTicks,finalSteelPenetration:steelPenetration(pair),
    finalBodyPenetration:Math.max(0,...last.contacts.map(c=>c.penetration)),finalState:pair.map(r=>({q:Array.from(r.q),velocity:Array.from(r.velocity),minimumWeaponY:r.diagnostics().minimumWeaponY,contacts:r.contacts})),tableTop};
}
// Warm both code graphs on identical captured input; restore fresh rigs for
// each recorded run. No method/prototype wrappers disable native behavior.
for(const name of ['baseline','fixed'])run(name,cases[0],2);
const receipt={schema:1,scope:'One short ABBA block per captured case and fixed 8/32 physical ticks. Physics/contact component only; no renderer, controller latency or FPS claim. Initial fixtures are restored unchanged, not compared for equality after the intentional bug fix.',
  rigSHA:sha(rig),baselineBindSHA:sha(baselineBind),fixedBindSHA:sha(fixedBind),inputSHA:sha(inputJSON),order:['baseline','fixed','fixed','baseline'],runs:[]};
const deadline=performance.now()+14000;
for(const spec of cases)for(const ticks of [8,32])for(const name of receipt.order){
  if(performance.now()>deadline-1200){receipt.budgetStopped=true;break;}
  const result=run(name,spec,ticks);receipt.runs.push(result);
  const siblings=receipt.runs.filter(r=>r.ticks===ticks&&r.weapons.join('/')===spec.weapons.join('/'));assert.ok(siblings.every(r=>r.initialSignature===result.initialSignature),'same captured initial state for both variants');
  console.log(JSON.stringify({name,weapons:spec.weapons,ticks,elapsedMs:result.elapsedMs,initial:result.initialPenetration,remaining:result.finalSteelPenetration}));
}
assert.equal(sha(await fs.readFile(logicalBind)),sha(fixedBind),'fixed source stable during measurement');assert.equal(sha(await fs.readFile(logicalRig)),sha(rig),'rig source stable');
receipt.sourceStable=true;
const outIndex=process.argv.indexOf('--out');
if(outIndex>=0){assert.ok(process.argv[outIndex+1],'--out requires a file');const out=path.resolve(process.argv[outIndex+1]);await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(receipt,null,2)+'\n');}
console.log(JSON.stringify({runs:receipt.runs.length,budgetStopped:receipt.budgetStopped??false,sourceStable:true,inputSHA:receipt.inputSHA}));
