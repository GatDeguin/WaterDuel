import test from 'node:test';
import assert from 'node:assert/strict';
import {cinematicCamera,burstCameraFocus} from '../public/rendering/cinematic-camera.js';
import {burstCameraFocus as waterFocus,matrixCamera} from '../public/rendering/matrix-camera.js';
import {roomCamera} from '../public/rendering/room-camera.js';
const roomInterior={min:[-10.5,.7745,2.4],max:[10.5,6.9,14.3]};
const broken=(slot,x,y=2.7)=>({slot,globIntact:false,fluid:{impact:{x,y,z:.12},particles:[{x:-x,y:.65,z:.2,volume:1}]}});
const snapshot=(fighters,phaseClock=1.2)=>({phase:'burst',phaseClock,fighters});
const yaw=c=>Math.atan2(c.eye[0]-c.target[0],c.eye[2]-c.target[2]);
const delta=(a,b)=>Math.max(...a.eye.map((v,i)=>Math.abs(v-b.eye[i])),...a.target.map((v,i)=>Math.abs(v-b.target[i])),Math.abs(a.fov-b.fov));
function projected(camera,point,aspect){
 const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);},dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const forward=unit(camera.target.map((v,i)=>v-camera.eye[i])),right=unit(cross(forward,[0,1,0])),up=cross(right,forward),offset=point.map((v,i)=>v-camera.eye[i]),depth=dot(offset,forward),half=depth*Math.tan(camera.fov/2);
 return {depth,x:dot(offset,right)/(half*aspect),y:dot(offset,up)/half};
}
const visible=(c,p,aspect)=>{const q=projected(c,p,aspect);assert.ok(q.depth>c.near&&Math.abs(q.x)<.94&&Math.abs(q.y)<.86,JSON.stringify({q,p,eye:c.eye,aspect}));};

test('presentation focus retains a fixed rupture origin and shot side while the real water crosses the centre',()=>{
 const game=snapshot([broken(1,-1.8)]),before=JSON.stringify(game),follow=waterFocus(game),focus=burstCameraFocus(game);
 assert.deepEqual({x:focus.x,y:focus.y,z:focus.z},follow);
 assert.deepEqual(focus.origins,[{x:-1.8,y:2.7,z:.12}]);assert.equal(focus.impactCount,1);assert.equal(focus.shotSide,-1);
 assert.ok(focus.x>0,'water centroid has crossed the centre; the shot must retain its original side');
 assert.equal(JSON.stringify(game),before);
});

test('draw focus identifies both actual origins and ignores intact or invalid heads',()=>{
 const game=snapshot([broken(1,-2),broken(2,2.2)]),focus=burstCameraFocus(game);
 assert.equal(focus.impactCount,2);assert.deepEqual(focus.origins,[{x:-2,y:2.7,z:.12},{x:2.2,y:2.7,z:.12}]);
 assert.equal(focus.shotSide,1,'a simultaneous pair uses one stable authored broad shot');
 assert.equal(burstCameraFocus({...game,phase:'fight'}),null);
 assert.equal(burstCameraFocus(snapshot([{...broken(1,-2),globIntact:true},{...broken(2,2),fluid:{impact:{x:NaN,y:2,z:0}}}])),null);
});

test('single rupture orbit follows its fixed side independently of the round number or falling water',()=>{
 for(const x of [-1.8,1.8]){
  const burstFocus=burstCameraFocus(snapshot([broken(x<0?1:2,x)])),options={phase:'burst',phaseClock:1.2,clock:30,aspect:16/9,burstFocus};
  const first=cinematicCamera({...options,round:1}),second=cinematicCamera({...options,round:2});
  assert.equal(delta(first,second),0,'a round increment cannot change the side chosen by this recorded impact');
  assert.ok(Math.sign(yaw(first))===Math.sign(x),'camera stays on the flank of the rupture');
 }
});

test('a double rupture keeps both complete duelists and the two impact origins in a broad moving frame',()=>{
 for(const aspect of [320/440,16/9,2.4]){
  const burstFocus=burstCameraFocus(snapshot([broken(1,-3.7,3.8),broken(2,3.7,3.8)]));
  let largest=0;
  for(const phaseClock of [.06,.25,.5,.8,1.2,1.7,2.1,2.4,2.6]){
   const options={phase:'burst',phaseClock,clock:30+phaseClock,aspect,round:1,burstFocus},c=cinematicCamera(options);
   for(const x of [-3.7,3.7])for(const y of [.3245,3.8])for(const z of [-.6,.6])visible(c,[x,y,z],aspect);
   for(const origin of burstFocus.origins??[])visible(c,[origin.x,origin.y,origin.z],aspect);
   largest=Math.max(largest,Math.abs(yaw(c)));
  }
  assert.ok(largest>25*Math.PI/180,'the broad draw shot still makes a cinematic orbit');
 }
});

test('new direction preserves combat, accessibility, historical fallback, exact joins and deterministic seeks',()=>{
 const burstFocus=burstCameraFocus(snapshot([broken(1,-2)]));
 for(const aspect of [320/440,16/9,2.4]){
  const options={phase:'burst',clock:30,aspect,round:2,burstFocus};
  for(const phaseClock of [.06,2.6])assert.deepEqual(cinematicCamera({...options,phaseClock}),matrixCamera({...options,phaseClock}));
  for(const extra of [{reducedMotion:true},{cameraMode:'detail',replay:true}])assert.deepEqual(cinematicCamera({...options,phaseClock:1.2,...extra}),matrixCamera({...options,phaseClock:1.2,...extra}));
  const expected=cinematicCamera({...options,phaseClock:1.2});cinematicCamera({...options,phaseClock:2.4});assert.deepEqual(cinematicCamera({...options,phaseClock:1.2}),expected);
  for(const bad of [null,{x:2,y:2.7,z:0},{x:2,y:2.7,z:0,impactCount:1,shotSide:NaN,origins:[]}]){
   const at={...options,phaseClock:1.2,burstFocus:bad};assert.deepEqual(cinematicCamera(at),matrixCamera(at));
  }
 }
});

test('the directed pair remains inside the finished room and does not crop the full envelope in portrait',()=>{
 const burstFocus=burstCameraFocus(snapshot([broken(1,-3.7,3.8),broken(2,3.7,3.8)]));
 for(const aspect of [.5,320/440,390/440])for(const phaseClock of [.25,.7,1.2,1.7,2.3]){
  const options={phase:'burst',clock:30+phaseClock,phaseClock,round:2,aspect,burstFocus,roomInterior},c=roomCamera(options);
  c.eye.forEach((value,i)=>assert.ok(value>=roomInterior.min[i]-1e-10&&value<=roomInterior.max[i]+1e-10));
  for(const x of [-3.7,3.7])for(const y of [.3245,3.8])for(const z of [-.6,.6])visible(c,[x,y,z],aspect);
  const next=roomCamera({...options,phaseClock:phaseClock+1e-6,clock:options.clock+1e-6});assert.ok(delta(c,next)<1e-4);
 }
});

test('the final campaign shot settles toward a frontal hero composition while retaining the trophy and both duelists',()=>{
 for(const aspect of [.5,16/9,2.4])for(const tier of ['normal','advanced']){
  const trophy=tier==='normal'?'champion':'master',options={phase:'matchover',clock:40,phaseClock:0,aspect,round:7};
  assert.deepEqual(cinematicCamera({...options,ceremony:{tier,trophy,age:0}}),cinematicCamera(options),'the ceremony begins at the existing round bridge');
  for(const age of [.05,.3,.8,1.2,1.6,3,10]){
   const c=roomCamera({...options,clock:40+age,phaseClock:age,ceremony:{tier,trophy,age},roomInterior});
   for(const x of [-3.7,3.7])for(const y of [.3245,3.8])for(const z of [-.6,.6])visible(c,[x,y,z],aspect);
   for(const x of [-.38,.38])for(const y of [.3245,1.11])for(const z of [-.2,.36])visible(c,[x,y,z],aspect);
   c.eye.forEach((v,i)=>assert.ok(v>=roomInterior.min[i]-1e-10&&v<=roomInterior.max[i]+1e-10));
   if(age>=1.6)assert.ok(Math.abs(yaw(c))<1e-12,'the hero shot resolves frontally rather than endlessly sweeping');
  }
  const a=cinematicCamera({...options,phaseClock:3,ceremony:{tier,trophy,age:3}}),b=cinematicCamera({...options,clock:80,phaseClock:10,ceremony:{tier,trophy,age:10}});
  assert.equal(delta(a,b),0,'a completed ceremony camera holds its composition');
 }
});

test('ceremony framing ignores none, incompatible trophies, malformed values, demos, replay, reduced motion and detail',()=>{
 const options={phase:'matchover',phaseClock:2,clock:40,aspect:16/9},valid={tier:'normal',trophy:'champion',age:2};
 for(const ceremony of [null,{}, {tier:'normal',trophy:'none',age:2},{tier:'advanced',trophy:'champion',age:2},{...valid,age:NaN},{...valid,age:-1},{...valid,age:'2'}])assert.deepEqual(cinematicCamera({...options,ceremony}),cinematicCamera(options));
 for(const extra of [{demonstration:true},{replay:true},{reducedMotion:true},{cameraMode:'detail'}])assert.deepEqual(cinematicCamera({...options,...extra,ceremony:valid}),cinematicCamera({...options,...extra}));
 for(const phase of ['ready','countdown','fight','burst'])assert.deepEqual(cinematicCamera({...options,phase,ceremony:valid}),cinematicCamera({...options,phase}));
});

test('directed orbit and ceremony preserve bounded frame motion, settle continuously and remain deterministic',()=>{
 for(const aspect of [.5,16/9,2.4])for(const count of [1,2]){
  const burstFocus=burstCameraFocus(snapshot(count===1?[broken(1,-2)]:[broken(1,-3.7),broken(2,3.7)]));
  let previous=roomCamera({phase:'burst',phaseClock:0,clock:30,round:2,aspect,burstFocus,roomInterior});
  for(let frame=1;frame<=312;frame++){
   const phaseClock=frame/120,c=roomCamera({phase:'burst',phaseClock,clock:30+phaseClock,round:2,aspect,burstFocus,roomInterior});
   assert.ok(Math.hypot(...c.eye.map((v,i)=>v-previous.eye[i]))<1.2,'120 Hz samples reveal positional cuts');
   assert.ok(Math.abs(yaw(c)-yaw(previous))<3*Math.PI/180,'orbit angular speed remains bounded');previous=c;
  }
  for(const age of [0,.2,.8,1.6,3]){
   const options={phase:'matchover',clock:40+age,phaseClock:3.25,round:7,aspect,ceremony:{tier:'normal',trophy:'champion',age},roomInterior};
   const c=roomCamera(options),epsilon=1e-6,next=roomCamera({...options,clock:options.clock+epsilon,ceremony:{...options.ceremony,age:age+epsilon}});
   assert.ok(delta(c,next)<1e-4,'hero entry and settled view join continuously');roomCamera({...options,ceremony:{...options.ceremony,age:10}});assert.deepEqual(roomCamera(options),c);
  }
 }
});
