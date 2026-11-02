import {APRON_GEOMETRY} from './apron-geometry.js';
import {TABLE_TOP} from './dimensions.js';

const STEP=1/120;
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);};
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const copy=a=>a.map(p=>[...p]);
export const APRON_TRIANGLES=Object.freeze(Array.from({length:6},(_,i)=>{
  const a=Math.floor(i/2)*3+i%2;return [[a,a+3,a+1],[a+1,a+3,a+4]];
}).flat().map(Object.freeze));
// The topology and four quadrature weights never change. Keep their original
// order and reduction association, including zero-weight free-node updates.
const contactSamples=APRON_TRIANGLES.flatMap(triangle=>[[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5]].map(weights=>({
  a:triangle[0],b:triangle[1],c:triangle[2],wa:weights[0],wb:weights[1],wc:weights[2],
  sum:triangle.reduce((s,i,j)=>s+(i<3?0:weights[j]**2),0)
})));

/** The 2 x 3 panels have 3 x 4 nodes. Coordinates are canonical metres;
 * thickness is a normal offset, shared by rendering and collision clearance. */
export function apronRestGrid(descriptor){
  const {min,max}=descriptor.bounds,z=descriptor.pivot[2];
  return Array.from({length:12},(_,i)=>[min[0]+(max[0]-min[0])*(i%3)/2,max[1]-(max[1]-min[1])*Math.floor(i/3)/3,z]);
}

/** Shared through-thickness directions. A cut vertex has one director field,
 * independent of the triangle containing its duplicate UV/material vertices. */
export function apronDirectors(normals){
  const sums=Array.from({length:12},()=>[0,0,0]);
  APRON_TRIANGLES.forEach((triangle,t)=>triangle.forEach(i=>{for(let k=0;k<3;k++)sums[i][k]+=normals[t][k];}));
  return sums.map((sum,i)=>Math.hypot(...sum)>1e-9?unit(sum):[...normals[APRON_TRIANGLES.findIndex(t=>t.includes(i))]]);
}

const surfaceFields=new WeakMap();
/** Evaluate the continuous thick surface and its local derivatives. The middle
 * surface is the solver's triangles; interpolated unit directors carry the
 * authored nonzero thickness across their shared edges without opening seams. */
export function apronSurfaceSample(cloth,canonical,panel,scale=1){
  let fields=surfaceFields.get(cloth);
  if(!fields){
    const directors=cloth.directors??apronDirectors(cloth.normals);
    fields=cloth.triangles.map(([a,b,c])=>{
      const ra=cloth.rest[a],rb=cloth.rest[b],rc=cloth.rest[c],ax=rb[0]-ra[0],ay=rb[1]-ra[1],bx=rc[0]-ra[0],by=rc[1]-ra[1],det=ax*by-ay*bx;
      const wx=[-(by-ay)/det,by/det,-ay/det],wy=[-(ax-bx)/det,-bx/det,ax/det],indices=[a,b,c];
      const derivative=(values,weights)=>[0,1,2].map(k=>indices.reduce((sum,i,j)=>sum+values[i][k]*weights[j],0));
      return {ra,ax,ay,bx,by,det,indices,directors,px:derivative(cloth.positions,wx),py:derivative(cloth.positions,wy),dx:derivative(directors,wx),dy:derivative(directors,wy)};
    });surfaceFields.set(cloth,fields);
  }
  const f=fields[panel],x=canonical[0]-f.ra[0],y=canonical[1]-f.ra[1],u=(x*f.by-y*f.bx)/f.det,v=(f.ax*y-f.ay*x)/f.det,w=[1-u-v,u,v];
  const interpolate=values=>[0,1,2].map(k=>f.indices.reduce((sum,i,j)=>sum+values[i][k]*w[j],0));
  const middle=interpolate(cloth.positions),raw=interpolate(f.directors),length=Math.hypot(...raw),director=length>1e-9?raw.map(v=>v/length):f.directors[f.indices[w.indexOf(Math.max(...w))]];
  const depth=(canonical[2]-f.ra[2])*scale;
  const derivative=(base,delta)=>{const along=dot(director,delta);return base.map((p,k)=>p+depth*(delta[k]-director[k]*along)/Math.max(length,1e-9));};
  return {position:middle.map((p,k)=>p+depth*director[k]),dx:derivative(f.px,f.dx),dy:derivative(f.py,f.dy),dz:director.map(v=>v*scale),director};
}

function legCapsules(pose,scale){
  if(!pose)return [];
  const vector=p=>[p.x,p.y,p.z??0],result=[];
  for(const side of ['F','B']){
    const prefix=side==='F'?'front':'back',hip=pose[`${prefix}Hip`],knee=pose[`knee${side}`],ankle=pose[`ankle${side}`]??pose[`foot${side}`];
    if(hip&&knee&&pose.clothLegs?.[`${prefix}Thigh`]!==false)result.push({a:vector(hip),b:vector(knee),radius:.09*scale});
    if(knee&&ankle&&pose.clothLegs?.[`${prefix}Shin`]!==false)result.push({a:vector(knee),b:vector(ankle),radius:.07*scale});
  }
  return result;
}
function capsulePushFallback(x,y,z,c,radius,push){
  // Typed-array map operations can round intermediate axes and centers. Keep
  // the original path for those inputs and non-three-dimensional endpoints.
  const p=[x,y,z],axis=sub(c.b,c.a),t=Math.max(0,Math.min(1,dot(sub(p,c.a),axis)/(dot(axis,axis)||1))),center=c.a.map((v,i)=>v+t*axis[i]),d=sub(p,center),length=Math.hypot(...d),penetration=c.radius+radius-length;
  if(!(penetration>0))return false;
  const result=length>1e-10?d.map(v=>v*penetration/length):[0,0,penetration];
  push[0]=result[0];push[1]=result[1];push[2]=result[2];return true;
}
function capsulePush(x,y,z,c,radius,push){
  // Read the axis for each projection: caller-supplied capsules may alias live
  // cloth nodes. The leading zero matches the original dot-product reduction.
  const a=c.a,b=c.b;
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==3||b.length!==3)return capsulePushFallback(x,y,z,c,radius,push);
  const ax=b[0]-a[0],ay=b[1]-a[1],az=b[2]-a[2];
  const t=Math.max(0,Math.min(1,((0+(x-a[0])*ax)+(y-a[1])*ay+(z-a[2])*az)/((0+ax*ax)+ay*ay+az*az||1)));
  const dx=x-(a[0]+t*ax),dy=y-(a[1]+t*ay),dz=z-(a[2]+t*az),length=Math.hypot(dx,dy,dz),penetration=c.radius+radius-length;
  if(!(penetration>0))return false;
  if(length>1e-10){push[0]=dx*penetration/length;push[1]=dy*penetration/length;push[2]=dz*penetration/length;}
  else{push[0]=0;push[1]=0;push[2]=penetration;}
  return true;
}

/** Kinematic belt + second order reduced cloth. Reactions only modify these
 * twelve nodes: neither gravity nor any accessory collision moves the rig. */
export class ApronCloth{
  constructor(variant='normal',descriptor=null){
    this.variant=variant in APRON_GEOMETRY?variant:'normal';this.geometry=descriptor??APRON_GEOMETRY[this.variant];
    this.rest=apronRestGrid(this.geometry);this.positions=[];this.velocities=Array.from({length:12},()=>[0,0,0]);
    this.frame=null;this.accumulator=0;this.wetness={top:0,bottom:0};this.contact=false;this.contactNodes=Array(12).fill(false);
    this.thickness=Math.max(...[this.geometry.bounds.min[2],this.geometry.bounds.max[2]].map(z=>Math.abs(z-this.geometry.pivot[2])));
    this.constraints=[];
    const edge=(a,b,stiffness)=>this.constraints.push({a,b,stiffness});
    for(let r=0;r<4;r++)for(let c=0;c<3;c++){
      const i=r*3+c;if(c<2)edge(i,i+1,.94);if(r<3)edge(i,i+3,.96);
      if(r<3&&c<2){edge(i,i+4,.55);edge(i+1,i+3,.55);}
      // Two-hop distances resist sharp bending, without locking panel normals.
      if(r<2)edge(i,i+6,.035);if(c===0)edge(i,i+2,.035);
    }
  }
  advance(dt,{frame,gravity=-9.81,pose=null,colliders=null}={}){
    if(!frame?.every(Number.isFinite)||frame.length!==16)throw new Error('Cloth requires a finite belt frame');
    this.frame=new Float64Array(frame);
    if(!this.positions.length)this.positions=this.rest.map(p=>point(frame,p));
    // Body contact projection can refresh the belt with dt=0. Its kinematic
    // pins must agree immediately; free nodes retain their inertial state.
    for(let i=0;i<3;i++)this.positions[i]=point(frame,this.rest[i]);
    if(!Number.isFinite(dt)||dt<=0)return;
    this.accumulator+=dt;
    const scale=Math.hypot(frame[8],frame[9],frame[10]),legs=colliders??legCapsules(pose,scale);
    while(this.accumulator>=STEP-1e-12){this.integrate(STEP,gravity,legs,scale);this.accumulator=Math.max(0,this.accumulator-STEP);}
  }
  integrate(dt,gravity,colliders,scale){
    const old=copy(this.positions),targets=this.rest.map(p=>point(this.frame,p));this.contactNodes.fill(false);this.contact=false;
    this.wetness.top*=Math.exp(-dt/24);this.wetness.bottom*=Math.exp(-dt/24);
    for(let i=0;i<12;i++){
      if(i<3){this.positions[i]=targets[i];continue;}
      const wet=this.wetness[Math.floor(i/3)<2?'top':'bottom'],drag=Math.exp(-dt*(2.8+5*wet));
      for(let k=0;k<3;k++){this.velocities[i][k]*=drag;if(k===1)this.velocities[i][k]+=gravity*dt;this.positions[i][k]+=this.velocities[i][k]*dt;}
    }
    const clearance=this.thickness*scale+8e-6,floor=TABLE_TOP+clearance,push=[0,0,0];
    for(let iteration=0;iteration<10;iteration++){
      for(const {a,b,stiffness} of this.constraints){
        const pa=this.positions[a],pb=this.positions[b],dx=pb[0]-pa[0],dy=pb[1]-pa[1],dz=pb[2]-pa[2],length=Math.hypot(dx,dy,dz),
          ta=targets[a],tb=targets[b],restLength=Math.hypot(tb[0]-ta[0],tb[1]-ta[1],tb[2]-ta[2]),wa=a<3?0:1,wb=b<3?0:1;
        if(length<1e-12||wa+wb===0)continue;
        const correction=stiffness*(length-restLength)/(length*(wa+wb));
        pa[0]+=dx*correction*wa;pb[0]-=dx*correction*wb;
        pa[1]+=dy*correction*wa;pb[1]-=dy*correction*wb;
        pa[2]+=dz*correction*wa;pb[2]-=dz*correction*wb;
      }
      for(let i=3;i<12;i++){
        const p=this.positions[i];
        for(const collider of colliders){if(capsulePush(p[0],p[1],p[2],collider,clearance,push)){p[0]+=push[0];p[1]+=push[1];p[2]+=push[2];this.contactNodes[i]=true;}}
        if(this.positions[i][1]<floor){this.positions[i][1]=floor;this.contactNodes[i]=true;}
      }
      // Interior samples constrain the same piecewise planar surface as render
      // and water, including a leg crossing between nodes of a wide boss panel.
      for(const {a,b,c,wa,wb,wc,sum} of contactSamples){
        const pa=this.positions[a],pb=this.positions[b],pc=this.positions[c],
          x=((0+pa[0]*wa)+pb[0]*wb)+pc[0]*wc,y=((0+pa[1]*wa)+pb[1]*wb)+pc[1]*wc,z=((0+pa[2]*wa)+pb[2]*wb)+pc[2]*wc;
        for(const collider of colliders){
          if(!capsulePush(x,y,z,collider,clearance,push)||sum<1e-10)continue;
          if(a>=3){pa[0]+=push[0]*wa/sum;pa[1]+=push[1]*wa/sum;pa[2]+=push[2]*wa/sum;this.contactNodes[a]=true;}
          if(b>=3){pb[0]+=push[0]*wb/sum;pb[1]+=push[1]*wb/sum;pb[2]+=push[2]*wb/sum;this.contactNodes[b]=true;}
          if(c>=3){pc[0]+=push[0]*wc/sum;pc[1]+=push[1]*wc/sum;pc[2]+=push[2]*wc/sum;this.contactNodes[c]=true;}
        }
      }
    }
    for(let i=3;i<12;i++){
      if(this.positions[i][1]<floor){this.positions[i][1]=floor;this.contactNodes[i]=true;}
      for(let k=0;k<3;k++)this.velocities[i][k]=Math.max(-8,Math.min(8,(this.positions[i][k]-old[i][k])/dt));
      if(this.contactNodes[i]){this.contact=true;for(let k=0;k<3;k++)this.velocities[i][k]*=.65;}
    }
  }
  snapshot(){
    const normals=APRON_TRIANGLES.map(([a,b,c])=>unit(cross(sub(this.positions[b],this.positions[a]),sub(this.positions[c],this.positions[a]))));
    return {variant:this.variant,angle:0,angularVelocity:0,contact:this.contact,wetness:{...this.wetness},canonicalMatrix:this.frame?new Float64Array(this.frame):null,
      cloth:{revision:4,columns:2,rows:3,rest:copy(this.rest),positions:copy(this.positions),velocities:copy(this.velocities),normals,directors:apronDirectors(normals),
        triangles:APRON_TRIANGLES.map(t=>[...t]),contactNodes:[...this.contactNodes],thickness:this.thickness*(this.frame?Math.hypot(this.frame[8],this.frame[9],this.frame[10]):1)}};
  }
}
