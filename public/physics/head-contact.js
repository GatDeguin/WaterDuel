/** First continuous point entry into the shared, axis-aligned XYZ head proxy.
 * The head may translate between the two observed fixed-step poses. Its radii
 * stay constant over that step. This is an ellipsoid, not the deforming latex
 * mesh. Returned incoming direction is relative to the moving head.
 */
export function segmentEllipsoidContact(previous,now,center,radii,{previousCenter=center,forward=null}={}){
  const from={...previous,z:previous.z??now.z??.17},to={...now,z:now.z??previous.z??.17};
  const c0={...previousCenter,z:previousCenter.z??.025},c1={...center,z:center.z??.025};
  const keys=['x','y','z'];
  if(!keys.every(k=>[from[k],to[k],c0[k],c1[k],radii[k]].every(Number.isFinite)&&radii[k]>0))return null;
  const origin={},delta={},relative={};let a=0,b=0,c=-1;
  for(const k of keys){
    origin[k]=(from[k]-c0[k])/radii[k];
    relative[k]=(to[k]-from[k])-(c1[k]-c0[k]);
    delta[k]=relative[k]/radii[k];
    a+=delta[k]*delta[k];b+=2*origin[k]*delta[k];c+=origin[k]*origin[k];
  }
  if(![a,b,c].every(Number.isFinite))return null;
  const startedInside=c<=1e-12;let t=0;
  if(!startedInside){
    if(a<1e-18)return null;
    const discriminant=b*b-4*a*c,tolerance=1e-12*Math.max(1,b*b,Math.abs(4*a*c));
    if(discriminant < -tolerance)return null;
    // The q form avoids cancellation for a distant, inward-moving point.
    const root=Math.sqrt(Math.max(0,discriminant)),q=-.5*(b+(b<0?-root:root));
    t=q===0?-b/(2*a):Math.min(q/a,c/q);
    if(t < -1e-12||t > 1+1e-12)return null;
    t=Math.max(0,Math.min(1,t));
  }
  const point={},atCenter={};
  for(const k of keys){point[k]=from[k]+(to[k]-from[k])*t;atCenter[k]=c0[k]+(c1[k]-c0[k])*t;}
  const length=Math.hypot(relative.x,relative.y,relative.z);
  const incoming=Object.fromEntries(keys.map(k=>[k,length>1e-12?relative[k]/length:0]));
  const surfacePoint={...point};
  if(startedInside){
    const radial={...origin};let magnitude=Math.hypot(radial.x,radial.y,radial.z);
    if(magnitude<1e-12){
      for(const k of keys)radial[k]=-incoming[k]/radii[k];
      magnitude=Math.hypot(radial.x,radial.y,radial.z);
    }
    // A stationary center overlap still needs a geometric surface location.
    // The blade orientation chooses that side without fabricating velocity.
    if(magnitude<1e-12&&forward&&keys.every(k=>Number.isFinite(forward[k]??0))){
      for(const k of keys)radial[k]=-(forward[k]??0)/radii[k];
      magnitude=Math.hypot(radial.x,radial.y,radial.z);
    }
    if(magnitude<1e-12){radial.x=-1;radial.y=0;radial.z=0;magnitude=1;}
    for(const k of keys)surfacePoint[k]=atCenter[k]+radii[k]*radial[k]/magnitude;
  }
  const normal=Object.fromEntries(keys.map(k=>[k,(surfacePoint[k]-atCenter[k])/(radii[k]*radii[k])]));
  const magnitude=Math.hypot(normal.x,normal.y,normal.z);
  for(const k of keys)normal[k]/=magnitude;
  return {t,point,surfacePoint,normal,incoming,startedInside,center:atCenter};
}
