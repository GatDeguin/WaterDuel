import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';

const PORT=18877;
const ROOT=`http://127.0.0.1:${PORT}`;
let processHandle;
async function serverReady(){
  processHandle=spawn(process.execPath,['server.mjs'],{cwd: new URL('..',import.meta.url),env:{...process.env,HTTPS:'0',PORT:String(PORT),PUBLIC_URL:ROOT},stdio:'ignore'});
  for(let i=0;i<50;i++){
    try{const r=await fetch(ROOT+'/api/health');if(r.ok)return;}catch{}
    await sleep(90);
  }
  throw Error('Failed to start local server');
}
async function connect(role,key,slot){
  const url=ROOT.replace('http:','ws:')+'/ws';
  const s=new WebSocket(url);
  await new Promise((resolve,reject)=>{s.addEventListener('open',resolve,{once:true});s.addEventListener('error',reject,{once:true});});
  s.send(JSON.stringify({type:'hello',role,key,slot}));
  return s;
}
function waitMessage(s,predicate=()=>true,limit=3500){
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{s.removeEventListener('message',receive);reject(new Error('Timeout waiting websocket message'));},limit);
    function receive(event){let m;try{m=JSON.parse(event.data)}catch{return;}if(predicate(m)){clearTimeout(timeout);s.removeEventListener('message',receive);resolve(m);}}
    s.addEventListener('message',receive);
  });
}
test('HTTP LAN session, QR svg, websocket host and 2 authenticated controller slots', async t=>{
  await serverReady();
  t.after(()=>{processHandle.kill();});
  const sess=await (await fetch(ROOT+'/api/session')).json();
  assert.ok(sess.hostToken.length>=32);
  assert.ok(sess.links['1'].includes('slot=1'));
  assert.ok(sess.links['2'].includes('slot=2'));
  assert.notEqual(sess.links['1'],sess.links['2']);
  assert.ok(sess.addresses.some(x=>x.url===ROOT));
  const qr=await (await fetch(ROOT+'/qr/1.svg')).text();
  assert.ok(qr.startsWith('<svg'));
  assert.ok(qr.length>1000);
  const qrOverride=await (await fetch(ROOT+'/qr/2.svg?base='+encodeURIComponent(ROOT))).text();
  assert.ok(qrOverride.startsWith('<svg'));
  const forbidden=await fetch(ROOT+'/qr/1.svg?base='+encodeURIComponent('http://evil.invalid'));
  assert.equal(forbidden.status,400);
  const host=await connect('host',sess.hostToken);
  t.after(()=>host.close());
  const hello=await waitMessage(host,m=>m.type==='welcome');
  assert.equal(hello.role,'host');
  const tokens=Object.fromEntries(Object.entries(sess.links).map(([slot,url])=>[slot,new URL(url).searchParams.get('key')]));
  const p1=await connect('controller',tokens['1'],1);
  t.after(()=>p1.close());
  const p1Hello=await waitMessage(p1,m=>m.type==='welcome');
  assert.equal(p1Hello.slot,1);
  const seenP1=await waitMessage(host,m=>m.type==='presence' && m.slot===1);
  assert.equal(seenP1.online,true);
  const controlPromise=waitMessage(host,m=>m.type==='control' && m.slot===1);
  p1.send(JSON.stringify({type:'control',sentAt:Date.now(),seq:1,mainY:.54,mainX:2,offY:-1,lean:1,bodyY:-2,thrust:true}));
  const control=await controlPromise;
  assert.equal(control.axes.mainX,1);
  assert.equal(control.axes.mainY,.54);
  assert.equal(control.axes.bodyY,-1);
  assert.equal(control.thrust,true);
  const p2=await connect('controller',tokens['2'],2);
  t.after(()=>p2.close());
  const p2Welcome=await waitMessage(p2,m=>m.type==='welcome');
  assert.equal(p2Welcome.slot,2);
  assert.equal((await waitMessage(host,m=>m.type==='presence' && m.slot===2)).online,true);
  const statePromise=waitMessage(p1,m=>m.type==='state');
  host.send(JSON.stringify({type:'state',phase:'fight',mode:'versus',score:[1,0],time:12}));
  assert.deepEqual((await statePromise).score,[1,0]);
  for(const name of ['joint-damage','joint-break']){
    const p1Event=waitMessage(p1,m=>m.type==='event'&&m.name===name);
    const p2Event=waitMessage(p2,m=>m.type==='event'&&m.name===name);
    host.send(JSON.stringify({type:'event',name,slot:2}));
    const received=await Promise.all([p1Event,p2Event]);
    assert.ok(received.every(m=>m.slot===2),'la vibración conserva la víctima física, aunque ambos mandos reciban el evento');
  }
  const evil=await connect('controller','invalid',1);
  t.after(()=>evil.close());
  const error=await waitMessage(evil,m=>m.type==='error');
  assert.equal(error.type,'error');
});
