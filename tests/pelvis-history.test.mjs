import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {fluidSolidColliders,resolveLiquidSolid} from '../public/physics/fluid-solids.js';
import {WATER_DROP_UNIT_VOLUME} from '../public/physics/dimensions.js';

test('El historial de prismas coincide con rigs configurados realmente en cada coordenada interpolada',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18]){
    const r=new ArticulatedRig({dir,scale,gravity:0});r.previousQ=r.q.slice();r.previousQ[0]-=.04;r.previousQ[1]-=.02;r.previousQ[2]=-.055;
    r.q[0]+=.02;r.q[1]+=.01;r.q[2]=.055;
    for(const t of [0,.13,.5,.88,1]){
      const oracle=new ArticulatedRig({dir,scale,gravity:0});oracle.q=Float64Array.from(r.q,(value,i)=>r.previousQ[i]*(1-t)+value*t);
      const actual=oracle.collisionPanels();
      assert.deepEqual(r.collisionGeometryAt(t),actual,`geometry dir${dir} scale${scale} t${t}`);
      assert.deepEqual(r.collisionPanelsAt(t),actual,`full dir${dir} scale${scale} t${t}`);
      assert.deepEqual(r.collisionGeometryAt(t,'pelvis'),actual.filter(p=>p.key==='pelvis'));
    }
  }
});

test('La pelvis a velocidad legal toca la gota del contraejemplo con ambos extremos libres',()=>{
  const angle=.055,dt=1/120,radius=.002;
  for(const dir of [-1,1])for(const scale of [1,1.18]){
    const make=q=>{const r=new ArticulatedRig({dir,scale,gravity:0});r.q[2]=q;r.previousQ=r.q.slice();return r;};
    const r=make(angle);r.previousQ[2]=-angle;r.velocity[2]=2*angle/dt;
    const point={x:r.q[0]+dir*.1595,y:r.q[1]+.1345,z:0};
    const gap=p=>Math.max(...p.axes.map(axis=>{
      const h=Math.max(...p.vertices.map(v=>Math.abs((v.x-p.center.x)*axis.x+(v.y-p.center.y)*axis.y)));
      return Math.abs((point.x-p.center.x)*axis.x+(point.y-p.center.y)*axis.y)-h-radius;
    }));
    for(const q of [-angle,angle])assert.ok(gap(make(q).collisionPanels().find(p=>p.key==='pelvis'))>0,'los extremos reales están libres');
    assert.ok(gap(make(0).collisionPanels().find(p=>p.key==='pelvis'))<0,'la geometría intermedia real atraviesa la gota');
    const parcel={...point,vx:0,vy:0,vz:0,volume:WATER_DROP_UNIT_VOLUME*radius**3},before={...parcel};
    resolveLiquidSolid(parcel,point,radius,dt,fluidSolidColliders([{rig:r}]).filter(s=>s.key==='pelvis'));
    assert.ok(Math.hypot(parcel.x-before.x,parcel.y-before.y)>1e-5||Math.hypot(parcel.vx,parcel.vy)>1e-5,'el contacto histórico debe desviar posición o velocidad');
    assert.equal(parcel.volume,before.volume);
  }
});
