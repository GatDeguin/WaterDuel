// All offscreen lighting, filtering and alpha compositing stay in linear light.
// RGBA16F is renderable with EXT_color_buffer_float. Linear RGBA8 is a bounded
// fallback which clips radiance above one; only presentation encodes display RGB.
export function colorTargetFormat(gl){
  const hdr=!!gl.getExtension?.('EXT_color_buffer_float');
  return {hdr,internal:hdr?gl.RGBA16F:gl.RGBA8,type:hdr?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,bytes:hdr?8:4,name:hdr?'RGBA16F · lineal HDR':'RGBA8 · lineal LDR'};
}
