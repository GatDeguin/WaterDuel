import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FluidVolume} from '../public/physics/fluid.js';
const source=readFileSync(new URL('../benchmarks/baselines/fluid-pre-1.4.mjs',import.meta.url),'utf8');
const before=await import('data:text/javascript;base64,'+Buffer.from(source.replace("'./dimensions.js'",JSON.stringify(new URL('../public/physics/dimensions.js',import.meta.url).href))).toString('base64'));
const head={x:0,y:2.4,z:.025},impact={x:-.42,y:2.4,z:.025};
test('El hash numérico y los buffers reutilizados conservan cada parcel y su velocidad bit a bit',()=>{
  for(const count of [200,260])for(const offset of [0,5000]){
    const a=new before.FluidVolume(1,count),b=new FluidVolume(1,count);
    for(const f of [a,b]){
      f.keepContained(head,1/120,.03,0);f.release({head,impact,attackDir:1,thrust:.8});
      for(const p of f.particles){p.x+=offset;p.z-=offset;}
    }
    for(let step=0;step<120;step++){
      const options={floor:.3245,bounds:offset?10000:3.7};a.integrate(1/120,options);b.integrate(1/120,options);
      assert.deepEqual(b.particles,a.particles,`count ${count}, offset ${offset}, step ${step}`);
    }
    assert.deepEqual(b.stats(),a.stats());
  }
});
test('El cambio de conjunto libre y retenido no reutiliza vecinos de un paso anterior',()=>{
  const a=new before.FluidVolume(2,200),b=new FluidVolume(2,200);
  for(const f of [a,b]){f.keepContained(head,1/120);f.beginLeak({head,impact});}
  for(let i=0;i<180;i++){
    const options={head,apertureArea:.025,pressure:.5,containmentCapacity:i<45?Infinity:0};
    a.advanceLeak(1/120,options);b.advanceLeak(1/120,options);
    assert.deepEqual(b.particles,a.particles,`step ${i}`);assert.deepEqual(b.leakState,a.leakState);
  }
});
