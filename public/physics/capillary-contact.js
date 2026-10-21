import {BALLOON_RADII,waterDropRadius} from './dimensions.js';
// Surface tension has a finite wetting well. Parcels keep their own volume;
// this reduced contact cannot fabricate sub-parcel films or hold a large drop
// with the force that would support a microscopic one.
const cache=new WeakMap(),bonds=new WeakMap();
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
function closest(point,t){
 const a=t.points[0],b=t.points[1],c=t.points[2],ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z,px=point.x-a.x,py=point.y-a.y,pz=point.z-a.z;
 const uu=ux*ux+uy*uy+uz*uz,uv=ux*vx+uy*vy+uz*vz,vv=vx*vx+vy*vy+vz*vz,pu=px*ux+py*uy+pz*uz,pv=px*vx+py*vy+pz*vz,den=uu*vv-uv*uv;
 let found=false,bestD2,bestX,bestY,bestZ,bestW0,bestW1,bestW2;
 // Preserve the original interior, AB, BC, CA order and strict nearest tie.
 // Only the winning candidate allocates a point and barycentric weights.
 for(let candidate=0;candidate<4;candidate++){
  let w0=0,w1=0,w2=0;
  if(candidate===0){if(!(den>1e-20))continue;const s=(vv*pu-uv*pv)/den,r=(uu*pv-uv*pu)/den;if(!(s>=0&&r>=0&&s+r<=1))continue;w0=1-s-r;w1=s;w2=r;}
  else{const start=candidate===1?a:candidate===2?b:c,end=candidate===1?b:candidate===2?c:a,ex=end.x-start.x,ey=end.y-start.y,ez=end.z-start.z,dx=point.x-start.x,dy=point.y-start.y,dz=point.z-start.z,s=clamp((dx*ex+dy*ey+dz*ez)/((ex*ex+ey*ey+ez*ez)||1),0,1);
   if(candidate===1){w0=1-s;w1=s;}else if(candidate===2){w1=1-s;w2=s;}else{w2=1-s;w0=s;}
  }
  let x=0,y=0,z=0;x+=a.x*w0;y+=a.y*w0;z+=a.z*w0;x+=b.x*w1;y+=b.y*w1;z+=b.z*w1;x+=c.x*w2;y+=c.y*w2;z+=c.z*w2;
  const dx=point.x-x,dy=point.y-y,dz=point.z-z,d2=dx*dx+dy*dy+dz*dz;
  if(!found||d2<bestD2){found=true;bestD2=d2;bestX=x;bestY=y;bestZ=z;bestW0=w0;bestW1=w1;bestW2=w2;}
 }
 return {point:{x:bestX,y:bestY,z:bestZ},weights:[bestW0,bestW1,bestW2],d2:bestD2};
}
export function buildCapillarySurface(membrane){
 if(!membrane?.nodes||!membrane?.faces)return null;
 const prior=cache.get(membrane);if(prior?.version===membrane.version)return prior;
 const triangles=[],edges=new Map(),scale=membrane.scale??1;
 for(const face of membrane.faces){
  if(face.fragment)continue;const ids=[face.a,face.b,face.c],points=ids.map(id=>membrane.nodes[id]);
  if(points.some(p=>!p||!['x','y','z'].every(k=>Number.isFinite(p[k]))))continue;
  const u=sub(points[1],points[0]),v=sub(points[2],points[0]),normal={x:u.y*v.z-u.z*v.y,y:u.z*v.x-u.x*v.z,z:u.x*v.y-u.y*v.x},length=Math.hypot(normal.x,normal.y,normal.z);
  if(length<1e-12)continue;for(const k of ['x','y','z'])normal[k]/=length;
  const center={x:0,y:0,z:0};for(const p of points)for(const k of ['x','y','z'])center[k]+=p[k]/3;
  const t={ids,points,normal,center,zone:points.some(p=>(p.ref?.y??Infinity)<-.65*BALLOON_RADII.y*scale)?'neck':null};
  for(const [i,j]of [[0,1],[1,2],[2,0]]){const key=ids[i]<ids[j]?`${ids[i]}:${ids[j]}`:`${ids[j]}:${ids[i]}`,other=edges.get(key);if(other&&dot(normal,other.normal)<.8&&dot(other.normal,sub(center,other.center))>1e-8){t.zone??='fold';other.zone??='fold';}else if(!other)edges.set(key,t);}
  triangles.push(t);
 }
 const eligible=triangles.filter(t=>t.zone);for(const t of eligible){t.min={};t.max={};for(const k of ['x','y','z']){t.min[k]=Math.min(...t.points.map(p=>p[k]));t.max[k]=Math.max(...t.points.map(p=>p[k]));}}
 const surface={membrane,version:membrane.version,triangleCount:eligible.length,
  closest(point,reach){let hit=null;for(const t of eligible){if(point.x<t.min.x-reach||point.x>t.max.x+reach||point.y<t.min.y-reach||point.y>t.max.y+reach||point.z<t.min.z-reach||point.z>t.max.z+reach)continue;const q=closest(point,t);if(q.d2<=reach*reach&&(!hit||q.d2<hit.d2))hit={...q,...t};}return hit;}};
 cache.set(membrane,surface);return surface;
}
export function applyCapillaryContact(p,surface,dt,{radius=waterDropRadius(p.volume),density=997,surfaceTension=.072,contactCosine=.7}={}){
 const empty={contact:false,work:0,capacity:0};
 if(!surface||!(dt>0&&dt<=.04)||!(radius>0)||!(p.volume>0)||!(density>0)||![radius,density,surfaceTension,contactCosine,p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite))return empty;
 const range=radius*.15,hit=surface.closest(p,radius+range);
 if(!hit){bonds.delete(p);return empty;}
 const distance=Math.sqrt(hit.d2),gap=Math.max(0,distance-radius),normal=distance>1e-12?{x:(p.x-hit.point.x)/distance,y:(p.y-hit.point.y)/distance,z:(p.z-hit.point.z)/distance}:hit.normal;
 const mass=p.volume*density;if(!(mass>0)||!Number.isFinite(1/mass))return empty;
 const weights=hit.weights,nodes=hit.points,skinMass=nodes.map(n=>n.pinned?0:(n.mass??0)+(n.addedMass??0));
 let inverse=1/mass,speed=0;for(let i=0;i<3;i++){const n=nodes[i];speed+=weights[i]*((n.vx??0)*normal.x+(n.vy??0)*normal.y+(n.vz??0)*normal.z);if(skinMass[i]>0)inverse+=weights[i]**2/skinMass[i];}
 const vn=p.vx*normal.x+p.vy*normal.y+p.vz*normal.z-speed;
 const force=Math.max(0,surfaceTension)*2*Math.PI*radius*clamp(contactCosine,0,1),capacity=force*range*.5;
 let bond=bonds.get(p);if(!bond||bond.surface!==surface.membrane){bond={surface:surface.membrane,remaining:capacity};bonds.set(p,bond);}bond.remaining=Math.min(bond.remaining,capacity);
 let impulse=-force*(1-gap/range)*dt-vn*(1-Math.exp(-20*dt))/inverse;
 const quadratic=.5*inverse*impulse*impulse,linear=impulse*vn;
 if(quadratic+linear>bond.remaining&&quadratic>0){const factor=clamp((-linear+Math.sqrt(linear*linear+4*quadratic*bond.remaining))/(2*quadratic),0,1);impulse*=factor;}
 const work=impulse*vn+.5*inverse*impulse*impulse;bond.remaining=clamp(bond.remaining-work,0,capacity);
 for(const k of ['x','y','z']){p['v'+k]+=impulse*normal[k]/mass;for(let i=0;i<3;i++)if(skinMass[i]>0)nodes[i]['v'+k]-=weights[i]*impulse*normal[k]/skinMass[i];}
 return {contact:true,zone:hit.zone,work,capacity,remainingEnergy:bond.remaining,impulse,point:hit.point};
}
