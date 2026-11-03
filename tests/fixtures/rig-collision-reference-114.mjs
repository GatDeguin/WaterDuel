import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getWeapon} from '../../public/equipment.js';
import {BALLOON_RADII} from '../../public/physics/dimensions.js';

export const BASELINE_SHA='e02e42100d66b8d25b3d525d0d4a53f54edcdeabaf04152091bc3eccfa8e518b';
const logical=new URL('../../public/physics/articulated-rig.js',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
const replaceOnce=(s,from,to)=>{assert.equal(s.split(from).length,2,'unique instrumentation marker: '+from);return s.replace(from,to);};
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const relocate=(source,url,overrides={})=>source.replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_m,prefix,quote,path)=>prefix+quote+(overrides[path]??new URL(path,url).href)+quote);

/** Both graphs deliberately use the SAME live dependency URLs (cloth included).
 * Only the rig source varies; current private class identity is also installed
 * into its own bind module. The historical rig bytes are never rewritten. */
export async function loadCollisionRig(source,tag,{bindSource=null}={}){
  const counts={supportFaces:0,interpolatedDerivatives:0,geometrySamples:0,bisections:0,deepAlternativeReads:0,deepAlternativeChoices:0};
  let instrumented='const __collisionAudit='+JSON.stringify(counts)+';\n'+source;
  instrumented=replaceOnce(instrumented,'const supportFace=(panel,n,tangent)=>{','const supportFace=(panel,n,tangent)=>{__collisionAudit.supportFaces++;');
  instrumented=replaceOnce(instrumented,'#kinematics(q=this.q,swordLength=this.swordLength,derivatives=true,bend=this.weaponFlex?.offset??0,yOnly=false){',
    '#kinematics(q=this.q,swordLength=this.swordLength,derivatives=true,bend=this.weaponFlex?.offset??0,yOnly=false){if(q!==this.q&&derivatives)__collisionAudit.interpolatedDerivatives++;');
  instrumented=replaceOnce(instrumented,'collisionGeometryAt(t,onlyKey=null){','collisionGeometryAt(t,onlyKey=null){__collisionAudit.geometrySamples++;');
  instrumented=replaceOnce(instrumented,'for(let n=0;n<14;n++){','for(let n=0;n<14;n++){__collisionAudit.bisections++;');
  instrumented=replaceOnce(instrumented,'for(const alternative of c.separationAxes??[]){','for(const alternative of c.separationAxes??[]){__collisionAudit.deepAlternativeReads++;');
  instrumented=replaceOnce(instrumented,'if(candidateMass>1e-9&&candidateCost<cost){','if(candidateMass>1e-9&&candidateCost<cost){__collisionAudit.deepAlternativeChoices++;');
  const url=data(relocate(instrumented+'\nexport {panelContact as probePanelContact,__collisionAudit};\n// '+tag,logical));
  const module=await import(url);bindSource??=await fs.readFile(new URL('../../public/physics/weapon-bind.js',import.meta.url),'utf8');
  const bind=await import(data(relocate(bindSource,new URL('../../public/physics/weapon-bind.js',import.meta.url),{'./articulated-rig.js':url})+'\n// '+tag));
  return {...module,bind,sourceHash:hash(source),reset(){for(const key of Object.keys(module.__collisionAudit))module.__collisionAudit[key]=0;}};
}
export async function collisionModules({fixedContactReference=false}={}){
  const bytes=await fs.readFile(new URL('./articulated-rig-pre-collision-1.13.js.txt',import.meta.url));
  assert.equal(hash(bytes),BASELINE_SHA,'immutable published 1.13 rig, not regenerated from candidate');
  let current=await fs.readFile(process.env.RIG_COLLISION_114_SOURCE?new URL(process.env.RIG_COLLISION_114_SOURCE,new URL('../../',import.meta.url)):logical,'utf8');
  const bindBytes=await fs.readFile(new URL('./weapon-bind-pre-query-1.13.js.txt',import.meta.url));
  assert.equal(hash(bindBytes),'96250b199cac641d405f98d0180441e1ffe889754325480557e9fd5c804b7e9a','immutable 1.13 bind counterpart');
  const bindSource=process.env.WEAPON_BIND_114_SOURCE?await fs.readFile(new URL(process.env.WEAPON_BIND_114_SOURCE,new URL('../../',import.meta.url)),'utf8'):null;
  // A cache oracle must use the SAME corrected contact algorithm on both
  // sides. The frozen 1.13 rig has no query factory, so its bind takes the
  // original default-trial path. Raw rig/bind fixtures remain hash-protected.
  const referenceBind=fixedContactReference?(bindSource??await fs.readFile(new URL('../../public/physics/weapon-bind.js',import.meta.url),'utf8')):bindBytes.toString('utf8');
  if(process.env.WATER_DUEL_TEST_QUERY_MUTATION==='snapshot-normal')current=replaceOnce(current,'normal:metric.normal,tangent:metric.tangent,cross:metric.cross,','normal:metric.normal+(prepared.layouts?1e-6:0),tangent:metric.tangent,cross:metric.cross,');
  return {reference:await loadCollisionRig(bytes.toString('utf8'),'reference-114',{bindSource:referenceBind}),candidate:await loadCollisionRig(current,'candidate-114',{bindSource})};
}

export function collisionPair(module,{dir=1,scale=1,weapon='sword',grip='normal',damage='none',flex=true,sweep=true,mixed=false,deep=false}={}){
  const w=getWeapon({weapon}),defense=w.twoHanded?'none':'knife';
  return [1,-1].map((side,index)=>{
    const size=mixed&&index?1.18:scale;
    const r=new module.ArticulatedRig({dir:dir*side,scale:size,baseX:-dir*side*1.53*scale,gravity:0,flexibleWeapons:flex,apronVariant:size>1.1?'boss':'normal',
      pose:{equipment:{weapon,defense,...(grip==='reverse'?{knifeGrip:grip}:{})},weaponMass:w.mass,twoHanded:w.twoHanded,gripOffset:w.gripOffset}});
    r.swordLength=w.length+(weapon==='spear'?.25:.12);r.previousSwordLength=r.swordLength-.07;
    r.defenseLength=defense==='knife'?.42:0;r.defenseRestAngle=grip==='reverse'?-1.7:.32;
    r.depth.offHand=.06;r.depth.offElbow=-.025;r.neckLateral.angle=.09*side;
    r.waterLoad={mass:.8,offset:{x:.025,y:-.04},inertia:.045,lateralInertia:.04,lateralOffset:.02};
    if(index)r.q[1]+=.025;
    r.q[14]+=.045*side;r.q[15]-=.035*side;
    if(deep){r.q[4]=1.15;r.q[5]=2.7;r.q[13]=Math.PI/4;}
    if(r.weaponFlex?.maximum){r.weaponFlex.offset=.012*side;r.weaponFlex.previousOffset=-.009*side;}
    r.pose();r.diagnostics();r.collisionPanels(); // Warm state before the mutable-input corpus.
    r.previousQ=r.q.slice();if(sweep)r.previousQ[0]-=dir*side*.35;
    for(let i=0;i<r.velocity.length;i++)r.velocity[i]=.025*Math.cos(i+index);
    r.target.set(r.q);
    if(damage==='partial')r.damageJoint('offElbow',.55);
    if(damage==='arm')r.damageJoint(index?'offElbow':'mainElbow',1);
    if(damage==='leg')r.damageJoint(index?'backKnee':'frontKnee',1);
    return r;
  });
}
export const rigState=r=>structuredClone({q:r.q,velocity:r.velocity,target:r.target,previousQ:r.previousQ,
  contacts:r.contacts,limits:r.limits,depth:r.depth,equipment:r.equipment,water:r.waterLoad,neck:r.neckLateral,
  lastImpulse:r.lastImpulse,lastReaction:r.lastReaction,pose:r.pose(),diagnostics:r.diagnostics(),panels:r.collisionPanels(),
  fragments:r.fragments.map(f=>f.snapshot()),flex:r.weaponFlex?{offset:r.weaponFlex.offset,previousOffset:r.weaponFlex.previousOffset,velocity:r.weaponFlex.velocity,energy:r.weaponFlex.energy()}:null});
export function resolveCollisionPair(module,rigs,{steel=true,heads=true}={}){
  const [a,b]=rigs,contact=steel?module.bind.resolveWeaponBind(a,b,{dt:1/120,project:false,observeVelocities:true}):null;
  const extraContacts=contact?.at?()=>module.bind.weaponBindManifold(a,b,contact):undefined;
  const result=module.ArticulatedRig.resolvePair(a,b,{headRadiiA:heads?BALLOON_RADII:null,headRadiiB:heads?BALLOON_RADII:null,extraContacts});
  return {contact,result,extra:extraContacts?.()??[],state:rigs.map(rigState)};
}
export function invalidateCollisionInputs(rigs){
  for(const [index,r] of rigs.entries()){
    r.q[0]+=r.dir*.045;r.q[13]-=.025;r.previousQ=r.q.slice();r.previousQ[0]-=r.dir*.09;
    r.previousQ[14]-=.07;r.previousQ[15]+=.06;r.swordLength+=.025;r.previousSwordLength-=.04;
    r.depth.offHand=-.012;r.depth.offElbow=.016;r.depth.mainHand=.183;r.neckLateral.angle=-.12;
    r.waterLoad.mass+=.12;r.waterLoad.offset.y-=.015;r.waterLoad.inertia+=.007;
    r.contacts[0].stance=index===0;r.contacts[0].vx=.013;r.contacts[0].x+=.008;
    r.velocity[0]=-.014;r.velocity[13]=.17;r.limits[13][1]-=.01;
    if(r.defenseLength){r.equipment={...r.equipment,knifeGrip:r.equipment.knifeGrip==='reverse'?'normal':'reverse'};r.defenseRestAngle*=-1;}
    if(r.weaponFlex?.maximum){r.weaponFlex.previousOffset=r.weaponFlex.offset;r.weaponFlex.offset=-.008;}
    r.damageJoint(index?'offShoulder':'frontKnee',1);
  }
}
