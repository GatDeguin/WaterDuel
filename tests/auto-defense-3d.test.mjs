import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoDefense} from '../public/auto-defense.js';
import {DuelEngine} from '../public/engine.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';

const DT=1/120,input=()=>({lean:0,mainX:0,mainY:0,offX:0,offY:0,wrist:0,thrust:false,guard:false});
const defender=(slot=1)=>({slot,dir:slot===1?1:-1,globIntact:true,balloonSize:1,lunge:0,lungeCool:0,guardEnergy:1,guardBroken:false,
  equipment:{weapon:'sword',defense:'short'},pose:{head:{x:0,y:2.6,z:.025},offShoulder:{x:slot===1?-.4:.4,y:2,z:-.11}}});
function moving(f,{x=.7*f.dir,y=2.6,z=.17,vx=-3.6*f.dir,vy=0,vz=0}={}){
  return {pose:{tip:{x,y,z}},previousTip:{x:x-vx*DT,y:y-vy*DT,z:z-vz*DT}};
}
function run(f,target,{seed=5,steps=100}={}){
  const assist=new AutoDefense({seed}),outputs=[];
  for(let i=0;i<steps;i++)outputs.push(assist.update(f,target,input(),DT));
  return {assist,outputs,first:outputs.findIndex(c=>c.guard)};
}

test('la asistencia anticipa puntas que entran desde profundidad, incluso con aproximación sólo Z',()=>{
  for(const slot of [1,2])for(const onlyZ of [false,true]){
    const f=defender(slot),target=moving(f,{x:onlyZ?0:.7*f.dir,vx:onlyZ?0:-3.6*f.dir,z:.8,vz:-3.6});
    const before=structuredClone({f,target}),result=run(f,target);
    assert.ok(result.first>=0,`${slot}/${onlyZ}: la trayectoria XYZ observada requiere un intento`);
    assert.deepEqual({f,target},before,'sólo produce intención; no desplaza cuerpo, arma o recursos');
  }
});

test('una proyección XY amenazante que se aleja en Z no provoca guardia',()=>{
  for(const slot of [1,2]){
    const f=defender(slot),result=run(f,moving(f,{z:.25,vz:3.6}));
    assert.equal(result.first,-1);assert.equal(result.assist.snapshot().episode,0);
    assert.equal(run(f,moving(f,{z:1.5})).first,-1,'un plano lejano y paralelo tampoco amenaza');
  }
});

test('la predicción usa el movimiento observado de la propia cabeza al entrar o salir del plano',()=>{
  const escaping=defender();escaping.previousHead={x:0,y:2.6,z:.025-8*DT};
  assert.equal(run(escaping,moving(escaping,{x:.9})).first,-1,'la cabeza ya sale del corredor de la punta');
  const entering=defender();entering.pose.head.z=.8;entering.previousHead={x:0,y:2.6,z:.8+4*DT};
  assert.ok(run(entering,moving(entering)).first>=0,'la cabeza observada entra al plano del arma');
});

test('un cruce oblicuo cercano al borde respeta los radios XYZ distintos del globo',()=>{
  const rx=BALLOON_RADII.x+.18,rz=BALLOON_RADII.z+.10,q=Math.SQRT1_2*.9999;
  for(const slot of [1,2]){
    const f=defender(slot),target=moving(f,{x:f.dir*rx*(q+.3),z:.025+rz*(-q+.3),vx:-f.dir*rx*3,vz:-rz*3});
    assert.ok(run(f,target).first>=0,'el mínimo debe evaluarse en espacio normalizado por radio');
  }
});

test('una finta abandonada antes de reaccionar no dispara desde una observación antigua',()=>{
  const f=defender(),assist=new AutoDefense({seed:5}),target=moving(f);
  for(let i=0;i<14;i++)assert.equal(assist.update(f,target,input(),DT).guard,false);
  const retreat=moving(f,{vx:3.6*f.dir});
  for(let i=0;i<60;i++)assert.equal(assist.update(f,retreat,input(),DT).guard,false);
});

test('retomar la amenaza después de una finta requiere otra observación sostenida sin volver a sortear',()=>{
  const f=defender(),assist=new AutoDefense({seed:5}),target=moving(f),retreat=moving(f,{vx:3.6});
  for(let i=0;i<14;i++)assist.update(f,target,input(),DT);
  const initial=assist.snapshot();for(let i=0;i<12;i++)assist.update(f,retreat,input(),DT);
  let first=-1;for(let i=0;i<50;i++){const c=assist.update(f,target,input(),DT);if(c.guard&&first<0)first=i;}
  assert.ok(first*DT>=initial.reaction);assert.equal(assist.snapshot().random,initial.random);assert.equal(assist.snapshot().episode,1);
});

test('daño del brazo defensivo demora y reduce intentos sin eliminar la posibilidad de fallar sano',()=>{
  let healthy=0,damaged=0,common=0;
  for(let seed=1;seed<=100;seed++){
    const f=defender(),hurt=defender();hurt.pose.joints={offShoulder:{damage:.8},offElbow:{damage:.6}};
    const a=run(f,moving(f),{seed}),b=run(hurt,moving(hurt),{seed});
    if(a.first>=0)healthy++;if(b.first>=0)damaged++;
    if(a.first>=0&&b.first>=0){assert.ok((b.first-a.first)*DT>=.10);common++;}
  }
  assert.ok(healthy>=60&&healthy<=80);assert.ok(damaged>0&&damaged<healthy);assert.ok(common>0);
});

test('la topología y el daño reales del rig dominan la copia visual y la pérdida del brazo impide asistencia',()=>{
  const g=new DuelEngine(),f=g.fighters[0],target=moving(f,{x:f.pose.head.x+.7,y:f.pose.head.y});
  f.pose.head={x:0,y:2.6,z:.025};f.pose.offShoulder={x:-.4,y:2,z:-.11};
  f.rig.damageJoint('offElbow',.8);f.pose.joints={offElbow:{damage:0}};
  const hurt=run(f,moving(f)),healthy=run(defender(),moving(defender()));
  assert.ok(hurt.first<0||hurt.first>healthy.first,'no ignora el daño real por una pose visual antigua');
  f.rig.damageJoint('offElbow',.2);assert.equal(f.rig.isBodyAttached('offForearm'),false);
  assert.equal(run(f,target).first,-1);
});

test('daño durante la reacción usa el mismo sorteo y nunca prolonga la duración máxima de una guardia iniciada',()=>{
  const f=defender(),assist=new AutoDefense({seed:5}),target=moving(f);let first=-1,last=-1;
  for(let i=0;i<12;i++)assist.update(f,target,input(),DT);
  const random=assist.snapshot().random;f.pose.joints={offElbow:{damage:.35}};
  for(let i=12;i<150;i++){
    const c=assist.update(f,target,input(),DT);
    if(c.guard){if(first<0){first=i;f.pose.joints.offElbow.damage=.9;}last=i;}
  }
  assert.ok(first>=run(defender(),moving(defender())).first+4);assert.ok((last-first)*DT<=.8+DT);assert.equal(assist.snapshot().random,random);
  f.pose.joints.offElbow.detached=true;assert.equal(assist.update(f,target,input(),DT).guard,false);
});

test('observaciones XYZ no finitas no producen controles inválidos; dt rechazado no consume estado',()=>{
  for(const component of ['x','y','z'])for(const owner of ['tip','previousTip','head','previousHead']){
    const f=defender(),target=moving(f);f.previousHead={...f.pose.head};
    const object=owner==='tip'?target.pose.tip:owner==='previousTip'?target.previousTip:owner==='head'?f.pose.head:f.previousHead;
    object[component]=NaN;assert.equal(run(f,target).first,-1);
  }
  const assist=new AutoDefense({seed:5}),f=defender(),before=assist.snapshot(),control=input();
  for(const dt of [NaN,0,-1,.1])assert.strictEqual(assist.update(f,moving(f),control,dt),control);
  assert.deepEqual(assist.snapshot(),before);
});

test('XYZ y daño conservan decisiones por semilla, omiten botones futuros y respetan controles manuales',()=>{
  const f=defender(),a=new AutoDefense({seed:5}),b=new AutoDefense({seed:5}),target=moving(f,{z:.8,vz:-3.6});
  f.pose.joints={offElbow:{damage:.3}};
  for(let i=0;i<100;i++)assert.deepEqual(a.update(f,target,input(),DT),b.update(f,{...target,controller:{thrust:true,guard:true},lunge:1,ai:{state:'attack'}},input(),DT));
  assert.deepEqual(a.snapshot(),b.snapshot());
  const manual={...input(),offX:-.4,offY:.1,guard:true},committed={...input(),attackHeld:true};
  assert.strictEqual(a.update(f,target,manual,DT),manual);assert.strictEqual(a.update(f,target,committed,DT),committed);
});
