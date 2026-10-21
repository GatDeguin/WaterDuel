/** WATER DUEL · deterministic-ish fixed-timestep mechanics and procedural water.
 * This is a physically inspired prototype, NOT a Navier–Stokes solver.
 */
import {FluidVolume,buildMembraneSupport,buildCapillarySurface} from './physics/fluid.js';
import {fluidSolidColliders} from './physics/fluid-solids.js';
import {BalloonMembrane} from './physics/membrane.js';
import {ArticulatedRig,resolveRigContact,REFERENCE_STANCE,NECK_CONE} from './physics/articulated-rig.js';
import {advanceBodyEvasion,CROUCH_DEPTH} from './physics/body-evasion.js';
import {advanceLocomotion} from './physics/locomotion.js';
import {BALLOON_RADII,TABLE_TOP} from './physics/dimensions.js';
import {WEAPONS,DEFENSES,normalizeLoadout,getWeapon,getDefense} from './equipment.js';
import {observedPointVelocity,relativePointSpeed,segmentConvexPolygonContact} from './physics/equipment-contact.js';
import {segmentEllipsoidContact} from './physics/head-contact.js';
import {AutoDefense} from './auto-defense.js';
import {standbyTargets} from './physics/standby.js';
import {WorkshopEffects} from './workshop-effects.js';
import {resolveWeaponBind,firstWeaponPointContact,weaponBindManifold} from './physics/weapon-bind.js';
import {classifyEquipmentContact,contactMaterialPair} from './physics/contact-materials.js';
import {normalizeBalloonColor} from './opponent-loadouts.js';
import {BurstStepClock,burstPhysicalTime} from './physics/step-clock.js';
import {SimulationPresentation} from './simulation-presentation.js';
import {JointImpactDamage} from './physics/joint-impact.js';
import {bodyAttached,walkingStrength,weaponActor} from './physics/limb-state.js';
import {resolveDetachedContacts} from './physics/detached-contacts.js';
import {applyJointPlay} from './physics/joint-play.js';
import {TRAINING_DRILL_KINDS,trainingOpponentControl} from './training-drills.js';
import {AIPerception,loadoutTactics} from './ai-perception.js';
import {SurfaceState,wetApronFromParcels} from './physics/surface-state.js';
export const STEP = 1/120;
export const RULES=Object.freeze({roundsToWin:2,regulationSeconds:90});
// Includes the v2 resting lean, both active lean motors, boss scale and slosh.
export const FOOTWORK=Object.freeze({arenaHalfWidth:2.2,minSeparation:2.7,maxSpeed:.65,acceleration:3});
const PUNCTURE_LUNGE=.21;
// World-space volumes are game units, not metres. This explicit mass density
// maps a normally filled head's ledger to ~1.776 model mass units.
export const WATER_RIG_DENSITY=10;
function rigWaterLoad(f,head){
  const {volume,center,inertia}=f.fluid.retainedMassProperties();
  return {mass:volume*WATER_RIG_DENSITY,center,inertia:inertia.zz*WATER_RIG_DENSITY,lateralInertia:inertia.xx*WATER_RIG_DENSITY,referenceHead:head};
}
// The gameplay proxy follows the shared latex silhouette; this small skin covers its procedural ripples.
const BALLOON_COLLISION_SKIN=.006;
const AI_PROFILES={
  rookie:{observe:.8,windup:.62,recover:.95,reaction:.23,error:.17},
  normal:{observe:.56,windup:.44,recover:.72,reaction:.15,error:.07},
  expert:{observe:.38,windup:.32,recover:.56,reaction:.10,error:.025},
  // The former 1.15 s window ended on the last successful counterattack tick.
  // Elastic steel/worn hinges add real motor settling, so preserve a usable
  // exposed recovery without disabling the descending point or its contacts.
  boss:{observe:.62,windup:.60,recover:1.27,reaction:.13,error:.035}
};
export const AI_STYLES=Object.freeze(['balanced','aggressive','defender','counter','feint','precision','erratic','boss']);
const ERRATIC_RHYTHM=Object.freeze([.55,1.45,.85,1.2]);
const STYLE_PATTERNS=Object.freeze({
  aggressive:['direct','high','direct','low'],defender:['probe','direct'],
  feint:['feint','high','feint','low'],precision:['precise'],
  erratic:['low','feint','high','direct'],boss:['high','feint','heavy','low']
});
function observationDuration(style,profile,cycle){
  if(style==='defender')return 2.2;
  if(style==='counter')return 2.8;
  return profile.observe*(style==='aggressive'?.7:style==='precision'?1.25:style==='erratic'?ERRATIC_RHYTHM[cycle%4]:1);
}
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const lerp=(a,b,t)=>a+(b-a)*t;
export const length2=(x,y)=>Math.hypot(x,y);
const smooth01=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};
export const neutral=()=>({offX:0,offY:0,mainX:0,mainY:0,lean:0,wrist:0,thrust:false,guard:false});
const spring=(value,velocity,target,stiff,damp,dt)=>{
  velocity+= (stiff*(target-value)-damp*velocity)*dt;
  return [value+velocity*dt,velocity];
};
const rng=(a,b)=>a+(b-a)*Math.random();
const pointSegDist=(px,py,ax,ay,bx,by)=>{
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  const t=den>1e-9?clamp(((px-ax)*dx+(py-ay)*dy)/den,0,1):0;
  return Math.hypot(px-ax-dx*t,py-ay-dy*t);
};
// Intersect an XY profile's complete parameter interval with its finite Z
// thickness. A projected entry before the steel reaches the solid is not a hit.
function contactExtrusion(previous,tip,query,min,max){
  const entry=query(previous,tip),reverse=entry&&query(tip,previous);
  if(!entry||!reverse)return null;
  const z0=previous.z??.17,z1=tip.z??.17,dz=z1-z0;
  let enter=entry.t,exit=1-reverse.t,depthEntry=-Infinity;
  if(Math.abs(dz)<1e-14){if(z0<min-1e-12||z0>max+1e-12)return null;}
  else{
    const a=(min-z0)/dz,b=(max-z0)/dz;
    depthEntry=Math.min(a,b);enter=Math.max(enter,depthEntry);exit=Math.min(exit,Math.max(a,b));
  }
  if(enter>exit+1e-12||enter>1+1e-12||exit<0)return null;
  const t=clamp(enter,0,1),point={x:lerp(previous.x,tip.x,t),y:lerp(previous.y,tip.y,t),z:lerp(z0,z1,t)};
  return {...entry,t,point,surfacePoint:{...point},startedInside:t===0,
    ...(depthEntry>entry.t?{normal:{x:0,y:0,z:-Math.sign(dz)}}:{})};
}
export function parryContact(previous,tip,pose,defense){
  if(defense.kind==='shield'){
    const rx=pose.shieldRadiusX??pose.shieldRadius,ry=pose.shieldRadiusY??pose.shieldRadius;
    const z=pose.offHand.z??.10,min=pose.shieldDepth?.min??z+defense.guardDepthMin,max=pose.shieldDepth?.max??z+defense.guardDepthMax;
    if(defense.contactProfiles)return defense.contactProfiles.map(profile=>contactExtrusion(previous,tip,
      (a,b)=>segmentConvexPolygonContact(a,b,profile,pose.offHand,rx,ry),min,max)).filter(Boolean).sort((a,b)=>a.t-b.t)[0]??null;
    return contactExtrusion(previous,tip,(a,b)=>segmentEllipseContact(a,b,pose.offHand.x,pose.offHand.y,rx,ry),min,max);
  }
  if(defense.kind!=='knife'||!pose.defenseTip)return null;
  const a=pose.offHand,b=pose.defenseTip,dx=b.x-a.x,dy=b.y-a.y,dz=(b.z??.17)-(a.z??.17),length=Math.hypot(dx,dy,dz),xy=Math.hypot(dx,dy);
  if(length<1e-6)return null;
  const u=[dx/length,dy/length,dz/length],v=xy>1e-8?[-dy/xy,dx/xy,0]:[1,0,0];
  const w=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],center=[(a.x+b.x)/2,(a.y+b.y)/2,((a.z??.17)+(b.z??.17))/2];
  const local=p=>{const d=[p.x-center[0],p.y-center[1],(p.z??.17)-center[2]],dot=q=>d.reduce((sum,x,i)=>sum+x*q[i],0);return {x:dot(u),y:dot(v),z:dot(w)};};
  // A finite thin blade profile follows both the XY angle and the actual depth
  // from its moving hand to its tip; the handle does not become a shield.
  const hit=contactExtrusion(local(previous),local(tip),(p,q)=>segmentEllipseContact(p,q,0,0,length/2,.055),-.012,.012);
  if(!hit)return null;
  const point={x:lerp(previous.x,tip.x,hit.t),y:lerp(previous.y,tip.y,hit.t),z:lerp(previous.z??.17,tip.z??.17,hit.t)};
  return {...hit,point,surfacePoint:{...point}};
}
function strikePoints(tip,direction,weapon){
  return (weapon.strikePoints??[{along:0,across:0}]).map(({along,across})=>({
    x:tip.x+direction.x*along+direction.y*across,
    y:tip.y+direction.y*along-direction.x*across,z:tip.z??.17
  }));
}
export function sweptEllipse(prev,now,cx,cy,rx,ry){
  return segmentEllipseContact(prev,now,cx,cy,rx,ry)!==null;
}
export function segmentEllipseContact(prev,now,cx,cy,rx,ry,forward=null){
  if(![prev.x,prev.y,now.x,now.y,cx,cy,rx,ry].every(Number.isFinite)||rx<=0||ry<=0)return null;
  const ax=(prev.x-cx)/rx,ay=(prev.y-cy)/ry,dx=(now.x-prev.x)/rx,dy=(now.y-prev.y)/ry;
  const a=dx*dx+dy*dy,b=2*(ax*dx+ay*dy),c=ax*ax+ay*ay-1;
  const startedInside=c<=1e-12;
  let t=0;
  if(!startedInside){
    if(a<1e-18)return null;
    const discriminant=b*b-4*a*c,tolerance=1e-12*Math.max(1,b*b,Math.abs(4*a*c));
    if(discriminant < -tolerance)return null;
    t=(-b-Math.sqrt(Math.max(0,discriminant)))/(2*a);
    if(t < -1e-12||t > 1+1e-12)return null;
    t=clamp(t,0,1);
  }
  const point={x:lerp(prev.x,now.x,t),y:lerp(prev.y,now.y,t)};
  const fromZ=prev.z??now.z,toZ=now.z??prev.z;
  if(Number.isFinite(fromZ)&&Number.isFinite(toZ))point.z=lerp(fromZ,toZ,t);
  let ix=now.x-prev.x,iy=now.y-prev.y,iz=(toZ??0)-(fromZ??0),speed=Math.hypot(ix,iy,iz);
  if(speed<1e-12&&forward){ix=forward.x;iy=forward.y;iz=forward.z??0;speed=Math.hypot(ix,iy,iz);}
  const incoming=speed>1e-12?{x:ix/speed,y:iy/speed,z:iz/speed}:{x:0,y:0,z:0};
  const surfacePoint={...point};
  if(startedInside){
    // First observed overlap is t=0. Effects use the nearest radial surface; at
    // the exact center, use the side opposite incoming motion (or a fixed left side).
    let sx=ax,sy=ay,size=Math.hypot(sx,sy);
    if(size<1e-12){sx=-incoming.x/rx;sy=-incoming.y/ry;size=Math.hypot(sx,sy);}
    if(size<1e-12){sx=-1;sy=0;size=1;}
    surfacePoint.x=cx+rx*sx/size;surfacePoint.y=cy+ry*sy/size;
  }
  const nx=(surfacePoint.x-cx)/(rx*rx),ny=(surfacePoint.y-cy)/(ry*ry),magnitude=Math.hypot(nx,ny);
  return {t,point,surfacePoint,normal:{x:nx/magnitude,y:ny/magnitude},incoming,startedInside};
}
const ccw=(a,b,c)=>(c.y-a.y)*(b.x-a.x)>(b.y-a.y)*(c.x-a.x);
export function intersects2D(a,b,c,d){return ccw(a,c,d)!==ccw(b,c,d)&&ccw(a,b,c)!==ccw(a,b,d);}
function reachableHand(shoulder,target,l1,l2,dir){
  const dx=target.x-shoulder.x,dy=target.y-shoulder.y,distance=Math.hypot(dx,dy);
  const reach=clamp(distance,Math.abs(l1-l2)+.005,l1+l2-.005);
  if(distance<1e-9)return {...target,x:shoulder.x+dir*reach,y:shoulder.y};
  return {...target,x:shoulder.x+dx*reach/distance,y:shoulder.y+dy*reach/distance};
}
function ik2(s,t,l1,l2,bend=-1){
  let vx=t.x-s.x,vy=t.y-s.y;
  let dist=Math.max(.0001,Math.hypot(vx,vy));
  const reach=l1+l2-.005;
  if(dist>reach){vx*=reach/dist;vy*=reach/dist;dist=reach;}
  const along=(l1*l1-l2*l2+dist*dist)/(2*dist);
  const height=Math.sqrt(Math.max(0,l1*l1-along*along));
  const nx=vx/dist,ny=vy/dist;
  return {x:s.x+nx*along-ny*height*bend,y:s.y+ny*along+nx*height*bend};
}
export function initialFighter(slot,equipment,balloonColor){
  const dir=slot===1?1:-1;
  return {
    slot,dir,equipment:normalizeLoadout(equipment),balloonColor:normalizeBalloonColor(balloonColor,slot),matchApronToBalloon:false,boss:false,baseX:dir===1?-1.53:1.53,baseVX:0,lean:0,leanVel:0,
    mainX:0,mainXV:0,mainY:0,mainYV:0,offX:0,offXV:0,offY:0,offYV:0,
    lunge:0,lungeCool:0,wasThrust:false,recoil:0,guard:false,guardEnergy:1,guardBroken:false,
    globIntact:true,balloonSize:1,balloonMass:1.15,waterShift:0,waterV:0,
    hitFlash:0, previousTip:null, pose:null,gripAdjustment:0,surfaceState:new SurfaceState(),
    ai:{state:'observe',time:0,duration:0,cycle:0,pattern:'direct',phase:1,threatTime:0,aimY:0,initialized:false,attackIssued:false},
    controller:neutral(),lastInputAt:0, connected:false,autoDefense:new AutoDefense({seed:Math.imul(slot,0x9e3779b1)}),perception:new AIPerception(),
    fluid:new FluidVolume(slot,200),membrane:new BalloonMembrane({fractureModel:'energy'}),balloon:{stress:0,wave:0,pressure:1,ruptureAge:-1,tearAngle:0},
    torsoTwist:0,twistVel:0,footSlip:0,headVelocity:{vx:0,vy:0,vz:0},headLast:null
  };
}

export class DuelEngine{
  constructor(event=()=>{}){
    this.effects=new WorkshopEffects();
    this.jointContacts=[];this.jointImpactDamage=new JointImpactDamage();
    this.onEvent=(name,data)=>{this.effects.emit(name,data);event(name,data);};
    this.mode='solo';this.difficulty='normal';this.arena='atelier';this.phase='ready';
    this.bestOf=3;this.scenario='duel';this.trainingDrill=null;this.demonstration=false;this.aiStyle='balanced';
    this.clock=0;this.elapsed=0;this.phaseClock=0;this.count=3;
    this.burstStepClock=new BurstStepClock(STEP);
    this.presentation=new SimulationPresentation();
    this.scores=[0,0];this.round=1;this.winner=0;
    this.loadouts=[normalizeLoadout(),normalizeLoadout()];
    this.balloonColors=['mint','amber'];this.matchApronToBalloon=false;
    this.fighters=this.loadouts.map((loadout,index)=>initialFighter(index+1,loadout,this.balloonColors[index]));
    this.fighters[1].matchApronToBalloon=this.mode==='solo'&&this.matchApronToBalloon===true;
    const enemy=this.fighters[1];enemy.boss=this.mode==='solo'&&this.difficulty==='boss';
    if(enemy.boss){enemy.balloonSize=1.16;enemy.balloonMass=1.62;enemy.fluid=new FluidVolume(2,260,enemy.balloonSize);enemy.membrane=new BalloonMembrane({scale:enemy.balloonSize,fractureModel:'energy'});}
    this.particles=[];this.shards=[];this.rings=[];this.spark=[];
    this.lastBodyContacts=[];this.materialContactTimes=new Map();this.guardContactEpisodes=new Set();
    this.fluidVersion=1;
    this.quality='high';this.aiEnabled=true;this.puddleStrength=[0,0];this.suddenDeath=false;
    this.eventNo=0;this.lastMessage='Prepará tu arma';this.nextClang=0;
    // The very first animation frame may have dt < STEP: renderable poses must exist.
    this.fighters.forEach(f=>this.initializeRig(f));
  }
  setMode(mode){if(!['solo','versus'].includes(mode))return;this.mode=mode;this.resetMatch();}
  setBalloonColor(slot,color){
    if(![1,2].includes(slot)||!['ready','matchover'].includes(this.phase))return false;
    this.balloonColors[slot-1]=normalizeBalloonColor(color,slot);
    this.fighters[slot-1].balloonColor=this.balloonColors[slot-1];return true;
  }
  setLoadout(slot,selection){
    if(![1,2].includes(slot)||!['ready','matchover'].includes(this.phase)||!selection||typeof selection!=='object'||Array.isArray(selection))return false;
    const has=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
    if(has(selection,'weapon')&&!has(WEAPONS,selection.weapon)||has(selection,'defense')&&!has(DEFENSES,selection.defense))return false;
    const loadout=normalizeLoadout({...this.loadouts[slot-1],...selection});
    this.loadouts[slot-1]=loadout;
    const fighter=this.fighters[slot-1];fighter.equipment={...loadout};fighter.guard=false;
    this.initializeRig(fighter);fighter.previousTip={...fighter.pose.tip};
    return true;
  }
  get roundsToWin(){return (this.bestOf+1)/2;}
  setBestOf(value){
    if(![3,5].includes(value)||!['ready','matchover'].includes(this.phase))return false;
    this.bestOf=value;return true;
  }
  setScenario(value){
    if(!['duel','practice'].includes(value)||!['ready','matchover'].includes(this.phase))return false;
    this.scenario=value;if(value!=='practice')this.trainingDrill=null;return true;
  }
  setTrainingDrill(config){
    if(!['ready','matchover'].includes(this.phase)||this.scenario!=='practice')return false;
    if(config===null){this.trainingDrill=null;return true;}
    if(!config||typeof config!=='object'||!TRAINING_DRILL_KINDS.includes(config.kind))return false;
    this.trainingDrill={kind:config.kind};return true;
  }
  setAIStyle(value){
    if(!AI_STYLES.includes(value)||!['ready','matchover'].includes(this.phase))return false;
    this.aiStyle=value;return true;
  }
  setArena(id){if(['atelier','midnight','dojo'].includes(id))this.arena=id;}
  setDifficulty(id){if(['rookie','normal','expert','boss'].includes(id)){this.difficulty=id;if(this.phase==='ready'||this.phase==='matchover')this.resetMatch();}}
  resetMatch(){
    this.phase='ready';this.phaseClock=0;this.scores=[0,0];this.round=1;this.winner=0;this.suddenDeath=false;this.demonstration=false;
    this.resetRound();this.onEvent('reset',{mode:this.mode});
  }
  resetRound(){
    this.burstStepClock.reset();
    this.presentation.reset();
    this.guardContactEpisodes.clear();
    this.jointContacts=[];this.jointImpactDamage=new JointImpactDamage();
    this.fighters=this.loadouts.map((loadout,index)=>initialFighter(index+1,loadout,this.balloonColors[index]));
    this.fighters[1].matchApronToBalloon=this.mode==='solo'&&this.matchApronToBalloon===true;
    const enemy=this.fighters[1];enemy.boss=this.mode==='solo'&&this.difficulty==='boss';
    if(enemy.boss){
      enemy.balloonSize=1.16;enemy.balloonMass=1.62;enemy.fluid=new FluidVolume(2,260,enemy.balloonSize);enemy.membrane=new BalloonMembrane({scale:enemy.balloonSize,fractureModel:'energy'});
      // The taller arm's resting point is near the smaller opponent's head.
      // Spawn both rigs with visible clearance; ordinary footwork can close it.
      for(const f of this.fighters)f.baseX=-f.dir*1.75;
    }
    this.particles=[];this.shards=[];this.rings=[];this.spark=[];
    this.fluidVersion=1;this.puddleStrength=[0,0];
    this.elapsed=0;this.suddenDeath=false;this.winner=0;
    this.count=3;this.lastMessage='Prepará tu arma';this.nextClang=0;
    this.fighters.forEach(f=>this.initializeRig(f));
  }
  start(){
    if(this.phase!=='ready'&&this.phase!=='matchover')return;
    if(this.phase==='matchover')this.resetMatch();
    this.#startRound();
  }
  #startRound(){
    this.resetRound();this.phase='countdown';this.phaseClock=0;this.count=3;this.lastMessage='Que gane la precisión';
    this.onEvent('start',{round:this.round});
  }
  setControl(slot,state,{connected=false}={}){
    const f=this.fighters[slot-1];if(!f)return;
    const v=x=>{const n=Number(x);return Number.isFinite(n)?clamp(n,-1,1):0;};
    f.controller={offX:v(state.offX),offY:v(state.offY),mainX:v(state.mainX),mainY:v(state.mainY),lean:v(state.lean),wrist:v(state.wrist),thrust:!!state.thrust,guard:!!state.guard,
      ...(state.attackHeld===true?{attackHeld:true}:{}),
      ...(Object.hasOwn(state,'headX')?{headX:v(state.headX)}:{}),...(Object.hasOwn(state,'headZ')?{headZ:v(state.headZ)}:{}),
      ...(Object.hasOwn(state,'bodyY')?{bodyY:v(state.bodyY)}:{})};
    if(connected)f.connected=true;
    f.lastInputAt=this.clock;
  }
  disconnect(slot){const f=this.fighters[slot-1];if(f){f.controller=neutral();f.connected=false;}}
  update(dt){
    dt=clamp(dt,0,.04);
    if(!dt)return;
    this.clock+=dt;
    if(this.phase==='countdown'){
      const old=this.count;this.phaseClock+=dt;
      this.count=Math.max(0,3-Math.floor(this.phaseClock));
      if(old!==this.count)this.onEvent('countdown',{count:this.count});
      if(this.phaseClock>=3.2){this.phase='fight';this.phaseClock=0;this.onEvent('fight',{round:this.round});}
    }else if(this.phase==='fight'){
      this.phaseClock+=dt;this.elapsed+=dt;
      if(this.elapsed>=RULES.regulationSeconds&&!this.suddenDeath){this.suddenDeath=true;this.lastMessage='MUERTE SÚBITA';this.onEvent('overtime',{round:this.round});}
    }else if(this.phase==='burst'){
      const from=this.phaseClock,origin=this.clock-dt-from;
      this.burstStepClock.origin??=origin;
      this.phaseClock+=dt;
      const realClock=this.clock;
      this.burstStepClock.advance(from,this.phaseClock,(step,at)=>{
        // Time-dependent support/FX sample the physical step's exact crossing
        // on the real burst timeline, independently of presentation cadence.
        this.clock=this.burstStepClock.origin+at;this.stepPhysics(step);
      },{flush:this.phaseClock>3.25});
      this.clock=realClock;
      if(this.phaseClock>3.25){
        if(this.scenario!=='practice'&&this.scores.some(v=>v>=this.roundsToWin)){this.phase='matchover';this.onEvent('matchover',{winner:this.winner,demonstration:this.demonstration});}
        else{if(this.winner!==0)this.round++;this.#startRound();}
      }
      return;
    }
    if(this.mode==='solo'){
      const drill=this.phase==='fight'&&this.scenario==='practice'&&this.trainingDrill?trainingOpponentControl(this.trainingDrill.kind,this):null;
      if(drill)this.setControl(2,drill);
      else if(this.aiEnabled&&this.phase==='fight')this.updateAI(this.fighters[1],dt);
      else if(!this.aiEnabled)this.fighters[1].controller=neutral();
    }
    this.stepPhysics(dt);
  }
  stepPhysics(physicalDt){
    if(this.phase==='burst'&&!this.presentation.matches(this))this.presentation.capture(this);
    this.lastPhysicalDt=physicalDt;
    this.updateFootwork(physicalDt);
    for(const f of this.fighters)this.updateFighter(f,physicalDt,{deferSupport:true});
    this.solveFighterContacts(physicalDt);
    for(const f of this.fighters)this.updateFighterSupport(f,physicalDt);
    if(this.phase==='fight')this.detectHits();
    this.applyJointDamage(physicalDt);
    this.updateWater(physicalDt);
    this.effects.step(physicalDt,this.clock);
    if(this.phase==='burst')this.presentation.capture(this);
  }
  presentationState(realRemainder=0){
    const extra=burstPhysicalTime(this.phaseClock+Math.max(0,realRemainder))-burstPhysicalTime(this.phaseClock);
    return this.presentation.view(this,(this.burstStepClock.remainder+extra)/STEP);
  }
  updateAI(f,dt){
    const target=this.fighters.find(other=>other!==f),ai=f.ai,profile=AI_PROFILES[this.difficulty],weapon=getWeapon(f),defense=getDefense(f);
    const sensed=f.perception.observe(f,target,dt,{difficulty:this.difficulty,occluders:()=>[...f.rig.collisionPanels(),...target.rig.collisionPanels()].filter(p=>p.body!=='weapon')});
    ai.attentionLost=!sensed?.head;ai.targetVisible=!!sensed?.headVisible;
    if(!sensed){this.setControl(f.slot,{...neutral(),mainX:-.3,mainY:-.2,offX:.6,offY:.8});return;}
    if(!sensed.head){
      // A point can be visible while the balloon is hidden. Read only that
      // observed threat, hold position and offer a finite secondary guard;
      // there is no aim/approach/thrust toward an unknown head position.
      const own=f.pose.head,tip=sensed.tip,v=sensed.velocity;
      const approaching=sensed.tipVisible&&sensed.armed&&Math.abs(tip.z-own.z)<BALLOON_RADII.z*f.balloonSize+.1&&
        v.vx*(own.x-tip.x)+v.vy*(own.y-tip.y)>.25&&Math.hypot(own.x-tip.x,own.y-tip.y)<1.7&&
        pointSegDist(own.x,own.y,tip.x,tip.y,tip.x+v.vx*.45,tip.y+v.vy*.45)<BALLOON_RADII.y*f.balloonSize+.20;
      ai.threatTime=approaching?ai.threatTime+dt:0;
      const guard=defense.canGuard&&bodyAttached(f,'offForearm')&&!f.guardBroken&&f.guardEnergy>.35&&ai.threatTime>=profile.reaction;
      this.setControl(f.slot,{...neutral(),mainX:-.3,mainY:-.2,offX:guard?1:.6,offY:guard?.9:.8,guard});return;
    }
    const tactics=loadoutTactics(f.equipment,sensed.equipment);ai.tactic=tactics.name;
    const style=AI_STYLES.includes(this.aiStyle)?this.aiStyle:'balanced';
    const scale=f.boss?1.18:1;
    ai.phase=f.boss&&this.scores[0]>0?2:1;
    const cautious=style==='defender'||style==='counter',maxWait=style==='defender'?2.2:2.8;
    const windup=profile.windup*(ai.phase===2?.85:1)*(style==='precision'?1.25:1)*(f.boss&&ai.cycle===0?1.45:1);
    const recovery=profile.recover*tactics.recoverScale*(ai.phase===2?.9:1)*(style==='aggressive'?.85:style==='defender'||style==='precision'?1.1:style==='boss'&&ai.pattern==='heavy'?1.25:style==='erratic'?[.8,1.2,1,.9][ai.cycle%4]:1);
    if(!ai.initialized){ai.initialized=true;this.#setAIState(f,'observe',f.boss?Math.max(1.35,observationDuration(style,profile,ai.cycle)):observationDuration(style,profile,ai.cycle)*tactics.observeScale);}
    ai.time+=dt;
    const attack=sensed.armed?sensed:null,head=sensed.head,tip=sensed.tip??head;
    // React to observed blade motion, never to a future button press or a fabricated hit.
    const vx=sensed.velocity.vx,vy=sensed.velocity.vy;
    const toHeadX=f.pose.head.x-tip.x,toHeadY=f.pose.head.y-tip.y;
    const approaching=vx*toHeadX+vy*toHeadY>.25&&Math.hypot(toHeadX,toHeadY)<1.7;
    const threatened=sensed.tipVisible&&!!attack&&(attack.lunge>PUNCTURE_LUNGE||approaching)&&Math.abs(tip.z-f.pose.head.z)<BALLOON_RADII.z*f.balloonSize+.1&&pointSegDist(f.pose.head.x,f.pose.head.y,
      tip.x,tip.y,tip.x+vx*.45,tip.y+vy*.45)<BALLOON_RADII.y*f.balloonSize+.20;
    ai.threatTime=threatened?ai.threatTime+dt:0;
    if(cautious){
      // The opportunity starts when an already observed threat recedes. Waiting
      // survives defensive state transitions, so passive opponents cannot freeze
      // the encounter and repeated feints cannot restart the deadline forever.
      ai.patience=(ai.patience||0)+dt;
      ai.counterWindow=Math.max(0,(ai.counterWindow||0)-dt);
      if(ai.threatTime>=profile.reaction)ai.sawThreat=true;
      if(ai.sawThreat&&ai.lastThreat&&!threatened)ai.counterWindow=1.8;
      ai.lastThreat=threatened;
    }
    const lead=clamp((sensed.headVelocity.vy||0)*(style==='precision'?.18:.10),style==='precision'?-.15:-.10,style==='precision'?.15:.10)+tactics.aimBias;
    const aim=clamp((head.y+lead-f.pose.mainShoulder.y-REFERENCE_STANCE.mainRise*scale)/(.46*scale+.58),-1,1);
    const hand=f.pose.mainHand,blade=f.pose.tip;
    // Aim into the observed volume. Treating its near silhouette as the arm's
    // destination left the dynamic point skimming outside the XYZ section.
    const aimX=head.x;
    const actualAngle=Math.atan2(blade.y-hand.y,f.dir*(blade.x-hand.x));
    const targetAngle=Math.atan2(head.y+lead-hand.y,Math.max(.3,f.dir*(aimX-hand.x)));
    const alignment=Math.abs(Math.atan2(Math.sin(targetAngle-actualAngle),Math.cos(targetAngle-actualAngle)));
    const prepared=f.dir*(hand.x-f.pose.mainShoulder.x)>.78*scale&&alignment<.085;
    if(style!=='balanced'){
      // Predict only the reach of our own currently observed blade direction.
      // This is not a hit/result oracle: actual swept contact still decides it.
      const length=Math.hypot(blade.x-hand.x,blade.y-hand.y)||1;
      const pulseLength=(weapon.length+weapon.lungeReach*Math.exp(-STEP*weapon.lungeDecay)+weapon.extension)*(f.boss?1.05:1);
      const x=hand.x+(blade.x-hand.x)/length*pulseLength,y=hand.y+(blade.y-hand.y)/length*pulseLength;
      const rx=BALLOON_RADII.x*sensed.balloonSize,ry=BALLOON_RADII.y*sensed.balloonSize;
      ai.projectedReach=pointSegDist(0,0,(hand.x-head.x)/rx,(hand.y-head.y)/ry,(x-head.x)/rx,(y-head.y)/ry);
      ai.readyToThrust=ai.projectedReach<=1;
    }
    // Follow through after visibly committing the preparation. A passive blade
    // moved upward by body contact must not cancel every slow rookie attack.
    // Early observed threats still get the full profile reaction delay, and a
    // committed attack remains physically exposed to a parry or counterattack.
    const mayInterrupt=ai.state!=='windup'||ai.time<ai.duration*(f.boss?.35:.65);
    if(defense.canGuard&&mayInterrupt&&['observe','windup','feint'].includes(ai.state)&&ai.threatTime>=profile.reaction&&!f.guardBroken&&f.guardEnergy>.35&&
      !(cautious&&(ai.committed||ai.patience>=maxWait))){
      this.#setAIState(f,'defend',style==='defender'?.48:.32);
    }
    const attackReach=1.04*scale+weapon.reach*(f.boss?1.05:1)+BALLOON_RADII.x*sensed.balloonSize-.12;
    const opportunity=cautious&&ai.counterWindow>0&&ai.time>=.18;
    if(ai.state==='observe'&&(ai.time>=ai.duration||opportunity||cautious&&ai.patience>=maxWait)&&Math.abs(head.x-f.pose.mainShoulder.x)<attackReach){
      const patterns=ai.phase===2?['feint','high','low']:['high','low','feint'];
      const stylePatterns=style==='boss'&&ai.phase===2?['feint','high','heavy','low']:STYLE_PATTERNS[style];
      ai.pattern=style==='counter'?(opportunity?'counter':'probe'):stylePatterns?stylePatterns[ai.cycle%stylePatterns.length]:f.boss?patterns[ai.cycle%patterns.length]:'direct';
      ai.aimY=clamp(aim+profile.error*(style==='precision'?.2:1)*(ai.cycle%2===0?1:-1),-1,1);
      if(cautious)ai.committed=true;
      this.#setAIState(f,ai.pattern==='feint'?'feint':'windup',ai.pattern==='feint'?.28:windup*(style==='boss'&&ai.pattern==='heavy'?1.25:1));
    }else if(ai.state==='feint'&&ai.time>=ai.duration){
      this.#setAIState(f,'windup',windup);
    }else if(ai.state==='windup'&&sensed.headVisible&&ai.time>=ai.duration&&f.lungeCool<=0&&
      (style==='balanced'?(prepared||ai.time>=ai.duration+.6):ai.readyToThrust)){
      this.#setAIState(f,'attack',.23);
      if(cautious){ai.patience=0;ai.counterWindow=0;ai.sawThreat=false;ai.committed=false;}
    }else if(ai.state==='attack'&&ai.time>=ai.duration){
      this.#setAIState(f,'recover',recovery);
    }else if(ai.state==='defend'&&(ai.time>=ai.duration||f.guardBroken)){
      this.#setAIState(f,'recover',f.boss?recovery:style==='defender'?.55:.4);
    }else if(ai.state==='recover'&&ai.time>=ai.duration){
      ai.cycle++;this.#setAIState(f,'observe',observationDuration(style,profile,ai.cycle)*tactics.observeScale);
    }
    const c={...neutral(),mainX:this.difficulty==='expert'?.7:.35,mainY:aim,offX:1,offY:.85,lean:1};
    if(style==='aggressive'&&ai.state==='observe'){c.mainX=.75;c.offX=.7;c.offY=.7;}
    if(ai.state==='observe'){
      if(style==='defender'){c.mainX=-.15;c.offX=.65;c.offY=1;c.lean=ai.patience>=maxWait?1:.08;}
      else if(style==='counter'){c.mainX=.2;c.offX=.85;c.offY=.9;c.lean=ai.patience>=maxWait?1:.25;}
      else if(style==='precision'){c.mainX=1;c.offX=.8;c.offY=.65;}
      else if(style==='erratic'){c.mainX=.45+.25*Math.sin(ai.time*5+ai.cycle*1.7);c.mainY=clamp(aim+.12*Math.sin(ai.time*7),-1,1);c.offX=.55+.4*Math.sin(ai.time*4);c.offY=.5+.35*Math.cos(ai.time*3);c.lean=.65+.35*Math.sin(ai.time*3+ai.cycle);}
      else if(style==='boss'){c.mainX=.55;c.offX=.5;c.offY=.8;c.lean=ai.phase===2?1:.6;}
    }
    if(ai.state==='windup'){
      const cue=(ai.pattern==='high'?.25:ai.pattern==='low'?-.35:ai.pattern==='heavy'?-.18:0)*
        (style==='balanced'?1:clamp(1-ai.time/(ai.duration*.55),0,1));
      // The articulated shoulder and wrist need the whole visible windup to
      // settle. Retraction until the last .28 s consumed the lunge before the
      // physical arm reached its range, so a passive retreat became invulnerable.
      c.mainX=1;c.mainY=clamp(ai.aimY+cue,-1,1);
      c.lean=1;
    }else if(ai.state==='feint'){
      c.mainX=.8;c.mainY=clamp(ai.aimY+.25,-1,1);c.lean=.5;
      if(style==='feint'){c.offX=.4;c.offY=.2;}
    }else if(ai.state==='attack'){
      c.mainX=1;c.mainY=ai.aimY;c.thrust=!ai.attackIssued;
      if(c.thrust)ai.attackIssued=true;
    }else if(ai.state==='recover'){
      c.mainX=-.6;c.mainY=-.3;c.offX=.25;c.offY=0;c.lean=f.boss?1:.25;
    }else if(ai.state==='defend'){
      // Full vertical reach clips the two-link arm and pulls its disk behind
      // the front of the balloon. Leave a small bend for a reachable parry.
      c.mainX=-.5;c.offX=1;c.offY=.9;c.lean=-.65;c.guard=true;
    }
    if(['observe','windup','attack','feint'].includes(ai.state)&&!cautious){
      // The wider reference stance already carries the hand far forward. Keep
      // the observed point in front of the near side of the balloon before
      // committing a thrust, instead of walking a long spear through the target
      // and aiming its harmless shaft at the centre indefinitely.
      const gap=f.dir*(head.x-f.pose.tip.x),standOff=BALLOON_RADII.x*sensed.balloonSize+weapon.lungeReach*.35+tactics.spacing;
      c.lean=clamp((gap-standOff)*3,-1,1);
    }
    // The expert's nominal preparation reserves a bent elbow and raises the
    // point with its wrist; contact feedback below may request more arm lift.
    if(((this.difficulty==='expert'&&style!=='erratic')||style==='precision')&&['observe','windup','attack'].includes(ai.state))c.mainY=Math.min(c.mainY,.42);
    if(['observe','windup','attack','feint'].includes(ai.state)){
      // Aim through the actual hand and target, rather than treating an IK
      // intention as an already achieved arm pose. The wrist is still the same
      // limited dynamic motor available to the human controller.
      const hand=f.pose.mainHand,range=Math.max(.3,f.dir*(aimX-hand.x));
      const error=profile.error*(ai.cycle%2===0?1:-1)*(style==='precision'?.04:.2);
      const desired=Math.atan2(head.y+lead+error-hand.y,range);
      const pulse=c.thrust?Math.exp(-STEP*weapon.lungeDecay):f.lunge;
      const length=(weapon.length+weapon.lungeReach*pulse+weapon.extension*c.mainX)*(f.boss?1.05:1);
      c.wrist=clamp((desired-Math.atan2(.58*c.mainY,length))/(Math.PI/4),-1,1);
    }
    if(['observe','windup','attack','feint'].includes(ai.state)&&!(f.boss&&ai.cycle===0&&ai.state==='observe'&&ai.time<ai.duration)){
      // A requested IK pose is not an achieved aim. Contact can hold the blade
      // below the opponent's wooden arm while its wrist reaches the stop.
      // Close the loop on the observed point and move out before lifting it.
      const hand=f.pose.mainHand,point=f.pose.tip;
      const desired=Math.atan2(head.y+lead-hand.y,Math.max(.3,f.dir*(aimX-hand.x)));
      const actual=Math.atan2(point.y-hand.y,f.dir*(point.x-hand.x));
      const error=Math.atan2(Math.sin(desired-actual),Math.cos(desired-actual));
      c.mainY=clamp(c.mainY+.9*error,-1,1);c.wrist=clamp(c.wrist+error,-1,1);
      if(!cautious||ai.committed||ai.patience>=maxWait){
        const standOff=BALLOON_RADII.x*sensed.balloonSize+weapon.lungeReach*.16+tactics.spacing;
        const gap=Math.hypot(head.x-hand.x,head.y-hand.y)-Math.hypot(point.x-hand.x,point.y-hand.y)-standOff;
        c.lean=clamp(gap*3,-1,1);
      }
      ai.blockedAimTime=Math.abs(error)>.35?(ai.blockedAimTime||0)+dt:0;
      ai.disengageCooldown=Math.max(0,(ai.disengageCooldown||0)-dt);
      if(ai.blockedAimTime>.35&&!ai.disengage&&!ai.disengageCooldown){ai.disengage='withdraw';ai.disengageTime=0;}
      if(ai.disengage){
        ai.disengageTime+=dt;c.thrust=false;c.mainX=-1;c.mainY=1;c.wrist=1;c.lean=ai.disengage==='withdraw'?-1:0;
        if(ai.disengage==='withdraw'&&ai.disengageTime>.8){ai.disengage='raise';ai.disengageTime=0;}
        else if(ai.disengage==='raise'&&(actual>desired-.15||ai.disengageTime>1.2)){
          ai.disengage=null;ai.blockedAimTime=0;ai.disengageCooldown=1.5;
        }
      }
    }
    if(sensed.tip&&!(f.boss&&(ai.state==='recover'||ai.cycle===0&&ai.state==='observe'&&ai.time<ai.duration))){
      // A stationary point also becomes dangerous when our head advances.
      // Recovery must not walk onto the blade displaced by our own last beat.
      // Use only observed velocities; the boss keeps its exposed recovery.
      const own=f.pose.head,hv=f.headVelocity||{},radius=BALLOON_RADII;
      const distance=(x,y,z)=>Math.hypot(x/(radius.x*f.balloonSize),y/(radius.y*f.balloonSize),z/(radius.z*f.balloonSize));
      const dx=tip.x-own.x,dy=tip.y-own.y,dz=(tip.z??.17)-(own.z??.025);
      const risk=Math.min(distance(dx,dy,dz),distance(dx+(vx-(hv.vx||0))*.18,dy+(vy-(hv.vy||0))*.18,dz-(hv.vz||0)*.18));
      if(risk<1.7){c.lean=Math.min(c.lean,-.5);c.headX=Math.sign(own.x-tip.x)*.8;}
    }
    if(f.boss&&ai.cycle===0&&ai.state==='observe'&&ai.time<ai.duration){
      // Present the heavy weapon away from the opponent while reading the
      // arena. This changes the physical intention, never hit eligibility.
      c.mainX=-.45;c.mainY=-.25;c.wrist=-.35;c.lean=0;c.thrust=false;
    }
    c.offY=clamp(c.offY+tactics.guardHeight,-1,1);
    if(!sensed.headVisible)c.thrust=false;
    this.setControl(f.slot,c);
  }
  #setAIState(f,state,duration){
    Object.assign(f.ai,{state,time:0,duration,attackIssued:false});
    this.onEvent('ai-state',{slot:f.slot,state,pattern:f.ai.pattern,phase:f.ai.phase,duration,vulnerable:state==='recover'});
  }
  updateFootwork(dt){
    if(this.phase!=='fight'){for(const f of this.fighters)f.baseVX=0;return;}
    const ordered=[...this.fighters].sort((a,b)=>b.dir-a.dir),previous=ordered.map(f=>f.baseX);
    const proposed=ordered.map(f=>{
      const expired=f.connected&&this.clock-f.lastInputAt>.45;
      const strength=walkingStrength(f);
      if(strength===0){f.baseVX=0;return f.baseX;}
      if(this.mode==='versus'||f.slot===1){
        f.baseVX=advanceLocomotion(f.baseVX,expired?0:f.controller.lean,dt,{dir:f.dir,strength,
          enabled:f.globIntact&&!f.rig.passive,maxSpeed:FOOTWORK.maxSpeed,acceleration:FOOTWORK.acceleration});
      }else{
        // AI lean is already the output of its geometric range controller,
        // rather than a thumb position. Preserve that controller's response.
        const speed=(expired?0:f.controller.lean)*f.dir*FOOTWORK.maxSpeed*strength;
        f.baseVX+=clamp(speed-f.baseVX,-FOOTWORK.acceleration*dt,FOOTWORK.acceleration*dt);
      }
      return clamp(f.baseX+f.baseVX*dt,-FOOTWORK.arenaHalfWidth,FOOTWORK.arenaHalfWidth);
    });
    const heads=ordered.map(f=>{
      const scale=f.boss?1.18:1,theta=clamp(REFERENCE_STANCE.lean+f.lean,-.95,.95);
      let pitch=f.dir*clamp(f.controller.headX??0,-1,1)*.30,yaw=clamp(f.controller.headZ??0,-1,1)*.34-(f.evasion?.feint??0)*NECK_CONE;
      const cone=Math.hypot(pitch,yaw);if(cone>NECK_CONE){pitch*=NECK_CONE/cone;yaw*=NECK_CONE/cone;}
      return {x:f.dir*f.lean*.18+f.dir*Math.sin(theta)*REFERENCE_STANCE.torso*scale+f.torsoTwist*.04+
        f.dir*Math.sin(theta+pitch)*REFERENCE_STANCE.neck*scale*Math.cos(yaw)+f.waterShift*.15,
        y:TABLE_TOP+(REFERENCE_STANCE.hipHeight-CROUCH_DEPTH*(f.evasion?.crouch??0))*scale+Math.cos(theta)*REFERENCE_STANCE.torso*scale+Math.cos(theta+pitch)*REFERENCE_STANCE.neck*scale*Math.cos(yaw),
        z:.025+Math.sin(yaw)*REFERENCE_STANCE.neck*scale};
    });
    const size=ordered[0].balloonSize+ordered[1].balloonSize;
    const yz=((heads[0].y-heads[1].y)/(BALLOON_RADII.y*size))**2+((heads[0].z-heads[1].z)/(BALLOON_RADII.z*size))**2;
    // Clearance follows the current requested neck/torso envelope. Neutral
    // spacing and weapon reach retain the original arena contract.
    const headClearance=ordered.every(f=>f.globIntact)?heads[0].x-heads[1].x+BALLOON_RADII.x*size*Math.sqrt(Math.max(0,1-yz))+.003:0;
    const separation=Math.max(FOOTWORK.minSeparation,headClearance);
    if(proposed[1]-proposed[0]<separation){
      const half=separation/2;
      const center=clamp((proposed[0]+proposed[1])/2,-FOOTWORK.arenaHalfWidth+half,FOOTWORK.arenaHalfWidth-half);
      proposed[0]=center-half;proposed[1]=center+half;
    }
    ordered.forEach((f,index)=>{f.baseX=proposed[index];f.baseVX=dt>0?(f.baseX-previous[index])/dt:0;});
  }
  resolveBodyContacts(dt,{extraContacts}={}){
    const [a,b]=this.fighters;
    const radii=f=>f.globIntact?{x:BALLOON_RADII.x*f.balloonSize,y:BALLOON_RADII.y*f.balloonSize,z:BALLOON_RADII.z*f.balloonSize}:null;
    const result=ArticulatedRig.resolvePair(a.rig,b.rig,{headRadiiA:radii(a),headRadiiB:radii(b),extraContacts});
    this.lastBodyContacts=result.contacts;
    for(const f of this.fighters)this.refreshRigPose(f,dt);
    this.materialContactTimes??=new Map();
    for(const contact of result.contacts)this.queueJointContact({a,b,...contact,impulse:0,source:'body'});
    for(const event of result.events){
      this.queueJointContact({a,b,...event,source:'body'});
      const key=`${event.bodyA}/${event.bodyB}/${event.material}`,last=this.materialContactTimes.get(key)??-Infinity;
      if(event.impulse>1e-4&&this.clock-last>.08){this.materialContactTimes.set(key,this.clock);this.onEvent('material-contact',{...event,force:event.impulse/Math.max(dt,STEP)});}
    }
  }
  queueJointContact(contact){
    if(this.phase==='fight'&&contact.a?.globIntact&&contact.b?.globIntact&&!contact.a.detachedAttack&&!contact.b.detachedAttack){
      this.jointContacts.push(contact);
      if(contact.impulse>1e-5&&!contact.head){
        for(const [fighter,body,key,point,sign] of [[contact.a,contact.bodyA,contact.keyA,contact.pointA,1],[contact.b,contact.bodyB,contact.keyB,contact.pointB,-1]]){
          if(!contact.normal)continue;
          fighter.surfaceState?.record(fighter.pose,{body,key,point,normal:{x:sign*contact.normal.x,y:sign*contact.normal.y,z:sign*(contact.normal.z??0)},impulse:contact.impulse,slideSpeed:contact.slideSpeed??0,time:this.clock,dt:this.lastPhysicalDt||STEP});
        }
      }
    }
  }
  applyJointDamage(dt=STEP){
    const contacts=this.jointContacts;this.jointContacts=[];
    if(this.phase!=='fight')return [];
    // Commit after both collision solves and simultaneous balloon classification.
    // No fracture can change the indexed CCD topology halfway through a solve.
    const changes=this.jointImpactDamage.process(contacts,this.clock),applied=[];
    for(const change of changes){
      const fighter=this.fighters[change.slot-1];
      if(!fighter?.globIntact)continue;
      const result=fighter.rig.damageJoint(change.joint,change.amount);
      if(result.applied)applied.push({...change,damage:result.damage,detached:result.detached});
    }
    for(const fighter of this.fighters){
      for(const event of fighter.rig.drainJointEvents()){
        const impact=applied.find(c=>c.slot===fighter.slot&&c.joint===event.joint);
        if(impact)this.onEvent(event.detached?'joint-break':'joint-damage',{...impact,...event,slot:fighter.slot,contact:true});
      }
      if(applied.some(c=>c.slot===fighter.slot)){
        this.refreshRigPose(fighter,dt);
        if(!bodyAttached(fighter,'weapon'))fighter.lunge=0;
        if(!bodyAttached(fighter,'offForearm'))fighter.guard=false;
      }
    }
    return applied;
  }
  refreshRigPose(f,dt){
    f.pose=f.rig.pose();f.pose.surface??=f.surfaceState.snapshot(f.pose,this.clock,f.rig);const h=f.previousHead||f.pose.head;
    f.headVelocity={vx:clamp((f.pose.head.x-h.x)/Math.max(dt,STEP),-8,8),vy:clamp((f.pose.head.y-h.y)/Math.max(dt,STEP),-8,8),vz:clamp((f.pose.head.z-h.z)/Math.max(dt,STEP),-8,8)};
    return f.pose;
  }
  solveFighterContacts(dt){
    // One finite collision impulse; then timber, heads and the swept steel
    // manifold share the same position iterations. A later steel projection
    // cannot silently reopen a timber constraint already reported as solved.
    this.resolveWeaponContacts(dt,{project:false});
    const [a,b]=this.fighters,extraContacts=this.lastWeaponContact?()=>weaponBindManifold(a.rig,b.rig,this.lastWeaponContact):undefined;
    this.resolveBodyContacts(dt,{extraContacts});
    if(this.lastWeaponContact)this.lastWeaponContact.penetration=Math.max(0,...extraContacts().map(c=>c.penetration));
    if(this.fighters.some(f=>f.rig.fragments.length)){
      this.lastDetachedContacts=resolveDetachedContacts(this.fighters.map(f=>f.rig),dt).contacts;
      for(const f of this.fighters)this.refreshRigPose(f,dt);
    }
  }
  resolveWeaponContacts(dt,{project=true}={}){
    this.lastWeaponContact=null;
    if(this.fighters.some(f=>!f.globIntact))return;
    const [a,b]=this.fighters,contact=resolveWeaponBind(a.rig,b.rig,{dt,project,observeVelocities:this.clock>=(this.nextClang||0)});
    if(!contact.at)return;
    this.lastWeaponContact=contact;
    this.queueJointContact({a,b,...contact,source:'steel'});
    // Sound/particles have a bounded rate; physical impulses are solved on
    // every step, including a blade beat made before pressing the attack.
    if(contact.impulse>1e-5&&this.clock>=(this.nextClang||0)){
      this.nextClang=this.clock+.08;
      const materialA=classifyEquipmentContact(a,contact.keyA,contact.pointA),materialB=classifyEquipmentContact(b,contact.keyB,contact.pointB);
      this.onEvent('clang',{at:contact.at,normal:contact.normal,keyA:contact.keyA,keyB:contact.keyB,bodyA:contact.bodyA,bodyB:contact.bodyB,
        material:contactMaterialPair(materialA,materialB),materialA,materialB,impulse:contact.impulse,force:contact.impulse/Math.max(dt,1e-9),
        closingSpeed:contact.closingSpeed,peakClosingSpeed:contact.closingSpeed,slideSpeed:contact.slideSpeed,
        frictionImpulse:contact.frictionImpulse,frictionState:contact.frictionState,slidePower:contact.slidePower,weaponBind:true,
        slotA:a.slot,slotB:b.slot,velocities:contact.velocities});
    }
  }
  updateFighter(f,dt,{deferSupport=false}={}){
    if(f.connected && this.clock-f.lastInputAt>.45)f.controller=neutral();
    const active=this.phase==='fight';
    const human=this.mode==='versus'||f.slot===1;
    const idle=standbyTargets({phase:this.phase,clock:this.clock,phaseClock:this.phaseClock,round:this.round,slot:f.slot,
      controller:f.controller,globIntact:f.globIntact,passive:f.rig.passive,reducedMotion:this.reducedMotion});
    const ctrl=active?(human?f.autoDefense.update(f,this.fighters.find(other=>other!==f),f.controller,dt):f.controller):(idle??neutral()),weapon=getWeapon(f),defense=getDefense(f);
    const armed=bodyAttached(f,'weapon'),canDefend=bodyAttached(f,'offForearm');
    advanceBodyEvasion(f,ctrl.bodyY,dt,active&&f.globIntact&&!f.rig.passive);
    for(const prop of ['mainX','mainY','offX','offY']){
      [f[prop],f[prop+'V']]=spring(f[prop],f[prop+'V'],ctrl[prop],75,16,dt);
    }
    // This spring produces motor intention. The coupled multibody below applies
    // segment inertia, limits, gravity, water load and support reactions once.
    const torque=ctrl.lean*.22 + f.recoil*.36-f.evasion.feint*.045;
    [f.torsoTwist,f.twistVel]=spring(f.torsoTwist,f.twistVel,torque,28,9,dt);
    let tLean=ctrl.lean*.35+f.recoil*.22 + f.torsoTwist*.16-f.evasion.feint*.11;
    [f.lean,f.leanVel]=spring(f.lean,f.leanVel,tLean,37,10,dt);
    if(active){
      if(ctrl.guard&&defense.canGuard&&canDefend)f.guardEnergy=clamp(f.guardEnergy-defense.guardDrain*dt,0,1);
      else f.guardEnergy=clamp(f.guardEnergy+defense.regeneration*dt,0,1);
      if(f.guardEnergy===0)f.guardBroken=true;
      else if(f.guardBroken&&f.guardEnergy>=.35)f.guardBroken=false;
    }
    f.guard=canDefend&&defense.canGuard&&!!ctrl.guard&&!f.guardBroken&&f.guardEnergy>0;
    if(f.guard)f.lunge=0;
    f.lungeCool=Math.max(0,f.lungeCool-dt);
    const pulse=armed&&active&&!f.guard&&ctrl.thrust&&!f.wasThrust&&f.lungeCool<=0;
    f.wasThrust=!!ctrl.thrust;
    if(pulse){f.lunge=1;f.lungeCool=weapon.cooldown;this.onEvent('thrust',{slot:f.slot});}
    const held=armed&&active&&!f.guard&&human&&ctrl.attackHeld===true;
    const loading=this.lastWeaponContact,loaded=loading?.at&&loading.bodyA==='weapon'&&loading.bodyB==='weapon';
    const withdraw=held&&!f.rig.passive?smooth01((-ctrl.mainX-.08)/.92):0;
    const gripTarget=loaded?withdraw*(.3+.7*clamp((loading.impulse??0)/(54*Math.max(dt,STEP)),0,1)):0;
    f.gripAdjustment=armed?lerp(f.gripAdjustment||0,gripTarget,1-Math.exp(-dt*12)):0;
    if(held){
      // Backward travel collects the weapon instead of holding a full lunge.
      // A diagonal withdraw can still aim/swing vertically, with continuously
      // reduced reach. Contact and puncture remain geometric at every value.
      const target=clamp(Math.hypot(ctrl.mainX,ctrl.mainY)+Math.min(ctrl.mainX,0),0,1);
      f.lunge=lerp(f.lunge,target,1-Math.exp(-dt*weapon.lungeDecay*1.6));
    }else f.lunge=armed?f.lunge*Math.exp(-dt*weapon.lungeDecay):0;
    f.recoil*=Math.exp(-dt*8);
    f.hitFlash*=Math.exp(-dt*9);
    if(!f.globIntact){
      f.balloon.ruptureAge+=dt;
    }
    const previous=f.pose?.tip||null;
    if(f.pose){
      const dx=f.pose.tip.x-f.pose.mainHand.x,dy=f.pose.tip.y-f.pose.mainHand.y,length=Math.hypot(dx,dy)||1;
      f.previousWeaponDirection={x:dx/length,y:dy/length};
    }
    const oldHead=f.pose?.head ? {...f.pose.head}:null;
    if(f.globIntact)this.buildPose(f,idle??f.controller);
    const intent=f.pose;
    f.rig.setIntent(intent,{baseX:f.baseX,baseVX:f.baseVX,waterLoad:rigWaterLoad(f,oldHead||intent.head)});
    applyJointPlay(f.rig);
    f.rig.step(dt);f.pose=f.rig.pose();
    f.balloonMass=f.rig.waterLoad.mass;
    f.previousTip=previous||f.pose.tip;
    const headTgt=clamp(f.mainY*.065-f.leanVel*.28,-.35,.35);
    f.waterV+=(headTgt-f.waterShift)*38*dt-f.waterV*8*dt;
    f.waterShift+=f.waterV*dt;
    f.balloon.stress=Math.max(0,f.balloon.stress*Math.exp(-4*dt)+Math.abs(f.waterV)*dt*.32);
    f.balloon.wave=clamp(Math.abs(f.waterV)*.24+Math.abs(f.leanVel)*.12,0,.8);
    if(oldHead){
      f.headVelocity={vx:clamp((f.pose.head.x-oldHead.x)/Math.max(dt,1/120),-8,8),
        vy:clamp((f.pose.head.y-oldHead.y)/Math.max(dt,1/120),-8,8),
        vz:clamp(((f.pose.head.z??.025)-(oldHead.z??.025))/Math.max(dt,1/120),-8,8)};
    }
    f.previousHead=oldHead||{...f.pose.head};
    if(!deferSupport)this.updateFighterSupport(f,dt);
  }
  updateFighterSupport(f,dt){
    this.refreshRigPose(f,dt);
    if(f.globIntact)f.fluid.keepContained(f.pose.head,dt,f.waterShift,this.clock);
    f.membrane.advance(dt,{head:f.pose.head,waterVolume:f.fluid.retainedVolume,waterFrame:f.fluid.surfaceFrame,slosh:f.waterShift});
  }
  initializeRig(f){
    const intent=this.buildPose(f);
    f.rig=new ArticulatedRig({dir:f.dir,scale:f.boss?1.18:1,baseX:f.baseX,pose:intent,apronVariant:f.boss?'boss':'normal',flexibleWeapons:true,
      surfaceSnapshot:(pose,rig)=>f.surfaceState.snapshot(pose,this.clock,rig)});
    f.pose=f.rig.pose();f.fluid.keepContained(f.pose.head,STEP,0,this.clock);
    f.previousHead={...f.pose.head};
    f.rig.setIntent(intent,{baseX:f.baseX,waterLoad:rigWaterLoad(f,f.pose.head)});
    f.balloonMass=f.rig.waterLoad.mass;f.membrane.attach(f.pose.head);
    return f.pose;
  }
  buildPose(f,control=f.controller){
    const dir=f.dir,scale=f.boss?1.18:1,weapon=getWeapon(f),defense=getDefense(f),stance=REFERENCE_STANCE;
    const hip={x:f.baseX+dir*(f.lean*.18),y:TABLE_TOP+(stance.hipHeight-CROUCH_DEPTH*(f.evasion?.crouch??0))*scale};
    const theta=clamp(stance.lean+f.lean,-.95,.95),sn=Math.sin(theta),cs=Math.cos(theta);
    const shoulder={x:hip.x+dir*sn*stance.torso*scale+f.torsoTwist*.04,y:hip.y+cs*stance.torso*scale};
    let neckPitch=dir*clamp(control.headX??0,-1,1)*.30,neckYaw=clamp(control.headZ??0,-1,1)*.34-(f.evasion?.feint??0)*NECK_CONE;
    const requestedCone=Math.hypot(neckPitch,neckYaw);if(requestedCone>NECK_CONE){neckPitch*=NECK_CONE/requestedCone;neckYaw*=NECK_CONE/requestedCone;}
    const head={x:shoulder.x+dir*Math.sin(theta+neckPitch)*stance.neck*scale*Math.cos(neckYaw)+f.waterShift*.15,
      y:shoulder.y+Math.cos(theta+neckPitch)*stance.neck*scale*Math.cos(neckYaw),z:.025+Math.sin(neckYaw)*stance.neck*scale};
    const mount=(x,z)=>({x:shoulder.x+dir*(x*cs-stance.shoulderDrop*sn)*scale,y:shoulder.y+(-x*sn-stance.shoulderDrop*cs)*scale,z});
    const mainShoulder=mount(stance.shoulderHalfWidth,.11),offShoulder=mount(-stance.shoulderHalfWidth,-.11);
    const swordLength=(weapon.length+weapon.lungeReach*f.lunge+weapon.extension*f.mainX)*(f.boss?1.05:1);
    let swordAngle=Math.atan2(.58*f.mainY,swordLength)+control.wrist*Math.PI/4+weapon.swing*f.lunge;
    // A backward mobile gesture collects the hand while crossing the main
    // blade through the upper approach. This is only motor intention: steel
    // contact, force limits and the material path still decide any parry.
    // Legacy/AI controllers do not carry the sustained mobile gesture marker.
    if(this.phase==='fight'&&(this.mode==='versus'||f.slot===1)&&control.attackHeld===true&&
      f.globIntact&&!f.rig?.passive&&bodyAttached(f,'weapon')){
      const backward=smooth01((-f.mainX-.08)/.92),travel=smooth01((Math.hypot(control.mainX,control.mainY)-.25)/.75);
      // Up/down and wrist keep their aiming authority, including a low escape
      // under a maul. Small gestures fade in without a jump at attackHeld=.25.
      swordAngle+=Math.PI/3*backward*travel*(1-Math.min(1,Math.abs(f.mainY)));
    }
    // A loaded withdrawing grip first collects the hand and rolls its wrist in
    // the requested vertical direction. This only moves the motor target; the
    // coupled rig and finite steel contact must actually free the weapon.
    const grip=f.gripAdjustment||0;
    swordAngle+=.10*grip*Math.sign(control.mainY||control.wrist||-1);
    let mainHand=reachableHand(mainShoulder,{x:mainShoulder.x+dir*((weapon.twoHanded?.56:stance.mainReach)+(weapon.twoHanded?.10:.19)*f.mainX+.085*f.lunge-.07*grip)*scale,
      y:mainShoulder.y+(stance.mainRise+.46*f.mainY+.035*grip*control.mainY)*scale,z:.17},.52*scale,.52*scale,dir);
    if(weapon.twoHanded){
      // Both grip intentions must lie inside the support arm's reach before the
      // closed-loop constraint solves their real masses and motor lag.
      const grip=reachableHand(offShoulder,{x:mainHand.x-dir*Math.cos(swordAngle)*weapon.gripOffset,y:mainHand.y-Math.sin(swordAngle)*weapon.gripOffset,z:.17},.48*scale,.47*scale,dir);
      mainHand={x:grip.x+dir*Math.cos(swordAngle)*weapon.gripOffset,y:grip.y+Math.sin(swordAngle)*weapon.gripOffset,z:.17};
      mainHand=reachableHand(mainShoulder,mainHand,.52*scale,.52*scale,dir);
    }
    const mainElbow=ik2(mainShoulder,mainHand,.52*scale,.52*scale,dir===1?-1:1);
    const tip={x:mainHand.x+dir*Math.cos(swordAngle)*swordLength,y:mainHand.y+Math.sin(swordAngle)*swordLength,z:.17};
    const offTarget=weapon.twoHanded?{x:mainHand.x-dir*Math.cos(swordAngle)*weapon.gripOffset,y:mainHand.y-Math.sin(swordAngle)*weapon.gripOffset,z:.17}:
      // The reference's free arm rests behind the torso. Positive controller
      // travel must still carry that hand to the front; retaining the old .28
      // range would leave even a fully extended shield behind the balloon.
      {x:offShoulder.x+dir*(f.guard?.56+.28*f.offX:stance.offReach+(f.offX>0?1.5:.28)*f.offX)*scale,
        y:offShoulder.y+(stance.offRise+.51*f.offY+(f.guard?.11:0))*scale,z:f.guard?.10:-.08};
    const offHand=reachableHand(offShoulder,offTarget,.48*scale,.47*scale,dir);
    const offElbow=ik2(offShoulder,offHand,.48*scale,.47*scale,dir===1?1:-1);
    const frontHip={x:hip.x+dir*stance.hipSocket*scale,y:hip.y,z:.20},backHip={x:hip.x-dir*stance.hipSocket*scale,y:hip.y,z:-.18};
    const footF={x:f.baseX+dir*stance.frontFoot*scale+f.footSlip,y:TABLE_TOP+.075,z:.29};
    const footB={x:f.baseX+dir*stance.backFoot*scale+f.footSlip,y:TABLE_TOP+.075,z:-.22};
    const kneeF={...ik2(frontHip,footF,stance.thigh*scale,stance.shin*scale,dir),z:.20};
    const kneeB={...ik2(backHip,footB,stance.thigh*scale,stance.shin*scale,dir),z:-.18};
    const shieldRadiusX=f.guard?defense.guardRadiusX:defense.radiusX,shieldRadiusY=f.guard?defense.guardRadiusY:defense.radiusY;
    const pose={hip,frontHip,backHip,shoulder,head,mainShoulder,mainElbow,mainHand,offShoulder,offElbow,offHand,tip,kneeF,kneeB,footF,footB,
      neckYawTarget:neckYaw,headBaseZ:.025,defenseDepthTarget:f.guard?.10:-.08,equipment:{...f.equipment},weaponMass:weapon.mass,twoHanded:weapon.twoHanded,gripOffset:weapon.gripOffset,
      shieldRadius:shieldRadiusX,shieldRadiusX,shieldRadiusY};
    if(defense.kind==='knife')pose.defenseTip={x:offHand.x+dir*defense.length*.45,y:offHand.y+defense.length*Math.sqrt(1-.45**2),z:.17};
    f.pose=pose;
    if(!f.membrane.attached)f.membrane.attach(head);
    return pose;
  }
  detectHits(){
    if(this.phase!=='fight')return;
    const [a,b]=this.fighters;
    const contacts=[];
    // Classify both attacks before applying outcomes, so simultaneous punctures are symmetric.
    for(const [owner,def] of [[a,b],[b,a]]){
      const atk=weaponActor(owner);
      if(!atk||!atk.globIntact||!def.globIntact)continue;
      const ap=atk.pose,dp=def.pose;
      const previous=atk.previousTip||ap.tip;
      const target=dp.head;
      const weapon=getWeapon(atk),dx=ap.tip.x-ap.mainHand.x,dy=ap.tip.y-ap.mainHand.y,length=Math.hypot(dx,dy)||1;
      const forward={x:dx,y:dy,z:(ap.tip.z??0)-(ap.mainHand.z??0)},direction={x:dx/length,y:dy/length};
      const currentPoints=strikePoints(ap.tip,direction,weapon),previousPoints=strikePoints(previous,atk.previousWeaponDirection??direction,weapon);
      const step=this.lastPhysicalDt||STEP;
      const headRadii=Object.fromEntries(Object.entries(BALLOON_RADII).map(([axis,radius])=>[axis,(radius+BALLOON_COLLISION_SKIN)*def.balloonSize]));
      const headSweep=(from,to,temporal=true)=>segmentEllipsoidContact(from,to,target,headRadii,
        {previousCenter:temporal?(def.previousHead??target):target,forward});
      const headContacts=currentPoints.map((point,index)=>{
        const hit=headSweep(previousPoints[index],point);
        const timber=hit&&def.rig?.firstTimberContact(previousPoints[index],point);
        if(timber&&timber.t<=hit.t+1e-12)return null;
        const blade=hit&&firstWeaponPointContact(def.rig,previousPoints[index],point);
        if(blade&&blade.t<=hit.t+1e-12)return null;
        if(hit)hit.pointVelocity=observedPointVelocity(previousPoints[index],point,step);
        return hit;
      }).filter(Boolean);
      // Balloon entry uses its XYZ ellipsoid. Guard profiles have finite
      // material depth and blade contacts follow the physical rig proxies.
      const defense=getDefense(def);
      const guarding=bodyAttached(def,'offForearm')&&defense.canGuard&&def.guard&&!def.guardBroken&&def.guardEnergy>0;
      const guardContacts=guarding?currentPoints.map((point,index)=>parryContact(previousPoints[index],point,dp,defense)).filter(Boolean):[];
      // Swept cutting-edge samples include shaft rotation. The present edge also
      // closes the small spaces between samples without inflating the balloon.
      for(let index=1;index<currentPoints.length;index++){
        const edge=headSweep(currentPoints[index-1],currentPoints[index],false);
        if(edge){
          // edge.t is the material coordinate on the present edge, not elapsed
          // sweep time. Interpolate that same point on both observed frames.
          const u=edge.t,interpolate=(a,b)=>({x:lerp(a.x,b.x,u),y:lerp(a.y,b.y,u),z:lerp(a.z,b.z,u)});
          const before=interpolate(previousPoints[index-1],previousPoints[index]),present=interpolate(currentPoints[index-1],currentPoints[index]);
          const timber=def.rig?.firstTimberContact(before,present);
          const blade=firstWeaponPointContact(def.rig,before,present);
          if((!timber||timber.t>1)&&(!blade||blade.t>1)){
          edge.pointVelocity=observedPointVelocity(before,present,step);
          edge.t=1;
          const oldHead=def.previousHead??target;
          const vx=edge.pointVelocity.vx-(target.x-oldHead.x)/step,vy=edge.pointVelocity.vy-(target.y-oldHead.y)/step,
            vz=edge.pointVelocity.vz-((target.z??.025)-(oldHead.z??.025))/step,speed=Math.hypot(vx,vy,vz);
          edge.incoming=speed>1e-12?{x:vx/speed,y:vy/speed,z:vz/speed}:{x:0,y:0,z:0};
          headContacts.push(edge);
          }
        }
        if(guarding){const parry=parryContact(currentPoints[index-1],currentPoints[index],dp,defense);if(parry){parry.t=1;guardContacts.push(parry);}}
      }
      const contact=headContacts.sort((a,b)=>a.t-b.t)[0],headContact=!!contact;
      const guardContact=guardContacts.sort((a,b)=>a.t-b.t)[0];
      // A guard can stop the point only if it is reached before the balloon.
      const blocked=!!guardContact&&(!headContact||guardContact.t<=contact.t+1e-12);
      // The observed point crossing latex is the attack. Motor extension,
      // cooldown and input flags cannot turn a real penetration into a safe tap.
      const hit=headContact&&!blocked;
      const impact=hit?{...contact.surfacePoint,normal:contact.normal,incoming:contact.incoming,t:contact.t,pointVelocity:contact.pointVelocity}:null;
      contacts.push({atk,def,impact,blocked,hit,guardContact});
    }
    const touchingGuards=new Set();
    for(const {atk,def,blocked,guardContact} of contacts){
      if(!blocked)continue;
      const episode=`${atk.slot}:${def.slot}`;touchingGuards.add(episode);
      atk.recoil=-.48;def.recoil=-.13;atk.lunge=0;
      // The unilateral stop still resolves every physical step. Charge the
      // impact once while the same steel remains against the guarded profile;
      // sustained effort already consumes guardDrain in updateFighter.
      if(!this.guardContactEpisodes.has(episode))def.guardEnergy=clamp(def.guardEnergy-getDefense(def).blockCost,0,1);
      if(def.guardEnergy===0){def.guardBroken=true;def.guard=false;}
      const point=guardContact.point,defense=getDefense(def),bodyB=defense.kind==='knife'?'offWeapon':'offForearm';
      let normal={...guardContact.normal};
      if(defense.kind==='knife'){
        // parryContact's thin dagger profile returns its local u/v/w normal.
        // Convert presentation/impulse metadata to the actual world frame.
        const a=def.pose.offHand,b=def.pose.defenseTip,dx=b.x-a.x,dy=b.y-a.y,dz=(b.z??.17)-(a.z??.17),length=Math.hypot(dx,dy,dz),xy=Math.hypot(dx,dy);
        const u=[dx/length,dy/length,dz/length],v=xy>1e-8?[-dy/xy,dx/xy,0]:[1,0,0],w=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
        const local=normal;
        normal=Object.fromEntries(['x','y','z'].map((axis,i)=>[axis,u[i]*local.x+v[i]*local.y+w[i]*(local.z??0)]));
      }
      const size=Math.hypot(normal.x,normal.y)||1,incoming={x:-normal.x/size,y:-normal.y/size};
      const va=atk.rig.pointVelocity({point}),vb=def.rig.pointVelocity({body:bodyB,point});
      const slideSpeed=va&&vb?Math.abs((va.x-vb.x)*-incoming.y+(va.y-vb.y)*incoming.x):0;
      const response=resolveRigContact(atk.rig,def.rig,{point,normal:incoming,bodyB,maxImpulse:.45});
      const impulse=response.impulse,closingSpeed=response.closingSpeed??0,keyA=getWeapon(atk).headLength?'weapon-head':'weapon';
      const materialA=classifyEquipmentContact(atk,keyA,point),materialB=classifyEquipmentContact(def,'guard',point),step=this.lastPhysicalDt||STEP;
      this.queueJointContact({a:atk,b:def,keyA,keyB:'guard',bodyA:'weapon',bodyB,pointA:point,pointB:point,normal:incoming,impulse,closingSpeed,source:'guard'});
      // A geometric stop still informs UI/rules when its mechanical impulse is
      // zero. Explicit zero measurements keep Audio/FX silent in that case.
      this.onEvent('clang',{at:point,normal,defender:def.slot,attacker:atk.slot,velocityBefore:va,velocityAfter:atk.rig.pointVelocity({point}),keyA,keyB:'guard',bodyA:'weapon',bodyB,
        material:contactMaterialPair(materialA,materialB),materialA,materialB,defenseMaterial:materialB,
        impulse,force:impulse/Math.max(step,1e-9),closingSpeed,peakClosingSpeed:Math.max(0,closingSpeed),slideSpeed});
    }
    // Geometric separation or lowering/breaking the guard ends the episode.
    this.guardContactEpisodes=touchingGuards;
    const hits=contacts.filter(contact=>contact.hit);
    if(hits.length===2){
      for(const {def,atk,impact} of hits)this.#rupture(def,atk,impact);
      this.winner=0;this.phase='burst';this.phaseClock=0;this.lastMessage='¡DOBLE PINCHAZO!';
      this.onEvent('burst',{draw:true,winner:0,loser:0,score:this.scores.slice(),
        contact:true,demonstration:false,impacts:hits.map(({def,impact})=>({slot:def.slot,x:impact.x,y:impact.y,z:impact.z,
          pointVelocity:{...impact.pointVelocity},relativeSpeed:relativePointSpeed(impact.pointVelocity,def.headVelocity)})),
        at:{x:(a.pose.head.x+b.pose.head.x)/2,y:(a.pose.head.y+b.pose.head.y)/2}});
      return;
    }
    if(hits.length===1){
      const {def,atk,impact}=hits[0];this.burst(def,atk,impact,false,{contact:true,pointVelocity:impact.pointVelocity});return;
    }
  }
  burst(def,atk,impact,timeout=false,{contact=false,demonstration=false,pointVelocity=null}={}){
    if(!def.globIntact || this.phase!=='fight')return;
    const previous=atk.previousTip||atk.pose.tip,tip=atk.pose.tip,step=this.lastPhysicalDt||STEP;
    const strikeVelocity=pointVelocity??observedPointVelocity(previous,tip,step);
    const relativeSpeed=relativePointSpeed(strikeVelocity,def.headVelocity);
    if(demonstration)this.demonstration=true;
    this.#rupture(def,atk,impact);
    this.winner=atk.slot;
    this.scores[atk.slot-1]++;
    this.phase='burst';this.phaseClock=0;
    this.lastMessage=timeout?'TIEMPO AGOTADO':'¡GLOBO PERFORADO!';
    this.onEvent('burst',{draw:false,winner:atk.slot,loser:def.slot,score:this.scores.slice(),at:{...def.pose.head},
      contact:!!contact&&!demonstration,demonstration:!!demonstration,impact:{x:impact.x,y:impact.y,z:impact.z??.17},pointVelocity:{...strikeVelocity},relativeSpeed});
  }
  #rupture(def,atk,impact){
    def.globIntact=false;def.hitFlash=1;def.rig.collapse();
    const impact3d={...impact,x:impact.x,y:impact.y,z:impact.z??.17};
    // Transfer the observed contact through both actual chains. The shared
    // solver applies no impulse when they are stationary or separating; this
    // is not an authored knock-down velocity or a collapse animation.
    const dx=atk.pose.tip.x-atk.pose.mainHand.x,dy=atk.pose.tip.y-atk.pose.mainHand.y,length=Math.hypot(dx,dy)||1;
    resolveRigContact(atk.rig,def.rig,{point:impact3d,normal:impact.incoming??{x:dx/length,y:dy/length},bodyB:'neck',maxImpulse:.30,restitution:0});
    def.balloon.ruptureAge=0;
    def.balloon.tearAngle=Math.atan2(impact3d.z-(def.pose.head.z||.025),impact3d.x-def.pose.head.x);
    const attackDir=impact.incoming?.x??atk.dir;
    def.membrane.puncture({point:impact3d,incoming:impact.incoming??{x:atk.dir,y:0,z:0},impulse:clamp(.45+atk.lunge,.1,1.4)});
    def.fluid.beginLeak({head:def.pose.head,impact:impact3d,attackDir,headVelocity:def.headVelocity,thrust:atk.lunge});
    atk.recoil=-.18;
    this.spawnWater(def,atk,impact);
  }
  spawnWater(def,atk,impact){
    const {head}=def.pose;
    // Subpixel optical glints only. Bulk water belongs exclusively to the fluid
    // ledger; torn latex comes exclusively from the persistent membrane mesh.
    const n=this.quality==='eco'?8:16;
    for(let i=0;i<n;i++){
      const theta=rng(0,Math.PI*2);
      const radial=Math.cos(theta),rise=Math.sin(theta);
      const speed=rng(.4,1.8);
      this.particles.push({x:impact.x+radial*.015,y:impact.y+rise*.015,z:impact.z??.17,
        vx:radial*speed+atk.dir*.2,vy:rise*speed+.4,vz:rng(-.6,.6),
        r:rng(.003,.007),volume:0,visualOnly:true,age:0,ttl:rng(.35,.7),color:def.slot,wet:false});
    }
    this.rings.push({x:head.x,y:.27,z:0,r:.1,age:0,ttl:2.0,color:def.slot});
  }
  sparkAt(x,y,z){
    for(let i=0;i<13;i++){
      let angle=rng(0,Math.PI*2),vel=rng(.4,2.8);
      this.spark.push({x,y,z,vx:Math.cos(angle)*vel,vy:Math.sin(angle)*vel,vz:rng(-.7,.7),age:0,ttl:rng(.14,.32)});
    }
  }
  updateWater(dt){
    const gravity=-9.81;
    const solidColliders=this.fighters.some(f=>f.fluid.released)?fluidSolidColliders(this.fighters):null;
    const water=[];
    for(let p of this.particles){
      p.age+=dt;
      if(p.age>p.ttl)continue;
      p.vx*=Math.exp(-.12*dt);p.vy=(p.vy+gravity*dt)*Math.exp(-.10*dt);p.vz*=Math.exp(-.15*dt);
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;
      if(p.y<.285+p.r){p.y=.285+p.r; if(!p.wet){p.vy=Math.abs(p.vy)*.16;p.vx*=.43;p.vz*=.43;p.wet=true;
        if(this.rings.length<80)this.rings.push({x:p.x,y:.284,z:p.z,r:.06,age:0,ttl:1.6,color:p.color});
      }else{p.vy=0;p.vx*=.91;p.vz*=.91;}}
      water.push(p);
    }
    this.particles=water;
    this.shards=this.shards.filter(p=>{
      p.age+=dt;if(p.age>p.ttl)return false;
      p.vy+=gravity*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.rz+=p.spin*dt;p.rx+=p.spin*.45*dt;
      if(p.y<.31){p.y=.31;p.vy=Math.abs(p.vy)*.19;p.vx*=.75;p.vz*=.75;}
      return true;
    });
    // Coherent liquid bulk: particle volume remains constant even after the burst.
    for(const f of this.fighters){
      if(f.fluid.released){
        const domain={floor:.326,viscosity:.27,solidColliders,capillarySurface:f.membrane.punctured?buildCapillarySurface(f.membrane):null};
        if(f.fluid.leaking){
          const opening=f.membrane.state;
          // Reduced normalized air pressure vents through the measured opening;
          // this is not pressure in Pa or bidirectional fluid/solid coupling.
          const airVolume=Math.max(.001,f.fluid.initialVolume*(1/.65-1));
          f.balloon.pressure*=Math.exp(-2*opening.apertureArea/airVolume*dt);
          f.fluid.advanceLeak(dt,{...domain,head:f.pose.head,headVelocity:f.headVelocity,slosh:f.waterShift,time:this.clock,
            apertureArea:opening.apertureArea,pressure:f.balloon.pressure,containmentCapacity:opening.containmentCapacity,capacityMode:'step',
            membraneSupport:f.fluid.retainedVolume>0?buildMembraneSupport(f.membrane):null});
        }else f.fluid.integrate(dt,domain);
        f.balloonMass=f.fluid.retainedVolume*WATER_RIG_DENSITY;
        const wet=f.fluid.wetCount/f.fluid.count;
        const index=f.slot-1;
        this.puddleStrength[index]=Math.min(1,this.puddleStrength[index]+wet*dt*.18);
        if(this.phase==='burst')f.footSlip+=f.dir*.002*this.puddleStrength[index]*dt;
      }
    }
    if(this.fighters.some(f=>f.fluid.released))for(const f of this.fighters){
      if(!f.pose.apron||!f.rig.apron)continue;
      wetApronFromParcels(f.rig.apron,f.pose.apron,this.fighters.map(other=>other.fluid),dt);
      f.pose.apron.wetness={...f.rig.apron.wetness};
    }
    this.rings=this.rings.filter(p=>(p.age+=dt)<p.ttl);
    this.spark=this.spark.filter(p=>{p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;return p.age<p.ttl;});
  }
}
