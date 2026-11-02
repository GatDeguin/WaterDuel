import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {FOOT_SHAPES} from '../public/physics/foot-geometry.js';

const length=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const near=(a,b,message)=>assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<1e-8,message);
function checkFeet(f,{settled=false,legacy=false}={}){
  const p=f.pose,s=f.boss?1.18:1;
  if(legacy){
    for(const key of ['footF','footB'])assert.ok(Math.abs(p[key].y-(TABLE_TOP+.075))<.0002,'feet retain grounded constraints');
    return;
  }
  for(const [side,suffix]of [['front','F'],['back','B']]){
    const foot=p.feet[side],ankle=p['ankle'+suffix],shape=FOOT_SHAPES[f.boss?'boss':'normal'][side],m=foot.matrix,z=(shape.minZ+shape.maxZ)/2;
    assert.ok(m.length===16&&Array.from(m).every(Number.isFinite),'finite physical foot frame');
    near(Array.from(m.slice(12,15)),[ankle.x,ankle.y,ankle.z],'foot frame originates at the ankle');
    const axes=[0,4,8].map(i=>Array.from(m.slice(i,i+3)));
    for(const axis of axes)assert.ok(Math.abs(Math.hypot(...axis)-s)<1e-8,'foot material retains its authored scale');
    for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert.ok(Math.abs(axes[i].reduce((sum,v,k)=>sum+v*axes[j][k],0))<1e-8,'rigid ankle frame has no shear');
    const center=point(m,[0,shape.centerY,z]);
    near(center,[p['foot'+suffix].x,p['foot'+suffix].y,p['foot'+suffix].z],'published foot center follows its material frame');
    assert.equal(foot.hull.length,shape.hull.length);
    for(const [i,[x,y]]of shape.hull.entries())near(point(m,[x,y,z]),[foot.hull[i].x,foot.hull[i].y,foot.hull[i].z],'material hull does not stretch');
    assert.ok(Math.abs(foot.support.y-Math.min(...foot.hull.map(v=>v.y)))<1e-8,'support belongs to the hull minimum');
    assert.ok(Math.abs(foot.support.y-TABLE_TOP)<.0002,'physical hull retains grounded constraints');
    assert.ok(foot.groundReaction>=0&&(!settled||foot.groundReaction>0),'ground normal supports without tension');
  }
}
function checkStance(f,{settled=false,legacy=false}={}){
  const p=f.pose,s=f.boss?1.18:1,d=f.dir;
  checkFeet(f,{settled,legacy});
  assert.ok(Math.abs(p.hip.y-(TABLE_TOP+.98*s))<(settled?.055:.002),`hip ${p.hip.y}`);
  assert.ok(d*(p.footF.x-p.footB.x)>1.05*s,'the fencing base must be broad');
  assert.ok(p.kneeF.y>TABLE_TOP+.48*s&&p.kneeB.y>TABLE_TOP+.40*s,'knees must be raised, not folded at floor level');
  assert.ok(d*(p.kneeF.x-p.footF.x)>0,'front knee bends toward the opponent');
  assert.ok(d*(p.kneeB.x-p.footB.x)>.20*s,'back shin opens behind the pelvis');
  assert.ok(Math.abs(length(p.hip,p.shoulder)-.755*s)<1e-8,'torso uses v2 proportions');
  assert.ok(d*(p.shoulder.x-p.hip.x)>.025*s&&d*(p.shoulder.x-p.hip.x)<.30*s,'torso has a controlled forward fencing inclination');
  assert.ok(d*(p.mainHand.x-p.mainShoulder.x)>.65*s,'main hand extends forward');
  assert.ok(p.mainElbow.y<p.mainHand.y-.10*s,'main elbow sits below the hand');
  assert.ok(d*(p.offHand.x-p.offShoulder.x)<-.60*s,'balancing hand stays behind');
  assert.ok(p.offElbow.y<p.offHand.y-.10*s,'balancing elbow sits below the raised hand');
  for(const [a,b,l] of [['frontHip','kneeF',.53],['kneeF',legacy?'footF':'ankleF',.55],['backHip','kneeB',.53],['kneeB',legacy?'footB':'ankleB',.55]])assert.ok(Math.abs(length(p[a],p[b])-l*s)<1e-8);
}

test('La postura inicial física coincide con la base, rodillas y brazos de la segunda referencia en ambos tamaños',()=>{
  for(const difficulty of ['normal','boss']){
    const g=new DuelEngine();g.setDifficulty(difficulty);for(const f of g.fighters)checkStance(f);
  }
});

test('La postura de referencia se sostiene con masa de agua real y conserva apoyos durante dos segundos',()=>{
  for(const difficulty of ['normal','boss']){
    const g=new DuelEngine();g.setDifficulty(difficulty);for(let i=0;i<240;i++)g.update(STEP);
    for(const f of g.fighters){checkStance(f,{settled:true});assert.ok(f.rig.diagnostics().contacts.every(c=>c.error<.0002));}
  }
});

test('La nueva guardia es intención dinámica: entradas altas/bajas mueven manos sin alterar piezas ni congelar la pose',()=>{
  const g=new DuelEngine();g.setMode('versus');g.start();for(let i=0;i<81;i++)g.update(.04);
  const initial=g.fighters[0].pose,hand={...initial.mainHand};g.setControl(1,{mainX:1,mainY:1,offX:1,offY:1,wrist:1,lean:.5});
  for(let i=0;i<90;i++)g.update(STEP);const f=g.fighters[0],p=f.pose;
  assert.ok(length(hand,p.mainHand)>.20,'main control still acts on the multibody');
  assert.ok(f.rig.diagnostics().coordinates.every(q=>Number.isFinite(q.position)&&q.position>=q.min-1e-8&&q.position<=q.max+1e-8));
  assert.ok(f.rig.diagnostics().contacts.every(c=>c.error<.0002));
  for(const [a,b,l] of [['mainShoulder','mainElbow',.52],['mainElbow','mainHand',.52],['frontHip','kneeF',.53],['kneeF','ankleF',.55]])assert.ok(Math.abs(length(p[a],p[b])-l)<1e-8);
});

// Portable raw N14 snapshots preserve the original center-height and leg
// endpoints. Remaining relative dependencies map to their public/ file URLs;
// this historical contract does not assert physical equivalence with N16.
async function historicalEngine(){
  const read=async(file,sha)=>{
    const bytes=await readFile(new URL(`./fixtures/${file}`,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),sha,`${file}: preserved raw bytes`);
    return bytes.toString('utf8');
  };
  const relocate=(source,path,overrides={})=>source.replace(/(from\s*['"])(\.{1,2}\/[^'"]+)(['"])/g,
    (_,a,p,c)=>a+(overrides[p]??new URL(p,new URL(path,import.meta.url)).href)+c);
  const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
  const [rig,engine]=await Promise.all([
    read('articulated-rig-pre-character-v4-1.12.js.txt','b18375efac5b262551ef2f8efe36ad37c2fb2769f83601aee175d20c8630f92e'),
    read('engine-pre-character-v4-1.12.js.txt','c15937c1b35da53d7836048aae4577e4079624f9f7acff6b5b8eb149195e84dc'),
  ]);
  const rigURL=moduleURL(relocate(rig,'../public/physics/articulated-rig.js'));
  return import(moduleURL(relocate(engine,'../public/engine.js',{'./physics/articulated-rig.js':rigURL})));
}

test('Histórico N14 conserva postura inicial/240 pasos, centros de pie y guardia activa originales',async()=>{
  const {DuelEngine:Historical,STEP:legacyStep}=await historicalEngine();
  for(const difficulty of ['normal','boss']){
    const g=new Historical();g.setDifficulty(difficulty);
    for(const f of g.fighters){assert.equal(f.rig.q.length,14);assert.equal('feet'in f.pose,false);checkStance(f,{legacy:true});}
    for(let i=0;i<240;i++)g.update(legacyStep);
    for(const f of g.fighters){checkStance(f,{settled:true,legacy:true});assert.ok(f.rig.diagnostics().contacts.every(c=>c.error<.0002));}
  }
  const g=new Historical();g.setMode('versus');g.start();for(let i=0;i<81;i++)g.update(.04);
  const hand={...g.fighters[0].pose.mainHand};g.setControl(1,{mainX:1,mainY:1,offX:1,offY:1,wrist:1,lean:.5});
  for(let i=0;i<90;i++)g.update(legacyStep);const f=g.fighters[0],p=f.pose;
  assert.ok(length(hand,p.mainHand)>.20,'main control still acts on the multibody');
  assert.ok(f.rig.diagnostics().coordinates.every(q=>Number.isFinite(q.position)&&q.position>=q.min-1e-8&&q.position<=q.max+1e-8));
  assert.ok(f.rig.diagnostics().contacts.every(c=>c.error<.0002));
  for(const [a,b,l]of [['mainShoulder','mainElbow',.52],['mainElbow','mainHand',.52],['frontHip','kneeF',.53],['kneeF','footF',.55]])assert.ok(Math.abs(length(p[a],p[b])-l)<1e-8);
});
