import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';

const module=await import('../public/physics/head-contact.js').catch(()=>({}));
const close=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} ≠ ${b}`);
const radii={x:.428,y:.512,z:.403};
function sweep(...args){
  assert.equal(typeof module.segmentEllipsoidContact,'function','head CCD must use an XYZ ellipsoid');
  return module.segmentEllipsoidContact(...args);
}
const equation=(point,center,r)=>((point.x-center.x)/r.x)**2+((point.y-center.y)/r.y)**2+((point.z-center.z)/r.z)**2;

test('El CCD XYZ devuelve la primera entrada y el gradiente del elipsoide sin inflarlo',()=>{
  for(const scale of [1,1.16])for(const dir of [-1,1]){
    const r=Object.fromEntries(Object.entries(radii).map(([k,v])=>[k,v*scale]));
    const center={x:1.2,y:2.4,z:.025},section=Math.sqrt(1-.3**2-.4**2);
    const from={x:center.x-dir*2*r.x,y:center.y+.3*r.y,z:center.z+.4*r.z};
    const to={...from,x:center.x+dir*2*r.x},hit=sweep(from,to,center,r);
    close(hit.t,(2-section)/4);close(hit.point.x,center.x-dir*r.x*section);
    close(equation(hit.surfacePoint,center,r),1);
    const n={x:-dir*section/r.x,y:.3/r.y,z:.4/r.z},length=Math.hypot(n.x,n.y,n.z);
    for(const k of ['x','y','z'])close(hit.normal[k],n[k]/length);
    assert.equal(hit.startedInside,false);close(hit.incoming.x,dir);
  }
});

test('La sección XYZ rechaza la esquina del antiguo cilindro XY con slab Z, y conserva la tangencia',()=>{
  const center={x:0,y:0,z:0};
  assert.equal(sweep({x:-1,y:.8*radii.y,z:.8*radii.z},{x:1,y:.8*radii.y,z:.8*radii.z},center,radii),null);
  const hit=sweep({x:-1,y:.6*radii.y,z:.8*radii.z},{x:1,y:.6*radii.y,z:.8*radii.z},center,radii);
  close(hit.t,.5);close(hit.point.x,0);close(equation(hit.point,center,radii),1);
  assert.equal(sweep({x:-1,y:.60001*radii.y,z:.8*radii.z},{x:1,y:.60001*radii.y,z:.8*radii.z},center,radii),null);
});

test('Un solapamiento inicial devuelve t cero y una superficie radial XYZ exacta',()=>{
  const center={x:2,y:3,z:4},from={x:2.1,y:3.1,z:4.1};
  const hit=sweep(from,{x:3,y:4,z:5},center,radii);
  assert.equal(hit.t,0);assert.equal(hit.startedInside,true);assert.deepEqual(hit.point,from);
  close(equation(hit.surfacePoint,center,radii),1);
  const middle=sweep(center,{...center,z:center.z+1},center,radii);
  close(middle.surfacePoint.z,center.z-radii.z);close(middle.normal.z,-1);
  const still=sweep(center,center,center,radii);
  close(equation(still.surfacePoint,center,radii),1);close(still.normal.x,-1);
});

test('El barrido relativo detecta una cabeza móvil aunque la punta permanezca quieta',()=>{
  const point={x:0,y:0,z:0},center={x:0,y:0,z:0};
  const hit=sweep(point,point,center,{x:.4,y:.5,z:.3},{previousCenter:{x:1,y:0,z:0}});
  close(hit.t,.6);close(hit.center.x,.4);close(hit.normal.x,-1);close(hit.incoming.x,1);
  assert.equal(hit.startedInside,false);close(equation(hit.surfacePoint,hit.center,{x:.4,y:.5,z:.3}),1);
  // A head that crosses the stationary point and leaves must still be caught.
  const crossed=sweep(point,point,{x:-1,y:0,z:0},{x:.4,y:.5,z:.3},{previousCenter:{x:1,y:0,z:0}});
  close(crossed.t,.3);assert.equal(crossed.startedInside,false);
});

test('Trasladar punta y cabeza juntas no inventa incoming aunque exista dirección del arma',()=>{
  const from={x:0,y:0,z:0},to={x:.01,y:-.02,z:.03};
  const hit=sweep(from,to,to,radii,{previousCenter:from,forward:{x:0,y:0,z:1}});
  assert.deepEqual(hit.incoming,{x:0,y:0,z:0});assert.equal(hit.t,0);
  close(equation(hit.surfacePoint,from,radii),1);close(hit.surfacePoint.z,-radii.z);
});

test('Los datos planares conservan Z explícita por defecto y los datos inválidos se descartan',()=>{
  const hit=sweep({x:-1,y:0},{x:1,y:0},{x:0,y:0},radii);
  close(hit.point.z,.17);close(hit.center.z,.025);
  close(equation(hit.point,hit.center,radii),1);
  for(const bad of [0,-1,NaN,Infinity])assert.equal(sweep({x:-1,y:0},{x:1,y:0},{x:0,y:0},{...radii,z:bad}),null);
  assert.equal(sweep({x:-1,y:0,z:NaN},{x:1,y:0,z:0},{x:0,y:0,z:0},radii),null);
  assert.equal(sweep({x:-1,y:0,z:0},{x:1,y:0,z:0},{x:0,y:0,z:Infinity},radii),null);
});

function strike(g,attacker,defender,trajectory){
  defender.previousHead={...defender.pose.head};
  attacker.lunge=.8;attacker.previousTip={x:trajectory.x-attacker.dir*.8,y:trajectory.y,z:trajectory.z};
  attacker.pose={...attacker.pose,tip:{x:trajectory.x+attacker.dir*.8,y:trajectory.y,z:trajectory.z}};
  g.detectHits();
}

test('La misma estocada rasante perfora en neutral y falla al esquivar con el cuello físico Z',()=>{
  for(const slot of [1,2])for(const boss of [false,true]){
    if(boss&&slot===2)continue;
    const make=()=>{const g=new DuelEngine();g.setDifficulty(boss?'boss':'normal');g.phase='fight';return g;};
    const neutral=make(),a=neutral.fighters[slot-1],b=neutral.fighters[2-slot];
    for(let i=0;i<120;i++)neutral.updateFighter(b,STEP);
    const trajectory={x:b.pose.head.x,y:b.pose.head.y+(BALLOON_RADII.y+.006)*b.balloonSize*.75,z:.17};
    strike(neutral,a,b,trajectory);assert.equal(b.globIntact,false,'positive control must physically puncture');
    const dodged=make(),c=dodged.fighters[slot-1],d=dodged.fighters[2-slot];
    for(let i=0;i<120;i++)dodged.updateFighter(d,STEP);
    d.controller.headZ=-1;for(let i=0;i<120;i++)dodged.updateFighter(d,STEP);
    assert.ok(d.pose.head.z<-.12,'actual neck must move collider out of the sword plane');
    strike(dodged,c,d,trajectory);assert.equal(d.globIntact,true,'same grazing trajectory must miss the displaced ellipsoid');
    assert.deepEqual(dodged.scores,[0,0]);
  }
});

test('La arista actual usa incoming relativo XYZ: traslación común cero y cabeza que entra en Z',()=>{
  const section=Math.sqrt(1-(.145/radii.z)**2);
  for(const common of [true,false]){
    const events=[],g=new DuelEngine((name,data)=>{if(name==='burst')events.push(data);});
    g.setLoadout(1,{weapon:'maul'});g.setLoadout(2,{defense:'none'});g.phase='fight';
    const [a,b]=g.fighters;
    const translation=common?{x:.01,y:-.015,z:.02}:{x:0,y:0,z:0};
    a.lunge=.8;a.previousWeaponDirection={x:1,y:0};
    a.pose={...a.pose,mainHand:{x:-1.08,y:.7,z:.17},tip:{x:0,y:.7,z:.17}};
    a.previousTip={x:-translation.x,y:.7-translation.y,z:.17-translation.z};
    b.pose={...b.pose,head:{x:.427*section,y:.634375,z:.025}};
    const delta=common?translation:{x:0,y:0,z:.01};
    b.previousHead={x:b.pose.head.x-delta.x,y:b.pose.head.y-delta.y,z:b.pose.head.z-delta.z};
    b.headVelocity={vx:delta.x/STEP,vy:delta.y/STEP,vz:delta.z/STEP};
    let incoming;const puncture=b.membrane.puncture.bind(b.membrane);
    b.membrane.puncture=args=>{incoming={...args.incoming};return puncture(args);};
    g.detectHits();assert.equal(b.globIntact,false);assert.equal(events.length,1);
    const expected=common?{x:0,y:0,z:0}:{x:0,y:0,z:-1};
    for(const k of ['x','y','z'])close(incoming[k],expected[k]);
    close(events[0].relativeSpeed,common?0:.01/STEP);
    for(const [axis,v] of [['x','vx'],['y','vy'],['z','vz']])close(events[0].pointVelocity[v],translation[axis]/STEP);
  }
});
