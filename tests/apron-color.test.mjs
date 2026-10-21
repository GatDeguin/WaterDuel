import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter} from '../public/rendering/asset-rig.js';
import {apronMaterialOverride,apronProceduralColor} from '../public/rendering/apron-color.js';
import {AssetGPU} from '../public/rendering/asset-gpu.js';
import {Renderer3D} from '../public/render3d.js';
import {HostSession} from '../public/host-session.js';
import {balloonPalette,BALLOON_COLORS} from '../public/opponent-loadouts.js';
import {captureReplayState,replayView} from '../public/replay.js';

const loaded=new Map();
async function character(boss=false){
  const name=boss?'water-mannequin-boss':'water-mannequin-amber';
  if(!loaded.has(name))loaded.set(name,fs.readFile(new URL(`../public/assets/characters/water-mannequin/v3/${name}.glb`,import.meta.url)).then(bytes=>{
    const asset=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));return {asset,prepared:prepareCharacter(asset)};
  }));
  return loaded.get(name);
}
function gpuFixture(){
  const uniforms={};const gl=new Proxy({getParameter:()=>16,createBuffer:()=>({}),createVertexArray:()=>({}),createTexture:()=>({}),
    uniform4fv:(k,v)=>uniforms[k]=Array.from(v),uniform3fv:(k,v)=>uniforms[k]=Array.from(v),uniform1f:(k,v)=>uniforms[k]=v,
    uniform1i:(k,v)=>uniforms[k]=v,uniform4iv:(k,v)=>uniforms[k]=Array.from(v),uniform2iv:(k,v)=>uniforms[k]=Array.from(v)},
    {get:(o,k)=>k in o?o[k]:typeof k==='string'&&/^[A-Z0-9_]+$/.test(k)?k:()=>{}});
  return {gl,uniforms,U:new Proxy({},{get:(_o,k)=>k})};
}
const eligible={slot:2,balloonColor:'cobalt',matchApronToBalloon:true};
const command=(h,command,value)=>h.handleCommand({type:'command',command,requestId:1,sentAt:Date.now(),...(value===undefined?{}:{value})});

test('tinte exclusivo de tela del faldón: las insignias de latón y el cuerpo quedan intactos en ambos GLB reales',async()=>{
  for(const boss of [false,true]){
    const {asset,prepared}=await character(boss),before=structuredClone(asset.materials);
    const selected=prepared.parts.filter(p=>apronMaterialOverride(eligible,p,asset.materials[p.material]));
    assert.equal(selected.length,1);assert.ok(selected.every(p=>p.accessory==='apron'&&p.boneName==='pelvis'&&/Woven_(Sash|Cloth)/.test(p.nodeName)));
    if(boss)assert.ok(prepared.parts.some(p=>p.accessory==='apron'&&/Brass/.test(p.nodeName)&&!selected.includes(p)),'la orla/heráldica articulada conserva su latón');
    assert.deepEqual(asset.materials,before);
    const cloth=selected[0],material=asset.materials[cloth.material];
    for(const fighter of [{...eligible,slot:1},{...eligible,matchApronToBalloon:false},{...eligible,matchApronToBalloon:undefined}])assert.equal(apronMaterialOverride(fighter,cloth,material),undefined);
    for(const fighter of [{...eligible,slot:1},{...eligible,matchApronToBalloon:false},{...eligible,matchApronToBalloon:undefined}])assert.equal(apronProceduralColor(fighter,0x123456),0x123456);
    assert.equal(apronMaterialOverride(eligible,{...cloth,accessory:undefined},material),undefined);
  }
});

test('cada paleta produce el mismo matiz lineal en tela, sin albedo fuera de rango ni brillo verde heredado',async()=>{
  const {asset,prepared}=await character(),part=prepared.parts.find(p=>p.accessory==='apron'&&/Woven_Sash/.test(p.nodeName)),material=asset.materials[part.material],base=material.pbrMetallicRoughness.baseColorFactor;
  for(const balloonColor of BALLOON_COLORS){
    const fighter={...eligible,balloonColor},options=apronMaterialOverride(fighter,part,material),color=balloonPalette(fighter).balloon;
    const target=[color>>16&255,color>>8&255,color&255].map(x=>(x/255)**2.2);
    const actual=base.slice(0,3).map((x,i)=>x*options.tint[i]);
    assert.ok(actual.every(x=>Number.isFinite(x)&&x>=0&&x<=1));
    for(let i=0;i<3;i++)assert.ok(Math.abs(actual[i]-.45*target[i])<1e-12);
    for(let i=0;i<3;i++)assert.ok(Math.abs(options.sheenColor[i]/Math.max(...options.sheenColor)-target[i]/Math.max(...target))<1e-12);
    assert.equal(apronMaterialOverride(fighter,part,material),options,'las opciones reutilizan caché por material/color');
    assert.equal(apronProceduralColor(fighter,0x111111),color);
  }
});

test('la ruta AssetGPU aplica base y sheen sólo a esa llamada y conserva mapas PBR/roughness',async()=>{
  const {asset,prepared}=await character(),{gl,uniforms,U}=gpuFixture(),gpu=new AssetGPU(gl,{decodeImage:async()=>({width:1,height:1,close(){}})});
  const model=await gpu.upload({...asset,primitives:prepared.parts}),index=prepared.parts.findIndex(p=>p.accessory==='apron'&&/Woven_Sash/.test(p.nodeName)),part=model.parts[index],material=model.materials[part.material];
  const source=structuredClone(material),options=apronMaterialOverride(eligible,prepared.parts[index],material);
  gpu.draw(model,part,part.worldMatrix,U,options);
  const tinted={...uniforms,uAssetColor:[...uniforms.uAssetColor],uAssetSheen:[...uniforms.uAssetSheen]};
  assert.deepEqual(tinted.uAssetColor,material.baseColorFactor.map((x,i)=>i<3?x*options.tint[i]:x));
  assert.deepEqual(tinted.uAssetSheen,[...options.sheenColor,material.sheenRoughness]);assert.ok(tinted.uAssetMaps&2);assert.ok(tinted.uAssetMaps&4);assert.ok(tinted.uAssetMaps&8);
  gpu.draw(model,part,part.worldMatrix,U);assert.deepEqual(uniforms.uAssetColor,material.baseColorFactor);
  assert.deepEqual(uniforms.uAssetSheen,[...material.sheenColor,material.sheenRoughness]);assert.equal(uniforms.uAssetMaps,tinted.uAssetMaps);assert.equal(uniforms.uAssetNormalScale,tinted.uAssetNormalScale);
  assert.deepEqual(material,source);gpu.dispose();
});

test('Renderer3D envía override exclusivamente a tela elegible, también durante replay',async()=>{
  const {asset,prepared}=await character(),h=new HostSession({opponentSeed:51}),f=h.game.fighters[1],calls=[];
  const entry={prepared,gpu:{parts:prepared.parts.map(p=>({...p})),materials:asset.materials}},renderer={assetScene:{characters:{amber:entry}},assetPoseCache:new WeakMap(),assetPart:(...args)=>calls.push(args)};
  f.matchApronToBalloon=true;
  for(const fighter of [f,replayView(captureReplayState(h.game)).fighters[1]]){
    calls.length=0;assert.equal(Renderer3D.prototype.detailedPuppet.call(renderer,fighter),true);
    assert.equal(calls.filter(call=>call[3]).length,1);assert.ok(calls.find(call=>call[3])[1].nodeName.includes('Woven_Sash'));
  }
  f.matchApronToBalloon=false;calls.length=0;Renderer3D.prototype.detailedPuppet.call(renderer,f);assert.equal(calls.filter(call=>call[3]).length,0);
});

test('metadato autoritativo sólo acompaña Duelo IA y persiste en rondas/revancha/replay',()=>{
  const h=new HostSession({opponentSeed:4});assert.equal(h.game.fighters[1].matchApronToBalloon,true);assert.equal(h.game.fighters[0].matchApronToBalloon,false);
  h.game.resetRound();assert.equal(h.game.fighters[1].matchApronToBalloon,true);
  assert.equal(replayView(captureReplayState(h.game)).fighters[1].matchApronToBalloon,true);
  for(const kind of ['campaign','training','practice','precision']){command(h,'setExperience',kind);assert.equal(h.game.fighters[1].matchApronToBalloon,false,kind);}
  command(h,'setExperience','duel');assert.equal(h.game.fighters[1].matchApronToBalloon,true);
  command(h,'setMode','versus');assert.equal(h.game.fighters[1].matchApronToBalloon,false);
});
