import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {deformEquipmentPoint,equipmentTransform} from '../public/rendering/asset-rig.js';
import {WorkshopEffects} from '../public/workshop-effects.js';

const implementation=await import('../public/physics/contact-materials.js').catch(()=>null);
const api=name=>{assert.equal(typeof implementation?.[name],'function',`Falta ${name}`);return implementation[name];};
const contract=JSON.parse(await fs.readFile(new URL('../docs/assets/equipment/contact-materials-v1.json',import.meta.url)));
function surface(id,s,{extension=.28,dir=1,key='weapon'}={}){
  const item=contract.assets[id],R=item.rest_reach_m,L=R+extension,hand={x:.4,y:1.8,z:.17},axis={x:dir*.8,y:.48,z:.36};
  const tip={x:hand.x+axis.x*L,y:hand.y+axis.y*L,z:hand.z+axis.z*L};
  const knife=id==='knife',f={equipment:{weapon:knife?'sword':id,defense:knife?'knife':'none'},pose:knife?{offHand:hand,defenseTip:tip}:{mainHand:hand,tip}};
  const transform=equipmentTransform(f,id),d=deformEquipmentPoint([0,s,0],transform)[1],point={x:hand.x+axis.x*d,y:hand.y+axis.y*d,z:hand.z+axis.z*d};
  return {f,point,key:knife?'guard':key};
}

test('Las bandas coarse conservan los materiales del contrato en ambos roles y extensión por tramos real',()=>{
  const classify=api('classifyEquipmentContact');
  for(const [id,item] of Object.entries(contract.assets))for(const zone of item.zones){
    if(!zone.rest_along_m)continue;
    const s=(zone.rest_along_m[0]+zone.rest_along_m[1])/2;
    for(const dir of [-1,1])for(const extension of [-.05,.28,.4]){
      const {f,point,key}=surface(id,s,{extension,dir});
      assert.equal(classify(f,key,point),zone.dominant,`${id}/${zone.id}/${dir}/${extension}`);
    }
  }
});

test('Cabezal mixto, fallback sin posición, palmas y materiales explícitos no se vuelven acero por body weapon',()=>{
  const classify=api('classifyEquipmentContact');
  for(const [id,want] of [['sword','steel'],['spear','wood'],['axe','wood'],['maul','wood']])assert.equal(classify({equipment:{weapon:id}},'weapon'),want);
  assert.equal(classify({equipment:{weapon:'maul'}},'weapon-head'),'wood_metal_mixed');
  assert.equal(classify({equipment:{weapon:'axe'}},'weapon-head'),'steel');
  assert.equal(classify({equipment:{weapon:'sword'}},'main-palm'),'wood');
  assert.equal(classify({equipment:{weapon:'sword'}},{key:'weapon',material:'wood'}),'wood');
  assert.equal(classify({equipment:{weapon:'maul'}},{key:'weapon-head',material:'brass'}),'brass');
  for(const [defense,want] of [['short','metal_mixed'],['long','wood'],['knife','steel']])assert.equal(classify({equipment:{defense}},'guard'),want);
  assert.equal(classify({equipment:{weapon:'typo'}},'weapon'),'unknown');assert.equal(classify({},'unresolved'),'unknown');
});

test('La banda pequeña de latón de la lanza no cambia la madera de toda el asta',()=>{
  const classify=api('classifyEquipmentContact');
  for(const [s,want] of [[.38,'wood'],[.395,'brass'],[.414,'wood']]){
    const {f,point,key}=surface('spear',s,{extension:.34});assert.equal(classify(f,key,point),want);
  }
});

test('La pareja distingue metal, madera, mixto y amortiguación sin adivinar materiales desconocidos',()=>{
  const pair=api('contactMaterialPair');
  for(const [a,b,want] of [['steel','brass','metal'],['metal_mixed','steel','metal'],['wood','wood','wood'],['wood','steel','composite'],
    ['wood_metal_mixed','steel','composite'],['wood_metal_mixed','wood','composite'],['leather','steel','leather'],['unknown','steel','unknown']]){
    assert.equal(pair(a,b),want);assert.equal(pair(b,a),want);
  }
});

test('Clang de madera y mixto sólo produce fragmentos secos; impulso cero no produce brillo',()=>{
  for(const material of ['wood','composite','wood_metal_mixed']){
    const fx=new WorkshopEffects({ambient:false,seed:7});
    assert.ok(fx.emit('clang',{material,at:{x:0,y:2,z:.17},impulse:.15,closingSpeed:1})>0);
    assert.ok(fx.particles.every(p=>p.kind==='wood'&&p.source===material));
  }
  for(const material of ['leather','unknown']){
    const fx=new WorkshopEffects({ambient:false});assert.equal(fx.emit('clang',{material,at:{x:0,y:2,z:.17},impulse:.15}),0);
  }
  const fx=new WorkshopEffects({ambient:false});assert.equal(fx.emit('clang',{material:'metal',at:{x:0,y:2,z:.17},impulse:0}),0);
});
