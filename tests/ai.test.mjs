import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {weaponGesture} from '../public/joysticks.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';

function duel(difficulty='normal',quality='high'){
  const events=[];
  const g=new DuelEngine((name,data)=>events.push({name,data,time:g.elapsed}));
  g.setDifficulty(difficulty);g.quality=quality;g.phase='fight';
  return {g,events,enemy:g.fighters[1]};
}
function think(g,f,seconds){
  for(let t=0;t<seconds-1e-10;t+=STEP){
    g.clock+=STEP;g.updateAI(f,STEP);g.updateFighter(f,STEP);
  }
}
function replay(quality='high'){
  const events=[];
  const g=new DuelEngine((name,data)=>{
    if(['start','fight','thrust','burst','matchover','ai-state'].includes(name))events.push({name,data});
  });
  g.quality=quality;g.start();
  const snapshots=[];let maxParticles=0;
  for(let i=0;i<3600;i++){
    g.setControl(1,{lean:-1});
    g.update(STEP);maxParticles=Math.max(maxParticles,g.particles.length);
    if(i%120===0)snapshots.push({phase:g.phase,round:g.round,score:g.scores.slice(),
      bodies:g.fighters.map(f=>({head:{...f.pose.head},tip:{...f.pose.tip},guard:f.guardEnergy,state:f.ai?.state}))});
  }
  return {events,snapshots,score:g.scores.slice(),phase:g.phase,maxParticles};
}

test('La IA nunca cancela sus propias estocadas por pedir guardia y ataque simultáneamente',()=>{
  const {g,events,enemy}=duel();
  let intentions=0;
  for(let i=0;i<1440;i++){
    g.clock+=STEP;g.updateAI(enemy,STEP);
    if(enemy.controller.thrust){intentions++;assert.equal(enemy.controller.guard,false);}
    g.updateFighter(enemy,STEP);
  }
  assert.ok(intentions>=3,'debe intentar varios ataques durante doce segundos');
  assert.equal(events.filter(e=>e.name==='thrust'&&e.data.slot===2).length,intentions);
});

test('La IA anticipa cada ataque y completa una recuperación real antes de volver a atacar',()=>{
  const {g,enemy}=duel();
  assert.ok(enemy.ai,'el rival debe conservar el estado de su decisión');
  const transitions=[];let previous='';
  for(let i=0;i<1200;i++){
    g.clock+=STEP;g.updateAI(enemy,STEP);
    if(enemy.ai.state!==previous){transitions.push({state:enemy.ai.state,time:i*STEP});previous=enemy.ai.state;}
    if(enemy.ai.state==='recover'){
      assert.equal(enemy.controller.guard,false);assert.equal(enemy.controller.thrust,false);
    }
    g.updateFighter(enemy,STEP);
  }
  assert.ok(transitions.filter(s=>s.state==='attack').length>=3);
  for(let i=0;i<transitions.length;i++){
    if(transitions[i].state==='attack'){
      assert.equal(transitions[i-1].state,'windup');
      assert.ok(transitions[i].time-transitions[i-1].time>=.4,'la anticipación normal debe ser visible');
    }
    if(transitions[i].state==='recover'&&transitions[i+1]){
      assert.ok(transitions[i+1].time-transitions[i].time>=.65,'no debe cancelar su recuperación');
    }
  }
});

test('La defensa depende de una amenaza observada y respeta un tiempo de reacción',()=>{
  const {g,enemy}=duel();
  for(let i=0;i<12;i++){g.updateAI(enemy,STEP);assert.equal(enemy.controller.guard,false);}
  const player=g.fighters[0],head=enemy.pose.head;
  player.lunge=.8;
  player.previousTip={x:head.x-1,y:head.y};
  player.pose={...player.pose,tip:{x:head.x-.8,y:head.y}};
  g.updateAI(enemy,STEP);assert.equal(enemy.controller.guard,false,'no debe defender con reacción instantánea');
  for(let i=0;i<22;i++)g.updateAI(enemy,STEP);
  assert.equal(enemy.controller.guard,true);
  assert.equal(enemy.controller.thrust,false);
  player.lunge=0;player.previousTip={...player.pose.tip};
  for(let i=0;i<90;i++)g.updateAI(enemy,STEP);
  assert.equal(enemy.controller.guard,false,'no debe sostener guardia sin amenaza');
});

test('El perfil defensor de IA reacciona a una estocada humana y logra una parada física',()=>{
  const events=[],g=new DuelEngine((name,data)=>events.push({name,data,time:g.elapsed}));
  g.setDifficulty('normal');assert.equal(g.setAIStyle('defender'),true);g.phase='fight';
  let responded=false,steps=0;
  for(let i=0;i<240&&g.phase==='fight';i++){
    const t=i*STEP;
    // A short retreat clears the resting steel before the human advances.
    // The defensive style observes this real preparation instead of racing
    // its own passive point into the human before the attempted thrust.
    responded=responded||events.some(e=>e.name==='clang'&&e.data.defender===2);
    g.setControl(1,responded?{mainX:-1,mainY:1,wrist:1,lean:-1}:
      {mainX:1,mainY:.6,lean:t<.3?-1:1,thrust:t>=.70&&t<.74});
    g.update(STEP);steps++;
  }
  assert.ok(events.some(e=>e.name==='thrust'&&e.data.slot===1),'el humano debe ejecutar una estocada real');
  assert.ok(events.some(e=>e.name==='ai-state'&&e.data.state==='defend'),'la IA debe decidir defender por sí misma');
  assert.ok(events.some(e=>e.name==='clang'&&e.data.defender===2&&e.data.impulse>0),'la guardia debe interactuar con el arma, no solo activar un estado');
  assert.equal(steps,240,'la respuesta y retirada siguen simulándose tras la parada');assert.equal(responded,true);
  assert.deepEqual(g.scores,[0,0]);
  assert.ok(g.fighters.every(f=>f.globIntact));
});

test('La IA usa controles humanos normalizados y no modifica la pose fuera de la simulación común',()=>{
  const {g,enemy}=duel('boss');
  const {g:humanDriven,enemy:human}=duel('boss');
  for(let i=0;i<720;i++){
    const before={baseX:enemy.baseX,lean:enemy.lean,mainX:enemy.mainX,mainY:enemy.mainY,pose:structuredClone(enemy.pose)};
    g.clock+=STEP;humanDriven.clock+=STEP;g.updateAI(enemy,STEP);
    assert.deepEqual({baseX:enemy.baseX,lean:enemy.lean,mainX:enemy.mainX,mainY:enemy.mainY,pose:enemy.pose},before);
    for(const key of ['offX','offY','mainX','mainY','lean','wrist']){
      assert.ok(Number.isFinite(enemy.controller[key])&&Math.abs(enemy.controller[key])<=1,key);
    }
    assert.equal(enemy.controller.guard&&enemy.controller.thrust,false);
    humanDriven.setControl(2,enemy.controller);
    if(g.updateFootwork){g.updateFootwork(STEP);humanDriven.updateFootwork(STEP);}
    g.updateFighter(enemy,STEP);humanDriven.updateFighter(human,STEP);
    assert.deepEqual(enemy.pose,human.pose);
    assert.equal(enemy.guardEnergy,human.guardEnergy);
  }
});

test('Un replay con las mismas entradas produce las mismas decisiones, poses y resultado',()=>{
  const a=replay(),b=replay();
  assert.ok(a.events.some(e=>e.name==='burst'),'el replay debe incluir un resultado real');
  assert.equal(a.phase,'matchover');
  assert.deepEqual(a,b);
});

test('Los perfiles gráficos cambian los efectos sin cambiar decisiones ni resultado del duelo',()=>{
  const high=replay('high');
  for(const quality of ['eco','ultra']){
    const other=replay(quality);
    if(quality==='eco')assert.ok(high.maxParticles>other.maxParticles,'los perfiles deben ejercer rutas visuales diferentes');
    assert.deepEqual(high.events,other.events);assert.deepEqual(high.snapshots,other.snapshots);
    assert.deepEqual(high.score,other.score);assert.equal(high.phase,other.phase);
  }
});

test('El jefe alterna patrones anticipados y ofrece recuperaciones vulnerables sin guardia',()=>{
  const {g,enemy}=duel('boss');
  assert.ok(enemy.ai,'el jefe debe conservar su patrón y estado');
  const patterns=new Set();let recoveries=0,lastState='',recoveryStart=0;
  for(let i=0;i<2400;i++){
    g.clock+=STEP;g.updateAI(enemy,STEP);
    patterns.add(enemy.ai.pattern);
    if(enemy.ai.state==='recover'){
      if(lastState!=='recover'){recoveries++;recoveryStart=i*STEP;}
      assert.equal(enemy.controller.guard,false);assert.equal(enemy.controller.thrust,false);
      assert.ok(enemy.controller.lean>0,'el jefe debe exponer físicamente la cabeza');
    }else if(lastState==='recover')assert.ok(i*STEP-recoveryStart>=.9);
    lastState=enemy.ai.state;g.updateFighter(enemy,STEP);
  }
  assert.ok(recoveries>=3);assert.ok(patterns.has('high'));assert.ok(patterns.has('low'));assert.ok(patterns.has('feint'));
  assert.equal(enemy.ai.phase,1);
  g.scores[0]=1;g.updateAI(enemy,STEP);assert.equal(enemy.ai.phase,2);
});

test('El alcance físico permite parar y contraatacar durante la recuperación del jefe',()=>{
  const {g,events}=duel('boss');
  assert.ok(g.fighters[1].ai,'el contraataque necesita observar la recuperación');
  // The decision routine generates normalized actuator controls for this reach
  // probe. It does not demonstrate human skill or a physical phone session.
  let parried=false,recovered=false,won=false,pointWindow=null;
  for(let i=0;i<2400&&g.phase==='fight';i++){
    const player=g.fighters[0],boss=g.fighters[1];
    g.updateAI(player,STEP);
    parried||=events.some(e=>e.name==='clang'&&e.data.defender===1);
    recovered||=parried&&boss.ai.state==='recover';
    if(!parried)g.setControl(1,{...player.controller,mainX:-1,mainY:-1,wrist:-1,thrust:false,lean:-1});
    else if(!recovered)g.setControl(1,{...player.controller,thrust:false});
    else g.setControl(1,{...weaponGesture({x:1,y:.85}),lean:0});
    if(parried){
      const head=player.pose.head,tip=boss.pose.tip;
      const danger=Math.hypot((tip.x-head.x)/BALLOON_RADII.x,(tip.y-head.y)/BALLOON_RADII.y,
        ((tip.z??.17)-(head.z??.025))/BALLOON_RADII.z)<1.5;
      // A recovery flag does not remove the descending blade. Keep real arm
      // protection and neck/crouch motion until the observed point moves away.
      if(!recovered||danger)g.setControl(1,{...player.controller,mainX:1,mainY:.85,wrist:.55,thrust:false,attackHeld:false,
        guard:danger||player.controller.guard,offX:.3,offY:1,lean:-1,headZ:-1,bodyY:-1});
      else g.setControl(1,{...weaponGesture({x:1,y:.85}),lean:0,headZ:-1,bodyY:-1});
    }
    for(const key of ['offX','offY','mainX','mainY','lean','wrist','headZ','bodyY'])assert.ok(Math.abs(player.controller[key]??0)<=1,key);
    g.update(STEP);
    if(g.scores[0]===1){won=true;pointWindow={state:boss.ai.state,time:boss.ai.time,duration:boss.ai.duration};break;}
  }
  assert.equal(won,true,'el jefe debe poder ser perforado sin cambiar posiciones, tamaño ni marcador');
  assert.equal(g.fighters[1].globIntact,false);assert.equal(g.fighters[0].globIntact,true);
  const parry=events.find(e=>e.name==='clang'&&e.data.defender===1),burst=events.find(e=>e.name==='burst');
  assert.ok(parry,'el jugador debe defender activamente antes de contraatacar');
  assert.ok(parry.data.impulse>0,'la parada anterior transfiere un impulso real');
  assert.equal(burst.data.winner,1);assert.equal(burst.data.contact,true);assert.equal(burst.data.demonstration,false);
  assert.ok(burst.data.relativeSpeed>0);assert.ok(burst.time>parry.time);assert.deepEqual(g.scores,[1,0]);
  assert.equal(pointWindow.state,'recover');assert.ok(pointWindow.time>0&&pointWindow.time<pointWindow.duration);
});

for(const difficulty of ['rookie','normal','expert','boss'])test(`Solo retroceder no bloquea indefinidamente al rival ${difficulty}`,()=>{
  const {g,events}=duel(difficulty);
  for(let i=0;i<15000&&g.phase!=='matchover';i++){
    g.setControl(1,{lean:-1});g.update(STEP);
  }
  assert.equal(g.phase,'matchover','125 segundos bastan para castigar a un rival que nunca ataca ni bloquea');
  assert.deepEqual(g.scores,[0,2]);
  assert.equal(events.filter(e=>e.name==='burst').length,2);
  assert.ok(events.filter(e=>e.name==='burst').every(e=>e.data.winner===2&&!e.data.draw));
});

test('El apoyo responde al mismo lean, conserva velocidad finita, límites y separación para ambos jugadores',()=>{
  const {g}=duel();g.mode='versus';
  const round=g.round,fighters=g.fighters.slice();
  // A bare point can puncture without a thrust. Prepare a safe weapon pose
  // through real controls so this trajectory exercises footwork for one round.
  for(let i=0;i<90;i++){
    for(const f of g.fighters)g.setControl(f.slot,{mainX:-1,mainY:-1,wrist:-1});
    g.update(STEP);
    assert.equal(g.phase,'fight');assert.equal(g.round,round);
    for(const [index,f]of g.fighters.entries()){assert.equal(f,fighters[index]);assert.ok(f.globIntact);}
  }
  const start=g.fighters.map(f=>f.baseX);
  let previous=start;
  for(let i=0;i<1200;i++){
    const toward=i<600?1:-1;
    for(const f of g.fighters)g.setControl(f.slot,{lean:toward,mainX:-1,mainY:-1,wrist:-1});
    g.update(STEP);
    assert.equal(g.phase,'fight');assert.equal(g.round,round);
    for(const [index,f] of g.fighters.entries()){
      assert.equal(f,fighters[index]);assert.ok(f.globIntact,'el recorrido completo necesita ambos globos vivos');
      assert.ok(Math.abs(f.baseX)<=2.2+1e-9,'los apoyos deben conservarse dentro del escenario');
      assert.ok(Math.abs(f.baseX-previous[index])<=.65*STEP+1e-9,'el desplazamiento no debe teletransportar');
    }
    assert.ok(g.fighters[1].baseX-g.fighters[0].baseX>=2.1-1e-9);
    if(i===599){assert.ok(g.fighters[0].baseX>start[0]);assert.ok(g.fighters[1].baseX<start[1]);}
    previous=g.fighters.map(f=>f.baseX);
  }
  assert.ok(g.fighters[0].baseX<start[0]);assert.ok(g.fighters[1].baseX>start[1]);
});

test('Los controles máximos mantienen las manos dentro del alcance de las dos articulaciones',()=>{
  for(const difficulty of ['normal','boss']){
    const {g}=duel(difficulty);
    for(const f of g.fighters){
      g.setControl(f.slot,{mainX:1,mainY:1,offX:1,offY:1,guard:false,thrust:false});
      for(let i=0;i<120;i++)g.updateFighter(f,STEP);
      g.setControl(f.slot,{mainX:1,mainY:1,offX:1,offY:1,guard:false,thrust:true});
      g.updateFighter(f,STEP);
      const p=f.pose,scale=f.boss?1.18:1;
      for(const [shoulder,elbow,hand,length] of [
        [p.mainShoulder,p.mainElbow,p.mainHand,.52*scale],
        [p.offShoulder,p.offElbow,p.offHand,.48*scale]
      ]){
        assert.ok(Math.hypot(elbow.x-shoulder.x,elbow.y-shoulder.y)<=length+1e-8);
        const forearm=hand===p.mainHand?.52*scale:.47*scale;
        assert.ok(Math.hypot(hand.x-elbow.x,hand.y-elbow.y)<=forearm+1e-8,'la mano no debe estirar el antebrazo');
      }
    }
  }
});

test('Los apoyos mantienen separados los globos normales y del jefe durante avance y oscilación',()=>{
  for(const difficulty of ['normal','boss']){
    const {g}=duel(difficulty);g.mode='versus';
    const round=g.round,fighters=g.fighters.slice(),shapes=g.fighters.map(f=>({boss:f.boss,size:f.balloonSize,scale:f.rig.scale}));
    assert.equal(shapes[1].boss,difficulty==='boss');
    for(let i=0;i<90;i++){
      for(const f of g.fighters)g.setControl(f.slot,{mainX:-1,mainY:-1,wrist:-1});
      g.update(STEP);
      assert.equal(g.phase,'fight');assert.equal(g.round,round);
      for(const [j,f]of g.fighters.entries()){assert.equal(f,fighters[j]);assert.ok(f.globIntact);}
    }
    let previous=g.fighters.map(f=>f.baseX);
    for(let i=0;i<2400;i++){
      const lean=i<900?1:Math.sin(i*STEP*9);
      for(const f of g.fighters)g.setControl(f.slot,{lean,mainX:-1,mainY:-1,wrist:-1});
      g.update(STEP);
      assert.equal(g.phase,'fight');assert.equal(g.round,round);
      const [a,b]=g.fighters;
      for(const [j,f]of g.fighters.entries()){
        assert.equal(f,fighters[j]);assert.ok(f.globIntact,'la separación requiere dos globos vivos durante todo el recorrido');
        assert.deepEqual({boss:f.boss,size:f.balloonSize,scale:f.rig.scale},shapes[j],'el jefe conserva su escala y volumen originales');
      }
      const dx=(b.pose.head.x-a.pose.head.x)/(.428*(a.balloonSize+b.balloonSize));
      const dy=(b.pose.head.y-a.pose.head.y)/(.512*(a.balloonSize+b.balloonSize));
      assert.ok(dx*dx+dy*dy>=1-1e-9,`los globos ${difficulty} no deben interpenetrarse`);
      for(const [j,f] of g.fighters.entries())assert.ok(Math.abs(f.baseX-previous[j])<=.65*STEP+1e-9);
      previous=g.fighters.map(f=>f.baseX);
    }
  }
});
