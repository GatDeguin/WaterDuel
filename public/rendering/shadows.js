// A depth-only view of the real opaque geometry from the workshop's key lamp.
// Transparent water/latex remain transmitting media and are not opaque casters.
const normalize=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function shadowViewProjection(eye=[-2.45,4.1,3],target=[0,1.4,0]){
  const z=normalize(eye.map((v,i)=>v-target[i])),x=normalize(cross([0,1,0],z)),y=cross(z,x);
  const view=new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,
    -x.reduce((sum,v,i)=>sum+v*eye[i],0),-y.reduce((sum,v,i)=>sum+v*eye[i],0),-z.reduce((sum,v,i)=>sum+v*eye[i],0),1]);
  const near=.25,far=16,f=1/Math.tan(110*Math.PI/360),projection=new Float32Array([f,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);
  const result=new Float32Array(16);
  for(let column=0;column<4;column++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)result[column*4+row]+=projection[k*4+row]*view[column*4+k];
  return result;
}

// Only the key light's direct and clearcoat terms use this visibility.
// Manual PCF avoids requiring a depth-compare sampler/extension in fallback mocks.
export const SHADOW_GLSL=`
uniform bool uHasShadow;
uniform sampler2D uShadowMap;
uniform mat4 uShadowVP;
uniform float uShadowSize;
float mappedVisibility(sampler2D map,mat4 matrix,float mapSize,vec3 position,vec3 normal,vec3 lightDirection){
  vec4 clip=matrix*vec4(position+normal*.006,1.0);
  if(clip.w<=0.0)return 1.0;
  vec3 projected=clip.xyz/clip.w*.5+.5;
  if(any(lessThanEqual(projected,vec3(0.0)))||any(greaterThanEqual(projected,vec3(1.0))))return 1.0;
  float bias=.000025+.000080*(1.0-max(dot(normal,lightDirection),0.0));
  float visibility=0.0,texel=1.0/max(mapSize,1.0);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    float depth=texture(map,projected.xy+vec2(float(x),float(y))*texel).r;
    visibility+=projected.z-bias<=depth?1.0:0.0;
  }
  return visibility/9.0;
}
float keyVisibility(vec3 position,vec3 normal,vec3 lightDirection){
  return uHasShadow?mappedVisibility(uShadowMap,uShadowVP,uShadowSize,position,normal,lightDirection):1.0;
}
uniform ivec3 uStaticShadowIndices;
uniform sampler2D uStaticShadow0,uStaticShadow1,uStaticShadow2;
uniform mat4 uStaticShadowVP0,uStaticShadowVP1,uStaticShadowVP2;
uniform vec3 uStaticShadowSizes;
float workshopVisibility(int index,vec3 position,vec3 normal,vec3 direction){
  if(index==0)return keyVisibility(position,normal,direction);
  if(index==uStaticShadowIndices.x)return mappedVisibility(uStaticShadow0,uStaticShadowVP0,uStaticShadowSizes.x,position,normal,direction);
  if(index==uStaticShadowIndices.y)return mappedVisibility(uStaticShadow1,uStaticShadowVP1,uStaticShadowSizes.y,position,normal,direction);
  if(index==uStaticShadowIndices.z)return mappedVisibility(uStaticShadow2,uStaticShadowVP2,uStaticShadowSizes.z,position,normal,direction);
  return 1.0;
}
`;

const read=(gl,key,fallback)=>{
  const value=gl.getParameter?.(key);return value===undefined?fallback:value;
};
function snapshot(gl,unit=gl.TEXTURE5){
  const active=read(gl,gl.ACTIVE_TEXTURE,gl.TEXTURE0);
  gl.activeTexture(unit);const texture=read(gl,gl.TEXTURE_BINDING_2D,null);gl.activeTexture(active);
  return {active,texture,unit,draw:read(gl,gl.DRAW_FRAMEBUFFER_BINDING,null),read:read(gl,gl.READ_FRAMEBUFFER_BINDING,null),
    viewport:Array.from(read(gl,gl.VIEWPORT,[0,0,1,1])),depthMask:read(gl,gl.DEPTH_WRITEMASK,true),depthFunc:read(gl,gl.DEPTH_FUNC,gl.LEQUAL),
    depthClear:read(gl,gl.DEPTH_CLEAR_VALUE,1),colorMask:Array.from(read(gl,gl.COLOR_WRITEMASK,[true,true,true,true])),cullFace:read(gl,gl.CULL_FACE_MODE,gl.BACK),
    blend:!!gl.isEnabled?.(gl.BLEND),cull:!!gl.isEnabled?.(gl.CULL_FACE),depth:!!gl.isEnabled?.(gl.DEPTH_TEST)};
}
function restore(gl,state){
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,state.draw);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,state.read);
  gl.viewport(...state.viewport);gl.depthMask(state.depthMask);gl.depthFunc(state.depthFunc);gl.clearDepth(state.depthClear);gl.colorMask(...state.colorMask);gl.cullFace(state.cullFace);
  for(const [capability,enabled]of [[gl.BLEND,state.blend],[gl.CULL_FACE,state.cull],[gl.DEPTH_TEST,state.depth]])enabled?gl.enable(capability):gl.disable(capability);
  gl.activeTexture(state.unit);gl.bindTexture(gl.TEXTURE_2D,state.texture);gl.activeTexture(state.active);
}

export class ShadowMap{
  constructor(gl,{unit=5,resolutionScale=1}={}){this.gl=gl;this.unit=gl['TEXTURE'+unit];this.resolutionScale=resolutionScale;this.matrix=shadowViewProjection();this.size=0;this.texture=null;this.framebuffer=null;this.available=false;this.error=null;this.bytes=0;}
  ensure(quality='high'){
    const requested=Math.max(1,Math.round(({eco:512,high:1024,ultra:1536}[quality]??1024)*this.resolutionScale));
    // This limit is immutable for the lifetime of a WebGL context. Reading it
    // every frame forces a driver round trip even when the map is unchanged.
    if(this.textureLimit===undefined){const reported=this.gl.getParameter?.(this.gl.MAX_TEXTURE_SIZE);this.textureLimit=Number.isFinite(reported)&&reported>0?reported:Infinity;}
    const limit=this.textureLimit;
    const size=Math.max(1,Math.min(requested,limit));
    if(this.size===size&&(this.available||this.error))return this.available;
    this.dispose();this.size=size;this.error=null;const gl=this.gl,state=snapshot(gl,this.unit);
    try{
      this.texture=gl.createTexture();this.framebuffer=gl.createFramebuffer();
      if(!this.texture||!this.framebuffer)throw Error('Sin recursos para sombra de lámpara');
      gl.activeTexture(this.unit);gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,size,size,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
      for(const [key,value]of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,value);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,this.texture,0);
      gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Framebuffer de sombra incompleto');
      this.available=true;this.bytes=size*size*4;
    }catch(error){this.error=error.message;this.dispose();}
    finally{restore(gl,state);}
    return this.available;
  }
  capture(draw,restoreState=null){
    // Standalone callers retain arbitrary external GL state. The owning
    // renderer supplies its explicit pass boundary to avoid synchronous reads.
    if(!this.available)return false;const gl=this.gl,state=restoreState??snapshot(gl,this.unit);
    // A declared sampler can stay active in the depth-only shader's branch.
    gl.activeTexture(this.unit);gl.bindTexture(gl.TEXTURE_2D,null);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.viewport(0,0,this.size,this.size);
    gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.depthFunc(gl.LEQUAL);gl.clearDepth(1);gl.colorMask(false,false,false,false);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.clear(gl.DEPTH_BUFFER_BIT);
    try{draw();}finally{restore(gl,state);}return true;
  }
  bind(activeTexture){
    const gl=this.gl,active=activeTexture??read(gl,gl.ACTIVE_TEXTURE,gl.TEXTURE0);
    gl.activeTexture(this.unit);gl.bindTexture(gl.TEXTURE_2D,this.available?this.texture:null);gl.activeTexture(active);
  }
  dispose(){
    const gl=this.gl;if(this.texture)gl.deleteTexture(this.texture);if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);
    this.texture=null;this.framebuffer=null;this.available=false;this.bytes=0;
  }
}
