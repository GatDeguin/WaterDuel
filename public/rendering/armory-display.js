import {WEAPONS,DEFENSES} from '../equipment.js';
import {drawWeapon,drawDefense} from './equipment.js';

// The rack fits the empty bay between the right wall's storage cabinets.
// Coordinates are in the same Y-up room as workshop-360-v4.
export const ARMORY_RACK=Object.freeze({
  x:11.87,y:2.675,z:10.10,width:2.50,height:2.55,eyeX:7.20,nearX:11.23,
});
const slots=[
  ['weapons','sword',2.59,9.22,.80],
  ['weapons','spear',2.59,9.80,.80],
  ['weapons','axe',2.59,10.38,.80],
  ['weapons','maul',2.59,10.96,.80],
  ['defenses','short',1.86,9.37,.89],
  ['defenses','long',1.86,10.10,.85],
  ['defenses','knife',1.65,10.83,.93],
];
const tintUnlocked=[1,1,1],tintLocked=[.65,.61,.54];
const equipmentPalette={wood:0x996241,edge:0x553927,light:0xc19161,ivory:0xdfc49a,metal:0xc6a05e,steel:0xb3c5ca,leather:0x5b3729};

// Local +Y is the tool's long axis. Local +Z faces the viewer from the wall.
function mount(x,y,z,sx,sy=sx,sz=sx){
  return new Float32Array([0,0,sx,0,0,sy,0,0,-sz,0,0,0,x,y,z,1]);
}
function localMount(world,local){
  const model=new Float32Array(16);
  for(let i=0;i<16;i+=4){
    model[i]=world[8]*local[i+2]+world[12]*local[i+3];
    model[i+1]=world[5]*local[i+1]+world[13]*local[i+3];
    model[i+2]=world[2]*local[i]+world[14]*local[i+3];
    model[i+3]=local[i+3];
  }
  return model;
}

// Conservative clip-space culling for the board, protruding tools and mounts.
// No individual model is visited while the rack is outside the camera.
export function armoryInFrame(viewProjection){
  const m=viewProjection,x=11.69,y=ARMORY_RACK.y,z=ARMORY_RACK.z;
  const extentX=.54,extentY=1.40,extentZ=1.42;
  for(let row=0;row<3;row++)for(let sign=-1;sign<=1;sign+=2){
    const a=m[3]+sign*m[row],b=m[7]+sign*m[4+row],c=m[11]+sign*m[8+row],d=m[15]+sign*m[12+row];
    if(a*x+b*y+c*z+d+Math.abs(a)*extentX+Math.abs(b)*extentY+Math.abs(c)*extentZ<0)return false;
  }
  return true;
}

function drawTool(renderer,group,id,model,unlocked){
  const equipment=renderer.assetScene.equipment?.[id];
  if(equipment){
    const tint=unlocked?tintUnlocked:tintLocked;
    for(const part of equipment.gpu.parts)renderer.assetPart(equipment.gpu,part,model,{tint});
    return;
  }
  const grip={x:0,y:0,z:0};
  const fallback={draw:(shape,local,...material)=>renderer.draw(shape,localMount(model,local),...material)};
  if(group==='weapons'){
    drawWeapon(fallback,{dir:1,equipment:{weapon:id,defense:'none'},pose:{mainHand:grip,tip:{...grip,y:WEAPONS[id].length}}},equipmentPalette);
  }else{
    drawDefense(fallback,{dir:1,equipment:{weapon:'sword',defense:id},pose:{offHand:grip,offElbow:{...grip,y:-.3},defenseTip:{...grip,y:DEFENSES[id].length}}},equipmentPalette);
  }
}

export function drawArmory(renderer,collection){
  const {x,y,z,width,height}=ARMORY_RACK;
  if(!renderer.assetScene.environment?.surroundings)renderer.box(12.09,y,z,.18,height+.18,width+.18,0x59544a,8);
  renderer.box(x,y,z,.22,height,width,0x523824,0);
  for(let i=0;i<7;i++)renderer.box(x-.12,y,z+(i-3)*.337,.045,height-.14,.330,i%2?0x674632:0x74513a,0);
  for(const side of [-1,1]){
    renderer.box(x-.16,y+side*(height/2-.075),z,.13,.15,width,0x3a2519,0);
    renderer.box(x-.16,y,z+side*(width/2-.070),.13,height,.14,0x3a2519,0);
  }
  renderer.box(x-.165,2.33,z,.13,.085,width-.22,0x3f2920,0);
  renderer.box(x-.19,3.82,z,.04,.085,1.66,0xc19456,1);
  for(const side of [-1,1])renderer.sphere(x-.22,3.82,z+side*.74,.025,.031,.031,0xf3bd76,1);

  for(const [group,id,toolY,toolZ,scale] of slots){
    const unlocked=collection?.[group]?.[id]?.unlocked!==false;
    const plateY=group==='weapons'?2.44:1.49;
    renderer.box(x-.175,toolY,toolZ,.09,.19,.30,0x342721,17);
    for(const side of [-1,1])renderer.sphere(x-.25,toolY,toolZ+side*.13,.043,.032,.038,0xc9a16a,1);
    drawTool(renderer,group,id,mount(x-.28,toolY,toolZ,scale),unlocked);
    renderer.box(x-.20,plateY,toolZ,.06,.09,.28,0x402c21,18);
    renderer.sphere(x-.241,plateY,toolZ,.028,.022,.023,unlocked?0x76cc99:0xe88053,6);
    if(!unlocked){
      renderer.draw('torus',mount(x-.345,toolY-.064,toolZ,.076,.075,.028),0xb5935e,1);
      renderer.box(x-.34,toolY-.112,toolZ,.085,.104,.124,0x9e7650,18);
      renderer.sphere(x-.391,toolY-.115,toolZ,.006,.014,.010,0x3c2b22,17);
    }
  }
}
