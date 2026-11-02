import test from 'node:test';
import assert from 'node:assert/strict';
import {HostSession} from '../public/host-session.js';

function finale(){
 const host=new HostSession({opponentSeed:113}),g=host.game;
 host.individual.select('campaign');host.individual.result='complete';host.individual.saved={stage:6,completed:true};
 g.mode='solo';g.phase='matchover';g.phaseClock=3.26;g.winner=1;g.fighters[1].globIntact=false;
 g.onEvent('matchover',{winner:1});g.clock=1.2;
 return {host,g};
}

test('newly earned campaign trophy is a presentation-only scene descriptor and never changes the physical result',()=>{
 const {host,g}=finale(),scores=g.scores.slice(),pose=JSON.stringify(g.fighters.map(f=>f.pose));
 const scene=host.renderState().scene;
 assert.deepEqual(scene.ceremony,{tier:'normal',trophy:'champion',age:1.2});
 assert.equal('ceremony' in g,false);assert.deepEqual(g.scores,scores);assert.equal(JSON.stringify(g.fighters.map(f=>f.pose)),pose);
 scene.ceremony.trophy='master';assert.equal(host.renderState().scene.ceremony.trophy,'champion','descriptor is a fresh bounded copy');
});

test('ceremony begins at zero after the burst clock and advances only with the game clock',()=>{
 const {host,g}=finale();g.clock=0;
 assert.equal(host.renderState().scene.ceremony.age,0);g.clock=.4;
 assert.equal(host.renderState().scene.ceremony.age,.4);assert.equal(g.phaseClock,3.26);
});

test('a repeated result event does not restart an already earned ceremony',()=>{
 const {host,g}=finale();assert.equal(host.renderState().scene.ceremony.age,1.2);
 g.onEvent('matchover',{winner:1});assert.equal(host.renderState().scene.ceremony.age,1.2);
});

test('saved completion, demo, tie, defeat, fight and an intact opponent cannot produce a ceremony',()=>{
 for(const kind of ['saved','demo','tie','defeat','fight','intact']){
  const {host,g}=finale();
  if(kind==='saved')host.individual.result='idle';if(kind==='demo')g.demonstration=true;if(kind==='tie')g.winner=0;
  if(kind==='defeat')g.winner=2;if(kind==='fight')g.phase='fight';if(kind==='intact')g.fighters[1].globIntact=true;
  assert.equal(host.renderState().scene.ceremony,undefined,kind);
 }
});

test('ceremony trophy uses reusable scene geometry and is omitted from replay or invalid descriptors',async()=>{
 const module=await import('../public/rendering/campaign-ceremony.js'),calls=[];
 const renderer=Object.fromEntries(['box','sphere','cylinder','torus'].map(name=>[name,(...args)=>calls.push({name,args})]));
 assert.equal(module.drawCampaignCeremony(renderer,{tier:'normal',trophy:'champion',age:1.2}),true);
 assert.ok(calls.length>=6&&calls.length<=16);assert.ok(calls.every(c=>c.args.every(v=>typeof v==='number'&&Number.isFinite(v))));
 calls.length=0;assert.equal(module.drawCampaignCeremony(renderer,{tier:'advanced',trophy:'master',age:0}),false);
 assert.equal(module.drawCampaignCeremony(renderer,{tier:'evil',trophy:'master',age:1}),false);assert.equal(calls.length,0);
 const {host}=finale();host.playback={clip:{frames:[{time:0,clock:0}],startTime:0,duration:1},index:0,view:{replay:true},time:0,paused:true};
 assert.equal(host.renderState().scene.ceremony,undefined);
});

test('reduced motion presents the complete trophy without growth at any ceremony age',async()=>{
 const {drawCampaignCeremony}=await import('../public/rendering/campaign-ceremony.js');
 const geometry=(age,reducedMotion)=>{
  const calls=[],renderer=Object.fromEntries(['box','sphere','cylinder','torus'].map(name=>[name,(...args)=>calls.push({name,args})]));
  assert.equal(drawCampaignCeremony(renderer,{tier:'advanced',trophy:'master',age},reducedMotion),true);
  return calls;
 };
 const completed=geometry(1.2,false);
 for(const age of [0,.01,.2,.8,1.2,4])assert.deepEqual(geometry(age,true),completed,`reduced motion age ${age}`);
 assert.notDeepEqual(geometry(.2,false),completed,'the normal presentation retains its authored reveal');
});
