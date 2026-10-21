import test from 'node:test';
import assert from 'node:assert/strict';
import {BalloonMembrane} from '../public/physics/membrane.js';
import {propagateEnergyFracture} from '../public/physics/membrane-fracture.js';

const head={x:0,y:2.4,z:.025};
function opened(toughness=.003){
 const m=new BalloonMembrane({fractureModel:'energy',fractureToughness:toughness});m.attach(head);
 m.puncture({point:{x:-.422,y:2.4,z:.025},incoming:{x:1,y:0,z:0},impulse:1});return m;
}
test('La propagación energética conserva material y contabiliza trabajo de fractura positivo',()=>{
 const m=opened(),mass=m.stats().mass;
 for(let i=0;i<120;i++)m.advance(1/120,{head,waterVolume:0});
 const s=m.stats();assert.equal(s.fracture.model,'energy');assert.ok(s.fractureEvents>1);
 assert.ok(s.fracture.dissipatedEnergy>0);assert.ok(Number.isFinite(s.elasticEnergy+s.kineticEnergy));
 assert.ok(Math.abs(s.nodeMassSum-mass)<1e-12);assert.equal(s.mass,mass);
 assert.equal(s.faces,320);assert.ok(m.nodes.every(p=>[p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite)));
});
test('Aumentar la tenacidad impide propagar aunque exista una punción y pretensión',()=>{
 const soft=opened(),tough=opened(1e6);
 for(let i=0;i<60;i++)for(const m of [soft,tough])m.advance(1/120,{head,waterVolume:0});
 assert.ok(soft.stats().fractureEvents>1);assert.equal(tough.stats().fractureEvents,1);
 assert.equal(tough.stats().fracture.dissipatedEnergy,0);
});
test('El reloj de fractura y su energía coinciden para llamadas de 30 y120Hz',()=>{
 const a=opened(),b=opened();
 for(let i=0;i<30;i++)a.advance(1/30,{head,waterVolume:0});
 for(let i=0;i<120;i++)b.advance(1/120,{head,waterVolume:0});
 assert.deepEqual(a.stats(),b.stats());assert.deepEqual(a.mesh(),b.mesh());
});
test('Abrir material paga exactamente energía mecánica y conserva momento lineal',()=>{
 const m=opened();for(const p of m.nodes){p.vx=p.ref.x*10;p.vy=p.ref.y*10;p.vz=p.ref.z*10;}
 const momentum=()=>m.nodes.reduce((s,p)=>[s[0]+p.mass*p.vx,s[1]+p.mass*p.vy,s[2]+p.mass*p.vz],[0,0,0]);
 const before=m.stats(),P=momentum();assert.ok(propagateEnergyFracture(m)>0);const after=m.stats();
 assert.ok(Math.abs(before.elasticEnergy-after.elasticEnergy)<1e-10,'particionar nodos no duplica energía de resortes');
 assert.ok(Math.abs(before.kineticEnergy-after.kineticEnergy-after.fracture.dissipatedEnergy)<1e-10);
 momentum().forEach((v,i)=>assert.ok(Math.abs(v-P[i])<1e-12));
});
test('Trasladar una grieta cargada sin movimiento relativo no puede financiar más desgarro',()=>{
 const m=opened();for(const p of m.nodes){p.vx=3;p.vy=-2;p.vz=1;}
 assert.equal(propagateEnergyFracture(m),0);assert.equal(m.stats().fractureEvents,1);
 assert.equal(m.stats().fracture.dissipatedEnergy,0);
});
