import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {SimulationPresentation} from '../public/simulation-presentation.js';
import {capHeightForFraction} from '../public/physics/dimensions.js';

function pair(){
 const game=new DuelEngine();game.mode='versus';game.phase='burst';game.phaseClock=.1;
 const view=new SimulationPresentation();view.capture(game);
 const before=structuredClone({head:game.fighters[0].pose.head,particle:game.fighters[0].fluid.particles[0],node:game.fighters[0].membrane.nodes[0]});
 game.stepPhysics(STEP);view.capture(game);return {game,view,before};
}

test('El render interpola cuerpo, agua y látex en el mismo tiempo sin mutar los solvers',()=>{
 const {game,view,before}=pair(),source=game.fighters[0];
 const state=structuredClone({pose:source.pose,particles:source.fluid.particles,nodes:source.membrane.nodes,q:source.rig.q,version:source.membrane.version});
 const scene=view.view(game,.5),fighter=scene.fighters[0];
 for(const axis of ['x','y','z']){
   assert.equal(fighter.pose.head[axis],(before.head[axis]+source.pose.head[axis])/2);
   assert.equal(fighter.fluid.particles[0][axis],(before.particle[axis]+source.fluid.particles[0][axis])/2);
   assert.equal(fighter.membrane.nodes[0][axis],(before.node[axis]+source.membrane.nodes[0][axis])/2);
 }
 fighter.membrane.mesh();
 assert.deepEqual({pose:source.pose,particles:source.fluid.particles,nodes:source.membrane.nodes,q:source.rig.q,version:source.membrane.version},state);
 assert.notEqual(scene,game);assert.notEqual(fighter,source);assert.notEqual(fighter.fluid,source.fluid);
 assert.notEqual(fighter.membrane.nodes,source.membrane.nodes);
});

test('Las identidades visuales estables no invalidan la caché volumétrica en cada render',()=>{
 const {game,view}=pair();
 const first=view.view(game,.2),fluid=first.fighters[0].fluid,particle=fluid.particles[0],oldX=particle.x,pose=first.fighters[0].pose;
 const second=view.view(game,.8);
 assert.equal(second,first);assert.equal(second.fighters[0].fluid,fluid);assert.equal(fluid.particles[0],particle);
 assert.notEqual(second.fighters[0].pose,pose,'los huesos deben actualizar sus matrices');
 assert.notEqual(particle.x,oldX);
});

test('El plano libre interpola una rotación ortonormal y conserva el volumen de su cap',()=>{
 const {game,view}=pair(),f=game.fighters[0];
 f.fluid.surfaceFrame={height:0,fraction:.25,rotation:[1,0,0,0,1,0,0,0,1]};view.reset();view.capture(game);
 f.fluid.surfaceFrame={height:0,fraction:.75,rotation:[0,-1,0,1,0,0,0,0,1]};view.capture(game);
 const frame=view.view(game,.5).fighters[0].fluid.surfaceFrame,r=frame.rotation;
 assert.equal(frame.fraction,.5);assert.equal(frame.height,capHeightForFraction(.5));
 for(let row=0;row<3;row++)assert.ok(Math.abs(Math.hypot(...r.slice(row*3,row*3+3))-1)<1e-12);
 assert.ok(Math.abs(r[0]*r[3]+r[1]*r[4]+r[2]*r[5])<1e-12);
});

test('Una rotura no mezcla topologías antiguas ni reutiliza el meshCache del solver',()=>{
 const game=new DuelEngine(),presentation=new SimulationPresentation();game.phase='burst';presentation.capture(game);
 const [a,b]=game.fighters,h=b.pose.head;game.phase='fight';game.burst(b,a,{x:h.x-.422,y:h.y,z:.17});
 presentation.capture(game);const meshBefore=b.membrane.mesh(),cache=b.membrane.meshCache;
 const f=presentation.view(game,.5).fighters[1],mesh=f.membrane.mesh();
 assert.equal(f.membrane.punctured,true);assert.equal(f.membrane.nodes.length,b.membrane.nodes.length);
 assert.equal(mesh.p.length,meshBefore.p.length);assert.equal(b.membrane.meshCache,cache);
 assert.notEqual(f.membrane.meshCache,cache);assert.ok(mesh.p.every(Number.isFinite));
});

test('La presentación se elimina al cambiar de round y nunca alcanza al replay',()=>{
 const {game,view}=pair(),old=view.view(game,.5);game.resetRound();
 assert.equal(view.view(game,.5),game,'los muñecos nuevos no heredan la interpolación anterior');
 game.replay=true;assert.equal(view.view(game,.5),game);
 game.replay=false;game.phase='fight';assert.equal(view.view(game,.5),game);
 assert.notEqual(old.fighters[0],game.fighters[0]);
});

test('La API del motor incorpora el resto real del RAF y no avanza al estar pausada',()=>{
 const game=new DuelEngine();game.mode='versus';game.phase='fight';const[a,b]=game.fighters;game.burst(b,a,b.pose.head);
 for(let i=0;i<4;i++)game.update(STEP);
 const clock=game.clock,phaseClock=game.phaseClock,previous=game.presentation.previous.fighters[1].pose.head,current=game.presentation.current.fighters[1].pose.head;
 const one=structuredClone(game.presentationState().fighters[1].pose.head);
 const two=structuredClone(game.presentationState(.003).fighters[1].pose.head);
 assert.ok(Math.hypot(two.x-one.x,two.y-one.y,two.z-one.z)>0);
 for(const axis of ['x','y','z'])assert.ok(two[axis]>=Math.min(previous[axis],current[axis])-1e-12&&two[axis]<=Math.max(previous[axis],current[axis])+1e-12);
 assert.deepEqual(game.presentationState(.003).fighters[1].pose.head,two);
 assert.equal(game.clock,clock);assert.equal(game.phaseClock,phaseClock);
});

test('Una partícula de efectos reutilizada no interpola desde la vida anterior del pool',()=>{
 const game=new DuelEngine(),view=new SimulationPresentation();game.phase='burst';
 const particle={kind:'dust',source:'window',x:1,y:2,z:3,r:.01,phase:.1};
 game.effects.particles=[particle];view.capture(game);
 Object.assign(particle,{kind:'smoke',source:'oilLamp',x:9,y:6,z:4,r:.04,phase:.9});view.capture(game);
 const rendered=view.view(game,.5).effects.particles[0];assert.equal(rendered.x,9);assert.equal(rendered.kind,'smoke');
});
