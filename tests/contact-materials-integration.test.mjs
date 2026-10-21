import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP,parryContact} from '../public/engine.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {DEFENSES,WEAPONS} from '../public/equipment.js';
import {firstWeaponContact} from '../public/physics/weapon-bind.js';
import {contactAudio} from '../public/audio/contact-audio.js';

const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function binding(){
  const events=[],g=new DuelEngine((name,data)=>events.push({name,data}));g.setMode('versus');g.setLoadout(1,{weapon:'spear'});g.phase='fight';
  for(const [i,f] of g.fighters.entries()){
    f.rig=new ArticulatedRig({dir:f.dir,baseX:-f.dir*1.53,gravity:0});
    const p=f.rig.pose(),w=WEAPONS[f.equipment.weapon],dx=p.tip.x-p.mainHand.x,dy=p.tip.y-p.mainHand.y,L=Math.hypot(dx,dy);
    p.tip={x:p.mainHand.x+dx/L*w.length,y:p.mainHand.y+dy/L*w.length,z:.17};p.equipment=f.equipment;p.weaponMass=w.mass;
    f.rig.setIntent(p);if(i)f.rig.q[1]+=.025;f.rig.previousQ=f.rig.q.slice();f.pose=f.rig.pose();
  }
  const [a,b]=g.fighters,c=firstWeaponContact(a.rig,b.rig);assert.ok(c);
  a.rig.reactImpulse({point:c.pointA,impulse:{x:c.normal.x*.06,y:c.normal.y*.06}});
  g.resolveWeaponContacts(STEP,{project:false});return {g,events};
}

test('El bind real lleva materiales por superficie, fuerza y velocidad medidas sin chispas legacy duplicadas',()=>{
  const {g,events}=binding(),data=events.find(e=>e.name==='clang')?.data;assert.ok(data);
  assert.equal(data.materialA,'wood');assert.ok(['steel','brass'].includes(data.materialB));assert.equal(data.material,'composite');
  assert.ok(data.impulse>0);near(data.force,data.impulse/STEP);near(data.peakClosingSpeed,data.closingSpeed);
  near(data.slideSpeed,g.lastWeaponContact.slideSpeed);assert.equal(data.keyA,'weapon');assert.equal(data.bodyA,'weapon');
  assert.ok(data.normal);assert.equal(g.spark.length,0,'No vuelve a añadir13chispas fuera del sistema de FX');
  const impact=g.effects.particles.filter(p=>!['dust','smoke'].includes(p.kind));assert.ok(impact.length);assert.ok(impact.every(p=>p.kind==='wood'));
});

function shield({slot=1,moving=true,defense='long'}={}){
  const events=[],g=new DuelEngine((name,data)=>events.push({name,data}));g.setMode('versus');g.setLoadout(3-slot,{defense});g.phase='fight';
  const a=g.fighters[slot-1],b=g.fighters[2-slot],dir=a.dir;
  b.rig.depth.offHand=.10;b.rig.defenseDepth.position=.10;b.rig.defenseDepth.target=.10;
  b.pose=b.rig.pose();b.previousHead={...b.pose.head};b.guard=true;
  const center=b.pose.offHand,from={x:center.x-dir*.45,y:center.y+.07,z:.17},to={x:center.x,y:center.y+.07,z:.17};
  const hit=parryContact(from,to,b.pose,DEFENSES[defense]);assert.ok(hit);
  const seed=new ArticulatedRig({dir,gravity:0}),offset=seed.pose().bodyFrames.weapon.center.x;
  a.rig=new ArticulatedRig({dir,baseX:hit.point.x-offset,gravity:0});
  a.pose={...a.rig.pose(),tip:to};a.previousTip=from;a.previousHead={...a.pose.head};
  a.rig.velocity.fill(0);b.rig.velocity.fill(0);
  const normal={x:-hit.normal.x,y:-hit.normal.y};
  if(moving)a.rig.reactImpulse({point:hit.point,impulse:{x:normal.x*.06,y:normal.y*.06}});
  const va=a.rig.pointVelocity({point:hit.point}),vb=b.rig.pointVelocity({body:'offForearm',point:hit.point});
  const expectedClosing=(va.x-vb.x)*normal.x+(va.y-vb.y)*normal.y;
  g.detectHits();return {g,events,a,b,hit,expectedClosing};
}

test('La parada usa el punto y normal del escudo y el impulso real en ambos roles',()=>{
  for(const slot of [1,2]){
    const {g,events,b,hit,expectedClosing}=shield({slot}),data=events.find(e=>e.name==='clang'&&e.data.defender===b.slot)?.data;assert.ok(data);
    assert.deepEqual(data.at,hit.point);assert.notDeepEqual(data.at,b.pose.offHand);
    assert.deepEqual(data.normal,hit.normal);assert.ok(data.impulse>0);near(data.closingSpeed,expectedClosing);
    near(data.peakClosingSpeed,expectedClosing);near(data.force,data.impulse/STEP);assert.equal(data.materialB,'wood');assert.equal(data.defenseMaterial,'wood');
    assert.equal(g.spark.length,0);assert.ok(g.effects.particles.filter(p=>!['dust','smoke'].includes(p.kind)).every(p=>p.kind!=='spark'));
  }
});

test('Una parada geométrica quieta conserva feedback semántico con impulso/fuerza/velocidad cero y sin FX',()=>{
  const {g,events,b}=shield({moving:false}),data=events.find(e=>e.name==='clang'&&e.data.defender===b.slot)?.data;assert.ok(data);
  assert.equal(data.impulse,0);assert.equal(data.force,0);assert.equal(data.peakClosingSpeed,0);assert.equal(data.slideSpeed,0);
  assert.equal(g.spark.length,0);assert.ok(g.effects.particles.every(p=>['dust','smoke'].includes(p.kind)));
  assert.deepEqual(contactAudio('clang',data,g).cues,[],'El evento semántico quieto tampoco dispara audio');
});

test('La daga convierte su normal local a mundo y aplica reacción en la hoja secundaria real',()=>{
  const events=[],g=new DuelEngine((name,data)=>events.push({name,data}));g.setMode('versus');g.setLoadout(2,{defense:'knife'});g.phase='fight';
  const [a,b]=g.fighters;b.rig.depth.offHand=.10;b.rig.defenseDepth.position=.10;b.pose=b.rig.pose();b.guard=true;b.previousHead={...b.pose.head};
  const h=b.pose.offHand,t=b.pose.defenseTip,dx=t.x-h.x,dy=t.y-h.y,dz=t.z-h.z,L=Math.hypot(dx,dy,dz),xy=Math.hypot(dx,dy);
  const u=[dx/L,dy/L,dz/L],v=[-dy/xy,dx/xy,0],w=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const center={x:h.x+.8*dx,y:h.y+.8*dy,z:h.z+.8*dz},from={x:center.x-v[0]*.12,y:center.y-v[1]*.12,z:center.z},to={x:center.x+v[0]*.06,y:center.y+v[1]*.06,z:center.z};
  const hit=parryContact(from,to,b.pose,DEFENSES.knife);assert.ok(hit);
  const n=[0,1,2].map(i=>u[i]*hit.normal.x+v[i]*hit.normal.y+w[i]*(hit.normal.z??0));
  const seed=new ArticulatedRig({gravity:0}),offset=seed.pose().bodyFrames.weapon.center.x;
  a.rig=new ArticulatedRig({baseX:hit.point.x-offset,gravity:0});a.pose={...a.rig.pose(),tip:to};a.previousTip=from;
  a.rig.velocity.fill(0);b.rig.velocity.fill(0);a.rig.reactImpulse({point:hit.point,impulse:{x:-n[0]*.06,y:-n[1]*.06}});
  g.detectHits();const data=events.find(e=>e.name==='clang'&&e.data.defender===2)?.data;assert.ok(data);
  for(const [i,axis] of ['x','y','z'].entries())near(data.normal[axis],n[i]);
  assert.deepEqual(data.at,hit.point);assert.equal(data.bodyB,'offWeapon');assert.equal(data.materialB,'steel');assert.ok(data.impulse>0);
  assert.equal(b.rig.lastImpulse.body,'offWeapon');
});
