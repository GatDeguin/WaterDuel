import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RecordedGameAudio,RECORDED_CUES} from '../public/audio/recorded-game-audio.js';
import {audioSHA256} from '../public/audio/recorded-effect-bank.js';

class Param {
  constructor(value=0){this.value=value;}
  setValueAtTime(value){assert.ok(Number.isFinite(value));this.value=value;}
  setTargetAtTime(value){this.setValueAtTime(value);}
  linearRampToValueAtTime(value){this.setValueAtTime(value);}
  cancelScheduledValues(){}
}
class Node {
  constructor(){this.gain=new Param(1);this.playbackRate=new Param(1);this.pan=new Param();}
  connect(node){return node;}
  disconnect(){this.disconnected=true;}
  start(time){this.started=time;}
  stop(){this.stopped=true;}
}
class Context {
  constructor(state='running'){
    this.state=state;this.currentTime=0;this.sampleRate=48000;this.destination=new Node();this.sources=[];this.listeners=new Set();this.allocations=0;this.resumes=0;
    this.listener={};for(const key of ['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'])this.listener[key]=new Param();
  }
  addEventListener(type,fn){if(type==='statechange')this.listeners.add(fn);}
  removeEventListener(type,fn){if(type==='statechange')this.listeners.delete(fn);}
  changeState(state){this.state=state;for(const fn of [...this.listeners])fn();}
  createGain(){return new Node();}
  createWaveShaper(){return new Node();}
  createDynamicsCompressor(){const node=new Node();for(const key of ['threshold','knee','ratio','attack','release'])node[key]=new Param();return node;}
  createPanner(){const node=new Node();for(const key of ['positionX','positionY','positionZ'])node[key]=new Param();return node;}
  createBufferSource(){const node=new Node();this.sources.push(node);return node;}
  createBuffer(channels,length,sampleRate){
    assert.ok(!this.forbidBuffers,'no sample buffer during gameplay');this.allocations++;const samples=new Float32Array(length);
    return {numberOfChannels:channels,length,sampleRate,duration:length/sampleRate,getChannelData:()=>samples};
  }
  resume(){this.resumes++;return Promise.resolve();}
  close(){this.changeState('closed');return Promise.resolve();}
}
const digest=bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
function clockFixture(){
  let serial=0,now=0;const timers=new Map();
  return {now:()=>now,setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});if(ms===0)queueMicrotask(()=>{if(timers.delete(id))fn();});return id;},clearTimeout:id=>timers.delete(id),
    expire(){for(const [id,{fn,ms}]of [...timers])if(ms>0&&timers.delete(id)){now+=ms;fn();}}};
}
function bankFixture(){
  const samples=new Map(),manifest={schemaVersion:1,cues:{}};
  for(const [nameIndex,name]of RECORDED_CUES.entries())manifest.cues[name]=[0,1,2].map(variant=>{
    const file=`${name}-${variant}.wav`,bytes=Uint8Array.of(nameIndex,variant,91,73).buffer;samples.set(file,bytes);
    return {file,sha256:digest(bytes),sampleRate:variant===0?44100:48000,duration:.12,bytes:bytes.byteLength};
  });
  return {manifest,samples};
}
function setup({fetcher,decoder,context=new Context(),workerFactory, ...options}={}){
  const bank=bankFixture(),clock=clockFixture(),requests=[];let decodes=0,contexts=0;
  const fetch=fetcher??(async url=>{requests.push(String(url));return String(url).endsWith('manifest.json')?{ok:true,json:async()=>bank.manifest}:{ok:true,arrayBuffer:async()=>bank.samples.get(new URL(url).pathname.split('/').at(-1)).slice(0)};});
  const decode=decoder??(async(ctx,bytes)=>{decodes++;assert.ok(!ctx.forbidBuffers,'no decode during gameplay');return {...ctx.createBuffer(1,5760,48000),marker:[...new Uint8Array(bytes)]};});
  const audio=new RecordedGameAudio({contextFactory:()=>{contexts++;return context;},recordedManifestURL:'https://game.test/audio/manifest.json',fetch,decode,clock,random:()=>.5,
    workerFactory:workerFactory??(()=>null),...options});
  return {audio,context,bank,clock,requests,get decodes(){return decodes;},get contexts(){return contexts;}};
}
async function prepared(options={}){
  const fixture=setup(options);fixture.audio.configure(true,55,{music:0});fixture.audio.unlock();await fixture.audio.prepareRecordings();await fixture.audio.prepareEffects();return fixture;
}

test('disabled, zero-volume and effects-muted configurations perform no recording I/O',async()=>{
  const f=setup();assert.equal(await f.audio.prepareRecordings(),false);assert.equal(f.requests.length,0);assert.equal(f.contexts,0);
  for(const [volume,effects]of [[0,1],[55,0]]){f.audio.configure(true,volume,{effects,music:0});f.audio.unlock();assert.equal(f.requests.length,0);}
  f.audio.dispose();
});

test('all 66 recordings publish atomically and first contacts never decode or create sample buffers',async()=>{
  const f=await prepared(),{audio,context}=f;assert.equal(audio.recordedState,'ready');assert.equal(audio.recordedProgress.ready,66);assert.equal(audio.recordedBuffers.size,66);
  const decodes=f.decodes,allocations=context.allocations;context.forbidBuffers=true;
  for(const cue of RECORDED_CUES){assert.equal(audio.play(cue,{x:-1.2,y:2.1,z:.6}),true);const voice=[...audio.voices].at(-1);assert.ok(voice.source.buffer.marker);assert.equal(voice.pan.panningModel,'HRTF');assert.equal(voice.pan.positionZ.value,.6);}
  assert.equal(f.decodes,decodes);assert.equal(context.allocations,allocations);assert.ok(audio.voices.size<=24);audio.dispose();
});

test('preparation drops transients without consuming variants, gates or voices, and does not expose a partial bank',async()=>{
  let release;const held=new Promise(resolve=>{release=resolve;});const f=setup({decoder:async(ctx,bytes)=>{await held;return ctx.createBuffer(1,5760,48000);}}),{audio}=f;
  audio.configure(true,55,{music:0});audio.unlock();await audio.prepareEffects();
  assert.equal(audio.play('wood'),false);assert.equal(audio.handleEvent('clang',{at:{x:0}}),false);assert.equal(audio.serial,0);assert.equal(audio.contactTimes.size,0);assert.equal(audio.voices.size,0);assert.equal(audio.recordedBuffers.size,0);
  release();await audio.prepareRecordings();assert.equal(audio.recordedState,'ready');assert.equal(audio.recordedBuffers.size,66);audio.dispose();
});

test('each recorded cue rotates three independent takes even when bursts contain exactly three layers',async()=>{
  const {audio}=await prepared(),seen={};
  for(let i=0;i<3;i++)for(const name of ['puncture','tear','water-burst']){const buffer=audio.effectBuffer(name);(seen[name]??=[]).push(buffer.marker[1]);}
  for(const variants of Object.values(seen))assert.deepEqual(variants,[0,1,2]);audio.dispose();
});

test('failed recording load uses prebuilt historical fallback and a retry publishes a complete real bank',async()=>{
  const f=setup(),{audio,bank}=f;bank.manifest.cues.wood[0].sha256='0'.repeat(64);audio.configure(true,55,{music:0});audio.unlock();
  assert.equal(await audio.prepareRecordings(),false);await audio.prepareEffects();assert.equal(audio.recordedState,'error');assert.equal(audio.recordedBuffers.size,0);assert.ok(audio.recordedError);f.context.forbidBuffers=true;
  assert.equal(audio.play('wood'),true);assert.ok(![...audio.voices].at(-1).source.buffer.marker);bank.manifest.cues.wood[0].sha256=digest(bank.samples.get('wood-0.wav'));f.context.forbidBuffers=false;
  assert.equal(await audio.retryRecordings(),true);assert.equal(audio.recordedBuffers.size,66);audio.dispose();
});

test('mute cancels a hung fetch promptly and late completion cannot publish into a new context',async()=>{
  let finish;const f=setup({fetcher:()=>new Promise(resolve=>{finish=resolve;})}),{audio}=f;audio.configure(true,55,{music:0});audio.unlock();const pending=audio.prepareRecordings();
  audio.configure(false,55);assert.equal(await pending,false);assert.equal(audio.recordedState,'idle');finish({ok:true,json:async()=>f.bank.manifest});await Promise.resolve();assert.equal(audio.recordedBuffers.size,0);audio.dispose();
});

test('timeout is explicit, bounded and retryable without per-impact I/O storms',async()=>{
  const f=setup({fetcher:()=>new Promise(()=>{})}),{audio,clock}=f;audio.configure(true,55,{music:0});audio.unlock();const pending=audio.prepareRecordings();clock.expire();assert.equal(await pending,false);
  assert.equal(audio.recordedState,'error');assert.match(audio.recordedError,/timeout/i);for(let i=0;i<20;i++)audio.play('wood');assert.equal(audio.recordedState,'error');audio.dispose();
});

test('pause and suspended autoplay retain the completed bank without voices or automatic resume storms',async()=>{
  const f=await prepared({context:new Context('suspended')}),{audio,context}=f,bank=audio.recordedBuffers;assert.equal(context.sources.length,0);const resumes=context.resumes;
  for(let i=0;i<10;i++)audio.update({phase:'fight',fighters:[],scores:[0,0]});assert.ok(context.resumes-resumes<=1);audio.setPaused(true);assert.equal(audio.recordedBuffers,bank);
  context.changeState('running');audio.setPaused(false);assert.equal(audio.play('wood'),true);audio.dispose();
});

test('closed context immediately discards recordings and a held decode cannot publish stale data',async()=>{
  let release;const f=setup({decoder:()=>new Promise(resolve=>{release=resolve;})}),{audio,context}=f;audio.configure(true,55,{music:0});audio.unlock();const pending=audio.prepareRecordings();
  for(let i=0;i<12&&!release;i++)await Promise.resolve();context.changeState('closed');assert.equal(await pending,false);assert.equal(audio.recordedBuffers.size,0);assert.equal(audio.recordedState,'idle');release?.(context.createBuffer(1,5760,48000));await Promise.resolve();assert.equal(audio.recordedBuffers.size,0);audio.dispose();
});

test('invalid manifest, stereo files and nonfinite PCM fail atomically before gameplay',async()=>{
  for(const kind of ['missing','traversal','stereo','nan']){
    const f=setup({decoder:async(ctx,bytes)=>{const buffer=ctx.createBuffer(kind==='stereo'?2:1,5760,48000);if(kind==='nan')buffer.getChannelData(0)[5]=NaN;return buffer;}}),{audio,bank}=f;
    if(kind==='missing')delete bank.manifest.cues.splash;if(kind==='traversal')bank.manifest.cues.wood[0].file='../outside.wav';audio.configure(true,55,{music:0});audio.unlock();
    assert.equal(await audio.prepareRecordings(),false,kind);assert.equal(audio.recordedBuffers.size,0,kind);audio.dispose();
  }
});

test('offline HTTP SHA-256 matches independent vectors across padding and block boundaries',async()=>{
  for(const size of [0,3,55,56,63,64,65,127,128,10003]){
    const bytes=Uint8Array.from({length:size},(_,i)=>(i*31+17)%256).buffer;
    assert.equal(await audioSHA256(bytes,null),digest(bytes));
  }
});

test('integrity is checked before a decoder detaches its input bytes',async()=>{
  let decoded=0;const f=await prepared({decoder:async(context,bytes)=>{
    const copy=structuredClone(bytes,{transfer:[bytes]});assert.equal(bytes.byteLength,0);decoded++;
    return {...context.createBuffer(1,5760,48000),marker:[...new Uint8Array(copy)]};
  }});assert.equal(decoded,66);assert.equal(f.audio.recordedState,'ready');f.audio.dispose();
});

test('recordings use the inherited physical burst timing, voice priorities and contact cooldowns',async()=>{
  const {audio,context}=await prepared(),data={loser:2,relativeSpeed:2,at:{x:1.2,y:2.1,z:.6}};
  assert.equal(audio.handleEvent('burst',data),true);const voices=[...audio.voices];assert.equal(voices.length,3);
  assert.deepEqual(voices.map(voice=>voice.name),['puncture','tear','water-burst']);assert.deepEqual(voices.map(voice=>voice.start),[0,.018,.04]);
  for(const voice of voices){assert.equal(voice.priority,3);assert.equal(voice.pan.positionX.value,1.2);assert.equal(voice.pan.positionY.value,2.1);assert.equal(voice.pan.positionZ.value,.6);}
  assert.equal(audio.handleEvent('burst',data),false);assert.equal(audio.voices.size,3);context.currentTime=.3;assert.equal(audio.handleEvent('burst',data),true);audio.dispose();
});

test('the six tonal cues keep the prepared historical buffers and music settings remain inherited',async()=>{
  const {audio,context}=await prepared();context.forbidBuffers=true;
  for(const name of ['countdown','go','victory','defeat','draw','ui']){assert.equal(audio.play(name),true);assert.ok(![...audio.voices].at(-1).source.buffer.marker);}
  assert.equal(audio.musicVolume,0);assert.equal(audio.musicVoices.length,0);assert.equal(audio.maxVoices,24);audio.dispose();
});

test('closing a ready context releases its whole bank and reopening builds a fresh owned bank',async()=>{
  const f=await prepared(),{audio,context}=f,old=audio.effectBuffer('wood');context.changeState('closed');
  assert.equal(audio.recordedBuffers.size,0);assert.equal(audio.context,null);assert.equal(audio.effectsAvailable,false);
  const replacement=new Context();audio.contextFactory=()=>replacement;audio.unlock();await audio.prepareRecordings();await audio.prepareEffects();
  assert.equal(audio.context,replacement);assert.equal(audio.recordedState,'ready');assert.notEqual(audio.effectBuffer('wood'),old);audio.dispose();
});
