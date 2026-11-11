import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AUDIO_EFFECTS,ALL_EFFECTS_MASK,validEffectMask,effectEnabled,setEffectEnabled} from '../public/audio/effect-controls.js';
import {WorkshopGameAudio} from '../public/audio/workshop-game-audio.js';

class Param{constructor(value=0){this.value=value;}setValueAtTime(v){this.value=v;}setTargetAtTime(v){this.value=v;}cancelScheduledValues(){}}
class Node{
  constructor(kind){this.kind=kind;this.gain=new Param(1);this.pan=new Param();this.delayTime=new Param();this.frequency=new Param();this.Q=new Param();this.playbackRate=new Param(1);this.connections=[];this.stopped=false;this.stops=[];}
  connect(node){this.connections.push(node);return node;}disconnect(node){this.connections=node?this.connections.filter(n=>n!==node):[];this.disconnected=true;}
  start(at){this.started=at;}stop(at){this.stops.push(at);this.stopped=at===undefined;}
}
class Context{
  constructor(){this.currentTime=0;this.sampleRate=48000;this.state='running';this.nodes=[];this.destination=this.node('destination');this.listener={};this.buffers=0;this.decodes=0;}
  node(kind){const n=new Node(kind);this.nodes.push(n);return n;}
  createGain(){return this.node('gain');}createWaveShaper(){return this.node('shaper');}createDelay(){return this.node('delay');}createBiquadFilter(){return this.node('filter');}createStereoPanner(){return this.node('stereo');}
  createPanner(){const n=this.node('panner');for(const key of ['positionX','positionY','positionZ'])n[key]=new Param();return n;}
  createDynamicsCompressor(){const n=this.node('compressor');for(const key of ['threshold','knee','ratio','attack','release'])n[key]=new Param();return n;}
  createBufferSource(){return this.node('sample');}createMediaElementSource(){return this.node('media');}
  createBuffer(){this.buffers++;throw Error('switches must not build samples');}decodeAudioData(){this.decodes++;throw Error('switches must not decode');}
  addEventListener(){}removeEventListener(){}resume(){return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
}
class Media{
  constructor(){this.currentTime=0;this.paused=true;this.plays=0;this.loads=0;this.listeners=new Map();}
  addEventListener(type,fn){this.listeners.set(type,fn);}removeEventListener(type){this.listeners.delete(type);}removeAttribute(name){if(name==='src')this.src='';}
  load(){this.loads++;}play(){this.paused=false;this.plays++;return Promise.resolve();}pause(){this.paused=true;}
}
function fixture(){
  const context=new Context(),media=[],lookups=[];let contexts=0;
  const audio=new WorkshopGameAudio({contextFactory:()=>{contexts++;return context;},mediaFactory:()=>{const m=new Media();media.push(m);return m;},random:()=>.5});
  audio.prepareEffects=()=>{audio.effectsState='ready';return Promise.resolve(true);};audio.prepareRecordings=()=>{audio.recordedState='ready';return Promise.resolve(true);};
  audio.effectBuffer=name=>{lookups.push(name);return {duration:.5};};
  return {audio,context,media,lookups,get contexts(){return contexts;}};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const combatEffects=AUDIO_EFFECTS.filter(({id})=>id!=='thunder');

test('El volumen de truenos ajusta voces activas sin tocar otros efectos y conserva la acústica compartida',async()=>{
  const {audio}=fixture();
  audio.recordedFetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)});
  audio.recordedDecode=async()=>({duration:2});
  audio.configure(true,55,{music:0,effects:.8,thunder:.5,distortion:.12,reverb:.3});
  const game={phase:'fight',clock:3,weatherStart:0,weather:'storm',fighters:[]};
  audio.update(game);await turn();
  game.clock=3.66;
  assert.equal(audio.update(game),1);
  const [thunder]=audio.voices;
  assert.equal(thunder.gain.gain.value,.6*.84*.5);
  assert.ok(thunder.pan.connections.includes(audio.effects));
  assert.ok(audio.effects.connections.includes(audio.fxRack.shaper));
  assert.ok(audio.fxRack.shaper.connections.includes(audio.fxRack.roomInput));
  audio.configure(true,55,{thunder:.25});
  assert.equal(thunder.gain.gain.value,.6*.84*.25);
  assert.equal(audio.effects.gain.value,.8);
  assert.equal(audio.fxRack.distortion,.12);
  assert.equal(audio.fxRack.reverb,.3);
  audio.configure(true,55,{thunder:0});
  assert.equal(thunder.gain.gain.value,0);
  game.clock=10.11;
  assert.equal(audio.update(game),0);
  assert.equal(audio.voices.size,1);
  audio.dispose();
});

test('El trueno respeta su propio interruptor, la pausa y el reloj de cada tormenta',async()=>{
  const wav=await readFile(new URL('../public/assets/audio/weather/thunder.wav',import.meta.url));
  const {audio}=fixture();let requests=0;
  audio.effectBuffer=WorkshopGameAudio.prototype.effectBuffer;
  audio.recordedFetch=async url=>{
    assert.match(url.pathname,/\/weather\/thunder\.wav$/);
    requests++;
    return {ok:true,arrayBuffer:async()=>wav.buffer.slice(wav.byteOffset,wav.byteOffset+wav.byteLength)};
  };
  audio.recordedDecode=async (_context,bytes)=>{
    const data=Buffer.from(bytes);
    assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WAVE');
    assert.ok(data.subarray(44).some(sample=>sample!==0));
    return {duration:data.readUInt32LE(40)/data.readUInt32LE(28)};
  };
  const onlyThunder=setEffectEnabled(0,'thunder',true),onlyWood=setEffectEnabled(0,'wood',true);
  audio.configure(true,55,{music:0,effectMask:onlyWood});
  const game={phase:'ready',clock:102.9,weatherStart:100,weather:'storm',fighters:[]};
  audio.update(game);await turn();assert.equal(requests,0,'other effects cannot enable a thunder load');
  audio.configure(true,55,{effectMask:onlyThunder});
  audio.update(game);await turn();
  assert.equal(requests,1);assert.equal(audio.voices.size,0);
  game.clock=103.66;
  assert.equal(audio.update(game,{paused:true}),0);
  assert.equal(audio.update(game),1);
  const [voice]=audio.voices;
  assert.equal(voice.name,'thunder');assert.ok(voice.spatial&&voice.at.z<0);
  assert.equal(audio.update(game),0);assert.equal(audio.voices.size,1);
  game.weatherStart=103.66;
  assert.equal(audio.update(game),0);assert.equal(voice.source.stopped,true);assert.equal(audio.voices.size,0);
  game.clock=107.32;assert.equal(audio.update(game),1);
  const newStrike=[...audio.voices][0];game.weather='rain';
  assert.equal(audio.update(game),0);assert.equal(newStrike.source.stopped,true);assert.equal(audio.voices.size,0);
  game.weather='storm';game.weatherStart=107.32;game.clock=110.98;assert.equal(audio.update(game),1);
  audio.configure(true,55,{music:0,effectMask:onlyWood});assert.equal(audio.voices.size,0);
  game.clock=117.43;assert.equal(audio.update(game),0);assert.equal(requests,1);
  assert.equal(audio.effectSelected('wood'),true);
  audio.dispose();
});

test('the immutable effect catalogue has stable individual bits and rejects removed or malformed IDs and masks',()=>{
  const ids=['wood','joint','shield-wood','footstep-dry','footstep-wet','metal','ring','blade-beat','blade-slide','shield-metal','tension','puncture','tear','latex-rub','slosh','jet','drip','splash','water-burst','whoosh','blade-swish','countdown','go','victory','defeat','draw','ui','thunder'];
  assert.deepEqual(AUDIO_EFFECTS.map(e=>e.id),ids);assert.ok(Object.isFrozen(AUDIO_EFFECTS));assert.ok(AUDIO_EFFECTS.every(e=>Object.isFrozen(e)&&e.label&&e.group));assert.equal(ALL_EFFECTS_MASK,268435455);
  for(const [i,id]of ids.entries()){const only=setEffectEnabled(0,id,true);assert.equal(only,2**i);assert.equal(effectEnabled(only,id),true);for(const other of ids)if(other!==id)assert.equal(effectEnabled(only,other),false);assert.equal(setEffectEnabled(only,id,false),0);assert.equal(effectEnabled(ALL_EFFECTS_MASK,id),true);}
  for(const mask of [0,1,ALL_EFFECTS_MASK])assert.equal(validEffectMask(mask),true);
  for(const mask of [-1,1.5,ALL_EFFECTS_MASK+1,NaN,Infinity,'0',null,{},true]){assert.equal(validEffectMask(mask),false);assert.equal(effectEnabled(mask,'wood'),false);assert.throws(()=>setEffectEnabled(mask,'wood',true),RangeError);}
  for(const id of ['wood-contact','__proto__','constructor','made-up',null]){assert.equal(effectEnabled(ALL_EFFECTS_MASK,id),false);assert.throws(()=>setEffectEnabled(ALL_EFFECTS_MASK,id,true),RangeError);}
  assert.throws(()=>setEffectEnabled(0,'wood',1),RangeError);
});

test('disabled effects stop before inherited playback, options, buffers or context creation, including fallback and unknown names',()=>{
  const f=fixture(),{audio}=f;audio.configure(true,55,{effectMask:0});
  const options={get intensity(){throw Error('disabled cue reached inherited options');}};
  for(const state of ['ready','error']){audio.recordedState=state;for(const {id}of AUDIO_EFFECTS)assert.equal(audio.play(id,options),false);}
  audio.configure(true,55,{effectMask:ALL_EFFECTS_MASK});for(const id of ['wood-contact','made-up','__proto__'])assert.equal(audio.play(id,options),false);
  assert.equal(f.contexts,0);assert.deepEqual(f.lookups,[]);assert.equal(audio.voices.size,0);audio.dispose();
});

test('each combat effect can be played alone and its switch remains independent of all other IDs',()=>{
  const {audio,context,lookups}=fixture();audio.configure(true,55,{music:0,effects:1});audio.unlock();
  for(const {id}of combatEffects){context.currentTime+=1;audio.configure(true,55,{effectMask:setEffectEnabled(0,id,true)});for(const other of AUDIO_EFFECTS)if(other.id!==id)assert.equal(audio.play(other.id),false);assert.equal(audio.play(id,{intensity:.2}),true,id);assert.deepEqual([...audio.voices].map(v=>v.name),[id]);}
  assert.deepEqual(lookups,combatEffects.map(e=>e.id));assert.equal(audio.play('wood-contact'),false);audio.dispose();
});

test('disabling a cue retires only its active and delayed voices and leaves music, other cues and the shared room intact',async()=>{
  const {audio,context,media}=fixture();audio.configure(true,55,{music:.24,effects:1});audio.setMusicPhase('fight');await turn();media[0].currentTime=22;
  assert.equal(audio.play('wood'),true);assert.equal(audio.play('joint'),true);assert.equal(audio.play('puncture',{delay:1}),true);
  const wood=[...audio.voices].find(v=>v.name==='wood'),joint=[...audio.voices].find(v=>v.name==='joint'),puncture=[...audio.voices].find(v=>v.name==='puncture'),music=audio.musicVoices[0],rack=audio.fxRack,room=rack.lines,nodes=context.nodes.length,plays=media[0].plays,loads=media[0].loads;
  const mask=setEffectEnabled(setEffectEnabled(ALL_EFFECTS_MASK,'wood',false),'puncture',false);audio.configure(true,55,{effectMask:mask});await turn();
  assert.equal(wood.source.stopped,true);assert.equal(wood.source.disconnected,true);assert.equal(puncture.source.stopped,true);assert.equal(puncture.source.disconnected,true);assert.equal(joint.source.stopped,false);
  assert.deepEqual([...audio.voices],[joint]);assert.equal(audio.musicVoices[0],music);assert.equal(media[0].currentTime,22);assert.equal(media[0].plays,plays);assert.equal(media[0].loads,loads);
  assert.equal(audio.fxRack,rack);assert.equal(rack.lines,room);assert.equal(rack.dirty,true);assert.equal(context.nodes.length,nodes);assert.equal(context.buffers,0);assert.equal(context.decodes,0);
  audio.configure(true,55,{effectMask:0});assert.equal(audio.voices.size,0);assert.equal(audio.musicVoices[0],music);assert.equal(audio.effectsVolume,1);assert.equal(audio.musicVolume,.24);audio.dispose();
});

test('mask changes preserve zero before unlock, reject coercion and survive pause and context recreation without resetting mixes',()=>{
  const f=fixture(),{audio,context}=f;audio.configure(false,37,{music:.3,effects:.6,distortion:.02,reverb:.07,reverbDecay:.9,effectMask:0});assert.equal(f.contexts,0);assert.equal(audio.effectMask,0);
  for(const effectMask of [undefined,NaN,-1,1.5,'1',ALL_EFFECTS_MASK+1]){audio.configure(false,37,{effectMask});assert.equal(audio.effectMask,0);}
  audio.configure(true,37);assert.equal(audio.effectMask,0);audio.unlock();audio.setPaused(true);audio.setPaused(false);assert.equal(audio.effectMask,0);
  context.state='closed';audio.releaseGraph();const replacement=new Context();audio.contextFactory=()=>replacement;audio.unlock();assert.equal(audio.effectMask,0);assert.equal(audio.play('wood'),false);
  assert.equal(audio.volume,.37);assert.equal(audio.musicVolume,.3);assert.equal(audio.effectsVolume,.6);assert.equal(audio.distortion,.02);assert.equal(audio.reverb,.07);assert.equal(audio.reverbDecay,.9);audio.dispose();
});

test('contact composites, joint damage and game notices obey their own switches without reviving wood-contact',()=>{
  const {audio,context}=fixture();audio.configure(true,55,{music:0,effects:1});audio.unlock();
  audio.configure(true,55,{effectMask:setEffectEnabled(ALL_EFFECTS_MASK,'tear',false)});
  assert.equal(audio.handleEvent('burst',{loser:2,relativeSpeed:2,at:{x:1,y:2.7,z:.2}},{phase:'burst',fighters:[]}),true);assert.deepEqual([...audio.voices].map(v=>v.name),['puncture','water-burst']);audio.stopEffects();
  audio.configure(true,55,{effectMask:setEffectEnabled(ALL_EFFECTS_MASK,'joint',false)});context.currentTime+=1;
  const damage={jointEvent:'joint-break',slot:1,joint:'mainElbow',damage:1,amount:.2,at:{x:-1,y:1.7,z:.2}};
  assert.equal(audio.handleEvent('material-contact',damage,{phase:'fight',fighters:[]}),false);assert.equal(audio.voices.size,0);
  audio.configure(true,55,{effectMask:setEffectEnabled(ALL_EFFECTS_MASK,'go',false)});assert.equal(audio.tone('go'),false);assert.equal(audio.voices.size,0);
  audio.configure(true,55,{effectMask:ALL_EFFECTS_MASK});assert.equal(audio.tone('go'),true);assert.deepEqual([...audio.voices].map(v=>v.name),['go']);audio.dispose();
});

test('switches leave prepared recording and fallback banks and their variation counters untouched until an enabled cue plays',()=>{
  const {audio,context}=fixture();audio.configure(true,55,{music:0});audio.unlock();audio.effectBuffer=WorkshopGameAudio.prototype.effectBuffer;
  audio.prepareRecordings=()=>Promise.resolve(audio.recordedState==='ready');
  for(const {id}of combatEffects)for(let variant=0;variant<3;variant++){
    audio.buffers.set(id+':'+variant,{duration:.5,bank:'fallback'});audio.recordedBuffers.set(id+':'+variant,{duration:.5,bank:'recorded'});
  }
  const fallback=audio.buffers,recorded=audio.recordedBuffers;
  for(const state of ['ready','error']){
    audio.recordedState=state;const serial=audio.serial,variants=[...audio.recordedVariants],nodes=context.nodes.length;
    audio.configure(true,55,{effectMask:setEffectEnabled(0,'puncture',true)});
    assert.equal(audio.play('wood'),false);assert.equal(audio.play('wood-contact'),false);assert.equal(audio.serial,serial);assert.deepEqual([...audio.recordedVariants],variants);assert.equal(context.nodes.length,nodes);
    assert.equal(audio.play('puncture'),true);assert.equal([...audio.voices].at(-1).source.buffer.bank,state==='ready'?'recorded':'fallback');
    audio.configure(true,55,{effectMask:0});context.currentTime+=1;
  }
  assert.equal(audio.buffers,fallback);assert.equal(audio.recordedBuffers,recorded);assert.equal(fallback.size,81);assert.equal(recorded.size,81);assert.equal(context.buffers,0);assert.equal(context.decodes,0);audio.dispose();
});

test('individual switches preserve the shared 24-voice limit while streamed music continues',async()=>{
  const {audio,context}=fixture();audio.configure(true,55);audio.setMusicPhase('fight');await turn();const music=audio.musicVoices[0];
  for(let i=0;i<80;i++){assert.equal(audio.play(i%2?'joint':'wood'),true);assert.ok(audio.voices.size+audio.musicVoices.length<=24);}
  assert.equal(audio.voices.size,23);const joints=[...audio.voices].filter(v=>v.name==='joint');
  audio.configure(true,55,{effectMask:setEffectEnabled(ALL_EFFECTS_MASK,'wood',false)});assert.deepEqual([...audio.voices],joints);assert.equal(audio.musicVoices[0],music);
  audio.configure(true,55,{effectMask:0});assert.equal(audio.voices.size,0);assert.equal(audio.musicVoices[0],music);
  audio.configure(true,55,{effectMask:ALL_EFFECTS_MASK});for(let i=0;i<80;i++)assert.equal(audio.play('metal'),true);
  assert.equal(audio.voices.size+audio.musicVoices.length,24);assert.equal(audio.musicVoices[0],music);assert.equal(context.buffers,0);assert.equal(context.decodes,0);audio.dispose();
});
