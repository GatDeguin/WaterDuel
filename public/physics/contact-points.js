import {TABLE_TOP} from './dimensions.js';

// A bounded visual sample of actual support vertices, not a hull or a fabricated
// centre. Lowest Y and X/Z extremes survive before filling separated grid cells.
export function nearFloorContactPoints(points,{floor=TABLE_TOP,maxGap=.12,limit=16}={}){
 const cells=new Map();
 for(const p of points){
  if(![p.x,p.y,p.z??0].every(Number.isFinite)||p.y>floor+maxGap)continue;
  const key=`${Math.round(p.x/.002)}:${Math.round((p.z??0)/.002)}`,old=cells.get(key);
  if(!old||p.y<old.y)cells.set(key,{x:p.x,y:p.y,z:p.z??0});
 }
 const pool=[...cells.values()],chosen=[],used=new Set();
 const add=p=>{if(p&&!used.has(p)&&chosen.length<limit){used.add(p);chosen.push(p);}};
 if(!pool.length||limit<1)return chosen;
 add(pool.reduce((a,b)=>b.y<a.y?b:a));
 for(const key of ['x','z']){add(pool.reduce((a,b)=>b[key]<a[key]?b:a));add(pool.reduce((a,b)=>b[key]>a[key]?b:a));}
 const grid=new Map();
 for(const p of pool){const key=`${Math.floor(p.x/.08)}:${Math.floor(p.z/.08)}`,old=grid.get(key);if(!old||p.y<old.y)grid.set(key,p);}
 const fill=candidates=>{
  while(chosen.length<limit){
   let next=null,best=-1;
   for(const p of candidates){if(used.has(p))continue;const distance=Math.min(...chosen.map(q=>(p.x-q.x)**2+(p.z-q.z)**2));if(distance>best){best=distance;next=p;}}
   if(!next)break;add(next);
  }
 };
 fill([...grid.values()]);fill(pool);return chosen;
}
