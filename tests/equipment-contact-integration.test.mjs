import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {SinglePlayerSession} from '../public/single-player.js';
import {DEFENSES} from '../public/equipment.js';
import {drawDefense,EQUIPMENT_MESHES} from '../public/rendering/equipment.js';
import {segmentConvexPolygonContact} from '../public/physics/equipment-contact.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';

// Same grazing XY fixtures on the actual z=.17 slice of the XYZ head, rather
// than at the wider center-plane radius used by the former cylinder proxy.
const headSection=Math.sqrt(1-((.17-.025)/(BALLOON_RADII.z+.006))**2);

function rotatingMaul(slot=1,{angle=-.1,headVelocity={vx:0,vy:0}}={}){
  const events=[],session=new SinglePlayerSession();session.select('precision');
  const game=new DuelEngine((name,data)=>{events.push({name,data});session.event(name,data,game);});
  game.setLoadout(slot,{weapon:'maul'});game.setLoadout(3-slot,{defense:'none'});game.phase='fight';
  const a=game.fighters[slot-1],b=game.fighters[2-slot],mirror=slot===1?1:-1;
  a.lunge=.8;a.previousTip={x:0,y:.70,z:.17};a.previousWeaponDirection={x:mirror*Math.cos(angle),y:Math.sin(angle)};
  a.pose={...a.pose,mainHand:{x:-mirror*1.08,y:.70,z:.17},tip:{x:0,y:.70,z:.17}};
  b.pose={...b.pose,head:{x:mirror*.42*headSection,y:.4375,z:.025}};b.headVelocity=headVelocity;b.previousHead={...b.pose.head};
  return {game,a,b,events,session};
}

test('La arista rotatoria de mazo informa su movimiento real con tip quieto y acredita precisión',()=>{
  const {game,events,session}=rotatingMaul();game.detectHits();
  const data=events.find(e=>e.name==='burst')?.data;
  assert.equal(data?.contact,true);assert.deepEqual(game.scores,[1,0]);
  const expected=2*.2625*Math.sin(.1/2)/STEP;
  assert.ok(Math.abs(data.relativeSpeed-expected)<1e-9,`velocidad ${data.relativeSpeed} debe corresponder a arista ${expected}`);
  assert.equal(session.view(game).progress,1,'un contacto aceptado dentro de zona acredita exactamente un objetivo');
});

test('La esquina invisible del escudo largo no para ni consume guardia en ambos sentidos',()=>{
  for(const slot of [1,2]){
    const events=[],game=new DuelEngine((name,data)=>events.push({name,data}));game.setLoadout(3-slot,{defense:'long'});game.phase='fight';
    const a=game.fighters[slot-1],b=game.fighters[2-slot],mirror=slot===1?1:-1;
    a.lunge=.8;a.previousTip={x:mirror*-.4,y:-.322,z:.17};
    a.pose={...a.pose,mainHand:{x:mirror*-1,y:-.322,z:.17},tip:{x:mirror*-.1755,y:-.322,z:.17}};
    b.guard=true;b.pose={...b.pose,head:{x:5,y:5,z:.025},offHand:{x:0,y:0,z:.17},shieldRadiusX:.27,shieldRadiusY:.46};
    b.previousHead={...b.pose.head};
    game.detectHits();
    assert.equal(events.some(e=>e.name==='clang'),false,`slot ${slot}: no existe geometría en esta esquina`);
    assert.equal(b.guardEnergy,1);assert.deepEqual(game.scores,[0,0]);
  }
});

test('La velocidad de mazo se refleja con el slot y resta el movimiento real de la cabeza',()=>{
  for(const slot of [1,2]){
    const mirror=slot===1?1:-1,headVelocity={vx:mirror*.7,vy:-.2,vz:.1};
    const {game,events}=rotatingMaul(slot,{headVelocity});game.detectHits();
    const data=events.find(e=>e.name==='burst').data;
    const vx=mirror*.2625*Math.sin(.1)/STEP,vy=.2625*(Math.cos(.1)-1)/STEP;
    assert.ok(Math.abs(data.pointVelocity.vx-vx)<1e-9);assert.ok(Math.abs(data.pointVelocity.vy-vy)<1e-9);
    assert.ok(Math.abs(data.relativeSpeed-Math.hypot(vx-headVelocity.vx,vy-headVelocity.vy,-headVelocity.vz))<1e-9);
    assert.equal(data.winner,slot);
  }
});

test('Un contacto sin movimiento no recibe velocidad inventada ni acredita el reto',()=>{
  const {game,events,session}=rotatingMaul(1,{angle:0});game.detectHits();
  const data=events.find(e=>e.name==='burst').data;
  assert.equal(data.relativeSpeed,0);assert.deepEqual(data.pointVelocity,{vx:0,vy:0,vz:0});
  assert.equal(session.view(game).progress,0);
});

test('La punta clásica conserva velocidad traslacional y el filo de hacha mide su propio radio de giro',()=>{
  const events=[],game=new DuelEngine((name,data)=>{if(name==='burst')events.push(data);});game.phase='fight';
  const [a,b]=game.fighters;a.lunge=.8;a.previousTip={x:-.8,y:0,z:.17};a.pose={...a.pose,mainHand:{x:.12,y:0,z:.17},tip:{x:1.2,y:0,z:.17}};
  b.pose={...b.pose,head:{x:1,y:0,z:.025}};b.previousHead={...b.pose.head};b.headVelocity={vx:1.25,vy:0};game.detectHits();
  assert.equal(events[0].relativeSpeed,2/STEP-1.25);
  const axeEvents=[],axe=new DuelEngine((name,data)=>{if(name==='burst')axeEvents.push(data);});axe.setLoadout(1,{weapon:'axe'});axe.setLoadout(2,{defense:'none'});axe.phase='fight';
  const [c,d]=axe.fighters;c.lunge=.8;c.previousTip={x:0,y:.7,z:.17};c.previousWeaponDirection={x:Math.cos(-.1),y:Math.sin(-.1)};
  c.pose={...c.pose,mainHand:{x:-.92,y:.7,z:.17},tip:{x:0,y:.7,z:.17}};d.pose={...d.pose,head:{x:.4128*headSection,y:.5488,z:.025}};d.previousHead={...d.pose.head};
  axe.detectHits();assert.equal(axeEvents.length,1);
  assert.ok(Math.abs(axeEvents[0].relativeSpeed-2*Math.hypot(.0072,.1512)*Math.sin(.05)/STEP)<1e-9);
});

test('El contacto interior de una arista interpola el mismo punto material en los dos estados observados',()=>{
  const {game,b,events}=rotatingMaul();b.pose.head={x:.427*headSection,y:.634375,z:.025};b.previousHead={...b.pose.head};
  game.detectHits();const data=events.find(e=>e.name==='burst')?.data;assert.ok(data);
  // A glancing slice is narrower than the sample spacing; only the present
  // edge intersects. Its first material point is above the head center.
  const halfSlice=(BALLOON_RADII.y+.006)*headSection*Math.sqrt(1-(.427/(BALLOON_RADII.x+.006))**2),across=.7-(.634375+halfSlice);
  const vx=across*Math.sin(.1)/STEP,vy=across*(Math.cos(.1)-1)/STEP;
  assert.ok(across>0&&across<.13125);
  assert.ok(Math.abs(data.pointVelocity.vx-vx)<1e-9);assert.ok(Math.abs(data.pointVelocity.vy-vy)<1e-9);
  assert.ok(Math.abs(data.relativeSpeed-Math.hypot(vx,vy))<1e-9);
});

function shieldSweep(slot,from,to,{head={x:5,y:5,z:.025},center={x:0,y:0,z:.10},rx=.27,ry=.46,guard=true}={}){
  const events=[],game=new DuelEngine((name,data)=>events.push({name,data}));game.setLoadout(3-slot,{defense:'long'});game.phase='fight';
  const a=game.fighters[slot-1],b=game.fighters[2-slot];a.lunge=.8;a.previousTip={...from,z:.17};
  a.pose={...a.pose,mainHand:{x:from.x-(slot===1?1:-1),y:from.y,z:.17},tip:{...to,z:.17}};
  b.guard=guard;b.pose={...b.pose,head,offHand:center,shieldDepth:{min:center.z+.02807524,max:center.z+.107},shieldRadiusX:rx,shieldRadiusY:ry};b.previousHead={...head};game.detectHits();return {game,a,b,events};
}

test('Los vértices visibles, centro y duelas salientes del escudo largo conservan parada en ambos slots y escalas',()=>{
  for(const slot of [1,2])for(const [rx,ry] of [[.27,.46],[.22,.36]]){
    const mirror=slot===1?1:-1;
    // .7,-.6 is a visible plank outside the pointed main body; its union must remain.
    for(const [x,y] of [[0,0],[0,.95],[0,-.95],[-1,.30],[.7,-.6]]){
      const end={x:mirror*x*rx,y:y*ry},from={x:end.x-mirror*.12,y:end.y};
      const {b,events}=shieldSweep(slot,from,end,{rx,ry});
      assert.ok(events.some(e=>e.name==='clang'),`${slot}/${rx}/${x},${y}`);assert.ok(b.guardEnergy<1);
    }
  }
});

test('La defensa larga respeta el primer contacto respecto del globo en ambos sentidos',()=>{
  for(const slot of [1,2]){
    const mirror=slot===1?1:-1,from={x:mirror*-1.5,y:0},to={x:mirror*1.5,y:0};
    const front=shieldSweep(slot,from,to,{head:{x:mirror*.9,y:0,z:.025}});
    assert.equal(front.b.globIntact,true);assert.ok(front.events.some(e=>e.name==='clang'));
    const behind=shieldSweep(slot,from,to,{head:{x:0,y:0,z:.025},center:{x:mirror*.9,y:0,z:.10}});
    assert.equal(behind.b.globIntact,false);assert.equal(behind.events.some(e=>e.name==='clang'),false);
    const idle=shieldSweep(slot,from,to,{guard:false});assert.equal(idle.events.some(e=>e.name==='clang'),false);
  }
});

test('Catálogo y renderer comparten perfil y las cinco duelas sin cambiar su geometría',()=>{
  const defense=DEFENSES.long;assert.equal(defense.contactProfiles[0],defense.profile);
  assert.ok(Object.isFrozen(defense.profile)&&defense.profile.every(Object.isFrozen));
  assert.equal(defense.contactProfiles.length,6);
  const calls=[],fighter={equipment:{weapon:'sword',defense:'long'},pose:{offHand:{x:0,y:0,z:.17},shieldRadiusX:.27,shieldRadiusY:.46}};
  drawDefense({draw:(shape,model)=>calls.push({shape,model})},fighter,{wood:1,light:2,metal:3,steel:4});
  const planks=calls.filter(c=>c.shape==='box'&&Math.abs(c.model[14]-.086)<1e-7);
  assert.equal(planks.length,5);
  for(let i=0;i<5;i++){
    assert.ok(Math.abs(planks[i].model[12]-.27*defense.planks[i].x)<1e-7);
    assert.ok(Math.abs(planks[i].model[0]-.27*defense.planks[i].width)<1e-7);
    assert.ok(Math.abs(planks[i].model[5]-.46*defense.planks[i].height)<1e-7);
  }
  for(const [x,y] of defense.profile)assert.ok(EQUIPMENT_MESHES.shieldLong.p.some((v,i,p)=>i%3===0&&v===x&&p[i+1]===y));
});

test('El clip convexo conserva bordes, primera entrada, starts-inside y ambos órdenes del perfil',()=>{
  const square=[[-1,-1],[1,-1],[1,1],[-1,1]];
  for(const profile of [square,square.slice().reverse()]){
    const hit=segmentConvexPolygonContact({x:-2,y:1,z:0},{x:2,y:1,z:1},profile,{x:0,y:0},1,1);
    assert.ok(hit);assert.equal(hit.t,.25);assert.equal(hit.point.z,.25);assert.equal(hit.normal.x,-1);
    assert.equal(segmentConvexPolygonContact({x:-2,y:1.00001},{x:2,y:1.00001},profile,{x:0,y:0},1,1),null);
    const inside=segmentConvexPolygonContact({x:0,y:0},{x:.2,y:.2},profile,{x:0,y:0},1,1);
    assert.equal(inside.t,0);assert.equal(inside.startedInside,true);
  }
});

test('Un perfil inválido o degenerado no genera contactos con NaN',()=>{
  for(const profile of [[[],[1,0],[0,1]],[[0,0],[1,0],[2,0]],[[0,0],[NaN,1],[1,1]]]){
    assert.equal(segmentConvexPolygonContact({x:-2,y:0},{x:2,y:0},profile,{x:0,y:0},1,1),null);
  }
});
