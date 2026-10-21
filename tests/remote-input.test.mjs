import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteInputBuffer,isFreshRemoteInput} from '../public/remote-input.js';

test('neutralización explícita cancela un toque pendiente sin permitir secuencias viejas',()=>{
  const b=new RemoteInputBuffer();
  b.receive(1,{seq:1,thrust:true,axes:{mainX:1}},10);
  b.receive(1,{seq:2,neutralize:true,thrust:true,guard:true,axes:{mainX:1}},11);
  const sample=b.sample(1,12);assert.equal(sample.thrust,false);assert.equal(sample.guard,false);assert.equal(sample.mainX,0);
  assert.equal(b.receive(1,{seq:1,thrust:true},13),false);assert.equal(b.sample(1,14).thrust,false);
  b.receive(1,{seq:3,thrust:true},15);b.receive(1,{seq:4,thrust:false},16);assert.equal(b.sample(1,17).thrust,true,'una liberación ordinaria conserva el toque breve');
});

test('Un toque de estocada que termina entre pasos se consume exactamente una vez',()=>{
  const inputs=new RemoteInputBuffer();
  inputs.receive(1,{seq:1,axes:{mainY:.7},thrust:true},100);
  inputs.receive(1,{seq:2,axes:{mainY:.7},thrust:false},101);
  assert.equal(inputs.sample(1,110).thrust,true);
  assert.equal(inputs.sample(1,118).thrust,false);
  assert.equal(inputs.sample(1,118).mainY,.7);
});

test('Mensajes duplicados o reordenados no repiten la estocada ni pisan el control nuevo',()=>{
  const inputs=new RemoteInputBuffer();
  inputs.receive(2,{seq:4,axes:{lean:.8},thrust:true},100);
  inputs.sample(2,110);
  assert.equal(inputs.receive(2,{seq:3,axes:{lean:-1},thrust:false},120),false);
  assert.equal(inputs.receive(2,{seq:4,axes:{lean:-1},thrust:true},121),false);
  assert.equal(inputs.sample(2,130).lean,.8);
  inputs.receive(2,{seq:5,axes:{},thrust:false},131);
  assert.equal(inputs.sample(2,132).thrust,false);
});

test('Los controles caducados no producen ataques y una reconexión admite secuencia nueva',()=>{
  const inputs=new RemoteInputBuffer();
  inputs.receive(1,{seq:90,axes:{lean:1},thrust:true},100);
  assert.equal(inputs.sample(1,600),null);
  inputs.disconnect(1);
  inputs.receive(1,{seq:1,axes:{lean:-.5},thrust:false},610);
  assert.equal(inputs.sample(1,611).lean,-.5);
  assert.equal(inputs.sample(1,611).thrust,false);
});

test('Actualizar los ejes no prolonga la vida de una estocada pendiente antigua',()=>{
  const inputs=new RemoteInputBuffer();
  inputs.receive(1,{seq:1,axes:{},thrust:true},0);
  inputs.receive(1,{seq:2,axes:{},thrust:false},10);
  inputs.receive(1,{seq:3,axes:{lean:.3},thrust:false},450);
  assert.equal(inputs.sample(1,451).thrust,false);
});

test('Reanudar paquetes con el botón todavía sostenido no crea otra pulsación',()=>{
  const inputs=new RemoteInputBuffer();
  inputs.receive(1,{seq:1,axes:{},thrust:true},0);
  assert.equal(inputs.sample(1,1).thrust,true);
  assert.equal(inputs.sample(1,500),null);
  inputs.receive(1,{seq:2,axes:{},thrust:true},700);
  assert.equal(inputs.sample(1,701).thrust,false);
  inputs.receive(1,{seq:3,axes:{},thrust:false},710);
  inputs.receive(1,{seq:4,axes:{},thrust:true},720);
  assert.equal(inputs.sample(1,721).thrust,true);
});

test('El límite de edad cubre el trayecto completo y no solo el tramo servidor-host',()=>{
  assert.equal(isFreshRemoteInput({sentAt:1000,t:1350},1510),false);
  assert.equal(isFreshRemoteInput({sentAt:1000,t:1200},1400),true);
  assert.equal(isFreshRemoteInput({sentAt:1000,t:1200},1431),false);
  assert.equal(isFreshRemoteInput({t:1200},1300),false);
});

test('El paso de simulación respeta la vida restante del input, sin reiniciarla al recibirlo',()=>{
  const inputs=new RemoteInputBuffer();
  inputs.receive(1,{seq:1,axes:{},thrust:true},350,350);
  assert.equal(inputs.sample(1,550),null);
  inputs.receive(1,{seq:2,axes:{},thrust:false},600,0);
  inputs.receive(1,{seq:3,axes:{},thrust:true},610,10);
  assert.equal(inputs.sample(1,615).thrust,true);
});

test('Los mandos conservan identidad independiente y no aceptan ejes no finitos',()=>{
  const inputs=new RemoteInputBuffer();
  inputs.receive(1,{seq:1,axes:{mainX:NaN,mainY:4},thrust:true},10);
  inputs.receive(2,{seq:1,axes:{mainX:-.8},guard:true},10);
  const p1=inputs.sample(1,20),p2=inputs.sample(2,20);
  assert.equal(p2.guard,true);
  assert.equal(p2.thrust,false);
  assert.equal(p1.mainX,0);
  assert.equal(p1.mainY,1);
  assert.equal(p1.thrust,true);
});

test('attackHeld conserva sólo el nivel fresco y no modifica la consumición única del toque legacy',()=>{
  const inputs=new RemoteInputBuffer();inputs.receive(1,{seq:1,axes:{mainY:.7},attackHeld:true,thrust:true},100);
  assert.equal(inputs.sample(1,110).attackHeld,true);assert.equal(inputs.sample(1,118).attackHeld,true);
  assert.equal(inputs.sample(1,126).thrust,false,'el nivel no vuelve a crear el flanco legacy');
  inputs.receive(1,{seq:2,axes:{},attackHeld:false},130);assert.equal(inputs.sample(1,131).attackHeld,undefined);
  inputs.receive(1,{seq:3,axes:{},attackHeld:true},140);assert.equal(inputs.sample(1,600),null);
  inputs.receive(1,{seq:4,axes:{},attackHeld:true},610);assert.equal(inputs.sample(1,611).attackHeld,true,'una solicitud nueva y fresca puede reanudar el nivel');
  inputs.receive(1,{seq:5,neutralize:true,attackHeld:true},620);assert.equal(inputs.sample(1,621).attackHeld,undefined);
  inputs.disconnect(1);assert.equal(inputs.sample(1,622),null);
});

test('Los ejes opcionales de cabeza se acotan y desaparecen al neutralizar, sin alterar mensajes legacy',()=>{
  const inputs=new RemoteInputBuffer();inputs.receive(1,{seq:1,axes:{headX:2,headZ:-.4}},10);
  assert.equal(inputs.sample(1,11).headX,1);assert.equal(inputs.sample(1,11).headZ,-.4);
  inputs.receive(1,{seq:2,axes:{headX:NaN,headZ:Infinity}},12);assert.equal(inputs.sample(1,13).headX,0);assert.equal(inputs.sample(1,13).headZ,0);
  inputs.receive(1,{seq:3,neutralize:true,axes:{headX:1,headZ:1}},14);assert.equal(inputs.sample(1,15).headX,undefined);
  inputs.receive(1,{seq:4,axes:{}},16);assert.equal(inputs.sample(1,17).headX,undefined);assert.equal(inputs.sample(1,500),null);
});

test('bodyY conserva postura fresca por cupo y neutralizar/expirar impide recuperar una esquiva vieja',()=>{
  const b=new RemoteInputBuffer();b.receive(1,{seq:1,axes:{bodyY:-3}},10);b.receive(2,{seq:1,axes:{bodyY:.8}},10);
  assert.equal(b.sample(1,11).bodyY,-1);assert.equal(b.sample(2,11).bodyY,.8);
  b.receive(1,{seq:2,axes:{bodyY:Infinity}},12);assert.equal(b.sample(1,13).bodyY,0);
  b.receive(2,{seq:2,neutralize:true,axes:{bodyY:1}},14);assert.equal(b.sample(2,15).bodyY,undefined);
  assert.equal(b.sample(1,500),null);b.disconnect(1);assert.equal(b.sample(1,501),null);
});
