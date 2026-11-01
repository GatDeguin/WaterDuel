import test from 'node:test';
import assert from 'node:assert/strict';
import {HostSession} from '../public/host-session.js';
import {normalizeMenuCommand,sanitizeMenuState} from '../public/remote-menu.js';
let serial=0;
const cmd=(name,value)=>({type:'command',requestId:++serial,sentAt:1,command:name,value});
const controls={musicVolume:['setMusicVolume',0,100,24],effectsVolume:['setEffectsVolume',0,100,100],distortion:['setDistortion',0,100,3],reverb:['setReverb',0,100,8],reverbDecay:['setReverbDecay',200,2400,1100]};

test('sound commands accept only bounded integers and never controller objects or coercions',()=>{
  for(const [field,[name,min,max]] of Object.entries(controls)){
    for(const value of [min,max])assert.deepEqual(normalizeMenuCommand(cmd(name,value))?.value,value,field);
    for(const value of [min-1,max+1,String(min),NaN,Infinity,null,{},min+.5])assert.equal(normalizeMenuCommand(cmd(name,value)),null,`${field}/${value}`);
  }
});
test('host exposes subtle sound defaults and independently normalizes all buses and effects',()=>{
  const host=new HostSession(),state=host.menuState();
  for(const [field,[name,,max,defaultValue]] of Object.entries(controls)){
    assert.equal(state[field],defaultValue,field);assert.equal(host.handleCommand(cmd(name,max)).ok,true);assert.equal(host.menuState()[field],max);
  }
  assert.deepEqual(host.audioOptions,{music:1,effects:1,distortion:1,reverb:1,reverbDecay:2.4,effectMask:134217727});
  assert.equal(host.handleCommand(cmd('setMusicVolume',-1)).ok,false);assert.equal(host.musicVolume,100);assert.deepEqual(host.game.scores,[0,0]);
});
test('sound preferences survive host reload and reject damaged storage without changing game progress',()=>{
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  const host=new HostSession({storage});assert.equal(map.size,0);
  host.handleCommand(cmd('setAudio',true));host.handleCommand(cmd('setVolume',62));host.handleCommand(cmd('setMusicVolume',17));host.handleCommand(cmd('setEffectsVolume',83));host.handleCommand(cmd('setDistortion',2));host.handleCommand(cmd('setReverb',6));host.handleCommand(cmd('setReverbDecay',900));
  const restored=new HostSession({storage}),state=restored.menuState();
  assert.equal(state.audioOn,true);assert.equal(state.volume,62);assert.equal(state.musicVolume,17);assert.equal(state.effectsVolume,83);assert.equal(state.distortion,2);assert.equal(state.reverb,6);assert.equal(state.reverbDecay,900);
  assert.deepEqual(restored.audioOptions,{music:.17,effects:.83,distortion:.02,reverb:.06,reverbDecay:.9,effectMask:134217727});assert.deepEqual(restored.game.scores,[0,0]);
  map.set('waterduel.audio.v1','{broken');assert.equal(new HostSession({storage}).menuState().distortion,3);
  assert.doesNotThrow(()=>new HostSession({storage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}}).handleCommand(cmd('setReverb',5)));
});
test('the relay copies scalar sound settings with finite bounds and no nested secrets',()=>{
  const state=sanitizeMenuState({musicVolume:1000,effectsVolume:-5,distortion:'99',reverb:NaN,reverbDecay:999999,audioFX:{token:'secret'}});
  assert.equal(state.musicVolume,100);assert.equal(state.effectsVolume,0);assert.equal(state.distortion,3);assert.equal(state.reverb,8);assert.equal(state.reverbDecay,2400);assert.ok(!JSON.stringify(state).includes('secret'));
});
test('sound adjustments remain available in a live round and do not reset physics or score',()=>{
  const host=new HostSession();host.handleCommand({type:'command',requestId:++serial,sentAt:1,command:'start'});const fighters=host.game.fighters,clock=host.game.clock;
  for(const [field,[name,min]] of Object.entries(controls)){assert.equal(host.handleCommand(cmd(name,min)).ok,true,field);assert.equal(host.menuState()[field],min);}
  assert.equal(host.game.fighters,fighters);assert.equal(host.game.clock,clock);assert.equal(host.game.phase,'countdown');assert.deepEqual(host.game.scores,[0,0]);
});
