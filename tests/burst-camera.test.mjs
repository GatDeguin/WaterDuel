import test from 'node:test';
import assert from 'node:assert/strict';
import {duelCamera} from '../public/rendering/duel-camera.js';

const distance=c=>Math.hypot(...c.eye.map((value,index)=>value-c.target[index]));
const difference=(a,b)=>Math.max(...a.eye.map((value,index)=>Math.abs(value-b.eye[index])),...a.target.map((value,index)=>Math.abs(value-b.target[index])),Math.abs(a.fov-b.fov));
const combat=aspect=>duelCamera({phase:'fight',aspect});
function project(camera,point,aspect){
  const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0),unit=v=>{const n=Math.hypot(...v);return v.map(value=>value/n);},
    cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const forward=unit(camera.target.map((value,index)=>value-camera.eye[index])),right=unit(cross(forward,[0,1,0])),up=cross(right,forward),
    vector=point.map((value,index)=>value-camera.eye[index]),depth=dot(vector,forward),half=depth*Math.tan(camera.fov/2);
  return {depth,x:dot(vector,right)/(half*aspect),y:dot(vector,up)/half};
}

test('La explosión orbita y acerca con foco real, después recupera exactamente el combate',()=>{
  const aspect=16/9,focus={x:1.3,y:2.7,z:.05},base=combat(aspect),at=phaseClock=>duelCamera({phase:'burst',phaseClock,clock:30+phaseClock,burstFocus:focus,aspect});
  for(const t of [0,.1,.4,2.35,2.4,2.55])assert.equal(difference(at(t),base),0,`combat composition at ${t}`);
  const peak=at(1.2);assert.ok(distance(peak)<distance(base),'physical dolly approaches the duel');
  assert.ok(Math.abs(peak.eye[0]-base.eye[0])>.5,'the camera makes a visible orbital arc');
  assert.ok(peak.target[0]>base.target[0]);assert.ok(peak.target[1]>base.target[1]);
  assert.ok(peak.fov>=base.fov&&peak.fov<=31*Math.PI/180);assert.ok(peak.motionWeight>0);
  const mirrored=duelCamera({phase:'burst',phaseClock:1.2,burstFocus:{...focus,x:-focus.x},aspect});assert.ok(mirrored.target[0]<base.target[0]);
  assert.deepEqual(focus,{x:1.3,y:2.7,z:.05});
});

test('Entrada, retorno al combate y puente a countdown mantienen continuidad sin historial',()=>{
  const options={phase:'burst',clock:80,round:2,aspect:16/9,burstFocus:{x:-1.4,y:2.9,z:0}},epsilon=1e-6;
  for(const phaseClock of [0,.4,1.05,1.7,2.35,2.6,3.25]){
    const a=duelCamera({...options,phaseClock,clock:80+phaseClock}),b=duelCamera({...options,phaseClock:phaseClock+epsilon,clock:80+phaseClock+epsilon});
    assert.ok(difference(a,b)<epsilon*6,`${phaseClock}: continuous motion`);
  }
  const end=duelCamera({...options,phaseClock:3.25}),next=duelCamera({...options,phase:'countdown',phaseClock:0,round:3});assert.equal(difference(end,next),0);
  assert.equal(difference(end,duelCamera({...options,phase:'ready',phaseClock:0})),0);
});

test('La órbita conserva ambas marionetas y la mesa con foco extremo en viewport pequeño',()=>{
  for(const aspect of [320/440,390/440,734/700,16/9,2.4])for(const x of [-3.7,0,3.7])for(const y of [.3245,3.8])for(const t of [.4,.7,1.05,1.4,1.8,2.1,2.35,2.8,3.25]){
    const camera=duelCamera({phase:'burst',phaseClock:t,clock:40+t,round:2,burstFocus:{x,y,z:.6},aspect});
    for(const px of [-3.7,3.7])for(const py of [.3245,3.8])for(const pz of [-.6,.6]){
      const p=project(camera,[px,py,pz],aspect);assert.ok(p.depth>0&&Math.abs(p.x)<.94&&Math.abs(p.y)<.86,`${aspect}/${x}/${y}/${t}: ${JSON.stringify(p)}`);
    }
  }
});

test('Replay inverso, movimiento reducido y foco inválido no introducen estado ni NaN',()=>{
  const options={phase:'burst',clock:40,round:3,aspect:16/9,burstFocus:{x:1.5,y:2.8,z:.1}},times=[0,.4,.8,1.2,2,2.4,2.8,3.25],forward=times.map(phaseClock=>duelCamera({...options,phaseClock}));
  for(let i=times.length-1;i>=0;i--)assert.deepEqual(duelCamera({...options,phaseClock:times[i]}),forward[i]);
  for(const phaseClock of times)assert.equal(difference(duelCamera({...options,phaseClock,reducedMotion:true}),combat(options.aspect)),0);
  for(const burstFocus of [null,{},NaN,{x:NaN,y:3},{x:3,y:Infinity,z:0},{x:1e99,y:-1e99,z:1e99}])for(const aspect of [NaN,0,-1,Infinity,Number.MIN_VALUE,1e30]){
    const c=duelCamera({...options,phaseClock:1.2,burstFocus,aspect});assert.ok([...c.eye,...c.target,c.fov,c.near,c.far].every(Number.isFinite));
  }
});
