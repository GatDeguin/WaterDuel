import test from 'node:test';
import assert from 'node:assert/strict';
import {FluidVolume,HEAD_VOLUME} from '../public/physics/fluid.js';
import {BalloonMembrane} from '../public/physics/membrane.js';
const H=1/120,head={x:0,y:2.4,z:0},impact={x:-.422,y:2.4,z:0};
const create=(scale=1,count=200)=>{const f=new FluidVolume(1,count,scale);f.keepContained(head,H,0,0);assert.equal(typeof f.beginLeak,'function','progressive opening flow must be implemented');f.beginLeak({head,impact:{...impact,x:impact.x*scale},attackDir:1,headVelocity:{vx:0,vy:0,vz:0},thrust:.8});return f;};
const advance=(f,n=60,opt={})=>{for(let i=0;i<n;i++)f.advanceLeak(H,{head,apertureArea:.02,pressure:.5,slosh:0,time:0,...opt});return f;};
const xyz=f=>f.particles.map(p=>[p.x,p.y,p.z]);

test('Apertura cero conserva el cap y no integra partículas retenidas como agua libre',()=>{
 const f=create(),before=xyz(f);advance(f,60,{apertureArea:0});
 assert.equal(f.released,true);assert.equal(f.releasedParticles.length,0);assert.equal(f.releasedVolume,0);assert.equal(f.retainedVolume,f.volume);
 assert.equal(f.leakState.steps,60);for(let i=0;i<200;i++)for(let k=0;k<3;k++)assert.ok(Math.abs(xyz(f)[i][k]-before[i][k])<1e-12,'closed opening must not let the free solver move retained parcels');assert.ok(f.retainedParticles.every(p=>p.age===0&&!p.wet));
 assert.equal(f.leakState.flowRate,0);
});

test('El caudal responde a apertura y presión sin cambiar el volumen de las partículas',()=>{
 const small=advance(create(),60,{apertureArea:.01,pressure:0}),large=advance(create(),60,{apertureArea:.04,pressure:0}),pressurized=advance(create(),60,{apertureArea:.01,pressure:1});
 assert.ok(small.releasedVolume>0);assert.ok(large.releasedVolume>small.releasedVolume);assert.ok(pressurized.releasedVolume>small.releasedVolume);
 for(const f of [small,large,pressurized]){
  assert.equal(f.particles.length,200);assert.ok(f.particles.every(p=>p.volume===f.particleVolume));
  assert.ok(Math.abs(f.retainedVolume+f.releasedVolume-HEAD_VOLUME)<1e-12);assert.ok(f.retainedVolume>0);
  assert.ok(f.leakState.budgetVolume>=0&&f.leakState.budgetVolume<f.particleVolume+1e-12);
  assert.ok(Math.abs(f.leakState.dischargedVolume-f.releasedVolume-f.leakState.budgetVolume)<1e-12);
  const all=new Set([...f.retainedParticles,...f.releasedParticles]);assert.equal(all.size,200);assert.equal(f.retainedParticles.length+f.releasedParticles.length,200);
 }
});

test('El nivel retenido desciende y todas sus muestras continúan bajo el mismo plano',()=>{
 const f=advance(create(),90,{apertureArea:.04,pressure:1,slosh:.2});
 assert.ok(f.surfaceFrame.fraction<.65&&f.surfaceFrame.fraction>0);
 const r=f.surfaceFrame.rotation;
 for(const p of f.retainedParticles){const q=[(p.x-head.x)/.392,(p.y-head.y)/.456,p.z/.365];assert.ok(Math.hypot(...q)<=1+1e-10);assert.ok(q[0]*r[1]+q[1]*r[4]+q[2]*r[7]<=f.surfaceFrame.height+1e-10);assert.equal(p.age,0);}
 assert.ok(f.releasedParticles.every(p=>p.age>0));
});

test('El ledger de carga retenida expone COM y tensor por volumen, con escala cúbica',()=>{
 const normal=create(),boss=create(1.16);assert.ok(Math.abs(boss.retainedVolume/normal.retainedVolume-1.16**3)<1e-12);
 const f=advance(normal,60),s=f.retainedMassProperties(),retained=f.retainedParticles;
 assert.equal(s.volume,f.retainedVolume);assert.deepEqual(f.retainedCOM,s.center);
 for(const axis of ['x','y','z']){const expected=retained.reduce((sum,p)=>sum+p[axis]*p.volume,0)/s.volume;assert.ok(Math.abs(s.center[axis]-expected)<1e-12);}
 const q={xx:0,yy:0,zz:0,xy:0,xz:0,yz:0};for(const p of retained){const x=p.x-s.center.x,y=p.y-s.center.y,z=p.z-s.center.z;q.xx+=p.volume*(y*y+z*z);q.yy+=p.volume*(x*x+z*z);q.zz+=p.volume*(x*x+y*y);q.xy-=p.volume*x*y;q.xz-=p.volume*x*z;q.yz-=p.volume*y*z;}
 for(const key of Object.keys(q))assert.ok(Math.abs(q[key]-s.inertia[key])<1e-12);
 assert.ok(s.inertia.xx>0&&s.inertia.yy>0&&s.inertia.zz>0);
});

test('Un reloj de 30 o 120 Hz produce el mismo ledger y posiciones con soporte lineal',()=>{
 const a=create(),b=create();
 for(const [f,n,dt] of [[a,30,1/30],[b,120,H]])for(let i=1;i<=n;i++){const t=i*dt;f.advanceLeak(dt,{head:{x:.3*t,y:2.4+.1*t,z:.05*t},apertureArea:.03,pressure:.6,slosh:.1*t,time:t,headVelocity:{vx:.3,vy:.1,vz:.05}});}
 assert.equal(a.leakState.steps,120);assert.equal(b.leakState.steps,120);assert.equal(a.releasedVolume,b.releasedVolume);assert.equal(a.retainedVolume,b.retainedVolume);
 for(let i=0;i<200;i++)for(const axis of ['x','y','z','vx','vy','vz'])assert.ok(Math.abs(a.particles[i][axis]-b.particles[i][axis])<1e-8,`${i}.${axis}`);
 const before=xyz(a),steps=a.leakState.steps;a.integrate(H);assert.deepEqual(xyz(a),before);assert.equal(a.leakState.steps,steps,'compat integrator must not run a leak twice');
});

test('release mantiene vaciado inmediato y completa un leak sin reimpulsar agua libre',()=>{
 const f=advance(create(),30),free=f.releasedParticles.map(p=>({p,position:[p.x,p.y,p.z],velocity:[p.vx,p.vy,p.vz]}));assert.ok(free.length>0&&free.length<200);
 assert.equal(f.release({head,impact,attackDir:1}),true);assert.equal(f.retainedVolume,0);assert.equal(f.releasedVolume,f.volume);assert.equal(f.releasedParticles.length,200);assert.equal(f.leakState.dischargedVolume,f.volume,'completing a leak records its instantaneous remainder');
 for(const {p,position,velocity} of free){assert.deepEqual([p.x,p.y,p.z],position);assert.deepEqual([p.vx,p.vy,p.vz],velocity);}
 const direct=new FluidVolume(1,200);direct.keepContained(head,H);const positions=xyz(direct);direct.release({head,impact});assert.equal(direct.releasedVolume,direct.volume);assert.deepEqual(xyz(direct),positions);assert.equal(direct.release({head,impact}),false);
});

test('Caudal extremo está acotado, vaciado conserva COM finito y nunca borra partículas',()=>{
 const huge=advance(create(),180,{apertureArea:1,pressure:1e12}),bounded=advance(create(),180,{apertureArea:1,pressure:1});
 assert.deepEqual(xyz(huge),xyz(bounded));assert.equal(huge.retainedVolume,0);assert.equal(huge.releasedVolume,huge.volume);assert.equal(huge.particles.length,200);
 const state=huge.retainedMassProperties();assert.equal(state.volume,0);assert.deepEqual(state.inertia,{xx:0,yy:0,zz:0,xy:0,xz:0,yz:0});assert.ok(Object.values(state.center).every(Number.isFinite));
 assert.ok(huge.particles.every(p=>['x','y','z','vx','vy','vz'].every(k=>Number.isFinite(p[k]))));
});

test('El primer paquete cambia de fase cerca del contacto y mantiene continuidad espacial',()=>{
 const f=create(),before=f.particles.map(p=>({p,x:p.x,y:p.y,z:p.z}));
 // One tick discharges fewer than two parcels, independently of the free solver.
 f.advanceLeak(H,{head,apertureArea:.085,pressure:1,time:0});
 assert.equal(f.releasedParticles.length,1);const parcel=f.releasedParticles[0],old=before.find(p=>p.p===parcel);
 const nearest=Math.min(...before.map(p=>(p.x-impact.x)**2+(p.y-impact.y)**2+(p.z-impact.z)**2));
 assert.ok(Math.abs((old.x-impact.x)**2+(old.y-impact.y)**2+(old.z-impact.z)**2-nearest)<1e-12);
 assert.ok(Math.hypot(parcel.x-old.x,parcel.y-old.y,parcel.z-old.z)<.08,'phase change must not teleport a parcel to the puncture');
 assert.ok(parcel.vx<0,'pressure leaves the left puncture outwards');assert.equal(parcel.age,H);
});

test('Un crédito menor que una partícula se conserva al cerrar y reabrir la abertura',()=>{
 const f=create();f.advanceLeak(H,{head,apertureArea:.01,pressure:1,time:0});const credit=f.leakState.budgetVolume;
 assert.ok(credit>0&&credit<f.particleVolume);assert.equal(f.releasedVolume,0);
 // A boundary observation closes linearly over its interval; then no more credit.
 f.advanceLeak(H,{head,apertureArea:0,pressure:1,time:0});const closed=f.leakState.budgetVolume;
 advance(f,30,{apertureArea:0,pressure:1});assert.equal(f.leakState.budgetVolume,closed);assert.ok(closed>=credit);
 advance(f,30,{apertureArea:.01,pressure:1});assert.ok(f.releasedVolume>0);assert.ok(f.leakState.budgetVolume<f.particleVolume);
});

test('La pérdida de soporte libera exceso sin depender del orificio ni perder volumen',()=>{
 const f=create(),capacity=.07;f.advanceLeak(H,{head,apertureArea:0,pressure:0,containmentCapacity:capacity,time:0});
 assert.ok(f.retainedVolume<=capacity+1e-12&&capacity-f.retainedVolume<f.particleVolume+1e-12);
 assert.ok(f.releasedVolume>0);assert.equal(f.leakState.orificeVolume,0);assert.equal(f.leakState.supportLossVolume,f.releasedVolume);
 assert.ok(Math.abs(f.retainedVolume+f.releasedVolume-f.volume)<1e-12);assert.equal(f.particles.length,200);
 assert.ok(f.releasedParticles.every(p=>p.age===H));assert.ok(f.particles.every(p=>p.volume===f.particleVolume));
 const nearest=f.particles.map((p,i)=>({p,i})).sort((a,b)=>{const pa=a.p,pb=b.p;return (pa.lx+.422)**2+pa.ly**2+pa.lz**2-((pb.lx+.422)**2+pb.ly**2+pb.lz**2);});
 assert.ok(nearest.slice(0,10).some(({p})=>p.free),'loss releases nearby finite parcels rather than deleting volume');
});

test('Una capacidad variable lineal conserva reloj, ledger y posiciones a 30 y 120 Hz',()=>{
 const a=create(),b=create();
 // Both callers observe the same initial capacity before it starts shrinking.
 for(const f of [a,b])f.advanceLeak(H,{head,apertureArea:0,pressure:0,containmentCapacity:f.volume,time:0});
 for(const [f,n,dt] of [[a,30,1/30],[b,120,H]])for(let i=1;i<=n;i++){const t=i*dt;f.advanceLeak(dt,{head,apertureArea:0,pressure:0,containmentCapacity:f.volume*(1-.8*t),time:t});}
 assert.equal(a.retainedVolume,b.retainedVolume);assert.equal(a.leakState.supportLossVolume,b.leakState.supportLossVolume);assert.equal(a.leakState.orificeVolume,0);
 assert.ok(a.retainedVolume<=a.volume*.2+1e-12&&a.volume*.2-a.retainedVolume<a.particleVolume+1e-12);
 for(let i=0;i<200;i++)for(const axis of ['x','y','z','vx','vy','vz'])assert.ok(Math.abs(a.particles[i][axis]-b.particles[i][axis])<1e-8,`${i}.${axis}`);
});

test('Capacidad cero cancela sólo crédito no emitido y conserva razones separadas de descarga',()=>{
 const f=advance(create(),30,{apertureArea:.01,pressure:1}),oldOrifice=f.releasedVolume;
 assert.ok(f.leakState.budgetVolume>0);f.advanceLeak(H,{head,apertureArea:0,pressure:0,containmentCapacity:0,time:0});
 assert.equal(f.retainedVolume,0);assert.equal(f.releasedVolume,f.volume);assert.equal(f.leakState.budgetVolume,0);
 assert.ok(f.leakState.orificeVolume>=oldOrifice);assert.ok(f.leakState.supportLossVolume>0);
 assert.ok(Math.abs(f.leakState.orificeVolume+f.leakState.supportLossVolume-f.releasedVolume)<1e-12);
 assert.ok(Math.abs(f.leakState.dischargedVolume-f.releasedVolume)<1e-12);
});

test('Una capacidad discreta del solver compartido se aplica en su tick con dt=.0025',()=>{
 const m=new BalloonMembrane(),f=create();m.attach(head);m.puncture({point:impact,incoming:{x:1,y:0,z:0}});
 for(let i=0;i<4;i++){
  m.advance(.0025,{head,waterVolume:f.retainedVolume,waterFrame:f.surfaceFrame});
  f.advanceLeak(.0025,{head,apertureArea:0,pressure:0,containmentCapacity:m.state.containmentCapacity,capacityMode:'step',time:0});
  assert.ok(f.retainedVolume<=m.state.containmentCapacity+f.particleVolume+1e-12,'a new discrete skin state must not be interpolated with an older state at the shared tick');
 }
 assert.equal(m.steps,1);assert.equal(f.leakState.steps,1);assert.ok(f.leakState.supportLossVolume>0);
});
