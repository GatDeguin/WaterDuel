import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {STEP,neutral} from '../public/engine.js';
import {HostSession} from '../public/host-session.js';
import {MobileSession} from '../public/mobile-session.js';
import {RemoteInputBuffer,isFreshRemoteInput} from '../public/remote-input.js';
import {FrameMetrics} from '../public/performance.js';
import {AdaptiveQuality} from '../public/adaptive-quality.js';

const source=await readFile(new URL('../public/game.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function surface(){const listeners=new Map();return {addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},fire(name){for(const fn of listeners.get(name)||[])fn({preventDefault(){}});}};}
async function runtime(){
  const raf=[],requests=[],pauses=[],unlocks=[],clock={now:0},window=surface(),canvas=surface();let host;
  const document={...surface(),hidden:false,documentElement:{dataset:{mobileGame:'true'}},getElementById:id=>id==='gameCanvas'?canvas:null};
  const mobileSession=new MobileSession({now:()=>clock.now});
  class Host extends HostSession{constructor(options){super(options);host=this;}}
  class Renderer{constructor(){this.waterSurfaces=new Map();this.stats={camera:null};}loadAssets(fn){fn({loading:false,ready:11,total:11,names:[],errors:[]});}render(){}dispose(){}}
  class Audio{configure(){}handleEvent(){}update(){}unlock(){unlocks.push(clock.now);}setPaused(value){pauses.push(value);}}
  class Network{static OPEN=1;static CONNECTING=0;constructor(){throw Error('Standalone must not open WebSocket');}}
  vm.runInNewContext(source.replace(/^import[^\n]+;\s*$/gm,''),{
    document,window,mobileSession,STEP,neutral,HostSession:Host,Renderer3D:Renderer,GameAudio:Audio,
    RemoteInputBuffer,isFreshRemoteInput,FrameMetrics,AdaptiveQuality,HostQRCodes:class{hide(){}setSession(){throw Error('No QR session on standalone');}},
    performance:{now:()=>clock.now},requestAnimationFrame:fn=>raf.push(fn),Date,WebSocket:Network,
    location:{protocol:'http:',host:'localhost'},AbortSignal,console,
    fetch:async url=>{requests.push(url);throw Error('Standalone must not discover a LAN session');},setTimeout:()=>0,clearTimeout(){},
  },{filename:'public/game.js'});
  const link=mobileSession.connect(),messages=[];link.onmessage=e=>messages.push(JSON.parse(e.data));await flush();
  link.send(JSON.stringify({type:'hello',role:'controller',slot:1}));await flush();
  return {host,link,messages,requests,pauses,unlocks,window,document,mobileSession,
    frame(ms=17){clock.now+=ms;assert.ok(raf.length);raf.shift()(clock.now);},
    send(message){link.send(JSON.stringify({sentAt:clock.now,...message}));},
    start(){return host.handleCommand({type:'command',requestId:1,sentAt:clock.now,command:'start'});}};
}
test('El juego móvil real inicia una autoridad local sin QR, fetch de sesión ni WebSocket',async()=>{
  const r=await runtime();assert.deepEqual(r.requests,[]);
  assert.ok(r.messages.some(m=>m.type==='welcome'&&m.hostOnline));
  assert.ok(r.messages.some(m=>m.type==='menu-state'&&m.state.mode==='solo'));
  assert.equal(r.start().ok,true);r.frame(40);assert.ok(r.host.game.clock>0);
});
test('El STEP del móvil consume los dos gestos y el menú pausa sin recuperar un hold antiguo',async()=>{
  const r=await runtime();r.start();
  r.send({type:'control',seq:1,mainX:-1,mainY:0,wrist:0,lean:.6,attackHeld:true});r.frame(40);
  assert.equal(r.host.game.fighters[0].controller.mainX,-1);assert.equal(r.host.game.fighters[0].controller.lean,.6);
  r.send({type:'ui-state',menuOpen:true});const before=r.host.game.clock;r.frame(80);assert.equal(r.host.game.clock,before);
  r.send({type:'ui-state',menuOpen:false});r.frame(40);assert.ok(r.host.game.clock>before);
  assert.equal(r.host.game.fighters[0].controller.mainX,0);assert.equal(r.host.game.fighters[0].controller.lean,0);
});
test('Perder foco en móvil pausa física y audio; volver requiere un gesto nuevo',async()=>{
  const r=await runtime();r.start();r.send({type:'control',seq:1,lean:1});r.frame(40);
  r.window.fire('blur');const before=r.host.game.clock;r.frame(80);assert.equal(r.host.game.clock,before);assert.equal(r.pauses.at(-1),true);
  r.window.fire('focus');r.frame(40);assert.ok(r.host.game.clock>before);assert.equal(r.host.game.fighters[0].controller.lean,0);
});
