const multiply=(a,b)=>{const o=new Float32Array(16);for(let j=0;j<4;j++)for(let i=0;i<4;i++)for(let k=0;k<4;k++)o[j*4+i]+=a[k*4+i]*b[j*4+k];return o;};
export function prepareWorkshopMotion(contract,parts){
  const fan=contract?.fanRotor;if(!fan)return null;
  if(typeof fan.name!=='string'||parts.filter(p=>p.nodeName===fan.name).length!==1||
    !Array.isArray(fan.pivot)||fan.pivot.length!==3||!fan.pivot.every(Number.isFinite)||
    !Array.isArray(fan.axis)||fan.axis.length!==3||fan.axis.some((v,i)=>v!==[0,0,1][i])||
    !Number.isFinite(fan.angularSpeed)||Math.abs(fan.angularSpeed)>30)throw Error('Contrato de rotor incompatible con el taller.');
  return {name:fan.name,pivot:[...fan.pivot],angularSpeed:fan.angularSpeed};
}
export function environmentPartMatrix(part,motion,time,{staticCapture=false}={}){
  if(!motion||part.nodeName!==motion.name)return part.worldMatrix;
  if(staticCapture)return null;
  const angle=(((Number.isFinite(time)?time:0)*motion.angularSpeed)%(Math.PI*2)),c=Math.cos(angle),s=Math.sin(angle),[x,y,z]=motion.pivot;
  // T(pivot) Rz(angle) T(-pivot) * restWorld. Static nodes remain unchanged.
  const m=new Float32Array([c,s,0,0,-s,c,0,0,0,0,1,0,x-c*x+s*y,y-s*x-c*y,0,1]);
  return multiply(m,part.worldMatrix);
}
