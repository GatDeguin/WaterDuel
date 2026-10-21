import {APRON_GEOMETRY} from './apron-geometry.js';
import {TABLE_TOP} from './dimensions.js';
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),unit=a=>mul(a,1/(Math.hypot(...a)||1));
const vec=p=>[p.x,p.y,p.z??0];
export const apronPoint=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const basis=(p,x,y,z)=>new Float64Array([...x,0,...y,0,...z,0,...p,1]);
export function apronMultiply(a,b){
  const m=new Float64Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)m[c*4+r]+=a[k*4+r]*b[c*4+k];return m;
}
function inverse(m){
  const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10],det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  const out=new Float64Array([(e*i-f*h)/det,(f*g-d*i)/det,(d*h-e*g)/det,0,(c*h-b*i)/det,(a*i-c*g)/det,(b*g-a*h)/det,0,(b*f-c*e)/det,(c*d-a*f)/det,(a*e-b*d)/det,0,0,0,0,1]);
  const p=apronPoint(out,[m[12],m[13],m[14]]);for(let k=0;k<3;k++)out[k+12]=-p[k];return out;
}
export function apronParentFrame(pose,dir,scale,descriptor){
  const hip=vec(pose.hip),main=vec(pose.mainShoulder),off=vec(pose.offShoulder),y=sub(mul(add(main,off),.5),hip);
  let x=sub(main,off),z=mul(unit(cross(x,y)),scale);if(dir<0){x=mul(x,-1);z=mul(z,-1);}
  return apronMultiply(basis(hip,x,y,z),inverse(descriptor.sourceTorsoFrame));
}
function rotate(v,axis,angle){
  const c=Math.cos(angle),s=Math.sin(angle),perp=cross(axis,v),parallel=dot(axis,v);
  return v.map((value,i)=>value*c+perp[i]*s+axis[i]*parallel*(1-c));
}
export function apronMatrix(frame,pivot,angle){
  if(angle===0)return new Float64Array(frame);
  const hinge=apronPoint(frame,pivot),axis=unit([frame[0],frame[1],frame[2]]),rotation=basis([0,0,0],rotate([1,0,0],axis,angle),rotate([0,1,0],axis,angle),rotate([0,0,1],axis,angle));
  const rotated=apronPoint(rotation,hinge);for(let k=0;k<3;k++)rotation[k+12]=hinge[k]-rotated[k];
  return apronMultiply(rotation,frame);
}

// A small semirigid hanging plate driven by a kinematic belt hinge. Contact
// reaction moves only this accessory; it cannot prop up or translate the body.
export class ApronHinge{
  constructor(variant='normal'){
    this.variant=variant in APRON_GEOMETRY?variant:'normal';this.geometry=APRON_GEOMETRY[this.variant];this.angle=0;this.angularVelocity=0;this.frame=null;this.contact=false;
    const {min,max}=this.geometry.bounds;this.center=min.map((v,i)=>(v+max[i])/2);this.mass=this.variant==='boss'?.085:.025;
    this.radius=Math.hypot(...sub(this.center,this.geometry.pivot));this.inertia=this.mass*(this.radius**2+((max[1]-min[1])**2+(max[2]-min[2])**2)/12);
  }
  minimum(frame,angle){
    const matrix=apronMatrix(frame,this.geometry.pivot,angle);return Math.min(...this.geometry.corners.map(p=>apronPoint(matrix,p)[1]));
  }
  advance(dt,{frame,passive=false,gravity=-9.81}){
    this.frame=new Float64Array(frame);this.contact=false;
    if(!passive){this.angle=0;this.angularVelocity=0;return;}
    const hinge=apronPoint(frame,this.geometry.pivot),axis=unit([frame[0],frame[1],frame[2]]),center=apronPoint(apronMatrix(frame,this.geometry.pivot,this.angle),this.center);
    const lever=sub(center,hinge),torque=this.mass*gravity*cross(axis,lever)[1];
    const drag=.7*Math.sqrt(this.inertia*this.mass*Math.abs(gravity)*Math.max(.05,this.radius));
    this.angularVelocity=Math.max(-12,Math.min(12,(this.angularVelocity+dt*torque/this.inertia)/(1+dt*drag/this.inertia)));
    this.angle=Math.max(-Math.PI/2,Math.min(Math.PI/2,this.angle+dt*this.angularVelocity));
    const floor=TABLE_TOP+4e-6;
    if(this.minimum(frame,this.angle)<floor){
      // Scalar unilateral position constraint. Search the two feasible hinge
      // directions, then bisect the first contact; no vertex is clipped or bent.
      let best=null;
      for(const direction of [-1,1]){
        let bad=this.angle;
        for(let step=1;step<=128;step++){
          const candidate=Math.max(-Math.PI/2,Math.min(Math.PI/2,this.angle+direction*step*.025));
          if(this.minimum(frame,candidate)>=floor){
            let good=candidate;for(let i=0;i<28;i++){const mid=(bad+good)/2;if(this.minimum(frame,mid)>=floor)good=mid;else bad=mid;}
            if(best===null||Math.abs(good-this.angle)<Math.abs(best-this.angle))best=good;break;
          }
          if(candidate===-Math.PI/2||candidate===Math.PI/2)break;bad=candidate;
        }
      }
      if(best!==null){this.angle=best;this.contact=true;}
    }
    if(this.minimum(frame,this.angle)<=floor+1e-5){
      const epsilon=1e-5,derivative=(this.minimum(frame,this.angle+epsilon)-this.minimum(frame,this.angle-epsilon))/(2*epsilon);
      if(derivative*this.angularVelocity<0)this.angularVelocity=0;
      this.contact=true;
    }
  }
  snapshot(){
    return {variant:this.variant,angle:this.angle,angularVelocity:this.angularVelocity,contact:this.contact,
      canonicalMatrix:this.frame?new Float64Array(apronMatrix(this.frame,this.geometry.pivot,this.angle)):null};
  }
}
