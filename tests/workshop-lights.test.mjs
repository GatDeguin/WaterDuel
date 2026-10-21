import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const api=await import('../public/rendering/workshop-lights.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
const contract=JSON.parse(await readFile(new URL('../public/assets/environment/workshop/asset-contract.json',import.meta.url),'utf8'));
const authored=JSON.parse(await readFile(new URL('../public/assets/environment/workshop/light-directions.json',import.meta.url),'utf8'));
const keyHint=contract.lighting.hints.find(hint=>hint.name==='Key | warm workshop softbox');
const ordered=[keyHint,...contract.lighting.hints.filter(hint=>hint!==keyHint)];
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<=Math.max(1,Math.abs(expected))*2e-6,`${actual} ≠ ${expected}`);

test('El adaptador de luces de taller expone un contrato CPU puro',()=>{
  assert.equal(typeof api.prepareWorkshopLights,'function');
});
test('Las ventanas reales emiten hacia el escenario y dejan su propio cristal fuera del hemisferio',()=>{
  const original=JSON.stringify(authored),result=api.prepareWorkshopLights(contract,'atelier',authored);
  for(const [index,name]of result.names.entries()){
    if(!/tall window/i.test(name))continue;
    const o=index*4,d=[...result.directions.slice(o,o+3)],p=[...result.positions.slice(o,o+3)];
    const dotTo=point=>{const delta=point.map((value,axis)=>value-p[axis]),length=Math.hypot(...delta);return delta.reduce((sum,value,axis)=>sum+value/length*d[axis],0);};
    assert.ok(dotTo([p[0],p[1],-4.94])<0,'the authored window glass is behind its own source');
    assert.ok(dotTo([0,1.8,0])>0,'fighters receive front hemisphere illumination');
    assert.ok(Math.abs(Math.hypot(...d)-1)<1e-6);
    const source=authored.lights.find(light=>light.name===name);
    close(result.colors[o+3],Math.sqrt(source.sizeRuntime*source.sizeYRuntime)/2);
  }
  assert.equal(JSON.stringify(authored),original);
});
test('Sidecar de luces rechaza dirección no unitaria, fuentes duplicadas o posición incompatible',()=>{
  for(const modify of [copy=>copy.lights[0].position[0]+=1,copy=>copy.lights.pop(),copy=>copy.lights[1].direction=[0,0,0],copy=>copy.lights[1].sizeRuntime=-1,copy=>copy.lights[1].spreadRadians=4,copy=>copy.lights[1].name=copy.lights[0].name]){
    const invalid=structuredClone(authored);modify(invalid);assert.throws(()=>api.prepareWorkshopLights(contract,'atelier',invalid));
  }
});

test('Los22 hints reales conservan posición world, color lineal y energía; key queda primero y colas a cero',()=>{
  const result=api.prepareWorkshopLights(contract);
  assert.equal(contract.lighting.hints.length,22);assert.equal(result.count,22);assert.equal(result.keyIndex,0);
  assert.ok(result.positions instanceof Float32Array);assert.ok(result.colors instanceof Float32Array);
  assert.equal(result.positions.length,24*4);assert.equal(result.colors.length,24*4);
  assert.deepEqual(result.names,ordered.map(hint=>hint.name));assert.deepEqual(result.keyPosition,keyHint.position);
  let totalIntensity=0;
  for(let index=0;index<result.count;index++){
    const source=ordered[index],offset=index*4;
    for(let axis=0;axis<3;axis++){close(result.positions[offset+axis],source.position[axis]);close(result.colors[offset+axis],source.colorLinear[axis]);}
    close(result.positions[offset+3],source.scaledWatts/(4*Math.PI));
    close(result.colors[offset+3],source.type==='AREA'?.65:.15);totalIntensity+=result.positions[offset+3];
  }
  close(totalIntensity*4*Math.PI,contract.lighting.hints.reduce((sum,hint)=>sum+hint.scaledWatts,0));
  assert.deepEqual([...result.positions.slice(22*4)],Array(8).fill(0));assert.deepEqual([...result.colors.slice(22*4)],Array(8).fill(0));
  assert.ok([...result.positions,...result.colors].every(Number.isFinite));
});

test('Preparar presets no muta el JSON y cada llamada posee buffers, nombres y keyPosition independientes',()=>{
  const original=JSON.stringify(contract),first=api.prepareWorkshopLights(contract);
  for(const arena of ['atelier','midnight','dojo'])api.prepareWorkshopLights(contract,arena);
  const second=api.prepareWorkshopLights(contract);first.positions[0]=999;first.colors[0]=999;first.names[0]='Otro';first.keyPosition[0]=999;
  close(second.positions[0],keyHint.position[0]);assert.equal(second.colors[0],1);assert.equal(second.names[0],keyHint.name);
  assert.deepEqual(second.keyPosition,keyHint.position);assert.equal(JSON.stringify(contract),original);
});

test('Taller nocturno baja frente a45% y lámparas a65%, con ventanas más azules sin recolocar ninguna luz',()=>{
  const day=api.prepareWorkshopLights(contract,'atelier'),night=api.prepareWorkshopLights(contract,'midnight');
  assert.equal(night.count,22);assert.deepEqual(night.names,day.names);
  for(let index=0;index<night.count;index++){
    const offset=index*4,source=ordered[index],practical=source.type==='POINT'||/practical|shade downlight|background amber/i.test(source.name);
    close(night.positions[offset+3],day.positions[offset+3]*(practical?.65:.45));
    for(let axis=0;axis<3;axis++)assert.equal(night.positions[offset+axis],day.positions[offset+axis]);
    if(/window|blue/i.test(source.name))assert.ok(night.colors[offset+2]/night.colors[offset]>day.colors[offset+2]/day.colors[offset]);
    else for(let axis=0;axis<3;axis++)assert.equal(night.colors[offset+axis],day.colors[offset+axis]);
  }
  assert.notDeepEqual(night.positions,day.positions);assert.notDeepEqual(night.colors,day.colors);
});

test('Dojo eleva potencia20% y neutraliza el tinte preservando count, radios y posiciones',()=>{
  const day=api.prepareWorkshopLights(contract,'atelier'),dojo=api.prepareWorkshopLights(contract,'dojo');
  assert.equal(dojo.count,22);assert.deepEqual(dojo.keyPosition,day.keyPosition);
  for(let index=0;index<day.count;index++){
    const offset=index*4;close(dojo.positions[offset+3],day.positions[offset+3]*1.2);
    for(let axis=0;axis<3;axis++){assert.equal(dojo.positions[offset+axis],day.positions[offset+axis]);close(dojo.colors[offset+axis],day.colors[offset+axis]*.65+.35);}
    assert.equal(dojo.colors[offset+3],day.colors[offset+3]);
  }
  assert.notDeepEqual(dojo.positions,day.positions);assert.notDeepEqual(dojo.colors,day.colors);
});

test('Cada hint malformado se rechaza con su ruta en vez de omitirlo o emitir NaN al GPU',()=>{
  const cases=[
    ['name',''],['name',null],['name','x'.repeat(200)],['type','SPOT'],['type',null],
    ['position',[1,2]],['position',[1,2,Infinity]],['position',[1,'2',3]],['position',[1,2,NaN]],['position',[10001,2,3]],
    ['scaledWatts',-1],['scaledWatts',Infinity],['scaledWatts','20'],['scaledWatts',1000001],
    ['colorLinear',[1,2,3]],['colorLinear',[1,NaN,.5]],['colorLinear',[1,-.1,.5]],['colorLinear',[1,.5]],
  ];
  for(const [field,value] of cases){
    const malformed=structuredClone(contract);malformed.lighting.hints[5][field]=value;
    assert.throws(()=>api.prepareWorkshopLights(malformed),new RegExp(`hints\\[5\\].*${field}`),`${field}:${value}`);
  }
  const missing=structuredClone(contract);delete missing.lighting.hints[4];
  assert.throws(()=>api.prepareWorkshopLights(missing),/hints\[4\]/);
});

test('Faltan luces, sobra capacidad, key ausente/ambigua, nombres duplicados o arena desconocida: error explícito',()=>{
  for(const value of [null,{},[],{lighting:{}},{lighting:{hints:[]}},{lighting:{hints:'arbitrary'}}])assert.throws(()=>api.prepareWorkshopLights(value),/lighting|hints/);
  const tooMany=structuredClone(contract);tooMany.lighting.hints.push(...structuredClone(contract.lighting.hints.slice(0,3)));
  assert.throws(()=>api.prepareWorkshopLights(tooMany),/24|capacidad/);
  const noKey=structuredClone(contract);noKey.lighting.hints=noKey.lighting.hints.filter(hint=>hint.name!==keyHint.name);
  assert.throws(()=>api.prepareWorkshopLights(noKey),/Key|key/);
  const duplicate=structuredClone(contract);duplicate.lighting.hints[0].name=keyHint.name;
  assert.throws(()=>api.prepareWorkshopLights(duplicate),/duplic|únic|ambig/i);
  const repeated=structuredClone(contract);repeated.lighting.hints[1].name=repeated.lighting.hints[0].name;
  assert.throws(()=>api.prepareWorkshopLights(repeated),/duplic|únic/i);
  assert.throws(()=>api.prepareWorkshopLights(contract,'unknown'),/arena/i);
});
