const equalBytes=(a,b)=>a.byteLength===b.byteLength&&a.every((value,index)=>value===b[index]);
function byteHash(bytes){let hash=2166136261;for(let i=0;i<bytes.length;i++)hash=Math.imul(hash^bytes[i],16777619);return hash>>>0;}

/** Context-owned immutable-image cache. Hash buckets always verify full bytes;
 * MIME, sampler and linear/sRGB interpretation are part of texture identity. */
export class SharedTextures{
  constructor(gl,decode){this.gl=gl;this.decode=decode;this.records=new Map();this.hashes=new WeakMap();this.bytes=0;this.disposed=false;}
  record(source,sampler){
    const gl=this.gl,settings=[sampler.wrapS??gl.REPEAT,sampler.wrapT??gl.REPEAT,sampler.magFilter??gl.LINEAR,sampler.minFilter??gl.LINEAR_MIPMAP_LINEAR];
    let hash=this.hashes.get(source.bytes);if(hash===undefined){hash=byteHash(source.bytes);this.hashes.set(source.bytes,hash);}
    const key=JSON.stringify([source.mimeType,source.bytes.byteLength,hash,...settings]);
    let bucket=this.records.get(key);if(!bucket){bucket=[];this.records.set(key,bucket);}
    let record=bucket.find(item=>equalBytes(item.source.bytes,source.bytes));
    if(!record){record={key,source,settings,variants:new Map(),bitmapPromise:null,decodeRefs:0};bucket.push(record);}
    return record;
  }
  acquire(source,sampler,kinds){
    if(this.disposed)throw Error('Carga de assets cancelada.');
    const record=this.record(source,sampler),references=[];
    for(const kind of kinds){
      let entry=record.variants.get(kind);
      if(!entry){
        entry={record,kind,refs:0,texture:null,bytes:0};record.variants.set(kind,entry);
        entry.promise=this.upload(record,entry);
      }
      entry.refs++;references.push(entry);
    }
    return {references,ready:Promise.all(references.map(entry=>entry.promise)).then(()=>Object.fromEntries(references.map(entry=>[entry.kind,entry.texture])))};
  }
  async upload(record,entry){
    const gl=this.gl;record.decodeRefs++;
    try{
      const bitmap=await(record.bitmapPromise??=Promise.resolve().then(()=>this.decode(record.source)));
      if(this.disposed||entry.refs===0)throw Error('Carga de assets cancelada.');
      const max=gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if(!bitmap.width||!bitmap.height||bitmap.width>max||bitmap.height>max)throw Error('Textura excede el tamaño de la GPU.');
      const texture=gl.createTexture();if(!texture)throw Error('No se pudo reservar textura.');entry.texture=texture;
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,entry.kind==='color'?gl.SRGB8_ALPHA8:gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
      for(const [index,parameter]of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_MAG_FILTER,gl.TEXTURE_MIN_FILTER].entries())gl.texParameteri(gl.TEXTURE_2D,parameter,record.settings[index]);
      gl.generateMipmap(gl.TEXTURE_2D);entry.bytes=Math.ceil(bitmap.width*bitmap.height*4*4/3);this.bytes+=entry.bytes;
    }catch(error){
      this.deleteTexture(entry);
      if(record.variants.get(entry.kind)===entry)record.variants.delete(entry.kind);
      this.prune(record);throw error;
    }finally{
      if(--record.decodeRefs===0){
        const pending=record.bitmapPromise;record.bitmapPromise=null;
        // The rejection is already propagated to each texture subscriber.
        pending?.then(bitmap=>bitmap.close?.(),()=>{});
      }
    }
  }
  deleteTexture(entry){if(entry.texture)this.gl.deleteTexture(entry.texture);entry.texture=null;this.bytes-=entry.bytes;entry.bytes=0;}
  prune(record){
    if(record.variants.size)return;const bucket=this.records.get(record.key);if(!bucket)return;
    const index=bucket.indexOf(record);if(index>=0)bucket.splice(index,1);if(!bucket.length)this.records.delete(record.key);
  }
  release(entry){
    if(entry.refs<=0)return;if(--entry.refs)return;this.deleteTexture(entry);
    if(entry.record.variants.get(entry.kind)===entry)entry.record.variants.delete(entry.kind);this.prune(entry.record);
  }
  dispose(){this.disposed=true;for(const bucket of this.records.values())for(const record of bucket)for(const entry of record.variants.values())this.deleteTexture(entry);this.records.clear();}
}
