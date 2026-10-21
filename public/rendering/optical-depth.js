// Per-object far interface in a depth-only FBO. This measures the projected
// envelope, not the exact sum of paths through disconnected liquid components.
export class OpticalDepth{
 constructor(gl){this.gl=gl;this.width=0;this.height=0;this.texture=null;this.framebuffer=null;this.available=false;this.error=null;this.bytes=0;}
 ensure(width,height){
  width=Math.max(1,Math.floor(width));height=Math.max(1,Math.floor(height));
  if(this.width===width&&this.height===height&&(this.available||this.error))return this.available;
  this.dispose();this.width=width;this.height=height;const gl=this.gl;
  try{
   gl.activeTexture(gl.TEXTURE4);this.framebuffer=gl.createFramebuffer();this.texture=gl.createTexture();
   if(!this.framebuffer||!this.texture)throw Error('Sin recursos de profundidad óptica');
   gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,width,height,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
   for(const [p,v]of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,p,v);
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,this.texture,0);
   gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Framebuffer de profundidad óptica incompleto');
   this.available=true;this.error=null;this.bytes=width*height*4;
  }catch(error){this.error=error.message;this.dispose();}
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE0);return this.available;
 }
 capture(draw,destination){
  if(!this.available)return false;const gl=this.gl;
  gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.viewport(0,0,this.width,this.height);
  gl.disable(gl.BLEND);gl.enable(gl.CULL_FACE);gl.cullFace(gl.FRONT);gl.depthMask(true);gl.depthFunc(gl.GREATER);gl.clearDepth(0);gl.clear(gl.DEPTH_BUFFER_BIT);
  try{draw();}finally{
   gl.bindFramebuffer(gl.FRAMEBUFFER,destination);gl.clearDepth(1);gl.depthFunc(gl.LEQUAL);gl.depthMask(false);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);
   gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.activeTexture(gl.TEXTURE0);
  }
  return true;
 }
 dispose(){const gl=this.gl;if(this.texture)gl.deleteTexture(this.texture);if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);this.texture=null;this.framebuffer=null;this.available=false;this.bytes=0;}
}

// Multi-component straight-view optical length. A front depth picks the one
// visible interface that may apply Beer attenuation; a signed RG32F pass sums
// exit minus entry distances without including the air between closed volumes.
// Unsupported float blending is explicit: callers retain OpticalDepth's
// previous envelope approximation and report that accuracy limit.
export class OpticalPathDepth extends OpticalDepth{
 constructor(gl){super(gl);this.frontTexture=null;this.frontFramebuffer=null;this.passes=0;}
 ensure(width,height){
  width=Math.max(1,Math.floor(width));height=Math.max(1,Math.floor(height));
  if(this.width===width&&this.height===height&&(this.available||this.error))return this.available;
  this.dispose();this.width=width;this.height=height;const gl=this.gl;
  if(!gl.getExtension?.('EXT_color_buffer_float')||!gl.getExtension?.('EXT_float_blend')){this.error='Recorrido óptico sin float blending; usar profundidad anterior aproximada.';return false;}
  try{
   this.framebuffer=gl.createFramebuffer();this.texture=gl.createTexture();this.frontFramebuffer=gl.createFramebuffer();this.frontTexture=gl.createTexture();
   if(!this.framebuffer||!this.texture||!this.frontFramebuffer||!this.frontTexture)throw Error('Sin recursos de recorrido óptico');
   const allocate=(texture,internal,format,type)=>{gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,internal,width,height,0,format,type,null);for(const [p,v]of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,p,v);};
   gl.activeTexture(gl.TEXTURE4);allocate(this.texture,gl.RG32F,gl.RG,gl.FLOAT);
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Framebuffer de recorrido óptico incompleto');
   gl.activeTexture(gl.TEXTURE2);allocate(this.frontTexture,gl.DEPTH_COMPONENT24,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT);
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.frontFramebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,this.frontTexture,0);gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Framebuffer frontal óptico incompleto');
   this.available=true;this.error=null;this.bytes=width*height*12;
  }catch(error){this.error=error.message;this.dispose();}
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE0);return this.available;
 }
 capture(draw,destination,{clearColor=null}={}){
  if(!this.available)return false;const gl=this.gl;this.passes=0;
  // The owning renderer supplies its known clear colour to avoid a synchronous
  // GL state query in every multi-component frame. Standalone callers may omit.
  const previousClear=clearColor??gl.getParameter?.(gl.COLOR_CLEAR_VALUE),clear=previousClear?.length===4?previousClear:[0,0,0,0];
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,null);
  try{
   gl.viewport(0,0,this.width,this.height);gl.bindFramebuffer(gl.FRAMEBUFFER,this.frontFramebuffer);
   // Both sides are required: for an eye inside liquid the first visible
   // material interface is an exit. Outside, the nearest depth is still entry.
   gl.disable(gl.BLEND);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.depthMask(true);gl.depthFunc(gl.LESS);gl.clearDepth(1);gl.clear(gl.DEPTH_BUFFER_BIT);draw('front');this.passes++;
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.depthMask(false);
   gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);draw('sum');this.passes++;
  }finally{
   gl.bindFramebuffer(gl.FRAMEBUFFER,destination);gl.clearColor(...clear);gl.clearDepth(1);gl.depthFunc(gl.LEQUAL);gl.depthMask(false);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
   gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.frontTexture);gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.activeTexture(gl.TEXTURE0);
  }
  return true;
 }
 dispose(){const gl=this.gl;if(this.frontTexture)gl.deleteTexture(this.frontTexture);if(this.frontFramebuffer)gl.deleteFramebuffer(this.frontFramebuffer);this.frontTexture=null;this.frontFramebuffer=null;this.passes=0;super.dispose();}
}
