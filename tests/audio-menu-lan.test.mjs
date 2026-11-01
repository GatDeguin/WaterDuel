import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {HostSession} from '../public/host-session.js';
function inbox(socket,observe=()=>{}){
 const queue=[],waiting=[];socket.addEventListener('message',event=>{const m=JSON.parse(event.data);observe(m);const index=waiting.findIndex(w=>w.match(m));if(index>=0){const [w]=waiting.splice(index,1);clearTimeout(w.timer);w.resolve(m);}else queue.push(m);});
 return match=>{const index=queue.findIndex(match);if(index>=0)return Promise.resolve(queue.splice(index,1)[0]);return new Promise((resolve,reject)=>{const item={match,resolve,timer:setTimeout(()=>{const i=waiting.indexOf(item);if(i>=0)waiting.splice(i,1);reject(Error('No applied sound state received'));},4000)};waiting.push(item);});};
}
test('all sound controls cross the authenticated LAN relay and return their applied host state',async t=>{
 const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const base=`http://127.0.0.1:${port}`,child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),stdio:'ignore',env:{...process.env,HOST:'127.0.0.1',HTTPS:'0',PORT:String(port),PUBLIC_URL:base}});t.after(()=>child.kill());
 let session;for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/session');if(r.ok){session=await r.json();break;}}catch{}await delay(20);}assert.ok(session,'local relay ready');
 const hostWire=new WebSocket(base.replace('http:','ws:')+'/ws'),hostInbox=inbox(hostWire);t.after(()=>hostWire.close());await new Promise((resolve,reject)=>{hostWire.addEventListener('open',resolve,{once:true});hostWire.addEventListener('error',reject,{once:true});});hostWire.send(JSON.stringify({type:'hello',role:'host',key:session.hostToken}));await hostInbox(m=>m.type==='welcome');
 const receivedCommands=[],host=new HostSession();hostWire.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.type!=='command')return;receivedCommands.push(message);const answer=host.handleCommand(message);hostWire.send(JSON.stringify({type:'command-result',slot:message.slot,relayId:message.relayId,requestId:message.requestId,...answer}));hostWire.send(JSON.stringify({type:'menu-state',state:host.menuState()}));});
 const wireMessages=[],controller=new WebSocket(base.replace('http:','ws:')+'/ws'),receive=inbox(controller,m=>wireMessages.push(m));t.after(()=>controller.close());await new Promise((resolve,reject)=>{controller.addEventListener('open',resolve,{once:true});controller.addEventListener('error',reject,{once:true});});controller.send(JSON.stringify({type:'hello',role:'controller',slot:1,key:new URL(session.links[1]).searchParams.get('key')}));await receive(m=>m.type==='welcome');
 let requestId=0;for(const [command,field,value]of [['setMusicVolume','musicVolume',31],['setEffectsVolume','effectsVolume',72],['setDistortion','distortion',2],['setReverb','reverb',6],['setReverbDecay','reverbDecay',900]]){
  controller.send(JSON.stringify({type:'command',requestId:++requestId,sentAt:Date.now(),command,value}));const result=await receive(m=>m.type==='command-result'&&m.requestId===requestId);assert.equal(result.ok,true,command);const state=await receive(m=>m.type==='menu-state'&&m.state[field]===value);assert.equal(state.state[field],value);assert.equal(host[field],value);assert.ok(!JSON.stringify(state).includes(session.hostToken));
 }
 for(const [command,value,mask]of [['setEffectEnabled',{id:'wood',enabled:false,hostToken:'do-not-forward'},134217726],['setEffectEnabled',{id:'joint',enabled:false},134217724],['setEffectEnabled',{id:'wood',enabled:true},134217725],['setEffectMask',0,0],['setEffectMask',134217727,134217727]]){
  controller.send(JSON.stringify({type:'command',requestId:++requestId,sentAt:Date.now(),command,value}));const result=await receive(m=>m.type==='command-result'&&m.requestId===requestId);assert.equal(result.ok,true,command);
  const state=await receive(m=>m.type==='menu-state'&&m.state.effectMask===mask);assert.equal(host.effectMask,mask);assert.ok(wireMessages.indexOf(state)>wireMessages.indexOf(result),'the applied FX DTO follows its ACK');
  if(command==='setEffectEnabled')assert.deepEqual(receivedCommands.at(-1).value,{id:value.id,enabled:value.enabled});
 }
 controller.send(JSON.stringify({type:'command',requestId:++requestId,sentAt:Date.now(),command:'setEffectEnabled',value:{id:'wood-contact',enabled:true}}));assert.equal((await receive(m=>m.type==='command-result'&&m.requestId===requestId)).ok,false);assert.equal(host.effectMask,134217727);
 controller.send(JSON.stringify({type:'command',requestId:++requestId,sentAt:Date.now(),command:'setReverb',value:101}));assert.equal((await receive(m=>m.type==='command-result'&&m.requestId===requestId)).ok,false);assert.equal(host.reverb,6);
});
