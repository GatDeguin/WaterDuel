import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {renderMusic,MUSIC_MODES,MUSIC_STEMS} from '../public/audio/synthesis.js';
import {musicStemLevels} from '../public/audio/music-dynamics.js';
const module=await import('../public/audio/music-synthesis.js').catch(()=>({}));
const cache=new Map();
const render=(stem='mix',mode='lydian')=>{assert.equal(typeof module.renderWorkshopMusic,'function');const key=stem+':'+mode;if(!cache.has(key))cache.set(key,module.renderWorkshopMusic({sampleRate:8000,stem,mode}));return cache.get(key);};
const stats=samples=>{let peak=0,sum=0,energy=0;for(const sample of samples){assert.ok(Number.isFinite(sample));peak=Math.max(peak,Math.abs(sample));sum+=sample;energy+=sample*sample;}return {peak,rms:Math.sqrt(energy/samples.length),dc:sum/samples.length};};
test('musical gain follows actual engagement distance without inventing contact cues or changing sources',()=>{
 const base=[.7,.38,.5],game={phase:'fight',fighters:[{pose:{head:{x:-3,y:2,z:0}}},{pose:{head:{x:3,y:2,z:0}}}]},far=musicStemLevels(game,base);game.fighters[1].pose.head.x=-1;const near=musicStemLevels(game,base);
 assert.ok(near[0]>far[0]&&near[1]>far[1]);assert.ok(near.every(value=>value>=0&&value<=1));game.phase='burst';assert.deepEqual(musicStemLevels(game,base),base);assert.deepEqual(base,[.7,.38,.5]);
});

test('new chamber score has original strings, wood and metal phrases, while all stems retain a common 20 second clock',()=>{
 for(const mode of MUSIC_MODES)for(const stem of [...MUSIC_STEMS,'mix']){
  const track=render(stem,mode);assert.equal(track.duration,20);assert.equal(track.bpm,96);assert.equal(track.bars,8);
  for(const channel of track.channels){assert.equal(channel.length,160000);const measured=stats(channel);assert.ok(measured.peak<.65,`${mode}/${stem}: peak headroom`);assert.ok(measured.rms>.005&&measured.rms<.12,`${mode}/${stem}: useful restrained RMS`);assert.ok(Math.abs(measured.dc)<.002);}
  assert.notDeepEqual(track.channels[0],track.channels[1]);
 }
 for(const stem of MUSIC_STEMS){const old=renderMusic({sampleRate:8000,stem,mode:'dorian'}).channels[0],current=render(stem,'dorian').channels[0];const delta=Float32Array.from(current,(value,i)=>value-old[i]);assert.ok(stats(delta).rms>.0005,`${stem}: musical addition is audible, not metadata only`);}
});
test('the delivered arrangement retains exact stem sums, modal identity and seamless ringing tails',()=>{
 for(const mode of MUSIC_MODES){const stems=MUSIC_STEMS.map(stem=>render(stem,mode)),mix=render('mix',mode);
  for(let c=0;c<2;c++)for(let i=0;i<mix.channels[c].length;i++)assert.ok(Math.abs(stems.reduce((sum,track)=>sum+track.channels[c][i],0)-mix.channels[c][i])<1e-6);
  for(const track of [...stems,mix])for(const channel of track.channels){assert.ok(Math.abs(channel[0]-channel.at(-1))<.012,'no amplitude step');assert.ok(Math.abs((channel[0]-channel.at(-1))-(channel[1]-channel[0]))<.012,'no slope click');assert.ok(stats(channel.subarray(0,160)).rms>.0001);assert.ok(stats(channel.subarray(channel.length-160)).rms>.0001);}
 }
 const hashes=new Set(MUSIC_MODES.map(mode=>createHash('sha256').update(Buffer.from(render('mix',mode).channels[0].buffer)).digest('hex')));assert.equal(hashes.size,4);
});
test('shipped local score files are complete PCM16 loops with exact manifest hashes and unclipped measured levels',async()=>{
 const root=new URL('../public/assets/audio/workshop-score-v3/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
 assert.equal(manifest.provenance.externalSamples,false);assert.equal(manifest.music.version,3);assert.equal(manifest.files.filter(file=>file.kind==='music'&&file.stem!=='mix').length,12);
 for(const entry of manifest.files){const bytes=await readFile(new URL(entry.file,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.readUInt16LE(34),16);assert.equal(bytes.length,44+entry.frames*entry.channels*2);assert.ok(entry.peak>0&&entry.peak<.85);assert.ok(entry.rms>0&&entry.rms<.12);
  if(entry.kind==='music'){assert.equal(entry.duration,20);assert.equal(entry.channels,2);const frameBytes=entry.channels*2;for(let c=0;c<entry.channels;c++){const first=bytes.readInt16LE(44+c*2)/32768,last=bytes.readInt16LE(bytes.length-frameBytes+c*2)/32768;assert.ok(Math.abs(first-last)<.012);}}
 }
});
