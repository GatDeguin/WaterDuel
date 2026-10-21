/** WATER DUEL 1.0 — locally evaluated, conserved particle-volume fluid.
 * Each particle represents constant liquid volume. Integration uses spatial hashing,
 * weak compressibility, viscosity, cohesion, floor collision and rigid-body impulse.
 * This is a real time, reduced-order particle fluid, not a validated SPH/FLIP CFD solver.
 */
import {BALLOON_RADII,TABLE_TOP,WATER_RADII,WATER_FILL_FRACTION,capHeightForFraction,containedWaterFrame,waterDropRadius} from './dimensions.js';
import {resolveLiquidSolid} from './fluid-solids.js';
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const PHI=2.399963229728653;
const INTERNAL_RELEASE_SPEED=7,RELEASE_COMPONENT_SPEED=14;
const FIXED_STEP=1/120,DISCHARGE=.62;
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const lerp=(a,b,t)=>a+(b-a)*t;
const fract=x=>x-Math.floor(x);
// Three signed 16-bit coordinates fit exactly in a 48-bit integer (IEEE-754
// integers are exact through 53 bits). Remote/out-of-domain cells retain an
// unambiguous string key rather than wrapping onto a physical neighbour.
const cellKey=(x,y,z)=>x>=-32768&&x<=32767&&y>=-32768&&y<=32767&&z>=-32768&&z<=32767?
  ((x+32768)*65536+y+32768)*65536+z+32768:`outside:${x},${y},${z}`;
export const WATER_DENSITY=997;
export const HEAD_FULL_VOLUME=(4/3)*Math.PI*WATER_RADII.x*WATER_RADII.y*WATER_RADII.z;
export const HEAD_VOLUME=HEAD_FULL_VOLUME*WATER_FILL_FRACTION; // world units cubed
const supportCache=new WeakMap();
/** A conservative container query over physical, attached skin triangles.
 * AABB is only an early rejection. Five outward crossings (down and lateral)
 * must belong to one edge-connected skin component; detached patches cannot
 * assemble a fictitious vessel. An open top is allowed. This is a reduced
 * support condition, not a general inside-mesh proof or fluid/solid CFD solve.
 */
export function buildMembraneSupport(membrane){
  const cached=supportCache.get(membrane);
  if(cached&&cached.version===membrane.version)return cached;
  const keys=['x','y','z'],triangles=[],edges=new Map(),parents=[];
  const bounds={min:{x:Infinity,y:Infinity,z:Infinity},max:{x:-Infinity,y:-Infinity,z:-Infinity}};
  const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  for(const face of membrane.faces){
    if(face.fragment)continue;
    const ids=[face.a,face.b,face.c],points=ids.map(id=>membrane.nodes[id]);
    if(points.some(p=>!p||keys.some(k=>!Number.isFinite(p[k]))))continue;
    const [a,b,c]=points,e=keys.map(k=>b[k]-a[k]),f=keys.map(k=>c[k]-a[k]);
    const normal=[e[1]*f[2]-e[2]*f[1],e[2]*f[0]-e[0]*f[2],e[0]*f[1]-e[1]*f[0]];
    if(Math.hypot(...normal)<1e-12)continue;
    const index=triangles.length;parents.push(index);
    triangles.push({a:keys.map(k=>a[k]),e,f,normal,component:index});
    for(const p of points)for(const k of keys){bounds.min[k]=Math.min(bounds.min[k],p[k]);bounds.max[k]=Math.max(bounds.max[k],p[k]);}
    for(let j=0;j<3;j++){
      const x=ids[j],y=ids[(j+1)%3],key=x<y?`${x}:${y}`:`${y}:${x}`;
      if(edges.has(key)){const other=root(edges.get(key));parents[root(index)]=other;}else edges.set(key,index);
    }
  }
  for(let i=0;i<triangles.length;i++)triangles[i].component=root(i);
  // Projection coefficients avoid general ray/triangle vector allocations in
  // each parcel query. Both lateral directions share one projected lookup.
  const projections=keys.map((_,axis)=>{
    const u=(axis+1)%3,v=(axis+2)%3,out=[];
    for(const t of triangles){
      const determinant=t.e[u]*t.f[v]-t.e[v]*t.f[u];
      if(Math.abs(determinant)<1e-12)continue;
      out.push({t,u,v,inverse:1/determinant,
        minU:Math.min(t.a[u],t.a[u]+t.e[u],t.a[u]+t.f[u]),maxU:Math.max(t.a[u],t.a[u]+t.e[u],t.a[u]+t.f[u]),
        minV:Math.min(t.a[v],t.a[v]+t.e[v],t.a[v]+t.f[v]),maxV:Math.max(t.a[v],t.a[v]+t.e[v],t.a[v]+t.f[v])});
    }return out;
  });
  const epsilon=1e-8;
  const support={version:membrane.version,bounds,triangleCount:triangles.length,componentCount:new Set(triangles.map(t=>t.component)).size,
    contains(point){
      if(keys.some(k=>!Number.isFinite(point[k])||point[k]<bounds.min[k]-epsilon||point[k]>bounds.max[k]+epsilon))return false;
      const p=[point.x,point.y,point.z];let component=-1;
      for(let axis=0;axis<3;axis++){
        let negative=Infinity,positive=Infinity,minus=null,plus=null;
        for(const q of projections[axis]){
          const pu=p[q.u],pv=p[q.v];
          if(pu<q.minU-epsilon||pu>q.maxU+epsilon||pv<q.minV-epsilon||pv>q.maxV+epsilon)continue;
          const t=q.t,du=pu-t.a[q.u],dv=pv-t.a[q.v];
          const s=(du*t.f[q.v]-dv*t.f[q.u])*q.inverse,r=(t.e[q.u]*dv-t.e[q.v]*du)*q.inverse;
          if(s<-epsilon||r<-epsilon||s+r>1+epsilon)continue;
          const d=t.a[axis]+s*t.e[axis]+r*t.f[axis]-p[axis];
          if(d<=epsilon&&-d<negative){negative=-d;minus=t;}
          if(d>=-epsilon&&d<positive){positive=d;plus=t;}
        }
        // The nearest crossing must leave the oriented skin, rather than enter
        // an unrelated fold in its AABB. No upper ray: a bowl may be open above.
        if(!minus||minus.normal[axis]>=-1e-12)return false;
        if(component<0)component=minus.component;else if(minus.component!==component)return false;
        if(axis!==1&&(!plus||plus.normal[axis]<=1e-12||plus.component!==component))return false;
      }
      return component>=0;
    }};
  supportCache.set(membrane,support);return support;
}
export class FluidVolume {
  constructor(slot,count=220,scale=1){
    this.slot=slot;this.count=count;this.scale=scale;this.particleVolume=HEAD_VOLUME*scale**3/count;
    this.particles=[];this.released=false;this.leaking=false;this.contained=false;this.elapsed=0;this.wetCount=0;
    this.leakAccumulator=0;this.leakSteps=0;this.leakCredit=0;this.leakDischarged=0;this.flowRate=0;this.exitSpeed=0;
    this.orificeReleased=0;this.supportLossReleased=0;this.capacityReleased=0;this.geometryReleased=0;this.instantReleased=0;this.phaseVersion=0;
    this.initialVolume=HEAD_VOLUME*scale**3;
    this.corrections=Array.from({length:6},()=>new Float32Array(count));
    this.neighborGrid=new Map();this.cellCoordinates=new Float64Array(count*3);this.neighborBuckets=[];
    this.previousPositions=new Float64Array(count*3);
    this.origin={x:0,y:0,z:0};this.previousOrigin={...this.origin};
    this.containmentVelocity={vx:0,vy:0,vz:0};
    this.surfaceFrame=containedWaterFrame();
    this.seed=slot*0.17;this.buildLattice();
  }
  buildLattice(){
    const N=this.count;
    this.particles=Array.from({length:N},(_,i)=>{
      // Inverse volume CDF in the spherical cap, then uniform-area sampling of
      // each horizontal disk. No particle is cropped, deleted or double-counted.
      const uy=capHeightForFraction((i+.5)/N*WATER_FILL_FRACTION),theta=i*PHI;
      const radius=Math.sqrt((1-uy*uy)*fract((i+.5)*.7548776662466927));
      const ux=radius*Math.cos(theta),uz=radius*Math.sin(theta);
      const lx=ux*WATER_RADII.x*this.scale,ly=uy*WATER_RADII.y*this.scale,lz=uz*WATER_RADII.z*this.scale;
      return {ux,uy,uz,theta,diskFraction:fract((i+.5)*.7548776662466927),lx,ly,lz,x:lx,y:ly,z:lz,vx:0,vy:0,vz:0,age:0,wet:false,free:false,volume:this.particleVolume,r:.026,slot:this.slot};
    });
  }
  get volume(){return this.particles.reduce((sum,p)=>sum+p.volume,0);}
  get releasedParticles(){return this.leaking?this.particles.filter(p=>p.free):this.released?this.particles:[];}
  get retainedParticles(){return this.leaking?this.particles.filter(p=>!p.free):this.released?[]:this.particles;}
  get releasedVolume(){return this.releasedParticles.reduce((sum,p)=>sum+p.volume,0);}
  get retainedVolume(){return this.retainedParticles.reduce((sum,p)=>sum+p.volume,0);}
  get retainedCOM(){return this.retainedMassProperties().center;}
  retainedMassProperties(){
    const particles=this.retainedParticles,volume=particles.reduce((sum,p)=>sum+p.volume,0),center={x:0,y:0,z:0};
    if(volume>0)for(const p of particles){center.x+=p.x*p.volume/volume;center.y+=p.y*p.volume/volume;center.z+=p.z*p.volume/volume;}
    else Object.assign(center,this.origin);
    const inertia={xx:0,yy:0,zz:0,xy:0,xz:0,yz:0};
    for(const p of particles){const x=p.x-center.x,y=p.y-center.y,z=p.z-center.z,v=p.volume;
      inertia.xx+=v*(y*y+z*z);inertia.yy+=v*(x*x+z*z);inertia.zz+=v*(x*x+y*y);
      inertia.xy-=v*x*y;inertia.xz-=v*x*z;inertia.yz-=v*y*z;
    }
    return {volume,center,inertia}; // Multiply volume and tensor by an explicit scene density.
  }
  get leakState(){return {active:this.leaking,complete:this.released&&this.retainedVolume===0,steps:this.leakSteps,elapsed:this.elapsed,
    flowRate:this.flowRate,exitSpeed:this.exitSpeed,budgetVolume:this.leakCredit,dischargedVolume:this.leakDischarged,
    orificeVolume:this.orificeReleased,supportLossVolume:this.supportLossReleased,
    capacityLossVolume:this.capacityReleased,geometryLossVolume:this.geometryReleased,instantVolume:this.instantReleased};}
  keepContained(head,dt,slosh=0,time=0){
    if(this.released&&!this.leaking)return;
    const c={x:head.x,y:head.y,z:head.z??.025};
    const vx=this.contained?(c.x-this.origin.x)/Math.max(dt,1/120):0;
    const vy=this.contained?(c.y-this.origin.y)/Math.max(dt,1/120):0;
    const vz=this.contained?(c.z-this.origin.z)/Math.max(dt,1/120):0;
    this.previousOrigin=this.origin;this.origin=c;
    // Raw transport is separate from the bounded public head-velocity estimate:
    // it must be removed exactly once when extracting motion relative to the cap.
    this.containmentVelocity={vx,vy,vz};
    this.lastSlosh=slosh;this.lastTime=time;
    this.surfaceFrame=containedWaterFrame(slosh,time,this.retainedVolume/(HEAD_FULL_VOLUME*this.scale**3));
    this.placeContained(dt);
    this.headVelocity={vx:clamp(vx,-7,7),vy:clamp(vy,-7,7),vz:clamp(vz,-7,7)};this.contained=true;
  }
  placeContained(dt,accumulateVelocity=false){
    const particles=this.retainedParticles,c=this.origin;
    const r=this.surfaceFrame.rotation;
    let rank=0;
    for(let p of particles){
      if(this.leaking){
        p.uy=capHeightForFraction((rank+.5)/particles.length*this.surfaceFrame.fraction);
        const radius=Math.sqrt(Math.max(0,(1-p.uy*p.uy)*p.diskFraction));
        p.ux=radius*Math.cos(p.theta);p.uz=radius*Math.sin(p.theta);rank++;
      }
      p.lx=(r[0]*p.ux+r[1]*p.uy+r[2]*p.uz)*WATER_RADII.x*this.scale;
      p.ly=(r[3]*p.ux+r[4]*p.uy+r[5]*p.uz)*WATER_RADII.y*this.scale;
      p.lz=(r[6]*p.ux+r[7]*p.uy+r[8]*p.uz)*WATER_RADII.z*this.scale;
      const targetX=c.x+p.lx,targetY=c.y+p.ly,targetZ=c.z+p.lz;
      p.vx=(accumulateVelocity?p.vx:0)+(this.contained?(targetX-p.x)/Math.max(dt,1/120):0);
      p.vy=(accumulateVelocity?p.vy:0)+(this.contained?(targetY-p.y)/Math.max(dt,1/120):0);
      p.vz=(accumulateVelocity?p.vz:0)+(this.contained?(targetZ-p.z)/Math.max(dt,1/120):0);
      p.x=targetX;p.y=targetY;p.z=targetZ;
    }
  }
  beginLeak({head,impact,attackDir=1,headVelocity={vx:0,vy:0},thrust=1}){
    if(this.released)return false;
    if(!this.contained)this.keepContained(head,1/120);
    this.released=true;this.leaking=true;this.elapsed=0;this.impact={...impact};
    this.leakInput={head:{...this.origin},slosh:this.lastSlosh??0,time:this.lastTime??0};
    this.releaseOptions={attackDir,headVelocity:{...headVelocity},thrust};
    this.releaseOrigin={x:head.x,y:head.y,z:head.z??.025};
    this.localImpact={x:impact.x-this.releaseOrigin.x,y:impact.y-this.releaseOrigin.y,z:(impact.z??this.releaseOrigin.z)-this.releaseOrigin.z};
    // Ellipsoid surface normal directs pressure out of the puncture; the weapon
    // adds a separate forward impulse. This is a reduced release model, not CFD.
    let tx=(impact.x-head.x)/(BALLOON_RADII.x*this.scale)**2,ty=(impact.y-head.y)/(BALLOON_RADII.y*this.scale)**2;
    let tz=((impact.z??(head.z??.025))-(head.z??.025))/(BALLOON_RADII.z*this.scale)**2;
    let len=Math.hypot(tx,ty,tz);
    if(len<1e-8){tx=-Math.sign(attackDir||1);ty=0;tz=0;len=1;}
    tx/=len;ty/=len;tz/=len;this.releaseNormal={x:tx,y:ty,z:tz};
    return true;
  }
  release(args){
    if(this.released&&!this.leaking)return false;
    if(!this.released)this.beginLeak(args);
    this.instantReleased+=this.retainedVolume;
    for(let i=0;i<this.particles.length;i++){
      const p=this.particles[i];
      if(!p.free)this.releaseParticle(p,i,{...this.releaseOptions,...args});
    }
    this.leaking=false;this.leakCredit=0;this.flowRate=0;this.leakDischarged=this.volume;
    this.surfaceFrame=containedWaterFrame(this.lastSlosh??0,this.lastTime??0,0);
    return true;
  }
  releaseParticle(p,i,{headVelocity={vx:0,vy:0},attackDir=1,thrust=1,supportLoss=false},exitSpeed=null){
      if(p.free)return false;
      const {x:tx,y:ty,z:tz}=this.releaseNormal;
      const outward=Math.hypot(p.lx/WATER_RADII.x,p.ly/WATER_RADII.y,p.lz/WATER_RADII.z)||1;
      const nx=p.lx/(WATER_RADII.x*outward),ny=p.ly/(WATER_RADII.y*outward),nz=p.lz/(WATER_RADII.z*outward);
      const jet=Math.max(0,nx*tx+ny*ty+nz*tz);
      const noise=(fract(Math.sin((i+7)*78.23)*5832.831)-.5);
      const pressure=exitSpeed===null ? .85+1.7*jet*jet : exitSpeed*.25,holeJet=exitSpeed===null ? .65+2.1*jet*jet : exitSpeed;
      const relativeX=p.vx-this.containmentVelocity.vx,relativeY=p.vy-this.containmentVelocity.vy,relativeZ=p.vz-this.containmentVelocity.vz;
      // Preserve measured internal motion, then add translation and puncture
      // impulse. Bound only extreme internal vectors without rotating them;
      // the final safety bound matches the integrator's component-speed limit.
      const relativeScale=Math.min(1,INTERNAL_RELEASE_SPEED/(Math.hypot(relativeX,relativeY,relativeZ)||1));
      p.vx=clamp(clamp(headVelocity.vx??0,-7,7)+relativeX*relativeScale+(supportLoss?0:nx*pressure+tx*holeJet+attackDir*.45*thrust+noise*.25),-RELEASE_COMPONENT_SPEED,RELEASE_COMPONENT_SPEED);
      p.vy=clamp(clamp(headVelocity.vy??0,-7,7)+relativeY*relativeScale+(supportLoss?0:ny*pressure+ty*holeJet+.4+noise*.25),-RELEASE_COMPONENT_SPEED,RELEASE_COMPONENT_SPEED);
      p.vz=clamp(clamp(headVelocity.vz??0,-7,7)+relativeZ*relativeScale+(supportLoss?0:nz*pressure+tz*holeJet+noise*.25),-RELEASE_COMPONENT_SPEED,RELEASE_COMPONENT_SPEED);
      p.wet=false;p.age=0;p.free=true;this.phaseVersion++;return true;
  }
  advanceLeak(dt,options={}){
    if(!this.leaking||!Number.isFinite(dt)||dt<=0)return;
    const previous=this.leakInput,targetHead=options.head??previous.head;
    const current={head:{x:finite(targetHead.x,previous.head.x),y:finite(targetHead.y,previous.head.y),z:finite(targetHead.z,previous.head.z)},
      slosh:finite(options.slosh,previous.slosh),time:finite(options.time,previous.time+dt),
      apertureArea:Math.max(0,finite(options.apertureArea)),pressure:clamp(finite(options.pressure),0,1),
      containmentCapacity:Math.max(0,finite(options.containmentCapacity,Infinity))};
    // The first opening observation is constant over its first caller interval.
    if(previous.apertureArea===undefined){previous.apertureArea=current.apertureArea;previous.pressure=current.pressure;}
    if(previous.containmentCapacity===undefined)previous.containmentCapacity=current.containmentCapacity;
    const accumulated=this.leakAccumulator;this.leakAccumulator+=dt;
    let tickTime=FIXED_STEP-accumulated;
    while(this.leakAccumulator>=FIXED_STEP-1e-12){
      const t=clamp(tickTime/dt,0,1),head={x:lerp(previous.head.x,current.head.x,t),y:lerp(previous.head.y,current.head.y,t),z:lerp(previous.head.z,current.head.z,t)};
      const slosh=lerp(previous.slosh,current.slosh,t),time=lerp(previous.time,current.time,t);
      this.keepContained(head,FIXED_STEP,slosh,time);
      const area=Math.min(4*Math.PI*(BALLOON_RADII.y*this.scale)**2,lerp(previous.apertureArea,current.apertureArea,t));
      const pressure=lerp(previous.pressure,current.pressure,t),r=this.surfaceFrame.rotation,q=this.localImpact;
      const planeAtHole=q.x/(WATER_RADII.x*this.scale)*r[1]+q.y/(WATER_RADII.y*this.scale)*r[4]+q.z/(WATER_RADII.z*this.scale)*r[7];
      const waterHeight=Math.max(0,(this.surfaceFrame.height-planeAtHole)*WATER_RADII.y*this.scale/Math.max(.5,r[4]));
      // Reduced hydraulic head, not pressure in Pa or a free-boundary CFD solve.
      this.exitSpeed=Math.min(INTERNAL_RELEASE_SPEED,Math.sqrt(2*9.81*(waterHeight+.24*this.scale*pressure)));
      this.flowRate=this.retainedVolume>0?DISCHARGE*area*this.exitSpeed:0;
      const remaining=this.retainedVolume-this.leakCredit,discharge=Math.min(Math.max(0,remaining),this.flowRate*FIXED_STEP);
      this.leakCredit+=discharge;this.leakDischarged+=discharge;
      let emitted=false;
      const hole={x:head.x+q.x,y:head.y+q.y,z:head.z+q.z};
      // Choose nearby finite parcels, preserving positions across the phase change.
      // Interior transport is the cap CDF approximation, not a solved nozzle path.
      const releaseClosest=supportLoss=>{
        let selected=-1,distance=Infinity;
        for(let i=0;i<this.particles.length;i++){const p=this.particles[i];if(p.free)continue;const d=(p.x-hole.x)**2+(p.y-hole.y)**2+(p.z-hole.z)**2;if(d<distance){distance=d;selected=i;}}
        if(selected<0)return 0;
        const p=this.particles[selected];
        this.releaseParticle(p,selected,{...this.releaseOptions,headVelocity:options.headVelocity??this.headVelocity,supportLoss},this.exitSpeed);
        emitted=true;return p.volume;
      };
      while(this.leakCredit>=this.particleVolume-1e-12){
        const volume=releaseClosest(false);if(!volume)break;
        this.orificeReleased+=volume;
        this.leakCredit=Math.max(0,this.leakCredit-this.particleVolume);emitted=true;
      }
      const beforeCapacity=previous.containmentCapacity,afterCapacity=current.containmentCapacity;
      const capacity=options.capacityMode==='step'?afterCapacity:
        Number.isFinite(beforeCapacity)&&Number.isFinite(afterCapacity)?lerp(beforeCapacity,afterCapacity,t):t>=1?afterCapacity:Infinity;
      // Isoperimetric capacity loss is separate from hydraulic discharge. Release
      // whole nearby parcels until below the bound (undershoot < one parcel).
      while(this.retainedVolume>capacity+1e-12){
        const volume=releaseClosest(true);if(!volume)break;
        this.supportLossReleased+=volume;this.capacityReleased+=volume;this.leakDischarged+=volume;
      }
      // The isoperimetric volume bound above cannot establish a vessel. Check
      // actual attached skin after nominal cap transport and again whenever a
      // discharge repacks it. Each nonempty pass releases at least one parcel,
      // so this loop is bounded by count+1 and never moves a newly free parcel.
      const support=options.membraneSupport;
      let recheck=true;
      while(recheck){
        if(emitted){this.surfaceFrame=containedWaterFrame(slosh,time,this.retainedVolume/(HEAD_FULL_VOLUME*this.scale**3));this.placeContained(FIXED_STEP,true);emitted=false;}
        recheck=false;
        if(support)for(let i=0;i<this.particles.length;i++){
          const p=this.particles[i];if(p.free||support.contains(p))continue;
          this.releaseParticle(p,i,{...this.releaseOptions,headVelocity:options.headVelocity??this.headVelocity,supportLoss:true},0);
          this.supportLossReleased+=p.volume;this.geometryReleased+=p.volume;this.leakDischarged+=p.volume;
          emitted=true;recheck=true;
        }
      }
      if(this.retainedVolume===0&&this.leakCredit>0){this.leakDischarged-=this.leakCredit;this.leakCredit=0;}
      this.step(FIXED_STEP,options.solidColliders?{...options,solidTimeFrom:clamp((tickTime-FIXED_STEP)/dt,0,1),solidTimeTo:clamp(tickTime/dt,0,1)}:options);
      this.elapsed+=FIXED_STEP;this.leakSteps++;this.leakAccumulator=Math.max(0,this.leakAccumulator-FIXED_STEP);tickTime+=FIXED_STEP;
    }
    this.leakInput=current;
  }
  integrate(dt,options={}){
    if(!this.released||this.leaking||!Number.isFinite(dt)||dt<=0)return;
    // Consume all caller time in bounded steps. A slower caller must not silently
    // simulate less time or change the number of density corrections per second.
    const steps=Math.ceil(dt*120-1e-10),step=dt/steps;
    for(let i=0;i<steps;i++)this.step(step,options.solidColliders?{...options,solidTimeFrom:i/steps,solidTimeTo:(i+1)/steps}:options);
    this.elapsed+=dt;
  }
  step(dt,{floor=TABLE_TOP,bounds=3.7,viscosity=.25,solidColliders=null,solidTimeFrom=0,solidTimeTo=1}={}){
    const p=this.leaking?this.releasedParticles:this.particles,n=p.length,cellSize=.135,inv=1/cellSize;
    const grid=this.neighborGrid,coordinates=this.cellCoordinates,buckets=this.neighborBuckets;
    grid.clear();let bucketCount=0;const air=Math.exp(-.07*dt);
    // Semi-implicit predictor; positions are advanced exactly once.
    for(let i=0;i<n;i++){
      const a=p[i];
      if(solidColliders?.length){this.previousPositions[i*3]=a.x;this.previousPositions[i*3+1]=a.y;this.previousPositions[i*3+2]=a.z;}
      a.vy-=9.81*dt;
      a.vx*=air;a.vy*=air;a.vz*=air;
      a.x+=a.vx*dt;a.y+=a.vy*dt;a.z+=a.vz*dt;
      const gx=Math.floor(a.x*inv),gy=Math.floor(a.y*inv),gz=Math.floor(a.z*inv),key=cellKey(gx,gy,gz);
      coordinates[i*3]=gx;coordinates[i*3+1]=gy;coordinates[i*3+2]=gz;
      let group=grid.get(key);
      if(!group){group=buckets[bucketCount]??(buckets[bucketCount]=[]);group.length=0;bucketCount++;grid.set(key,group);}
      group.push(i);
    }
    // Predict density and compute symmetric pairwise corrections; no volume deletion.
    const [dx,dy,dz,vx,vy,vz]=this.corrections;
    for(const buffer of this.corrections)buffer.fill(0);
    const smoothing=.128,desired=.071;
    for(let i=0;i<n;i++){
      const a=p[i],gx=coordinates[i*3],gy=coordinates[i*3+1],gz=coordinates[i*3+2];
      for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++)for(let oz=-1;oz<=1;oz++){
        const group=grid.get(cellKey(gx+ox,gy+oy,gz+oz));if(!group)continue;
        for(const j of group){if(j<=i)continue;
          const b=p[j];let xx=b.x-a.x,yy=b.y-a.y,zz=b.z-a.z;
          let d=Math.hypot(xx,yy,zz);
          if(d>=smoothing)continue;
          if(d<.00005){xx=.00005;d=.00005;}
          const q=1-d/smoothing,repulsion=Math.max(0,desired-d)*.28;
          // Preserve cohesion for physically connected splash streams. Pairwise and symmetric.
          const attraction=d>desired?Math.min(.0014,q*q*.004):0;
          const corr=clamp(repulsion-attraction,-.0015,.018)/d;
          dx[i]-=xx*corr;dy[i]-=yy*corr;dz[i]-=zz*corr;
          dx[j]+=xx*corr;dy[j]+=yy*corr;dz[j]+=zz*corr;
          const mix=q*q*viscosity*.055;
          const cvx=(b.vx-a.vx)*mix,cvy=(b.vy-a.vy)*mix,cvz=(b.vz-a.vz)*mix;
          vx[i]+=cvx;vy[i]+=cvy;vz[i]+=cvz;
          vx[j]-=cvx;vy[j]-=cvy;vz[j]-=cvz;
        }
      }
    }
    this.wetCount=0;
    for(let i=0;i<n;i++){
      const a=p[i];
      const x=dx[i],y=dy[i],z=dz[i];
      a.x+=x;a.y+=y;a.z+=z;
      a.vx+=x/Math.max(dt,.004)*.5+vx[i];
      a.vy+=y/Math.max(dt,.004)*.5+vy[i];
      a.vz+=z/Math.max(dt,.004)*.5+vz[i];
      const contactRadius=waterDropRadius(a.volume);
      if(solidColliders?.length)resolveLiquidSolid(a,{x:this.previousPositions[i*3],y:this.previousPositions[i*3+1],z:this.previousPositions[i*3+2]},contactRadius,dt,solidColliders,{timeFrom:solidTimeFrom,timeTo:solidTimeTo});
      if(a.y<floor+contactRadius){
        a.y=floor+contactRadius;
        if(a.vy<0)a.vy=-a.vy*.10;
        a.vx*=Math.exp(-7.5*dt);a.vz*=Math.exp(-7.5*dt);
        a.wet=true;
      }
      if(Math.abs(a.x)>bounds-contactRadius){a.x=Math.sign(a.x)*(bounds-contactRadius);a.vx*=-.22;}
      if(Math.abs(a.z)>1.31-contactRadius){a.z=Math.sign(a.z)*(1.31-contactRadius);a.vz*=-.18;}
      if(a.wet)this.wetCount++;
      a.age+=dt;
      // Clamp runaway energy after any degenerate collision.
      a.vx=clamp(a.vx,-14,14);a.vy=clamp(a.vy,-14,14);a.vz=clamp(a.vz,-14,14);
    }
  }
  stats(){
    const volume=this.volume;
    return {particleCount:this.particles.length,volume,mass:volume*WATER_DENSITY,
      volumeError:volume-this.initialVolume,wet:this.wetCount,
      momentum:this.particles.reduce((m,p)=>({x:m.x+p.vx*p.volume*WATER_DENSITY,y:m.y+p.vy*p.volume*WATER_DENSITY,z:m.z+p.vz*p.volume*WATER_DENSITY}),{x:0,y:0,z:0})};
  }
}
