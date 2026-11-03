import test from 'node:test';
import assert from 'node:assert/strict';
import {matrixCamera,burstCameraFocus} from '../public/rendering/matrix-camera.js';
import {duelCamera} from '../public/rendering/duel-camera.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
const delta=(a,b)=>Math.max(...a.eye.map((v,i)=>Math.abs(v-b.eye[i])),...a.target.map((v,i)=>Math.abs(v-b.target[i])),Math.abs(a.fov-b.fov));
function project(c,p,aspect){
 const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
 const forward=unit(c.target.map((v,i)=>v-c.eye[i])),right=unit(cross(forward,[0,1,0])),up=cross(right,forward),offset=p.map((v,i)=>v-c.eye[i]),depth=dot(offset,forward),half=depth*Math.tan(c.fov/2);
 return {depth,x:dot(offset,right)/(half*aspect),y:dot(offset,up)/half};
}
test('matrix orbit is visibly wider during the rupture, then returns to the original camera',()=>{
 const options={phase:'burst',clock:50,round:1,aspect:16/9,burstFocus:{x:1.8,y:2.7,z:.2}},base=duelCamera({...options,phase:'fight'});
 const peak=matrixCamera({...options,phaseClock:1.2}),classic=duelCamera({...options,phaseClock:1.2});
 const yaw=c=>Math.atan2(c.eye[0]-c.target[0],c.eye[2]-c.target[2]),orbit=Math.abs(yaw(peak)-yaw(base))*180/Math.PI;
 assert.ok(orbit>=45&&orbit<=65,`cinematic orbit is 45–65 degrees, got ${orbit}`);
 assert.ok(Math.abs(peak.eye[0]-base.eye[0])>2);assert.ok(Math.abs(peak.eye[0]-base.eye[0])>Math.abs(classic.eye[0]-base.eye[0])*1.7);
 assert.ok(Math.hypot(...peak.eye.map((v,i)=>v-peak.target[i]))<Math.hypot(...base.eye.map((v,i)=>v-base.target[i]))*.75,'dolly materially approaches the impact');
 assert.ok(Math.abs(peak.target[0]-options.burstFocus.x)<.4&&Math.abs(peak.target[1]-options.burstFocus.y)<.25,'the detail shot follows the recorded rupture');
 const elevation=c=>Math.atan2(c.eye[1]-c.target[1],Math.hypot(c.eye[0]-c.target[0],c.eye[2]-c.target[2]));
 assert.ok(Math.abs(elevation(matrixCamera({...options,phaseClock:.65}))-elevation(matrixCamera({...options,phaseClock:1.5})))>.15,'the arc visibly changes height');
 for(const phaseClock of [0,.06,2.6,3.25])assert.equal(delta(matrixCamera({...options,phaseClock}),duelCamera({...options,phaseClock})),0);
 for(const phase of ['ready','countdown','fight','matchover'])assert.deepEqual(matrixCamera({...options,phase,phaseClock:1}),duelCamera({...options,phase,phaseClock:1}));
});
test('cinematic detail keeps the impact visible, restores the complete envelope and stays continuous in portrait and landscape',()=>{
 for(const aspect of [320/440,390/440,16/9,2.4])for(const round of [1,2])for(const x of [-3.7,0,3.7])for(const t of [.06,.2,.7,1.1,1.55,2.1,2.6]){
  const options={phase:'burst',phaseClock:t,clock:50+t,round,aspect,burstFocus:{x,y:3.8,z:.6}},c=matrixCamera(options),next=matrixCamera({...options,phaseClock:t+1e-6});
  assert.ok([...c.eye,...c.target,c.fov].every(Number.isFinite));assert.ok(delta(c,next)<1e-4,`continuous faster arc ${aspect}/${round}/${x}/${t}: ${delta(c,next)}`);
  const impact=project(c,[x,3.8,.6],aspect);assert.ok(impact.depth>c.near&&Math.abs(impact.x)<.94&&Math.abs(impact.y)<.86,`impact remains visible ${aspect}/${round}/${x}/${t}: ${JSON.stringify(impact)}`);
  // The requested dramatic close-up can crop bodies. Preserve the original
  // complete composition at both boundaries, including its existing margins.
  if(t<=.06||t>=2.6)for(const px of [-3.7,3.7])for(const py of [.3245,3.8])for(const pz of [-.6,.6]){const p=project(c,[px,py,pz],aspect);assert.ok(p.depth>0&&Math.abs(p.x)<.94&&Math.abs(p.y)<.86,`${aspect}/${round}/${x}/${t}: ${JSON.stringify(p)}`);}
 }
});

test('the final opening and return settle continuously before the existing round bridge without a new cut',()=>{
 for(const aspect of [320/440,16/9,2.4])for(const round of [1,2]){
  const options={phase:'burst',clock:50,round,aspect,burstFocus:{x:round===1?2:-2,y:2.8,z:.17}},base=duelCamera({...options,phase:'fight'});
  const radius=c=>Math.hypot(...c.eye.map((v,i)=>v-c.target[i]));
  assert.ok(radius(matrixCamera({...options,phaseClock:2.3}))>radius(matrixCamera({...options,phaseClock:1.2})),'outward dolly opens the shot before settling');
  for(const boundary of [.06,2.6]){
   const at=matrixCamera({...options,phaseClock:boundary}),before=matrixCamera({...options,phaseClock:boundary-1e-5}),after=matrixCamera({...options,phaseClock:boundary+1e-5});
   assert.ok(delta(at,before)<1e-7&&delta(at,after)<1e-7,'zero-speed join at the original camera');
  }
  assert.equal(delta(matrixCamera({...options,phaseClock:2.6}),base),0);
  for(const phaseClock of [2.6,2.8,3.25])assert.deepEqual(matrixCamera({...options,phaseClock}),duelCamera({...options,phaseClock}));
 }
});

test('the entire dramatic arc has bounded frame motion and a broad mirrored orbit on phone and PC',()=>{
 for(const aspect of [320/440,390/440,16/9,2.4])for(const round of [1,2])for(const x of [-3.7,0,3.7])for(const y of [TABLE_TOP+.08,1.9,3.8]){
  const options={phase:'burst',clock:50,round,aspect,burstFocus:{x,y,z:.17}},base=duelCamera({...options,phase:'fight'});
  const yaw=c=>Math.atan2(c.eye[0]-c.target[0],c.eye[2]-c.target[2]),baseYaw=yaw(base),side=round===1?1:-1;
  let previous=matrixCamera({...options,phaseClock:0}),largest=0;
  for(let frame=1;frame<=312;frame++){
   const phaseClock=frame/120,c=matrixCamera({...options,phaseClock}),angle=side*(yaw(c)-baseYaw)*180/Math.PI;
   largest=Math.max(largest,angle);
   assert.ok(c.eye[1]>=TABLE_TOP+.45,'the portrait dolly must never descend behind the tabletop or workshop floor');
   if(c.motionWeight>.99)assert.ok(c.eye[1]>c.target[1],'the dramatic detail looks down at the action, rather than up at the ceiling');
   assert.ok(Math.hypot(...c.eye.map((v,i)=>v-previous.eye[i]))<1.2,'a 120 Hz sample cannot hide a positional cut');
   assert.ok(Math.abs(yaw(c)-yaw(previous))<3*Math.PI/180,'angular speed stays bounded despite the larger sweep');
   const impact=project(c,[x,y,.17],aspect);assert.ok(impact.depth>c.near&&Math.abs(impact.x)<.94&&Math.abs(impact.y)<.86,'the rupture stays inside the safe frame throughout the arc');
   previous=c;
  }
  assert.ok(largest>=58&&largest<=65,`broad sweep in either viewport/side: ${largest}`);
 }
});

test('a low portrait impact remains visible above the opaque table and floor during the descending orbit',()=>{
 // Independent review traced this exact former camera-to-impact segment
 // through two opaque floor triangles in the delivered workshop GLB.
 const options={phase:'burst',phaseClock:1.6,clock:50,round:1,aspect:320/440,burstFocus:{x:-3.7,y:1.9,z:.17}},c=matrixCamera(options);
 assert.ok(c.eye[1]>=TABLE_TOP+.45,`safe descending pitch: eye height ${c.eye[1]}`);
 for(let i=0;i<=10;i++){
  const y=c.eye[1]+(options.burstFocus.y-c.eye[1])*i/10;
  assert.ok(y>=TABLE_TOP+.45,'the whole sightline remains above opaque horizontal floor/table surfaces');
 }
 const impact=project(c,[-3.7,1.9,.17],options.aspect);
 assert.ok(impact.depth>c.near&&Math.abs(impact.x)<.94&&Math.abs(impact.y)<.86);
});
test('burst focus comes from recorded water impacts, not falling heads, and handles a draw without mutation',()=>{
 const game={phase:'burst',fighters:[{globIntact:true,pose:{head:{x:-2,y:3,z:0}}},{globIntact:false,pose:{head:{x:99,y:-9,z:0}},fluid:{impact:{x:1.9,y:2.8,z:.12}}}]},before=JSON.stringify(game);
 assert.deepEqual(burstCameraFocus(game),{x:1.9,y:2.8,z:.12});assert.equal(JSON.stringify(game),before);
 game.fighters[0].globIntact=false;game.fighters[0].fluid={impact:{x:-1.9,y:2.6,z:-.12}};assert.deepEqual(burstCameraFocus(game),{x:0,y:2.7,z:0});
 assert.equal(burstCameraFocus({...game,phase:'fight'}),null);assert.equal(burstCameraFocus({phase:'burst',fighters:[]}),null);
});

test('the shot follows the recorded water volume as it falls, with impact fallback and deterministic replay seeks',()=>{
 const game={phase:'burst',phaseClock:1.4,fighters:[{globIntact:true,fluid:{particles:[{x:-7,y:7,z:7,volume:999}]}},
  {globIntact:false,pose:{head:{x:99,y:-9,z:0}},fluid:{impact:{x:1.9,y:2.8,z:.12},particles:[
   {x:1.6,y:1.1,z:.1,volume:1},{x:2,y:.7,z:.3,volume:3},
   {x:NaN,y:4,z:0,volume:1},{x:4,y:4,z:4,volume:-1}]}}]},before=JSON.stringify(game);
 const focus=burstCameraFocus(game);
 assert.ok(Math.abs(focus.x-1.9)<1e-12&&Math.abs(focus.y-.8)<1e-12&&Math.abs(focus.z-.25)<1e-12,'follow the positive finite water volume, not an empty head or intact balloon');
 assert.deepEqual(burstCameraFocus({...game,phaseClock:0}),{x:1.9,y:2.8,z:.12});
 const early=burstCameraFocus({...game,phaseClock:.6});assert.ok(early.y>.8&&early.y<2.8,'blend continuously away from the initial puncture');
 burstCameraFocus({...game,phaseClock:.2});assert.deepEqual(burstCameraFocus(game),focus,'reverse seeks use the same snapshot, without camera history');
 assert.equal(JSON.stringify(game),before);
 const empty={phase:'burst',phaseClock:1.4,fighters:[{globIntact:false,fluid:{impact:{x:1.9,y:2.8,z:.12},particles:[{x:4,y:4,z:4,volume:0}]}}]};
 assert.deepEqual(burstCameraFocus(empty),{x:1.9,y:2.8,z:.12});
});
test('reduced motion, inspection, reverse replay seeks and malformed inputs preserve deterministic camera safety',()=>{
 const options={phase:'burst',phaseClock:1.2,clock:30,round:2,aspect:16/9,burstFocus:{x:1.5,y:2.7,z:0}},expected=matrixCamera(options);
 matrixCamera({...options,phaseClock:2.4});matrixCamera({...options,phaseClock:.2});assert.deepEqual(matrixCamera(options),expected);
 for(const extra of [{reducedMotion:true},{cameraMode:'detail',replay:true}])assert.deepEqual(matrixCamera({...options,...extra}),duelCamera({...options,...extra}));
 for(const aspect of [NaN,0,Infinity,Number.MIN_VALUE,1e30])for(const burstFocus of [null,{},NaN,{x:NaN,y:Infinity,z:0},{x:1e99,y:-1e99,z:1e99}]){
  const c=matrixCamera({...options,aspect,burstFocus});assert.ok([...c.eye,...c.target,c.fov,c.near,c.far].every(Number.isFinite));
 }
});
