// CPU surface checks from real motor inputs; this is not GPU/FPS evidence.
import {readFile,writeFile} from 'node:fs/promises';
import {DuelEngine,STEP} from '../public/engine.js';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms} from '../public/rendering/asset-rig.js';
import {deformApronGeometry} from '../public/rendering/apron-deform.js';
import {bodyForBone,bodyVisible} from '../public/rendering/joint-damage.js';
import {advanceLocomotion} from '../public/physics/locomotion.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
const out=new URL('../public/assets/characters/water-mannequin/v4/pose-sweep.json',import.meta.url);
const prepared={};
for(const [key,name]of [['normal','water-mannequin'],['boss','water-mannequin-boss']]){
  const bytes=await readFile(new URL(`../public/assets/characters/water-mannequin/v4/${name}.glb`,import.meta.url));
  prepared[key]=prepareCharacter(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
}
const scenarios=[['guardia',36,{}],['avance',72,{lean:.45,mainX:.2}],['parada',48,{guard:true,offX:.8,offY:.7,mainX:-.5}],
  ['esquiva',48,{bodyY:-1,headZ:.7,mainX:-.6}],['extension',48,{mainX:1,mainY:.4,headX:.5}],['recuperacion',48,{mainX:-1,mainY:-.5}]];
const loadouts=[['sword','none'],['sword','short'],['sword','long'],['sword','knife'],['sword','knife','reverse'],['spear','none'],['axe','none'],['maul','none']];
const results=[];let vertices=0;
function inspect(f,asset,label){
  const matrices=characterTransforms(asset,f);let minY=Infinity,lowest=null;
  for(let i=0;i<asset.parts.length;i++){
    const part=asset.parts[i];if(!bodyVisible(f.pose,bodyForBone(part.boneName,f.pose)))continue;
    const points=deformApronGeometry(part,f.pose.apron)?.positions??part.positions,m=matrices[i];
    if(!m.every(Number.isFinite))throw Error(`Matriz no finita ${label}/${part.nodeName}`);
    for(let j=0;j<points.length;j+=3){
      const x=points[j],y=points[j+1],z=points[j+2],worldY=m[1]*x+m[5]*y+m[9]*z+m[13];vertices++;
      if(!Number.isFinite(worldY))throw Error(`Vértice no finito ${label}/${part.nodeName}`);
      if(worldY<minY){minY=worldY;lowest={node:part.nodeName,bone:part.boneName,index:j/3};}
    }
  }
  return {label,minimumY:minY,belowFloor:Math.max(0,TABLE_TOP-minY),lowest,selfPenetration:f.rig.diagnostics().maxSelfPenetration};
}
for(const boss of [false,true])for(const dir of [-1,1])for(const [weapon,defense,knifeGrip]of loadouts){
  const game=new DuelEngine();if(boss)game.setDifficulty('boss');else game.setMode('versus');
  const f=game.fighters[boss?1:0];game.setLoadout(f.slot,{weapon,defense,...(knifeGrip?{knifeGrip}:{})});
  if(!!f.boss!==boss)throw Error('El fixture debe usar el rig correspondiente al GLB');
  f.dir=dir;f.baseX=-dir*1.53;game.initializeRig(f);game.phase='fight';
  const asset=prepared[boss?'boss':'normal'],samples=[];
  for(const [label,steps,control]of scenarios){
    for(let i=0;i<steps;i++){
      game.clock+=STEP;game.setControl(f.slot,control);
      // Same scalar motor policy as updateFootwork, without a second fighter
      // capping this single-body articulation inspection.
      f.baseVX=advanceLocomotion(f.baseVX,control.lean??0,STEP,{dir,enabled:true});f.baseX+=f.baseVX*STEP;
      game.updateFighter(f,STEP);
    }
    samples.push(inspect(f,asset,label));
  }
  if(['sword','maul'].includes(weapon)&&defense==='none'){
    f.rig.collapse();for(let i=0;i<360;i++)f.rig.step(STEP);f.pose=f.rig.pose();samples.push(inspect(f,asset,'caida360'));
  }
  results.push({boss,dir,weapon,defense,knifeGrip:knifeGrip??'normal',samples});
}
const violations=results.flatMap(result=>result.samples.filter(s=>s.belowFloor>1e-5).map(sample=>({...result,samples:undefined,sample})));
const report={ok:violations.length===0,scope:'CPU geometry/ground sweep from motor inputs; no triangle-triangle clearance proof, no GPU or FPS claim',
  profiles:results.length,samples:results.reduce((n,r)=>n+r.samples.length,0),verticesExamined:vertices,
  maximumBelowFloor:Math.max(0,...results.flatMap(r=>r.samples.map(s=>s.belowFloor))),violations,results};
await writeFile(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:report.ok,profiles:report.profiles,samples:report.samples,vertices,maximumBelowFloor:report.maximumBelowFloor,violations:violations.map(v=>({boss:v.boss,dir:v.dir,weapon:v.weapon,label:v.sample.label,below:v.sample.belowFloor,lowest:v.sample.lowest}))},null,2));
if(!report.ok)process.exitCode=1;
