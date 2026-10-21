import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../public/engine.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} ≠ ${expected}`);
function contact(...args){
  assert.equal(typeof engine.segmentEllipseContact,'function');
  return engine.segmentEllipseContact(...args);
}

test('El barrido devuelve la primera entrada, normal exterior y Z interpolada en ambas direcciones y escalas',()=>{
  for(const scale of [1,1.16])for(const dir of [-1,1]){
    const rx=.428*scale,ry=.512*scale;
    const hit=contact({x:-dir*.8*scale,y:0,z:.1},{x:dir*.8*scale,y:0,z:.3},0,0,rx,ry);
    close(hit.t,(.8-.428)/1.6);close(hit.point.x,-dir*rx);close(hit.point.y,0);
    close(hit.point.z,.1+.2*hit.t);close(hit.normal.x,-dir);close(hit.normal.y,0);
    assert.equal(hit.startedInside,false);assert.equal(Math.sign(hit.incoming.x),dir);
    assert.equal(engine.sweptEllipse({x:-1,y:0},{x:1,y:0},0,0,rx,ry),true);
  }
});

test('El contacto tangente pertenece al segmento y un barrido exterior no produce impacto',()=>{
  const tangent=contact({x:-1,y:.5},{x:1,y:.5},0,0,.4,.5);
  close(tangent.t,.5);close(tangent.point.x,0);close(tangent.normal.y,1);
  assert.equal(contact({x:-1,y:.5001},{x:1,y:.5001},0,0,.4,.5),null);
  assert.equal(contact({x:-2,y:0},{x:-1,y:0},0,0,.4,.5),null);
  assert.equal(contact({x:1,y:0},{x:1,y:0},0,0,.4,.5),null);
});

test('Si el segmento comienza dentro se resuelve t=0 y los efectos usan una superficie radial explícita',()=>{
  const inside=contact({x:.1,y:0,z:.17},{x:1,y:0,z:.17},0,0,.4,.5);
  assert.equal(inside.startedInside,true);assert.equal(inside.t,0);close(inside.point.x,.1);
  close(inside.surfacePoint.x,.4);close(inside.surfacePoint.y,0);close(inside.surfacePoint.z,.17);
  const center=contact({x:0,y:0},{x:1,y:0},0,0,.4,.5);
  close(center.surfacePoint.x,-.4);close(center.normal.x,-1);
  const still=contact({x:0,y:0},{x:0,y:0},0,0,.4,.5);
  assert.ok(Number.isFinite(still.normal.x)&&Number.isFinite(still.normal.y));
});

test('El impacto registrado por el duelo queda del lado de entrada y dirige la liberación hacia ese lado',()=>{
  for(const slot of [1,2])for(const boss of [false,true]){
    if(boss&&slot===2)continue;
    const g=new engine.DuelEngine();g.setDifficulty(boss?'boss':'normal');g.phase='fight';
    const attacker=g.fighters[slot-1],defender=g.fighters[2-slot],h=defender.pose.head;
    const scale=defender.balloonSize;
    attacker.lunge=.8;attacker.previousTip={x:h.x-attacker.dir*.8*scale,y:h.y,z:.17};
    attacker.pose={...attacker.pose,tip:{x:h.x+attacker.dir*.8*scale,y:h.y,z:.17}};
    g.detectHits();
    assert.equal(defender.globIntact,false);
    const section=Math.sqrt(1-((.17-h.z)/((BALLOON_RADII.z+.006)*scale))**2);
    close(defender.fluid.impact.x,h.x-attacker.dir*(BALLOON_RADII.x+.006)*scale*section);
    close(defender.fluid.impact.y,h.y);close(defender.fluid.impact.z,.17);
    assert.equal(Math.sign(defender.fluid.releaseNormal.x),-attacker.dir);
  }
});

test('El elipsoide XYZ descarta una punta situada fuera de la profundidad del globo',()=>{
  const g=new engine.DuelEngine();g.phase='fight';
  const [a,b]=g.fighters,h=b.pose.head;
  a.lunge=.8;a.previousTip={x:h.x-.8,y:h.y,z:1.5};
  a.pose={...a.pose,tip:{x:h.x+.8,y:h.y,z:1.5}};
  g.detectHits();assert.equal(b.globIntact,true);assert.deepEqual(g.scores,[0,0]);
});

test('Una defensa situada detrás de la cabeza no anula un contacto anterior con el globo',()=>{
  const g=new engine.DuelEngine();g.phase='fight';
  const [a,b]=g.fighters;
  a.lunge=.8;a.previousTip={x:0,y:0};a.pose={...a.pose,tip:{x:2,y:0}};
  b.guard=true;b.pose={...b.pose,head:{x:1,y:0},offHand:{x:1.5,y:0},shieldRadius:.3};
  b.previousHead={...b.pose.head};
  g.detectHits();assert.equal(b.globIntact,false);assert.deepEqual(g.scores,[1,0]);
});
