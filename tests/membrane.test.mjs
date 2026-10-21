import test from 'node:test';
import assert from 'node:assert/strict';
import * as physics from '../public/physics/membrane.js';
import {HEAD_VOLUME} from '../public/physics/fluid.js';
import {BALLOON_RADII,TABLE_TOP} from '../public/physics/dimensions.js';
import {DuelEngine} from '../public/engine.js';
const head={x:0,y:2.4,z:.025},options={head,waterVolume:HEAD_VOLUME,slosh:0};
const create=config=>{assert.equal(typeof physics.BalloonMembrane,'function','native XPBD membrane must be implemented');return new physics.BalloonMembrane(config);};
const run=(m,n=120,dt=1/120,opt=null)=>{for(let i=0;i<n;i++)m.advance(dt,opt??{...options,waterVolume:m.punctured?0:HEAD_VOLUME});return m;};
const puncture=(m,x=-1)=>m.puncture({point:{x:x*BALLOON_RADII.x,y:head.y,z:head.z},incoming:{x:-x,y:0,z:0},impulse:1});
const positions=m=>m.mesh().p;
function volume(mesh){let sum=0,p=mesh.p;for(let i=0;i<p.length;i+=9)sum+=(p[i]*(p[i+4]*p[i+8]-p[i+5]*p[i+7])+p[i+1]*(p[i+5]*p[i+6]-p[i+3]*p[i+8])+p[i+2]*(p[i+3]*p[i+7]-p[i+4]*p[i+6]))/6;return sum;}
test('La membrana geodésica es cerrada, finita, exterior y usa dimensiones compartidas',()=>{
 for(const subdivisions of [2,3]){
  const m=create({subdivisions});m.attach(head);const mesh=m.mesh({smooth:0}),s=m.stats(),edges=new Map();
  assert.equal(s.nodes,subdivisions===2?162:642);assert.equal(s.faces,subdivisions===2?320:1280);
  assert.ok(mesh.p.every(Number.isFinite)&&mesh.n.every(Number.isFinite));assert.ok(volume(mesh)>0);
  for(let i=0;i<mesh.p.length;i+=3){const x=mesh.p[i]-head.x,y=mesh.p[i+1]-head.y,z=mesh.p[i+2]-head.z;assert.ok(Math.abs(Math.hypot(x/.422,y/.506,z/.397)-1)<1e-10);assert.ok(x*mesh.n[i]+y*mesh.n[i+1]+z*mesh.n[i+2]>0);}
  for(let i=0;i<mesh.p.length;i+=9){const p=mesh.p,keys=[0,3,6].map(k=>p.slice(i+k,i+k+3).map(x=>(Math.abs(x)<1e-10?0:x).toFixed(8)).join(','));for(const[a,b]of[[0,1],[1,2],[2,0]]){const key=[keys[a],keys[b]].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}}
  assert.ok([...edges.values()].every(n=>n===2));
 }
});
test('El suavizado interpola la piel simulada sin añadir nodos ni pasos físicos',()=>{
 const m=create();m.attach(head);const raw=m.mesh({smooth:0}),before=m.stats(),smooth=m.mesh({smooth:1});
 assert.equal(smooth.p.length,raw.p.length*4);assert.equal(m.stats().nodes,before.nodes);assert.equal(m.stats().steps,0);
 assert.ok(Math.abs(volume(smooth)/volume(raw)-1)<.04,'render interpolation stays close to simulated skin volume');
 assert.ok(smooth.p.every(Number.isFinite)&&smooth.n.every(Number.isFinite));
});
test('XPBD sostiene volumen con pretensión y conserva masa al cambiar escala',()=>{
 const a=create(),b=create({scale:1.16});a.attach(head);b.attach(head);
 const mass=a.stats().mass,volume0=a.stats().volume;run(a,240);
 const s=a.stats();assert.ok(s.elasticEnergy>0&&s.volumeLambda!==0);assert.ok(Math.abs(s.volume/volume0-1)<.08);assert.equal(s.mass,mass);assert.ok(Math.abs(b.stats().mass/mass-1.16**2)<1e-10);
});
test('Un contacto leve abolla localmente sin abrir conexiones y produce respuesta energética',()=>{
 // Work is measured at the impulse on initially stationary material. Later
 // kinetic energy alone can fall as contact work becomes elastic energy.
 const a=create(),b=create();a.attach(head);b.attach(head);const point={x:-.422,y:head.y,z:head.z},energy=b.stats().kineticEnergy;
 b.contact({point,incoming:{x:1,y:0,z:0},strength:.3});assert.ok(b.stats().kineticEnergy>energy);
 const moving=b.nodes.filter(p=>Math.hypot(p.vx,p.vy,p.vz)>0);assert.ok(moving.length>0);
 assert.ok(moving.every(p=>Math.hypot(p.x-point.x,p.y-point.y,p.z-point.z)<.19),'impulse must stay near observed contact');
 run(a,3);run(b,3);assert.equal(b.stats().punctured,false);assert.equal(b.stats().brokenEdges,0);assert.notDeepEqual(positions(a),positions(b));
});
test('La punción cambia conectividad junto al contacto sin eliminar masa de látex',()=>{
 const m=create();m.attach(head);const mass=m.stats().mass,before=m.mesh();puncture(m);
 const s=m.stats();assert.equal(s.punctured,true);assert.ok(s.brokenEdges>0&&s.boundaryEdges>0);assert.ok(s.nodes>162);assert.equal(s.mass,mass);assert.equal(s.faces,320);assert.equal(m.mesh().p.length,before.p.length);
 assert.ok(Math.abs(s.localImpact.x+.422)<1e-10);assert.ok(s.fractureOrigins.every(p=>p.x<0),'initial connectivity change is local to the puncture');
});
test('Liberar pretensión retrae la superficie y dos contactos generan respuestas diferentes',()=>{
 const left=create(),right=create();left.attach(head);right.attach(head);run(left,30);run(right,30);const initialArea=left.stats().area;
 puncture(left,-1);puncture(right,1);run(left,30);run(right,30);
 assert.notDeepEqual(positions(left),positions(right));assert.ok(left.stats().area<initialArea*.98);assert.ok(left.stats().kineticEnergy>0);assert.ok(left.stats().fractureEvents>=1);
});
test('La membrana permanece finita y conserva masa en soporte móvil y contra el piso',()=>{
 const m=create();m.attach(head);const mass=m.stats().mass;puncture(m);
 for(let i=0;i<300;i++)m.advance(1/120,{...options,head:{x:.2*Math.sin(i/30),y:1.0,z:.025}});
 const mesh=m.mesh();assert.ok(mesh.p.every(Number.isFinite)&&mesh.n.every(Number.isFinite));assert.equal(m.stats().mass,mass);
 for(let i=1;i<mesh.p.length;i+=3)assert.ok(mesh.p[i]>=TABLE_TOP-1e-9);
});
test('El reloj fijo converge entre llamadas de 30 y 120 Hz',()=>{
 const a=create(),b=create();a.attach(head);b.attach(head);puncture(a);puncture(b);run(a,30,1/30);run(b,120,1/120);
 assert.equal(a.stats().steps,120);assert.equal(b.stats().steps,120);assert.deepEqual(positions(a),positions(b));assert.equal(a.stats().mass,b.stats().mass);
});
test('El desgarro se propaga por strain junto a la grieta y disminuye la tensión almacenada',()=>{
 const normal=create(),strong=create({tearStrain:4});normal.attach(head);strong.attach(head);run(normal,120);run(strong,120);
 const originalFaces=normal.faces.map(f=>{const ids=[f.a,f.b,f.c],center={x:0,y:0,z:0};for(const id of ids)for(const axis of ['x','y','z'])center[axis]+=normal.nodes[id].ref[axis]/3;return {ids,center};});
 const before=normal.stats().elasticEnergy;puncture(normal);puncture(strong);run(normal,120);run(strong,120);
 assert.ok(normal.stats().fractureEvents>1,'a loaded puncture must propagate beyond the initial face');
 assert.equal(strong.stats().fractureEvents,1,'higher tensile failure threshold must suppress propagation');
 assert.ok(normal.stats().elasticEnergy<before*.3);
 assert.ok(Math.abs(normal.stats().nodeMassSum-normal.stats().mass)<1e-12,'separating material partitions, rather than deletes, mass');
 const cutNodes=new Set();for(const [i,p] of normal.stats().fractureOrigins.entries()){
  const face=originalFaces.find(f=>Math.hypot(f.center.x-p.x,f.center.y-p.y,f.center.z-p.z)<1e-10);assert.ok(face,'damage must identify real material faces');
  if(i===0)assert.ok(p.x<-.2,'initial cut must stay at the left contact');
  else assert.ok(face.ids.some(id=>cutNodes.has(id)),'new damage must share material nodes with the existing crack');
  for(const id of face.ids)cutNodes.add(id);
 }
});
test('Engine transmite penetración real a la membrana sin exigir bandera ni umbral de estocada',()=>{
 const game=new DuelEngine();game.phase='fight';const [a,b]=game.fighters;
 assert.ok(a.membrane instanceof physics.BalloonMembrane);assert.ok(b.membrane instanceof physics.BalloonMembrane);
 const h=b.pose.head;a.lunge=.21;a.previousTip={x:h.x-.8,y:h.y,z:.17};a.pose={...a.pose,tip:{x:h.x+.8,y:h.y,z:.17}};
 game.detectHits();assert.equal(b.membrane.stats().punctured,true);assert.equal(b.globIntact,false);assert.deepEqual(game.scores,[1,0]);
 a.lunge=.8;game.detectHits();assert.deepEqual(game.scores,[1,0],'la penetración se resuelve una sola vez');
 assert.ok(b.membrane.stats().localImpact.x<0,'entry side of the competitive sweep must reach native topology');
});
test('La apertura expone presión de restricción y mantiene carga del agua que todavía queda dentro',()=>{
 const m=create();m.attach(head);run(m,120);const mass=m.stats().mass;
 assert.ok(m.state,'membrane must expose an opening/pressure state');assert.ok(m.state.pressure>0);puncture(m);
 assert.ok(m.ruptured&&m.state.apertureArea>0&&m.state.pressureAtPuncture>0);
 m.advance(1/120,{...options,waterVolume:HEAD_VOLUME/2});
 assert.ok(Math.abs(m.stats().addedWaterMass-HEAD_VOLUME*.15)<1e-12,'rupture does not erase the inertia of retained water');
 m.advance(1/120,{...options,waterVolume:0});assert.equal(m.stats().addedWaterMass,0);assert.equal(m.stats().mass,mass);
});

test('La capacidad isoperimétrica usa solamente piel principal y escala con volumen',()=>{
 const m=create();m.attach(head);puncture(m);const before=m.state;
 assert.ok(before.mainSkinArea>0&&before.containmentCapacity>0,'opening state must expose remaining support area and capacity');
 assert.ok(Math.abs(before.containmentCapacity-before.mainSkinArea**1.5/(6*Math.sqrt(Math.PI)))<1e-12);
 const fragmentNodes=new Set(m.faces.filter(f=>f.fragment).flatMap(f=>[f.a,f.b,f.c]));
 for(const i of fragmentNodes){m.nodes[i].x*=20;m.nodes[i].y*=20;m.nodes[i].z*=20;}
 assert.equal(m.state.mainSkinArea,before.mainSkinArea,'detached material cannot count as retaining skin');
 const mainNodes=new Set(m.faces.filter(f=>!f.fragment).flatMap(f=>[f.a,f.b,f.c]));
 for(const i of mainNodes){const p=m.nodes[i];p.x=head.x+(p.x-head.x)*.5;p.y=head.y+(p.y-head.y)*.5;p.z=head.z+(p.z-head.z)*.5;}
 assert.ok(Math.abs(m.state.mainSkinArea/before.mainSkinArea-.25)<1e-12);assert.ok(Math.abs(m.state.containmentCapacity/before.containmentCapacity-.125)<1e-12);
});

test('La pretensión material retrae una punción fresca y estabilizada hasta perder soporte de agua',()=>{
 for(const settle of [0,100]){
  const m=create();m.attach(head);run(m,settle);const initialArea=m.state.mainSkinArea,mass=m.stats().mass;
  puncture(m);run(m,120,1/120,{...options,waterVolume:HEAD_VOLUME});
  assert.ok(m.state.mainSkinArea<initialArea*.55,'empty skin must retract substantially, not retain 85% inflated rest radius');
  assert.ok(m.state.containmentCapacity<HEAD_VOLUME*.8,'physical skin retraction must force support loss without bypassing the leak');
  assert.ok(m.stats().fractureEvents>1);assert.ok(Math.abs(m.stats().nodeMassSum-mass)<1e-12);assert.equal(m.stats().mass,mass);
  assert.ok(m.mesh().p.every(Number.isFinite)&&m.mesh().n.every(Number.isFinite));
 }
});
