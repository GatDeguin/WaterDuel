import test from 'node:test';
import assert from 'node:assert/strict';
import {cinematicCamera} from '../public/rendering/cinematic-camera.js';
import {matrixCamera} from '../public/rendering/matrix-camera.js';
const delta=(a,b)=>Math.max(...a.eye.map((v,i)=>Math.abs(v-b.eye[i])),...a.target.map((v,i)=>Math.abs(v-b.target[i])),Math.abs(a.fov-b.fov));

test('staging sweeps and countdown crane are pronounced while combat, inspection and reduced motion stay exact',()=>{
  const options={clock:8,round:1,aspect:16/9};
  const opening=cinematicCamera({...options,phase:'countdown',phaseClock:1.1}),base=matrixCamera({...options,phase:'countdown',phaseClock:1.1});
  assert.ok(Math.abs(opening.eye[0]-base.eye[0])>2,'the entry sweep is visibly lateral');
  assert.ok(Math.abs(opening.eye[1]-base.eye[1])>.2,'the entry changes camera height');
  for(const phase of ['ready','countdown','fight','burst','matchover']){
    const at={...options,phase,phaseClock:1.1};
    for(const extra of [{reducedMotion:true},{cameraMode:'detail',replay:true}])assert.deepEqual(cinematicCamera({...at,...extra}),matrixCamera({...at,...extra}));
  }
  for(const phaseClock of [0,1,10,100])assert.deepEqual(cinematicCamera({...options,phase:'fight',phaseClock}),matrixCamera({...options,phase:'fight',phaseClock}));
});

test('camera staging joins waiting, countdown, fight and round bridge without cuts or render history',()=>{
  for(const aspect of [.5,16/9,2.4])for(const round of [1,2]){
    const options={clock:8,round,aspect};
    const ready=cinematicCamera({...options,phase:'ready',phaseClock:5});
    assert.deepEqual(cinematicCamera({...options,phase:'countdown',phaseClock:0}),ready);
    assert.deepEqual(cinematicCamera({...options,phase:'countdown',phaseClock:2.4}),matrixCamera({...options,phase:'countdown',phaseClock:2.4}));
    assert.deepEqual(cinematicCamera({...options,phase:'burst',phaseClock:2.6}),matrixCamera({...options,phase:'burst',phaseClock:2.6}));
    assert.ok(delta(cinematicCamera({...options,phase:'burst',phaseClock:3.25}),ready)<1e-12);
    assert.ok(delta(cinematicCamera({...options,phase:'burst',phaseClock:3.25}),cinematicCamera({...options,round:round+1,phase:'countdown',phaseClock:0}))<1e-12,'the actual next-round increment does not reverse the staging camera');
    for(const phase of ['ready','countdown','burst','matchover'])for(const t of [0,.2,1.1,2.4,2.6,2.9,3.25]){
      const at={...options,phase,phaseClock:t},current=cinematicCamera(at),next=cinematicCamera({...at,phaseClock:t+1e-6,clock:8+1e-6});
      assert.ok([...current.eye,...current.target,current.fov,current.near,current.far].every(Number.isFinite));
      assert.ok(delta(current,next)<1e-4,`continuous ${aspect}/${round}/${phase}/${t}`);
      cinematicCamera({...at,phaseClock:1.7});assert.deepEqual(cinematicCamera(at),current,'seeking backwards is deterministic');
    }
  }
});
