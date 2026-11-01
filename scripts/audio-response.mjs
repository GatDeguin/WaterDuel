import {createReadStream} from 'node:fs';
// Only one bounded byte range is useful for these small local audio streams.
export function parseAudioRange(value,size){
  if(value===undefined)return null;
  if(typeof value!=='string'||!Number.isSafeInteger(size)||size<=0)return false;
  const match=/^bytes=(\d*)-(\d*)$/i.exec(value.trim());if(!match||!match[1]&&!match[2])return false;
  const start=match[1]?Number(match[1]):null,end=match[2]?Number(match[2]):null;
  if(start!==null&&!Number.isSafeInteger(start)||end!==null&&!Number.isSafeInteger(end))return false;
  if(start===null)return end>0?{start:Math.max(0,size-end),end:size-1}:false;
  return start<size&&(end===null||end>=start)?{start,end:end===null?size-1:Math.min(end,size-1)}:false;
}
export function serveAudio(request,response,{file,size,headers={}}){
  const range=request.method==='HEAD'?null:parseAudioRange(request.headers.range,size);
  const common={...headers,'Accept-Ranges':'bytes'};
  if(range===false){response.writeHead(416,{...common,'Content-Range':`bytes */${size}`,'Content-Length':0});response.end();return;}
  const start=range?.start??0,end=range?.end??size-1;
  response.writeHead(range?206:200,{...common,'Content-Length':Math.max(0,end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
  if(request.method==='HEAD'||size===0){response.end();return;}
  const stream=createReadStream(file,{start,end});response.once('close',()=>stream.destroy());stream.once('error',()=>response.destroy());stream.pipe(response);
}
