// Detached compounds use the existing continuous rectangle query, through a
// geometry-only adapter. The actual response always uses the real body and
// owner. Parent/parent pairs remain exclusively in ArticulatedRig.resolvePair.
import {firstWeaponContact,weaponBindManifold} from './weapon-bind.js';
const cutMount={mainShoulder:['mainUpper','torso'],mainElbow:['mainForearm','mainUpper'],wrist:['weapon','mainForearm'],offShoulder:['offUpper','torso'],offElbow:['offForearm','offUpper'],frontHip:['frontThigh','pelvis'],frontKnee:['frontShin','frontThigh'],backHip:['backThigh','pelvis'],backKnee:['backShin','backThigh']};
const cuts=new WeakMap();
function gap(a,b){
  let value=-Infinity;
  for(const n of [...a.axes,...b.axes]){const A=a.vertices.map(p=>p.x*n.x+p.y*n.y),B=b.vertices.map(p=>p.x*n.x+p.y*n.y);value=Math.max(value,Math.min(...B)-Math.max(...A),Math.min(...A)-Math.max(...B));}
  return Math.max(value,Math.abs(a.z-b.z)-(a.depth+b.depth)/2);
}
function cutExclusion(a,b,pa,pb){
  const inspect=(fragment,other,p,q)=>{
    if(!fragment.fragment||fragment.rig!==other.rig)return false;
    const mount=cutMount[fragment.entity.joint];if(!mount||p.body!==mount[0]||q.body!==mount[1])return false;
    let records=cuts.get(fragment.entity);if(!records){records=new Map();cuts.set(fragment.entity,records);}
    let pairs=records.get(other.entity);if(!pairs){pairs=new Map();records.set(other.entity,pairs);}
    const key=p.key+'/'+q.key;
    // Only the initially intersecting mating faces are exempt while leaving
    // their old hinge. A real geometric gap permanently rearms this pair;
    // there is no elapsed-time immunity and no separation kick at birth.
    if(!pairs.has(key))pairs.set(key,gap(p,q)<=.001);
    if(pairs.get(key)&&gap(p,q)>.001)pairs.set(key,false);
    return pairs.get(key);
  };
  return inspect(a,b,pa,pb)||inspect(b,a,pb,pa);
}
function provider(actor,key){
  const entity=actor.entity,geometry=t=>entity.collisionPanelsAt(t).find(p=>p.key===key),adapt=p=>p?[{...p,body:'weapon',material:'collision-query'}]:[];
  return {get q(){return actor.fragment?[entity.x,entity.y,entity.angle]:entity.q;},
    get previousQ(){return actor.fragment?[entity.previous.x,entity.previous.y,entity.previous.angle]:entity.previousQ;},
    scale:actor.rig.scale,dir:actor.rig.dir,swordLength:actor.fragment?3:entity.swordLength,previousSwordLength:actor.fragment?3:entity.previousSwordLength,
    collisionPanels:()=>adapt(entity.collisionPanels().find(p=>p.key===key)),collisionPanelsAt:t=>adapt(geometry(t))};
}
const half=(p,n)=>Math.max(...p.vertices.map(v=>Math.abs((v.x-p.center.x)*n.x+(v.y-p.center.y)*n.y)));
const located=(p,uv)=>({x:p.center.x+p.axes.reduce((s,n,i)=>s+n.x*uv[i]*half(p,n),0),y:p.center.y+p.axes.reduce((s,n,i)=>s+n.y*uv[i]*half(p,n),0),z:p.z});
export function resolveDetachedContacts(rigs,dt=1/120){
  const actors=rigs.flatMap((rig,owner)=>[{rig,owner,entity:rig,fragment:false},...rig.fragments.map(entity=>({rig,owner,entity,fragment:true}))]),contacts=[];
  const cap=Math.min(.45,54*Math.max(0,Number.isFinite(dt)?dt:0));
  for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){
    const a=actors[i],b=actors[j];if(!a.fragment&&!b.fragment)continue;
    for(const pa of a.entity.collisionPanels())for(const pb of b.entity.collisionPanels()){
      if(cutExclusion(a,b,pa,pb))continue;
      const A=provider(a,pa.key),B=provider(b,pb.key),hit=firstWeaponContact(A,B);if(!hit)continue;
      const currentA=a.entity.collisionPanels().find(p=>p.key===pa.key),currentB=b.entity.collisionPanels().find(p=>p.key===pb.key);
      if(!currentA||!currentB)continue;
      const pointA=located(currentA,hit.anchorA),pointB=located(currentB,hit.anchorB),normal=hit.normal;
      const va=a.entity.pointVelocity({body:pa.body,point:pointA}),vb=b.entity.pointVelocity({body:pb.body,point:pointB});if(!va||!vb)continue;
      const mass=(entity,body,point,n)=>entity.effectiveInverseMass({body,point,normal:n});
      const inverseMass=mass(a.entity,pa.body,pointA,normal)+mass(b.entity,pb.body,pointB,normal),closing=(va.x-vb.x)*normal.x+(va.y-vb.y)*normal.y;
      const impulse=inverseMass>1e-9?Math.max(0,Math.min(cap,closing/inverseMass)):0;
      let impulseA={x:-normal.x*impulse,y:-normal.y*impulse},impulseB={x:normal.x*impulse,y:normal.y*impulse};
      if(impulse>0){
        a.entity.reactImpulse({body:pa.body,point:pointA,impulse:impulseA});b.entity.reactImpulse({body:pb.body,point:pointB,impulse:impulseB});
        const tangent={x:-normal.y,y:normal.x},av=a.entity.pointVelocity({body:pa.body,point:pointA}),bv=b.entity.pointVelocity({body:pb.body,point:pointB});
        const tangentMass=mass(a.entity,pa.body,pointA,tangent)+mass(b.entity,pb.body,pointB,tangent);
        if(tangentMass>1e-9){const slide=((av.x-bv.x)*tangent.x+(av.y-bv.y)*tangent.y)/tangentMass,friction=Math.max(-.3*impulse,Math.min(.3*impulse,slide));
          const fa={x:-tangent.x*friction,y:-tangent.y*friction},fb={x:-fa.x,y:-fa.y};
          a.entity.reactImpulse({body:pa.body,point:pointA,impulse:fa});b.entity.reactImpulse({body:pb.body,point:pointB,impulse:fb});
          impulseA={x:impulseA.x+fa.x,y:impulseA.y+fa.y};impulseB={x:impulseB.x+fb.x,y:impulseB.y+fb.y};
        }
      }
      let residual=0;
      for(let iteration=0;iteration<24;iteration++){
        const c=weaponBindManifold(A,B,hit)[0];if(!c){residual=0;break;}
        residual=c.penetration;const n=c.normal,ma=mass(a.entity,pa.body,c.pointA,n),mb=mass(b.entity,pb.body,c.pointB,n),total=ma+mb;if(total<1e-9)break;
        a.entity.projectContact({body:pa.body,point:c.pointA,normal:{x:-n.x,y:-n.y},penetration:(residual+1e-7)*ma/total});
        b.entity.projectContact({body:pb.body,point:c.pointB,normal:n,penetration:(residual+1e-7)*mb/total});
      }
      residual=weaponBindManifold(A,B,hit)[0]?.penetration??0;
      contacts.push({ownerA:a.owner,ownerB:b.owner,fragmentA:a.fragment?a.entity.id:null,fragmentB:b.fragment?b.entity.id:null,bodyA:pa.body,bodyB:pb.body,keyA:pa.key,keyB:pb.key,t:hit.t,normal,
        pointA,pointB,at:{x:(hit.pointA.x+hit.pointB.x)/2,y:(hit.pointA.y+hit.pointB.y)/2,z:(hit.pointA.z+hit.pointB.z)/2},
        closingSpeed:closing,slideSpeed:Math.abs((va.x-vb.x)*-normal.y+(va.y-vb.y)*normal.x),impulse,impulseA,impulseB,penetration:residual});
    }
  }
  for(const actor of actors)if(actor.fragment)actor.entity.resolveFloor();
  return {contacts};
}
