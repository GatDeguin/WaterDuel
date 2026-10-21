// Reduced dynamic fracture in scene units. Tensile strain supplies the driving
// condition; opening work is paid from relative material motion, never rigid
// translation. This is an energy budget, not calibrated Griffith toughness.
function patchNodes(m,face){
 const ids=new Set([face.a,face.b,face.c]);
 for(const other of m.faces)if(!other.fragment&&(ids.has(other.a)||ids.has(other.b)||ids.has(other.c))){
  // Expand only one material ring, rather than flooding the whole membrane.
  if([face.a,face.b,face.c].some(id=>id===other.a||id===other.b||id===other.c))for(const id of [other.a,other.b,other.c])ids.add(id);
 }
 return ids;
}
function relativeMotion(nodes,ids){
 let mass=0,x=0,y=0,z=0;
 for(const id of ids){const p=nodes[id];mass+=p.mass;x+=p.mass*p.vx;y+=p.mass*p.vy;z+=p.mass*p.vz;}
 if(mass){x/=mass;y/=mass;z/=mass;}
 let energy=0;for(const id of ids){const p=nodes[id];energy+=p.mass*((p.vx-x)**2+(p.vy-y)**2+(p.vz-z)**2)/2;}
 return {x,y,z,energy};
}
export function fractureCandidates(m){
 const budget=m.fractureEnergy,out=new Map();if(!budget||!m.punctured)return [];
 for(const e of m.edges){
  if(e.faces.length!==2||(!m.boundaryNodes.has(e.a)&&!m.boundaryNodes.has(e.b)))continue;
  const a=m.nodes[e.a],b=m.nodes[e.b],extension=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)-e.rest;
  if(1+extension/e.rest<=m.tearStrain)continue;
  const driving=extension*extension/(2*m.edgeCompliance);
  for(const index of e.faces){
   const face=m.faces[index],cost=budget.toughness*face.referenceArea;
   if(face.fragment||!(cost>0)||driving<cost)continue;
   const score=driving/cost;if(!out.has(index)||score>out.get(index).score)out.set(index,{index,cost,score});
  }
 }
 return [...out.values()];
}
export function propagateEnergyFracture(m,loaded=null){
 const budget=m.fractureEnergy;if(!budget||!m.punctured)return 0;
 let broken=0;
 for(let pass=0;pass<2;pass++){
  let candidate=null;
  for(const entry of loaded??fractureCandidates(m)){
   const face=m.faces[entry.index];if(face.fragment)continue;
   const ids=patchNodes(m,face),motion=relativeMotion(m.nodes,ids);
   if(motion.energy<=entry.cost)continue;
   if(!candidate||entry.score>candidate.score)candidate={...entry,ids};
  }
  if(!candidate)break;
  const firstNewNode=m.nodes.length;m.detachFace(candidate.index);
  for(let id=firstNewNode;id<m.nodes.length;id++)candidate.ids.add(id);
  const motion=relativeMotion(m.nodes,candidate.ids),paid=Math.min(candidate.cost,motion.energy);
  const factor=Math.sqrt(Math.max(0,1-paid/Math.max(motion.energy,1e-30)));
  for(const id of candidate.ids){const p=m.nodes[id];p.vx=motion.x+(p.vx-motion.x)*factor;p.vy=motion.y+(p.vy-motion.y)*factor;p.vz=motion.z+(p.vz-motion.z)*factor;}
  budget.dissipatedEnergy+=paid;budget.lastDrivingRatio=candidate.score;broken++;
 }
 return broken;
}
