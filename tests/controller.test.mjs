import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {RadialJoystick,weaponGesture,movementGesture} from '../public/joysticks.js';

const source=await readFile(new URL('../public/controller.js',import.meta.url),'utf8');
const markup=await readFile(new URL('../public/controller.html',import.meta.url),'utf8');
const neutral={offX:0,offY:0,mainX:0,mainY:0,lean:0,bodyY:0,wrist:0,thrust:false,guard:false,attackHeld:false,headX:0,headZ:0};

class Surface{
  constructor(){this.listeners=new Map();}
  addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);}
  fire(type,properties={}){
    const event={target:this,currentTarget:this,preventDefault(){this.defaultPrevented=true;},...properties};
    for(const handler of this.listeners.get(type)||[])handler(event);
    return event;
  }
}
class Element extends Surface{
  constructor(id,attributes){
    super();this.id=id;this.attributes=attributes;this.style={left:'50%',top:'50%'};
    this.dataset={};this.hidden=false;this.textContent='';this.captures=new Set();
    const classes=new Set();this.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),
      contains:name=>classes.has(name),toggle(name,force){const add=force??!classes.has(name);if(add)classes.add(name);else classes.delete(name);return add;}};
  }
  getBoundingClientRect(){const size=/Knob$/.test(this.id)?28:100;return {left:0,top:0,width:size,height:size,right:size,bottom:size};}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){if(this.captures.delete(id))this.fire('lostpointercapture',{pointerId:id});}
}
function controller({slot=1,offset=120000,secure=false,permission='granted',reducedMotion=false}={}){
  const elements=new Map();
  for(const match of markup.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)){
    const attributes=new Map([...match[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    elements.set(match[1],new Element(match[1],attributes));
  }
  const document=new Surface();document.hidden=false;
  document.getElementById=id=>{assert.ok(elements.has(id),`real controller.html must contain ${id}`);return elements.get(id);};
  const window=new Surface();window.isSecureContext=secure;window.matchMedia=()=>({matches:reducedMotion});
  class Orientation{static async requestPermission(){return permission;}}
  if(secure)window.DeviceOrientationEvent=Orientation;
  const clock={now:1700000000000},intervals=[],timeouts=new Map(),sockets=[],haptics=[];let nextTimer=1;
  class Socket{
    static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
    constructor(url){this.url=url;this.readyState=Socket.CONNECTING;this.messages=[];sockets.push(this);}
    send(value){assert.equal(this.readyState,Socket.OPEN);this.messages.push(JSON.parse(value));}
    open(){this.readyState=Socket.OPEN;this.onopen?.();}
    receive(value){this.onmessage?.({data:JSON.stringify(value)});}
    close(){this.readyState=Socket.CLOSED;this.onclose?.();}
  }
  class ClockDate extends Date{static now(){return clock.now;}}
  const context=vm.createContext({window,document,navigator:{vibrate:pattern=>haptics.push(pattern)},DeviceOrientationEvent:Orientation,
    location:{search:`?slot=${slot}&key=fixture-private-key`,protocol:'http:',host:'fixture.local:8787'},
    URLSearchParams,WebSocket:Socket,Date:ClockDate,
    setInterval:(callback,ms)=>{intervals.push({callback,ms});return nextTimer++;},
    setTimeout:(callback,ms)=>{const id=nextTimer++;timeouts.set(id,{callback,ms});return id;},
    clearTimeout:id=>timeouts.delete(id),console,RadialJoystick,weaponGesture,movementGesture});
  new vm.Script(source.replace(/^import[^\n]+;\s*$/gm,''),{filename:'public/controller.js'}).runInContext(context,{timeout:1000});
  const socket=sockets[0];assert.ok(socket);socket.open();
  socket.receive({type:'welcome',role:'controller',hostOnline:true,serverTime:clock.now+offset});
  return {elements,document,window,clock,intervals,timeouts,socket,sockets,haptics,
    element:id=>elements.get(id),
    state:()=>JSON.parse(vm.runInContext('JSON.stringify(state)',context)),
    last:()=>socket.messages.filter(message=>message.type==='control').at(-1)};
}
function activateAll(h){
  h.element('offPad').fire('pointerdown',{pointerId:1,clientX:86,clientY:50});
  h.element('mainPad').fire('pointerdown',{pointerId:2,clientX:50,clientY:14});
  h.element('headPad').fire('pointerdown',{pointerId:6,clientX:86,clientY:50});
}
function assertNeutral(h){
  assert.deepEqual(h.state(),neutral);
  for(const id of ['offKnob','mainKnob','headKnob'])assert.equal(h.element(id).style.left,'50%',id);
  for(const id of ['offKnob','mainKnob'])assert.equal(h.element(id).style.top,'50%',id);
  assert.match(h.element('mainPadValue').textContent,/MUÑECA 0°/);
}

test('Dos manos independientes: izquierda mueve y derecha inclina muñeca y mantiene ataque sin pulso',()=>{
  const h=controller({slot:2});activateAll(h);
  assert.equal(h.element('controllerShell').dataset.slot,'2');
  assert.deepEqual(h.state(),{offX:0,offY:0,mainX:0,mainY:1,lean:1,bodyY:0,wrist:.65,thrust:false,guard:false,attackHeld:true,headX:1,headZ:0});
  h.element('offPad').fire('pointermove',{pointerId:99,clientX:14,clientY:50});
  assert.equal(h.last().lean,1,'an unrelated finger must not move a captured pad');
  h.element('offPad').fire('pointerup',{pointerId:1});
  assert.equal(h.last().lean,0);assert.equal(h.last().mainY,1);assert.equal(h.last().wrist,.65);assert.equal(h.last().attackHeld,true);
  assert.equal(h.last().thrust,false);assert.equal(h.last().attackHeld,true);assert.equal(h.last().guard,false);
  h.element('mainPad').fire('pointercancel',{pointerId:2});
  assert.equal(h.last().mainY,0);assert.equal(h.last().attackHeld,false);assert.equal(h.last().guard,false);
});

test('El derecho inclina la muñeca sin botón de ataque ni slider independiente',()=>{
  const h=controller();assert.equal(h.elements.has('thrustBtn'),false);assert.equal(h.elements.has('wristTrack'),false);
  const main=h.element('mainPad');main.fire('pointerdown',{pointerId:41,clientX:50,clientY:14});
  assert.equal(h.last().mainY,1);assert.equal(h.last().wrist,.65);assert.equal(h.last().attackHeld,true);assert.equal(h.last().thrust,false);
  main.fire('pointermove',{pointerId:41,clientX:50,clientY:86});
  assert.equal(h.last().mainY,-1);assert.equal(h.last().wrist,-.65);assert.equal(h.last().thrust,false);
  main.fire('pointerup',{pointerId:41});assert.equal(h.last().wrist,0);assert.equal(h.last().attackHeld,false);
});

for(const slot of [1,2])test(`Jugador ${slot}: atrás pide parada y conserva los campos de recogida, extensión y orientación`,()=>{
  const h=controller({slot}),pad=h.element('mainPad'),status=()=>h.element('mainPadValue').textContent;
  const controls=()=>Object.fromEntries(['mainX','mainY','wrist','attackHeld','thrust','headX','headZ'].map(key=>[key,h.last()[key]]));
  pad.fire('pointerdown',{pointerId:42,clientX:86,clientY:50});
  assert.deepEqual(controls(),{mainX:1,mainY:0,wrist:0,attackHeld:true,thrust:false,headX:0,headZ:0});
  assert.match(status(),/^ARMA EXTENDIDA · MUÑECA 0°$/);
  pad.fire('pointermove',{pointerId:42,clientX:14,clientY:50});
  assert.deepEqual(controls(),{mainX:-1,mainY:0,wrist:0,attackHeld:true,thrust:false,headX:0,headZ:0},'retreat uses the same signed axis and level, without a new wire field');
  assert.match(status(),/^PARADA · MUÑECA 0°$/);
  assert.match(pad.getAttribute('aria-label'),/izquierda recoge y busca desviar el arma rival, derecha extiende, arriba o abajo orienta/);
  pad.fire('pointermove',{pointerId:42,clientX:50,clientY:14});
  assert.deepEqual(controls(),{mainX:0,mainY:1,wrist:.65,attackHeld:true,thrust:false,headX:0,headZ:0});
  assert.match(status(),/^ARMA EXTENDIDA/,'vertical intent keeps its existing status and wrist control');
  pad.fire('pointermove',{pointerId:42,clientX:14,clientY:14});
  assert.ok(Math.abs(h.last().mainX+Math.SQRT1_2)<1e-9);assert.ok(Math.abs(h.last().mainY-Math.SQRT1_2)<1e-9);
  assert.equal(h.last().attackHeld,true);assert.equal(h.last().thrust,false);assert.match(status(),/^PARADA/);
  // Real radial dead-zone remapping: inspect both sides of the delivered X=-.08 boundary.
  pad.fire('pointermove',{pointerId:42,clientX:50-28*(.08+.92*.079),clientY:50});
  assert.ok(h.last().mainX>-.08&&h.last().mainX<0);assert.equal(h.last().attackHeld,false);assert.match(status(),/^APUNTANDO/);
  pad.fire('pointermove',{pointerId:42,clientX:50-28*(.08+.92*.081),clientY:50});
  assert.ok(h.last().mainX<-.08);assert.equal(h.last().attackHeld,false);assert.match(status(),/^RECOGIENDO/);
  pad.fire('pointermove',{pointerId:42,clientX:50-28*(.08+.92*.251),clientY:50});
  assert.ok(h.last().mainX<-.25);assert.equal(h.last().attackHeld,true);assert.match(status(),/^PARADA/);
  pad.fire('pointerup',{pointerId:42});
  assert.deepEqual(controls(),{mainX:0,mainY:0,wrist:0,attackHeld:false,thrust:false,headX:0,headZ:0});
  assert.equal(status(),'EN NEUTRO · MUÑECA 0°');
});

for(const signal of ['blur','pagehide','hidden','disconnect','host-offline','resize','orientationchange'])test(`La señal ${signal} neutraliza ejes, botones, knobs y ARIA sin reactivar gestos viejos`,()=>{
  const h=controller();activateAll(h);
  h.element('offPad').fire('pointermove',{pointerId:1,clientX:50,clientY:86});assert.equal(h.state().bodyY,-1);
  if(signal==='hidden'){h.document.hidden=true;h.document.fire('visibilitychange');}
  else if(signal==='disconnect')h.socket.close();
  else if(signal==='host-offline')h.socket.receive({type:'host',online:false});
  else h.window.fire(signal);
  assertNeutral(h);
  h.element('mainPad').fire('pointermove',{pointerId:2,clientX:86,clientY:14});
  h.element('offPad').fire('pointermove',{pointerId:1,clientX:100,clientY:-999});
  h.element('headPad').fire('pointermove',{pointerId:6,clientX:86,clientY:14});
  assertNeutral(h);
  if(signal!=='disconnect')for(const [key,value] of Object.entries(neutral))assert.equal(h.last()[key],value);
});

for(const signal of ['pointerup','pointercancel','lostpointercapture'])test(`Derecho: ${signal} restaura muñeca, ataque y knob sin que otro dedo libere`,()=>{
  const h=controller(),element=h.element('mainPad');
  element.fire('pointerdown',{pointerId:11,clientX:50,clientY:14});
  assert.equal(h.state().wrist,.65);assert.equal(h.state().attackHeld,true);
  element.fire(signal,{pointerId:12});assert.equal(h.state().wrist,.65,'another pointer must not release this gesture');
  element.fire(signal,{pointerId:11});
  assert.equal(h.state().wrist,0);assert.equal(h.state().attackHeld,false);assert.equal(h.element('mainKnob').style.left,'50%');assert.equal(h.element('mainKnob').style.top,'50%');
  assert.match(element.getAttribute('aria-label'),/Muñeca 0 grados/);
});

test('El teclado del controlador real opera movimiento y arma; liberar o centrar recoge muñeca y ataque',()=>{
  const h=controller(),off=h.element('offPad'),main=h.element('mainPad');
  off.fire('keydown',{key:'ArrowRight'});main.fire('keydown',{key:'ArrowUp'});
  assert.equal(h.last().lean,1);assert.equal(h.last().mainY,1);assert.equal(h.last().wrist,.65);assert.equal(h.last().attackHeld,true);
  off.fire('keyup',{key:'ArrowRight'});assert.equal(h.last().lean,0);assert.equal(h.last().mainY,1);
  main.fire('blur');assert.equal(h.last().mainY,0);assert.equal(h.last().attackHeld,false);
  assert.equal(h.last().wrist,0);main.fire('keydown',{key:'ArrowDown'});assert.equal(h.last().wrist,-.65);
  main.fire('keydown',{key:'Home'});assert.equal(h.last().wrist,0);assert.equal(h.last().attackHeld,false);assert.equal(h.last().thrust,false);
  for(const message of h.socket.messages.filter(message=>message.type==='control'))assert.equal(message.thrust,false);
  assert.equal(h.last().guard,false);assert.equal(h.elements.has('guardBtn'),false);assert.equal(h.elements.has('leanTrack'),false);
});

test('El mando aplica zona muerta radial y escala continua usando su knob real',()=>{
  const h=controller(),pad=h.element('mainPad');
  pad.fire('pointerdown',{pointerId:20,clientX:52,clientY:50});assert.equal(h.last().mainX,0);
  pad.fire('pointermove',{pointerId:20,clientX:65.12,clientY:50});assert.ok(Math.abs(h.last().mainX-.5)<1e-9);
  pad.fire('pointermove',{pointerId:20,clientX:500,clientY:-500});assert.ok(Math.hypot(h.last().mainX,h.last().mainY)<=1+1e-12);
  pad.fire('pointerup',{pointerId:20});assert.equal(h.last().mainX,0);assert.equal(h.last().mainY,0);
});

test('Teclado de movimiento combina distancia y acción corporal; el ataque conserva diagonal circular',()=>{
  const h=controller(),pad=h.element('offPad');
  pad.fire('keydown',{key:'ArrowRight'});pad.fire('keydown',{key:'ArrowLeft'});assert.equal(h.last().lean,0);
  pad.fire('keyup',{key:'ArrowLeft'});assert.equal(h.last().lean,1);
  pad.fire('keydown',{key:'ArrowUp'});assert.ok(Math.abs(h.last().lean-Math.SQRT1_2)<1e-9);assert.ok(Math.abs(h.last().bodyY-Math.SQRT1_2)<1e-9);assert.equal(h.last().offY,0);
  pad.fire('keydown',{key:'Home'});assert.equal(h.last().lean,0);assert.equal(h.last().bodyY,0);
  const main=h.element('mainPad');main.fire('keydown',{key:'ArrowRight'});main.fire('keydown',{key:'ArrowUp'});
  assert.ok(Math.abs(h.last().mainX-Math.SQRT1_2)<1e-9);assert.ok(Math.abs(h.last().mainY-Math.SQRT1_2)<1e-9);assert.equal(h.last().attackHeld,true);
});

for(const slot of [1,2])test(`Jugador ${slot}: izquierda combina avance, finta al fondo y agacharse sin tocar el arma`,()=>{
  const h=controller({slot}),pad=h.element('offPad');
  pad.fire('pointerdown',{pointerId:21,clientX:50,clientY:14});assert.equal(h.last().bodyY,1);assert.equal(h.last().lean,0);
  assert.notEqual(h.element('offKnob').style.top,'50%');assert.match(h.element('offPadValue').textContent,/FINTA/);
  const send=h.intervals.find(item=>item.ms===33).callback;
  for(let i=0;i<5;i++){h.clock.now+=33;send();assert.equal(h.last().bodyY,1);assert.equal(h.last().thrust,false);}
  pad.fire('pointermove',{pointerId:21,clientX:50,clientY:86});assert.equal(h.last().bodyY,-1);assert.match(h.element('offPadValue').textContent,/AGACHARSE/);
  pad.fire('pointermove',{pointerId:21,clientX:86,clientY:86});assert.ok(Math.abs(h.last().lean-Math.SQRT1_2)<1e-9);assert.ok(Math.abs(h.last().bodyY+Math.SQRT1_2)<1e-9);
  assert.equal(h.last().mainX,0);assert.equal(h.last().mainY,0);assert.equal(h.last().attackHeld,false);
  pad.fire('pointerup',{pointerId:21});assert.equal(h.last().bodyY,0);assert.equal(h.last().lean,0);
  assert.equal(h.element('offKnob').style.top,'50%');assert.equal(h.last().offX,0);assert.equal(h.last().offY,0);assert.equal(h.last().guard,false);
});

test('Derecha usa umbral de magnitud, sostiene nivel fresco sin pulsos y soltar cancela ataque',()=>{
  const h=controller(),pad=h.element('mainPad');
  pad.fire('pointerdown',{pointerId:22,clientX:58.4224,clientY:50});assert.equal(h.last().attackHeld,false);
  pad.fire('pointermove',{pointerId:22,clientX:58.9376,clientY:50});assert.equal(h.last().attackHeld,true);
  const send=h.intervals.find(item=>item.ms===33).callback;
  for(let index=0;index<5;index++){h.clock.now+=33;send();assert.equal(h.last().attackHeld,true);assert.equal(h.last().thrust,false);}
  pad.fire('pointerup',{pointerId:22});assert.equal(h.last().attackHeld,false);assert.equal(h.last().thrust,false);assert.equal(h.last().wrist,0);
  h.clock.now+=33;send();assert.equal(h.last().attackHeld,false);
});

for(const offset of [-120000,120000])test(`Welcome y pong envían sentAt en reloj del servidor con desfase ${offset} ms`,()=>{
  const h=controller({offset});assert.equal(h.last().sentAt,h.clock.now+offset);
  const periodicSend=h.intervals.find(item=>item.ms===33).callback;
  h.clock.now+=1000;h.intervals.find(item=>item.ms===2000).callback();
  const ping=h.socket.messages.at(-1);assert.equal(ping.type,'ping');assert.equal(ping.at,h.clock.now);
  h.clock.now+=100;
  h.socket.receive({type:'pong',at:ping.at,serverTime:ping.at+offset+50});
  periodicSend();assert.equal(h.last().sentAt,h.clock.now+offset);
  assert.equal(h.element('rttLabel').textContent,'RTT 100 ms');
  assert.ok(h.last().seq>1);assert.deepEqual(h.state(),neutral);
});

test('Daño sólo hace feedback en el mando afectado o empate y conserva un único timer visual',()=>{
  const h=controller();h.socket.receive({type:'event',name:'burst',slot:2});assert.equal(h.haptics.length,0);
  h.socket.receive({type:'event',name:'burst',slot:1});assert.equal(h.haptics.length,1);assert.equal(h.element('controllerShell').classList.contains('damage-feedback'),true);
  h.socket.receive({type:'event',name:'burst',slot:0});assert.equal(h.haptics.length,2);assert.equal(h.timeouts.size,1);
  for(const timeout of h.timeouts.values())timeout.callback();assert.equal(h.element('controllerShell').classList.contains('damage-feedback'),false);
  const p2=controller({slot:2});p2.socket.receive({type:'event',name:'burst',slot:1});assert.equal(p2.haptics.length,0);
  p2.socket.receive({type:'event',name:'burst',slot:2});assert.equal(p2.haptics.length,1);
});

test('Movimiento reducido conserva el flash de daño sin aplicar shake',()=>{
  const h=controller({reducedMotion:true});h.socket.receive({type:'event',name:'burst',slot:0});
  assert.equal(h.element('controllerShell').classList.contains('damage-feedback'),true);
  assert.equal(h.element('controllerShell').classList.contains('reduce-damage-motion'),true);
});

test('Articulación, desprendimiento y globo tienen patrones distintos y el golpe mayor no se corta por un clang',()=>{
  const h=controller();
  h.socket.receive({type:'event',name:'joint-damage',slot:2});assert.equal(h.haptics.length,0);
  h.socket.receive({type:'event',name:'joint-damage',slot:1});const joint=Array.from(h.haptics.at(-1));
  assert.deepEqual(joint,[18,22,32]);
  h.socket.receive({type:'event',name:'joint-break',slot:1});const fracture=Array.from(h.haptics.at(-1));
  assert.notDeepEqual(fracture,joint);
  h.socket.receive({type:'event',name:'burst',slot:1});const head=Array.from(h.haptics.at(-1));
  assert.deepEqual(head,[90,30,90]);assert.notDeepEqual(head,fracture);
  const count=h.haptics.length;
  h.socket.receive({type:'event',name:'clang',slot:0});
  h.socket.receive({type:'event',name:'joint-damage',slot:1});assert.equal(h.haptics.length,count);
  h.clock.now+=300;h.socket.receive({type:'event',name:'clang',slot:0});assert.equal(h.haptics.at(-1),27);
});

test('Salir del mando cancela la vibración de daño y una página oculta no vuelve a iniciarla',()=>{
  const h=controller();h.socket.receive({type:'event',name:'burst',slot:1});
  h.window.fire('blur');assert.equal(h.haptics.at(-1),0);
  const count=h.haptics.length;h.document.hidden=true;
  h.socket.receive({type:'event',name:'joint-break',slot:1});assert.equal(h.haptics.length,count);
});

test('Sensor calibrado controla cabeza X/Z, no muñeca; inválido, timeout y blur neutralizan sin reactivar valores viejos',async()=>{
  const h=controller({secure:true});h.element('motionBtn').fire('click');await new Promise(resolve=>setImmediate(resolve));
  h.window.fire('deviceorientation',{gamma:10,beta:20});assert.equal(h.last().headX,0);assert.equal(h.last().headZ,0);
  h.window.fire('deviceorientation',{gamma:22.5,beta:7.5});assert.equal(h.last().headX,.5);assert.equal(h.last().headZ,-.5);assert.equal(h.last().wrist,0);
  h.window.fire('deviceorientation',{gamma:NaN,beta:20});assert.equal(h.last().headX,0);assert.equal(h.last().headZ,0);
  h.window.fire('deviceorientation',{gamma:-50,beta:50});h.window.fire('deviceorientation',{gamma:80,beta:-100});
  assert.equal(h.last().headX,1);assert.equal(h.last().headZ,-1);
  const expiry=[...h.timeouts.values()].find(timer=>timer.ms===400);assert.ok(expiry);expiry.callback();assert.equal(h.last().headX,0);assert.equal(h.last().headZ,0);
  h.window.fire('deviceorientation',{gamma:0,beta:0});h.window.fire('deviceorientation',{gamma:25,beta:25});
  h.window.fire('blur');assertNeutral(h);h.window.fire('deviceorientation',{gamma:80,beta:80});assertNeutral(h);
});

test('Permiso/sitio sin sensor conserva fallback de cabeza independiente y no obliga a activarlo para atacar',async()=>{
  const h=controller({secure:true,permission:'denied'});h.element('motionBtn').fire('click');await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.element('warning').textContent,/rechazado/);h.window.fire('deviceorientation',{gamma:10,beta:10});assert.equal(h.last().headX,0);
  h.element('mainPad').fire('pointerdown',{pointerId:31,clientX:86,clientY:50});assert.equal(h.last().attackHeld,true);
  h.element('headPad').fire('pointerdown',{pointerId:32,clientX:86,clientY:14});assert.ok(Math.abs(h.last().headX-Math.SQRT1_2)<1e-9);assert.ok(Math.abs(h.last().headZ-Math.SQRT1_2)<1e-9);
  h.element('headPad').fire('pointerup',{pointerId:32});assert.equal(h.last().headX,0);assert.equal(h.last().headZ,0);assert.equal(h.last().attackHeld,true);
  h.element('mainPad').fire('pointerup',{pointerId:31});assert.equal(h.last().attackHeld,false);
  h.element('headPad').fire('keydown',{key:'ArrowRight'});h.element('headPad').fire('keydown',{key:'ArrowUp'});
  assert.ok(Math.abs(h.last().headX-Math.SQRT1_2)<1e-9);assert.ok(Math.abs(h.last().headZ-Math.SQRT1_2)<1e-9);
  h.element('headPad').fire('keydown',{key:'Home'});assert.equal(h.last().headX,0);assert.equal(h.last().headZ,0);
});

test('Recalibrar toma un nuevo centro y desactivar inclinación impide que eventos posteriores muevan la cabeza',async()=>{
  const h=controller({secure:true});h.element('motionBtn').fire('click');await new Promise(resolve=>setImmediate(resolve));
  h.window.fire('deviceorientation',{gamma:0,beta:0});h.window.fire('deviceorientation',{gamma:10,beta:10});assert.equal(h.last().headX,.4);
  h.element('motionBtn').fire('click');await new Promise(resolve=>setImmediate(resolve));
  h.window.fire('deviceorientation',{gamma:50,beta:60});assert.equal(h.last().headX,0);assert.equal(h.last().headZ,0);
  h.window.fire('deviceorientation',{gamma:55,beta:55});assert.equal(h.last().headX,.2);assert.equal(h.last().headZ,-.2);
  h.element('motionStopBtn').fire('click');assert.equal(h.last().headX,0);assert.equal(h.last().headZ,0);assert.equal(h.element('motionStopBtn').hidden,true);
  h.window.fire('deviceorientation',{gamma:100,beta:100});assert.equal(h.last().headX,0);assert.equal(h.last().headZ,0);
});
test('Cruzar beta por ±180 conserva la inclinación corta sin disparar una esquiva completa',async()=>{
  for(const [from,to,expected]of [[179,-179,.08],[-179,179,-.08]]){
    const h=controller({secure:true});h.element('motionBtn').fire('click');await new Promise(resolve=>setImmediate(resolve));
    h.window.fire('deviceorientation',{gamma:0,beta:from});h.window.fire('deviceorientation',{gamma:0,beta:to});
    assert.ok(Math.abs(h.last().headZ-expected)<1e-9);assert.equal(h.last().headX,0);
  }
});
