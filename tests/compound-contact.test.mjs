import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {resolveWeaponBind,weaponBindManifold} from '../public/physics/weapon-bind.js';
import {TABLE_TOP,BALLOON_RADII} from '../public/physics/dimensions.js';

async function historicalRig(){
  const bytes=await fs.readFile(new URL('./fixtures/articulated-rig-pre-character-v4-1.12.js.txt',import.meta.url));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'b18375efac5b262551ef2f8efe36ad37c2fb2769f83601aee175d20c8630f92e','raw N14 portátil, sin regenerarlo desde N16');
  const logicalModule=new URL('../public/physics/articulated-rig.js',import.meta.url);
  const source=bytes.toString('utf8').replace(/(from\s*['"])(\.{1,2}\/[^'"]+)(['"])/g,
    (_,prefix,path,suffix)=>prefix+new URL(path,logicalModule).href+suffix);
  return (await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).ArticulatedRig;
}

test('Histórico N14: la captura profunda original se resuelve aislada aunque ready ya prepare contactos de acero',async()=>{
  const HistoricalRig=await historicalRig();
  const bytes=await fs.readFile(new URL('../audit/weapon-bind-contact-fixture.json',import.meta.url));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'78b028557aae816a24098e96362ab87b4d6779363be4d0e9b8a2d4852be7501a','el fixture profundo original no se sustituye por un inicio ya separado');
  const f=JSON.parse(bytes,(_key,value)=>value?.$typed?new globalThis[value.$typed](value.data):value);
  const [a,b]=f.rigs.map(state=>Object.assign(new HistoricalRig(),structuredClone(state)));
  for(const r of [a,b])assert.equal(r.q.length,14,'el estado histórico no se presenta como una captura N16');
  const original=[a,b].map(r=>({target:r.target.slice(),water:structuredClone(r.waterLoad),length:r.swordLength}));
  const steel=resolveWeaponBind(a,b,{dt:f.dt,project:false});assert.ok(steel.at);
  const manifold=()=>weaponBindManifold(a,b,steel);
  const result=HistoricalRig.resolvePair(a,b,{headRadiiA:f.headRadiiA,headRadiiB:f.headRadiiB,extraContacts:manifold});
  for(const c of [...result.contacts,...manifold()])assert.ok(c.penetration<.001,`${c.keyA}/${c.keyB}: ${c.penetration}`);
  for(const [i,r]of [a,b].entries()){
    const d=r.diagnostics();assert.ok(d.contacts.every(c=>c.error<.0002));
    assert.ok(d.minimumWeaponY>=TABLE_TOP-1e-5);
    assert.ok(d.coordinates.every(c=>Number.isFinite(c.position)&&Number.isFinite(c.velocity)&&c.position>=c.min-1e-8&&c.position<=c.max+1e-8));
    assert.deepEqual(r.target,original[i].target);assert.deepEqual(r.waterLoad,original[i].water);assert.equal(r.swordLength,original[i].length);
  }
});

// Independent SAT check of the native starting panels. It does not call the
// pair solver, so an already separated fixture cannot satisfy this coverage.
function panelPenetration(a,b){
  let depth=(a.depth+b.depth)/2-Math.abs(a.z-b.z);
  for(const n of [...a.axes,...b.axes]){
    const A=a.vertices.map(p=>p.x*n.x+p.y*n.y),B=b.vertices.map(p=>p.x*n.x+p.y*n.y);
    depth=Math.min(depth,Math.max(...A)-Math.min(...B),Math.max(...B)-Math.min(...A));
  }
  return depth;
}
function woodenPenetration(a,b){
  let depth=-Infinity;
  for(const pa of a.collisionPanels())for(const pb of b.collisionPanels()){
    if(pa.body==='weapon'&&pb.body==='weapon')continue;
    depth=Math.max(depth,panelPenetration(pa,pb));
  }
  return depth;
}

test('N16 nativo: acero y madera parten de penetraciones reales y se resuelven juntos sin alterar intención ni carga',()=>{
  for(const dir of [-1,1]){
    const a=new ArticulatedRig({dir,baseX:-dir*1.53,gravity:0}),b=new ArticulatedRig({dir:-dir,baseX:dir*1.53,gravity:0});
    b.q[1]+=.025;a.previousQ=a.q.slice();b.previousQ=b.q.slice();
    for(const r of [a,b])for(const key of ['q','velocity','target','limits'])assert.equal(r[key].length,16);
    assert.ok(woodenPenetration(a,b)>.001,'la madera también participa desde una interpenetración medida');
    const original=[a,b].map(r=>({target:r.target.slice(),water:structuredClone(r.waterLoad),length:r.swordLength}));
    const steel=resolveWeaponBind(a,b,{dt:1/120,project:false});assert.ok(steel.at);
    const manifold=()=>weaponBindManifold(a,b,steel);
    assert.ok(manifold().some(c=>c.penetration>.001),'el acero no empieza ya separado');
    const result=ArticulatedRig.resolvePair(a,b,{headRadiiA:BALLOON_RADII,headRadiiB:BALLOON_RADII,extraContacts:manifold});
    for(const c of [...result.contacts,...manifold()])assert.ok(c.penetration<.001,`${c.keyA}/${c.keyB}: ${c.penetration}`);
    assert.ok(woodenPenetration(a,b)<.001,'el SAT independiente confirma el despeje final de madera');
    for(const [i,r]of [a,b].entries()){
      const d=r.diagnostics();assert.ok(d.contacts.every(c=>c.error<.0002));
      assert.ok(d.minimumWeaponY>=TABLE_TOP-1e-5);
      assert.ok(d.coordinates.every(c=>Number.isFinite(c.position)&&Number.isFinite(c.velocity)&&c.position>=c.min-1e-8&&c.position<=c.max+1e-8));
      assert.deepEqual(r.target,original[i].target);assert.deepEqual(r.waterLoad,original[i].water);assert.equal(r.swordLength,original[i].length);
    }
  }
});
