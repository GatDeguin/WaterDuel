import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadWorkshopSurroundings} from '../public/rendering/workshop-surroundings.js';
import {prepareWorkshopMotion,environmentPartMatrix} from '../public/rendering/workshop-motion.js';
import {parseGLB} from '../public/rendering/glb.js';
const api=await import('../public/rendering/workshop-runtime-v4.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const fn=name=>{assert.equal(typeof api[name],'function',`${name} must expose the versioned v4 runtime path`);return api[name];};
const base=new URL('../public/assets/environment/workshop/',import.meta.url),baseURL=new URL('https://local.example/sub/WaterDuel/assets/environment/workshop/');
const json=name=>JSON.parse(readFileSync(new URL(name,base))),metadata=()=>({contract:json('asset-contract-v4.json'),frames:json('light-directions-v4.json'),day:json('lighting-day-v4.json'),night:json('lighting-night-v4.json')});
const surrounding=json('workshop-360-v4.json');
const close=(a,b)=>assert.ok(Math.abs(a-b)<=Math.max(1,Math.abs(b))*2e-6,`${a} != ${b}`);

test('versioned metadata loads exactly the four v4 sidecars below a subdirectory and preserves runtime coordinates',async()=>{
 const calls=[],signal=new AbortController().signal;
 const fetchImpl=async(url,options)=>{calls.push({url:String(url),signal:options.signal});return {ok:true,json:async()=>json(new URL(url).pathname.split('/').at(-1))};};
 const actual=await fn('loadWorkshopV4Metadata')(baseURL,{fetchImpl,signal});
 assert.deepEqual(calls.map(c=>new URL(c.url).pathname.split('/').at(-1)).sort(),['asset-contract-v4.json','light-directions-v4.json','lighting-day-v4.json','lighting-night-v4.json'].sort());
 assert.ok(calls.every(c=>c.url.startsWith(baseURL.href)&&c.signal===signal));
 assert.equal(actual.contract.version,4);assert.equal(actual.contract.asset,'workshop-runtime-v4.glb');
 assert.deepEqual(actual.contract.fanRotor.pivot,[-4.200680255889893,1.7139557600021362,-2.226360559463501]);
 assert.deepEqual(actual.contract.lighting.hints[0].position,metadata().contract.lighting.hints[0].position);
});

test('v4 metadata rejects unfinished releases, mismatched frames, unbounded lights and HTTP failures',async()=>{
 const validate=fn('validateWorkshopV4Metadata');
 for(const edit of [m=>m.contract.ready=false,m=>m.contract.stable=false,m=>m.contract.version=3,m=>m.contract.coordinateTransform.appliedToGeometry=false,m=>m.contract.asset='workshop-runtime-v3.glb',m=>m.contract.lighting.hints[0].scaledWatts=NaN,m=>m.frames.version=3,m=>m.frames.lights[0].position[0]+=1,m=>m.night.variant='day',m=>m.night.lights.pop(),m=>m.day.lights[1].scaledWatts=NaN]){const m=metadata();edit(m);assert.throws(()=>validate(m));}
 await assert.rejects(()=>fn('loadWorkshopV4Metadata')(baseURL,{fetchImpl:async()=>({ok:false,status:503})}),/v4|contrato|metadata|503/i);
});

test('authored v4 day and night keep all 24 sources without rescaling coordinates or applying legacy night attenuation twice',()=>{
 const m=metadata(),before=JSON.stringify(m),presets=fn('prepareWorkshopV4Presets')(m,surrounding);
 for(const arena of ['atelier','midnight','dojo'])assert.equal(presets[arena].count,24);
 for(const [arena,source]of [['atelier',m.day],['midnight',m.night]]){
  const result=presets[arena];
  for(let i=0;i<result.count;i++){
   const light=source.lights.find(l=>l.name===result.names[i])??surrounding.lighting.hints.find(l=>l.name===result.names[i]);
   for(let axis=0;axis<3;axis++){close(result.positions[i*4+axis],light.position[axis]);close(result.colors[i*4+axis],light.colorLinear[axis]);}
   close(result.positions[i*4+3],light.scaledWatts/(4*Math.PI));
  }
  const key=source.lights.find(l=>/^Key\s*\|/.test(l.name));assert.deepEqual(result.keyPosition,key.position);
 }
 assert.equal(JSON.stringify(m),before);assert.notDeepEqual(presets.atelier.colors,presets.midnight.colors);
 assert.notDeepEqual(presets.atelier.positions,presets.midnight.positions);
});

test('the v4 surrounds loader requests the matching pair while the old default continues requesting the old pair',async()=>{
 const calls=[],bytes=readFileSync(new URL('workshop-360-v4.glb',base));
 const fetchImpl=async url=>{const file=new URL(url).pathname.split('/').at(-1);calls.push(file);return {ok:true,json:async()=>json(file),arrayBuffer:async()=>{const b=file==='workshop-360-v4.glb'?bytes:readFileSync(new URL(file,base));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}};};
 const result=await loadWorkshopSurroundings(baseURL,{revision:4,fetchImpl});
 assert.deepEqual(calls,['workshop-360-v4.json','workshop-360-v4.glb']);assert.equal(result.contract.asset,'workshop-360-v4.glb');assert.ok(result.source.primitives.length>0);
 calls.length=0;await loadWorkshopSurroundings(baseURL,{fetchImpl});assert.deepEqual(calls,['workshop-360.json','workshop-360.glb']);
 await assert.rejects(()=>loadWorkshopSurroundings(baseURL,{revision:7,fetchImpl}),/revision|revisión/i);
});

function modelFor(m){return {materials:m.night.materialOverrides.map((entry,i)=>({name:entry.materialName,baseColorFactor:[.2+i*.1,.3,.4,.8],emissiveFactor:[.7,.8,.9],normalTexture:{index:3},metallicFactor:0,coat:.2})).concat({name:'Untouched wood',baseColorFactor:[.4,.2,.1,1],emissiveFactor:[0,0,0]})};}

test('night changes exactly its two material records, applies already scaled emission once and restores day without touching maps',()=>{
 const m=metadata(),model=modelFor(m),original=model.materials.slice(),before=JSON.stringify(model),controller=fn('createWorkshopV4VariantController')(model,m);
 assert.equal(controller.apply('midnight'),true);
 for(let i=0;i<2;i++){
  assert.deepEqual(model.materials[i].baseColorFactor,m.night.materialOverrides[i].baseColorFactor);
  assert.deepEqual(model.materials[i].emissiveFactor,m.night.materialOverrides[i].emissiveFactor);
  assert.equal(model.materials[i].normalTexture,original[i].normalTexture);assert.equal(model.materials[i].coat,original[i].coat);
 }
 const night=model.materials.slice();assert.equal(controller.apply('midnight'),false);assert.deepEqual(model.materials,night);
 assert.equal(model.materials[2],original[2]);assert.equal(controller.apply('atelier'),true);assert.deepEqual(model.materials,original);assert.equal(JSON.stringify(model),before);
 controller.apply('midnight');assert.equal(controller.apply('dojo'),true);assert.deepEqual(model.materials,original);assert.throws(()=>controller.apply('arbitrary'),/arena|preset/i);
});

test('a missing, duplicated or malformed night material cannot partially change a loaded model',()=>{
 const m=metadata(),model=modelFor(m),factory=fn('createWorkshopV4VariantController');
 for(const edit of [x=>x.night.materialOverrides[0].baseColorFactor[0]=NaN,x=>x.night.materialOverrides[1].emissiveFactor=[0,Infinity,0],x=>x.night.materialOverrides[1].materialName=x.night.materialOverrides[0].materialName,x=>x.night.materialOverrides[0].materialName='Not a real material']){
  const invalid=structuredClone(m);edit(invalid);const before=JSON.stringify(model);assert.throws(()=>factory(model,invalid));assert.equal(JSON.stringify(model),before);
 }
});

test('the actual v4 rotor keeps its unique local mesh, runtime pivot, axis and rate without transforming the static workshop twice',()=>{
 const m=metadata(),bytes=readFileSync(new URL('workshop-runtime-v4.glb',base)),asset=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 for(const entry of m.night.materialOverrides)assert.equal(asset.materials.filter(material=>material.name===entry.materialName).length,1,'each night override names exactly one real v4 GLB material');
 const rotor=asset.primitives.find(p=>p.nodeName==='Workshop_FanRotor');assert.ok(rotor);assert.equal(asset.primitives.filter(p=>p.nodeName===rotor.nodeName).length,1);
 const motion=prepareWorkshopMotion({...m.contract,crossingClearance:null},[rotor]);assert.deepEqual(motion.pivot,m.contract.fanRotor.pivot);assert.deepEqual(motion.axis,[0,0,1]);assert.equal(motion.angularSpeed,7.2);
 const rest=environmentPartMatrix(rotor,motion,0),quarter=environmentPartMatrix(rotor,motion,Math.PI/2/7.2);
 for(let i=0;i<3;i++){close(rest[12+i],m.contract.fanRotor.pivot[i]);close(quarter[12+i],rest[12+i]);}
 close(quarter[0],0);close(quarter[1],1);assert.equal(environmentPartMatrix(rotor,motion,1,{staticCapture:true}),null);
 const stationary=asset.primitives.find(p=>p!==rotor);assert.equal(environmentPartMatrix(stationary,motion,1),stationary.worldMatrix);
});
