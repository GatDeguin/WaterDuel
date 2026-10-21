/** WATER DUEL 1.0 — offline WebGL2, procedural PBR-style materials and articulated 3D rig.
 * No CDN, texture download, WebGPU requirement or npm package.
 * This is an interactive rendering system, not a pre-rendered concept image.
 */
import {latexMesh,buildFluidSurface,containedWaterMesh} from './physics/surfaces.js';
import {renderQualityView} from './adaptive-quality.js';
import {TABLE_TOP,WATER_RADII,waterDropRadius} from './physics/dimensions.js';
import {MATERIAL_GLSL} from './rendering/materials.js';
import {SceneTransmission} from './rendering/transmission.js';
import {WorkshopEnvironment} from './rendering/environment.js';
import {POST_VERTEX,POST_FRAGMENT} from './rendering/postprocess.js';
import {colorTargetFormat} from './rendering/color.js';
import {OPTICS_GLSL} from './rendering/optics.js';
import {OpticalDepth} from './rendering/optical-depth.js';
import {ShadowMap,SHADOW_GLSL,shadowViewProjection} from './rendering/shadows.js';
import {EQUIPMENT_MESHES,drawWeapon,drawDefense,drawMaulSupportArm} from './rendering/equipment.js';
import {AssetGPU} from './rendering/asset-gpu.js';
import {loadGLB} from './rendering/glb.js';
import {prepareCharacter,characterTransforms,detachedCharacterTransforms,prepareEquipment,equipmentTransform} from './rendering/asset-rig.js';
import {bodyForBone,bodyVisible,equipmentBody,jointMarks,rigidRenderer,drawPartialMaulSupport} from './rendering/joint-damage.js';
import {SHEEN_GLSL} from './rendering/sheen.js';
import {prepareWorkshopLights} from './rendering/workshop-lights.js';
import {prepareWorkshopMotion,environmentPartMatrix} from './rendering/workshop-motion.js';
import {duelCamera} from './rendering/duel-camera.js';
import {effectBatches,EFFECT_LIMITS} from './workshop-effects.js';
import {balloonPalette} from './opponent-loadouts.js';
import {apronMaterialOverride,apronProceduralColor} from './rendering/apron-color.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rgb=h=>[(h>>16&255)/255,(h>>8&255)/255,(h&255)/255];
const I=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const mul=(a,b)=>{let o=new Float32Array(16);for(let j=0;j<4;j++)for(let i=0;i<4;i++)for(let k=0;k<4;k++)o[j*4+i]+=a[k*4+i]*b[j*4+k];return o;};
const T=(x,y,z)=>{const m=I();m[12]=x;m[13]=y;m[14]=z;return m;};
const S=(x,y,z)=>{const m=I();m[0]=x;m[5]=y;m[10]=z;return m;};
const RX=t=>{const m=I(),c=Math.cos(t),s=Math.sin(t);m[5]=c;m[6]=s;m[9]=-s;m[10]=c;return m;};
const RY=t=>{const m=I(),c=Math.cos(t),s=Math.sin(t);m[0]=c;m[2]=-s;m[8]=s;m[10]=c;return m;};
const RZ=t=>{const m=I(),c=Math.cos(t),s=Math.sin(t);m[0]=c;m[1]=s;m[4]=-s;m[5]=c;return m;};
const C=(...m)=>m.reduce((a,b)=>mul(a,b),I());
const norm=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function normalMatrix(m){
  const a=[m[0],m[1],m[2]],b=[m[4],m[5],m[6]],c=[m[8],m[9],m[10]];
  const x=cross(b,c),y=cross(c,a),z=cross(a,b),det=a[0]*x[0]+a[1]*x[1]+a[2]*x[2]||1;
  return new Float32Array([...x.map(v=>v/det),...y.map(v=>v/det),...z.map(v=>v/det)]);
}
function lookAt(eye,target,up){
  const z=norm(eye.map((v,i)=>v-target[i])),x=norm(cross(up,z)),y=cross(z,x);
  const m=new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,0,0,0,1]);
  m[12]=-x[0]*eye[0]-x[1]*eye[1]-x[2]*eye[2];
  m[13]=-y[0]*eye[0]-y[1]*eye[1]-y[2]*eye[2];
  m[14]=-z[0]*eye[0]-z[1]*eye[1]-z[2]*eye[2];return m;
}
function perspective(fov,aspect,near,far){const f=1/Math.tan(fov/2),m=new Float32Array(16);m[0]=f/aspect;m[5]=f;m[10]=(far+near)/(near-far);m[11]=-1;m[14]=2*far*near/(near-far);return m;}
const vert=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aInstance;
layout(location=3) in float aOptics;
layout(location=4) in vec2 aUV;
layout(location=5) in vec2 aUV1;
layout(location=6) in vec4 aColor;
uniform mat4 uModel,uVP;
uniform mat3 uNormal;
uniform bool uInstancing;
uniform float uTime,uWobble;
uniform bool uAssetEnabled;
uniform vec3 uAssetDeform;
out vec3 vN,vPos,vLocal;
out vec3 vLocalN;
out float vThickness;
out vec2 vUV,vUV1;
out vec4 vAssetColor;
void main(){
  vec3 p=aPosition,normal=aNormal;
  if(uAssetEnabled&&uAssetDeform.z!=0.0){
    float span=max(.00001,uAssetDeform.y-uAssetDeform.x);
    p.y+=uAssetDeform.z*clamp((aPosition.y-uAssetDeform.x)/span,0.0,1.0);
    if(aPosition.y>uAssetDeform.x&&aPosition.y<uAssetDeform.y)normal.y/=max(.001,1.0+uAssetDeform.z/span);
  }
  if(uWobble>0.0){
    float a=sin(uTime*3.3+p.x*12.0+p.y*8.0)*sin(uTime*2.4+p.z*9.0);
    p+=normalize(aNormal)*uWobble*.014*a;
  }
  vec4 w=uInstancing?vec4(p*aInstance.w+aInstance.xyz,1.0):uModel*vec4(p,1.0);
  vPos=w.xyz;vN=normalize(uInstancing?normal:uNormal*normal);
  vLocal=p;vLocalN=aNormal;vThickness=aOptics;
  vUV=aUV;vUV1=aUV1;vAssetColor=aColor;
  gl_Position=uVP*w;
}`;
const frag=`#version 300 es
precision highp float;
in vec3 vN,vPos,vLocal;
in vec3 vLocalN;
in float vThickness;
in vec2 vUV,vUV1;
in vec4 vAssetColor;
uniform bool uAssetEnabled;
uniform vec4 uAssetColor,uAssetParams;
uniform vec3 uAssetEmission;
uniform float uAssetNormalScale,uAssetCoatRoughness,uAssetOcclusionStrength,uAssetTransmission,uAssetThickness,uAssetAlphaCutoff;
uniform int uAssetMaps,uAssetAlphaMode,uAssetEmissionUV;
uniform ivec4 uAssetTexCoords;
uniform sampler2D uAssetBaseMap,uAssetNormalMap,uAssetMRMap,uAssetAOMap,uAssetEmissionMap;
uniform sampler2D uAssetSheenColorMap,uAssetSheenRoughnessMap;
uniform vec4 uAssetSheen;
uniform ivec2 uAssetSheenUV;
uniform int uWorkshopLightCount;
uniform vec4 uWorkshopPositions[24],uWorkshopColors[24],uWorkshopDirections[24];
vec3 currentSheenColor=vec3(0.0);
float currentSheenRoughness=.5;
uniform vec3 uColor,uEye,uLamp1,uLamp2,uViewAxis;
uniform float uOpacity,uTime,uWet;
uniform int uMaterial;
uniform bool uNeutral;
uniform bool uHasScene,uHasEnvironment;
uniform bool uLinearTarget;
uniform bool uDepthPass,uHasOpticalDepth;
uniform sampler2D uSceneColor,uSceneDepth;
uniform sampler2D uOpticalDepth;
uniform samplerCube uEnvironment;
uniform vec2 uSceneSize;
uniform mat4 uVP;
out vec4 fragColor;
${MATERIAL_GLSL}
${OPTICS_GLSL}
${SHADOW_GLSL}
${SHEEN_GLSL}
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453123);}
float noise(vec3 p){
  vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float geometrySchlick(float nv,float r){float k=pow(r+1.0,2.0)/8.0;return nv/(nv*(1.0-k)+k+0.0001);}
vec3 lightBrdfCore(vec3 N,vec3 V,vec3 L,vec3 col,vec3 F0,float rough,float metal){
  vec3 H=normalize(V+L);float NL=max(dot(N,L),0.0),NV=max(dot(N,V),.0001),NH=max(dot(N,H),.001),HV=max(dot(H,V),0.0);
  vec3 F=F0+(1.0-F0)*pow(1.0-HV,5.0);
  float D=ggx(NH,rough),G=geometrySchlick(NV,rough)*geometrySchlick(NL,rough);
  vec3 spec=D*G*F/max(4.0*NV*NL,.0001);
  return ((1.0-F)*(1.0-metal)*col/3.14159+spec)*NL;
}
vec3 lightBrdf(vec3 N,vec3 V,vec3 L,vec3 col,vec3 F0,float rough,float metal){
  vec3 base=lightBrdfCore(N,V,L,col,F0,rough,metal);
  if(uAssetEnabled&&max(currentSheenColor.r,max(currentSheenColor.g,currentSheenColor.b))>0.0){
    base*=sheenBaseScale(currentSheenColor,max(0.0,dot(N,V)),max(0.0,dot(N,L)),currentSheenRoughness);
    base+=sheenBrdf(N,V,L,currentSheenColor,currentSheenRoughness);
  }
  return base;
}
vec3 bumpSurface(vec3 normal,float height,float strength){
  vec3 dx=dFdx(vPos),dy=dFdy(vPos),r1=cross(dy,normal),r2=cross(normal,dx);
  float det=dot(dx,r1);
  if(abs(det)<.0000001)return normal;
  vec3 grad=sign(det)*(dFdx(height)*r1+dFdy(height)*r2);
  return normalize(abs(det)*normal-strength*grad);
}
vec2 projectUV(vec3 p){vec4 q=uVP*vec4(p,1);return q.xy/q.w*.5+.5;}
vec2 assetUV(int channel){return channel==1?vUV1:vUV;}
void main(){
  if(uDepthPass&&!uAssetEnabled){fragColor=vec4(0);return;}
  vec3 N=normalize(vN),V=normalize(uEye-vPos);
  // Geometric footprint precedes detail/discard: GLSL ES 3.00, 8.9.
  vec3 geometricDx=dFdx(N),geometricDy=dFdy(N);
  float geometricNormalVariance=max(dot(geometricDx,geometricDx),dot(geometricDy,geometricDy));
  if(!gl_FrontFacing)N=-N;
  vec4 params=MATERIAL_PARAMS[clamp(uMaterial,0,MATERIAL_COUNT-1)];
  float rough=params.x,metal=params.y,opacity=uOpacity,coat=params.w,ior=params.z;
  bool water=uMaterial==3||uMaterial==9||uMaterial==19||(uMaterial>=13&&uMaterial<=15),latex=uMaterial==2||uMaterial==10;
  // Palette swatches are sRGB; lighting and the BRDF operate in linear space.
  vec3 base=pow(max(uColor,vec3(0.0)),vec3(2.2));
  float ambientOcclusion=1.0;vec3 assetEmission=vec3(0.0);
  if(uAssetEnabled){
    vec4 texel=(uAssetMaps&1)!=0?texture(uAssetBaseMap,assetUV(uAssetTexCoords.x)):vec4(1.0);
    base=uAssetColor.rgb*texel.rgb*vAssetColor.rgb;
    float alpha=uAssetColor.a*texel.a*vAssetColor.a;
    if(uAssetAlphaMode==1&&alpha<uAssetAlphaCutoff)discard;
    opacity=uAssetAlphaMode==2?alpha:1.0;
    if(uDepthPass){fragColor=vec4(0);return;}
    rough=uAssetParams.x;metal=uAssetParams.y;ior=uAssetParams.z;coat=uAssetParams.w;
    if((uAssetMaps&4)!=0){vec4 mr=texture(uAssetMRMap,assetUV(uAssetTexCoords.z));rough*=mr.g;metal*=mr.b;}
    if((uAssetMaps&8)!=0)ambientOcclusion=mix(1.0,texture(uAssetAOMap,assetUV(uAssetTexCoords.w)).r,uAssetOcclusionStrength);
    assetEmission=uAssetEmission;
    if((uAssetMaps&16)!=0)assetEmission*=texture(uAssetEmissionMap,assetUV(uAssetEmissionUV)).rgb;
    currentSheenColor=uAssetSheen.rgb;currentSheenRoughness=uAssetSheen.a;
    if((uAssetMaps&32)!=0)currentSheenColor*=texture(uAssetSheenColorMap,assetUV(uAssetSheenUV.x)).rgb;
    if((uAssetMaps&64)!=0)currentSheenRoughness*=texture(uAssetSheenRoughnessMap,assetUV(uAssetSheenUV.y)).a;
    if((uAssetMaps&2)!=0){
      vec2 uv=assetUV(uAssetTexCoords.y),du=dFdx(uv),dv=dFdy(uv);vec3 dx=dFdx(vPos),dy=dFdy(vPos);
      float determinant=du.x*dv.y-du.y*dv.x;
      if(abs(determinant)>.000000001){
        vec3 tangent=(dx*dv.y-dy*du.y)/determinant,bitangent=(-dx*dv.x+dy*du.x)/determinant;
        tangent-=N*dot(N,tangent);bitangent-=N*dot(N,bitangent);
        if(length(tangent)>.000001&&length(bitangent)>.000001){
          vec3 mapped=texture(uAssetNormalMap,uv).rgb*2.0-1.0;mapped.xy*=uAssetNormalScale;
          N=normalize(normalize(tangent)*mapped.x+normalize(bitangent)*mapped.y+N*mapped.z);
        }
      }
    }
  }
  float n=0.0; if(uMaterial==0||uMaterial==12||uMaterial==7||uMaterial==8)n=noise(vLocal*5.0);
  if(uMaterial==0 || uMaterial==12){ // varnished timber, growth rings and pores
    float rings=length(vLocal.xz*vec2(1.0,1.25)+vec2(1.9,.7));
    float grain=uMaterial==12?sin(vLocal.z*95.0+noise(vLocal*vec3(1,2,12))*2.3):sin(rings*82.0+noise(vLocal*vec3(4,1,4))*5.0);
    float fibers=noise(vLocal*vec3(180,4,95)),pores=pow(noise(vLocal*vec3(68,9,73)),5.0);
    float endgrain=smoothstep(.55,.88,abs(normalize(vLocalN).y));
    base*=.93+.065*grain+.055*fibers-.16*pores;
    base*=1.0-endgrain*.12;
    N=bumpSurface(N,grain*.002+fibers*.001-pores*.003,.12);
    rough=clamp(rough+pores*.18+fibers*.04,.12,.75);
  }else if(uMaterial==1||(uMaterial>=16&&uMaterial<=18)){ // machined and patinated metals
    float brushed=sin(vLocal.y*230.0+vLocal.x*17.0)*.5+.5;
    float patina=noise(vLocal*9.0),scratches=pow(noise(vLocal*vec3(3,155,23)),12.0);
    base*=.89+.10*brushed-.18*scratches;
    rough=clamp(rough+brushed*.045+scratches*.20,.09,.80);
    N=bumpSurface(N,brushed*.002+scratches*.009,.08);
    if(uMaterial==18){base=mix(base,vec3(.018,.070,.055),smoothstep(.52,.76,patina)*.65);rough+=.07*patina;}
  }else if(latex){ // Same thin film before and after a topological cut.
    N=bumpSurface(N,noise(vPos*95.0)*.001,.15);
    float f=pow(1.0-max(dot(N,V),0.0),2.8);
    base=mix(base*.45,base*1.36,f);
    opacity=clamp(uOpacity*(.26+.52*f),.08,.93);
    // The thin rear wall remains weak; opaque-scene transmission follows below.
    if(!gl_FrontFacing)opacity*=.10;
  }else if(uMaterial==3 || uMaterial==9){ // water droplet / connected 3D liquid isosurface
    float fres=pow(1.0-max(dot(N,V),0.0),3.2);
    base=mix(vec3(.15,.36,.40),base*.80+vec3(.30,.34,.35),fres);
    opacity=clamp(uOpacity*(.22+.72*fres),.08,.96);
  }else if(uMaterial==4){float weave=sin(vLocal.x*310.0)*sin(vLocal.y*255.0);base*=.85+.10*weave;N=bumpSurface(N,weave*.003,.20);}
  else if(uMaterial==5){fragColor=vec4(base,opacity);return;}
  else if(uMaterial==6){vec3 emitted=base*2.8;fragColor=vec4(uLinearTarget?emitted:pow(emitted/(1.0+emitted),vec3(1.0/2.2)),opacity);return;}
  else if(uMaterial==7){float pores=noise(vLocal*88.0),creases=pow(abs(sin(vLocal.y*31.0+noise(vLocal*10.0))),18.0);base*=.77+.24*pores-.13*creases;N=bumpSurface(N,pores*.005+creases*.004,.2);}
  else if(uMaterial==8){rough=.88;base*=.79+.26*n;}
  else if(uMaterial==11){opacity=uOpacity*.68;}
  else if(uMaterial==13){ // contained water body, approximate absorption tint
    rough=.045;metal=0.0;
    float f=pow(1.0-max(dot(N,V),0.0),4.0);
    base=base*(.20+.50*f)+vec3(.015,.025,.028);
    opacity=uOpacity*(.30+.52*f);if(!gl_FrontFacing)opacity*=.22;
  }
  else if(uMaterial==14){ // actual planar free surface
    rough=.027;metal=0.0;base=base*.72+vec3(.12);
    float f=pow(1.0-max(dot(N,V),0.0),4.0);
    opacity=uOpacity*(.55+.40*f);if(!gl_FrontFacing)opacity*=.4;
  }
  else if(uMaterial==15){ // meniscus annulus; optical normal bend, no added volume
    rough=.022;metal=0.0;base=base*.68+vec3(.28);opacity=uOpacity;
    if(!gl_FrontFacing)opacity*=.4;
  }
  if(uWet>0.0 && (uMaterial==0||uMaterial==8||uMaterial==12)){
    rough=mix(rough,.07,clamp(uWet,0.0,1.0));base*=1.0-.23*uWet;
  }
  // Filter the GGX lobe with the pixel footprint instead of adding a large
  // denominator epsilon (which erased the direct highlight on smooth water).
  float normalVariance=geometricNormalVariance;
  rough=sqrt(clamp(rough*rough+min(.25,normalVariance*.5),.065*.065,1.0));
  float dielectric=pow((ior-1.0)/(ior+1.0),2.0);
  vec3 F0=mix(vec3(dielectric),base,metal);
  vec3 L1=normalize(uLamp1-vPos),L2=normalize(uLamp2-vPos),L3=normalize(vec3(-.65,.91,.74));
  float attenuation1=18.0/(9.0+dot(uLamp1-vPos,uLamp1-vPos));
  float attenuation2=16.0/(9.0+dot(uLamp2-vPos,uLamp2-vPos));
  vec3 lightingBase=(water||latex)?vec3(0):base;
  float visibility=keyVisibility(vPos,N,L1);
  vec3 col=lightingBase*(uNeutral?vec3(.16):vec3(.065,.075,.075))*ambientOcclusion;
  // A broad mip of the captured, lit workshop supplies a low-frequency diffuse
  // return. This is an inexpensive irradiance approximation, not a GI solve.
  // Capture itself disables this branch, so the probe never feeds back into it.
  if(uHasEnvironment){
    vec3 returnLight=textureLod(uEnvironment,N,5.5).rgb;
    vec3 diffuseEnergy=(1.0-F0)*(1.0-metal);
    col+=lightingBase*diffuseEnergy*returnLight*.45*ambientOcclusion;
  }
  if(uAssetEnabled)col*=sheenBaseScale(currentSheenColor,max(0.0,dot(N,V)),max(0.0,dot(N,V)),currentSheenRoughness);
  vec3 volumeIncident=vec3(0.0);
  if(uWorkshopLightCount==0){
  col+=lightBrdf(N,V,L1,lightingBase,F0,rough,metal)*(uNeutral?vec3(1.17):vec3(1.70,1.12,.70))*attenuation1*3.1*visibility;
  col+=lightBrdf(N,V,L2,lightingBase,F0,rough,metal)*(uNeutral?vec3(1.0):vec3(.45,1.22,1.37))*attenuation2*2.5;
  col+=lightBrdf(N,V,L3,lightingBase,F0,rough,metal)*(uNeutral?vec3(.77):vec3(.55,.76,1.00))*.7;
  if(coat>0.0){
    col*=1.0-coat*.04;
    col+=coat*lightBrdfCore(N,V,L1,vec3(0),vec3(.04),uAssetEnabled?max(.065,uAssetCoatRoughness):.10,0.0)*(uNeutral?vec3(1.17):vec3(1.70,1.12,.70))*attenuation1*3.1*visibility;
  }
  }else{
    for(int light=0;light<24;light++){
      if(light>=uWorkshopLightCount)break;
      vec3 delta=uWorkshopPositions[light].xyz-vPos;
      float distanceSquared=dot(delta,delta),radius=uWorkshopColors[light].a;
      float intensity=uWorkshopPositions[light].w/(distanceSquared+radius*radius);
      vec3 direction=normalize(delta),color=uNeutral?vec3(1.0):uWorkshopColors[light].rgb;
      // Authored AREA emission travels along local -Z, into one hemisphere.
      // The Lambertian emitter distributes its power over pi rather than 4pi.
      // This removes window sources illuminating their own glass from behind.
      vec4 emitter=uWorkshopDirections[light];
      if(emitter.w>=0.0){
        float cosine=dot(emitter.xyz,-direction);
        intensity*=4.0*max(0.0,cosine)*smoothstep(emitter.w,min(1.0,emitter.w+.08),cosine);
      }else if(emitter.w>-1.0)intensity*=smoothstep(-.15,.1,dot(emitter.xyz,-direction));
      float visible=workshopVisibility(light,vPos,N,direction);
      vec3 radiance=color*intensity*visible;
      col+=lightBrdf(N,V,direction,lightingBase,F0,rough,metal)*radiance;
      if(coat>0.0)col+=coat*lightBrdfCore(N,V,direction,vec3(0),vec3(.04),uAssetEnabled?max(.065,uAssetCoatRoughness):.10,0.0)*radiance;
      volumeIncident+=radiance*(.25+.5*abs(dot(N,direction)));
    }
  }
  col+=F0*pow(1.0-max(dot(N,V),0.0),3.0)*.17;
  // Soft highlight environment reflection for metal, water and latex.
  if(metal>.5||coat>0.0||water||latex||uMaterial==10){
    vec3 R=reflect(-V,N);
    if(uHasEnvironment){
      vec3 reflected=textureLod(uEnvironment,R,rough*6.0).rgb;
      vec3 F=F0+(1.0-F0)*pow(1.0-max(dot(N,V),0.0),5.0);
      col+=reflected*F*(1.0-rough*.65)*.80*ambientOcclusion;
    }else{
    vec3 F=F0+(1.0-F0)*pow(1.0-max(dot(N,V),0.0),5.0);
    col+=F*(uNeutral?vec3(.57):vec3(.48,.57,.64))*pow(clamp(R.y+.35,0.0,1.0),7.0)*(.14+.34*(1.0-rough));
    col+=F*(uNeutral?vec3(.56):vec3(.8,.55,.32))*pow(max(dot(R,normalize(vec3(.45,.3,1.0))),0.0),19.0)*.16;
    // Analytic rectangular studio/window reflection, not screen-space refraction.
    float windowHighlight=pow(max(dot(R,normalize(vec3(-.45,.65,1.0))),0.0),70.0);
    col+=F*(uNeutral?vec3(.8):vec3(.85,.94,1.0))*windowHighlight*.9;
    }
  }
  if(uHasScene&&(water||latex||uMaterial==11)){
    float nv=max(dot(N,V),.03),f=dielectric+(1.0-dielectric)*pow(1.0-nv,5.0);
    float thickness=latex?clamp(vThickness,.00002,.02)/nv:uMaterial==13?.64:uMaterial==11?.035:uMaterial==9?.13:uMaterial==19?.002:.055;
    vec2 uv=gl_FragCoord.xy/uSceneSize;
    if(water&&uHasOpticalDepth){
      float rear=texture(uOpticalDepth,uv).r;
      // Far minus front in view depth, corrected to the oblique view ray.
      // Disjoint components can share an envelope: this is not multi-hit tracing.
      float forward=max(.1,dot(V,uViewAxis));
      if(rear>gl_FragCoord.z)thickness=clamp((viewDistance(rear)-viewDistance(gl_FragCoord.z))/forward,.0002,2.0);
    }
    vec3 ray=refract(-V,N,1.0/ior);
    vec2 refracted=clamp(projectUV(vPos+ray*thickness),vec2(.001),vec2(.999));
    // Reject foreground silhouettes: they cannot lie behind the transmitting ray.
    float sampledDepth=texture(uSceneDepth,refracted).r;
    float foregroundDistance=viewDistance(sampledDepth);
    float surfaceDistance=viewDistance(gl_FragCoord.z);
    if(foregroundDistance<surfaceDistance-.012)refracted=uv;
    vec3 behind=texture(uSceneColor,refracted).rgb;
    vec3 absorption=latex?latexAbsorption(uColor):waterAbsorption(uColor);
    // Homogeneous single scattering over the estimated optical path. This adds
    // depth-dependent backlight to the volume, not a flat emissive water tint.
    // It is a reduced optical medium, not a volumetric path tracer/caustic solve.
    vec3 scattering=latex?latexScattering(uColor):(water&&uMaterial!=19)?waterScattering(uColor):vec3(0);
    vec3 extinction=absorption+scattering,transmittance=exp(-extinction*thickness);
    float g=.35,mu=dot(-L2,V),phase=(1.0-g*g)/pow(max(.08,1.0+g*g-2.0*g*mu),1.5);
    vec3 illumination=(uNeutral?vec3(1.0):vec3(.66,1.12,1.18))*attenuation2*2.5;
    if(latex){
      // Pigment scatters the incident workshop light in the thin film. Both
      // faces receive light; no emissive color is added to brighten the head.
      phase=1.0;
      illumination=(uNeutral?vec3(.16):vec3(.065,.075,.075));
      illumination+=(uNeutral?vec3(1.17):vec3(1.70,1.12,.70))*attenuation1*3.1*(.25+.5*abs(dot(N,L1)))*keyVisibility(vPos,N,L1);
      illumination+=(uNeutral?vec3(1.0):vec3(.45,1.22,1.37))*attenuation2*2.5*(.25+.5*abs(dot(N,L2)));
    }
    if(uWorkshopLightCount>0)illumination=volumeIncident+(uNeutral?vec3(.16):vec3(.065,.075,.075));
    vec3 inScatter=(1.0-transmittance)*scattering/max(extinction,vec3(.001))*illumination*phase;
    vec3 transmitted=behind*transmittance+inScatter;
    // Direct/specular environment already includes Fresnel in its BRDF.
    col=transmitted*(1.0-f)+col;
    // Closed volumes use one front interface with full pixel coverage. Fresnel
    // and absorption have already mixed the transmitted and reflected radiance.
    if(!gl_FrontFacing&&(uMaterial==2||uMaterial==3||uMaterial==9||uMaterial==13||uMaterial==19))discard;
    opacity=uMaterial==19?uOpacity:1.0;
  }
  if(uAssetEnabled){
    if(uAssetTransmission>0.0&&uHasScene){
      float nv=max(.03,dot(N,V)),f=dielectric+(1.0-dielectric)*pow(1.0-nv,5.0);
      vec3 ray=refract(-V,N,1.0/max(1.001,ior));
      vec2 uv=clamp(projectUV(vPos+ray*uAssetThickness),vec2(.001),vec2(.999));
      if(texture(uSceneDepth,uv).r<gl_FragCoord.z-.0001)uv=gl_FragCoord.xy/uSceneSize;
      col=mix(col,texture(uSceneColor,uv).rgb*base*(1.0-f)+col*f,uAssetTransmission);
    }
    col+=assetEmission;
  }
  float distanceFog=smoothstep(7.0,21.0,length(vPos-uEye));
  col=mix(col,uNeutral?vec3(.057):vec3(.012,.020,.024),distanceFog*.34);
  if(!uLinearTarget){col=col/(col+vec3(1.0));col=pow(max(col,vec3(0.0)),vec3(1.0/2.2));}
  fragColor=vec4(col,opacity);
}`;
function compile(gl,kind,source){const s=gl.createShader(kind);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const info=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error('GLSL: '+info);}return s;}
function buildProgram(gl,vertex,fragment){
  const p=gl.createProgram(),shaders=[];let linked=false;
  try{for(const [kind,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const s=compile(gl,kind,source);shaders.push(s);gl.attachShader(p,s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Vinculación GLSL: '+gl.getProgramInfoLog(p));linked=true;return p;}
  finally{for(const shader of shaders){gl.detachShader(p,shader);gl.deleteShader(shader);}if(!linked)gl.deleteProgram(p);}
}
function sphereMesh(stacks=26,slices=38){const p=[],n=[],ix=[];for(let j=0;j<=stacks;j++){const phi=j/stacks*Math.PI;for(let i=0;i<=slices;i++){const t=i/slices*Math.PI*2,x=Math.cos(t)*Math.sin(phi),y=Math.cos(phi),z=Math.sin(t)*Math.sin(phi);p.push(x,y,z);n.push(x,y,z);}}
  for(let j=0;j<stacks;j++)for(let i=0;i<slices;i++){const a=j*(slices+1)+i,b=a+slices+1;ix.push(a,a+1,b,b,a+1,b+1);}return {p,n,ix};}
function cylinderMesh(sides=24){const p=[],n=[],ix=[];for(let i=0;i<=sides;i++){const a=i/sides*Math.PI*2,x=Math.cos(a),z=Math.sin(a);p.push(x,-.5,z,x,.5,z);n.push(x,0,z,x,0,z);}
  for(let i=0;i<sides;i++){const a=2*i;ix.push(a,a+1,a+2,a+1,a+3,a+2);}
  for(let sign of [-1,1]){let start=p.length/3;p.push(0,sign*.5,0);n.push(0,sign,0);for(let i=0;i<=sides;i++){const a=i/sides*Math.PI*2;p.push(Math.cos(a),sign*.5,Math.sin(a));n.push(0,sign,0);}for(let i=0;i<sides;i++){if(sign===1)ix.push(start,start+i+2,start+i+1);else ix.push(start,start+i+1,start+i+2);}}return {p,n,ix};}
function torusMesh(segments=32,tube=9){const p=[],n=[],ix=[];for(let i=0;i<=segments;i++){const a=i/segments*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a);for(let j=0;j<=tube;j++){const b=j/tube*Math.PI*2,cb=Math.cos(b),sb=Math.sin(b),r=.84+.16*cb;p.push(r*ca,r*sa,.16*sb);n.push(cb*ca,cb*sa,sb);}}
  for(let i=0;i<segments;i++)for(let j=0;j<tube;j++){const a=i*(tube+1)+j,b=a+tube+1;ix.push(a,b,a+1,b,b+1,a+1);}return {p,n,ix};}
function bevelMesh(){const p=[],n=[],ix=[],r=.09,steps=[-.5,-.5+r,.5-r,.5];
  const maps=[(u,v)=>[.5,u,v],(u,v)=>[-.5,u,-v],(u,v)=>[u,.5,-v],(u,v)=>[u,-.5,v],(u,v)=>[u,v,.5],(u,v)=>[-u,v,-.5]];
  for(const map of maps){let start=p.length/3;
    for(let j=0;j<4;j++)for(let i=0;i<4;i++){
      const q=map(steps[i],steps[j]);const core=q.map(v=>clamp(v,-.5+r,.5-r));const diff=q.map((v,k)=>v-core[k]);
      const len=Math.hypot(...diff)||1;const nn=diff.map(v=>v/len);
      p.push(...core.map((v,k)=>v+nn[k]*r));n.push(...nn);
    }
    for(let j=0;j<3;j++)for(let i=0;i<3;i++){let a=start+j*4+i,b=a+4;ix.push(a,a+1,b,b,a+1,b+1);}
  }
  return {p,n,ix};
}
function buildMesh(gl,obj){const vao=gl.createVertexArray();gl.bindVertexArray(vao);const pb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,pb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(obj.p),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
  const nb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,nb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(obj.n),gl.STATIC_DRAW);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0);
  const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(obj.ix),gl.STATIC_DRAW);gl.bindVertexArray(null);return {vao,count:obj.ix.length,pb,nb,ib,instance:gl.createBuffer()};}
const glass=(m,a=1)=>m===2||m===3||m===9||m===10||m===11||m===19||(m>=13&&m<=15)||a<.98;
const STAGE_TOP=TABLE_TOP;
const defaultWaterSampleVolume=4/3*Math.PI*.06**3;
function waterSurfaceSnapshot(particles,quality,mesh){
  const positions=new Float64Array(particles.length*3),volumes=new Float64Array(particles.length),support=new Float64Array(particles.length);
  const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity],factor=quality==='eco'?1.2:quality==='ultra'?.8:1;
  let radius=Infinity,totalVolume=0;
  for(let i=0;i<particles.length;i++){
    const p=particles[i],volume=p.volume??defaultWaterSampleVolume;
    positions[i*3]=p.x;positions[i*3+1]=p.y;positions[i*3+2]=p.z;volumes[i]=volume;
    if(Number.isFinite(volume)&&volume>0){
      const r=Math.cbrt(3*volume/(4*Math.PI));radius=Math.min(radius,r);totalVolume+=volume;
      // Nominal compact support plus a cell is an early boundary guard. Dense
      // components can enlarge their kernel: actual geometry bounds below are
      // authoritative for a mesh already clipped against a fixed plane.
      support[i]=r*(2.2+factor);
      for(let axis=0;axis<3;axis++){bounds[axis]=Math.min(bounds[axis],positions[i*3+axis]-support[i]);bounds[axis+3]=Math.max(bounds[axis+3],positions[i*3+axis]+support[i]);}
    }
  }
  // The extractor picks the smallest parcel radius per connected component.
  // Using the global minimum also bounds the finest disconnected component;
  // stats.cell is a maximum across components and would miss small droplets.
  const cell=radius*factor;
  const meshBounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(let i=0;i<mesh.p.length;i++){const axis=i%3;meshBounds[axis]=Math.min(meshBounds[axis],mesh.p[i]);meshBounds[axis+3]=Math.max(meshBounds[axis+3],mesh.p[i]);}
  return {positions,volumes,support,bounds,meshBounds,totalVolume,particles:particles.slice(),tolerance:Number.isFinite(cell)?cell*.25:0};
}
function waterSurfaceMotion(snapshot,particles){
  const invalid={distance:Infinity,rawDistance:Infinity,offset:{x:0,y:0,z:0}};
  if(!snapshot||snapshot.particles.length!==particles.length||!snapshot.totalVolume)return invalid;
  const translation=[0,0,0],bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(let i=0;i<particles.length;i++){
    const p=particles[i];
    if(snapshot.particles[i]!==p||snapshot.volumes[i]!== (p.volume??defaultWaterSampleVolume))return invalid;
    const position=[p.x,p.y,p.z];
    for(let axis=0;axis<3;axis++){
      if(!Number.isFinite(position[axis]))return invalid;
      translation[axis]+=(position[axis]-snapshot.positions[i*3+axis])*snapshot.volumes[i]/snapshot.totalVolume;
      bounds[axis]=Math.min(bounds[axis],position[axis]-snapshot.support[i]);bounds[axis+3]=Math.max(bounds[axis+3],position[axis]+snapshot.support[i]);
    }
  }
  const lower=[-3.7,TABLE_TOP,-1.31],upper=[3.7,Infinity,1.31];
  for(let axis=0;axis<3;axis++)if(Math.abs(translation[axis])>1e-12){
    const a=snapshot.meshBounds?.[axis],b=snapshot.meshBounds?.[axis+3];
    // A rigid translation normal to a clipped face changes the fixed-domain
    // boundary condition even when all sample residuals are exactly zero.
    if(!Number.isFinite(a)||!Number.isFinite(b)||a<=lower[axis]+1e-8||b>=upper[axis]-1e-8||
      a+translation[axis]<lower[axis]-1e-9||b+translation[axis]>upper[axis]+1e-9)return invalid;
  }
  for(let axis=0;axis<3;axis++)if(Math.abs(translation[axis])>1e-12&&
    (snapshot.bounds[axis]<=lower[axis]||snapshot.bounds[axis+3]>=upper[axis]||bounds[axis]<=lower[axis]||bounds[axis+3]>=upper[axis]||
      snapshot.bounds[axis]+translation[axis]<=lower[axis]||snapshot.bounds[axis+3]+translation[axis]>=upper[axis]))translation[axis]=0;
  let maximumSquared=0,rawSquared=0;
  for(let i=0;i<particles.length;i++){
    const p=particles[i];
    const dx=p.x-snapshot.positions[i*3],dy=p.y-snapshot.positions[i*3+1],dz=p.z-snapshot.positions[i*3+2];
    rawSquared=Math.max(rawSquared,dx*dx+dy*dy+dz*dz);
    maximumSquared=Math.max(maximumSquared,(dx-translation[0])**2+(dy-translation[1])**2+(dz-translation[2])**2);
  }
  return {distance:Math.sqrt(maximumSquared),rawDistance:Math.sqrt(rawSquared),offset:{x:translation[0],y:translation[1],z:translation[2]}};
}
export class Renderer3D {
 constructor(canvas){
  this.canvas=canvas;const gl=canvas.getContext('webgl2',{alpha:true,antialias:true,depth:true,premultipliedAlpha:false,powerPreference:'high-performance',stencil:false});if(!gl)throw Error('WebGL2 no disponible.');this.gl=gl;
  const prog=buildProgram(gl,vert,frag);this.program=prog;gl.useProgram(prog);
  this.U={};for(const u of ['uModel','uNormal','uVP','uInstancing','uTime','uWobble','uColor','uOpacity','uMaterial','uEye','uLamp1','uLamp2','uViewAxis','uWet','uNeutral','uHasScene','uHasEnvironment','uSceneColor','uSceneDepth','uSceneSize','uEnvironment','uLinearTarget','uDepthPass','uHasOpticalDepth','uOpticalDepth','uHasShadow','uShadowMap','uShadowVP','uShadowSize','uAssetEnabled','uAssetDeform','uAssetColor','uAssetParams','uAssetEmission','uAssetCoatRoughness','uAssetNormalScale','uAssetOcclusionStrength','uAssetTransmission','uAssetThickness','uAssetAlphaCutoff','uAssetAlphaMode','uAssetMaps','uAssetTexCoords','uAssetEmissionUV','uAssetBaseMap','uAssetNormalMap','uAssetMRMap','uAssetAOMap','uAssetEmissionMap'])this.U[u]=gl.getUniformLocation(prog,u);
  for(const [i,name]of ['uAssetBaseMap','uAssetNormalMap','uAssetMRMap','uAssetAOMap','uAssetEmissionMap'].entries())gl.uniform1i(this.U[name],6+i);
  for(const name of ['uAssetSheen','uAssetSheenUV','uAssetSheenColorMap','uAssetSheenRoughnessMap','uWorkshopLightCount'])this.U[name]=gl.getUniformLocation(prog,name);
  for(const name of ['uWorkshopPositions','uWorkshopColors','uWorkshopDirections'])this.U[name]=gl.getUniformLocation(prog,name+'[0]');
  gl.uniform1i(this.U.uAssetSheenColorMap,11);gl.uniform1i(this.U.uAssetSheenRoughnessMap,12);gl.uniform1i(this.U.uWorkshopLightCount,0);
  gl.uniform1i(this.U.uAssetEnabled,0);this.assetGPU=new AssetGPU(gl);
  this.assetScene={characters:{},equipment:{},environment:null};this.assetStatus={loading:false,ready:0,total:11,names:[],errors:[],gpuBytesApprox:0};this.disposed=false;this.assetPoseCache=new WeakMap();
  gl.uniform1i(this.U.uSceneColor,0);gl.uniform1i(this.U.uSceneDepth,1);gl.uniform1i(this.U.uEnvironment,3);
  gl.uniform1i(this.U.uOpticalDepth,4);
  gl.uniform1i(this.U.uShadowMap,5);gl.uniform1i(this.U.uHasShadow,0);
  for(const name of ['uStaticShadowIndices','uStaticShadowSizes',...Array.from({length:3},(_,i)=>['uStaticShadow'+i,'uStaticShadowVP'+i]).flat()])this.U[name]=gl.getUniformLocation(prog,name);
  for(let i=0;i<3;i++)gl.uniform1i(this.U['uStaticShadow'+i],13+i);
  gl.uniform3iv(this.U.uStaticShadowIndices,[-1,-1,-1]);
  this.colorFormat=colorTargetFormat(gl);this.transmission=new SceneTransmission(gl,this.colorFormat);this.environment=new WorkshopEnvironment(gl,128,this.colorFormat);
  this.opticalDepth=new OpticalDepth(gl);
  this.shadows=new ShadowMap(gl);this.depthOnly=false;
  this.staticShadows=Array.from({length:3},(_,i)=>new ShadowMap(gl,{unit:13+i,resolutionScale:.5}));this.staticShadowKey=null;
  let post;try{post=buildProgram(gl,POST_VERTEX,POST_FRAGMENT);}catch(error){gl.useProgram(null);gl.deleteProgram(prog);throw error;}
  this.post={program:post,vao:gl.createVertexArray(),image:gl.getUniformLocation(post,'uImage'),texel:gl.getUniformLocation(post,'uTexel')};
  this.mesh={sphere:buildMesh(gl,sphereMesh()),droplet:buildMesh(gl,sphereMesh(8,11)),cylinder:buildMesh(gl,cylinderMesh()),hex:buildMesh(gl,cylinderMesh(6)),box:buildMesh(gl,bevelMesh()),torus:buildMesh(gl,torusMesh())};
  for(const [name,geometry] of Object.entries(EQUIPMENT_MESHES))this.mesh[name]=buildMesh(gl,geometry);
  this.quality=1.75;this.dynamic={};this.pending=[];this.renderTime=0;this.waterSurfaces=new Map();this.stats={draws:0,triangles:0};this.width=1;this.height=1;this.disableWaterMesh=false;
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);
  gl.uniform3fv(this.U.uLamp1,new Float32Array([-2.45,4.1,3.0]));gl.uniform3fv(this.U.uLamp2,new Float32Array([3.25,3.7,-.25]));
 }
 async loadAssets(onStatus=()=>{}){
  if(this.assetPromise)return this.assetPromise;
  this.assetAbort=new AbortController();this.assetStatus.loading=true;
  const jobs=[
    ...[['mint','water-mannequin.glb'],['amber','water-mannequin-amber.glb'],['boss','water-mannequin-boss.glb']].map(([key,file])=>({kind:'character',key,label:{mint:'Mint Mamba',amber:'Amber Ace',boss:'Maestro Hidráulico'}[key],url:`/assets/characters/water-mannequin/v3/${file}`})),
    ...['sword','spear','axe','maul','short','long','knife'].map(key=>({kind:'equipment',key,label:key,url:`/assets/equipment/workshop/v2/${key}.glb`})),
    {kind:'environment',key:'workshop',label:'Taller',url:'/assets/environment/workshop/workshop-runtime-v3.glb'},
  ];
  const publish=()=>{this.assetStatus.gpuBytesApprox=this.assetGPU.bytes;onStatus({...this.assetStatus,names:[...this.assetStatus.names],errors:[...this.assetStatus.errors]});};
  publish();
  const worker=async()=>{
    while(jobs.length&&!this.disposed){
      const job=jobs.shift();
      try{
        const source=await loadGLB(job.url,{signal:this.assetAbort.signal});
        if(this.disposed)return;
        const prepared=job.kind==='character'?prepareCharacter(source):job.kind==='equipment'?prepareEquipment(source,job.key):null;
        let lightingPresets=null,motion=null;
        if(job.kind==='environment'){
          const response=await fetch('/assets/environment/workshop/asset-contract-v3.json',{signal:this.assetAbort.signal});
          if(!response.ok)throw Error('No se pudo leer el contrato de luces del taller.');
          const contract=await response.json();if(contract.stable!==true)throw Error('La exportación del taller todavía no está estable.');
          motion=prepareWorkshopMotion(contract,source.primitives);
          const framesResponse=await fetch('/assets/environment/workshop/light-directions.json',{signal:this.assetAbort.signal});
          if(!framesResponse.ok)throw Error('No se pudo leer la orientación de luces del taller.');
          const frames=await framesResponse.json();
          lightingPresets=Object.fromEntries(['atelier','midnight','dojo'].map(arena=>{
            const lights=prepareWorkshopLights(contract,arena,frames);
            // Raster staging: give the front softboxes enough return to reveal
            // wood and brass against the bright windows. Keep source positions,
            // colors and practical lamps; these gains are artistic, not watts.
            lights.names.forEach((name,index)=>{
              const gain=index===0?1.8:/^Soft front return$/i.test(name)?1.6:1;
              lights.positions[index*4+3]*=gain;
            });
            return [arena,lights];
          }));
        }
        const gpu=await this.assetGPU.upload(prepared?{...source,primitives:prepared.parts}:source);
        if(this.disposed)return;
        if(job.kind==='character')this.assetScene.characters[job.key]={prepared,gpu};
        else if(job.kind==='equipment')this.assetScene.equipment[job.key]={prepared,gpu};
        else this.assetScene.environment={gpu,transform:I(),lightingPresets,motion};
        this.assetStatus.ready++;this.assetStatus.names.push(job.label);this.environment.key=null;
      }catch(error){if(this.disposed)return;this.assetStatus.errors.push(`No se pudo cargar ${job.label}. Se usa su representación procedural.`);console.error(error);}
      publish();
    }
  };
  this.assetPromise=Promise.all([worker(),worker()]).then(()=>{if(!this.disposed){this.assetStatus.loading=false;publish();}return this.assetStatus;});
  return this.assetPromise;
 }
 assetPart(model,part,matrix,deform){
  if(this.assetGPU.transparent(model,part)){
    if(!this.depthOnly)this.pending.push({kind:'asset',model,part,matrix,deform,order:0,depth:matrix[14]});return;
  }
  this.assetGPU.draw(model,part,matrix,this.U,deform);this.stats.draws++;this.stats.triangles+=part.count/3;
 }
 detailedPuppet(f){
  const entry=this.assetScene.characters[f.boss?'boss':f.slot===1?'mint':'amber'];if(!entry)return false;
  let cached=this.assetPoseCache.get(f);
  if(!cached||cached.pose!==f.pose||cached.entry!==entry){cached={pose:f.pose,entry,matrices:characterTransforms(entry.prepared,f)};this.assetPoseCache.set(f,cached);}
  entry.gpu.parts.forEach((part,index)=>{
    if(bodyVisible(f.pose,bodyForBone(entry.prepared.parts[index].boneName)))this.assetPart(entry.gpu,part,cached.matrices[index],
      apronMaterialOverride(f,entry.prepared.parts[index],entry.gpu.materials[part.material]));
  });return true;
 }
 detailedEquipment(f,key){
  if(key==='none'||!bodyVisible(f.pose,equipmentBody(key)))return true;const entry=this.assetScene.equipment[key];if(!entry)return false;
  const transform=equipmentTransform(f,key);if(!transform)return true;
  for(const part of entry.gpu.parts)this.assetPart(entry.gpu,part,transform.matrix,transform);return true;
 }
 workshopLighting(game){
  const gl=this.gl,U=this.U,lighting=this.assetScene.environment?.lightingPresets?.[game.arena];
  gl.uniform1i(U.uWorkshopLightCount,lighting?.count??0);
  if(lighting){
    gl.uniform4fv(U.uWorkshopPositions,lighting.positions);gl.uniform4fv(U.uWorkshopColors,lighting.colors);gl.uniform4fv(U.uWorkshopDirections,lighting.directions);
    gl.uniform3fv(U.uLamp1,new Float32Array(lighting.keyPosition));
    const fill=Math.max(0,lighting.names.findIndex(name=>/window/i.test(name)));
    gl.uniform3fv(U.uLamp2,lighting.positions.subarray(fill*4,fill*4+3));
    if(this.lightingKey!==lighting){this.shadows.matrix=shadowViewProjection(lighting.keyPosition);this.lightingKey=lighting;}
  }else{
    gl.uniform3fv(U.uLamp1,new Float32Array([-2.45,4.1,3]));gl.uniform3fv(U.uLamp2,new Float32Array([3.25,3.7,-.25]));
    if(this.lightingKey){this.shadows.matrix=shadowViewProjection();this.lightingKey=null;}
  }
  this.stats.lighting={sources:lighting?.count??3,preset:game.arena,areaModel:'Directional softened emitter approximation',keyGain:lighting?1.8:1,frontReturnGain:lighting?1.6:1,diffuseProbe:'Broad mip approximation',keyShadow:this.shadows.available};
 }
 resize(){const dpr=Math.min(window.devicePixelRatio||1,this.quality)*(this.renderScale??1);let w=Math.max(1,Math.min(2240,Math.round(this.canvas.clientWidth*dpr))),h=Math.max(1,Math.min(1440,Math.round(this.canvas.clientHeight*dpr)));
  if(w!==this.canvas.width||h!==this.canvas.height){this.canvas.width=w;this.canvas.height=h;}this.width=w;this.height=h;this.gl.viewport(0,0,w,h);}
 setup(shape,model,color,material,opacity,wobble,wet){const gl=this.gl,U=this.U,m=this.mesh[shape];gl.uniform1i(U.uAssetEnabled,0);gl.bindVertexArray(m.vao);gl.disableVertexAttribArray(2);gl.vertexAttrib4f(2,0,0,0,1);gl.disableVertexAttribArray(3);gl.vertexAttrib1f(3,.0045);
  gl.uniform1i(U.uInstancing,0);gl.uniformMatrix4fv(U.uModel,false,model);gl.uniformMatrix3fv(U.uNormal,false,normalMatrix(model));
  gl.uniform3fv(U.uColor,Array.isArray(color)?color:rgb(color));gl.uniform1i(U.uMaterial,material);gl.uniform1f(U.uOpacity,opacity);gl.uniform1f(U.uWobble,wobble);gl.uniform1f(U.uWet,wet||0);return m;}
 raw(shape,model,color,material=0,opacity=1,wobble=0,wet=0){const gl=this.gl,m=this.setup(shape,model,color,material,opacity,wobble,wet);gl.drawElements(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0);this.stats.draws++;this.stats.triangles+=m.count/3;}
 draw(shape,model,color,material=0,opacity=1,wobble=0,wet=0){if(glass(material,opacity)){if(!this.depthOnly)this.pending.push({kind:'mesh',shape,model,color,material,opacity,wobble,wet,order:material===9?0:material===10?2:1,depth:model[14]});return;}this.raw(shape,model,color,material,opacity,wobble,wet);}
 box(x,y,z,sx,sy,sz,color,material=0,opacity=1,rot=0,wet=0){this.draw('box',C(T(x,y,z),RZ(rot),S(sx,sy,sz)),color,material,opacity,0,wet);}
 sphere(x,y,z,sx,sy,sz,color,material=2,opacity=1,wobble=0){this.draw('sphere',C(T(x,y,z),S(sx,sy,sz)),color,material,opacity,wobble);}
 cylinder(x,y,z,sx,sy,sz,color,material=1,rotX=0,opacity=1){this.draw('cylinder',C(T(x,y,z),RX(rotX),S(sx,sy,sz)),color,material,opacity);}
 torus(x,y,z,sx,sy,sz,color,material=1){this.draw('torus',C(T(x,y,z),S(sx,sy,sz)),color,material);}
 beam(a,b,r,color,material=0,z=0){const az=a.z??z,bz=b.z??z,dx=b.x-a.x,dy=b.y-a.y,dz=bz-az,len=Math.hypot(dx,dy,dz);
  this.draw('cylinder',C(T((a.x+b.x)/2,(a.y+b.y)/2,(az+bz)/2),RZ(-Math.atan2(dx,dy)),S(r,len,r)),color,material);}
 panelBetween(a,b,w,d,color,material=0,offset=0){const ax=a.x,ay=a.y,bx=b.x,by=b.y,len=Math.hypot(bx-ax,by-ay),z=((a.z||0)+(b.z||0))/2+offset;
  this.draw('box',C(T((ax+bx)/2,(ay+by)/2,z),RZ(-Math.atan2(bx-ax,by-ay)),S(w,len,d)),color,material);}
 pin(pos,z,r=.11,accent=0xd7ad60){
  const x=pos.x,y=pos.y;this.cylinder(x,y,z-.025,r*1.17,.075,r*1.17,0x302a24,17,Math.PI/2);
  this.cylinder(x,y,z+.023,r,.064,r,accent,1,Math.PI/2);
  this.torus(x,y,z+.063,r*.78,r*.78,.04,0x9d9585,16);
  this.cylinder(x,y,z+.066,r*.63,.069,r*.63,0x3c322b,17,Math.PI/2);
  this.draw('hex',C(T(x,y,z+.105),RX(Math.PI/2),S(r*.38,.039,r*.38)),0xc2c5bd,16);
  this.box(x,y,z+.128,r*.43,r*.064,.013,0x3a3630,17,1,.65);
 }
 joint(pos,z,r=.11,col=0xd7ad60){this.pin(pos,z,r,col);this.sphere(pos.x-.018,pos.y+.023,z+.128,r*.16,r*.16,.015,0xffefce,1);}
 limb(a,b,thick,depth,front,back,z=0){
  const aa={...a,z},bb={...b,z};
  this.panelBetween(aa,bb,thick,depth,front,0);
  const v={x:bb.x-aa.x,y:bb.y-aa.y},length=Math.hypot(v.x,v.y)||1;
  const perp={x:-v.y/length,y:v.x/length};
  const leftA={x:aa.x+perp.x*thick*.4,y:aa.y+perp.y*thick*.4,z:z+depth*.32};
  const leftB={x:bb.x+perp.x*thick*.4,y:bb.y+perp.y*thick*.4,z:z+depth*.32};
  this.beam(leftA,leftB,.012,back,1,z+depth*.32);
  for(const t of [.17,.83]){
    const point={x:aa.x+v.x*t,y:aa.y+v.y*t};
    this.cylinder(point.x,point.y,z+depth*.59,.018,.018,.018,0xe7c78a,1,Math.PI/2);
  }
 }
 actuator(a,b,z,r=.028){
  // Telescopic barrel and piston share the actual two moving anchors.
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,ux=dx/length,uy=dy/length;
  const start={x:a.x+ux*.045,y:a.y+uy*.045,z},end={x:b.x-ux*.04,y:b.y-uy*.04,z};
  const split={x:start.x+(end.x-start.x)*.56,y:start.y+(end.y-start.y)*.56,z};
  this.beam(start,split,r*1.65,0xa98246,18);this.beam(split,end,r*.67,0xc6d1d0,16);
  for(const p of [a,b]){this.torus(p.x,p.y,z,r*1.8,r*1.8,r*.8,0xb8a16b,1);this.cylinder(p.x,p.y,z,r*.60,.055,r*.60,0xbac5c1,16,Math.PI/2);}
 }
 clevis(pos,z,r,axisAngle=0){
  // Two fork ears straddle the bearing; the axle spans them along the z axis.
  for(const side of [-1,1])this.draw('box',C(T(pos.x,pos.y,z+side*.095),RZ(axisAngle),S(r*1.5,r*2.0,.045)),0x4e4a3b,18);
  this.cylinder(pos.x,pos.y,z,r*.36,.28,r*.36,0xabb7b6,16,Math.PI/2);
 }
 drawArena(game,t){
  if(this.assetScene.environment){
    const {gpu,transform,motion}=this.assetScene.environment;
    const tint=game.arena==='midnight'?[.33,.54,.68]:game.arena==='dojo'?[1.24,1.14,.94]:[1,1,1];
    for(const part of gpu.parts){const matrix=environmentPartMatrix(part,motion,game.clock??t,{staticCapture:!!this.staticShadowPass});if(matrix)this.assetPart(gpu,part,mul(transform,matrix),{tint});}
    for(let i=0;i<2;i++){const wet=game.puddleStrength?.[i]||0;if(wet>.001)this.sphere(i===0?-1.55:1.55,.341,.32,.5+wet*.8,.006,.3+wet*.45,0x62a5a8,19,.09*wet);}
    return;
  }
  const id=game.arena,night=id==='midnight';const wood=night?0x294448:id==='dojo'?0xc6b092:0x9c6e43;
  const back=night?0x11262a:id==='dojo'?0x61554a:0x332d25;
  this.box(0,2.25,-4.00,14.3,7.3,.17,back,8);
  // Industrial-height multipane studio windows. Brighter backing gives perceived depth.
  for(const cx of [-4.45,4.46]){
    this.box(cx,3.10,-3.87,2.60,3.35,.07,night?0x2c565c:0x7899ad,night?8:6);
    this.box(cx,3.10,-3.82,2.46,3.13,.03,night?0x264449:0x9fb6ad,11,.36);
    for(let j=0;j<4;j++)this.box(cx,1.84+j*.79,-3.77,2.65,.064,.085,0x3d3126,0);
    for(let k of [-.77,0,.77])this.box(cx+k,3.12,-3.76,.065,3.25,.075,0x3d3126,0);
  }
  // Dark timber support columns with bright brass tie-downs.
  for(let x of [-6.2,-2.85,2.85,6.2]){
    this.box(x,2.2,-3.54,.20,5.6,.25,0x5d432c,0);
    for(let y of [.76,2.35,4.15])this.box(x,y,-3.34,.28,.055,.12,0xc39c54,1);
  }
  for(let y of [1.17,3.95])this.box(0,y,-3.66,13.4,.18,.25,0x4c392a,0);
  // Atmospheric hanging lamps with metallic shades and luminous bulbs.
  for(let x of [-2.8,0,2.8]){
    this.beam({x,y:5.7,z:-2.8},{x,y:4.55,z:-2.8},.014,0x7d745d,1);
    this.cylinder(x,4.53,-2.8,.39,.19,.39,0x433c30,1);
    this.sphere(x,4.39,-2.8,.185,.175,.185,0xffc477,6);
    this.torus(x,4.5,-2.8,.34,.14,.34,0xd7b67b,1);
  }
  // Hanging central arena banner; designed as 3D geometry, no background screenshot.
  this.box(0,3.18,-3.44,1.78,2.35,.055,night?0x184446:0x184b46,4);
  this.box(0,4.29,-3.36,1.83,.055,.086,0xc0974c,1);
  for(let dx of [-.27,.27]){
    this.box(dx,3.42,-3.34,.33,.68,.038,dx<0?0x31af95:0xe6a35e,1);
    this.sphere(dx,3.78,-3.30,.165,.165,.025,dx<0?0x31af95:0xe6a35e,1);
  }
  this.box(0,2.70,-3.34,1.22,.038,.04,0xeac78c,1);
  // Workbenches and shelves stay behind the physical duel area.
  for(let x of [-5.55,5.55]){
    this.box(x,.79,-3.26,2.05,.18,.70,0x745538,0);
    this.box(x,.41,-3.28,1.87,.80,.10,0x402f23,0);
    for(let i=0;i<3;i++){
      this.box(x-.65+i*.58,1.1,-3.25,.25,.42,.26,i===1?0x9f7d51:0x4d4e43,1);
    }
  }
  // Actual fighting stage: layered hardwood, wet specular varnish, brass perimeter.
  this.box(0,.040,0,7.90,.34,2.76,0x3a2e22,0);
  this.box(0,.213,0,7.82,.095,2.70,0x302720,1);
  for(let j=0;j<11;j++){
    const z=-1.215+j*.243;
    const col=night?[0x304f50,0x31575b,0x315154][j%3]:id==='dojo'?[0xbda98a,0xcab498,0xcfb69b][j%3]:[0x9e704b,0xb78656,0xa8774c][j%3];
    this.box(0,.287,z,7.60,.075,.228,col,12,1,0,.48);
    if(j!==10)this.box(0,.330,z+.119,7.59,.004,.010,0x403128,1);
  }
  for(const z of [-1.39,1.39]){
    this.box(0,.14,z,7.95,.18,.09,0xc19a60,1);
    for(const x of [-3.77,-2.75,-1.25,0,1.25,2.75,3.77])this.sphere(x,.17,z+.05,.035,.033,.023,0xe4bf79,1);
  }
  for(const x of [-3.84,3.84])this.box(x,.16,0,.095,.18,2.88,0xc39d62,1);
  for(const x of [-2.6,2.6])this.box(x,.326,0,.016,.005,2.00,0xf4cd83,1,.45);
  // Stage feet and clamps.
  for(const x of [-3.28,3.28])for(const z of [-1.05,1.05]){
    this.box(x,-.11,z,.21,.31,.27,0x332b26,1);this.cylinder(x,.344,z,.038,.020,.038,0xd2ae70,1);
  }
  // Pool and glossy wetting variation: real fluid particles update each player's zone.
  for(let i=0;i<2;i++){
    let wet=game.puddleStrength?.[i]||0;
    if(wet>.001){let x=i===0?-1.55:1.55;
      this.sphere(x,.341,.32,.5+wet*.8,.006,.3+wet*.45,0x62a5a8,19,.09*wet);
    }
  }
 }
 drawProceduralPuppet(f,time,pal,only=null){
  const p=f.pose,dir=f.dir,h=p.head,show=part=>bodyVisible(p,part,only);
  // Keep the wooden soles above the stage without changing collision/rig poses.
  const knee={...p.kneeF,z:.19},heel={...p.kneeB,z:-.17};
  const front={...p.footF,y:Math.max(p.footF.y,STAGE_TOP+.075)};
  const rear={...p.footB,y:Math.max(p.footB.y,STAGE_TOP+.075)};
  for(const [part,a,b,z,width] of [['frontThigh',p.frontHip??p.hip,knee,.19,.19],['frontShin',knee,front,.19,.18],['backThigh',p.backHip??p.hip,heel,-.17,.20],['backShin',heel,rear,-.17,.17]])if(show(part))this.limb(a,b,width,.18,pal.wood,pal.metal,z);
  for(const [j,part]of [[knee,'frontShin'],[heel,'backShin']])if(show(part))this.joint(j,(j.z||0)+.105,.092,pal.metal);
  if(show('frontShin'))this.clevis(knee,.19,.070);if(show('backShin'))this.clevis(heel,-.17,.070);
  if(show('frontThigh'))this.actuator({x:p.hip.x-dir*.08,y:p.hip.y-.10},{x:knee.x-dir*.09,y:knee.y+.08},.32,.024);
  if(show('backShin'))this.actuator({x:heel.x+dir*.08,y:heel.y+.04},{x:rear.x+dir*.08,y:rear.y+.14},-.29,.020);
  for(const [foot,part]of [[front,'frontShin'],[rear,'backShin']])if(show(part)){
    this.box(foot.x+dir*.055,foot.y-.015,foot.z,.42,.12,.25,pal.wood);
    this.box(foot.x-dir*.1,foot.y+.054,foot.z,.08,.14,.235,pal.edge,1);
    this.cylinder(foot.x-dir*.08,foot.y+.11,foot.z+.14,.027,.026,.027,pal.metal,1,Math.PI/2);
  }
  // Separate pelvic chassis, spine and rib panels leave a working waist gap.
  if(show('pelvis'))this.pin(p.hip,.205,.147,pal.metal);
  const waist={x:p.hip.x+(p.shoulder.x-p.hip.x)*.28,y:p.hip.y+(p.shoulder.y-p.hip.y)*.28,z:0};
  if(show('pelvis'))this.box(p.hip.x,p.hip.y+.075,0,f.boss?.52:.43,.17,.34,pal.wood,0,1,-f.lean*.33);
  if(show('torso')){
  this.beam({...p.hip,z:0},{...p.shoulder,z:0},.065,0x615b4d,17);
  this.cylinder(waist.x,waist.y,0,.12,.11,.12,pal.metal,1);
  this.panelBetween({...waist,z:.155},{...p.shoulder,z:.155},f.boss?.43:.35,.14,pal.ivory,0);
  this.panelBetween({...waist,z:.244},{...p.shoulder,z:.244},.19,.035,pal.wood,0);
  this.panelBetween({...waist,z:-.16},{...p.shoulder,z:-.16},.32,.07,pal.edge,0);
  for(const side of [-1,1])this.actuator({x:p.hip.x+side*.17,y:p.hip.y+.1},{x:p.shoulder.x+side*.17,y:p.shoulder.y-.12},-.045,.019);
  for(const u of [.24,.74]){
    const xx=p.hip.x+(p.shoulder.x-p.hip.x)*u,yy=p.hip.y+(p.shoulder.y-p.hip.y)*u;
    this.box(xx,yy,.276,.25,.054,.045,pal.metal,1,1,-f.lean*.33);
    this.sphere(xx-.084,yy,.305,.021,.021,.017,0xffdba1,1);
    this.sphere(xx+.084,yy,.305,.021,.021,.017,0xffdba1,1);
  }
  this.pin(p.shoulder,.22,.175,pal.metal);
  }
  // Brass chest clasp, belt, suspended fabric strip move along with body.
  if(show('pelvis'))this.box(p.hip.x,p.hip.y+.20,.31,.29,.10,.08,pal.leather,7);
  if(show('torso')){
  this.box(p.shoulder.x,p.shoulder.y-.08,.33,.26,.23,.09,pal.metal,1);
  this.cylinder(p.shoulder.x,p.shoulder.y-.08,.40,.055,.032,.055,0x3e3527,1,Math.PI/2);
  }
  if(show('pelvis'))this.panelBetween({x:p.hip.x-dir*.10,y:p.hip.y-.01,z:.29},{x:p.hip.x-dir*.14,y:p.hip.y-.38+Math.sin(time*2+f.slot)*.03,z:.29},.14,.036,pal.cloth,4);
  // Independent left-hand defense arm with true elbow and wrist pivots.
  const twoHanded=p.twoHanded??(f.equipment?.weapon==='maul');
  if(twoHanded){if(show('offUpper')&&show('offForearm'))drawMaulSupportArm(this,f,pal);else drawPartialMaulSupport(this,f,pal,show);}
  else{
    if(show('offUpper'))this.limb(p.offShoulder,p.offElbow,.20,.16,pal.wood,pal.metal,-.14);
    if(show('offForearm'))this.limb(p.offElbow,p.offHand,.17,.15,pal.ivory,pal.metal,-.10);
  }
  if(show('offUpper'))this.joint(p.offShoulder,-.025,.13,pal.metal);if(show('offForearm'))this.joint(p.offElbow,-.005,.105,pal.metal);
  if(show('offForearm'))this.clevis(p.offElbow,-.11,.070,-f.lean*.2);
  if(show('offForearm'))this.joint(p.offHand,twoHanded?(p.offHand.z??.17)+.099:.035,.078,pal.metal);
  if(!twoHanded&&show('offForearm'))this.panelBetween({...p.offHand,z:-.10},{x:p.offHand.x+dir*.15,y:p.offHand.y,z:-.10},.10,.16,pal.leather,7);
  if(show(equipmentBody(f.equipment?.defense??'short')))drawDefense(this,f,pal);
  // Main weapon arm: timber links, hinge plates, small external brass rods and handle.
  if(show('mainUpper'))this.limb(p.mainShoulder,p.mainElbow,.21,.19,pal.wood,pal.metal,.145);
  if(show('mainForearm'))this.limb(p.mainElbow,p.mainHand,.17,.16,pal.ivory,pal.metal,.172);
  if(show('mainUpper'))this.joint(p.mainShoulder,.253,.145,pal.metal);if(show('mainForearm'))this.joint(p.mainElbow,.260,.105,pal.metal);
  if(show('mainForearm'))this.clevis(p.mainElbow,.16,.072,-f.lean*.2);
  if(show('weapon'))this.joint(p.mainHand,.269,.077,pal.metal);
  const hand=p.mainHand;let ux,uy;if(show('weapon'))({ux,uy}=drawWeapon(this,f,pal));
  // Hinged hydraulic barrels and chrome rods change length between real anchors.
  if(show('mainUpper'))this.actuator({x:p.mainShoulder.x-dir*.08,y:p.mainShoulder.y+.075},{x:p.mainElbow.x-dir*.025,y:p.mainElbow.y+.065},.315,.025);
  if(show('mainForearm'))this.actuator({x:p.mainElbow.x-dir*.055,y:p.mainElbow.y+.07},{x:p.mainHand.x-dir*.055,y:p.mainHand.y-.015},.29,.019);
  if(show('offUpper'))this.actuator({x:p.offShoulder.x+dir*.055,y:p.offShoulder.y+.045},{x:p.offElbow.x,y:p.offElbow.y+.08},-.29,.022);
  // Four wooden digits wrap the handle; knuckles are fixed to the moving wrist.
  if(show('weapon'))for(let i=0;i<4;i++){
    const u=(i-1.5)*.037,xx=hand.x+ux*u,yy=hand.y+uy*u;
    this.box(xx-uy*.035,yy+ux*.035,.244,.035,.09,.052,pal.wood,0,1,Math.atan2(uy,ux));
    this.sphere(xx-uy*.075,yy+ux*.075,.254,.025,.025,.027,pal.metal,1);
  }
  if(f.boss){
    // Single-player hydraulics champion: armored brass shoulder housings,
    // secondary linkages and cloth pennant; still actuated by the same IK joints.
    for(const [shoulder,part]of [[p.mainShoulder,'mainUpper'],[p.offShoulder,'offUpper']])if(show(part)){
      this.sphere(shoulder.x,shoulder.y,shoulder===p.mainShoulder?.26:-.22,.22,.20,.155,pal.metal,18);
      this.joint(shoulder,.34,.12,0xf7d798);
    }
    if(show('mainUpper'))this.actuator({x:p.shoulder.x-dir*.13,y:p.shoulder.y-.10},{x:p.mainElbow.x,y:p.mainElbow.y+.12},.39,.038);
    if(show('mainForearm'))this.panelBetween({...p.mainElbow,z:.30},{...p.mainHand,z:.30},.14,.08,0x7e693f,18);
    if(show('torso'))this.panelBetween({x:p.shoulder.x+.04,y:p.shoulder.y+.05,z:.36},{x:p.hip.x+.09,y:p.hip.y+.03,z:.36},.22,.10,0x50412f,1);
    if(show('pelvis'))this.box(p.hip.x,p.hip.y-.19,.34,.24,.55,.055,apronProceduralColor(f,0x902e28),4);
    if(show('pelvis'))this.torus(p.hip.x,p.hip.y+.38,.34,.13,.13,.045,0xf0c370,1);
    if(show('torso'))for(let i=0;i<4;i++){let u=.12+i*.19;this.cylinder(p.hip.x+(p.shoulder.x-p.hip.x)*u,p.hip.y+(p.shoulder.y-p.hip.y)*u,.39,.021,.03,.021,0xe3c68c,1,Math.PI/2);}
  }
  // Highly detailed head mount and tensile ring below water mass.
  if(show('neck')){
  this.beam({...p.shoulder,z:0},{x:h.x,y:h.y-.40,z:.025},.075,pal.edge,0);
  this.cylinder(h.x,h.y-.47,.018,.183,.050,.183,pal.metal,1);
  this.cylinder(h.x,h.y-.435,.018,.116,.051,.116,0x392e25,1);
  }
 }
 drawJointMarks(pose,only=null){
  if(this.depthOnly)return;
  for(const {at,to,z,damage}of jointMarks(pose,only)){
    const angle=Math.atan2(to.y-at.y,to.x-at.x),dx=Math.cos(angle),dy=Math.sin(angle);
    for(let i=0;i<3;i++){
      const along=.035+i*.018,across=(i-1)*.012;
      this.box(at.x+dx*along-dy*across,at.y+dy*along+dx*across,z,.003,.024+damage*.025,.002,0x2c1b12,0,1,angle+.35+i*.23);
    }
    this.torus(at.x,at.y,z+.006,.047+damage*.014,.047+damage*.014,.009,0x40362b,17);
  }
 }
 drawDetachedPuppet(f,time,pal,detailed){
  for(const fragment of f.pose.detached??[]){
    const bodies=new Set(fragment.bodies),pose={...fragment.sourcePose,joints:{[fragment.joint]:{damage:1,detached:false}}};
    const source={...f,pose,equipment:pose.equipment??f.equipment},proxy=rigidRenderer(this,fragment.transform);
    if(detailed){
      const entry=this.assetScene.characters[f.boss?'boss':f.slot===1?'mint':'amber'];
      this.detachedPoseCache??=new WeakMap();let cached=this.detachedPoseCache.get(fragment.sourcePose);
      if(!cached||cached.entry!==entry){cached={entry,matrices:characterTransforms(entry.prepared,source)};this.detachedPoseCache.set(fragment.sourcePose,cached);}
      const matrices=detachedCharacterTransforms(entry.prepared,source,fragment,cached.matrices);
      entry.gpu.parts.forEach((part,index)=>{if(matrices[index])this.assetPart(entry.gpu,part,matrices[index],
        apronMaterialOverride(source,entry.prepared.parts[index],entry.gpu.materials[part.material]));});
      if(bodies.has('weapon')&&!proxy.detailedEquipment(source,source.equipment?.weapon??'sword'))drawWeapon(proxy,source,pal);
      if(bodies.has(equipmentBody(source.equipment?.defense??'short'))&&!proxy.detailedEquipment(source,source.equipment?.defense??'short'))drawDefense(proxy,source,pal);
    }else proxy.drawProceduralPuppet(source,time,pal,bodies);
    proxy.drawJointMarks(pose,bodies);
  }
 }
 drawPuppet(f,time,game){
  const p=f.pose,dir=f.dir,pal=f.slot===1?{
    wood:0xa16c42,edge:0x78502f,light:0xc99e67,ivory:0xdfc49a,metal:0xd4af63,steel:0xa9b9b7,balloon:0x21b79b,liquid:0x60dacc,dark:0x106a62,leather:0x62442f,cloth:0x14866f
  }:{wood:0x9a6541,edge:0x6c472e,light:0xbb8855,ivory:0xd4b48a,metal:0xcda35f,steel:0xb6bdbc,balloon:0xed8a37,liquid:0xf5c084,dark:0x9f4f23,leather:0x623624,cloth:0x9d4b31};
  Object.assign(pal,balloonPalette(f));
  pal.cloth=apronProceduralColor(f,pal.cloth);
  // Ambient contact shadows use multiple softly transparent flattened meshes.
  for(let i=0;i<3;i++)this.sphere(f.baseX,.345+i*.001,.07,.63+i*.20,.012,.27+i*.11,0x081519,5,.27-i*.06);
  const h=p.head,detailed=this.detailedPuppet(f);
  if(detailed){
    if(!this.detailedEquipment(f,f.equipment?.weapon??'sword'))drawWeapon(this,f,pal);
    if(!this.detailedEquipment(f,f.equipment?.defense??'short'))drawDefense(this,f,pal);
  }else{
  this.drawProceduralPuppet(f,time,pal);
  }
  this.drawDetachedPuppet(f,time,pal,detailed);this.drawJointMarks(f.pose);
  if(this.depthOnly)return;
  if(f.fluid.retainedVolume>0){
   if(f.membrane?.punctured&&f.balloon.ruptureAge>0){
    // Once the physical vessel is open, render the actual retained parcel
    // positions. A nominal ellipsoid would keep drawing water above the skin.
    // Kernel reconstruction is still approximate near the contact boundary.
    const particles=f.fluid.retainedParticles,water=buildFluidSurface(particles,{quality:game.quality,domain:{floor:TABLE_TOP,bounds:3.7,depth:1.31}});
    if(water.p.length&&!water.stats?.budgetReached)this.dynamicDraw(water,pal.liquid,13,.68,0,water);
    else this.pending.push({kind:'instance',particles,color:pal.liquid,material:3,opacity:.75,order:0,depth:0});
   }else{
    // The cap, its free surface and particles share the same simulation frame.
    const water=containedWaterMesh(h,{scale:f.balloonSize,quality:game.quality,frame:f.fluid.surfaceFrame});
    this.dynamicDraw(water.body,pal.liquid,13,.68,0,water);
    this.dynamicDraw(water.surface,pal.liquid,14,.76,1,water);
    this.dynamicDraw(water.meniscus,pal.liquid,15,.85,1,water);
   }
  }
  if(f.globIntact){
    const m=f.membrane?.mesh()||latexMesh(h,{sway:f.balloon.wave,water:f.waterShift,time,quality:game.quality,scale:f.balloonSize});
    this.dynamicDraw(m,pal.balloon,2,.93,2);
    // Higher specular top knot and small latex tie.
    const top=f.membrane?.nodes.reduce((a,b)=>b.ref.y>a.ref.y?b:a);
    const knot=top?{x:top.x,y:top.y,z:top.z}:{x:h.x,y:h.y+.503*f.balloonSize,z:.025};
    this.sphere(knot.x,knot.y+.018,knot.z,.032,.035,.029,pal.dark,10,.95);
    for(const side of [-1,1])this.draw('sphere',C(T(knot.x+side*.032,knot.y+.057,knot.z),RZ(side*.52),S(.037,.061,.018)),pal.balloon,10,.91);
    // Decorative air pockets follow submerged fluid samples. Their radius fits
    // both the free plane and the ellipsoid; they carry no liquid ledger volume.
    for(let i=0;i<5;i++){
      const sample=f.fluid.particles[(11+i*37)%f.fluid.particles.length],frame=f.fluid.surfaceFrame;
      const minRadius=Math.min(WATER_RADII.x,WATER_RADII.y,WATER_RADII.z)*f.balloonSize;
      const radius=Math.min(.014*f.balloonSize,(frame.height-sample.uy)*minRadius*.4,(1-Math.hypot(sample.ux,sample.uy,sample.uz))*minRadius*.4);
      if(radius>.002)this.sphere(h.x+sample.lx,h.y+sample.ly,(h.z??.025)+sample.lz,radius,radius,radius,0xd9ffff,3,.38);
    }
  }else{
    if(f.membrane?.punctured||f.balloon.ruptureAge<1.55){
      const m=f.membrane?.punctured?f.membrane.mesh():latexMesh(h,{burstAge:f.balloon.ruptureAge,tearAngle:f.balloon.tearAngle,impact:f.fluid.impact,localImpact:f.fluid.localImpact,quality:game.quality,scale:f.balloonSize});
      this.dynamicDraw(m,pal.balloon,10,.84,2);
    }
    this.sphere(h.x,h.y-.44,0,.069,.059,.078,pal.dark,1);
  }
 }
 ensureDynamic(){if(this.dynamic.vao)return;const gl=this.gl,vao=gl.createVertexArray();gl.bindVertexArray(vao);
  const pb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,pb);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
  const nb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,nb);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0);
  const ob=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,ob);gl.vertexAttribPointer(3,1,gl.FLOAT,false,0,0);
  gl.bindVertexArray(null);this.dynamic={vao,pb,nb,ob};}
 dynamicDraw(mesh,color,material,opacity=1,order=0,opticalMesh=null){if(!mesh.p.length)return;this.pending.push({kind:'dynamic',mesh,color,material,opacity,order,depth:0,opticalMesh:opticalMesh||(material===9?mesh:null)});}
 flushDynamic(item,reuseGeometry=false){const gl=this.gl,U=this.U,m=item.mesh;gl.uniform1i(U.uAssetEnabled,0);this.ensureDynamic();const d=this.dynamic;gl.bindVertexArray(d.vao);
  if(!reuseGeometry){
    gl.bindBuffer(gl.ARRAY_BUFFER,d.pb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(m.p),gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,d.nb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(m.n),gl.DYNAMIC_DRAW);
    if(m.optics){gl.bindBuffer(gl.ARRAY_BUFFER,d.ob);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(m.optics),gl.DYNAMIC_DRAW);}
  }
  if(m.optics)gl.enableVertexAttribArray(3);
  else{gl.disableVertexAttribArray(3);gl.vertexAttrib1f(3,.0045);}
  gl.disableVertexAttribArray(2);gl.vertexAttrib4f(2,0,0,0,1);
  const offset=m.offset;gl.uniform1i(U.uInstancing,0);gl.uniformMatrix4fv(U.uModel,false,offset?T(offset.x,offset.y,offset.z):I());gl.uniformMatrix3fv(U.uNormal,false,new Float32Array([1,0,0,0,1,0,0,0,1]));
  gl.uniform3fv(U.uColor,Array.isArray(item.color)?item.color:rgb(item.color));gl.uniform1i(U.uMaterial,item.material);
  gl.uniform1f(U.uOpacity,item.opacity);gl.uniform1f(U.uWobble,0);gl.uniform1f(U.uWet,0);
  gl.drawArrays(gl.TRIANGLES,0,m.p.length/3);this.stats.draws++;this.stats.triangles+=m.p.length/9;
 }
 instance(shape,particles,color,material=3,opacity=.85){if(!particles.length)return;const gl=this.gl,U=this.U,m=this.mesh[shape];gl.uniform1i(U.uAssetEnabled,0);
  const data=new Float32Array(particles.length*4);
  for(let i=0;i<particles.length;i++){const p=particles[i];data[i*4]=p.x;data[i*4+1]=p.y;data[i*4+2]=p.z;data[i*4+3]=p.volume>0?(shape==='droplet'?waterDropRadius(p.volume):Math.cbrt(3*p.volume/(4*Math.PI))):(p.r||.035)*(p.wet?.69:1);}
  gl.bindVertexArray(m.vao);gl.bindBuffer(gl.ARRAY_BUFFER,m.instance);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
  gl.disableVertexAttribArray(3);gl.vertexAttrib1f(3,.0045);
  gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(2,1);
  gl.uniform1i(U.uInstancing,1);gl.uniformMatrix4fv(U.uModel,false,I());gl.uniformMatrix3fv(U.uNormal,false,new Float32Array([1,0,0,0,1,0,0,0,1]));
  gl.uniform3fv(U.uColor,rgb(color));gl.uniform1i(U.uMaterial,material);gl.uniform1f(U.uOpacity,opacity);
  gl.uniform1f(U.uWobble,0);gl.uniform1f(U.uWet,0);
  gl.drawElementsInstanced(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0,particles.length);
  gl.vertexAttribDivisor(2,0);gl.disableVertexAttribArray(2);
  this.stats.draws++;this.stats.triangles+=particles.length*m.count/3;
 }
 drawEffects(game){
  if(this.depthOnly)return;
  const batches=effectBatches(game.effects?.particles);
  for(const batch of batches)this.pending.push({kind:'instance',...batch});
  this.stats.effects={particles:batches.reduce((count,batch)=>count+batch.particles.length,0),batches:batches.length,cap:EFFECT_LIMITS.total};
 }
 renderLiquid(game,time){
  for(const f of game.fighters){
    const fluid=f.fluid;if(!fluid.released)continue;
    const particles=fluid.releasedParticles;
    if(!particles.length){this.waterSurfaces.delete(f.slot);continue;}
    // Marching tetrahedra extracts a real 3D iso-surface from a spatial fluid density field.
    // Translate the entire cached field by its measured common COM shift; keep
    // it only while every sample's residual remains within a quarter of the
    // finest cell. No vertex deformation or volume scaling is performed.
    const refresh=game.quality==='eco'?.24:game.quality==='ultra'?.06:.125;
    const cache=this.waterSurfaces.get(f.slot);
    // A budget fallback already draws live parcels; its unused mesh need not
    // rebuild for motion alone. Time/emission/profile invalidation still applies.
    const drawable=cache?.mesh?.p.length&&!cache.mesh.stats?.budgetReached;
    const movement=drawable&&!this.disableWaterMesh?waterSurfaceMotion(cache.motion,particles):null;
    if(!this.disableWaterMesh && (!cache||cache.fluid!==fluid||cache.count!==particles.length||cache.quality!==game.quality||time-cache.time>refresh||time<cache.time||(drawable&&(!cache.motion||movement.distance>cache.motion.tolerance)))){
      let mesh=buildFluidSurface(particles,{quality:game.quality,domain:{floor:TABLE_TOP,bounds:3.7,depth:1.31}});
      this.waterSurfaces.set(f.slot,{time,mesh,fluid,count:particles.length,quality:game.quality,motion:waterSurfaceSnapshot(particles,game.quality,mesh),maxSampleDisplacement:0,maxSampleResidual:0});
    }else if(cache&&movement){cache.maxSampleDisplacement=movement.rawDistance;cache.maxSampleResidual=movement.distance;cache.mesh.offset=movement.offset;}
    const col=balloonPalette(f).drop;
    const surface=this.waterSurfaces.get(f.slot)?.mesh;
    const needsFallback=this.disableWaterMesh||!surface?.p.length||surface.stats?.budgetReached;
    if(!needsFallback)this.dynamicDraw(surface,col,9,.55,0);
    if(needsFallback)this.pending.push({kind:'instance',particles,color:col,material:3,opacity:.75,order:1,depth:0});
  }
  for(const side of [1,2]){
    const liquid=game.particles.filter(p=>p.color===side);
    if(liquid.length)this.pending.push({kind:'instance',particles:liquid,color:balloonPalette(game.fighters.find(f=>f.slot===side)??{slot:side}).mist,material:3,opacity:.73,order:1,depth:0});
  }
  for(const r of game.rings){const a=Math.max(0,1-r.age/r.ttl),radius=r.r+r.age*.21;
    this.sphere(r.x,.343,r.z,radius,.007,radius*.65,balloonPalette(game.fighters.find(f=>f.slot===r.color)??{slot:r.color}).ring,19,.24*a);
  }
  for(const s of game.shards){const col=balloonPalette(game.fighters.find(f=>f.slot===s.slot)??{slot:s.slot}).balloon;
    this.draw('box',C(T(s.x,s.y,s.z),RZ(s.rz),RY(s.rx),S(s.size,.014,s.size*.55)),col,10,.85);
  }
  for(const s of game.spark){let a=Math.max(0,1-s.age/s.ttl);this.sphere(s.x,s.y,s.z,.026*a,.026*a,.025*a,0xffd08d,6,a);}
 }
 flush(onLayer){const gl=this.gl;
  // The transparent pass owns depth writing; particle batches preserve this state.
  this.pending.sort((a,b)=>a.order-b.order || a.depth-b.depth);
  gl.depthMask(false);
  let layer=null,lastOpticalMesh=null;
  for(const item of this.pending){
    let geometryUploaded=false;
    if(layer!==null&&layer!==item.order)onLayer?.();layer=item.order;
    gl.uniform1i(this.U.uHasOpticalDepth,0);
    if(item.opticalMesh&&this.opticalDepth.available&&this.transmission.available){
      if(lastOpticalMesh!==item.opticalMesh){
        gl.uniform1i(this.U.uDepthPass,1);
        try{this.opticalDepth.capture(()=>this.flushDynamic({...item,mesh:item.opticalMesh}),this.transmission.composite.framebuffer);}
        finally{gl.uniform1i(this.U.uDepthPass,0);gl.viewport(0,0,this.width,this.height);}
        // Optical depth just uploaded this exact mesh into the same dynamic
        // VAO. Keep that geometry for its immediately following color draw.
        // Nothing is reused across frames or different/mutable mesh objects.
        geometryUploaded=item.opticalMesh===item.mesh;
        lastOpticalMesh=item.opticalMesh;
      }
      gl.uniform1i(this.U.uHasOpticalDepth,1);
    }
    // The torn film is two-sided, but its resolved transmission has full pixel
    // coverage. Keep the nearest fold; otherwise rear triangles overwrite the
    // front film with another lookup of the unchanged background image.
    const writeFilmDepth=this.transmission.available&&item.material===10;
    if(writeFilmDepth)gl.depthMask(true);
    if(item.kind==='mesh')this.raw(item.shape,item.model,item.color,item.material,item.opacity,item.wobble,item.wet);
    else if(item.kind==='asset'){this.assetGPU.draw(item.model,item.part,item.matrix,this.U,item.deform);this.stats.draws++;this.stats.triangles+=item.part.count/3;}
    else if(item.kind==='dynamic')this.flushDynamic(item,geometryUploaded);
    else if(item.kind==='instance')this.instance('droplet',item.particles,item.color,item.material,item.opacity);
    if(writeFilmDepth)gl.depthMask(false);
  }
  gl.depthMask(true);this.pending.length=0;
 }
 captureWorkshop(game,time){
  const gl=this.gl,U=this.U,eye=[0,2,0],directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],ups=[[0,-1,0],[0,-1,0],[0,0,1],[0,0,-1],[0,-1,0],[0,-1,0]];
  gl.uniform1i(U.uHasScene,0);gl.uniform1i(U.uHasEnvironment,0);gl.uniform1i(U.uHasShadow,0);
  gl.uniform3iv(U.uStaticShadowIndices,this.staticShadowIndices??[-1,-1,-1]);
  this.environment.capture(`${game.arena}:${game.lightingMode}`,face=>{
    gl.uniform1i(U.uLinearTarget,1);
    const target=eye.map((v,i)=>v+directions[face][i]);
    gl.uniformMatrix4fv(U.uVP,false,mul(perspective(Math.PI/2,1,.1,40),lookAt(eye,target,ups[face])));
    gl.uniform3fv(U.uEye,new Float32Array(eye));
    this.drawArena({...game,puddleStrength:[0,0]},time);this.pending.length=0;
  });
  this.environment.bind();gl.uniform1i(U.uHasEnvironment,this.environment.available?1:0);
  gl.viewport(0,0,this.width,this.height);
 }
 captureShadows(game,time){
  const gl=this.gl,U=this.U,start=performance.now(),draws=this.stats.draws,triangles=this.stats.triangles;
  // This renderer owns the context. Establish a complete pass boundary rather
  // than reading it back from the GPU for every shadow map on every frame.
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.width,this.height);
  gl.depthMask(true);gl.depthFunc(gl.LEQUAL);gl.clearDepth(1);gl.colorMask(true,true,true,true);gl.cullFace(gl.BACK);
  gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.activeTexture(gl.TEXTURE0);
  const shadowReturn=map=>({active:gl.TEXTURE0,texture:map.texture,unit:map.unit,draw:null,read:null,
    viewport:[0,0,this.width,this.height],depthMask:true,depthFunc:gl.LEQUAL,depthClear:1,colorMask:[true,true,true,true],cullFace:gl.BACK,blend:true,cull:false,depth:true});
  gl.uniform1i(U.uHasShadow,0);this.shadows.ensure(game.quality);
  if(this.shadows.available){
    this.pending.length=0;this.depthOnly=true;gl.uniform1i(U.uDepthPass,1);gl.uniform1f(U.uTime,time);gl.uniformMatrix4fv(U.uVP,false,this.shadows.matrix);
    try{this.shadows.capture(()=>{this.drawArena(game,time);for(const f of game.fighters)this.drawPuppet(f,time,game);},shadowReturn(this.shadows));}
    finally{this.depthOnly=false;this.pending.length=0;gl.uniform1i(U.uDepthPass,0);}
    this.shadows.bind(gl.TEXTURE0);gl.uniformMatrix4fv(U.uShadowVP,false,this.shadows.matrix);gl.uniform1f(U.uShadowSize,this.shadows.size);gl.uniform1i(U.uHasShadow,1);
  }
  this.stats.shadow={available:this.shadows.available,error:this.shadows.error,size:this.shadows.size,bytes:this.shadows.bytes,
    draws:this.stats.draws-draws,triangles:this.stats.triangles-triangles,cpuMs:performance.now()-start};
  // Dominant window/front emitters reuse static opaque-workshop occlusion.
  // Puppets cast their moving shadows through the key map above. These maps
  // solve the desk/floor barriers without redrawing three full scenes per frame.
  const lighting=this.assetScene.environment?.lightingPresets?.[game.arena],indices=[-1,-1,-1],sizes=[0,0,0];
  if(lighting){
    const names=['Left tall window | blue bounce','Right tall window | blue rim','Soft front return'];
    const key=game.quality+':'+lighting.names.join('|');
    for(let i=0;i<3;i++){
      const map=this.staticShadows[i],index=lighting.names.indexOf(names[i]);if(index<0)continue;
      map.ensure(game.quality);
      if(this.staticShadowKey!==key&&map.available){
        const o=index*4,eye=[...lighting.positions.slice(o,o+3)],direction=[...lighting.directions.slice(o,o+3)];
        map.matrix=shadowViewProjection(eye,eye.map((value,axis)=>value+direction[axis]*4));
        this.pending.length=0;this.depthOnly=true;gl.uniform1i(U.uDepthPass,1);gl.uniformMatrix4fv(U.uVP,false,map.matrix);
        this.staticShadowPass=true;
        try{map.capture(()=>this.drawArena(game,time),shadowReturn(map));}finally{this.staticShadowPass=false;this.depthOnly=false;this.pending.length=0;gl.uniform1i(U.uDepthPass,0);}
      }
      if(map.available){indices[i]=index;sizes[i]=map.size;map.bind(gl.TEXTURE0);gl.uniformMatrix4fv(U['uStaticShadowVP'+i],false,map.matrix);}
    }
    this.staticShadowKey=key;
  }
  gl.uniform3iv(U.uStaticShadowIndices,indices);gl.uniform3fv(U.uStaticShadowSizes,sizes);
  this.staticShadowIndices=indices;
  this.stats.staticShadows=this.staticShadows.map((map,index)=>({lightIndex:indices[index],available:map.available,size:map.size,bytes:map.bytes,error:map.error}));
 }
 presentScene(color,width,height){
  const gl=this.gl,p=this.post;
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.useProgram(p.program);gl.bindVertexArray(p.vao);
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,color);gl.uniform1i(p.image,2);gl.uniform2f(p.texel,1/width,1/height);
  gl.drawArrays(gl.TRIANGLES,0,3);gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);this.stats.draws++;
 }
 dispose(){
  this.disposed=true;this.assetAbort?.abort();
  const gl=this.gl;gl.useProgram(null);gl.bindVertexArray(null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  this.transmission.dispose();this.environment.dispose();this.opticalDepth.dispose();this.shadows.dispose();
  for(const map of this.staticShadows)map.dispose();
  this.assetGPU.dispose();
  for(const mesh of Object.values(this.mesh)){for(const key of ['pb','nb','ib','instance'])if(mesh[key])gl.deleteBuffer(mesh[key]);if(mesh.vao)gl.deleteVertexArray(mesh.vao);}
  for(const key of ['pb','nb','ob'])if(this.dynamic[key])gl.deleteBuffer(this.dynamic[key]);if(this.dynamic.vao)gl.deleteVertexArray(this.dynamic.vao);
  if(this.post.vao)gl.deleteVertexArray(this.post.vao);gl.deleteProgram(this.post.program);gl.deleteProgram(this.program);this.waterSurfaces.clear();this.pending.length=0;
 }
 render(game,time,profile=null){
  this.renderScale=profile?.renderScale??1;
  game=renderQualityView(game,profile);
  this.stats.performance={mode:profile?.mode??'fixed',level:profile?.level??0,quality:game.quality,renderScale:this.renderScale};
  const gl=this.gl,U=this.U;this.resize();this.stats.draws=0;this.stats.triangles=0;this.renderTime=time;
  this.stats.assets={...this.assetStatus,gpuBytesApprox:this.assetGPU.bytes};
  // Loading is an atomic presentation boundary: partial detailed models never
  // replace visible procedural versions one by one. Failures settle before
  // showing their permanent fallback, with no desktop loading interface.
  if(this.assetStatus.loading){
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.width,this.height);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);return;
  }
  gl.clearColor(.024,.035,.043,1);gl.useProgram(this.program);
  this.workshopLighting(game);
  gl.uniform1i(U.uNeutral,game.lightingMode==='neutral'?1:0);
  this.captureShadows(game,time);
  const shadowDraws=this.stats.draws,shadowTriangles=this.stats.triangles;
  this.captureWorkshop(game,time);this.stats.draws=shadowDraws;this.stats.triangles=shadowTriangles;
  gl.uniform1i(U.uHasShadow,this.shadows.available?1:0);
  this.transmission.ensure(this.width,this.height);this.opticalDepth.ensure(this.width,this.height);this.transmission.begin();
  gl.uniform1i(U.uDepthPass,0);gl.uniform1i(U.uHasOpticalDepth,0);
  gl.uniform1i(U.uLinearTarget,this.transmission.available?1:0);
  this.stats.transmission={available:this.transmission.available,error:this.transmission.error,bytes:this.transmission.bytes,format:this.colorFormat.name};
  this.stats.environment={available:this.environment.available,error:this.environment.error,size:this.environment.size};
  this.stats.opticalDepth={available:this.opticalDepth.available,error:this.opticalDepth.error,bytes:this.opticalDepth.bytes};
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  // Simulated phase time drives presentation only. Combat stays authored and
  // stable; round transitions return to it before control resumes.
  const aspect=this.width/this.height;
  this.cameraMotionPreference??=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')??{matches:false};
  const camera=duelCamera({phase:game.phase,phaseClock:game.phaseClock,clock:game.clock,round:game.round,replay:game.replay,
    cameraMode:game.cameraMode,aspect,reducedMotion:game.reducedMotion??this.cameraMotionPreference.matches});
  const {eye,target,fov}=camera;this.stats.camera={...camera,aspect};
  const vp=mul(perspective(fov,aspect,camera.near,camera.far),lookAt(eye,target,[0,1,0]));
  gl.uniformMatrix4fv(U.uVP,false,vp);gl.uniform3fv(U.uEye,new Float32Array(eye));gl.uniform3fv(U.uViewAxis,new Float32Array(norm(eye.map((v,i)=>v-target[i]))));gl.uniform1f(U.uTime,time);
  gl.uniform1i(U.uNeutral,game.lightingMode==='neutral'?1:0);
  this.drawArena(game,time);
  for(const f of game.fighters)this.drawPuppet(f,time,game);
  this.renderLiquid(game,time);
  this.drawEffects(game);
  if(this.transmission.prepare()){gl.uniform1i(U.uHasScene,1);gl.uniform2f(U.uSceneSize,this.width,this.height);}
  this.flush(()=>this.transmission.snapshot());
  const targetMarker=game.precisionTarget;
  if(targetMarker&&game.phase==='fight'&&game.fighters.some(f=>f.slot===targetMarker.slot&&f.globIntact)){
    // Projected training guide. It neither modifies the skin nor participates
    // in contact detection; the objective validator uses the same XYZ center.
    gl.uniform1i(U.uHasScene,0);gl.disable(gl.DEPTH_TEST);
    this.raw('torus',C(T(targetMarker.x,targetMarker.y,targetMarker.z),S(targetMarker.radius,targetMarker.radius,.008)),0xffe7a5,6,1,0,0);
    gl.enable(gl.DEPTH_TEST);
  }
  this.transmission.present((color,w,h)=>this.presentScene(color,w,h));
 }
}

