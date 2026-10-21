import test from 'node:test';
import assert from 'node:assert/strict';
import {BalloonMembrane} from '../public/physics/membrane.js';
import {LATEX_REST_THICKNESS} from '../public/rendering/optics.js';
test('El espesor óptico es continuo en nodos compartidos y conserva el volumen material total',()=>{
 const m=new BalloonMembrane();m.attach({x:0,y:2.4,z:.025});
 m.nodes[20].x+=.13;m.nodes[20].y-=.05;m.version++;
 const mesh=m.mesh({smooth:0}),seen=new Map();let volume=0;
 for(let i=0;i<mesh.p.length;i+=9){
  const p=mesh.p,a=[p[i+3]-p[i],p[i+4]-p[i+1],p[i+5]-p[i+2]],b=[p[i+6]-p[i],p[i+7]-p[i+1],p[i+8]-p[i+2]];
  const area=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;
  volume+=area*(mesh.optics[i/3]+mesh.optics[i/3+1]+mesh.optics[i/3+2])/3;
 }
 for(let i=0;i<mesh.p.length;i+=3){const key=mesh.p.slice(i,i+3).join(','),t=mesh.optics[i/3];
  if(seen.has(key))assert.ok(Math.abs(t-seen.get(key))<1e-12,'a shared vertex must not change color at a triangle boundary');
  seen.set(key,t);assert.ok(t>0&&Number.isFinite(t));
 }
 const expected=m.faces.reduce((sum,f)=>sum+f.restArea,0)*LATEX_REST_THICKNESS;
 assert.ok(Math.abs(volume-expected)<1e-12);
});
