/** Small owned traces of measured contacts, and optical water coating on cloth.
 * Neither consumes parcels nor changes a body mass or a game's hit result. */
import {APRON_GEOMETRY} from './apron-geometry.js';
import {apronPoint} from './apron.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const originKeys={pelvis:'hip',torso:'hip',neck:'shoulder',weapon:'mainHand',mainUpper:'mainShoulder',mainForearm:'mainElbow',offUpper:'offShoulder',offForearm:'offElbow',offWeapon:'offHand',frontThigh:'frontHip',frontShin:'kneeF',backThigh:'backHip',backShin:'kneeB'};
const valid=p=>p&&[p.x,p.y,p.z??0].every(Number.isFinite);
const root=(pose,body)=>{const f=pose.bodyFrames?.[body],key=originKeys[body];return f&&key?{...f.origin,z:pose[key]?.z??0,angle:f.angle}:null;};
function onCurve(pose,s){
  const curve=pose.weaponCurve??[pose.mainHand,pose.tip],index=Math.min(curve.length-2,Math.floor(s*(curve.length-1))),t=s*(curve.length-1)-index,a=curve[index],b=curve[index+1],length=Math.hypot(b.x-a.x,b.y-a.y)||1;
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:(a.z??0)+((b.z??0)-(a.z??0))*t,tx:(b.x-a.x)/length,ty:(b.y-a.y)/length};
}
export class SurfaceState{
  constructor(){this.marks=[];this.contacts=new Map();this.serial=0;}
  record(pose,{body,key,point,normal,impulse,slideSpeed=0,time,dt=1/120}={}){
    const f=root(pose,body);
    if(!f||!valid(point)||!valid(normal)||!Number.isFinite(impulse)||impulse<=1e-5||!Number.isFinite(time)||time<0)return false;
    const id=`${body}:${key}`,previous=this.contacts.get(id)??-Infinity;if(time-previous<.10)return false;
    this.contacts.set(id,time);if(this.contacts.size>48)this.contacts.delete(this.contacts.keys().next().value);
    const c=Math.cos(f.angle),s=Math.sin(f.angle),dx=point.x-f.x,dy=point.y-f.y,n=Math.hypot(normal.x,normal.y)||1;
    const mark={id:++this.serial,body,key,at:time,impulse,local:{x:c*dx+s*dy,y:-s*dx+c*dy,z:(point.z??0)-f.z},normal:{x:(c*normal.x+s*normal.y)/n,y:(-s*normal.x+c*normal.y)/n,z:normal.z??0},
      slideDistance:clamp(Number.isFinite(slideSpeed)?Math.abs(slideSpeed)*Math.max(0,dt):0,0,.08)};
    if(body==='weapon'&&pose.mainHand&&pose.tip){
      const curve=pose.weaponCurve??[pose.mainHand,pose.tip];let nearest=Infinity;
      for(let i=0;i<curve.length-1;i++){
        const a=curve[i],b=curve[i+1],x=b.x-a.x,y=b.y-a.y,den=x*x+y*y,t=clamp(((point.x-a.x)*x+(point.y-a.y)*y)/Math.max(1e-12,den),0,1),px=a.x+x*t,py=a.y+y*t,d=(point.x-px)**2+(point.y-py)**2;
        if(d<nearest){nearest=d;mark.arcFraction=(i+t)/(curve.length-1);const length=Math.sqrt(den)||1;mark.across=(-(point.x-px)*y+(point.y-py)*x)/length;mark.curveNormal={x:(normal.x*x+normal.y*y)/(length*n),y:(-normal.x*y+normal.y*x)/(length*n)};}
      }
    }
    this.marks.push(mark);if(this.marks.length>24)this.marks.shift();return true;
  }
  snapshot(pose,time,rig){
    const marks=[];
    for(const mark of this.marks){
      if(rig?.isBodyAttached?.(mark.body)===false)continue;
      const f=root(pose,mark.body);if(!f)continue;
      let c=Math.cos(f.angle),s=Math.sin(f.angle),position={x:f.x+c*mark.local.x-s*mark.local.y,y:f.y+s*mark.local.x+c*mark.local.y,z:f.z+mark.local.z};
      let normal={x:c*mark.normal.x-s*mark.normal.y,y:s*mark.normal.x+c*mark.normal.y,z:mark.normal.z};
      if(mark.arcFraction!==undefined){const p=onCurve(pose,mark.arcFraction);position={x:p.x-p.ty*mark.across,y:p.y+p.tx*mark.across,z:p.z+mark.local.z};normal={x:p.tx*mark.curveNormal.x-p.ty*mark.curveNormal.y,y:p.ty*mark.curveNormal.x+p.tx*mark.curveNormal.y,z:mark.normal.z};}
      marks.push({id:mark.id,body:mark.body,key:mark.key,position,normal,tangent:{x:-normal.y,y:normal.x,z:0},length:.006+mark.slideDistance,slideDistance:mark.slideDistance,impulse:mark.impulse,age:Math.max(0,time-mark.at),
        anchor:{local:{...mark.local},normal:{...mark.normal},...(mark.arcFraction!==undefined?{arcFraction:mark.arcFraction,across:mark.across}: {})}});
    }
    return {marks};
  }
}
function inverse(m){
  const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10],det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  if(!Number.isFinite(det)||Math.abs(det)<1e-12)return null;
  const n=[(e*i-f*h)/det,(f*g-d*i)/det,(d*h-e*g)/det,(c*h-b*i)/det,(a*i-c*g)/det,(b*g-a*h)/det,(b*f-c*e)/det,(c*d-a*f)/det,(a*e-b*d)/det];return {n,origin:[m[12],m[13],m[14]]};
}
const boxTriangles=[[0,2,6],[0,6,4],[1,5,7],[1,7,3],[0,4,5],[0,5,1],[2,3,7],[2,7,6],[0,1,3],[0,3,2],[4,6,7],[4,7,5]];
function edgeDistance(p,a,b){
  const x=b[0]-a[0],y=b[1]-a[1],z=b[2]-a[2],t=clamp(((p[0]-a[0])*x+(p[1]-a[1])*y+(p[2]-a[2])*z)/(x*x+y*y+z*z),0,1);
  return (p[0]-a[0]-t*x)**2+(p[1]-a[1]-t*y)**2+(p[2]-a[2]-t*z)**2;
}
function triangleDistance(p,a,b,c){
  const x=b[0]-a[0],y=b[1]-a[1],z=b[2]-a[2],u=c[0]-a[0],v=c[1]-a[1],w=c[2]-a[2],px=p[0]-a[0],py=p[1]-a[1],pz=p[2]-a[2];
  const aa=x*x+y*y+z*z,ab=x*u+y*v+z*w,bb=u*u+v*v+w*w,pa=px*x+py*y+pz*z,pb=px*u+py*v+pz*w,den=aa*bb-ab*ab;
  const s=(bb*pa-ab*pb)/den,t=(aa*pb-ab*pa)/den;
  if(s>=0&&t>=0&&s+t<=1){const nx=y*w-z*v,ny=z*u-x*w,nz=x*v-y*u,d=px*nx+py*ny+pz*nz;return d*d/(nx*nx+ny*ny+nz*nz);}
  return Math.min(edgeDistance(p,a,b),edgeDistance(p,b,c),edgeDistance(p,c,a));
}
export function wetApronFromParcels(apron,pose,sources,dt){
  const m=pose?.canonicalMatrix,g=APRON_GEOMETRY[pose?.variant];if(!m||!g||!apron?.wetness||!Number.isFinite(dt)||dt<=0||dt>.04)return 0;
  const inv=inverse(m);if(!inv)return 0;
  const world=g.corners.map(p=>apronPoint(m,p)),min=[0,1,2].map(k=>Math.min(...world.map(p=>p[k]))),max=[0,1,2].map(k=>Math.max(...world.map(p=>p[k])));
  let touches=0;
  for(const source of sources){
    if(!source.released)continue;
    for(const p of source.particles){
      if(source.leaking&&!p.free||!valid(p)||!Number.isFinite(p.volume)||p.volume<=0)continue;
      const radius=clamp(Number.isFinite(p.r)?p.r:.026,.001,.06),values=[p.x,p.y,p.z??0];
      if(values.some((v,k)=>v+radius<min[k]||v-radius>max[k]))continue;
      const d=values.map((v,k)=>v-inv.origin[k]),local=[0,1,2].map(k=>inv.n[k]*d[0]+inv.n[k+3]*d[1]+inv.n[k+6]*d[2]);
      // Canonical torso correction can be affine rather than orthogonal. An
      // inverse-axis radius estimate would falsely wet oblique box corners.
      const inside=local.every((v,k)=>v>=g.bounds.min[k]&&v<=g.bounds.max[k]);
      let distance=0;if(!inside){distance=Infinity;for(const [a,b,c]of boxTriangles)distance=Math.min(distance,triangleDistance(values,world[a],world[b],world[c]));}
      if(distance>radius*radius)continue;
      const height=clamp((local[1]-g.bounds.min[1])/(g.bounds.max[1]-g.bounds.min[1]),0,1),region=height>=.5?'top':'bottom',amount=dt*Math.min(4,p.volume/.0001);
      apron.wetness[region]=clamp(apron.wetness[region]+amount,0,1);touches++;
    }
  }
  return touches;
}
