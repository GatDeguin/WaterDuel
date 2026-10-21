/** Worn hinge clearance, in radians. A dead zone changes motor intention only;
 * contact, inertia, angular stops and gravity keep owning the achieved pose. */
const indices=Object.freeze({pelvis:2,torso:3,mainShoulder:4,mainElbow:5,offShoulder:6,offElbow:7,frontHip:8,frontKnee:9,backHip:10,backKnee:11,neck:12,wrist:13});
export function jointPlayAngle(damage){
  if(!Number.isFinite(damage)||damage<=0)return 0;
  const wear=Math.max(0,Math.min(1,(damage-.08)/.92));
  return .12*wear*wear;
}
export function applyJointPlay(rig){
  if(!rig||rig.passive||!rig.jointDamageVersion)return;
  for(const [name,record] of Object.entries(rig.jointDamage)){
    const i=indices[name];
    if(i===undefined||record.detached||rig.detachedCoordinates?.has(i))continue;
    const play=jointPlayAngle(record.damage)*(i===2||i===3?.35:1),error=rig.target[i]-rig.q[i];
    if(Number.isFinite(error)&&play>0)rig.target[i]=rig.q[i]+Math.sign(error)*Math.max(0,Math.abs(error)-play);
  }
}
