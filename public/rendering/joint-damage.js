// Visual ownership only. Physical attachment, damage and fragment transforms
// come from the rig; these helpers never move a joint or create a body.
const BODIES=Object.freeze({root:'pelvis',pelvis:'pelvis',spine:'torso',chest:'torso',neck:'neck',head:'neck',
  'upper_arm.R':'mainUpper','forearm.R':'mainForearm','hand.R':'weapon',
  'upper_arm.L':'offUpper','forearm.L':'offForearm','hand.L':'offForearm',
  'thigh.R':'frontThigh','shin.R':'frontShin','foot.R':'frontShin','thigh.L':'backThigh','shin.L':'backShin','foot.L':'backShin'});
const JOINTS=Object.freeze({
  mainShoulder:['mainUpper','mainShoulder','mainElbow',.25],mainElbow:['mainForearm','mainElbow','mainHand',.27],wrist:['weapon','mainHand','tip',.27],
  offShoulder:['offUpper','offShoulder','offElbow',-.04],offElbow:['offForearm','offElbow','offHand',.01],
  frontHip:['frontThigh','frontHip','kneeF',.29],frontKnee:['frontShin','kneeF','footF',.29],
  backHip:['backThigh','backHip','kneeB',-.07],backKnee:['backShin','kneeB','footB',-.07]
});
const IDENTITY=Object.freeze([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
export const bodyForBone=name=>BODIES[name]??null;
// Shields are fixed to the forearm; only the parrying knife has a separate
// physical offWeapon body in the rig.
export const equipmentBody=key=>key==='knife'?'offWeapon':key==='short'||key==='long'?'offForearm':'weapon';
export function bodyVisible(pose,body,only=null){
  if(only)return only.has(body);
  return !(pose.detached??[]).some(fragment=>fragment.bodies.includes(body));
}
export function assertFragmentTransform(matrix){
  if(!matrix||matrix.length!==16||!Array.from(matrix).every(Number.isFinite)||
    Math.abs(Math.hypot(matrix[0],matrix[1])-1)>1e-5||Math.abs(Math.hypot(matrix[4],matrix[5])-1)>1e-5||
    Math.abs(matrix[0]*matrix[4]+matrix[1]*matrix[5])>1e-5||Math.abs(matrix[0]*matrix[5]-matrix[1]*matrix[4]-1)>1e-5||
    [2,3,6,7,8,9,11].some(i=>Math.abs(matrix[i])>1e-5)||Math.abs(matrix[10]-1)>1e-5||Math.abs(matrix[15]-1)>1e-5)
    throw new Error('Transform físico de fragmento inválido.');
  return matrix;
}
export function fragmentMatrix(delta,matrix){
  if(IDENTITY.every((value,i)=>delta[i]===value))return matrix;
  const result=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){let value=0;for(let k=0;k<4;k++)value+=delta[k*4+r]*matrix[c*4+k];result[c*4+r]=value;}
  return result;
}
export function rigidRenderer(renderer,delta){
  assertFragmentTransform(delta);
  const proxy=Object.create(renderer);
  proxy.draw=(shape,matrix,...rest)=>renderer.draw(shape,fragmentMatrix(delta,matrix),...rest);
  proxy.assetPart=(model,part,matrix,...rest)=>renderer.assetPart(model,part,fragmentMatrix(delta,matrix),...rest);
  return proxy;
}
export function jointMarks(pose,only=null){
  const marks=[];
  for(const [joint,state]of Object.entries(pose.joints??{})){
    const descriptor=JOINTS[joint];if(!descriptor||state.detached||!Number.isFinite(state.damage)||state.damage<=0)continue;
    const [body,start,end,z]=descriptor;if(!bodyVisible(pose,body,only))continue;
    const at=pose[start]??(start.endsWith('Hip')?pose.hip:null),to=pose[end];if(!at||!to)continue;
    marks.push({joint,body,at,to,z,damage:Math.min(1,state.damage)});
  }
  return marks;
}

// Same rigid XYZ support-link construction as the procedural maul fallback,
// separated by physical body when its two links have different owners.
export function drawPartialMaulSupport(renderer,fighter,pal,show){
  const p=fighter.pose;
  for(const [body,a,b,width,depth,color]of [['offUpper',p.offShoulder,p.offElbow,.20,.16,pal.wood],['offForearm',p.offElbow,p.offHand,.17,.15,pal.ivory??pal.light]]){
    if(!show(body))continue;
    const origin=[a.x,a.y,a.z??-.10],difference=[b.x-a.x,b.y-a.y,(b.z??origin[2])-origin[2]],distance=Math.hypot(...difference);
    const y=distance>1e-8?difference.map(v=>v/distance):[fighter.dir,0,0],planar=Math.hypot(y[0],y[1]);
    const x=planar>1e-8?[y[1]/planar,-y[0]/planar,0]:[1,0,0],z=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]],length=Math.max(.001,distance);
    const part=(shape,px,py,pz,sx,sy,sz,color,material=0,face=false)=>{
      const axisY=face?z:y,axisZ=face?y.map(v=>-v):z;
      const matrix=new Float32Array([x[0]*sx,x[1]*sx,x[2]*sx,0,axisY[0]*sy,axisY[1]*sy,axisY[2]*sy,0,axisZ[0]*sz,axisZ[1]*sz,axisZ[2]*sz,0,
        origin[0]+x[0]*px+y[0]*py+z[0]*pz,origin[1]+x[1]*px+y[1]*py+z[1]*pz,origin[2]+x[2]*px+y[2]*py+z[2]*pz,1]);
      renderer.draw(shape,matrix,color,material);
    };
    part('box',0,length/2,0,width,length,depth,color);
    part('cylinder',width*.4,length/2,depth*.32,.012,length,.012,pal.metal,1);
    for(const t of [.17,.83])part('cylinder',0,length*t,depth*.59,.018,.018,.018,pal.metal,1,true);
  }
}
