import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {serveAudio,parseAudioRange} from '../scripts/audio-response.mjs';
test('audio byte ranges are bounded single ranges, including suffixes and unknown ends',()=>{
 assert.deepEqual(parseAudioRange('bytes=10-19',100),{start:10,end:19});assert.deepEqual(parseAudioRange('bytes=95-',100),{start:95,end:99});assert.deepEqual(parseAudioRange('bytes=-10',100),{start:90,end:99});assert.deepEqual(parseAudioRange('bytes=90-999',100),{start:90,end:99});
 for(const range of ['bytes=100-','bytes=20-10','bytes=-0','bytes=0-1,3-4','other=0-10','bytes=NaN-1','bytes=9007199254740992-'])assert.equal(parseAudioRange(range,100),false,range);
 assert.equal(parseAudioRange(undefined,100),null);
});
test('native music delivery includes size, seeking ranges, exact bytes and HEAD without a body',async t=>{
 const file=new URL('../public/music/intro.mp3',import.meta.url),data=await fs.readFile(file),headers={'Content-Type':'audio/mpeg','X-Content-Type-Options':'nosniff'};
 const server=http.createServer((req,res)=>serveAudio(req,res,{file,size:data.length,headers}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/intro.mp3`;
 const partial=await fetch(url,{headers:{Range:'bytes=10-109'}});assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),`bytes 10-109/${data.length}`);assert.equal(partial.headers.get('accept-ranges'),'bytes');assert.equal(partial.headers.get('content-length'),'100');assert.ok(Buffer.from(await partial.arrayBuffer()).equals(data.subarray(10,110)));
 const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(data.length));assert.equal((await head.arrayBuffer()).byteLength,0);
 const rejected=await fetch(url,{headers:{Range:`bytes=${data.length}-`}});assert.equal(rejected.status,416);assert.equal(rejected.headers.get('content-range'),`bytes */${data.length}`);assert.equal((await rejected.arrayBuffer()).byteLength,0);
 const full=await fetch(url);assert.equal(full.headers.get('content-type'),'audio/mpeg');assert.ok(Buffer.from(await full.arrayBuffer()).equals(data));
});
