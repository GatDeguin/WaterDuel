import {materialSheen} from './sheen.js';
import {SharedTextures} from './shared-textures.js';
const identity=()=>Float32Array.from([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function normalMatrix(m,out){
  const x0=m[5]*m[10]-m[6]*m[9],x1=m[6]*m[8]-m[4]*m[10],x2=m[4]*m[9]-m[5]*m[8],
    y0=m[9]*m[2]-m[10]*m[1],y1=m[10]*m[0]-m[8]*m[2],y2=m[8]*m[1]-m[9]*m[0],
    z0=m[1]*m[6]-m[2]*m[5],z1=m[2]*m[4]-m[0]*m[6],z2=m[0]*m[5]-m[1]*m[4],d=m[0]*x0+m[1]*x1+m[2]*x2;
  if(!Number.isFinite(d)||Math.abs(d)<1e-12)throw Error('Transformación de asset singular.');
  out[0]=x0/d;out[1]=x1/d;out[2]=x2/d;out[3]=y0/d;out[4]=y1/d;out[5]=y2/d;out[6]=z0/d;out[7]=z1/d;out[8]=z2/d;return d;
}
async function decodeImage(image){
  return createImageBitmap(new Blob([image.bytes],{type:image.mimeType}),{imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});
}
const num=(v,defaultValue)=>Number.isFinite(v)?v:defaultValue;
const params=material=>material.pbrMetallicRoughness??material;
const imageSlots=['baseColorTexture','normalTexture','metallicRoughnessTexture','occlusionTexture','emissiveTexture','sheenColorTexture','sheenRoughnessTexture'];
const colorSlots=new Set(['baseColorTexture','emissiveTexture','sheenColorTexture']);
const defaultTint=[1,1,1],noDeform={};
function withFlatNormals(p){
  if(p.normals)return p;
  const count=p.indices.length,positions=new Float32Array(count*3),normals=new Float32Array(count*3),indices=new Uint32Array(count);
  const fields={};for(const [name,width]of [['uv',2],['uv1',2],['colors',4]])if(p[name])fields[name]=new Float32Array(count*width);
  for(let i=0;i<count;i++){
    const v=p.indices[i];positions.set(p.positions.subarray(v*3,v*3+3),i*3);indices[i]=i;
    for(const [name,width]of [['uv',2],['uv1',2],['colors',4]])if(fields[name])fields[name].set(p[name].subarray(v*width,v*width+width),i*width);
  }
  for(let i=0;i<count*3;i+=9){
    const ax=positions[i+3]-positions[i],ay=positions[i+4]-positions[i+1],az=positions[i+5]-positions[i+2],bx=positions[i+6]-positions[i],by=positions[i+7]-positions[i+1],bz=positions[i+8]-positions[i+2];
    const n=[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx],length=Math.hypot(...n);for(let v=0;v<3;v++)normals.set(length?n.map(x=>x/length):[0,1,0],i+v*3);
  }
  return {...p,...fields,positions,normals,indices};
}
function materialInfo(raw={}){
  const p=params(raw),e=raw.extensions??{},base=p.baseColorFactor??raw.baseColorFactor??[1,1,1,1],sheen=materialSheen(raw);
  return {...raw,baseColorFactor:base,roughnessFactor:num(p.roughnessFactor,1),metallicFactor:num(p.metallicFactor,1),
    baseColorTexture:p.baseColorTexture??raw.baseColorTexture,metallicRoughnessTexture:p.metallicRoughnessTexture??raw.metallicRoughnessTexture,
    emissiveFactor:(raw.emissiveFactor??[0,0,0]).map(v=>v*num(e.KHR_materials_emissive_strength?.emissiveStrength,1)),
    ior:num(e.KHR_materials_ior?.ior,1.5),coat:num(e.KHR_materials_clearcoat?.clearcoatFactor,0),coatRoughness:num(e.KHR_materials_clearcoat?.clearcoatRoughnessFactor,.1),
    transmission:num(e.KHR_materials_transmission?.transmissionFactor,0),thickness:num(e.KHR_materials_volume?.thicknessFactor,.025),
    sheenColor:[...sheen.color],sheenRoughness:sheen.roughness,sheenColorTexture:sheen.colorTexture,sheenRoughnessTexture:sheen.roughnessTexture};
}
function drawMaterial(material,textures){
  let flags=0;const bindings=[],coordinates=[];
  imageSlots.forEach((slot,index)=>{
    const info=material[slot],texture=textures[info?.index]?.[colorSlots.has(slot)?'color':'data']??null;
    bindings.push(texture);coordinates.push(info?.texCoord??0);if(texture)flags|=1<<index;
  });
  return {flags,bindings,texCoords:coordinates.slice(0,4),emissionUV:coordinates[4],sheenUV:coordinates.slice(5,7),
    params:[material.roughnessFactor,material.metallicFactor,material.ior,material.coat],sheen:[...material.sheenColor,material.sheenRoughness]};
}

/** Renderer-owned VAOs/textures. CPU parsing/retargeting and physics stay outside. */
export class AssetGPU{
  constructor(gl,{decodeImage:decode=decodeImage}={}){
    this.gl=gl;this.decodeImage=decode;this.models=new Set();this.disposed=false;this.bufferBytes=0;this.sharedTextures=new SharedTextures(gl,decode);
    this.normalScratch=new Float32Array(9);this.colorScratch=[1,1,1,1];this.deformScratch=[0,1,0];this.flexScratch=[0,1,1];this.wetScratch=[0,0,0,1];this.sheenScratch=[0,0,0,0];
    this.defaultMaterial=materialInfo();this.defaultDrawMaterial=drawMaterial(this.defaultMaterial,[]);
  }
  get bytes(){return this.bufferBytes+this.sharedTextures.bytes;}
  async upload(asset){
    if(this.disposed)throw Error('GPU de assets cerrada.');
    const gl=this.gl,model={parts:[],textures:[],textureObjects:[],textureReferences:[],materials:asset.materials.map(materialInfo),buffers:[],vaos:[],bytes:0,bufferBytes:0};
    try{
      for(const [textureIndex,sourceTexture]of (asset.textures??[]).entries()){
        const source=asset.images[sourceTexture.source];if(!source)throw Error('Imagen de textura ausente.');
        const kinds=new Set();
        for(const m of model.materials)for(const slot of imageSlots)if(m[slot]?.index===textureIndex)kinds.add(colorSlots.has(slot)?'color':'data');
        if(!kinds.size){model.textures.push({});continue;}
        const acquisition=this.sharedTextures.acquire(source,asset.samplers?.[sourceTexture.sampler]??{},kinds);
        model.textureReferences.push(...acquisition.references);
        const variants=await acquisition.ready;if(this.disposed)throw Error('Carga de assets cancelada.');
        model.textures.push(variants);model.textureObjects.push(...Object.values(variants));
        model.bytes+=acquisition.references.reduce((sum,entry)=>sum+entry.bytes,0);
      }
      model.drawMaterials=model.materials.map(material=>drawMaterial(material,model.textures));
      for(const sourcePrimitive of asset.primitives){const primitive=withFlatNormals(sourcePrimitive);
        const vao=gl.createVertexArray();if(!vao)throw Error('No se pudo reservar VAO.');model.vaos.push(vao);gl.bindVertexArray(vao);
        const buffer=(data,location,size)=>{
          const object=gl.createBuffer();if(!object)throw Error('No se pudo reservar buffer.');model.buffers.push(object);
          gl.bindBuffer(gl.ARRAY_BUFFER,object);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);model.bytes+=data.byteLength;model.bufferBytes+=data.byteLength;this.bufferBytes+=data.byteLength;
        };
        buffer(primitive.positions,0,3);buffer(primitive.normals,1,3);
        buffer(primitive.uv??new Float32Array(primitive.positions.length/3*2),4,2);
        if(primitive.uv1)buffer(primitive.uv1,5,2);else{gl.disableVertexAttribArray(5);gl.vertexAttrib2f(5,0,0);}
        if(primitive.colors)buffer(primitive.colors,6,4);else{gl.disableVertexAttribArray(6);gl.vertexAttrib4f(6,1,1,1,1);}
        const ib=gl.createBuffer();if(!ib)throw Error('No se pudo reservar índices.');model.buffers.push(ib);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,primitive.indices,gl.STATIC_DRAW);model.bytes+=primitive.indices.byteLength;model.bufferBytes+=primitive.indices.byteLength;this.bufferBytes+=primitive.indices.byteLength;
        model.parts.push({vao,count:primitive.indices.length,material:primitive.material??0,nodeName:primitive.nodeName,nodeIndex:primitive.nodeIndex,worldMatrix:primitive.worldMatrix??identity()});
      }
      gl.bindVertexArray(null);gl.bindTexture(gl.TEXTURE_2D,null);this.models.add(model);return model;
    }catch(error){this.release(model);throw error;}
  }
  transparent(model,part){const m=model.materials[part.material]??this.defaultMaterial;return m.alphaMode==='BLEND'||m.transmission>0;}
  draw(model,part,matrix,U,{deformStart=0,deformEnd=1,extension=0,flexOffset=0,flexLength=1,flexDirection=1,wetTop=0,wetBottom=0,wetMinY=0,wetMaxY=1,tint=defaultTint,sheenColor}=noDeform){
    if(this.disposed)return;const gl=this.gl,m=model.materials[part.material]??this.defaultMaterial,d=model.drawMaterials[part.material]??this.defaultDrawMaterial;gl.bindVertexArray(part.vao);
    gl.disableVertexAttribArray(2);gl.vertexAttrib4f(2,0,0,0,1);gl.disableVertexAttribArray(3);gl.vertexAttrib1f(3,.0045);
    gl.uniform1i(U.uInstancing,0);gl.uniform1i(U.uAssetEnabled,1);gl.uniform1i(U.uMaterial,21);gl.uniform1f(U.uWobble,0);gl.uniform1f(U.uWet,0);
    const determinant=normalMatrix(matrix,this.normalScratch),color=this.colorScratch,deform=this.deformScratch;
    color[0]=m.baseColorFactor[0]*tint[0];color[1]=m.baseColorFactor[1]*tint[1];color[2]=m.baseColorFactor[2]*tint[2];color[3]=m.baseColorFactor[3];
    deform[0]=deformStart;deform[1]=deformEnd;deform[2]=extension;
    gl.uniformMatrix4fv(U.uModel,false,matrix);gl.uniformMatrix3fv(U.uNormal,false,this.normalScratch);
    gl.uniform4fv(U.uAssetColor,color);gl.uniform4fv(U.uAssetParams,d.params);
    gl.uniform1f(U.uAssetCoatRoughness,m.coatRoughness);gl.uniform3fv(U.uAssetEmission,m.emissiveFactor);
    gl.uniform3fv(U.uAssetDeform,deform);gl.uniform1f(U.uAssetNormalScale,num(m.normalTexture?.scale,1));
    const flex=this.flexScratch,wet=this.wetScratch;flex[0]=flexOffset;flex[1]=flexLength;flex[2]=flexDirection;wet[0]=wetTop;wet[1]=wetBottom;wet[2]=wetMinY;wet[3]=wetMaxY;
    gl.uniform3fv(U.uAssetFlex,flex);gl.uniform4fv(U.uAssetWet,wet);
    gl.uniform1f(U.uAssetOcclusionStrength,num(m.occlusionTexture?.strength,1));gl.uniform1f(U.uAssetTransmission,m.transmission);gl.uniform1f(U.uAssetThickness,m.thickness);
    gl.uniform1i(U.uAssetAlphaMode,m.alphaMode==='MASK'?1:m.alphaMode==='BLEND'?2:0);gl.uniform1f(U.uAssetAlphaCutoff,num(m.alphaCutoff,.5));
    const sheen=sheenColor?this.sheenScratch:d.sheen;
    if(sheenColor){for(let i=0;i<3;i++)sheen[i]=sheenColor[i];sheen[3]=d.sheen[3];}
    gl.uniform4fv(U.uAssetSheen,sheen);
    for(let index=0;index<imageSlots.length;index++){gl.activeTexture(gl.TEXTURE0+6+index);gl.bindTexture(gl.TEXTURE_2D,d.bindings[index]);}
    gl.uniform1i(U.uAssetMaps,d.flags);gl.uniform4iv(U.uAssetTexCoords,d.texCoords);gl.uniform1i(U.uAssetEmissionUV,d.emissionUV);gl.uniform2iv(U.uAssetSheenUV,d.sheenUV);
    gl.frontFace(determinant<0?gl.CW:gl.CCW);
    if(m.doubleSided)gl.disable(gl.CULL_FACE);else{gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);}
    gl.drawElements(gl.TRIANGLES,part.count,gl.UNSIGNED_INT,0);gl.frontFace(gl.CCW);gl.disable(gl.CULL_FACE);gl.activeTexture(gl.TEXTURE0);
  }
  release(model){
    const gl=this.gl;for(const b of model.buffers)gl.deleteBuffer(b);for(const v of model.vaos)gl.deleteVertexArray(v);for(const reference of model.textureReferences)this.sharedTextures.release(reference);
    this.models.delete(model);this.bufferBytes-=model.bufferBytes;model.bufferBytes=0;model.buffers=[];model.vaos=[];model.textures=[];model.textureObjects=[];model.textureReferences=[];model.drawMaterials=[];model.parts=[];
  }
  dispose(){this.disposed=true;for(const model of [...this.models])this.release(model);this.sharedTextures.dispose();this.gl.bindVertexArray(null);}
}
