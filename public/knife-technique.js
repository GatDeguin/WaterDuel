/** Pure knife geometry and planar defensive contact; callers own rigs and rules. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const point3=p=>p&&[p.x,p.y,p.z??.17].every(Number.isFinite);
const vector=(x,y,z)=>({x,y,z});
const zero=(reason,closingSpeed=0,slideSpeed=0)=>({normalImpulse:0,tangentImpulse:0,
  impulseA:{x:0,y:0},impulseB:{x:0,y:0},closingSpeed,slideSpeed,state:'free',dissipatedWork:0,reason});

export const normalizeKnifeGrip=value=>value==='reverse'?'reverse':'normal';

/** Reverse is an icepick guard: down and outward, clear of the supporting arms.
 * Length is the historic XY reach; actual endpoint depth remains explicit. */
export function knifeTip(hand,{dir=1,length=.42,grip='normal',tipZ=.17}={}){
  if(!point3(hand)||!Number.isFinite(length)||length<=0||!Number.isFinite(tipZ))return null;
  const sign=normalizeKnifeGrip(grip)==='reverse'?-1:1,direction=dir<0?-1:1;
  return {x:hand.x+direction*length*.45,y:hand.y+length*Math.sqrt(1-.45**2)*sign,z:tipZ};
}

/** Blade and palm must not rotate together when changing the relative grip. */
export function knifeHandDirection(hand,tip,grip='normal'){
  if(!point3(hand)||!point3(tip))return null;
  return normalizeKnifeGrip(grip)==='reverse'?
    vector(2*hand.x-tip.x,2*hand.y-tip.y,2*(hand.z??.17)-(tip.z??.17)):
    vector(tip.x,tip.y,tip.z??.17);
}

export function knifeFrame(hand,tip){
  if(!point3(hand)||!point3(tip))return null;
  const dx=tip.x-hand.x,dy=tip.y-hand.y,dz=(tip.z??.17)-(hand.z??.17),length=Math.hypot(dx,dy,dz),xy=Math.hypot(dx,dy);
  if(length<1e-6)return null;
  const u=vector(dx/length,dy/length,dz/length),v=xy>1e-8?vector(-dy/xy,dx/xy,0):vector(1,0,0);
  const w=vector(u.y*v.z-u.z*v.y,u.z*v.x-u.x*v.z,u.x*v.y-u.y*v.x);
  return {u,v,w,center:vector((hand.x+tip.x)/2,(hand.y+tip.y)/2,((hand.z??.17)+(tip.z??.17))/2),length};
}

export function knifeWorldNormal(hand,tip,normal){
  const frame=knifeFrame(hand,tip);
  if(!frame||!normal||![normal.x,normal.y,normal.z??0].every(Number.isFinite))return null;
  const {u,v,w}=frame;
  return vector(...['x','y','z'].map(axis=>u[axis]*normal.x+v[axis]*normal.y+w[axis]*(normal.z??0)));
}

/**
 * One equal/opposite XY impulse pair from actual point velocities and constrained
 * inverse-mass tensors. Normal points A→B; apply returned impulses once, instead
 * of also calling a normal-only solver. Friction cannot create a free sideways kick.
 */
export function solveDefensiveImpulse({velocityA,velocityB,normal,inertiaA,inertiaB,
  maxImpulse=.45,restitution=.1,staticFriction=.22,dynamicFriction=.14}={}){
  if(!velocityA||!velocityB||![velocityA.x,velocityA.y,velocityB.x,velocityB.y].every(Number.isFinite))return zero('invalid-velocity');
  if(!normal||![normal.x,normal.y].every(Number.isFinite))return zero('invalid-normal');
  const size=Math.hypot(normal.x,normal.y);if(size<1e-8)return zero('invalid-normal');
  const n={x:normal.x/size,y:normal.y/size},t={x:-n.y,y:n.x},vx=velocityA.x-velocityB.x,vy=velocityA.y-velocityB.y;
  const vn=vx*n.x+vy*n.y,vt=vx*t.x+vy*t.y;
  if(vn<=0)return zero('separating',vn,Math.abs(vt));
  if(!inertiaA||!inertiaB||![inertiaA.normal,inertiaB.normal].every(v=>Number.isFinite(v)&&v>=0))return zero('invalid-inertia',vn,Math.abs(vt));
  const complete=[inertiaA,inertiaB].every(m=>Number.isFinite(m.tangent)&&Number.isFinite(m.cross));
  if(complete&&[inertiaA,inertiaB].some(m=>m.tangent<0||m.normal*m.tangent-m.cross*m.cross< -1e-10))return zero('invalid-inertia',vn,Math.abs(vt));
  const kn=inertiaA.normal+inertiaB.normal,kt=complete?inertiaA.tangent+inertiaB.tangent:0,kc=complete?inertiaA.cross+inertiaB.cross:0;
  if(kn<1e-9)return zero('immovable',vn,Math.abs(vt));
  const cap=clamp(finite(maxImpulse),0,.75),e=clamp(finite(restitution),0,.5),muS=clamp(finite(staticFriction),0,1),muD=Math.min(muS,clamp(finite(dynamicFriction),0,1));
  const target=(1+e)*vn;let jn=clamp(target/kn,0,cap),jt=0,state='free';
  if(jn>0&&kt>1e-9&&muS>0){
    const determinant=kn*kt-kc*kc;
    const stickN=determinant>1e-12?(target*kt-vt*kc)/determinant:-1;
    const stickT=determinant>1e-12?(vt*kn-target*kc)/determinant:Infinity;
    if(stickN>0&&stickN<=cap&&Math.abs(stickT)<=muS*stickN){jn=stickN;jt=stickT;state='sticking';}
    else{
      const mu=muD+(muS-muD)*Math.exp(-((vt/.18)**2)),sign=Math.sign(vt-kc*jn),denominator=kn+kc*sign*mu;
      if(denominator>1e-9)jn=clamp(target/denominator,0,cap);
      const stop=(vt-kc*jn)/kt;jt=clamp(stop,-mu*jn,mu*jn);state=Math.abs(stop)<=mu*jn?'sticking':'sliding';
    }
  }
  // Use the same coupled mass metric to cap work, including when the force cap
  // prevents sticking. No pose change, future-hit flag or independent attack.
  let work=vn*jn+vt*jt,quadratic=kn*jn*jn+2*kc*jn*jt+kt*jt*jt;
  if(work<=0)return zero('no-work',vn,Math.abs(vt));
  if(quadratic>2*work){const scale=2*work/quadratic;jn*=scale;jt*=scale;}
  work=vn*jn+vt*jt;quadratic=kn*jn*jn+2*kc*jn*jt+kt*jt*jt;
  const x=n.x*jn+t.x*jt,y=n.y*jn+t.y*jt;
  return {normalImpulse:jn,tangentImpulse:jt,impulseA:{x:-x,y:-y},impulseB:{x,y},
    closingSpeed:vn,slideSpeed:Math.abs(vt),state,dissipatedWork:Math.max(0,work-.5*quadratic),capped:jn>=cap,reason:'contact'};
}
