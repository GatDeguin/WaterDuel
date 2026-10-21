// One persistent staging area and GPU allocation per dynamic buffer.
export class FloatStream{
 constructor(gl,{streaming=typeof gl.bufferSubData==='function'&&typeof gl.getParameter?.(gl.VERSION)==='string'}={}){
  this.gl=gl;this.streaming=streaming;this.buffers=new Map();this.stats={allocations:0,stagingGrows:0,uploadedBytes:0,capacityBytes:0};
 }
 reserve(buffer,count){
  let entry=this.buffers.get(buffer);if(entry?.capacity>=count)return entry;
  const capacity=2**Math.ceil(Math.log2(Math.max(16,count))),old=entry?.capacity??0;
  entry={capacity,staging:new Float32Array(capacity)};this.buffers.set(buffer,entry);this.stats.stagingGrows++;
  if(this.streaming){const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,capacity*4,gl.DYNAMIC_DRAW);this.stats.allocations++;this.stats.capacityBytes+=(capacity-old)*4;}
  return entry;
 }
 upload(buffer,values,count=values.length){
  const gl=this.gl,entry=this.reserve(buffer,count);let source=values;
  if(!(source instanceof Float32Array)){for(let i=0;i<count;i++)entry.staging[i]=values[i];source=entry.staging;}
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  if(this.streaming)gl.bufferSubData(gl.ARRAY_BUFFER,0,source,0,count);
  else gl.bufferData(gl.ARRAY_BUFFER,source.length===count?source:source.slice(0,count),gl.DYNAMIC_DRAW);
  this.stats.uploadedBytes+=count*4;
 }
 clear(){this.buffers.clear();}
}
