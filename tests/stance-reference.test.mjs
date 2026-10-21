import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';

const length=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function checkStance(f,{settled=false}={}){
  const p=f.pose,s=f.boss?1.18:1,d=f.dir;
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
  for(const key of ['footF','footB'])assert.ok(Math.abs(p[key].y-(TABLE_TOP+.075))<.0002,'feet retain grounded constraints');
  for(const [a,b,l] of [['frontHip','kneeF',.53],['kneeF','footF',.55],['backHip','kneeB',.53],['kneeB','footB',.55]])assert.ok(Math.abs(length(p[a],p[b])-l*s)<1e-8);
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
  for(const [a,b,l] of [['mainShoulder','mainElbow',.52],['mainElbow','mainHand',.52],['frontHip','kneeF',.53],['kneeF','footF',.55]])assert.ok(Math.abs(length(p[a],p[b])-l)<1e-8);
});
