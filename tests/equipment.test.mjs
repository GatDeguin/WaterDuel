import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';

const equipment=await import('../public/equipment.js').catch(()=>null);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

test('El arsenal separa cuatro armas de cuatro defensas y reserva la daga para la mano secundaria',()=>{
  assert.ok(equipment?.WEAPONS,'falta el catálogo compartido de equipamiento');
  assert.deepEqual(Object.keys(equipment.WEAPONS),['sword','spear','axe','maul']);
  assert.deepEqual(Object.keys(equipment.DEFENSES),['short','long','none','knife']);
  assert.deepEqual(equipment.normalizeLoadout({weapon:'maul',defense:'long'}),{weapon:'maul',defense:'none'});
  assert.deepEqual(equipment.normalizeLoadout({weapon:'knife',defense:'invalid'}),{weapon:'sword',defense:'short'});
  assert.equal(equipment.getWeapon('sword').length,1.02);
  assert.equal(equipment.getDefense('knife').kind,'knife');
  for(const item of [...Object.values(equipment.WEAPONS),...Object.values(equipment.DEFENSES)]){
    assert.ok(Object.isFrozen(item));assert.ok(item.label&&item.title&&item.lore);
  }
});

test('Las selecciones se validan, cambian solamente fuera del combate y sobreviven reinicios',()=>{
  const game=new DuelEngine();assert.equal(typeof game.setLoadout,'function');
  assert.equal(game.setLoadout(1,{weapon:'spear',defense:'knife'}),true);
  assert.equal(game.setLoadout(2,{weapon:'axe',defense:'long'}),true);
  assert.equal(game.setLoadout(0,{weapon:'sword'}),false);
  assert.equal(game.setLoadout(1,{weapon:'knife'}),false);
  assert.equal(game.setLoadout(1,{defense:'garbage'}),false);
  for(const phase of ['countdown','fight','burst']){
    game.phase=phase;assert.equal(game.setLoadout(1,{weapon:'maul'}),false);
  }
  game.phase='matchover';assert.equal(game.setLoadout(2,{weapon:'maul',defense:'short'}),true);
  for(const reset of [()=>game.resetRound(),()=>game.resetMatch(),()=>game.setMode('versus'),()=>game.setDifficulty('boss')]){
    reset();assert.deepEqual(game.fighters[0].equipment,{weapon:'spear',defense:'knife'});
    assert.deepEqual(game.fighters[1].equipment,{weapon:'maul',defense:'none'});
  }
  const saved={...game.loadouts[0]};game.fighters[0].equipment.weapon='axe';assert.deepEqual(game.loadouts[0],saved);
});

test('El alcance y la masa física cambian con el arma y la pose conserva la defensa',()=>{
  const game=new DuelEngine();assert.equal(typeof game.setLoadout,'function');
  const lengths={},masses={};
  for(const weapon of ['sword','spear','axe','maul']){
    game.setLoadout(1,{weapon,defense:'long'});const f=game.fighters[0];
    lengths[weapon]=distance(f.pose.mainHand,f.pose.tip);
    masses[weapon]=f.rig.diagnostics().bodies.find(b=>b.name==='weapon').mass;
    assert.equal(f.pose.equipment.weapon,weapon);
    if(weapon!=='maul')assert.ok(f.pose.shieldRadiusY>f.pose.shieldRadiusX);
  }
  assert.ok(lengths.spear>lengths.sword);assert.ok(lengths.axe<lengths.sword);
  assert.ok(masses.maul>masses.axe&&masses.axe>masses.sword);
});

test('Sin defensa no aparece una guardia invisible ni se impide atacar',()=>{
  const game=new DuelEngine();assert.equal(typeof game.setLoadout,'function');
  game.setLoadout(1,{defense:'none'});game.mode='versus';game.phase='fight';
  game.setControl(1,{guard:true,thrust:true});game.updateFighter(game.fighters[0],STEP);
  assert.equal(game.fighters[0].guard,false);assert.ok(game.fighters[0].lunge>.8);
  assert.equal(game.fighters[0].guardEnergy,1);assert.equal(game.fighters[0].pose.shieldRadiusX,0);
});

function guardedSweep(defense,y){
  const events=[],game=new DuelEngine((name)=>events.push(name));
  assert.equal(typeof game.setLoadout,'function');game.setLoadout(2,{defense});
  game.mode='versus';game.phase='fight';const [a,b]=game.fighters;
  a.lunge=.8;a.previousTip={x:-.8,y,z:.17};a.pose={...a.pose,tip:{x:1.2,y,z:.17}};
  b.guard=true;b.pose={...b.pose,head:{x:1,y,z:.025},offHand:{x:0,y:0,z:.10},shieldDepth:{min:.135,max:.207}};
  b.previousHead={...b.pose.head};
  game.detectHits();return {game,events};
}

test('El escudo largo cubre altura adicional y sin escudo no se bloquea el barrido',()=>{
  const short=guardedSweep('short',.35),long=guardedSweep('long',.35),none=guardedSweep('none',0);
  assert.equal(short.game.fighters[1].globIntact,false);
  assert.equal(long.game.fighters[1].globIntact,true);assert.ok(long.events.includes('clang'));
  assert.equal(none.game.fighters[1].globIntact,false);
});

test('La daga para solamente el tramo de su hoja durante la guardia y no crea un escudo circular',()=>{
  const game=new DuelEngine();assert.equal(typeof game.setLoadout,'function');game.setLoadout(2,{defense:'knife'});
  game.mode='versus';game.phase='fight';const [a,b]=game.fighters;
  a.lunge=.8;a.previousTip={x:-.8,y:.20,z:.17};a.pose={...a.pose,tip:{x:1.2,y:.20,z:.17}};
  b.guard=true;b.pose={...b.pose,head:{x:1,y:.2,z:.025},offHand:{x:0,y:0,z:.17},defenseTip:{x:0,y:.42,z:.17}};
  b.previousHead={...b.pose.head};
  game.detectHits();assert.equal(b.globIntact,true);assert.ok(b.guardEnergy<1);
  const miss=guardedSweep('knife',-.2);assert.equal(miss.game.fighters[1].globIntact,false);
  assert.equal(game.scores[1],0,'la daga secundaria no perfora por su cuenta');
});

test('El mazo mantiene ambas manos en la empuñadura física y conserva las longitudes de brazos',()=>{
  for(const slot of [1,2])for(const boss of [false,true]){
    const game=new DuelEngine();assert.equal(typeof game.setLoadout,'function');
    game.setDifficulty(boss?'boss':'normal');game.setLoadout(slot,{weapon:'maul'});game.phase='fight';
    const f=game.fighters[slot-1],scale=f.boss?1.18:1;
    for(let i=0;i<160;i++){
      game.setControl(slot,{mainX:Math.sin(i*.04),mainY:Math.cos(i*.031),wrist:Math.sin(i*.023),lean:Math.sin(i*.015),thrust:i%100===0});
      game.updateFighter(f,STEP);const p=f.pose;
      assert.ok(distance(p.offHand,p.offGrip)<.015,'la mano secundaria debe permanecer prendida al mango');
      assert.ok(Math.abs(distance(p.offShoulder,p.offElbow)-.48*scale)<1e-8);
      assert.ok(Math.abs(distance(p.offElbow,p.offHand)-.47*scale)<1e-8);
      assert.ok(Object.values(p).filter(v=>v&&typeof v==='object'&&'x' in v).every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y)));
    }
  }
});

test('Cada arma consigue una perforación real mediante los mismos mandos, sin resultados asignados',()=>{
  assert.ok(equipment?.WEAPONS);
  for(const weapon of Object.keys(equipment.WEAPONS)){
    const game=new DuelEngine();game.setLoadout(2,{weapon,defense:'none'});game.phase='fight';
    for(let i=0;i<3600&&game.scores[1]===0;i++)game.update(STEP);
    assert.equal(game.scores[1],1,`${weapon} debe alcanzar al rival pasivo`);
    assert.equal(game.fighters[0].membrane.punctured,true);
  }
});

test('Hacha y mazo preparan un arco de golpe físico; espada y lanza conservan la estocada recta',()=>{
  const game=new DuelEngine();assert.equal(typeof game.setLoadout,'function');
  for(const weapon of ['sword','spear','axe','maul']){
    game.setLoadout(1,{weapon});const f=game.fighters[0];f.lunge=1;f.mainY=0;f.controller.wrist=0;
    const p=game.buildPose(f),height=p.tip.y-p.mainHand.y;
    if(['axe','maul'].includes(weapon))assert.ok(height>.20,'el cabezal debe elevarse antes de descender');
    else assert.ok(Math.abs(height)<1e-12);
    f.lunge=0;
  }
});

test('El filo lateral del hacha y la cara ancha del mazo perforan aunque el centro de punta pase fuera',()=>{
  for(const weapon of ['sword','spear','axe','maul']){
    const game=new DuelEngine();assert.equal(typeof game.setLoadout,'function');
    game.setLoadout(1,{weapon});game.setLoadout(2,{defense:'none'});game.phase='fight';
    const [a,b]=game.fighters;a.lunge=.8;a.previousTip={x:-.8,y:.70,z:.17};
    a.pose={...a.pose,mainHand:{x:.12,y:.70,z:.17},tip:{x:1.2,y:.70,z:.17}};
    b.pose={...b.pose,head:{x:1,y:0,z:.025}};b.previousHead={...b.pose.head};game.detectHits();
    assert.equal(b.globIntact,!['axe','maul'].includes(weapon),`${weapon}: debe contar solamente su geometría real`);
  }
});
