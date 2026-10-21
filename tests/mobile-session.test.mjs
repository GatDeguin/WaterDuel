import test from 'node:test';
import assert from 'node:assert/strict';
import {HostSession} from '../public/host-session.js';

const api=await import('../public/mobile-session.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
const neutral=()=>({offX:0,offY:0,mainX:0,mainY:0,lean:0,bodyY:0,wrist:0,thrust:false,guard:false,attackHeld:false,headX:0,headZ:0});
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
async function fixture({host=true,onSettings=()=>{}}={}){
  assert.equal(typeof api.MobileSession,'function','The in-process mobile session must exist');
  const clock={now:10000},messages=[],pauses=[],interactions=[];
  const session=new api.MobileSession({now:()=>clock.now});
  const gameHost=host?new HostSession({onSettings}):null;
  if(gameHost)session.bindHost(gameHost,{onPause:value=>pauses.push(value),onInteraction:()=>interactions.push(clock.now)});
  const link=session.connect();link.onmessage=event=>messages.push(JSON.parse(event.data));
  let opened=0;link.onopen=()=>{opened++;link.send(JSON.stringify({type:'hello',role:'controller',slot:1}));};
  assert.equal(link.readyState,0,'Socket-compatible open notification is asynchronous');
  await flush();assert.equal(link.readyState,1);assert.equal(opened,1);
  const send=value=>link.send(JSON.stringify(value));
  return {session,host:gameHost,clock,link,messages,pauses,interactions,send,
    control:(value,seq=1)=>send({type:'control',seq,sentAt:clock.now,...value}),
    command:(command,value,requestId=1,at=clock.now)=>send({type:'command',requestId,sentAt:at,command,...(value===undefined?{}:{value})})};
}

test('mobile singleton and socket-compatible handshake work without a server or invitation',async()=>{
  const f=await fixture();assert.ok(api.mobileSession instanceof api.MobileSession);assert.equal(typeof api.connectMobileController,'function');
  assert.deepEqual(f.messages.map(m=>m.type),['welcome','state','menu-state']);
  assert.deepEqual(f.messages[0],{type:'welcome',role:'controller',slot:1,hostOnline:true,serverTime:f.clock.now});
  const menu=f.messages[2].state;assert.equal(menu.mode,'solo');assert.equal(menu.phase,'ready');
  assert.equal(menu.fighters.length,2);assert.equal('game'in menu,false);assert.equal('hostToken'in menu,false);
  f.messages[2].state.fighters[0].equipment.weapon='maul';f.session.publish();await flush();
  assert.equal(f.messages.at(-1).state.fighters[0].equipment.weapon,'sword','published DTOs never alias the real host');
  f.link.close();
});

test('late host binding notifies an already welcomed local controller and permits publication',async()=>{
  const f=await fixture({host:false});assert.equal(f.messages[0].hostOnline,false);assert.deepEqual(f.session.sample(),neutral());
  f.control({lean:1});assert.deepEqual(f.session.sample(),neutral(),'no host cannot retain an active input');
  const host=new HostSession();f.session.bindHost(host);await flush();
  assert.ok(f.messages.some(m=>m.type==='host'&&m.online===true));assert.equal(f.messages.at(-1).type,'menu-state');
  assert.equal(f.messages.at(-1).state.phase,'ready');f.link.close();
});

test('controls are bounded copies, sequence-ordered, stale after 450 ms and explicitly neutralized',async()=>{
  const f=await fixture();const input={mainX:2,mainY:-2,lean:.7,bodyY:-.8,wrist:Infinity,attackHeld:true,headX:.4,headZ:-.5};
  f.control(input);const first=f.session.sample();assert.deepEqual(first,{...neutral(),mainX:1,mainY:-1,lean:.7,bodyY:-.8,attackHeld:true,headX:.4,headZ:-.5});
  input.lean=-1;first.lean=-1;assert.equal(f.session.sample().lean,.7);
  f.control({lean:-1},1);assert.equal(f.session.sample().lean,.7,'replayed sequence cannot overwrite input');
  f.clock.now+=450;assert.equal(f.session.sample().lean,.7);f.clock.now++;assert.deepEqual(f.session.sample(),neutral());
  f.control({mainX:1},2);assert.equal(f.session.sample().mainX,1);
  f.control({mainX:1,attackHeld:true,neutralize:true},3);assert.deepEqual(f.session.sample(),neutral());
  f.control({mainX:1},4);f.session.neutralize();assert.deepEqual(f.session.sample(),neutral());
  assert.ok(f.interactions.length>=1);f.link.close();assert.deepEqual(f.session.sample(),neutral());
});

test('ui menu pause clears every input and refuses holds until an explicit fresh gesture after resume',async()=>{
  const f=await fixture();f.control({lean:1,attackHeld:true,mainX:1,headZ:1});
  f.send({type:'ui-state',menuOpen:true});assert.equal(f.session.paused,true);assert.deepEqual(f.session.sample(),neutral());
  f.control({lean:1,attackHeld:true,mainX:1},2);assert.deepEqual(f.session.sample(),neutral());
  f.send({type:'ui-state',menuOpen:false});assert.equal(f.session.paused,false);assert.deepEqual(f.session.sample(),neutral());
  f.control({bodyY:-1},3);assert.equal(f.session.sample().bodyY,-1);
  assert.deepEqual(f.pauses.slice(-2),[true,false]);
  const before=f.session.paused;f.send({type:'ui-state',menuOpen:'true'});assert.equal(f.session.paused,before,'only boolean state changes pause');
  f.link.close();
});

test('commands preserve ACK-before-final-state even when HostSession settings publish an intermediate state',async()=>{
  let session;const f=await fixture({onSettings:()=>session?.publish()});session=f.session;f.messages.length=0;
  f.command('setQuality','eco');assert.equal(f.host.game.quality,'eco','delegates to the real HostSession');
  assert.equal(f.messages.length,0,'local responses wait until the send call has returned');await flush();
  const ack=f.messages.findIndex(m=>m.type==='command-result');assert.ok(ack>=0);assert.equal(f.messages[ack].ok,true);
  assert.ok(f.messages.slice(ack+1).some(m=>m.type==='menu-state'&&m.state.quality==='eco'),'a later state settles controller ackSerial');
  assert.ok(f.interactions.length>0);f.link.close();
});

test('real loading, renderer failure and command validation remain authoritative in the local host',async()=>{
  const f=await fixture();f.host.assetStatus={loading:true,ready:0,total:11,names:[],errors:[]};
  f.command('start');await flush();assert.equal(f.messages.findLast(m=>m.type==='command-result').ok,false);assert.equal(f.host.game.phase,'ready');
  f.host.assetStatus.loading=false;f.host.rendererError='No hay arena 3D';f.command('start',undefined,2);await flush();
  assert.equal(f.messages.findLast(m=>m.type==='command-result').ok,false);assert.equal(f.host.game.phase,'ready');
  f.host.rendererError='';f.command('start',undefined,3);await flush();assert.equal(f.messages.findLast(m=>m.type==='command-result').ok,true);assert.equal(f.host.game.phase,'countdown');
  f.command('setBestOf',5,4);await flush();assert.equal(f.messages.findLast(m=>m.type==='command-result').ok,false,'preparation cannot bypass fight/countdown restrictions');
  f.link.close();
});

test('bad JSON, missing hello, invalid commands, stale envelopes and duplicate requests cannot mutate the host',async()=>{
  const f=await fixture();f.link.send('{bad json');f.link.send('[]');f.link.send('null');
  f.command('setQuality','eco',0);f.command('setQuality','eco',2,f.clock.now-2501);f.command('setQuality','eco',3,f.clock.now+1001);
  f.command('setVolume','80',4);await flush();assert.equal(f.host.game.quality,'high');assert.equal(f.host.volume,55);
  f.command('setVolume',80,5);await flush();assert.equal(f.host.volume,80);f.command('setVolume',20,5);await flush();assert.equal(f.host.volume,80,'request replay cannot repeat or replace an action');
  f.link.close();const unopened=f.session.connect();unopened.onopen=()=>unopened.send(JSON.stringify({type:'command',requestId:1,sentAt:f.clock.now,command:'setQuality',value:'eco'}));
  await flush();assert.equal(f.host.game.quality,'high','open transport without hello has no command authority');unopened.close();
});

test('single-phone standalone rejects Versus explicitly without changing the remote-capable HostSession',async()=>{
  const f=await fixture();f.command('setMode','versus');await flush();
  const result=f.messages.findLast(m=>m.type==='command-result');assert.equal(result.ok,false);assert.match(result.message,/individual|teléfono|móvil/i);
  assert.equal(f.host.game.mode,'solo');
  assert.equal(f.host.handleCommand({type:'command',requestId:99,sentAt:f.clock.now,command:'setMode',value:'versus'}).ok,true,'the shared PC host still supports Versus');
  f.link.close();
});

test('ping and victim events retain wire semantics and closing cancels queued deliveries',async()=>{
  const f=await fixture();f.messages.length=0;f.send({type:'ping',at:123});f.session.event('burst',2);f.session.event('burst',0);f.session.event('joint-break',1);await flush();
  assert.deepEqual(f.messages[0],{type:'pong',at:123,serverTime:f.clock.now});
  assert.deepEqual(f.messages.filter(m=>m.type==='event'),[{type:'event',name:'burst',slot:2},{type:'event',name:'burst',slot:0},{type:'event',name:'joint-break',slot:1}]);
  const count=f.messages.length;f.session.event('clang',0);f.link.close();await flush();assert.equal(f.messages.length,count);assert.equal(f.link.readyState,3);
  assert.deepEqual(f.session.sample(),neutral());
});

test('closing an open-menu controller cannot leave a later local connection permanently paused',async()=>{
  const f=await fixture();f.send({type:'ui-state',menuOpen:true});assert.equal(f.session.paused,true);
  f.link.close();assert.equal(f.session.paused,false);assert.equal(f.pauses.at(-1),false);assert.deepEqual(f.session.sample(),neutral());
  const link=f.session.connect();link.onopen=()=>link.send(JSON.stringify({type:'hello',role:'controller',slot:1}));await flush();
  link.send(JSON.stringify({type:'control',seq:1,sentAt:f.clock.now,mainX:1}));assert.equal(f.session.sample().mainX,1,'a new connection has a fresh sequence and no abandoned dialog');
  link.close();
});
