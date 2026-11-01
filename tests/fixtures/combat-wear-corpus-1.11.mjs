import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseGLB} from '../../public/rendering/glb.js';
import {prepareEquipment,deformEquipmentPoint} from '../../public/rendering/asset-rig.js';
import {equipmentBody} from '../../public/rendering/joint-damage.js';

export const WEAR_REFERENCE_SHA='596af1bdcd1ca980979ddf1853e764073f20b6164e7cd03d5c7381b417238d2b';
export async function projectionModule(reference=false){
  const url=new URL(reference?'combat-wear-reference-1.10.js':'../../public/rendering/combat-wear.js',import.meta.url),source=await fs.readFile(url,'utf8');
  if(reference&&createHash('sha256').update(source).digest('hex')!==WEAR_REFERENCE_SHA)throw Error('Frozen wear reference changed');
  let linked=source;
  for(const name of ['joint-damage','asset-rig'])linked=linked.replace(`'./${name}.js'`,JSON.stringify(new URL(`../../public/rendering/${name}.js`,import.meta.url).href));
  // A test-only export observes the selected triangle and barycentric polygon.
  // The pinned implementation and all of its arithmetic remain unchanged.
  return import('data:text/javascript;base64,'+Buffer.from(linked+'\nexport {project as projectForOracle};').toString('base64'));
}
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function matrix(side,angle){const c=Math.cos(angle),s=Math.sin(angle);return new Float64Array([side*c,side*s,0,0,-s,c,0,0,0,0,side,0,side*.7,1.6,.17,1]);}
export async function wearCorpus(){
  const corpus=[];
  for(const id of ['sword','spear','axe','maul','short','long','knife']){
    const bytes=await fs.readFile(new URL(`../../public/assets/equipment/workshop/v2/${id}.glb`,import.meta.url)),asset=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),prepared=prepareEquipment(asset,id);
    for(const side of [1,-1])for(const flex of [0,.07,-.06]){
      const transform={matrix:matrix(side,side*.41),extension:flex===0?0:flex*.4,deformStart:.05,deformEnd:.8,flexOffset:['sword','spear'].includes(id)?flex:0,flexLength:1.2,flexDirection:side};
      const geometry={equipment:[{prepared,materials:asset.materials,transform}]},body=equipmentBody(id),key=['short','long'].includes(id)?'guard':id;
      const fighter={slot:side===1?1:2,pose:{surface:{marks:[]},joints:{}}};
      for(const partIndex of [0,Math.floor(prepared.parts.length/2),prepared.parts.length-1]){
        const part=prepared.parts[partIndex];
        for(const fraction of [.11,.53,.89]){
          const at=Math.floor((part.indices.length/3-1)*fraction)*3,indices=Array.from(part.indices.subarray(at,at+3));
          const vertices=indices.map(i=>point(transform.matrix,deformEquipmentPoint(part.positions.subarray(i*3,i*3+3),transform))),[a,b,c]=vertices;
          const normal=cross(b.map((v,i)=>v-a[i]),c.map((v,i)=>v-a[i])),length=Math.hypot(...normal);if(length<1e-10)continue;for(let i=0;i<3;i++)normal[i]/=length;
          const center=a.map((v,i)=>(v+b[i]+c[i])/3),position=Object.fromEntries(['x','y','z'].map((name,i)=>[name,center[i]-normal[i]*.002]));
          const mark={id:1,body,key,position,normal:Object.fromEntries(['x','y','z'].map((name,i)=>[name,normal[i]])),tangent:{x:1,y:0,z:0},length:.012,impulse:.12,anchor:{partIndex,at}};
          corpus.push({label:`${id}/${side}/${flex}/${partIndex}/${fraction}`,fighter,geometry,mark});
        }
      }
    }
  }
  return corpus;
}
export function patchValue(patch){if(!patch)return null;const {kind,partIndex,indices,polygon,normalSign,distance,material}=patch;return {kind,partIndex,indices,polygon,normalSign,distance,material};}
export function drawLog(api,entry,{owner={},generation=1,transform=null}={}){
  const draws=[],capture=(kind,mesh,color,material,opacity,order)=>draws.push({kind,p:Array.from(mesh.p),n:Array.from(mesh.n),color,material,opacity,order});
  const renderer={flushDynamic:item=>capture('opaque',item.mesh,item.color,item.material,item.opacity),dynamicDraw:(mesh,...args)=>capture('pending',mesh,...args)};
  const result=api.drawCombatWear(renderer,{...entry.fighter,pose:{...entry.fighter.pose,surface:{marks:[entry.mark]}}},{geometry:entry.geometry,owner,generation,transform});
  return {result,draws};
}
