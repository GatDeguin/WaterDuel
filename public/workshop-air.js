// Prescribed local fan current in scene units, not CFD. No physical water,
// collision state or random source enters this deterministic presentation field.
const zero=()=>({x:0,y:0,z:0});
export function prepareWorkshopAir(fan){
 if(!fan)return null;
 if(!Array.isArray(fan.pivot)||fan.pivot.length!==3||!fan.pivot.every(Number.isFinite)||
    !Array.isArray(fan.axis)||fan.axis.length!==3||!fan.axis.every(Number.isFinite)||Math.hypot(...fan.axis)<1e-9)
  throw Error('Pivote/eje de aire inválido (fan axis).');
 if(!Number.isFinite(fan.angularSpeed)||Math.abs(fan.angularSpeed)>30)throw Error('Velocidad de ventilador inválida.');
 const measured=fan.expectedRadiusRange,radius=fan.radius??(Array.isArray(measured)&&measured.length===2?(measured[0]+measured[1])/2:null);
 if(!Number.isFinite(radius)||radius<=0||radius>2)throw Error('Radio medido de ventilador inválido.');
 const length=Math.hypot(...fan.axis);
 return {pivot:[...fan.pivot],axis:fan.axis.map(v=>v/length),radius,angularSpeed:fan.angularSpeed,
  range:radius*8,spread:.6,speed:Math.min(1.5,radius*Math.abs(fan.angularSpeed)*.22)};
}
export function sampleWorkshopAir(air,point,time=0){
 if(!air||!air.speed)return zero();
 const x=point?.x,y=point?.y,z=point?.z;
 if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))return zero();
 const px=point.x,py=point.y,pz=point.z,dx=px-air.pivot[0],dy=py-air.pivot[1],dz=pz-air.pivot[2];
 const distance=0+dx*air.axis[0]+dy*air.axis[1]+dz*air.axis[2];
 if(distance<=0||distance>=air.range)return zero();
 const radius=air.radius+air.spread*distance,radial2=Math.max(0,(0+dx*dx+dy*dy+dz*dz)-distance*distance);
 if(radial2>=radius*radius)return zero();
 const inlet=Math.min(1,distance/(air.radius*.12)),profile=(1-radial2/(radius*radius))**2*(1-distance/air.range)**2;
 const pulse=.96+.04*Math.sin((Number.isFinite(time)?time:0)*air.angularSpeed);
 const speed=air.speed*profile*inlet*inlet*(3-2*inlet)*pulse;
 return {x:air.axis[0]*speed,y:air.axis[1]*speed,z:air.axis[2]*speed};
}
