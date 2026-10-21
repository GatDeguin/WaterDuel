import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {containedWaterFrame} from '../public/physics/dimensions.js';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const meshHash=values=>sha256(Buffer.from(Float64Array.from(values).buffer));
export async function loadContained(path,{label='none',instrument=false,exposeTemplate=false,exposeReset=false}={}){
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  let code=source.replace("'./dimensions.js'",JSON.stringify(new URL('../public/physics/dimensions.js',import.meta.url).href))
    .replace("'./membrane.js'",JSON.stringify(new URL('../public/physics/membrane.js',import.meta.url).href));
  if(instrument){
    const anchor='const norm=(x,y,z)=>{const d=Math.hypot(x,y,z)||1;return [x/d,y/d,z/d];};';
    if(!code.includes(anchor))throw Error('Normalization instrument anchor missing');
    code=code.replace(anchor,anchor.replace('=>{','=>{globalThis.__containedNormCounts['+JSON.stringify(label)+']++;'));
    globalThis.__containedNormCounts??={};globalThis.__containedNormCounts[label]=0;
  }
  if(exposeTemplate)code+='\nexport {capTemplate};\n';
  if(exposeReset)code+='\nexport function resetContainedTemplates(){capTemplates.clear();}\n';
  code+=`\n// Isolated contained module identity: ${label}\n`;
  return {sourceHash:sha256(source),module:await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))};
}
export function containedCases(){
  const cases=[],fractions=[0,.001,.05,.2,.35,.5,.65,.8,.95,.999,1];
  for(const quality of ['eco','high','ultra'])for(let i=0;i<fractions.length;i++){
    cases.push({name:`fraction-${i}-${quality}`,head:{x:i%2?-1.75:1.75,y:2.4+(i-5)*.13,...(i%3===0?{}:{z:i%2?-.35:.35})},
      options:{quality,scale:[.7,1,1.16,1.8][i%4],frame:containedWaterFrame((i-5)*.11,i*.47,fractions[i])}});
  }
  // Fixed fill is the normal runtime path. Vary transport, scale, slosh and
  // clock while reusing each exact template; include camera-near world poses.
  for(const quality of ['eco','high','ultra'])for(let i=0;i<22;i++)cases.push({name:`motion-${i}-${quality}`,
    head:{x:(i-11)*.23,y:1.35+(i%7)*.27,z:i===0?-0:Math.sin(i)*.48},
    options:{quality,scale:[.5,1,1.16,2][i%4],frame:containedWaterFrame((i-11)*.037,i*.271,.65)}});
  cases.push({name:'default-arguments',head:{x:0,y:2.4},options:undefined});
  cases.push({name:'default-z-null',head:{x:-0,y:2.4,z:null},options:{quality:'high',scale:1}});
  cases.push({name:'negative-scale',head:{x:-0,y:2.4,z:0},options:{quality:'eco',scale:-1,frame:containedWaterFrame(.2,.3,.65)}});
  cases.push({name:'zero-scale',head:{x:0,y:2.4,z:-0},options:{quality:'eco',scale:0,frame:containedWaterFrame(0,0,.65)}});
  cases.push({name:'signed-zero-scale',head:{x:0,y:2.4,z:-0},options:{quality:'eco',scale:-0,frame:containedWaterFrame(-0,0,.65)}});
  cases.push({name:'nan-frame-height',head:{x:0,y:2.4,z:0},options:{quality:'eco',frame:{height:NaN,rotation:[1,0,0,0,1,0,0,0,1]}}});
  cases.push({name:'unknown-profile-compatibility',head:{x:0,y:2.4,z:0},options:{quality:'compat-profile',frame:containedWaterFrame(.1,.5,.65)}});
  return cases;
}
