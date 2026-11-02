import {APRON_TRIANGLES,apronRestGrid,apronSurfaceSample} from '../physics/apron-cloth.js';
import {apronPoint} from '../physics/apron.js';

const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);};
function inverse(m){
  const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10],det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  const n=new Float64Array([(e*i-f*h)/det,(f*g-d*i)/det,(d*h-e*g)/det,0,(c*h-b*i)/det,(a*i-c*g)/det,(b*g-a*h)/det,0,(b*f-c*e)/det,(c*d-a*f)/det,(a*e-b*d)/det,0,0,0,0,1]);
  const p=apronPoint(n,[m[12],m[13],m[14]]);for(let k=0;k<3;k++)n[k+12]=-p[k];return n;
}
const widths={positions:3,normals:3,uv:2,uv1:2,colors:4};
function interpolate(a,b,t){
  const value={};for(const key of Object.keys(a))value[key]=a[key].map((v,i)=>v+(b[key][i]-v)*t);return value;
}
function clip(polygon,a,b){
  const distance=p=>(b[0]-a[0])*(p.canonical[1]-a[1])-(b[1]-a[1])*(p.canonical[0]-a[0]);
  const output=[];let previous=polygon.at(-1),dp=distance(previous);
  for(const vertex of polygon){
    const d=distance(vertex),inside=d>=-1e-12,wasInside=dp>=-1e-12;
    if(inside!==wasInside)output.push(interpolate(previous,vertex,dp/(dp-d)));
    if(inside)output.push(vertex);previous=vertex;dp=d;
  }
  return output;
}

/** Clip only the hanging surface into the twelve solver triangles at load.
 * Attributes, including material-selected UV1, are interpolated at cut edges.
 * The existing PBR pipeline consumes CPU-deformed positions and normals while
 * UV attributes and topology stay immutable. No shader extension or offset. */
export function prepareApronDeformation(parts,descriptor){
  if(!descriptor)return parts;
  const rest=apronRestGrid(descriptor),output=[];
  for(const part of parts){
    if(part.accessory!=='apron'){output.push(part);continue;}
    const minY=Math.min(...Array.from(part.positions).filter((_,i)=>i%3===1)),maxY=Math.max(...Array.from(part.positions).filter((_,i)=>i%3===1));
    const groups=APRON_TRIANGLES.map(()=>({indices:[],positions:[],normals:[],uv:[],uv1:[],colors:[]}));
    const vertex=v=>{
      const result={};for(const [key,width] of Object.entries(widths))if(part[key])result[key]=Array.from(part[key].subarray(v*width,v*width+width));
      result.canonical=apronPoint(part.apronFromBone,result.positions);return result;
    };
    for(let i=0;i<part.indices.length;i+=3){
      const original=[0,1,2].map(k=>vertex(part.indices[i+k]));
      for(let panel=0;panel<12;panel++){
        const triangle=APRON_TRIANGLES[panel].map(i=>rest[i]);let polygon=original;
        for(let edge=0;edge<3&&polygon.length;edge++)polygon=clip(polygon,triangle[edge],triangle[(edge+1)%3]);
        if(polygon.length<3)continue;
        const group=groups[panel];
        for(let j=1;j<polygon.length-1;j++){
          const vertices=[polygon[0],polygon[j],polygon[j+1]],area=cross(sub(vertices[1].positions,vertices[0].positions),sub(vertices[2].positions,vertices[0].positions));
          if(Math.hypot(...area)<1e-12)continue;
          for(const v of vertices){
            group.indices.push(group.positions.length/3);
            for(const key of Object.keys(widths))if(v[key])group[key].push(...(key==='normals'?unit(v[key]):v[key]));
          }
        }
      }
    }
    for(let panel=0;panel<12;panel++){
      const group=groups[panel];if(!group.indices.length)continue;
      const prepared={...part,apronPanel:panel,apronWetBounds:[minY,maxY],indices:new Uint32Array(group.indices)};
      for(const key of Object.keys(widths))prepared[key]=part[key]?new Float32Array(group[key]):null;
      output.push(prepared);
    }
  }
  return output;
}

/** v4 geometry is evaluated in world coordinates, so its model transform is
 * identity (or a fragment delta). Old snapshots keep the explicit hinge path. */
export function deformApronPart(part,snapshot){
  const cloth=snapshot?.cloth;if(cloth?.revision!==4||part.apronPanel===undefined)return null;
  return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
}

const geometryCache=new WeakMap(),canonicalCache=new WeakMap();
export function deformApronGeometry(part,snapshot){
  const cloth=snapshot?.cloth;if(cloth?.revision!==4||part.apronPanel===undefined)return null;
  let cache=geometryCache.get(snapshot);if(!cache){cache=new WeakMap();geometryCache.set(snapshot,cache);}if(cache.has(part))return cache.get(part);
  let canonical=canonicalCache.get(part);
  if(!canonical){
    const positions=[],normals=[],inv=inverse(part.apronFromBone);
    for(let v=0;v<part.positions.length;v+=3){
      positions.push(apronPoint(part.apronFromBone,part.positions.subarray(v,v+3)));
      const n=part.normals.subarray(v,v+3);normals.push(unit([inv[0]*n[0]+inv[1]*n[1]+inv[2]*n[2],inv[4]*n[0]+inv[5]*n[1]+inv[6]*n[2],inv[8]*n[0]+inv[9]*n[1]+inv[10]*n[2]]));
    }
    canonical={positions,normals};canonicalCache.set(part,canonical);
  }
  const positions=new Float32Array(part.positions.length),normals=new Float32Array(part.normals.length),scale=Math.hypot(snapshot.canonicalMatrix[8],snapshot.canonicalMatrix[9],snapshot.canonicalMatrix[10]);
  for(let i=0;i<canonical.positions.length;i++){
    const sample=apronSurfaceSample(cloth,canonical.positions[i],part.apronPanel,scale),n=canonical.normals[i],cx=cross(sample.dy,sample.dz),cy=cross(sample.dz,sample.dx),cz=cross(sample.dx,sample.dy);
    const determinant=sample.dx.reduce((sum,v,k)=>sum+v*cx[k],0),sign=determinant<0?-1:1;
    let normal=[0,1,2].map(k=>sign*(cx[k]*n[0]+cy[k]*n[1]+cz[k]*n[2]));if(Math.hypot(...normal)<1e-10)normal=sample.director;
    positions.set(sample.position,i*3);normals.set(unit(normal),i*3);
  }
  const geometry={...part,positions,normals};cache.set(part,geometry);return geometry;
}

const emblemBindings=new WeakMap();
/** All panels project the same full-size emblem in bind coordinates. Each
 * retains its own material anchors and follows its own physical matrix. */
export function apronEmblemBindings(prepared,owner){
  const cached=emblemBindings.get(owner);if(cached?.prepared===prepared)return cached;
  const bindings=[];let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  prepared.parts.forEach((part,index)=>{
    if(part.accessory!=='apron'||!/Woven_(?:Sash|Cloth)/.test(part.nodeName))return;
    bindings.push({part,index,owner:{}});
    for(let i=0;i<part.positions.length;i+=3){minX=Math.min(minX,part.positions[i]);maxX=Math.max(maxX,part.positions[i]);minY=Math.min(minY,part.positions[i+1]);maxY=Math.max(maxY,part.positions[i+1]);}
  });
  const center=[(minX+maxX)/2,minY+(maxY-minY)*.3],scale=[(maxX-minX)*.24,(maxY-minY)*.12];
  for(const binding of bindings){binding.center=center;binding.scale=scale;}
  // Project over the whole bind surface: projecting strips one panel at a time
  // would discard every strip straddling a cut. Each resulting material anchor
  // still carries the index of its own physical panel for transformation.
  const positions=[],indices=[],partIndices=[];
  for(const {part,index} of bindings){
    const offset=positions.length/3;positions.push(...part.positions);
    for(const vertex of part.indices??Array.from({length:part.positions.length/3},(_,i)=>i))indices.push(offset+vertex);
    for(let i=0;i<part.positions.length/3;i++)partIndices.push(index);
  }
  const result={prepared,panels:bindings,surface:{positions:new Float32Array(positions),indices:new Uint32Array(indices),partIndices:new Uint32Array(partIndices),center,scale,owner:{}}};
  emblemBindings.set(owner,result);return result;
}

export function deformApronEmblem(binding,snapshot){
  if(snapshot?.cloth?.revision!==4)return null;
  if(binding.liveSnapshot===snapshot)return binding.livePositions;
  const positions=new Float32Array(binding.surface.positions.length);let offset=0;
  for(const {part} of binding.panels){const geometry=deformApronGeometry(part,snapshot)??part;positions.set(geometry.positions,offset);offset+=geometry.positions.length;}
  binding.liveSnapshot=snapshot;binding.livePositions=positions;return positions;
}
