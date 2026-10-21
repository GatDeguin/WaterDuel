import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {renderMusic,renderSound} from '../public/audio/synthesis.js';
import {musicDecision} from '../public/audio/music-state.js';
import {FOLEY_NAMES,renderFoley} from '../public/audio/foley-synthesis.js';
import {contactAudio} from '../public/audio/contact-audio.js';

// A condensed, scripted listening demonstration. It uses the production score
// and policy; it does not advance, record or modify a live match.
const sampleRate=22050,duration=45,barSeconds=2.5,transitionSeconds=.12;
const expanded=process.argv.includes('--foley-v2');
const destination=new URL('../output/audio/',import.meta.url);
const duel={phase:'fight',mode:'solo',scenario:'duel',scores:[0,0],bestOf:3,roundsToWin:2};
const chapters=[
  {start:0,end:7.5,mode:'lydian',label:'Lidio · preparación',moment:'Se prepara el duelo',state:{...duel,phase:'ready'}},
  {start:7.5,end:17.5,mode:'dorian',label:'Dórico · duelo equilibrado',moment:'Comienza el intercambio',state:{...duel}},
  {start:17.5,end:27.5,mode:'aeolian',label:'Eólico · desventaja',moment:'J1 queda por detrás en el marcador',state:{...duel,scores:[0,1]}},
  {start:27.5,end:37.5,mode:'phrygian',label:'Frigio · máxima tensión',moment:'Muerte súbita',state:{...duel,scores:[0,1],suddenDeath:true}},
  {start:37.5,end:45,mode:'lydian',label:'Lidio · victoria',moment:'J1 remonta y gana',state:{...duel,phase:'matchover',winner:1,scores:[2,1]}},
];
for(const chapter of chapters){
  if(musicDecision(chapter.state).mode!==chapter.mode)throw Error('La escena no corresponde a su modo: '+chapter.label);
  if(Math.abs(chapter.start/barSeconds-Math.round(chapter.start/barSeconds))>1e-8)throw Error('Cambio fuera de compás');
}
const music=new Map([...new Set(chapters.map(chapter=>chapter.mode))].map(mode=>[mode,renderMusic({sampleRate,mode}).channels]));
const channels=[new Float32Array(duration*sampleRate),new Float32Array(duration*sampleRate)];
const effectChannels=channels.map(channel=>new Float32Array(channel.length));

// Quiet, spatially placed gestures leave the characteristic modal notes clear.
// These are authored demonstration cues, not claims of physical contact capture.
let cues=[
  [.65,'joint',-2,.07],[2.1,'slosh',-1.8,.09],
  [4.3,'countdown',0,.035],[5.3,'countdown',0,.035],[6.3,'countdown',0,.035],
  [7.5,'go',0,.16],[8.65,'whoosh',-2,.15],[9,'metal',0,.15],[9.015,'wood',0,.12],
  [10.4,'joint',1.8,.08],[11.25,'whoosh',2,.15],[11.5,'ring',.2,.09],
  [12.5,'wood',-1.7,.08],[13.1,'slosh',-2,.09],[13.75,'whoosh',-1.5,.14],[14,'metal',.1,.14],
  [16.45,'puncture',-2,.18],[16.475,'tear',-2,.17],[16.52,'jet',-2,.13],[17.2,'splash',-1.7,.15],[18.2,'drip',-1.5,.08],
  [19.75,'whoosh',-1.8,.15],[20,'metal',0,.15],[21.25,'slosh',-2,.1],[21.9,'whoosh',2,.14],[22.15,'wood',.1,.11],
  [26,'tension',-1.8,.11],[27.5,'tension',0,.12],
  [29.5,'whoosh',-2,.17],[29.8,'metal',0,.17],[30.25,'ring',.2,.09],
  [31.25,'whoosh',2,.17],[31.5,'wood',0,.11],[32.1,'joint',-1.8,.09],
  [32.6,'metal',0,.15],[33.1,'slosh',-2,.09],
  [35.55,'whoosh',-2,.18],[36.2,'puncture',2,.19],[36.225,'tear',2,.18],[36.3,'jet',2,.14],
  [37,'splash',1.8,.15],[37.65,'victory',0,.17],[39,'drip',1.8,.07],[40.8,'drip',1.5,.05],
].map(([at,name,x,gain],index)=>({at,name,x,gain,seed:37+index*13}));
const contactFixtures=[];
if(expanded){
  cues=cues.filter(cue=>![16.45,16.475,16.52,36.2,36.225,36.3,20,22.15,12.5].includes(cue.at))
    .map(cue=>({...cue,name:({whoosh:'blade-swish',metal:'blade-beat',wood:'wood-contact'}[cue.name]??cue.name)}));
  contactFixtures.push(
    {at:12.5,event:'clang',data:{material:'wood_metal_mixed',weaponBind:true,impulse:.18,closingSpeed:1,at:{x:-1.7}}},
    {at:14.05,event:'clang',data:{material:'steel',weaponBind:true,impulse:.03,closingSpeed:0,slideSpeed:1.1,at:{x:.1}}},
    {at:16.45,event:'burst',data:{loser:1,relativeSpeed:2.1,at:{x:-2},contact:true}},
    {at:20,event:'clang',data:{defender:1,defenseMaterial:'metal_mixed',impulse:.08,closingSpeed:1.2,at:{x:0}}},
    {at:22.15,event:'clang',data:{defender:1,defenseMaterial:'wood',impulse:.13,closingSpeed:1.4,at:{x:.1}}},
    {at:36.2,event:'burst',data:{loser:2,relativeSpeed:3,at:{x:2},contact:true}},
  );
  for(const fixture of contactFixtures)for(const cue of contactAudio(fixture.event,fixture.data).cues)
    cues.push({at:fixture.at+(cue.delay??0),name:cue.name,x:cue.x,gain:cue.intensity*.3,rate:cue.rate??1,seed:137+cues.length*13});
  cues.push({at:1.1,name:'footstep-dry',x:-2,gain:.12,seed:19},{at:39.7,name:'footstep-wet',x:1.8,gain:.1,seed:23});
  cues.sort((a,b)=>a.at-b.at);
}

const duck=new Float32Array(channels[0].length);duck.fill(1);
for(const cue of cues){
  const rendered=(FOLEY_NAMES.includes(cue.name)?renderFoley:renderSound)(cue.name,{sampleRate,seed:cue.seed});
  const rate=cue.rate??1,source=rate===1?rendered:new Float32Array(Math.ceil(rendered.length/rate));
  if(rate!==1)for(let i=0;i<source.length;i++){
    const position=i*rate,lo=Math.floor(position),fraction=position-lo;
    source[i]=(rendered[lo]??0)*(1-fraction)+(rendered[lo+1]??0)*fraction;
  }
  const offset=Math.round(cue.at*sampleRate),pan=Math.max(-.85,Math.min(.85,cue.x/3.2));
  const gains=[Math.cos((pan+1)*Math.PI/4),Math.sin((pan+1)*Math.PI/4)];
  for(let i=0;i<source.length&&offset+i<channels[0].length;i++){
    for(let channel=0;channel<2;channel++)effectChannels[channel][offset+i]+=source[i]*cue.gain*gains[channel];
  }
  if(['metal','puncture','tear'].includes(cue.name)){
    for(let i=0;i<sampleRate*.45&&offset+i<duck.length;i++){
      const t=i/sampleRate,envelope=Math.min(1,t/.012)*Math.exp(-t/.15);
      duck[offset+i]=Math.min(duck[offset+i],1-.16*envelope);
    }
  }
}

let chapterIndex=0;
for(let i=0;i<channels[0].length;i++){
  const t=i/sampleRate;
  while(chapterIndex+1<chapters.length&&t>=chapters[chapterIndex+1].start)chapterIndex++;
  const chapter=chapters[chapterIndex],current=music.get(chapter.mode),phase=i%current[0].length;
  const incoming=chapterIndex?Math.min(1,(t-chapter.start)/transitionSeconds):1;
  const previous=chapterIndex?music.get(chapters[chapterIndex-1].mode):null;
  const fade=Math.min(1,t/.2,Math.max(0,(duration-1/sampleRate-t)/1.2));
  for(let channel=0;channel<2;channel++){
    const score=current[channel][phase]*incoming+(previous?previous[channel][phase]*(1-incoming):0);
    // The score is brought forward for listening; game balance remains untouched.
    channels[channel][i]=(score*1.9*duck[i]+effectChannels[channel][i])*fade;
  }
}

let sourcePeak=0;
for(const channel of channels)for(const sample of channel){
  if(!Number.isFinite(sample))throw Error('Muestra no finita');sourcePeak=Math.max(sourcePeak,Math.abs(sample));
}
if(sourcePeak<.01)throw Error('La demo quedó muda');
const normalization=.8/sourcePeak;
const frames=channels[0].length,bytes=frames*4,wav=Buffer.alloc(44+bytes);
wav.write('RIFF',0);wav.writeUInt32LE(36+bytes,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*4,28);
wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(bytes,40);
let peak=0,energy=0,maxStep=0;const last=[0,0];
for(let i=0;i<frames;i++)for(let channel=0;channel<2;channel++){
  const sample=Math.round(channels[channel][i]*normalization*32767);
  if(Math.abs(sample)>32767)throw Error('La demo satura');wav.writeInt16LE(sample,44+(i*2+channel)*2);
  const decoded=sample/32768;peak=Math.max(peak,Math.abs(decoded));energy+=decoded**2;
  maxStep=Math.max(maxStep,Math.abs(decoded-last[channel]));last[channel]=decoded;
}
if(channels.some(channel=>channel[0]!==0||channel.at(-1)!==0))throw Error('Los extremos no son silenciosos');
const sourceFiles=['public/audio/synthesis.js','public/audio/music-state.js'];
const receipt={
  title:'WaterDuel · duelo modal',kind:'Demo sonora guionada de un duelo condensado',
  file:expanded?'duelo-modal-foley-v2.wav':'duelo-modal-demo.wav',duration,sampleRate,channels:2,encoding:'PCM16',tonic:'D',bpm:96,barSeconds,transitionSeconds,
  provenance:{source:'Síntesis y política modal de producción',externalSamples:false,liveMatchRecording:false,mix:'Música adelantada para facilitar escucha; no modifica el balance del juego'},
  chapters:chapters.map(chapter=>({...chapter,reason:musicDecision(chapter.state).reason})),cues,contactFixtures,
  listenFor:[{at:6.5625,note:'Sol♯',mode:'lydian',degree:'#4'},{at:15.46875,note:'Si',mode:'dorian',degree:'6'},{at:23.125,note:'Si♭',mode:'aeolian',degree:'b6'},{at:28.4375,note:'Mi♭',mode:'phrygian',degree:'b2'}],
  verification:{finite:true,clippedSamples:0,peak,rms:Math.sqrt(energy/(frames*2)),maxSampleStep:maxStep,frames,bytes:wav.length,silentEndpoints:true,policyMatchesAllChapters:true,allChangesOnBars:true,continuousPhraseClock:true},
  sha256:createHash('sha256').update(wav).digest('hex'),
  sources:await Promise.all(sourceFiles.map(async file=>({file,sha256:createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex')}))),
};
await mkdir(destination,{recursive:true});
await writeFile(new URL(receipt.file,destination),wav);
await writeFile(new URL(receipt.file.replace('.wav','.json'),destination),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({file:fileURLToPath(new URL(receipt.file,destination)),duration,chapters:receipt.chapters.map(({start,mode,label})=>({start,mode,label})),verification:receipt.verification,sha256:receipt.sha256},null,2));
