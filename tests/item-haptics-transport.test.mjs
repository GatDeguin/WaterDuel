import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MobileSession} from '../public/mobile-session.js';
import {HostSession} from '../public/host-session.js';
import {DuelEngine,STEP} from '../public/engine.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {firstWeaponContact} from '../public/physics/weapon-bind.js';
import {WEAPONS} from '../public/equipment.js';
import {sanitizeItemImpact,contactHaptic} from '../public/item-haptics.js';

const [serverSource,gameSource,controllerSource]=await Promise.all(['../server.mjs','../public/game.js','../public/controller.js'].map(file=>readFile(new URL(file,import.meta.url),'utf8')));
const hit=(extra={})=>({impulse:.18,closingSpeed:1,materialA:'steel',materialB:'wood',attacker:1,defender:2,...extra});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

function relay(){
  const start=serverSource.indexOf('class Peer {'),end=serverSource.indexOf("server.on('upgrade'",start);assert.ok(start>=0&&end>start);
  // Actual relay class/send/message methods, with memory sockets; no listener or server process.
  const create=new Function('sanitizeItemImpact','Buffer',`
    const peers=new Set(),slots=new Map(),pendingCommands=new Map();let authority=null;
    const MAX_FRAME=8192,expiresAt=Date.now()+600000,expireCommands=()=>{},clearPending=()=>{},renewSession=()=>{throw Error('Unexpected session expiry');};
    ${serverSource.slice(start,end)}
    function peer(role,slot){const messages=[];const socket={destroyed:false,writableLength:0,on(){},end(){},write(bytes){
      const offset=(bytes[1]&127)===126?4:2;messages.push(JSON.parse(bytes.subarray(offset).toString('utf8')));
    }};const value=new Peer(socket);value.role=role;value.slot=slot;if(role==='host')authority=value;if(role==='controller')slots.set(slot,value);return {value,messages};}
    return {peer};`);
  const api=create(sanitizeItemImpact,Buffer),host=api.peer('host'),one=api.peer('controller',1),two=api.peer('controller',2);
  return {...api,host,one,two};
}

function controller(slot=1,{hardware=true}={}){
  const eventStart=controllerSource.indexOf("    if(m.type==='event'){"),eventEnd=controllerSource.indexOf("    if(m.type==='error')",eventStart),
    rumbleStart=controllerSource.indexOf('function rumble('),rumbleEnd=controllerSource.indexOf('\nfunction send(',rumbleStart);
  assert.ok(eventStart>=0&&eventEnd>eventStart&&rumbleStart>=0&&rumbleEnd>rumbleStart);
  const clock={now:10000},document={hidden:false},calls=[],navigator=hardware?{vibrate:pattern=>calls.push(structuredClone(pattern))}:{};
  const create=new Function('contactHaptic','document','navigator','clock',`
    const slot=${slot},Date={now:()=>clock.now},shell={classList:{toggle(){},add(){},remove(){}}},window={matchMedia:()=>({matches:false})};
    let inputFocused=true,welcomed=true,hostOnline=true,rumbleUntil=0,rumblePriority=0,damageTimer=null;
    const setTimeout=()=>1,clearTimeout=()=>{};
    ${controllerSource.slice(rumbleStart,rumbleEnd)}
    return {receive(m){${controllerSource.slice(eventStart,eventEnd)}},focus(value){inputFocused=value;},online(value){hostOnline=value;},stopRumble};`);
  return {...create(contactHaptic,document,navigator,clock),clock,document,calls};
}

test('LAN sanitiza contacto real y entrega sólo a participantes, sin secretos ni prioridades remotas',()=>{
  const r=relay(),payload=hit({attacker:1,defender:0,hostToken:'secret',pattern:[999999],priority:3});
  r.host.value.message({type:'event',name:'clang',slot:2,impact:payload});
  assert.deepEqual(r.one.messages,[{type:'event',name:'clang',slot:2,impact:sanitizeItemImpact(payload)}]);assert.deepEqual(r.two.messages,[]);
  assert.equal(JSON.stringify(r.one.messages).includes('secret'),false);
  r.host.value.message({type:'event',name:'clang',slot:0,impact:{impulse:.2,closingSpeed:1,slotA:1,slotB:2}});
  assert.equal(r.one.messages.length,2);assert.equal(r.two.messages.length,1);assert.deepEqual(r.one.messages[1],r.two.messages[0]);
  r.one.value.message({type:'event',name:'clang',slot:0,impact:hit()});assert.equal(r.two.messages.length,1,'controller cannot impersonate authority contact');
  const old=r.host.value;r.peer('host');old.message({type:'event',name:'clang',slot:0,impact:hit()});assert.equal(r.two.messages.length,1,'orphan host cannot forward contact');
});

test('LAN conserva marker nulo para contacto cero y mantiene clang legacy sin inventar datos físicos',()=>{
  const r=relay();
  r.host.value.message({type:'event',name:'clang',slot:1,impact:hit({impulse:0})});
  assert.deepEqual(r.one.messages,[{type:'event',name:'clang',slot:1,impact:null}]);assert.deepEqual(r.two.messages,[]);
  r.host.value.message({type:'event',name:'clang',slot:0,impact:null});assert.equal(r.two.messages.at(-1).impact,null);
  r.host.value.message({type:'event',name:'clang',slot:0});assert.deepEqual(r.two.messages.at(-1),{type:'event',name:'clang',slot:0});
  const count=r.two.messages.length;r.host.value.message({type:'event',name:'clang',slot:1});assert.equal(r.two.messages.length,count,'legacy contact with an explicit recipient stays local too');
});

test('La sesión móvil local conserva el mismo payload y no recibe impacto exclusivo de J2',async()=>{
  const session=new MobileSession({now:()=>10000});session.bindHost(new HostSession());
  const messages=[],link=session.connect();link.onmessage=event=>messages.push(JSON.parse(event.data));
  link.onopen=()=>link.send(JSON.stringify({type:'hello',role:'controller',slot:1}));await flush();messages.length=0;
  session.event('clang',0,hit({attacker:2,defender:0}));await flush();assert.deepEqual(messages,[]);
  const payload=hit({attacker:1,defender:0,token:'secret'});session.event('clang',0,payload);await flush();
  assert.deepEqual(messages,[{type:'event',name:'clang',slot:0,impact:sanitizeItemImpact(payload)}]);
  session.event('clang',1,hit({impulse:0}));await flush();assert.deepEqual(messages.at(-1),{type:'event',name:'clang',slot:1,impact:null});
  session.event('clang',0);await flush();assert.deepEqual(messages.at(-1),{type:'event',name:'clang',slot:0});
  const count=messages.length;session.event('clang',2);await flush();assert.equal(messages.length,count);link.close();
});

test('El callback real de game emite un clang físico acotado y el send local conserva impact:null',()=>{
  const start=gameSource.indexOf('},onEvent:(name,data)=>{'),end=gameSource.indexOf('\n}});',start);assert.ok(start>=0&&end>start);
  const callback=new Function('audio','send','host','sanitizeItemImpact','name','data',gameSource.slice(start+'},onEvent:(name,data)=>{'.length,end));
  const sent=[],played=[],audio={handleEvent:(...args)=>played.push(args)},host={game:{}};
  callback(audio,message=>sent.push(message),host,sanitizeItemImpact,'material-contact',hit());
  assert.equal(sent.length,0,'body/material audio path must not duplicate the clang haptic');
  callback(audio,message=>sent.push(message),host,sanitizeItemImpact,'clang',hit({slotA:1,slotB:2}));
  assert.deepEqual(sent,[{type:'event',name:'clang',slot:2,impact:sanitizeItemImpact(hit({slotA:1,slotB:2}))}]);
  callback(audio,message=>sent.push(message),host,sanitizeItemImpact,'clang',hit({impulse:0}));assert.equal(sent.at(-1).impact,null);
  assert.equal(played.length,3,'haptic wiring does not duplicate or change audio dispatch');
  const sendStart=gameSource.indexOf('function send(message)'),sendEnd=gameSource.indexOf('\nfunction broadcast()',sendStart),calls=[];
  const send=new Function('mobileMode','mobileSession','hasAuthority','socket','WebSocket',`return (${gameSource.slice(sendStart,sendEnd)});`)(true,{event:(...args)=>calls.push(args)},false,null,{});
  send({type:'event',name:'clang',slot:1,impact:null});send({type:'event',name:'burst',slot:2});
  assert.deepEqual(calls,[['clang',1,null],['burst',2]]);
});

test('El mando consume física real una vez, ignora cero/reposo y nunca vibra por otro jugador',()=>{
  const c=controller(1);
  for(const impact of [null,hit({impulse:0}),hit({impulse:.2,closingSpeed:0}),hit({impulse:.0001}),hit({attacker:2,defender:0})])c.receive({type:'event',name:'clang',slot:0,impact});
  assert.deepEqual(c.calls,[]);
  c.receive({type:'event',name:'clang',slot:0,impact:hit()});assert.deepEqual(c.calls,[contactHaptic(hit(),1).pattern]);
  c.clock.now+=60;c.receive({type:'event',name:'clang',slot:0,impact:hit()});assert.equal(c.calls.length,1,'each solver step cannot restart a contact pulse');
  c.clock.now+=21;c.receive({type:'event',name:'clang',slot:0,impact:hit()});assert.equal(c.calls.length,2);
  const p2=controller(2);p2.receive({type:'event',name:'clang',slot:0,impact:hit({attacker:1,defender:0})});assert.deepEqual(p2.calls,[]);
});

test('Contacto prioridad 0 no interrumpe daño 1/2/3 y respeta foco, visibilidad y disponibilidad',()=>{
  const c=controller();
  for(const name of ['joint-damage','joint-break','burst']){
    c.clock.now+=1000;c.receive({type:'event',name,slot:1});const count=c.calls.length;
    c.receive({type:'event',name:'clang',slot:0,impact:hit({impulse:4,closingSpeed:20})});assert.equal(c.calls.length,count);
  }
  const silent=controller();silent.focus(false);silent.receive({type:'event',name:'clang',slot:0,impact:hit()});
  silent.focus(true);silent.document.hidden=true;silent.receive({type:'event',name:'clang',slot:0,impact:hit()});
  silent.document.hidden=false;silent.online(false);silent.receive({type:'event',name:'clang',slot:0,impact:hit()});assert.deepEqual(silent.calls,[]);
  assert.doesNotThrow(()=>controller(1,{hardware:false}).receive({type:'event',name:'clang',slot:0,impact:hit()}));
  const legacy=controller();legacy.receive({type:'event',name:'clang',slot:2});assert.deepEqual(legacy.calls,[]);
  legacy.receive({type:'event',name:'clang',slot:0});assert.deepEqual(legacy.calls,[27]);
});

test('Un choque resuelto por el motor produce un único patrón local a partir de sus medidas reales',()=>{
  const raw=[],g=new DuelEngine((name,data)=>{if(name==='clang')raw.push(data);});g.setMode('versus');g.setLoadout(1,{weapon:'spear'});g.phase='fight';
  for(const [index,f]of g.fighters.entries()){
    f.rig=new ArticulatedRig({dir:f.dir,baseX:-f.dir*1.53,gravity:0});
    const pose=f.rig.pose(),weapon=WEAPONS[f.equipment.weapon],dx=pose.tip.x-pose.mainHand.x,dy=pose.tip.y-pose.mainHand.y,length=Math.hypot(dx,dy);
    pose.tip={x:pose.mainHand.x+dx/length*weapon.length,y:pose.mainHand.y+dy/length*weapon.length,z:.17};pose.equipment=f.equipment;pose.weaponMass=weapon.mass;
    f.rig.setIntent(pose);if(index)f.rig.q[1]+=.025;f.rig.previousQ=f.rig.q.slice();f.pose=f.rig.pose();
  }
  const [a,b]=g.fighters,contact=firstWeaponContact(a.rig,b.rig);assert.ok(contact);
  a.rig.reactImpulse({point:contact.pointA,impulse:{x:contact.normal.x*.06,y:contact.normal.y*.06}});
  g.resolveWeaponContacts(STEP,{project:false});assert.equal(raw.length,1);
  assert.ok(raw[0].impulse>=.001&&raw[0].closingSpeed>=.06,'the physical measurement itself must exceed the declared significance limits');
  const r=relay(),c1=controller(1),c2=controller(2);
  r.host.value.message({type:'event',name:'clang',slot:0,impact:sanitizeItemImpact(raw[0])});
  for(const message of r.one.messages)c1.receive(message);for(const message of r.two.messages)c2.receive(message);
  assert.deepEqual(c1.calls,[contactHaptic(raw[0],1).pattern]);assert.deepEqual(c2.calls,[contactHaptic(raw[0],2).pattern]);
  assert.deepEqual(g.scores,[0,0],'haptic dispatch does not award a hit');
});
