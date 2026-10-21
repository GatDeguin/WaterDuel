import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {weaponGesture} from '../public/joysticks.js';
import {firstWeaponPointContact} from '../public/physics/weapon-bind.js';
import {segmentEllipsoidContact} from '../public/physics/head-contact.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';

// Real motor/rig integration; deferSupport omits only fluid/latex maintenance.
// These component cases do not claim an opposing blade was intercepted.
function arm(slot,{mode='versus',damage=0,detached=false}={}){
  const events=[],game=new DuelEngine((name,data)=>events.push({name,data}));game.setMode(mode);game.phase='fight';
  const fighter=game.fighters[slot-1];game.setLoadout(slot,{defense:'none'});
  if(damage||detached)fighter.rig.damageJoint('wrist',detached?1:damage);
  const hold=(x,y=0,wrist)=>{
    const control=weaponGesture({x,y});if(wrist!==undefined)control.wrist=wrist;
    game.setControl(slot,control);
    for(let i=0;i<150;i++){game.clock+=STEP;fighter.lastInputAt=game.clock;game.updateFighter(fighter,STEP,{deferSupport:true});}
    const p=fighter.pose;
    return {angle:Math.atan2(p.tip.y-p.mainHand.y,fighter.dir*(p.tip.x-p.mainHand.x)),
      hand:fighter.dir*(p.mainHand.x-p.mainShoulder.x),tip:fighter.dir*(p.tip.x-p.mainShoulder.x),
      rise:p.tip.y-p.mainHand.y,lunge:fighter.lunge,q:Array.from(fighter.rig.q),target:Array.from(fighter.rig.target)};
  };
  return {game,fighter,events,hold};
}

for(const slot of [1,2])test(`J${slot}: atrás recoge el brazo y cruza la hoja mediante sus motores, sin fabricar una guardia secundaria`,()=>{
  const f=arm(slot),neutral=f.hold(0),forward=f.hold(1),back=f.hold(-1);
  assert.ok(back.angle>Math.PI/6,`la hoja debe cubrir la línea superior; ángulo real ${back.angle}`);
  assert.ok(back.rise>.4,'la hoja principal atraviesa alturas de intercepción');
  assert.ok(back.hand<neutral.hand-.02&&back.hand<forward.hand-.02,'la mano sigue recogida');
  assert.ok(back.tip<neutral.tip-.02&&back.lunge<.001,'la punta se recoge y no sostiene una estocada');
  assert.equal(f.fighter.guard,false);assert.equal(f.fighter.guardEnergy,1);
  assert.ok(back.q.every(Number.isFinite));assert.equal(f.events.filter(e=>e.name==='clang'||e.name==='thrust').length,0);
});

test('Centro y adelante no reciben la asistencia de parada; la IA conserva su orientación anterior',()=>{
  const human=arm(2),ai=arm(2,{mode:'solo'});
  for(const x of [0,1]){
    // No sustained gesture here: the same legacy controls isolate orientation.
    for(const f of [human,ai])f.game.setControl(2,{mainX:x,mainY:0,wrist:0});
    for(let i=0;i<180;i++)for(const f of [human,ai])f.game.updateFighter(f.fighter,STEP,{deferSupport:true});
    assert.deepEqual(Array.from(human.fighter.rig.target),Array.from(ai.fighter.rig.target));
  }
  const a=human.hold(-1),b=ai.hold(-1);
  assert.ok(a.angle>b.angle+.4,'el mainX negativo de la IA no se transforma en parada humana');
  assert.equal(ai.fighter.autoDefense.snapshot().elapsed,0);
});

test('Daño de muñeca no se borra y un arma desprendida no recibe asistencia de parada',()=>{
  const damaged=arm(1,{damage:.75}),before=damaged.fighter.rig.jointDamage.wrist.damage;
  const response=damaged.hold(-1);assert.equal(damaged.fighter.rig.jointDamage.wrist.damage,before);
  assert.ok(response.q.every(Number.isFinite));
  const detached=arm(1,{detached:true});detached.hold(-1);
  assert.equal(detached.fighter.rig.isBodyAttached('weapon'),false);
  const intent=detached.game.buildPose(detached.fighter);
  assert.ok(Math.abs(intent.tip.y-intent.mainHand.y)<1e-10,'sin muñeca adjunta no aparece una intención de guardia principal');
  assert.equal(detached.events.some(e=>e.name==='clang'),false);
});

test('La parada principal no requiere brazo secundario, pero se retira al desplomarse el rig',()=>{
  const f=arm(1);f.fighter.rig.damageJoint('offShoulder',1);
  assert.equal(f.fighter.rig.isBodyAttached('offForearm'),false);
  const back=f.hold(-1);assert.ok(back.angle>Math.PI/6);
  assert.equal(f.fighter.guard,false,'el arma principal no reutiliza el estado del escudo');
  f.fighter.rig.collapse();const passive=f.game.buildPose(f.fighter);
  assert.ok(Math.abs(passive.tip.y-passive.mainHand.y)<1e-10,'un muñeco pasivo no prepara una parada por input');
});

test('El gesto móvil adelante/centro conserva la orientación de ataque, y la entrada en .25 no salta',()=>{
  for(const x of [0,1]){
    const f=arm(1);f.hold(x);
    const mobile=f.game.buildPose(f.fighter,weaponGesture({x,y:0}));
    const legacy=f.game.buildPose(f.fighter,{mainX:x,mainY:0,wrist:0});
    assert.deepEqual(mobile,legacy,'la nueva intención de parada no modifica forward/centro móvil');
  }
  const f=arm(1);f.hold(-.251);
  const angle=control=>{const p=f.game.buildPose(f.fighter,control);return Math.atan2(p.tip.y-p.mainHand.y,p.tip.x-p.mainHand.x);};
  assert.ok(Math.abs(angle(weaponGesture({x:-.249,y:0}))-angle(weaponGesture({x:-.251,y:0})))<.001);
  const original=angle({mainX:-1,mainY:0,wrist:0});
  assert.ok(Math.abs(original)<1e-10,'un piloto legacy sin attackHeld conserva su hoja horizontal');
  f.game.disconnect(1);const released=f.game.buildPose(f.fighter);
  assert.ok(Math.abs(released.tip.y-released.mainHand.y)<1e-10,'desconectar elimina la intención de parada');
});

function incoming(slot,weapon,{upperPreparation=weapon==='sword',gesture={x:-1,y:0}}={}){
  const events=[],game=new DuelEngine((name,data)=>{if(['clang','burst'].includes(name))events.push({name,data});});
  game.setMode('versus');game.setLoadout(slot,{weapon:'sword',defense:'none'});game.setLoadout(3-slot,{weapon,defense:'none'});game.phase='fight';
  const defender=game.fighters[slot-1],attacker=game.fighters[2-slot],defend=weaponGesture(gesture);
  const reactions=[];let observing=false,pending=[];
  // Observe the actual impulse at its actual material point. No replacement
  // forces, poses or solver results: both wrappers call the original methods.
  const react=attacker.rig.reactImpulse.bind(attacker.rig);
  attacker.rig.reactImpulse=options=>{
    const before=observing?attacker.rig.pointVelocity(options):null,result=react(options);
    if(before)pending.push({before,after:attacker.rig.pointVelocity(options)});
    return result;
  };
  const resolve=game.resolveWeaponContacts.bind(game);
  game.resolveWeaponContacts=(dt,options)=>{
    const targets=game.fighters.map(f=>Array.from(f.rig.target)),positions=game.fighters.map(f=>Array.from(f.rig.q));
    pending=[];observing=true;resolve(dt,options);observing=false;
    const contact=game.lastWeaponContact;
    if(contact?.impulse>0){
      assert.ok(contact.impulse<=54*dt+1e-12);
      assert.deepEqual(game.fighters.map(f=>Array.from(f.rig.target)),targets,'el contacto no retargetea los motores');
      if(options?.project===false)assert.deepEqual(game.fighters.map(f=>Array.from(f.rig.q)),positions,'el impulso no teletransporta articulaciones');
      const sign=attacker.slot===1?-1:1,n=contact.normal;
      for(const r of pending)reactions.push({impulse:contact.impulse,separatingDelta:sign*((r.after.x-r.before.x)*n.x+(r.after.y-r.before.y)*n.y)});
    }
  };
  for(let i=0;i<150&&game.phase==='fight';i++){
    game.setControl(slot,defend);game.setControl(3-slot,upperPreparation?{mainX:0,mainY:.6,wrist:0}:{mainX:-1,mainY:-1,wrist:-1});game.update(STEP);
  }
  const prepared=game.phase==='fight';events.length=0;reactions.length=0;
  for(let i=0;i<220&&game.phase==='fight';i++){
    game.setControl(slot,defend);game.setControl(3-slot,{mainX:1,mainY:.6,lean:1,thrust:i>=54&&i<59});game.update(STEP);
    assert.ok(game.fighters.every(f=>[...f.rig.q,...f.rig.velocity].every(Number.isFinite)));
  }
  return {game,defender,attacker,events,reactions,prepared};
}

for(const slot of [1,2])for(const weapon of ['sword','maul'])test(`J${slot}: atrás intercepta ${weapon} y desvía su movimiento por un impulso físico finito`,()=>{
  const f=incoming(slot,weapon);
  assert.equal(f.prepared,true);assert.deepEqual(f.game.scores,[0,0]);assert.equal(f.game.phase,'fight');
  assert.ok(f.events.some(e=>e.name==='clang'&&e.data.weaponBind&&e.data.impulse>0),'debe existir contacto real de armas');
  assert.ok(f.reactions.some(r=>r.separatingDelta>.001),'el impulso debe desviar la velocidad normal del arma rival hacia separación');
  assert.equal(f.defender.guard,false);assert.equal(f.defender.guardEnergy,1,'la parada principal no usa energía de escudo');
});

test('Un mazo puede superar la parada principal y perforar: no existe invulnerabilidad por mantener atrás',()=>{
  const f=incoming(1,'maul',{upperPreparation:true,gesture:{x:-Math.sqrt(.99),y:-.1}});
  assert.ok(f.reactions.some(r=>r.separatingDelta>.001),'el fallo ocurre después de un desvío real');
  const burst=f.events.find(e=>e.name==='burst')?.data;
  assert.equal(burst?.loser,1);assert.equal(burst.contact,true);assert.equal(burst.demonstration,false);
  assert.equal(f.defender.membrane.punctured,true);
});

test('La hoja preparada no protege una trayectoria fuera de profundidad o alcance de su acero',()=>{
  const f=arm(1);f.hold(-1);const {head,mainHand,tip}=f.fighter.pose,dir=f.fighter.dir;
  // Geometry oracle on a motor-prepared real blade, not a claim of joystick
  // playback. Both rays hit the real balloon; only one can meet its steel.
  for(const [y,z] of [[head.y,.32],[head.y+.36,.17]]){
    const from={x:head.x+dir*2,y,z},to={x:head.x,y,z};
    assert.ok(segmentEllipsoidContact(from,to,head,BALLOON_RADII));
    assert.equal(firstWeaponPointContact(f.fighter.rig,from,to),null,'no se extiende la protección a material que la hoja no ocupa');
  }
  assert.ok(tip.y>mainHand.y+.4,'el caso usa una hoja que sí está preparada para parar');
});
