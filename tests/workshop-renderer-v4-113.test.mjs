import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Renderer3D} from '../public/render3d.js';
import {createWorkshopV4VariantController,prepareWorkshopV4Presets} from '../public/rendering/workshop-runtime-v4.js';
import {prepareWorkshopMotion} from '../public/rendering/workshop-motion.js';

const base=new URL('../public/assets/environment/workshop/',import.meta.url);
const json=async name=>JSON.parse(await readFile(new URL(name,base),'utf8'));
const metadata=async()=>({contract:await json('asset-contract-v4.json'),frames:await json('light-directions-v4.json'),day:await json('lighting-day-v4.json'),night:await json('lighting-night-v4.json')});
const identity=()=>Float32Array.from([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<=Math.max(1,Math.abs(expected))*2e-6,`${actual} != ${expected}`);
function uniforms(){
 const values=new Map(),gl=new Proxy({},{get:(_target,name)=>name.startsWith('uniform')?(key,value)=>values.set(key,ArrayBuffer.isView(value)?Array.from(value):value):()=>{}});
 return {values,gl,U:new Proxy({},{get:(_target,key)=>key})};
}
function normalizedMaterials(source){
 return source.materials.map(material=>({...material,...material.pbrMetallicRoughness,
  baseColorFactor:material.pbrMetallicRoughness?.baseColorFactor??material.baseColorFactor??[1,1,1,1],
  emissiveFactor:(material.emissiveFactor??[0,0,0]).map(v=>v*(material.extensions?.KHR_materials_emissive_strength?.emissiveStrength??1))}));
}
async function loadMain({rejectSurrounds=false}={}){
 const r=Object.create(Renderer3D.prototype),calls=[],uploads=[],statuses=[],previousFetch=globalThis.fetch,previousError=console.error;
 r.assetStatus={loading:false,ready:0,total:11,names:[],errors:[]};r.assetScene={characters:{},equipment:{},environment:null};r.environment={key:'previous'};
 r.assetGPU={bytes:0,async upload(source){uploads.push(source);return {materials:normalizedMaterials(source),parts:source.primitives.map(p=>({...p,count:p.indices.length}))};}};
 globalThis.fetch=async(url,{signal}={})=>{
  const path=new URL(url).pathname,file=path.split('/').at(-1);calls.push({path,signal});
  if(!path.includes('/environment/workshop/')||rejectSurrounds&&file==='workshop-360-v4.json')return {ok:false,status:503};
  if(file.endsWith('.json'))return {ok:true,json:()=>json(file)};
  const bytes=await readFile(new URL(file,base));return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
 };
 console.error=()=>{};
 try{await r.loadAssets(status=>statuses.push(status));return {r,calls,uploads,statuses};}
 finally{globalThis.fetch=previousFetch;console.error=previousError;}
}

test('the shipped renderer loads V4 geometry, its four matching sidecars and the stable V4 room as one 24-light presentation',async()=>{
 const {r,calls,statuses}=await loadMain(),entry=r.assetScene.environment;
 assert.ok(entry,'the real V4 main contract must admit its matching geometry');assert.equal(entry.revision,4);assert.ok(entry.variants);
 const files=calls.filter(c=>c.path.includes('/environment/workshop/')).map(c=>c.path.split('/').at(-1));
 for(const file of ['workshop-runtime-v4.glb','asset-contract-v4.json','light-directions-v4.json','lighting-day-v4.json','lighting-night-v4.json','workshop-360-v4.json','workshop-360-v4.glb'])assert.ok(files.includes(file),`${file} must be requested through the actual renderer loader`);
 assert.ok(!files.includes('asset-contract.json')&&!files.includes('light-directions.json')&&!files.includes('workshop-360.glb'));
 assert.ok(calls.every(c=>c.signal===r.assetAbort.signal));assert.equal(entry.surroundings?.contract.stable,true,'the real 360 release remains gated; do not patch its stable flag inside this test');
 for(const arena of ['atelier','midnight','dojo'])assert.equal(entry.lightingPresets[arena].count,24,arena);
 const m=await metadata(),room=await json('workshop-360-v4.json');
 for(const [arena,preset]of [['atelier',m.day],['midnight',m.night]])for(const [i,name]of entry.lightingPresets[arena].names.entries()){
  const authored=preset.lights.find(light=>light.name===name)??room.lighting.hints.find(light=>light.name===name),light=entry.lightingPresets[arena];assert.ok(authored,`${name} must retain an authored source`);
  for(let axis=0;axis<3;axis++){near(light.positions[i*4+axis],authored.position[axis]);near(light.colors[i*4+axis],authored.colorLinear[axis]);}
  near(light.positions[i*4+3],authored.scaledWatts/(4*Math.PI));
 }
 assert.equal(entry.gpu.parts.filter(p=>p.nodeName==='Workshop_FanRotor').length,1);assert.equal(entry.motion.angularSpeed,7.2);
 assert.deepEqual(entry.motion.pivot,m.contract.fanRotor.pivot);assert.ok(statuses.slice(0,-1).every(s=>s.loading));assert.equal(statuses.at(-1).loading,false);assert.equal(r.environment.key,null);
});

test('an unavailable V4 room settles with an explicit error and the intact 22-light V4 main scene',async()=>{
 const {r,calls,statuses}=await loadMain({rejectSurrounds:true}),entry=r.assetScene.environment;
 assert.equal(r.assetStatus.loading,false);assert.equal(r.assetStatus.ready,1);assert.ok(entry);assert.equal(entry.revision,4);assert.equal(entry.surroundings,null);
 assert.ok(r.assetStatus.errors.some(message=>/360/.test(message)));assert.equal(statuses.at(-1).loading,false);
 assert.ok(!calls.some(c=>c.path.endsWith('/workshop-360.glb')),'no old room is silently mixed into V4');
 const m=await metadata();
 for(const [arena,preset]of [['atelier',m.day],['midnight',m.night]]){
  const light=entry.lightingPresets[arena];assert.equal(light.count,22);
  for(const [i,name]of light.names.entries()){
   const authored=preset.lights.find(source=>source.name===name);for(let axis=0;axis<3;axis++){near(light.positions[i*4+axis],authored.position[axis]);near(light.colors[i*4+axis],authored.colorLinear[axis]);}
   near(light.positions[i*4+3],authored.scaledWatts/(4*Math.PI));
  }
 }
});

function modelFor(m){return {materials:m.night.materialOverrides.map((entry,i)=>({name:entry.materialName,baseColorFactor:[.2+i*.1,.3,.4,1],emissiveFactor:[.01,.02,.03],normalTexture:{index:4}}))};}
test('actual arena drawing retains neutral V4 tint, rotates the runtime rotor once and excludes it from static captures',async()=>{
 const m=await metadata(),r=Object.create(Renderer3D.prototype),pivot=m.contract.fanRotor.pivot,rotor={nodeName:m.contract.fanRotor.name,worldMatrix:identity()},fixed={nodeName:'Static wall',worldMatrix:identity()},room={nodeName:'V4 room',worldMatrix:identity()},calls=[];
 rotor.worldMatrix.set(pivot,12);const motion=prepareWorkshopMotion({...m.contract,crossingClearance:null},[rotor,fixed]);
 r.assetScene={environment:{revision:4,gpu:{parts:[rotor,fixed]},motion,transform:identity(),surroundings:{gpu:{parts:[room]}}}};
 r.assetPart=(_gpu,part,matrix,deform)=>calls.push({part,matrix:Array.from(matrix),tint:deform.tint});
 for(const arena of ['atelier','midnight','dojo']){
  calls.length=0;r.drawArena({arena,clock:Math.PI/2/7.2,puddleStrength:[0,0]},999);
  assert.equal(calls.length,3);assert.ok(calls.every(call=>call.tint.every(v=>v===1)));
  const spin=calls.find(call=>call.part===rotor);near(spin.matrix[0],0);near(spin.matrix[1],1);for(let axis=0;axis<3;axis++)near(spin.matrix[12+axis],pivot[axis]);
  assert.deepEqual(calls.find(call=>call.part===fixed).matrix,Array.from(fixed.worldMatrix));
 }
 r.staticShadowPass=true;calls.length=0;r.drawArena({arena:'midnight',clock:1},1);assert.deepEqual(calls.map(call=>call.part),[fixed,room]);
 r.staticShadowPass=false;r.assetScene.environment.revision=3;calls.length=0;r.drawArena({arena:'midnight',clock:1},1);assert.deepEqual(calls[0].tint,[.33,.54,.68],'the legacy tint path remains unchanged');
});

test('actual lighting uniforms preserve the authored day/night arrays and report no second legacy gains for V4',async()=>{
 const m=await metadata(),r=Object.create(Renderer3D.prototype),{values,gl,U}=uniforms(),presets=prepareWorkshopV4Presets(m);
 Object.assign(r,{gl,U,stats:{},shadows:{available:false},assetScene:{environment:{revision:4,lightingPresets:presets}}});
 for(const arena of ['atelier','midnight','dojo']){
  r.workshopLighting({arena});assert.equal(values.get('uWorkshopLightCount'),22);assert.deepEqual(values.get('uWorkshopPositions'),Array.from(presets[arena].positions));assert.deepEqual(values.get('uWorkshopColors'),Array.from(presets[arena].colors));assert.deepEqual(values.get('uWorkshopDirections'),Array.from(presets[arena].directions));
  assert.equal(r.stats.lighting.keyGain,1);assert.equal(r.stats.lighting.frontReturnGain,1);
 }
});

test('render applies the V4 material variant before lights, shadows, cubemap and visible draws, and hides partial loading',async()=>{
 const m=await metadata(),model=modelFor(m),original=model.materials.slice(),r=Object.create(Renderer3D.prototype),{gl,U}=uniforms(),trace=[];
 const observe=pass=>trace.push({pass,material:model.materials[0]});
 Object.assign(r,{gl,U,program:{},stats:{},assetStatus:{loading:false},assetGPU:{bytes:0},floatStream:{stats:{}},assetScene:{environment:{variants:createWorkshopV4VariantController(model,m)}},shadows:{available:false},environment:{available:false},colorFormat:{name:'stub'},cameraMotionPreference:{matches:false},pending:[],
  resize(){this.width=1120;this.height=690;},workshopLighting(){observe('lights');},captureShadows(){observe('shadows');},captureWorkshop(){observe('cubemap');},drawArena(){observe('arena');},drawPuppet(){observe('puppet');},renderLiquid(){},drawEffects(){},flush(){},
  opticalDepth:{available:false,ensure(){}},transmission:{available:false,ensure(){},begin(){},prepare(){return false;},present(){}}});
 const game={arena:'midnight',quality:'high',phase:'ready',phaseClock:0,clock:0,round:1,lightingMode:'cinematic',cameraMode:'combat',fighters:[{}]};
 r.render(game,0);assert.deepEqual(trace.map(call=>call.pass),['lights','shadows','cubemap','arena','puppet']);
 for(const call of trace){assert.deepEqual(call.material.baseColorFactor,m.night.materialOverrides[0].baseColorFactor);assert.deepEqual(call.material.emissiveFactor,m.night.materialOverrides[0].emissiveFactor);assert.equal(call.material.normalTexture,original[0].normalTexture);}
 const night=model.materials[0];trace.length=0;r.render(game,1);assert.ok(trace.every(call=>call.material===night),'repeated frames retain the same prepared material records');
 trace.length=0;r.render({...game,arena:'atelier'},2);assert.ok(trace.every(call=>call.material===original[0]),'day is restored before every render pass');
 r.assetStatus.loading=true;trace.length=0;r.render(game,3);assert.deepEqual(trace,[]);assert.equal(model.materials[0],original[0],'loading cannot expose any variant or partially drawn version');
});
