import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';
import {getWeapon} from '../public/equipment.js';
function readiness(depthFraction,balloonSize=1,slot=2){
 const game=new DuelEngine();game.setAIStyle('defender');game.phase='fight';const f=game.fighters[slot-1],weapon=getWeapon(f),hand=f.pose.mainHand,tip=f.pose.tip;
 const length=Math.hypot(tip.x-hand.x,tip.y-hand.y),ux=(tip.x-hand.x)/length,uy=(tip.y-hand.y)/length,pulse=weapon.length+weapon.lungeReach*Math.exp(-STEP*weapon.lungeDecay)+weapon.extension;
 const beyond=.95/Math.hypot(ux/(BALLOON_RADII.x*balloonSize),uy/(BALLOON_RADII.y*balloonSize));
 const head={x:hand.x+ux*(pulse+beyond),y:hand.y+uy*(pulse+beyond),z:(tip.z??.17)+BALLOON_RADII.z*balloonSize*depthFraction};
 f.perception.observe=()=>({head,headVisible:true,headVelocity:{vx:0,vy:0,vz:0},balloonSize,tip:null,tipVisible:false,armed:false,velocity:{vx:0,vy:0,vz:0},equipment:{weapon:'sword',defense:'short'}});
 const pose=structuredClone(f.pose),q=[...f.rig.q];game.updateAI(f,STEP);assert.deepEqual(f.pose,pose);assert.deepEqual([...f.rig.q],q);assert.deepEqual(game.scores,[0,0]);
 return f.ai;
}
test('AI projected readiness rejects an XY-near blade whose observed depth misses the ellipsoid',()=>{
 for(const slot of [1,2])for(const size of [.8,1,1.16])for(const direction of [-1,1]){
  const near=readiness(0,size,slot),far=readiness(direction*.5,size,slot);assert.equal(near.readyToThrust,true);assert.equal(far.readyToThrust,false);assert.ok(far.projectedReach>1);
 }
});
