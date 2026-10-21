import test from 'node:test';
import assert from 'node:assert/strict';

const api=await import('../public/rendering/duel-camera.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const camera=options=>{assert.equal(typeof api.duelCamera,'function');return api.duelCamera(options);};
const near=(a,b,epsilon=1e-9)=>assert.ok(Math.abs(a-b)<epsilon,`${a} ≠ ${b}`);
const difference=(a,b)=>Math.max(...a.eye.map((v,i)=>Math.abs(v-b.eye[i])),...a.target.map((v,i)=>Math.abs(v-b.target[i])),Math.abs(a.fov-b.fov));
const base=(aspect=16/9)=>camera({phase:'fight',aspect});
function projected(c,p,aspect){
  const unit=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const forward=unit(c.target.map((x,i)=>x-c.eye[i])),right=unit(cross(forward,[0,1,0])),up=cross(right,forward),v=p.map((x,i)=>x-c.eye[i]),depth=dot(v,forward),half=Math.tan(c.fov/2)*depth;
  return {x:dot(v,right)/(half*aspect),y:dot(v,up)/half,depth};
}

test('Combate mantiene el frontal 42mm más próximo para cualquier reloj, ronda o replay',()=>{
  const expected={fov:.473115634607783,eye:[.09693878144,1.9-.025031*(10.4+.07254123688),10.4],target:[.01055110991,1.9,-.07254123688]};
  for(const clock of [0,1,30,10000])for(const replay of [false,true]){
    const c=camera({phase:'fight',clock,phaseClock:clock,round:5,replay,aspect:16/9});
    assert.deepEqual(c.eye,expected.eye);assert.deepEqual(c.target,expected.target);assert.equal(c.fov,expected.fov);assert.equal(c.detail,false);assert.equal(c.motionWeight,0);
  }
});

test('Ready introduce movimiento lento mínimo; countdown converge antes del combate y sin corte inicial',()=>{
  assert.ok(camera({phase:'ready',clock:0,aspect:16/9}).eye[2]>base().eye[2]+1,'vista del taller antes de acercar el duelo');
  const ready=camera({phase:'ready',clock:18.75,aspect:16/9});assert.ok(difference(ready,base())>.01);
  assert.equal(difference(ready,camera({phase:'countdown',clock:18.75,phaseClock:0,round:1,aspect:16/9})),0);
  for(const phaseClock of [2.4,3,3.2])assert.equal(difference(camera({phase:'countdown',clock:18.75+phaseClock,phaseClock,round:1,aspect:16/9}),base()),0);
  const a=camera({phase:'ready',clock:20,aspect:16/9}),b=camera({phase:'ready',clock:20+1/120,aspect:16/9});assert.ok(difference(a,b)<.001);
});

test('Pinchazo mantiene encuadre .4s, orbita/acerca y recupera combate antes del puente de ronda',()=>{
  for(const phaseClock of [0,.1,.4])assert.equal(difference(camera({phase:'burst',phaseClock,round:2,aspect:16/9}),base()),0);
  const peak=camera({phase:'burst',phaseClock:1.7,round:2,aspect:16/9});assert.ok(peak.eye[2]<base().eye[2]-.1);assert.ok(Math.abs(peak.eye[0]-base().eye[0])>.5);
  for(const phaseClock of [2.35,2.4,2.6])assert.equal(difference(camera({phase:'burst',phaseClock,round:2,aspect:16/9}),base()),0);
  for(const phaseClock of [3.25,3.3])assert.equal(difference(camera({phase:'burst',phaseClock,clock:80,round:2,aspect:16/9}),camera({phase:'ready',clock:80,aspect:16/9})),0);
  const next=camera({phase:'countdown',phaseClock:0,clock:80,round:3,aspect:16/9});assert.equal(difference(next,camera({phase:'burst',phaseClock:3.25,clock:80,round:2,aspect:16/9})),0);
  const presentation=camera({phase:'countdown',phaseClock:1.2,clock:81.2,round:3,aspect:16/9});assert.ok(difference(presentation,base())>.01);
  assert.equal(difference(camera({phase:'countdown',phaseClock:2.4,clock:82.4,round:3,aspect:16/9}),base()),0);
});

test('Bordes temporales y cambio casi cuadrado son continuos, sin aceleración brusca de fase',()=>{
  const epsilon=1e-5;
  for(const phase of ['burst','countdown'])for(const t of [0,.4,1.2,2.4,3.25]){
    const a=camera({phase,phaseClock:t,clock:40+t,round:2,aspect:16/9}),b=camera({phase,phaseClock:t+epsilon,clock:40+t+epsilon,round:2,aspect:16/9});
    assert.ok(difference(a,b)<epsilon*1.3,`${phase} ${t}: movimiento suave menor de 1.3 unidades/s`);
  }
  const a=camera({phase:'ready',clock:7,aspect:734/700}),b=camera({phase:'ready',clock:7,aspect:736/700});assert.ok(difference(a,b)<.06);
});

test('La animación preserva margen de cabezas y pies del sobre compartido en todos los aspectos',()=>{
  for(const aspect of [320/440,390/440,734/700,1120/690,16/9,2.4])for(const phase of ['ready','countdown','burst','matchover'])for(let phaseClock=0;phaseClock<=3.3;phaseClock+=.11){
    const c=camera({phase,phaseClock,clock:10+phaseClock,round:2,aspect});
    for(const x of [-3.7,3.7])for(const y of [.3245,3.8])for(const z of [-.6,.6]){
      const p=projected(c,[x,y,z],aspect);assert.ok(p.depth>0&&Math.abs(p.x)<.94&&Math.abs(p.y)<.86,`${aspect} ${phase} ${phaseClock}: ${JSON.stringify(p)}`);
    }
  }
});

test('Movimiento reducido elimina la animación; detalle sigue reservado fuera del combate y countdown',()=>{
  for(const phase of ['ready','countdown','burst','matchover'])assert.equal(difference(camera({phase,clock:8,phaseClock:1,round:2,reducedMotion:true,aspect:16/9}),base()),0);
  const detail=camera({phase:'ready',clock:8,cameraMode:'detail',aspect:16/9});assert.equal(detail.detail,true);near(detail.fov,38*Math.PI/180);assert.equal(detail.motionWeight,0);
  for(const phase of ['fight','countdown'])assert.equal(camera({phase,phaseClock:3,cameraMode:'detail',aspect:16/9}).detail,false);
  assert.equal(camera({phase:'fight',cameraMode:'detail',replay:true,aspect:16/9}).detail,true,'replay permits deliberate inspection');
});

test('Mismo snapshot da el mismo recorrido sin historial; entradas ausentes o inválidas son finitas',()=>{
  const snapshot={phase:'burst',phaseClock:1.1,clock:20,round:2,replay:true,aspect:16/9};
  const a=camera(snapshot);camera({phase:'ready',clock:8000,aspect:.5});assert.deepEqual(camera(snapshot),a);assert.deepEqual(snapshot,{phase:'burst',phaseClock:1.1,clock:20,round:2,replay:true,aspect:16/9});
  for(const aspect of [undefined,NaN,0,-1,Infinity]){const c=camera({phase:'ready',clock:NaN,phaseClock:Infinity,aspect});assert.ok([...c.eye,...c.target,c.fov].every(Number.isFinite));}
});

test('Un empate de primera ronda conserva continuidad al reiniciar countdown sin incrementar round',()=>{
  const options={clock:40,round:1,aspect:16/9};
  const resolved=camera({...options,phase:'burst',phaseClock:3.25}),next=camera({...options,phase:'countdown',phaseClock:0});
  assert.equal(difference(resolved,next),0);
  assert.equal(difference(resolved,camera({...options,phase:'matchover',phaseClock:3.25})),0);
});
