import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

test('Un peer retirado o sin propiedad del cupo no puede entregar control aunque siga recibiendo TCP',async()=>{
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  const start=source.indexOf('class Peer {'),end=source.indexOf("server.on('upgrade'");
  assert.ok(start>=0&&end>start,'La prueba evalúa la clase real del servidor.');
  const seen=[],slots=new Map(),peers=new Set();
  const Peer=vm.runInNewContext(source.slice(start,end)+'\nPeer;',{
    Buffer,Date,MAX_FRAME:8192,slots,peers,authority:{send:message=>seen.push(message)},expiresAt:Date.now()+60000,
    expireCommands:()=>{},clearPending:()=>{},renewSession:()=>{throw Error('No debe renovar.');},
  });
  const socket=()=>({destroyed:false,writableLength:0,on(){},write(){},end(){}});
  const old=new Peer(socket());old.role='controller';old.slot=1;slots.set(1,old);old.close();
  const replacement=new Peer(socket());replacement.role='controller';replacement.slot=1;slots.set(1,replacement);seen.length=0;
  const control={type:'control',seq:781,sentAt:Date.now(),mainX:1,thrust:true};
  old.message(control);
  const payload=Buffer.from(JSON.stringify({...control,seq:782})),mask=Buffer.from([1,2,3,4]);
  const header=payload.length<126?Buffer.from([0x81,0x80|payload.length]):Buffer.from([0x81,0xfe,payload.length>>8,payload.length&255]);
  const masked=Buffer.from(payload);for(let index=0;index<masked.length;index++)masked[index]^=mask[index%4];
  old.receive(Buffer.concat([header,mask,masked]));
  const orphan=new Peer(socket());orphan.role='controller';orphan.slot=1;orphan.message({...control,seq:783});
  assert.deepEqual(seen,[],'Ni los frames posteriores a cleanup ni un peer huérfano pueden controlar al sucesor.');
});

async function startServer(t,environment={}){
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),stdio:'ignore',
    env:{...process.env,HTTPS:'0',PORT:String(port),HOST:'127.0.0.1',PUBLIC_URL:base,HEARTBEAT_MS:'200',...environment}});
  t.after(()=>child.kill());
  for(let attempt=0;attempt<80;attempt++){
    try{const response=await fetch(base+'/api/session');if(response.ok)return {base,session:await response.json()};}catch{}
    await delay(25);
  }
  throw Error('El servidor aislado no inició.');
}

async function client(base,hello){
  const socket=new WebSocket(base.replace('http:','ws:')+'/ws'),messages=[],queue=[],waiters=[];
  socket.addEventListener('message',event=>{
    const data=JSON.parse(event.data);messages.push(data);
    if(data.type==='ping')socket.send(JSON.stringify({type:'pong',at:data.at}));
    const index=waiters.findIndex(waiter=>waiter.predicate(data));
    if(index>=0){const waiter=waiters.splice(index,1)[0];clearTimeout(waiter.timer);waiter.resolve(data);}else queue.push(data);
  });
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const api={socket,messages,send:value=>socket.send(JSON.stringify(value)),
    wait(predicate,timeout=1600){
      const index=queue.findIndex(predicate);if(index>=0)return Promise.resolve(queue.splice(index,1)[0]);
      return new Promise((resolve,reject)=>{
        const waiter={predicate,resolve,timer:null};
        waiter.timer=setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error('No llegó el mensaje esperado.'));},timeout);
        waiters.push(waiter);
      });
    },
    async close(){
      if(socket.readyState===WebSocket.CLOSED)return;
      const closed=new Promise(resolve=>socket.addEventListener('close',resolve,{once:true}));socket.close();await closed;
    }};
  if(hello){api.send({type:'hello',...hello});api.welcome=await api.wait(message=>['welcome','error'].includes(message.type));}
  return api;
}
const token=(session,slot)=>new URL(session.links[slot]).searchParams.get('key');
const command=(requestId,name='start',value,sentAt=Date.now())=>({type:'command',requestId,sentAt,command:name,...(value===undefined?{}:{value})});
const result=message=>message.type==='command-result';

test('Menús por WebSocket autenticado: autoridad, tipos, ACK, privacidad y reconexión',async t=>{
  const {base,session}=await startServer(t);
  async function connected(fn){
    const host=await client(base,{role:'host',key:session.hostToken});
    const p1=await client(base,{role:'controller',slot:1,key:token(session,1)});
    const p2=await client(base,{role:'controller',slot:2,key:token(session,2)});
    try{await fn(host,p1,p2);}finally{await p1.close();await p2.close();await host.close();}
  }

  await t.test('Sólo los dos cupos autenticados reenvían comandos y el slot viene del socket',()=>connected(async(host,p1,p2)=>{
    const anonymous=await client(base);try{
      anonymous.send({...command(1),slot:2});
      assert.equal((await anonymous.wait(message=>message.type==='error')).code,'AUTH_REQUIRED');
      p1.send({...command(1,'setBestOf',5),slot:2,key:'injected'});
      const seen=await host.wait(message=>message.type==='command');
      assert.equal(seen.slot,1);assert.equal(seen.value,5);assert.ok(Number.isSafeInteger(seen.relayId));
      assert.equal(seen.key,undefined);assert.equal(seen.requestId,1);
      p2.send(command(1,'setArena','dojo'));
      assert.equal((await host.wait(message=>message.type==='command'&&message.slot===2)).value,'dojo');
      const invalid=await client(base,{role:'controller',slot:1,key:'bad'});
      assert.equal(invalid.welcome.code,'INVALID_INVITATION');await invalid.close();
    }finally{await anonymous.close();}
  }));

  await t.test('La secuencia de comandos es independiente del input y rechaza duplicados, valores y edad',()=>connected(async(host,p1)=>{
    p1.send({type:'control',seq:999,sentAt:Date.now(),mainX:.3});
    p1.send(command(1));await host.wait(message=>message.type==='command'&&message.requestId===1);
    p1.send(command(1));assert.equal((await p1.wait(result)).ok,false);
    p1.send(command(2,'setBestOf','5'));assert.equal((await p1.wait(result)).ok,false);
    p1.send(command(3,'reset',undefined,Date.now()-3000));assert.match((await p1.wait(result)).message,/caduc|antigu|tiempo/i);
    p1.send(command(4,'reset',undefined,Date.now()+5000));assert.equal((await p1.wait(result)).ok,false);
    p1.send(command(5,'setLoadout',{slot:2,weapon:'sword',defense:'knife',key:'private'}));
    const seen=await host.wait(message=>message.type==='command'&&message.requestId===5);
    assert.deepEqual(seen.value,{slot:2,weapon:'sword',defense:'knife'});
    assert.deepEqual(host.messages.filter(message=>message.type==='command').map(message=>message.requestId),[1,5]);
  }));

  await t.test('Neutralizar es booleano explícito: fuerza controles neutros y conserva autenticación y secuencia',()=>connected(async(host,p1)=>{
    const sendControl=(seq,neutralize)=>p1.send({type:'control',slot:2,seq,sentAt:Date.now(),neutralize,
      mainX:1,mainY:-.5,offX:.3,offY:.8,lean:1,wrist:.6,thrust:true,guard:true});
    sendControl(1,true);const cleared=await host.wait(message=>message.type==='control'&&message.seq===1);
    assert.equal(cleared.slot,1);assert.equal(cleared.neutralize,true);
    assert.deepEqual(cleared.axes,{offX:0,offY:0,mainX:0,mainY:0,lean:0,wrist:0});
    assert.equal(cleared.thrust,false);assert.equal(cleared.guard,false);
    for(const [seq,value] of [[2,false],[3,'true'],[4,{value:true}]]){
      sendControl(seq,value);const ordinary=await host.wait(message=>message.type==='control'&&message.seq===seq);
      assert.notEqual(ordinary.neutralize,true);assert.equal(ordinary.axes.mainX,1);assert.equal(ordinary.thrust,true);
    }
    sendControl(4,true);p1.send({type:'control',seq:5,sentAt:Date.now()-5000,neutralize:true});
    sendControl(6,true);await host.wait(message=>message.type==='control'&&message.seq===6);
    assert.deepEqual(host.messages.filter(message=>message.type==='control').map(message=>message.seq),[1,2,3,4,6]);
  }));

  await t.test('Los resultados se correlacionan y sólo llegan al móvil solicitante',()=>connected(async(host,p1,p2)=>{
    p1.send(command(1));const seen=await host.wait(message=>message.type==='command');
    host.send({type:'command-result',slot:1,requestId:1,relayId:seen.relayId+1,ok:true,message:'incorrecto'});
    p2.send({type:'command-result',slot:1,requestId:1,relayId:seen.relayId,ok:true,message:'falso'});
    await delay(30);assert.equal(p1.messages.filter(result).length,0);
    host.send({type:'command-result',slot:1,requestId:1,relayId:seen.relayId,ok:true,message:'Partida iniciada',hostToken:'secret'});
    assert.deepEqual(await p1.wait(result),{type:'command-result',requestId:1,ok:true,message:'Partida iniciada'});
    assert.equal(p2.messages.filter(result).length,0);
  }));

  await t.test('La tasa de menú está acotada a doce solicitudes por segundo sin afectar el otro cupo',()=>connected(async(host,p1,p2)=>{
    for(let id=1;id<=13;id++)p1.send(command(id));
    const rejected=await p1.wait(result);assert.equal(rejected.requestId,13);assert.equal(rejected.ok,false);assert.match(rejected.message,/rápid|esper/i);
    p2.send(command(1,'setMode','versus'));
    await host.wait(message=>message.type==='command'&&message.slot===2);
    assert.equal(host.messages.filter(message=>message.type==='command'&&message.slot===1).length,12);
  }));

  await t.test('El cupo de pendientes es finito aunque el host deje de confirmar comandos',()=>connected(async(host,p1)=>{
    for(let id=1;id<=12;id++)p1.send(command(id));
    await host.wait(message=>message.type==='command'&&message.requestId===12);await delay(1050);
    for(let id=13;id<=24;id++)p1.send(command(id));
    await host.wait(message=>message.type==='command'&&message.requestId===24);await delay(1050);
    p1.send(command(25));const rejected=await p1.wait(result);
    assert.equal(rejected.requestId,25);assert.equal(rejected.ok,false);assert.match(rejected.message,/pendientes/i);
    assert.equal(host.messages.filter(message=>message.type==='command').length,24);
    const first=host.messages.find(message=>message.type==='command');
    host.send({type:'command-result',slot:1,requestId:first.requestId,relayId:first.relayId,ok:true,message:'Confirmado'});
    assert.equal((await p1.wait(result)).ok,true);
    p1.send(command(26));await host.wait(message=>message.type==='command'&&message.requestId===26);
  }));

  await t.test('La solicitud pendiente vence y una respuesta tardía no confirma una acción caducada',()=>connected(async(host,p1)=>{
    p1.send(command(1));const seen=await host.wait(message=>message.type==='command');
    const expired=await p1.wait(result,5600);assert.equal(expired.requestId,1);assert.equal(expired.ok,false);
    assert.match(expired.message,/tiempo/i);
    host.send({type:'command-result',slot:1,requestId:1,relayId:seen.relayId,ok:true,message:'Demasiado tarde'});
    await delay(30);assert.equal(p1.messages.filter(result).length,1);
  }));

  await t.test('Estado sanitizado llega a ambos mandos y se recupera al reconectar con host vigente',()=>connected(async(host,p1,p2)=>{
    host.send({type:'menu-state',state:{phase:'ready',mode:'solo',bestOf:5,volume:84,message:'Listo',
      fighters:[{slot:1,name:'Mint Mamba',equipment:{weapon:'sword',defense:'short',key:'secret'},wins:[true,false,false]}],
      replay:{clips:[{id:2,duration:3.2,complete:true,frames:['secret']}]},hostToken:'secret',links:['secret']}});
    const first=await p1.wait(message=>message.type==='menu-state'),second=await p2.wait(message=>message.type==='menu-state');
    assert.deepEqual(first,second);assert.equal(first.state.bestOf,5);assert.equal(first.state.volume,84);
    assert.equal(JSON.stringify(first).includes('secret'),false);
    p1.send({type:'menu-state',state:{message:'forged'}});await delay(20);
    assert.equal(p2.messages.filter(message=>message.type==='menu-state').length,1);
    await p1.close();const successor=await client(base,{role:'controller',slot:1,key:token(session,1)});
    try{assert.deepEqual(await successor.wait(message=>message.type==='menu-state'),first);}finally{await successor.close();}
  }));

  await t.test('Un ACK viejo no se adjudica al socket nuevo aunque reinicie requestId',()=>connected(async(host,p1)=>{
    p1.send(command(1));const first=await host.wait(message=>message.type==='command');await p1.close();
    const successor=await client(base,{role:'controller',slot:1,key:token(session,1)});
    try{
      successor.send(command(1));const next=await host.wait(message=>message.type==='command'&&message.relayId!==first.relayId);
      assert.notEqual(next.relayId,first.relayId);
      host.send({type:'command-result',slot:1,requestId:1,relayId:first.relayId,ok:true,message:'Viejo'});
      await delay(30);assert.equal(successor.messages.filter(result).length,0);
      host.send({type:'command-result',slot:1,requestId:1,relayId:next.relayId,ok:true,message:'Nuevo'});
      assert.equal((await successor.wait(result)).message,'Nuevo');
    }finally{await successor.close();}
  }));

  await t.test('Caída del host cancela pendientes y borra menú previo; sin host el móvil recibe explicación',()=>connected(async(host,p1)=>{
    host.send({type:'menu-state',state:{message:'No debe persistir'}});await p1.wait(message=>message.type==='menu-state');
    p1.send(command(1));await host.wait(message=>message.type==='command');await host.close();
    const cancelled=await p1.wait(result);assert.equal(cancelled.ok,false);assert.match(cancelled.message,/pantalla|conexión/i);
    p1.send(command(2));assert.equal((await p1.wait(result)).ok,false);
    const replacement=await client(base,{role:'controller',slot:1,key:token(session,1)});
    try{await delay(30);assert.equal(replacement.messages.some(message=>message.type==='menu-state'),false);}finally{await replacement.close();}
  }));
});

test('La renovación de sesión elimina menú y solicitudes de la autoridad anterior',async t=>{
  const {base,session}=await startServer(t,{SESSION_TTL_MS:'1000'});
  const host=await client(base,{role:'host',key:session.hostToken});
  const pad=await client(base,{role:'controller',slot:1,key:token(session,1)});
  t.after(async()=>{await pad.close();await host.close();});
  host.send({type:'menu-state',state:{message:'Estado anterior'}});await pad.wait(message=>message.type==='menu-state');
  pad.send(command(1));await host.wait(message=>message.type==='command');
  await pad.wait(message=>message.type==='session-expired',2200);
  const next=await (await fetch(base+'/api/session')).json();assert.notEqual(next.id,session.id);
  const nextHost=await client(base,{role:'host',key:next.hostToken});
  const nextPad=await client(base,{role:'controller',slot:1,key:token(next,1)});
  try{await delay(30);assert.equal(nextPad.messages.some(message=>message.type==='menu-state'),false);}
  finally{await nextPad.close();await nextHost.close();}
});
