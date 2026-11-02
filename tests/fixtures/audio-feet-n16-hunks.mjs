import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Later authorization: observe achieved N16 sole support, preserving the exact
// contextual endpoint and every older preparation/joint/score snapshot.
const lines=(...values)=>values.join('\n');
export const AUTHORIZED_N16_FEET_AUDIO=Object.freeze([Object.freeze({
  path:'public/audio/scene-audio.js',
  baselineSha256:'238c558d7ab455df1ae686788ca02a2e4f423c9fd2a6ec8cda98d0dd049772fd',
  currentSha256:'0cb426a1c7c414bdc5a56d900e669f3edd6f5c52ec28e24aae77a9642d9d1473',
  hunks:Object.freeze([Object.freeze({id:'observe-achieved-n16-foot-support',before:lines(
    'function feetOf(fighter,pose){',
    '  const feet={},contacts=fighter.rig?.contacts;',
    '  // Engine foot points are ankle/boot centers, .075 above TABLE_TOP. Grounded',
    '  // means the observed pose is near that physical support height, and any rig',
    '  // contact actually reports stance. Swinging support targets alone are not hits.',
    '  for(const key of FEET){',''),after:lines(
    'function feetOf(fighter,pose){',
    "  const feet={},contacts=fighter.rig?.contacts,physical=fighter.pose?.feet,hasPhysical=Object.hasOwn(fighter.pose??{},'feet');",
    '  for(const key of FEET){',
    '    if(hasPhysical){',
    '      // N16 exports achieved hull support separately from its moving centre.',
    '      // Gait anchors are intentions; malformed physical data stays silent.',
    "      const foot=physical?.[key==='footF'?'front':'back'],support=foot?.support;",
    '      feet[key]={grounded:!!pose[key]&&foot?.stance===true&&finite(support?.x)&&finite(support?.y)&&finite(support?.z)&&Math.abs(support.y-TABLE_TOP)<=.002};',
    '      continue;',
    '    }',
    '    // Historical poses use .075-high proxy centres and optional stance targets.','')})])
})]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function transformN16FeetAudio(bytes,spec,reverse=false){
  assert.equal(hash(bytes),reverse?spec.currentSha256:spec.baselineSha256,'Unexpected delta outside authorized N16 foot audio hunks: '+spec.path);
  let source=bytes.toString('utf8');
  assert.ok(Buffer.from(source,'utf8').equals(bytes),'Non-lossless UTF-8: '+spec.path);
  for(const hunk of reverse?[...spec.hunks].reverse():spec.hunks){
    const from=reverse?hunk.after:hunk.before,to=reverse?hunk.before:hunk.after;
    assert.ok(from&&to&&from!==to,'Invalid authorized N16 foot audio hunk: '+hunk.id);
    assert.equal(source.split(from).length-1,1,'Literal hunk missing or ambiguous: '+spec.path+' '+hunk.id);
    source=source.replace(from,()=>to);
  }
  const result=Buffer.from(source,'utf8');
  assert.equal(hash(result),reverse?spec.baselineSha256:spec.currentSha256,'Unexpected transformed N16 foot audio bytes: '+spec.path);
  return result;
}
export function beforeN16FeetAudio(bytes,path){
  const spec=AUTHORIZED_N16_FEET_AUDIO.find(entry=>entry.path===path);
  return spec?transformN16FeetAudio(bytes,spec,true):bytes;
}
