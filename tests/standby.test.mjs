import test from 'node:test';
import assert from 'node:assert/strict';

const api=await import('../public/physics/standby.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const standby=options=>{assert.equal(typeof api.standbyTargets,'function');return api.standbyTargets(options);};
const neutral={mainX:0,mainY:0,offX:0,offY:0,lean:0,wrist:0,headX:0,headZ:0,thrust:false,guard:false,attackHeld:false};

test('Standby entrega sólo intenciones pequeñas de motores reales, sin locomoción ni ataques',()=>{
  const limits={mainX:.012,mainY:.022,offX:.008,offY:.018,lean:0,wrist:.012,headX:.012,headZ:.008};
  let changed=false;
  for(const slot of [1,2])for(let clock=0;clock<60;clock+=.031){
    const target=standby({phase:'ready',clock,slot});assert.deepEqual(Object.keys(target).sort(),Object.keys(neutral).sort());
    for(const [key,max]of Object.entries(limits))assert.ok(Number.isFinite(target[key])&&Math.abs(target[key])<=max+1e-12,`${key}: ${target[key]}`);
    for(const key of ['thrust','guard','attackHeld'])assert.equal(target[key],false);
    changed||=Math.abs(target.mainY)>.005;
  }
  assert.equal(changed,true);assert.deepEqual(standby({phase:'ready',clock:0}),neutral);
});

test('Cualquier intención manual tiene prioridad; combate, ruptura o pasivo no reciben standby',()=>{
  for(const phase of ['fight','burst','matchover','unknown'])assert.equal(standby({phase,clock:8}),null);
  for(const extra of [{globIntact:false},{passive:true},{reducedMotion:true}])assert.equal(standby({phase:'ready',clock:8,...extra}),null);
  for(const key of ['mainX','mainY','offX','offY','lean','wrist','headX','headZ','thrust','guard','attackHeld']){
    const controller={...neutral,[key]:typeof neutral[key]==='boolean'?true:.02},before={...controller};
    assert.equal(standby({phase:'ready',clock:8,controller}),null,key);assert.deepEqual(controller,before);
  }
});

test('Ready y primera cuenta atrás comparten objetivos, luego llegan exactamente a neutro antes del combate',()=>{
  const options={clock:17,slot:2,round:1};
  assert.deepEqual(standby({phase:'ready',...options}),standby({phase:'countdown',phaseClock:0,...options}));
  for(const phaseClock of [2.4,3,3.2])assert.deepEqual(standby({phase:'countdown',phaseClock,...options}),neutral);
});

test('Siguientes rondas nacen en neutro, animan sin salto y vuelven a neutro antes de fight',()=>{
  assert.deepEqual(standby({phase:'countdown',clock:40,phaseClock:0,round:2}),neutral);
  const middle=standby({phase:'countdown',clock:41.2,phaseClock:1.2,round:2});assert.ok(Math.abs(middle.mainY)+Math.abs(middle.offY)>.005);
  assert.deepEqual(standby({phase:'countdown',clock:42.4,phaseClock:2.4,round:2}),neutral);
  const a=standby({phase:'ready',clock:20}),b=standby({phase:'ready',clock:20+1/120});
  for(const key of ['mainX','mainY','offX','offY','wrist','headX','headZ'])assert.ok(Math.abs(a[key]-b[key])<.0003,key);
});

test('API determinista, sin estado ni modificación del caller y con reloj inválido seguro',()=>{
  const options={phase:'ready',clock:15,slot:1,controller:{...neutral}},snapshot=structuredClone(options),a=standby(options);
  standby({phase:'ready',clock:900,slot:2});assert.deepEqual(standby(options),a);assert.deepEqual(options,snapshot);
  assert.notDeepEqual(standby({phase:'ready',clock:15,slot:1}),standby({phase:'ready',clock:15,slot:2}));
  for(const clock of [undefined,NaN,Infinity,-100])assert.deepEqual(standby({phase:'ready',clock}),neutral);
});
