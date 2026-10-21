import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {contactAudio} from '../public/audio/contact-audio.js';
import {WorkshopEffects,EFFECT_LIMITS} from '../public/workshop-effects.js';

const hit={slot:2,joint:'mainElbow',damage:.65,amount:.2,at:{x:1.4,y:2,z:.17},impulse:.04};

test('Daño y rotura usan crujido/joint del banco existente con posición causal y sin explosión',()=>{
  for(const name of ['joint-damage','joint-break']){
    const plan=contactAudio(name,hit),adapted=contactAudio('material-contact',{...hit,jointEvent:name});
    assert.deepEqual(plan,adapted);assert.deepEqual(plan.cues.map(c=>c.name),['wood-contact','joint']);
    assert.ok(plan.cues.every(c=>c.x===hit.at.x&&Number.isFinite(c.intensity)&&c.intensity>0&&c.intensity<=1));
    assert.ok(plan.key.includes('2')&&plan.key.includes('mainElbow'));assert.ok(plan.cooldown>0);
  }
  assert.notEqual(contactAudio('joint-damage',hit).key,contactAudio('joint-break',hit).key,'a break cannot be swallowed by a preceding damage cue gate');
  for(const data of [{...hit,damage:0},{...hit,damage:NaN},{...hit,amount:0},{...hit,joint:'unknown'},{...hit,slot:0},{...hit,at:{x:NaN,y:2}}])
    assert.deepEqual(contactAudio('joint-damage',data).cues,[]);
});

test('Callback real de game adapta audio y transmite cada evento con víctima, sin cambiar burst/clang',async()=>{
  const source=await readFile(new URL('../public/game.js',import.meta.url),'utf8'),start=source.indexOf('},onEvent:(name,data)=>{'),end=source.indexOf('\n}});',start);
  assert.ok(start>=0&&end>start);const callback=new Function('audio','send','host','name','data',source.slice(start+'},onEvent:(name,data)=>{'.length,end));
  for(const name of ['joint-damage','joint-break']){
    const played=[],sent=[],audio={handleEvent:(...args)=>played.push(args)},game={fighters:[]};callback(audio,m=>sent.push(m),{game},name,hit);
    assert.equal(played[0][0],'material-contact');assert.equal(played[0][1].jointEvent,name);assert.equal(played[0][1].joint,hit.joint);assert.equal(played[0][2],game);
    assert.deepEqual(sent,[{type:'event',name,slot:2}]);
  }
});

test('Handler móvil real vibra sólo en víctima de articulación y no vibra por slot0/ajeno',async()=>{
  const source=await readFile(new URL('../public/controller.js',import.meta.url),'utf8'),start=source.indexOf("    if(m.type==='event'){"),end=source.indexOf("    if(m.type==='error')",start);
  assert.ok(start>=0&&end>start);const receive=new Function('m','slot','damageFeedback','rumble',source.slice(start,end));
  for(const name of ['joint-damage','joint-break'])for(const slot of [1,2]){
    const calls=[];receive({type:'event',name,slot},slot,()=>calls.push('burst'),pattern=>calls.push(pattern));assert.equal(calls.length,1);assert.ok(Array.isArray(calls[0])||Number.isFinite(calls[0]));
    for(const victim of [0,3,slot===1?2:1]){const ignored=[];receive({type:'event',name,slot:victim},slot,()=>ignored.push('burst'),pattern=>ignored.push(pattern));assert.deepEqual(ignored,[]);}
  }
});

test('Astillas de eventos físicos son visualOnly, acotadas y no se generan sin daño/posición válidos',()=>{
  const effects=new WorkshopEffects({ambient:false});
  assert.ok(effects.emit('joint-damage',hit)>0);assert.ok(effects.emit('joint-break',hit)>0);
  for(let i=0;i<100;i++)effects.emit('joint-break',hit);
  assert.ok(effects.particles.length<=EFFECT_LIMITS.wood);assert.ok(effects.particles.every(p=>p.visualOnly===true&&p.kind==='wood'));
  const before=effects.particles.length;assert.equal(effects.emit('joint-break',{...hit,damage:0}),0);assert.equal(effects.emit('joint-break',{...hit,at:null}),0);assert.equal(effects.particles.length,before);
});
