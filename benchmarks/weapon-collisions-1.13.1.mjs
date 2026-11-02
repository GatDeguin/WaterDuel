import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {serialize} from 'node:v8';
import {performance} from 'node:perf_hooks';
// Same current dependencies in both graphs; only these three frozen modules
// are replaced for the 1.13 reference. No browser, renderer or audio device.
const root=path.resolve(import.meta.dirname,'..'),folder=path.join(root,'.runtime/perf-collision-1.13.1'),label='collision-1.13.1';
const mode=({verify:'oracle',benchmark:'paired'})[process.argv[2]??'verify'];if(!mode)throw Error('Use verify or benchmark');
const sha=b=>createHash('sha256').update(b).digest('hex');
const overrides=new Map([
 ['public/physics/articulated-rig.js',['tests/fixtures/articulated-rig-pre-collision-1.13.js.txt','e02e42100d66b8d25b3d525d0d4a53f54edcdeabaf04152091bc3eccfa8e518b']],
 ['public/physics/apron-cloth.js',['tests/fixtures/apron-cloth-pre-1.14.js.txt','cf3d7c3c3f85c716cdce6b6ab5b146d204bf1c10d77485e3be1e2f1cd15878ba']],
 ['public/physics/weapon-bind.js',['tests/fixtures/weapon-bind-pre-query-1.13.js.txt','96250b199cac641d405f98d0180441e1ffe889754325480557e9fd5c804b7e9a']]
]);
const seen=new Set(),sources=[],changes=[];
async function graph(file){
 if(seen.has(file))return;seen.add(file);
 const current=await fs.readFile(path.join(root,file)),override=overrides.get(file),baseline=override?await fs.readFile(path.join(root,override[0])):current;
 if(override)assert.equal(sha(baseline),override[1],'immutable reference '+file);
 const record={file,source:file,sha256:sha(current),baselineSHA:sha(baseline)};sources.push(record);if(override)changes.push(record);
 for(const [base,bytes] of [[path.join(folder,'baseline'),baseline],[path.join(folder,'graphs',label),current]]){const to=path.join(base,file);await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,bytes);}
 for(const text of [baseline.toString('utf8'),current.toString('utf8')])for(const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))await graph(path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1])));
}
for(const file of ['public/engine.js','public/joysticks.js','public/replay.js'])await graph(file);
const load=(base,file)=>import(pathToFileURL(path.join(base,file)).href);
const [A,B,{weaponGesture},{captureReplayState}]=await Promise.all([load(path.join(folder,'baseline'),'public/engine.js'),load(path.join(folder,'graphs',label),'public/engine.js'),load(path.join(folder,'baseline'),'public/joysticks.js'),load(path.join(folder,'baseline'),'public/replay.js')]);
const recipes=['sword','spear','axe','maul'].flatMap(weapon=>['neutral','bind'].map(recipe=>({weapon,recipe})));
function make(api,spec){let seed=0x57445141;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),previous=Math.random;Math.random=random;try{const events=[],game=new api.DuelEngine((name,data)=>events.push({name,data}));game.setMode('versus');game.setScenario('practice');game.setLoadout(1,{weapon:spec.weapon});game.setLoadout(2,{weapon:spec.weapon});game.aiEnabled=false;game.phase='fight';return {game,events,random,tick:0,steps:[]};}finally{Math.random=previous;}}
function tick(run,api){const {game,random,tick:i}=run;for(const slot of [1,2])game.setControl(slot,run.spec.recipe==='bind'?{...weaponGesture({x:.9,y:(slot===1?1:-1)*.15*Math.sin(i*.05)}),lean:.2}:api.neutral());const original=Math.random;Math.random=random;const start=performance.now();try{game.update(api.STEP);}finally{Math.random=original;}run.steps.push({ms:performance.now()-start,steel:!!game.lastWeaponContact});run.tick++;}
const snapshot=run=>({replay:captureReplayState(run.game),rigs:run.game.fighters.map(f=>f.rig.diagnostics()),steel:run.game.lastWeaponContact,body:run.game.lastBodyContacts,events:run.events});
const stats=values=>{const s=values.toSorted((a,b)=>a-b);return {n:s.length,mean:s.length?values.reduce((n,v)=>n+v,0)/s.length:null,p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)};};
const coverage=run=>({weapon:run.spec.weapon,recipe:run.spec.recipe,ticks:run.tick,steel:run.steps.filter(s=>s.steel).length,phase:run.game.phase,eventCounts:run.events.reduce((a,e)=>(a[e.name]=(a[e.name]??0)+1,a),{})});
function execute(api){const runs=recipes.map(spec=>({...make(api,spec),spec})),start=performance.now(),cpu=process.cpuUsage();for(const run of runs)while(run.tick<180&&run.game.phase==='fight')tick(run,api);const usage=process.cpuUsage(cpu),wall=performance.now()-start,parts=runs.map(run=>({...coverage(run),all:stats(run.steps.map(s=>s.ms)),touch:stats(run.steps.filter(s=>s.steel).map(s=>s.ms))}));const terminal=runs.map(snapshot);return {wallMs:wall,cpuMs:(usage.user+usage.system)/1000,physicsMs:runs.reduce((s,r)=>s+r.steps.reduce((a,x)=>a+x.ms,0),0),parts,terminal};}
const receipt={label,mode,sources,changes,scope:'Deterministic real whole-engine Node CPU; no rendering/GPU/FPS claim',pass:false};
if(mode==='oracle'){
 let compared=0,steel=0;receipt.parts=[];
 for(const spec of recipes){const a={...make(A,spec),spec},b={...make(B,spec),spec};while(a.tick<180&&a.game.phase==='fight'){tick(a,A);tick(b,B);assert.deepEqual(snapshot(b),snapshot(a),`${spec.weapon}/${spec.recipe}/${a.tick}`);compared++;steel+=!!a.game.lastWeaponContact;}assert.equal(b.game.phase,a.game.phase);receipt.parts.push(coverage(a));}
 assert.ok(compared>800&&steel>250);receipt.exactUpdates=compared;receipt.steelUpdates=steel;
}else{
 const warmA=execute(A),warmB=execute(B);assert.deepEqual(warmB.terminal,warmA.terminal);receipt.warmups=2;receipt.runs=[];
 for(let round=0;round<4;round++)for(const branch of ['A','B','B','A']){const result=execute(branch==='A'?A:B);assert.deepEqual(result.terminal,warmA.terminal);const {terminal,...measurement}=result;receipt.runs.push({round,branch,...measurement,digest:sha(serialize(terminal))});await fs.writeFile(path.join(folder,label+'-paired.json'),JSON.stringify(receipt,null,2));}
 receipt.rounds=Array.from({length:4},(_,round)=>{const rows=receipt.runs.filter(r=>r.round===round),mean=b=>rows.filter(r=>r.branch===b).reduce((s,r)=>s+r.physicsMs,0)/2;return {round,A:mean('A'),B:mean('B'),reduction:1-mean('B')/mean('A')};});
}
for(const r of sources)assert.equal(sha(await fs.readFile(path.join(root,r.source))),r.sha256,'candidate source changed during measurement');
receipt.pass=true;await fs.writeFile(path.join(folder,label+'-'+mode+'.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({label,mode,pass:true,exactUpdates:receipt.exactUpdates,steelUpdates:receipt.steelUpdates,rounds:receipt.rounds}));
