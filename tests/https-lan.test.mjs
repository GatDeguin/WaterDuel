import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes,X509Certificate} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {loadLocalHTTPS,canonicalPublicURL,needsHTTPS,isLoopbackAddress} from '../scripts/local-https.mjs';

const execute=promisify(execFile);
async function freePort(){const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));return port;}
function secureGet(port,pathname,ca,extra={}){
  return new Promise((resolve,reject)=>{const request=https.get({hostname:'localhost',port,path:pathname,ca,...extra},response=>{
    const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks),authorized:response.socket?.authorized??request.socket.authorized}));
  });request.on('error',reject);});
}
async function until(predicate,limit=3500){const end=Date.now()+limit;do{const value=predicate();if(value)return value;await delay(10);}while(Date.now()<end);throw Error('La operación de TLS/relay no respondió dentro del plazo.');}
async function plainWS(port){const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`),messages=[];socket.addEventListener('message',event=>messages.push(JSON.parse(event.data)));await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});return {socket,messages,send:value=>socket.send(JSON.stringify(value)),close:()=>socket.close()};}
function secureWS(port,ca,origin=`https://localhost:${port}`){
  return new Promise((resolve,reject)=>{
    const request=https.request({hostname:'localhost',port,path:'/ws',ca,headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64'),Origin:origin}});
    request.once('error',reject);request.once('response',()=>reject(Error('No se negoció WSS.')));
    request.once('upgrade',(response,socket,head)=>{
      const messages=[];let buffer=head;
      function receive(chunk){buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=2){let length=buffer[1]&127,offset=2;if(length===126){if(buffer.length<4)return;length=buffer.readUInt16BE(2);offset=4;}if(length===127){socket.destroy();return;}if(buffer.length<offset+length)return;const opcode=buffer[0]&15,payload=buffer.subarray(offset,offset+length);buffer=buffer.subarray(offset+length);if(opcode===1)messages.push(JSON.parse(payload.toString()));if(opcode===8)socket.end();}}
      socket.on('data',receive);socket.on('error',()=>{});if(head.length)receive(Buffer.alloc(0));
      resolve({messages,authorized:socket.authorized,send(value){const body=Buffer.from(JSON.stringify(value)),mask=randomBytes(4),header=body.length<126?Buffer.from([0x81,0x80|body.length]):Buffer.from([0x81,0xfe,body.length>>8,body.length&255]);for(let i=0;i<body.length;i++)body[i]^=mask[i%4];socket.write(Buffer.concat([header,mask,body]));},close:()=>socket.destroy()});
    });request.end();
  });
}

test('HTTPS real y WSS verificados por CA comparten sesión, cupos, autoridad y caducidad con HTTP',async t=>{
  const local=path.join(fileURLToPath(new URL('..',import.meta.url)),'.local');await mkdir(local,{recursive:true});
  const directory=await mkdtemp(path.join(local,'tls-test-'));
  t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(local)+path.sep+'tls-test-'));await rm(directory,{recursive:true,force:true});});
  const prepare=new URL('../scripts/prepare-local-https.ps1',import.meta.url);
  await execute('pwsh',['-NoProfile','-File',prepare.pathname.replace(/^\/(.:)/,'$1'),'-OutputDirectory',directory],{windowsHide:true});
  const ca=await readFile(path.join(directory,'ca.crt')),cert=await readFile(path.join(directory,'server.crt'));
  const authority=new X509Certificate(ca),leaf=new X509Certificate(cert);
  assert.equal(authority.ca,true);assert.equal(leaf.ca,false);assert.equal(leaf.verify(authority.publicKey),true);
  assert.ok(leaf.checkIP('127.0.0.1'));assert.ok(leaf.checkIP('::1'));assert.ok(leaf.checkHost('localhost'));
  for(const entries of Object.values(os.networkInterfaces()))for(const entry of entries??[])if(entry.family==='IPv4')assert.ok(leaf.checkIP(entry.address),'SAN debe cubrir las IPv4 de esta instalación');
  const oldFingerprint=authority.fingerprint256;
  await execute('pwsh',['-NoProfile','-File',prepare.pathname.replace(/^\/(.:)/,'$1'),'-OutputDirectory',directory],{windowsHide:true});
  assert.equal(new X509Certificate(await readFile(path.join(directory,'ca.crt'))).fingerprint256,oldFingerprint,'renovar el servidor conserva la CA confiada de esta instalación');
  const port=await freePort(),securePort=await freePort(),base=`https://localhost:${securePort}`;
  const environment={...process.env,HTTPS:'1',PORT:String(port),HTTPS_PORT:String(securePort),HOST:'0.0.0.0',PUBLIC_URL:'',
    TLS_CERT_FILE:path.join(directory,'server.crt'),TLS_KEY_FILE:path.join(directory,'server.key'),TLS_CA_FILE:path.join(directory,'ca.crt'),SESSION_TTL_MS:'2200',HEARTBEAT_MS:'100'};
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
  const clients=[];t.after(async()=>{for(const client of clients)client.close();const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await Promise.race([exit,delay(800)]);});
  let session;
  for(let i=0;i<100;i++){try{const response=await fetch(`http://127.0.0.1:${port}/api/session`);if(response.ok){session=await response.json();break;}}catch{}await delay(20);}
  assert.ok(session,'ambos listeners deben arrancar sin imprimir claves');
  const secured=await secureGet(securePort,'/api/session',ca),same=JSON.parse(secured.body);assert.equal(secured.authorized,true);assert.equal(same.id,session.id);assert.equal(new URL(same.baseURL).protocol,'https:');
  assert.equal(new URL(session.links[1]).protocol,'https:');assert.equal(new URL(session.links[2]).port,String(securePort));
  assert.equal(session.tls.enabled,true);assert.ok(session.addresses.some(entry=>entry.url===same.baseURL));
  assert.ok(session.addresses.every(entry=>new URL(entry.url).protocol==='https:'),'las alternativas de QR no deben anunciar HTTP LAN que el propio servidor rechaza');
  const download=await fetch(`http://127.0.0.1:${port}${session.tls.caCertificatePath}`),publicBytes=await download.text();assert.equal(download.status,200);assert.doesNotMatch(publicBytes,/PRIVATE KEY/);assert.equal(new X509Certificate(publicBytes).fingerprint256,oldFingerprint);
  const lan=Object.values(os.networkInterfaces()).flat().find(entry=>entry?.family==='IPv4'&&!entry.internal)?.address;
  if(lan){
    for(const pathname of ['/api/session','/qr/1.svg','/controller.html']){
      const blocked=await fetch(`http://${lan}:${port}${pathname}`,{headers:{Host:`localhost:${port}`,'X-Forwarded-For':'127.0.0.1'}});
      assert.equal(blocked.status,426,'un Host/X-Forwarded-For falsificado no convierte una conexión LAN en loopback');
      const text=await blocked.text();assert.equal(text.includes(session.hostToken),false);assert.ok(text.includes(session.baseURL));
    }
    assert.equal((await fetch(`http://${lan}:${port}/certs/waterduel-local-ca.crt`)).status,200);
    assert.equal((await fetch(`http://${lan}:${port}/https`)).status,200);
    const status=await new Promise((resolve,reject)=>{
      const request=http.request({hostname:lan,port,path:'/ws',headers:{Host:`localhost:${port}`,'X-Forwarded-For':'127.0.0.1',Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64')}},response=>{response.resume();resolve(response.statusCode);});
      request.on('upgrade',(_response,socket)=>{socket.destroy();resolve(101);});request.on('error',reject);request.end();
    });assert.equal(status,426,'WebSocket HTTP desde LAN tampoco acepta el Host falsificado');
  }
  for(const pathname of ['/.local/tls/server.key','/.local/tls/ca.key','/certs/server.key'])assert.equal((await fetch(`http://127.0.0.1:${port}${pathname}`)).status,404);
  await assert.rejects(secureGet(securePort,'/api/health',undefined),error=>['UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code));
  await assert.rejects(secureGet(securePort,'/api/health',ca,{servername:'not-covered.invalid'}),error=>error.code==='ERR_TLS_CERT_ALTNAME_INVALID');
  await assert.rejects(secureWS(securePort,ca,`https://localhost:${port}`));await assert.rejects(secureWS(securePort,ca,`http://localhost:${securePort}`));
  const host=await plainWS(port);clients.push(host);host.send({type:'hello',role:'host',key:session.hostToken});await until(()=>host.messages.find(message=>message.type==='welcome'));
  const first=await secureWS(securePort,ca);clients.push(first);assert.equal(first.authorized,true);first.send({type:'hello',role:'controller',slot:1,key:new URL(session.links[1]).searchParams.get('key')});await until(()=>first.messages.find(message=>message.type==='welcome'));
  const second=await plainWS(port);clients.push(second);second.send({type:'hello',role:'controller',slot:2,key:new URL(session.links[2]).searchParams.get('key')});await until(()=>second.messages.find(message=>message.type==='welcome'));
  const rivalHost=await secureWS(securePort,ca);clients.push(rivalHost);rivalHost.send({type:'hello',role:'host',key:session.hostToken});assert.equal((await until(()=>rivalHost.messages.find(message=>message.type==='error'))).code,'HOST_BUSY');
  first.send({type:'control',seq:1,sentAt:Date.now(),mainX:.6,attackHeld:true,headX:.3});const control=await until(()=>host.messages.find(message=>message.type==='control'&&message.slot===1));assert.equal(control.attackHeld,true);assert.equal(control.axes.headX,.3);
  const active=JSON.parse((await secureGet(securePort,'/api/session',ca)).body);assert.deepEqual(active.connected,[true,true]);assert.equal(active.hostConnected,true);
  assert.equal(logs.includes(session.hostToken),false);for(const slot of [1,2])assert.equal(logs.includes(new URL(session.links[slot]).searchParams.get('key')),false);assert.doesNotMatch(logs,/PRIVATE KEY/);
  await delay(Math.max(0,session.expiresAt-Date.now()+100));const renewed=JSON.parse((await secureGet(securePort,'/api/session',ca)).body);
  assert.notEqual(renewed.id,session.id);assert.deepEqual(renewed.connected,[false,false]);assert.equal(renewed.hostConnected,false);
  assert.ok(await until(()=>host.messages.some(message=>message.type==='session-expired')));assert.ok(await until(()=>first.messages.some(message=>message.type==='session-expired')));
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/session`)).json()).id,renewed.id);
});

test('Una configuración TLS inválida termina el proceso antes de anunciar o abrir una arena',async()=>{
  try{
    await execute(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),windowsHide:true,env:{...process.env,HTTPS:'1',TLS_CERT_FILE:'missing-certificate.crt',TLS_KEY_FILE:'missing-private.key'}});
    assert.fail('El proceso debe fallar al faltar archivos TLS configurados.');
  }catch(error){assert.equal(error.code,1);assert.match(error.stderr,/No se inicia WaterDuel/);assert.doesNotMatch(error.stdout,/Local arena online|PRIVATE KEY/);}
});

test('TLS deshabilitado es explícito y una configuración inválida no se degrada a un HTTPS aparente',()=>{
  assert.equal(loadLocalHTTPS({root:process.cwd(),env:{HTTPS:'0',TLS_CERT_FILE:'not-present'}}),null);
  assert.throws(()=>loadLocalHTTPS({root:process.cwd(),env:{TLS_CERT_FILE:'not-present'}}),/juntos/);
  assert.throws(()=>loadLocalHTTPS({root:process.cwd(),env:{HTTPS:'1',TLS_CERT_FILE:'not-present',TLS_KEY_FILE:'also-missing'}}),/Faltan/);
  assert.throws(()=>canonicalPublicURL('http://localhost:8788',true),/HTTPS/);
  assert.throws(()=>canonicalPublicURL('https://user:secret@localhost/',true),/sin ruta ni credenciales/);
  assert.throws(()=>canonicalPublicURL('https://localhost/route',true),/sin ruta/);
});

test('La excepción HTTP usa únicamente la dirección real del socket, sin confiar en Host o proxies',()=>{
  for(const address of ['127.0.0.1','127.1.2.3','::1','::ffff:127.0.0.1'])assert.equal(isLoopbackAddress(address),true);
  for(const address of ['192.168.1.2','10.0.0.1','::ffff:192.168.1.2',undefined,'localhost']){
    const request={socket:{remoteAddress:address,encrypted:false},headers:{host:'localhost:8787','x-forwarded-for':'127.0.0.1'}};
    assert.equal(needsHTTPS(request,true),true);assert.equal(needsHTTPS({...request,socket:{...request.socket,encrypted:true}},true),false);
    assert.equal(needsHTTPS(request,false),false);
  }
});
