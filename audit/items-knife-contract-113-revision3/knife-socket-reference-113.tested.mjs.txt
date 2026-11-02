import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGLB} from '../public/rendering/glb.js';
import {equipmentTransform,deformEquipmentPoint} from '../public/rendering/asset-rig.js';
import {assertKnifeSocketContract} from './helpers/knife-socket-reference.mjs';

// Captured N16 J1/normal pose from PERSONAJES_V4_KNIFE_SOCKET_PRECISION.json.
// These tests do not construct an engine, advance a simulation or execute GPU code.
const capturedHand=[-.9691203726277041,2.612294039123961,.09979211404812562];
const capturedTip=[-.7674337541269044,2.9806993972795026,.17];
const assets=new Map(['v2','v3'].map(version=>{
  const bytes=readFileSync(new URL(`../public/assets/equipment/workshop/${version}/knife.glb`,import.meta.url));
  return [version,parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))];
}));
const xyz=v=>({x:v[0],y:v[1],z:v[2]});
function actualInputs({version='v2',hand=capturedHand,tip=capturedTip,dir=1}={}){
  const asset=assets.get(version),fighter={dir,equipment:{weapon:'sword',defense:'knife'},pose:{offHand:xyz(hand),defenseTip:xyz(tip)}};
  const transform=equipmentTransform(fighter,'knife');
  const socket=asset.nodes.find(node=>node.name==='Socket_Strike').worldMatrix.subarray(12,15);
  const uniforms32={...transform,deformStart:Math.fround(transform.deformStart),deformEnd:Math.fround(transform.deformEnd),extension:Math.fround(transform.extension)};
  return {asset,hand,tip,transform,localPoint64:deformEquipmentPoint([0,.42,0],transform),localPoint32:deformEquipmentPoint(socket,uniforms32)};
}
function alterAsset(asset,name,change){
  return {...asset,json:{...asset.json,nodes:asset.json.nodes.map(node=>node.name===name?{...node,...change}:node)}};
}

test('La captura que excede 1e-7 conserva geometría F64 y satisface el contrato CPU de datos Float32',()=>{
  for(const version of ['v2','v3']){
    const input=actualInputs({version}),report=assertKnifeSocketContract(input);
    assert.ok(report?.quantizedEndpoint,'el contrato debe producir evidencia de los tres controles');
    for(let i=0;i<3;i++)assert.ok(Math.abs(report.geometryEndpoint[i]-capturedTip[i])<1e-7);
    assert.ok(Math.abs(report.quantizedEndpoint[1]-2.980699296424608)<1e-14,'incluye uniforms Float32, sin afirmar ejecución GPU');
    assert.ok(Math.abs(report.quantizedEndpoint[1]-capturedTip[1])>1e-7,'esta captura distingue precisión geométrica y representación Float32');
    assert.ok(report.rows.every(row=>Math.abs(row.error)<=row.bound));
    assert.ok(report.localBound.uniforms>0,'la cota incluye start/end/extension cuantizados');
  }
});

test('Un socket authored desplazado 1e-4 falla el contrato canónico aunque se conserve la matriz',()=>{
  const input=actualInputs();
  input.asset=alterAsset(input.asset,'Socket_Strike',{translation:[0,Math.fround(.42)+1e-4,0]});
  assert.throws(()=>assertKnifeSocketContract(input),/canonical socket/);
});

test('Alterar una ULP un coeficiente F32 falla incluso si el extremo está sobre el eje Y local',()=>{
  for(const index of [0,8,13]){
    const input=actualInputs(),matrix=input.transform.matrix.slice();
    new Uint32Array(matrix.buffer)[index]++;
    input.transform={...input.transform,matrix};
    assert.throws(()=>assertKnifeSocketContract(input),/matrix coefficient/);
  }
});

test('Un extremo geométrico incorrecto falla el límite F64 original de 1e-7',()=>{
  const input=actualInputs();input.localPoint64[0]+=1e-4;
  assert.throws(()=>assertKnifeSocketContract(input),/F64 alignment/);
});

test('Un extremo cuantizado fuera de su cota falla por componente con geometría F64 válida',()=>{
  const input=actualInputs();input.localPoint32[1]+=1e-4;
  assert.throws(()=>assertKnifeSocketContract(input),/Float32 data bound/);
});

test('La referencia no toma la extensión ni los extremos de deformación del transform productivo',()=>{
  for(const field of ['extension','deformStart','deformEnd','stretchAlong']){
    const input=actualInputs();input.transform={...input.transform,[field]:input.transform[field]+1e-4};
    assert.throws(()=>assertKnifeSocketContract(input),/deformation contract/);
  }
});

test('Flex, padres no identidad y datos no finitos se rechazan en este contrato de daga recta',()=>{
  for(const field of ['flexOffset','flexLength']){
    const input=actualInputs();input.transform={...input.transform,[field]:.001};
    assert.throws(()=>assertKnifeSocketContract(input),/unsupported flex/);
  }
  const parent=actualInputs();parent.asset=alterAsset(parent.asset,'WD_knife_Asset',{translation:[1e-4,0,0]});
  assert.throws(()=>assertKnifeSocketContract(parent),/identity parent/);
  const invalid=actualInputs();invalid.localPoint32[1]=NaN;
  assert.throws(()=>assertKnifeSocketContract(invalid),/finite/);
  const wide=actualInputs();wide.transform={...wide.transform,matrix:new Float64Array(wide.transform.matrix)};
  assert.throws(()=>assertKnifeSocketContract(wide),/Float32Array/);
});

test('La cota se propaga con orientación, extensión, coordenadas y traslación; no es un epsilon fijo',()=>{
  const baseline=assertKnifeSocketContract(actualInputs());
  assert.ok(baseline?.rows,'el contrato debe exponer cotas por componente');
  for(const dir of [1,-1])for(const length of [.12,.42,1.68]){
    const hand=[dir*12.4,18.2,-.3],tip=[hand[0]+dir*.6*length,hand[1]+.8*length,hand[2]];
    const report=assertKnifeSocketContract(actualInputs({hand,tip,dir}));
    assert.ok(report.rows.every(row=>Math.abs(row.error)<=row.bound));
    assert.ok(report.rows[1].bound>baseline.rows[1].bound,'una traslación mayor exige su propia granularidad Float32');
  }
});
