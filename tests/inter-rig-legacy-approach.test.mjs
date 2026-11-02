import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {BALLOON_RADII} from '../public/physics/dimensions.js';

// Historical contract B: raw pre-character-v4 engine and N14 rig snapshots.
// The fixtures are self-contained test inputs: execution never reads the
// .superpowers archive from which their original bytes were preserved.
// Other relative imports intentionally resolve to the corresponding public/
// dependencies. This is a historical N14 approach fixture, not a claim of
// numerical or physical equivalence with the current N16 solver/contact model.
const snapshots={
  engine:{file:'engine-pre-character-v4-1.12.js.txt',sha:'c15937c1b35da53d7836048aae4577e4079624f9f7acff6b5b8eb149195e84dc'},
  rig:{file:'articulated-rig-pre-character-v4-1.12.js.txt',sha:'b18375efac5b262551ef2f8efe36ad37c2fb2769f83601aee175d20c8630f92e'},
};
async function pinnedSource({file,sha}){
  const bytes=await readFile(new URL(`./fixtures/${file}`,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sha,`${file}: preserved raw bytes`);
  return bytes.toString('utf8');
}
function relocated(source,logicalModule,overrides={}){
  return source.replace(/(from\s*['"])(\.{1,2}\/[^'"]+)(['"])/g,
    (_,prefix,path,suffix)=>prefix+(overrides[path]??new URL(path,logicalModule).href)+suffix);
}
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
function stable(f){
  const d=f.rig.diagnostics();
  assert.ok(d.contacts.every(c=>c.error<.0002));
  assert.ok(d.coordinates.every(q=>Number.isFinite(q.position)&&q.position>=q.min-1e-8&&q.position<=q.max+1e-8));
}

test('Histórico N14: dos humanos con armas bajas acercan globos vivos dentro del guard original',async t=>{
  const [rigSource,engineSource]=await Promise.all([pinnedSource(snapshots.rig),pinnedSource(snapshots.engine)]);
  const archivedRigURL=moduleURL(relocated(rigSource,new URL('../public/physics/articulated-rig.js',import.meta.url)));
  const engineURL=moduleURL(relocated(engineSource,new URL('../public/engine.js',import.meta.url),{
    './physics/articulated-rig.js':archivedRigURL,
  }));
  const {DuelEngine,STEP}=await import(engineURL);
  const g=new DuelEngine();g.setLoadout(1,{defense:'none'});g.setLoadout(2,{defense:'none'});
  g.setMode('versus');g.start();for(let i=0;i<81;i++)g.update(.04);
  assert.equal(g.phase,'fight');
  for(const f of g.fighters){assert.equal(f.rig.q.length,14);assert.equal('feet'in f.pose,false);}
  let minimum=Infinity;
  for(let tick=0;tick<390;tick++){
    const lean=tick<90?0:1;
    g.setControl(1,{mainX:-1,mainY:-1,wrist:-1,lean,headX:lean});
    g.setControl(2,{mainX:-1,mainY:-1,wrist:-1,lean,headX:-lean});g.update(STEP);
    const [a,b]=g.fighters;
    assert.ok(a.globIntact&&b.globIntact,'la preparación y el acercamiento mantienen ambos globos vivos');
    const p=a.pose.head,q=b.pose.head,s=a.balloonSize+b.balloonSize;
    minimum=Math.min(minimum,Math.hypot((p.x-q.x)/(BALLOON_RADII.x*s),(p.y-q.y)/(BALLOON_RADII.y*s),(p.z-q.z)/(BALLOON_RADII.z*s)));
    for(const f of g.fighters)stable(f);
  }
  assert.ok(minimum>=1-1e-5,`minimum ${minimum}`);
  assert.ok(minimum<1.15,`el control histórico debe ejercitar cercanía real: ${minimum}`);
  assert.deepEqual(g.scores,[0,0]);
  t.diagnostic(`N14 historical minimum=${minimum}; 81×.04 + 390×STEP; both balloons intact; scores=0,0`);
});
