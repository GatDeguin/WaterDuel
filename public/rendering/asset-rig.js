import {getWeapon,getDefense,WEAPONS,DEFENSES} from '../equipment.js';
import {splitApronParts} from './apron-parts.js';
import {apronParentFrame,apronMatrix} from '../physics/apron.js';
import {bodyForBone,assertFragmentTransform,fragmentMatrix} from './joint-damage.js';
import {equipmentFlex,equipmentRootTip,bendEquipmentPoint,HANDLE_RADII} from './equipment-flex.js';

// Column-major glTF matrices. Geometry is prepared once; per-frame work consists
// only of rigid/affine model matrices. This module never writes to the solver.
const identity=()=>new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
// ArticulatedRig's foot point is the proxy centre, with groundHeight set to
// TABLE_TOP + .075. The delivered Socket_Foot_* is on the sole, not that centre.
// Subtract the proxy half-height so lifted physical steps retain their delta.
const RIG_FOOT_PROXY_HALF_HEIGHT=.075;
const vector=p=>Array.isArray(p)||ArrayBuffer.isView(p)?Array.from(p):[p.x,p.y,p.z??0];
const subtract=(a,b)=>a.map((v,i)=>v-b[i]);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const times=(a,k)=>a.map(v=>v*k);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a,fallback=[0,1,0])=>{const l=Math.hypot(...a);return l>1e-9?times(a,1/l):fallback;};
const origin=m=>[m[12],m[13],m[14]];
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
function multiply(a,b){
  const result=new Float64Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)result[c*4+r]+=a[k*4+r]*b[c*4+k];
  return result;
}
function inverse(m){
  const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10];
  const determinant=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  if(!Number.isFinite(determinant)||Math.abs(determinant)<1e-12)throw new Error('Singular asset transform');
  const result=new Float64Array([(e*i-f*h)/determinant,(f*g-d*i)/determinant,(d*h-e*g)/determinant,0,
    (c*h-b*i)/determinant,(a*i-c*g)/determinant,(b*g-a*h)/determinant,0,
    (b*f-c*e)/determinant,(c*d-a*f)/determinant,(a*e-b*d)/determinant,0,0,0,0,1]);
  const t=point(result,origin(m));result[12]=-t[0];result[13]=-t[1];result[14]=-t[2];return result;
}
function normalTransform(m,n){
  const inv=inverse(m);return unit([inv[0]*n[0]+inv[1]*n[1]+inv[2]*n[2],inv[4]*n[0]+inv[5]*n[1]+inv[6]*n[2],inv[8]*n[0]+inv[9]*n[1]+inv[10]*n[2]]);
}
function basis(position,x,y,z){return new Float64Array([...x,0,...y,0,...z,0,...position,1]);}
function along(a,b,scaleX=1,scaleY=1,scaleZ=1){
  a=vector(a);b=vector(b);const y=unit(subtract(b,a)),x=unit(cross(y,[0,0,1]),[1,0,0]),z=unit(cross(x,y),[0,0,1]);
  return basis(a,times(x,scaleX),times(y,scaleY),times(z,scaleZ));
}
const excluded=p=>/Preview_Rapier|Balloon|Water|Latex/i.test(p.nodeName);
const jointName=(asset,nodeIndex)=>asset.nodes[nodeIndex]?.name??asset.json.nodes[nodeIndex]?.name;
const world=(asset,nodeIndex)=>asset.nodes[nodeIndex].worldMatrix;

function rigidJoint(primitive,vertex){
  if(!primitive.joints||!primitive.weights)throw new Error(`Character requires rigid joint weights: ${primitive.nodeName}`);
  let joint=-1;
  for(let k=0;k<4;k++){
    const weight=primitive.weights[vertex*4+k];
    if(weight>1e-5){
      if(joint!==-1||Math.abs(weight-1)>1e-4)throw new Error('Character weights must be rigid, one joint of weight 1 per vertex');
      joint=primitive.joints[vertex*4+k];
    }
  }
  if(joint<0)throw new Error('Character vertex has no rigid joint');return joint;
}

const limbLinks={
  'upper_arm.R':['mainShoulder','mainElbow','forearm.R'],
  'forearm.R':['mainElbow','mainHand','hand.R'],
  'upper_arm.L':['offShoulder','offElbow','forearm.L'],
  'forearm.L':['offElbow','offHand','hand.L'],
  'thigh.R':['frontHip','kneeF','shin.R'],'shin.R':['kneeF','footF','foot.R'],
  'thigh.L':['backHip','kneeB','shin.L'],'shin.L':['kneeB','footB','foot.L']
};

export function prepareCharacter(asset){
  const nodesByName=new Map(asset.nodes.map((node,index)=>[node.name,index]));
  const sourcePoint=name=>{
    const index=nodesByName.get(name);if(index===undefined)throw new Error(`Missing character pivot ${name}`);
    return origin(world(asset,index));
  };
  const source={hip:sourcePoint('pelvis'),mainShoulder:sourcePoint('upper_arm.R'),offShoulder:sourcePoint('upper_arm.L'),
    mainGrip:sourcePoint('Socket_MainHand'),offGrip:sourcePoint('Socket_SecondaryHand'),head:sourcePoint('head')};
  // The optional authored rapier supplies its actual axis before being excluded.
  // It is metadata for hand orientation, never a second rendered weapon.
  let tip=null,farthest=0;
  for(const p of asset.primitives.filter(p=>/Preview_Rapier/.test(p.nodeName))){
    const skin=asset.skins[p.skinIndex];
    for(let v=0;v<p.positions.length/3;v++){
      const j=rigidJoint(p,v),ibm=skin.inverseBindMatrices.subarray(j*16,j*16+16),m=multiply(world(asset,skin.joints[j]),ibm);
      const position=point(m,p.positions.subarray(v*3,v*3+3)),distance=Math.hypot(...subtract(position,source.mainGrip));
      if(distance>farthest){farthest=distance;tip=position;}
    }
  }
  source.mainFrame=along(source.mainGrip,tip??add(source.mainGrip,[1,0,0]));
  source.offFrame=along(source.offGrip,add(source.offGrip,[-1,0,0]));
  const sourceMid=times(add(source.mainShoulder,source.offShoulder),.5);
  const sourceX=subtract(source.mainShoulder,source.offShoulder),sourceY=subtract(sourceMid,source.hip);
  source.torsoFrame=basis(source.hip,sourceX,sourceY,unit(cross(sourceX,sourceY)));
  source.authoredScale=source.hip[1]/.9800000786781311;
  const parts=[],bones=new Map();let excludedTriangles=0,triangleCount=0;
  for(const p of asset.primitives){
    if(excluded(p)){excludedTriangles+=p.indices.length/3;continue;}
    if(p.skinIndex===null||p.skinIndex===undefined)throw new Error(`Character mesh is not skinned: ${p.nodeName}`);
    const skin=asset.skins[p.skinIndex],groups=new Map();
    for(let t=0;t<p.indices.length;t+=3){
      const indices=[p.indices[t],p.indices[t+1],p.indices[t+2]],joint=rigidJoint(p,indices[0]);
      if(indices.some(v=>rigidJoint(p,v)!==joint))throw new Error('Character triangle crosses rigid joints');
      if(!groups.has(joint))groups.set(joint,[]);groups.get(joint).push(...indices);
    }
    for(const [joint,triangles] of groups){
      const nodeIndex=skin.joints[joint],boneName=jointName(asset,nodeIndex),bind=skin.inverseBindMatrices.subarray(joint*16,joint*16+16);
      if(!bind.every(Number.isFinite))throw new Error('Invalid inverse bind matrix');
      if(!bones.has(boneName)){
        const matrix=world(asset,nodeIndex),link=limbLinks[boneName];
        const entry={name:boneName,nodeIndex,worldMatrix:matrix,sourceOrigin:origin(matrix)};
        if(link){entry.link=link;entry.sourceEnd=sourcePoint(link[2]);entry.sourceFrame=along(entry.sourceOrigin,entry.sourceEnd);}
        bones.set(boneName,entry);
      }
      const remap=new Map(),positions=[],normals=[],uv=[],uv1=[],colors=[],indices=[];
      for(const v of triangles){
        if(!remap.has(v)){
          remap.set(v,positions.length/3);positions.push(...point(bind,p.positions.subarray(v*3,v*3+3)));
          normals.push(...normalTransform(bind,p.normals.subarray(v*3,v*3+3)));uv.push(p.uv?.[v*2]??0,p.uv?.[v*2+1]??0);
          if(p.uv1)uv1.push(p.uv1[v*2],p.uv1[v*2+1]);
          if(p.colors)colors.push(...p.colors.subarray(v*4,v*4+4));
        }
        indices.push(remap.get(v));
      }
      const inverseWorld=inverse(world(asset,nodeIndex)),part={positions:new Float32Array(positions),normals:new Float32Array(normals),uv:new Float32Array(uv),
        uv1:p.uv1?new Float32Array(uv1):null,colors:p.colors?new Float32Array(colors):null,
        indices:new Uint32Array(indices),material:p.material,nodeName:p.nodeName,nodeIndex:p.nodeIndex,boneName,boneIndex:nodeIndex};
      const link=limbLinks[boneName];
      if(link){
        part.targetStart=link[0];part.targetEnd=link[1];part.anchorStart=point(inverseWorld,bones.get(boneName).sourceOrigin);
        part.anchorEnd=point(inverseWorld,bones.get(boneName).sourceEnd);
      }
      if(['pelvis','spine','chest','root'].includes(boneName)){part.targetStart='hip';part.anchorStart=point(inverseWorld,source.hip);}
      if(boneName==='hand.R'||boneName==='hand.L'){
        part.socket=boneName==='hand.R'?'Socket_MainHand':'Socket_SecondaryHand';
        part.anchorSocket=point(inverseWorld,boneName==='hand.R'?source.mainGrip:source.offGrip);
      }
      if(boneName==='foot.R'||boneName==='foot.L'){
        part.socket=boneName==='foot.R'?'Socket_Foot_R':'Socket_Foot_L';part.anchorSocket=point(inverseWorld,sourcePoint(part.socket));
      }
      triangleCount+=indices.length/3;parts.push(part);
    }
  }
  const apron=splitApronParts(parts,bones,source);
  for(const part of apron.parts)if(part.accessory==='apron'){
    const canonical=basis(times(source.hip,-1/source.authoredScale),[1/source.authoredScale,0,0],[0,1/source.authoredScale,0],[0,0,1/source.authoredScale]);
    part.apronFromBone=multiply(canonical,bones.get(part.boneName).worldMatrix);
  }
  return {parts:apron.parts,bones,source,nodesByName,triangleCount,excludedTriangles,asset,apron:apron.descriptor,
    apronVariant:apron.parts.some(p=>p.accessory==='apron'&&/Boss/i.test(p.nodeName))?'boss':'normal'};
}

export function characterTransforms(prepared,fighter){
  const p=fighter.pose,source=prepared.source,bones=prepared.bones,scale=(fighter.boss?1.18:1)/source.authoredScale;
  const targetMain=vector(p.mainShoulder),targetOff=vector(p.offShoulder),mid=times(add(targetMain,targetOff),.5),hip=vector(p.hip);
  let x=subtract(targetMain,targetOff);const y=subtract(mid,hip);let z=times(unit(cross(x,y)),scale);
  // The two torso ports are symmetric. Keep the decorated front toward the
  // presentation plane for the opposite duelist by exchanging those visual
  // ports with a proper half-turn; limb bones still follow their own physical
  // main/off pivots. Flipping both axes preserves handedness and the hip anchor.
  if(fighter.dir<0){x=times(x,-1);z=times(z,-1);}
  const torsoMap=multiply(basis(hip,x,y,z),inverse(source.torsoFrame));
  const weapon=getWeapon(fighter),primary=equipmentTransform(fighter,weapon.id).matrix,mainRadius=(HANDLE_RADII[weapon.id]??.045)/.045;
  // Resize across the grip axis around the authored socket. Physical hand/root motion already owns readjustment.
  const handMain=multiply(primary,multiply(basis([0,0,0],[scale*mainRadius,0,0],[0,scale,0],[0,0,scale*mainRadius]),inverse(source.mainFrame)));
  const defense=getDefense(fighter),offDirection=p.twoHanded?add(vector(p.offHand),subtract(vector(p.tip),vector(p.mainHand))):
    defense.kind==='knife'&&p.defenseTip?vector(p.defenseTip):add(vector(p.offHand),subtract(vector(p.offHand),vector(p.offElbow)));
  const offRadius=(p.twoHanded?HANDLE_RADII[weapon.id]:defense.kind==='knife'?HANDLE_RADII.knife:.045)/.045;
  const handOff=multiply(along(p.offHand,offDirection,scale*offRadius,scale,scale*offRadius),inverse(source.offFrame));
  const feetMaps=new Map();
  for(const suffix of ['R','L'])if(bones.has(`foot.${suffix}`)){
    const socket=`Socket_Foot_${suffix}`,sourceSocket=origin(world(prepared.asset,prepared.nodesByName.get(socket)));
    const target=vector(suffix==='R'?p.footF:p.footB);target[1]-=RIG_FOOT_PROXY_HALF_HEIGHT;
    // Rotate around world Y for an opposite fighter; do not reflect normals.
    const dir=fighter.dir<0?-1:1,map=basis([0,0,0],[dir*scale,0,0],[0,scale,0],[0,0,dir*scale]);
    const offset=subtract(target,point(map,sourceSocket));map[12]=offset[0];map[13]=offset[1];map[14]=offset[2];feetMaps.set(suffix,map);
  }
  const matrices=new Map();
  for(const [name,bone] of bones){
    let map;
    if(name==='hand.R')map=handMain;
    else if(name==='hand.L')map=handOff;
    else if(name==='foot.R'||name==='foot.L')map=feetMaps.get(name.endsWith('.R')?'R':'L');
    else if(bone.link){
      const [start,end]=bone.link;let targetEnd=vector(p[end]);
      if(name==='forearm.R')targetEnd=point(handMain,origin(bones.get('hand.R').worldMatrix));
      if(name==='forearm.L')targetEnd=point(handOff,origin(bones.get('hand.L').worldMatrix));
      if(name==='shin.R')targetEnd=point(feetMaps.get('R'),origin(bones.get('foot.R').worldMatrix));
      if(name==='shin.L')targetEnd=point(feetMaps.get('L'),origin(bones.get('foot.L').worldMatrix));
      const length=Math.hypot(...subtract(targetEnd,vector(p[start]))),sourceLength=Math.hypot(...subtract(bone.sourceEnd,bone.sourceOrigin));
      map=multiply(along(p[start],targetEnd,scale,length/sourceLength,scale),inverse(bone.sourceFrame));
    }else if(name==='neck'){
      const end=[p.head.x,p.head.y-.40*(fighter.balloonSize??1),p.head.z??.025],sourceEnd=source.head;
      const sourceLength=Math.hypot(...subtract(sourceEnd,bone.sourceOrigin));
      map=multiply(along(p.shoulder,end,scale,Math.hypot(...subtract(end,vector(p.shoulder)))/sourceLength,scale),inverse(along(bone.sourceOrigin,sourceEnd)));
    }else if(name==='head'){
      const target=[p.head.x,p.head.y-.40*(fighter.balloonSize??1),p.head.z??.025];
      map=basis(subtract(target,times(source.head,scale)),[scale,0,0],[0,scale,0],[0,0,scale]);
    }else if(['pelvis','spine','chest','root'].includes(name))map=torsoMap;
    else throw new Error(`Unsupported rigid character bone ${name}`);
    matrices.set(name,new Float32Array(multiply(map,bone.worldMatrix)));
  }
  let accessoryMatrix=null;
  if(prepared.apron){
    accessoryMatrix=p.apron?.variant===prepared.apronVariant&&p.apron.canonicalMatrix?p.apron.canonicalMatrix:
      apronMatrix(apronParentFrame(p,fighter.dir,fighter.boss?1.18:1,prepared.apron),prepared.apron.pivot,p.apron?.angle??0);
  }
  return prepared.parts.map(part=>part.accessory==='apron'?new Float32Array(multiply(accessoryMatrix,part.apronFromBone)):matrices.get(part.boneName));
}

const deformation={sword:[.18,1.02],spear:[.15,1],axe:[.18,.56],maul:[.18,.725],knife:[.09,.42]};
export function detachedCharacterTransforms(prepared,fighter,fragment,sourceMatrices=null){
  assertFragmentTransform(fragment.transform);
  const matrices=sourceMatrices??characterTransforms(prepared,{...fighter,pose:fragment.sourcePose,equipment:fragment.sourcePose.equipment??fighter.equipment});
  const bodies=new Set(fragment.bodies);
  return prepared.parts.map((part,index)=>bodies.has(bodyForBone(part.boneName))?fragmentMatrix(fragment.transform,matrices[index]):null);
}

export function prepareEquipment(asset,id){
  if(!WEAPONS[id]&&!DEFENSES[id])throw new Error(`Unknown equipment asset ${id}`);
  if(id==='none')return {id,parts:[],triangleCount:0};
  const parts=asset.primitives.map(p=>{
    if(p.skinIndex!==null&&p.skinIndex!==undefined)throw new Error('Equipment must be a rigid unskinned asset');
    const positions=new Float32Array(p.positions.length),normals=new Float32Array(p.normals.length);
    for(let v=0;v<p.positions.length/3;v++){
      positions.set(point(p.worldMatrix,p.positions.subarray(v*3,v*3+3)),v*3);
      normals.set(normalTransform(p.worldMatrix,p.normals.subarray(v*3,v*3+3)),v*3);
    }
    return {positions,normals,uv:p.uv?new Float32Array(p.uv):new Float32Array(p.positions.length/3*2),uv1:p.uv1?new Float32Array(p.uv1):null,
      colors:p.colors?new Float32Array(p.colors):null,indices:new Uint32Array(p.indices),material:p.material,nodeName:p.nodeName,nodeIndex:p.nodeIndex};
  });
  return {id,parts,triangleCount:parts.reduce((sum,p)=>sum+p.indices.length/3,0)};
}

export function equipmentTransform(fighter,id){
  if(id==='none')return null;
  const p=fighter.pose,weapon=WEAPONS[id],defense=DEFENSES[id];
  if(!weapon&&!defense)throw new Error(`Unknown equipment asset ${id}`);
  if(defense&&getWeapon(fighter).twoHanded)return null;
  if(weapon||id==='knife'){
    const hand=weapon?p.mainHand:p.offHand,tip=weapon?p.tip:p.defenseTip;
    if(!tip)throw new Error(`Missing physical tip for ${id}`);
    const flex=weapon?equipmentFlex(fighter,id):{flexOffset:0,flexLength:0,flexDirection:fighter.dir<0?-1:1};
    const length=flex.flexLength||Math.hypot(...subtract(vector(tip),vector(hand))),nominal=weapon?.length??defense.length;
    const [deformStart,deformEnd]=deformation[id],extension=length-nominal;
    return {matrix:new Float32Array(along(hand,weapon?equipmentRootTip(fighter,id):tip)),extension,deformStart,deformEnd,stretchAlong:1+extension/(deformEnd-deformStart),...flex};
  }
  const sx=(p.shieldRadiusX??p.shieldRadius??defense.radiusX)/defense.radiusX,sy=(p.shieldRadiusY??p.shieldRadius??defense.radiusY)/defense.radiusY;
  return {matrix:new Float32Array(basis(vector(p.offHand),[sx,0,0],[0,sy,0],[0,0,1])),extension:0,deformStart:0,deformEnd:1,stretchAlong:1,flexOffset:0,flexLength:0,flexDirection:fighter.dir<0?-1:1};
}

export function deformEquipmentPoint(position,{extension=0,deformStart=0,deformEnd=1,...flex}={}){
  const result=Array.from(position),t=Math.max(0,Math.min(1,(result[1]-deformStart)/(deformEnd-deformStart)));
  result[1]+=extension*t;return bendEquipmentPoint(result,flex);
}
