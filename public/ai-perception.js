/** Sight and finite attention for the existing physical AI pilot. Memory holds
 * owned observations, never a live fighter/controller or a future hit result. */
import {getWeapon,getDefense,normalizeLoadout} from './equipment.js';
import {weaponActor} from './physics/limb-state.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const valid=p=>p&&[p.x,p.y,p.z??0].every(Number.isFinite);
const copy=p=>Object.freeze({x:p.x,y:p.y,z:p.z??0});
const intervals=Object.freeze({rookie:.025,normal:.012,expert:.008,boss:.010});
function blocks(from,to,panel){
  if(!Array.isArray(panel.vertices)||panel.vertices.length<3||!Number.isFinite(panel.z)||!Number.isFinite(panel.depth))return false;
  let lo=0,hi=1;const dx=to.x-from.x,dy=to.y-from.y,dz=(to.z??0)-(from.z??0);
  const clip=(distance,slope)=>{if(Math.abs(slope)<1e-14)return distance<=1e-10;const t=-distance/slope;if(slope<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);return lo<=hi+1e-12;};
  let area=0;for(let i=0;i<panel.vertices.length;i++){const a=panel.vertices[i],b=panel.vertices[(i+1)%panel.vertices.length];area+=a.x*b.y-b.x*a.y;}
  const sign=Math.sign(area);if(!sign)return false;
  for(let i=0;i<panel.vertices.length;i++){
    const a=panel.vertices[i],b=panel.vertices[(i+1)%panel.vertices.length],nx=sign*(b.y-a.y),ny=-sign*(b.x-a.x);
    if(!clip(nx*(from.x-a.x)+ny*(from.y-a.y),nx*dx+ny*dy))return false;
  }
  const z=from.z??0;if(!clip(z-panel.z-panel.depth/2,dz)||!clip(panel.z-panel.depth/2-z,-dz))return false;
  return lo>1e-5&&lo<.995&&hi>=lo;
}
export function pointVisible(observer,target,occluders=[]){
  const eye=observer?.pose?.head;if(!valid(eye)||!valid(target))return false;
  const dx=(target.x-eye.x)*(observer.dir<0?-1:1),dy=target.y-eye.y,dz=(target.z??0)-(eye.z??0),range=Math.hypot(dx,dy,dz);
  if(range>8||range>.12&&dx/range<Math.cos(50*Math.PI/180))return false;
  return !occluders.some(panel=>blocks(eye,target,panel));
}
export class AIPerception{
  constructor(){this.reset();}
  reset(){this.elapsed=0;this.nextObservation=0;this.lastSeen=-Infinity;this.lastTipSeen=-Infinity;this.lastSample=0;this.snapshot=null;this.memorySeconds=.40;}
  #current(){
    if(!this.snapshot||this.elapsed-Math.max(this.lastSeen,this.lastTipSeen)>this.memorySeconds)return null;
    const headFresh=this.elapsed-this.lastSeen<=this.memorySeconds,tipFresh=this.elapsed-this.lastTipSeen<=this.memorySeconds;
    if(!headFresh||!tipFresh)return Object.freeze({...this.snapshot,head:headFresh?this.snapshot.head:null,headVisible:headFresh&&this.snapshot.headVisible,visible:headFresh&&this.snapshot.visible,
      headVelocity:headFresh?this.snapshot.headVelocity:Object.freeze({vx:0,vy:0,vz:0}),age:Number.isFinite(this.lastSeen)?this.elapsed-this.lastSeen:this.memorySeconds,
      tip:tipFresh?this.snapshot.tip:null,previousTip:tipFresh?this.snapshot.previousTip:null,armed:tipFresh&&this.snapshot.armed,tipVisible:tipFresh&&this.snapshot.tipVisible,
      velocity:tipFresh?this.snapshot.velocity:Object.freeze({vx:0,vy:0,vz:0}),lunge:tipFresh?this.snapshot.lunge:0,tipAge:Number.isFinite(this.lastTipSeen)?this.elapsed-this.lastTipSeen:this.memorySeconds});
    return this.snapshot;
  }
  observe(observer,target,dt,{difficulty='normal',occluders=[]}={}){
    if(!Number.isFinite(dt)||dt<=0||dt>.04)return this.#current();
    this.elapsed+=dt;
    if(this.elapsed<this.nextObservation-1e-12)return this.#current();
    this.nextObservation=this.elapsed+(intervals[difficulty]??intervals.normal);
    const panels=typeof occluders==='function'?occluders():occluders,head=target?.pose?.head;
    const headVisible=pointVisible(observer,head,panels),actor=weaponActor(target),tip=actor?.pose?.tip??target?.pose?.tip;
    const tipVisible=pointVisible(observer,tip,panels),previous=this.snapshot;
    if(!headVisible&&!tipVisible&&!this.#current())return null;
    const span=previous?Math.max(dt,this.elapsed-this.lastSample):dt;
    // A visible temporal material sample already supplies the last physical
    // point. Sampling that observed velocity avoids aliasing a fast strike to
    // zero between attention ticks; it still cannot read controls/future input.
    const seenTip=tipVisible?tip:previous?.tip??head;
    if(!valid(seenTip))return null;
    const old=tipVisible&&valid(actor?.previousTip)?actor.previousTip:previous?.tip??seenTip;
    const velocity=Object.freeze({vx:tipVisible?clamp((seenTip.x-old.x)/dt,-8,8):0,vy:tipVisible?clamp((seenTip.y-old.y)/dt,-8,8):0,vz:tipVisible?clamp(((seenTip.z??0)-(old.z??0))/dt,-8,8):0});
    const hv=headVisible?target.headVelocity:null,previousHead=previous?.head;
    const component=(axis,key)=>headVisible?clamp(Number.isFinite(hv?.[key])?hv[key]:previousHead?((head[axis]??0)-previousHead[axis])/span:0,-8,8):0;
    const headVelocity=Object.freeze({vx:component('x','vx'),vy:component('y','vy'),vz:component('z','vz')});
    const defenseVisible=pointVisible(observer,target?.pose?.offHand,panels);
    const equipment=Object.freeze({weapon:tipVisible&&actor?normalizeLoadout({weapon:target.equipment?.weapon}).weapon:previous?.equipment.weapon??null,
      defense:defenseVisible?normalizeLoadout({defense:target.equipment?.defense}).defense:previous?.equipment.defense??null});
    this.snapshot=Object.freeze({head:headVisible?copy(head):previousHead??null,tip:copy(seenTip),previousTip:copy(old),velocity,headVelocity,
      equipment,balloonSize:headVisible&&Number.isFinite(target.balloonSize)&&target.balloonSize>0?target.balloonSize:previous?.balloonSize??1,armed:!!actor&&tipVisible,
      lunge:tipVisible?actor?.lunge??0:0,visible:headVisible,headVisible,tipVisible,age:headVisible?0:Number.isFinite(this.lastSeen)?this.elapsed-this.lastSeen:this.memorySeconds,
      tipAge:tipVisible?0:Number.isFinite(this.lastTipSeen)?this.elapsed-this.lastTipSeen:this.memorySeconds});
    if(headVisible){this.lastSeen=this.elapsed;this.lastSample=this.elapsed;}
    if(tipVisible)this.lastTipSeen=this.elapsed;
    return this.#current();
  }
}
/** Small, bounded policy changes based only on equipment already seen. */
export function loadoutTactics(own,opponent){
  const weapon=getWeapon(own),enemy=getWeapon(opponent),defense=getDefense(opponent);
  const knownWeapon=typeof opponent?.weapon==='string',knownDefense=typeof opponent?.defense==='string';
  const longer=knownWeapon&&enemy.reach-weapon.reach>.12,heavy=knownWeapon&&(enemy.twoHanded||enemy.mass>=.28),highShield=knownDefense&&defense.id==='long';
  return {name:longer?'close-long-point':heavy?'draw-heavy-recovery':highShield?'over-high-shield':'balanced',
    spacing:longer?-.07:heavy?.065:0,observeScale:heavy?1.06:1,recoverScale:longer?1.06:1,
    aimBias:highShield?.055:0,guardHeight:heavy?.07:0};
}
