import {SOUND_NAMES} from './synthesis.js';
import {FOLEY_NAMES} from './foley-synthesis.js';

const TONAL=new Set(['countdown','go','victory','defeat','draw','ui']);
export const RECORDED_CUES=Object.freeze([...SOUND_NAMES.filter(name=>!TONAL.has(name)),...FOLEY_NAMES]);
const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const rotate=(value,count)=>(value>>>count)|(value<<(32-count));

// Web Crypto is absent on some offline HTTP LAN origins. This bounded fallback
// checks exactly the same SHA-256 without requiring a network or dependency.
export async function audioSHA256(buffer,subtle=globalThis.crypto?.subtle){
  if(subtle){const digest=await subtle.digest('SHA-256',buffer);return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');}
  const bytes=new Uint8Array(buffer),padded=new Uint8Array(Math.ceil((bytes.length+9)/64)*64),view=new DataView(padded.buffer),words=new Uint32Array(64);
  padded.set(bytes);padded[bytes.length]=128;view.setUint32(padded.length-8,Math.floor(bytes.length/0x20000000));view.setUint32(padded.length-4,bytes.length*8);
  const hash=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  for(let offset=0;offset<padded.length;offset+=64){
    for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++){const a=words[i-15],b=words[i-2];words[i]=words[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+words[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10));}
    let [a,b,c,d,e,f,g,h]=hash;
    for(let i=0;i<64;i++){const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]+words[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    for(const [i,value]of [a,b,c,d,e,f,g,h].entries())hash[i]+=value;
  }
  return Array.from(hash,value=>value.toString(16).padStart(8,'0')).join('');
}

function jobsFrom(manifest,url){
  if(manifest?.schemaVersion!==1||!manifest.cues||Object.keys(manifest.cues).length!==RECORDED_CUES.length)throw Error('Inventario de grabaciones inválido.');
  const jobs=[],root=new URL('.',url);let expectedBytes=0;
  for(const name of RECORDED_CUES){
    const takes=manifest.cues[name];if(!Array.isArray(takes)||takes.length!==3)throw Error('Se requieren tres tomas de '+name);
    takes.forEach((entry,variant)=>{
      if(!entry||typeof entry.file!=='string'||!/^[a-zA-Z0-9_-]+\.wav$/.test(entry.file)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Archivo o SHA-256 inválido: '+name);
      const sampleRate=entry.sampleRate??manifest.format?.sampleRate;
      if(![44100,48000].includes(sampleRate)||!Number.isFinite(entry.duration)||entry.duration<.02||entry.duration>3||!Number.isInteger(entry.bytes)||entry.bytes<1||entry.bytes>2_000_000)throw Error('Formato de grabación inválido: '+name);
      expectedBytes+=entry.bytes;jobs.push({...entry,name,variant,url:new URL(entry.file,root)});
    });
  }
  if(expectedBytes>24_000_000)throw Error('El banco de grabaciones supera el presupuesto.');return jobs;
}

/** Fetch/hash/decode is sequential, bounded and completely outside playback.
 * The private staging map is never exposed before the whole bank succeeds. */
export function startRecordedPreparation({context,url,fetch,decode,clock,timeoutMs=20000,onProgress=()=>{},digest=audioSHA256}){
  const controller=new AbortController(),entries=new Map();let settle,settled=false,timer=null;
  const promise=new Promise(resolve=>{settle=resolve;});
  const finish=(state,error='')=>{
    if(settled)return;settled=true;if(timer!==null)clock.clearTimeout(timer);
    if(state!=='ready'){controller.abort();entries.clear();}
    settle({state,error,entries});
  };
  const active=()=>{if(settled)return false;if(context.state==='closed'){finish('cancelled','AudioContext cerrado.');return false;}return true;};
  timer=clock.setTimeout(()=>finish('error','Se agotó el plazo de grabaciones (timeout).'),Number.isFinite(timeoutMs)?Math.max(1,Math.min(60000,timeoutMs)):20000);
  (async()=>{
    const response=await fetch(url,{signal:controller.signal});if(!active())return;if(!response.ok)throw Error('No se pudo cargar el manifiesto de grabaciones.');
    const jobs=jobsFrom(await response.json(),url);if(!active())return;let decodedBytes=0;
    for(const job of jobs){
      const response=await fetch(job.url,{signal:controller.signal});if(!active())return;if(!response.ok)throw Error('No se pudo cargar '+job.file);
      const bytes=await response.arrayBuffer();if(!active())return;if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==job.bytes)throw Error('Tamaño de grabación inválido: '+job.file);
      if(await digest(bytes)!==job.sha256)throw Error('SHA-256 de grabación inválido: '+job.file);if(!active())return;
      // Hash must precede decodeAudioData: browsers may detach its input buffer.
      const buffer=await decode(context,bytes);if(!active())return;
      if(buffer?.numberOfChannels!==1||!Number.isFinite(buffer.duration)||Math.abs(buffer.duration-job.duration)>.015||!Number.isInteger(buffer.length)||buffer.length<1)throw Error('Audio mono o duración inválida: '+job.file);
      const samples=buffer.getChannelData(0);if(!(samples instanceof Float32Array)||samples.length!==buffer.length)throw Error('PCM inválido: '+job.file);
      for(const value of samples)if(!Number.isFinite(value)||Math.abs(value)>1)throw Error('PCM fuera de rango: '+job.file);
      decodedBytes+=buffer.length*4;if(decodedBytes>64_000_000)throw Error('El banco PCM supera el presupuesto.');
      entries.set(job.name+':'+job.variant,buffer);onProgress({ready:entries.size,total:jobs.length});
    }
    finish('ready');
  })().catch(error=>finish('error',String(error?.message??error)));
  return {promise,cancel:()=>finish('cancelled','Carga de grabaciones cancelada.')};
}
