import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio} from '../public/game-audio.js';
import {EFFECT_JOBS} from '../public/audio/effect-bank-preparation.js';
import {contactAudio} from '../public/audio/contact-audio.js';
import {AudioScene} from '../public/audio/scene-audio.js';

class Param{constructor(value=0){this.value=value;}setValueAtTime(value){assert.ok(Number.isFinite(value));this.value=value;}setTargetAtTime(value){this.setValueAtTime(value);}linearRampToValueAtTime(value){this.setValueAtTime(value);}cancelScheduledValues(){}}
class Node{constructor(){this.connections=[];this.gain=new Param(1);this.pan=new Param();this.playbackRate=new Param(1);}connect(node){this.connections.push(node);return node;}disconnect(){this.connections=[];this.disconnected=true;}start(){}stop(){this.stopped=true;}}
class Context{
 constructor({spatial=true,room=true,stereo=true}={}){this.state='running';this.currentTime=0;this.sampleRate=22050;this.destination=new Node();this.allocations=0;this.nodes=[];this.listener={};for(const key of ['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'])this.listener[key]=new Param();if(!spatial)this.createPanner=undefined;if(!room){this.createDelay=undefined;this.createBiquadFilter=undefined;}if(!stereo)this.createStereoPanner=undefined;}
 node(){const node=new Node();this.nodes.push(node);return node;}
 createGain(){return this.node();}createStereoPanner(){return this.node();}createPanner(){const n=this.node();for(const key of ['positionX','positionY','positionZ'])n[key]=new Param();return n;}
 createDelay(){const n=this.node();n.delayTime=new Param();return n;}createBiquadFilter(){const n=this.node();n.frequency=new Param();n.Q=new Param();return n;}
 createDynamicsCompressor(){const n=this.node();for(const key of ['threshold','knee','ratio','attack','release'])n[key]=new Param();return n;}createWaveShaper(){return this.node();}createBufferSource(){return this.node();}
 createBuffer(channels,length,sampleRate){if(this.forbidBuffers)throw Error('AudioBuffer allocation during gameplay');this.allocations++;const data=Array.from({length:channels},()=>new Float32Array(length));return {duration:length/sampleRate,length,numberOfChannels:channels,getChannelData:i=>data[i]};}
 resume(){return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
}
function ready(options={}){const context=new Context(options),audio=new GameAudio({contextFactory:()=>context,workerFactory:()=>null,random:()=>.5});audio.configure(true,55,{music:0});audio.unlock();for(const job of EFFECT_JOBS)audio.buffers.set(job.name+':'+job.variant,context.createBuffer(1,job.frames,22050));audio.effectsState='ready';context.forbidBuffers=true;return {context,audio};}

test('prepared events use physical XYZ HRTF and the actual camera listener without new sample buffers',()=>{
 const {audio,context}=ready();const game={phase:'fight',fighters:[],scores:[0,0]};
 audio.update(game,{camera:{eye:[.2,2,10],target:[0,1.9,0]},dt:1/60});
 assert.equal(context.listener.positionX.value,.2);assert.equal(context.listener.positionY.value,2);assert.equal(context.listener.positionZ.value,10);
 assert.ok(context.listener.forwardZ.value<-.99);assert.ok(Math.abs(Math.hypot(context.listener.forwardX.value,context.listener.forwardY.value,context.listener.forwardZ.value)-1)<1e-12);
 const event={material:'wood',impulse:.15,closingSpeed:2,at:{x:-1.2,y:1.4,z:.7}};assert.equal(audio.handleEvent('material-contact',event,game),true);
 const voice=[...audio.voices][0];assert.equal(voice.pan.panningModel,'HRTF');assert.equal(voice.pan.positionX.value,-1.2);assert.equal(voice.pan.positionY.value,1.4);assert.equal(voice.pan.positionZ.value,.7);assert.equal(voice.pan.distanceModel,'inverse');
 const before=context.allocations;for(let i=0;i<120;i++){context.currentTime+=1/60;audio.update(game,{camera:{eye:[.2+i*.001,2,10],target:[0,1.9,0]},dt:1/60});if(i%10===0)audio.handleEvent('clang',{weaponBind:true,material:'steel',impulse:.1,closingSpeed:1,at:{x:1,y:2,z:-.3}},game);}
 assert.equal(context.allocations,before);assert.equal(before,84);audio.dispose();
});
test('legacy stereo and mono remain playable when spatial or room APIs are absent',()=>{
 for(const options of [{spatial:false,room:false},{spatial:false,room:false,stereo:false}]){const {audio}=ready(options);assert.equal(audio.play('wood',{x:-2,y:1,z:.3}),true);assert.ok([...audio.voices][0].pan);audio.setPaused(true);assert.equal(audio.voices.size,0);audio.dispose();}
});
test('room reflections are shared and reset cannot replay stale tails after mute, pause or reset',()=>{
 const {audio,context}=ready();audio.play('wood');audio.play('ring');assert.ok(audio.acoustics?.roomNodes?.length>0);assert.ok(audio.acoustics.roomNodes.length<=8);
 const previous=[...audio.acoustics.roomNodes];audio.setPaused(true);assert.ok(previous.every(node=>node.disconnected));assert.equal(audio.voices.size,0);
 audio.setPaused(false);audio.play('wood');audio.handleEvent('reset');assert.equal(audio.voices.size,0);audio.configure(false,55);assert.equal(audio.master.gain.value,0);assert.equal(context.allocations,84);audio.dispose();
});
test('a suspended context waiting for autoplay creates no room nodes across repeated updates',()=>{
 const {audio,context}=ready();audio.play('wood');const oldRoom=[...audio.acoustics.roomNodes];
 context.state='suspended';context.resume=()=>new Promise(()=>{});audio.update({phase:'fight',fighters:[],scores:[0,0]});
 assert.ok(oldRoom.every(node=>node.disconnected));const nodes=context.nodes.length;
 for(let i=0;i<60;i++)audio.update({phase:'fight',fighters:[],scores:[0,0]});
 assert.equal(context.nodes.length,nodes);assert.equal(audio.acoustics.roomNodes.length,0);assert.equal(audio.voices.size,0);
 context.state='running';audio.play('wood');assert.equal(audio.acoustics.roomNodes.length,6);
 const active=context.nodes.length;audio.play('ring');assert.equal(context.nodes.length-active,4,'one source, gain, panner and send; shared room is reused');
 audio.dispose();assert.equal(context.allocations,84);
});
test('contact position retains actual height/depth and friction requires measured normal contact',()=>{
 const base={weaponBind:true,material:'steel',impulse:.1,closingSpeed:0,slideSpeed:1,at:{x:1,y:2.1,z:-.4}};
 const noFriction=contactAudio('clang',{...base,frictionImpulse:0,slidePower:0});assert.deepEqual(noFriction.cues,[]);
 const low=contactAudio('clang',{...base,frictionImpulse:-.002,slidePower:.002}),high=contactAudio('clang',{...base,frictionImpulse:-.06,slidePower:.06});
 assert.equal(high.cues[0].name,'blade-slide');assert.ok(high.cues[0].intensity>low.cues[0].intensity);assert.equal(high.cues[0].y,2.1);assert.equal(high.cues[0].z,-.4);
 assert.deepEqual(contactAudio('clang',{...base,impulse:0,frictionImpulse:.1,slidePower:1}).cues,[]);assert.deepEqual(contactAudio('clang',{...base,frictionImpulse:NaN,slidePower:1}).cues,[]);
});
test('physical blade and foot observations carry their own XYZ instead of a global sound plane',async()=>{
 const {DuelEngine}=await import('../public/engine.js');
 const game=new DuelEngine(),scene=new AudioScene(),f=game.fighters[0];scene.update(game,1/60);f.pose.tip.x+=.04;f.pose.tip.z+=.06;f.pose.mainHand.x+=.03;
 const swish=scene.update(game,1/60).find(cue=>cue.name==='blade-swish');assert.ok(swish);assert.equal(swish.y,f.pose.tip.y);assert.equal(swish.z,f.pose.tip.z);
});
