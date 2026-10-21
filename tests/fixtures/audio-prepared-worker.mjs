// Node transport adapter for the actual promoted browser worker.
import {parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
globalThis.addEventListener=(type,listener)=>{if(type==='message')parentPort.on('message',data=>listener({data}));};
globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);
const workerURL=new URL('../../public/audio/effect-bank-worker.js',import.meta.url);
const bytes=await readFile(workerURL);
await import(workerURL.href);
parentPort.postMessage({type:'worker-loaded',url:workerURL.href,sha256:createHash('sha256').update(bytes).digest('hex')});
