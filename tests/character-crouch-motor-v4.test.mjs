import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import {advanceBodyEvasion,CROUCH_DEPTH,FEINT_DURATION,FEINT_PEAK_FRACTION} from '../public/physics/body-evasion.js';

test('Crouch conserva intención rápida y limita sólo el motor físico en unidades mundiales de ambos tamaños',()=>{
  for(const boss of [false,true]){
    const control=Object.freeze({mainX:.4,wrist:-.6,guard:true,attackHeld:true}),f={boss,controller:control},depth=CROUCH_DEPTH*(boss?1.18:1);
    let previous=0,previousVelocity=0,maxVelocity=0,maxAcceleration=0;
    for(let frame=0;frame<420;frame++){
      const e=advanceBodyEvasion(f,frame<180?-1:0,STEP,true);
      assert.ok(Number.isFinite(e.motorCrouch)&&Number.isFinite(e.motorCrouchVelocity),'physical motor fields exist and remain finite');
      assert.ok(e.motorCrouch>=0&&e.motorCrouch<=1);
      const position=depth*e.motorCrouch,velocity=(position-previous)/STEP,acceleration=(velocity-previousVelocity)/STEP;
      maxVelocity=Math.max(maxVelocity,Math.abs(velocity));maxAcceleration=Math.max(maxAcceleration,Math.abs(acceleration));
      assert.ok(Math.abs(velocity)<=.8+1e-9,`world velocity ${velocity}`);
      assert.ok(Math.abs(acceleration)<=5+1e-9,`world acceleration ${acceleration}`);
      previous=position;previousVelocity=velocity;
      if(frame===11){assert.ok(Math.abs(e.crouch-(1-Math.exp(-1.2)))<1e-12);assert.ok(e.motorCrouch<e.crouch-.5,'fast semantic intention stays separate from physical progress');}
    }
    assert.ok(Math.abs(maxVelocity-.8)<1e-9&&Math.abs(maxAcceleration-5)<1e-9,'fixture exercises both physical limits');
    assert.ok(f.evasion.motorCrouch<.001,'release returns the motor toward neutral');
    assert.equal(f.controller,control);assert.deepEqual(control,{mainX:.4,wrist:-.6,guard:true,attackHeld:true});
  }
});

test('Un objetivo analógico igual al motor en movimiento conserva el límite de aceleración',()=>{
  const f={},depth=CROUCH_DEPTH;
  let previousPosition=0,previousVelocity=0;
  for(let frame=0;frame<30;frame++){
    const e=advanceBodyEvasion(f,-1,STEP,true),position=depth*e.motorCrouch;
    previousVelocity=(position-previousPosition)/STEP;previousPosition=position;
  }
  assert.ok(Math.abs(previousVelocity-.8)<1e-9,'the fixture reaches the physical velocity cap');
  const target=f.evasion.motorCrouch;
  advanceBodyEvasion(f,-target,STEP,true);
  const position=depth*f.evasion.motorCrouch,velocity=(position-previousPosition)/STEP;
  const acceleration=(velocity-previousVelocity)/STEP;
  assert.ok(f.evasion.motorCrouch>=0&&f.evasion.motorCrouch<=1);
  assert.ok(Math.abs(acceleration)<=5+1e-9,`analog target acceleration ${acceleration} m/s²`);
  assert.ok(Math.abs(depth*f.evasion.motorCrouchVelocity-velocity)<1e-9,'stored and realized velocities agree');
});

test('dt0 conserva la velocidad física aunque el mando coincida con la meta interior actual',()=>{
  const f={};for(let frame=0;frame<30;frame++)advanceBodyEvasion(f,-1,STEP,true);
  const before={position:f.evasion.motorCrouch,velocity:f.evasion.motorCrouchVelocity};
  advanceBodyEvasion(f,-before.position,0,true);
  assert.equal(f.evasion.motorCrouch,before.position);assert.equal(f.evasion.motorCrouchVelocity,before.velocity);
});

test('Reversiones y metas analógicas cerca de ambos límites conservan V/A en tres relojes fijos',()=>{
  for(const boss of [false,true])for(const h of [STEP,1/60,1/30]){
    const f={boss},depth=CROUCH_DEPTH*(boss?1.18:1);let position=0,velocity=0;
    const sample=target=>{
      const e=advanceBodyEvasion(f,-target,h,true),next=depth*e.motorCrouch,nextVelocity=(next-position)/h;
      const acceleration=(nextVelocity-velocity)/h;
      assert.ok(e.motorCrouch>=0&&e.motorCrouch<=1);
      assert.ok(Math.abs(nextVelocity)<=.8+1e-9);
      assert.ok(Math.abs(acceleration)<=5+1e-9,`boundary/analog ${boss}/${h}/${target}: ${acceleration}`);
      assert.ok(Math.abs(depth*e.motorCrouchVelocity-nextVelocity)<1e-9,'stored velocity cannot hide a final-step clipping impulse');
      position=next;velocity=nextVelocity;return e;
    };
    for(const target of [1,0,1,0]){
      let reached=false;
      for(let frame=0;frame<240;frame++){
        const e=sample(target);
        if(target?e.motorCrouch>.97:e.motorCrouch<.03){reached=true;break;}
      }
      assert.ok(reached,'the fixture must reach each endpoint neighborhood before reversing');
      assert.ok(Math.abs(velocity)>.01,'reversal starts while the physical motor is still moving');
      sample(f.evasion.motorCrouch); // An analog goal under the moving material, near either bound.
    }
    for(const target of [.25,.7,.4,.6,0,1,0])for(let frame=0;frame<Math.ceil(.2/h);frame++)sample(target);
  }
});

test('Un estado de crouch ya existente inicia el motor en el valor previo, sin salto ni velocidad heredada inválida',()=>{
  for(const boss of [false,true]){
    const f={boss,evasion:{crouch:.6,feint:0,age:-1,latched:false,cooldown:0}};
    advanceBodyEvasion(f,-1,0,true);
    assert.equal(f.evasion.crouch,.6);assert.equal(f.evasion.motorCrouch,.6);assert.equal(f.evasion.motorCrouchVelocity,0);
    f.evasion.motorCrouch=NaN;f.evasion.motorCrouchVelocity=NaN;
    advanceBodyEvasion(f,0,0,true);assert.equal(f.evasion.motorCrouch,.6);assert.equal(f.evasion.motorCrouchVelocity,0);
  }
});

test('La separación física no modifica controles ni la finta original de .85 segundos',()=>{
  const controller=Object.freeze({bodyY:1,mainX:.3,offY:.7,wrist:-.4,thrust:true,guard:true}),f={controller};
  advanceBodyEvasion(f,1,0,true);advanceBodyEvasion(f,1,FEINT_DURATION*FEINT_PEAK_FRACTION,true);
  assert.ok(f.evasion.feint>.999999);assert.equal(FEINT_DURATION,.85);assert.equal(FEINT_PEAK_FRACTION,.38);
  advanceBodyEvasion(f,1,FEINT_DURATION*(1-FEINT_PEAK_FRACTION),true);assert.equal(f.evasion.feint,0);assert.equal(f.evasion.age,-1);
  advanceBodyEvasion(f,1,.2,true);assert.equal(f.evasion.age,-1,'holding still cannot repeat the feint');
  assert.equal(f.controller,controller);assert.deepEqual(controller,{bodyY:1,mainX:.3,offY:.7,wrist:-.4,thrust:true,guard:true});
});

test('buildPose usa el motor para Y y mantiene fallback para estados anteriores sin motor',()=>{
  for(const difficulty of ['normal','boss']){
    const g=new DuelEngine();g.setDifficulty(difficulty);
    for(const f of g.fighters){
      const scale=f.boss?1.18:1;f.evasion={...f.evasion,crouch:1,motorCrouch:.25,feint:0};
      const physical=g.buildPose(f);assert.ok(Math.abs(physical.hip.y-(TABLE_TOP+(.98-CROUCH_DEPTH*.25)*scale))<1e-12);
      delete f.evasion.motorCrouch;const legacy=g.buildPose(f);
      assert.ok(Math.abs(legacy.hip.y-(TABLE_TOP+(.98-CROUCH_DEPTH)*scale))<1e-12);
    }
  }
});

test('La predicción de clearance usa Y física, no la intención rápida adelantada',()=>{
  function spacing(intent,motor){
    const g=new DuelEngine();g.setMode('versus');g.phase='fight';
    for(const f of g.fighters){f.baseX=-f.dir*.1;f.lean=.85;g.setControl(f.slot,{headX:f.dir});f.evasion={crouch:0,motorCrouch:0,feint:0};}
    const e=g.fighters[0].evasion;e.crouch=intent;
    if(motor===undefined)delete e.motorCrouch;else e.motorCrouch=motor;
    g.updateFootwork(0);return g.fighters[1].baseX-g.fighters[0].baseX;
  }
  const neutral=spacing(0,0),pending=spacing(1,0),achieved=spacing(1,1);
  assert.ok(Math.abs(neutral-pending)<1e-12,'semantic crouch alone cannot change the physical clearance envelope');
  assert.ok(achieved<pending-.001,'achieved vertical separation changes the head envelope');
  assert.ok(Math.abs(spacing(1,undefined)-achieved)<1e-12,'legacy states retain the previous fallback');
});

test('Crouch legal y retorno sostienen ambos pies, profundidad y caps físicos sin motor externo de base',t=>{
  const evidence=[];
  for(const difficulty of ['normal','boss']){
    const g=new DuelEngine();g.setDifficulty(difficulty);g.phase='fight';
    for(let frame=0;frame<90;frame++)for(const f of g.fighters)g.updateFighter(f,STEP);
    const before=g.fighters.map(f=>f.pose.hip.y),previous=g.fighters.map(f=>f.rig.target[1]),previousVelocity=[0,0];
    const metrics=g.fighters.map(f=>({difficulty,slot:f.slot,boss:f.boss,maxGap:0,minNormal:Infinity,maxTargetV:0,maxTargetA:0}));
    for(let frame=0;frame<420;frame++)for(const [i,f]of g.fighters.entries()){
      g.setControl(f.slot,{bodyY:frame<180?-1:0});g.updateFighter(f,STEP);const d=f.rig.diagnostics(),m=metrics[i];
      const velocity=(f.rig.target[1]-previous[i])/STEP,acceleration=(velocity-previousVelocity[i])/STEP;
      m.maxTargetV=Math.max(m.maxTargetV,Math.abs(velocity));m.maxTargetA=Math.max(m.maxTargetA,Math.abs(acceleration));previous[i]=f.rig.target[1];previousVelocity[i]=velocity;
      assert.ok(Math.abs(velocity)<=.8+1e-9&&Math.abs(acceleration)<=5+1e-9,'observed physical hip target respects world limits');
      assert.equal(d.motorTorque[0],0);assert.equal(d.motorTorque[1],0);
      assert.ok(d.minimumGroundY>=TABLE_TOP-.0003);assert.ok(d.contacts.every(c=>c.error<.0002));
      for(const foot of Object.values(f.pose.feet)){
        const gap=Math.min(...foot.hull.map(p=>p.y))-TABLE_TOP;m.maxGap=Math.max(m.maxGap,gap);m.minNormal=Math.min(m.minNormal,foot.groundReaction);
        assert.ok(Math.abs(gap)<.0003,`supported material hull: ${difficulty}/${f.slot}/${frame}: ${gap}`);
        assert.ok(foot.stance&&foot.groundReaction>0,'both feet transmit a real positive normal throughout crouch and return');
      }
      if(frame===11)assert.ok(Math.abs(f.evasion.crouch-(1-Math.exp(-1.2)))<1e-12);
      if(frame===179){m.descent=before[i]-f.pose.hip.y;assert.ok(m.descent>.20);}
      if(frame===419){m.returnError=Math.abs(f.pose.hip.y-before[i]);assert.ok(m.returnError<.02);}
    }
    evidence.push(...metrics);
  }
  t.diagnostic(JSON.stringify(evidence));
});
