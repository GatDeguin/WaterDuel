// KHR_materials_sheen input semantics / Charlie and inexpensive Neubelt visibility:
// https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_sheen
//
// Approximation, not the Khronos Charlie-visibility LUT: this local 17x12 table
// integrates *our Neubelt BRDF* over 128 cosine bins x 256 azimuth bins. View
// nodes are (i/16)^2 and roughness nodes .07 + j*.93/11. Bilinear interpolation
// uses a 6% margin + .0005. Roughness is floored at .07 for finite pixel lobes.
// Neubelt can exceed unit directional albedo; a symmetric lobe normalization
// and albedo scaling guard against that excess. This is a measured conservative
// approximation, not an exact analytic conservation proof or prefiltered IBL.
// Tests integrate the resulting layer + a white Lambert base independently.
// Sheen color texture RGB is sRGB; roughness texture uses linear alpha.
// The factors below remain linear; clearcoat must be applied above this layer.

const clamp=x=>Math.max(0,Math.min(1,x));
const max3=color=>Math.max(...color);
const scalar=(x,label)=>{if(typeof x!=='number'||!Number.isFinite(x))throw new Error('sheen: '+label+' must be finite');return clamp(x);};
function textureInfo(info){
  if(info==null)return null;
  if(!Number.isInteger(info.index)||info.index<0||![0,1].includes(info.texCoord??0))throw new Error('sheen: invalid texture index or UV');
  return {index:info.index,texCoord:info.texCoord??0,extensions:info.extensions??{}};
}

export function materialSheen(material){
  const extension=material?.extensions?.KHR_materials_sheen??{},color=extension.sheenColorFactor??[0,0,0];
  if((!Array.isArray(color)&&!ArrayBuffer.isView(color))||color.length!==3)throw new Error('sheen: color must have three components');
  return {color:Float32Array.from(color,x=>scalar(x,'color')),roughness:scalar(extension.sheenRoughnessFactor??0,'roughness'),
    colorTexture:textureInfo(extension.sheenColorTexture),roughnessTexture:textureInfo(extension.sheenRoughnessTexture)};
}

const ALBEDO=[
  5.7193779,4.9668084,3.6868430,2.4522747,1.4531555,0.7523410,0.3300500,0.1175136,0.0320057,0.0061457,0.0007419,0.0000476,0.0000013,0.0000000,0.0000000,0.0000000,0.0000000,
  2.6272112,2.4405832,2.0891942,1.6979338,1.3152416,0.9690643,0.6753735,0.4413845,0.2672277,0.1473692,0.0722831,0.0304471,0.0104264,0.0026429,0.0004119,0.0000243,0.0000000,
  1.7389431,1.6512757,1.4807940,1.2824543,1.0774455,0.8784186,0.6936179,0.5284988,0.3864353,0.2690501,0.1764038,0.1071647,0.0588179,0.0279442,0.0105699,0.0025724,0.0001083,
  1.3266770,1.2735206,1.1687523,1.0445958,0.9131916,0.7816527,0.6546227,0.5353320,0.4260933,0.3285426,0.2437556,0.1723033,0.1142790,0.0693157,0.0366059,0.0149299,0.0026987,
  1.0939046,1.0567501,0.9831270,0.8951871,0.8010886,0.7054784,0.6113006,0.5205658,0.4347282,0.3548825,0.2818706,0.2163388,0.1587685,0.1094895,0.0686852,0.0363910,0.0124897,
  0.9475170,0.9190678,0.8626175,0.7950051,0.7223158,0.6479241,0.5738896,0.5015596,0.4318705,0.3655104,0.3030120,0.2448070,0.1912602,0.1426894,0.0993787,0.0615862,0.0295495,
  0.8489136,0.8257163,0.7797174,0.7246199,0.6653026,0.6044106,0.5435019,0.4835453,0.4251720,0.3688122,0.3147746,0.2632948,0.2145654,0.1687562,0.1260290,0.0865478,0.0504889,
  0.7792263,0.7594369,0.7202601,0.6733959,0.6229631,0.5711550,0.5192244,0.4679129,0.4176680,0.3687617,0.3213589,0.2755592,0.2314226,0.1889867,0.1482780,0.1093209,0.0721437,
  0.7281689,0.7107142,0.6762305,0.6350615,0.5908182,0.5453964,0.4998525,0.4547856,0.4105296,0.3672595,0.3250514,0.2839190,0.2438352,0.2047456,0.1665764,0.1292389,0.0926312,
  0.6896840,0.6738976,0.6427775,0.6057065,0.5659401,0.5251692,0.4843180,0.4438919,0.4041534,0.3652174,0.3271062,0.2897814,0.2531628,0.2171384,0.1815697,0.1462909,0.1111100,
  0.6599949,0.6454413,0.6168126,0.5827858,0.5463583,0.5090742,0.4717652,0.4348736,0.3986153,0.3630677,0.3282211,0.2940066,0.2603134,0.2269963,0.1938781,0.1607458,0.1273540,
  0.6366405,0.6230235,0.5962906,0.5645855,0.5307124,0.4961067,0.4615334,0.4273909,0.3938639,0.3610069,0.3287908,0.2971302,0.2658976,0.2349304,0.2040305,0.1729592,0.1414450
];
const MIN_ROUGHNESS=.07,ALBEDO_MARGIN=1.06,ALBEDO_FLOOR=.0005;
const safeRoughness=r=>Math.max(MIN_ROUGHNESS,Math.min(1,r));
function directionalAlbedo(cosine,roughness){
  const x=Math.sqrt(clamp(cosine))*16,y=(safeRoughness(roughness)-MIN_ROUGHNESS)*11/.93;
  const xi=Math.min(15,Math.floor(x)),yi=Math.min(10,Math.floor(y)),fx=x-xi,fy=y-yi;
  const a=ALBEDO[yi*17+xi]*(1-fx)+ALBEDO[yi*17+xi+1]*fx;
  const b=ALBEDO[(yi+1)*17+xi]*(1-fx)+ALBEDO[(yi+1)*17+xi+1]*fx;
  return (a*(1-fy)+b*fy)*ALBEDO_MARGIN+ALBEDO_FLOOR;
}

// CPU reference for numerical energy/reciprocity checks; same table as GLSL.
// N, V, L must be unit vectors. Output already includes max(dot(N,L),0).
export function sheenBrdf(N,V,L,color,roughness){
  const strength=max3(color);if(strength<=0)return [0,0,0];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],nv=clamp(dot(N,V)),nl=clamp(dot(N,L));
  if(nv<=0||nl<=0)return [0,0,0];
  const h=[V[0]+L[0],V[1]+L[1],V[2]+L[2]],length=Math.hypot(...h);
  if(length<1e-8)return [0,0,0];
  const nh=clamp(dot(N,h)/length),r=safeRoughness(roughness),inv=1/(r*r);
  const distribution=(2+inv)*Math.pow(Math.max(0,1-nh*nh),inv*.5)/(2*Math.PI);
  const visibility=1/Math.max(4*(nl+nv-nl*nv),1e-8);
  const normalization=Math.max(1,directionalAlbedo(nv,r),directionalAlbedo(nl,r));
  const value=distribution*visibility*nl/normalization;
  return color.map(c=>clamp(c)*value);
}

export function sheenBaseScale(color,nv,nl,roughness){
  const strength=clamp(max3(color));if(strength<=0)return 1;
  return clamp(1-strength*Math.max(clamp(directionalAlbedo(nv,roughness)),clamp(directionalAlbedo(nl,roughness))));
}

export const SHEEN_GLSL=`
const float wdSheenAlbedo[204]=float[204](
${ALBEDO.map(x=>x.toFixed(7)).join(',')}
);
float wdSheenMax(vec3 c){return max(c.r,max(c.g,c.b));}
float wdSheenEnergy(float cosine,float roughness){
  float x=sqrt(clamp(cosine,0.0,1.0))*16.0;
  float y=(clamp(roughness,.07,1.0)-.07)*11.0/.93;
  int xi=min(15,int(floor(x))),yi=min(10,int(floor(y)));
  float a=mix(wdSheenAlbedo[yi*17+xi],wdSheenAlbedo[yi*17+xi+1],x-float(xi));
  float b=mix(wdSheenAlbedo[(yi+1)*17+xi],wdSheenAlbedo[(yi+1)*17+xi+1],x-float(xi));
  return mix(a,b,y-float(yi))*1.06+.0005;
}
float wdSheenCharlie(float NdotH,float roughness){
  float r=clamp(roughness,.07,1.0),inv=1.0/(r*r);
  return (2.0+inv)*pow(max(0.0,1.0-NdotH*NdotH),.5*inv)/(6.283185307179586);
}
float wdSheenNeubelt(float NdotV,float NdotL){
  return 1.0/max(4.0*(NdotL+NdotV-NdotL*NdotV),1e-8);
}
float sheenBaseScale(vec3 color,float NdotV,float NdotL,float roughness){
  float strength=clamp(wdSheenMax(color),0.0,1.0);
  if(strength<=0.0)return 1.0;
  float energy=max(clamp(wdSheenEnergy(NdotV,roughness),0.0,1.0),clamp(wdSheenEnergy(NdotL,roughness),0.0,1.0));
  return clamp(1.0-strength*energy,0.0,1.0);
}
vec3 sheenBrdf(vec3 N,vec3 V,vec3 L,vec3 color,float roughness){
  if(wdSheenMax(color)<=0.0)return vec3(0.0);
  float nv=clamp(dot(N,V),0.0,1.0),nl=clamp(dot(N,L),0.0,1.0);
  if(nv<=0.0||nl<=0.0)return vec3(0.0);
  vec3 h=V+L;float hlen=length(h);if(hlen<1e-8)return vec3(0.0);
  float nh=clamp(dot(N,h/hlen),0.0,1.0);
  float normalization=max(1.0,max(wdSheenEnergy(nv,roughness),wdSheenEnergy(nl,roughness)));
  return clamp(color,0.0,1.0)*wdSheenCharlie(nh,roughness)*wdSheenNeubelt(nv,nl)*nl/normalization;
}
`;

