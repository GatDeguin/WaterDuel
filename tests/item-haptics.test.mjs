import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const implementation=await import('../public/item-haptics.js').catch(error=>{
  if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return null;
});
const api=name=>{assert.equal(typeof implementation?.[name],'function',`Falta ${name}`);return implementation[name];};
const impact=(extra={})=>({impulse:.18,closingSpeed:1,materialA:'steel',materialB:'wood',attacker:1,defender:2,...extra});
const total=output=>output.pattern.reduce((sum,ms)=>sum+ms,0);

test('El relay conserva sólo hechos físicos acotados y participantes, sin secretos ni arreglos ajenos',()=>{
  const sanitize=api('sanitizeItemImpact'),source=impact({impulse:1e300,closingSpeed:Number.MAX_VALUE,slot:1,
    hostToken:'secret',at:{x:1,y:2},pattern:new Array(1_000_000)});
  Object.defineProperty(source,'unrelated',{enumerable:true,get(){throw Error('must not inspect unrelated data');}});
  const clean=sanitize(source);
  assert.deepEqual(clean,{impulse:4,closingSpeed:20,materialA:'steel',materialB:'wood',attacker:1,defender:2,slot:1});
  assert.equal(Object.getPrototypeOf(clean),Object.prototype);
  assert.equal(JSON.stringify(clean).includes('secret'),false);
  source.impulse=.01;source.attacker=2;assert.equal(clean.impulse,4);assert.equal(clean.attacker,1);
  assert.deepEqual(sanitize(clean),clean,'wire normalization is idempotent');
});

test('Los contactos físicos slotA/slotB y el slot local usan el mismo schema de LAN y sesión local',()=>{
  const sanitize=api('sanitizeItemImpact');
  assert.deepEqual(sanitize({impulse:.2,slotA:1,slotB:2}),{
    impulse:.2,closingSpeed:0,materialA:'unknown',materialB:'unknown',attacker:1,defender:2,slot:0});
  assert.deepEqual(sanitize({impulse:.2,slot:2}),{
    impulse:.2,closingSpeed:0,materialA:'unknown',materialB:'unknown',attacker:0,defender:0,slot:2});
  assert.equal(sanitize(impact({slotA:2})),null,'conflicting aliases cannot invent participants');
  assert.equal(sanitize(impact({defender:0,slotB:2})).defender,2);
  const plain=Object.assign(Object.create(null),{impulse:.2,slot:1});assert.equal(sanitize(plain).slot,1);
});

test('Presión estática y ruido subumbral no vibran aunque el solver reporte impulso positivo',()=>{
  const sanitize=api('sanitizeItemImpact'),haptic=api('contactHaptic');
  for(const extra of [{impulse:.2,closingSpeed:0},{impulse:.2,closingSpeed:.059999},{impulse:.000999,closingSpeed:2},{impulse:Number.MIN_VALUE,closingSpeed:20}]){
    assert.ok(sanitize(impact(extra)),'wire preserves valid physical measurements');assert.equal(haptic(impact(extra),1),null);
  }
  assert.ok(haptic(impact({impulse:.001,closingSpeed:.06}),1),'the declared significance boundary is inclusive');
});

test('El límite JSON rehidrata registros de otro Realm sin aceptar directamente su prototipo',()=>{
  const sanitize=api('sanitizeItemImpact'),foreign=vm.runInNewContext('({impulse:.2,closingSpeed:1,slot:1})');
  assert.equal(sanitize(foreign),null);
  assert.equal(sanitize(JSON.parse(JSON.stringify(foreign))).slot,1);
});

test('Impulso cero, NaN, infinito, tipos coercibles y datos hostiles nunca generan una respuesta',()=>{
  const sanitize=api('sanitizeItemImpact'),haptic=api('contactHaptic');
  for(const impulse of [0,-0,-.1,NaN,Infinity,-Infinity,'0.2',true,1n,{},[]]){
    assert.equal(sanitize(impact({impulse})),null);assert.equal(haptic(impact({impulse,closingSpeed:20}),1),null);
  }
  for(const closingSpeed of [NaN,Infinity,-Infinity,-.1,'1',false,1n,null,{},[]])assert.equal(haptic(impact({closingSpeed}),1),null);
  for(const value of [null,undefined,false,12,'contact',[],new Date(),Object.create(impact())]){
    assert.equal(sanitize(value),null);assert.equal(haptic(value,1),null);
  }
  let reads=0;const getter=impact();Object.defineProperty(getter,'impulse',{get(){reads++;throw Error('hostile getter');}});
  assert.equal(sanitize(getter),null);assert.equal(reads,0,'do not execute accessors on untrusted records');
  assert.equal(sanitize(new Proxy({}, {getOwnPropertyDescriptor(){throw Error('hostile proxy');}})),null);
  assert.equal(sanitize({data:impact()}),null,'only the explicit physical payload is accepted');
});

test('Sólo recibe háptica un jugador válido realmente incluido en el contacto',()=>{
  const sanitize=api('sanitizeItemImpact'),haptic=api('contactHaptic');
  for(const local of [0,3,-1,NaN,Infinity,'1',false,null,undefined,1n])assert.equal(haptic(impact(),local),null);
  for(const key of ['attacker','defender','slot','slotA','slotB'])for(const value of [3,-1,'1',NaN,Infinity,null,false])assert.equal(sanitize(impact({[key]:value})),null);
  assert.equal(haptic({impulse:.2},1),null);assert.equal(haptic({impulse:.2,slot:0},1),null);
  assert.ok(haptic({impulse:.2,closingSpeed:1,slot:1},1));assert.equal(haptic({impulse:.2,closingSpeed:1,slot:1},2),null);
  assert.ok(haptic({impulse:.2,closingSpeed:1,slotA:1,slotB:2},1));assert.ok(haptic({impulse:.2,closingSpeed:1,slotA:1,slotB:2},2));
  assert.ok(haptic({impulse:.2,closingSpeed:1,attacker:2},2));assert.equal(haptic({impulse:.2,closingSpeed:1,attacker:2},1),null);
});

test('Todos los patrones usan enteros positivos, suman como máximo 120 ms y quedan debajo de prioridades de daño',()=>{
  const haptic=api('contactHaptic'),materials=['steel','brass','metal','metal_mixed','wood','wood_metal_mixed','composite','leather','unknown'];
  for(const materialA of materials)for(const materialB of materials)
    for(const impulse of [Number.MIN_VALUE,.001,.02,.06,.15,.3,.45,4,Number.MAX_VALUE])for(const closingSpeed of [0,.1,1,4,20,Number.MAX_VALUE]){
      const output=haptic(impact({materialA,materialB,impulse,closingSpeed}),1);
      if(impulse<.001||closingSpeed<.06){assert.equal(output,null);continue;}
      assert.ok(output);assert.ok([1,3].includes(output.pattern.length));
      assert.ok(output.pattern.every(ms=>Number.isInteger(ms)&&ms>0&&ms<=120));
      assert.ok(total(output)>0&&total(output)<=120);assert.equal(output.priority,0);
      assert.deepEqual(Object.keys(output).sort(),['pattern','priority']);
    }
});

test('Contactos suaves, medios y fuertes aumentan duración sin escalones grandes ni overflow',()=>{
  const haptic=api('contactHaptic');
  const soft=haptic(impact({impulse:.015}),1),medium=haptic(impact({impulse:.16}),1),hard=haptic(impact({impulse:.45}),1);
  assert.ok(total(soft)<total(medium)&&total(medium)<total(hard));
  let previous=0;
  for(let step=1;step<=90;step++){
    const duration=total(haptic(impact({impulse:step*.005}),1));
    assert.ok(duration>=previous);if(step>1)assert.ok(duration-previous<=2);previous=duration;
  }
  for(const threshold of [.06,.2,.3])assert.ok(Math.abs(total(haptic(impact({impulse:threshold-1e-10}),1))-total(haptic(impact({impulse:threshold+1e-10}),1)))<=1);
  const slow=haptic(impact({closingSpeed:.06}),1),fast=haptic(impact({closingSpeed:4}),1);
  assert.ok(total(fast)>total(slow));
  assert.deepEqual(haptic(impact({impulse:Number.MAX_VALUE,closingSpeed:Number.MAX_VALUE}),1),haptic(impact({impulse:4,closingSpeed:20}),1));
});

test('El par de materiales es simétrico, con diferencias leves y fallback neutro para etiquetas no confiables',()=>{
  const sanitize=api('sanitizeItemImpact'),haptic=api('contactHaptic');
  const metal=haptic(impact({materialA:'steel',materialB:'brass'}),1),wood=haptic(impact({materialA:'wood',materialB:'wood'}),1),
    leather=haptic(impact({materialA:'leather',materialB:'steel'}),1),mixed=haptic(impact({materialA:'wood',materialB:'steel'}),1);
  assert.equal(metal.pattern.length,3);assert.equal(wood.pattern.length,1);assert.equal(leather.pattern.length,1);
  assert.notDeepEqual(metal,wood);assert.notDeepEqual(mixed,wood);assert.ok(total(leather)<total(wood));
  assert.ok(Math.max(total(metal),total(wood),total(leather),total(mixed))-Math.min(total(metal),total(wood),total(leather),total(mixed))<=12);
  for(const [a,b]of [['wood','steel'],['steel','brass'],['leather','steel'],['metal_mixed','wood_metal_mixed']])
    assert.deepEqual(haptic(impact({materialA:a,materialB:b}),1),haptic(impact({materialA:b,materialB:a}),1));
  const clean=sanitize(impact({materialA:'https://secret.invalid/token',materialB:['steel']}));
  assert.equal(clean.materialA,'unknown');assert.equal(clean.materialB,'unknown');
  assert.deepEqual(haptic(clean,1),haptic(impact({materialA:'unknown',materialB:'unknown'}),1));
});

test('La política es determinista y devuelve patrones propios sin deduplicar ni mutar el evento',()=>{
  const haptic=api('contactHaptic'),source=impact(),before=structuredClone(source),a=haptic(source,1),b=haptic(source,1);
  assert.deepEqual(a,b);assert.notEqual(a,b);assert.notEqual(a.pattern,b.pattern);assert.deepEqual(source,before);
  a.pattern[0]=999;assert.deepEqual(haptic(source,1),b);
  assert.ok(haptic(source,2),'both involved players may apply their own existing rumble gate');
});
