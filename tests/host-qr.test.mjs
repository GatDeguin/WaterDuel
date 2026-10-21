import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {HostQRCodes,sessionQrData} from '../public/host-qr.js';

const NOW=1_800_000_000_000;
function session(){return {id:'012345ABCD',baseURL:'http://192.168.1.8:8787',serverTime:NOW,expiresAt:NOW+60_000,
  links:{1:'http://192.168.1.8:8787/controller.html?slot=1&key='+'a'.repeat(36),2:'http://192.168.1.8:8787/controller.html?slot=2&key='+'b'.repeat(36)}};}
function element(){const attributes=new Map();return {hidden:true,onload:null,onerror:null,
  setAttribute:(key,value)=>attributes.set(key,String(value)),getAttribute:key=>attributes.get(key)??null,removeAttribute:key=>attributes.delete(key)};}
function fixture(){
  let now=NOW,serial=0;const timers=new Map(),cards=[element(),element()],images=[element(),element()];
  const root={hidden:true,querySelector(selector){const index=selector.includes('"1"')?0:1;return selector.startsWith('img')?images[index]:cards[index];}};
  let expired=0;
  const qr=new HostQRCodes(root,{now:()=>now,setTimer:(callback,delay)=>{const id=++serial;timers.set(id,{callback,delay});return id;},clearTimer:id=>timers.delete(id),onExpired:()=>expired++});
  return {qr,root,cards,images,timers,get expired(){return expired;},advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.delay<=ms){timers.delete(id);timer.callback();}}};
}

test('Dos invitaciones auténticas generan sólo rutas QR del mismo servidor, sin copiar claves al DOM',()=>{
  const data=sessionQrData(session(),{now:NOW});assert.equal(data.length,2);
  for(const [index,item] of data.entries()){
    const url=new URL(item.src,'http://localhost:8787');assert.equal(url.pathname,`/qr/${index+1}.svg`);
    assert.equal(url.origin,'http://localhost:8787');assert.equal(url.searchParams.get('base'),session().baseURL);
    assert.equal(url.searchParams.get('v'),'012345ABCD');assert.doesNotMatch(item.src,/key=|aaaa|bbbb/);
  }
});

test('Se rechazan vínculos externos, roles cruzados, claves inválidas, credenciales URL, parámetros extras y sesión vencida',()=>{
  const mutations=[
    s=>s.links[1]=s.links[1].replace('192.168.1.8','external.invalid'),
    s=>s.links[1]=s.links[1].replace('slot=1','slot=2'),
    s=>s.links[1]=s.links[1].replace('a'.repeat(36),'not-a-key'),
    s=>s.links[1]=s.links[1].replace('http://','http://user:password@'),
    s=>s.links[1]+='&return=https://external.invalid',
    s=>s.links[1]+='#fragment',s=>s.links[2]=s.links[1],
    s=>s.baseURL='javascript:alert(1)',s=>s.baseURL+='/other',s=>s.expiresAt=NOW,
    s=>s.id='../outside',s=>s.serverTime=NaN,
  ];
  for(const mutate of mutations){const value=session();mutate(value);assert.deepEqual(sessionQrData(value,{now:NOW}),[]);}
});

test('El reloj del servidor define el vencimiento aun con desfase local',()=>{
  const data=sessionQrData(session(),{now:NOW+300_000,serverOffset:-300_000});assert.equal(data.length,2);
  assert.equal(data[0].deadline,NOW+360_000);
  assert.deepEqual(sessionQrData(session(),{now:NOW+360_000,serverOffset:-300_000}),[]);
});

test('Los QR permanecen ocultos hasta cargar, se retiran al vencer y se actualizan con la sesión redescubierta',()=>{
  const f=fixture();assert.equal(f.qr.setSession(session()),true);assert.equal(f.root.hidden,true);
  f.images[0].onload();assert.equal(f.root.hidden,false);assert.equal(f.cards[0].hidden,false);assert.equal(f.cards[1].hidden,true);
  f.images[1].onload();assert.equal(f.cards[1].hidden,false);
  const staleLoad=f.images[0].onload;f.advance(60_000);
  assert.equal(f.root.hidden,true);assert.equal(f.expired,1);assert.equal(f.images[0].getAttribute('src'),null);
  staleLoad();assert.equal(f.root.hidden,true,'una carga tardía no revive una invitación vencida');
  const next=session();next.id='ABCDEF1234';next.serverTime=NOW+60_000;next.expiresAt=NOW+120_000;
  assert.equal(f.qr.setSession(next),true);assert.match(f.images[0].getAttribute('src'),/v=ABCDEF1234/);
  f.images[0].onload();assert.equal(f.root.hidden,false);f.qr.hide();assert.equal(f.root.hidden,true);assert.equal(f.timers.size,0);
});

test('Los temporizadores nativos conservan su receptor global al llamarse desde el componente QR',()=>{
  const f=fixture(),originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;let scheduled=0,cleared=0;
  // WebIDL Window timers may reject a foreign `this`; Node's native timers and
  // the earlier arrow-function fake did not expose that browser interop bug.
  globalThis.setTimeout=function(){assert.equal(this,globalThis,'setTimeout debe recibir su global, no HostQRCodes');scheduled++;return 42;};
  globalThis.clearTimeout=function(id){assert.equal(this,globalThis);assert.equal(id,42);cleared++;};
  try{
    const qr=new HostQRCodes(f.root,{now:()=>NOW});assert.equal(qr.setSession(session()),true);qr.hide();
    assert.equal(scheduled,1);assert.equal(cleared,1);
  }finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test('Una imagen fallida o una respuesta de sesión inválida no deja códigos obsoletos visibles',()=>{
  const f=fixture();f.qr.setSession(session());f.images[0].onload();f.images[0].onerror();assert.equal(f.root.hidden,true);
  f.images[1].onload();assert.equal(f.root.hidden,false);assert.equal(f.cards[0].hidden,true);
  assert.equal(f.qr.setSession({}),false);assert.equal(f.root.hidden,true);assert.equal(f.images[1].getAttribute('src'),null);
  assert.equal(new HostQRCodes(null).setSession(session()),false,'un fixture sin DOM de invitación sigue siendo válido');
});

test('Las únicas superposiciones PC son los dos QR pequeños de esquina, sin controles ni panel de menú',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/<aside\b[^>]*id="joinCodes"[^>]*hidden/);assert.equal((html.match(/<img\b/g)??[]).length,2);
  assert.equal((html.match(/<figcaption>J[12]<\/figcaption>/g)??[]).length,2);
  assert.doesNotMatch(html,/<(?:button|dialog|input|select|nav)\b/);
  const css=await readFile(new URL('../public/style.css',import.meta.url),'utf8');
  assert.match(css,/pointer-events:\s*none/);assert.match(css,/clamp\(64px,7\.5vw,96px\)/);
  assert.match(css,/background:\s*#fff/);assert.match(css,/left:/);assert.match(css,/right:/);
});
