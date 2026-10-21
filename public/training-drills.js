/** Practice intentions and read-only objectives. Only DuelEngine produces contacts and scores. */
import {BALLOON_RADII} from './physics/dimensions.js';
import {segmentEllipsoidContact} from './physics/head-contact.js';
import {getWeapon} from './equipment.js';

export const TRAINING_DRILL_KINDS=Object.freeze(['parry','moving','depth']);
const titles={parry:'Escuela de paradas',moving:'Blancos móviles',depth:'Distancia y profundidad'};
const clamp=value=>Math.max(-1,Math.min(1,value));
const point=p=>p&&[p.x,p.y,p.z??0].every(Number.isFinite);
const copy=p=>({x:p.x,y:p.y,z:p.z??0});
const delta=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:(a.z??0)-(b.z??0)});
const length=p=>Math.hypot(p.x,p.y,p.z??0);
const distance=(a,b)=>length(delta(a,b));
const dot=(a,b)=>a.x*b.x+a.y*b.y+(a.z??0)*(b.z??0);
const fighters=game=>[game?.fighters?.find(f=>f.slot===1),game?.fighters?.find(f=>f.slot===2)];
const realPuncture=data=>data?.contact===true&&!data.demonstration&&!data.draw&&data.winner===1&&data.loser===2&&
  point(data.impact)&&Number.isFinite(data.impact?.z)&&Number.isFinite(data.relativeSpeed)&&data.relativeSpeed>0;

/** A pure input source: the rig, water load, locomotion and ordinary collision solver do the moving. */
export function trainingOpponentControl(kind,game){
  if(!TRAINING_DRILL_KINDS.includes(kind))return null;
  const [player,opponent]=fighters(game);
  if(!point(player?.pose?.head)||!point(opponent?.pose?.mainHand)||!point(opponent?.pose?.tip)||!Number.isFinite(opponent.baseX))return null;
  const t=Number.isFinite(game.elapsed)?game.elapsed:0;
  const c={mainX:-.8,mainY:-.7,offX:-.5,offY:-.5,lean:0,wrist:-.7,thrust:false,guard:false,headX:0,headZ:0,bodyY:0};
  if(kind==='moving'){
    const desiredBase=1.48+.24*Math.sin(t*1.15);
    c.lean=clamp((desiredBase-opponent.baseX)*(opponent.dir===1?1:-1)*3);
    c.headX=.8*Math.sin(t*1.35);c.headZ=.9*Math.sin(t*.9);c.bodyY=.45+.4*Math.sin(t*1.1);
    return c;
  }
  // A slow, visible upper approach leaves a real Z escape around the balloon's curved edge.
  const parry=kind==='parry',phase=parry?(t%6.5)-1:t%5.6,head=player.pose.head,hand=opponent.pose.mainHand,tip=opponent.pose.tip;
  if(phase<0||phase>=.7){
    c.lean=clamp(((parry?1.55:1.65)-opponent.baseX)*(opponent.dir===1?1:-1)*3);
    // Withdraw above the head before lowering the blade, so recovery cannot cut back through the escape.
    if(!parry&&phase>=0&&phase<2.2){c.mainX=-1;c.mainY=1;c.wrist=1;}
    else if(!parry)c.headZ=.75*Math.sin(t);
    return c;
  }
  const weapon=getWeapon(opponent),dir=opponent.dir===1?1:-1,targetY=head.y+(parry?.03:.65);
  c.mainX=1;c.mainY=clamp((targetY-(opponent.pose.mainShoulder?.y??hand.y)-.13)/1.04);
  const desired=Math.atan2(targetY-hand.y,Math.max(.3,dir*(head.x-hand.x)));
  const actual=Math.atan2(tip.y-hand.y,dir*(tip.x-hand.x));
  const error=Math.atan2(Math.sin(desired-actual),Math.cos(desired-actual));
  c.mainY=clamp(c.mainY+.9*error);
  c.wrist=clamp((desired-Math.atan2(.58*c.mainY,weapon.length+weapon.extension))/(Math.PI/4)+error);
  const gap=Math.hypot(head.x-hand.x,targetY-hand.y)-Math.hypot(tip.x-hand.x,tip.y-hand.y)-.21;
  c.lean=clamp(gap*3);
  return c;
}

/** The marker and event check use the same current ellipsoid surface, in world XYZ. */
function movingTarget(game,index){
  const [,opponent]=fighters(game),head=opponent?.pose?.head;
  if(!point(head)||index>=3)return null;
  const scale=Number.isFinite(opponent.balloonSize)&&opponent.balloonSize>0?opponent.balloonSize:1;
  const dy=[0,.18,-.18][index]*scale,z=.17,section=1-(dy/(BALLOON_RADII.y*scale))**2-((z-(head.z??0))/(BALLOON_RADII.z*scale))**2;
  if(section<=0)return null;
  return {x:head.x+(opponent.dir===1?1:-1)*BALLOON_RADII.x*scale*Math.sqrt(section),y:head.y+dy,z,radius:.15*scale,slot:2};
}

export class TrainingDrill{
  constructor(kind){this.kind=kind;this.progress=0;this.usedBalloons=new WeakSet();this.resetRound();}
  resetRound(){this.reference=null;this.previousOpponentHead=null;this.movingTravel=0;this.pendingParry=null;this.pendingDepth=null;this.openUntil=0;this.lastContactTime=-Infinity;if(this.kind!=='moving'&&this.progress<2)this.progress=0;}
  repeat(){this.progress=0;this.usedBalloons=new WeakSet();this.resetRound();}
  #valid(game){return game?.mode==='solo'&&!game.demonstration;}
  #deflection(game){
    const pending=this.pendingParry,[,opponent]=fighters(game);
    if(!pending)return;
    const elapsed=game.clock-pending.time;
    if(opponent!==pending.opponent||elapsed>.18){this.pendingParry=null;return;}
    if(elapsed<.015||!point(opponent?.pose?.tip))return;
    const movement=delta(opponent.pose.tip,pending.tip),speed=length(movement)/elapsed;
    if(speed<.08)return;
    const cosine=dot(movement,pending.incoming)/(length(movement)*length(pending.incoming));
    if(cosine<.72){this.progress=1;this.openUntil=game.clock+4;this.pendingParry=null;}
  }
  observe(game,dt){
    if(!this.#valid(game)||game.phase!=='fight'||!Number.isFinite(dt)||dt<=0||dt>.25||this.completed)return;
    const [player,opponent]=fighters(game);
    if(!point(player?.pose?.head)||!point(opponent?.pose?.head)||!player.globIntact||!opponent.globIntact)return;
    if(!this.reference)this.reference={head:copy(player.pose.head)};
    if(this.kind==='moving'){
      if(this.previousOpponentHead)this.movingTravel+=distance(opponent.pose.head,this.previousOpponentHead);
      this.previousOpponentHead=copy(opponent.pose.head);return;
    }
    if(this.kind==='parry'){
      if(this.progress===1&&game.clock>this.openUntil){this.progress=0;this.openUntil=0;}
      this.#deflection(game);return;
    }
    if(this.progress!==0||!point(opponent.previousTip)||!point(opponent.pose.tip)||opponent.detachedAttack||opponent.rig?.passive)return;
    const head=player.pose.head,previousHead=point(player.previousHead)?player.previousHead:head;
    if(Math.abs((head.z??0)-this.reference.head.z)<.07||game.clock-this.lastContactTime<.12)return;
    const radii=Object.fromEntries(Object.entries(BALLOON_RADII).map(([axis,radius])=>[axis,radius*(player.balloonSize??1)]));
    const from=opponent.previousTip,to=opponent.pose.tip;
    if(distance(from,to)/Math.max(game.lastPhysicalDt??dt,1/120)<.15)return;
    if(this.pendingDepth){
      const pending=this.pendingDepth,age=game.clock-pending.time;
      if(pending.opponent!==opponent||age>1.6){this.pendingDepth=null;}
      else if(age>=.12){
        const separation=Math.hypot((to.x-head.x)/radii.x,(to.y-head.y)/radii.y,((to.z??0)-(head.z??0))/radii.z);
        const receding=distance(to,head)>distance(from,previousHead)+.002;
        if(separation>1.18&&(receding||(opponent.dir??-1)*(to.x-head.x)>radii.x)){this.progress=1;this.pendingDepth=null;return;}
      }
    }
    const centered=segmentEllipsoidContact(from,to,{...head,z:this.reference.head.z},radii,
      {previousCenter:{...previousHead,z:this.reference.head.z}});
    const actual=segmentEllipsoidContact(from,to,head,radii,{previousCenter:previousHead});
    // The same swept point must enter the former depth plane and miss the actual moving balloon.
    if(centered&&!centered.startedInside&&!actual)this.pendingDepth??={opponent,time:game.clock};
  }
  event(name,data,game){
    if(!this.#valid(game)||data.demonstration||this.completed)return;
    const [player,opponent]=fighters(game);
    if(name==='clang'){
      this.lastContactTime=game.clock;
      this.pendingDepth=null;
      if(this.kind==='parry')this.#deflection(game);
      if(this.kind!=='parry'||this.progress!==0||game.phase!=='fight'||!(data.defender===1||data.weaponBind===true)||!point(data.at)||
        !(data.impulse>1e-5)||!(data.closingSpeed>.05)||!point(opponent?.pose?.tip)||!point(opponent.previousTip)||!point(player?.pose?.head))return;
      const incoming=delta(opponent.pose.tip,opponent.previousTip),towardHead=delta(player.pose.head,opponent.pose.tip);
      if(length(incoming)<1e-5||dot(incoming,towardHead)<=0)return;
      const before=data.attacker===2?data.velocityBefore:data.slotA===2?data.velocities?.beforeA:data.slotB===2?data.velocities?.beforeB:null;
      const after=data.attacker===2?data.velocityAfter:data.slotA===2?data.velocities?.afterA:data.slotB===2?data.velocities?.afterB:null;
      if(point(before)&&point(after)){
        const speed=length(before),outgoing=length(after),change=distance(before,after);
        // These velocities straddle the very same contact impulse: animation or the recovery control cannot supply this proof.
        if(speed>.08&&change>.08&&(outgoing<speed*.4||dot(before,after)<speed*outgoing*.72)){
          this.progress=1;this.openUntil=game.clock+4;this.pendingParry=null;return;
        }
        return;
      }
      this.pendingParry??={opponent,time:game.clock,tip:copy(opponent.pose.tip),incoming};return;
    }
    if(name==='burst')this.pendingDepth=null;
    if(name!=='burst'||!realPuncture(data)||!opponent||this.usedBalloons.has(opponent))return;
    if(this.kind==='parry'){
      this.#deflection(game);this.usedBalloons.add(opponent);
      if(this.progress===1&&game.clock<=this.openUntil)this.progress=2;
    }else if(this.kind==='moving'){
      this.usedBalloons.add(opponent);const target=movingTarget(game,this.progress);
      const velocity=opponent.headVelocity,movingSpeed=velocity&&[velocity.vx,velocity.vy,velocity.vz].every(Number.isFinite)?Math.hypot(velocity.vx,velocity.vy,velocity.vz):0;
      const tracked=this.movingTravel>=.035||(this.movingTravel>=.015&&movingSpeed>.05);
      if(tracked&&target&&distance(data.impact,target)<=target.radius)this.progress++;
    }else if(this.kind==='depth'){
      this.usedBalloons.add(opponent);
      if(this.progress===1&&this.reference&&point(player?.pose?.head)&&Math.abs((player.pose.head.z??0)-this.reference.head.z)<=.06)this.progress=2;
    }
  }
  get completed(){return this.progress>=(this.kind==='moving'?3:2);}
  view(game){
    const completed=this.completed;
    const instruction=completed?'Ejercicio completado con contactos físicos. Podés repetirlo desde el menú.':this.kind==='parry'?
      (this.progress===0?'Desviá un ataque real con la defensa o cruzando tu arma al retroceder. Un choque sin desvío no cuenta.':
        'Apertura real: contraatacá y perforá el globo antes de que se recupere la guardia.'):
      this.kind==='moving'?'Seguí el globo oscilante y perforá dentro del círculo. Cada contacto se comprueba en las tres dimensiones.':
      this.progress===0?'Bajá el arma y esquivá el ataque alto inclinando la cabeza hacia atrás en profundidad. La punta debe pasar sin tocar tu globo.':
        'Esperá la retirada del arma, volvé al plano de alcance y ajustá la distancia con el joystick izquierdo para perforar el globo rival.';
    return {title:titles[this.kind],instruction,completed,progress:this.progress,total:this.kind==='moving'?3:2,objectiveIndex:this.progress,
      status:completed?'completed':'idle',nextAction:completed?'repeat':null,target:this.kind==='moving'&&!completed?movingTarget(game,this.progress):null};
  }
}
