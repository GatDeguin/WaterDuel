import test from 'node:test';
import assert from 'node:assert/strict';
import {workshopClipPlanes,workshopPartInView} from '../public/rendering/workshop-visibility.js';

const matrix=(x=0,y=0,z=0)=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1]);
const cube={sourceGeometry:{positions:new Float32Array([-.25,-.25,-.25,.25,.25,.25])}};
const planes=workshopClipPlanes(matrix());

test('removes an opaque part only when all its vertices clear a clip plane',()=>{
  for(const axis of [0,1,2])for(const sign of [-1,1]){
    const center=[0,0,0];
    center[axis]=1.1*sign;
    assert.equal(workshopPartInView(cube,matrix(...center),planes),true);
    center[axis]=1.251*sign;
    assert.equal(workshopPartInView(cube,matrix(...center),planes),true,'near-plane rounding margin');
    center[axis]=1.3*sign;
    assert.equal(workshopPartInView(cube,matrix(...center),planes),false);
  }
});

test('bounds use the drawn orientation and preserve missing geometry',()=>{
  const long={sourceGeometry:{positions:new Float32Array([-.8,-.05,0,.8,.05,0])}};
  const model=matrix(1.4);
  assert.equal(workshopPartInView(long,model,planes),true);
  model[0]=model[5]=0;model[1]=1;model[4]=-1;
  assert.equal(workshopPartInView(long,model,planes),false);
  assert.equal(workshopPartInView({},model,planes),true);
});
