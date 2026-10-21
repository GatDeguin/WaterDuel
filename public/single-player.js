/** Read-only objectives and versioned local progress. DuelEngine owns every hit and result. */
import {BALLOON_RADII} from './physics/dimensions.js';
import {newOpponentSeed,seededOpponentRandom,randomOpponent} from './opponent-loadouts.js';
import {TRAINING_DRILL_KINDS,TrainingDrill} from './training-drills.js';

export const SINGLE_PLAYER_STORAGE_KEY='water-duel.single-player.v1';
export const CAMPAIGN=Object.freeze([
  {name:'La Aguja del Taller',arena:'atelier',difficulty:'rookie',aiStyle:'aggressive',opponentLoadout:{weapon:'sword',defense:'short'},opponentColor:'amber'},
  {name:'El Guardián de Roble',arena:'dojo',difficulty:'normal',aiStyle:'defender',opponentLoadout:{weapon:'axe',defense:'long'},opponentColor:'cobalt'},
  {name:'El Eco de Acero',arena:'midnight',difficulty:'normal',aiStyle:'counter',opponentLoadout:{weapon:'sword',defense:'knife'},opponentColor:'violet'},
  {name:'La Sombra de Latón',arena:'atelier',difficulty:'normal',aiStyle:'feint',opponentLoadout:{weapon:'axe',defense:'short'},opponentColor:'crimson'},
  {name:'La Punta de Cristal',arena:'dojo',difficulty:'expert',aiStyle:'precision',opponentLoadout:{weapon:'spear',defense:'knife'},opponentColor:'gold'},
  {name:'El Péndulo Salvaje',arena:'midnight',difficulty:'expert',aiStyle:'erratic',opponentLoadout:{weapon:'spear',defense:'long'},opponentColor:'rose'},
  {name:'El Maestro Hidráulico',arena:'atelier',difficulty:'boss',aiStyle:'boss',opponentLoadout:{weapon:'maul',defense:'none'},opponentColor:'coral'}
].map(encounter=>Object.freeze({...encounter,opponentLoadout:Object.freeze(encounter.opponentLoadout)})));
const KINDS=new Set(['duel','training','practice','precision','campaign',...TRAINING_DRILL_KINDS]);
const TITLES={duel:'Duelo individual',training:'Escuela del taller',practice:'Práctica libre',precision:'Tres puntos de precisión',campaign:'Campeones del taller'};
const TRAINING=Object.freeze([
  'Orientá el arma con el joystick derecho: mové la mano respecto del hombro.',
  'Soltá el joystick derecho y dejá volver el brazo al centro.',
  'Acercate al rival con el joystick izquierdo hasta desplazar la base.',
  'Alejate con el joystick izquierdo para recuperar distancia.',
  'Combiná ambos joysticks: acercate mientras orientás el arma. La defensa es automática.',
  'Desplazá el joystick derecho para atacar: la punta debe avanzar.',
  'Perforá el globo rival con un ataque real del joystick derecho.'
]);
const finitePoint=p=>p&&[p.x,p.y,p.z??0].every(Number.isFinite);
const xyz=p=>({x:p.x,y:p.y,z:p.z??0});
const difference=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:(a.z??0)-(b.z??0)});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z??0)-(b.z??0));
const emptyProgress=()=>({stage:0,completed:false});

function loadProgress(storage){
  try{
    const value=JSON.parse(storage?.getItem(SINGLE_PLAYER_STORAGE_KEY)??'null');
    if(!value||Array.isArray(value)||value.version!==1||!Number.isInteger(value.stage)||value.stage<0||value.stage>=CAMPAIGN.length||
      typeof value.completed!=='boolean'||(value.completed&&value.stage!==CAMPAIGN.length-1))return emptyProgress();
    return {stage:value.stage,completed:value.completed};
  }catch{return emptyProgress();}
}

function trainingPose(f){
  const p=f?.pose;
  if(!p||![p.mainHand,p.mainShoulder,p.offHand,p.offShoulder,p.tip,p.head].every(finitePoint)||!Number.isFinite(f.baseX))return null;
  return {main:difference(p.mainHand,p.mainShoulder),off:difference(p.offHand,p.offShoulder),tip:xyz(p.tip),baseX:f.baseX};
}

/** The marker and hit validator share this surface point, evaluated at the event pose. */
function precisionTarget(game,index){
  const opponent=game?.fighters?.find(f=>f.slot===2),head=opponent?.pose?.head;
  if(!finitePoint(head)||index>=3)return null;
  const scale=Number.isFinite(opponent.balloonSize)&&opponent.balloonSize>0?opponent.balloonSize:1;
  const offsets=[0,.19,-.19],dy=offsets[index]*scale,z=.17,dz=z-(head.z??0);
  const ry=BALLOON_RADII.y*scale,rz=BALLOON_RADII.z*scale;
  const section=1-(dy/ry)**2-(dz/rz)**2;
  if(section<=0)return null;
  return {x:head.x+(opponent.dir===1?1:-1)*BALLOON_RADII.x*scale*Math.sqrt(section),y:head.y+dy,z,radius:.13*scale,slot:2};
}

function validPuncture(data){
  return data?.contact===true&&!data.demonstration&&!data.draw&&data.winner===1&&data.loser===2&&
    data.impact&&[data.impact.x,data.impact.y,data.impact.z].every(Number.isFinite)&&Number.isFinite(data.relativeSpeed)&&data.relativeSpeed>0;
}

export class SinglePlayerSession{
  constructor({storage=null,seed=newOpponentSeed(),random=null}={}){
    this.storage=storage;this.saved=loadProgress(storage);this.kind='duel';this.stage=this.saved.stage;
    this.opponentSeed=seed;this.opponentRandom=random??seededOpponentRandom(seed);this.duelOpponent=randomOpponent(this.opponentRandom);
    this.objectiveIndex=0;this.reference=null;this.hold=0;this.result='idle';this.demoMatch=false;this.usedBalloons=new WeakSet();this.drill=null;
  }
  select(kind){
    if(!KINDS.has(kind))return false;
    this.kind=kind;this.stage=this.saved.stage;this.objectiveIndex=0;this.reference=null;this.hold=0;
    this.drill=TRAINING_DRILL_KINDS.includes(kind)?new TrainingDrill(kind):null;
    this.result='idle';this.demoMatch=false;this.usedBalloons=new WeakSet();return true;
  }
  configuration(){
    const practice=['training','practice','precision',...TRAINING_DRILL_KINDS].includes(this.kind);
    const encounter=this.kind==='campaign'?CAMPAIGN[this.stage]:null;
    return {scenario:practice?'practice':'duel',aiEnabled:this.drill?this.kind!=='moving':!practice,difficulty:this.drill?'rookie':encounter?.difficulty??'normal',
      aiStyle:this.drill?'precision':encounter?.aiStyle??'balanced',arena:encounter?.arena??'atelier',bestOf:3,opponentName:encounter?.name??(this.drill?'Compañero del taller':practice?'Blanco del taller':this.duelOpponent.opponentName),
      ...(this.drill?{trainingDrill:{kind:this.kind},opponentLoadout:{weapon:'sword',defense:'none'}}:{}),
      ...(this.kind==='depth'?{playerLoadout:{weapon:'sword',defense:'none'}}:{}),
      ...(!practice?{opponentLoadout:{...(encounter?.opponentLoadout??this.duelOpponent.opponentLoadout)},opponentColor:encounter?.opponentColor??this.duelOpponent.opponentColor}:{})};
  }
  observe(game,dt){
    if(this.drill){this.drill.observe(game,dt);this.objectiveIndex=this.drill.progress;return;}
    if(this.kind!=='training'||this.objectiveIndex>=TRAINING.length||game?.mode!=='solo'||game?.phase!=='fight'||
      !Number.isFinite(dt)||dt<=0||dt>.25)return;
    const f=game.fighters?.find(f=>f.slot===1),pose=trainingPose(f);if(!pose)return;
    if(!this.reference){this.reference=pose;return;}
    const c=f.controller??{},dir=f.dir===-1?-1:1;let success=false;
    switch(this.objectiveIndex){
      case 0:success=Math.hypot(c.mainX??0,c.mainY??0)>.2&&distance(pose.main,this.reference.main)>=.18;break;
      case 1:{
        const centered=Math.hypot(c.mainX??0,c.mainY??0)<.08&&!c.thrust&&!c.attackHeld&&f.lunge<.1&&distance(pose.main,this.reference.main)>=.12;
        this.hold=centered?this.hold+dt:0;success=this.hold>=.25;break;
      }
      case 2:success=(c.lean??0)>.2&&dir*(pose.baseX-this.reference.baseX)>=.22;break;
      case 3:success=(c.lean??0)<-.2&&dir*(pose.baseX-this.reference.baseX)<=-.22;break;
      case 4:success=(c.lean??0)>.2&&Math.hypot(c.mainX??0,c.mainY??0)>.2&&distance(pose.main,this.reference.main)>=.18&&dir*(pose.baseX-this.reference.baseX)>=.1;break;
      case 5:success=Math.hypot(c.mainX??0,c.mainY??0)>.2&&dir*(pose.tip.x-this.reference.tip.x)>=.14;break;
    }
    if(success){this.objectiveIndex++;this.reference=pose;this.hold=0;}
  }
  event(name,data={},game){
    if(name==='reset'){
      this.reference=null;this.hold=0;this.demoMatch=false;this.result='idle';this.usedBalloons=new WeakSet();this.drill?.resetRound();if(this.drill)this.objectiveIndex=this.drill.progress;return;
    }
    if(name==='start'){this.reference=null;this.hold=0;this.drill?.resetRound();if(this.drill)this.objectiveIndex=this.drill.progress;return;}
    if(game?.mode!=='solo')return;
    if(this.drill){this.drill.event(name,data,game);this.objectiveIndex=this.drill.progress;return;}
    if(name==='burst'){
      if(data.demonstration)this.demoMatch=true;
      if(!validPuncture(data))return;
      const opponent=game?.fighters?.find(f=>f.slot===2);
      if(!opponent||this.usedBalloons.has(opponent))return;
      this.usedBalloons.add(opponent);
      // A legal puncture can happen on the thrust's first physics tick, before
      // the post-step observer sees the motion. The verified contact itself
      // proves both the physical thrust and its successful perforation.
      if(this.kind==='training'&&[5,6].includes(this.objectiveIndex))this.objectiveIndex=7;
      if(this.kind==='precision'&&this.objectiveIndex<3){
        const target=precisionTarget(game,this.objectiveIndex);
        if(target&&distance(data.impact,target)<=target.radius)this.objectiveIndex++;
      }
    }
    if(name==='matchover'&&this.kind==='duel'&&this.result==='idle'&&!this.demoMatch&&!data.demonstration&&!game.demonstration){
      if(data.winner===1)this.result='won';else if(data.winner===2)this.result='lost';
    }
    if(name==='matchover'&&this.kind==='campaign'&&!this.saved.completed&&this.result==='idle'&&!this.demoMatch&&!data.demonstration&&!game.demonstration){
      if(data.winner===1){
        this.result=this.stage===CAMPAIGN.length-1?'complete':'won';
        this.saved={stage:Math.min(CAMPAIGN.length-1,this.stage+1),completed:this.result==='complete'};this.#save();
      }else if(data.winner===2)this.result='lost';
    }
  }
  view(game){
    if(this.drill)return {kind:this.kind,...this.drill.view(game),campaignStage:this.stage,opponentName:this.configuration().opponentName};
    const training=this.kind==='training',precision=this.kind==='precision',campaign=this.kind==='campaign';
    const completed=training?this.objectiveIndex>=7:precision?this.objectiveIndex>=3:campaign&&(this.saved.completed||this.result==='complete');
    let instruction='Perforá el globo rival para ganar la partida.';
    if(training)instruction=completed?'Entrenamiento completado. Ya podés ponerlo en práctica.':TRAINING[this.objectiveIndex];
    if(precision)instruction=completed?'Tres impactos precisos completados.':'Perforá dentro del círculo marcado. Los impactos fuera de zona no cuentan.';
    if(this.kind==='practice')instruction='Ensayá movimientos y perforaciones. El rival no ataca y la práctica continúa tras cada globo.';
    if(campaign)instruction=completed?'El Maestro Hidráulico fue derrotado. Campaña completada.':this.result==='won'?'Victoria confirmada. El siguiente rival está disponible.':
      this.result==='lost'?'Partida perdida. Reintentá este encuentro.':`Encuentro ${this.stage+1} de ${CAMPAIGN.length}: ${CAMPAIGN[this.stage].name}.`;
    return {kind:this.kind,title:TITLES[this.kind],instruction,completed,progress:campaign?(completed?7:this.stage+(this.result==='won'?1:0)):this.objectiveIndex,
      total:training?7:precision?3:campaign?7:0,objectiveIndex:this.objectiveIndex,status:completed?'completed':this.result,
      nextAction:(campaign||this.kind==='duel')?(this.result==='won'?'advance':this.result==='lost'?'retry':null):completed?'repeat':null,
      target:precision&&!completed?precisionTarget(game,this.objectiveIndex):null,campaignStage:this.stage,opponentName:this.configuration().opponentName};
  }
  next(){
    if(this.drill){if(!this.drill.completed)return false;this.drill.repeat();this.objectiveIndex=0;return true;}
    if(this.kind==='duel'){
      if(this.result!=='won'&&this.result!=='lost')return false;
      if(this.result==='won')this.duelOpponent=randomOpponent(this.opponentRandom);
      this.result='idle';this.demoMatch=false;this.reference=null;this.hold=0;this.usedBalloons=new WeakSet();return true;
    }
    if(this.kind==='campaign'){
      if(this.result!=='won'&&this.result!=='lost')return false;
      if(this.result==='won')this.stage=this.saved.stage;
      this.result='idle';this.demoMatch=false;this.reference=null;this.hold=0;this.usedBalloons=new WeakSet();return true;
    }
    if((this.kind==='training'&&this.objectiveIndex>=7)||(this.kind==='precision'&&this.objectiveIndex>=3)){
      this.objectiveIndex=0;this.reference=null;this.hold=0;this.demoMatch=false;this.usedBalloons=new WeakSet();return true;
    }
    return false;
  }
  resetProgress(){
    this.saved=emptyProgress();this.stage=0;this.result='idle';this.demoMatch=false;this.reference=null;this.hold=0;
    try{this.storage?.removeItem(SINGLE_PLAYER_STORAGE_KEY);}catch{/* Optional storage never blocks local play. */}
  }
  #save(){try{this.storage?.setItem(SINGLE_PLAYER_STORAGE_KEY,JSON.stringify({version:1,...this.saved}));}catch{/* Play continues without persistence. */}}
}
