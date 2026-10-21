import {renderMusic,MUSIC_STEMS,MUSIC_MODES,MODE_INTERVALS} from './synthesis.js';
const TAU=Math.PI*2,BEAT=.625;
const frequency=note=>440*2**((note-69)/12);
const note=(degree,scale,tonic=50)=>tonic+scale[((degree%7)+7)%7]+Math.floor(degree/7)*12;
function place(channels,samples,seconds,sampleRate,pan){
  const start=Math.round(seconds*sampleRate),left=Math.cos((pan+1)*Math.PI/4),right=Math.sin((pan+1)*Math.PI/4);
  for(let i=0;i<samples.length;i++){const index=(start+i)%channels[0].length;channels[0][index]+=samples[i]*left;channels[1][index]+=samples[i]*right;}
}
function bowed(sampleRate,hz,duration,gain){
  const samples=new Float32Array(Math.round(sampleRate*duration));
  for(let i=0;i<samples.length;i++){
    const t=i/sampleRate,attack=Math.min(1,t/.19),release=Math.min(1,(duration-t)/.34),envelope=Math.sin(attack*Math.PI/2)**2*Math.sin(release*Math.PI/2)**2;
    const vibrato=.0028*hz/4.8*Math.sin(TAU*4.8*t),phase=TAU*(hz*t+vibrato),breath=.94+.06*Math.sin(TAU*.8*t);
    let value=0;for(const [partial,level]of [[1,1],[2,.23],[3,.09],[4,.035]])if(hz*partial<sampleRate*.43)value+=Math.sin(phase*partial)*level;
    samples[i]=value*envelope*breath*gain;
  }return samples;
}
function pluck(sampleRate,hz,gain){
  const duration=.31,samples=new Float32Array(Math.round(sampleRate*duration));
  for(let i=0;i<samples.length;i++){const t=i/sampleRate,on=Math.min(1,t/.003),off=Math.min(1,(duration-t)/.025),phase=TAU*hz*t;
    samples[i]=(Math.sin(phase)+.24*Math.sin(phase*2.43)+.055*Math.sin(phase*4.13))*Math.exp(-t/.055)*on*off*gain;}
  return samples;
}
function brush(sampleRate,gain,seed){
  const duration=.22,samples=new Float32Array(Math.round(sampleRate*duration));let state=seed>>>0,filtered=0;
  for(let i=0;i<samples.length;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;const t=i/sampleRate,white=(state/4294967296)*2-1;filtered+=(white-filtered)*.16;
    samples[i]=(white-filtered)*Math.exp(-t/.045)*Math.sin(Math.min(1,t/.005)*Math.PI/2)**2*Math.min(1,(duration-t)/.025)*gain;}
  return samples;
}
/** Original workshop chamber arrangement: bowed diatonic harmony, answering
 * wooden phrases and quiet brushed-metal time. All notes are baked offline;
 * the browser plays the same 12 aligned stems without creating score samples.
 * No clipping limiter/normalization disguises the level tests or loop seam.
 */
export function renderWorkshopMusic({sampleRate=22050,stem='mix',mode='lydian'}={}){
  if(!MUSIC_MODES.includes(mode)||stem!=='mix'&&!MUSIC_STEMS.includes(stem))throw new RangeError('Invalid workshop music mode or stem');
  if(stem==='mix'){
    const parts=MUSIC_STEMS.map(part=>renderWorkshopMusic({sampleRate,stem:part,mode}));
    const channels=[new Float32Array(parts[0].channels[0].length),new Float32Array(parts[0].channels[0].length)];
    for(const part of parts)for(let channel=0;channel<2;channel++)for(let i=0;i<channels[channel].length;i++)channels[channel][i]+=part.channels[channel][i];
    return {channels,sampleRate,bpm:96,bars:8,duration:20,version:3};
  }
  const base=renderMusic({sampleRate,stem,mode}),channels=base.channels,scale=MODE_INTERVALS[mode];
  const progression=[0,3,5,4,0,5,3,4];
  for(let bar=0;bar<8;bar++){
    const at=bar*4*BEAT,root=progression[bar];
    if(stem==='bass'){
      // A small string trio holds thirds/fifths through the bar line. The
      // final dominant rings into bar one through modular sample placement.
      for(const [voice,degree]of [[0,root],[1,root+2],[2,root+4]])place(channels,bowed(sampleRate,frequency(note(degree,scale,50)),2.95,.0135),at,sampleRate,[-.36,.12,.4][voice]);
    }else if(stem==='wood'){
      const answer=bar%2?[4,2,1,0]:[0,2,4,6],positions=bar%2?[.75,1.75,2.75,3.5]:[.75,1.75,2.75,3.75];
      for(let i=0;i<answer.length;i++)place(channels,pluck(sampleRate,frequency(note(root+answer[i],scale,62)),[.027,.018,.024,.016][i]),at+positions[i]*BEAT,sampleRate,i%2?.32:-.28);
    }else{
      for(const [index,beat]of [1,3,3.75].entries())place(channels,brush(sampleRate,index===2?.008:.014,173+bar*37+index*11),at+beat*BEAT,sampleRate,index%2?-.3:.35);
    }
  }
  return {...base,version:3};
}
