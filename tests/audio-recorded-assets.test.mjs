import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {RECORDED_CUES} from '../public/audio/recorded-effect-bank.js';

const root=new URL('../public/assets/audio/recorded-foley-v1/',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=async()=>JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
function wave(bytes){
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
  assert.equal(bytes.readUInt32LE(4)+8,bytes.length);let format=null,data=null;
  for(let at=12;at+8<=bytes.length;){
    const id=bytes.toString('ascii',at,at+4),size=bytes.readUInt32LE(at+4),start=at+8;
    assert.ok(start+size<=bytes.length,'WAV chunks stay inside the real file');
    if(id==='fmt '){assert.equal(format,null);assert.ok(size>=16);format={encoding:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),rate:bytes.readUInt32LE(start+4),byteRate:bytes.readUInt32LE(start+8),alignment:bytes.readUInt16LE(start+12),bits:bytes.readUInt16LE(start+14)};}
    if(id==='data'){assert.equal(data,null);data=bytes.subarray(start,start+size);}at=start+size+(size&1);
  }
  assert.deepEqual(format,{encoding:1,channels:1,rate:44100,byteRate:88200,alignment:2,bits:16});assert.ok(data&&data.length>0&&data.length%2===0);
  let peak=0,energy=0,sum=0,clipped=0;const samples=[];
  for(let i=0;i<data.length;i+=2){const value=data.readInt16LE(i)/32768;samples.push(value);peak=Math.max(peak,Math.abs(value));energy+=value*value;sum+=value;if(Math.abs(value)>=32767/32768)clipped++;}
  return {data,samples,frames:samples.length,duration:samples.length/44100,peak,rms:Math.sqrt(energy/samples.length),dc:sum/samples.length,clipped};
}

test('the shipped real recording bank has exactly 22 cues and three independently identified variants each',async()=>{
  const m=await manifest();assert.equal(m.schemaVersion,1);assert.deepEqual(Object.keys(m.cues),RECORDED_CUES);
  assert.deepEqual(m.format,{container:'WAV',encoding:'PCM signed 16-bit little-endian',sampleRate:44100,channels:1,bits:16});
  assert.equal(m.provenance.externalRecordings,true);assert.equal(m.provenance.syntheticLayers,false);assert.equal(m.provenance.variationDescription,'Edited variants from identified source recordings; some share originals and use different cuts or mixes, not 66 independent natural takes.');
  const files=[];
  for(const name of RECORDED_CUES){const entries=m.cues[name];assert.equal(entries.length,3,name);assert.equal(new Set(entries.map(x=>x.sha256)).size,3,`${name}: three distinct final waveforms`);for(const entry of entries){assert.match(entry.file,/^[a-z0-9-]+\.wav$/);files.push(entry.file);}}
  assert.equal(new Set(files).size,66);const actual=(await readdir(root)).filter(file=>file.endsWith('.wav')).sort();assert.deepEqual(actual,[...files,m.preview.file].sort());
});

test('all 66 real WAV headers, hashes, durations, levels and PCM budgets match the delivered bytes',async()=>{
  const m=await manifest();let bytes=0,decoded=0;
  for(const[name,entries]of Object.entries(m.cues))for(const entry of entries){
    const raw=await readFile(new URL(entry.file,root)),w=wave(raw);bytes+=raw.length;decoded+=w.frames*4;
    assert.equal(sha(raw),entry.sha256,entry.file);assert.equal(raw.length,entry.bytes);assert.equal(w.frames,entry.frames);assert.equal(entry.sampleRate,44100);assert.equal(entry.channels,1);assert.equal(entry.bits,16);assert.equal(w.duration,entry.duration);
    assert.ok(w.duration>=.02&&w.duration<=3);assert.ok(raw.length<=2_000_000);assert.equal(w.clipped,0);assert.ok(w.peak>.025&&w.peak<.57,`${entry.file}: useful signal and at least 5 dB headroom`);
    if(name==='ring')assert.ok(w.peak<.12,'ring is a restrained recorded tail, not another full impact');
    assert.ok(w.rms>.0005&&w.rms<.25);assert.ok(Math.abs(w.dc)<.001,`${entry.file}: no material DC offset`);
    assert.equal(w.samples[0],0);assert.equal(w.samples.at(-1),0);assert.ok(Math.abs(w.samples[1])<.015&&Math.abs(w.samples.at(-2))<.015,'soft sample boundaries');
    assert.ok(Math.abs(w.peak-entry.metrics.peak)<1e-10);assert.ok(Math.abs(w.rms-entry.metrics.rms)<1e-10);
  }
  assert.equal(bytes,m.totalBytes);assert.equal(decoded,m.decodedFloat32Bytes);assert.ok(bytes<=24_000_000);assert.ok(decoded<=64_000_000);
});

test('each rendered variant identifies its real originals, exact frame cuts, author, license and processing',async()=>{
  const m=await manifest(),used=new Set();assert.ok(Object.keys(m.sources).length>=6);
  for(const[name,entries]of Object.entries(m.cues)){
    const edits=new Set();
    for(const entry of entries){
      assert.ok(Array.isArray(entry.layers)&&entry.layers.length>0);assert.ok(entry.processing.length>=4);assert.ok(entry.processing.every(step=>typeof step==='string'&&step.length>3));
      for(const layer of entry.layers){
        const source=m.sources[layer.sourceId];assert.ok(source,layer.sourceId);used.add(layer.sourceId);
        assert.match(source.originalSHA256,/^[a-f0-9]{64}$/);assert.equal(layer.originalSHA256,source.originalSHA256);assert.match(source.sourceURL,/^https:\/\//);assert.match(source.downloadURL,/^https:\/\//);
        assert.ok(source.author.length>2);assert.ok(['CC0-1.0','CC-BY-3.0'].includes(source.license));assert.match(source.licenseURL,/^https:\/\/creativecommons\.org\//);
        assert.equal(source.sampleRate,44100);assert.equal(source.bits,16);assert.ok(source.originalBytes>44);assert.ok(source.frames>0);
        assert.ok(Number.isInteger(layer.cut.startFrame)&&Number.isInteger(layer.cut.endFrame));assert.ok(layer.cut.startFrame>=0&&layer.cut.endFrame>layer.cut.startFrame&&layer.cut.endFrame<=source.frames);
        assert.equal(layer.cut.sampleRate,44100);assert.equal(layer.cut.startSeconds,layer.cut.startFrame/44100);assert.equal(layer.cut.endSeconds,layer.cut.endFrame/44100);assert.ok(Number.isFinite(layer.gainDb));assert.ok(layer.delaySeconds>=0&&layer.delaySeconds<3);
      }
      edits.add(JSON.stringify(entry.layers.map(({sourceId,cut,gainDb,delaySeconds})=>({sourceId,cut,gainDb,delaySeconds}))));
    }
    assert.equal(edits.size,3,`${name}: independently described edits, never a duplicate declared as a take`);
  }
  assert.equal(used.size,Object.keys(m.sources).length,'credits contain exactly the source recordings actually used');
});

test('the listening montage contains all variants and the three physical burst layer combinations without clipping',async()=>{
  const m=await manifest(),raw=await readFile(new URL(m.preview.file,root)),w=wave(raw);assert.equal(sha(raw),m.preview.sha256);assert.equal(raw.length,m.preview.bytes);assert.equal(w.clipped,0);
  const chapters=m.preview.chapters;assert.equal(chapters.length,69);assert.equal(new Set(chapters.filter(x=>x.kind==='variant').map(x=>`${x.cue}:${x.variant}`)).size,66);
  assert.equal(chapters.filter(x=>x.kind==='burst-layer-mix').length,3);
  let previousEnd=0;for(const chapter of chapters){assert.ok(chapter.start>=previousEnd);assert.ok(chapter.duration>0&&chapter.start+chapter.duration<=w.duration+1/44100);previousEnd=chapter.start+chapter.duration;}
  assert.ok(w.peak<.95,'co-playing burst layers retains preview headroom');
});

test('the shipped game uses the recorded bank and both phone menus expose the actual credits page',async()=>{
  const game=await readFile(new URL('../public/game.js',import.meta.url),'utf8');
  assert.match(game,/import\s*\{\s*RecordedGameAudio\s+as\s+GameAudio\s*\}\s*from\s*['"]\.\/audio\/recorded-game-audio\.js['"]/);
  assert.match(game,/audio\s*=\s*new GameAudio\(/);assert.doesNotMatch(game,/from\s*['"]\.\/game-audio\.js['"]/);
  const href='./assets/audio/recorded-foley-v1/credits.html';
  for(const filename of ['mobile.html','controller.html']){
    const html=await readFile(new URL('../public/'+filename,import.meta.url),'utf8');assert.ok(html.includes(`href="${href}"`),filename);
  }
  const desktop=await readFile(new URL('../public/index.html',import.meta.url),'utf8');assert.ok(!desktop.includes(href),'PC remains scene and QR without an added credits interface');
  const credits=await readFile(new URL('credits.html',root),'utf8');assert.match(credits,/creativecommons\.org/);assert.match(credits,/Mike Koenig/);assert.match(credits,/Vinrax/);
});
