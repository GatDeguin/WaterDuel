/** Seeded presentation particles. These never carry physical water or damage. */
const H=1/60,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const EFFECT_LIMITS=Object.freeze({total:176,dust:64,smoke:16,wood:28,spark:28,mist:28,glint:12});
const WINDOWS=Object.freeze([{x:-3.0051,y:3.7174,z:-4.5561},{x:3.0051,y:3.9759,z:-4.5561}]);
const STYLES=Object.freeze({
  dust:{color:0xc7c0ae,opacity:.13,material:5,order:.5},smoke:{color:0x8e887e,opacity:.035,material:5,order:.5},
  wood:{color:0x9b744b,opacity:.30,material:8,order:2.5},spark:{color:0xffc274,opacity:.75,material:6,order:2.5},
  mist:{color:0xc8dedb,opacity:.08,material:5,order:2.5},glint:{color:0xc2e6df,opacity:.24,material:6,order:2.5}
});
const position=p=>p&&[p.x,p.y,p.z??0].every(Number.isFinite)&&Math.abs(p.x)<20&&p.y> -2&&p.y<12&&Math.abs(p.z??0)<20?{x:p.x,y:p.y,z:p.z??0}:null;
const ownParticle=p=>({kind:p.kind,source:p.source,x:p.x,y:p.y,z:p.z,r:p.r,alpha:p.alpha,age:p.age,ttl:p.ttl,visualOnly:true});

export class WorkshopEffects{
  constructor({seed=0x5744554c,ambient=true,windows=WINDOWS,combustionSources=[]}={}){
    this.state=(Number.isFinite(seed)?seed:0x5744554c)>>>0;this.ambient=!!ambient;this.particles=[];this.free=[];
    this.counts=Object.fromEntries(Object.keys(STYLES).map(kind=>[kind,0]));this.created=0;this.reused=0;this.time=0;this.accumulator=0;this.droppedTime=0;this.lastSteps=0;this.dustCredit=0;
    this.windows=[];this.combustionSources=[];this.smokeCredit=[];this.configureEnvironment({windows,combustionSources});
    if(this.ambient)for(let i=0;i<24;i++)this.#dust(true);
  }
  #random(){this.state=(Math.imul(this.state,1664525)+1013904223)>>>0;return this.state/4294967296;}
  #room(kind){return this.particles.length<EFFECT_LIMITS.total&&this.counts[kind]<EFFECT_LIMITS[kind];}
  #spawn(kind,source,p,v,r,ttl,age=0){
    if(!this.#room(kind))return null;
    let particle=this.free.pop();if(particle)this.reused++;else{particle={};this.created++;}
    Object.assign(particle,{kind,source,x:p.x,y:p.y,z:p.z,vx:v.x,vy:v.y,vz:v.z,r0:r,r,ttl,age,alpha:1,phase:this.#random()*Math.PI*2,visualOnly:true});
    this.#appearance(particle);this.particles.push(particle);this.counts[kind]++;return particle;
  }
  #retire(index){const p=this.particles[index];this.counts[p.kind]--;this.free.push(p);this.particles[index]=this.particles[this.particles.length-1];this.particles.pop();}
  #appearance(p){
    const u=clamp(p.age/p.ttl,0,1),grow=p.kind==='smoke'?1+u*1.4:p.kind==='mist'?1+u*.7:1;
    const fadeIn=p.kind==='smoke'||p.kind==='dust'?Math.min(1,p.age/.25):1;
    p.alpha=fadeIn*(1-u)**(p.kind==='spark'?1.2:1.7);p.r=p.r0*grow;
  }
  configureEnvironment({windows,combustionSources}={}){
    if(Array.isArray(windows))this.windows=windows.slice(0,4).map(position).filter(Boolean);
    if(Array.isArray(combustionSources)){
      this.combustionSources=combustionSources.slice(0,8).filter(p=>p?.kind==='oilLamp'||p?.kind==='candle').map(p=>{const v=position(p);return v?{...v,kind:p.kind}:null;}).filter(Boolean).slice(0,4);
      this.smokeCredit=this.combustionSources.map(()=>0);
    }
  }
  #dust(prewarm=false){
    if(!this.windows.length||!this.#room('dust'))return;
    const source=this.windows[Math.floor(this.#random()*this.windows.length)],ttl=9+this.#random()*7;
    const p={x:source.x+(this.#random()-.5)*1.9,y:source.y+(this.#random()-.5)*2.0,z:source.z+.25+this.#random()*1.9};
    this.#spawn('dust','window',p,{x:(this.#random()-.5)*.025,y:(this.#random()-.5)*.016,z:.008+this.#random()*.014},.003+this.#random()*.005,ttl,prewarm?(.1+this.#random()*.6)*ttl:0);
  }
  emit(name,data={}){
    if(name==='reset'){for(let i=this.particles.length-1;i>=0;i--)if(!['dust','smoke'].includes(this.particles[i].kind))this.#retire(i);return 0;}
    if(!data||typeof data!=='object')return 0;
    if(name==='joint-damage'||name==='joint-break'){
      const p=position(data.at);
      if(!p||![1,2].includes(data.slot)||!Number.isFinite(data.damage)||data.damage<=0||
        data.amount!==undefined&&(!Number.isFinite(data.amount)||data.amount<=0))return 0;
      const strength=clamp(data.amount??data.damage,.001,1);
      return this.#contact('wood',name,p,data.normal,strength,name==='joint-break'?6:2);
    }
    if(name==='burst'){
      if(data.contact!==true||data.demonstration===true)return 0;
      const sites=data.draw&&Array.isArray(data.impacts)?data.impacts.slice(0,2):[data.impact??data.at];let count=0;
      for(const site of sites){const p=position(site);if(p)count+=this.#contact('mist','burst',p,null,.15,12);}return count;
    }
    if(name!=='material-contact'&&name!=='clang')return 0;
    const p=position(data.at);if(!p)return 0;
    const knownImpulse=Number.isFinite(data.impulse),impulse=knownImpulse?clamp(data.impulse,0,.75):name==='clang'?.02:0;
    if(impulse<=.0001)return 0;
    const material=data.material??(name==='clang'?'metal':undefined),kind=['wood','composite','wood_metal_mixed'].includes(material)?'wood':material==='latex'?'glint':['metal','steel','brass','metal_mixed'].includes(material)?'spark':null;
    if(!kind)return 0;
    const count=kind==='glint'?2:clamp(Math.ceil(1+impulse*(kind==='spark'?20:24)),2,kind==='spark'?9:8);
    return this.#contact(kind,material,p,data.normal,impulse,count);
  }
  #contact(kind,source,p,normal,strength,count){
    let nx=Number.isFinite(normal?.x)?normal.x:0,ny=Number.isFinite(normal?.y)?normal.y:1,nz=Number.isFinite(normal?.z)?normal.z:0;
    const length=Math.hypot(nx,ny,nz)||1;nx/=length;ny/=length;nz/=length;let emitted=0;
    for(let i=0;i<count&&this.#room(kind);i++){
      const speed=kind==='spark'?.28+this.#random()*.75:kind==='wood'?.07+this.#random()*.23:.02+this.#random()*.12;
      const spread=kind==='glint'?.012:kind==='mist'?.10:.26;
      const v={x:nx*speed+(this.#random()-.5)*spread,y:ny*speed+(this.#random()-.5)*spread,z:nz*speed+(this.#random()-.5)*spread};
      const radius=kind==='spark'?.0025+this.#random()*.003:kind==='wood'?.0035+this.#random()*.006:kind==='glint'?.003:.008+this.#random()*.010;
      const ttl=kind==='spark'?.13+this.#random()*.16:kind==='wood'?.35+this.#random()*.45:kind==='glint'?.10:.35+this.#random()*.6;
      const at={x:p.x+nx*.007,y:p.y+ny*.007,z:p.z+nz*.007};this.#spawn(kind,source,at,v,radius,ttl);emitted++;
    }
    return emitted;
  }
  step(dt,_hostTime){
    if(!Number.isFinite(dt)||dt<=0){this.lastSteps=0;return 0;}
    const accepted=Math.min(.25,dt);this.droppedTime+=dt-accepted;this.accumulator+=accepted;let steps=0;
    while(this.accumulator>=H-1e-12){this.#tick();this.accumulator-=H;steps++;}
    this.lastSteps=steps;return steps;
  }
  #tick(){
    this.time+=H;
    for(let i=this.particles.length-1;i>=0;i--){
      const p=this.particles[i];p.age+=H;if(p.age>=p.ttl){this.#retire(i);continue;}
      if(p.kind==='dust'){
        p.x+=H*(p.vx+.009*Math.sin(this.time*.6+p.phase));p.y+=H*(p.vy+.006*Math.cos(this.time*.8+p.phase));p.z+=H*p.vz;
      }else{
        const gravity=p.kind==='spark'?-2.2:p.kind==='wood'?-.8:p.kind==='smoke'?.035:p.kind==='mist'?-.055:0;
        const drag=Math.exp(-H*(p.kind==='spark'?.5:p.kind==='smoke'?.3:1.5));p.vx*=drag;p.vz*=drag;p.vy=p.vy*drag+gravity*H;
        p.x+=H*p.vx;p.y+=H*p.vy;p.z+=H*p.vz;
      }
      this.#appearance(p);
    }
    if(!this.ambient)return;
    this.dustCredit+=4*H;while(this.dustCredit>=1){this.#dust();this.dustCredit--;}
    for(let i=0;i<this.combustionSources.length;i++){
      this.smokeCredit[i]+=.65*H;
      if(this.smokeCredit[i]<1)continue;this.smokeCredit[i]--;
      if(!this.#room('smoke'))continue;const p=this.combustionSources[i];
      this.#spawn('smoke',p.kind,{x:p.x,y:p.y+.025,z:p.z},{x:(this.#random()-.5)*.018,y:.045+this.#random()*.025,z:(this.#random()-.5)*.018},.023+this.#random()*.014,2.6+this.#random()*1.5);
    }
  }
  snapshot(){return {version:1,clock:this.time,particles:this.particles.map(ownParticle)};}
  stats(){return {count:this.particles.length,counts:{...this.counts},created:this.created,reused:this.reused,lastSteps:this.lastSteps,droppedTime:this.droppedTime};}
}

/** Fresh GPU views, at most six kinds × three alpha bands and 176 instances. */
export function effectBatches(particles){
  if(!Array.isArray(particles))return [];
  const groups=new Map(),levels=[.20,.55,.90];
  for(let i=0;i<Math.min(particles.length,EFFECT_LIMITS.total);i++){
    const p=particles[i],style=STYLES[p?.kind];if(!style||!position(p)||!Number.isFinite(p.r)||p.r<=0||!Number.isFinite(p.alpha)||p.alpha<.001)continue;
    const alpha=clamp(p.alpha,0,1),band=Math.min(2,Math.floor(alpha*3)),key=`${p.kind}:${band}`;
    if(!groups.has(key))groups.set(key,{particles:[],color:style.color,material:style.material,opacity:style.opacity*levels[band],order:style.order,depth:p.z});
    groups.get(key).particles.push({x:p.x,y:p.y,z:p.z,r:Math.min(.18,p.r*Math.sqrt(alpha/levels[band]))});
  }
  return [...groups.values()];
}
