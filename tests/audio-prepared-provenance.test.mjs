import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SOURCE_TRANSFORMS,transformSource} from '../audit/audio-prepared-promotion-post1.4/transforms.mjs';
import {AUTHORIZED_JOINT_AUDIO,transformAuthorizedJointAudio} from '../audit/audio-prepared-promotion-post1.4/authorized-joint-audio-hunks.mjs';
import {AUTHORIZED_CONTEXTUAL_AUDIO,transformContextualAudio,beforeContextualAudio} from '../audit/audio-contextual-1.5.2/authorized-contextual-audio-hunks.mjs';

const root=new URL('../',import.meta.url),promotion=new URL('../audit/audio-prepared-promotion-post1.4/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('sources.json',promotion),'utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function assertHistoricalAudioLineage(actual,snapshot,entry){
  assert.equal(sha256(snapshot),entry.sha256,'Historical snapshot changed: '+entry.path);
  const authorized=AUTHORIZED_JOINT_AUDIO.find(spec=>spec.path===entry.path);
  if(authorized){
    assert.equal(authorized.baselineSha256,entry.sha256,'Authorization must preserve the promotion hash');
    const reversed=transformAuthorizedJointAudio(actual,authorized,true);
    assert.equal(sha256(reversed),entry.sha256,'Unexpected delta outside authorized audio hunks: '+entry.path);
    assert.ok(reversed.equals(snapshot),'Inverse differs from historical bytes: '+entry.path);
    assert.ok(transformAuthorizedJointAudio(snapshot,authorized).equals(actual),'Forward differs: '+entry.path);
  }else{
    assert.equal(sha256(actual),entry.sha256,'Protected source changed: '+entry.path);
    assert.ok(actual.equals(snapshot),'Snapshot differs: '+entry.path);
  }
}
const assertAudioLineage=(actual,snapshot,entry)=>assertHistoricalAudioLineage(beforeContextualAudio(actual,entry.path),snapshot,entry);

test('promoted sources reverse byte-for-byte to the three frozen browser-tested clones',async()=>{
  for(const spec of SOURCE_TRANSFORMS){
    const clone=await readFile(new URL(spec.source,root)),actual=beforeContextualAudio(await readFile(new URL(spec.target,root)),spec.target);
    assert.equal(sha256(clone),spec.sha256);
    assert.ok(transformSource(actual,spec,true).equals(clone),'Reverse differs: '+spec.target);
    assert.equal(sha256(actual),manifest.targets.find(target=>target.path===spec.target).proposedSha256);
  }
});

test('promotion preserves the recoverable original product and protected audio sources',async()=>{
  const before=await readFile(new URL('before/public/game-audio.js',promotion));
  assert.equal(sha256(before),'51d56c443e5875e30c8d5c48d7404145fac0ef58d20e169fe81fab2dbae1b653');
  for(const entry of manifest.protected){
    const actual=await readFile(new URL(entry.path,root)),snapshot=await readFile(new URL('before/'+entry.path,promotion));
    assertAudioLineage(actual,snapshot,entry);
  }
});

test('joint audio exceptions are literal, reversible hunks limited to the two authorized files',()=>{
  assert.deepEqual(AUTHORIZED_JOINT_AUDIO.map(spec=>spec.path),['public/audio/scene-audio.js','public/audio/contact-audio.js']);
  assert.deepEqual(AUTHORIZED_JOINT_AUDIO.map(spec=>spec.hunks.length),[7,2]);
  for(const spec of AUTHORIZED_JOINT_AUDIO)assert.equal(new Set(spec.hunks.map(hunk=>hunk.id)).size,spec.hunks.length);
});

test('audio provenance rejects unrelated edits, altered hunks, duplicate hunks and changed historical snapshots',async()=>{
  for(const spec of AUTHORIZED_JOINT_AUDIO){
    const actual=beforeContextualAudio(await readFile(new URL(spec.path,root)),spec.path),snapshot=await readFile(new URL('before/'+spec.path,promotion));
    const entry=manifest.protected.find(entry=>entry.path===spec.path),hunk=spec.hunks[0];
    assert.throws(()=>assertHistoricalAudioLineage(Buffer.concat([actual,Buffer.from('// unrelated edit\r\n')]),snapshot,entry),/Unexpected delta/);
    const unrelated=spec.path.endsWith('scene-audio.js')?['MAX_PARCELS=320','MAX_PARCELS=319']:['cooldown:.095','cooldown:.096'];
    assert.ok(actual.includes(Buffer.from(unrelated[0])));
    assert.throws(()=>assertHistoricalAudioLineage(Buffer.from(actual.toString('utf8').replace(...unrelated)),snapshot,entry),/Unexpected delta/);
    assert.throws(()=>assertHistoricalAudioLineage(Buffer.from(actual.toString('utf8').replace(hunk.after,hunk.after+' ')),snapshot,entry),/Unexpected delta/);
    assert.throws(()=>assertHistoricalAudioLineage(Buffer.from(actual.toString('utf8').replace(hunk.after,'X'+hunk.after.slice(1))),snapshot,entry),/missing or ambiguous/);
    assert.throws(()=>assertHistoricalAudioLineage(Buffer.concat([actual,Buffer.from(hunk.after)]),snapshot,entry),/missing or ambiguous/);
    assert.throws(()=>assertHistoricalAudioLineage(Buffer.from(actual.toString('utf8').replace(hunk.after,hunk.before)),snapshot,entry),/missing or ambiguous/);
    assert.throws(()=>assertHistoricalAudioLineage(Buffer.from(actual.toString('utf8').replaceAll('\n','\r\n')),snapshot,entry),/missing or ambiguous/);
    assert.throws(()=>assertHistoricalAudioLineage(actual,Buffer.concat([snapshot,Buffer.from('\n')]),entry),/Historical snapshot changed/);
  }
});

test('contextual audio is a reversible, hash-pinned later layer over all historical guards',async()=>{
 assert.deepEqual(AUTHORIZED_CONTEXTUAL_AUDIO.map(spec=>spec.path),['public/game-audio.js','public/audio/scene-audio.js','public/audio/contact-audio.js','tests/game-audio.test.mjs']);
 assert.deepEqual(AUTHORIZED_CONTEXTUAL_AUDIO.map(spec=>spec.hunks.length),[14,6,3,1]);
 for(const spec of AUTHORIZED_CONTEXTUAL_AUDIO){
  const actual=await readFile(new URL(spec.path,root)),baseline=await readFile(new URL('../audit/audio-contextual-1.5.2/baseline/'+spec.path,import.meta.url));
  assert.equal(sha256(actual),spec.currentSha256);assert.equal(sha256(baseline),spec.baselineSha256);
  assert.ok(transformContextualAudio(actual,spec,true).equals(baseline));assert.ok(transformContextualAudio(baseline,spec).equals(actual));
  for(const changed of [Buffer.concat([actual,Buffer.from('// unrelated\n')]),Buffer.from(actual.toString('utf8').replace(spec.hunks[0].after,spec.hunks[0].after+' ')),Buffer.concat([actual,Buffer.from(spec.hunks[0].after)])])assert.throws(()=>transformContextualAudio(changed,spec,true),/Unexpected delta/);
  assert.throws(()=>transformContextualAudio(Buffer.concat([baseline,Buffer.from('\n')]),spec),/Unexpected delta/);
  const altered=structuredClone(spec);altered.hunks[0].before+=' ';assert.throws(()=>transformContextualAudio(actual,altered,true),/Unexpected transformed/);
 }
});

test('real worker identity fixture consumes the promoted worker, not the experiment',async()=>{
  const fixture=await readFile(new URL('tests/fixtures/audio-prepared-worker.mjs',root),'utf8');
  assert.ok(fixture.includes("new URL('../../public/audio/effect-bank-worker.js',import.meta.url)"));
  assert.ok(fixture.includes("type:'worker-loaded'"));
  assert.ok(!fixture.includes('/qa/experiments/'));
  const identity=await readFile(new URL('tests/audio-prepared-identity.test.mjs',root),'utf8');
  assert.ok(identity.includes('consumedWorker.sha256'));
  assert.ok(identity.includes('consumedWorker.url'));
});
