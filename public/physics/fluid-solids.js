/** Reduced, one-way liquid/rig contact. Shared extruded body proxies keep water
 * from passing through wood/steel; they are not triangle CFD or fluid feedback.
 * A parcel remains whole: contact never creates, deletes or changes its volume.
 */
import {createDetachedFluidColliders} from './detached-fluid-colliders.js';
const dot=(a,b)=>a.x*b.x+a.y*b.y+(a.z??0)*(b.z??0);
const length=v=>Math.hypot(v.x,v.y,v.z??0);
const depthIndexes=new WeakMap(),DEPTH_CELL=.125;
const sweepIndexes=new WeakMap();
const sweepAxes=[['x',4],['y',4],['z',8]];
function createSweepIndex(colliders){
  if(colliders.length>64)return null;
  const axes=[];
  for(const [axis,scale] of sweepAxes){
    let first=Infinity,last=-Infinity;
    const ranges=[];
    for(const solid of colliders){
      const min=Math.floor(solid.bounds.min[axis]*scale),max=Math.floor(solid.bounds.max[axis]*scale);
      if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||max<min)return null;
      ranges.push([min,max]);first=Math.min(first,min);last=Math.max(last,max);
    }
    if(!ranges.length||last-first>128)return null;
    const bits=new Uint32Array((last-first+1)*2);
    for(const [i,[min,max]] of ranges.entries()){
      const word=i>>>5,mask=1<<(i&31);
      for(let cell=min;cell<=max;cell++)bits[(cell-first)*2+word]|=mask;
    }
    axes.push({first,last,scale,bits});
  }
  return {count:colliders.length,axes};
}
function intersectSweep(axis,lower,upper,mask){
  const low=Math.floor(lower*axis.scale),high=Math.floor(upper*axis.scale);
  if(!Number.isSafeInteger(low)||!Number.isSafeInteger(high)||high<low)return false;
  const start=Math.max(low,axis.first),end=Math.min(high,axis.last);
  let lo=0,hi=0;
  for(let cell=start;cell<=end;cell++){
    const i=(cell-axis.first)*2;lo|=axis.bits[i];hi|=axis.bits[i+1];
  }
  mask.lo&=lo;mask.hi&=hi;
  return true;
}

function depthCandidates(solids,from,to,radius){
  const index=depthIndexes.get(solids);if(!index||index.count!==solids.length)return null;
  const low=Math.floor((Math.min(from.z,to.z)-radius)/DEPTH_CELL),high=Math.floor((Math.max(from.z,to.z)+radius)/DEPTH_CELL);
  if(!Number.isSafeInteger(low)||!Number.isSafeInteger(high)||high-low>32)return null;
  let mask=0;for(let cell=low;cell<=high;cell++)mask|=index.bins.get(cell)??0;return mask;
}
function panelSolid(panel){
  const center={x:panel.center.x,y:panel.center.y,z:panel.z},a=panel.axes[0],b=panel.axes[1];
  let u=0,v=0;
  for(const p of panel.vertices){
    const dx=p.x-center.x,dy=p.y-center.y;u=Math.max(u,Math.abs(dx*a.x+dy*a.y));v=Math.max(v,Math.abs(dx*b.x+dy*b.y));
  }
  return {axes:[{x:a.x,y:a.y,z:0},{x:b.x,y:b.y,z:0},{x:0,y:0,z:1}],center,half:[u,v,panel.depth/2]};
}
// These are the serial joints from ArticulatedRig.#kinematics. Distances below
// come from its actual frames, so boss proportions and shoulder/hip offsets
// participate without a normal-size, whole-body reach constant.
const parentBody={torso:'pelvis',neck:'torso',mainUpper:'torso',mainForearm:'mainUpper',weapon:'mainForearm',
  offUpper:'torso',offForearm:'offUpper',offWeapon:'offForearm',frontThigh:'pelvis',frontShin:'frontThigh',frontFoot:'frontShin',backThigh:'pelvis',backShin:'backThigh',backFoot:'backShin'};
const bodyJoint={pelvis:2,torso:3,neck:12,mainUpper:4,mainForearm:5,weapon:13,offUpper:6,offForearm:7,offWeapon:7,frontThigh:8,frontShin:9,backThigh:10,backShin:11,frontFoot:14,backFoot:15};
function panelMotion(r,panel,solid,pose,before,extension,depthTravel){
  const translation={x:r.q[0]-before[0],y:r.q[1]-before[1],z:depthTravel},frames=pose.bodyFrames;
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
export function fluidSolidColliders(fighters,stepSeconds=1/120,{nativeChestSampler=null,prepareSweepIndex=false}={}){
  const colliders=fighters.flatMap(f=>{
    const r=f.rig,current=r.collisionPanels(),currentSolids=current.map(panelSolid),cache=new Map([[1,{panels:current,solids:currentSolids}]]),before=r.previousQ??r.q;
    const extension=Math.abs(r.swordLength-(r.previousSwordLength??r.swordLength));
    const bodyDepth=r.bodyDepth??0,weaponDepth=r.weaponDepthOffset??0;
    const movingDepth=bodyDepth!==(r.previousBodyDepth??bodyDepth)||weaponDepth!==(r.previousWeaponDepthOffset??weaponDepth);
    const pose=r.pose();
    const direct=typeof r.collisionSolidsAt==='function',componentCaches=direct?current.map(()=>new Map()):null;
    const previousSolids=direct?r.collisionSolidsAt(0):null;
    const chestSampler=direct?nativeChestSampler?.(r):null;
    const at=(t,index)=>{
      if(direct){
        if(t===0)return previousSolids[index];
        if(t===1)return currentSolids[index];
        const samples=componentCaches[index];
        if(samples.has(t)){
          const solid=samples.get(t);samples.delete(t);samples.set(t,solid);return solid;
        }
        const key=current[index].key;
        const solid=chestSampler&&(key==='chest-front'||key==='chest-back')?chestSampler(t,key):r.collisionSolidsAt(t,key)[0];
        if(samples.size>=32)samples.delete(samples.keys().next().value);
        samples.set(t,solid);return solid;
      }
      if(!cache.has(t)){
        if(cache.size>=32){for(const key of cache.keys())if(key!==0&&key!==1){cache.delete(key);break;}}
        cache.set(t,{panels:null,solids:[]});
      }
      const sample=cache.get(t);
      if(!sample.solids[index]){
        if(r.collisionSolidsAt)sample.solids[index]=r.collisionSolidsAt(t,current[index].key)[0];
        else{
          const panel=sample.panels?.[index]??(r.collisionGeometryAt?r.collisionGeometryAt(t,current[index].key)[0]:(sample.panels??=r.collisionPanelsAt(t))[index]);
          sample.solids[index]=panelSolid(panel);
        }
      }
      return sample.solids[index];
    };
    if(!direct)cache.set(0,{panels:r.collisionGeometryAt?.(0)??r.collisionPanelsAt(0),solids:[]});
    return current.map((panel,index)=>{
    const solid=currentSolids[index],center=solid.center;
    // Rigid planar point velocity is affine: evaluate its translation and
    // angular rate once per proxy, rather than rebuilding rig kinematics for
    // every liquid parcel which contacts that same piece of wood.
    const v=f.rig.pointVelocity({body:panel.body,point:center})??{x:0,y:0};
    const beside=f.rig.pointVelocity({body:panel.body,point:{x:center.x+1,y:center.y}})??v,omega=beside.y-v.y;
    const previous=at(0,index);
    // An arm or weapon may move in depth independently of the torso.
    const depthTravel=movingDepth&&center.z!==previous.center.z?center.z-previous.center.z:0;
    const depthVelocity=depthTravel===0?0:depthTravel/stepSeconds;
    const motion=panelMotion(r,panel,solid,pose,before,extension,depthTravel),bounds=sweptBounds(previous,solid,motion);
    return {...solid,body:panel.body,key:panel.key,bounds,motionAt:t=>at(t,index),motion,velocityAt:point=>{
      return {vx:v.x-omega*(point.y-center.y),vy:v.y+omega*(point.x-center.x),vz:depthVelocity};
    }};
  });});
  for(const f of fighters)for(const fragment of f.rig.fragments??[])colliders.push(...createDetachedFluidColliders(fragment,{panelSolid,sweptBounds}));
  if(prepareSweepIndex){
    const index=createSweepIndex(colliders);
    if(index){sweepIndexes.set(colliders,index);return colliders;}
  }
  if(colliders.length<=32){
    const bins=new Map();let valid=true;
    for(let i=0;i<colliders.length;i++){
      const bounds=colliders[i].bounds,low=Math.floor(bounds.min.z/DEPTH_CELL),high=Math.floor(bounds.max.z/DEPTH_CELL);
      if(!Number.isSafeInteger(low)||!Number.isSafeInteger(high)||high-low>32){valid=false;break;}
      for(let cell=low;cell<=high;cell++)bins.set(cell,(bins.get(cell)??0)|(1<<i));
    }
    if(valid)depthIndexes.set(colliders,{count:colliders.length,bins});
  }
  return colliders;
}
function signedGap(point,solid,radius,result=null){
  const x=point.x-solid.center.x,y=point.y-solid.center.y,z=point.z-solid.center.z;
  let gap=-Infinity,selected=null,sign=1;
  for(let i=0;i<3;i++){
    const axis=solid.axes[i],projection=x*axis.x+y*axis.y+z*(axis.z??0),distance=Math.abs(projection)-solid.half[i]-radius;
    if(distance>gap){gap=distance;selected=axis;sign=projection<0?-1:1;}
  }
  const normal=selected?(result?.normal??{x:0,y:0,z:0}):null;
  if(normal){normal.x=selected.x*sign;normal.y=selected.y*sign;normal.z=selected.z*sign;}
  if(result){result.gap=gap;result.normal=normal;result.axis=normal;return result;}
  return {gap,normal,axis:normal};
}
function movingEntry(from,to,solid,radius,t0,t1){

  if(!solid.motionAt||!solid.motion||solid.motion.centerBound<1e-12&&solid.motion.angleRate<1e-12&&solid.motion.halfBound<1e-12)return entry(from,to,solid,radius);
  const delta={x:to.x-from.x,y:to.y-from.y,z:to.z-from.z},path=length(delta),span=Math.max(0,t1-t0);
  const shape0=solid.motionAt(t0),shape1=solid.motionAt(t1),motion=solid.motion;
  if(motion.angleRate===0&&motion.halfBound===0){
    const relativeTo={x:to.x-shape1.center.x+shape0.center.x,y:to.y-shape1.center.y+shape0.center.y,z:to.z-shape1.center.z+shape0.center.z};
    const hit=entry(from,relativeTo,shape0,radius);return hit?{...hit,solid}:null;
  }
  let first=0,lastTime=1;
  // Clip the invariant depth slab of stationary layers before spending the
  // advancement budget on an unrelated XY crossing. Moving layers use their
  // relative depth speed below.
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
  // Depth is affine over the solid's step, including a shorter fluid substep.
  const relativeZ=motion.translation?.z?delta.z-(shape1.center.z-shape0.center.z):delta.z;
  const relativeDelta={x:delta.x-(motion.translation?.x??0)*span,y:delta.y-(motion.translation?.y??0)*span,
    z:relativeZ};
  // The active face itself rotates during the remaining interval. Include the
  // possible change of the path's projection, not just its current dot product.
  const rotationBound=((motion.angularBound??motion.centerBound)+motion.angleRate*(distanceBound+length(relativeDelta))+(motion.centerExtension??0)+motion.halfBound)*span;
  const w=motion.angleRate*span,secondBound=w*w*distanceBound+2*w*(path+motion.centerBound*span)+
    ((motion.angularBound??motion.centerBound)+2*(motion.centerExtension??0))*motion.angleRate*span*span;
  const sample=(t,out=null)=>{
    const point=out?.point??{x:0,y:0,z:0};
    point.x=from.x+delta.x*t;point.y=from.y+delta.y*t;point.z=from.z+delta.z*t;
    const shape=solid.motionAt(t0+span*t);
    const result=signedGap(point,shape,radius,out);result.point=point;result.shape=shape;result.t=t;return result;
  };
  const empty=(a,b)=>{
    const width=b.t-a.t,curve=secondBound*width*width/8+1e-10;
    const ax=a.point.x-a.shape.center.x,ay=a.point.y-a.shape.center.y,az=a.point.z-a.shape.center.z;
    const bx=b.point.x-b.shape.center.x,by=b.point.y-b.shape.center.y,bz=b.point.z-b.shape.center.z;
    for(let i=0;i<3;i++){
      const A=a.shape.axes[i],B=b.shape.axes[i],x=ax*A.x+ay*A.y+az*(A.z??0),y=bx*B.x+by*B.y+bz*(B.z??0);
      const h0=a.shape.half[i]+radius,h1=b.shape.half[i]+radius,pad=1e-7+(i===2?1e-10:curve);
      if(Math.min(x-h0,y-h1)>pad||Math.min(-x-h0,-y-h1)>pad)return true;
    }
    return false;
  };
  const firstSample=sample(first),endSample=sample(lastTime);if(empty(firstSample,endSample))return null;
  let t=first,last=null,probe=null;
  // Conservative advancement of the expanded prism's signed face gap. Unlike
  // endpoint tests, it sees a rotating blade pass through a resting parcel.
  for(let iteration=0;iteration<96;iteration++){
    // Only this iterative probe is reused. Endpoints and recursive samples
    // retain their own records while they certify unresolved intervals.
    last=t===first?firstSample:(probe=sample(t,probe));
    if(last.gap<=1e-7)return {t,normal:last.normal,penetration:Math.max(0,-last.gap),solid};
    const bound=last.axis.z?Math.abs(relativeDelta.z):Math.abs(dot(relativeDelta,last.axis))+rotationBound;
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
  const index=sweepIndexes.get(solids),maskPair=index?.count===solids.length?{lo:0,hi:0}:null;
  // Up to three corner contacts; capped work and no repeated infinite bounce.
  for(let iteration=0;iteration<3;iteration++){
    let hit=null;
    const minX=Math.min(start.x,parcel.x)-radius,maxX=Math.max(start.x,parcel.x)+radius;
    const minY=Math.min(start.y,parcel.y)-radius,maxY=Math.max(start.y,parcel.y)+radius;
    const minZ=Math.min(start.z,parcel.z)-radius,maxZ=Math.max(start.z,parcel.z)+radius;
    const visit=solid=>{
      const bounds=solid.bounds;
      if(bounds&&(maxZ<bounds.min.z||minZ>bounds.max.z||maxX<bounds.min.x||minX>bounds.max.x||maxY<bounds.min.y||minY>bounds.max.y))return;
      const next=movingEntry(start,parcel,solid,radius,timeStart,timeTo);
      if(next&&(!hit||next.t<hit.t))hit=next;
    };
    if(maskPair){maskPair.lo=-1;maskPair.hi=-1;}
    if(maskPair&&intersectSweep(index.axes[0],minX,maxX,maskPair)&&intersectSweep(index.axes[1],minY,maxY,maskPair)&&
        intersectSweep(index.axes[2],minZ,maxZ,maskPair)){
      // Visit each word in collider order. Equal times keep their original tie break.
      let low=maskPair.lo,high=maskPair.hi;
      while(low!==0){const i=31-Math.clz32(low&-low);low&=low-1;visit(solids[i]);}
      while(high!==0){const i=31-Math.clz32(high&-high);high&=high-1;visit(solids[32+i]);}
    }else{
      let mask=depthCandidates(solids,start,parcel,radius);
      if(mask===null){for(const solid of solids)visit(solid);}
      else while(mask!==0){const i=31-Math.clz32(mask&-mask);mask&=mask-1;visit(solids[i]);}
    }
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
