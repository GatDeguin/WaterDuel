import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ArticulatedRig,REFERENCE_STANCE} from '../../public/physics/articulated-rig.js';
import {FOOT_SHAPES} from '../../public/physics/foot-geometry.js';
import {getWeapon} from '../../public/equipment.js';

const physicsURL=new URL('../../public/physics/articulated-rig.js',import.meta.url);
export const PUBLISHED_N14_SHA='b18375efac5b262551ef2f8efe36ad37c2fb2769f83601aee175d20c8630f92e';
export async function importRigText(source){
  const portable=source.replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_match,prefix,quote,specifier)=>prefix+quote+new URL(specifier,physicsURL).href+quote);
  return import('data:text/javascript;base64,'+Buffer.from(portable).toString('base64'));
}
export async function publishedN14(){
  const bytes=await fs.readFile(new URL('./articulated-rig-pre-character-v4-1.12.js.txt',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),PUBLISHED_N14_SHA,'published N14 source bytes must remain frozen');
  const {ArticulatedRig:Rig}=await importRigText(bytes.toString('utf8'));
  assert.equal(new Rig().q.length,14,'the historical oracle is explicitly N14');return Rig;
}

/** Native N16 inputs, never a N14 state copied over a new constructor. All
 * existing coordinate positions remain legal; both new ankles actually move. */
export function* nativeN16Fixtures(){
  for(const dir of [-1,1])for(const size of [1,1.18])for(const weapon of ['sword','spear','axe','maul']){
    const rig=new ArticulatedRig({dir,scale:size,gravity:0}),w=getWeapon({weapon});
    rig.equipment={weapon,defense:w.twoHanded?'none':'knife'};rig.twoHanded=w.twoHanded;rig.gripOffset=w.gripOffset??0;
    rig.defenseLength=w.twoHanded?0:.42;rig.defenseRestAngle=.31;
    rig.swordLength=1.69;rig.previousSwordLength=1.03;rig.neckLateral.angle=.17;
    rig.depth.offHand=.045;rig.depth.offElbow=-.031;rig.waterLoad={mass:.9,offset:{x:.03,y:-.06},inertia:.05,lateralInertia:0,lateralOffset:0};
    rig.previousQ=rig.q.slice();
    for(let i=0;i<rig.q.length;i++){
      const [min,max]=rig.limits[i];
      rig.previousQ[i]=Math.max(min,Math.min(max,rig.q[i]+.17*Math.sin(i*1.7+dir)));
      rig.q[i]=Math.max(min,Math.min(max,rig.q[i]+.21*Math.cos(i*1.3-size)));
      rig.velocity[i]=.2*Math.cos(i+.1*dir);
    }
    assert.equal(rig.q.length,16);assert.notEqual(rig.q[14],rig.previousQ[14]);assert.notEqual(rig.q[15],rig.previousQ[15]);yield rig;
  }
}

export function withInterpolatedPose(rig,t,inspect){
  const original=rig.q.slice(),length=rig.swordLength;
  try{
    rig.q.set(original.map((value,i)=>rig.previousQ[i]*(1-t)+value*t));
    rig.swordLength=rig.previousSwordLength*(1-t)+length*t;
    return inspect(rig.pose());
  }finally{rig.q.set(original);rig.swordLength=length;}
}

/** Rectangular OBB basis is the first two axes. A convex foot also exposes SAT
 * edge normals; those are not extra OBB dimensions. Project the actual vertices
 * rather than substituting nominal segment length/width. */
export function projectedSolid(panel){
  assert.ok(panel.axes.length>=2);const axes=panel.axes.slice(0,2);
  return {body:panel.body,key:panel.key,...(panel.material?{material:panel.material}:{}),center:{...panel.center,z:panel.z},
    axes:[...axes.map(axis=>({...axis,z:0})),{x:0,y:0,z:1}],
    half:[...axes.map(axis=>Math.max(...panel.vertices.map(p=>Math.abs((p.x-panel.center.x)*axis.x+(p.y-panel.center.y)*axis.y)))),panel.depth/2]};
}

// Bounds for independent geometric arithmetic, not a physics-equivalence
// tolerance: <64 roundoffs for chained sin/cos, rotations and projections.
export function geometryNear(actual,expected,label){
  const tolerance=64*Number.EPSILON*Math.max(1,Math.abs(actual),Math.abs(expected));
  assert.ok(Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<=tolerance,`${label}: ${actual} != ${expected} (roundoff budget ${tolerance})`);
}
export function assertSolidNear(actual,expected,label){
  assert.equal(actual.body,expected.body,label+'/body');assert.equal(actual.key,expected.key,label+'/key');
  assert.equal(actual.axes.length,3,label+'/three dimensional OBB');assert.equal(actual.half.length,3,label+'/three half extents');
  for(const key of ['x','y','z'])geometryNear(actual.center[key],expected.center[key],label+'/center '+key);
  for(let i=0;i<3;i++){
    geometryNear(actual.half[i],expected.half[i],label+'/half '+i);
    for(const key of ['x','y','z'])geometryNear(actual.axes[i][key],expected.axes[i][key],label+'/axis '+i+'/'+key);
  }
}

/** Foot geometry from the public coordinate contract and measured local hull,
 * without asking either collision producer for positions, axes or endpoints. */
export function footHullReference(rig,side){
  const front=side==='front',hi=front?8:10,ki=hi+1,ai=front?14:15,q=rig.q,s=rig.scale,dir=rig.dir;
  const advance=(p,x,y,a)=>({x:p.x+dir*(x*Math.cos(a)-y*Math.sin(a)),y:p.y+x*Math.sin(a)+y*Math.cos(a)});
  const hip=advance({x:q[0],y:q[1]},(front?1:-1)*REFERENCE_STANCE.hipSocket*s,0,q[2]);
  const knee=advance(hip,REFERENCE_STANCE.thigh*s,0,q[2]+q[hi]);
  const ankle=advance(knee,REFERENCE_STANCE.shin*s,0,q[2]+q[hi]+q[ki]);
  const angle=q[2]+q[hi]+q[ki]+Math.PI/2+q[ai],shape=FOOT_SHAPES[s>1.1?'boss':'normal'][side];
  const z=rig.depth[front?'ankleF':'ankleB']+dir*(shape.minZ+shape.maxZ)/2*s;
  return shape.hull.map(([x,y])=>({...advance(ankle,x*s,y*s,angle),z}));
}

/** Centered differences of a material point, not the runtime's pointVelocity.
 * Compare H and H/2 to expose truncation, and budget subtraction roundoff from
 * the actual world-coordinate magnitude. No solver/J tables are imported. */
export function materialVelocityReference(rig,body,point){
  const frameName=body==='water'?'neck':body,original=rig.q.slice(),base=rig.pose().bodyFrames[frameName];
  assert.ok(base,'attached material body has a frame');
  const offset={x:point.x-base.center.x,y:point.y-base.center.y};
  const located=()=>{
    const frame=rig.pose().bodyFrames[frameName],angle=frame.angle-base.angle,c=Math.cos(angle),s=Math.sin(angle);
    return {x:frame.center.x+c*offset.x-s*offset.y,y:frame.center.y+s*offset.x+c*offset.y};
  };
  const differentiate=h=>{
    for(let i=0;i<original.length;i++)rig.q[i]=original[i]+h*rig.velocity[i];const plus=located();
    for(let i=0;i<original.length;i++)rig.q[i]=original[i]-h*rig.velocity[i];const minus=located();rig.q.set(original);
    return {x:(plus.x-minus.x)/(2*h),y:(plus.y-minus.y)/(2*h),magnitude:Math.max(1,Math.abs(plus.x),Math.abs(plus.y),Math.abs(minus.x),Math.abs(minus.y))};
  };
  try{
    const h=2e-6,a=differentiate(h),b=differentiate(h/2),roundoff=64*Number.EPSILON*Math.max(a.magnitude,b.magnitude)/(h/2);
    return {x:b.x,y:b.y,error:{x:4*Math.abs(a.x-b.x)+roundoff,y:4*Math.abs(a.y-b.y)+roundoff}};
  }finally{rig.q.set(original);}
}
export function assertMaterialVelocity(actual,reference,label){
  for(const [key,alias]of [['x','vx'],['y','vy']]){
    const value=actual[key]??actual[alias];
    assert.ok(Number.isFinite(value)&&Math.abs(value-reference[key])<=reference.error[key],`${label}/${key}: ${value} != FD ${reference[key]} (estimated error ${reference.error[key]})`);
  }
}
