// The physical topology is authoritative. Replay/visual views have no solver;
// their owned joint records describe the same connected chains.
const chains={weapon:['mainShoulder','mainElbow','wrist'],offForearm:['offShoulder','offElbow'],
  frontShin:['frontHip','frontKnee'],backShin:['backHip','backKnee']};
export function bodyAttached(fighter,body){
  if(fighter?.rig?.isBodyAttached)return fighter.rig.isBodyAttached(body);
  return !(chains[body]??[]).some(name=>fighter?.pose?.joints?.[name]?.detached);
}
export function walkingStrength(fighter){
  if(!bodyAttached(fighter,'frontShin')||!bodyAttached(fighter,'backShin'))return 0;
  const joints=fighter?.pose?.joints;
  return Math.min(...['frontHip','frontKnee','backHip','backKnee'].map(name=>1-.65*(joints?.[name]?.damage??0)));
}

// A released blade remains a physical hazard. Its old connected pose is never
// used as an attack, and controls cannot move this independent compound.
export function weaponActor(fighter){
  if(!fighter)return null;
  if(bodyAttached(fighter,'weapon'))return fighter;
  const fragment=fighter.rig?.fragments?.find(f=>f.bodyNames.includes('weapon'));
  if(!fragment)return null;
  const source=fragment.sourcePose,hand=fragment.worldPointAt(source.mainHand,1),tip=fragment.worldPointAt(source.tip,1);
  const beforeHand=fragment.worldPointAt(source.mainHand,0),previousTip=fragment.worldPointAt(source.tip,0);
  const dx=previousTip.x-beforeHand.x,dy=previousTip.y-beforeHand.y,length=Math.hypot(dx,dy)||1;
  return {...fighter,detachedAttack:true,rig:fragment,lunge:0,
    pose:{...source,mainHand:hand,tip},previousTip,previousWeaponDirection:{x:dx/length,y:dy/length}};
}
