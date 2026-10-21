import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';

let SinglePlayerSession,CAMPAIGN;
try{({SinglePlayerSession,CAMPAIGN}=await import('../public/single-player.js'));}
catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const session=options=>{
  assert.equal(typeof SinglePlayerSession,'function','falta el módulo de progreso individual');
  return new SinglePlayerSession(options);
};
function fixture(){
  return {mode:'solo',phase:'fight',round:1,clock:0,scores:[0,0],fighters:[
    {slot:1,dir:1,baseX:-1.5,boss:false,balloonSize:1,globIntact:true,guard:false,guardBroken:false,guardEnergy:1,lunge:0,
      controller:{mainX:0,mainY:0,offX:0,offY:0,lean:0,guard:false,thrust:false},
      pose:{head:{x:-1.5,y:2.45,z:0},mainShoulder:{x:-1.3,y:1.7,z:.11},mainHand:{x:-.6,y:1.85,z:.17},
        offShoulder:{x:-1.7,y:1.7,z:-.11},offHand:{x:-1.45,y:1.85,z:-.08},tip:{x:.42,y:1.85,z:.17}}},
    {slot:2,dir:-1,baseX:1.5,boss:false,balloonSize:1,globIntact:true,
      pose:{head:{x:1.5,y:2.45,z:0}}}
  ]};
}
const genuine=(impact,extra={})=>({winner:1,loser:2,draw:false,contact:true,impact:{...impact},relativeSpeed:1.2,...extra});
function observe(s,g,seconds=.1){for(let elapsed=0;elapsed<seconds-1e-8;elapsed+=STEP){g.clock+=STEP;s.observe(g,STEP);}}
function trainToPuncture(s,g){
  const f=g.fighters[0];s.select('training');observe(s,g);
  f.controller.mainY=1;f.pose.mainHand.y+=.25;observe(s,g);
  f.controller.mainY=0;f.pose.mainHand.y-=.25;observe(s,g,.35);
  f.controller.lean=1;f.baseX+=.25;observe(s,g);
  f.controller.lean=-1;f.baseX-=.25;observe(s,g);
  f.controller.lean=1;f.baseX+=.15;f.controller.mainY=1;f.pose.mainHand.y+=.25;observe(s,g,.35);
  f.controller.guard=false;f.guard=false;f.controller.thrust=true;f.lunge=.8;f.pose.tip.x+=.4;observe(s,g);
}

test('las modalidades físicas desactivan IA sin cambiar el duelo competitivo',()=>{
  const s=session();assert.equal(s.configuration().scenario,'duel');assert.equal(s.configuration().aiEnabled,true);
  for(const kind of ['training','practice','precision']){
    assert.equal(s.select(kind),true);assert.equal(s.configuration().scenario,'practice');assert.equal(s.configuration().aiEnabled,false);
  }
  assert.equal(s.select('invalid'),false);assert.equal(s.view().kind,'precision');
});

test('entrenamiento exige desplazamientos físicos y no acredita pulsaciones inmóviles',()=>{
  const s=session(),g=fixture(),f=g.fighters[0];s.select('training');observe(s,g);
  f.controller.mainY=1;observe(s,g,.7);assert.equal(s.view(g).progress,0);
  // Trasladar todo el cuerpo no es mover la articulación del brazo.
  for(const key of ['mainShoulder','mainHand'])f.pose[key].x+=.3;
  observe(s,g);assert.equal(s.view(g).progress,0);
  f.pose.mainHand.y+=.25;observe(s,g);assert.equal(s.view(g).progress,1);
  f.controller.mainY=0;observe(s,g,.35);assert.equal(s.view(g).progress,1,'release must physically return the arm');
  f.pose.mainHand.y-=.25;observe(s,g,.35);assert.equal(s.view(g).progress,2);
  f.controller.lean=1;observe(s,g);assert.equal(s.view(g).progress,2);
  f.baseX+=.25;observe(s,g);assert.equal(s.view(g).progress,3);
  f.controller.lean=-1;f.baseX-=.25;observe(s,g);assert.equal(s.view(g).progress,4);
  f.controller.lean=1;f.controller.mainY=1;observe(s,g,.4);assert.equal(s.view(g).progress,4,'buttons alone cannot prove combined movement');
  f.pose.mainHand.y+=.25;f.baseX+=.15;observe(s,g,.35);assert.equal(s.view(g).progress,5);
  f.controller.guard=false;f.guard=false;f.controller.thrust=true;observe(s,g);assert.equal(s.view(g).progress,5);
  f.lunge=.8;f.pose.tip.x+=.4;observe(s,g);assert.equal(s.view(g).progress,6);
});

test('perforación de entrenamiento ignora demo, contacto ausente y velocidad inválida',()=>{
  const s=session(),g=fixture();trainToPuncture(s,g);assert.equal(s.view(g).progress,6);
  for(const extra of [{demonstration:true},{contact:false},{winner:2,loser:1},{draw:true},{relativeSpeed:0},{relativeSpeed:NaN},{impact:{x:0,y:NaN,z:.17}}]){
    s.event('burst',genuine({x:1,y:2,z:.17},extra),g);assert.equal(s.view(g).completed,false);
  }
  s.event('burst',genuine({x:1,y:2,z:.17}),g);assert.equal(s.view(g).completed,true);assert.equal(s.view(g).progress,7);
  assert.equal(s.next(),true);assert.equal(s.view(g).progress,0);
});

test('precisión publica zonas alcanzables, móviles y comprueba el impacto XYZ real',()=>{
  const s=session(),g=fixture();s.select('precision');let target=s.view(g).target;
  assert.equal(target.slot,2);assert.equal(target.z,.17);assert.ok(target.x<g.fighters[1].pose.head.x);
  assert.ok(Math.abs(target.y-g.fighters[1].pose.head.y)<.26);
  s.event('burst',genuine({...target,z:.17+target.radius+.01}),g);assert.equal(s.view(g).progress,0);
  g.fighters[1]=structuredClone(g.fighters[1]);g.round++;
  s.event('burst',genuine(target,{demonstration:true}),g);assert.equal(s.view(g).progress,0);
  g.fighters[1].pose.head.x+=.4;g.fighters[1].pose.head.y+=.2;
  const moved=s.view(g).target;assert.ok(Math.abs(moved.x-target.x-.4)<1e-12);assert.ok(Math.abs(moved.y-target.y-.2)<1e-12);
  s.event('burst',genuine(target),g);assert.equal(s.view(g).progress,0,'el marcador antiguo no valida un globo que se movió');
  g.fighters[1]=structuredClone(g.fighters[1]);g.round++;
  s.event('burst',genuine(moved),g);assert.equal(s.view(g).progress,1);
  g.fighters[1]=structuredClone(g.fighters[1]);g.round++;
  const second=s.view(g).target;s.event('burst',genuine(second),g);assert.equal(s.view(g).progress,2);
  g.fighters[1]=structuredClone(g.fighters[1]);g.round++;
  const third=s.view(g).target;s.event('burst',genuine(third),g);assert.equal(s.view(g).completed,true);
  assert.equal(s.view(g).target,null);assert.equal(s.view(g).progress,3);
});

test('precisión no cuenta duplicados del mismo globo ni geometría no finita',()=>{
  const s=session(),g=fixture();s.select('precision');const data=genuine(s.view(g).target);
  s.event('burst',data,g);s.event('burst',data,g);assert.equal(s.view(g).progress,1);
  g.fighters[1].pose.head.x=Infinity;assert.equal(s.view(g).target,null);
  s.event('burst',genuine({x:1,y:2,z:.17}),g);assert.equal(s.view(g).progress,1);
});

test('práctica libre nunca concluye ni inventa progreso por romper un globo',()=>{
  const s=session(),g=fixture();s.select('practice');s.event('burst',genuine({x:1,y:2,z:.17}),g);
  observe(s,g,1);assert.equal(s.view(g).completed,false);assert.equal(s.next(),false);
});

test('campaña exige victoria confirmada y ofrece reintento tras derrota',()=>{
  const s=session(),g=fixture();s.select('campaign');const first=s.configuration();
  assert.equal(first.aiStyle,'aggressive');assert.equal(s.next(),false);
  s.event('burst',genuine({x:1,y:2,z:.17}),g);assert.equal(s.next(),false);
  s.event('matchover',{winner:0},g);assert.equal(s.next(),false);
  s.event('matchover',{winner:2},g);assert.equal(s.view(g).nextAction,'retry');assert.equal(s.next(),true);
  assert.equal(s.configuration().aiStyle,'aggressive');
  s.event('matchover',{winner:1},g);assert.equal(s.view(g).nextAction,'advance');assert.equal(s.view(g).progress,1);assert.equal(s.next(),true);
  assert.equal(s.configuration().aiStyle,'defender');
});

test('los siete encuentros terminan en jefe y guardan sólo progreso ganado',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const s=session({storage}),g=fixture();s.select('campaign');const styles=[];
  for(let index=0;index<7;index++){
    styles.push(s.configuration().aiStyle);s.event('matchover',{winner:1},g);
    if(index<6)assert.equal(s.next(),true);
  }
  assert.deepEqual(styles,['aggressive','defender','counter','feint','precision','erratic','boss']);
  assert.equal(s.configuration().difficulty,'boss');assert.equal(s.view(g).completed,true);
  assert.equal(s.next(),false,'no se fabrica un octavo encuentro');
  const restored=session({storage});restored.select('campaign');assert.equal(restored.view(g).completed,true);
  restored.resetProgress();assert.equal(restored.configuration().aiStyle,'aggressive');assert.equal(restored.view(g).completed,false);
});

test('JSON corrupto, versión futura y rango inválido no fabrican progreso',()=>{
  for(const raw of ['oops','null','[]','{"version":2,"stage":6,"completed":true}','{"version":1,"stage":99,"completed":false}',
    '{"version":1,"stage":1.5,"completed":false}','{"version":1,"stage":0,"completed":true}','{"version":1,"stage":6,"completed":"yes"}']){
    const s=session({storage:{getItem:()=>raw,setItem(){},removeItem(){}}});s.select('campaign');
    assert.equal(s.configuration().aiStyle,'aggressive');assert.equal(s.view().completed,false);
  }
});

test('storage denegado y datos devueltos mutados no afectan jugar ni el catálogo',()=>{
  const s=session({storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}}}),g=fixture();
  s.select('campaign');const config=s.configuration();config.aiStyle='boss';assert.equal(s.configuration().aiStyle,'aggressive');
  s.event('matchover',{winner:1},g);assert.equal(s.next(),true);assert.equal(s.configuration().aiStyle,'defender');
  s.resetProgress();assert.equal(s.configuration().aiStyle,'aggressive');assert.equal(Object.isFrozen(CAMPAIGN),true);
});

test('eventos demo no pueden ganar campaña ni heredar su resultado',()=>{
  const s=session(),g=fixture();s.select('campaign');s.event('burst',genuine({x:1,y:2,z:.17},{demonstration:true}),g);
  s.event('matchover',{winner:1},g);assert.equal(s.next(),false);
  s.event('reset',{},g);s.event('matchover',{winner:1,demonstration:true},g);assert.equal(s.next(),false);
  s.event('reset',{},g);s.event('matchover',{winner:1},g);assert.equal(s.next(),true);
});

test('la marca autoritativa de demostración bloquea campaña aunque falte en el evento',()=>{
  const s=session(),g=fixture();s.select('campaign');g.demonstration=true;
  s.event('matchover',{winner:1},g);assert.equal(s.next(),false);assert.equal(s.view(g).progress,0);
});

test('una sesión individual conservada no acredita acciones ni victorias de Versus',()=>{
  const s=session(),g=fixture();s.select('training');observe(s,g);g.mode='versus';
  g.fighters[0].controller.mainY=1;g.fighters[0].pose.mainHand.y+=.3;observe(s,g);
  assert.equal(s.view(g).progress,0);
  s.select('precision');s.event('burst',genuine(s.view(g).target),g);assert.equal(s.view(g).progress,0);
  s.select('campaign');s.event('matchover',{winner:1},g);assert.equal(s.next(),false);
});

test('un fallo de precisión consume ese globo y no acepta un segundo contacto inventado',()=>{
  const s=session(),g=fixture();s.select('precision');const target=s.view(g).target;
  s.event('burst',genuine({...target,y:target.y+.5}),g);assert.equal(s.view(g).progress,0);
  s.event('burst',genuine(target),g);assert.equal(s.view(g).progress,0);
  g.fighters[1]=structuredClone(g.fighters[1]);g.round++;s.event('burst',genuine(s.view(g).target),g);assert.equal(s.view(g).progress,1);
});

test('observe ignora pausas y datos inválidos y no modifica el estado autoritativo',()=>{
  const s=session(),g=fixture();s.select('training');const original=structuredClone(g);observe(s,g);
  assert.deepEqual({...g,clock:0},original);
  g.phase='ready';g.fighters[0].controller.mainY=1;g.fighters[0].pose.mainHand.y+=1;observe(s,g);assert.equal(s.view(g).progress,0);
  s.observe(g,Infinity);s.observe(null,STEP);assert.equal(s.view(g).progress,0);
});

test('los primeros seis objetivos de entrenamiento se alcanzan con articulaciones y mandos reales',()=>{
  const s=session();s.select('training');const g=new DuelEngine();g.aiEnabled=false;g.mode='solo';g.phase='fight';
  // Solve the same authoritative joints/footwork directly; tactical AI is outside this pure module's scope.
  const run=(control,seconds,target)=>{for(let time=0;time<seconds&&s.view(g).progress<target;time+=STEP){g.clock+=STEP;g.setControl(1,control);g.updateFootwork(STEP);for(const f of g.fighters)g.updateFighter(f,STEP);s.observe(g,STEP);}};
  s.observe(g,STEP);run({mainY:1},.8,1);assert.equal(s.view(g).progress,1);
  run({},1.5,2);assert.equal(s.view(g).progress,2);
  run({lean:1},.6,3);assert.equal(s.view(g).progress,3);
  run({lean:-1},1.2,4);assert.equal(s.view(g).progress,4);
  run({mainY:1,lean:1},.9,5);assert.equal(s.view(g).progress,5);
  run({mainX:1,mainY:.4,thrust:true},.3,6);assert.equal(s.view(g).progress,6);
});
