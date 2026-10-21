import test from 'node:test';
import assert from 'node:assert/strict';
import {ApronHinge,apronPoint} from '../public/physics/apron.js';
import {APRON_GEOMETRY} from '../public/physics/apron-geometry.js';
import {DuelEngine,STEP} from '../public/engine.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
const api=await import('../public/physics/surface-state.js').catch(()=>null);
const pose=()=>({hip:{x:0,y:1,z:0},mainHand:{x:1,y:1,z:.17},bodyFrames:{weapon:{origin:{x:1,y:1},angle:0}}});
test('Sólo un impulso medido deja marca, anclada al cuerpo y con historial acotado',()=>{
  assert.ok(api,'faltan marcas físicas de superficie');const s=new api.SurfaceState(),p=pose();
  const c={body:'weapon',key:'weapon',point:{x:1.5,y:1,z:.17},normal:{x:0,y:1},impulse:0,slideSpeed:2,time:0,dt:1/120};
  s.record(p,c);assert.equal(s.snapshot(p,0).marks.length,0);
  c.impulse=.1;s.record(p,c);const first=s.snapshot(p,0).marks[0];assert.ok(first);assert.ok(first.slideDistance>0);
  p.bodyFrames.weapon.origin.x+=2;p.mainHand.x+=2;assert.ok(Math.abs(s.snapshot(p,1).marks[0].position.x-first.position.x-2)<1e-12);
  for(let i=1;i<60;i++)s.record(p,{...c,time:i*.2,point:{...c.point,x:3.5+i*.001}});
  assert.equal(s.snapshot(p,12).marks.length,24);
  const snapshot=s.snapshot(p,12);snapshot.marks[0].position.x=999;assert.notEqual(s.snapshot(p,12).marks[0].position.x,999);
});
test('El motor registra un impacto físico y resetRound borra sus marcas',()=>{
  const g=new DuelEngine();g.setMode('versus');g.phase='fight';
  for(const f of g.fighters){f.rig=new ArticulatedRig({baseX:-f.dir*1.3,dir:f.dir,gravity:0});f.rig.velocity[4]=4;f.pose=f.rig.pose();}
  g.resolveBodyContacts(STEP);for(const f of g.fighters)g.refreshRigPose(f,STEP);
  assert.ok(g.fighters.some(f=>f.pose.surface?.marks.length>0),'el evento medido debe anclar una marca real');
  assert.deepEqual(g.scores,[0,0]);g.resetRound();assert.ok(g.fighters.every(f=>f.pose.surface.marks.length===0));
});
test('Una proyección XY o agua contenida no moja el delantal: exige parcela libre real dentro del OBB',()=>{
  assert.ok(api,'falta mojado localizado por parcelas');const a=new ApronHinge(),matrix=new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,1,0,1]);
  a.frame=matrix;const p=a.snapshot(),g=APRON_GEOMETRY.normal,b=g.bounds,local=[0,b.max[1]-.01,(b.min[2]+b.max[2])/2],world=apronPoint(matrix,local),drop={x:world[0],y:world[1],z:world[2],r:.006,volume:.001,free:true};
  api.wetApronFromParcels(a,p,[{released:false,particles:[drop]}],1/120);assert.equal(a.wetness.top,0);
  api.wetApronFromParcels(a,p,[{released:true,particles:[{...drop,z:drop.z+2}]}],1/120);assert.equal(a.wetness.top,0);
  const before={...drop};api.wetApronFromParcels(a,p,[{released:true,particles:[drop]}],1/120);
  assert.ok(a.wetness.top>0);assert.equal(a.wetness.bottom,0);assert.deepEqual(drop,before,'el estado óptico no consume ni crea agua');
});
test('El agua altera arrastre del accesorio sin cambiar masa, y seca de forma gradual',()=>{
  const dry=new ApronHinge(),wet=new ApronHinge();assert.ok(wet.wetness,'falta humedad localizada');
  wet.wetness.top=wet.wetness.bottom=1;const frame=new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,2,0,1]);
  for(const a of [dry,wet]){a.angle=.3;a.angularVelocity=1;}
  const mass=wet.mass;dry.advance(1/120,{frame,passive:true,gravity:0});wet.advance(1/120,{frame,passive:true,gravity:0});
  assert.ok(Math.abs(wet.angularVelocity)<Math.abs(dry.angularVelocity));assert.equal(wet.mass,mass);
  assert.ok(wet.wetness.top<1&&wet.wetness.top>.99);assert.ok(wet.snapshot().wetness.top>0);
});
test('Una matriz canónica oblicua no moja por aproximar la distancia de una esquina en espacio local',()=>{
  assert.ok(api);const a=new ApronHinge(),m=new Float64Array([1,0,0,0,1,1,0,0,0,0,1,0,0,2,0,1]);a.frame=m;
  const b=APRON_GEOMETRY.normal.bounds,p=apronPoint(m,[b.max[0]+.01,b.max[1]+.01,(b.min[2]+b.max[2])/2]);
  const parcel={x:p[0],y:p[1],z:p[2],r:.015,volume:.001,free:true};
  api.wetApronFromParcels(a,a.snapshot(),[{released:true,particles:[parcel]}],1/120);
  assert.equal(a.wetness.top,0,'la esfera queda a sqrt(.02²+.01²) de la esquina real, fuera de su radio');
});
test('La captura de una pieza separada conserva marcas propias congeladas en su pose fuente',()=>{
  const r=new ArticulatedRig({gravity:0}),p=r.pose(),s=new api.SurfaceState();
  s.record(p,{body:'weapon',key:'weapon',point:{...p.tip},normal:{x:0,y:1},impulse:.2,time:0});
  const surface=s.snapshot(p,0,r);r.damageJoint('wrist',1,{surface});const source=r.fragments[0].sourcePose;
  assert.equal(source.surface.marks.length,1);assert.ok(Object.isFrozen(source.surface.marks[0].position));
  surface.marks[0].position.x=999;assert.notEqual(source.surface.marks[0].position.x,999);
});
