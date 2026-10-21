import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {MUSIC_MODES,MUSIC_STEMS} from '../public/audio/synthesis.js';
import {renderWorkshopMusic} from '../public/audio/music-synthesis.js';

const score=await import('../public/audio/roda-synthesis.js').catch(()=>({}));
const cache=new Map();
function render(stem='mix',mode='dorian'){
  assert.equal(typeof score.renderPuppetRodaMusic,'function','the new score must produce audio, not just a description');
  const key=stem+':'+mode;
  if(!cache.has(key))cache.set(key,score.renderPuppetRodaMusic({sampleRate:8000,stem,mode}));
  return cache.get(key);
}
function stats(samples){
  let peak=0,sum=0,squares=0;
  for(const sample of samples){assert.ok(Number.isFinite(sample));peak=Math.max(peak,Math.abs(sample));sum+=sample;squares+=sample*sample;}
  return {peak,rms:Math.sqrt(squares/samples.length),dc:sum/samples.length};
}
const digest=samples=>createHash('sha256').update(Buffer.from(samples.buffer,samples.byteOffset,samples.byteLength)).digest('hex');

test('puppet roda delivers an original rhythmic score on the existing 20 second modal clock',()=>{
  for(const mode of MUSIC_MODES)for(const stem of [...MUSIC_STEMS,'mix']){
    const track=render(stem,mode);
    assert.equal(track.sampleRate,8000);assert.equal(track.bpm,96);assert.equal(track.bars,8);assert.equal(track.duration,20);assert.equal(track.version,4);
    assert.equal(track.channels.length,2);
    for(const channel of track.channels){
      assert.equal(channel.length,160000);
      const levels=stats(channel);assert.ok(levels.peak<.65,`${mode}/${stem}: unclipped headroom`);
      assert.ok(levels.rms>.005&&levels.rms<.12,`${mode}/${stem}: audible restrained layer (${levels.rms})`);
      assert.ok(Math.abs(levels.dc)<.002,`${mode}/${stem}: no DC offset`);
    }
    assert.notEqual(digest(track.channels[0]),digest(track.channels[1]),'stereo placement must survive export');
  }
  for(const stem of MUSIC_STEMS){
    const old=renderWorkshopMusic({sampleRate:8000,stem,mode:'dorian'}).channels[0],current=render(stem).channels[0];
    assert.ok(stats(Float32Array.from(current,(value,i)=>value-old[i])).rms>.005,`${stem}: replace the chamber phrase audibly`);
  }
});

test('syncopated attacks and resonant string sustain are present in the rendered waveform',()=>{
  const wood=render('wood').channels[0],bass=render('bass').channels[0],rate=8000;
  const window=(samples,at,length=.025)=>stats(samples.subarray(Math.round(at*rate),Math.round((at+length)*rate))).rms;
  // A struck wire rings after the short attack. An off-beat stroke is stronger
  // than its preceding rest: this checks actual samples rather than event labels.
  const open=.625*.75;
  assert.ok(window(wood,open+.07,.08)>.008,'a resonant wire must ring beyond a click');
  assert.ok(window(wood,.625*1.75+.004) > window(wood,.625*1.60)*1.4,'off-beat answering attack');
  assert.ok(window(bass,.625*1.5+.006) > window(bass,.625*1.35)*1.4,'drum displacement before the downbeat');
  const attack=window(wood,open+.005,.04),tail=window(wood,open+.4,.04);
  assert.ok(attack>tail*1.2,'struck toy strings decay instead of holding bowed chords');
});

test('all modal layers sum exactly, loop with ringing tails and render deterministically',()=>{
  for(const mode of MUSIC_MODES){
    const layers=MUSIC_STEMS.map(stem=>render(stem,mode)),mix=render('mix',mode);
    for(let c=0;c<2;c++)for(let i=0;i<mix.channels[c].length;i++)assert.ok(Math.abs(layers.reduce((sum,layer)=>sum+layer.channels[c][i],0)-mix.channels[c][i])<1e-6);
    for(const track of [...layers,mix])for(const channel of track.channels){
      const seam=channel[0]-channel.at(-1);
      assert.ok(Math.abs(seam)<.012,'no amplitude click at wrap');
      assert.ok(Math.abs(seam-(channel[1]-channel[0]))<.012,'no slope click at wrap');
      assert.ok(stats(channel.subarray(channel.length-160)).rms>.0001,'natural tail reaches next phrase');
    }
  }
  assert.equal(new Set(MUSIC_MODES.map(mode=>digest(render('mix',mode).channels[0]))).size,4,'four audibly different modal arrangements');
  const again=score.renderPuppetRodaMusic({sampleRate:8000,stem:'mix',mode:'dorian'});
  for(let c=0;c<2;c++)assert.equal(digest(again.channels[c]),digest(render().channels[c]));
});

test('score rejects invalid formats before allocating an audio bank',()=>{
  assert.equal(typeof score.renderPuppetRodaMusic,'function');
  for(const options of [{sampleRate:7999},{sampleRate:48001},{sampleRate:22050.5},{sampleRate:NaN},{stem:'voices'},{mode:'unknown'}])assert.throws(()=>score.renderPuppetRodaMusic(options),RangeError);
});

test('the shipped puppet bank is complete PCM16 with authentic hashes and exact synthesis samples',async()=>{
  const root=new URL('../public/assets/audio/workshop-roda-v4/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  assert.equal(manifest.provenance.externalSamples,false);assert.equal(manifest.provenance.externalServices,false);
  assert.equal(manifest.provenance.source,'public/audio/roda-synthesis.js');assert.equal(manifest.music.version,4);
  assert.equal(manifest.files.filter(file=>file.kind==='music'&&file.stem!=='mix').length,12);
  for(const mode of MUSIC_MODES)for(const stem of [...MUSIC_STEMS,'mix']){
    const entry=manifest.files.find(file=>file.mode===mode&&file.stem===stem);
    assert.ok(entry,`${mode}/${stem} must be shipped`);
    const bytes=await readFile(new URL(entry.file,root)),actual=score.renderPuppetRodaMusic({sampleRate:entry.sampleRate,stem,mode});
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
    assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.readUInt16LE(22),2);assert.equal(bytes.readUInt16LE(34),16);
    assert.equal(entry.duration,20);assert.equal(bytes.length,44+entry.frames*4);assert.ok(entry.peak<.65&&entry.rms>.005&&entry.rms<.12);
    for(let frame=0;frame<entry.frames;frame++)for(let c=0;c<2;c++)assert.equal(bytes.readInt16LE(44+frame*4+c*2),Math.round(actual.channels[c][frame]*32767)||0,'prepared playback equals current composer');
  }
});
