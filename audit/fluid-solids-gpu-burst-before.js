/** Reduced, one-way liquid/rig contact. Shared extruded body proxies keep water
 * from passing through wood/steel; they are not triangle CFD or fluid feedback.
 * A parcel remains whole: contact never creates, deletes or changes its volume.
 */
const dot=(a,b)=>a.x*b.x+a.y*b.y+(a.z??0)*(b.z??0);
const length=v=>Math.hypot(v.x,v.y,v.z??0);
function panelSolid(panel){
  const center={...panel.center,z:panel.z},axes=[...panel.axes.map(v=>({...v,z:0})),{x:0,y:0,z:1}];
  const half=panel.axes.map(axis=>Math.max(...panel.vertices.map(p=>Math.abs((p.x-center.x)*axis.x+(p.y-center.y)*axis.y))));half.push(panel.depth/2);
  return {axes,center,half};
}
// These are the serial joints from ArticulatedRig.#kinematics. Distances below
// come from its actual frames, so boss proportions and shoulder/hip offsets
// participate without a normal-size, whole-body reach constant.
const parentBody={torso:'pelvis',neck:'torso',mainUpper:'torso',mainForearm:'mainUpper',weapon:'mainForearm',
  offUpper:'torso',offForearm:'offUpper',offWeapon:'offForearm',frontThigh:'pelvis',frontShin:'frontThigh',backThigh:'pelvis',backShin:'backThigh'};
const bodyJoint={pelvis:2,torso:3,neck:12,mainUpper:4,mainForearm:5,weapon:13,offUpper:6,offForearm:7,offWeapon:7,frontThigh:8,frontShin:9,backThigh:10,backShin:11};
function panelMotion(r,panel,solid,pose,before,extension){
  const translation={x:r.q[0]-before[0],y:r.q[1]-before[1],z:0},frames=pose.bodyFrames;
  const extending=panel.key==='weapon'?.5:panel.key==='weapon-head'?1:0;
  const centerExtension=extension*extending,halfBound=panel.key==='weapon'?extension/2:0;
  let body=panel.body,frame=frames?.[body];
  if(!frame||bodyJoint[body]===undefined){
    const angleRate=Array.from(r.q).slice(2).reduce((sum,value,i)=>sum+Math.abs(value-before[i+2]),0),reach=4*(r.scale??1)+Math.max(r.swordLength,r.previousSwordLength??0)+2;
    return {centerBound:length(translation)+reach*angleRate+extension,angleRate,halfBound:extension/2,translation,angularBound:reach*angleRate,centerExtension:extension};
  }
  let radius=Math.hypot(solid.center.x-frame.origin.x,solid.center.y-frame.origin.y)+Math.max(0,(r.previousSwordLength??r.swordLength)-r.swordLength)*extending;
  let angularBound=0,angleRate=0;
  while(frame){
    const index=bodyJoint[body],delta=Math.abs(r.q[index]-before[index]);angularBound+=radius*delta;angleRate+=delta;
    const parent=parentBody[body],next=parent&&frames[parent];if(!next)break;
    radius+=Math.hypot(frame.origin.x-next.origin.x,frame.origin.y-next.origin.y);body=parent;frame=next;
  }
  return {centerBound:length(translation)+angularBound+centerExtension,angleRate,halfBound,translation,angularBound,centerExtension};
}
function sweptBounds(a,b,motion){
  const corner=Math.max(Math.hypot(...a.half),Math.hypot(...b.half)),w=motion.angleRate;
  // Every serial-link offset is a sinusoid with angular speed <= w. Its second
  // derivative is bounded by w times the summed angular travel; a linearly
  // extending offset adds the two product-rule terms. The deviation from the
  // endpoint chord is at most max|p''|/8 over this unit interval.
  const curvature=((motion.angularBound??motion.centerBound)+corner*w+2*(motion.centerExtension??0)+2*motion.halfBound)*w/8+1e-9;
  const min={},max={};
  for(const key of ['x','y','z']){
    const extent=s=>s.axes.reduce((sum,axis,i)=>sum+Math.abs(axis[key]??0)*s.half[i],0);
    const A=extent(a),B=extent(b),padding=key==='z'?1e-9:curvature;
    min[key]=Math.min(a.center[key]-A,b.center[key]-B)-padding;
    max[key]=Math.max(a.center[key]+A,b.center[key]+B)+padding;
  }
  return {min,max};
}
export function fluidSolidColliders(fighters){
  return fighters.flatMap(f=>{
    const r=f.rig,current=r.collisionPanels(),cache=new Map([[1,{panels:current,solids:current.map(panelSolid)}]]),before=r.previousQ??r.q;
    const extension=Math.abs(r.swordLength-(r.previousSwordLength??r.swordLength));
    const pose=r.pose();
    const at=(t,index)=>{
      if(!cache.has(t)){
        if(cache.size>=32){for(const key of cache.keys())if(key!==0&&key!==1){cache.delete(key);break;}}
        cache.set(t,{panels:null,solids:[]});
      }
      const sample=cache.get(t);
      if(!sample.solids[index]){
        const panel=sample.panels?.[index]??(r.collisionGeometryAt?r.collisionGeometryAt(t,current[index].key)[0]:(sample.panels??=r.collisionPanelsAt(t))[index]);
        sample.solids[index]=panelSolid(panel);
      }
      return sample.solids[index];
    };
    const previous=r.collisionGeometryAt?.(0)??r.collisionPanelsAt(0);cache.set(0,{panels:previous,solids:[]});
    return current.map((panel,index)=>{
    const solid=panelSolid(panel),center=solid.center;
    // Rigid planar point velocity is affine: evaluate its translation and
    // angular rate once per proxy, rather than rebuilding rig kinematics for
    // every liquid parcel which contacts that same piece of wood.
    const v=f.rig.pointVelocity({body:panel.body,point:center})??{x:0,y:0};
    const beside=f.rig.pointVelocity({body:panel.body,point:{x:center.x+1,y:center.y}})??v,omega=beside.y-v.y;
    const motion=panelMotion(r,panel,solid,pose,before,extension),bounds=sweptBounds(at(0,index),solid,motion);
    return {...solid,body:panel.body,key:panel.key,bounds,motionAt:t=>at(t,index),motion,velocityAt:point=>{
      return {vx:v.x-omega*(point.y-center.y),vy:v.y+omega*(point.x-center.x),vz:0};
    }};
  });});
}
function signedGap(point,solid,radius){
  const relative={x:point.x-solid.center.x,y:point.y-solid.center.y,z:point.z-solid.center.z};
  let gap=-Infinity,normal=null;
  for(let i=0;i<3;i++){
    const axis=solid.axes[i],projection=dot(relative,axis),distance=Math.abs(projection)-solid.half[i]-radius;
    if(distance>gap){gap=distance;const sign=projection<0?-1:1;normal={x:axis.x*sign,y:axis.y*sign,z:axis.z*sign};}
  }
  return {gap,normal,axis:normal};
}
function movingEntry(from,to,solid,radius,t0,t1){
  if(solid.bounds)for(const key of ['x','y','z'])if(Math.max(from[key],to[key])+radius<solid.bounds.min[key]||Math.min(from[key],to[key])-radius>solid.bounds.max[key])return null;
  if(!solid.motionAt||!solid.motion||solid.motion.centerBound<1e-12&&solid.motion.angleRate<1e-12&&solid.motion.halfBound<1e-12)return entry(from,to,solid,radius);
  const delta={x:to.x-from.x,y:to.y-from.y,z:to.z-from.z},path=length(delta),span=Math.max(0,t1-t0);
  const shape0=solid.motionAt(t0),shape1=solid.motionAt(t1),motion=solid.motion;
  if(motion.angleRate===0&&motion.halfBound===0){
    const relativeTo={x:to.x-shape1.center.x+shape0.center.x,y:to.y-shape1.center.y+shape0.center.y,z:to.z-shape1.center.z+shape0.center.z};
    const hit=entry(from,relativeTo,shape0,radius);return hit?{...hit,solid}:null;
  }
  let first=0,lastTime=1;
  // The rig is planar: these extrusions have an invariant world Z slab even
  // while their XY axes rotate. Clip that exact separation before spending a
  // conservative-advancement budget on an unrelated projected blade crossing.
  if(shape0.center.z===shape1.center.z&&shape0.half[2]===shape1.half[2]){
    const low=shape0.center.z-shape0.half[2]-radius,high=shape0.center.z+shape0.half[2]+radius;
    if(Math.abs(delta.z)<1e-14){if(from.z<low||from.z>high)return null;}
    else{
      const a=(low-from.z)/delta.z,b=(high-from.z)/delta.z;
      first=Math.max(0,Math.min(a,b));lastTime=Math.min(1,Math.max(a,b));if(first>lastTime)return null;
    }
  }
  const relative0=length({x:from.x-shape0.center.x,y:from.y-shape0.center.y,z:from.z-shape0.center.z});
  if(relative0>path+(motion.centerBound+motion.halfBound)*span+Math.hypot(...shape0.half)+radius)return null;
  const relative1=length({x:to.x-shape1.center.x,y:to.y-shape1.center.y,z:to.z-shape1.center.z});
  const distanceBound=Math.max(relative0,relative1)+path+motion.centerBound*span;
  const relativeDelta={x:delta.x-(motion.translation?.x??0)*span,y:delta.y-(motion.translation?.y??0)*span,z:delta.z};
  // The active face itself rotates during the remaining interval. Include the
  // possible change of the path's projection, not just its current dot product.
  const rotationBound=((motion.angularBound??motion.centerBound)+motion.angleRate*(distanceBound+length(relativeDelta))+(motion.centerExtension??0)+motion.halfBound)*span;
  const w=motion.angleRate*span,secondBound=w*w*distanceBound+2*w*(path+motion.centerBound*span)+
    ((motion.angularBound??motion.centerBound)+2*(motion.centerExtension??0))*motion.angleRate*span*span;
  const sample=t=>{
    const point={x:from.x+delta.x*t,y:from.y+delta.y*t,z:from.z+delta.z*t},shape=solid.motionAt(t0+span*t);
    return {...signedGap(point,shape,radius),point,shape,t};
  };
  const empty=(a,b)=>{
    const width=b.t-a.t,curve=secondBound*width*width/8+1e-10;
    const relative=s=>({x:s.point.x-s.shape.center.x,y:s.point.y-s.shape.center.y,z:s.point.z-s.shape.center.z});
    const A=relative(a),B=relative(b);
    for(let i=0;i<3;i++){
      const x=dot(A,a.shape.axes[i]),y=dot(B,b.shape.axes[i]),h0=a.shape.half[i]+radius,h1=b.shape.half[i]+radius,pad=1e-7+(i===2?1e-10:curve);
      if(Math.min(x-h0,y-h1)>pad||Math.min(-x-h0,-y-h1)>pad)return true;
    }
    return false;
  };
  const firstSample=sample(first),endSample=sample(lastTime);if(empty(firstSample,endSample))return null;
  let t=first,last=null;
  // Conservative advancement of the expanded prism's signed face gap. Unlike
  // endpoint tests, it sees a rotating blade pass through a resting parcel.
  for(let iteration=0;iteration<96;iteration++){
    last=t===first?firstSample:sample(t);
    if(last.gap<=1e-7)return {t,normal:last.normal,penetration:Math.max(0,-last.gap),solid};
    const bound=last.axis.z?Math.abs(delta.z):Math.abs(dot(relativeDelta,last.axis))+rotationBound;
    if(t>=lastTime||bound<1e-14)return null;
    t=Math.min(lastTime,t+Math.max(1e-10,.8*last.gap/bound));
  }
  // Near tangency can exhaust first-order advancement while remaining free.
  // Certify temporal intervals using the face's second derivative, in order;
  // never accept an unchecked endpoint or turn budget exhaustion into a hit.
  let queries=0;
  const search=(a,b,depth=0)=>{
    if(a.gap<=1e-7)return {t:a.t,normal:a.normal,penetration:Math.max(0,-a.gap),solid};
    if(empty(a,b))return null;
    if(queries>=512||depth>=30||a.t===b.t)return {t:a.t,normal:a.normal,penetration:0,solid,limited:true};
    const middle=sample((a.t+b.t)/2);queries++;return search(a,middle,depth+1)||search(middle,b,depth+1);
  };
  return search(sample(t),endSample);
}
function entry(from,to,solid,radius){
  const start={x:from.x-solid.center.x,y:from.y-solid.center.y,z:from.z-solid.center.z};
  const delta={x:to.x-from.x,y:to.y-from.y,z:to.z-from.z};
  let enter=0,exit=1,normal=null,inside=true,nearest=Infinity,insideNormal=null;
  for(let i=0;i<3;i++){
    const axis=solid.axes[i],a=dot(start,axis),d=dot(delta,axis),h=solid.half[i]+radius;
    const gap=h-Math.abs(a);
    if(gap<nearest){nearest=gap;const sign=a<0?-1:1;insideNormal={x:axis.x*sign,y:axis.y*sign,z:axis.z*sign};}
    if(gap<0)inside=false;
    if(Math.abs(d)<1e-14){if(Math.abs(a)>h)return null;continue;}
    const t0=(-h-a)/d,t1=(h-a)/d,low=Math.min(t0,t1),high=Math.max(t0,t1);
    if(low>enter){enter=low;const sign=d>0?-1:1;normal={x:axis.x*sign,y:axis.y*sign,z:axis.z*sign};}
    exit=Math.min(exit,high);if(enter>exit)return null;
  }
  if(exit<0||enter>1)return null;
  return {t:inside?0:enter,normal:inside?insideNormal:normal,penetration:inside?nearest:0,solid};
}
export function resolveLiquidSolid(parcel,from,radius,dt,solids,{timeFrom=0,timeTo=1}={}){
  let start=from,remaining=dt,timeStart=timeFrom;
  // Up to three corner contacts; capped work and no repeated infinite bounce.
  for(let iteration=0;iteration<3;iteration++){
    let hit=null;
    for(const solid of solids){const next=movingEntry(start,parcel,solid,radius,timeStart,timeTo);if(next&&(!hit||next.t<hit.t))hit=next;}
    if(!hit||!hit.normal)return;
    const n=hit.normal,t=hit.t,point={x:start.x+(parcel.x-start.x)*t,y:start.y+(parcel.y-start.y)*t,z:start.z+(parcel.z-start.z)*t};
    const v=hit.solid.velocityAt?.(point)??{vx:0,vy:0,vz:0};
    let x=parcel.vx-v.vx,y=parcel.vy-v.vy,z=parcel.vz-v.vz,closing=x*n.x+y*n.y+z*n.z;
    if(closing<0){
      // Low restitution and viscous tangential loss: steel/wood cannot launch
      // stationary liquid by themselves. Moving bodies supply their velocity.
      x-=closing*n.x;y-=closing*n.y;z-=closing*n.z;
      parcel.vx=v.vx+x*.94-closing*.04*n.x;parcel.vy=v.vy+y*.94-closing*.04*n.y;parcel.vz=v.vz+z*.94-closing*.04*n.z;
    }
    const offset=Math.max(0,hit.penetration)+1e-7;
    start={x:point.x+n.x*offset,y:point.y+n.y*offset,z:point.z+n.z*offset};remaining*=1-t;
    timeStart+=(timeTo-timeStart)*t;
    if(hit.limited||iteration===2){parcel.x=start.x;parcel.y=start.y;parcel.z=start.z;return {limited:true};}
    parcel.x=start.x+parcel.vx*remaining;parcel.y=start.y+parcel.vy*remaining;parcel.z=start.z+parcel.vz*remaining;
    if(remaining<1e-10)return;
  }
}
