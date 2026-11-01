import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';
import {findChrome,openArenaInChrome} from '../scripts/open-chrome.mjs';
import {startWindows} from '../scripts/windows-start.mjs';

test('Chrome detection supports standard and registered installations without a shell or private paths',async()=>{
  const standard='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  assert.equal(await findChrome({platform:'win32',env:{ProgramFiles:'C:\\Program Files'},exists:file=>file===standard}),standard);
  const custom='D:\\Apps !\\Chrome\\chrome.exe',calls=[];
  assert.equal(await findChrome({platform:'win32',env:{},exists:file=>file===custom,runFile:async(file,args,options)=>{calls.push({file,args,options});return {stdout:`    (Default)    REG_SZ    "${custom}"\r\n`};}}),custom);
  assert.ok(calls.length>0);assert.ok(calls.every(c=>c.options.shell===false&&c.options.windowsHide===true));
  assert.equal(await findChrome({platform:'linux',env:{},exists:()=>assert.fail('not a Windows search')}),null);
});

test('launching opens the explicit desktop arena in Chrome and preserves paths and URL as separate arguments',async()=>{
  const calls=[],browser='C:\\Users\\Player !\\Chrome\\chrome.exe',url='http://localhost:8797/?view=desktop';let detached=0;
  const result=await openArenaInChrome(url,{find:async()=>browser,spawn:(file,args,options)=>{calls.push({file,args,options});const child=new EventEmitter();child.unref=()=>detached++;queueMicrotask(()=>child.emit('spawn'));return child;}});
  assert.equal(result.opened,true);assert.equal(detached,1);assert.equal(calls[0].file,browser);assert.deepEqual(calls[0].args,['--new-window','--start-fullscreen',url]);assert.equal(calls[0].options.shell,false);assert.equal(calls[0].options.windowsHide,false);
  for(const bad of ['https://example.com','file:///C:/secret','http://user:pass@localhost:8787','--disable-web-security'])await assert.rejects(openArenaInChrome(bad,{find:()=>assert.fail('invalid URL must not start Chrome')}));
  assert.deepEqual(await openArenaInChrome(url,{find:async()=>null}),{opened:false,reason:'not-found',url});
  const failed=await openArenaInChrome(url,{find:async()=>browser,spawn:()=>{const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('error',new Error('spawn failed')));return child;}});assert.equal(failed.opened,false);assert.equal(failed.reason,'launch-failed');
});

test('the Windows launcher opens Chrome only after successful server readiness, never during check or startup failure',async t=>{
  const previous=process.env.HTTPS;t.after(()=>{if(previous===undefined)delete process.env.HTTPS;else process.env.HTTPS=previous;});
  const events=[],deps={importServer:async()=>{events.push('server-ready');return {arenaStartup:{ready:true,url:'http://localhost:8787/?view=desktop'}};},openChrome:async url=>{events.push(url);return {opened:true,url};}};
  const result=await startWindows({env:{HTTPS:'0'},openChrome:true},deps);assert.equal(result.browser.opened,true);assert.deepEqual(events,['server-ready','http://localhost:8787/?view=desktop']);
  events.length=0;await startWindows({env:{HTTPS:'0'},openChrome:true,check:true},deps);assert.deepEqual(events,[]);
  await assert.rejects(startWindows({env:{HTTPS:'0'},openChrome:true},{...deps,importServer:async()=>({arenaStartup:{ready:false}})}),{code:'SERVER_NOT_READY'});assert.deepEqual(events,[]);
  await assert.rejects(startWindows({env:{HTTPS:'0'},openChrome:true},{...deps,importServer:async()=>{throw Error('port busy');}}),/port busy/);assert.deepEqual(events,[]);
});

test('the real listener is reachable before the browser callback receives the configured desktop URL',async()=>{
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const moduleURL=new URL('../scripts/windows-start.mjs',import.meta.url).href;
  const code=`import {startWindows} from ${JSON.stringify(moduleURL)}; try { const result=await startWindows({openChrome:true},{openChrome:async url=>{const response=await fetch(url);if(response.status!==200)throw Error('Arena not ready');console.log('CHROME_READY_TEST '+JSON.stringify({url,status:response.status}));return {opened:true,url};}});if(!result.browser.opened)throw Error('No callback');process.exit(0);} catch(error){console.error(error);process.exit(1);}`;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{env:{...process.env,HTTPS:'0',PORT:String(port),HOST:'127.0.0.1',PUBLIC_URL:''},windowsHide:true,timeout:10000});
  const line=stdout.split(/\r?\n/).find(s=>s.startsWith('CHROME_READY_TEST '));assert.ok(line);assert.deepEqual(JSON.parse(line.slice(18)),{url:`http://localhost:${port}/?view=desktop`,status:200});
});
