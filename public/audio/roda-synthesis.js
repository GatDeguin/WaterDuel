import {MUSIC_STEMS,MUSIC_MODES,MODE_INTERVALS} from './synthesis.js';

const TAU=2*Math.PI,BEAT=.625,DURATION=20;
export const PUPPET_RODA_SCORE=Object.freeze({version:4,bpm:96,bars:8,duration:DURATION,
  title:'Roda de muñecos',instruments:Object.freeze(['struck wire and wooden resonator','small skin drum and heel blocks','seed shaker, brass jingles and ratchet'])});
const frequency=midi=>440*2**((midi-69)/12);
const degree=(index,scale,tonic=50)=>tonic+scale[((index%7)+7)%7]+12*Math.floor(index/7);
const edge=(time,duration,attack=.0015,release=.035)=>Math.sin(Math.min(1,time/attack)*Math.PI/2)**2*Math.sin(Math.min(1,(duration-time)/release)*Math.PI/2)**2;

function place(channels,samples,seconds,rate,pan){
  const start=Math.round(seconds*rate),left=Math.cos((pan+1)*Math.PI/4),right=Math.sin((pan+1)*Math.PI/4);
  const reflection=Math.round(rate*.019),length=channels[0].length;
  for(let i=0;i<samples.length;i++){
    const at=(start+i)%length,echo=(at+reflection)%length,value=samples[i];
    channels[0][at]+=value*left;channels[1][at]+=value*right;
    // A quiet wooden-room reflection belongs to the score, not to a collision.
    channels[0][echo]+=value*right*.075;channels[1][echo]+=value*left*.075;
  }
}

function wire(rate,hz,voice,gain){
  const muted=voice==='buzz',duration=muted?.15:.66,out=new Float32Array(Math.round(duration*rate));
  const formant=voice==='high'?690:430,decay=muted?.027:.19;
  for(let i=0;i<out.length;i++){
    const t=i/rate,phase=TAU*hz*t+.006*Math.sin(TAU*5.1*t);
    let string=0;
    for(const [partial,level]of [[1,1],[2,.43],[3,.25],[4,.13],[6,.045]])if(hz*partial<rate*.43)
      string+=Math.sin(phase*partial)*level*Math.exp(-t/(decay/(1+partial*.045)));
    const cavity=Math.sin(TAU*(formant*t+26*.045*(1-Math.exp(-t/.045))))*Math.exp(-t/.048)*.28;
    const rattle=muted?Math.sin(phase*5.13)*Math.sin(TAU*hz*.5*t)*Math.exp(-t/.024)*.55:0;
    const wah=.76+.24*Math.sin(TAU*2.1*t+.35);
    out[i]=(string*wah+cavity+rattle)*edge(t,duration)*gain;
  }
  return out;
}

function block(rate,hz,gain){
  const duration=.19,out=new Float32Array(Math.round(duration*rate));
  for(let i=0;i<out.length;i++){
    const t=i/rate;let value=0;
    for(const [ratio,level,decay]of [[1,1,.035],[2.43,.38,.021],[4.13,.11,.012]])if(hz*ratio<rate*.43)value+=Math.sin(TAU*hz*ratio*t)*Math.exp(-t/decay)*level;
    out[i]=value*edge(t,duration)*gain;
  }
  return out;
}

function drum(rate,hz,gain,slap=false){
  const duration=.36,out=new Float32Array(Math.round(duration*rate));
  for(let i=0;i<out.length;i++){
    const t=i/rate,phase=TAU*(hz*t+hz*.24*.017*(1-Math.exp(-t/.017)));
    const skin=Math.sin(phase)*Math.exp(-t/(slap?.041:.095));
    const shell=(Math.sin(phase*1.59)*.34+Math.sin(phase*2.14)*.18)*Math.exp(-t/.034);
    out[i]=(skin+shell)*edge(t,duration)*gain;
  }
  return out;
}

function shaker(rate,gain,seed,ratchet=false){
  const duration=ratchet?.22:.14,out=new Float32Array(Math.round(duration*rate));
  const fast=1-Math.exp(-TAU*2600/rate),slow=1-Math.exp(-TAU*700/rate);
  let state=seed>>>0,filtered=0,low=0;
  for(let i=0;i<out.length;i++){
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    const t=i/rate;filtered+=(state/2147483648-1-filtered)*fast;low+=(filtered-low)*slow;
    const teeth=ratchet?.22+.78*Math.max(0,Math.sin(TAU*48*t))**4:1;
    const jingle=(Math.sin(TAU*1840*t)+.35*Math.sin(TAU*2710*t))*Math.exp(-t/.043)*.12;
    out[i]=((filtered-low)*teeth+jingle)*Math.exp(-t/(ratchet?.065:.03))*edge(t,duration,.003)*gain;
  }
  return out;
}

/** Original capoeira-inspired workshop music. A struck wire leads a repeating
 * question/answer over displaced hand-drum strokes and tiny wooden/brass parts.
 * No recording, traditional song or combat event is sampled. The three layers
 * retain the established modal clock and are baked to local WAVs before play.
 */
export function renderPuppetRodaMusic({sampleRate=22050,stem='mix',mode='lydian'}={}){
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>48000)throw new RangeError('Sample rate must be an integer between 8000 and 48000 Hz');
  if(!MUSIC_MODES.includes(mode)||stem!=='mix'&&!MUSIC_STEMS.includes(stem))throw new RangeError('Invalid puppet roda mode or stem');
  const channels=[new Float32Array(sampleRate*DURATION),new Float32Array(sampleRate*DURATION)];
  if(stem==='mix'){
    for(const part of MUSIC_STEMS){const track=renderPuppetRodaMusic({sampleRate,stem:part,mode});
      for(let c=0;c<2;c++)for(let i=0;i<channels[c].length;i++)channels[c][i]+=track.channels[c][i];}
  }else{
    const scale=MODE_INTERVALS[mode];
    for(let bar=0;bar<8;bar++){
      const at=bar*4*BEAT,answer=bar%2!==0;
      if(stem==='wood'){
        const phrase=[[0,'buzz',.47],[.25,'buzz',.34],[.75,'low',.91],[1.75,'high',1],
          [2,'buzz',.42],[2.25,'buzz',.32],[2.75,answer?'high':'low',.84],[3.5,answer?'low':'high',.9]];
        for(const [beat,voice,level]of phrase){const hz=frequency(degree(voice==='high'?1:0,scale,50));
          place(channels,wire(sampleRate,hz,voice,.083*level*(bar===6?1.04:1)),at+beat*BEAT,sampleRate,-.23);}
        for(const [beat,index]of [[1.25,answer?5:2],[3.125,answer?3:6]])
          place(channels,block(sampleRate,frequency(degree(index,scale,62)),.035),at+beat*BEAT,sampleRate,.32);
      }else if(stem==='bass'){
        for(const [beat,level]of [[0,1],[1.5,.72],[2,.86],[3.25,.68]])
          place(channels,drum(sampleRate,frequency(degree(0,scale,38)),.1*level),at+beat*BEAT,sampleRate,-.06);
        for(const beat of [.75,2.75])place(channels,drum(sampleRate,frequency(degree(answer?3:4,scale,50)),.046,true),at+beat*BEAT,sampleRate,.16);
        place(channels,drum(sampleRate,frequency(degree(bar%4===3?6:4,scale,38)),.039),at+3.875*BEAT,sampleRate,.08);
      }else{
        for(let step=0;step<8;step++)place(channels,shaker(sampleRate,step%2?.14:.081,1201+bar*97+step*31),at+step*.5*BEAT,sampleRate,step%2?.35:.15);
        for(const [beat,index]of [[1.5,2],[3.25,answer?6:4]])place(channels,block(sampleRate,frequency(degree(index,scale,74)),.052),at+beat*BEAT,sampleRate,-.34);
        place(channels,shaker(sampleRate,.056,719+bar*53,true),at+3.875*BEAT,sampleRate,.25);
      }
    }
  }
  return {channels,sampleRate,...PUPPET_RODA_SCORE};
}
