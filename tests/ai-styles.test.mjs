import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../public/engine.js';
import {REFERENCE_STANCE} from '../public/physics/articulated-rig.js';
const {DuelEngine,STEP}=engine;
function decisions(style,seconds=14,difficulty='normal'){
  const events=[],game=new DuelEngine((name,data)=>{if(name==='ai-state')events.push({...data,time:game.clock});});
  game.setDifficulty(difficulty);game.setAIStyle(style);game.phase='fight';
  const enemy=game.fighters[1],pose=structuredClone(enemy.pose),controls=[];
  // Decision-only fixture: a stationary observed head already within reach.
  // Real whole-engine contact/progress is tested separately below.
  const hand=enemy.pose.mainHand,tip=enemy.pose.tip,bladeLength=Math.hypot(tip.x-hand.x,tip.y-hand.y);
  const pulseLength=(1.02+.32*Math.exp(-STEP*7.8)+.10)*(enemy.boss?1.05:1);
  game.fighters[0].pose.head={x:hand.x+(tip.x-hand.x)/bladeLength*pulseLength+enemy.dir*.1,y:hand.y+(tip.y-hand.y)/bladeLength*pulseLength+.04,z:.025};
  for(let i=0;i<Math.ceil(seconds/STEP);i++){
    game.clock+=STEP;game.updateAI(enemy,STEP);
    if(i%15===0)controls.push({...enemy.controller});
    for(const key of ['offX','offY','mainX','mainY','lean','wrist'])assert.ok(Number.isFinite(enemy.controller[key])&&Math.abs(enemy.controller[key])<=1,`${style}/${key}`);
    assert.equal(enemy.controller.guard&&enemy.controller.thrust,false);
    if(enemy.ai.state==='recover'){assert.equal(enemy.controller.guard,false);assert.equal(enemy.controller.thrust,false);}
  }
  assert.deepEqual(enemy.pose,pose,'pensar sólo debe producir controles; la simulación aplica el movimiento');
  return {game,enemy,events,controls};
}

test('El agresivo toma iniciativa antes, conservando por defecto la política balanced anterior',()=>{
  const balanced=new DuelEngine(),aggressive=new DuelEngine();
  balanced.phase=aggressive.phase='fight';aggressive.aiStyle='aggressive';
  balanced.updateAI(balanced.fighters[1],STEP);aggressive.updateAI(aggressive.fighters[1],STEP);
  assert.equal(balanced.fighters[1].ai.duration,.56);
  assert.ok(aggressive.fighters[1].ai.duration<.56,'aiStyle debe cambiar una decisión real y no sólo su nombre');
});

test('El catálogo y setter publican estilos válidos, con cambio sólo fuera de combate',()=>{
  assert.deepEqual(engine.AI_STYLES,['balanced','aggressive','defender','counter','feint','precision','erratic','boss']);
  const game=new DuelEngine();assert.equal(game.aiStyle,'balanced');
  for(const id of engine.AI_STYLES){assert.equal(game.setAIStyle(id),true);assert.equal(game.aiStyle,id);}
  assert.equal(game.setAIStyle('omniscient'),false);assert.equal(game.aiStyle,'boss');
  for(const phase of ['fight','countdown','burst']){game.phase=phase;assert.equal(game.setAIStyle('aggressive'),false);assert.equal(game.aiStyle,'boss');}
  game.phase='matchover';assert.equal(game.setAIStyle('balanced'),true);
});

test('Defensor y contraatacador esperan oportunidades pero toman iniciativa con plazo finito ante inactividad',()=>{
  for(const [style,wait] of [['defender',2.2],['counter',2.8]]){
    const {events}=decisions(style,6);
    assert.equal(events[0].duration,wait);
    const firstPreparation=events.find(e=>e.state==='windup');
    assert.ok(firstPreparation.time>=wait&&firstPreparation.time<wait+.02,`${style} debe comprometerse al vencer su espera observable`);
    assert.ok(events.some(e=>e.state==='attack'));
  }
});

test('Fintas, precisión, variación errática y preparación heavy del jefe cambian decisiones efectivas',()=>{
  const feint=decisions('feint'),precision=decisions('precision'),erratic=decisions('erratic'),boss=decisions('boss',22,'boss');
  assert.ok(feint.events.some(e=>e.state==='feint'));
  assert.ok(new Set(feint.events.filter(e=>e.state==='windup').map(e=>e.pattern)).size>=2);
  assert.ok(precision.events.find(e=>e.state==='windup').duration>=.55);
  const f=precision.enemy,p=precision.game.fighters[0].pose.head,aim=Math.max(-1,Math.min(1,(p.y-f.pose.mainShoulder.y-REFERENCE_STANCE.mainRise)/1.04));
  assert.ok(Math.abs(f.ai.aimY-aim)<.02,'la preparación precisa usa menor error medido');
  assert.ok(new Set(erratic.events.filter(e=>e.state==='observe').map(e=>e.duration)).size>=3);
  const heavy=boss.events.find(e=>e.state==='windup'&&e.pattern==='heavy');
  assert.ok(heavy&&heavy.duration>=.75,'el ataque pesado anticipa su intención más tiempo');
  assert.ok(boss.events.some(e=>e.state==='recover'&&e.duration>=1.4),'su recuperación permite contraataque');
});

test('Siete estilos mantienen firmas distintas, windup completo y recuperación sin guardia ni estocada',()=>{
  const signatures=new Set();
  for(const style of engine.AI_STYLES){
    const {events,controls}=decisions(style,16,style==='boss'?'boss':'normal');
    signatures.add(JSON.stringify({events:events.map(e=>[e.state,e.pattern,e.duration]),controls:controls.slice(0,20)}));
    assert.ok(events.some(e=>e.state==='attack'),style);
    for(let i=0;i<events.length;i++)if(events[i].state==='attack'){
      assert.equal(events[i-1].state,'windup',style);
      assert.ok(events[i].time-events[i-1].time>=(style==='boss'?.6:.44)-1e-8,`${style}: anticipación mínima`);
    }
  }
  assert.equal(signatures.size,8,'balanced y siete arquetipos no pueden reducirse a etiquetas');
});

test('Ningún estilo mira un botón futuro del rival ni reacciona instantáneamente a la punta',()=>{
  for(const style of engine.AI_STYLES.slice(1)){
    const a=new DuelEngine(),b=new DuelEngine();a.setAIStyle(style);b.setAIStyle(style);a.phase=b.phase='fight';
    b.setControl(1,{thrust:true,guard:true,mainX:1,mainY:1,lean:1,wrist:1});
    for(let i=0;i<10;i++){
      a.updateAI(a.fighters[1],STEP);b.updateAI(b.fighters[1],STEP);
      assert.deepEqual(a.fighters[1].controller,b.fighters[1].controller,`${style} lee geometría, no input futuro`);
    }
    const player=a.fighters[0],enemy=a.fighters[1],head=enemy.pose.head;
    player.lunge=.8;player.previousTip={x:head.x-1,y:head.y};player.pose={...player.pose,tip:{x:head.x-.8,y:head.y}};
    for(let i=0;i<17;i++){a.updateAI(enemy,STEP);assert.equal(enemy.controller.guard,false,`${style} debe respetar reacción .15 s`);}
    for(let i=0;i<3;i++)a.updateAI(enemy,STEP);
    assert.equal(enemy.controller.guard,true,`${style} puede defender una amenaza real observada`);
  }
});

test('El contraataque nace del retroceso observado de la amenaza antes de agotar la espera',()=>{
  const transitions=[],game=new DuelEngine((name,data)=>{if(name==='ai-state')transitions.push({...data,time:game.clock});});
  game.setAIStyle('counter');game.phase='fight';
  const enemy=game.fighters[1],player=game.fighters[0],head=enemy.pose.head;
  player.pose.head.x=enemy.pose.mainShoulder.x+enemy.dir*2.2;
  player.lunge=.8;player.previousTip={x:head.x-1,y:head.y};player.pose.tip={x:head.x-.8,y:head.y};
  for(let i=0;i<26;i++){game.clock+=STEP;game.updateAI(enemy,STEP);}
  assert.equal(enemy.ai.state,'defend');
  player.lunge=0;player.previousTip={...player.pose.tip};
  for(let i=0;i<110;i++){game.clock+=STEP;game.updateAI(enemy,STEP);}
  const response=transitions.find(e=>e.state==='windup');
  assert.ok(response&&response.time<2.8);assert.equal(response.pattern,'counter');
  assert.ok(response.duration>=.44);
});

test('Un estilo nuevo no consume la estocada cuando su alcance proyectado observado sigue corto',()=>{
  const game=new DuelEngine();game.setAIStyle('defender');game.phase='fight';
  const enemy=game.fighters[1];game.fighters[0].pose.head.x=enemy.pose.mainShoulder.x+enemy.dir*2.6;
  let intentions=0;
  for(let i=0;i<700;i++){game.clock+=STEP;game.updateAI(enemy,STEP);intentions+=Number(enemy.controller.thrust);}
  assert.equal(intentions,0,'el plazo de espera no puede forzar una estocada geométricamente inviable');
  assert.equal(enemy.ai.state,'windup');assert.equal(enemy.ai.readyToThrust,false);
});

for(const [style,difficulty] of [['aggressive','rookie'],['defender','normal'],['counter','normal'],['feint','normal'],['precision','expert'],['erratic','expert'],['boss','boss']]){
  test(`El estilo ${style} perfora por contacto legal a un rival que sólo retrocede`,t=>{
    const bursts=[],game=new DuelEngine((name,data)=>{if(name==='burst')bursts.push({...data,time:game.elapsed});});
    game.setDifficulty(difficulty);game.setAIStyle(style);game.phase='fight';
    for(let i=0;i<3000&&game.phase==='fight';i++){
      game.setControl(1,{lean:-1});game.update(STEP);
    }
    assert.equal(bursts.length,1,`${style}:25 s deben bastar para concretar una perforación, sin puntaje por plazo`);
    assert.equal(bursts[0].contact,true);assert.equal(bursts[0].demonstration,false);assert.equal(bursts[0].winner,2);
    assert.ok(bursts[0].relativeSpeed>0);assert.deepEqual(game.scores,[0,1]);
    assert.equal(game.fighters[0].globIntact,false);assert.equal(game.fighters[1].globIntact,true);
    t.diagnostic(`${style}: primer contacto legal a ${bursts[0].time.toFixed(3)} s`);
  });
}

for(const style of ['defender','counter'])test(`${style} completa mejor de tres ante retirada pasiva con dos contactos, sin victoria por reloj`,t=>{
  const bursts=[],game=new DuelEngine((name,data)=>{if(name==='burst')bursts.push(data);});
  game.setAIStyle(style);game.phase='fight';
  let ticks=0;
  for(;ticks<6000&&game.phase!=='matchover';ticks++){
    game.setControl(1,{lean:-1});game.update(STEP);
  }
  assert.equal(game.phase,'matchover');assert.deepEqual(game.scores,[0,2]);assert.equal(bursts.length,2);
  assert.ok(bursts.every(e=>e.contact&&e.winner===2&&!e.draw&&!e.demonstration));
  t.diagnostic(`${style}: partida completada en ${(ticks*STEP).toFixed(3)} s de reloj simulado`);
});
