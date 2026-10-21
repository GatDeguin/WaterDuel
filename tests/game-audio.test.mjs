import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio} from '../public/game-audio.js';

class Param {
  constructor(value=0){this.value=value;}
  setValueAtTime(value){assert.ok(Number.isFinite(value));this.value=value;}
  setTargetAtTime(value){this.setValueAtTime(value);}
  linearRampToValueAtTime(value){this.setValueAtTime(value);}
  cancelScheduledValues(){}
}
class Node {
  constructor(){this.gain=new Param(1);this.pan=new Param();this.playbackRate=new Param(1);this.connections=[];this.stopped=false;}
  connect(node){this.connections.push(node);return node;}
  disconnect(){this.connections=[];this.disconnected=true;}
  start(time,offset=0){this.started=time;this.offset=offset;}
  stop(){this.stopped=true;}
}
class Context {
  constructor(){this.state='running';this.currentTime=0;this.sampleRate=22050;this.destination=new Node();this.sources=[];this.resumeCount=0;}
  createGain(){return new Node();}
  createStereoPanner(){return new Node();}
  createDynamicsCompressor(){const n=new Node();for(const k of ['threshold','knee','ratio','attack','release'])n[k]=new Param();return n;}
  createWaveShaper(){return new Node();}
  createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));return {duration:length/rate,length,numberOfChannels:channels,getChannelData:i=>data[i]};}
  createBufferSource(){const node=new Node();this.sources.push(node);return node;}
  resume(){this.resumeCount++;this.state='running';return Promise.resolve();}
  close(){this.state='closed';return Promise.resolve();}
}
const setup=(options={})=>{const context=new Context();const audio=new GameAudio({contextFactory:()=>context,random:()=>.5,...options});return {audio,context};};

test('audio starts silent and disabled without allocating a context',()=>{
  const {audio,context}=setup();audio.tone('clang');assert.equal(audio.context,null);assert.equal(context.sources.length,0);
});
test('mute applies zero gain immediately and stops all scheduled voices',()=>{
  const {audio,context}=setup();audio.configure(true,55);audio.play('metal');assert.equal(audio.context,context);
  audio.configure(false,55);assert.equal(audio.master.gain.value,0);assert.equal(audio.voices.size,0);assert.ok(context.sources.every(s=>s.stopped));
});
test('malformed volume is bounded and zero volume never schedules effects',()=>{
  const {audio,context}=setup();audio.configure(true,Infinity);assert.ok(Number.isFinite(audio.volume));
  audio.configure(true,0);assert.equal(audio.play('wood'),false);assert.equal(context.sources.length,0);
  audio.configure(true,500);assert.equal(audio.volume,1);audio.configure(true,-20);assert.equal(audio.volume,0);
});
test('real position and intensity control the effect stereo gain',()=>{
  const {audio}=setup();audio.configure(true,55);audio.play('wood',{x:-2,intensity:.2});audio.play('wood',{x:2,intensity:.8});
  const voices=[...audio.voices];assert.ok(voices[0].pan.pan.value<0);assert.ok(voices[1].pan.pan.value>0);
  assert.ok(voices[0].gain.gain.value<voices[1].gain.gain.value);
});
test('accepted material contacts choose loaded wood or latex without false punctures',()=>{
  const {audio,context}=setup();audio.configure(true,55);
  assert.equal(audio.handleEvent('material-contact',{material:'wood',impulse:.06,closingSpeed:.8,at:{x:-2}}),true);
  assert.ok([...audio.voices].some(v=>v.name==='wood-contact'&&v.pan.pan.value<0));
  context.currentTime=.2;audio.handleEvent('material-contact',{material:'latex',impulse:.02,closingSpeed:.5,at:{x:2}});
  assert.ok([...audio.voices].some(v=>v.name==='latex-rub'));assert.ok(![...audio.voices].some(v=>v.name==='puncture'));
});
test('shield impact material and physical hit strength change the audible layers',()=>{
  const {audio,context}=setup();audio.configure(true,55);
  const game={fighters:[{slot:1,equipment:{defense:'short'}}]};
  audio.handleEvent('clang',{defender:1,at:{x:-2},impulse:.01,closingSpeed:.2},game);
  const soft=[...audio.voices].find(v=>v.name==='shield-metal');assert.ok(soft);
  context.currentTime=.2;game.fighters[0].equipment.defense='long';
  audio.handleEvent('clang',{defender:1,at:{x:2},impulse:.2,closingSpeed:2},game);
  const hard=[...audio.voices].find(v=>v.name==='shield-wood');assert.ok(hard);assert.ok(hard.gain.gain.value>soft.gain.gain.value);
});
test('continuous same-contact events are rate limited without suppressing later hits',()=>{
  const {audio,context}=setup();audio.configure(true,55);
  const hit={weaponBind:true,impulse:.06,closingSpeed:1,at:{x:0}};
  for(let n=0;n<500;n++)audio.handleEvent('clang',hit);
  assert.ok(audio.voices.size<=2);assert.ok(context.sources.length<=2,'No crea cientos de nodos para el mismo impacto.');
  context.currentTime=.12;assert.equal(audio.handleEvent('clang',hit),true);
  assert.ok(context.sources.length<=4);assert.equal(audio.handleEvent('clang',{...hit,closingSpeed:0}),false);
});
test('material gate history stays bounded and mute permits a fresh accepted contact',()=>{
  const {audio,context}=setup();audio.configure(true,55);
  for(let n=0;n<250;n++){context.currentTime=n*.12;audio.handleEvent('material-contact',{material:'wood',bodyA:'part'+n,bodyB:'body',impulse:.05,closingSpeed:.7});}
  assert.ok(audio.contactTimes.size<=64);audio.configure(false,55);assert.equal(audio.contactTimes.size,0);
  audio.configure(true,55);assert.equal(audio.handleEvent('material-contact',{material:'wood',bodyA:'part249',bodyB:'body',impulse:.05,closingSpeed:.7}),true);
});
test('rupture adds pressure-water onset once and observes both heads on a draw',()=>{
  const {audio,context}=setup();audio.configure(true,55);
  const burst={at:{x:-2},loser:1,relativeSpeed:2};audio.handleEvent('burst',burst);
  assert.ok([...audio.voices].some(v=>v.name==='water-burst'));const count=context.sources.length;
  audio.handleEvent('burst',burst);assert.equal(context.sources.length,count);
  context.currentTime=.4;audio.stopEffects();
  audio.handleEvent('burst',{draw:true,impacts:[{slot:1,x:-2,relativeSpeed:1},{slot:2,x:2,relativeSpeed:2}]});
  const water=[...audio.voices].filter(v=>v.name==='water-burst');assert.equal(water.length,2);
  assert.ok(water.some(v=>v.pan.pan.value<0)&&water.some(v=>v.pan.pan.value>0));
});
test('observed swing rate is forwarded while legacy thrust events do not duplicate foley',()=>{
  const {audio}=setup();audio.configure(true,55,{music:0});
  assert.equal(audio.handleEvent('thrust',{slot:1}),false);
  audio.scene={reset(){},update(){return [{name:'blade-swish',x:-2,intensity:.4,rate:.75,priority:1}];}};
  audio.update({phase:'fight',fighters:[],scores:[0,0]});
  const voice=[...audio.voices][0];assert.equal(voice.name,'blade-swish');assert.equal(voice.source.playbackRate.value,.75);
});
test('hundreds of impacts keep the total source budget and release stolen nodes',()=>{
  const {audio,context}=setup({maxVoices:12});audio.configure(true,55);audio.setMusicPhase('fight');
  for(let n=0;n<400;n++)audio.play('metal',{x:n%2?-2:2,intensity:.6});
  assert.ok(audio.voices.size+audio.musicVoices.length<=12);
  assert.ok(context.sources.filter(s=>!s.stopped).length<=12);assert.ok(context.sources.some(s=>s.disconnected));
});
test('critical rupture cues survive a flood of lower priority foley',()=>{
  const {audio}=setup({maxVoices:8});audio.configure(true,55);audio.handleEvent('burst',{at:{x:-1},relativeSpeed:3});
  for(let n=0;n<30;n++)audio.play('wood',{priority:0});
  assert.ok([...audio.voices].some(v=>v.name==='puncture'));assert.ok([...audio.voices].some(v=>v.name==='tear'));
});
test('rupture does not invent a timed floor splash before any physical water impact',()=>{
  const {audio}=setup();audio.configure(true,55);audio.handleEvent('burst',{at:{x:-1}});
  assert.ok([...audio.voices].some(v=>v.name==='puncture'));assert.ok([...audio.voices].some(v=>v.name==='tear'));
  assert.ok([...audio.voices].every(v=>!['splash','drip','jet'].includes(v.name)));
});
test('demonstration results preserve the modal policy without a victory or defeat cue',()=>{
  const {audio}=setup();audio.configure(true,55);
  audio.handleEvent('matchover',{winner:2,demonstration:true},{phase:'matchover',mode:'solo',winner:2,demonstration:true});
  assert.equal(audio.musicMode,'lydian');assert.equal(audio.voices.size,0);
});
test('ended and elapsed sources disconnect and free their budget',()=>{
  const {audio,context}=setup();audio.configure(true,55);audio.play('wood');const voice=[...audio.voices][0];
  voice.source.onended();assert.equal(audio.voices.size,0);assert.ok(voice.source.disconnected);
  audio.play('wood');context.currentTime=20;audio.play('wood');assert.equal(audio.voices.size,1);
});
test('suspended contexts drop stale events and resume on unlock',async()=>{
  const {audio,context}=setup();context.state='suspended';audio.configure(true,55);audio.unlock();await Promise.resolve();
  assert.ok(context.resumeCount>0);assert.equal(audio.play('wood'),true);
});
test('remote enable cannot let an automatic resume block the later local gesture',async()=>{
  const {audio,context}=setup();let releaseAuto;context.state='suspended';
  context.resume=()=>{context.resumeCount++;if(context.resumeCount===1)return new Promise(resolve=>{releaseAuto=resolve;});
    context.state='running';return Promise.resolve();};
  audio.configure(true,55);
  for(let n=0;n<60;n++)audio.update({phase:'fight',fighters:[],scores:[0,0]});
  assert.equal(context.resumeCount,1);assert.equal(context.sources.length,0);
  audio.unlock();assert.equal(context.resumeCount,2,'El gesto local reintenta resume aunque el automático siga pendiente.');
  assert.equal(context.state,'running');assert.equal(audio.play('wood'),true);releaseAuto();await Promise.resolve();audio.dispose();
});
test('a rejected gesture does not clear the guard of the pending automatic resume',async()=>{
  const {audio,context}=setup();let releaseAuto;context.state='suspended';
  context.resume=()=>{context.resumeCount++;return context.resumeCount===1?new Promise(resolve=>{releaseAuto=resolve;}):Promise.reject(new Error('Blocked'));};
  audio.configure(true,55);audio.update({phase:'fight',fighters:[],scores:[0,0]});audio.unlock();
  await new Promise(resolve=>setImmediate(resolve));
  for(let n=0;n<60;n++)audio.update({phase:'fight',fighters:[],scores:[0,0]});
  assert.equal(context.resumeCount,2,'RAF no acumula más promesas mientras el automático sigue pendiente.');
  releaseAuto();await Promise.resolve();audio.dispose();
});
test('an interrupted context drops already scheduled impacts and modal transitions',()=>{
  const {audio,context}=setup();audio.configure(true,55);audio.setMusicPhase('ready','lydian');audio.play('metal');
  context.state='suspended';context.resume=()=>Promise.resolve();
  audio.update({phase:'fight',clock:1,fighters:[],scores:[0,0]});
  assert.equal(audio.voices.size,0);assert.equal(audio.musicVoices.length,0);
  context.state='running';audio.update({phase:'fight',clock:2,fighters:[],scores:[0,0]});
  assert.equal(audio.voices.size,0);assert.equal(audio.musicVoices.length,3);
});
test('closed context recreates its graph without nodes from previous context',()=>{
  const contexts=[new Context(),new Context()];let index=0;
  const audio=new GameAudio({contextFactory:()=>contexts[index++]});audio.configure(true,55);audio.play('metal');
  contexts[0].state='closed';audio.play('metal');assert.equal(audio.context,contexts[1]);assert.equal(audio.voices.size,1);
});
test('pause silences effects and score, resumes without stacking loops',()=>{
  const {audio}=setup();audio.configure(true,55);audio.setMusicPhase('fight');audio.play('wood');audio.setPaused(true);
  assert.equal(audio.voices.size,0);assert.equal(audio.musicVoices.length,0);assert.equal(audio.play('metal'),false);
  audio.setPaused(false);audio.setMusicPhase('fight');audio.setMusicPhase('fight');assert.equal(audio.musicVoices.length,3);
});
test('legacy tone names remain playable; unknown events fail closed',()=>{
  const {audio}=setup();audio.configure(true,55);for(const name of ['tap','clang','pop','go','thrust'])audio.tone(name);
  assert.ok(audio.voices.size>0);const count=audio.voices.size;assert.equal(audio.handleEvent('unknown'),false);assert.equal(audio.voices.size,count);
});
test('dispose releases its sources and allows later user unlock',()=>{
  const {audio,context}=setup();audio.configure(true,55);audio.setMusicPhase('ready');audio.play('metal');audio.dispose();
  assert.equal(audio.voices.size,0);assert.equal(audio.musicVoices.length,0);assert.equal(audio.context,null);assert.ok(context.sources.every(s=>s.stopped));
});
test('modal changes enter at the next bar with synchronized stems and bounded overlap',()=>{
  const {audio,context}=setup();audio.configure(true,55);audio.setMusicPhase('ready','lydian');context.currentTime=.6;
  audio.setMusicPhase('fight','dorian');assert.equal(audio.musicVoices.length,6);
  const arriving=audio.musicVoices.filter(v=>v.mode==='dorian');assert.equal(arriving.length,3);
  for(const voice of arriving){assert.ok(Math.abs(voice.source.started-2.52)<1e-8);assert.ok(Math.abs(voice.source.offset-2.5)<1e-8);}
  for(let n=0;n<100;n++)audio.setMusicPhase('fight','phrygian');assert.equal(audio.musicVoices.length,6);
  assert.equal(audio.musicVoices.filter(v=>v.mode==='phrygian').length,3,'latest requested mode replaces the unstarted arrival');
  audio.setMusicPhase('ready','lydian');assert.equal(audio.musicVoices.length,3,'returning to the active mode cancels the queued switch');
  audio.setMusicPhase('fight','phrygian');context.currentTime=3;audio.setMusicPhase('fight','phrygian');
  assert.equal(audio.musicVoices.length,3);assert.ok(audio.musicVoices.every(v=>v.mode==='phrygian'));
});
test('browser music loads local modal stems asynchronously without blocking effects',async()=>{
  const original=globalThis.fetch,urls=[];
  try{
    globalThis.fetch=async url=>{urls.push(url.pathname);return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};};
    const {audio,context}=setup();context.decodeAudioData=async()=>({duration:20,numberOfChannels:2});
    audio.configure(true,55);audio.setMusicPhase('ready','lydian');assert.equal(audio.musicVoices.length,0);
    assert.equal(audio.play('wood'),true);await audio.loadingMusic;
    assert.equal(urls.length,12);assert.ok(urls.every(p=>p.includes('/assets/audio/workshop-roda-v4/music-')));
    audio.setMusicPhase('fight','dorian');assert.equal(audio.musicVoices.length,3);assert.equal(audio.musicMode,'dorian');audio.dispose();
  }finally{globalThis.fetch=original;}
});
test('failed local music cancels sibling requests while effects remain usable',async()=>{
  const original=globalThis.fetch,signals=[];
  try{
    globalThis.fetch=async(url,{signal})=>{signals.push(signal);if(signals.length===1)throw new Error('Missing local stem');
      return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true}));};
    const {audio,context}=setup();context.decodeAudioData=async()=>({duration:20,numberOfChannels:2});
    audio.configure(true,55);audio.setMusicPhase('ready','lydian');await audio.loadingMusic;
    assert.equal(signals.length,12);assert.ok(signals.every(signal=>signal.aborted));assert.match(audio.musicError,/Missing/);
    assert.equal(audio.play('wood'),true);audio.dispose();
  }finally{globalThis.fetch=original;}
});
