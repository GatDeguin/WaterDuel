import {emblemSegments} from '../identity.js';
const cache=new WeakMap();
const transform=(m,p)=>m?[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]):p;
/** Frontmost triangle hit, so pigment follows the actual skin/fabric surface. */
export function surfaceEmblem(fighter,{positions,indices=null,center,scale,matrix=null,owner=fighter},channel='balloon'){
 let channels=cache.get(owner);if(!channels){channels={};cache.set(owner,channels);}
 const mesh=channels[channel]??={p:[],n:[],anchors:[],key:null};mesh.p.length=mesh.n.length=0;
 const key=`${fighter.balloonColor}:${positions.length}:${indices?.length??0}`;
 const hit=(x,y)=>{
  let best=null;const count=indices?.length??positions.length/3;
  for(let t=0;t<count;t+=3){
   const a=(indices?indices[t]:t)*3,b=(indices?indices[t+1]:t+1)*3,c=(indices?indices[t+2]:t+2)*3;
   const ax=positions[a],ay=positions[a+1],bx=positions[b],by=positions[b+1],cx=positions[c],cy=positions[c+1];
   const det=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(det)<1e-12)continue;
   const u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/det,v=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/det,w=1-u-v;
   if(u<0||v<0||w<0)continue;const z=u*positions[a+2]+v*positions[b+2]+w*positions[c+2];
   if(!best||z>best.z)best={a,b,c,u,v,w,z};
  }return best;
 };
 if(mesh.key!==key){mesh.key=key;mesh.anchors.length=0;
 for(const line of emblemSegments(fighter)){
  const dx=line.to[0]-line.from[0],dy=line.to[1]-line.from[1],len=Math.hypot(dx,dy)||1,width=.0016;
  const corners=[];
  // Several short strips conform to curvature; no flat badge floats above it.
  for(let step=0;step<4;step++){
   corners.length=0;
   for(const [t,side] of [[step/4,-1],[(step+1)/4,-1],[(step+1)/4,1],[step/4,1]]){
    const x=center[0]+(line.from[0]+dx*t)*scale[0]-dy/len*width*side,y=center[1]+(line.from[1]+dy*t)*scale[1]+dx/len*width*side;
    corners.push(hit(x,y));
   }
   if(corners.some(p=>!p))continue;
   for(const tri of [[0,1,2],[0,2,3]])for(const i of tri)mesh.anchors.push(corners[i]);
  }
 }}
 // Barycentric material anchors are bound once per topology/color. Subsequent
 // frames only sample the same physical triangles: pigment does not slide.
 for(let i=0;i<mesh.anchors.length;i+=3){
  const points=[];
  for(let k=0;k<3;k++){const h=mesh.anchors[i+k];points.push(transform(matrix,[0,1,2].map(a=>positions[h.a+a]*h.u+positions[h.b+a]*h.v+positions[h.c+a]*h.w)));}
  const [a,b,c]=points,ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2],n=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx],len=Math.hypot(...n)||1;
  for(const p of points)for(let axis=0;axis<3;axis++){mesh.p.push(p[axis]+.0008*n[axis]/len);mesh.n.push(n[axis]/len);}
 }return mesh;
}
