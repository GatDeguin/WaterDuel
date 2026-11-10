// Bounds only decide whether to submit an unchanged opaque draw. The margin
// keeps geometry near a clip plane eligible despite float32 vertex arithmetic.
const CLIP_MARGIN=.002;
const boundsByPositions=new WeakMap();

function positionBounds(positions){
  if(!positions?.length)return null;
  let bounds=boundsByPositions.get(positions);
  if(bounds)return bounds;
  bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i+=3){
    for(let axis=0;axis<3;axis++){
      const point=positions[i+axis];
      bounds[axis]=Math.min(bounds[axis],point);
      bounds[axis+3]=Math.max(bounds[axis+3],point);
    }
  }
  boundsByPositions.set(positions,bounds);
  return bounds;
}

export function workshopClipPlanes(viewProjection){
  const m=viewProjection,planes=[];
  for(let row=0;row<3;row++)for(const sign of [-1,1]){
    const x=m[3]+sign*m[row],y=m[7]+sign*m[4+row],z=m[11]+sign*m[8+row];
    const d=m[15]+sign*m[12+row],length=Math.hypot(x,y,z);
    planes.push([x,y,z,d,CLIP_MARGIN*length]);
  }
  return planes;
}

export function workshopPartInView(part,model,planes){
  const bounds=positionBounds(part.sourceGeometry?.positions);
  if(!bounds)return true;
  for(const [x,y,z,d,margin] of planes){
    const a=x*model[0]+y*model[1]+z*model[2],b=x*model[4]+y*model[5]+z*model[6];
    const c=x*model[8]+y*model[9]+z*model[10],offset=x*model[12]+y*model[13]+z*model[14]+d;
    const farthest=a*bounds[a<0?0:3]+b*bounds[b<0?1:4]+c*bounds[c<0?2:5]+offset;
    if(farthest < -margin)return false;
  }
  return true;
}
