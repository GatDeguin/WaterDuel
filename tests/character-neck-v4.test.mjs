import test from 'node:test';
import assert from 'node:assert/strict';
import {physicalNeckMount} from '../public/rendering/character-neck.js';
import {Renderer3D} from '../public/render3d.js';
import {DuelEngine} from '../public/engine.js';
test('Montura del globo sigue el eje físico del cuello al inclinarse o caer',()=>{
  for(const direction of [[0,1,0],[1,0,0],[0,-1,0],[.6,.4,.3]]){
    const n=Math.hypot(...direction),u=direction.map(v=>v/n),shoulder={x:0,y:1,z:.025};
    const head={x:shoulder.x+u[0]*.56,y:shoulder.y+u[1]*.56,z:shoulder.z+u[2]*.56},p=physicalNeckMount({shoulder,head},1);
    const v=[p.x-shoulder.x,p.y-shoulder.y,p.z-shoulder.z];
    assert.ok(Math.abs(Math.hypot(...v)-.16)<1e-10);
    assert.ok(Math.abs(Math.hypot(head.x-p.x,head.y-p.y,head.z-p.z)-.4)<1e-10);
    assert.ok(v.every((value,i)=>Math.abs(value-u[i]*.16)<1e-10));
  }
});
test('Montura evita inversión si tamaño del globo excede su soporte y posee el resultado',()=>{
  const pose={shoulder:{x:0,y:0,z:0},head:{x:0,y:.2,z:0}},before=structuredClone(pose),point=physicalNeckMount(pose,2);
  assert.ok(point.y>0&&point.y<.2);point.y=3;assert.deepEqual(pose,before);
});

test('Cuello procedural v4 mantiene barra y ambos aros sobre el eje conseguido, sin mutar pose',()=>{
  const fighter=new DuelEngine().fighters[0],pivot={x:.3,y:1.2,z:.025};
  for(const direction of [[1,0,0],[0,-1,0],[.6,.4,.3]]){
    const length=Math.hypot(...direction),axis=direction.map(value=>value/length);
    const head={x:pivot.x+axis[0]*.56,y:pivot.y+axis[1]*.56,z:pivot.z+axis[2]*.56};
    const f={...fighter,balloonSize:1,pose:{...fighter.pose,neckPivot:{...pivot},head}},before=structuredClone(f.pose);
    const renderer=Object.create(Renderer3D.prototype),calls=[];
    renderer.draw=(shape,matrix)=>calls.push({shape,matrix:Array.from(matrix)});
    renderer.drawProceduralPuppet(f,0,{edge:0x123456,metal:0xabcdef},new Set(['neck']));
    assert.equal(calls.length,3,'bar and both authored rings must remain present');
    for(const {shape,matrix:m} of calls){
      assert.equal(shape,'cylinder');assert.ok(m.every(Number.isFinite));
      const v=[m[12]-pivot.x,m[13]-pivot.y,m[14]-pivot.z],along=v.reduce((sum,value,i)=>sum+value*axis[i],0);
      const error=Math.hypot(...v.map((value,i)=>value-along*axis[i]));
      assert.ok(error<2e-6,`neck piece is ${error} m off the achieved axis ${direction}`);
      assert.ok(along>=-2e-6&&along<=.16+2e-6,'centers remain between pivot and physical mount');
      const size=Math.hypot(m[4],m[5],m[6]),alignment=(m[4]*axis[0]+m[5]*axis[1]+m[6]*axis[2])/size;
      assert.ok(Math.abs(alignment-1)<2e-6,'local cylinder Y follows the full achieved 3D neck axis');
    }
    assert.deepEqual(f.pose,before);
  }
});
