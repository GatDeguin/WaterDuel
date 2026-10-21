// Fullscreen triangle avoids a single-sample -> multisample framebuffer blit.
// FXAA operates only on the resolved image; it never changes simulation quality.
export const POST_VERTEX=`#version 300 es
precision highp float;
out vec2 vUV;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUV=p;gl_Position=vec4(p*2.0-1.0,0,1);}`;
export const POST_FRAGMENT=`#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uImage;
uniform vec2 uTexel;
out vec4 outColor;
vec3 sampleImage(vec2 uv){vec3 linear=max(texture(uImage,uv).rgb,vec3(0));return pow(linear/(1.0+linear),vec3(1.0/2.2));}
void main(){
  vec3 c=sampleImage(vUV),nw=sampleImage(vUV+vec2(-1,-1)*uTexel),
    ne=sampleImage(vUV+vec2(1,-1)*uTexel),sw=sampleImage(vUV+vec2(-1,1)*uTexel),se=sampleImage(vUV+vec2(1,1)*uTexel);
  vec3 luma=vec3(.299,.587,.114);float m=dot(c,luma),a=dot(nw,luma),b=dot(ne,luma),d=dot(sw,luma),e=dot(se,luma);
  float lo=min(m,min(min(a,b),min(d,e))),hi=max(m,max(max(a,b),max(d,e)));
  if(hi-lo<max(.035,hi*.125)){outColor=vec4(c,1);return;}
  vec2 direction=vec2(-((a+b)-(d+e)),(a+d)-(b+e));
  float reduce=max((a+b+d+e)*.03125,.0078125);
  direction=clamp(direction/(min(abs(direction.x),abs(direction.y))+reduce),vec2(-6),vec2(6))*uTexel;
  vec3 x=.5*(sampleImage(vUV+direction*(-1.0/6.0))+sampleImage(vUV+direction*(1.0/6.0)));
  vec3 y=x*.5+.25*(sampleImage(vUV-direction*.5)+sampleImage(vUV+direction*.5));
  float v=dot(y,luma);outColor=vec4(v<lo||v>hi?x:y,1);
}`;
