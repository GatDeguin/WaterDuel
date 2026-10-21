import test from 'node:test';
import assert from 'node:assert/strict';
import {FluidVolume} from '../public/physics/fluid.js';
const api=await import('../public/physics/capillary-contact.js').catch(()=>({}));
const skin=()=>({version:1,scale:1,nodes:[{x:-1,y:0,z:-1,ref:{y:-.5},mass:.01,vx:0,vy:0,vz:0},{x:0,y:0,z:1,ref:{y:-.5},mass:.01,vx:0,vy:0,vz:0},{x:1,y:0,z:-1,ref:{y:-.5},mass:.01,vx:0,vy:0,vz:0}],faces:[{a:0,b:1,c:2,fragment:false}]});
function setup(y=.0105){assert.equal(typeof api.buildCapillarySurface,'function');assert.equal(typeof api.applyCapillaryContact,'function');const membrane=skin(),surface=api.buildCapillarySurface(membrane),p={x:0,y,z:0,vx:0,vy:0,vz:0,volume:1e-9};return {membrane,surface,p};}
test('La capilaridad requiere piel real próxima: no genera halos ni cambia volumen',()=>{
 const {surface,p}=setup(.02),before={...p};assert.equal(api.applyCapillaryContact(p,surface,1/120,{radius:.01}).contact,false);assert.deepEqual(p,before);
 const f=setup();const v=f.p.volume,result=api.applyCapillaryContact(f.p,f.surface,1/120,{radius:.01});
 assert.equal(result.contact,true);assert.ok(f.p.vy<0);assert.equal(f.p.volume,v);assert.equal(result.zone,'neck');
});
test('El impulso capilar tiene reacción sobre nodos y un presupuesto interfacial finito',()=>{
 const {membrane,surface,p}=setup(),density=997,mass=p.volume*density;
 const energy=()=>mass*(p.vx**2+p.vy**2+p.vz**2)/2+membrane.nodes.reduce((s,n)=>s+n.mass*(n.vx**2+n.vy**2+n.vz**2)/2,0);
 let cap=0;for(let i=0;i<100;i++){const r=api.applyCapillaryContact(p,surface,1/120,{radius:.01});cap=Math.max(cap,r.capacity);}
 const momentum=mass*p.vy+membrane.nodes.reduce((s,n)=>s+n.mass*n.vy,0);
 assert.ok(Math.abs(momentum)<1e-12);assert.ok(energy()<=cap+1e-12);assert.ok(Number.isFinite(energy()));
});
test('Piel desconectada o zonas lisas fuera del cuello no crean adhesión invisible',()=>{
 const m=skin();m.faces[0].fragment=true;const p={x:0,y:.0105,z:0,vx:0,vy:0,vz:0,volume:1e-9};
 assert.equal(api.applyCapillaryContact(p,api.buildCapillarySurface(m),1/120,{radius:.01}).contact,false);
 const smooth=skin();for(const n of smooth.nodes)n.ref.y=.5;
 assert.equal(api.applyCapillaryContact(p,api.buildCapillarySurface(smooth),1/120,{radius:.01}).contact,false);
});
test('Un pliegue cóncavo fuera del cuello usa las dos caras materiales reales',()=>{
 const membrane=skin();membrane.nodes=[[-1,1,0],[0,0,-1],[0,0,1],[1,1,0]].map(([x,y,z])=>({x,y,z,ref:{y:.5},mass:.01,vx:0,vy:0,vz:0}));membrane.faces=[{a:0,b:2,c:1},{a:3,b:1,c:2}];
 const surface=api.buildCapillarySurface(membrane),p={x:-1/3+.0105/Math.SQRT2,y:1/3+.0105/Math.SQRT2,z:0,vx:0,vy:0,vz:0,volume:1e-9};
 assert.equal(surface.triangleCount,2);assert.equal(api.applyCapillaryContact(p,surface,1/120,{radius:.01}).zone,'fold');
});
test('La integración de agua lejana es idéntica y conserva masa y número de parcelas',()=>{
 const a=new FluidVolume(1,16),b=new FluidVolume(1,16),membrane=skin();for(const n of membrane.nodes)n.y=-10;
 for(const f of [a,b])f.release({head:{x:0,y:3,z:0},impact:{x:-.422,y:3,z:0},attackDir:1,thrust:0});
 const volume=a.volume;for(let i=0;i<12;i++){a.integrate(1/120);b.integrate(1/120,{capillarySurface:api.buildCapillarySurface(membrane)});}
 assert.deepEqual(a.particles,b.particles);assert.equal(b.particles.length,16);assert.equal(b.volume,volume);
});
