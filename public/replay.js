/** Own visual snapshots. Never steps a solver, resolves contacts or changes score. */
const PARTICLE_KEYS=Object.freeze(['x','y','z','lx','ly','lz','ux','uy','uz','volume','r','age','ttl','vx','vy','vz','color','slot','wet','free','visualOnly','rz','rx','size','spin']);
const GAME_KEYS=['clock','elapsed','phaseClock','phase','round','winner','scores','mode','arena','quality','cameraMode','lightingMode','puddleStrength','difficulty','bestOf','roundsToWin','lastMessage','suddenDeath'];
const FIGHTER_KEYS=['slot','dir','boss','baseX','lean','globIntact','balloonSize','balloonMass','balloonColor','matchApronToBalloon','waterShift','hitFlash','guard','guardEnergy','guardBroken','equipment','pose','balloon'];

function own(value){
  if(ArrayBuffer.isView(value))return value.slice();
  if(Array.isArray(value))return value.map(own);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v!=='function').map(([k,v])=>[k,own(v)]));
  return value;
}
function fields(source,keys){const out={};for(const key of keys)if(source[key]!==undefined)out[key]=own(source[key]);return out;}
function packParticles(particles=[]){
  const data=new Float32Array(particles.length*PARTICLE_KEYS.length);
  for(let i=0;i<particles.length;i++)for(let k=0;k<PARTICLE_KEYS.length;k++){
    const value=particles[i][PARTICLE_KEYS[k]];data[i*PARTICLE_KEYS.length+k]=typeof value==='boolean'?Number(value):Number.isFinite(value)?value:0;
  }
  return {data,count:particles.length};
}
function unpackParticles(packed){
  return Array.from({length:packed.count},(_,i)=>{
    const particle={};
    for(let k=0;k<PARTICLE_KEYS.length;k++)particle[PARTICLE_KEYS[k]]=packed.data[i*PARTICLE_KEYS.length+k];
    return particle;
  });
}
function copyMesh(mesh){return {p:new Float32Array(mesh.p),n:new Float32Array(mesh.n),...(mesh.optics?{optics:new Float32Array(mesh.optics)}:{})};}

export function captureReplayState(game){
  const frame={version:1,time:0,...fields(game,GAME_KEYS)};
  frame.fighters=game.fighters.map(f=>{
    const fighter=fields(f,FIGHTER_KEYS),fluid=f.fluid;
    fighter.fluid={...fields(fluid,['released','leaking','scale','count','phaseVersion','initialVolume','retainedVolume','releasedVolume','surfaceFrame','impact','localImpact']),particles:packParticles(fluid.particles)};
    if(f.membrane){
      const top=f.membrane.nodes.reduce((a,b)=>b.ref.y>a.ref.y?b:a);
      fighter.membrane={punctured:!!f.membrane.punctured,mesh:copyMesh(f.membrane.mesh()),knot:{x:top.x,y:top.y,z:top.z}};
    }else fighter.membrane=null;
    return fighter;
  });
  for(const key of ['particles','rings','shards','spark'])frame[key]=packParticles(game[key]);
  frame.effects=game.effects?.snapshot?.()??null;
  return frame;
}

/** Fresh disposable view: renderer caches/offsets cannot change the saved frame. */
export function replayView(frame){
  const view={...fields(frame,GAME_KEYS),replay:true};
  view.fighters=frame.fighters.map(saved=>{
    const fighter=fields(saved,FIGHTER_KEYS),fluid={...fields(saved.fluid,['released','leaking','scale','count','phaseVersion','initialVolume','retainedVolume','releasedVolume','surfaceFrame','impact','localImpact']),particles:unpackParticles(saved.fluid.particles)};
    fluid.releasedParticles=fluid.leaking?fluid.particles.filter(p=>p.free):fluid.released?fluid.particles:[];
    fluid.retainedParticles=fluid.leaking?fluid.particles.filter(p=>!p.free):fluid.released?[]:fluid.particles;
    fighter.fluid=fluid;
    const membrane=saved.membrane;
    if(membrane){
      const mesh=copyMesh(membrane.mesh);
      fighter.membrane={punctured:membrane.punctured,nodes:[{...membrane.knot,ref:{y:1}}],mesh:()=>mesh};
    }else fighter.membrane=null;
    return fighter;
  });
  for(const key of ['particles','rings','shards','spark'])view[key]=unpackParticles(frame[key]);
  view.effects=own(frame.effects);
  return view;
}

// Accounting includes buffer bytes and deliberately padded JS metadata. V8/DOM/
// WebGL heap and one transient capture/playback view are outside this library.
function dataBytes(value){
  if(ArrayBuffer.isView(value))return value.byteLength+64;
  if(Array.isArray(value))return 32+value.reduce((sum,v)=>sum+8+dataBytes(v),0);
  if(value&&typeof value==='object')return 48+Object.entries(value).reduce((sum,[key,v])=>sum+32+key.length*2+dataBytes(v),0);
  return typeof value==='string'?24+value.length*2:16;
}
function contactEvent(data){
  const event={contact:true,demonstration:false,draw:!!data.draw,winner:[0,1,2].includes(data.winner)?data.winner:0,loser:[0,1,2].includes(data.loser)?data.loser:0};
  if(Array.isArray(data.score))event.score=data.score.slice(0,2).map(n=>Number.isFinite(n)?n:0);
  for(const key of ['impact','at'])if(data[key]&&Number.isFinite(data[key].x)&&Number.isFinite(data[key].y))event[key]={x:data[key].x,y:data[key].y,z:Number.isFinite(data[key].z)?data[key].z:0};
  if(Number.isFinite(data.relativeSpeed)&&data.relativeSpeed>=0)event.relativeSpeed=data.relativeSpeed;
  return event;
}
function option(value,fallback,min,max,name){
  const result=value??fallback;
  if(!Number.isFinite(result)||result<min||result>max)throw new RangeError(`${name} fuera de rango`);
  return result;
}

export class ReplayRecorder{
  #ring=[];#clips=[];#pending=null;#queued=null;#time=0;#nextSample=0;#nextId=1;#bytes=0;
  constructor({sampleHz=20,beforeSeconds=2,afterSeconds=1.2,maxClips=3,maxBytes=64*1024*1024}={}){
    this.sampleHz=option(sampleHz,20,1,120,'sampleHz');
    this.beforeSeconds=option(beforeSeconds,2,0,10,'beforeSeconds');
    this.afterSeconds=option(afterSeconds,1.2,0,10,'afterSeconds');
    this.maxClips=Math.floor(option(maxClips,3,0,10,'maxClips'));
    this.maxBytes=Math.floor(option(maxBytes,64*1024*1024,0,64*1024*1024,'maxBytes'));
  }
  get clips(){return this.#clips.slice();}
  get bytes(){return this.#bytes;}
  get pending(){return !!(this.#pending||this.#queued);}
  event(name,data={}){
    if(name!=='burst'||!data||typeof data!=='object'||data.contact!==true||data.demonstration||!this.maxClips||!this.maxBytes)return false;
    if(this.#pending)this.#finish(false);
    this.#queued=contactEvent(data);this.#limit();return !!this.#queued;
  }
  record(game,dt){
    if(!Number.isFinite(dt)||dt<0||!this.maxClips||!this.maxBytes)return false;
    this.#time+=dt;
    const scheduled=this.#time>=this.#nextSample-1e-10;
    if(!scheduled&&!this.#queued&&!(this.#pending&&this.#time>=this.#pending.until-1e-10))return false;
    if(scheduled)this.#nextSample=this.#time+1/this.sampleHz;
    const frame=captureReplayState(game);frame.time=this.#time;frame.bytes=dataBytes(frame)+58;
    this.#ring.push(frame);
    while(this.#ring.length&&this.#ring[0].time<this.#time-this.beforeSeconds-1e-10)this.#ring.shift();
    if(this.#queued){
      this.#pending={event:this.#queued,eventTime:frame.time,until:frame.time+this.afterSeconds,frames:this.#ring.slice()};this.#queued=null;
    }else if(this.#pending)this.#pending.frames.push(frame);
    if(this.#pending&&this.#time>=this.#pending.until-1e-10)this.#finish(true);
    this.#limit();return true;
  }
  newMatch(){
    this.#ring=[];this.#pending=null;this.#queued=null;this.#time=0;this.#nextSample=0;this.#limit();
  }
  clear(){this.#clips=[];this.newMatch();}
  #finish(complete){
    const pending=this.#pending;this.#pending=null;if(!pending?.frames.length)return;
    const first=pending.frames[0],last=pending.frames.at(-1);
    const clip={id:this.#nextId++,event:pending.event,eventTime:pending.eventTime,frames:pending.frames,startTime:first.time,endTime:last.time,duration:last.time-first.time,complete};
    clip.bytes=pending.frames.reduce((sum,frame)=>sum+frame.bytes+8,0)+dataBytes(clip.event)+256;
    this.#clips.push(clip);
    while(this.#clips.length>this.maxClips)this.#clips.shift();
  }
  #measure(){
    const frames=new Set(this.#ring);let bytes=this.#ring.length?32+this.#ring.length*8:0;
    for(const clip of this.#clips){bytes+=dataBytes(clip.event)+256+clip.frames.length*8;for(const frame of clip.frames)frames.add(frame);}
    if(this.#pending){bytes+=dataBytes(this.#pending.event)+256+this.#pending.frames.length*8;for(const frame of this.#pending.frames)frames.add(frame);}
    if(this.#queued)bytes+=dataBytes(this.#queued);
    for(const frame of frames)bytes+=frame.bytes;
    return bytes;
  }
  #limit(){
    let bytes=this.#measure();
    while(bytes>this.maxBytes){
      if(this.#clips.length)this.#clips.shift();
      else if(this.#ring.length)this.#ring.shift();
      else if(this.#pending)this.#pending=null;
      else if(this.#queued)this.#queued=null;
      else break;
      bytes=this.#measure();
    }
    this.#bytes=bytes;
  }
}
