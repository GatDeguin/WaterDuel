import test from 'node:test';
import assert from 'node:assert/strict';
import {fluidSolidColliders,resolveLiquidSolid} from '../public/physics/fluid-solids.js';

function depthRig({x=0,fromZ=0,toZ=0,angle=0}={}){
  const y=1;
  const shape=t=>{
    const turn=(2*t-1)*angle,c=Math.cos(turn),s=Math.sin(turn);
    return {center:{x,y,z:fromZ+(toZ-fromZ)*t},half:[.20,.06,.01],
      axes:[{x:c,y:s,z:0},{x:-s,y:c,z:0},{x:0,y:0,z:1}]};
  };
  return {
    q:[0,0,0,angle],previousQ:[0,0,0,-angle],swordLength:1,previousBodyDepth:fromZ,bodyDepth:toZ,
    pose:()=>({bodyFrames:{torso:{origin:{x,y}}}}),pointVelocity:()=>({x:0,y:0}),
    collisionPanels(){
      const {center,half,axes}=shape(1);
      const vertices=[-1,1].flatMap(u=>[-1,1].map(v=>({
        x:center.x+u*half[0]*axes[0].x+v*half[1]*axes[1].x,
        y:center.y+u*half[0]*axes[0].y+v*half[1]*axes[1].y,
      })));
      return [{body:'torso',key:'chest-front',center,axes,vertices,z:center.z,depth:2*half[2]}];
    },
    collisionSolidsAt(t){return [shape(t)];},
  };
}

for(const angle of [0,.15])test(`El agua recibe el barrido de una pieza que se mueve en Z con giro XY ${angle}`,()=>{
  const radius=.004,step=.02,timeFrom=.25,timeTo=.75;
  const fillers=Array.from({length:31},(_,index)=>({rig:depthRig({x:3+index})}));
  for(const dir of [-1,1]){
    const rig=depthRig({fromZ:-.2*dir,toZ:.2*dir,angle});
    const solids=fluidSolidColliders([...fillers,{rig}],step);
    const moving=solids[31],origin={x:0,y:1,z:0};
    assert.equal(solids.length,32);
    for(const t of [timeFrom,timeTo]){
      const {center,half}=moving.motionAt(t);
      assert.ok(Math.abs(center.z-origin.z)>half[2]+radius,'los extremos del tramo están libres');
    }
    const resolve=(candidates,from)=>{
      const parcel={...from,vx:0,vy:0,vz:0,volume:1e-7};
      resolveLiquidSolid(parcel,from,radius,step*(timeTo-timeFrom),candidates,{timeFrom,timeTo});
      assert.equal(parcel.volume,1e-7);
      return parcel;
    };
    const parcel=resolve(solids,origin);
    assert.ok(Math.abs(parcel.vz-dir*1.04*.4/step)<1e-10,'la cara móvil aporta su velocidad real en Z');
    assert.ok(dir*parcel.z>0,'el contacto ocurre entre los extremos');
    assert.deepEqual(parcel,resolve(solids.slice(),origin),'el índice incluye el barrido del bit 31');
    const free={x:0,y:1,z:.31*dir};
    assert.deepEqual(resolve(solids,free),{...free,vx:0,vy:0,vz:0,volume:1e-7});
  }
});
