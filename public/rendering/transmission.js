// Two disjoint targets keep the opaque image/depth readable during transmission.
// Sampling a texture attached to the active draw framebuffer is never permitted.
import {colorTargetFormat} from './color.js';
export class SceneTransmission {
  constructor(gl,format=colorTargetFormat(gl)){this.gl=gl;this.format=format;this.width=0;this.height=0;this.opaque=null;this.composite=null;this.available=false;this.error=null;this.bytes=0;}
  ensure(width,height){
    width=Math.max(1,Math.floor(width));height=Math.max(1,Math.floor(height));
    if(this.width===width&&this.height===height&&(this.available||this.error))return this.available;
    this.dispose();this.width=width;this.height=height;
    this.gl.activeTexture(this.gl.TEXTURE0);
    try{
      this.opaque=this.createTarget(true);this.composite=this.createTarget(false);
      if(!this.opaque||!this.composite)throw new Error('No se pudieron reservar los buffers de transmisión');
      this.available=true;this.error=null;this.bytes=width*height*(this.format.bytes*2+8);
    }catch(error){this.error=error.message;this.dispose();}
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,null);
    this.gl.bindRenderbuffer(this.gl.RENDERBUFFER,null);
    this.gl.bindTexture(this.gl.TEXTURE_2D,null);
    return this.available;
  }
  createTarget(sampleDepth){
    const gl=this.gl,target={framebuffer:gl.createFramebuffer(),color:gl.createTexture(),depth:null,depthBuffer:null};
    if(!target.framebuffer||!target.color){this.destroyTarget(target);return null;}
    try{
      gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);
      gl.bindTexture(gl.TEXTURE_2D,target.color);
      gl.texImage2D(gl.TEXTURE_2D,0,this.format.internal,this.width,this.height,0,gl.RGBA,this.format.type,null);
      this.textureParameters(gl.LINEAR);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target.color,0);
      if(sampleDepth){
        target.depth=gl.createTexture();if(!target.depth)throw new Error('Sin textura de profundidad');
        gl.bindTexture(gl.TEXTURE_2D,target.depth);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,this.width,this.height,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
        this.textureParameters(gl.NEAREST);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,target.depth,0);
      }else{
        target.depthBuffer=gl.createRenderbuffer();if(!target.depthBuffer)throw new Error('Sin buffer de profundidad');
        gl.bindRenderbuffer(gl.RENDERBUFFER,target.depthBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,this.width,this.height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,target.depthBuffer);
      }
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Framebuffer de transmisión incompleto');
      return target;
    }catch(error){this.destroyTarget(target);throw error;}
  }
  textureParameters(filter){
    const gl=this.gl;
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  }
  begin(){
    if(!this.available)return false;const gl=this.gl;
    // A sampler remains active even when its shader branch is disabled. Remove
    // last frame's reads before making those images writable attachments.
    for(const unit of [gl.TEXTURE0,gl.TEXTURE1,gl.TEXTURE2]){gl.activeTexture(unit);gl.bindTexture(gl.TEXTURE_2D,null);}
    gl.activeTexture(gl.TEXTURE0);gl.bindFramebuffer(gl.FRAMEBUFFER,this.opaque.framebuffer);return true;
  }
  prepare(){
    if(!this.available)return false;
    const gl=this.gl,w=this.width,h=this.height;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.opaque.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.composite.framebuffer);
    gl.blitFramebuffer(0,0,w,h,0,0,w,h,gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT,gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.composite.framebuffer);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.opaque.color);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.opaque.depth);
    return true;
  }
  snapshot(){
    if(!this.available)return false;const gl=this.gl,w=this.width,h=this.height;
    // Resolve the finished transparent layer into the next layer's read image.
    // No draw is issued while that read texture is the copy destination.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.composite.framebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.opaque.framebuffer);
    gl.blitFramebuffer(0,0,w,h,0,0,w,h,gl.COLOR_BUFFER_BIT,gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.composite.framebuffer);return true;
  }
  present(drawFullscreen){
    if(!this.available)return;
    const gl=this.gl,w=this.width,h=this.height;
    if(drawFullscreen){gl.bindFramebuffer(gl.FRAMEBUFFER,null);drawFullscreen(this.composite.color,w,h);}
    else{
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.composite.framebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);
      gl.blitFramebuffer(0,0,w,h,0,0,w,h,gl.COLOR_BUFFER_BIT,gl.NEAREST);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.activeTexture(gl.TEXTURE0);
  }
  destroyTarget(target){
    if(!target)return;const gl=this.gl;
    if(target.color)gl.deleteTexture(target.color);if(target.depth)gl.deleteTexture(target.depth);
    if(target.depthBuffer)gl.deleteRenderbuffer(target.depthBuffer);if(target.framebuffer)gl.deleteFramebuffer(target.framebuffer);
  }
  dispose(){this.destroyTarget(this.opaque);this.destroyTarget(this.composite);this.opaque=null;this.composite=null;this.available=false;this.bytes=0;}
}
