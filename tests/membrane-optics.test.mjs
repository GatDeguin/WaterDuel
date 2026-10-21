import test from 'node:test';
import assert from 'node:assert/strict';
import {BalloonMembrane} from '../public/physics/membrane.js';
import {ggxDistribution,latexThickness,waterOptics} from '../public/rendering/optics.js';

test('GGX conserva su lóbulo al reducir rugosidad sin un epsilon que borre el brillo',()=>{
  for(const r of [.045,.13,.48]){
    assert.ok(Math.abs(ggxDistribution(1,r)*Math.PI*r**4-1)<1e-7);
    // Integrate D(n.h)*(n.h) over a hemisphere using adaptive angle sampling.
    let sum=0;const count=100000;
    for(let i=0;i<count;i++){const theta=(i+.5)/count*Math.PI/2;sum+=ggxDistribution(Math.cos(theta),r)*Math.cos(theta)*Math.sin(theta)*2*Math.PI*Math.PI/2/count;}
    assert.ok(Math.abs(sum-1)<2e-5,`${r}: normalized distribution ${sum}`);
  }
});
test('El agua limpia transmite más con trayecto corto y no añade un término lechoso dominante',()=>{
  const thin=waterOptics([.3,.8,.7],.01),thick=waterOptics([.3,.8,.7],.8);
  for(let i=0;i<3;i++){assert.ok(thin.transmittance[i]>.99);assert.ok(thin.transmittance[i]>thick.transmittance[i]);assert.ok(thick.scattering[i]<.004);}
});
test('El espesor de la película conserva área por espesor y llega a cada vértice incluso tras el desgarro',()=>{
  assert.equal(latexThickness(1,1),.0045);
  assert.ok(Math.abs(latexThickness(1,2)*2-.0045)<1e-12);
  const m=new BalloonMembrane();m.attach({x:0,y:2,z:0});
  for(const smooth of [0,1]){
    const mesh=m.mesh({smooth});assert.equal(mesh.optics.length,mesh.p.length/3);
    for(const t of mesh.optics)assert.ok(Number.isFinite(t)&&t>0&&t<.0045);
  }
  m.puncture({point:{x:.42,y:2,z:0},incoming:{x:-1,y:0,z:0}});
  const mesh=m.mesh({smooth:0});assert.equal(mesh.optics.length,mesh.p.length/3);
  assert.equal(mesh.p.length/9,m.faces.length,'all physical material still rendered');
  assert.ok(mesh.optics.every(Number.isFinite));
});
