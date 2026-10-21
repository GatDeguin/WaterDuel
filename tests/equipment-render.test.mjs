import test from 'node:test';
import assert from 'node:assert/strict';
import {EQUIPMENT_MESHES,drawWeapon,drawDefense,drawMaulSupportArm} from '../public/rendering/equipment.js';
import {Renderer3D} from '../public/render3d.js';
import {DuelEngine} from '../public/engine.js';
import {getWeapon} from '../public/equipment.js';

const palette={wood:0xa16c42,edge:0x78502f,light:0xc99e67,metal:0xd4af63,steel:0xa9b9b7,leather:0x62442f,dark:0x106a62};
const weaponIds=['sword','spear','axe','maul'],defenseIds=['short','long','none','knife'];
function fighter(weapon='sword',defense='short',angle=.2){
  const mainHand={x:-.7,y:1.8,z:.17},offHand={x:-.9,y:1.9,z:-.08},length=weapon==='spear'?1.35:1.02;
  return {dir:1,equipment:{weapon,defense},pose:{mainHand,offHand,tip:{x:mainHand.x+Math.cos(angle)*length,y:mainHand.y+Math.sin(angle)*length,z:.17},
    offElbow:{x:-1.1,y:1.5,z:-.08},defenseTip:{x:offHand.x+.12,y:offHand.y+.40,z:offHand.z},
    shieldRadius:.23,shieldRadiusX:defense==='long'?.22:.23,shieldRadiusY:defense==='long'?.43:.23}};
}
function recorder(){const calls=[];return {calls,draw:(shape,model,color,material=0)=>calls.push({shape,model:Array.from(model),color,material})};}
const transform=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));

test('Cada combinación tiene geometría finita, sin escalas degeneradas ni texturas externas',()=>{
  for(const weapon of weaponIds)for(const defense of defenseIds)for(const angle of [-2.8,-.3,Math.PI/2]){
    const f=fighter(weapon,defense,angle),r=recorder();drawWeapon(r,f,palette);drawDefense(r,f,palette);
    assert.ok(r.calls.length>8,`${weapon}/${defense} must be detailed geometry`);
    for(const {shape,model,color,material} of r.calls){
      assert.ok(['sphere','cylinder','box','torus','hex',...Object.keys(EQUIPMENT_MESHES)].includes(shape),shape);
      assert.equal(model.length,16);assert.ok(model.every(Number.isFinite),`${weapon}/${defense}: finite ${shape}`);
      const a=model.slice(0,3),b=model.slice(4,7),c=model.slice(8,11);
      const determinant=a[0]*(b[1]*c[2]-b[2]*c[1])-b[0]*(a[1]*c[2]-a[2]*c[1])+c[0]*(a[1]*b[2]-a[2]*b[1]);
      assert.ok(Math.abs(determinant)>1e-10,`${weapon}/${defense}: nondegenerate ${shape}`);
      assert.ok(Number.isInteger(color)&&material>=0&&material<=18);
    }
  }
});

test('Las puntas de acero de espada, lanza y hacha coinciden con el contacto real',()=>{
  for(const weapon of ['sword','spear','axe'])for(const angle of [-2.4,.4,1.57]){
    const f=fighter(weapon,'none',angle),r=recorder();drawWeapon(r,f,palette);
    const shape={sword:'rapierBlade',spear:'spearHead',axe:'axeHead'}[weapon];
    const item=r.calls.find(call=>call.shape===shape&&call.material===16);
    assert.ok(item,`${weapon} has a distinct steel mesh`);
    const mesh=EQUIPMENT_MESHES[shape],tip=[f.pose.tip.x,f.pose.tip.y,f.pose.tip.z];
    let nearest=Infinity;
    for(let i=0;i<mesh.p.length;i+=3)nearest=Math.min(nearest,distance(transform(item.model,mesh.p.slice(i,i+3)),tip));
    assert.ok(nearest<1e-6,`${weapon} visible tip misses contact by ${nearest}`);
  }
});

test('El mazo lleva núcleo de madera y placa de golpe alineada, y nunca crea defensa secundaria',()=>{
  const f=fighter('maul','long'),r=recorder();drawWeapon(r,f,palette);
  assert.ok(r.calls.some(c=>c.shape==='box'&&c.material===0),'heavy timber core');
  const steel=r.calls.filter(c=>(c.shape==='box'||c.shape==='strikingPlate')&&c.material===16),tip=[f.pose.tip.x,f.pose.tip.y,f.pose.tip.z];
  assert.ok(steel.some(c=>distance(transform(c.model,[0,.5,0]),tip)<1e-6),'striking plate ends at the simulated contact');
  r.calls.length=0;drawDefense(r,f,palette);assert.equal(r.calls.length,0);
});

test('El antebrazo de apoyo del mazo llega al agarre real también en profundidad',()=>{
  const f=fighter('maul','none');f.pose.offShoulder={x:-1.1,y:2,z:-.11};f.pose.offElbow={x:-1,y:1.5,z:-.10};
  f.pose.offHand={x:-.65,y:1.8,z:.17};const r=recorder();drawMaulSupportArm(r,f,palette);
  const forearm=r.calls.filter(c=>c.shape==='box'&&c.material===0).at(-1);assert.ok(forearm);
  const start=transform(forearm.model,[0,-.5,0]),end=transform(forearm.model,[0,.5,0]);
  assert.ok(distance(start,Object.values(f.pose.offElbow))<1e-6);
  assert.ok(distance(end,Object.values(f.pose.offHand))<1e-6,'the wooden forearm must meet the handle in XYZ');
});

test('La defensa vacía no dibuja objetos, el cuchillo es una daga y el escudo largo no es un disco',()=>{
  const r=recorder();drawDefense(r,fighter('sword','none'),palette);assert.equal(r.calls.length,0);
  drawDefense(r,fighter('sword','knife'),palette);
  assert.ok(r.calls.some(c=>c.shape==='rapierBlade'&&c.material===16),'parrying dagger has a steel blade');
  assert.ok(!r.calls.some(c=>c.shape==='shieldLong'),'dagger has no shield panel');
  r.calls.length=0;const f=fighter('sword','long');drawDefense(r,f,palette);
  const panel=r.calls.find(c=>c.shape==='shieldLong'&&c.material===0);assert.ok(panel);
  const m=panel.model;assert.ok(Math.hypot(m[4],m[5],m[6])>Math.hypot(m[0],m[1],m[2])*1.7,'elongated timber shield');
  assert.ok(!r.calls.some(c=>c.shape==='cylinder'&&Math.abs(c.model[12]-f.pose.offHand.x)<1e-8&&Math.hypot(c.model[0],c.model[1],c.model[2])>.15),'no circular shield hidden beneath the long silhouette');
});

function fakeWebGL2(){
  const trace={buffers:0,uploads:0,draws:0,vertexData:[]};let vao;
  return new Proxy({trace,getUniformLocation:(_program,name)=>name,createBuffer:()=>{trace.buffers++;return {};},createVertexArray:()=>({}),bindVertexArray:value=>{vao=value;},
    bufferData:(_target,data)=>{trace.uploads++;trace.vertexData.push({vao,data:Array.from(data)});},
    getShaderParameter:()=>true,getProgramParameter:()=>true,drawElements:()=>trace.draws++,drawArrays:()=>trace.draws++,drawElementsInstanced:()=>trace.draws++},
  {get:(object,key)=>key in object?object[key]:typeof key==='string'&&key.startsWith('create')?()=>({}):()=>{}});
}

test('Toda la cara de impacto física del hacha y mazo cae sobre su geometría visible',()=>{
  const gl=fakeWebGL2(),render=new Renderer3D({getContext:()=>gl});
  function covers(call,point){
    const uploads=gl.trace.vertexData.filter(v=>v.vao===render.mesh[call.shape].vao),mesh=EQUIPMENT_MESHES[call.shape]??{p:uploads[0].data,ix:uploads[2].data};
    for(let i=0;i<mesh.ix.length;i+=3){
      const [a,b,c]=mesh.ix.slice(i,i+3).map(index=>transform(call.model,mesh.p.slice(index*3,index*3+3)));
      const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      if(Math.abs(cross(a,b,c))<1e-10)continue;
      const sides=[cross(a,b,point),cross(b,c,point),cross(c,a,point)];
      if(sides.every(v=>v>=-1e-7)||sides.every(v=>v<=1e-7))return true;
    }
    return false;
  }
  for(const weapon of ['axe','maul']){
    const f=fighter(weapon,'none',.3),r=recorder(),frame=drawWeapon(r,f,palette);
    for(const point of getWeapon(weapon).strikePoints){
      const p=[f.pose.tip.x+frame.y[0]*point.along+frame.x[0]*point.across,f.pose.tip.y+frame.y[1]*point.along+frame.x[1]*point.across];
      assert.ok(r.calls.some(call=>call.material===16&&covers(call,p)),`${weapon} strike ${JSON.stringify(point)} must lie on visible steel`);
    }
  }
});

test('Los equipos se integran con la marioneta y reutilizan los buffers en todos los cambios de carga',()=>{
  const gl=fakeWebGL2(),render=new Renderer3D({getContext:()=>gl}),game=new DuelEngine(),f=game.fighters[0];
  for(const key of Object.keys(EQUIPMENT_MESHES))assert.ok(render.mesh[key],`cached mesh ${key}`);
  render.depthOnly=true;const buffers=gl.trace.buffers,uploads=gl.trace.uploads;
  for(const weapon of weaponIds)for(const defense of defenseIds){
    f.equipment={weapon,defense};game.buildPose(f);render.drawPuppet(f,0,game);
  }
  assert.equal(gl.trace.buffers,buffers,'changing equipment never allocates GPU buffers');
  assert.equal(gl.trace.uploads,uploads,'opaque equipment uses prebuilt geometry');
  assert.ok(gl.trace.draws>100);
});
