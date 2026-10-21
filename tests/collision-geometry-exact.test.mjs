import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {getWeapon} from '../public/equipment.js';
import {fluidSolidColliders,resolveLiquidSolid} from '../public/physics/fluid-solids.js';
import {fluidSolidColliders as beforeColliders,resolveLiquidSolid as beforeResolve} from '../audit/fluid-solids-gpu-burst-before.js';

const temporary=new URL(`../public/physics/.geometry-exact-baseline-${process.pid}.mjs`,import.meta.url);
await fs.writeFile(temporary,await fs.readFile(new URL('../audit/articulated-rig-gpu-burst-before.js',import.meta.url),'utf8'));
const {ArticulatedRig:Baseline}=await import(temporary.href);
const copy=(Type,r)=>Object.assign(new Type(),Object.fromEntries(Object.entries(r).filter(([key])=>key!=='apron').map(([key,value])=>[key,structuredClone(value)])));
const solid=panel=>({center:{...panel.center,z:panel.z},axes:[...panel.axes.map(v=>({...v,z:0})),{x:0,y:0,z:1}],
  half:[...panel.axes.map(axis=>Math.max(...panel.vertices.map(p=>Math.abs((p.x-panel.center.x)*axis.x+(p.y-panel.center.y)*axis.y)))),panel.depth/2],
  body:panel.body,key:panel.key,...(panel.material?{material:panel.material}:{})});
test.after(async()=>fs.unlink(temporary));

function* fixtures(){
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const weapon of ['sword','spear','axe','maul'])for(const defense of ['none','long','knife']){
    const r=new Baseline({dir,scale}),w=getWeapon({weapon});r.equipment={weapon,defense};r.twoHanded=!!w.twoHanded;r.gripOffset=w.gripOffset??0;
    r.defenseLength=defense==='knife'?.42:0;r.defenseRestAngle=.31;r.swordLength=1.69;r.previousSwordLength=1.03;
    r.neckLateral.angle=.17;r.depth.offHand=.045;r.depth.offElbow=-.031;
    r.previousQ=r.q.slice();
    for(let i=0;i<r.q.length;i++){
      const [min,max]=r.limits[i];r.previousQ[i]=Math.max(min,Math.min(max,r.q[i]+.21*Math.sin(i*1.7+dir)));
      r.q[i]=Math.max(min,Math.min(max,r.q[i]+.27*Math.cos(i*1.3-scale)));
    }
    yield r;
  }
}

test('Cada consulta seleccionada y completa conserva exactamente el baseline y rigs temporales independientes',()=>{
  for(const before of fixtures()){
    const current=copy(ArticulatedRig,before);
    for(const t of [0,.13,.5,.88,1]){
      const expected=before.collisionPanelsAt(t),oracle=copy(Baseline,before);
      oracle.q=Float64Array.from(before.q,(value,i)=>before.previousQ[i]*(1-t)+value*t);
      oracle.swordLength=before.previousSwordLength*(1-t)+before.swordLength*t;
      assert.deepEqual(expected,oracle.collisionPanels(),'oráculo realmente configurado en q(t), no historial compartido');
      assert.deepEqual(current.collisionGeometryAt(t),expected);
      for(const panel of expected)assert.deepEqual(current.collisionGeometryAt(t,panel.key),[panel]);
      assert.deepEqual(current.collisionGeometryAt(t,'absent'),[]);
    }
  }
});

test('Los OBB directos conservan las proyecciones originales de cada vértice sin redondeo nominal',()=>{
  assert.equal(typeof ArticulatedRig.prototype.collisionSolidsAt,'function');
  for(const before of fixtures()){
    const current=copy(ArticulatedRig,before);
    for(const t of [0,.13,.5,.88,1]){
      const expected=before.collisionPanelsAt(t).map(solid);
      assert.deepEqual(current.collisionSolidsAt(t),expected);
      for(const shape of expected)assert.deepEqual(current.collisionSolidsAt(t,shape.key),[shape]);
    }
  }
});

test('El CCD completo conserva sólidos, cotas, velocidad y parcelas bit a bit frente al corte congelado',()=>{
  const shape=s=>({center:s.center,axes:s.axes,half:s.half});
  for(const before of fixtures()){
    const current=copy(ArticulatedRig,before),old=beforeColliders([{rig:before}]),now=fluidSolidColliders([{rig:current}]);
    assert.equal(now.length,old.length);
    for(let i=0;i<old.length;i++){
      assert.deepEqual(shape(now[i]),shape(old[i]));assert.deepEqual(now[i].bounds,old[i].bounds);assert.deepEqual(now[i].motion,old[i].motion);
      for(const t of [0,.17,.57,1])assert.deepEqual(shape(now[i].motionAt(t)),shape(old[i].motionAt(t)));
      const from={...old[i].motionAt(.5).center},p={...from,x:from.x+.013,y:from.y-.008,vx:1.56,vy:-.96,vz:0,volume:.001};
      const a={...p},b={...p};beforeResolve(a,from,.002,1/120,old);resolveLiquidSolid(b,from,.002,1/120,now);assert.deepEqual(b,a);
      assert.deepEqual(now[i].velocityAt(from),old[i].velocityAt(from));
    }
  }
});

test('El índice de profundidad conserva bordes, el bit32 y los recorridos completos de respaldo',()=>{
  for(const count of [32,33]){
    const panels=Array.from({length:count},(_,i)=>({body:'surface',key:`surface${i}`,center:{x:0,y:1},z:i*.5-8,depth:.10,
      axes:[{x:1,y:0},{x:0,y:1}],vertices:[{x:-.3,y:1.003},{x:-.3,y:.997},{x:.3,y:.997},{x:.3,y:1.003}]}));
    const q=new Float64Array(14),rig={q,previousQ:q,swordLength:1,previousSwordLength:1,scale:1,
      pose:()=>({bodyFrames:{}}),collisionPanels:()=>panels,collisionPanelsAt:()=>panels,pointVelocity:()=>({x:0,y:0})};
    const old=beforeColliders([{rig}]),now=fluidSolidColliders([{rig}]);
    for(const i of [0,15,count-1])for(const zOffset of [0,.075,.075+Number.EPSILON,.075-Number.EPSILON]){
      const from={x:0,y:1.2,z:panels[i].z+zOffset},p={...from,y:.8,vx:0,vy:-4,vz:0,volume:.001},a={...p},b={...p};
      beforeResolve(a,from,.025,.1,old);resolveLiquidSolid(b,from,.025,.1,now);assert.deepEqual(b,a);
    }
    const from={x:0,y:1.2,z:-50},p={x:0,y:.8,z:50,vx:0,vy:-4,vz:1000,volume:.001},a={...p},b={...p};
    beforeResolve(a,from,.025,.1,old);resolveLiquidSolid(b,from,.025,.1,now);assert.deepEqual(b,a);
  }
});
