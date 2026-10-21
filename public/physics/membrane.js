/** Reduced real-time latex membrane. XPBD (Macklin et al. 2016), Eq. 18.
 * Not a calibrated hyperelastic constitutive/fracture or bidirectional CFD model.
 */
import {BALLOON_RADII,TABLE_TOP,WATER_RADII,WATER_FILL_FRACTION} from './dimensions.js';
import {latexThickness} from '../rendering/optics.js';
import {fractureCandidates,propagateEnergyFracture} from './membrane-fracture.js';
const H=1/120,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const REFERENCE_WATER_VOLUME=4*Math.PI/3*WATER_RADII.x*WATER_RADII.y*WATER_RADII.z*WATER_FILL_FRACTION;
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const normalize=v=>{const d=Math.hypot(v.x,v.y,v.z)||1;return {x:v.x/d,y:v.y/d,z:v.z/d};};
const triangleArea=(a,b,c)=>{const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;return Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2;};
const templates=new Map();
function geodesic(level){
 if(templates.has(level))return templates.get(level);
 const t=(1+Math.sqrt(5))/2;
 let vertices=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(([x,y,z])=>normalize({x,y,z}));
 let faces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
 for(let pass=0;pass<level;pass++){
  const midpoints=new Map(),next=[];
  const midpoint=(a,b)=>{const key=a<b?`${a}:${b}`:`${b}:${a}`;if(midpoints.has(key))return midpoints.get(key);const p=vertices[a],q=vertices[b],i=vertices.length;vertices.push(normalize({x:p.x+q.x,y:p.y+q.y,z:p.z+q.z}));midpoints.set(key,i);return i;};
  for(const [a,b,c]of faces){const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);next.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]);}faces=next;
 }
 for(const f of faces){const [a,b,c]=f.map(i=>vertices[i]);if(dot(cross(sub(b,a),sub(c,a)),a)<0)[f[1],f[2]]=[f[2],f[1]];}
 const result={vertices,faces};templates.set(level,result);return result;
}
function meshVolume(nodes,faces,origin){let v=0;for(const f of faces){const a=nodes[f.a],b=nodes[f.b],c=nodes[f.c],ax=a.x-origin.x,ay=a.y-origin.y,az=a.z-origin.z,bx=b.x-origin.x,by=b.y-origin.y,bz=b.z-origin.z,cx=c.x-origin.x,cy=c.y-origin.y,cz=c.z-origin.z;v+=(ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx))/6;}return v;}
function pointTriangleDistanceSquared(point,a,b,c){
 const u=sub(b,a),v=sub(c,a),p=sub(point,a),uu=dot(u,u),uv=dot(u,v),vv=dot(v,v),pu=dot(p,u),pv=dot(p,v),den=uu*vv-uv*uv;
 if(den>1e-18){const s=(vv*pu-uv*pv)/den,t=(uu*pv-uv*pu)/den;if(s>=0&&t>=0&&s+t<=1){const dx=p.x-s*u.x-t*v.x,dy=p.y-s*u.y-t*v.y,dz=p.z-s*u.z-t*v.z;return dx*dx+dy*dy+dz*dz;}}
 let nearest=Infinity;for(const [start,end]of [[a,b],[b,c],[c,a]]){const edge=sub(end,start),toPoint=sub(point,start),t=clamp(dot(toPoint,edge)/(dot(edge,edge)||1),0,1),dx=toPoint.x-edge.x*t,dy=toPoint.y-edge.y*t,dz=toPoint.z-edge.z*t;nearest=Math.min(nearest,dx*dx+dy*dy+dz*dz);}return nearest;
}
export class BalloonMembrane{
 get ruptured(){return this.punctured;}
 get apertureArea(){let area=0;for(const f of this.faces)if(f.cutOriginal)area+=triangleArea(...f.cutOriginal.map(i=>this.nodes[i]));return area;}
 get mainSkinArea(){let area=0;for(const f of this.faces)if(!f.fragment)area+=triangleArea(this.nodes[f.a],this.nodes[f.b],this.nodes[f.c]);return area;}
 get state(){const mainSkinArea=this.mainSkinArea;
  // Even a perfectly closed surface of this area cannot hold more volume.
  // This necessary upper bound does not establish closure or water/cloth contact.
  return {ruptured:this.punctured,apertureArea:this.apertureArea,mainSkinArea,containmentCapacity:mainSkinArea**1.5/(6*Math.sqrt(Math.PI)),pressure:this.punctured?0:Math.max(0,this.volumeLambda/(H*H)),pressureAtPuncture:this.pressureAtPuncture??0,retainedWaterAddedMass:this.addedMass??0,localImpact:this.localImpact?{...this.localImpact}:null};}
  constructor({scale=1,subdivisions=2,mass=.04,prestretch=.55,edgeCompliance=.02,areaCompliance=.008,volumeCompliance=2e-6,iterations=6,tearStrain=1.65,damping=2.8,fractureModel='legacy',fractureToughness=.003}={}){
  this.scale=scale;this.subdivisions=subdivisions===3?3:2;this.iterations=iterations;
  this.prestretch=prestretch;this.edgeCompliance=edgeCompliance;this.areaCompliance=areaCompliance;this.volumeCompliance=volumeCompliance;this.tearStrain=tearStrain;this.damping=damping;
  if(fractureModel==='energy')this.fractureEnergy={toughness:Number.isFinite(fractureToughness)&&fractureToughness>0?fractureToughness:.003,dissipatedEnergy:0,lastDrivingRatio:0};
  this.totalMass=mass*scale**2;this.support={x:0,y:0,z:0};this.targetSupport={...this.support};this.attached=false;this.accumulator=0;this.steps=0;this.version=0;this.punctured=false;this.fractureEvents=0;this.brokenEdges=0;this.fractureOrigins=[];this.volumeLambda=0;
  const template=geodesic(this.subdivisions);
  this.nodes=template.vertices.map(p=>{const ref={x:p.x*BALLOON_RADII.x*scale,y:p.y*BALLOON_RADII.y*scale,z:p.z*BALLOON_RADII.z*scale};return {...ref,ref,pinned:p.y<-.88,vx:0,vy:0,vz:0,mass:0,w:0,addedMass:0};});
  this.faces=template.faces.map(([a,b,c])=>({a,b,c,referenceArea:triangleArea(this.nodes[a],this.nodes[b],this.nodes[c]),lambda:0,fragment:false}));
  const totalArea=this.faces.reduce((s,f)=>s+f.referenceArea,0);
  for(const f of this.faces){f.restArea=f.referenceArea*prestretch**2;f.mass=this.totalMass*f.referenceArea/totalArea;}
  this.referenceVolume=meshVolume(this.nodes,this.faces,this.support);this.targetVolume=this.referenceVolume;this.rebuild();
 }
 attach(head){
  const target={x:head.x,y:head.y,z:head.z??.025},delta=sub(target,this.support);
  for(const p of this.nodes){p.x+=delta.x;p.y+=delta.y;p.z+=delta.z;}
  this.support=target;this.targetSupport={...target};this.attached=true;this.version++;return this;
 }
 rebuild(){
  const edges=new Map();for(const p of this.nodes)p.mass=0;
  for(let i=0;i<this.faces.length;i++){
   const f=this.faces[i];for(const id of [f.a,f.b,f.c])this.nodes[id].mass+=f.mass/3;
   for(const [a,b]of [[f.a,f.b],[f.b,f.c],[f.c,f.a]]){const key=a<b?`${a}:${b}`:`${b}:${a}`;let e=edges.get(key);if(!e){const pa=this.nodes[a].ref,pb=this.nodes[b].ref;e={a,b,rest:Math.hypot(pa.x-pb.x,pa.y-pb.y,pa.z-pb.z)*this.prestretch,lambda:0,faces:[]};edges.set(key,e);}e.faces.push(i);}
  }
  this.edges=[...edges.values()];this.boundaryNodes=new Set();
  for(const e of this.edges)if(e.faces.length===1&&!this.faces[e.faces[0]].fragment){this.boundaryNodes.add(e.a);this.boundaryNodes.add(e.b);}
  this.volumeGrad=new Float64Array(this.nodes.length*3);this.version++;
 }
 contact({point,incoming={x:1,y:0,z:0},strength=.25}){
  if(!this.attached||this.punctured)return false;
  const direction=normalize(incoming),radius=.19*this.scale,limit=clamp(strength,0,1)*1.7;
  let touched=false;
  for(const p of this.nodes){const d=Math.hypot(p.x-point.x,p.y-point.y,p.z-(point.z??this.support.z));if(d>=radius||p.pinned)continue;const weight=(1-d/radius)**2;p.vx+=direction.x*limit*weight;p.vy+=direction.y*limit*weight;p.vz+=direction.z*limit*weight;touched=true;}
  return touched;
 }
 puncture({point,incoming={x:1,y:0,z:0},impulse=1}){
  if(this.punctured)return false;if(!this.attached)this.attach({x:0,y:0,z:0});
  if(this.fractureEnergy)impulse=clamp(Number.isFinite(impulse)?impulse:0,0,1);
  const impact={x:point.x,y:point.y,z:point.z??this.support.z};this.localImpact=sub(impact,this.support);this.releaseOrigin={...this.support};
  this.contact({point:impact,incoming,strength:clamp(impulse,0,1)});
  let nearest=-1,distance=Infinity;
  // Face proximity is evaluated in physical coordinates at the observed contact.
  // No angular sectors or time-driven tear front is involved.
  for(let i=0;i<this.faces.length;i++){const f=this.faces[i],d=pointTriangleDistanceSquared(impact,this.nodes[f.a],this.nodes[f.b],this.nodes[f.c]);if(d<distance){distance=d;nearest=i;}}
  this.pressureAtPuncture=Math.max(0,this.volumeLambda/(H*H));this.punctured=true;this.volumeLambda=0;this.detachFace(nearest);
  const direction=normalize(incoming),f=this.faces[nearest];for(const id of [f.a,f.b,f.c]){const p=this.nodes[id];p.vx+=direction.x*.7*impulse;p.vy+=direction.y*.7*impulse;p.vz+=direction.z*.7*impulse;}
  return true;
 }
 detachFace(index){
  const f=this.faces[index];if(!f||f.fragment)return false;
  f.cutOriginal=[f.a,f.b,f.c];
  const center={x:0,y:0,z:0};for(const key of ['a','b','c']){const old=this.nodes[f[key]];center.x+=old.ref.x/3;center.y+=old.ref.y/3;center.z+=old.ref.z/3;const id=this.nodes.length;this.nodes.push({...old,ref:{...old.ref},pinned:false,mass:0,w:0});f[key]=id;}
  f.fragment=true;f.lambda=0;this.brokenEdges+=3;this.fractureEvents++;this.fractureOrigins.push(center);this.rebuild();return true;
 }
 advance(dt,{head=this.targetSupport,waterVolume=0,waterFrame=null,slosh=0,floor=TABLE_TOP,bounds=3.7,depth=1.31}={}){
  if(!Number.isFinite(dt)||dt<=0)return 0;if(!this.attached)this.attach(head);
  const previous=this.targetSupport,target={x:head.x,y:head.y,z:head.z??.025},initialAccumulator=this.accumulator;
  this.accumulator+=dt;let count=0;
  while(this.accumulator>=H-1e-12){
   const t=clamp(((count+1)*H-initialAccumulator)/dt,0,1);
   this.support={x:previous.x+(target.x-previous.x)*t,y:previous.y+(target.y-previous.y)*t,z:previous.z+(target.z-previous.z)*t};
   this.step({waterVolume,waterFrame,slosh,floor,bounds,depth});this.accumulator-=H;count++;
  }
  this.targetSupport=target;return count;
 }
 step({waterVolume,waterFrame,slosh,floor,bounds,depth}){
  this.contactFloor=floor;this.contactBounds=bounds;this.contactDepth=depth;
  const nodes=this.nodes,old=this.previousPositionsScratch?.length===nodes.length*3?this.previousPositionsScratch:new Float64Array(nodes.length*3),drag=Math.exp(-this.damping*H);
  // Reduced entrained-water inertia, not an assertion that the water solver
  // exchanges pressure/momentum bidirectionally with these surface nodes.
  const addedMass=Math.max(0,waterVolume)*.3;
  this.addedMass=addedMass;let loadWeight=0;
  for(const p of nodes){const qx=(p.x-this.support.x)/(WATER_RADII.x*this.scale),qy=(p.y-this.support.y)/(WATER_RADII.y*this.scale),qz=(p.z-this.support.z)/(WATER_RADII.z*this.scale),r=waterFrame?.rotation;
   const planeDistance=r?qx*r[1]+qy*r[4]+qz*r[7]:qy,submerged=planeDistance<=(waterFrame?.height??.2)?1.4:.4;p.loadWeight=p.mass*submerged;loadWeight+=p.loadWeight;}
  for(let i=0;i<nodes.length;i++){
   const p=nodes[i];old[i*3]=p.x;old[i*3+1]=p.y;old[i*3+2]=p.z;
   p.addedMass=loadWeight?addedMass*p.loadWeight/loadWeight:0;p.w=p.pinned||p.mass===0?0:1/(p.mass+p.addedMass);
   if(!p.w)continue;
   p.vx=(p.vx+clamp(slosh*14,-6,6)*(addedMass/(this.totalMass+addedMass||1))*H)*drag;p.vy=(p.vy-9.81*H)*drag;p.vz*=drag;
   p.x+=p.vx*H;p.y+=p.vy*H;p.z+=p.vz*H;
  }
  const tensileFailures=this.fractureEnergy?fractureCandidates(this):null;
  if(this.punctured&&!this.fractureEnergy){
   const failures=[];for(const e of this.edges){if(e.faces.length!==2||(!this.boundaryNodes.has(e.a)&&!this.boundaryNodes.has(e.b)))continue;const a=nodes[e.a],b=nodes[e.b],strain=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)/e.rest;if(strain>this.tearStrain){const face=e.faces.find(i=>!this.faces[i].fragment);if(face!==undefined&&!failures.includes(face))failures.push(face);if(failures.length===2)break;}}
   for(const face of failures)this.detachFace(face);
   if(failures.length)for(const p of nodes)p.w=p.pinned||p.mass===0?0:1/p.mass;
  }
  // Topology can append nodes. Their starting positions/velocity are inherited;
  // extend the previous-position buffer rather than inventing a displacement.
  let previousPositions=old;if(nodes.length*3>old.length){previousPositions=new Float64Array(nodes.length*3);previousPositions.set(old);for(let i=old.length/3;i<nodes.length;i++){const p=nodes[i];previousPositions[i*3]=p.x-p.vx*H;previousPositions[i*3+1]=p.y-p.vy*H;previousPositions[i*3+2]=p.z-p.vz*H;p.w=p.mass>0?1/p.mass:0;}}
  this.previousPositionsScratch=previousPositions;
  for(const e of this.edges)e.lambda=0;for(const f of this.faces)f.lambda=0;this.volumeLambda=0;
  const alphaEdge=this.edgeCompliance/(H*H),alphaArea=this.areaCompliance/(H*H),alphaVolume=this.volumeCompliance/(H*H);
  this.targetVolume=this.referenceVolume*(1+.025*clamp(waterVolume/(REFERENCE_WATER_VOLUME*this.scale**3)-1,-1,1));
  for(let iteration=0;iteration<this.iterations;iteration++){
   for(const e of this.edges){const a=nodes[e.a],b=nodes[e.b],dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z,d=Math.hypot(dx,dy,dz);if(d<1e-10)continue;const compliance=this.fractureEnergy?alphaEdge/(e.faces.length*.5):alphaEdge;const dl=(-(d-e.rest)-compliance*e.lambda)/(a.w+b.w+compliance);e.lambda+=dl;const factor=dl/d;a.x+=a.w*dx*factor;a.y+=a.w*dy*factor;a.z+=a.w*dz*factor;b.x-=b.w*dx*factor;b.y-=b.w*dy*factor;b.z-=b.w*dz*factor;}
   for(const f of this.faces){
    const a=nodes[f.a],b=nodes[f.b],c=nodes[f.c],ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const magnitude=Math.hypot(nx,ny,nz);if(magnitude<1e-12)continue;nx/=magnitude;ny/=magnitude;nz/=magnitude;
    // Scalar form of the same three cross products and XPBD updates. Keep the
    // arithmetic/update order: removing temporary vectors must not change tears.
    const gax=(b.y-c.y)*nz-(b.z-c.z)*ny,gay=(b.z-c.z)*nx-(b.x-c.x)*nz,gaz=(b.x-c.x)*ny-(b.y-c.y)*nx;
    const gbx=(c.y-a.y)*nz-(c.z-a.z)*ny,gby=(c.z-a.z)*nx-(c.x-a.x)*nz,gbz=(c.x-a.x)*ny-(c.y-a.y)*nx;
    const gcx=(a.y-b.y)*nz-(a.z-b.z)*ny,gcy=(a.z-b.z)*nx-(a.x-b.x)*nz,gcz=(a.x-b.x)*ny-(a.y-b.y)*nx;
    const denominator=(a.w*(gax*gax+gay*gay+gaz*gaz)+b.w*(gbx*gbx+gby*gby+gbz*gbz)+c.w*(gcx*gcx+gcy*gcy+gcz*gcz))*.25+alphaArea,dl=(-(magnitude*.5-f.restArea)-alphaArea*f.lambda)/denominator;f.lambda+=dl;
    a.x+=a.w*gax*.5*dl;a.y+=a.w*gay*.5*dl;a.z+=a.w*gaz*.5*dl;
    b.x+=b.w*gbx*.5*dl;b.y+=b.w*gby*.5*dl;b.z+=b.w*gbz*.5*dl;
    c.x+=c.w*gcx*.5*dl;c.y+=c.w*gcy*.5*dl;c.z+=c.w*gcz*.5*dl;
   }
   if(!this.punctured){
    const g=this.volumeGrad;g.fill(0);let volume=0;
    for(const f of this.faces){
     const a=nodes[f.a],b=nodes[f.b],c=nodes[f.c],ax=a.x-this.support.x,ay=a.y-this.support.y,az=a.z-this.support.z,bx=b.x-this.support.x,by=b.y-this.support.y,bz=b.z-this.support.z,cx=c.x-this.support.x,cy=c.y-this.support.y,cz=c.z-this.support.z;
     const gax=by*cz-bz*cy,gay=bz*cx-bx*cz,gaz=bx*cy-by*cx,gbx=cy*az-cz*ay,gby=cz*ax-cx*az,gbz=cx*ay-cy*ax,gcx=ay*bz-az*by,gcy=az*bx-ax*bz,gcz=ax*by-ay*bx;
     volume+=(ax*gax+ay*gay+az*gaz)/6;
     const ia=f.a*3,ib=f.b*3,ic=f.c*3;
     g[ia]+=gax/6;g[ia+1]+=gay/6;g[ia+2]+=gaz/6;
     g[ib]+=gbx/6;g[ib+1]+=gby/6;g[ib+2]+=gbz/6;
     g[ic]+=gcx/6;g[ic+1]+=gcy/6;g[ic+2]+=gcz/6;
    }
    let denominator=alphaVolume;for(let i=0;i<nodes.length;i++)denominator+=nodes[i].w*(g[i*3]**2+g[i*3+1]**2+g[i*3+2]**2);
    const dl=(-(volume-this.targetVolume)-alphaVolume*this.volumeLambda)/denominator;this.volumeLambda+=dl;for(let i=0;i<nodes.length;i++){const p=nodes[i];p.x+=p.w*g[i*3]*dl;p.y+=p.w*g[i*3+1]*dl;p.z+=p.w*g[i*3+2]*dl;}
   }
   for(const p of nodes){if(p.pinned){p.x=this.support.x+p.ref.x;p.y=this.support.y+p.ref.y;p.z=this.support.z+p.ref.z;}p.x=clamp(p.x,-bounds+.002,bounds-.002);p.y=Math.max(floor+.002,p.y);p.z=clamp(p.z,-depth+.002,depth-.002);}
  }
  for(let i=0;i<nodes.length;i++){const p=nodes[i];p.vx=clamp((p.x-previousPositions[i*3])/H,-12,12);p.vy=clamp((p.y-previousPositions[i*3+1])/H,-12,12);p.vz=clamp((p.z-previousPositions[i*3+2])/H,-12,12);}
  // Charge opening work after XPBD has reconstructed velocities; an earlier
  // damping impulse would otherwise be overwritten by that reconstruction.
  if(this.punctured&&this.fractureEnergy)propagateEnergyFracture(this,tensileFailures);
  this.steps++;this.version++;
 }
 mesh({includeFragments=true,smooth=this.subdivisions===2?1:0}={}){
  const key=`${includeFragments?'all':'skin'}:${smooth?1:0}`;if(this.meshCache?.version===this.version&&this.meshCache[key])return this.meshCache[key];
  if(this.meshCache?.version!==this.version)this.meshCache={version:this.version};
  const normals=new Float64Array(this.nodes.length*3),restAreas=new Float64Array(this.nodes.length),areas=new Float64Array(this.nodes.length),out={p:[],n:[],optics:[]};
  for(const f of this.faces){
   const a=this.nodes[f.a],b=this.nodes[f.b],c=this.nodes[f.c],ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
   const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,area=Math.hypot(nx,ny,nz)/2,ia=f.a*3,ib=f.b*3,ic=f.c*3;
   normals[ia]+=nx;normals[ia+1]+=ny;normals[ia+2]+=nz;restAreas[f.a]+=f.restArea;areas[f.a]+=area;
   normals[ib]+=nx;normals[ib+1]+=ny;normals[ib+2]+=nz;restAreas[f.b]+=f.restArea;areas[f.b]+=area;
   normals[ic]+=nx;normals[ic+1]+=ny;normals[ic+2]+=nz;restAreas[f.c]+=f.restArea;areas[f.c]+=area;
  }
  const vertices=this.nodes.map((p,id)=>{
   let nx=normals[id*3],ny=normals[id*3+1],nz=normals[id*3+2],d=Math.hypot(nx,ny,nz);
   if(d<1e-12){nx=p.ref.x/BALLOON_RADII.x**2;ny=p.ref.y/BALLOON_RADII.y**2;nz=p.ref.z/BALLOON_RADII.z**2;d=Math.hypot(nx,ny,nz);}
   d=d||1;return {p,n:{x:nx/d,y:ny/d,z:nz/d},thickness:latexThickness(restAreas[id],areas[id])};
  });
  const midpointCache=new Map(),midpoint=(a,b)=>{
   // Node count is constant for this mesh call, so this ordered integer pair
   // is collision-free and does not allocate a string on every edge lookup.
   const id=a<b?a*this.nodes.length+b:b*this.nodes.length+a,cached=midpointCache.get(id);if(cached)return cached;
   const va=vertices[a],vb=vertices[b],p={x:(va.p.x+vb.p.x)/2,y:(va.p.y+vb.p.y)/2,z:(va.p.z+vb.p.z)/2};
   // Interpolate the current skin through its tangent planes (bounded Phong
   // projection). This changes render tessellation, never the physical nodes.
   const da=(p.x-va.p.x)*va.n.x+(p.y-va.p.y)*va.n.y+(p.z-va.p.z)*va.n.z,db=(p.x-vb.p.x)*vb.n.x+(p.y-vb.p.y)*vb.n.y+(p.z-vb.p.z)*vb.n.z;
   const cx=-(va.n.x*da+vb.n.x*db)/4,cy=-(va.n.y*da+vb.n.y*db)/4,cz=-(va.n.z*da+vb.n.z*db)/4;
   const length=Math.hypot(va.p.x-vb.p.x,va.p.y-vb.p.y,va.p.z-vb.p.z),factor=Math.min(1,length*.08/(Math.hypot(cx,cy,cz)||1));
   p.x=clamp(p.x+cx*factor,-(this.contactBounds??3.7)+.002,(this.contactBounds??3.7)-.002);p.y=Math.max((this.contactFloor??TABLE_TOP)+.002,p.y+cy*factor);p.z=clamp(p.z+cz*factor,-(this.contactDepth??1.31)+.002,(this.contactDepth??1.31)-.002);
   const result={p,n:normalize({x:va.n.x+vb.n.x,y:va.n.y+vb.n.y,z:va.n.z+vb.n.z}),thickness:(va.thickness+vb.thickness)/2};midpointCache.set(id,result);return result;
  };
  // Area-weighted nodal thickness is continuous inside a connected film. Its
  // linear integral over the physical triangles equals total rest material
  // volume exactly. Split tear nodes do not share their optical thickness.
  const emit=(a,b,c)=>{
   out.p.push(a.p.x,a.p.y,a.p.z,b.p.x,b.p.y,b.p.z,c.p.x,c.p.y,c.p.z);
   out.n.push(a.n.x,a.n.y,a.n.z,b.n.x,b.n.y,b.n.z,c.n.x,c.n.y,c.n.z);
   out.optics.push(a.thickness,b.thickness,c.thickness);
  };
  for(const f of this.faces){
   if(!includeFragments&&f.fragment)continue;
   const a=vertices[f.a],b=vertices[f.b],c=vertices[f.c];
   if(smooth){const ab=midpoint(f.a,f.b),bc=midpoint(f.b,f.c),ca=midpoint(f.c,f.a);emit(a,ab,ca);emit(ab,b,bc);emit(ca,bc,c);emit(ab,bc,ca);}else emit(a,b,c);
  }
  this.meshCache[key]=out;return out;
 }
 stats(){
  let area=0,elasticEnergy=0,kineticEnergy=0,massSum=0;
  for(const e of this.edges){const a=this.nodes[e.a],b=this.nodes[e.b],c=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)-e.rest;elasticEnergy+=c*c/(2*this.edgeCompliance)*(this.fractureEnergy?e.faces.length*.5:1);}
  for(const f of this.faces){const a=triangleArea(this.nodes[f.a],this.nodes[f.b],this.nodes[f.c]);area+=a;elasticEnergy+=(a-f.restArea)**2/(2*this.areaCompliance);}
  for(const p of this.nodes){massSum+=p.mass;kineticEnergy+=p.mass*(p.vx*p.vx+p.vy*p.vy+p.vz*p.vz)/2;}
  const signedSurfaceVolume=meshVolume(this.nodes,this.faces,this.support);
  return {nodes:this.nodes.length,faces:this.faces.length,edges:this.edges.length,boundaryEdges:this.edges.filter(e=>e.faces.length===1).length,mass:this.totalMass,nodeMassSum:massSum,addedWaterMass:this.addedMass??0,area,volume:this.punctured?null:signedSurfaceVolume,signedSurfaceVolume,targetVolume:this.targetVolume,apertureArea:this.apertureArea,elasticEnergy,kineticEnergy,volumeLambda:this.volumeLambda,punctured:this.punctured,brokenEdges:this.brokenEdges,fractureEvents:this.fractureEvents,fractureOrigins:this.fractureOrigins.map(p=>({...p})),localImpact:this.localImpact?{...this.localImpact}:null,steps:this.steps,...(this.fractureEnergy?{fracture:{model:'energy',...this.fractureEnergy}}:{})};
 }
}
