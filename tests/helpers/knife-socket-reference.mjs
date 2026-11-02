import assert from 'node:assert/strict';

// Independent, test-only reference for the straight workshop dagger. No imports
// from the renderer, equipment catalogue, GLB parser or deformation helpers.
// This evaluates binary32 INPUT DATA in JS binary64. It neither executes nor
// bounds the additional arithmetic of a GPU vertex shader or its view matrix.
const NOMINAL=.42,START=.09,END=.42,ALIGNMENT=1e-7,U64=Number.EPSILON/2;
const IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const gamma=n=>n*U64/(1-n*U64);
const clamp=n=>Math.max(0,Math.min(1,n));
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const absoluteDot=(m,p,i)=>Math.abs(m[i]*p[0])+Math.abs(m[i+4]*p[1])+Math.abs(m[i+8]*p[2])+Math.abs(m[i+12]);
function vector(value,label){
  const result=Array.isArray(value)||ArrayBuffer.isView(value)?Array.from(value):[value?.x,value?.y,value?.z??0];
  assert.ok(result.length===3&&result.every(Number.isFinite),`${label} must contain three finite coordinates`);
  return result;
}
function exactVector(actual,expected,label){assert.deepEqual(Array.from(actual??[]),expected,label);}
function identityNode(node,label){
  if(node.matrix!==undefined){
    exactVector(node.matrix,IDENTITY,label);
    assert.ok(node.translation===undefined&&node.rotation===undefined&&node.scale===undefined,label);
  }else{
    exactVector(node.translation??[0,0,0],[0,0,0],label);
    exactVector(node.rotation??[0,0,0,1],[0,0,0,1],label);
    exactVector(node.scale??[1,1,1],[1,1,1],label);
  }
}
function canonicalSocket(asset){
  const raw=asset.json.nodes,indices=raw.flatMap((node,i)=>node.name==='Socket_Strike'?[i]:[]);
  assert.equal(indices.length,1,'canonical socket must be unique');
  const index=indices[0],node=raw[index],parsed=asset.nodes[index],expected=[0,Math.fround(NOMINAL),0];
  assert.equal(node.matrix,undefined,'canonical socket uses translation only');
  exactVector(node.translation,expected,'canonical socket translation');
  exactVector(node.rotation??[0,0,0,1],[0,0,0,1],'canonical socket rotation');
  exactVector(node.scale??[1,1,1],[1,1,1],'canonical socket scale');
  // Traverse AUTHORING parents, rather than trusting parser parent indices to
  // prove their own correctness. Nonidentity parents require a separate bound.
  let child=index;const seen=new Set([child]);
  for(;;){
    const parents=raw.flatMap((parent,i)=>parent.children?.includes(child)?[i]:[]);
    assert.ok(parents.length<=1,'identity parent hierarchy must be a tree');
    const parent=parents[0]??-1;
    assert.equal(asset.nodes[child].parentIndex,parent,'identity parent parser index');
    if(parent<0)break;
    assert.ok(!seen.has(parent),'identity parent hierarchy must be acyclic');seen.add(parent);
    identityNode(raw[parent],'identity parent authoring transform');
    exactVector(asset.nodes[parent].localMatrix,IDENTITY,'identity parent parsed local transform');
    exactVector(asset.nodes[parent].worldMatrix,IDENTITY,'identity parent parsed world transform');
    child=parent;
  }
  const expectedMatrix=IDENTITY.slice();expectedMatrix.splice(12,3,...expected);
  assert.ok(parsed.worldMatrix instanceof Float32Array,'canonical socket world matrix must be Float32Array');
  exactVector(parsed.localMatrix,expectedMatrix,'canonical socket parsed local transform');
  exactVector(parsed.worldMatrix,expectedMatrix,'canonical socket parsed world transform');
  return Array.from(parsed.worldMatrix.subarray(12,15));
}
function independentFrame(hand,tip){
  const delta=tip.map((v,i)=>v-hand[i]),length=Math.hypot(...delta);
  assert.ok(length>1e-9&&Number.isFinite(length),'reference requires a finite nondegenerate dagger');
  const normalize=(v,fallback)=>{
    const n=Math.hypot(...v);return n>1e-9?v.map(c=>c*(1/n)):fallback;
  };
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const y=normalize(delta,[0,1,0]),x=normalize(cross(y,[0,0,1]),[1,0,0]),z=normalize(cross(x,y),[0,0,1]);
  return {matrix:new Float64Array([...x,0,...y,0,...z,0,...hand,1]),extension:length-NOMINAL};
}
function halfULP32(value){
  assert.ok(Number.isFinite(value)&&Number.isFinite(Math.fround(value)),'finite binary32 representation required');
  // Exact zero has no input rounding error. 2^-150 also covers subnormal F32.
  return value===0?0:Math.max(2**-150,2**(Math.floor(Math.log2(Math.abs(value)))-24));
}
function deformEvaluation64(y,a,b,extension){
  // Three rounded operations form r=(y-a)/(b-a). Clamp is 1-Lipschitz.
  // Then one product and one addition form D=y+extension*clamp(r).
  const ratio=(y-a)/(b-a);
  assert.ok(Number.isFinite(ratio),'finite deformation intermediates required');
  return Math.abs(extension)*Math.min(1,gamma(3)*Math.abs(ratio))+
    U64*Math.abs(extension)+U64*(Math.abs(y)+(1+U64)*Math.abs(extension));
}
function localErrorBound(socket,extension){
  const ey=halfULP32(NOMINAL),ea=halfULP32(START),eb=halfULP32(END),ee=halfULP32(extension);
  const spanMin=(END-START)-ea-eb;
  assert.ok(spanMin>1e-5,'deformation interval must remain above the shader span floor');
  // For t=clamp((y-a)/(b-a)), globally, including either clamp boundary:
  // |dt| <= (ey + max(ea,eb))/spanMin. Sensitivities to a,b have weights
  // (1-t),t, so their worst weighted input error is max(ea,eb).
  // |dD| <= ey + |t|*ee + (|extension|+ee)*|dt|.
  const t=clamp((NOMINAL-START)/(END-START));
  const socketBound=ey+(Math.abs(extension)+ee)*ey/spanMin;
  const uniforms=Math.abs(t)*ee+(Math.abs(extension)+ee)*Math.max(ea,eb)/spanMin;
  const evaluation=deformEvaluation64(NOMINAL,START,END,extension)+
    deformEvaluation64(socket[1],Math.fround(START),Math.fround(END),Math.fround(extension));
  return {socket:socketBound,uniforms,evaluation,point:[0,socketBound+uniforms+evaluation,0]};
}

/**
 * Actual local points are supplied by the production deformation function:
 * localPoint64 uses [0,.42,0] and original uniforms; localPoint32 uses the
 * parsed socket and fround(start/end/extension). Expected data come only from
 * the physical pose and the canonical contract above, never from those points.
 */
export function assertKnifeSocketContract({asset,hand,tip,transform,localPoint64,localPoint32}){
  hand=vector(hand,'hand');tip=vector(tip,'tip');
  localPoint64=vector(localPoint64,'F64 local point');localPoint32=vector(localPoint32,'Float32-data local point');
  const socket=canonicalSocket(asset),reference=independentFrame(hand,tip),matrix64=reference.matrix;
  assert.ok(transform.flexOffset===0&&transform.flexLength===0,'unsupported flex in straight-dagger reference');
  for(const [field,expected] of Object.entries({deformStart:START,deformEnd:END,extension:reference.extension,stretchAlong:1+reference.extension/(END-START)})){
    assert.equal(transform[field],expected,`deformation contract: ${field}`);
  }
  const idealLocal=[0,NOMINAL+reference.extension,0],idealEndpoint=point(matrix64,idealLocal);
  const geometryEndpoint=point(matrix64,localPoint64);
  for(let i=0;i<3;i++){
    assert.ok(Math.abs(geometryEndpoint[i]-tip[i])<ALIGNMENT,`F64 alignment component ${i}`);
    assert.ok(Math.abs(idealEndpoint[i]-tip[i])<ALIGNMENT,`F64 alignment independent reference component ${i}`);
  }
  const matrix32=transform.matrix;
  assert.ok(matrix32 instanceof Float32Array&&matrix32.length===16,'submitted matrix must be Float32Array(16)');
  for(let i=0;i<16;i++)assert.equal(matrix32[i],Math.fround(matrix64[i]),`matrix coefficient ${i} must equal fround(independent reference)`);
  const quantizedEndpoint=point(matrix32,localPoint32),localBound=localErrorBound(socket,reference.extension);
  const rows=[0,1,2].map(i=>{
    let matrixTerm=0,pointTerm=0;
    for(let j=0;j<3;j++){
      const coefficient=matrix64[j*4+i],dm=halfULP32(coefficient);
      matrixTerm+=Math.abs(idealLocal[j])*dm;
      pointTerm+=(Math.abs(coefficient)+dm)*localBound.point[j];
    }
    const translation=halfULP32(matrix64[12+i]);
    // Each affine dot product has at most four products and three additions.
    const evaluation=gamma(7)*(absoluteDot(matrix64,idealLocal,i)+absoluteDot(matrix32,localPoint32,i));
    const bound=matrixTerm+pointTerm+translation+evaluation,error=quantizedEndpoint[i]-idealEndpoint[i];
    assert.ok(Number.isFinite(bound)&&Number.isFinite(error)&&Math.abs(error)<=bound,
      `Float32 data bound component ${i}: |${error}| > ${bound}`);
    return {component:i,error,bound,matrixTerm,pointTerm,translation,evaluation,geometryResidual:idealEndpoint[i]-tip[i]};
  });
  return {geometryEndpoint,idealEndpoint,quantizedEndpoint,localBound,rows};
}
