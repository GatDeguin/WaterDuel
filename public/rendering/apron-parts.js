import {APRON_GEOMETRY} from '../physics/apron-geometry.js';

// This is an asset preparation step, not a cloth solver. Connectivity is welded
// for classification only; the original UV seams, normals and vertex data remain.
const isCloth=p=>p.boneName==='pelvis'&&/Woven_(?:Sash|Cloth)/i.test(p.nodeName);
const isBrass=p=>p.boneName==='pelvis'&&/Brass/i.test(p.nodeName);
const emptyBounds=()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
function include(bounds,p){for(let a=0;a<3;a++){bounds.min[a]=Math.min(bounds.min[a],p[a]);bounds.max[a]=Math.max(bounds.max[a],p[a]);}}
function canonicalPositions(part,bones,source){
  const m=bones.get(part.boneName)?.worldMatrix,scale=source.authoredScale;
  if(!m||!m.every(Number.isFinite)||!Number.isFinite(scale)||scale<=0||!source.hip?.every(Number.isFinite))throw new Error('Apron requires finite source frame and scale');
  const positions=new Float64Array(part.positions.length);
  for(let v=0;v<positions.length;v+=3)for(let a=0;a<3;a++)positions[v+a]=(m[a]*part.positions[v]+m[a+4]*part.positions[v+1]+m[a+8]*part.positions[v+2]+m[a+12]-source.hip[a])/scale;
  return positions;
}
function boundsOf(positions,indices){
  const result=emptyBounds();for(const v of indices)include(result,positions.subarray(v*3,v*3+3));return result;
}
function connectedTriangles(part,positions){
  const parents=Int32Array.from({length:part.indices.length/3},(_,i)=>i),owners=new Map();
  const root=t=>{while(parents[t]!==t){parents[t]=parents[parents[t]];t=parents[t];}return t;};
  for(let t=0;t<parents.length;t++)for(let k=0;k<3;k++){
    const v=part.indices[t*3+k]*3,key=[0,1,2].map(a=>Math.round(positions[v+a]*1e6)).join(',');
    if(owners.has(key))parents[root(t)]=root(owners.get(key));else owners.set(key,t);
  }
  const components=new Map();
  for(let t=0;t<parents.length;t++){
    const key=root(t);if(!components.has(key))components.set(key,[]);
    components.get(key).push(part.indices[t*3],part.indices[t*3+1],part.indices[t*3+2]);
  }
  return components.values();
}
function subset(part,selected,apron){
  if(selected.length===part.indices.length)return part.accessory===(apron?'apron':undefined)?part:{...part,accessory:apron?'apron':undefined};
  const remap=new Map(),indices=[],attributes={positions:[],normals:[],uv:[],uv1:[],colors:[]};
  for(const old of selected){
    if(!remap.has(old)){
      remap.set(old,remap.size);
      for(const [name,width] of [['positions',3],['normals',3],['uv',2],['uv1',2],['colors',4]])if(part[name])attributes[name].push(...part[name].subarray(old*width,old*width+width));
    }
    indices.push(remap.get(old));
  }
  const result={...part,indices:new Uint32Array(indices),accessory:apron?'apron':undefined};
  for(const name of Object.keys(attributes))result[name]=part[name]?new part[name].constructor(attributes[name]):part[name];
  return result;
}
const contains=(outer,inner)=>[0,1,2].every(a=>inner.min[a]>=outer.min[a]&&inner.max[a]<=outer.max[a]);

/** Positions remain bone-local. The descriptor alone uses canonical world axes,
 * relative to the hip and divided by authoredScale. Never mutate source parts. */
export function splitApronParts(parts,bones,source){
  const fabric=parts.filter(isCloth),report={brassComponents:0,apronBrassComponents:0,clothTriangles:0,apronTriangles:0};
  if(!fabric.length)return {parts:[...parts],descriptor:null,report};
  const clothBounds=emptyBounds();
  for(const p of fabric){
    const vertices=canonicalPositions(p,bones,source);
    const bounds=boundsOf(vertices,p.indices);include(clothBounds,bounds.min);include(clothBounds,bounds.max);
  }
  // Authored trim protrudes slightly past the cloth. Requiring containment of
  // each whole connected component prevents any waistband/buckle being clipped.
  const region={min:[clothBounds.min[0]-.012,clothBounds.min[1]-.009,clothBounds.min[2]-.006],
    max:[clothBounds.max[0]+.012,clothBounds.max[1]+.006,clothBounds.max[2]+.020]};
  const output=[];
  for(const p of parts){
    if(isCloth(p)){
      output.push(subset(p,p.indices,true));report.clothTriangles+=p.indices.length/3;continue;
    }
    if(!isBrass(p)){output.push(p);continue;}
    const vertices=canonicalPositions(p,bones,source);
    const attached=[],fixed=[];
    for(const component of connectedTriangles(p,vertices)){
      const apron=contains(region,boundsOf(vertices,component));report.brassComponents++;
      if(apron)report.apronBrassComponents++;
      const target=apron?attached:fixed;for(const index of component)target.push(index);
    }
    if(fixed.length)output.push(subset(p,fixed,false));
    if(attached.length)output.push(subset(p,attached,true));
  }
  const bounds=emptyBounds();
  for(const p of output)if(p.accessory==='apron'){
    const vertices=canonicalPositions(p,bones,source),partBounds=boundsOf(vertices,p.indices);
    include(bounds,partBounds.min);include(bounds,partBounds.max);report.apronTriangles+=p.indices.length/3;
  }
  const model=APRON_GEOMETRY[fabric.some(p=>/Boss/i.test(p.nodeName))?'boss':'normal'];
  const sourceTorsoFrame=Array.from(source.torsoFrame);
  for(let a=0;a<3;a++){
    sourceTorsoFrame[a]/=source.authoredScale;sourceTorsoFrame[a+4]/=source.authoredScale;
    sourceTorsoFrame[a+12]=(sourceTorsoFrame[a+12]-source.hip[a])/source.authoredScale;
  }
  const descriptor={space:model.space,pivot:[0,clothBounds.max[1],model.pivot[2]],bounds,
    sourceHip:source.hip.map(v=>v/source.authoredScale),sourceTorsoFrame,
    corners:Array.from({length:8},(_,i)=>[0,1,2].map(a=>bounds[(i>>a)&1?'max':'min'][a]))};
  return {parts:output,descriptor,report};
}
