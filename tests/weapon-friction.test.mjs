import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {resolveWeaponBind,firstWeaponContact,WEAPON_BIND} from '../public/physics/weapon-bind.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';

function slider(y,velocity,mass=1){
  const vertices=[{x:-.5,y:y-.017},{x:.5,y:y-.017},{x:.5,y:y+.017},{x:-.5,y:y+.017}];
  const panel={body:'weapon',key:'weapon',material:'steel',axes:[{x:1,y:0},{x:0,y:1}],center:{x:0,y},vertices,z:.177,depth:.034};
  return {q:[],previousQ:[],scale:1,swordLength:1,velocity:{...velocity},
    collisionPanels:()=>[panel],collisionPanelsAt:()=>[panel],
    pointVelocity(){return {...this.velocity};},
    effectiveInverseMass:()=>1/mass,
    contactInertia(){return {normal:1/mass,tangent:1/mass,cross:0};},
    reactImpulse({impulse}){this.velocity.x+=impulse.x/mass;this.velocity.y+=impulse.y/mass;this.lastImpulse={impulse};return true;}
  };
}
const energy=(a,b)=>.5*(a.velocity.x**2+a.velocity.y**2+b.velocity.x**2+b.velocity.y**2);
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} vs ${b}`);

test('Las armas conservan el choque normal y sólo ganan fricción al comenzar el combate',()=>{
  const game=new DuelEngine();game.setMode('versus');
  const measure=dt=>{
    const a=slider(0,{x:.8,y:1}),b=slider(.025,{x:0,y:0});
    game.fighters[0].rig=a;game.fighters[1].rig=b;
    game.resolveWeaponContacts(dt,{project:false});
    return {phase:game.phase,contact:game.lastWeaponContact,relativeX:a.velocity.x-b.velocity.x};
  };
  const waiting=measure(STEP);
  game.start();game.phaseClock=3.2-1.5*STEP;
  const steps=[];
  game.stepPhysics=dt=>steps.push(measure(dt));
  game.update(STEP);game.update(STEP);
  const [countdown,fight]=steps;
  assert.deepEqual([waiting.phase,countdown.phase,fight.phase],['ready','countdown','fight']);
  for(const {contact,relativeX} of [waiting,countdown]){
    assert.ok(contact.impulse>0);
    assert.equal(contact.frictionImpulse,0);
    assert.equal(contact.frictionState,'free');
    assert.equal(contact.slidePower,0);
    close(relativeX,.8);
  }
  assert.ok(fight.contact.impulse>0&&Math.abs(fight.contact.frictionImpulse)>0);
  assert.ok(fight.relativeX<.8);
});

test('El roce transmite impulso tangencial igual y opuesto, acotado y disipativo',()=>{
  const a=slider(0,{x:.8,y:1}),b=slider(.025,{x:0,y:0}),before=energy(a,b);
  const result=resolveWeaponBind(a,b,{dt:1/120,project:false});
  assert.ok(Math.abs(result.frictionImpulse)>0,'Falta la respuesta tangencial del acero');
  assert.ok(Math.abs(result.frictionImpulse)<=WEAPON_BIND.staticFriction*result.impulse+1e-12);
  assert.ok(Math.abs(a.velocity.x-b.velocity.x)<.8);
  close(a.lastImpulse.impulse.x+b.lastImpulse.impulse.x,0);close(a.lastImpulse.impulse.y+b.lastImpulse.impulse.y,0);
  assert.ok(energy(a,b)<=before+1e-10);assert.ok(result.slidePower>=0);
});

test('Adherencia breve y deslizamiento son finitos; fricción cero conserva la libertad tangencial',()=>{
  const a=slider(0,{x:.01,y:1}),b=slider(.025,{x:0,y:0});
  const stuck=resolveWeaponBind(a,b,{project:false});
  assert.equal(stuck.frictionState,'sticking');close(a.velocity.x-b.velocity.x,0);
  const c=slider(0,{x:2,y:1}),d=slider(.025,{x:0,y:0});
  const slip=resolveWeaponBind(c,d,{project:false});
  assert.equal(slip.frictionState,'sliding');assert.ok(c.velocity.x-d.velocity.x>0);
  const e=slider(0,{x:.8,y:1}),f=slider(.025,{x:0,y:0});
  const smooth=resolveWeaponBind(e,f,{project:false,staticFriction:0,dynamicFriction:0});
  assert.equal(smooth.frictionImpulse,0);close(e.velocity.x-f.velocity.x,.8);
});

test('En vuelo libre la inercia de contacto conserva igualdad 1e-8 en ambos ejes',()=>{
  for(const dir of [-1,1]){
    const rig=new ArticulatedRig({dir,baseX:-dir*1.53,gravity:0});rig.q[1]=1.85;
    const d=rig.diagnostics();assert.ok(d.minimumGroundY>TABLE_TOP+.2,'every floor collider is far from contact');
    assert.ok(d.coordinates.every(c=>c.position>c.min+.001&&c.position<c.max-.001),'all coordinate stops are inactive');
    assert.ok(Object.values(rig.pose().feet).every(foot=>!foot.stance&&foot.groundReaction===0));
    const point=rig.pose().mainHand;
    const normal={x:.6,y:.8},tangent={x:-.8,y:.6};
    assert.equal(typeof rig.contactInertia,'function');
    const response=rig.contactInertia({body:'weapon',point,normal});
    assert.ok(response.normal>0&&response.tangent>0&&Number.isFinite(response.cross));
    close(response.normal,rig.effectiveInverseMass({body:'weapon',point,normal}),1e-8);
    close(response.tangent,rig.effectiveInverseMass({body:'weapon',point,normal:tangent}),1e-8);
    assert.ok(response.cross**2<=response.normal*response.tangent+1e-8);
  }
});

test('Un adaptador sin inercia tangencial completa conserva el choque normal sin inventar una respuesta de roce',()=>{
  const a=slider(0,{x:.8,y:1}),b=slider(.025,{x:0,y:0});delete b.contactInertia;
  const before=energy(a,b),result=resolveWeaponBind(a,b,{project:false});
  assert.ok(result.impulse>0);assert.equal(result.frictionImpulse,0);
  close(a.velocity.x-b.velocity.x,.8);assert.ok(energy(a,b)<=before+1e-10);
});

test('El forcejeo real conserva intención, energía y simetría sin desactivar la punta ni regalar daño',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18]){
    const a=new ArticulatedRig({dir,scale,baseX:-dir*1.53*scale,gravity:0}),b=new ArticulatedRig({dir:-dir,scale,baseX:dir*1.53*scale,gravity:0});
    b.q[1]+=.025;a.previousQ=a.q.slice();b.previousQ=b.q.slice();
    const contact=firstWeaponContact(a,b);assert.ok(contact);
    const n=contact.normal,t={x:-n.y,y:n.x};
    a.reactImpulse({body:'weapon',point:contact.pointA,impulse:{x:n.x*.06+t.x*.035,y:n.y*.06+t.y*.035}});
    // Establish the defender's support velocity after its initial vertical
    // placement too, before measuring collision work (as in weapon-bind).
    b.reactImpulse({body:'weapon',point:contact.pointB,impulse:{x:-n.x*.06-t.x*.035,y:-n.y*.06-t.y*.035}});
    const before=a.diagnostics().kineticEnergy+b.diagnostics().kineticEnergy,targets=[Array.from(a.target),Array.from(b.target)];
    const applied=[0,0],predicted=[];
    for(const [i,rig,point] of [[0,a,contact.pointA],[1,b,contact.pointB]]){
      const apply=rig.reactImpulse.bind(rig);
      rig.reactImpulse=options=>{applied[i]++;predicted[i]=rig.trialContactImpulse({...options,normal:n});return apply(options);};
    }
    const result=resolveWeaponBind(a,b,{project:false});
    assert.ok(Number.isFinite(result.frictionImpulse));assert.ok(result.impulse>0);
    assert.ok(Math.abs(result.frictionImpulse)<=WEAPON_BIND.staticFriction*result.impulse+1e-12);
    assert.ok(a.diagnostics().kineticEnergy+b.diagnostics().kineticEnergy<=before+1e-8);
    assert.deepEqual([Array.from(a.target),Array.from(b.target)],targets);
    close(a.lastImpulse.impulse.x+b.lastImpulse.impulse.x,0);close(a.lastImpulse.impulse.y+b.lastImpulse.impulse.y,0);
    assert.deepEqual(applied,[1,1],'bounded trials may apply the final signed total impulse only once per body');
    assert.deepEqual(a.velocity,predicted[0].velocity);assert.deepEqual(b.velocity,predicted[1].velocity);
    assert.ok(result.contactIterations<=8&&result.contactBacktracks<=8);
  }
});
