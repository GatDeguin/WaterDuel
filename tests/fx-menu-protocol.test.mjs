import test from 'node:test';
import assert from 'node:assert/strict';
import {HostSession} from '../public/host-session.js';
import {normalizeMenuCommand,sanitizeMenuState} from '../public/remote-menu.js';
import {loadSoundPreferences} from '../public/audio/sound-settings.js';
import {MobileSession} from '../public/mobile-session.js';
import {ALL_EFFECTS_MASK as ALL,effectEnabled} from '../public/audio/effect-controls.js';
let serial=0;
const command=(name,value)=>({type:'command',command:name,value,requestId:++serial,sentAt:1});

test('individual FX commands strictly validate a known ID and boolean and copy only their two fields',()=>{
  const source={id:'wood',enabled:false,token:'private',other:{secret:true}},clean=normalizeMenuCommand(command('setEffectEnabled',source));
  assert.deepEqual(clean?.value,{id:'wood',enabled:false});source.enabled=true;assert.equal(clean.value.enabled,false);
  for(const value of [null,[],{},'wood',{id:'wood'},{id:'wood',enabled:'false'},{id:'wood',enabled:0},{id:'wood-contact',enabled:true},{id:'__proto__',enabled:false},{id:'constructor',enabled:false},{id:'joint',enabled:null}])assert.equal(normalizeMenuCommand(command('setEffectEnabled',value)),null,JSON.stringify(value));
  for(const value of [0,ALL])assert.equal(normalizeMenuCommand(command('setEffectMask',value))?.value,value);
  for(const value of [-1,ALL+1,2**31,1.5,'0',null,{},NaN,Infinity])assert.equal(normalizeMenuCommand(command('setEffectMask',value)),null);
});

test('individual host intents compose without losing another FX change and are included in authoritative audio options',()=>{
  let host;const notifications=[];host=new HostSession({onSettings:kind=>notifications.push({kind,mask:host.audioOptions.effectMask})});
  assert.equal(host.menuState().effectMask,ALL);assert.equal(host.audioOptions.effectMask,ALL);
  assert.equal(host.handleCommand(command('setEffectEnabled',{id:'wood',enabled:false})).ok,true);
  assert.equal(host.handleCommand(command('setEffectEnabled',{id:'joint',enabled:false})).ok,true);
  assert.equal(host.menuState().effectMask,ALL-3);
  assert.equal(host.handleCommand(command('setEffectEnabled',{id:'wood',enabled:true})).ok,true);
  assert.equal(host.audioOptions.effectMask,ALL-2);assert.deepEqual(notifications.map(n=>n.kind),['audio','audio','audio']);
  assert.equal(host.handleCommand(command('setEffectEnabled',{id:'wood-contact',enabled:true})).ok,false);assert.equal(notifications.length,3);
});

test('FX switches persist without changing previously saved master mute, volume or music preferences',()=>{
  const data=new Map([['waterduel.audio.v1',JSON.stringify({audioOn:false,volume:37,musicVolume:19,effectsVolume:0,distortion:2,reverb:4,reverbDecay:900})]]);
  const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},host=new HostSession({storage});
  assert.equal(host.effectMask,ALL,'older sound preferences enable the current catalog by default');
  host.handleCommand(command('setEffectEnabled',{id:'joint',enabled:false}));
  const next=new HostSession({storage});assert.equal(next.effectMask,ALL-2);assert.equal(next.audioOn,false);assert.equal(next.volume,37);assert.equal(next.musicVolume,19);assert.equal(next.effectsVolume,0);assert.equal(next.reverbDecay,900);
  data.set('waterduel.audio.v1',JSON.stringify({effectMask:5}));
  const legacy=new HostSession({storage});assert.equal(legacy.effectMask,2**27+5);
  assert.equal(legacy.handleCommand(command('setEffectEnabled',{id:'thunder',enabled:false})).ok,true);
  assert.equal(new HostSession({storage}).effectMask,5,'a modern disabled thunder stays disabled on reload');
  data.set('waterduel.audio.v1',JSON.stringify({effectMask:0}));
  assert.equal(loadSoundPreferences(storage).effectMask,0,'legacy mute all stays muted');
  for(const effectMask of [-1,ALL+1,1.2,'0',null,{},NaN]){data.set('waterduel.audio.v1',JSON.stringify({effectMask}));assert.equal(loadSoundPreferences(storage).effectMask,ALL,'invalid persisted mask falls back to the catalog defaults');}
  assert.doesNotThrow(()=>new HostSession({storage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}}).handleCommand(command('setEffectMask',0)));
});

test('bulk and individual FX settings apply in a live round without resetting gameplay or master levels',()=>{
  const host=new HostSession();host.game.start();host.game.update(1/120);const fighters=host.game.fighters,clock=host.game.clock,phase=host.game.phase;
  const original={audioOn:host.audioOn,volume:host.volume,musicVolume:host.musicVolume,effectsVolume:host.effectsVolume};
  for(const value of [0,ALL]){assert.equal(host.handleCommand(command('setEffectMask',value)).ok,true);assert.equal(host.menuState().effectMask,value);}
  assert.equal(host.handleCommand(command('setEffectEnabled',{id:'puncture',enabled:false})).ok,true);
  assert.equal(host.game.fighters,fighters);assert.equal(host.game.clock,clock);assert.equal(host.game.phase,phase);assert.deepEqual(host.game.scores,[0,0]);
  for(const key of Object.keys(original))assert.equal(host[key],original[key]);
});

test('the relay state carries only one bounded scalar FX mask, with no scene, arbitrary FX keys or secrets',()=>{
  for(const effectMask of [0,7,2**27,ALL]){const state=sanitizeMenuState({effectMask,effectsEnabled:{hostToken:'secret'},fx:[{id:'anything'}]});assert.equal(state.effectMask,effectMask);assert.equal(effectEnabled(state.effectMask,'thunder'),effectMask>=2**27);assert.equal(JSON.stringify(state).includes('secret'),false);assert.equal('effectsEnabled'in state,false);}
  for(const effectMask of [undefined,-1,ALL+1,NaN,'0',{},[]])assert.equal(sanitizeMenuState({effectMask}).effectMask,ALL);
});

test('the standalone mobile transport appends the applied FX state after its ACK even when settings publish an earlier state',async()=>{
  const session=new MobileSession({now:()=>500}),events=[];
  const host=new HostSession({onSettings:()=>session.publish()});session.bindHost(host);
  const link=session.connect();link.onmessage=event=>events.push(JSON.parse(event.data));
  await new Promise(resolve=>setImmediate(resolve));link.send(JSON.stringify({type:'hello',role:'controller',slot:1}));await new Promise(resolve=>setImmediate(resolve));events.length=0;
  link.send(JSON.stringify({type:'command',requestId:1,sentAt:500,command:'setEffectEnabled',value:{id:'wood',enabled:false}}));await new Promise(resolve=>setImmediate(resolve));
  const ack=events.findIndex(e=>e.type==='command-result'&&e.requestId===1);assert.ok(ack>0);assert.equal(events[ack].ok,true);
  assert.ok(events.slice(0,ack).some(e=>e.type==='menu-state'),'onSettings is allowed to publish before the ACK');
  assert.ok(events.slice(ack+1).some(e=>e.type==='menu-state'&&e.state.effectMask===ALL-1),'a later authoritative DTO settles the checkbox');
  assert.equal(host.audioOn,false);link.close();
});
