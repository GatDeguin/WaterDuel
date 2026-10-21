// Liquid reads severed rigid compounds through the same OBB contact contract.
// No fluid impulse is fed back into the compound, matching attached solids.
// Geometry conversion/broadphase callbacks stay owned by fluid-solids.js.
export function createDetachedFluidColliders(fragment,{panelSolid,sweptBounds}){
  const current=fragment.collisionPanelsAt(1),previous=fragment.collisionPanelsAt(0);
  const translation={x:fragment.x-fragment.previous.x,y:fragment.y-fragment.previous.y,z:0};
  const angleRate=Math.abs(fragment.angle-fragment.previous.angle),origin=fragment.initialCenter;
  const vx=fragment.vx,vy=fragment.vy,omega=fragment.omega,center={x:fragment.x,y:fragment.y};
  return current.map((panel,index)=>{
    const solid=panelSolid(panel),first=panelSolid(previous[index]),samples=new Map();
    // A rigid panel centre is COM translation plus a fixed rotating offset.
    // |c'| <= |translation| + radius*|angle|; every corner has acceleration
    // <= (radius+cornerRadius)*angle² over normalized whole-STEP time. The
    // shared sweptBounds therefore bounds its endpoint-chord error by /8.
    const source=fragment.panels[index].center,radius=Math.hypot(source.x-origin.x,source.y-origin.y),angularBound=radius*angleRate;
    const motion={centerBound:Math.hypot(translation.x,translation.y)+angularBound,angleRate,halfBound:0,translation,angularBound,centerExtension:0};
    const at=t=>{
      if(t===0)return first;if(t===1)return solid;
      if(samples.has(t)){const value=samples.get(t);samples.delete(t);samples.set(t,value);return value;}
      const value=panelSolid(fragment.collisionPanelsAt(t)[index]);
      if(samples.size>=32)samples.delete(samples.keys().next().value);
      samples.set(t,value);return value;
    };
    return {...solid,body:panel.body,key:panel.key,fragmentId:fragment.id,bounds:sweptBounds(first,solid,motion),motionAt:at,motion,
      velocityAt:point=>({vx:vx-omega*(point.y-center.y),vy:vy+omega*(point.x-center.x),vz:0})};
  });
}
