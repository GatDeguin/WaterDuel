import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {renderSound} from '../public/audio/synthesis.js';
import {FOLEY_NAMES,renderFoley} from '../public/audio/foley-synthesis.js';
import {EFFECT_JOBS,startEffectPreparation} from '../public/audio/effect-bank-preparation.js';
import {renderEffectRequest} from '../public/audio/effect-bank-worker.js';

test('real worker protocol preserves every Float32 bit for all 84 original runtime variants',{timeout:15000},async t=>{
  let consumedWorker=null;
  const workerFactory=()=>{
    const thread=new Worker(new URL('./fixtures/audio-prepared-worker.mjs',import.meta.url));
    const worker={postMessage:message=>thread.postMessage(message),terminate:()=>thread.terminate()};
    thread.on('message',data=>{if(data?.type==='worker-loaded'){consumedWorker=data;return;}worker.onmessage?.({data});});
    thread.on('error',error=>worker.onerror?.({message:error.message}));
    thread.on('messageerror',()=>worker.onmessageerror?.());
    return worker;
  };
  let allocated=0;
  const context={state:'running',createBuffer(channels,length,sampleRate){
    allocated++;assert.equal(channels,1);assert.equal(sampleRate,22050);
    const samples=new Float32Array(length);return {length,sampleRate,getChannelData:channel=>{
      assert.equal(channel,0);return samples;
    }};
  }};
  const preparation=startEffectPreparation({context,workerFactory});
  t.after(()=>preparation.cancel());
  const result=await preparation.promise;
  assert.equal(result.state,'ready',result.error);assert.equal(allocated,84);assert.equal(result.entries.size,84);
  const actualWorker=new URL('../public/audio/effect-bank-worker.js',import.meta.url);
  assert.equal(consumedWorker.url,actualWorker.href);
  assert.equal(consumedWorker.sha256,createHash('sha256').update(await readFile(actualWorker)).digest('hex'));

  const hash=createHash('sha256');let bytes=0;
  for(const job of EFFECT_JOBS){
    const render=FOLEY_NAMES.includes(job.name)?renderFoley:renderSound;
    const expected=render(job.name,{sampleRate:22050,seed:31+job.variant*79});
    const actual=result.entries.get(job.name+':'+job.variant).getChannelData(0);
    assert.equal(actual.length,expected.length);
    const actualBytes=Buffer.from(actual.buffer),expectedBytes=Buffer.from(expected.buffer);
    assert.ok(actualBytes.equals(expectedBytes),'Exact Float32 mismatch: '+job.name+':'+job.variant);
    hash.update(job.name+':'+job.variant+'\n');hash.update(actualBytes);bytes+=actualBytes.length;
  }
  assert.equal(bytes,4810452);assert.equal(result.metrics.bytes,bytes);
  t.diagnostic(JSON.stringify({variants:84,exactFloat32Bits:true,sampleBytes:bytes,bankSHA256:hash.digest('hex'),
    scope:'Node real worker transport and fake AudioBuffer; no browser FPS or hardware output measurement'}));
});

test('worker rejects names, variants and commands outside the closed inventory',()=>{
  for(const request of [{type:'render',name:'unknown',variant:0},{type:'render',name:'wood',variant:3},
    {type:'render',name:'wood',variant:-1},{type:'other',name:'wood',variant:0}]){
    assert.throws(()=>renderEffectRequest(request),RangeError);
  }
});

