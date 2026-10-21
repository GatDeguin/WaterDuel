import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {sessionQrData} from '../public/host-qr.js';
const require=createRequire(import.meta.url),QRCode=require('../vendor/qr/index.js'),levels=require('../vendor/qr/QRErrorCorrectLevel.js');

function matchesInvitation(svg,invitation){
  const qr=new QRCode(0,levels.M);qr.addData(invitation);qr.make();
  const count=qr.getModuleCount(),size=count+8;
  if(!svg.includes(`viewBox="0 0 ${size} ${size}"`)||!svg.includes('fill="#fff"'))return false;
  const modules=new Set([...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(match=>`${match[1]},${match[2]}`));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const inside=x>=4&&x<count+4&&y>=4&&y<count+4;
    if(modules.has(`${x},${y}`)!==(inside&&qr.isDark(y-4,x-4)))return false;
  }
  return true;
}

test('Las dos rutas QR codifican las invitaciones HTTP vigentes y se renuevan al rotar una sesión real',async t=>{
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const base=`http://127.0.0.1:${port}`,child=spawn(process.execPath,['server.mjs'],{
    cwd:new URL('..',import.meta.url),stdio:'ignore',env:{...process.env,HTTPS:'0',HOST:'127.0.0.1',PORT:String(port),PUBLIC_URL:base,SESSION_TTL_MS:'1800',HEARTBEAT_MS:'100'},
  });
  t.after(async()=>{const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await Promise.race([exit,delay(800)]);});
  let first;
  for(let attempt=0;attempt<80;attempt++){
    try{const response=await fetch(base+'/api/session');if(response.ok){first=await response.json();break;}}catch{}
    await delay(20);
  }
  assert.ok(first,'El servidor aislado entrega metadatos sin imprimir invitaciones.');
  const initial=sessionQrData(first);assert.equal(initial.length,2);
  for(const [index,data] of initial.entries()){
    const response=await fetch(base+data.src);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^image\/svg\+xml/);
    assert.equal(matchesInvitation(await response.text(),first.links[index+1]),true,'La matriz coincide con la invitación de ese jugador y conserva cuatro módulos blancos.');
  }
  await delay(Math.max(0,first.expiresAt-Date.now()+100));
  const next=await (await fetch(base+'/api/session')).json(),renewed=sessionQrData(next);
  assert.equal(renewed.length,2);assert.notEqual(next.id,first.id);assert.notEqual(renewed[0].src,initial[0].src);
  assert.deepEqual(sessionQrData(first),[],'Los metadatos anteriores ya no permiten mostrar códigos.');
  for(const [index,data] of renewed.entries()){
    const svg=await (await fetch(base+data.src)).text();assert.equal(matchesInvitation(svg,next.links[index+1]),true);
    assert.equal(matchesInvitation(svg,first.links[index+1]),false,'Una imagen nueva no vuelve a codificar la clave anterior.');
  }
  // This compares actual HTTP SVG matrices with the included encoder. It is not
  // an optical scan or an independent QR decoder, and makes neither claim.
});
