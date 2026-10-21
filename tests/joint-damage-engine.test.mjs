import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {AutoDefense} from '../public/auto-defense.js';

function duel(){const events=[],g=new DuelEngine((name,data)=>events.push({name,data}));g.setMode('versus');g.phase='fight';return {g,events};}
const damage=f=>Object.values(f.pose.joints??{}).reduce((sum,j)=>sum+j.damage,0);
function impactFixture(g){
  for(const f of g.fighters){
    f.rig=new ArticulatedRig({baseX:-f.dir*1.3,dir:f.dir,gravity:0});
    f.rig.velocity[4]=4;f.pose=f.rig.pose();
  }
}

test('Un impacto real desgasta articulaciones antes del throttle de sonido, sin puntuar',()=>{
  const {g,events}=duel();impactFixture(g);
  g.materialContactTimes=new Map([['weapon/weapon/wood',g.clock]]);
  g.resolveBodyContacts(STEP);
  assert.equal(typeof g.applyJointDamage,'function','falta el commit de impactos medidos al terminar el paso');
  assert.equal(g.fighters.reduce((n,f)=>n+damage(f),0),0,'el solve aún no debe cambiar la topología');
  g.applyJointDamage(STEP);
  assert.ok(g.fighters.some(f=>damage(f)>0),'el impulso físico debe producir daño progresivo');
  assert.ok(events.some(e=>e.name==='joint-damage'&&[1,2].includes(e.data.slot)&&e.data.contact===true));
  assert.equal(events.some(e=>e.name==='material-contact'),false,'el sonido estaba en cooldown');
  assert.deepEqual(g.scores,[0,0]);assert.equal(g.phase,'fight');
  assert.ok(g.fighters.every(f=>f.globIntact));
});

test('El mismo contacto fuera de combate no desgasta; reposo, cuenta atrás y gravedad tampoco',()=>{
  const {g,events}=duel();g.phase='countdown';impactFixture(g);g.resolveBodyContacts(STEP);
  assert.equal(typeof g.applyJointDamage,'function');g.applyJointDamage(STEP);
  assert.equal(g.fighters.reduce((n,f)=>n+damage(f),0),0);
  g.resetRound();g.phase='ready';
  for(let i=0;i<120;i++)g.update(STEP);
  assert.equal(g.fighters.reduce((n,f)=>n+damage(f),0),0);
  assert.equal(events.some(e=>e.name==='joint-damage'||e.name==='joint-break'),false);
});

test('Una mano y arma separadas no generan ataques invisibles con su antigua punta',()=>{
  const {g,events}=duel(),[a,b]=g.fighters;
  assert.equal(typeof a.rig.damageJoint,'function','falta el desprendimiento físico');
  a.rig.damageJoint('wrist',1);a.pose=a.rig.pose();
  const h=b.pose.head;
  a.previousTip={x:h.x-.7,y:h.y,z:h.z};a.pose.tip={...h};
  a.previousWeaponDirection={x:1,y:0};a.pose.mainHand={x:h.x-1,y:h.y,z:h.z};
  b.previousTip={...b.pose.tip};g.detectHits();
  assert.deepEqual(g.scores,[0,0]);assert.ok(b.globIntact);
  assert.equal(events.some(e=>e.name==='burst'),false);
  g.setControl(1,{thrust:true,attackHeld:true,mainX:1});g.updateFighter(a,STEP);
  assert.equal(a.lunge,0,'ninguna intención reactiva el arma perdida');
  assert.equal(events.some(e=>e.name==='thrust'&&e.data.slot===1),false);
});

test('El brazo de defensa separado no vuelve a activar una guardia manual o automática',()=>{
  const {g}=duel(),[a,b]=g.fighters;
  assert.equal(typeof b.rig.damageJoint,'function');b.rig.damageJoint('offElbow',1);b.pose=b.rig.pose();
  g.setControl(2,{guard:true,offY:1});g.updateFighter(b,STEP);
  assert.equal(b.guard,false);
  const assist=new AutoDefense({seed:5});
  for(let i=0;i<100;i++){
    a.pose.tip={x:b.pose.head.x-.4,y:b.pose.head.y,z:b.pose.head.z};
    a.previousTip={x:a.pose.tip.x-.04,y:a.pose.tip.y,z:a.pose.tip.z};
    assert.notEqual(assist.update(b,a,{guard:false,thrust:false},STEP).guard,true);
  }
});

for(const slot of [1,2])test(`J${slot}: una espada separada sigue pinchando sólo con su punta física real`,()=>{
  const {g,events}=duel(),a=g.fighters[slot-1],b=g.fighters[2-slot];
  a.rig.damageJoint('wrist',1);a.pose=a.rig.pose();
  const fragment=a.rig.fragments[0],head=b.pose.head,tip=fragment.worldPointAt(fragment.sourcePose.tip,1),dir=a.dir;
  fragment.x+=head.x-tip.x-dir*.6;fragment.y+=head.y-tip.y;
  fragment.previous={x:fragment.x,y:fragment.y,angle:fragment.angle};
  fragment.x+=dir*.9;fragment.vx=dir*.9/STEP;
  a.pose=a.rig.pose();b.previousTip={...b.pose.tip};
  g.detectHits();
  const burst=events.find(e=>e.name==='burst');assert.ok(burst,'la punta desprendida conserva su colisión con látex');
  assert.equal(burst.data.contact,true);assert.equal(burst.data.winner,slot);assert.equal(burst.data.loser,b.slot);
  assert.equal(b.globIntact,false);assert.equal(g.scores[slot-1],1);
});

test('Impactos separados del solver desgastan hasta una única rotura; la pérdida sola nunca gana',()=>{
  const {g,events}=duel();impactFixture(g);
  const initial=g.fighters.map(f=>f.rig.q.slice());let strokes=0;
  for(;strokes<100&&!g.fighters.some(f=>!f.rig.isBodyAttached('weapon'));strokes++){
    for(const [index,f]of g.fighters.entries()){
      f.rig.q.set(initial[index]);f.rig.velocity.fill(0);f.rig.velocity[4]=4;f.pose=f.rig.pose();
    }
    g.clock+=.2;g.resolveBodyContacts(STEP);g.applyJointDamage(STEP);
  }
  assert.ok(strokes>1&&strokes<100,'la unión cede por impactos medidos sucesivos, no por asignar daño desde el test');
  assert.ok(events.some(e=>e.name==='joint-damage'&&!e.data.detached));
  const broken=events.filter(e=>e.name==='joint-break');assert.ok(broken.length>0);
  assert.equal(new Set(broken.map(e=>`${e.data.slot}/${e.data.joint}`)).size,broken.length);
  assert.equal(g.phase,'fight');assert.deepEqual(g.scores,[0,0]);assert.ok(g.fighters.every(f=>f.globIntact));
});

for(const slot of [1,2])test(`J${slot}: perder el arma y el escudo no vuelve invulnerable el globo`,()=>{
  const {g}=duel(),a=g.fighters[slot-1],b=g.fighters[2-slot];
  b.rig.damageJoint('mainShoulder',1);b.rig.damageJoint('offShoulder',1);b.pose=b.rig.pose();
  const h=b.pose.head;a.previousTip={x:h.x-a.dir*.7,y:h.y,z:h.z};a.pose.tip={...h};
  a.pose.mainHand={x:h.x-a.dir,y:h.y,z:h.z};a.previousWeaponDirection={x:a.dir,y:0};
  g.detectHits();assert.equal(b.globIntact,false);assert.equal(g.scores[slot-1],1);
});

test('Perder una pierna detiene la marcha, conserva globo/score y una ronda nueva restaura todo',()=>{
  const {g}=duel(),f=g.fighters[0];
  assert.equal(typeof f.rig.damageJoint,'function');f.rig.damageJoint('frontHip',1);f.pose=f.rig.pose();
  const before=f.baseX;g.setControl(1,{lean:1});
  for(let i=0;i<12;i++)g.updateFootwork(STEP);
  assert.equal(f.baseX,before,'sin dos apoyos conectados no hace una marcha intacta');
  assert.ok(f.globIntact);assert.deepEqual(g.scores,[0,0]);assert.equal(g.phase,'fight');
  g.resetRound();
  for(const restored of g.fighters){
    assert.ok(restored.rig.isBodyAttached('weapon'));assert.ok(restored.rig.isBodyAttached('frontShin'));
    assert.equal(damage(restored),0);assert.equal(restored.pose.detached?.length??0,0);
  }
  assert.deepEqual(g.applyJointDamage(STEP),[],'no quedan impactos ni episodios pendientes de la ronda anterior');
});
