import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptiveQuality,renderQualityView} from '../public/adaptive-quality.js';

const feed=(control,{count=120,workMs=28,frameMs=33,phase='fight',start=0,eligible=true}={})=>{
  for(let i=0;i<count;i++)control.observe({now:start+i*frameMs,frameMs,workMs,phase,eligible});
};
const adaptive=()=>{const control=new AdaptiveQuality();control.configure('adaptive','high');return control;};
test('fixed and replay retain the selected quality without dynamic resolution',()=>{
  const control=new AdaptiveQuality();control.configure('fixed','ultra');feed(control);
  assert.deepEqual(control.profile('burst'),{mode:'fixed',level:0,quality:'ultra',renderScale:1});
  control.configure('adaptive','high');feed(control);
  assert.equal(control.profile('burst',true).mode,'fixed');
  assert.equal(control.profile('burst',true).quality,'high');
});
test('sustained overload lowers render detail and clamps to a bounded floor',()=>{
  const control=adaptive();feed(control);
  const profile=control.profile('fight');
  assert.equal(profile.level,4);assert.equal(profile.quality,'eco');
  assert.equal(profile.renderScale,.7);
});
test('one long frame does not lower quality; hidden and throttled callbacks do not accumulate pressure',()=>{
  const control=adaptive();feed(control,{count:1,workMs:90});
  feed(control,{count:100,eligible:false,start:100});
  feed(control,{count:100,frameMs:1000,workMs:4,start:4000});
  assert.equal(control.profile('fight').level,0);
});
test('late callbacks alone do not pretend to be CPU overload',()=>{
  const control=adaptive();feed(control,{workMs:6,frameMs:33});
  assert.equal(control.profile('fight').level,0);
});
test('burst starts with a measured-cost precaution and restores slowly after the phase',()=>{
  const control=adaptive();assert.equal(control.profile('burst').level,2);
  feed(control,{count:100,workMs:5,frameMs:16.7,phase:'burst'});
  assert.equal(control.profile('burst').level,2);
  feed(control,{count:50,workMs:5,frameMs:16.7,start:2000});
  assert.equal(control.profile('fight').level,2);
  feed(control,{count:160,workMs:5,frameMs:16.7,start:2850});
  assert.ok(control.profile('fight').level<2);
});
test('configuration changes reset pressure and preserve every selected quality as the ceiling',()=>{
  const control=adaptive();feed(control);control.configure('adaptive','ultra');
  assert.equal(control.profile('fight').quality,'ultra');assert.equal(control.profile('fight').level,0);
  control.configure('adaptive','eco');assert.equal(control.profile('fight').quality,'eco');
  feed(control);control.configure('fixed','eco');assert.equal(control.profile('fight').renderScale,1);
});
test('invalid samples cannot poison pressure or trigger profile changes',()=>{
  const control=adaptive();
  for(const value of [NaN,Infinity,-1])control.observe({now:100,frameMs:16.7,workMs:value,phase:'fight',eligible:true});
  assert.equal(control.profile('fight').level,0);
});
test('render override retains inherited scene properties and never changes the authoritative scene',()=>{
  const prototype={arena:'atelier',clock:3},fighters=Object.freeze([{slot:1}]);
  const scene=Object.freeze(Object.assign(Object.create(prototype),{quality:'ultra',fighters,phase:'burst'}));
  const view=renderQualityView(scene,{mode:'adaptive',quality:'eco'});
  assert.equal(scene.quality,'ultra');assert.equal(view.quality,'eco');assert.equal(view.arena,'atelier');
  assert.equal(Object.getPrototypeOf(view),prototype);assert.equal(view.fighters,fighters);
  assert.equal(renderQualityView(scene,{mode:'fixed',quality:'eco'}),scene);
});
test('burst bootstrap observes the same cooldown as later quality transitions',()=>{
  const control=adaptive();control.profile('burst',false,1000);
  feed(control,{count:10,workMs:25,frameMs:30,phase:'burst',start:1000});
  assert.equal(control.profile('burst').level,2);
  feed(control,{count:6,workMs:25,frameMs:30,phase:'burst',start:1300});
  assert.equal(control.profile('burst').level,3);
});
test('adaptation requires explicit opt-in; missing or invalid modes remain fixed',()=>{
  const control=new AdaptiveQuality();feed(control);assert.equal(control.profile('burst').mode,'fixed');
  for(const mode of [undefined,null,'auto',false]){
    control.configure('adaptive','high');control.configure(mode,'high');feed(control);
    assert.equal(control.profile('burst').mode,'fixed');assert.equal(control.profile('burst').renderScale,1);
  }
});
