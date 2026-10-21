import test from 'node:test';
import assert from 'node:assert/strict';

const api=await import('../public/joysticks.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} ≠ ${expected}`);
class Surface{
  constructor(rect){this.rect=rect;this.listeners=new Map();this.captures=new Set();this.style={setProperty(){}};
    this.classes=new Set();this.classList={toggle:(name,on)=>{if(on)this.classes.add(name);else this.classes.delete(name);}};}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)??[]).filter(listener=>listener!==fn));}
  fire(type,data={}){const event={preventDefault(){this.prevented=true;},...data};for(const fn of this.listeners.get(type)??[])fn(event);return event;}
  getBoundingClientRect(){return this.rect;}
  setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){if(this.captures.delete(id))this.fire('lostpointercapture',{pointerId:id});}
}
function fixture(){
  const pad=new Surface({left:100,top:50,width:200,height:160}),knob=new Surface({width:40,height:40}),changes=[];
  let enabled=true;
  const joystick=new api.RadialJoystick({element:pad,knob,onChange:value=>changes.push(value),enabled:()=>enabled});
  return {pad,knob,changes,joystick,disable(){enabled=false;}};
}

test('El módulo de joystick expone geometría y control reutilizable sin DOM global',()=>{
  assert.equal(typeof api.joystickGeometry,'function');assert.equal(typeof api.radialAxes,'function');assert.equal(typeof api.RadialJoystick,'function');
});

test('Gesto de arma deriva dirección, muñeca y ataque del mismo desplazamiento continuo',()=>{
  assert.equal(typeof api.weaponGesture,'function');
  assert.deepEqual(api.weaponGesture({x:0,y:0}),{mainX:0,mainY:0,wrist:0,attackHeld:false});
  assert.deepEqual(api.weaponGesture({x:0,y:1}),{mainX:0,mainY:1,wrist:.65,attackHeld:true});
  assert.deepEqual(api.weaponGesture({x:0,y:-1}),{mainX:0,mainY:-1,wrist:-.65,attackHeld:true});
  assert.equal(api.weaponGesture({x:.25,y:0}).attackHeld,false);
  assert.equal(api.weaponGesture({x:.25001,y:0}).attackHeld,true);
  const diagonal=api.weaponGesture({x:1,y:1});near(diagonal.mainX,Math.SQRT1_2);near(diagonal.mainY,Math.SQRT1_2);near(diagonal.wrist,.65*Math.SQRT1_2);
  const low=api.weaponGesture({x:0,y:.01});near(low.wrist,.0065);assert.equal(low.attackHeld,false);
  assert.deepEqual(api.weaponGesture({x:NaN,y:Infinity}),{mainX:0,mainY:0,wrist:0,attackHeld:false});
});

test('Radio disponible usa el lado corto, tamaño real del knob y margen; no depende de un porcentaje fijo',()=>{
  assert.deepEqual(api.joystickGeometry({left:100,top:50,width:200,height:160},{width:40,height:40}),{centerX:200,centerY:130,radius:52});
  assert.deepEqual(api.joystickGeometry({left:0,top:0,width:320,height:240},{width:64,height:56}),{centerX:160,centerY:120,radius:80});
  assert.equal(api.joystickGeometry({left:0,top:0,width:0,height:0},{width:40,height:40}).radius,0);
});

test('Zona muerta radial08 es estable, continua y remapeada; diagonales y arrastre exterior conservan círculo e Y correcta',()=>{
  const geometry={centerX:0,centerY:0,radius:100};
  assert.deepEqual(api.radialAxes({clientX:7,clientY:0},geometry),{x:0,y:0});
  assert.deepEqual(api.radialAxes({clientX:0,clientY:8},geometry),{x:0,y:0});
  near(api.radialAxes({clientX:54,clientY:0},geometry).x,.5);
  const up=api.radialAxes({clientX:0,clientY:-100},geometry);near(up.y,1);near(up.x,0);
  const far=api.radialAxes({clientX:1000,clientY:-1000},geometry);near(far.x,Math.SQRT1_2);near(far.y,Math.SQRT1_2);
  near(Math.hypot(far.x,far.y),1);
  assert.deepEqual(api.radialAxes({clientX:Infinity,clientY:0},geometry),{x:0,y:0});
  assert.deepEqual(api.radialAxes({clientX:1,clientY:1},{...geometry,radius:0}),{x:0,y:0});
});

test('Dos dedos independientes arrastran fuera y un tercer dedo no roba ni libera captura',()=>{
  const left=fixture(),right=fixture();
  left.pad.fire('pointerdown',{pointerId:1,clientX:1000,clientY:130});
  right.pad.fire('pointerdown',{pointerId:2,clientX:200,clientY:-1000});
  assert.deepEqual(left.joystick.value,{x:1,y:0});assert.deepEqual(right.joystick.value,{x:0,y:1});
  left.pad.fire('pointerdown',{pointerId:3,clientX:100,clientY:130});
  left.pad.fire('pointermove',{pointerId:3,clientX:100,clientY:130});left.pad.fire('pointerup',{pointerId:3});
  assert.deepEqual(left.joystick.value,{x:1,y:0});
  left.pad.fire('pointerup',{pointerId:1});assert.deepEqual(left.joystick.value,{x:0,y:0});
  assert.deepEqual(right.joystick.value,{x:0,y:1});assert.equal(left.pad.captures.size,0);assert.equal(right.pad.captures.has(2),true);
});

for(const signal of ['pointerup','pointercancel','lostpointercapture','blur'])test(`${signal} centra sin reentrada y un movimiento viejo no reactiva el joystick`,()=>{
  const f=fixture();f.pad.fire('pointerdown',{pointerId:5,clientX:1000,clientY:130});
  const before=f.changes.length;f.pad.fire(signal,{pointerId:5});
  assert.deepEqual(f.joystick.value,{x:0,y:0});assert.equal(f.changes.length,before+1);
  assert.equal(f.knob.style.left,'50%');assert.equal(f.knob.style.top,'50%');assert.equal(f.pad.captures.size,0);
  f.pad.fire('pointermove',{pointerId:5,clientX:1000,clientY:130});assert.equal(f.changes.length,before+1);
});

test('Teclas mantenidas resuelven opuestos y diagonal circular; Home centra y deshabilitado no inicia gestos',()=>{
  const f=fixture();f.pad.fire('keydown',{key:'ArrowRight'});f.pad.fire('keydown',{key:'ArrowUp'});
  near(f.joystick.value.x,Math.SQRT1_2);near(f.joystick.value.y,Math.SQRT1_2);
  f.pad.fire('keydown',{key:'ArrowLeft'});assert.deepEqual(f.joystick.value,{x:0,y:1});
  f.pad.fire('keyup',{key:'ArrowLeft'});near(f.joystick.value.x,Math.SQRT1_2);
  f.pad.fire('keydown',{key:'Home'});assert.deepEqual(f.joystick.value,{x:0,y:0});
  f.disable();f.pad.fire('pointerdown',{pointerId:7,clientX:1000,clientY:130});f.pad.fire('keydown',{key:'ArrowRight'});
  assert.deepEqual(f.joystick.value,{x:0,y:0});assert.equal(f.pad.captures.size,0);
});

test('Reset recalcula geometría después de resize, borra captura y puede silenciar callbacks para neutralización global',()=>{
  const f=fixture();f.pad.fire('pointerdown',{pointerId:8,clientX:252,clientY:130});
  assert.equal(f.joystick.value.x,1);const before=f.changes.length;
  f.pad.rect={left:0,top:0,width:320,height:240};f.knob.rect={width:64,height:64};f.joystick.reset({notify:false});
  assert.equal(f.changes.length,before);assert.deepEqual(f.joystick.value,{x:0,y:0});assert.equal(f.pad.captures.size,0);
  f.pad.fire('pointerdown',{pointerId:9,clientX:240,clientY:120});assert.equal(f.joystick.value.x,1);
});

test('Modo horizontal usa el ancho real, ignora Y y no debilita desplazamiento diagonal',()=>{
  const pad=new Surface({left:0,top:0,width:240,height:100}),knob=new Surface({width:40,height:40});
  const joystick=new api.RadialJoystick({element:pad,knob,axis:'horizontal',onChange(){}});
  assert.equal(joystick.geometry().radius,92);
  pad.fire('pointerdown',{pointerId:10,clientX:212,clientY:50});assert.deepEqual(joystick.value,{x:1,y:0});
  pad.fire('pointermove',{pointerId:10,clientX:212,clientY:-1000});assert.deepEqual(joystick.value,{x:1,y:0});assert.equal(knob.style.top,'50%');
  pad.fire('pointermove',{pointerId:10,clientX:120,clientY:1000});assert.deepEqual(joystick.value,{x:0,y:0});
  pad.fire('pointermove',{pointerId:10,clientX:28,clientY:NaN});assert.deepEqual(joystick.value,{x:-1,y:0});
  pad.fire('pointerup',{pointerId:10});pad.fire('keydown',{key:'ArrowRight'});pad.fire('keydown',{key:'ArrowUp'});
  assert.deepEqual(joystick.value,{x:1,y:0});pad.fire('keyup',{key:'ArrowRight'});assert.deepEqual(joystick.value,{x:0,y:0});
});

test('El gesto de movimiento combina distancia y acción corporal vertical en un disco unitario',()=>{
  assert.equal(typeof api.movementGesture,'function');
  assert.deepEqual(api.movementGesture({x:1,y:0}),{lean:1,bodyY:0});
  assert.deepEqual(api.movementGesture({x:0,y:-1}),{lean:0,bodyY:-1});
  assert.deepEqual(api.movementGesture({x:0,y:1}),{lean:0,bodyY:1});
  const diagonal=api.movementGesture({x:2,y:-2});near(diagonal.lean,Math.SQRT1_2);near(diagonal.bodyY,-Math.SQRT1_2);
  assert.deepEqual(api.movementGesture({x:NaN,y:Infinity}),{lean:0,bodyY:0});
});
