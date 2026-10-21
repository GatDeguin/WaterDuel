/**
 * WATER DUEL · Zero-dependency LAN host and WebSocket relay.
 * Node.js 20+. One authoritative simulation host; two authenticated controller slots.
 * The QR encoder is MIT-licensed Kazuhiko Arase QRCode for JavaScript.
 */
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {normalizeMenuCommand,sanitizeMenuState} from './public/remote-menu.js';
import {loadLocalHTTPS,canonicalPublicURL,certificateCovers,needsHTTPS} from './scripts/local-https.mjs';
import {lanAddresses} from './scripts/network-addresses.mjs';

const require = createRequire(import.meta.url);
const QRCode = require('./vendor/qr/index.js');
const QRLevels = require('./vendor/qr/QRErrorCorrectLevel.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'public');
const PORT = Number(process.env.PORT || 8787);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8788);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_FRAME = 8 * 1024;
const positiveOption=(name,fallback,min)=>Math.max(min,Number(process.env[name])||fallback);
const SESSION_TTL=positiveOption('SESSION_TTL_MS',4*60*60*1000,1000);
const HEARTBEAT_MS=positiveOption('HEARTBEAT_MS',5000,100);
const PEER_IDLE_MS=positiveOption('PEER_IDLE_MS',16000,1000);
let SESSION_ID,hostToken,token,expiresAt;
const peers = new Set();
const slots = new Map();
let authority = null;
let lastMenuState=null,relaySerial=0;
const pendingCommands=new Map();
const COMMAND_TTL_MS=5000;
function rejectCommand(peer,requestId,message){
  peer.send({type:'command-result',requestId,ok:false,message});
}
function clearPending(predicate,message){
  for(const [relayId,entry] of pendingCommands){
    if(!predicate(entry))continue;
    pendingCommands.delete(relayId);
    if(message&&!entry.peer.closed&&slots.get(entry.slot)===entry.peer)rejectCommand(entry.peer,entry.requestId,message);
  }
}
function expireCommands(now){clearPending(entry=>entry.deadline<=now,'La pantalla no respondió a tiempo. Volvé a intentar.');}
function renewSession(){
  lastMenuState=null;
  for(const peer of [...peers]){peer.send({type:'session-expired'});peer.close();}
  pendingCommands.clear();
  SESSION_ID=crypto.randomBytes(5).toString('hex').toUpperCase();
  hostToken=crypto.randomBytes(20).toString('hex');
  token={1:crypto.randomBytes(18).toString('hex'),2:crypto.randomBytes(18).toString('hex')};
  expiresAt=Date.now()+SESSION_TTL;
}
renewSession();

const networks=lanAddresses();
let localTLS,baseURL;
try{
  localTLS=loadLocalHTTPS({root:HERE,ips:networks.map(n=>n.ip)});
  if(localTLS&&(!Number.isInteger(HTTPS_PORT)||HTTPS_PORT<1||HTTPS_PORT>65535||HTTPS_PORT===PORT))throw Error('HTTPS_PORT debe ser un puerto válido distinto de PORT.');
  baseURL=canonicalPublicURL(process.env.PUBLIC_URL||`${localTLS?'https':'http'}://${networks[0].ip}:${localTLS?HTTPS_PORT:PORT}`,!!localTLS);
}catch(error){console.error('No se inicia WaterDuel: '+error.message);process.exit(1);}
const addressCandidates=[{name:'Predeterminada',url:baseURL},...networks.flatMap(n=>[
  ...(localTLS&&certificateCovers(localTLS.certificate,n.ip)?[{name:n.adapter+' · HTTPS · '+n.ip,url:`https://${n.ip}:${HTTPS_PORT}`}]:[]),
  ...(!localTLS?[{name:n.adapter+' · HTTP · '+n.ip,url:`http://${n.ip}:${PORT}`}]:[])])];
const addresses=[...new Map(addressCandidates.map(entry=>[entry.url,entry])).values()];
const allowedBases=new Set(addresses.map(a=>a.url));
const linkFor = (slot,base=baseURL) => `${base}/controller.html?slot=${slot}&key=${token[slot]}`;
const tlsSummary={enabled:!!localTLS,port:localTLS?HTTPS_PORT:null,caCertificatePath:localTLS?.ca?'/certs/waterduel-local-ca.crt':null,
  caFingerprint256:localTLS?.caFingerprint??null,requiresManualTrust:!!localTLS?.localAuthority};

function respond(res, code, type, body, headers={}) {
  res.writeHead(code, {'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',...headers});
  res.end(body);
}
function svgQR(value) {
  const qr = new QRCode(0, QRLevels.M);
  qr.addData(value); qr.make();
  const n=qr.getModuleCount(); const quiet=4;
  let blocks='';
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    if(qr.isDark(y,x)) blocks += `M${x+quiet} ${y+quiet}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n+8} ${n+8}" shape-rendering="crispEdges" role="img" aria-label="QR de conexión"><rect width="100%" height="100%" fill="#fff"/><path fill="#17282B" d="${blocks}"/></svg>`;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json'};
const requestHandler=(req,res)=>{
  let url;
  try{url=new URL(req.url,`${req.socket.encrypted?'https':'http'}://${req.headers.host || 'localhost'}`)} catch {return respond(res,400,'text/plain','Bad request');}
  if(needsHTTPS(req,localTLS)&&!['/certs/waterduel-local-ca.crt','/https'].includes(url.pathname))
    return respond(res,426,'text/plain; charset=utf-8',`Usá HTTPS para los mandos: ${baseURL}\nCA pública y ayuda: /https\n`,{Upgrade:'TLS/1.2'});
  if(url.pathname==='/https'){
    if(!localTLS)return respond(res,503,'text/plain; charset=utf-8','HTTPS no está habilitado. Prepará certificados válidos antes de usar mandos seguros.\n');
    return respond(res,200,'text/plain; charset=utf-8',`WaterDuel HTTPS: ${baseURL}\nCA pública: /certs/waterduel-local-ca.crt\nHuella SHA-256: ${localTLS.caFingerprint??'Certificado configurado'}\nCompará la huella con la consola de la PC antes de confiar manualmente. No se instala confianza automáticamente.\n`);
  }
  if(Date.now()>=expiresAt)renewSession();
  if (url.pathname === '/api/session') return respond(res,200,'application/json',JSON.stringify({id:SESSION_ID,baseURL,addresses,tls:tlsSummary,expiresAt,serverTime:Date.now(),hostConnected:!!authority,connected:[slots.has(1),slots.has(2)],links:{1:linkFor(1),2:linkFor(2)},hostToken}));
  if (url.pathname === '/api/health') return respond(res,200,'application/json',JSON.stringify({ok:true, session:SESSION_ID, connected:[slots.has(1),slots.has(2)],hostConnected:!!authority}));
  if(url.pathname==='/certs/waterduel-local-ca.crt'){
    if(!localTLS?.ca)return respond(res,404,'text/plain','No local CA certificate available');
    return respond(res,200,'application/x-x509-ca-cert',localTLS.ca,{'Content-Disposition':'attachment; filename="waterduel-local-ca.crt"'});
  }
  if(/^\/qr\/[12]\.svg$/.test(url.pathname)) {
    const slot=Number(url.pathname[4]);
    const selected=url.searchParams.get('base');
    if(selected && !allowedBases.has(selected))return respond(res,400,'text/plain','Invalid network address');
    return respond(res,200,'image/svg+xml; charset=utf-8',svgQR(linkFor(slot,selected||baseURL)));
  }
  let relative;try{relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.replace(/^\//,''));}
  catch{return respond(res,400,'text/plain','Invalid URL encoding');}
  if(relative.includes('\\') || relative.split('/').includes('..')) return respond(res,403,'text/plain','Forbidden');
  const full=path.resolve(ROOT,relative);
  if(full!==ROOT && !full.startsWith(ROOT+path.sep)) return respond(res,403,'text/plain','Forbidden');
  try {
    const stat=fs.statSync(full);
    if(!stat.isFile()) throw new Error('not file');
    const ext=path.extname(full);
    const data=fs.readFileSync(full);
    return respond(res,200,mime[ext]||'application/octet-stream',data);
  } catch {return respond(res,404,'text/plain','Not found');}
};
const server=http.createServer(requestHandler),secureServer=localTLS?https.createServer(localTLS.options,requestHandler):null;

class Peer {
  constructor(socket) {
    this.socket=socket; this.buffer=Buffer.alloc(0); this.role=null; this.slot=null; this.lastSeq=-1; this.closed=false;
    this.lastCommandId=0;this.commandTimes=[];
    this.createdAt=Date.now();this.lastSeen=this.createdAt;
    socket.on('data',b=>this.receive(b));
    socket.on('error',()=>this.cleanup());
    socket.on('close',()=>this.cleanup());
    peers.add(this);
  }
  send(payload) {
    if(this.closed || this.socket.destroyed) return;
    if(this.socket.writableLength>256*1024){this.close();return;}
    const data=Buffer.from(JSON.stringify(payload));
    const hdr=data.length<126?Buffer.from([0x81,data.length]):Buffer.from([0x81,126,data.length>>8,data.length&255]);
    try {this.socket.write(Buffer.concat([hdr,data]));} catch {this.cleanup();}
  }
  pong(data=Buffer.alloc(0)) {if(!this.closed)try{this.socket.write(Buffer.concat([Buffer.from([0x8a,data.length]),data]));}catch{}}
  close() {try{this.socket.end(Buffer.from([0x88,0]));}catch{}this.cleanup();}
  cleanup(){
    if(this.closed)return;
    this.closed=true;peers.delete(this);
    if(this.role==='host' && authority===this){
      authority=null;lastMenuState=null;
      clearPending(entry=>entry.host===this,'La pantalla perdió la conexión. Esperá a que vuelva.');
      for(const p of slots.values())p.send({type:'host',online:false});
    }
    if(this.role==='controller'){
      clearPending(entry=>entry.peer===this);
      if(slots.get(this.slot)===this){slots.delete(this.slot);authority?.send({type:'presence',slot:this.slot,online:false});}
    }
  }
  receive(data){
    if(this.closed)return;
    this.lastSeen=Date.now();
    this.buffer=Buffer.concat([this.buffer,data]);
    while(this.buffer.length>=2){
      const a=this.buffer[0],b=this.buffer[1];
      const masked=!!(b&0x80); let len=b&127,offset=2;
      if(len===126){if(this.buffer.length<4)return;len=this.buffer.readUInt16BE(2);offset=4;}
      if(len===127 || len>MAX_FRAME || !masked || !(a&0x80) || (a&0x70)){this.close();return;}
      if(this.buffer.length<offset+4+len)return;
      const key=this.buffer.subarray(offset,offset+4);offset+=4;
      const payload=Buffer.from(this.buffer.subarray(offset,offset+len));
      this.buffer=this.buffer.subarray(offset+len);
      for(let i=0;i<len;i++)payload[i]^=key[i%4];
      const opcode=a&15;
      if(opcode===8){this.close();return;}
      if(opcode===9){this.pong(payload);continue;}
      if(opcode!==1)continue;
      try{this.message(JSON.parse(payload.toString('utf8')))}catch{this.send({type:'error',message:'Invalid message'});}
    }
  }
  message(msg){
    if(this.closed)return;
    if(!msg || typeof msg !== 'object')return;
    if(Date.now()>=expiresAt){renewSession();return;}
    expireCommands(Date.now());
    if(msg.type==='hello'){
      if(this.role)return;
      if(msg.role==='host' && msg.key===hostToken){
        if(authority && authority!==this){this.send({type:'error',code:'HOST_BUSY',message:'Otra pantalla ya controla esta sesión. Cerrala antes de reintentar.'});this.close();return;}
        authority=this;this.role='host';
        this.send({type:'welcome',role:'host',id:SESSION_ID,serverTime:Date.now(),connected:[slots.has(1),slots.has(2)]});
        for(const p of slots.values())p.send({type:'host',online:true});
      } else if(msg.role==='controller' && (msg.slot===1 || msg.slot===2) && msg.key===token[msg.slot]){
        this.role='controller';this.slot=msg.slot;
        const old=slots.get(msg.slot);if(old && old!==this)old.close();
        slots.set(msg.slot,this);
        this.send({type:'welcome',role:'controller',slot:this.slot,hostOnline:!!authority,id:SESSION_ID,serverTime:Date.now(),maxInputAgeMs:430});
        if(authority&&lastMenuState)this.send({type:'menu-state',state:lastMenuState});
        authority?.send({type:'presence',slot:this.slot,online:true});
      } else {this.send({type:'error',code:'INVALID_INVITATION',message:'Invitación inválida o caducada. Volvé a escanear el QR.'});this.close();}
      return;
    }
    if(msg.type==='ping' && this.role){this.send({type:'pong',at:Number(msg.at)||0,serverTime:Date.now()});return;}
    if(msg.type==='pong' && this.role)return;
    if(msg.type==='command'){
      if(this.role!=='controller'||slots.get(this.slot)!==this){
        this.send({type:'error',code:'AUTH_REQUIRED',message:'Conectá un mando con su invitación vigente para usar el menú.'});return;
      }
      const requestId=msg.requestId;
      if(!Number.isSafeInteger(requestId)||requestId<=0){this.send({type:'error',code:'INVALID_COMMAND',message:'La solicitud de menú no es válida.'});return;}
      if(requestId<=this.lastCommandId){rejectCommand(this,requestId,'La solicitud ya fue procesada o llegó fuera de orden.');return;}
      this.lastCommandId=requestId;
      const now=Date.now();this.commandTimes=this.commandTimes.filter(at=>now-at<1000);
      if(this.commandTimes.length>=12){rejectCommand(this,requestId,'Demasiadas opciones muy rápido. Esperá un segundo.');return;}
      this.commandTimes.push(now);
      const command=normalizeMenuCommand(msg);
      if(!command){rejectCommand(this,requestId,'La opción o su valor no son válidos.');return;}
      const age=now-command.sentAt;
      if(age>2500||age< -1000){rejectCommand(this,requestId,'La solicitud caducó o su tiempo no está sincronizado. Volvé a intentar.');return;}
      if(!authority){rejectCommand(this,requestId,'La pantalla está sin conexión. Esperá a que vuelva.');return;}
      let count=0;for(const entry of pendingCommands.values())if(entry.peer===this)count++;
      if(count>=24){rejectCommand(this,requestId,'La pantalla todavía tiene solicitudes pendientes. Esperá antes de intentar.');return;}
      const relayId=++relaySerial;
      pendingCommands.set(relayId,{peer:this,slot:this.slot,requestId,host:authority,deadline:now+COMMAND_TTL_MS});
      authority.send({type:'command',...command,slot:this.slot,relayId});return;
    }
    if(msg.type==='menu-state'&&this.role==='host'&&authority===this){
      if(!msg.state||typeof msg.state!=='object'||Array.isArray(msg.state))return;
      lastMenuState=sanitizeMenuState(msg.state);
      for(const peer of slots.values())peer.send({type:'menu-state',state:lastMenuState});
      return;
    }
    if(msg.type==='command-result'&&this.role==='host'&&authority===this){
      const entry=pendingCommands.get(msg.relayId);
      if(!entry||entry.host!==this||entry.slot!==msg.slot||entry.requestId!==msg.requestId||typeof msg.ok!=='boolean')return;
      pendingCommands.delete(msg.relayId);
      if(!entry.peer.closed&&slots.get(entry.slot)===entry.peer)
        entry.peer.send({type:'command-result',requestId:entry.requestId,ok:msg.ok,message:sanitizeMenuState({message:msg.message}).message});
      return;
    }
    if(msg.type==='control' && this.role==='controller'&&slots.get(this.slot)===this){
      let seq=Number(msg.seq);
      if(!Number.isSafeInteger(seq)||seq<=this.lastSeq)return;
      this.lastSeq=seq;
      // Controller timestamps are in server time after the welcome/ping clock sync.
      const age=Date.now()-msg.sentAt;
      if(!Number.isFinite(msg.sentAt)||age>430||age< -1000)return;
      const clamp=x=>Number.isFinite(Number(x))?Math.max(-1,Math.min(1,Number(x))):0;
      const neutralize=msg.neutralize===true;
      const axes=neutralize?{offX:0,offY:0,mainX:0,mainY:0,lean:0,wrist:0}:
        {offX:clamp(msg.offX),offY:clamp(msg.offY),mainX:clamp(msg.mainX),mainY:clamp(msg.mainY),lean:clamp(msg.lean),wrist:clamp(msg.wrist)};
      if(!neutralize)for(const key of ['headX','headZ','bodyY'])if(Object.hasOwn(msg,key))axes[key]=clamp(msg[key]);
      authority?.send({type:'control',slot:this.slot,axes,thrust:neutralize?false:!!msg.thrust,guard:neutralize?false:!!msg.guard,
        ...(!neutralize&&msg.attackHeld===true?{attackHeld:true}:{}),
        seq,t:Date.now(),sentAt:msg.sentAt,...(neutralize?{neutralize:true}:{})});
      return;
    }
    if(msg.type==='state' && this.role==='host'){
      for(const p of slots.values())p.send({type:'state',phase:String(msg.phase||'ready').slice(0,40),mode:String(msg.mode||'solo').slice(0,16),score:Array.isArray(msg.score)?msg.score.slice(0,2):[0,0],time:Number(msg.time)||0});
      return;
    }
    if(msg.type==='event' && this.role==='host'){
      if(['burst','clang','countdown','victory','joint-damage','joint-break'].includes(msg.name)) for(const p of slots.values())p.send({type:'event',name:msg.name,slot:msg.slot||0});
    }
  }
}
function upgradeHandler(req,socket){
  if(needsHTTPS(req,localTLS)){
    const body=`Usá la conexión segura ${baseURL}\n`;
    socket.end(`HTTP/1.1 426 Upgrade Required\r\nUpgrade: TLS/1.2\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);return;
  }
  let route;
  try{route=new URL(req.url,'http://localhost').pathname}catch{socket.destroy();return;}
  const key=req.headers['sec-websocket-key'];
  if(route!=='/ws'||req.headers.upgrade?.toLowerCase()!=='websocket'||typeof key!=='string'||!/^[A-Za-z0-9+/]{22}==$/.test(key)){socket.destroy();return;}
  // Reject cross-site browser hijacking: the request origin must be this local server.
  const origin=req.headers.origin;
  if(origin){try{const u=new URL(origin),h=req.headers.host; if(u.host!==h||u.protocol!==(req.socket.encrypted?'https:':'http:')||u.username||u.password){socket.destroy();return;}}catch{socket.destroy();return;}}
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  new Peer(socket);
}
server.on('upgrade',upgradeHandler);secureServer?.on('upgrade',upgradeHandler);
const heartbeat=setInterval(()=>{
  const now=Date.now();
  if(now>=expiresAt){renewSession();return;}
  expireCommands(now);
  for(const peer of [...peers]){
    if(now-peer.lastSeen>PEER_IDLE_MS || (!peer.role&&now-peer.createdAt>5000)){peer.close();continue;}
    if(peer.role)peer.send({type:'ping',at:now});
  }
},HEARTBEAT_MS);
heartbeat.unref();
async function listen(listener,port){await new Promise((resolve,reject)=>{const failed=error=>reject(error);listener.once('error',failed);listener.listen(port,HOST,()=>{listener.off('error',failed);resolve();});});}
try{
  if(secureServer)await listen(secureServer,HTTPS_PORT);
  await listen(server,PORT);
  console.log('\n  WATER DUEL · Local arena online');
  console.log(`  Pantalla en esta PC: http://localhost:${PORT}`);
  console.log(`  Mandos en la LAN: ${baseURL}`);
  if(localTLS){
    console.log(localTLS.localAuthority?'  HTTPS activo. La CA local requiere confianza manual en cada móvil; no se instaló automáticamente.':'  HTTPS activo con el certificado configurado.');
    if(localTLS.ca){console.log(`  CA pública: http://${networks[0].ip}:${PORT}/certs/waterduel-local-ca.crt`);console.log(`  Huella SHA-256 de la CA: ${localTLS.caFingerprint}`);}
  }else if(process.env.HTTPS!=='0')console.log('  HTTPS no está habilitado: prepará certificados locales o configurá TLS_CERT_FILE/TLS_KEY_FILE.');
  if(addresses.length>2)console.log('  Otras interfaces de red: '+networks.map(n=>n.ip).join(', '));
  console.log('  Escaneá los QR J1/J2 de las esquinas de la arena. Las claves no se imprimen en consola.');
  console.log('  Todos los dispositivos deben compartir Wi-Fi. Ctrl+C para salir.\n');
}catch(error){
  console.error(`No se pudo iniciar la arena (${error.code||'SERVER_ERROR'}). Revisá los puertos HTTP/HTTPS configurados.`);
  server.close();secureServer?.close();process.exitCode=1;
}
