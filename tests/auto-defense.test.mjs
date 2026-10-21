import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoDefense,AUTO_DEFENSE} from '../public/auto-defense.js';

const DT=1/120,control=()=>({lean:0,mainX:0,mainY:0,offX:0,offY:0,wrist:0,thrust:false,guard:false});
function observed(slot=1){const dir=slot===1?1:-1;return {slot,dir,globIntact:true,balloonSize:1,lunge:0,lungeCool:0,guardEnergy:1,guardBroken:false,equipment:{weapon:'sword',defense:'short'},pose:{head:{x:0,y:2.6,z:.025},offShoulder:{x:-dir*.4,y:2.0,z:-.11}}};}
function approach(defender){return {pose:{tip:{x:defender.dir*.7,y:2.6,z:.17}},previousTip:{x:defender.dir*.73,y:2.6,z:.17}};}

test('Una defensa automática usa reacción acotada y sólo produce controles de brazo, sin mover cuerpo ni leer botones',()=>{
  let attempted=0,missed=0;
  for(let seed=1;seed<=100;seed++){
    const d=observed(),a=approach(d),automatic=new AutoDefense({seed}),before=structuredClone(d),input=control();
    let first=-1;
    for(let i=0;i<60;i++){const c=automatic.update(d,a,input,DT);if(c.guard&&first<0)first=(i+1)*DT;assert.equal(c.lean,input.lean);assert.equal(c.thrust,input.thrust);}
    assert.deepEqual(d,before,'la decisión no modifica pose, recursos o físico');assert.deepEqual(input,control());
    if(first>=0){attempted++;assert.ok(first>=AUTO_DEFENSE.reactionMin&&first<=AUTO_DEFENSE.reactionMax+DT);}
    else missed++;
  }
  assert.ok(attempted>=60&&attempted<=80,`distribución de intentos: ${attempted}/100`);assert.ok(missed>0);
});

test('Los mismos observables y semilla repiten decisiones, aunque el rival anuncie otros botones futuros',()=>{
  const a=new AutoDefense({seed:77}),b=new AutoDefense({seed:77}),f=observed();
  for(let i=0;i<240;i++){
    const target=approach(f),withButtons={...target,controller:{thrust:i%2===0,guard:true,attackHeld:true},lunge:1};
    assert.deepEqual(a.update(f,target,control(),DT),b.update(f,withButtons,control(),DT));
  }
  assert.deepEqual(a.snapshot(),b.snapshot());
});

test('No hay defensa por un arma estática, alejada o que se retira',()=>{
  for(const target of [{pose:{tip:{x:.7,y:2.6}},previousTip:{x:.7,y:2.6}},
    {pose:{tip:{x:4,y:2.6}},previousTip:{x:4.03,y:2.6}},
    {pose:{tip:{x:.7,y:2.6}},previousTip:{x:.67,y:2.6}}]){
    const a=new AutoDefense({seed:1});for(let i=0;i<120;i++)assert.equal(a.update(observed(),target,control(),DT).guard,false);
  }
});

test('Una estocada propia comprometida o un inicio de ataque debido no se cancela para levantar guardia',()=>{
  for(const slot of [1,2])for(const input of [{...control(),thrust:true},{...control(),attackHeld:true}]){
    const a=new AutoDefense({seed:1}),f=observed(slot),target=approach(f);
    for(let i=0;i<120;i++)assert.equal(a.update(f,target,input,DT).guard,false);
    f.lunge=.8;for(let i=0;i<60;i++)assert.equal(a.update(f,target,control(),DT).guard,false);
  }
});

test('Sin equipo defensivo o energía no se crea un escudo, y reset reproduce el estado inicial',()=>{
  const a=new AutoDefense({seed:14}),f=observed();f.equipment.defense='none';
  for(let i=0;i<60;i++)assert.equal(a.update(f,approach(f),control(),DT).guard,false);
  f.equipment.defense='short';f.guardEnergy=0;
  for(let i=0;i<60;i++)assert.equal(a.update(f,approach(f),control(),DT).guard,false);
  a.reset();assert.deepEqual(a.snapshot(),new AutoDefense({seed:14}).snapshot());
});

test('la guardia iniciada sostiene una amenaza que sigue acercándose, con energía positiva y duración acotada',()=>{
  const a=new AutoDefense({seed:5}),f=observed(),input=control();let first=null,last=null;
  for(let i=0;i<150;i++){
    const time=(i+1)*DT;
    if(first!==null)f.guardEnergy=.2; // A real impact can lower the reserve below the start threshold.
    const output=a.update(f,approach(f),input,DT);
    if(output.guard){first??=time;last=time;}
    if(time>.60&&time<.65)assert.equal(output.guard,true,'la punta aún observada no queda libre sólo por vencer el mínimo inicial');
  }
  assert.ok(first>=AUTO_DEFENSE.reactionMin&&first<=AUTO_DEFENSE.reactionMax+DT);
  assert.ok(last-first>=AUTO_DEFENSE.guardSeconds);assert.ok(last-first<=AUTO_DEFENSE.guardSeconds*2+DT,'el esfuerzo sostenido tiene una cota');
  assert.equal(a.snapshot().episode,1,'sostener no vuelve a sortear intentos ni crea ataques');
});
