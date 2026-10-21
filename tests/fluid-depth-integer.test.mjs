import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createDetachedFluidColliders} from '../public/physics/detached-fluid-colliders.js';

const moduleSource=await fs.readFile(new URL('../public/physics/fluid-solids.js',import.meta.url),'utf8');
const detachedImport="import {createDetachedFluidColliders} from './detached-fluid-colliders.js';";
assert.ok(moduleSource.includes(detachedImport));
// Preserve the bounded VM execution that detects unsafe-integer loops, while
// supplying the real ESM dependency rather than parsing an import as a script.
const source=moduleSource.replace(detachedImport,'').replace(/^export /gm,'');
function evaluate(code){
  const context=vm.createContext({createDetachedFluidColliders});
  new vm.Script(source+'\n'+code).runInContext(context,{timeout:100});
  return context.result;
}

test('La búsqueda Z con celdas finitas fuera del entero seguro termina usando recorrido completo',()=>{
  const result=evaluate(`
    const solids=fluidSolidColliders([]);
    globalThis.result=[2**50,-(2**50)].map(z=>{
      const p={x:0,y:1,z,vx:0,vy:0,vz:0,volume:.001};
      const fallback=depthCandidates(solids,p,p,.001)===null;
      resolveLiquidSolid(p,{x:0,y:1,z},.001,1/120,solids);
      return fallback&&p.z===z&&p.volume===.001;
    });
  `);
  assert.deepEqual(Array.from(result),[true,true]);
});

test('Construir el índice Z con celdas finitas no seguras conserva los sólidos sin indexarlos',()=>{
  const result=evaluate(`
    globalThis.result=[2**50,-(2**50)].map(z=>{
      const panel={key:'test',body:'pelvis',center:{x:0,y:1},z,depth:.02,
        axes:[{x:1,y:0},{x:0,y:1}],
        vertices:[{x:-.1,y:.9},{x:.1,y:.9},{x:.1,y:1.1},{x:-.1,y:1.1}]};
      const rig={q:new Float64Array(14),swordLength:1,previousSwordLength:1,
        collisionPanels:()=>[panel],collisionPanelsAt:()=>[panel],
        pose:()=>({}),pointVelocity:()=>({x:0,y:0})};
      const solids=fluidSolidColliders([{rig}]);
      return solids.length===1&&!depthIndexes.has(solids)&&solids[0].center.z===z;
    });
  `);
  assert.deepEqual(Array.from(result),[true,true]);
});
