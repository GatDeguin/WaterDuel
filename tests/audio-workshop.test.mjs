import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {WorkshopGameAudio,WORKSHOP_AUDIO_DEFAULTS} from '../public/audio/workshop-game-audio.js';
import {WORKSHOP_MUSIC_TRACKS} from '../public/audio/streamed-music.js';
import {DuelEngine} from '../public/engine.js';
import {AudioScene} from '../public/audio/scene-audio.js';

class Param{
  constructor(value=0){this.value=value;this.targets=[];}
  setValueAtTime(value){assert.ok(Number.isFinite(value));this.value=value;}
  setTargetAtTime(value,time,constant){this.setValueAtTime(value);this.targets.push({value,time,constant});}
  cancelScheduledValues(){}
}
class AudioNode{
  constructor(kind,context){this.kind=kind;this.context=context;this.connections=[];this.gain=new Param(1);this.pan=new Param();this.delayTime=new Param();this.frequency=new Param();this.Q=new Param();this.playbackRate=new Param(1);}
  connect(node){this.connections.push(node);return node;}
  disconnect(node){this.connections=node?this.connections.filter(x=>x!==node):[];this.disconnected=true;}
  start(at){this.started=at;}
  stop(){this.stopped=true;}
}
class Context{
  constructor(state='running'){this.state=state;this.currentTime=0;this.sampleRate=48000;this.nodes=[];this.buffers=0;this.decodes=0;this.mediaSources=[];this.handlers=new Set();this.resumes=0;this.destination=this.node('destination');this.listener={};}
  node(kind){const node=new AudioNode(kind,this);this.nodes.push(node);return node;}
  createGain(){return this.node('gain');}
  createWaveShaper(){return this.node('shaper');}
  createDelay(){return this.node('delay');}
  createBiquadFilter(){return this.node('filter');}
  createStereoPanner(){return this.node('stereo');}
  createPanner(){const node=this.node('panner');for(const key of ['positionX','positionY','positionZ'])node[key]=new Param();return node;}
  createDynamicsCompressor(){const node=this.node('compressor');for(const key of ['threshold','knee','ratio','attack','release'])node[key]=new Param();return node;}
  createMediaElementSource(media){assert.ok(!this.mediaSources.some(x=>x.media===media));const node=this.node('media');node.media=media;this.mediaSources.push(node);return node;}
  createBufferSource(){return this.node('sample');}
  createBuffer(channels,length,rate){this.buffers++;const pcm=Array.from({length:channels},()=>new Float32Array(length));return {numberOfChannels:channels,length,sampleRate:rate,duration:length/rate,getChannelData:i=>pcm[i]};}
  decodeAudioData(){this.decodes++;throw Error('Music must stream, not decode to PCM');}
  addEventListener(type,fn){if(type==='statechange')this.handlers.add(fn);}
  removeEventListener(type,fn){this.handlers.delete(fn);}
  changeState(state){this.state=state;for(const handler of [...this.handlers])handler();}
  resume(){this.resumes++;return Promise.resolve();}
  close(){this.changeState('closed');return Promise.resolve();}
}
class Media{
  constructor(){this.src='';this.currentTime=0;this.paused=true;this.loads=0;this.plays=0;this.listeners=new Map();this.pending=null;}
  addEventListener(type,fn){this.listeners.set(type,fn);}
  removeEventListener(type,fn){if(this.listeners.get(type)===fn)this.listeners.delete(type);}
  emit(type){if(type==='ended')this.paused=true;this.listeners.get(type)?.();}
  play(){this.plays++;this.paused=false;return this.pending??Promise.resolve();}
  pause(){this.paused=true;}
  load(){this.loads++;}
  removeAttribute(name){if(name==='src')this.src='';}
}
function fixture({context=new Context(),mediaFactory,...options}={}){
  const media=[];const audio=new WorkshopGameAudio({contextFactory:()=>context,mediaFactory:mediaFactory??(()=>{const item=new Media();media.push(item);return item;}),workerFactory:()=>null,...options});
  return {audio,context,media};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('the four supplied MP3 files ship unchanged with distinct identities and subdirectory-safe URLs',async()=>{
  const identities={
    'intro.mp3':'7fde9236f002ca692c70dd48c0e0d3fbb96448d0f476c3f643f1edc7bbd43418',
    'batalla.mp3':'311367042ea5f32c0603005b4be1ee8d41f71d0874817f384b81351cd5da1a73',
    'batalla2.mp3':'3d9e4513ed63d4cc38506ca3fadb5c984130ec4d94798e4cad964908663a0b2e',
    'batalla3.mp3':'979dd24e4d0cb3ccc9027a480b7aa639fe2104665111a5db94cd4ce7d4612e8b'},names=Object.keys(identities),hashes=new Set();
  const manifest=JSON.parse(await readFile(new URL('../public/music/manifest.json',import.meta.url),'utf8'));assert.equal(manifest.tracks.length,4);
  assert.equal(WORKSHOP_MUSIC_TRACKS.intro.file,names[0]);assert.deepEqual(WORKSHOP_MUSIC_TRACKS.battle.map(x=>x.file),names.slice(1));
  for(const file of names){const shipped=await readFile(new URL('../public/music/'+file,import.meta.url)),hash=createHash('sha256').update(shipped).digest('hex'),entry=manifest.tracks.find(x=>x.file===file);assert.equal(hash,identities[file]);assert.equal(entry.sha256,hash);assert.equal(entry.bytes,shipped.length);assert.equal(entry.channels,2);assert.equal(entry.sampleRate,44100);assert.ok(entry.encodedDuration>175&&entry.encodedDuration<185);assert.equal(shipped[entry.audioStart],255);assert.equal(shipped[entry.audioStart+1]&224,224);hashes.add(hash);assert.ok(shipped.subarray(0,3).toString()==='ID3'||shipped[0]===255);}
  assert.equal(hashes.size,4);for(const track of [WORKSHOP_MUSIC_TRACKS.intro,...WORKSHOP_MUSIC_TRACKS.battle])assert.match(track.url.href,/\/public\/music\/[^/]+\.mp3$/);
});

test('muted audio allocates no media, contexts or effect racks and defaults remain subtle',()=>{
  const f=fixture();assert.equal(f.audio.unlock(),null);assert.equal(f.context.nodes.length,1);assert.equal(f.media.length,0);
  assert.deepEqual(WORKSHOP_AUDIO_DEFAULTS,{music:.24,effects:1,distortion:.03,reverb:.08,reverbDecay:1.1});f.audio.dispose();
});

test('one streamed voice uses supplied music, preserves battle position between rounds and rotates finished/new-duel tracks',async()=>{
  const {audio,context,media}=fixture();audio.configure(true,55,{effects:0});audio.setMusicPhase('ready');await turn();
  assert.equal(media.length,1);assert.match(media[0].src,/intro\.mp3$/);assert.equal(audio.musicVoices.length,1);assert.equal(context.decodes,0);
  audio.setMusicPhase('countdown');audio.setMusicPhase('fight');await turn();assert.match(media[0].src,/batalla\.mp3$/);media[0].currentTime=41;
  const loads=media[0].loads,plays=media[0].plays;for(let i=0;i<30;i++)audio.setMusicPhase('fight');audio.setMusicPhase('burst');audio.setMusicPhase('countdown');audio.setMusicPhase('fight');
  assert.equal(media[0].loads,loads);assert.equal(media[0].plays,plays);assert.equal(media[0].currentTime,41);
  media[0].emit('ended');await turn();assert.match(media[0].src,/batalla2\.mp3$/);assert.equal(audio.musicVoices.length,1);
  audio.setMusicPhase('matchover');await turn();assert.match(media[0].src,/intro\.mp3$/);audio.setMusicPhase('countdown');audio.setMusicPhase('fight');await turn();assert.match(media[0].src,/batalla3\.mp3$/);
  assert.equal(context.mediaSources.length,1);assert.equal(context.decodes,0);assert.equal([...audio.buffers.keys()].filter(x=>x.startsWith('music:')).length,0);audio.dispose();
});

test('the effect path is distortion then shared reverberation while streamed music bypasses both',async()=>{
  const {audio,context}=fixture();audio.configure(true,55,{effects:0});audio.setMusicPhase('ready');await turn();const rack=audio.fxRack;
  assert.ok(rack);assert.ok(audio.effects.connections.includes(rack.shaper));assert.ok(!audio.effects.connections.includes(audio.master));
  assert.ok(rack.shaper.connections.includes(rack.dry));assert.ok(rack.shaper.connections.includes(rack.roomInput));assert.ok(rack.wet.connections.includes(audio.master));
  assert.deepEqual(audio.music.connections,[audio.master]);assert.ok(!audio.music.connections.includes(rack.shaper));
  assert.equal(rack.distortion,.03);assert.equal(rack.reverb,.08);assert.equal(rack.decay,1.1);assert.equal(context.buffers,0);assert.equal(context.decodes,0);audio.dispose();
});

test('zero and subtle reverb use only the adjustable rack while ring keeps direct XYZ HRTF without legacy sends',async()=>{
  const {audio,context}=fixture();audio.configure(true,55,{effects:0,reverb:0});audio.unlock();await turn();
  audio.effectsVolume=1;audio.effectBuffer=()=>({duration:.4});audio.effectsState='ready';audio.recordedState='ready';
  for(const reverb of [0,.08,0]){
    audio.reverb=reverb;audio.fxRack.configure(audio);assert.equal(audio.play('ring',{x:1.25,y:2.1,z:.6,intensity:.1}),true);
    const voice=[...audio.voices].at(-1);assert.equal(voice.send===null,true,'no unadjustable legacy room send');assert.equal(audio.acoustics.roomInput===null,true,'no legacy wet input');assert.equal(audio.acoustics.roomNodes.length,0);
    assert.equal(voice.spatial,true);assert.equal(voice.pan.panningModel,'HRTF');assert.equal(voice.pan.positionX.value,1.25);assert.equal(voice.pan.positionY.value,2.1);assert.equal(voice.pan.positionZ.value,.6);
    assert.deepEqual(voice.pan.connections,[audio.effects]);assert.equal(audio.fxRack.wet.gain.value,reverb);
  }
  assert.equal(context.nodes.filter(node=>node.kind==='delay').length,4,'only the one adjustable shared room owns delay lines');audio.dispose();
});

test('volume and effect sliders clamp malformed values and update existing native parameters without rebuilding PCM or room graphs',async()=>{
  const {audio,context}=fixture();audio.configure(true,65,{music:.4,effects:0,distortion:.02,reverb:.07,reverbDecay:.9});audio.setMusicPhase('ready');await turn();
  const rack=audio.fxRack,nodes=context.nodes.length,curve=rack.shaper.curve;
  for(let i=0;i<20;i++)audio.configure(true,65,{music:.4,effects:0,distortion:.02,reverb:.07,reverbDecay:.9});assert.equal(context.nodes.length,nodes);assert.equal(rack.shaper.curve,curve);
  audio.configure(true,150,{music:2,effects:0,distortion:-2,reverb:5,reverbDecay:90});assert.equal(audio.volume,1);assert.equal(audio.musicVolume,1);assert.equal(rack.distortion,0);assert.equal(rack.reverb,1);assert.equal(rack.decay,2.4);assert.equal(context.nodes.length,nodes);
  const identity=rack.shaper.curve;assert.ok(Math.abs(identity[512]-(512/1024-1))<1e-6);for(const line of rack.lines)assert.ok(line.feedback.gain.value>=0&&line.feedback.gain.value<.95);
  assert.equal(context.buffers,0);assert.equal(context.decodes,0);audio.dispose();
});

test('pause/mute preserve media offset, discard reverb tails, and one gesture resumes without spawning layers',async()=>{
  const {audio,media}=fixture();audio.configure(true,55,{effects:0});audio.setMusicPhase('fight');await turn();media[0].currentTime=24;
  audio.effectsVolume=1;audio.effectBuffer=()=>({duration:.4});audio.effectsState='ready';audio.recordedState='ready';assert.equal(audio.play('wood',{intensity:.1}),true);
  const oldLines=audio.fxRack.lines.map(line=>line.delay);audio.setPaused(true);assert.equal(media[0].paused,true);assert.equal(audio.musicVoices.length,0);assert.ok(oldLines.every(node=>node.disconnected));
  audio.setPaused(false);audio.unlock();audio.setMusicPhase('fight');await turn();assert.equal(media[0].currentTime,24);assert.equal(media.length,1);assert.equal(audio.musicVoices.length,1);
  audio.configure(false,55,{effects:0});assert.equal(media[0].paused,true);audio.configure(true,55,{effects:0});audio.unlock();audio.setMusicPhase('fight');await turn();assert.equal(media[0].currentTime,24);assert.equal(audio.musicVoices.length,1);audio.dispose();
});

test('a late play from a previous selection cannot pause the newly selected battle track',async()=>{
  let resolveOld;const item=new Media();item.pending=new Promise(resolve=>{resolveOld=resolve;});const {audio}=fixture({mediaFactory:()=>item});
  audio.configure(true,55,{effects:0});audio.setMusicPhase('ready');item.pending=null;audio.setMusicPhase('fight');await turn();assert.equal(item.paused,false);assert.match(item.src,/batalla\.mp3$/);
  resolveOld();await turn();assert.equal(item.paused,false);assert.equal(audio.musicVoices.length,1);audio.dispose();
});

test('a rejected autoplay attempt waits for a gesture and a late play promise cannot revive muted audio',async()=>{
  let resolve;const item=new Media();item.pending=Promise.reject(new Error('Autoplay'));item.pending.catch(()=>{});const {audio}=fixture({mediaFactory:()=>item});
  audio.configure(true,55,{effects:0});audio.setMusicPhase('fight');await turn();const plays=item.plays;
  for(let i=0;i<20;i++)audio.setMusicPhase('fight');await turn();assert.equal(item.plays,plays);assert.ok(audio.musicError);
  item.pending=new Promise(done=>{resolve=done;});audio.unlock({gesture:true});audio.configure(false,55,{effects:0});resolve();await turn();assert.equal(item.paused,true);assert.equal(audio.musicVoices.length,0);audio.dispose();
});

test('the streaming voice shares the inherited 24-voice budget and impacts do not create DSP/sample preparation work',async()=>{
  const {audio,context}=fixture();audio.configure(true,55,{effects:0});audio.setMusicPhase('fight');await turn();
  audio.effectsVolume=1;audio.effectBuffer=()=>({duration:.4});audio.effectsState='ready';audio.recordedState='ready';
  const rack=audio.fxRack,shaper=rack.shaper,buffers=context.buffers,decodes=context.decodes;
  for(let i=0;i<60;i++)audio.play('wood',{intensity:.1});assert.equal(audio.musicVoices.length,1);assert.equal(audio.voices.size,23);assert.equal(audio.voices.size+audio.musicVoices.length,24);
  assert.equal(audio.fxRack,rack);assert.equal(rack.shaper,shaper);assert.equal(context.buffers,buffers);assert.equal(context.decodes,decodes);audio.dispose();
});

test('closed contexts detach streaming media and native effect nodes and cannot reuse a source owned by an old context',async()=>{
  const f=fixture(),{audio,context,media}=f;audio.configure(true,55,{effects:0});audio.setMusicPhase('fight');await turn();const rack=audio.fxRack;
  context.changeState('closed');assert.equal(audio.context,null);assert.equal(media[0].paused,true);assert.equal(media[0].src,'');assert.ok(rack.shaper.disconnected);assert.equal(audio.musicVoices.length,0);
  const replacement=new Context();audio.contextFactory=()=>replacement;audio.unlock();audio.setMusicPhase('fight');await turn();assert.equal(media.length,2);assert.equal(replacement.mediaSources.length,1);assert.notEqual(audio.fxRack,rack);audio.dispose();
});

function preparedContactFixture(){
  const f=fixture();f.audio.configure(true,55,{effects:0,music:0});f.audio.unlock();f.audio.effectsVolume=1;f.audio.effectsState='ready';f.audio.recordedState='ready';f.audio.effectBuffer=()=>({duration:.1});return f;
}
const restingContact={material:'wood',bodyA:'weapon',bodyB:'mainForearm',impulse:.0108,closingSpeed:.19,peakClosingSpeed:.19,force:1.296,at:{x:.67,y:1.62,z:.177}};
test('resting material contacts stay silent while active latex contacts remain audible and wood-contact stays disabled',()=>{
  const {audio,context}=preparedContactFixture();
  for(const phase of ['ready','countdown','matchover'])for(let i=0;i<12;i++){context.currentTime+=.1;assert.equal(audio.handleEvent('material-contact',restingContact,{phase,fighters:[]}),false);}
  assert.equal(audio.voices.size,0);assert.equal(audio.contactTimes.size,0);
  for(const phase of ['fight','burst']){context.currentTime+=.2;assert.equal(audio.handleEvent('material-contact',restingContact,{phase,fighters:[]}),false);assert.equal(audio.handleEvent('material-contact',{...restingContact,material:'latex'},{phase,fighters:[]}),true);assert.equal([...audio.voices].at(-1).name,'latex-rub');}
  audio.dispose();
});

test('progressive joint damage and breaks keep their joint cue in every phase without the removed wood-contact layer',()=>{
  const {audio,context}=preparedContactFixture();
  for(const phase of ['ready','countdown','fight','burst','matchover'])for(const jointEvent of ['joint-damage','joint-break']){
    context.currentTime+=.3;assert.equal(audio.handleEvent('material-contact',{jointEvent,slot:1,joint:'mainElbow',damage:.4,amount:.2,at:{x:-1,y:1.7,z:.2}},{phase,fighters:[]}),true);
    assert.deepEqual([...audio.voices].map(voice=>voice.name),['joint']);audio.stopEffects();
  }
  audio.dispose();
});

test('wood-contact never enters the inherited playback path or creates a voice, including direct, physical, joint and fallback routes',()=>{
  const {audio,context}=preparedContactFixture(),lookups=[];audio.effectBuffer=name=>{lookups.push(name);return {duration:.1};};
  const forbiddenOptions={get x(){throw Error('removed wood-contact reached the parent playback entry');}};
  for(const recordedState of ['ready','error']){
    audio.recordedState=recordedState;assert.equal(audio.play('wood-contact',forbiddenOptions),false);assert.equal(audio.voices.size,0);
    for(const phase of ['ready','countdown','fight','burst','matchover']){
      context.currentTime+=.3;assert.equal(audio.handleEvent('material-contact',restingContact,{phase,fighters:[]}),false);
      for(const jointEvent of ['joint-damage','joint-break']){
        context.currentTime+=.3;assert.equal(audio.handleEvent('material-contact',{jointEvent,slot:1,joint:'mainElbow',damage:.4,amount:.2,at:{x:-1,y:1.7,z:.2}},{phase,fighters:[]}),true);
        assert.equal([...audio.voices].some(voice=>voice.name==='wood-contact'),false);audio.stopEffects();
      }
    }
  }
  assert.equal(lookups.includes('wood-contact'),false);assert.equal(audio.play('wood',{intensity:.1}),true);assert.equal(audio.play('joint',{intensity:.1}),true);
  assert.equal(lookups.includes('wood'),true);assert.equal(lookups.includes('joint'),true);assert.equal([...audio.voices].some(voice=>voice.name==='wood-contact'),false);audio.dispose();
});

test('measured wood and hinge motion becomes quiet outside combat and retains its original intensity during fight and burst',()=>{
  for(const phase of ['ready','countdown','matchover','fight','burst']){
    const {audio}=fixture(),game=new DuelEngine(),reference=new AudioScene();game.phase=phase;audio.scene.update(game,1/60);reference.update(game,1/60);
    const f=game.fighters[0];f.pose.mainHand.x+=.03;f.pose.mainHand.y+=.015;f.pose.mainElbow.y+=.0075;f.pose.head.x+=.006;f.pose.tip.x+=.06;
    const original=reference.update(game,1/60),quiet=audio.scene.update(game,1/60);assert.ok(original.some(cue=>cue.name==='wood'));assert.ok(original.some(cue=>cue.name==='joint'));
    assert.deepEqual(quiet.map(cue=>cue.name),original.map(cue=>cue.name));
    for(let i=0;i<original.length;i++){const scale=['wood','joint'].includes(original[i].name)&&!['fight','burst'].includes(phase)?.15:1;assert.ok(Math.abs(quiet[i].intensity-original[i].intensity*scale)<1e-12);}
    audio.dispose();
  }
});
