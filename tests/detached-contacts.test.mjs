import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig,RIG_STEP} from '../public/physics/articulated-rig.js';
const module=await import('../public/physics/detached-contacts.js').catch(()=>null);
test('a new cut face separates without an artificial collision kick',()=>{
  assert.equal(typeof module?.resolveDetachedContacts,'function');
  const rig=new ArticulatedRig();rig.damageJoint('mainElbow',1);const fragment=rig.fragments[0];
  const before={q:[...rig.q],v:[...rig.velocity],x:fragment.x,y:fragment.y,vx:fragment.vx,vy:fragment.vy,omega:fragment.omega};
  const result=module.resolveDetachedContacts([rig],RIG_STEP);assert.equal(result.contacts.length,0);
  assert.deepEqual({q:[...rig.q],v:[...rig.velocity],x:fragment.x,y:fragment.y,vx:fragment.vx,vy:fragment.vy,omega:fragment.omega},before);
});
test('a detached real weapon collides with the opponent and exchanges opposite finite impulses',()=>{
  assert.equal(typeof module?.resolveDetachedContacts,'function');
  const source=new ArticulatedRig({baseX:-4}),target=new ArticulatedRig({baseX:1.5,dir:-1});source.damageJoint('wrist',1);const fragment=source.fragments[0];
  const torso=target.collisionPanels().find(p=>p.key==='chest-front'),blade=fragment.collisionPanels()[0];
  const offset={x:torso.center.x-blade.center.x,y:torso.center.y-blade.center.y};
  fragment.x+=offset.x;fragment.y+=offset.y;fragment.previous={x:fragment.x-3,y:fragment.y,angle:fragment.angle};fragment.vx=3;
  const before=target.velocity.slice(),result=module.resolveDetachedContacts([source,target],RIG_STEP);
  assert.ok(result.contacts.some(c=>c.ownerA!==c.ownerB&&c.impulse>0),'the solver uses the fragment and opponent owners');
  assert.ok(result.contacts.some(c=>c.t>0&&c.t<1),'the continuous query finds an interior entry from a separated previous pose');
  assert.ok(target.velocity.some((v,i)=>v!==before[i]),'real articulated velocity receives the reaction');
  for(const contact of result.contacts){assert.ok(Number.isFinite(contact.impulse)&&contact.impulse>=0&&contact.impulse<=.45);assert.ok(Math.abs(contact.impulseA.x+contact.impulseB.x)<1e-12);assert.ok(Math.abs(contact.impulseA.y+contact.impulseB.y)<1e-12);assert.ok([contact.pointA.x,contact.pointB.y,contact.at.x,contact.at.y,contact.closingSpeed,contact.slideSpeed].every(Number.isFinite));}
  assert.ok([...target.q,...target.velocity,fragment.x,fragment.y,fragment.vx,fragment.vy,fragment.omega].every(Number.isFinite));
});
