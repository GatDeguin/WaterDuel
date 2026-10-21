import test from 'node:test';
import assert from 'node:assert/strict';
import {FluidVolume,HEAD_VOLUME,WATER_DENSITY} from '../public/physics/fluid.js';
import {buildFluidSurface,latexMesh} from '../public/physics/surfaces.js';
import * as waterSurfaces from '../public/physics/surfaces.js';
import {containedWaterFrame,TABLE_TOP} from '../public/physics/dimensions.js';
const head={x:0,y:2.4,z:0};
const meshVolume=mesh=>{
  let volume=0;
  for(let i=0;i<mesh.p.length;i+=9){const p=mesh.p,a=i,b=i+3,c=i+6;volume+=(p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])+p[a+1]*(p[b+2]*p[c]-p[b]*p[c+2])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;}
  return volume;
};
test('El ledger interior representa un llenado del 65% y no un elipsoide completo',()=>{
  const full=(4/3)*Math.PI*.392*.456*.365;
  assert.ok(Math.abs(HEAD_VOLUME/full-.65)<1e-12);
  for(const [count,scale] of [[200,1],[260,1.16]]){
    const f=new FluidVolume(1,count,scale),volume=full*.65*scale**3;
    assert.ok(Math.abs(f.volume-volume)<1e-12);
    assert.ok(f.particles.every(p=>Math.abs(p.volume-volume/count)<1e-12));
  }
});
test('Todas las partículas confinadas están dentro del mismo cap y bajo el plano libre que oscila',()=>{
  for(const [count,scale] of [[200,1],[260,1.16]]){
   const f=new FluidVolume(1,count,scale),volume=f.volume;
   for(const slosh of [-.35,0,.35]){
    f.keepContained(head,1/120,slosh,1.2);
    const frame=f.surfaceFrame;assert.ok(frame?.rotation?.length===9,'shared liquid frame is required');
    const r=frame.rotation;
    for(const p of f.particles){
      const q=[(p.x-head.x)/(.392*scale),(p.y-head.y)/(.456*scale),p.z/(.365*scale)];
      assert.ok(Math.hypot(...q)<=1+1e-10,'particle must stay inside the liquid ellipsoid');
      assert.ok(q[0]*r[1]+q[1]*r[4]+q[2]*r[7]<=frame.height+1e-10,'particle must stay below its free plane');
    }
    assert.equal(f.particles.length,count);assert.equal(f.volume,volume);
   }
  }
});
test('Varios niveles legales coinciden con integración independiente de secciones y volumen cerrado',()=>{
  const full=(4/3)*Math.PI*.392*.456*.365;
  for(const fraction of [.2,.4,.65,.85]){
    const frame=containedWaterFrame(0,0,fraction),steps=2000,dy=(frame.height+1)/steps;
    let integral=0;
    for(let i=0;i<steps;i++){const y=-1+(i+.5)*dy;integral+=Math.PI*(1-y*y)*dy;}
    assert.ok(Math.abs(integral/(4*Math.PI/3)-fraction)<1e-6,'level must match independent slice integration');
    const mesh=waterSurfaces.containedWaterMesh(head,{frame,quality:'high'});
    assert.ok(Math.abs(meshVolume(mesh)/(full*fraction)-1)<.025);
  }
});
test('El agua interior es una malla cerrada de volumen contable, normales exteriores y giro estable',()=>{
  assert.equal(typeof waterSurfaces.containedWaterMesh,'function');
  for(const quality of ['eco','high','ultra'])for(const scale of [1,1.16]){
    const f=new FluidVolume(1,200,scale),volumes=[];
    for(const slosh of [0,.3]){
      f.keepContained(head,1/120,slosh,.8);
      const mesh=waterSurfaces.containedWaterMesh(head,{quality,scale,frame:f.surfaceFrame}),edges=new Map();
      assert.ok(mesh.surface.p.length>0 && mesh.meniscus.p.length>0,'free surface and meniscus must be real geometry');
      assert.ok(mesh.p.every(Number.isFinite)&&mesh.n.every(Number.isFinite));
      const volume=meshVolume(mesh);assert.ok(volume>0&&Math.abs(volume/f.volume-1)<.025,`${quality}: geometry/ledger mismatch ${volume/f.volume}`);volumes.push(volume);
      for(const part of [mesh.surface,mesh.meniscus])for(let i=0;i<part.p.length;i+=3){
        const q=[(part.p[i]-head.x)/(.392*scale),(part.p[i+1]-head.y)/(.456*scale),part.p[i+2]/(.365*scale)],r=f.surfaceFrame.rotation;
        assert.ok(Math.abs(q[0]*r[1]+q[1]*r[4]+q[2]*r[7]-f.surfaceFrame.height)<1e-10,'free surface must use the same liquid plane');
      }
      for(let i=0;i<mesh.p.length;i+=9){
        const p=mesh.p,a=p.slice(i,i+3),u=p.slice(i+3,i+6).map((v,k)=>v-a[k]),v=p.slice(i+6,i+9).map((x,k)=>x-a[k]);
        const face=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
        assert.ok(face.reduce((s,n,k)=>s+n*mesh.n[i+k],0)>0,'face orientation must agree with its exterior normal');
        const keys=[0,3,6].map(k=>p.slice(i+k,i+k+3).map(x=>(Math.abs(x)<5e-8?0:x).toFixed(7)).join(','));
        for(const [a,b] of [[0,1],[1,2],[2,0]]){const key=[keys[a],keys[b]].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}
      }
      assert.ok([...edges.values()].every(n=>n===2),'closed volume must have no holes or doubled seams');
    }
    assert.ok(Math.abs(volumes[0]-volumes[1])<1e-10,'slosh rotation must conserve geometry volume');
  }
});
test('Liberar el cap oscilante conserva posiciones, cantidad y ledger',()=>{
  const f=new FluidVolume(1,200);f.keepContained(head,1/120,.3,1);
  const before=f.particles.map(p=>[p.x,p.y,p.z]),volume=f.volume;
  f.release({head,impact:{x:-.422,y:2.4,z:0},attackDir:1});
  assert.deepEqual(f.particles.map(p=>[p.x,p.y,p.z]),before);assert.equal(f.volume,volume);
  for(let i=0;i<120;i++)f.integrate(1/120);
  assert.equal(f.volume,volume);assert.equal(f.particles.length,200);
});
test('La reconstrucción al liberar conserva volumen del cap y responde al volumen individual',()=>{
  for(const quality of ['eco','high','ultra'])for(const [count,scale,slosh] of [[200,1,0],[260,1.16,.24]]){
    const f=new FluidVolume(1,count,scale);f.keepContained(head,1/120,slosh,.8);
    const cap=waterSurfaces.containedWaterMesh(head,{quality,scale,frame:f.surfaceFrame});
    const free=buildFluidSurface(f.particles,{quality}),half=buildFluidSurface(f.particles.map(p=>({...p,volume:p.volume/2})),{quality});
    assert.equal(free.stats.budgetReached,false,'release cap must fit the mesh budget');
    assert.ok(Math.abs(meshVolume(free)/f.volume-1)<.02,`${quality}: surface must reconstruct ledger, not add kernel volume`);
    assert.ok(Math.abs(meshVolume(free)/meshVolume(cap)-1)<.04,`${quality}: no inflated volume on release`);
    assert.ok(Math.abs(meshVolume(half)/meshVolume(free)-.5)<.02,'particle volume must affect the reconstructed solid at fixed coordinates');
  }
});
test('Las gotas aisladas conservan su volumen en distintas fases XYZ sin depender de gotas remotas',()=>{
  const volume=HEAD_VOLUME/200;
  for(const quality of ['eco','high','ultra'])for(let i=0;i<4;i++){
    const cloud=[{x:-3.7,y:.35,z:-1.31,volume},{x:3.7-i*.047,y:3.292826086956522+i*.039,z:1.1280434782608698-i*.051,volume:volume/2}];
    const mesh=buildFluidSurface(cloud,{quality});
    assert.equal(mesh.stats.budgetReached,false);
    assert.ok(Math.abs(meshVolume(mesh)/(1.5*volume)-1)<.02,`${quality}: sparse liquid volume depends on grid phase`);
    for(const drop of cloud)assert.ok(mesh.p.some((v,k)=>k%3===0&&Math.abs(v-drop.x)<.15),'each finite-volume drop must remain represented');
  }
});
test('El campo líquido cierra y conserva volumen contra suelo y paredes del dominio real',()=>{
  const volume=HEAD_VOLUME/200,domain={floor:TABLE_TOP,bounds:3.7,depth:1.31};
  for(const quality of ['eco','high','ultra'])for(const drop of [
    {x:0,y:TABLE_TOP+.024,z:0,volume},
    {x:3.7,y:TABLE_TOP+.024,z:1.31,volume}
  ]){
    const mesh=buildFluidSurface([drop],{quality,domain});
    assert.equal(mesh.stats.budgetReached,false);
    for(let i=0;i<mesh.p.length;i+=3){
      assert.ok(mesh.p[i+1]>=TABLE_TOP-1e-8,'visible liquid must not penetrate floor');
      assert.ok(Math.abs(mesh.p[i])<=3.7+1e-8&&Math.abs(mesh.p[i+2])<=1.31+1e-8,'visible liquid must stay inside side planes');
    }
    assert.ok(Math.abs(meshVolume(mesh)/volume-1)<.02,'closing contact planes must not delete liquid volume');
    const edges=new Map();for(let i=0;i<mesh.p.length;i+=9){const keys=[0,3,6].map(k=>mesh.p.slice(i+k,i+k+3).map(v=>v.toFixed(7)).join(','));for(const [a,b]of [[0,1],[1,2],[2,0]]){const key=[keys[a],keys[b]].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}}
    assert.ok([...edges.values()].every(count=>count===2),'floor-wall intersections must be closed with matching edge subdivisions');
  }
});
test('Los contactos de partículas usan radio volumétrico sin depender del perfil visual',()=>{
  const f=new FluidVolume(1,200),radius=Math.cbrt(3*f.particles[0].volume/(4*Math.PI));
  f.released=true;for(const p of f.particles){p.x=3.7;p.y=TABLE_TOP;p.z=1.31;p.vx=p.vy=p.vz=0;}
  f.integrate(1/120);
  for(const p of f.particles){assert.ok(p.y>=TABLE_TOP+radius-1e-10);assert.ok(p.x<=3.7-radius+1e-10);assert.ok(p.z<=1.31-radius+1e-10);}
});
const released=({velocity={vx:0,vy:0,vz:0},impact={x:-.4,y:2.4,z:0},count=200}={})=>{
  const f=new FluidVolume(1,count);f.keepContained(head,1/120,0,0);
  f.release({head,impact,attackDir:1,headVelocity:velocity,thrust:.8});return f;
};
test('El fluido consume el tiempo completo y converge entre llamadas de 30 y 120 Hz',()=>{
  const coarse=released(),fine=released();
  for(let i=0;i<30;i++)coarse.integrate(1/30);
  for(let i=0;i<120;i++)fine.integrate(1/120);
  assert.ok(Math.abs(coarse.elapsed-1)<1e-10,'a 30 Hz caller must not lose simulation time');
  for(let i=0;i<coarse.count;i++)for(const axis of ['x','y','z'])
    assert.ok(Math.abs(coarse.particles[i][axis]-fine.particles[i][axis])<.002,`particle ${i}, ${axis}`);
});
test('La liberación hereda el momento de la cabeza en los tres ejes',()=>{
  const still=released(),moving=released({velocity:{vx:1.2,vy:-.4,vz:.8}});
  const a=still.stats().momentum,b=moving.stats().momentum,mass=HEAD_VOLUME*WATER_DENSITY;
  for(const [axis,v] of [['x',1.2],['y',-.4],['z',.8]])
    assert.ok(Math.abs((b[axis]-a[axis])/mass-v)<1e-9,axis);
});
test('La liberación conserva velocidades y momento internos de dos sloshes que llegan al mismo cap',()=>{
  const make=previous=>{const f=new FluidVolume(1,200);f.keepContained(head,1/120,previous,0);f.keepContained(head,1/120,0,0);return f;};
  const a=make(.003),b=make(-.003),beforeA=a.particles.map(p=>[p.vx,p.vy,p.vz]),beforeB=b.particles.map(p=>[p.vx,p.vy,p.vz]);
  const momentumDelta=a.stats().momentum.x-b.stats().momentum.x;
  assert.ok(Math.abs(momentumDelta)>10,'fixture must carry different internal momentum before puncture');
  assert.deepEqual(a.particles.map(p=>[p.x,p.y,p.z]),b.particles.map(p=>[p.x,p.y,p.z]),'both histories end at exactly the same positions');
  const volume=a.volume;
  for(const f of [a,b])f.release({head,impact:{x:-.422,y:2.4,z:0},attackDir:1,headVelocity:{vx:0,vy:0,vz:0}});
  for(let i=0;i<a.count;i++)for(const [axis,k] of [['vx',0],['vy',1],['vz',2]])
    assert.ok(Math.abs((a.particles[i][axis]-b.particles[i][axis])-(beforeA[i][k]-beforeB[i][k]))<1e-10,'pressure must add to, not erase, internal velocity');
  assert.ok(Math.abs((a.stats().momentum.x-b.stats().momentum.x)-momentumDelta)<1e-8);
  assert.equal(a.volume,volume);assert.equal(b.volume,volume);
});
test('El transporte del soporte no se suma dos veces al heredar el slosh',()=>{
  const make=translation=>{const f=new FluidVolume(1,200);f.keepContained({x:head.x-translation[0]/120,y:head.y-translation[1]/120,z:head.z-translation[2]/120},1/120,0,0);f.keepContained(head,1/120,0,0);return f;};
  // The sampled support velocity deliberately exceeds the head-velocity clamp.
  // Removing the clamped metadata instead of the raw transport would leak motion.
  const still=make([0,0,0]),moving=make([20,-10,12]),inherited={vx:1.2,vy:-.4,vz:.8};
  still.release({head,impact:{x:-.422,y:2.4,z:0},headVelocity:{vx:0,vy:0,vz:0}});
  moving.release({head,impact:{x:-.422,y:2.4,z:0},headVelocity:inherited});
  for(let i=0;i<200;i++)for(const axis of ['vx','vy','vz'])
    assert.ok(Math.abs(moving.particles[i][axis]-still.particles[i][axis]-inherited[axis])<1e-10,'inherit head translation exactly once');
});
test('La herencia interna limita saltos extremos sin descartar su dirección ni producir energía ilimitada',()=>{
  const make=previous=>{const f=new FluidVolume(1,200);f.keepContained(head,1/120,previous,0);f.keepContained(head,1/120,-.35,0);return f;};
  const extreme=make(.35),still=make(-.35);
  const raw=extreme.particles.map(p=>[p.vx,p.vy,p.vz]);
  assert.ok(Math.max(...extreme.particles.map(p=>Math.hypot(p.vx,p.vy,p.vz)))>20);
  for(const f of [extreme,still])f.release({head,impact:{x:-.422,y:2.4,z:0},headVelocity:{vx:0,vy:0,vz:0}});
  const inherited=extreme.particles.map((p,i)=>Math.hypot(p.vx-still.particles[i].vx,p.vy-still.particles[i].vy,p.vz-still.particles[i].vz));
  assert.ok(Math.max(...inherited)>6.9,'saturated slosh must still contribute motion');
  assert.ok(Math.max(...inherited)<=7.000000001,'relative slosh speed is bounded as one vector');
  for(let i=0;i<extreme.count;i++){
    const delta=['vx','vy','vz'].map(k=>extreme.particles[i][k]-still.particles[i][k]);
    const dot=delta.reduce((s,v,k)=>s+v*raw[i][k],0)/(Math.hypot(...delta)*Math.hypot(...raw[i]));
    assert.ok(dot>1-1e-10,'vector limiting must preserve the direction of internal motion');
  }
  assert.ok(extreme.particles.every(p=>['vx','vy','vz'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=14)));
});
test('Perforar en lados opuestos cambia el flujo y conserva el líquido sin borrar partículas',()=>{
  const left=released(),right=released({impact:{x:.4,y:2.4,z:0}});
  const mean=f=>f.particles.reduce((s,p)=>s+p.vx,0)/f.count;
  assert.ok(mean(right)-mean(left)>1,'the puncture must direct the mean exit flow');
  for(const f of [left,right]){
    const volume=f.particles.reduce((s,p)=>s+p.volume,0);
    for(let i=0;i<240;i++)f.integrate(1/120);
    assert.equal(f.count,f.particles.length);assert.ok(Math.abs(f.volume-volume)<1e-10);
    assert.ok(f.particles.every(p=>['x','y','z','vx','vy','vz'].every(k=>Number.isFinite(p[k]))));
    assert.ok(f.particles.every(p=>p.y>=.3485-1e-9));
  }
});
test('La superficie incluye ambos extremos de una nube extensa en todos los perfiles',()=>{
  const f=released();const cloud=f.particles.map((p,i)=>({...p,x:p.lx*.2+(i%2?3.35:-3.35),y:2+p.ly*.2,z:p.lz*.2}));
  for(const quality of ['eco','high','ultra']){
    const mesh=buildFluidSurface(cloud,{quality}),xs=mesh.p.filter((_,i)=>i%3===0);
    assert.ok(Math.min(...xs)<-3.2 && Math.max(...xs)>3.2,`${quality}: no cropped cloud end`);
    assert.ok(mesh.p.every(Number.isFinite));
  }
  for(const quality of ['eco','high','ultra']){
    const mesh=buildFluidSurface([{x:-3.7,y:.35,z:0},{x:3.7,y:.35,z:0}],{quality});
    const xs=mesh.p.filter((_,i)=>i%3===0);
    assert.ok(Math.min(...xs)<-3.6 && Math.max(...xs)>3.6,`${quality}: isolated arena-edge drops remain visible`);
  }
});
test('Las gotas separadas en XYZ del árbitro no desaparecen por fase de muestreo',()=>{
  const fixtures=[
    [{x:-3.7,y:.35,z:-1.31},{x:3.7,y:3.292826086956522,z:1.1280434782608698}],
    [{x:-3.7,y:.35,z:-1.31},{x:3.7,y:3.25,z:1.21}]
  ];
  for(const quality of ['eco','high','ultra'])for(const cloud of fixtures){
    const mesh=buildFluidSurface(cloud,{quality});
    for(const drop of cloud){
      const near=[];
      for(let i=0;i<mesh.p.length;i+=3)if(Math.hypot(mesh.p[i]-drop.x,mesh.p[i+1]-drop.y,mesh.p[i+2]-drop.z)<.3)near.push(i);
      assert.ok(near.length>=12,`${quality}: isolated drop ${JSON.stringify(drop)} disappeared`);
    }
  }
});
test('Una gota conserva superficie al trasladarse a fases distintas dentro de la arena',()=>{
  for(const quality of ['eco','high','ultra'])for(let i=0;i<12;i++){
    const a={x:-3.7,y:.35,z:-1.31},b={x:2.8+i*.073,y:.7+i*.207,z:-.95+i*.183};
    const mesh=buildFluidSurface([a,b],{quality});
    assert.ok(mesh.p.some((v,k)=>k%3===0&&Math.abs(v-b.x)<.25),`${quality}, phase ${i}: second drop disappeared`);
  }
});
test('El presupuesto de triángulos de superficie es un límite estricto',()=>{
  const f=released();
  for(const maxTriangles of [1,7,19])assert.ok(buildFluidSurface(f.particles,{quality:'high',maxTriangles}).p.length/9<=maxTriangles);
});
test('Una gota reconstruida tiene normales exteriores y una malla cerrada sin quads cruzados',()=>{
  for(const quality of ['eco','high','ultra']){
    const mesh=buildFluidSurface([{x:0,y:0,z:0}],{quality}),edges=new Map();
    assert.ok(mesh.p.length>0);
    for(let i=0;i<mesh.p.length;i+=3){
      assert.ok(mesh.p[i]*mesh.n[i]+mesh.p[i+1]*mesh.n[i+1]+mesh.p[i+2]*mesh.n[i+2]>0,`${quality}: outward liquid normal`);
    }
    for(let i=0;i<mesh.p.length;i+=9){
      const vertices=[0,3,6].map(k=>mesh.p.slice(i+k,i+k+3).map(v=>v.toFixed(7)).join(','));
      for(const [a,b] of [[0,1],[1,2],[2,0]]){
        const key=[vertices[a],vertices[b]].sort().join('|');edges.set(key,(edges.get(key)||0)+1);
      }
    }
    assert.ok([...edges.values()].every(count=>count===2),`${quality}: every edge belongs to exactly two triangles`);
  }
});
test('Las normales del globo intacto apuntan hacia fuera y respetan z=0',()=>{
  for(const quality of ['eco','high','ultra'])for(const scale of [1,1.16]){
    const mesh=latexMesh(head,{time:0,quality,scale});
    for(let i=0;i<mesh.p.length;i+=3){
      const dot=(mesh.p[i]-head.x)*mesh.n[i]+(mesh.p[i+1]-head.y)*mesh.n[i+1]+mesh.p[i+2]*mesh.n[i+2];
      assert.ok(dot>0,'outward-facing membrane normal');
    }
    for(let i=0;i<mesh.p.length;i+=9){
      const a=mesh.p.slice(i,i+3),u=mesh.p.slice(i+3,i+6).map((v,k)=>v-a[k]),v=mesh.p.slice(i+6,i+9).map((x,k)=>x-a[k]);
      const face=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      assert.ok(face.reduce((s,n,k)=>s+n*mesh.n[i+k],0)>0,'triangle winding must agree with the exterior normal');
    }
  }
  const mesh=latexMesh(head,{time:0});
  const shifted=latexMesh({...head,z:.2},{time:0});
  for(let i=2;i<mesh.p.length;i+=3)assert.ok(Math.abs(shifted.p[i]-mesh.p[i]-.2)<1e-10,'zero z is not a missing coordinate');
});
test('La rotura temprana comienza junto a la punción y luego se propaga',()=>{
  const impact={x:-.422,y:2.4,z:0};
  const early=latexMesh(head,{burstAge:.005,impact,tearAngle:Math.PI});
  // A remote patch on the opposite side must initially retain its sealed shape.
  const opposite=[];
  for(let i=0;i<early.p.length;i+=3)if(early.p[i]>.25 && Math.abs(early.p[i+1]-head.y)<.2)opposite.push(early.p.slice(i,i+3));
  assert.ok(opposite.length>0);
  for(const [x,y,z] of opposite){const radius=Math.hypot(x/.422,(y-head.y)/.506,z/.397);assert.ok(Math.abs(radius-1)<.025,'tear must not open all panels immediately');}
  const left=latexMesh(head,{burstAge:.12,impact,tearAngle:Math.PI});
  const right=latexMesh(head,{burstAge:.12,impact:{x:.422,y:2.4,z:0},tearAngle:0});
  assert.notDeepEqual(left.p,right.p);
});
test('Los paneles de látex hacen contacto con las tablas durante toda su caída visible',()=>{
  for(const age of [.1,.5,1,1.4,1.549]){
    const mesh=latexMesh({x:0,y:1.2,z:0},{burstAge:age,impact:{x:-.422,y:1.2,z:0}});
    for(let i=1;i<mesh.p.length;i+=3)assert.ok(mesh.p[i]>=.3245,`age ${age}: membrane penetrated the stage at ${mesh.p[i]}`);
  }
});
test('La punción local permanece anclada cuando se traslada el soporte después de romperse',()=>{
  const f=released({impact:{x:-.422,y:2.4,z:0}});
  const options={burstAge:.12,impact:f.impact,localImpact:f.localImpact};
  const a=latexMesh(head,options),b=latexMesh({...head,x:1.1,y:2,z:.4},options);
  for(let i=0;i<a.p.length;i++){
    const offset=[1.1,-.4,.4][i%3];
    assert.ok(Math.abs(b.p[i]-a.p[i]-offset)<1e-9,'support translation must not rotate or deform the tear');
  }
});
