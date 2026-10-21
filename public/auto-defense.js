import {getDefense} from './equipment.js';
import {BALLOON_RADII} from './physics/dimensions.js';
import {bodyAttached,weaponActor} from './physics/limb-state.js';

export const AUTO_DEFENSE=Object.freeze({attemptChance:.70,reactionMin:.15,reactionMax:.25,guardSeconds:.40,cooldown:.65});
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function mix(seed){let x=seed>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);return (x^(x>>>16))>>>0;}
function observedThreat(fighter,opponent,dt){
  opponent=weaponActor(opponent);if(!opponent)return null;
  const head=fighter.pose?.head,tip=opponent?.pose?.tip,previous=opponent?.previousTip;
  if(!head||!tip||!previous||![head.x,head.y,tip.x,tip.y,previous.x,previous.y].every(Number.isFinite))return null;
  const vx=clamp((tip.x-previous.x)/dt,-8,8),vy=clamp((tip.y-previous.y)/dt,-8,8);
  const dx=head.x-tip.x,dy=head.y-tip.y,speed2=vx*vx+vy*vy;
  if(speed2<.04||vx*dx+vy*dy<.12||Math.hypot(dx,dy)>2.2)return null;
  const time=clamp((dx*vx+dy*vy)/speed2,0,.55),scale=fighter.balloonSize||1;
  const rx=BALLOON_RADII.x*scale+.18,ry=BALLOON_RADII.y*scale+.18;
  if(((tip.x+vx*time-head.x)/rx)**2+((tip.y+vy*time-head.y)/ry)**2>1)return null;
  if(Math.abs((tip.z??.17)-(head.z??.025))>BALLOON_RADII.z*scale+.10)return null;
  // Predict the height at the shield's front plane using observed motion only.
  const front=head.x+fighter.dir*.20,t=Math.abs(vx)>.1?clamp((front-tip.x)/vx,0,.45):time;
  return {height:tip.y+vy*t};
}

/** Deterministic human assistance. This class never resolves or predicts a hit. */
export class AutoDefense{
  constructor({seed=1}={}){this.seed=seed>>>0;this.reset();}
  reset(){this.random=mix(this.seed)||0x6d2b79f5;this.elapsed=0;this.episode=0;this.tracking=false;this.attempt=false;this.started=0;this.reaction=0;this.quiet=0;this.fired=false;this.guardUntil=0;this.cooldown=0;this.height=0;}
  next(){let x=this.random;x^=x<<13;x^=x>>>17;x^=x<<5;this.random=x>>>0;return this.random/4294967296;}
  snapshot(){return {seed:this.seed,random:this.random,elapsed:this.elapsed,episode:this.episode,tracking:this.tracking,attempt:this.attempt,reaction:this.reaction,quiet:this.quiet,fired:this.fired,guardUntil:this.guardUntil,cooldown:this.cooldown};}
  update(fighter,opponent,control,dt){
    if(!Number.isFinite(dt)||dt<=0||dt>.04)return control;
    this.elapsed+=dt;this.cooldown=Math.max(0,this.cooldown-dt);
    const observed=observedThreat(fighter,opponent,dt);
    this.quiet=observed?0:this.quiet+dt;if(observed)this.height=observed.height;
    if(this.quiet>.30&&this.elapsed>=this.guardUntil)this.tracking=false;
    if(observed&&!this.tracking&&this.cooldown<=0){
      this.tracking=true;this.episode++;this.started=this.elapsed;this.fired=false;
      this.attempt=this.next()<AUTO_DEFENSE.attemptChance;
      this.reaction=AUTO_DEFENSE.reactionMin+this.next()*(AUTO_DEFENSE.reactionMax-AUTO_DEFENSE.reactionMin);
    }
    const equipped=getDefense(fighter).canGuard;
    const committed=fighter.lunge>.21||control.thrust||control.attackHeld===true&&fighter.lungeCool<=dt;
    const holding=this.fired&&this.elapsed<this.guardUntil;
    const available=bodyAttached(fighter,'offForearm')&&fighter.globIntact&&equipped&&!fighter.guardBroken&&fighter.guardEnergy>(holding?0:.35);
    if(this.tracking&&this.attempt&&!this.fired&&this.elapsed-this.started>=this.reaction&&this.quiet<.15&&available&&!committed){
      this.fired=true;this.guardUntil=this.elapsed+AUTO_DEFENSE.guardSeconds;this.cooldown=AUTO_DEFENSE.cooldown;
    }
    // A reacting arm must not retract while the same observed point is still
    // approaching. Keep the original minimum effort, extend only from observed
    // motion and cap the hold; energy, commitment and geometry still apply.
    if(holding&&observed&&available&&!committed)this.guardUntil=Math.min(this.started+this.reaction+AUTO_DEFENSE.guardSeconds*2,
      Math.max(this.guardUntil,this.elapsed+.12));
    // Explicit legacy/manual controls retain their semantics. New mobile
    // controls send guard:false and leave both secondary axes to this assist.
    if(control.guard||committed||!available||!this.fired||this.elapsed>=this.guardUntil)return control;
    const scale=fighter.boss?1.18:1,shoulder=fighter.pose.offShoulder;
    const offY=clamp((this.height-shoulder.y-.13*scale)/(.51*scale),-.25,1);
    return {...control,offX:.85,offY,guard:true};
  }
}
