// Static workshop capture. Dynamic puppets are deliberately excluded so a
// balloon never reflects its own old position or samples the active capture.
import {colorTargetFormat} from './color.js';
export class WorkshopEnvironment {
  constructor(gl,size=128,format=colorTargetFormat(gl)){this.gl=gl;this.format=format;this.size=size;this.key=null;this.texture=null;this.framebuffer=null;this.depth=null;this.available=false;this.error=null;this.attempted=false;}
  allocate(){
    if(this.attempted)return this.available;this.attempted=true;const gl=this.gl;
    try{
      this.texture=gl.createTexture();this.framebuffer=gl.createFramebuffer();this.depth=gl.createRenderbuffer();
      if(!this.texture||!this.framebuffer||!this.depth)throw Error('Captura de entorno no disponible');
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_CUBE_MAP,this.texture);
      for(let i=0;i<6;i++)gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+i,0,this.format.internal,this.size,this.size,0,gl.RGBA,this.format.type,null);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_CUBE_MAP,axis,gl.CLAMP_TO_EDGE);
      gl.bindRenderbuffer(gl.RENDERBUFFER,this.depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,this.size,this.size);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.depth);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_CUBE_MAP_POSITIVE_X,this.texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Captura de entorno incompleta');
      this.available=true;
    }catch(e){this.error=e.message;this.dispose();}
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindRenderbuffer(gl.RENDERBUFFER,null);gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);gl.activeTexture(gl.TEXTURE0);
    return this.available;
  }
  capture(key,drawFace){
    if(!this.allocate()||this.key===key)return false;const gl=this.gl;
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.viewport(0,0,this.size,this.size);
    for(let face=0;face<6;face++){
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_CUBE_MAP_POSITIVE_X+face,this.texture,0);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);drawFace(face);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_CUBE_MAP,this.texture);gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    gl.activeTexture(gl.TEXTURE0);this.key=key;return true;
  }
  bind(){if(!this.available)return;const gl=this.gl;gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_CUBE_MAP,this.texture);gl.activeTexture(gl.TEXTURE0);}
  dispose(){const gl=this.gl;if(this.texture)gl.deleteTexture(this.texture);if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);if(this.depth)gl.deleteRenderbuffer(this.depth);this.texture=null;this.framebuffer=null;this.depth=null;this.available=false;this.key=null;}
}
