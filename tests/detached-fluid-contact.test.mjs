import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ArticulatedRig,RIG_STEP} from '../public/physics/articulated-rig.js';
import {FluidVolume} from '../public/physics/fluid.js';
import {fluidSolidColliders,resolveLiquidSolid} from '../public/physics/fluid-solids.js';
import {TABLE_TOP,waterDropRadius} from '../public/physics/dimensions.js';
import {getDefense} from '../public/equipment.js';

function digest(value){
  const hash=createHash('sha256');
  const visit=v=>{
    if(typeof v==='number'){hash.update('n');const b=Buffer.alloc(8);b.writeDoubleLE(v);hash.update(b);}
    else if(typeof v==='string'){hash.update('s');const b=Buffer.from(v,'utf16le');visit(b.length);hash.update(b);}
    else if(v===null)hash.update('null');else if(v===undefined)hash.update('undefined');
    else if(typeof v==='boolean')hash.update(v?'true':'false');
    else{hash.update(Array.isArray(v)?'array':'object');const entries=Object.entries(v);visit(entries.length);for(const [k,item]of entries){visit(k);visit(item);}}
  };
  visit(value);return hash.digest('hex');
}
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-12,`${message}: ${a} versus ${b}`);
function shieldRig(defense,dir,scale,guard){
  const rig=new ArticulatedRig({dir,scale}),d=getDefense(defense),p=rig.pose();
  p.equipment={weapon:'sword',defense};p.shieldRadiusX=guard?d.guardRadiusX:d.radiusX;p.shieldRadiusY=guard?d.guardRadiusY:d.radiusY;
  p.defenseDepthTarget=guard?.10:-.08;rig.setIntent(p);
  rig.defenseDepth.position=p.defenseDepthTarget;rig.depth.offHand=p.defenseDepthTarget;
  return rig;
}
const fragmentCollider=(rig,fragment,key)=>fluidSolidColliders([{rig}]).find(c=>c.fragmentId===fragment.id&&c.key===key);
function separated(point,solid,radius){
  return solid.axes.some((axis,i)=>Math.abs((point.x-solid.center.x)*axis.x+(point.y-solid.center.y)*axis.y+(point.z-solid.center.z)*(axis.z??0))>solid.half[i]+radius);
}

test('intact liquid colliders retain the original IEEE values, ordering, CCD samples and surface velocities',()=>{
  // Captured before the detached-water change from fluid-solids SHA256
  // 8f86d2f5ba787f4d0d4f47a96e21dba716a625f85f40e04357bc3e22c0822f33.
  const states=[];
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const weapon of ['sword','spear','axe','maul']){
    const rig=new ArticulatedRig({dir,scale});rig.equipment={weapon,defense:weapon==='maul'?'none':'short'};rig.twoHanded=weapon==='maul';rig.gripOffset=rig.twoHanded?.22:0;
    rig.swordLength=1.69;rig.previousSwordLength=1.03;rig.previousQ=rig.q.slice();
    for(let i=0;i<rig.q.length;i++){rig.q[i]=Math.max(rig.limits[i][0],Math.min(rig.limits[i][1],rig.q[i]+.13*Math.sin(i+2)));rig.velocity[i]=.2*Math.cos(i);}
    states.push(fluidSolidColliders([{rig}]).map(c=>({body:c.body,key:c.key,center:c.center,axes:c.axes,half:c.half,bounds:c.bounds,motion:c.motion,
      samples:[0,.13,.5,.88,1].map(t=>c.motionAt(t)),velocities:[c.center,{x:c.center.x+.13,y:c.center.y-.19,z:c.center.z}].map(p=>c.velocityAt(p))})));
  }
  assert.equal(digest(states),'72e3ee2b19323642f0d14abc76206378ed8bc922fa0ee4941ebeed3144e65179');
});

test('short and long severed shields retain their exact pose envelope, depth, floor corners and original mass',()=>{
  for(const defense of ['short','long'])for(const joint of ['offShoulder','offElbow'])for(const dir of [-1,1])for(const scale of [1,1.18])for(const guard of [false,true]){
    const rig=shieldRig(defense,dir,scale,guard),pose=rig.pose(),mass=rig.diagnostics().bodies.reduce((s,b)=>s+b.mass,0);
    rig.damageJoint(joint,1);const f=rig.fragments[0],panel=f.collisionPanels().find(p=>p.key==='detached-shield');
    assert.ok(panel,`${defense} ${joint} ${dir} ${scale} guard ${guard}`);assert.equal(panel.body,'offForearm');
    near(panel.center.x,pose.offHand.x,'shield pivot x');near(panel.center.y,pose.offHand.y,'shield pivot y');
    near(panel.minX,pose.offHand.x-pose.shieldRadiusX,'left rim');near(panel.maxX,pose.offHand.x+pose.shieldRadiusX,'right rim');
    near(panel.minY,pose.offHand.y-pose.shieldRadiusY,'bottom rim');near(panel.maxY,pose.offHand.y+pose.shieldRadiusY,'top rim');
    near(panel.z-panel.depth/2,pose.shieldDepth.min,'near depth');near(panel.z+panel.depth/2,pose.shieldDepth.max,'far depth');
    near(f.mass+rig.diagnostics().bodies.reduce((s,b)=>s+b.mass,0),mass,'no extra shield mass at fracture');
    const vertices=f.worldVertices();
    for(const p of panel.vertices)for(const z of [pose.shieldDepth.min,pose.shieldDepth.max])
      assert.ok(vertices.some(v=>Math.abs(v.x-p.x)<1e-12&&Math.abs(v.y-p.y)<1e-12&&Math.abs(v.z-z)<1e-12),'every extruded rim corner participates in the floor');
    f.vx=.3;f.vy=-.4;f.omega=.7*dir;
    for(let i=0;i<240;i++)f.step(RIG_STEP);
    assert.ok(f.floorContacts>0);assert.ok(f.worldVertices().every(p=>p.y>=TABLE_TOP-1e-7));
    for(const p of f.collisionPanels().find(p=>p.key==='detached-shield').vertices)assert.ok(p.y>=TABLE_TOP-1e-7,'shield rim cannot sink through table');
    assert.ok([f.x,f.y,f.angle,f.vx,f.vy,f.omega,...f.transform()].every(Number.isFinite));
  }
});

test('a severed shield stops a fast real liquid parcel and preserves its inventory without feedback impulse',()=>{
  for(const defense of ['short','long'])for(const dir of [-1,1])for(const scale of [1,1.18]){
    const rig=shieldRig(defense,dir,scale,true);rig.damageJoint('offElbow',1);const f=rig.fragments[0],solid=fragmentCollider(rig,f,'detached-shield');
    assert.ok(solid,'the detached shield must reach the water collision stream');
    const fluid=new FluidVolume(1,1,.03),head={x:0,y:2,z:0};fluid.keepContained(head,RIG_STEP);fluid.release({head,impact:head,attackDir:dir});
    const parcel=fluid.particles[0],radius=waterDropRadius(parcel.volume),top=solid.center.y+solid.half[1];
    Object.assign(parcel,{x:solid.center.x,y:top+radius+.04,z:solid.center.z,vx:0,vy:-14,vz:0});
    const before={mass:f.mass,vx:f.vx,vy:f.vy,omega:f.omega,volume:fluid.volume};
    fluid.integrate(RIG_STEP,{floor:TABLE_TOP,solidColliders:[solid]});
    assert.ok(parcel.y>=top+radius-1e-7);assert.ok(parcel.vy>=0);assert.equal(fluid.count,1);assert.equal(fluid.volume,before.volume);
    assert.deepEqual({mass:f.mass,vx:f.vx,vy:f.vy,omega:f.omega},{mass:before.mass,vx:before.vx,vy:before.vy,omega:before.omega});
  }
});

test('detached rotating steel contacts stationary water between separated endpoints, while a depth miss remains free',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18]){
    const rig=new ArticulatedRig({dir,scale,gravity:0});rig.equipment={weapon:'spear',defense:'none'};rig.swordLength=1.69;
    rig.damageJoint('wrist',1);const f=rig.fragments[0],p=f.collisionPanels().find(p=>p.key==='weapon');
    const half=Math.max(...p.vertices.map(v=>(v.x-p.center.x)*p.axes[0].x+(v.y-p.center.y)*p.axes[0].y));
    const at={x:p.center.x+p.axes[0].x*half*.85,y:p.center.y+p.axes[0].y*half*.85,z:p.z},radius=.002;
    f.previous={x:f.x,y:f.y,angle:-dir*.11};f.angle=dir*.11;f.omega=dir*.22/RIG_STEP;
    const solid=fragmentCollider(rig,f,'weapon');assert.ok(solid);
    assert.ok(separated(at,solid.motionAt(0),radius));assert.ok(separated(at,solid.motionAt(1),radius));assert.equal(separated(at,solid.motionAt(.5),radius),false);
    const parcel={...at,vx:0,vy:0,vz:0,volume:1e-7},before={...parcel},motion={x:f.x,y:f.y,vx:f.vx,vy:f.vy,omega:f.omega};
    resolveLiquidSolid(parcel,at,radius,RIG_STEP,[solid]);
    assert.ok(Math.hypot(parcel.x-before.x,parcel.y-before.y)>1e-5||Math.hypot(parcel.vx,parcel.vy)>1e-5,'continuous rigid sweep reaches water');assert.equal(parcel.volume,before.volume);
    assert.deepEqual({x:f.x,y:f.y,vx:f.vx,vy:f.vy,omega:f.omega},motion,'one-way water response must not apply a second body impulse');
    const miss={...at,z:solid.center.z+solid.half[2]+radius+.01,vx:0,vy:0,vz:0,volume:1e-7},free={...miss};
    resolveLiquidSolid(miss,{...miss},radius,RIG_STEP,[solid]);assert.deepEqual(miss,free);
  }
});

test('a translating detached blade crosses a parcel with clear start and exit poses',()=>{
  const rig=new ArticulatedRig({gravity:0});rig.damageJoint('wrist',1);const f=rig.fragments[0],p=f.collisionPanels().find(p=>p.key==='weapon'),n=p.axes[1];
  const at={...p.center,z:p.z},radius=.002;f.previous={x:f.x-n.x*.2,y:f.y-n.y*.2,angle:0};f.x+=n.x*.2;f.y+=n.y*.2;f.vx=n.x*.4/RIG_STEP;f.vy=n.y*.4/RIG_STEP;
  const solid=fragmentCollider(rig,f,'weapon');assert.ok(solid);assert.ok(separated(at,solid.motionAt(0),radius));assert.ok(separated(at,solid.motionAt(1),radius));
  const parcel={...at,vx:0,vy:0,vz:0,volume:1e-7};resolveLiquidSolid(parcel,at,radius,RIG_STEP,[solid]);
  assert.ok(parcel.vx*n.x+parcel.vy*n.y>0,'moving surface transmits its real velocity');assert.equal(parcel.volume,1e-7);
});

test('detached swept bounds contain rigid arcs and retained samples survive subsequent CCD queries',()=>{
  for(const dir of [-1,1])for(const scale of [1,1.18])for(const joint of ['mainShoulder','offElbow']){
    const rig=shieldRig('long',dir,scale,true);rig.damageJoint(joint,1);const f=rig.fragments[0];
    f.previous={x:f.x-.15,y:f.y+.08,angle:-1.2};f.x+=.1;f.y+=.12;f.angle=1.4;
    const all=fluidSolidColliders([{rig}]),parentCount=rig.collisionPanels().length,solids=all.filter(c=>c.fragmentId===f.id);
    assert.equal(solids.length,f.collisionPanels().length);assert.ok(all.slice(0,parentCount).every(c=>c.fragmentId===undefined),'original parent order precedes new fragments');
    for(const c of solids){
      const retained=[c.motionAt(0),c.motionAt(.5),c.motionAt(1)],snap=structuredClone(retained);
      for(let i=0;i<=64;i++){
        const p=f.collisionPanelsAt(i/64).find(p=>p.key===c.key),sample=c.motionAt(i/64);
        near(sample.center.x,p.center.x,'CCD center x');near(sample.center.y,p.center.y,'CCD center y');
        for(const v of p.vertices)for(const key of ['x','y'])assert.ok(v[key]>=c.bounds.min[key]-1e-10&&v[key]<=c.bounds.max[key]+1e-10,`${joint} ${c.key} ${key} at ${i}/64`);
        assert.ok(p.z-p.depth/2>=c.bounds.min.z-1e-10&&p.z+p.depth/2<=c.bounds.max.z+1e-10);
      }
      assert.deepEqual(retained,snap,'scratch samples must not overwrite endpoint or DFS values');
    }
  }
});
