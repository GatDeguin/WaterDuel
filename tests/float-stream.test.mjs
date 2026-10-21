import test from 'node:test';import assert from 'node:assert/strict';import {FloatStream} from '../public/rendering/float-stream.js';
test('El streaming reutiliza capacidad y conserva los mismos floats sin subarrays temporales',()=>{
 const uploads=[],reserves=[],gl={ARRAY_BUFFER:1,DYNAMIC_DRAW:2,bindBuffer(){},bufferData:(_,n)=>reserves.push(n),bufferSubData:(_,offset,data,start,count)=>uploads.push(Array.from(data).slice(start,start+count))};
 const stream=new FloatStream(gl,{streaming:true}),buffer={};stream.reserve(buffer,16);
 stream.upload(buffer,[1,2,3]);stream.upload(buffer,new Float32Array([4,5]));stream.upload(buffer,[6,7,8,9]);
 assert.deepEqual(uploads,[[1,2,3],[4,5],[6,7,8,9]]);assert.equal(reserves.length,1);assert.equal(stream.stats.allocations,1);assert.equal(stream.stats.stagingGrows,1);
});
test('Crecer es acotado por la demanda y el adaptador sin streaming conserva bytes',()=>{
 const values=[],gl={ARRAY_BUFFER:1,DYNAMIC_DRAW:2,bindBuffer(){},bufferData:(_,data)=>values.push(data)};
 const stream=new FloatStream(gl,{streaming:false});stream.upload({},[1.1,2.2]);assert.deepEqual(Array.from(values[0]),Array.from(Float32Array.from([1.1,2.2])));
 assert.equal(stream.stats.uploadedBytes,8);
});
