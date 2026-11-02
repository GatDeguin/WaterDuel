import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DuelEngine,STEP} from '../public/engine.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms} from '../public/rendering/asset-rig.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {FOOT_SHAPES} from '../public/physics/foot-geometry.js';

const character=async(boss,revision)=>{
  const bytes=await fs.readFile(new URL(`../public/assets/characters/water-mannequin/v${revision}/water-mannequin${boss?'-boss':''}.glb`,import.meta.url));
  return prepareCharacter(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
};
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const nearPoint=(a,b,message)=>assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<1e-9,message);
function physicalFeet(f,boss,frame){
  for(const [side,suffix]of [['front','F'],['back','B']]){
    const foot=f.pose.feet[side],ankle=f.pose['ankle'+suffix],m=foot.matrix,shape=FOOT_SHAPES[boss?'boss':'normal'][side],scale=f.rig.scale;
    assert.ok(m.length===16&&Array.from(m).every(Number.isFinite),'frame de pie finito');
    nearPoint(Array.from(m.slice(12,15)),[ankle.x,ankle.y,ankle.z],'origen del frame rígido en el tobillo físico');
    const axes=[0,4,8].map(i=>Array.from(m.slice(i,i+3)));
    for(const axis of axes)assert.ok(Math.abs(Math.hypot(...axis)-scale)<1e-10,'el pie conserva la escala material');
    for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)assert.ok(Math.abs(axes[a].reduce((sum,v,i)=>sum+v*axes[b][i],0))<1e-10,'frame sin cizalladura');
    const z=(shape.minZ+shape.maxZ)/2,center=point(m,[0,shape.centerY,z]);
    nearPoint(center,[foot.center.x,foot.center.y,foot.center.z],'centro material sigue el frame del tobillo');
    nearPoint(center,[f.pose['foot'+suffix].x,f.pose['foot'+suffix].y,f.pose['foot'+suffix].z],'centro publicado conserva el mismo punto material');
    assert.equal(foot.hull.length,shape.hull.length);
    for(const [i,[x,y]]of shape.hull.entries())nearPoint(point(m,[x,y,z]),[foot.hull[i].x,foot.hull[i].y,foot.hull[i].z],'cada vértice material conserva su hull sin estiramiento');
    assert.ok(Math.abs(foot.depth-(shape.maxZ-shape.minZ)*scale)<1e-10,'profundidad material sin estiramiento');
    const minimum=Math.min(...foot.hull.map(p=>p.y));
    assert.ok(Math.abs(foot.support.y-minimum)<1e-9,'soporte en el mínimo del hull físico');
    const context=`boss${boss} dir${f.dir} frame${frame} ${side} gap${minimum-TABLE_TOP} reaction${foot.groundReaction} stance${foot.stance}`;
    assert.ok(Math.abs(minimum-TABLE_TOP)<.0003,`hull apoyado en suelo dentro de la tolerancia del solver: ${context}`);
    assert.ok(foot.stance&&foot.groundReaction>0,`apoyo real con reacción normal positiva: ${context}`);
  }
}

test('La postura baja conserva suelo y apoyos también en GLB v2/v4 de ambos sentidos y tamaños',async()=>{
  for(const boss of [false,true]){
    const characters=await Promise.all([2,4].map(async revision=>({revision,c:await character(boss,revision)})));
    for(const dir of [-1,1]){
      const g=new DuelEngine();g.setDifficulty(boss?'boss':'normal');g.phase='fight';
      const f=g.fighters[boss?1:0];f.dir=dir;f.baseX=-dir*Math.abs(f.baseX);g.initializeRig(f);
      for(let i=0;i<90;i++)g.updateFighter(f,STEP);
      const hip=f.pose.hip.y;
      for(let frame=0;frame<180;frame++){
        g.setControl(f.slot,{bodyY:-1});g.updateFighter(f,STEP);
        const d=f.rig.diagnostics();assert.ok(d.minimumGroundY>=TABLE_TOP-.0003,`proxy boss${boss} dir${dir} frame${frame}`);
        assert.ok(d.contacts.every(c=>c.error<.0002),'apoyos dentro del mismo solver');
        if(frame%15!==0&&frame!==179)continue;
        // Both delivered meshes consume this exact same physical step.
        physicalFeet(f,boss,frame);
        for(const {revision,c}of characters){
          const matrices=characterTransforms(c,f);
          for(let i=0;i<c.parts.length;i++){
            const part=c.parts[i],m=matrices[i];
            if(!/^(shin|thigh|foot)\./.test(part.boneName))continue;
            for(let v=0;v<part.positions.length;v+=3){
              const y=m[1]*part.positions[v]+m[5]*part.positions[v+1]+m[9]*part.positions[v+2]+m[13];
              assert.ok(y>=TABLE_TOP-1e-5,`v${revision} ${part.boneName} boss${boss} dir${dir} frame${frame}: ${y}`);
            }
          }
        }
      }
      assert.ok(f.pose.hip.y<hip-.20,'la envolvente no impide la postura solicitada');
    }
  }
});

test('El impacto unilateral de suelo sin gravedad no crea energía ni tensión hacia la tarima',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18]){
    const r=new ArticulatedRig({dir,scale,gravity:0});r.collapse();r.velocity[1]=-.8;
    const before=r.diagnostics().kineticEnergy;r.step(STEP);const after=r.diagnostics();
    assert.ok(after.minimumGroundY>=TABLE_TOP-.0003);
    assert.ok(after.kineticEnergy<=before+1e-8,`${before} -> ${after.kineticEnergy}`);
    assert.ok(after.motorTorque.every(t=>t===0));
    assert.ok(after.coordinates.every(q=>Number.isFinite(q.position)&&Number.isFinite(q.velocity)));
  }
});
