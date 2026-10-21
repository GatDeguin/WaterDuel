import test from 'node:test';
import assert from 'node:assert/strict';
import {SinglePlayerSession} from '../public/single-player.js';
import {trainingOpponentControl} from '../public/training-drills.js';
import {DuelEngine,STEP} from '../public/engine.js';

function fixture(){
  return {mode:'solo',phase:'fight',clock:1,elapsed:1,lastPhysicalDt:.02,round:1,scores:[0,0],fighters:[
    {slot:1,dir:1,baseX:-1.5,balloonSize:1,globIntact:true,controller:{},pose:{head:{x:-1,y:2.4,z:.025},tip:{x:.4,y:2,z:.17}}},
    {slot:2,dir:-1,baseX:1.5,balloonSize:1,globIntact:true,controller:{},previousTip:{x:-.35,y:2.4,z:.17},
      pose:{head:{x:1.1,y:2.4,z:.025},mainShoulder:{x:1.2,y:1.7,z:.11},mainHand:{x:.5,y:2,z:.17},tip:{x:-.45,y:2.4,z:.17}}}
  ]};
}
const burst=(impact,extra={})=>({winner:1,loser:2,contact:true,relativeSpeed:1,impact:{...impact},...extra});
const select=kind=>{const s=new SinglePlayerSession();assert.equal(s.select(kind),true);return s;};
function step(s,g,dt=.02){g.clock+=dt;g.elapsed+=dt;s.observe(g,dt);}

test('los tres ejercicios físicos son práctica repetible con configuración propia',()=>{
  for(const kind of ['parry','moving','depth']){
    const s=select(kind);assert.equal(s.configuration().scenario,'practice');assert.deepEqual(s.configuration().trainingDrill,{kind});
    assert.equal(s.view().completed,false);assert.equal(s.next(),false);
  }
});

test('el movimiento del blanco usa sólo controles acotados y no altera la escena',()=>{
  const g=fixture(),before=structuredClone(g),a=trainingOpponentControl('moving',g,.02);
  g.elapsed=2;const b=trainingOpponentControl('moving',g,.02);g.elapsed=before.elapsed;
  assert.deepEqual(g,before);assert.notEqual(a.headZ,b.headZ);assert.notEqual(a.lean,b.lean);
  for(const c of [a,b])for(const [key,value] of Object.entries(c))if(typeof value==='number')assert.ok(Number.isFinite(value)&&Math.abs(value)<=1,key);
  assert.equal(a.thrust,false);assert.equal(trainingOpponentControl('invalid',g,.02),null);
});

test('paradas exige contacto, desvío físico y perforación real dentro de la apertura',()=>{
  const s=select('parry'),g=fixture(),opponent=g.fighters[1];step(s,g);
  s.event('clang',{at:{x:-.5,y:2.4,z:.17},defender:1,impulse:0,closingSpeed:2},g);step(s,g);assert.equal(s.view(g).progress,0);
  s.event('clang',{at:{x:-.5,y:2.4,z:.17},defender:1,impulse:.2,closingSpeed:2},g);
  // A contact alone does not prove that the approaching point was deflected.
  step(s,g);assert.equal(s.view(g).progress,0);
  opponent.pose.tip.y+=.08;step(s,g);assert.equal(s.view(g).progress,1);
  s.event('burst',burst(opponent.pose.head,{contact:false}),g);assert.equal(s.view(g).completed,false);
  s.event('burst',burst(opponent.pose.head),g);assert.equal(s.view(g).completed,true);
  assert.equal(s.next(),true);assert.equal(s.view(g).progress,0);
});

test('una apertura expirada y contactos demo no acreditan el contraataque',()=>{
  const s=select('parry'),g=fixture();step(s,g);
  const hit={at:{x:-.5,y:2.4,z:.17},defender:1,impulse:.2,closingSpeed:2};
  s.event('clang',{...hit,demonstration:true},g);g.fighters[1].pose.tip.y+=.08;step(s,g);assert.equal(s.view(g).progress,0);
  g.fighters[1].previousTip={...g.fighters[1].pose.tip,x:g.fighters[1].pose.tip.x+.1};
  s.event('clang',hit,g);g.fighters[1].pose.tip.y+=.08;step(s,g);assert.equal(s.view(g).progress,1);
  g.clock+=5;step(s,g);assert.equal(s.view(g).progress,0);
  s.event('burst',burst(g.fighters[1].pose.head),g);assert.equal(s.view(g).completed,false);
});

test('blancos móviles valida movimiento observado, zona XYZ actual y un impacto por globo',()=>{
  const s=select('moving'),g=fixture();step(s,g);
  const original=s.view(g).target;s.event('burst',burst(original),g);assert.equal(s.view(g).progress,0,'aún no se observó oscilación');
  g.fighters[1]=structuredClone(g.fighters[1]);s.event('start',{},g);step(s,g);
  for(let i=0;i<3;i++){
    const head=g.fighters[1].pose.head;head.x+=.06;step(s,g);
    const target=s.view(g).target;s.event('burst',burst({...target,z:target.z+target.radius+.01}),g);assert.equal(s.view(g).progress,i);
    s.event('burst',burst(target),g);assert.equal(s.view(g).progress,i,'el mismo globo ya tuvo un contacto fuera de zona');
    g.fighters[1]=structuredClone(g.fighters[1]);s.event('start',{},g);step(s,g);g.fighters[1].pose.head.x+=.06;step(s,g);
    s.event('burst',burst(s.view(g).target),g);assert.equal(s.view(g).progress,i+1);
    if(i<2){g.fighters[1]=structuredClone(g.fighters[1]);s.event('start',{},g);step(s,g);}
  }
  assert.equal(s.view(g).completed,true);assert.equal(s.view(g).target,null);assert.equal(s.next(),true);
});

test('profundidad exige una amenaza que atraviesa el plano anterior y falla en XYZ',()=>{
  const s=select('depth'),g=fixture(),f=g.fighters[0],enemy=g.fighters[1];step(s,g);
  f.controller.headZ=-1;f.pose.head.z=-.15;step(s,g);assert.equal(s.view(g).progress,0,'inclinarse por sí solo no esquiva un ataque');
  // The upper glancing point would enter the centred balloon, but misses the actual head in Z.
  enemy.previousTip={x:-.5,y:2.78,z:.17};enemy.pose.tip={x:-.9,y:2.78,z:.17};
  f.previousHead={...f.pose.head};step(s,g);assert.equal(s.view(g).progress,0,'la amenaza todavía no pasó');
  enemy.previousTip={...enemy.pose.tip};enemy.pose.tip.x=-1.6;step(s,g,.14);assert.equal(s.view(g).progress,1);
  s.event('burst',burst(enemy.pose.head,{contact:false}),g);assert.equal(s.view(g).completed,false,'hay que recuperar el plano de alcance');
  f.pose.head.z=.025;step(s,g);s.event('burst',burst(enemy.pose.head),g);assert.equal(s.view(g).completed,true);
});

test('los ejercicios ignoran Versus, replay implícito, demos y datos no finitos',()=>{
  for(const kind of ['parry','moving','depth']){
    const s=select(kind),g=fixture();g.mode='versus';step(s,g);s.event('burst',burst(g.fighters[1].pose.head),g);assert.equal(s.view(g).progress,0);
    g.mode='solo';g.phase='ready';g.fighters[0].pose.head.z=NaN;s.observe(g,Infinity);assert.equal(s.view(g).progress,0);
  }
});

test('el ejercicio de profundidad permite una esquiva real con la cabeza articulada',()=>{
  const s=select('depth');let g;
  g=new DuelEngine((name,data)=>s.event(name,data,g));g.aiEnabled=false;g.setScenario('practice');g.setLoadout(1,{weapon:'sword',defense:'none'});g.setLoadout(2,{weapon:'sword',defense:'none'});g.phase='fight';
  for(let i=0;i<360&&g.phase==='fight';i++){
    g.clock+=STEP;g.elapsed+=STEP;g.setControl(2,trainingOpponentControl('depth',g));
    g.setControl(1,{headZ:-1,mainY:-.8,wrist:-.7});g.stepPhysics(STEP);s.observe(g,STEP);
  }
  assert.equal(g.fighters[0].globIntact,true,'el globo desplazado sale de la trayectoria de ataque');
  assert.equal(s.view(g).progress,1,'la punta real atraviesa el volumen anterior y deja intacto el volumen actual');
  assert.deepEqual(g.scores,[0,0],'la esquiva nunca adjudica un punto canónico');
});

test('una intercepción de acero sólo abre la parada si la punta entrante cambia de trayectoria',()=>{
  const s=select('parry'),g=fixture();step(s,g);
  s.event('clang',{weaponBind:true,at:{x:-.5,y:2.4,z:.17},impulse:.2,closingSpeed:1},g);
  step(s,g);assert.equal(s.view(g).progress,0);
  g.fighters[1].pose.tip.y+=.08;step(s,g);assert.equal(s.view(g).progress,1);
});

test('la parada mide el cambio causal de velocidad del contacto y rechaza un choque sin desvío',()=>{
  const s=select('parry'),g=fixture();step(s,g);
  const contact={at:{x:-.5,y:2.4,z:.17},attacker:2,defender:1,impulse:.2,closingSpeed:1,velocityBefore:{x:-1,y:0},velocityAfter:{x:-1,y:0}};
  s.event('clang',contact,g);assert.equal(s.view(g).progress,0);
  s.event('clang',{...contact,velocityAfter:{x:0,y:.4}},g);assert.equal(s.view(g).progress,1);
  assert.deepEqual(g.scores,[0,0]);
});

test('la cadencia de paradas abre una oportunidad desde una parada física y retira al rival',()=>{
  const s=select('parry');let g;
  g=new DuelEngine((name,data)=>s.event(name,data,g));g.setDifficulty('rookie');g.aiStyle='precision';g.setScenario('practice');g.setTrainingDrill({kind:'parry'});g.setLoadout(2,{weapon:'sword',defense:'none'});g.phase='fight';
  let opened=false;
  for(let i=0;i<660&&g.phase==='fight'&&!s.view(g).completed;i++){
    // The existing AI is only a test input driver: the human's rig and collision path are unchanged.
    if(s.view(g).progress===1)g.updateAI(g.fighters[0],STEP);else g.setControl(1,{mainY:-.8,wrist:-.7});
    g.update(STEP);s.observe(g,STEP);opened||=s.view(g).progress===1;
  }
  assert.equal(opened,true,'un contacto real frena o desvía el ataque entrante');
  assert.equal(g.fighters[0].globIntact,true,'la retirada deja tiempo para un contraataque');
  assert.equal(s.view(g).completed,true,'el contraataque termina mediante burst real del motor');assert.deepEqual(g.scores,[1,0]);
});

test('profundidad se completa al recuperar el alcance y perforar con el motor real',()=>{
  const s=select('depth');let g;
  g=new DuelEngine((name,data)=>s.event(name,data,g));g.setDifficulty('rookie');g.aiStyle='precision';g.setScenario('practice');g.setTrainingDrill({kind:'depth'});
  g.setLoadout(1,{weapon:'sword',defense:'none'});g.setLoadout(2,{weapon:'sword',defense:'none'});g.phase='fight';
  for(let i=0;i<840&&g.phase==='fight'&&!s.view(g).completed;i++){
    if(s.view(g).progress===1&&g.elapsed>=2.8)g.updateAI(g.fighters[0],STEP);
    else g.setControl(1,{mainY:-.8,wrist:-.7,headZ:s.view(g).progress===0||g.elapsed<2.1?-1:0});
    g.update(STEP);s.observe(g,STEP);
  }
  assert.equal(s.view(g).completed,true);assert.equal(g.fighters[0].globIntact,true);assert.deepEqual(g.scores,[1,0]);
});

test('un contacto posterior y una punta estática no fabrican una esquiva en profundidad',()=>{
  const s=select('depth'),g=fixture(),f=g.fighters[0],enemy=g.fighters[1];step(s,g);f.pose.head.z=-.15;f.previousHead={...f.pose.head};
  enemy.previousTip={x:-.5,y:2.78,z:.17};enemy.pose.tip={x:-.9,y:2.78,z:.17};step(s,g);assert.equal(s.view(g).progress,0);
  s.event('clang',{defender:1,at:enemy.pose.tip,impulse:.1,closingSpeed:1},g);
  enemy.previousTip={...enemy.pose.tip};enemy.pose.tip.x=-1.6;step(s,g,.14);assert.equal(s.view(g).progress,0,'una parada durante la pasada no es una esquiva limpia');
  s.event('start',{},g);step(s,g);enemy.previousTip={...enemy.pose.tip};step(s,g,.14);assert.equal(s.view(g).progress,0);
});

test('un blanco móvil articula su globo sin conceder puntos ni completar objetivos',()=>{
  const s=select('moving'),g=new DuelEngine();g.aiEnabled=false;g.setScenario('practice');g.phase='fight';
  const head={...g.fighters[1].pose.head};
  for(let i=0;i<240&&g.phase==='fight';i++){
    g.clock+=STEP;g.elapsed+=STEP;g.setControl(2,trainingOpponentControl('moving',g));g.stepPhysics(STEP);s.observe(g,STEP);
  }
  const actual=g.fighters[1].pose.head;
  assert.ok(Math.hypot(actual.x-head.x,actual.y-head.y,actual.z-head.z)>.1);assert.deepEqual(g.scores,[0,0]);assert.equal(s.view(g).progress,0);
});

test('un contacto temprano dentro del círculo cuenta cuando el globo ya se está moviendo físicamente',()=>{
  const s=select('moving');let g;
  g=new DuelEngine((name,data)=>s.event(name,data,g));g.setScenario('practice');g.setTrainingDrill({kind:'moving'});g.aiEnabled=false;g.setLoadout(2,{weapon:'sword',defense:'none'});g.phase='fight';
  for(let i=0;i<120&&g.phase==='fight';i++){
    g.setControl(1,{mainX:1,mainY:.1,wrist:-.2,attackHeld:true,lean:.7});g.update(STEP);s.observe(g,STEP);
  }
  assert.deepEqual(g.scores,[1,0]);assert.equal(s.view(g).progress,1,'un contacto real dentro del círculo no debe perderse por esperar más oscilación');
});

test('las tres zonas del blanco oscilante se completan con contactos XYZ reales',()=>{
  const s=select('moving');let g,contacts=0;
  g=new DuelEngine((name,data)=>{if(name==='burst'&&data.contact===true)contacts++;s.event(name,data,g);});
  g.setScenario('practice');g.setTrainingDrill({kind:'moving'});g.aiEnabled=false;g.setLoadout(2,{weapon:'sword',defense:'none'});
  const inputs=[{mainY:.1,wrist:-.2},{mainY:.9,wrist:-.2},{mainY:-.3,wrist:-.4}];
  for(let index=0;index<inputs.length;index++){
    // Prepare a fresh physical round; only genuine engine burst callbacks advance the exercise.
    g.resetMatch();g.phase='fight';
    for(let i=0;i<120&&g.phase==='fight';i++){
      g.setControl(1,{mainX:1,attackHeld:true,lean:.7,...inputs[index]});g.update(STEP);s.observe(g,STEP);
    }
    assert.deepEqual(g.scores,[1,0]);assert.equal(s.view(g).progress,index+1);
  }
  assert.equal(contacts,3);assert.equal(s.view(g).completed,true);
});
