import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import * as water from '../public/physics/fluid.js';
import {BalloonMembrane} from '../public/physics/membrane.js';
const H=1/120;
// Outward-oriented square bowl: floor and four sides; no fictitious top cap.
function bowl({missing='',fragment=false,offset={x:0,y:0,z:0}}={}){
  const nodes=[[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1],[-1,2,-1],[1,2,-1],[1,2,1],[-1,2,1]]
    .map(([x,y,z])=>({x:x+offset.x,y:y+offset.y,z:z+offset.z}));
  const sides={floor:[[0,1,2],[0,2,3]],back:[[0,4,5],[0,5,1]],right:[[1,5,6],[1,6,2]],front:[[2,6,7],[2,7,3]],left:[[3,7,4],[3,4,0]]};
  const faces=Object.entries(sides).filter(([name])=>name!==missing).flatMap(([,triangles])=>triangles.map(([a,b,c])=>({a,b,c,fragment})));
  return {nodes,faces,version:1};
}

test('El recipiente usa soporte inferior y envolvente lateral conectada de triángulos reales',()=>{
  assert.equal(typeof water.buildMembraneSupport,'function');
  const p={x:.1,y:.7,z:.2},intact=water.buildMembraneSupport(bowl());
  assert.equal(intact.contains(p),true,'a bowl open above still supports interior water');
  for(const missing of ['floor','right']){
    const broken=water.buildMembraneSupport(bowl({missing}));
    assert.equal(broken.contains(p),false,`missing ${missing} is not repaired by the AABB`);
  }
  assert.equal(water.buildMembraneSupport(bowl({fragment:true})).contains(p),false,'detached latex is not a container');
  const loose=bowl(),patches={nodes:[],faces:[],version:1};
  for(const face of loose.faces){const first=patches.nodes.length;patches.nodes.push(...[face.a,face.b,face.c].map(id=>({...loose.nodes[id]})));patches.faces.push({a:first,b:first+1,c:first+2,fragment:false});}
  assert.equal(water.buildMembraneSupport(patches).contains(p),false,'spatially adjacent disconnected patches do not assemble a supporting vessel');
  assert.equal(intact.contains({x:1.01,y:.7,z:.2}),false);
  const shift={x:3,y:-.3,z:1};
  assert.equal(water.buildMembraneSupport(bowl({offset:shift})).contains({x:p.x+shift.x,y:p.y+shift.y,z:p.z+shift.z}),true);
});

test('La malla física intacta contiene el cap normal y jefe sin depender del elipsoide nominal',()=>{
  for(const scale of [1,1.16]){
    const head={x:1.2,y:2.4,z:-.12},m=new BalloonMembrane({scale}),f=new water.FluidVolume(1,200,scale);
    m.attach(head);f.keepContained(head,H,.07,.2);
    const s=water.buildMembraneSupport(m);assert.equal(s.triangleCount,320);assert.equal(s.componentCount,1);
    assert.ok(f.particles.every(p=>s.contains(p)));
    assert.equal(water.buildMembraneSupport(m),s,'an unchanged physical version reuses only its geometry query');
    m.attach({x:head.x+.4,y:head.y+.2,z:head.z-.1});
    const moved=water.buildMembraneSupport(m);assert.notEqual(moved,s);
    assert.equal(s.contains({x:head.x-.39,y:head.y,z:head.z}),true);
    assert.equal(moved.contains({x:head.x-.39,y:head.y,z:head.z}),false);
  }
});

test('R7: el fixture real del auditor no retiene centros fuera del AABB de piel principal',()=>{
  const g=new DuelEngine();g.mode='versus';g.phase='fight';
  const [a,b]=g.fighters,h=b.pose.head;
  g.burst(b,a,{x:h.x-.422,y:h.y,z:.17});
  for(let tick=1;tick<=240;tick++){
    g.update(STEP);
    if(![30,60,120,240].includes(tick))continue;
    const used=new Set(b.membrane.faces.filter(f=>!f.fragment).flatMap(f=>[f.a,f.b,f.c]));
    const nodes=[...used].map(id=>b.membrane.nodes[id]);
    const outside=b.fluid.retainedParticles.filter(p=>['x','y','z'].some(axis=>
      p[axis]<Math.min(...nodes.map(n=>n[axis]))-1e-6||p[axis]>Math.max(...nodes.map(n=>n[axis]))+1e-6));
    assert.equal(outside.length,0,`tick ${tick}: ${outside.length} centros sin recipiente geométrico`);
  }
});

test('Las punciones de ambos lados, normal y jefe, conservan ledger y soporte en cada tick físico',()=>{
  for(const boss of [false,true])for(const side of [-1,1]){
    const g=new DuelEngine();
    if(boss)g.setDifficulty('boss');
    g.mode='versus';g.phase='fight';
    const [a,b]=g.fighters,h=b.pose.head,scale=b.balloonSize;
    assert.equal(b.boss,boss);
    g.burst(b,a,{x:h.x+side*.422*scale,y:h.y,z:.17});
    const initial=b.fluid.volume,count=b.fluid.count;
    let partial=false,checks=0;
    for(let tick=1;tick<=240;tick++){
      g.update(STEP);const f=b.fluid;
      assert.equal(f.particles.length,count);assert.ok(f.particles.every(p=>p.volume===f.particleVolume));
      assert.ok(Math.abs(f.retainedVolume+f.releasedVolume-initial)<1e-12);
      assert.ok(Math.abs(f.leakState.orificeVolume+f.leakState.supportLossVolume-f.releasedVolume)<1e-12);
      assert.ok(Math.abs(f.leakState.geometryLossVolume+f.leakState.capacityLossVolume-f.leakState.supportLossVolume)<1e-12);
      if(f.leakState.steps){
        const skin=water.buildMembraneSupport(b.membrane);
        for(const p of f.retainedParticles){assert.equal(skin.contains(p),true,`${boss?'boss':'normal'} ${side} tick ${tick}`);checks++;}
      }
      partial ||= f.retainedVolume>0&&f.releasedVolume>0;
    }
    assert.ok(checks>0&&partial,'geometry must allow a progressive, supported remainder');
    assert.ok(b.fluid.leakState.geometryLossVolume>0);
    assert.ok(b.fluid.retainedVolume<initial*.05,'retraction must not leave the nominal water cap suspended');
  }
});

test('La pérdida geométrica cambia fase en la posición medida y no aplica chorro ni reimpulsa agua libre',()=>{
  const head={x:0,y:2.4,z:0},f=new water.FluidVolume(1,200);f.keepContained(head,H);
  f.beginLeak({head,impact:{x:-.422,y:2.4,z:0},headVelocity:{vx:.3,vy:.1,vz:-.2},thrust:1});
  const before=f.particles.map(p=>({x:p.x,y:p.y,z:p.z}));
  const release=f.releaseParticle.bind(f);let transitions=0;
  f.releaseParticle=(p,...args)=>{
    const pos={x:p.x,y:p.y,z:p.z},result=release(p,...args);
    assert.deepEqual({x:p.x,y:p.y,z:p.z},pos,'changing phase itself must not relocate a parcel');
    transitions++;return result;
  };
  // Intercept only the integrator, so phase-change continuity is measured before
  // gravity/density collision moves the newly free particles in this same tick.
  const step=f.step.bind(f);f.step=()=>{};
  f.advanceLeak(H,{head,apertureArea:0,pressure:0,time:0,headVelocity:{vx:.3,vy:.1,vz:-.2},membraneSupport:water.buildMembraneSupport(bowl({missing:'floor',offset:{x:0,y:1.4,z:0}}))});
  assert.equal(f.retainedVolume,0);assert.equal(f.leakState.orificeVolume,0);
  assert.ok(Math.abs(f.leakState.geometryLossVolume-f.volume)<1e-12);
  assert.equal(transitions,f.count);
  for(let i=0;i<f.count;i++){
    const p=f.particles[i];for(const k of ['x','y','z'])assert.ok(Math.abs(p[k]-before[i][k])<1e-12);
    for(const[k,v]of [['vx',.3],['vy',.1],['vz',-.2]])assert.ok(Math.abs(p[k]-v)<1e-12,'support loss inherits measured motion without an orifice impulse');
  }
  const phaseVersion=f.phaseVersion,freeBefore=f.particles.map(p=>({x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz}));
  f.advanceLeak(H,{head:{x:.1,y:2.5,z:.1},apertureArea:1,pressure:1,headVelocity:{vx:4,vy:3,vz:2},membraneSupport:water.buildMembraneSupport(bowl())});
  assert.equal(f.phaseVersion,phaseVersion);assert.equal(transitions,f.count);
  assert.deepEqual(f.particles.map(p=>({x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz})),freeBefore);
  f.step=step;
});

test('Un recipiente estable permite caudal de orificio; el soporte móvil no cambia el reloj 30/120',()=>{
  const make=()=>{const f=new water.FluidVolume(1,200),head={x:0,y:2.4,z:0};f.keepContained(head,H);f.beginLeak({head,impact:{x:-.422,y:2.4,z:0},thrust:.8});return f;};
  const a=make(),b=make();
  for(const[f,n,dt]of [[a,30,1/30],[b,120,H]])for(let i=1;i<=n;i++){
    const t=i*dt,head={x:.3*t,y:2.4+.1*t,z:.05*t};
    f.advanceLeak(dt,{head,apertureArea:.03,pressure:.6,time:t,slosh:.1*t,headVelocity:{vx:.3,vy:.1,vz:.05},
      membraneSupport:water.buildMembraneSupport(bowl({offset:{x:head.x,y:head.y-1,z:head.z}}))});
  }
  assert.equal(a.leakState.steps,120);assert.equal(b.leakState.steps,120);
  assert.ok(a.leakState.orificeVolume>0);assert.equal(a.leakState.supportLossVolume,0);
  assert.equal(a.retainedVolume,b.retainedVolume);
  for(let i=0;i<a.count;i++)for(const k of ['x','y','z','vx','vy','vz'])assert.ok(Math.abs(a.particles[i][k]-b.particles[i][k])<1e-8,`${i}.${k}`);
});
