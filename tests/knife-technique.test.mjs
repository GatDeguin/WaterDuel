import test from 'node:test';
import assert from 'node:assert/strict';

const knife=await import('../public/knife-technique.js').catch(()=>null);
const near=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const tensor=(normal=1,tangent=1,cross=0)=>({normal,tangent,cross});
const base=extra=>({velocityA:{x:3,y:2},velocityB:{x:0,y:0},normal:{x:1,y:0},
  inertiaA:tensor(),inertiaB:tensor(),maxImpulse:.45,...extra});
const solve=extra=>{
  assert.equal(typeof knife?.solveDefensiveImpulse,'function','falta el helper puro de técnica defensiva');
  return knife.solveDefensiveImpulse(base(extra));
};

test('La técnica normal conserva la punta histórica y la inversa cambia la hoja, sin mutar la mano',()=>{
  assert.equal(typeof knife?.knifeTip,'function','falta la geometría compartida del cuchillo');
  const hand=Object.freeze({x:-1.3,y:2.1,z:.10});
  for(const dir of [-1,1]){
    const normal=knife.knifeTip(hand,{dir}),reverse=knife.knifeTip(hand,{dir,grip:'reverse'});
    assert.deepEqual(normal,{x:hand.x+dir*.42*.45,y:hand.y+.42*Math.sqrt(1-.45**2),z:.17});
    near(reverse.x-hand.x,normal.x-hand.x);near(reverse.y-hand.y,-(normal.y-hand.y));
    near(Math.hypot(reverse.x-hand.x,reverse.y-hand.y),.42);assert.equal(reverse.z,.17);
    const scale=knife.knifeTip(hand,{dir,length:.55,grip:'reverse',tipZ:.22});
    near(Math.hypot(scale.x-hand.x,scale.y-hand.y),.55);assert.equal(scale.z,.22);
  }
  assert.equal(knife.normalizeKnifeGrip('reverse'),'reverse');
  for(const value of [undefined,null,'normal','invalid'])assert.equal(knife.normalizeKnifeGrip(value),'normal');
});

test('La palma conserva orientación relativa al cuchillo invertido y ambos jugadores se espejan',()=>{
  assert.equal(typeof knife?.knifeHandDirection,'function');
  const hand={x:0,y:2,z:.10},tip={x:.2,y:2.4,z:.17};
  assert.deepEqual(knife.knifeHandDirection(hand,tip),tip);
  assert.deepEqual(knife.knifeHandDirection(hand,tip,'reverse'),{x:-.2,y:1.6,z:.03});
  for(const grip of ['normal','reverse']){
    const left=knife.knifeTip({x:-1,y:2,z:.10},{dir:1,grip}),right=knife.knifeTip({x:1,y:2,z:.10},{dir:-1,grip});
    near(left.x,-right.x);near(left.y,right.y);near(left.z,right.z);
  }
});

test('La base real de la hoja convierte normales locales a mundo en XY y profundidad',()=>{
  assert.equal(typeof knife?.knifeWorldNormal,'function');
  const hand={x:0,y:0,z:0},tip={x:0,y:0,z:.42};
  assert.deepEqual(knife.knifeWorldNormal(hand,tip,{x:1,y:0,z:0}),{x:0,y:0,z:1});
  const tilted={x:.18,y:.34,z:.11},frame=knife.knifeFrame(hand,tilted);
  for(const axis of [frame.u,frame.v,frame.w])near(Math.hypot(axis.x,axis.y,axis.z),1);
  near(frame.u.x*frame.v.x+frame.u.y*frame.v.y+frame.u.z*frame.v.z,0);
  const n=knife.knifeWorldNormal(hand,tilted,{x:0,y:1,z:0});assert.deepEqual(n,frame.v);
  assert.equal(knife.knifeFrame(hand,hand),null);assert.equal(knife.knifeWorldNormal(hand,hand,{x:1,y:0}),null);
});

test('La parada devuelve un único par de impulsos iguales y opuestos, con fricción limitada',()=>{
  const r=solve();
  assert.ok(r.normalImpulse>0&&r.normalImpulse<=.45);assert.ok(r.tangentImpulse>0);
  near(r.impulseA.x+r.impulseB.x,0);near(r.impulseA.y+r.impulseB.y,0);
  assert.ok(Math.abs(r.tangentImpulse)<=.22*r.normalImpulse+1e-12);
  assert.ok(r.impulseA.x<0&&r.impulseA.y<0);assert.ok(r.dissipatedWork>=0);
  assert.equal(r.state,'sliding');
});

test('El signo tangencial nace de la velocidad relativa y se espeja con el contacto',()=>{
  const right=solve({normal:{x:1,y:0},velocityA:{x:3,y:1},velocityB:{x:0,y:0}});
  const left=solve({normal:{x:-1,y:0},velocityA:{x:-3,y:1},velocityB:{x:0,y:0}});
  near(left.impulseA.x,-right.impulseA.x);near(left.impulseA.y,right.impulseA.y);
  const movingGuard=solve({velocityA:{x:2,y:0},velocityB:{x:0,y:3}});
  assert.ok(movingGuard.impulseA.y>0,'la mano defensiva puede arrastrar la hoja por su velocidad real');
  assert.ok(movingGuard.impulseB.y<0,'el defensor recibe la reacción contraria');
});

test('Separación, impulso máximo cero y normales puramente Z no fabrican respuesta planar',()=>{
  for(const options of [
    {velocityA:{x:-2,y:10}}, {velocityA:{x:0,y:10}}, {maxImpulse:0},
    {normal:{x:0,y:0,z:1}}, {normal:{x:NaN,y:1}}, {velocityA:{x:Infinity,y:0}},
    {inertiaA:tensor(1,1,4)}
  ]){
    const result=solve(options);
    near(result.normalImpulse,0);near(result.tangentImpulse,0);
    assert.ok([result.impulseA.x,result.impulseA.y,result.impulseB.x,result.impulseB.y,result.dissipatedWork].every(Number.isFinite));
  }
});

test('Sin tensor tangencial completo se conserva la respuesta normal sin inventar fricción',()=>{
  const r=solve({inertiaA:{normal:1},inertiaB:{normal:1},maxImpulse:4,velocityA:{x:1,y:2}});
  near(r.normalImpulse,.55);near(r.tangentImpulse,0);near(r.impulseA.x,-.55);
});

test('El sistema acoplado no añade energía cinética en una muestra determinista de tensores positivos',()=>{
  let seed=76321;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<160;i++){
    const positive=()=>{const n=.05+random()*4,c=(random()-.5)*1.5;return tensor(n,c*c/n+.05+random()*3,c);};
    const a=positive(),b=positive(),angle=(random()-.5)*6.2,n={x:Math.cos(angle),y:Math.sin(angle)},t={x:-n.y,y:n.x};
    const vn=.01+random()*5,vt=(random()-.5)*10;
    const velocityA={x:n.x*vn+t.x*vt,y:n.y*vn+t.y*vt};
    const r=solve({inertiaA:a,inertiaB:b,normal:n,velocityA,maxImpulse:random()*.7});
    const jn=r.normalImpulse,jt=r.tangentImpulse;
    const work=vn*jn+vt*jt,quadratic=(a.normal+b.normal)*jn**2+2*(a.cross+b.cross)*jn*jt+(a.tangent+b.tangent)*jt**2;
    assert.ok(-work+.5*quadratic<=1e-9,'el par de impulsos debe ser pasivo en la misma métrica de masa');
    assert.ok(r.dissipatedWork>=0&&Number.isFinite(r.dissipatedWork));
    near(r.impulseA.x+r.impulseB.x,0);near(r.impulseA.y+r.impulseB.y,0);
  }
});
