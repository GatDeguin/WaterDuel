import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// This later, user-requested layer preserves the earlier preparation and joint
// audio histories. Literal hunks and BOTH endpoint hashes are mandatory.
export const AUTHORIZED_CONTEXTUAL_AUDIO=JSON.parse(await readFile(new URL('./authorized-contextual-audio-hunks.json',import.meta.url),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function transformContextualAudio(bytes,spec,reverse=false){
 assert.equal(hash(bytes),reverse?spec.currentSha256:spec.baselineSha256,'Unexpected delta outside authorized contextual audio hunks: '+spec.path);
 let text=bytes.toString('utf8');assert.ok(Buffer.from(text).equals(bytes),'Non-lossless UTF-8: '+spec.path);
 const hunks=reverse?[...spec.hunks].reverse():spec.hunks;
 for(const hunk of hunks){const from=reverse?hunk.after:hunk.before,to=reverse?hunk.before:hunk.after;
  assert.ok(from.length>0);assert.equal(text.split(from).length,2,'Literal hunk missing or ambiguous: '+spec.path+' '+hunk.id);text=text.replace(from,()=>to);
 }
 const result=Buffer.from(text);assert.equal(hash(result),reverse?spec.baselineSha256:spec.currentSha256,'Unexpected transformed contextual audio bytes: '+spec.path);return result;
}
export function beforeContextualAudio(bytes,path){const spec=AUTHORIZED_CONTEXTUAL_AUDIO.find(spec=>spec.path===path);return spec?transformContextualAudio(bytes,spec,true):bytes;}
