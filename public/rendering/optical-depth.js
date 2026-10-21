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
