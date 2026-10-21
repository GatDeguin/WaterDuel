// Native Web Audio spatialization and bounded shared early room reflections.
// No PCM, convolution impulse, Worklet, timer or solver is created here.
const finite=Number.isFinite;
const bound=(value,min,max,fallback)=>finite(value)?Math.max(min,Math.min(max,value)):fallback;
const point=value=>({x:bound(value?.x,-8,8,0),y:bound(value?.y,-2,8,1.8),z:bound(value?.z,-8,16,0)});
const set=(param,value,now)=>{if(param?.setValueAtTime)param.setValueAtTime(value,now);else if(param)param.value=value;};
const ROOM_SEND={ring:.22,'blade-beat':.18,'blade-slide':.12,'shield-metal':.18,metal:.18,'wood-contact':.09,'shield-wood':.09,wood:.07,joint:.06,'water-burst':.12,splash:.1,drip:.09,'footstep-dry':.05,'footstep-wet':.06};
export class WorkshopAcoustics{
  constructor(context,destination){this.context=context;this.destination=destination;this.roomNodes=[];this.roomInput=null;this.listenerKey='';this.setListener();}
  setListener(camera=null){
    const listener=this.context.listener;if(!listener)return false;
    const eye=camera?.eye,target=camera?.target,valid=Array.isArray(eye)&&eye.length===3&&eye.every(finite)&&Array.isArray(target)&&target.length===3&&target.every(finite);
    const position=valid?eye:[0,1.94,10.4],difference=valid?target.map((value,i)=>value-eye[i]):[0,0,-1],length=Math.hypot(...difference);
    if(!finite(length)||length<1e-8)return false;
    const forward=difference.map(value=>value/length),upSeed=Math.abs(forward[1])>.98?[0,0,1]:[0,1,0];
    const dot=upSeed.reduce((sum,value,i)=>sum+value*forward[i],0),rawUp=upSeed.map((value,i)=>value-dot*forward[i]),upLength=Math.hypot(...rawUp),up=rawUp.map(value=>value/upLength);
    const values=[...position,...forward,...up],key=values.join('|');if(this.listenerKey===key)return true;this.listenerKey=key;
    const now=this.context.currentTime;
    if(listener.positionX&&listener.forwardX){
      for(const [prefix,vector]of [['position',position],['forward',forward],['up',up]])for(let i=0;i<3;i++)set(listener[prefix+'XYZ'[i]],vector[i],now);
    }else{listener.setPosition?.(...position);listener.setOrientation?.(...forward,...up);}
    return true;
  }
  resetRoom(){
    for(const node of this.roomNodes)try{node.disconnect();}catch{}this.roomNodes=[];this.roomInput=null;
  }
  ensureRoom(){
    if(this.roomInput||this.context.state!=='running')return;
    const ctx=this.context;if(typeof ctx.createDelay!=='function'||typeof ctx.createBiquadFilter!=='function')return;
    try{
      const input=ctx.createGain(),filter=ctx.createBiquadFilter();this.roomNodes.push(input,filter);filter.type='lowpass';filter.frequency.value=2800;filter.Q.value=.35;input.connect(filter);
      // Feed-forward only: finite 97 ms tail, no unstable feedback or stale
      // convolution buffers. The dry path remains unchanged and room is shared.
      for(const [seconds,level]of [[.043,.4],[.097,.23]]){const delay=ctx.createDelay(.2),gain=ctx.createGain();this.roomNodes.push(delay,gain);delay.delayTime.value=seconds;gain.gain.value=level;filter.connect(delay).connect(gain).connect(this.destination);}
      this.roomInput=input;
    }catch{for(const node of this.roomNodes)try{node.disconnect();}catch{}this.roomNodes=[];}
  }
  source(location,name){
    const ctx=this.context,at=point(location);let pan=null,spatial=false;
    try{if(typeof ctx.createPanner==='function'){
      pan=ctx.createPanner();pan.panningModel='HRTF';pan.distanceModel='inverse';pan.refDistance=7;pan.maxDistance=40;pan.rolloffFactor=.7;pan.coneInnerAngle=360;pan.coneOuterAngle=360;pan.coneOuterGain=1;
      if(pan.positionX){set(pan.positionX,at.x,ctx.currentTime);set(pan.positionY,at.y,ctx.currentTime);set(pan.positionZ,at.z,ctx.currentTime);}else if(pan.setPosition)pan.setPosition(at.x,at.y,at.z);else throw Error('Panner position unavailable');spatial=true;
    }}catch{try{pan?.disconnect();}catch{}pan=null;}
    if(!pan){pan=typeof ctx.createStereoPanner==='function'?ctx.createStereoPanner():ctx.createGain();if(pan.pan)pan.pan.value=bound(at.x/3.2,-.85,.85,0);}
    pan.connect(this.destination);let send=null;
    const room=ROOM_SEND[name]??.035;
    if(room>0)this.ensureRoom();
    if(this.roomInput&&room>0){send=ctx.createGain();send.gain.value=room;pan.connect(send).connect(this.roomInput);}
    return {pan,send,spatial,at};
  }
  dispose(){this.resetRoom();}
}
