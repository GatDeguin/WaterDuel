/** The lower balloon mount is a distance along the achieved neck axis,
 * not a world-vertical displacement when the articulated body falls. */
export function physicalNeckMount(pose,balloonSize=1){
  const a=pose.neckPivot??pose.shoulder,h=pose.head;
  const dx=h.x-a.x,dy=h.y-a.y,dz=(h.z??0)-(a.z??0),length=Math.hypot(dx,dy,dz);
  const radius=.40*(Number.isFinite(balloonSize)?Math.max(0,balloonSize):1),distance=Math.min(radius,length*.95);
  if(length<1e-10)return {x:h.x,y:h.y,z:h.z??0};
  return {x:h.x-dx/length*distance,y:h.y-dy/length*distance,z:(h.z??0)-dz/length*distance};
}

/** Cylinder matrices share the achieved neck axis, including depth tilt. */
export function physicalNeckMatrices(pose,balloonSize=1){
  const pivot=pose.neckPivot??pose.shoulder,mount=physicalNeckMount(pose,balloonSize);
  const delta=[mount.x-pivot.x,mount.y-pivot.y,mount.z-(pivot.z??0)],length=Math.hypot(...delta);
  const y=length>1e-10?delta.map(v=>v/length):[0,1,0],reference=Math.abs(y[2])<.9?[0,0,1]:[0,1,0];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const rawX=cross(y,reference),norm=Math.hypot(...rawX),x=rawX.map(v=>v/norm),z=cross(x,y);
  const cylinder=(along,radius,height)=>new Float32Array([
    ...x.map(v=>v*radius),0,...y.map(v=>v*height),0,...z.map(v=>v*radius),0,
    pivot.x+y[0]*along,pivot.y+y[1]*along,(pivot.z??0)+y[2]*along,1]);
  return [cylinder(length/2,.075,length),cylinder(Math.max(0,length-.07),.183,.050),cylinder(Math.max(0,length-.035),.116,.051)];
}
