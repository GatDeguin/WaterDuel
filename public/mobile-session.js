// The standalone page shares one HostSession in process. This transport owns
// neither a simulation clock nor a renderer and is safe to import on a remote
// controller: no engine, network, DOM or timers are created by this module.
const neutral=()=>({offX:0,offY:0,mainX:0,mainY:0,lean:0,bodyY:0,wrist:0,thrust:false,guard:false,attackHeld:false,headX:0,headZ:0});
const axes=['offX','offY','mainX','mainY','lean','bodyY','wrist','headX','headZ'];
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const noop=()=>{};

export class MobileSession{
  constructor({now=Date.now}={}){
    this.now=now;this.host=null;this.link=null;this.onInteraction=noop;this.onPause=noop;
    this.menuOpen=false;this.control=neutral();this.controlAt=-Infinity;
    this.hello=false;this.lastSeq=0;this.lastRequestId=0;
  }
  get paused(){return this.menuOpen;}
  bindHost(host,{onInteraction=noop,onPause=noop}={}){
    this.host=host??null;this.onInteraction=onInteraction;this.onPause=onPause;this.neutralize();
    this.onPause(this.paused);
    if(this.hello){this.deliver({type:'host',online:!!this.host});this.publish();}
  }
  connect(){
    this.link?.close();this.hello=false;this.lastSeq=0;this.lastRequestId=0;this.neutralize();
    const link={readyState:0,onopen:null,onmessage:null,onclose:null,
      send:raw=>{
        if(link.readyState!==1)throw new Error('El mando local todavía no está abierto.');
        if(this.link===link)this.receive(raw);
      },
      close:()=>{
        if(link.readyState===3)return;
        link.readyState=3;
        if(this.link===link){
          this.link=null;this.hello=false;this.neutralize();
          if(this.menuOpen){this.menuOpen=false;this.onPause(false);}
        }
        queueMicrotask(()=>link.onclose?.());
      }};
    this.link=link;
    queueMicrotask(()=>{if(this.link===link&&link.readyState===0){link.readyState=1;link.onopen?.();}});
    return link;
  }
  deliver(message){
    const link=this.link;if(!this.hello||!link||link.readyState!==1)return;
    const data=JSON.stringify(message);
    // Match the asynchronous WebSocket boundary. In particular, the controller
    // finishes installing its pending request before receiving the local ACK.
    queueMicrotask(()=>{if(this.link===link&&link.readyState===1)link.onmessage?.({data});});
  }
  receive(raw){
    if(typeof raw!=='string'||raw.length>16384)return;
    let message;try{message=JSON.parse(raw);}catch{return;}
    if(!record(message))return;
    if(message.type==='hello'){
      if(message.role!=='controller'||message.slot!==1)return;
      this.hello=true;this.neutralize();
      this.deliver({type:'welcome',role:'controller',slot:1,hostOnline:!!this.host,serverTime:this.now()});
      this.publish();return;
    }
    if(!this.hello)return;
    if(message.type==='ui-state'){
      if(typeof message.menuOpen!=='boolean')return;
      const changed=this.menuOpen!==message.menuOpen;this.menuOpen=message.menuOpen;this.neutralize();
      if(changed)this.onPause(this.paused);return;
    }
    if(message.type==='ping'){
      if(finite(message.at))this.deliver({type:'pong',at:message.at,serverTime:this.now()});return;
    }
    if(!this.host)return;
    if(message.type==='control'){
      const now=this.now();
      if(!positive(message.seq)||message.seq<=this.lastSeq||!finite(message.sentAt)||now-message.sentAt>450||message.sentAt-now>1000)return;
      this.lastSeq=message.seq;
      if(this.paused||message.neutralize===true){this.neutralize();return;}
      const control=neutral();
      for(const key of axes)control[key]=finite(message[key])?Math.max(-1,Math.min(1,message[key])):0;
      for(const key of ['thrust','guard','attackHeld'])control[key]=message[key]===true;
      this.control=control;this.controlAt=Math.min(now,message.sentAt);
      if(axes.some(key=>control[key]!==0)||control.thrust||control.guard||control.attackHeld)this.onInteraction();
      return;
    }
    if(message.type==='command'){
      const now=this.now();
      if(!positive(message.requestId)||message.requestId<=this.lastRequestId||!finite(message.sentAt)||message.sentAt<0||
        now-message.sentAt>2500||message.sentAt-now>1000)return;
      this.lastRequestId=message.requestId;this.onInteraction();
      const result=message.command==='setMode'&&message.value==='versus'?
        {ok:false,message:'En este teléfono se juega en modo individual. Versus está disponible en la arena de PC con dos mandos.'}:
        this.host.handleCommand(message);
      // onSettings may already have published an intermediate state. Always
      // append another state after this ACK so the existing UI can settle it.
      this.deliver({type:'command-result',requestId:message.requestId,...result});this.publish();
    }
  }
  sample(){
    if(this.paused||!this.hello||!this.host||this.now()-this.controlAt>450)return neutral();
    return {...this.control};
  }
  neutralize(){this.control=neutral();this.controlAt=-Infinity;}
  publish(){
    if(!this.host||!this.hello)return;
    const game=this.host.game;
    this.deliver({type:'state',phase:game.phase,mode:game.mode,score:[...game.scores],time:game.elapsed});
    this.deliver({type:'menu-state',state:this.host.menuState()});
  }
  event(name,slot=0){
    if(typeof name!=='string'||name.length===0||name.length>64||![0,1,2].includes(slot))return;
    this.deliver({type:'event',name,slot});
  }
}

export const mobileSession=new MobileSession();
export function connectMobileController(){return mobileSession.connect();}
