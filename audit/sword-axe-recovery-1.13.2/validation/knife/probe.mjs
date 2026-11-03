import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileFunction} from 'node:vm';
import assert from 'node:assert/strict';
import {knifeFrame} from '../../../../public/knife-technique.js';
const root=new URL('../../../../',import.meta.url),out=new URL('./',import.meta.url),engineURL=new URL('public/engine.js',root),sha=b=>createHash('sha256').update(b).digest('hex');
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const relocate=(s,url)=>s.replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_m,p,q,path)=>p+q+new URL(path,url).href+q);
const testRaw=await fs.readFile(new URL('feature-cut-knife-defense-integration.test.mjs.txt',import.meta.url),'utf8'),old=await fs.readFile(new URL('tests/fixtures/engine-pre-opening-1.13.1.js.txt',root));
assert.equal(sha(old),'ab55912da7216cdb3e8a5c8c52d5fcf9f68026e6981f3e19c8471b33f7dd9d2d');
const sources=['public/engine.js','public/physics/articulated-rig.js','public/physics/weapon-bind.js','public/knife-technique.js','tests/knife-defense-integration.test.mjs'];
const pins=Object.fromEntries(await Promise.all(sources.map(async path=>[path,sha(await fs.readFile(new URL(path,root)))])));
assert.equal(pins['public/engine.js'],'b06cbb0b67d2bb90985a9d6a56b50a2a19ce1675ff6e070a97ce885690e26da6');
assert.equal(pins['public/physics/articulated-rig.js'],'378248716a14da0a662929e2d04c26c416d334f8863c132eb2c7561e4fc76adb');
assert.equal(pins['public/physics/weapon-bind.js'],'a30c937900e00722f2bac6f9ab74e35ed7d92d9d29e64903486ce3261b30daad');
const modules={old:await import(data(relocate(old.toString(),engineURL))),current:await import(engineURL)};
const recipes=compileFunction(testRaw.slice(testRaw.indexOf('const settled='),testRaw.indexOf('function realParry('))+'return recipes;',[])();
const fn=testRaw.slice(testRaw.indexOf('function realParry('),testRaw.indexOf('function guardPose('));
const segment=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,dz=(b.z??0)-(a.z??0),t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy+((p.z??0)-(a.z??0))*dz)/(dx*dx+dy*dy+dz*dz)));return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t,(p.z??0)-(a.z??0)-dz*t);};
const receipt={pins,baselineEngineSHA:sha(old),testSHA:sha(testRaw),runs:[]};
const variants=process.argv[2]==='feedback-robust'?['feedback-robust:0','feedback-robust:17','feedback-robust:123']:process.argv[2]?.startsWith('feedback')?[process.argv[2]]:['old','current'];
const selectedRecipes=process.argv[2]==='feedback-robust'?recipes.filter(r=>r.slot===1&&r.grip==='reverse'):recipes;
for(const variant of variants)for(const recipe of selectedRecipes){
  const trace=[];let owner,closest={distance:Infinity};const module=modules[variant==='old'?'old':'current'];
  class ObservedEngine extends module.DuelEngine{
    constructor(...args){super(...args);if(variant.startsWith('feedback-robust:'))this.clock=Number(variant.split(':')[1]);}
    start(){super.start();trace.push({stage:'start',bases:this.fighters.map(f=>f.baseX),wrists:this.fighters.map(f=>({offset:f.openingWrist,q:f.rig.q[13],target:f.rig.target[13]}))});}
    update(dt){const oldPhase=this.phase;super.update(dt);if(oldPhase==='countdown'&&this.phase==='fight')trace.push({stage:'after-countdown',poses:this.fighters.map(f=>({head:f.pose.head,hand:f.pose.mainHand,tip:f.pose.tip,offHand:f.pose.offHand,defenseTip:f.pose.defenseTip})),q:this.fighters.map(f=>[...f.rig.q])});
      if(this.phase==='fight'){const d=this.fighters[recipe.slot-1],a=this.fighters[2-recipe.slot],distance=segment(a.pose.tip,d.pose.offHand,d.pose.defenseTip);if(distance<closest.distance)closest={distance,clock:this.clock,attacker:{hand:a.pose.mainHand,tip:a.pose.tip},defender:{head:d.pose.head,hand:d.pose.offHand,tip:d.pose.defenseTip},controls:this.fighters.map(f=>f.controller)};}}
  }
  const aimControl=(game,slot,mainY)=>{
    const a=game.fighters[2-slot],d=game.fighters[slot-1],h=a.pose.mainHand,p=a.pose.tip,frame=knifeFrame(d.pose.offHand,d.pose.defenseTip);
    // The knife is a tilted finite profile, not a 2D disk. Aim at the centre
    // of the actually accessible slice at the attacking blade's own depth.
    const half=frame.length/2,z=(p.z??.17)-frame.center.z,span=.012*Math.abs(frame.w.z);
    const limits=[(z-span)/frame.u.z,(z+span)/frame.u.z].sort((a,b)=>a-b),lo=Math.max(-half,limits[0]),hi=Math.min(half,limits[1]);
    const u=Math.abs(frame.u.z)>1e-9&&lo<=hi?(lo+hi)/2:0,w=(z-u*frame.u.z)/frame.w.z;
    const target={x:frame.center.x+u*frame.u.x+w*frame.w.x,y:frame.center.y+u*frame.u.y+w*frame.w.y};
    const desired=Math.atan2(target.y-h.y,Math.max(.3,a.dir*(target.x-h.x))),actual=Math.atan2(p.y-h.y,a.dir*(p.x-h.x));
    const error=Math.atan2(Math.sin(desired-actual),Math.cos(desired-actual));
    const length=a.rig.swordLength,base=(desired-Math.atan2(.58*mainY,length))/(Math.PI/4);
    const width=.055*Math.sqrt(Math.max(0,1-(u/half)**2)),range=Math.hypot(target.x-h.x,target.y-h.y);
    return {wrist:Math.max(-1,Math.min(1,base+error)),lean:Math.abs(error)<=Math.atan2(width,range)?1:0};
  };
  const aimWrist=(...args)=>aimControl(...args).wrist,aimLean=(...args)=>aimControl(...args).lean;
  let source=fn;
  if(variant==='feedback')source=source.replace('{mainX:1,mainY:aim,wrist,lean:1,thrust:i===thrustTick}','{mainX:1,mainY:aim,wrist:aimWrist(game,slot,aim),lean:1,thrust:i===thrustTick}');
  if((variant==='feedback-aim-first'||variant.startsWith('feedback-robust:'))&&recipe.slot===1&&recipe.grip==='reverse')source=source.replace('{mainX:1,mainY:aim,wrist,lean:1,thrust:i===thrustTick}','{mainX:1,mainY:aim,wrist:aimWrist(game,slot,aim),lean:aimLean(game,slot,aim),thrust:i===thrustTick}');
  const real=compileFunction(source+'return realParry;',['DuelEngine','STEP','assert','aimWrist','aimLean'])(ObservedEngine,module.STEP,assert,aimWrist,aimLean);
  const start=performance.now(),result=real(recipe),checks=result.observed?{
    offWeapon:result.observed.event.bodyB==='offWeapon',positive:result.observed.event.impulse>1e-5,friction:Math.abs(result.observed.event.frictionImpulse)>1e-6,
    opposite:Math.hypot(result.observed.attacker.impulse.x+result.observed.defender.impulse.x,result.observed.attacker.impulse.y+result.observed.defender.impulse.y)<1e-7,
    score:result.observed.score.every(v=>v===0)}:null;
  const record={variant,recipe,elapsedMs:performance.now()-start,phase:result.game.phase,scores:result.game.scores,contactCount:result.contacts.length,
    observed:result.observed,checks,closest,trace};
  receipt.runs.push(record);console.log(JSON.stringify({variant,slot:recipe.slot,grip:recipe.grip,observed:!!result.observed,phase:result.game.phase,score:result.game.scores,checks,closest:closest.distance}));
}
for(const [path,pin]of Object.entries(pins))assert.equal(sha(await fs.readFile(new URL(path,root))),pin,'source drift '+path);
receipt.sourceStable=true;await fs.writeFile(new URL((process.argv[2]?.startsWith('feedback')?process.argv[2]:'baseline-current')+'-reproduced.json',out),JSON.stringify(receipt,null,2)+'\n');
