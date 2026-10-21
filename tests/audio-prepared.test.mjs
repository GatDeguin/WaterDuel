import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GameAudio} from '../public/game-audio.js';

const manifests=await Promise.all(['workshop','foley-v2'].map(async folder=>JSON.parse(await readFile(
  new URL('../public/assets/audio/'+folder+'/manifest.json',import.meta.url),'utf8'))));
const frames=new Map(manifests.flatMap(manifest=>manifest.files.filter(file=>file.kind==='effect').map(file=>[file.name,file.frames])));
class Param {
  constructor(value=0){this.value=value;}
  setValueAtTime(value){this.value=value;}
  setTargetAtTime(value){this.value=value;}
  linearRampToValueAtTime(value){this.value=value;}
  cancelScheduledValues(){}
}
class AudioNode {
  constructor(){this.gain=new Param(1);this.pan=new Param();this.playbackRate=new Param(1);}
  connect(node){return node;}
  disconnect(){this.disconnected=true;}
  start(time,offset=0){this.started=time;this.offset=offset;}
  stop(){this.stopped=true;}
}
class Context {
  constructor(){this.state='running';this.currentTime=0;this.destination=new AudioNode();this.sources=[];this.allocations=0;this.resumeCount=0;this.listeners=new Set();}
  addEventListener(type,listener){if(type==='statechange')this.listeners.add(listener);}
  removeEventListener(type,listener){if(type==='statechange')this.listeners.delete(listener);}
  setState(state){this.state=state;for(const listener of [...this.listeners])listener();}
  createGain(){return new AudioNode();}
  createStereoPanner(){return new AudioNode();}
  createWaveShaper(){return new AudioNode();}
  createDynamicsCompressor(){const node=new AudioNode();for(const key of ['threshold','knee','ratio','attack','release'])node[key]=new Param();return node;}
  createBufferSource(){const node=new AudioNode();this.sources.push(node);return node;}
  createBuffer(channels,length,sampleRate){this.allocations++;const data=Array.from({length:channels},()=>new Float32Array(length));
    return {numberOfChannels:channels,length,sampleRate,duration:length/sampleRate,getChannelData:index=>data[index]};}
  resume(){this.resumeCount++;return Promise.resolve();}
  close(){this.state='closed';return Promise.resolve();}
}
function clockFixture(){
  let serial=0,time=0;const timers=new Map();
  return {now:()=>{time+=.01;return time;},setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,delay});
    if(delay===0)queueMicrotask(()=>{if(timers.delete(id))fn();});return id;},clearTimeout:id=>timers.delete(id),
    expire(){for(const [id,{fn,delay}]of timers)if(delay>0){timers.delete(id);time+=delay;fn();}},get pending(){return timers.size;}};
}
class FakeWorker {
  constructor(mode='auto'){this.mode=mode;this.requests=[];this.terminated=false;}
  postMessage(request){this.requests.push(request);if(this.mode==='hold')return;
    queueMicrotask(()=>{
      if(this.mode==='error'){this.onerror?.({message:'Worker broke',preventDefault(){}});return;}
      const samples=new Float32Array(this.mode==='invalid'?1:frames.get(request.name));
      this.onmessage?.({data:{type:'sample',name:request.name,variant:request.variant,sampleRate:22050,samples:samples.buffer}});
    });
  }
  terminate(){this.terminated=true;}
}
function setup({mode='auto',factory,context=new Context(),...options}={}){
  const workers=[],clock=clockFixture();let contexts=0;
  const audio=new GameAudio({contextFactory:()=>{contexts++;return context;},random:()=>.5,clock,
    workerFactory:factory??(()=>{const worker=new FakeWorker(mode);workers.push(worker);return worker;}),...options});
  return {audio,context,workers,clock,get contexts(){return contexts;}};
}
async function ready(options={}){const fixture=setup(options);fixture.audio.configure(true,55,{music:0});fixture.audio.unlock();
  assert.equal(await fixture.audio.loadingEffects,true);assert.equal(fixture.audio.effectsState,'ready');return fixture;}

test('experimental preparation stays idle with audio disabled and no context or worker',()=>{
  let contexts=0,workers=0;
  const audio=new GameAudio({contextFactory:()=>{contexts++;return null;},workerFactory:()=>{workers++;return null;}});
  assert.equal(audio.effectsState,'idle');
  assert.equal(audio.effectsReady,false);
  assert.equal(audio.context,null);
  assert.equal(audio.play('wood'),false);
  assert.equal(contexts,0);assert.equal(workers,0);
});

test('preparation publishes exactly 84 buffers atomically and creates no voices',async()=>{
  const {audio,context,workers,clock}=setup();audio.configure(true,55,{music:0});
  assert.equal(audio.context,null);assert.equal(workers.length,0);audio.unlock();
  assert.equal(audio.effectsState,'preparing');assert.equal(audio.buffers.size,0);
  const loading=audio.loadingEffects;assert.equal(audio.prepareEffects(),loading);assert.equal(await loading,true);
  assert.equal(audio.effectsReady,true);assert.equal(audio.buffers.size,84);assert.equal(context.allocations,84);
  assert.equal(audio.effectsProgress.ready,84);assert.equal(audio.effectsProgress.total,84);
  assert.equal(context.sources.length,0);assert.equal(workers.length,1);assert.ok(workers[0].terminated);
  assert.equal(workers[0].requests.length,84);assert.equal(clock.pending,0);
  assert.equal(audio.effectsPreparationMetrics.bytes,4810452);
  assert.ok(Number.isFinite(audio.effectsPreparationMetrics.maxCopyMs));audio.dispose();
});

test('ready playback never synthesizes or allocates a buffer and preserves global variant order',async()=>{
  const {audio,context,workers}=await ready();
  context.createBuffer=()=>{throw new Error('Playback allocated an AudioBuffer');};
  const variants=[];
  for(const name of ['wood','tear','wood','water-burst','tear','wood']){
    const variant=audio.serial%3;assert.equal(audio.play(name),true);
    const voice=[...audio.voices].at(-1);assert.equal(voice.source.buffer,audio.buffers.get(name+':'+variant));variants.push(variant);
  }
  assert.deepEqual(variants,[0,1,2,0,1,2]);assert.equal(workers[0].requests.length,84);assert.equal(audio.serial,6);audio.dispose();
});

test('ready playback visits all 84 preloaded keys with createBuffer forbidden',async()=>{
  const {audio,context}=await ready();context.createBuffer=()=>{throw new Error('Playback allocated an AudioBuffer');};
  const visited=new Set();
  for(const name of frames.keys())for(let variant=0;variant<3;variant++){
    assert.equal(audio.play(name),true);const key=name+':'+variant;visited.add(key);
    assert.equal([...audio.voices].at(-1).source.buffer,audio.buffers.get(key));
  }
  assert.equal(visited.size,84);assert.equal(audio.serial,84);audio.dispose();
});

test('prepared rupture preserves nominal delays, gain, rate, panning and critical voice priority',async()=>{
  const {audio,context}=await ready({maxVoices:8});context.currentTime=2;
  assert.equal(audio.handleEvent('burst',{at:{x:-2},loser:1,relativeSpeed:2}),true);
  const burst=[...audio.voices];assert.deepEqual(burst.map(v=>v.name),['puncture','tear','water-burst']);
  assert.deepEqual(burst.map(v=>v.start),[2,2.018,2.04]);assert.ok(burst.every(v=>v.priority===3&&v.pan.pan.value<0));
  assert.equal(burst[0].gain.gain.value,.3);assert.equal(burst[2].source.playbackRate.value,.99);
  for(let i=0;i<50;i++)audio.play('wood',{priority:0});
  assert.ok(audio.voices.size<=8);assert.ok(burst.every(v=>audio.voices.has(v)));audio.dispose();
});

test('preparation drops transient events without serial, cooldown or scene backlog',async()=>{
  const {audio,context}=setup();audio.configure(true,55,{music:0});audio.unlock();
  let resets=0,observations=0;audio.scene={reset(){resets++;},update(){observations++;return [{name:'wood'}];}};
  const game={phase:'fight',scores:[0,0],fighters:[]};
  assert.equal(audio.handleEvent('burst',{loser:1,relativeSpeed:2}),false);assert.equal(audio.update(game),0);
  assert.equal(audio.serial,0);assert.equal(audio.contactTimes.size,0);assert.equal(observations,0);assert.equal(context.sources.length,0);
  await audio.loadingEffects;assert.ok(resets>=2);assert.equal(context.sources.length,0);
  assert.equal(audio.handleEvent('burst',{loser:1,relativeSpeed:2}),true);assert.equal(audio.serial,3);audio.dispose();
});

test('suspended context preparation does not bypass autoplay or retry resume per frame',async()=>{
  const context=new Context();context.state='suspended';let releaseResume;
  context.resume=()=>{context.resumeCount++;return new Promise(resolve=>{releaseResume=resolve;});};
  const {audio}=setup({context});audio.configure(true,55,{music:0});audio.unlock({gesture:false});await audio.loadingEffects;
  assert.equal(audio.effectsReady,true);assert.equal(context.state,'suspended');
  for(let i=0;i<60;i++)assert.equal(audio.play('wood'),false);
  assert.equal(context.resumeCount,1);assert.equal(context.sources.length,0);audio.unlock();assert.equal(context.resumeCount,2);
  releaseResume();audio.dispose();
});

test('mute during a worker task cancels it, ignores late messages and releases buffers',async()=>{
  const {audio,workers,clock}=setup({mode:'hold'});audio.configure(true,55,{music:0});audio.unlock();
  const loading=audio.loadingEffects,worker=workers[0],late=worker.onmessage;audio.configure(false,55);
  assert.equal(await loading,false);assert.ok(worker.terminated);assert.equal(audio.effectsState,'idle');assert.equal(clock.pending,0);
  late({data:{type:'sample',name:'wood',variant:0,sampleRate:22050,samples:new Float32Array(frames.get('wood')).buffer}});
  await Promise.resolve();assert.equal(audio.buffers.size,0);assert.equal(audio.effectsReady,false);audio.dispose();
});

test('cancellation also discards a received sample whose copy task has not run',async()=>{
  const {audio,context,workers,clock}=setup({mode:'hold'});audio.configure(true,55,{music:0});audio.unlock();
  const loading=audio.loadingEffects;
  workers[0].onmessage({data:{type:'sample',name:'wood',variant:0,sampleRate:22050,samples:new Float32Array(frames.get('wood')).buffer}});
  audio.configure(false,55);await loading;await Promise.resolve();
  assert.equal(context.allocations,0);assert.equal(clock.pending,0);assert.equal(audio.buffers.size,0);audio.dispose();
});

test('disable between final copy and ready publication cannot publish a stale bank',async()=>{
  const {audio,context}=setup(),allocate=context.createBuffer.bind(context);
  context.createBuffer=(...args)=>{const buffer=allocate(...args);if(context.allocations===84)queueMicrotask(()=>audio.configure(false,55));return buffer;};
  audio.configure(true,55,{music:0});audio.unlock();const loading=audio.loadingEffects;
  assert.equal(await loading,false);assert.equal(audio.effectsState,'idle');assert.equal(audio.buffers.size,0);audio.dispose();
});

test('muting after ready frees effect bank and a later enable prepares exactly once',async()=>{
  const {audio,workers}=await ready();audio.play('wood');audio.configure(false,55,{music:0});
  assert.equal(audio.voices.size,0);assert.equal(audio.buffers.size,0);assert.equal(audio.effectsState,'idle');
  audio.configure(true,55,{music:0});await audio.loadingEffects;assert.equal(workers.length,2);assert.equal(audio.effectsReady,true);audio.dispose();
});

test('volume zero and effects zero never prepare until audible configuration returns',async()=>{
  const {audio,workers}=setup();audio.configure(true,0,{music:0});audio.unlock();assert.equal(workers.length,0);
  audio.configure(true,55,{music:0,effects:0});audio.unlock();assert.equal(workers.length,0);
  audio.configure(true,55,{music:0,effects:1});await audio.loadingEffects;assert.equal(workers.length,1);assert.equal(audio.effectsReady,true);
  audio.configure(true,0);assert.equal(audio.effectsState,'idle');assert.equal(audio.buffers.size,0);audio.dispose();
});

for(const mode of ['error','invalid'])test(mode+' response fails preparation atomically without a frame retry storm',async()=>{
  const {audio,workers,clock}=setup({mode});audio.configure(true,55,{music:0});audio.unlock();assert.equal(await audio.loadingEffects,false);
  assert.equal(audio.effectsState,'error');assert.ok(audio.effectsError);assert.equal(audio.buffers.size,0);assert.ok(workers[0].terminated);
  for(let i=0;i<100;i++)assert.equal(audio.play('wood'),false);
  assert.equal(workers.length,1);assert.equal(clock.pending,0);audio.dispose();
});

test('timeout terminates the worker and remains explicit until a fresh enable',async()=>{
  const {audio,workers,clock}=setup({mode:'hold',effectsTimeoutMs:50});audio.configure(true,55,{music:0});audio.unlock();
  const loading=audio.loadingEffects;clock.expire();assert.equal(await loading,false);
  assert.equal(audio.effectsState,'error');assert.match(audio.effectsError,/timeout|plazo/i);assert.ok(workers[0].terminated);
  assert.equal(audio.play('wood'),false);assert.equal(workers.length,1);audio.dispose();
});

test('no Worker uses immediate explicit legacy fallback and preserves the first synchronous play',async()=>{
  const {audio,context}=setup({factory:()=>null});audio.configure(true,55,{music:0});
  assert.equal(audio.play('wood'),true);assert.equal(context.allocations,1);await audio.loadingEffects;
  assert.equal(audio.effectsState,'legacy-fallback');assert.equal(audio.effectsReady,false);
  assert.equal(audio.buffers.size,1);audio.dispose();
});

test('settling immediate legacy fallback preserves the first contact cooldown across microtasks',async()=>{
  const {audio}=setup({factory:()=>null});audio.configure(true,55,{music:0});
  let observed=0;audio.scene={reset(){observed=0;},update(){observed++;return [];}};
  const contact={material:'wood',bodyA:'blade',bodyB:'body',impulse:.06,closingSpeed:.8,at:{x:-1}};
  assert.equal(audio.handleEvent('material-contact',contact),true);assert.equal(audio.serial,1);
  audio.update({phase:'fight',scores:[0,0],fighters:[]});assert.equal(observed,1);
  await audio.loadingEffects;
  assert.equal(observed,1,'Promise settlement must preserve the active observer baseline.');
  assert.equal(audio.handleEvent('material-contact',contact),false);assert.equal(audio.serial,1);audio.dispose();
});

test('dispose and closed context discard staged banks, then a new context can prepare',async()=>{
  const contexts=[new Context(),new Context()],workers=[],clock=clockFixture();let index=0;
  const audio=new GameAudio({contextFactory:()=>contexts[index++],clock,workerFactory:()=>{const worker=new FakeWorker();workers.push(worker);return worker;}});
  audio.configure(true,55,{music:0});audio.unlock();const oldLoading=audio.loadingEffects;contexts[0].state='closed';audio.unlock();
  assert.equal(await oldLoading,false);assert.ok(workers[0].terminated);assert.equal(await audio.loadingEffects,true);
  assert.equal(audio.context,contexts[1]);assert.equal(audio.buffers.size,84);audio.dispose();
  assert.equal(audio.context,null);assert.equal(audio.buffers.size,0);assert.equal(audio.effectsState,'idle');assert.equal(clock.pending,0);
});

test('pause keeps a ready bank while suppressing voices and resumes without another preparation',async()=>{
  const {audio,workers}=await ready();audio.play('wood');audio.setPaused(true);assert.equal(audio.voices.size,0);
  assert.equal(audio.effectsReady,true);assert.equal(audio.buffers.size,84);audio.setPaused(false);assert.equal(audio.play('wood'),true);
  assert.equal(workers.length,1);audio.dispose();
});

test('closed statechange releases a paused ready bank without another unlock or frame',async()=>{
  const {audio,context,clock}=await ready();audio.setPaused(true);context.setState('closed');
  assert.equal(audio.context,null);assert.equal(audio.effectsState,'idle');assert.equal(audio.buffers.size,0);
  assert.equal(clock.pending,0);assert.equal(context.listeners.size,0);
});

test('closed statechange cancels a hung worker immediately without another unlock or frame',async()=>{
  const {audio,context,workers,clock}=setup({mode:'hold'});audio.configure(true,55,{music:0});audio.unlock();
  const loading=audio.loadingEffects;audio.setPaused(true);context.setState('closed');
  assert.equal(await loading,false);assert.ok(workers[0].terminated);assert.equal(audio.context,null);
  assert.equal(audio.effectsState,'idle');assert.equal(audio.buffers.size,0);assert.equal(clock.pending,0);
});

test('suspended statechange retains an ongoing preparation and its finished bank',async()=>{
  const {audio,context,workers}=setup();audio.configure(true,55,{music:0});audio.unlock();
  const loading=audio.loadingEffects;context.setState('suspended');assert.equal(await loading,true);
  assert.equal(audio.effectsReady,true);assert.equal(audio.context,context);assert.equal(workers.length,1);
  context.setState('suspended');assert.equal(audio.effectsReady,true);assert.equal(audio.buffers.size,84);audio.dispose();
});

test('music decodes and plays independently while effects preparation is still pending',async()=>{
  const originalFetch=globalThis.fetch,urls=[];
  try{
    globalThis.fetch=async url=>{urls.push(url.pathname);return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};};
    const {audio,context}=setup({mode:'hold'});context.decodeAudioData=async()=>({duration:20,numberOfChannels:2});
    audio.configure(true,55);audio.setMusicPhase('ready');await audio.loadingMusic;audio.setMusicPhase('ready');
    assert.equal(audio.effectsState,'preparing');assert.equal(audio.musicReady,true);assert.equal(audio.musicVoices.length,3);
    assert.equal(urls.length,12);assert.ok(urls.every(url=>/\/assets\/audio\/workshop-score-v3\/music-(lydian|dorian|aeolian|phrygian)-(wood|metal|bass)\.wav$/.test(url)));audio.dispose();
  }finally{globalThis.fetch=originalFetch;}
});

