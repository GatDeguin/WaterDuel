/** Local equipment +Y follows the root tangent; all bend data comes from the physical pose. */
export function equipmentFlex(fighter,id){
  const flex=['sword','spear'].includes(id)?fighter.pose?.weaponFlex:null;
  return {flexOffset:Number.isFinite(flex?.offset)?flex.offset:0,flexLength:Number.isFinite(flex?.length)&&flex.length>0?flex.length:0,flexDirection:fighter.dir<0?-1:1};
}

export function equipmentRootTip(fighter,id){
  const p=fighter.pose,root=p.weaponRootDirection,flex=equipmentFlex(fighter,id);
  if(flex.flexLength&&root&&[root.x,root.y,root.z??0].every(Number.isFinite))return {x:p.mainHand.x+root.x,y:p.mainHand.y+root.y,z:(p.mainHand.z??.17)+(root.z??0)};
  return p.tip;
}

/** Extension is applied by the caller first. Negative grip/guard points remain rigid. */
export function bendEquipmentPoint(position,{flexOffset=0,flexLength=0,flexDirection=1}={}){
  const [x,y,z]=position;
  if(y<=0||!flexLength||Math.abs(flexOffset)<1e-10)return [x,y,z];
  const theta=2*flexOffset/flexLength,s=y/flexLength,a=theta*s,dir=flexDirection<0?-1:1;
  const sn=Math.sin(a),cs=Math.cos(a),cx=Math.abs(a)<1e-5?-dir*y*(a/2-a*a*a/24):-dir*flexLength*(1-cs)/theta;
  const cy=Math.abs(a)<1e-5?y*(1-a*a/6+a**4/120):flexLength*sn/theta;
  return [cx+x*cs,cy+dir*x*sn,z];
}

export const HANDLE_RADII=Object.freeze({sword:.045,spear:.039,axe:.048,maul:.054,knife:.038});
