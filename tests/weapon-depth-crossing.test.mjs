import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {firstWeaponContact,resolveWeaponBind,weaponBindManifold} from '../public/physics/weapon-bind.js';

function blade({from,to,velocity=0,vertical=false}){
  const x=vertical?.025:.55,y=vertical?.55:.025;
  const panel=z=>({key:'weapon',body:'weapon',depth:.04,z,center:{x:0,y:0},
    vertices:[{x:-x,y:-y},{x,y:-y},{x,y},{x:-x,y}],axes:[{x:1,y:0},{x:0,y:1}]});
  return {
    previousWeaponDepthOffset:from,weaponDepthOffset:to,weaponDepthVelocity:velocity,weaponDepthInverseMass:.7,
    impulse:0,
    collisionPanels(){return [panel(this.weaponDepthOffset)];},
    collisionPanelsAt(t){return [panel(from+(this.weaponDepthOffset-from)*t)];},
    pointVelocity(){return {x:0,y:0};},
    applyWeaponDepthImpulse(value){this.impulse+=value;this.weaponDepthVelocity+=value*this.weaponDepthInverseMass;},
    projectWeaponDepth(delta){this.weaponDepthOffset+=delta;return delta;}
  };
}

test('Armas superpuestas en XY sólo se cruzan cuando coinciden en profundidad',()=>{
  const still=blade({from:0,to:0,vertical:true});
  assert.equal(firstWeaponContact(blade({from:-.18,to:-.10}),still),null);
  const approaching=blade({from:-.12,to:-.02});
  const hit=firstWeaponContact(approaching,still);
  assert.ok(hit&&Math.abs(hit.t-.8)<.00001);
  assert.deepEqual(hit.normal,{x:0,y:0,z:1});
});

test('Un encuentro por la cara de profundidad desvía las armas con impulsos opuestos',()=>{
  const a=blade({from:-.12,to:-.02,velocity:.2});
  const b=blade({from:0,to:0,velocity:-.05,vertical:true});
  const hit=resolveWeaponBind(a,b,{observeVelocities:true});
  assert.ok(hit.impulse>0);
  assert.equal(a.impulse,-b.impulse);
  assert.ok(a.impulse<0&&b.impulse>0);
  assert.ok(a.weaponDepthVelocity<b.weaponDepthVelocity);
  assert.ok(a.weaponDepthOffset<-.02&&b.weaponDepthOffset>0);
  assert.ok(hit.penetration<1e-7);
  assert.ok(hit.dissipatedWork>=0);
  assert.deepEqual(weaponBindManifold(a,b,hit),[]);
});

test('El gesto de profundidad desplaza cuerpo, apoyos, arma y agua durante una ronda real',()=>{
  const game=new DuelEngine();
  game.setMode('versus');game.start();
  while(game.phase==='countdown')game.update(STEP);
  const initial=game.fighters.map(f=>structuredClone(f.pose));
  const advance=(count,tilt)=>{
    for(let i=0;i<count;i++){
      for(const f of game.fighters)game.setControl(f.slot,{headZ:-f.dir*tilt,mainX:-1,mainY:-1,wrist:-1});
      game.update(STEP);
    }
  };
  advance(1,1);
  assert.ok(game.fighters.every(f=>Math.abs(f.rig.bodyDepth)<.01));
  advance(109,1);
  for(const [i,f] of game.fighters.entries()){
    const z=f.rig.bodyDepth,before=initial[i],direction=-f.dir;
    assert.ok(direction*z>.24&&Math.abs(z)<=.28);
    for(const key of ['hip','shoulder','mainHand','tip'])assert.ok(Math.abs(f.pose[key].z-before[key].z-z)<1e-8,key);
    assert.ok(Math.abs(f.pose.feet.front.matrix[14]-before.feet.front.matrix[14]-z)<1e-8);
    assert.ok(direction*(f.pose.head.z-before.head.z)>.40);
    assert.equal(f.fluid.origin.z,f.pose.head.z);
    assert.equal(f.membrane.targetSupport.z,f.pose.head.z);
  }
  advance(150,0);
  assert.equal(game.phase,'fight');
  assert.ok(game.fighters.every(f=>Math.abs(f.rig.bodyDepth)<.001));
});

test('Un cruce entre mazos mueve las manos y los brazos de ambos rigs en Z',()=>{
  const game=new DuelEngine();
  game.setMode('versus');game.setScenario('practice');
  for(const slot of [1,2])game.setLoadout(slot,{weapon:'maul'});
  game.phase='fight';
  for(const f of game.fighters){f.rig.projectBodyDepth(f.dir*.25);f.pose=f.rig.pose();}
  let hit;
  for(let i=0;i<65&&game.phase==='fight';i++){
    game.update(STEP);
    const contact=game.lastWeaponContact;
    if(contact?.normal?.z&&contact.impulse>1e-6){hit=contact;break;}
  }
  assert.ok(hit&&hit.penetration<1e-6);
  for(const f of game.fighters){
    const depth=f.rig.weaponDepthOffset-f.rig.bodyDepth;
    assert.ok(f.dir*depth>.001,'la mano cede en profundidad respecto del cuerpo');
    assert.ok(f.dir*(f.pose.mainElbow.z-.14-f.rig.bodyDepth)>.0005,'el codo acompaña el desvío');
    assert.equal(f.pose.weaponDepthOffset,f.rig.weaponDepthOffset);
  }
  assert.deepEqual(game.scores,[0,0]);
});
