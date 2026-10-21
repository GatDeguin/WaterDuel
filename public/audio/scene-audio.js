import {TABLE_TOP,waterDropRadius} from '../physics/dimensions.js';
import {getWeapon} from '../equipment.js';
import {bodyAttached,weaponActor} from '../physics/limb-state.js';

const MAX_FIGHTERS=2,MAX_PARCELS=320,MAX_EDGES=96,MAX_CUES=8;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=Number.isFinite;
const FEET=['footF','footB'],STANDING_HEIGHT=TABLE_TOP+.075;
const POINTS=['head','hip','mainShoulder','mainElbow','mainHand','offShoulder','offElbow','offHand','tip',...FEET];
const POINT_BODIES={mainElbow:'mainUpper',mainHand:'weapon',offElbow:'offUpper',offHand:'offForearm',tip:'weapon',footF:'frontShin',footB:'backShin'};
const connected=(fighter,body)=>bodyAttached(fighter,body)&&!(fighter.pose?.detached??[]).some(fragment=>fragment.bodies.includes(body));
const point=value=>value&&finite(value.x)&&finite(value.y)&&finite(value.z??0)?{x:value.x,y:value.y,z:value.z??0}:null;
const distance=(a,b)=>a&&b?Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z):0;

function jointAngle(a,b,c){
  if(!a||!b||!c)return null;
  const u={x:a.x-b.x,y:a.y-b.y,z:a.z-b.z},v={x:c.x-b.x,y:c.y-b.y,z:c.z-b.z};
  const length=Math.hypot(u.x,u.y,u.z)*Math.hypot(v.x,v.y,v.z);
  return length>1e-9?Math.acos(clamp((u.x*v.x+u.y*v.y+u.z*v.z)/length,-1,1)):null;
}

function stretchOf(membrane){
  const edges=membrane?.edges,nodes=membrane?.nodes;
  if(!Array.isArray(edges)||!Array.isArray(nodes))return null;
  const count=Math.min(edges.length,MAX_EDGES);let sum=0,valid=0;
  // Evenly distributed edge samples bound work for either membrane subdivision.
  // This is measured stretch/rest length, not a constitutive stress estimate.
  for(let i=0;i<count;i++){
    const edge=edges[Math.floor(i*edges.length/count)];
    if(!edge||!finite(edge.rest)||edge.rest<=0)continue;
    const a=point(nodes[edge.a]),b=point(nodes[edge.b]);
    if(a&&b){sum+=distance(a,b)/edge.rest;valid++;}
  }
  return valid?sum/valid:null;
}

function feetOf(fighter,pose){
  const feet={},contacts=fighter.rig?.contacts;
  // Engine foot points are ankle/boot centers, .075 above TABLE_TOP. Grounded
  // means the observed pose is near that physical support height, and any rig
  // contact actually reports stance. Swinging support targets alone are not hits.
  for(const key of FEET){
    let support=null;
    if(Array.isArray(contacts))for(let i=0;i<Math.min(contacts.length,2);i++)if(contacts[i]?.key===key){support=contacts[i];break;}
    const floor=finite(support?.floor)?support.floor:STANDING_HEIGHT;
    feet[key]={grounded:!!pose[key]&&Math.abs(floor-STANDING_HEIGHT)<=.025&&
      Math.abs(pose[key].y-floor)<=.018&&(!support||support.stance===true)};
  }
  return feet;
}

function snapshot(fighter,wetness){
  const pose={};for(const name of POINTS)pose[name]=POINT_BODIES[name]&&!connected(fighter,POINT_BODIES[name])?null:point(fighter.pose?.[name]);
  const fluid=fighter.fluid,membrane=fighter.membrane,parcels=new Map();
  // Only conserved FluidVolume parcels are inspected. The first 320 cover the
  // current 200-parcel fighter and 260-parcel boss. Oversized sources are sampled
  // conservatively: unsampled contacts are silent rather than invented later.
  const source=fluid?.particles;
  if(Array.isArray(source))for(let i=0;i<Math.min(source.length,MAX_PARCELS);i++){
    const p=source[i],position=point(p);
    if(!position||!finite(p.vy)||!finite(p.volume)||p.volume<=0)continue;
    parcels.set(p,{...position,vy:p.vy,volume:p.volume,wet:p.wet===true,free:p.free===true});
  }
  const rotation=fluid?.surfaceFrame?.rotation;
  const surface=Array.isArray(rotation)&&rotation.length>=9&&rotation.slice(0,9).every(finite)?rotation.slice(0,9):null;
  const weapon=getWeapon(fighter),weaponMass=clamp(finite(fighter.rig?.weaponMass)?fighter.rig.weaponMass:weapon.mass,.04,1.5);
  // A detached blade belongs to its independent physical actor. Parent endpoint
  // motion cannot animate it, and changing actor establishes a new air baseline.
  const actor=weaponActor(fighter),blade=actor?{source:actor.detachedAttack?actor.rig:fighter,
    hand:point(actor.pose?.mainHand),tip:point(actor.pose?.tip),
    mass:actor.detachedAttack?clamp(getWeapon(actor.pose).mass,.04,1.5):weaponMass}:null;
  return {fighter,pose,fluid,membrane,edges:membrane?.edges,parcels,surface,weapon:weapon.id,weaponMass,
    blade,
    feet:feetOf(fighter,pose),wetness:finite(wetness)?clamp(wetness,0,1):0,
    fraction:finite(fluid?.surfaceFrame?.fraction)?fluid.surfaceFrame.fraction:0,
    slosh:finite(fluid?.lastSlosh)?fluid.lastSlosh:0,
    discharge:finite(fluid?.leakDischarged)?fluid.leakDischarged:null,
    stretch:stretchOf(membrane),
    angles:[jointAngle(pose.mainShoulder,pose.mainElbow,pose.mainHand),jointAngle(pose.offShoulder,pose.offElbow,pose.offHand)],
    x:clamp(pose.head?.x??(finite(fighter.baseX)?fighter.baseX:0),-4,4)};
}

/** Read-only audio observer. update(engine, realFrameSeconds) returns material
 * cues {name,x,intensity,priority,rate}; x is world space, clamped to [-4,4]. There is
 * no Web Audio, physics stepping, timer playback or access to visual particles.
 * Call reset() when pausing, replaying, muting or replacing the observed scene.
 * First observations establish baselines; missed events are never backfilled.
 */
export class AudioScene{
  constructor(){this.reset();}
  reset(){this.game=null;this.clock=null;this.time=0;this.slots=[];}

  update(game,dt){
    if(!game||!Array.isArray(game.fighters)||!finite(dt)||dt<=0){this.reset();return [];}
    if(this.game!==game||finite(game.clock)&&finite(this.clock)&&game.clock<this.clock-1e-6)this.reset();
    this.game=game;this.clock=finite(game.clock)?game.clock:null;
    dt=Math.min(dt,.05);this.time+=dt;
    const cues=[];
    for(let index=0;index<Math.min(game.fighters.length,MAX_FIGHTERS);index++){
      const fighter=game.fighters[index];
      if(!fighter||typeof fighter!=='object'){this.slots[index]=null;continue;}
      const puddleIndex=[1,2].includes(fighter.slot)?fighter.slot-1:index;
      const next=snapshot(fighter,game.puddleStrength?.[puddleIndex]),old=this.slots[index];
      const discontinuity=!old||old.fighter!==fighter||old.fluid!==next.fluid||old.membrane!==next.membrane||old.weapon!==next.weapon||
        POINTS.some(name=>distance(old.pose[name],next.pose[name])>.8);
      next.gates=discontinuity?Object.create(null):old.gates;
      next.footTravel=discontinuity?{footF:0,footB:0}:{...old.footTravel};
      this.slots[index]=next;
      if(discontinuity)continue;
      const emit=(name,intensity,cooldown,priority=1,x=next.x,rate=1,gate=name,location=null)=>{
        if(!finite(intensity)||intensity<=0||this.time-(next.gates[gate]??-Infinity)<cooldown-1e-9)return false;
        next.gates[gate]=this.time;
        const at=location??next.pose.head;
        cues.push({name,x:clamp(finite(x)?x:next.x,-4,4),y:clamp(finite(at?.y)?at.y:1.8,-2,8),z:clamp(finite(at?.z)?at.z:0,-8,16),intensity:clamp(intensity,0,1),priority,rate:clamp(finite(rate)?rate:1,.7,1.4)});
        return true;
      };

      let movement=0,movingPoints=0;
      for(const name of ['head','hip','mainElbow','offElbow','mainHand','offHand']){
        if(old.pose[name]&&next.pose[name]){movement+=distance(old.pose[name],next.pose[name]);movingPoints++;}
      }
      const speed=movingPoints?movement/(movingPoints*dt):0;
      if(speed>.16)emit('wood',.12+speed*.18,.22,1,next.pose.hip?.x??next.x,1,'wood',next.pose.hip);
      let angularSpeed=0,angularJoint=0;
      for(let i=0;i<next.angles.length;i++)if(next.angles[i]!==null&&old.angles[i]!==null)
        if(Math.abs(next.angles[i]-old.angles[i])/dt>angularSpeed){angularSpeed=Math.abs(next.angles[i]-old.angles[i])/dt;angularJoint=i;}
      const jointAt=angularJoint===0?next.pose.mainElbow:next.pose.offElbow;
      if(angularSpeed>.35)emit('joint',.1+angularSpeed*.085,.18,1,jointAt?.x??next.x,1,'joint',jointAt);
      if(next.blade&&old.blade&&next.blade.source===old.blade.source&&next.blade.tip&&old.blade.tip&&next.blade.hand&&old.blade.hand){
        // World motion includes pure joystick translation/extension: subtracting
        // hand travel would erase a straight thrust with an unchanged blade axis.
        const bladeSpeed=(distance(next.blade.tip,old.blade.tip)*.7+distance(next.blade.hand,old.blade.hand)*.3)/dt;
        if(bladeSpeed>.5){
          const massRatio=next.blade.mass/.16;
          emit('blade-swish',.08+bladeSpeed*.13*Math.sqrt(massRatio),.14,1,next.blade.tip.x,
            .88+Math.min(bladeSpeed,8)*.055-Math.log2(massRatio)*.09,'blade-swish',next.blade.tip);
        }
      }
      for(const key of FEET){
        const a=old.pose[key],b=next.pose[key];
        if(!a||!b){next.footTravel[key]=0;continue;}
        const horizontal=Math.hypot(b.x-a.x,b.z-a.z),travel=distance(a,b),grounded=next.feet[key].grounded;
        if(!grounded){next.footTravel[key]=Math.min(.5,next.footTravel[key]+travel);continue;}
        const landing=!old.feet[key].grounded&&(travel/dt>.08||next.footTravel[key]>.035);
        if(old.feet[key].grounded)next.footTravel[key]=Math.min(.5,next.footTravel[key]+horizontal);
        const slide=old.feet[key].grounded&&horizontal/dt>.08&&next.footTravel[key]>=.06;
        if(landing||slide){
          const footSpeed=travel/dt,wet=next.wetness>.08;
          const played=emit(wet?'footstep-wet':'footstep-dry',.14+Math.min(footSpeed,4)*.12+(landing?.08:0),.18,1,b.x,
            .9+Math.min(footSpeed,3)*.055,'foot:'+key,b);
          // A rate-limited landing is gone, not a backlog for the next slide.
          if(played||landing)next.footTravel[key]=0;
        }else if(!old.feet[key].grounded)next.footTravel[key]=0;
      }

      if(next.surface&&old.surface&&next.fraction>0){
        const surfaceSpeed=Math.hypot(...next.surface.map((value,i)=>value-old.surface[i]))/dt;
        // Ignore the tiny procedural resting ripple in containedWaterFrame.
        if(surfaceSpeed>.15&&(Math.abs(next.slosh)>.015||surfaceSpeed>.5))emit('slosh',surfaceSpeed*.08,.22,2);
      }
      if(next.edges===old.edges&&next.stretch!==null&&old.stretch!==null){
        const stretching=(next.stretch-old.stretch)/dt;
        if(next.stretch>1.04&&stretching>.3)emit('tension',stretching*.1,.18,2);
      }
      if(next.fluid?.leaking===true&&next.discharge!==null&&old.discharge!==null){
        const discharged=next.discharge-old.discharge;
        if(discharged>1e-8){
          const initial=finite(next.fluid.initialVolume)&&next.fluid.initialVolume>0?next.fluid.initialVolume:.2;
          emit('jet',.1+discharged/(dt*initial)*.4,.1,3);
        }
      }

      let impactVolume=0,impactEnergy=0,impactX=0,impactY=0,impactZ=0,impacts=0;
      if(next.fluid?.released===true)for(const [parcel,p] of next.parcels){
        const previous=old.parcels.get(parcel);
        // wet is set by the physical floor solver and remains true thereafter.
        // Require an observed falling free parcel before that first transition.
        if(!previous?.free||previous.wet||!p.free||!p.wet||previous.vy>=-.05||p.y>TABLE_TOP+waterDropRadius(p.volume)+.02)continue;
        impactVolume+=p.volume;impactEnergy+=p.volume*previous.vy**2;impactX+=p.x*p.volume;impactY+=p.y*p.volume;impactZ+=p.z*p.volume;impacts++;
      }
      if(impactVolume>0){
        const name=impacts>=4||impactVolume>.004?'splash':'drip';
        emit(name,.12+Math.sqrt(impactEnergy/impactVolume)*.12+Math.sqrt(impactVolume)*2,.1,4,impactX/impactVolume,1,name,{y:impactY/impactVolume,z:impactZ/impactVolume});
      }
    }
    this.slots.length=Math.min(game.fighters.length,MAX_FIGHTERS);
    return cues.sort((a,b)=>b.priority-a.priority||b.intensity-a.intensity).slice(0,MAX_CUES);
  }
}
