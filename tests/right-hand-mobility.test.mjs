import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {weaponGesture} from '../public/joysticks.js';

// Component behavior, not a claim that a sword/maul contact was reproduced.
// All poses/q remain owned by the real rig; deferSupport skips only the unrelated
// fluid/membrane support update. No full engine update, AI or synthetic collision.
function fixture(slot){
  const events=[],game=new DuelEngine((name,data)=>events.push({name,data}));game.setMode('versus');game.phase='fight';
  const fighter=game.fighters[slot-1];let steps=0;
  const advance=(count=120)=>{for(let i=0;i<count;i++){game.updateFighter(fighter,STEP,{deferSupport:true});steps++;}assert.ok(fighter.rig.q.every(Number.isFinite));};
  const hold=(x,y,count=120)=>{const gesture=weaponGesture({x,y});game.setControl(slot,gesture);advance(count);return sample(gesture);};
  const sample=gesture=>{
    const p=fighter.pose,dir=fighter.dir;
    return {steps,gesture,lunge:fighter.lunge,mainX:fighter.mainX,mainY:fighter.mainY,
      hand:{x:p.mainHand.x,y:p.mainHand.y,z:p.mainHand.z},tip:{x:p.tip.x,y:p.tip.y,z:p.tip.z},
      handLocal:dir*(p.mainHand.x-p.mainShoulder.x),tipLocal:dir*(p.tip.x-p.mainShoulder.x),
      bladeLength:Math.hypot(p.tip.x-p.mainHand.x,p.tip.y-p.mainHand.y),wristAngle:p.wristAngle};
  };
  return {game,fighter,events,hold,advance,sample};
}

for(const slot of [1,2]){
  test(`Retirada horizontal del jugador ${slot} reduce estocada y recoge mano/punta reales detrás del neutro`,()=>{
    const f=fixture(slot),neutral=f.hold(0,0,180),forward=f.hold(1,0),back=f.hold(-1,0);
    const movement={handFromForward:forward.handLocal-back.handLocal,tipFromForward:forward.tipLocal-back.tipLocal,
      handBehindNeutral:neutral.handLocal-back.handLocal,tipBehindNeutral:neutral.tipLocal-back.tipLocal};
    assert.equal(back.gesture.attackHeld,true,'wire/weaponGesture stay unchanged: the engine must interpret retreat');
    assert.ok(forward.lunge>.99,'the fixture must first extend the real arm');
    assert.ok(back.lunge<.001,`backward horizontal must remove extension; actual ${back.lunge}`);
    assert.ok(movement.handFromForward>.02&&movement.tipFromForward>.02,`both physical points must retreat from extension; hand ${movement.handFromForward}, tip ${movement.tipFromForward}`);
    assert.ok(movement.handBehindNeutral>.02,`hand must genuinely fold past neutral; actual ${movement.handBehindNeutral}`);
    assert.ok(movement.tipBehindNeutral>.02,`tip must genuinely retract past neutral; actual ${movement.tipBehindNeutral}`);
    assert.equal(f.events.filter(event=>event.name==='thrust').length,0,'no timer/button attack is fabricated');
  });

  test(`Diagonal atrás del jugador ${slot} atenúa extensión de forma continua y vuelve a neutro`,()=>{
    const f=fixture(slot);f.hold(0,0,90);
    const vertical=f.hold(0,1),mild=f.hold(-.2,Math.sqrt(1-.2**2)),nearA=f.hold(-.49,Math.sqrt(1-.49**2),90),
      nearB=f.hold(-.51,Math.sqrt(1-.51**2),90),strong=f.hold(-.8,.6),neutral=f.hold(0,0);
    assert.ok(vertical.lunge>.99,'vertical keeps its delivered sustained extension');
    assert.ok(mild.lunge>.05&&mild.lunge<vertical.lunge-.05,`mild retreat must attenuate real lunge; actual ${mild.lunge}`);
    assert.ok(strong.lunge>.05&&strong.lunge<mild.lunge-.2,`strong diagonal remains partial, not full or instantly zero; actual ${strong.lunge}`);
    assert.ok(nearA.lunge>nearB.lunge&&nearA.lunge-nearB.lunge<.06,`nearby diagonal inputs must not produce a discontinuous full/zero jump; ${nearA.lunge} → ${nearB.lunge}`);
    assert.ok(neutral.lunge<.001,'returning to center releases the sustained extension');
    assert.equal(f.events.filter(event=>event.name==='thrust').length,0);
  });

  test(`Forward, vertical, centro y release del jugador ${slot} conservan comportamiento físico sin botón`,()=>{
    const f=fixture(slot),neutral=f.hold(0,0),vertical=f.hold(0,1),forward=f.hold(.8,.6),released=f.hold(0,0);
    assert.ok(neutral.lunge<.001);assert.ok(vertical.lunge>.99);assert.ok(forward.lunge>.99);
    assert.ok(released.lunge<.001);assert.equal(released.gesture.attackHeld,false);
    assert.ok(Math.abs(released.mainX)<.001&&Math.abs(released.mainY)<.001,'the arm axes actually return to center');
    assert.equal(f.events.filter(event=>event.name==='thrust').length,0);
  });

  test(`Thrust legacy del jugador ${slot} sigue permitido como pulso sin reutilizar attackHeld`,()=>{
    const f=fixture(slot);f.hold(0,0,90);
    f.game.setControl(slot,{mainX:.5,mainY:.1,wrist:0,thrust:true});f.advance(1);const pulse=f.sample();
    assert.ok(pulse.lunge>.9);assert.equal(f.events.filter(event=>event.name==='thrust').length,1);
    f.advance(90);assert.equal(f.events.filter(event=>event.name==='thrust').length,1,'held legacy level must not repeat pulses');
    f.game.setControl(slot,weaponGesture({x:0,y:0}));f.advance(1);
    f.game.setControl(slot,{mainX:.5,mainY:.1,thrust:true});f.advance(1);
    assert.equal(f.events.filter(event=>event.name==='thrust').length,2,'a fresh legacy edge after cooldown remains allowed');
  });
}
