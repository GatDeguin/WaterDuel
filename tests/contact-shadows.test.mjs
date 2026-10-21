import test from 'node:test';
import assert from 'node:assert/strict';
import {contactShadows} from '../public/rendering/contact-shadows.js';
import {DetachedCluster} from '../public/physics/detached-cluster.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import {DuelEngine} from '../public/engine.js';
import {SimulationPresentation} from '../public/simulation-presentation.js';
import {captureReplayState,replayView} from '../public/replay.js';

const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const fighter=()=>({baseX:19,pose:{footF:{x:-.7,y:TABLE_TOP+.075,z:.29},footB:{x:.6,y:TABLE_TOP+.075,z:-.22}}});
function cluster(vertices){
 const center={x:0,y:1,jx:[0],jy:[0]};
 return new DetachedCluster({id:'actual',joint:'wrist',bodies:[{name:'weapon',mass:1,inertia:.1,center,rotations:[0]}],
  panels:[],vertices,velocity:[0],dir:1,sourcePose:{},gravity:0});
}

test('Las dos sombras siguen centros de suela físicos y nunca baseX',()=>{
 const f=fighter(),before=structuredClone(f),stamps=contactShadows(f);
 assert.equal(stamps.length,2);assert.deepEqual(stamps.map(s=>[s.x,s.z]),[[-.7,.29],[.6,-.22]]);
 for(const s of stamps){near(s.gap,0);assert.ok(s.opacity>0&&s.opacity<.3);assert.ok(s.radiusX>0&&s.radiusX<.25);near(s.y,TABLE_TOP+.0008);}
 assert.deepEqual(f,before);
 f.pose.joints={frontKnee:{detached:true}};
 assert.deepEqual(contactShadows(f).map(s=>s.id),['footB']);
});

test('Elevar una suela amplía penumbra, reduce opacidad y la desvanece fuera de contacto',()=>{
 const f=fighter(),ground=contactShadows(f)[0];f.pose.footF.y+=.06;
 const raised=contactShadows(f)[0];near(raised.gap,.06);assert.ok(raised.opacity<ground.opacity);assert.ok(raised.radiusX>ground.radiusX);
 f.pose.footF.y+=.061;assert.deepEqual(contactShadows(f).map(s=>s.id),['footB']);
 f.pose.footB.y+=.2;assert.deepEqual(contactShadows(f),[]);
});

test('Un fragmento proyecta sólo vértices físicos cercanos; sin fantasma del miembro separado',()=>{
 const f=fighter();f.pose.joints={frontKnee:{detached:true},backKnee:{detached:true}};
 const frag=cluster([{x:1,y:TABLE_TOP+.015,z:.2},{x:1.2,y:TABLE_TOP+.2,z:.2},{x:1,y:TABLE_TOP+.015,z:.2}]);
 const before=structuredClone({x:frag.x,y:frag.y,vertices:frag.vertices});
 const stamps=contactShadows(f,{fragments:[frag]});assert.equal(stamps.length,1);
 assert.equal(stamps[0].kind,'fragment');near(stamps[0].x,1);near(stamps[0].z,.2);near(stamps[0].gap,.015);
 assert.deepEqual({x:frag.x,y:frag.y,vertices:frag.vertices},before);
});

test('Snapshot limita a16 puntos reales con mínimoY y extremos X/Z sin fabricar centros',()=>{
 const points=Array.from({length:40},(_,i)=>({x:(i%10)*.05,y:TABLE_TOP+.03+(i%3)*.01,z:Math.floor(i/10)*.06}));
 points.push({x:.17,y:TABLE_TOP+.001,z:.09},{x:-.4,y:TABLE_TOP+.04,z:.04},{x:.7,y:TABLE_TOP+.05,z:.04},
  {x:.12,y:TABLE_TOP+.06,z:-.4},{x:.12,y:TABLE_TOP+.06,z:.6},{x:20,y:TABLE_TOP+.2,z:0});
 const frag=cluster(points),snapshot=frag.snapshot();assert.equal(snapshot.contactVertices.length,16);
 const world=frag.worldVertices();for(const p of snapshot.contactVertices)assert.ok(world.some(q=>q.x===p.x&&q.y===p.y&&q.z===p.z));
 for(const p of points.slice(40,45))assert.ok(snapshot.contactVertices.some(q=>Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z)<1e-12));
 assert.ok(snapshot.contactVertices.every(p=>p.y<=TABLE_TOP+.12));assert.deepEqual(snapshot.contactTransform,snapshot.transform);
 snapshot.contactVertices[0].x=100;assert.notEqual(frag.worldVertices()[0].x,100);
});

test('La sombra del snapshot usa delta rígida interpolada, no el world actual de captura',()=>{
 const frag=cluster([{x:.3,y:TABLE_TOP+.02,z:.2}]);frag.x=.6;
 const snapshot=frag.snapshot(),current=snapshot.contactVertices[0];near(current.x,.9);
 snapshot.transform=frag.transformAt(.5);
 const f={pose:{detached:[snapshot]}};const stamps=contactShadows(f);assert.equal(stamps.length,1);near(stamps[0].x,.6);near(stamps[0].gap,.02);
 snapshot.transform[13]+=.2;assert.deepEqual(contactShadows(f),[],'fade is evaluated after interpolation, not against captured gap');
});

test('La delta de profundidad XYZ sigue la geometría sin reaplicar la traslación capturada',()=>{
 const captured=identity(),current=identity();captured[14]=.25;current[14]=.6;
 const fragment={id:'depth',contactVertices:[{x:.2,y:TABLE_TOP+.01,z:.4}],contactTransform:captured,transform:current};
 const before=structuredClone(fragment),f={pose:{detached:[fragment]}};
 near(contactShadows(f)[0].z,.75);assert.deepEqual(fragment,before);
 fragment.transform[14]=.425;near(contactShadows(f)[0].z,.575,'interpolated depth uses the same delta as the visible fragment');
});

test('Agua, látex, geometría ausente y coordenadas inválidas no crean oclusores opacos',()=>{
 const point={x:0,y:TABLE_TOP,z:0},transform=identity(),f={pose:{}};
 const fragments=[{id:1,material:'water',worldVertices:()=>[point]},{id:2,material:'latex',worldVertices:()=>[point]},
  {id:3,opaque:false,worldVertices:()=>[point]},{id:4,sourcePose:{},transform},
  {id:5,contactVertices:[{...point,x:NaN}],contactTransform:transform,transform}];
 assert.deepEqual(contactShadows(f,{fragments}),[]);
});

test('Contactos duplicados no acumulan oscuridad y variantes inválidas no contaminan la salida',()=>{
 const p={x:.1,y:TABLE_TOP+.02,z:.2},f={pose:{}},fragment={id:1,worldVertices:()=>Array.from({length:50},()=>({...p}))};
 assert.equal(contactShadows(f,{fragments:[fragment]}).length,1);
 assert.throws(()=>contactShadows(f,{maxGap:0}),/gap/i);
 assert.throws(()=>contactShadows(f,{floor:NaN}),/floor/i);
 const malformed={id:2,contactVertices:[p],contactTransform:identity(),transform:identity()};malformed.transform[0]=2;
 assert.deepEqual(contactShadows(f,{fragments:[malformed]}),[]);
});

test('Replay y presentación conservan contactos medidos del fragmento real y la misma interpolación rígida',()=>{
 const game=new DuelEngine(),f=game.fighters[0];f.rig.damageJoint('wrist',1);const fragment=f.rig.fragments[0];
 fragment.y+=TABLE_TOP-Math.min(...fragment.worldVertices().map(p=>p.y));f.pose=f.rig.pose();
 const saved=captureReplayState(game),atCapture=contactShadows(f).filter(s=>s.kind==='fragment');assert.ok(atCapture.length>0);
 assert.deepEqual(contactShadows(replayView(saved).fighters[0]).filter(s=>s.kind==='fragment'),atCapture);
 const presentation=new SimulationPresentation();game.phase='burst';presentation.capture(game);
 const beforeVertices=fragment.worldVertices();fragment.x+=.4;f.pose=f.rig.pose();presentation.capture(game);
 const shown=presentation.view(game,.5).fighters[0],stamps=contactShadows(shown).filter(s=>s.kind==='fragment');assert.ok(stamps.length>0);
 for(const s of stamps)assert.ok(beforeVertices.some(p=>Math.hypot(s.x-(p.x+.2),s.z-p.z)<1e-9),'each centre follows a real physical point at the displayed transform');
 assert.deepEqual(contactShadows(replayView(saved).fighters[0]).filter(s=>s.kind==='fragment'),atCapture,'future motion never changes saved contact geometry');
});
