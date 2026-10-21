/** Bounded visual interpolation. These two owned frames never enter a solver or
 * the replay recorder. Real ledger values/topology remain discrete; positions
 * share one interpolation time across body, liquid and latex.
 */
import {capHeightForFraction} from './physics/dimensions.js';
const clamp=t=>Math.max(0,Math.min(1,Number.isFinite(t)?t:0));
const mix=(a,b,t)=>a+(b-a)*t;
function own(value){
  if(ArrayBuffer.isView(value))return value.slice();
  if(Array.isArray(value))return value.map(own);
  if(value&&typeof value==='object'){const out={};for(const key in value)if(Object.hasOwn(value,key))out[key]=own(value[key]);return out;}
  return value;
}
const length=a=>Math.hypot(...a);

function quaternion(matrix){
  const scale=[0,1,2].map(c=>length([matrix[c*4],matrix[c*4+1],matrix[c*4+2]]));
  const m=(r,c)=>matrix[c*4+r]/(scale[c]||1),trace=m(0,0)+m(1,1)+m(2,2);let q;
  if(trace>0){const s=Math.sqrt(trace+1)*2;q=[(m(2,1)-m(1,2))/s,(m(0,2)-m(2,0))/s,(m(1,0)-m(0,1))/s,s/4];}
  else if(m(0,0)>m(1,1)&&m(0,0)>m(2,2)){const s=Math.sqrt(1+m(0,0)-m(1,1)-m(2,2))*2;q=[s/4,(m(0,1)+m(1,0))/s,(m(0,2)+m(2,0))/s,(m(2,1)-m(1,2))/s];}
  else if(m(1,1)>m(2,2)){const s=Math.sqrt(1+m(1,1)-m(0,0)-m(2,2))*2;q=[(m(0,1)+m(1,0))/s,s/4,(m(1,2)+m(2,1))/s,(m(0,2)-m(2,0))/s];}
  else{const s=Math.sqrt(1+m(2,2)-m(0,0)-m(1,1))*2;q=[(m(0,2)+m(2,0))/s,(m(1,2)+m(2,1))/s,s/4,(m(1,0)-m(0,1))/s];}
  const norm=length(q)||1;return {q:q.map(v=>v/norm),scale};
}
function rigidMatrix(a,b,t){
  const x=quaternion(a),y=quaternion(b),sign=x.q.reduce((sum,v,i)=>sum+v*y.q[i],0)<0?-1:1;
  const raw=x.q.map((v,i)=>mix(v,y.q[i]*sign,t)),norm=length(raw)||1,[qx,qy,qz,qw]=raw.map(v=>v/norm),s=x.scale.map((v,i)=>mix(v,y.scale[i],t));
  return new Float64Array([(1-2*(qy*qy+qz*qz))*s[0],2*(qx*qy+qz*qw)*s[0],2*(qx*qz-qy*qw)*s[0],0,
    2*(qx*qy-qz*qw)*s[1],(1-2*(qx*qx+qz*qz))*s[1],2*(qy*qz+qx*qw)*s[1],0,
    2*(qx*qz+qy*qw)*s[2],2*(qy*qz-qx*qw)*s[2],(1-2*(qx*qx+qy*qy))*s[2],0,
    mix(a[12],b[12],t),mix(a[13],b[13],t),mix(a[14],b[14],t),1]);
}
function blend(a,b,t,key=''){
  if(typeof a==='number'&&typeof b==='number')return mix(a,b,t);
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return own(b);
  if(key==='joints')return own(b);
  if(key==='detached'&&Array.isArray(b))return b.map(fragment=>{
    const previous=Array.isArray(a)?a.find(old=>old.id===fragment.id&&old.joint===fragment.joint&&
      old.bodies.length===fragment.bodies.length&&old.bodies.every((body,i)=>body===fragment.bodies[i])):null;
    return {...own(fragment),transform:previous?rigidMatrix(previous.transform,fragment.transform,t):own(fragment.transform)};
  });
  if(key==='canonicalMatrix'&&a.length===16&&b.length===16)return rigidMatrix(a,b,t);
  if(Array.isArray(b)||ArrayBuffer.isView(b))return b.length===a.length?Array.from(b,(v,i)=>blend(a[i],v,t)):own(b);
  return Object.fromEntries(Object.entries(b).map(([k,v])=>[k,blend(a[k],v,t,k)]));
}
function waterFrame(a,b,t){
  if(!a||!b)return own(b);
  const matrix=r=>[r[0],r[3],r[6],0,r[1],r[4],r[7],0,r[2],r[5],r[8],0,0,0,0,1],m=rigidMatrix(matrix(a.rotation),matrix(b.rotation),t);
  const fraction=mix(a.fraction,b.fraction,t);
  return {...own(b),fraction,height:capHeightForFraction(fraction),rotation:[m[0],m[4],m[8],m[1],m[5],m[9],m[2],m[6],m[10]]};
}
const positions=['x','y','z','age','rz','rx'];
// Particle fields are scalar; membrane ref is immutable rest geometry. Copying
// solver-only lambdas, velocities or adjacency here buys no visual information.
const captureParticles=particles=>(particles??[]).map(source=>({source,value:{...source}}));
const captureNodes=nodes=>nodes.map(source=>({source,value:{x:source.x,y:source.y,z:source.z,ref:source.ref}}));
function particleView(previous,current,cache,t){
  const old=new Map((previous??[]).map(p=>[p.source,p.value]));
  return current.map(({source,value})=>{
    let out=cache.get(source);if(!out){out={};cache.set(source,out);}Object.assign(out,value);
    const before=old.get(source),sameLife=before&&before.kind===value.kind&&before.source===value.source&&before.phase===value.phase;
    if(sameLife)for(const key of positions)if(Number.isFinite(before[key])&&Number.isFinite(value[key]))out[key]=mix(before[key],value[key],t);
    return out;
  });
}
function captureFighter(f){
  const {fluid,membrane}=f;
  return {source:f,pose:own(f.pose),balloon:own(f.balloon),waterShift:f.waterShift,hitFlash:f.hitFlash,
    fluid:{released:fluid.released,leaking:fluid.leaking,scale:fluid.scale,count:fluid.count,phaseVersion:fluid.phaseVersion,
      initialVolume:fluid.initialVolume,retainedVolume:fluid.retainedVolume,releasedVolume:fluid.releasedVolume,
      surfaceFrame:own(fluid.surfaceFrame),impact:own(fluid.impact),localImpact:own(fluid.localImpact),particles:captureParticles(fluid.particles)},
    membrane:membrane?{prototype:Object.getPrototypeOf(membrane),punctured:membrane.punctured,subdivisions:membrane.subdivisions,
      contactFloor:membrane.contactFloor,contactDepth:membrane.contactDepth,contactBounds:membrane.contactBounds,
      version:membrane.version,nodes:captureNodes(membrane.nodes),faces:membrane.faces.map(f=>({a:f.a,b:f.b,c:f.c,restArea:f.restArea,fragment:f.fragment}))}:null};
}
export class SimulationPresentation{
  constructor(){this.reset();}
  reset(){this.previous=null;this.current=null;this.scene=null;this.views=[];this.particleCache=new WeakMap();this.serial=0;}
  matches(game){return !!this.current&&this.current.fighters.every((f,i)=>f.source===game.fighters[i]);}
  capture(game){
    const frame={fighters:game.fighters.map(captureFighter)};
    for(const key of ['particles','rings','shards','spark'])frame[key]=captureParticles(game[key]);
    frame.effects=captureParticles(game.effects?.particles);
    this.previous=this.matches(game)?this.current:frame;this.current=frame;
  }
  view(game,alpha=0){
    if(game.phase!=='burst'||game.replay||!this.matches(game))return game;
    const t=clamp(alpha);this.serial++;
    if(!this.scene){this.scene={};this.views=game.fighters.map(()=>({fluid:{},membrane:null}));}
    // Read-only presentation metadata follows the authoritative current match.
    // Neither this scene nor its visual subobjects are passed back to engine.
    Object.assign(this.scene,game);
    this.scene.fighters=this.current.fighters.map((now,index)=>{
      const before=this.previous.fighters[index],source=game.fighters[index],out=this.views[index];
      Object.assign(out,{slot:source.slot,dir:source.dir,boss:source.boss,baseX:source.baseX,lean:source.lean,globIntact:source.globIntact,
        balloonSize:source.balloonSize,balloonMass:source.balloonMass,balloonColor:source.balloonColor,matchApronToBalloon:source.matchApronToBalloon,equipment:source.equipment,
        guard:source.guard,guardEnergy:source.guardEnergy,guardBroken:source.guardBroken,
        pose:blend(before.pose,now.pose,t),balloon:blend(before.balloon,now.balloon,t),waterShift:mix(before.waterShift,now.waterShift,t),hitFlash:mix(before.hitFlash,now.hitFlash,t)});
      const fluid=out.fluid,nowFluid=now.fluid;
      Object.assign(fluid,nowFluid);fluid.surfaceFrame=waterFrame(before.fluid.surfaceFrame,nowFluid.surfaceFrame,t);
      fluid.particles=particleView(before.fluid.particles,nowFluid.particles,this.particleCache,t);
      fluid.releasedParticles=fluid.leaking?fluid.particles.filter(p=>p.free):fluid.released?fluid.particles:[];
      fluid.retainedParticles=fluid.leaking?fluid.particles.filter(p=>!p.free):fluid.released?[]:fluid.particles;
      if(now.membrane){
        const m=now.membrane;if(!out.membrane)out.membrane=Object.create(m.prototype);
        Object.assign(out.membrane,m,{version:this.serial,meshCache:null,nodes:particleView(before.membrane?.nodes,m.nodes,this.particleCache,t)});
      }else out.membrane=null;
      return out;
    });
    for(const key of ['particles','rings','shards','spark'])this.scene[key]=particleView(this.previous[key],this.current[key],this.particleCache,t);
    this.scene.effects={particles:particleView(this.previous.effects,this.current.effects,this.particleCache,t)};
    return this.scene;
  }
}
