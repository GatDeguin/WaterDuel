import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter} from '../public/rendering/asset-rig.js';
import {shinFloorSupport} from '../public/physics/shin-geometry.js';

test('v4 reduced shin floor hull has the same minimum as every delivered wood/hardware vertex over dense rotations and depth offsets',async()=>{
  for(const variant of ['normal','boss']){
    const raw=await readFile(new URL(`../public/assets/characters/water-mannequin/v4/water-mannequin${variant==='boss'?'-boss':''}.glb`,import.meta.url));
    const c=prepareCharacter(parseGLB(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength))),scale=variant==='boss'?1.18:1;
    for(const [side,suffix] of [['front','R'],['back','L']]){
      const bone=c.bones.get('shin.'+suffix),frame=bone.sourceFrame,sourceLength=Math.hypot(...bone.sourceEnd.map((v,i)=>v-bone.sourceOrigin[i]))/c.source.authoredScale,cloud=[];
      for(const part of c.parts)if(part.boneName===bone.name)for(let i=0;i<part.positions.length;i+=3){
        const m=bone.worldMatrix,world=[0,1,2].map(k=>m[k]*part.positions[i]+m[k+4]*part.positions[i+1]+m[k+8]*part.positions[i+2]+m[k+12]-frame[k+12]);
        cloud.push([0,1,2].map(k=>(world[0]*frame[k*4]+world[1]*frame[k*4+1]+world[2]*frame[k*4+2])/c.source.authoredScale));
      }
      for(const depth of [0,-.13,.13]){
        const h=.55*scale,length=Math.hypot(h,depth),reduced=shinFloorSupport(variant,side,scale,depth,h);
        assert.ok(reduced.vertices.length<cloud.length/10,'the public support is a reduced hull, not the source mesh');
        for(let degree=0;degree<360;degree++){
          const angle=degree*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),y=([x,y,z])=>-x*scale*cos+(y*h/sourceLength-z*depth*scale/length)*sin;
          const fullMin=cloud.reduce((min,p)=>Math.min(min,y(p)),Infinity),hullMin=reduced.vertices.reduce((min,p)=>Math.min(min,y(p)),Infinity);
          assert.ok(Math.abs(fullMin-hullMin)<1e-8,`${variant}/${side}/depth${depth}/angle${degree}: ${fullMin} != ${hullMin}`);
        }
      }
    }
  }
});
