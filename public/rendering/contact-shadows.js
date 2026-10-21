import {TABLE_TOP} from '../physics/dimensions.js';
import {bodyAttached} from '../physics/limb-state.js';
import {nearFloorContactPoints} from '../physics/contact-points.js';
import {assertFragmentTransform} from './joint-damage.js';

// Local ambient contact approximation on the stage, complementing the direct
// light's real shadow map. These are translucent decals, never opaque water or
// latex casters. Every centre projects an actual sole or rigid support vertex.
const FOOT_HALF_HEIGHT=.075;
function visibleFragmentPoints(fragment){
 if(fragment.opaque===false||['water','latex'].includes(fragment.material))return [];
 if(typeof fragment.worldVertices==='function')return fragment.worldVertices();
 if(!Array.isArray(fragment.contactVertices))return [];
 const current=fragment.transform,captured=fragment.contactTransform??current;
 try{assertFragmentTransform(current);assertFragmentTransform(captured);}catch{return [];}
 return fragment.contactVertices.map(p=>{
  // Inverse of the captured rigid XY transform, followed by the interpolated
  // visible transform. Replays keep both equal; presentation changes only one.
  const dx=p.x-captured[12],dy=p.y-captured[13],x=captured[0]*dx+captured[1]*dy,y=captured[4]*dx+captured[5]*dy;
  return {x:current[0]*x+current[4]*y+current[12],y:current[1]*x+current[5]*y+current[13],z:(p.z??0)+current[14]-captured[14]};
 });
}

export function contactShadows(fighter,{floor=TABLE_TOP,maxGap=.12,fragments=null}={}){
 if(!Number.isFinite(floor))throw new RangeError('contact floor must be finite');
 if(!Number.isFinite(maxGap)||maxGap<=0)throw new RangeError('contact gap must be positive');
 const stamps=[],pose=fighter?.pose??{},scale=fighter?.rig?.scale??(fighter?.boss?1.18:1);
 const stamp=(id,kind,p,rx,rz,alpha)=>{
  if(!p||![p.x,p.y,p.z??0].every(Number.isFinite))return;
  const gap=Math.max(0,p.y-floor);if(gap>=maxGap)return;
  const fade=1-gap/maxGap,spread=gap*.35;
  stamps.push({id,kind,x:p.x,y:floor+.0008,z:p.z??0,gap,radiusX:rx+spread,radiusZ:rz+spread,opacity:alpha*fade*fade});
 };
 for(const [key,body]of [['footF','frontShin'],['footB','backShin']]){
  if(bodyAttached(fighter,body)&&!(pose.detached??[]).some(f=>f.bodies?.includes(body))&&pose[key])
   stamp(key,'foot',{...pose[key],y:pose[key].y-FOOT_HALF_HEIGHT},.13*scale,.10*scale,.23);
 }
 const parts=fragments??pose.detached??fighter?.rig?.fragments??[];
 for(const fragment of parts){
  const points=nearFloorContactPoints(visibleFragmentPoints(fragment),{floor,maxGap});
  for(let i=0;i<points.length;i++){
   const p=points[i],radius=.035+Math.max(0,p.y-floor)*.35;
   // Tessellation must not turn coincident support patches into a dark blob.
   const overlaps=points.filter(q=>(p.x-q.x)**2+(p.z-q.z)**2<4*radius*radius).length;
   stamp(`${fragment.id??'fragment'}:${i}`,'fragment',p,.035,.035,.13/Math.max(1,overlaps));
  }
 }
 return stamps;
}
