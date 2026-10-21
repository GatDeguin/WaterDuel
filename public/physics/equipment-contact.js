/** Geometry and observed material-point motion; never resolves a game result. */
export function observedPointVelocity(from,to,dt){
  return {vx:(to.x-from.x)/dt,vy:(to.y-from.y)/dt,vz:((to.z??0)-(from.z??0))/dt};
}
export function relativePointSpeed(velocity,bodyVelocity={}){
  return Math.hypot(velocity.vx-(bodyVelocity.vx??0),velocity.vy-(bodyVelocity.vy??0),velocity.vz-(bodyVelocity.vz??0));
}

/** First segment entry into a convex normalized profile, transformed to XY. */
export function segmentConvexPolygonContact(previous,now,profile,center,rx,ry){
  if(![previous.x,previous.y,now.x,now.y,center.x,center.y,rx,ry].every(Number.isFinite)||rx<=0||ry<=0||
    !Array.isArray(profile)||profile.length<3||profile.some(p=>!Array.isArray(p)||p.length<2||!p.slice(0,2).every(Number.isFinite)))return null;
  let area=0;
  for(let i=0;i<profile.length;i++){const a=profile[i],b=profile[(i+1)%profile.length];area+=a[0]*b[1]-a[1]*b[0];}
  if(Math.abs(area)<1e-14)return null;
  const sign=Math.sign(area),ax=(previous.x-center.x)/rx,ay=(previous.y-center.y)/ry;
  const dx=(now.x-previous.x)/rx,dy=(now.y-previous.y)/ry;
  let enter=0,exit=1,normal=null,startedInside=true,closest=Infinity,insideNormal=null;
  for(let i=0;i<profile.length;i++){
    const a=profile[i],b=profile[(i+1)%profile.length],ex=b[0]-a[0],ey=b[1]-a[1];
    const nx=sign*ey,ny=-sign*ex,distance=nx*(ax-a[0])+ny*(ay-a[1]),slope=nx*dx+ny*dy;
    const worldNormal={x:nx/rx,y:ny/ry},length=Math.hypot(worldNormal.x,worldNormal.y);if(length<1e-14)continue;
    worldNormal.x/=length;worldNormal.y/=length;
    if(-distance/length<closest){closest=-distance/length;insideNormal=worldNormal;}
    if(distance>1e-12)startedInside=false;
    if(Math.abs(slope)<1e-14){if(distance>1e-12)return null;continue;}
    const t=-distance/slope;
    if(slope<0){if(t>enter){enter=t;normal=worldNormal;}}
    else exit=Math.min(exit,t);
    if(enter>exit+1e-12)return null;
  }
  if(exit< -1e-12||enter>1+1e-12)return null;
  const t=startedInside?0:Math.max(0,Math.min(1,enter));
  const z0=previous.z??now.z??0,z1=now.z??previous.z??0;
  const point={x:previous.x+(now.x-previous.x)*t,y:previous.y+(now.y-previous.y)*t,z:z0+(z1-z0)*t};
  const vx=now.x-previous.x,vy=now.y-previous.y,vz=z1-z0,length=Math.hypot(vx,vy,vz);
  return {t,point,surfacePoint:{...point},normal:normal??insideNormal,incoming:length>1e-12?{x:vx/length,y:vy/length,z:vz/length}:{x:0,y:0,z:0},startedInside};
}
