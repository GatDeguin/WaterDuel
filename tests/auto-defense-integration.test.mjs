import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP,neutral} from '../public/engine.js';
import {AutoDefense} from '../public/auto-defense.js';
import {WEAPONS} from '../public/equipment.js';
import {captureReplayState,replayView} from '../public/replay.js';

function contact(seed,defenderSlot,{respond=true}={}){
  const events=[],game=new DuelEngine((name,data)=>{if(['clang','burst','thrust'].includes(name))events.push({name,data,time:game.clock});});
  game.setMode('versus');game.phase='fight';game.fighters[defenderSlot-1].autoDefense=new AutoDefense({seed});
  const samples=[];let guardFrame=null,responded=false,steps=0;
  for(let i=0;i<150&&game.phase==='fight';i++){
    const t=i*STEP,shot=defenderSlot===1?.45:.50;
    // These are single fencing attempts, followed by a physical response to
    // the observed parry. Lowering the defender's main arm prevents its resting
    // point from puncturing the attacker while the secondary arm reacts.
    responded=responded||respond&&events.some(e=>e.name==='clang'&&e.data.defender===defenderSlot);
    const retreat=defenderSlot===1?{mainX:-1,mainY:-1,wrist:-1,lean:-1}:
      {mainX:-1,mainY:1,wrist:1,lean:-1};
    // The mirrored blade approaches the upper edge from the other side: pick
    // it up while withdrawing rather than sweeping it down through the head.
    game.setControl(3-defenderSlot,responded?retreat:{mainX:1,mainY:.6,lean:1,thrust:t>=shot&&t<shot+.04});
    game.setControl(defenderSlot,{mainX:-1,mainY:-1,wrist:-1});game.update(STEP);steps++;
    if(game.fighters[defenderSlot-1].guard&&!guardFrame)guardFrame=captureReplayState(game);
    if(i%15===0){const f=game.fighters[defenderSlot-1];samples.push({head:{...f.pose.head},hand:{...f.pose.offHand},guard:f.guard,auto:f.autoDefense.snapshot()});}
  }
  return {game,events,samples,guardFrame,steps,responded};
}

for(const slot of [1,2])test(`La defensa automática de J${slot} bloquea o falla un intento respondido mediante escudo y colisión reales`,()=>{
  const blocked=contact(5,slot),failed=contact(1,slot);
  assert.ok(blocked.events.some(e=>e.name==='clang'&&e.data.defender===slot),'el escudo debe parar físicamente la estocada');
  assert.deepEqual(blocked.game.scores,[0,0]);assert.ok(blocked.game.fighters.every(f=>f.globIntact));
  assert.equal(blocked.steps,150,'la retirada se simula completa después de la parada');assert.equal(blocked.responded,true);
  assert.ok(blocked.samples.some(s=>s.guard));
  const burst=failed.events.find(e=>e.name==='burst');assert.ok(burst);assert.equal(burst.data.loser,slot);assert.equal(burst.data.winner,3-slot);
  assert.equal(burst.data.contact,true);assert.equal(burst.data.demonstration,false);assert.ok(burst.data.relativeSpeed>0);
  assert.equal(failed.game.fighters[slot-1].membrane.punctured,true);
  assert.ok(failed.samples.some(s=>s.guard&&s.auto.attempt),'una reacción más tardía intenta cubrirse y puede llegar tarde de verdad');
});

test('La presión mantenida después de una parada automática puede abrir el escudo y perforar de verdad',()=>{
  const pressure=contact(5,2,{respond:false});
  assert.ok(pressure.events.some(e=>e.name==='clang'&&e.data.defender===2),'la presión empieza con una intercepción real');
  assert.equal(pressure.responded,false);
  const burst=pressure.events.find(e=>e.name==='burst');assert.ok(burst);
  assert.equal(burst.data.winner,1);assert.equal(burst.data.loser,2);
  assert.equal(burst.data.contact,true);assert.equal(burst.data.demonstration,false);assert.ok(burst.data.relativeSpeed>0);
  assert.equal(pressure.game.fighters[1].membrane.punctured,true);
});

test('La defensa semillada reproduce contactos y poses, y una vista de replay no hace avanzar su decisión',()=>{
  const a=contact(5,2),b=contact(5,2);assert.deepEqual(a.events,b.events);assert.deepEqual(a.samples,b.samples);
  const before=a.game.fighters[1].autoDefense.snapshot(),view=replayView(a.guardFrame);
  assert.equal(view.fighters[1].guard,true,'el replay conserva una guardia automática realmente ejecutada');view.fighters[1].pose.offHand.x=999;
  assert.deepEqual(a.game.fighters[1].autoDefense.snapshot(),before);assert.notEqual(a.game.fighters[1].pose.offHand.x,999);
  a.game.resetMatch();assert.deepEqual(a.game.fighters[1].autoDefense.snapshot(),new DuelEngine().fighters[1].autoDefense.snapshot());
});

test('La IA conserva su propia defensa y no recibe un segundo decisor automático humano',()=>{
  const game=new DuelEngine();game.phase='fight';
  for(let i=0;i<90;i++)game.update(STEP);
  assert.equal(game.fighters[1].autoDefense.snapshot().elapsed,0);assert.ok(game.fighters[1].ai.time>0);
  assert.ok(game.fighters[0].autoDefense.snapshot().elapsed>0);
});

test('El joystick izquierdo sólo desplaza; derecho sostiene una intención física y conserva el toque legacy',()=>{
  for(const slot of [1,2]){
    const game=new DuelEngine();game.setMode('versus');game.phase='fight';const before=game.fighters[slot-1].baseX;
    game.setControl(slot,{lean:.8});for(let i=0;i<45;i++)game.update(STEP);
    assert.ok(game.fighters[slot-1].dir*(game.fighters[slot-1].baseX-before)>0);assert.equal(game.fighters[slot-1].lunge,0);
  }
  for(const weapon of Object.keys(WEAPONS)){
    const times=[],game=new DuelEngine((name,data)=>{if(name==='thrust'&&data.slot===1)times.push(game.clock);});
    game.setLoadout(1,{weapon});game.phase='fight';const f=game.fighters[0];
    game.setControl(1,{mainX:1,mainY:-1,attackHeld:true});
    for(let i=0;i<360;i++){game.clock+=STEP;game.updateFighter(f,STEP);}
    assert.equal(times.length,0,`${weapon}: sostener el mando no crea ataques de temporizador`);
    assert.ok(f.lunge>.99,`${weapon}: la intención física permanece extendida`);
    const extendedLength=f.rig.swordLength;
    game.setControl(1,{mainX:-1,mainY:0,attackHeld:true});
    for(let i=0;i<120;i++){game.clock+=STEP;game.updateFighter(f,STEP);}
    assert.ok(f.lunge<.001,`${weapon}: mantener el mando hacia atrás recoge la estocada`);
    assert.ok(f.rig.swordLength<extendedLength-.1,`${weapon}: la retirada cambia la longitud física, no sólo la bandera`);
    assert.equal(times.length,0,`${weapon}: recoger tampoco fabrica un pulso`);
    const count=times.length;game.setControl(1,neutral());
    for(let i=0;i<120;i++){game.clock+=STEP;game.updateFighter(f,STEP);}assert.equal(times.length,count);
    game.resetMatch();game.phase='fight';times.length=0;game.setControl(1,{thrust:true,mainY:-1});
    for(let i=0;i<180;i++){game.clock+=STEP;game.updateFighter(game.fighters[0],STEP);}assert.equal(times.length,1,'mantener thrust legacy conserva su único flanco');
  }
});
