import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const base='http://127.0.0.1:18878';
function message(socket,predicate,timeout=2500){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.removeEventListener('message',receive);reject(Error('Expected LAN message not received'));},timeout);
    function receive(event){const data=JSON.parse(event.data);if(predicate(data)){clearTimeout(timer);socket.removeEventListener('message',receive);resolve(data);}}
    socket.addEventListener('message',receive);
  });
}
async function connect(role,key,slot){
  const socket=new WebSocket(base.replace('http:','ws:')+'/ws');
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const welcome=message(socket,m=>m.type==='welcome'||m.type==='error');
  socket.send(JSON.stringify({type:'hello',role,key,slot}));
  return {socket,welcome:await welcome};
}
async function close(socket){
  if(socket.readyState===WebSocket.CLOSED)return;
  const done=new Promise(resolve=>socket.addEventListener('close',resolve,{once:true}));socket.close();await done;
}

test('Sesiones LAN: autoridad única, secuencias, heartbeat y caducidad real',async t=>{
  const processHandle=spawn(process.execPath,['server.mjs'],{
    cwd:new URL('..',import.meta.url),stdio:'ignore',
    env:{...process.env,HTTPS:'0',PORT:'18878',PUBLIC_URL:base,SESSION_TTL_MS:'2000',HEARTBEAT_MS:'200',PEER_IDLE_MS:'1500'},
  });
  t.after(()=>processHandle.kill());
  let session;
  for(let attempt=0;attempt<60;attempt++){
    try{const response=await fetch(base+'/api/session');if(response.ok){session=await response.json();break;}}catch{}
    await delay(50);
  }
  assert.ok(session,'The isolated LAN server starts offline');

  await t.test('Una segunda pantalla no roba autoridad y el relevo requiere liberar la primera',async()=>{
    const first=await connect('host',session.hostToken);
    const second=await connect('host',session.hostToken);
    try{
      assert.equal(second.welcome.code,'HOST_BUSY');
      assert.equal(first.socket.readyState,WebSocket.OPEN);
    }finally{await close(second.socket);await close(first.socket);}
    const successor=await connect('host',session.hostToken);
    assert.equal(successor.welcome.role,'host');
    await close(successor.socket);
  });

  await t.test('Dos mandos independientes rechazan mensajes duplicados y responden a ping sin otro servicio',async()=>{
    const host=await connect('host',session.hostToken);
    const key=slot=>new URL(session.links[slot]).searchParams.get('key');
    const p1=await connect('controller',key(1),1),p2=await connect('controller',key(2),2);
    const seen=[];host.socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.type==='control')seen.push(data);});
    const done=message(host.socket,data=>data.type==='control'&&data.slot===2&&data.seq===3);
    p1.socket.send(JSON.stringify({type:'control',sentAt:Date.now(),seq:2,thrust:true,mainY:9}));
    p1.socket.send(JSON.stringify({type:'control',sentAt:Date.now(),seq:1,thrust:true,mainY:-1}));
    p1.socket.send(JSON.stringify({type:'control',sentAt:Date.now(),seq:2,thrust:true}));
    p2.socket.send(JSON.stringify({type:'control',sentAt:Date.now(),seq:3,guard:true,lean:-.7,sentAt:Date.now()}));
    await done;
    assert.deepEqual(seen.map(data=>[data.slot,data.seq]),[[1,2],[2,3]]);
    assert.equal(seen[0].axes.mainY,1);
    assert.equal(seen[1].guard,true);
    const pong=message(p1.socket,data=>data.type==='pong'&&data.at===123);
    p1.socket.send(JSON.stringify({type:'ping',at:123}));
    assert.equal((await pong).at,123);
    await close(p1.socket);await close(p2.socket);await close(host.socket);
  });

  await t.test('Un mando puede reconectar con secuencia nueva y neutraliza su cupo al salir',async()=>{
    session=await (await fetch(base+'/api/session')).json();
    const host=await connect('host',session.hostToken),key=new URL(session.links[1]).searchParams.get('key');
    const first=await connect('controller',key,1);
    const offline=message(host.socket,data=>data.type==='presence'&&data.slot===1&&!data.online);
    await close(first.socket);await offline;
    const second=await connect('controller',key,1);
    const control=message(host.socket,data=>data.type==='control'&&data.slot===1);
    second.socket.send(JSON.stringify({type:'control',sentAt:Date.now(),seq:1,mainX:.4}));
    assert.equal((await control).seq,1);
    await close(second.socket);await close(host.socket);
  });

  await t.test('Un input retenido antes del servidor no se rejuvenece con el timestamp del relay',async()=>{
    session=await (await fetch(base+'/api/session')).json();
    const host=await connect('host',session.hostToken);
    const pad=await connect('controller',new URL(session.links[1]).searchParams.get('key'),1);
    const seen=[];
    host.socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.type==='control')seen.push(data.seq);});
    const done=message(host.socket,data=>data.type==='control'&&data.seq===12);
    pad.socket.send(JSON.stringify({type:'control',sentAt:Date.now(),seq:10,sentAt:Date.now()-5000,thrust:true}));
    pad.socket.send(JSON.stringify({type:'control',sentAt:Date.now(),seq:11,sentAt:Date.now()+60000,thrust:true}));
    pad.socket.send(JSON.stringify({type:'control',sentAt:Date.now(),seq:12,sentAt:Date.now(),thrust:false}));
    await done;
    assert.deepEqual(seen,[12]);
    assert.ok(Number.isFinite(pad.welcome.serverTime));
    await close(pad.socket);await close(host.socket);
  });

  await t.test('Las invitaciones expiran y una clave anterior no entra en la sesión nueva',async()=>{
    session=await (await fetch(base+'/api/session')).json();
    assert.ok(Number.isFinite(session.expiresAt));
    let next=session;
    for(let attempt=0;attempt<60&&next.id===session.id;attempt++){
      await delay(60);next=await (await fetch(base+'/api/session')).json();
    }
    assert.notEqual(next.id,session.id);
    assert.notEqual(next.links[1],session.links[1]);
    const stale=await connect('controller',new URL(session.links[1]).searchParams.get('key'),1);
    assert.equal(stale.welcome.code,'INVALID_INVITATION');
    await close(stale.socket);
  });
});
