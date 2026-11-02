/** Procedural fallback uses the very same extruded hull as foot contact. */
export function proceduralFootMesh(foot){
  const hull=foot?.hull,depth=foot?.depth;
  if(!hull||hull.length<3||!Number.isFinite(depth)||depth<=0)return {p:new Float32Array(),n:new Float32Array()};
  const positions=[],normals=[],half=depth/2,z=foot.center.z;
  const triangle=(a,b,c)=>{
    const u=b.map((v,i)=>v-a[i]),v=c.map((value,i)=>value-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);
    if(length<1e-12)return;for(const p of [a,b,c]){positions.push(...p);normals.push(...n.map(value=>value/length));}
  };
  const at=(i,side)=>[hull[i].x,hull[i].y,z+side*half];
  for(let i=1;i<hull.length-1;i++){triangle(at(0,1),at(i,1),at(i+1,1));triangle(at(0,-1),at(i+1,-1),at(i,-1));}
  for(let i=0;i<hull.length;i++){const j=(i+1)%hull.length;triangle(at(i,-1),at(j,-1),at(j,1));triangle(at(i,-1),at(j,1),at(i,1));}
  return {p:new Float32Array(positions),n:new Float32Array(normals)};
}
