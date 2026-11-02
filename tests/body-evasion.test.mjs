import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';

function duel(slot=1){
  const g=new DuelEngine();g.setMode('versus');g.phase='fight';
  return {g,f:g.fighters[slot-1]};
}
const step=(g,f,n,control)=>{for(let i=0;i<n;i++){g.setControl(f.slot,control);g.updateFighter(f,STEP);}};

test('Abajo agacha pelvis y cabeza mediante articulaciones con pies apoyados, y soltar recupera',()=>{
  for(const slot of [1,2]){
    const {g,f}=duel(slot);step(g,f,90,{});
    const before=structuredClone(f.pose),volume=f.fluid.initialVolume;
    const local=(m,p)=>{
      const d=[p.x-m[12],p.y-m[13],p.z-m[14]];
      return [0,4,8].map(i=>(d[0]*m[i]+d[1]*m[i+1]+d[2]*m[i+2])/(m[i]**2+m[i+1]**2+m[i+2]**2));
    };
    const material=Object.fromEntries(['front','back'].map(side=>{
      const foot=before.feet[side];return [side,[foot.center,...foot.hull].map(p=>local(foot.matrix,p))];
    }));
    let supportedFrames=0;
    const supportedStep=(n,control)=>{
      for(let frame=0;frame<n;frame++){
        step(g,f,1,control);const d=f.rig.diagnostics();
        assert.equal(d.motorTorque[0],0,'no motor externo de baseX');assert.equal(d.motorTorque[1],0,'no motor externo de baseY');
        assert.ok(d.minimumGroundY>=TABLE_TOP-.0003);
        for(const [side,suffix] of [['front','F'],['back','B']]){
          const foot=f.pose.feet[side],m=foot.matrix,min=Math.min(...foot.hull.map(p=>p.y));
          assert.ok(Math.abs(min-foot.support.y)<1e-9,'el apoyo es el mínimo del hull conseguido');
          assert.ok(min>=TABLE_TOP-.0003&&min<=TABLE_TOP+.0003,'la suela permanece sobre la tarima durante todo el gesto');
          assert.ok(foot.groundReaction>0,'cada pie transmite una reacción real, no un target aéreo');
          assert.equal(foot.depth,before.feet[side].depth);assert.equal(foot.height,before.feet[side].height);
          const knee=f.pose['knee'+suffix],ankle=f.pose['ankle'+suffix],oldKnee=before['knee'+suffix],oldAnkle=before['ankle'+suffix];
          assert.deepEqual([m[12],m[13],m[14]],[ankle.x,ankle.y,ankle.z],'el frame nace en el tobillo físico');
          for(const i of [0,4,8])for(const j of [0,4,8]){
            const old=before.feet[side].matrix,product=a=>a[i]*a[j]+a[i+1]*a[j+1]+a[i+2]*a[j+2];
            assert.ok(Math.abs(product(m)-product(old))<1e-9,'el frame conserva escala y ángulos entre ejes');
          }
          assert.ok(Math.abs(Math.hypot(knee.x-ankle.x,knee.y-ankle.y,knee.z-ankle.z)-Math.hypot(oldKnee.x-oldAnkle.x,oldKnee.y-oldAnkle.y,oldKnee.z-oldAnkle.z))<1e-9,'la espinilla no se estira para sostener el gesto');
          for(const [i,p] of [foot.center,...foot.hull].entries()){
            const v=material[side][i],expected=[0,1,2].map(k=>m[k]*v[0]+m[k+4]*v[1]+m[k+8]*v[2]+m[k+12]);
            assert.ok([p.x,p.y,p.z].every((value,k)=>Math.abs(value-expected[k])<1e-9),'centro y hull sólo cambian por el mismo frame rígido');
          }
        }
        supportedFrames++;
      }
    };
    supportedStep(180,{bodyY:-1});
    assert.ok(f.pose.hip.y<before.hip.y-.20,`pelvis J${slot}`);
    assert.ok(f.pose.head.y<before.head.y-.20,`cabeza J${slot}`);
    assert.ok(f.rig.diagnostics().minimumGroundY>=TABLE_TOP-.0003);
    assert.ok(Math.abs(f.fluid.retainedVolume+f.fluid.releasedVolume-volume)<1e-12);
    assert.deepEqual(f.membrane.support,f.pose.head,'el látex usa la misma cabeza');
    supportedStep(240,{});assert.equal(supportedFrames,420,'ambos pies tienen apoyo real en cada frame de agachado y retorno');
    assert.ok(Math.abs(f.pose.hip.y-before.hip.y)<.02,'retorno físico al soltar');
  }
});

test('Arriba inicia una sola finta de profundidad y vuelve aunque se mantenga el gesto',()=>{
  for(const slot of [1,2]){
    const {g,f}=duel(slot);step(g,f,90,{});const before=structuredClone(f.pose);
    let min=Infinity;
    for(let i=0;i<180;i++){step(g,f,1,{bodyY:1});min=Math.min(min,f.pose.head.z);}
    assert.ok(min<before.head.z-.15,`finta hacia el fondo J${slot}: ${min}`);
    assert.ok(Math.abs(f.pose.head.z-before.head.z)<.035,'no conserva una esquiva inmóvil ni repite mientras se sostiene');
    assert.ok(Math.abs(f.pose.hip.x-before.hip.x)<.02,'no acerca al rival por un gesto vertical');
    step(g,f,40,{});let again=Infinity;
    for(let i=0;i<100;i++){step(g,f,1,{bodyY:1});again=Math.min(again,f.pose.head.z);}
    assert.ok(again<before.head.z-.15,'neutral rearma un nuevo gesto');
  }
});

test('Eje corporal se valida y nunca activa ataque ni defensa; reset borra su intención',()=>{
  const {g,f}=duel();g.setControl(1,{bodyY:Infinity});assert.equal(f.controller.bodyY,0);
  g.setControl(1,{bodyY:-5});assert.equal(f.controller.bodyY,-1);
  assert.equal(f.controller.thrust,false);assert.equal(f.controller.guard,false);
  step(g,f,60,{bodyY:-1});g.resetRound();
  assert.equal(g.fighters[0].controller.bodyY??0,0);
  assert.ok(g.fighters[0].pose.hip.y>TABLE_TOP+.9);
});
