import test from 'node:test';
import assert from 'node:assert/strict';
import {FluidVolume} from '../public/physics/fluid.js';
import {waterDropRadius} from '../public/physics/dimensions.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {fluidSolidColliders,resolveLiquidSolid} from '../public/physics/fluid-solids.js';
const axes=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}];
const board=(extra={})=>({center:{x:0,y:1,z:0},axes,half:[.3,.003,.3],...extra});
test('La consulta geométrica de CCD conserva cada prisma bit a bit sin calcular Jacobianos',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const weapon of ['sword','spear','axe','maul']){
    const r=new ArticulatedRig({dir,scale});r.equipment={weapon,defense:'none'};r.twoHanded=weapon==='maul';r.gripOffset=r.twoHanded?.22:0;
    r.swordLength=1.69;r.previousSwordLength=1.03;r.previousQ=r.q.slice();
    for(let i=0;i<r.q.length;i++)r.q[i]=Math.max(r.limits[i][0],Math.min(r.limits[i][1],r.q[i]+.13*Math.sin(i+2)));
    for(const t of [0,.13,.5,.88,1]){
      const all=r.collisionPanelsAt(t);assert.deepEqual(r.collisionGeometryAt(t),all);
      for(const panel of all)assert.deepEqual(r.collisionGeometryAt(t,panel.key),[panel]);
    }
  }
});
function drop(position,velocity){
  const f=new FluidVolume(1,1,.03),head={x:0,y:2,z:0};f.keepContained(head,1/120);
  f.release({head,impact:{x:0,y:2,z:0},attackDir:1});Object.assign(f.particles[0],position,velocity);return f;
}
test('Una gota rápida no atraviesa una duela fina y conserva todo su volumen',()=>{
  const f=drop({x:0,y:1.08,z:0},{vx:.4,vy:-14,vz:.2}),volume=f.volume,p=f.particles[0],radius=waterDropRadius(p.volume);
  f.integrate(1/120,{floor:0,solidColliders:[board()]});
  assert.ok(p.y>=1.003+radius-1e-7,`drop at ${p.y}`);assert.ok(p.vy>=0);assert.equal(f.volume,volume);assert.equal(f.count,1);
});
test('La profundidad y la rotación del cuerpo importan en el contacto de agua',()=>{
  const miss=drop({x:0,y:1.08,z:.6},{vx:0,vy:-14,vz:0});miss.integrate(1/120,{floor:0,solidColliders:[board()]});
  assert.ok(miss.particles[0].y<1);
  const q=Math.SQRT1_2,tilted=board({axes:[{x:q,y:q,z:0},{x:-q,y:q,z:0},{x:0,y:0,z:1}]});
  const hit=drop({x:-.05,y:1.05,z:0},{vx:7,vy:-7,vz:0});hit.integrate(1/120,{floor:0,solidColliders:[tilted]});
  const p=hit.particles[0];assert.ok((-p.x+p.y-1)*q>waterDropRadius(p.volume));
  assert.ok(p.vy>0&&p.vx<0,'normal inclinada desvía el flujo');
});
test('El agua recibe velocidad de la superficie móvil y no transmite masa ficticia al rig',()=>{
  const f=drop({x:0,y:1.08,z:0},{vx:0,vy:-14,vz:0});
  f.integrate(1/120,{floor:0,solidColliders:[board({velocityAt:()=>({vx:0,vy:2,vz:0})})]});
  assert.ok(f.particles[0].vy>=2);assert.equal(f.particles[0].age,1/120);
});
test('El arco de una lanza a velocidad legal encuentra una gota aunque ambos extremos estén libres',()=>{
  for(const direction of [-1,1])for(const scale of [1,1.18]){
    const r=new ArticulatedRig({gravity:0,scale});r.equipment={weapon:'spear',defense:'none'};
    r.swordLength=1.69;r.previousSwordLength=1.69;
    const mid=r.pose(),u={x:(mid.tip.x-mid.mainHand.x)/1.69,y:(mid.tip.y-mid.mainHand.y)/1.69};
    const point={x:mid.mainHand.x+u.x*1.58,y:mid.mainHand.y+u.y*1.58,z:.177};
    r.q[13]=-direction*.055;r.previousQ=r.q.slice();r.q[13]=direction*.055;r.velocity[13]=direction*.11/(1/120);
    const f=new FluidVolume(1,200),parcel={...point,vx:0,vy:0,vz:0,volume:f.particleVolume},before={...parcel};
    resolveLiquidSolid(parcel,point,waterDropRadius(parcel.volume),1/120,fluidSolidColliders([{rig:r}]));
    assert.ok(Math.hypot(parcel.x-before.x,parcel.y-before.y,parcel.z-before.z)>1e-5||Math.hypot(parcel.vx,parcel.vy,parcel.vz)>1e-5,'el acero móvil transmite contacto');
    assert.equal(parcel.volume,before.volume);
  }
});
test('Trasladar juntos agua y arma con separación no produce rebote ni contacto ficticio',()=>{
  const r=new ArticulatedRig({gravity:0});r.equipment={weapon:'spear',defense:'none'};r.swordLength=1.69;r.previousSwordLength=1.69;
  const p=r.pose(),u={x:(p.tip.x-p.mainHand.x)/1.69,y:(p.tip.y-p.mainHand.y)/1.69};
  const from={x:p.mainHand.x+u.x*1.58-u.y*.12,y:p.mainHand.y+u.y*1.58+u.x*.12,z:.177};
  r.previousQ=r.q.slice();r.q[0]+=.04;r.q[1]+=.02;r.velocity[0]=.04/(1/120);r.velocity[1]=.02/(1/120);
  const f=new FluidVolume(1,200),parcel={x:from.x+.04,y:from.y+.02,z:from.z,vx:4.8,vy:2.4,vz:0,volume:f.particleVolume},before={...parcel};
  resolveLiquidSolid(parcel,from,waterDropRadius(parcel.volume),1/120,fluidSolidColliders([{rig:r}]));assert.deepEqual(parcel,before);
});
test('Una gota fuera de la capa Z de una lanza rotatoria conserva todo su avance libre',()=>{
  const r=new ArticulatedRig({gravity:0});r.equipment={weapon:'spear',defense:'none'};r.swordLength=1.69;r.previousSwordLength=1.69;
  const p=r.pose(),u={x:(p.tip.x-p.mainHand.x)/1.69,y:(p.tip.y-p.mainHand.y)/1.69},f=new FluidVolume(1,200),radius=waterDropRadius(f.particleVolume);
  const from={x:p.mainHand.x+u.x*1.58,y:p.mainHand.y+u.y*1.58,z:.177+.017+radius+.005};
  r.q[13]=-.055;r.previousQ=r.q.slice();r.q[13]=.055;r.velocity[13]=13.2;
  const parcel={...from,x:from.x+1/120,vx:1,vy:0,vz:0,volume:f.particleVolume},before={...parcel};
  resolveLiquidSolid(parcel,from,radius,1/120,fluidSolidColliders([{rig:r}]));assert.deepEqual(parcel,before);
});

test('Mover muñeca y cuello no detiene una gota paralela a la madera inmóvil del brazo superior',()=>{
  const r=new ArticulatedRig({gravity:0});r.previousQ=r.q.slice();r.q[13]+=.11;r.q[12]+=.10;
  const panels=r.collisionPanels(),index=panels.findIndex(p=>p.key==='mainUpper'),p=panels[index],radius=.005;
  const half=Math.max(...p.vertices.map(v=>Math.abs((v.x-p.center.x)*p.axes[1].x+(v.y-p.center.y)*p.axes[1].y)));
  const from={x:p.center.x+p.axes[1].x*(half+radius+.0005),y:p.center.y+p.axes[1].y*(half+radius+.0005),z:p.z};
  const parcel={x:from.x+p.axes[0].x*.04,y:from.y+p.axes[0].y*.04,z:from.z,vx:p.axes[0].x*4.8,vy:p.axes[0].y*4.8,vz:0,volume:1e-5},before={...parcel};
  resolveLiquidSolid(parcel,from,radius,1/120,[fluidSolidColliders([{rig:r}])[index]]);
  assert.deepEqual(parcel,before,'los grados de libertad que no son ancestros de esta pieza no crean una colisión ni agotan el barrido');
});

test('La envolvente barrida contiene todos los vértices de cada cuerpo con arcos amplios, jefe y extensión',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const weapon of ['sword','spear','axe','maul']){
    const r=new ArticulatedRig({dir,scale});r.equipment={weapon,defense:'none'};r.twoHanded=weapon==='maul';r.gripOffset=r.twoHanded?.22:0;
    r.collapse();r.previousQ=r.q.slice();r.previousSwordLength=.65;r.swordLength=1.94;
    for(let i=0;i<r.q.length;i++)r.q[i]=Math.max(r.limits[i][0],Math.min(r.limits[i][1],r.q[i]+.8*Math.sin(1+i*1.3)));
    const solids=fluidSolidColliders([{rig:r}]);
    for(let tick=0;tick<=40;tick++)for(const [index,p]of r.collisionGeometryAt(tick/40).entries()){
      const b=solids[index].bounds;
      for(const vertex of p.vertices)for(const key of ['x','y'])assert.ok(vertex[key]>=b.min[key]-1e-10&&vertex[key]<=b.max[key]+1e-10,`${weapon} ${dir} ${scale} ${p.key} ${key} t${tick}`);
      assert.ok(p.z-p.depth/2>=b.min.z-1e-10&&p.z+p.depth/2<=b.max.z+1e-10);
    }
  }
});

test('El arco compuesto del brazo y muñeca conserva contacto con agua estacionaria en ambos lados y escalas',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18]){
    const r=new ArticulatedRig({dir,scale,gravity:0});r.equipment={weapon:'spear',defense:'none'};r.swordLength=1.69;r.previousSwordLength=1.69;
    r.previousQ=r.q.slice();for(const i of [3,4,5,13])r.previousQ[i]-=.045;for(const i of [3,4,5,13]){r.q[i]+=.045;r.velocity[i]=10.8;}
    const middle=r.collisionGeometryAt(.5,'weapon')[0],extent=Math.max(...middle.vertices.map(v=>(v.x-middle.center.x)*middle.axes[0].x+(v.y-middle.center.y)*middle.axes[0].y));
    const at={x:middle.center.x+middle.axes[0].x*extent*.85,y:middle.center.y+middle.axes[0].y*extent*.85,z:middle.z};
    const parcel={...at,vx:0,vy:0,vz:0,volume:1e-7},before={...parcel},index=r.collisionPanels().findIndex(p=>p.key==='weapon');
    resolveLiquidSolid(parcel,at,.002,1/120,[fluidSolidColliders([{rig:r}])[index]]);
    assert.ok(Math.hypot(parcel.x-before.x,parcel.y-before.y)>1e-5||Math.hypot(parcel.vx,parcel.vy)>1e-5);assert.equal(parcel.volume,before.volume);
  }
});

test('Una cara que rota casi tangente conserva avance libre cuando todo el intervalo está separado',()=>{
  const radius=.005,at={x:0,y:1+.003+radius+.000013,z:0},parcel={...at,vx:0,vy:0,vz:0,volume:1e-5},before={...parcel};
  const solid=board({motion:{centerBound:.000001,angleRate:.11,halfBound:0,translation:{x:0,y:0,z:0},angularBound:0,centerExtension:0},motionAt:t=>{
    const a=-.055+.11*t,c=Math.cos(a),s=Math.sin(a);return board({axes:[{x:c,y:s,z:0},{x:-s,y:c,z:0},{x:0,y:0,z:1}]});
  }});
  resolveLiquidSolid(parcel,at,radius,1/120,[solid]);assert.deepEqual(parcel,before,'agotar avances conservadores no debe inventar un impacto contra una cara separada');
});
