import test from 'node:test';
import assert from 'node:assert/strict';
import {roomCamera} from '../public/rendering/room-camera.js';
import {cinematicCamera} from '../public/rendering/cinematic-camera.js';
const interior={min:[-10.5,.7745,2.4],max:[10.5,6.9,14.3]};
const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function projected(c,p,aspect){const f=unit(c.target.map((v,i)=>v-c.eye[i])),r=unit(cross(f,[0,1,0])),u=cross(r,f),d=p.map((v,i)=>v-c.eye[i]),depth=dot(d,f),h=depth*Math.tan(c.fov/2);return {depth,x:dot(d,r)/(h*aspect),y:dot(d,u)/h};}

test('normal landscape cameras remain exact inside the finished workshop',()=>{
  for(const phase of ['ready','countdown','fight','burst','matchover'])for(const phaseClock of [0,.7,1.6,2.6,3.25])for(const round of [1,2]){
    const options={phase,phaseClock,clock:8,round,aspect:16/9,burstFocus:{x:1.5,y:2.7,z:0},roomInterior:interior};
    assert.deepEqual(roomCamera(options),cinematicCamera(options));
  }
});

test('portrait cameras stay inside the room and fit the duel after constraining their position',()=>{
  for(const aspect of [.5,320/440,390/440])for(const phase of ['ready','countdown','fight','burst','matchover'])for(const phaseClock of [0,.7,1.6,2.6,3.25]){
    const options={phase,phaseClock,clock:8,round:1,aspect,burstFocus:{x:1.5,y:.42,z:0},roomInterior:interior},c=roomCamera(options);
    assert.ok([...c.eye,...c.target,c.fov].every(Number.isFinite));
    for(let i=0;i<3;i++)assert.ok(c.eye[i]>=interior.min[i]-1e-10&&c.eye[i]<=interior.max[i]+1e-10,`${phase}/${phaseClock}/${aspect}: ${c.eye}`);
    if(phase!=='burst'||phaseClock<=.06||phaseClock>=2.6)for(const x of [-3.7,3.7])for(const y of [.3245,3.8])for(const z of [-.6,.6]){const p=projected(c,[x,y,z],aspect);assert.ok(p.depth>0&&Math.abs(p.x)<.94&&Math.abs(p.y)<.86,JSON.stringify(p));}
    const next=roomCamera({...options,phaseClock:phaseClock+1e-6,clock:8+1e-6});assert.ok(Math.max(...next.eye.map((v,i)=>Math.abs(v-c.eye[i])),Math.abs(next.fov-c.fov))<1e-4,'constraint remains continuous');
  }
});

test('room framing uses snapshot data only and malformed room bounds safely preserve the camera',()=>{
  const options={phase:'burst',phaseClock:1.2,clock:30,round:2,aspect:.5,burstFocus:{x:-2,y:1.4,z:.1},roomInterior:interior},before=JSON.stringify(options),expected=roomCamera(options);
  roomCamera({...options,phaseClock:.2});assert.deepEqual(roomCamera(options),expected);assert.equal(JSON.stringify(options),before);
  for(const roomInterior of [null,{}, {min:[0,0,0],max:[-1,3,4]}, {min:[0,NaN,0],max:[4,5,6]}])assert.deepEqual(roomCamera({...options,roomInterior}),cinematicCamera(options));
});
