/** Mechanical impact bookkeeping only. The engine supplies every contact once
 * per physical STEP and applies the returned changes after solving that STEP.
 * No rig, pose, controller, random generator or game result is mutated here. */
export const JOINT_IMPACT=Object.freeze({minimumImpulse:.035,minimumSpeed:.55,minimumEnergy:.015,separationSeconds:.12,maxContacts:4096});
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const sources=new Set(['body','steel','guard']);
const joints=Object.freeze({mainUpper:['mainShoulder','mainShoulder'],mainForearm:['mainElbow','mainElbow'],
  offUpper:['offShoulder','offShoulder'],offForearm:['offElbow','offElbow'],
  frontThigh:['frontHip','frontHip'],frontShin:['frontKnee','kneeF'],backThigh:['backHip','backHip'],backShin:['backKnee','kneeB']});
const bodies=new Set([...Object.keys(joints),'weapon','offWeapon','torso','neck','pelvis']);
const point=value=>value&&[value.x,value.y,value.z??0].every(Number.isFinite)?{x:value.x,y:value.y,z:value.z??0}:null;

function hinge(fighter,body,key){
  let definition=joints[body],gain=1,maximum=.25;
  if(body==='weapon'){
    definition=['wrist','mainHand'];
    // The wooden palm is the hinge itself. Steel transfers a smaller load back
    // through the grip; it is not mistaken for the opponent's wooden elbow.
    if(key!=='main-palm'){gain=.15;maximum=.05;}
  }else if(body==='offWeapon'){definition=['offElbow','offElbow'];gain=.2;maximum=.06;}
  if(!definition)return null;
  const pivot=point(fighter.pose[definition[1]]);
  return pivot?{joint:definition[0],pivot,gain,maximum}:null;
}

function observation(contact){
  if(!contact||!sources.has(contact.source))return null;
  const {a,b,bodyA,bodyB}=contact;
  if(!a||!b||a===b||![1,2].includes(a.slot)||![1,2].includes(b.slot)||a.slot===b.slot||
    !a.rig||!b.rig||!a.pose||!b.pose||!bodies.has(bodyA)||!bodies.has(bodyB))return null;
  if(a.rig.isBodyAttached?.(bodyA)===false||b.rig.isBodyAttached?.(bodyB)===false)return null;
  if(!Number.isFinite(contact.impulse)||contact.impulse<0)return null;
  const sides=[{fighter:a,body:bodyA,at:null,hinge:hinge(a,bodyA,contact.keyA)},
    {fighter:b,body:bodyB,at:null,hinge:hinge(b,bodyB,contact.keyB)}];
  const identities=sides.map(side=>`${side.fighter.slot}:${side.hinge?.joint??side.body}`).sort();
  const key=identities.join('|');
  // A post-solve overlap need not fabricate impact geometry just to keep an
  // existing episode alive. It can never create a mechanical change itself.
  if(contact.impulse===0)return {key,sides,normal:null,impulse:0,speed:0};
  const atA=point(contact.pointA),atB=point(contact.pointB),normal=point(contact.normal);
  if(!atA||!atB||!normal)return null;
  const normalLength=Math.hypot(normal.x,normal.y,normal.z);
  if(!Number.isFinite(normalLength)||normalLength<=1e-12||
    !Number.isFinite(contact.closingSpeed)||contact.peakClosingSpeed!==undefined&&!Number.isFinite(contact.peakClosingSpeed))return null;
  sides[0].at=atA;sides[1].at=atB;
  return {key,sides,normal:{x:normal.x/normalLength,y:normal.y/normalLength},
    impulse:contact.impulse,speed:Math.max(0,contact.closingSpeed,contact.peakClosingSpeed??0)};
}

function changeFor(side,impact){
  const h=side.hinge;if(!h)return null;
  const scale=side.fighter.rig.scale??1;
  if(!Number.isFinite(scale)||scale<=0)return null;
  const energy=.5*impact.impulse*impact.speed;
  if(!Number.isFinite(energy)||energy<JOINT_IMPACT.minimumEnergy)return null;
  const rx=side.at.x-h.pivot.x,ry=side.at.y-h.pivot.y;
  const arm=Math.abs(rx*impact.normal.y-ry*impact.normal.x);
  if(!Number.isFinite(arm))return null;
  // A direct compressive strike still loads the joint. The bounded bending
  // lever increases damage without letting a long/large model bypass the cap.
  const leverage=.35+Math.min(1,arm/(.45*scale));
  const amount=clamp((energy-JOINT_IMPACT.minimumEnergy)/.35*leverage*h.gain,.01,h.maximum);
  return {slot:side.fighter.slot,joint:h.joint,amount,at:{...side.at},impulse:impact.impulse,closingSpeed:impact.speed};
}

function stronger(a,b){
  if(!a||b.amount>a.amount)return b;
  if(b.amount<a.amount)return a;
  // Stable witnesses for equal capped impacts, independent of source/order.
  for(const key of ['impulse','closingSpeed']){if(b[key]!==a[key])return b[key]>a[key]?b:a;}
  for(const key of ['x','y','z']){if(b.at[key]!==a.at[key])return b.at[key]<a.at[key]?b:a;}
  return a;
}

export class JointImpactDamage{
  constructor(){this.episodes=new Map();this.lastTime=null;}
  process(contacts,time){
    if(!Array.isArray(contacts)||contacts.length>JOINT_IMPACT.maxContacts||!Number.isFinite(time)||time<0||
      this.lastTime!==null&&time<this.lastTime)return [];
    this.lastTime=time;
    for(const [key,episode]of this.episodes)if(time-episode.lastSeen>=JOINT_IMPACT.separationSeconds)this.episodes.delete(key);
    const groups=new Map(),changes=new Map();
    for(const contact of contacts){
      const observed=observation(contact);if(!observed)continue;
      let group=groups.get(observed.key);
      if(!group){
        let episode=this.episodes.get(observed.key);
        if(!episode){episode={lastSeen:time,consumed:false};this.episodes.set(observed.key,episode);}
        episode.lastSeen=time;group={episode,impacts:[]};groups.set(observed.key,group);
      }
      group.impacts.push(observed);
    }
    for(const {episode,impacts}of groups.values()){
      if(episode.consumed)continue;
      let qualified=false;
      for(const impact of impacts){
        if(impact.impulse<JOINT_IMPACT.minimumImpulse||impact.speed<JOINT_IMPACT.minimumSpeed)continue;
        for(const side of impact.sides){
          const change=changeFor(side,impact);if(!change)continue;qualified=true;
          const key=`${change.slot}:${change.joint}`;changes.set(key,stronger(changes.get(key),change));
        }
      }
      if(qualified)episode.consumed=true;
    }
    return [...changes.values()].sort((a,b)=>a.slot-b.slot||a.joint.localeCompare(b.joint));
  }
}
