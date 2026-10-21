import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {normalizeMenuCommand,sanitizeMenuState} from '../public/remote-menu.js';
import {RadialJoystick,weaponGesture,movementGesture} from '../public/joysticks.js';
const source=await readFile(new URL('../public/controller.js',import.meta.url),'utf8');
const markup=await readFile(new URL('../public/controller.html',import.meta.url),'utf8');

class Element{
  constructor(id=''){this.id=id;this.listeners=new Map();this.attrs=new Map();this.children=[];this.style={};this.dataset={};this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.open=false;this.captures=new Set();const classes=new Set();this.classList={add:n=>classes.add(n),remove:n=>classes.delete(n),toggle:(n,on)=>{if(on??!classes.has(n))classes.add(n);else classes.delete(n);},contains:n=>classes.has(n)};}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
  fire(name,data={}){const event={target:this,currentTarget:this,preventDefault(){this.defaultPrevented=true;},...data};for(const fn of this.listeners.get(name)??[])fn(event);return event;}
  setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.get(k)??null;}
  removeAttribute(k){this.attrs.delete(k);}getBoundingClientRect(){const size=/Knob$/.test(this.id)?28:100;return {left:0,top:0,width:size,height:size};}
  setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){if(this.captures.delete(id))this.fire('lostpointercapture',{pointerId:id});}
  focus(){this.owner.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;this.fire('close');}
  appendChild(child){this.children.push(child);return child;}replaceChildren(...children){this.children=children;}
  querySelectorAll(){return [...this.owner.elements.values()].filter(e=>e.id.startsWith('menu')&&!e.disabled&&!e.hidden);}
  set innerHTML(_value){throw Error('El contenido remoto debe presentarse como texto, nunca HTML.');}
}
function fixture(slot=1){
  const elements=new Map();for(const m of markup.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)){
    const e=new Element(m[1]);for(const a of m[0].matchAll(/([\w:-]+)="([^"]*)"/g))e.setAttribute(a[1],a[2]);e.hidden=/\bhidden\b/.test(m[0]);elements.set(e.id,e);
  }
  const document=new Element('document');document.elements=elements;document.hidden=false;document.body=new Element('body');document.getElementById=id=>elements.get(id)??null;document.createElement=()=>{const e=new Element();e.owner=document;return e;};
  for(const e of elements.values())e.owner=document;const window=new Element('window');window.isSecureContext=false;
  const sockets=[],timers=new Map();let timer=0;
  class Socket{static OPEN=1;static CONNECTING=0;static CLOSED=3;constructor(){this.readyState=0;this.messages=[];sockets.push(this);}send(raw){this.messages.push(JSON.parse(raw));}open(){this.readyState=1;this.onopen?.();}receive(data){this.onmessage?.({data:JSON.stringify(data)});}close(){this.readyState=3;this.onclose?.();}}
  const ctx=vm.createContext({document,window,navigator:{vibrate(){}},location:{search:`?slot=${slot}&key=private-fixture`,protocol:'http:',host:'fixture.local:8787'},WebSocket:Socket,URLSearchParams,Date,console,RadialJoystick,weaponGesture,movementGesture,
    setInterval:()=>++timer,setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id)});
  new vm.Script(source.replace(/^import[^\n]+;\s*$/gm,''),{filename:fileURLToPath(new URL('../public/controller.js',import.meta.url)),importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInContext(ctx);
  const socket=sockets[0];socket.open();socket.receive({type:'welcome',role:'controller',slot,hostOnline:true,serverTime:Date.now()+10000});
  return {document,window,elements,socket,timers,ctx,el:id=>{assert.ok(elements.has(id),`falta superficie móvil ${id}`);return elements.get(id);},commands:()=>socket.messages.filter(m=>m.type==='command'),controls:()=>socket.messages.filter(m=>m.type==='control'),
    receive:state=>socket.receive({type:'menu-state',state}),open(){this.el('menuBtn').fire('click');},change(id,value){this.el(id).value=String(value);this.el(id).fire('change');}};
}
const state=(extra={})=>({phase:'ready',mode:'solo',experience:'duel',difficulty:'normal',bestOf:3,arena:'atelier',quality:'high',camera:'combat',lighting:'cinematic',audioOn:true,volume:55,scores:[1,0],round:2,clock:'00:37',fighters:[{slot:1,name:'Mint',equipment:{weapon:'sword',defense:'short'},guardPercent:70,guardLabel:'GUARDIA',wins:[true,false]},{slot:2,name:'Amber',equipment:{weapon:'spear',defense:'long'},guardPercent:20,guardLabel:'ACTIVA',wins:[false,false]}],objective:{title:'Escuela',instruction:'Mové el brazo real',progress:2,total:7,completed:false,nextAction:null},replay:{clips:[{id:7,duration:2.8,complete:true}],active:false,paused:true,speed:.5,position:.25},configurable:true,trainingEquipmentLocked:false,message:'Preparados',...extra});
const neutral={offX:0,offY:0,mainX:0,mainY:0,lean:0,bodyY:0,wrist:0,thrust:false,guard:false,attackHeld:false,headX:0,headZ:0};

test('MENÚ y volver neutralizan captura multitáctil y no reactivan un hold viejo',()=>{
  const f=fixture();f.receive(state());f.el('mainPad').fire('pointerdown',{pointerId:1,clientX:100,clientY:0});f.el('headPad').fire('pointerdown',{pointerId:3,clientX:100,clientY:0});
  f.el('offPad').fire('pointerdown',{pointerId:4,clientX:50,clientY:86});assert.equal(f.controls().at(-1).bodyY,-1);
  assert.equal(f.controls().at(-1).attackHeld,true);assert.ok(f.controls().at(-1).wrist>0);f.open();assert.equal(f.el('mobileMenu').open,true);assert.equal(f.el('controllerShell').inert,true);
  assert.equal(f.el('mainPad').captures.size,0);assert.equal(f.el('headPad').captures.size,0);
  for(const [k,v]of Object.entries(neutral))assert.equal(f.controls().at(-1)[k],v);
  f.el('mainPad').fire('pointermove',{pointerId:1,clientX:100,clientY:0});f.el('offPad').fire('pointerdown',{pointerId:4,clientX:100,clientY:0});f.el('headPad').fire('pointermove',{pointerId:3,clientX:100,clientY:0});
  assert.equal(f.controls().at(-1).guard,false);assert.equal(f.controls().at(-1).lean,0);assert.equal(f.controls().at(-1).attackHeld,false);f.el('menuCloseBtn').fire('click');assert.equal(f.el('mobileMenu').open,false);
  f.el('mainPad').fire('pointerup',{pointerId:1});assert.equal(f.controls().at(-1).thrust,false);assert.equal(f.controls().at(-1).wrist,0);assert.equal(f.document.activeElement,f.el('menuBtn'));
});

test('neutralización explícita borra intención sostenida; releases ordinarios no fabrican pulsos',()=>{
  const f=fixture();f.receive(state());assert.equal(f.controls().at(-1).neutralize,true,'la bienvenida limpia cualquier entrada retenida');
  f.el('mainPad').fire('pointerdown',{pointerId:11,clientX:100,clientY:0});assert.equal('neutralize'in f.controls().at(-1),false);assert.equal(f.controls().at(-1).attackHeld,true);assert.equal(f.controls().at(-1).thrust,false);
  f.el('mainPad').fire('pointerup',{pointerId:11});assert.equal('neutralize'in f.controls().at(-1),false);assert.equal(f.controls().at(-1).attackHeld,false);assert.equal(f.controls().at(-1).wrist,0);
  f.open();assert.equal(f.controls().at(-1).neutralize,true);assert.equal(f.controls().at(-1).thrust,false);
  f.el('menuCloseBtn').fire('click');assert.equal(f.controls().at(-1).neutralize,true);
  f.el('mainPad').fire('pointerdown',{pointerId:12,clientX:100,clientY:0});f.el('mainPad').fire('pointerup',{pointerId:12});assert.equal('neutralize'in f.controls().at(-1),false);
  f.window.fire('blur');assert.equal(f.controls().at(-1).neutralize,true);
});

test('configuración móvil envía valores tipados y requestId/sentAt crecientes sin credenciales',()=>{
  const f=fixture();f.receive(state());f.open();
  const cases=[['menuMode','versus','setMode','versus'],['menuExperience','precision','setExperience','precision'],['menuDifficulty','boss','setDifficulty','boss'],['menuBestOf','5','setBestOf',5],['menuArena','dojo','setArena','dojo'],['menuQuality','eco','setQuality','eco'],['menuCamera','detail','setCamera','detail'],['menuLighting','neutral','setLighting','neutral'],['menuVolume','80','setVolume',80]];
  const fields={setMode:'mode',setExperience:'experience',setDifficulty:'difficulty',setBestOf:'bestOf',setArena:'arena',setQuality:'quality',setCamera:'camera',setLighting:'lighting',setVolume:'volume'};
  for(const [id,value,command,want]of cases){f.receive(state());f.change(id,value);const sent=f.commands().at(-1);assert.equal(sent.command,command);assert.equal(sent.value,want);f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true,message:'Aplicado'});f.receive(state({[fields[command]]:want}));}
  f.el('menuAudio').checked=false;f.el('menuAudio').fire('change');assert.equal(f.commands().at(-1).value,false);assert.equal(f.commands().at(-1).command,'setAudio');
  let previous=0;for(const m of f.commands()){assert.ok(Number.isSafeInteger(m.requestId)&&m.requestId>previous);previous=m.requestId;assert.ok(m.sentAt>Date.now()+9000);assert.equal('key'in m,false);assert.equal('slot'in m,false);}
});

test('estado y rechazo restauran selección autoritativa sin atribuir éxito local',()=>{
  const f=fixture();f.receive(state());f.open();f.change('menuArena','dojo');const command=f.commands().at(-1);
  f.socket.receive({type:'command-result',requestId:command.requestId,ok:false,message:'No durante combate'});assert.equal(f.el('menuArena').value,'atelier');assert.match(f.el('menuFeedback').textContent,/No durante combate/);
  f.receive(state({arena:'midnight',scores:[1,2],round:4,clock:'+00:09'}));assert.equal(f.el('menuArena').value,'midnight');assert.match(f.el('menuScore').textContent,/1.*2/);assert.equal(f.el('menuClock').textContent,'+00:09');assert.match(f.el('menuObjectiveInstruction').textContent,/brazo/);
});

test('comenzar espera su ACK y devuelve directamente al arma sin un segundo toque en volver',()=>{
  const f=fixture();f.receive(state());f.open();f.el('menuStartBtn').fire('click');const sent=f.commands().at(-1);
  assert.equal(f.el('mobileMenu').open,true,'enviar no equivale a iniciar');
  assert.equal(f.el('menuStartBtn').disabled,true);assert.equal(f.el('menuStartBtn').getAttribute('aria-busy'),'true');
  f.receive(state({phase:'countdown',configurable:false}));assert.equal(f.el('mobileMenu').open,true,'el estado puede venir de otro jugador');
  f.socket.receive({type:'command-result',requestId:sent.requestId+1,ok:true});assert.equal(f.el('mobileMenu').open,true);
  f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true,message:'Preparados'});
  assert.equal(f.el('mobileMenu').open,false);assert.equal(f.el('controllerShell').inert,false);
  assert.equal(f.el('menuBtn').getAttribute('aria-expanded'),'false');assert.equal(f.document.activeElement,f.el('mainPad'));
  for(const [k,v]of Object.entries(neutral))assert.equal(f.controls().at(-1)[k],v);
  f.el('mainPad').fire('pointerdown',{pointerId:51,clientX:100,clientY:0});assert.equal(f.controls().at(-1).attackHeld,true);
  assert.equal(f.commands().length,1,'volver a los mandos no pide reiniciar ni comenzar otra vez');
});

test('revancha, siguiente encuentro y cerrar repetición vuelven a mandos tras aceptación propia',()=>{
  for(const [id,initial]of [
    ['menuStartBtn',state({phase:'matchover'})],
    ['menuNextBtn',state({phase:'matchover',experience:'campaign',objective:{nextAction:'advance'}})],
    ['menuReplayCloseBtn',state({replay:{clips:[],active:true,paused:true,speed:1,position:0}})]
  ]){
    const f=fixture();f.receive(initial);f.open();f.el(id).fire('click');const sent=f.commands().at(-1);
    assert.ok(sent,id);assert.equal(f.el('mobileMenu').open,true,id);
    f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true});
    assert.equal(f.el('mobileMenu').open,false,id);
  }
});

test('preparar partida y reiniciar progreso conservan configuración antes de comenzar',()=>{
  for(const id of ['menuResetBtn','menuCampaignResetBtn']){
    const f=fixture();f.receive(state({phase:'matchover',experience:'campaign'}));f.open();f.el(id).fire('click');const sent=f.commands().at(-1);
    f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true});f.receive(state({experience:'campaign'}));
    assert.equal(f.el('mobileMenu').open,true,id);assert.equal(f.el('menuStartBtn').disabled,false,id);
    assert.equal(f.commands().length,1,'no iniciar de forma implícita al borrar o preparar');
  }
});

test('seleccionar modo espera aplicación, conserva menú y bloquea iniciar una configuración anterior',()=>{
  const f=fixture();f.receive(state());f.open();f.change('menuExperience','precision');const sent=f.commands().at(-1);
  assert.equal(f.el('menuStartBtn').disabled,true);f.el('menuStartBtn').fire('click');assert.equal(f.commands().length,1);
  f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true});assert.equal(f.el('menuStartBtn').disabled,true);
  f.receive(state());assert.equal(f.el('menuStartBtn').disabled,true,'no basta un estado que todavía usa duelo');
  f.receive(state({experience:'precision'}));assert.equal(f.el('menuStartBtn').disabled,false);assert.equal(f.el('mobileMenu').open,true);
  f.change('menuQuality','eco');assert.equal(f.el('menuStartBtn').disabled,false,'la presentación no cambia la experiencia elegida');
});

test('inicio pendiente impide otro cambio mecánico o reinicio, pero deja disponible presentación',()=>{
  const f=fixture();f.receive(state());f.open();f.el('menuStartBtn').fire('click');
  for(const id of ['menuMode','menuExperience','menuArena','menuResetBtn','menuCampaignResetBtn'])assert.equal(f.el(id).disabled,true,id);
  f.change('menuMode','versus');f.el('menuResetBtn').fire('click');assert.equal(f.commands().length,1);
  f.change('menuQuality','eco');assert.equal(f.commands().at(-1).command,'setQuality');
});

test('rechazo o timeout de inicio conservan menú, explican el fallo y habilitan reintento explícito',()=>{
  for(const kind of ['reject','timeout']){
    const f=fixture();f.receive(state());f.open();f.el('menuStartBtn').fire('click');const sent=f.commands().at(-1);
    if(kind==='reject')f.socket.receive({type:'command-result',requestId:sent.requestId,ok:false,message:'La arena no está lista'});
    else for(const timer of [...f.timers.values()])timer();
    assert.equal(f.el('mobileMenu').open,true,kind);assert.equal(f.el('menuStartBtn').disabled,false,kind);
    assert.equal(f.el('menuFeedback').classList.contains('error'),true,kind);
    assert.equal(f.commands().length,1);f.el('menuStartBtn').fire('click');assert.equal(f.commands().length,2);
    f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true});assert.equal(f.el('mobileMenu').open,true,'la respuesta tardía no confirma el nuevo intento');
  }
});

test('error al enviar mantiene visible la acción y permite intentarla sin fingir confirmación',()=>{
  const f=fixture();f.receive(state());f.open();const realSend=f.socket.send.bind(f.socket);f.socket.send=()=>{throw Error('Transporte cerrado');};
  f.el('menuStartBtn').fire('click');assert.equal(f.el('mobileMenu').open,true);assert.equal(f.el('menuStartBtn').disabled,false);
  assert.equal(f.el('menuFeedback').classList.contains('error'),true);assert.equal(f.commands().length,0);
  f.socket.send=realSend;f.el('menuStartBtn').fire('click');assert.equal(f.commands().length,1);
  const sent=f.commands().at(-1);f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true});assert.equal(f.el('mobileMenu').open,false);
});

test('ACK atrasado no cierra una visita posterior al menú ni reenvía la acción',()=>{
  const f=fixture();f.receive(state());f.open();f.el('menuStartBtn').fire('click');const sent=f.commands().at(-1);
  f.el('menuCloseBtn').fire('click');f.open();f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true});
  assert.equal(f.el('mobileMenu').open,true);assert.equal(f.commands().length,1);
  f.receive(state({phase:'countdown',configurable:false}));assert.equal(f.el('mobileMenu').open,true);
});

test('reconectar necesita estado fresco antes de aceptar acciones y deja los mandos en neutro',()=>{
  const f=fixture();f.receive(state());f.open();f.el('menuStartBtn').fire('click');const sent=f.commands().at(-1);
  f.socket.receive({type:'host',online:false});f.socket.receive({type:'host',online:true});
  assert.equal(f.el('menuStartBtn').disabled,true,'la selección anterior no confirma el estado de la arena que volvió');
  f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true});assert.equal(f.el('mobileMenu').open,true,'se canceló al desconectar');
  f.el('menuStartBtn').fire('click');assert.equal(f.commands().length,1);
  f.receive(state());assert.equal(f.el('menuStartBtn').disabled,false);
  for(const [k,v]of Object.entries(neutral))assert.equal(f.controls().at(-1)[k],v);
});

test('estado encolado mientras no hay arena no habilita comandos cuando reaparece la conexión',()=>{
  const f=fixture();f.receive(state());f.open();f.socket.receive({type:'host',online:false});
  f.receive(state({experience:'precision'}));f.socket.receive({type:'host',online:true});
  assert.equal(f.el('menuStartBtn').disabled,true);f.el('menuStartBtn').fire('click');assert.equal(f.commands().length,0);
  f.receive(state({experience:'training'}));assert.equal(f.el('menuStartBtn').disabled,false);
  assert.equal(f.el('menuExperience').value,'training');
});

test('conexión perdida bloquea comandos y no reenvía acciones pendientes al reconectar',()=>{
  const f=fixture();f.receive(state());f.open();f.el('menuStartBtn').fire('click');assert.equal(f.commands().length,1);
  f.socket.receive({type:'host',online:false});f.el('menuResetBtn').fire('click');assert.equal(f.commands().length,1);assert.equal(f.el('menuStartBtn').disabled,true);
  f.socket.receive({type:'host',online:true});f.receive(state());assert.equal(f.commands().length,1);f.el('menuResetBtn').fire('click');assert.equal(f.commands().at(-1).command,'reset');
});

test('combate y escuela bloquean cambios mecánicos pero conservan opciones de presentación',()=>{
  const f=fixture();f.receive(state({phase:'fight',configurable:false,trainingEquipmentLocked:true,experience:'training'}));f.open();
  assert.equal(f.el('menuMode').disabled,true);assert.equal(f.el('menuWeapon1').disabled,true);assert.equal(f.el('menuDefense2').disabled,true);
  const before=f.commands().length;f.change('menuMode','versus');assert.equal(f.commands().length,before);f.change('menuQuality','ultra');assert.equal(f.commands().at(-1).command,'setQuality');
  assert.equal(f.el('menuStartBtn').disabled,true);assert.equal(f.el('menuReplayOpenBtn').disabled,true);assert.equal(f.el('menuCombatNotice').hidden,false);
});

test('replay usa id real, fracción/velocidad y controles según estado autoritativo',()=>{
  const f=fixture();f.receive(state());f.open();f.el('menuReplayClip').value='7';f.el('menuReplayOpenBtn').fire('click');assert.deepEqual(f.commands().at(-1).value,7);
  f.receive(state({replay:{clips:[{id:7,duration:2.8,complete:true}],active:true,paused:false,speed:.5,position:.25}}));
  f.change('menuReplaySeek','750');assert.equal(f.commands().at(-1).command,'replaySeek');assert.equal(f.commands().at(-1).value,.75);
  f.change('menuReplaySpeed','0.25');assert.equal(f.commands().at(-1).value,.25);
  f.el('menuReplayToggleBtn').fire('click');assert.equal(f.commands().at(-1).command,'replayToggle');f.el('menuReplayCloseBtn').fire('click');assert.equal(f.commands().at(-1).command,'replayClose');
});

test('avanzar, revancha y reinicio de campaña son peticiones explícitas al host',()=>{
  const f=fixture();f.receive(state({phase:'matchover',experience:'campaign',objective:{title:'Victoria',instruction:'Siguiente rival',progress:1,total:7,completed:false,nextAction:'advance'}}));f.open();
  for(const [id,command]of [['menuStartBtn','start'],['menuResetBtn','reset'],['menuNextBtn','nextEncounter'],['menuCampaignResetBtn','resetCampaign'],['menuReplayClearBtn','replayClear']]){
    f.el(id).fire('click');assert.equal(f.commands().at(-1).command,command);const m=f.commands().at(-1);assert.ok(normalizeMenuCommand(m),'el relay real debe aceptar la petición móvil');f.socket.receive({type:'command-result',requestId:m.requestId,ok:true,message:'OK'});
  }
  const cancel=f.el('mobileMenu').fire('cancel');assert.equal(cancel.defaultPrevented,true);assert.equal(f.el('mobileMenu').open,false);
});

test('catálogo local ofrece equipo real y mazo normaliza la mano secundaria',async()=>{
  const f=fixture();f.receive(state());f.open();await vm.runInContext('equipmentPromise',f.ctx);
  assert.deepEqual(f.el('menuWeapon1').children.map(e=>e.value),['sword','spear','axe','maul']);
  f.change('menuWeapon1','maul');const sent=f.commands().at(-1);assert.equal(sent.command,'setLoadout');assert.deepEqual(sent.value,{slot:1,weapon:'maul',defense:'none'});
  assert.equal(f.el('menuDefense1').disabled,true,'el segundo campo no debe reenviar el arma anterior mientras se confirma el cambio');
  f.receive(state({trainingEquipmentLocked:true,experience:'training'}));const n=f.commands().length;f.change('menuWeapon2','axe');assert.equal(f.commands().length,n);
});

test('ack ajeno no confirma acciones y timeout permite reintentar sin reenvío automático',()=>{
  const f=fixture();f.receive(state());f.open();f.el('menuStartBtn').fire('click');const sent=f.commands().at(-1);
  f.socket.receive({type:'command-result',requestId:sent.requestId+20,ok:true,message:'AJENO'});assert.equal(f.el('menuStartBtn').disabled,true);assert.doesNotMatch(f.el('menuFeedback').textContent,/AJENO/);
  for(const timeout of [...f.timers.values()])timeout();assert.equal(f.el('menuStartBtn').disabled,false);assert.equal(f.commands().length,1);
  f.el('menuStartBtn').fire('click');assert.equal(f.commands().length,2);assert.ok(f.commands()[1].requestId>sent.requestId);
});

test('ACK de equipo espera estado posterior aplicado antes de permitir una defensa con arma vieja',async()=>{
  const f=fixture();f.receive(state());f.open();await vm.runInContext('equipmentPromise',f.ctx);
  f.change('menuWeapon1','spear');const sent=f.commands().at(-1);
  f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true,message:'Equipo aplicado'});
  assert.equal(f.el('menuWeapon1').disabled,true);assert.equal(f.el('menuDefense1').disabled,true);
  f.change('menuDefense1','knife');assert.equal(f.commands().length,1,'ACK sin estado no habilita otra composición del mismo equipo');
  f.receive(state());assert.equal(f.el('menuDefense1').disabled,true,'un estado posterior pero incoherente tampoco confirma el equipo');
  const applied=state();applied.fighters[0].equipment={weapon:'spear',defense:'short'};f.receive(applied);
  assert.equal(f.el('menuDefense1').disabled,false);f.change('menuDefense1','knife');assert.deepEqual(f.commands().at(-1).value,{slot:1,weapon:'spear',defense:'knife'});
});

test('opciones disponibles siguen experiencia especial, combate y replay del host',()=>{
  const f=fixture();f.open();
  for(const experience of ['training','practice','precision','campaign']){
    f.receive(state({experience}));assert.equal(f.el('menuDifficulty').disabled,true,experience);assert.equal(f.el('menuBestOf').disabled,true,experience);
  }
  f.receive(state({phase:'fight',configurable:false}));assert.equal(f.el('menuCamera').disabled,true);
  f.receive(state({phase:'countdown',configurable:false}));assert.equal(f.el('menuCamera').disabled,true);
  f.receive(state({phase:'ready',replay:{clips:[],active:true,paused:true,speed:1,position:0},objective:{title:'Prueba',instruction:'Listo',progress:1,total:1,nextAction:'repeat'}}));
  assert.equal(f.el('menuStartBtn').disabled,true);assert.equal(f.el('menuNextBtn').disabled,true);assert.equal(f.el('menuCamera').disabled,false);
});

test('fallo de renderer se anuncia dentro y fuera del menú y desaparece al recuperarse',()=>{
  const f=fixture();f.receive(state());f.el('motionBtn').fire('click');const sensorWarning=f.el('warning').textContent;
  const message='<img src=x onerror=alert(1)> WebGL no disponible';f.receive(state({rendererError:message}));
  for(const id of ['rendererWarning','menuRendererWarning']){assert.equal(f.el(id).hidden,false);assert.equal(f.el(id).textContent,message);assert.equal(f.el(id).getAttribute('role'),'alert');}
  assert.equal(f.el('warning').textContent,sensorWarning,'la alerta gráfica no pisa la advertencia de credenciales/sensor');
  f.open();assert.equal(f.el('menuRendererWarning').hidden,false);f.receive(state());
  for(const id of ['rendererWarning','menuRendererWarning']){assert.equal(f.el(id).hidden,true);assert.equal(f.el(id).textContent,'');}
  assert.equal(f.el('warning').textContent,sensorWarning);
});

test('estado 3D móvil pasa de carga a listo sin spinner ni controles de PC y sin pisar otras advertencias',()=>{
  const f=fixture();f.receive(state());
  for(const id of ['assetsStatus','menuAssetsStatus'])assert.equal(f.el(id).hidden,true);
  f.el('motionBtn').fire('click');const warning=f.el('warning').textContent;
  f.receive(sanitizeMenuState(state({rendererError:'WebGL se está recuperando',assets:{loading:true,ready:2,total:7,
    names:['Taller','Muñeco menta'],errors:[],gpuBytesApprox:500}})));
  for(const id of ['assetsStatus','menuAssetsStatus']){
    assert.equal(f.el(id).hidden,false);assert.equal(f.el(id).getAttribute('role'),'status');
    assert.equal(f.el(id).dataset.state,'loading');assert.match(f.el(id).textContent,/Cargando.*3D/i);assert.match(f.el(id).textContent,/2.*7/);
  }
  assert.equal(f.el('warning').textContent,warning);assert.equal(f.el('rendererWarning').textContent,'WebGL se está recuperando');
  f.open();assert.equal(f.el('menuAssetsStatus').hidden,false);
  f.receive(sanitizeMenuState(state({assets:{loading:false,ready:7,total:7,names:['Taller','Muñecos'],errors:[],gpuBytesApprox:2000}})));
  for(const id of ['assetsStatus','menuAssetsStatus']){assert.equal(f.el(id).dataset.state,'ready');assert.match(f.el(id).textContent,/listos.*7.*7/i);}
  assert.equal(f.el('warning').textContent,warning);assert.equal(f.el('rendererWarning').hidden,true);
  f.receive(state());for(const id of ['assetsStatus','menuAssetsStatus']){assert.equal(f.el(id).hidden,true);assert.equal(f.el(id).textContent,'');}
});

test('incidencias de carga 3D se anuncian como texto literal separado, con rutas y secretos omitidos por DTO',()=>{
  const f=fixture();f.receive(state());const literal='<img src=x onerror=alert(1)> No se pudo cargar el muñeco';
  f.receive(sanitizeMenuState(state({assets:{loading:false,ready:3,total:4,names:['Taller'],
    errors:[literal,'Falló /assets/secret.glb token=private-token'],gpuBytesApprox:3000},rendererError:'Aviso de renderer'})));
  for(const id of ['assetsStatus','menuAssetsStatus']){
    const box=f.el(id);assert.equal(box.hidden,false);assert.equal(box.dataset.state,'error');assert.match(box.textContent,/incidencias.*3.*4/i);
    assert.ok(box.textContent.includes(literal));assert.doesNotMatch(box.textContent,/secret\.glb|private-token/);assert.equal(box.getAttribute('role'),'status');
  }
  assert.equal(f.el('rendererWarning').textContent,'Aviso de renderer');assert.equal(f.el('menuRendererWarning').textContent,'Aviso de renderer');
  assert.equal(f.commands().length,0,'el estado de carga no envía acciones ni altera configuración');
});

test('Defensa automática presenta sólo recurso/estado autoritativo y no ofrece guardia manual ni éxito inventado',()=>{
  const f=fixture();f.receive(state());assert.match(f.el('autoDefenseStatus').textContent,/GUARDIA.*70%/);
  const next=state();next.fighters[0].guardLabel='AGOTADA';next.fighters[0].guardPercent=12;f.receive(next);
  assert.match(f.el('autoDefenseStatus').textContent,/AGOTADA.*12%/);assert.doesNotMatch(f.el('autoDefenseStatus').textContent,/éxito|bloqueó|parada exitosa/i);
  assert.equal(f.elements.has('guardBtn'),false);assert.equal(f.elements.has('leanTrack'),false);
  assert.equal(f.controls().at(-1).guard,false);assert.equal(f.controls().at(-1).offX,0);assert.equal(f.controls().at(-1).offY,0);
});

test('resultado final es relativo a cada móvil: ganador sigue en verde y perdedor pide revancha en rojo',()=>{
  for(const [slot,scores,outcome,label]of [[1,[2,0],'win','SEGUIR'],[2,[2,0],'lose','REVANCHA'],[1,[1,2],'lose','REVANCHA'],[2,[1,2],'win','SEGUIR']]){
    const f=fixture(slot);f.receive(state({phase:'matchover',mode:'versus',scores}));
    assert.equal(f.el('matchResult').hidden,false);assert.equal(f.el('matchResult').dataset.outcome,outcome);
    assert.match(f.el('resultActionBtn').textContent,new RegExp(label));assert.equal(f.el('resultActionBtn').disabled,false);
    assert.equal(f.document.activeElement,f.el('resultActionBtn'));assert.equal(f.el('menuBtn').disabled,false);
  }
});

test('el resultado sólo cubre mandos al terminar la partida y neutraliza un gesto capturado',()=>{
  const f=fixture();f.receive(state());f.el('mainPad').fire('pointerdown',{pointerId:91,clientX:100,clientY:0});assert.equal(f.controls().at(-1).attackHeld,true);
  for(const phase of ['burst','countdown','fight']){f.receive(state({phase,mode:'versus',scores:[1,0]}));assert.equal(f.el('matchResult').hidden,true,phase);}
  f.receive(state({phase:'matchover',mode:'versus',scores:[2,0]}));assert.equal(f.el('mainPad').captures.size,0);assert.equal(f.el('playPads').inert,true);
  for(const [k,v]of Object.entries(neutral))assert.equal(f.controls().at(-1)[k],v);
  f.el('mainPad').fire('pointerdown',{pointerId:92,clientX:100,clientY:0});f.el('offPad').fire('keydown',{key:'ArrowRight'});
  assert.equal(f.controls().at(-1).attackHeld,false);assert.equal(f.controls().at(-1).lean,0);
});

test('seguir o revancha individual usa el siguiente encuentro autorizado y Versus usa start',()=>{
  for(const [mode,scores,nextAction,want]of [['solo',[2,0],'advance','nextEncounter'],['solo',[0,2],'retry','nextEncounter'],['versus',[2,0],null,'start'],['versus',[0,2],null,'start'],['solo',[2,0],null,'start']]){
    const f=fixture();f.receive(state({phase:'matchover',mode,scores,objective:{nextAction}}));f.el('resultActionBtn').fire('click');
    assert.equal(f.commands().length,1);assert.equal(f.commands()[0].command,want);assert.ok(normalizeMenuCommand(f.commands()[0]));
  }
});

test('empate no inventa victoria o derrota, y el móvil J2 no participa en una actividad individual',()=>{
  const f=fixture();f.receive(state({phase:'matchover',mode:'versus',scores:[2,2]}));
  assert.equal(f.el('matchResult').dataset.outcome,'draw');assert.match(f.el('resultTitle').textContent,/EMPATE/);assert.match(f.el('resultActionBtn').textContent,/REPETIR/);
  f.el('resultActionBtn').fire('click');assert.equal(f.commands()[0].command,'start');
  const spectator=fixture(2);spectator.receive(state({phase:'matchover',mode:'solo',scores:[0,2],objective:{nextAction:'retry'}}));
  assert.equal(spectator.el('matchResult').dataset.outcome,'observer');assert.equal(spectator.el('resultActionBtn').hidden,true);
  assert.match(spectator.el('resultMessage').textContent,/JUGADOR 1/i);spectator.el('resultActionBtn').fire('click');assert.equal(spectator.commands().length,0);
});

test('resultado pendiente espera su ACK, bloquea doble toque y no necesita abrir menú ni volver',()=>{
  const f=fixture();f.receive(state({phase:'matchover',mode:'versus',scores:[2,0]}));f.el('resultActionBtn').fire('click');const sent=f.commands()[0];
  assert.equal(f.el('matchResult').hidden,false);assert.equal(f.el('resultActionBtn').disabled,true);assert.equal(f.el('resultActionBtn').getAttribute('aria-busy'),'true');
  f.el('resultActionBtn').fire('click');assert.equal(f.commands().length,1);
  f.socket.receive({type:'command-result',requestId:sent.requestId+8,ok:true});assert.equal(f.el('matchResult').hidden,false);
  f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true});assert.equal(f.el('matchResult').hidden,true);assert.equal(f.el('mobileMenu').open,false);
  f.receive(state({phase:'matchover',mode:'versus',scores:[2,0]}));assert.equal(f.el('matchResult').hidden,true,'un paquete del mismo resultado no vuelve a ofrecer inicio');
  f.receive(state({phase:'countdown',mode:'versus',scores:[0,0],configurable:false}));assert.equal(f.el('playPads').inert,false);
  f.el('mainPad').fire('pointerdown',{pointerId:93,clientX:100,clientY:0});assert.equal(f.controls().at(-1).attackHeld,true);
});

test('rechazo, timeout y fallo de envío dejan resultado y reintento con explicación visible',()=>{
  for(const failure of ['reject','timeout','send']){
    const f=fixture();f.receive(state({phase:'matchover',scores:[0,2],objective:{nextAction:'retry'}}));
    if(failure==='send')f.socket.send=()=>{throw Error('cerrado');};
    f.el('resultActionBtn').fire('click');const sent=f.commands()[0];
    if(failure==='reject')f.socket.receive({type:'command-result',requestId:sent.requestId,ok:false,message:'El rival aún no está listo'});
    if(failure==='timeout')for(const timer of [...f.timers.values()])timer();
    assert.equal(f.el('matchResult').hidden,false,failure);assert.equal(f.el('resultActionBtn').disabled,false,failure);
    assert.equal(f.el('resultFeedback').hidden,false,failure);assert.equal(f.el('resultFeedback').classList.contains('error'),true,failure);
    assert.ok(f.el('resultFeedback').textContent.length>0,failure);
  }
});

test('otro jugador puede empezar y elimina el resultado; ACK viejo no descarta un resultado posterior',()=>{
  const f=fixture();f.receive(state({phase:'matchover',mode:'versus',scores:[2,0]}));f.el('resultActionBtn').fire('click');const sent=f.commands()[0];
  f.receive(state({phase:'countdown',mode:'versus',scores:[0,0],configurable:false}));assert.equal(f.el('matchResult').hidden,true);
  f.receive(state({phase:'matchover',mode:'versus',scores:[0,2]}));assert.equal(f.el('matchResult').dataset.outcome,'lose');
  f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true});assert.equal(f.el('matchResult').hidden,false);
  assert.equal(f.el('resultActionBtn').disabled,false);assert.equal(f.commands().length,1);
});

test('repetición activa no deja un resultado superpuesto sobre sus controles',()=>{
  const f=fixture();f.receive(state({phase:'matchover',scores:[2,0]}));assert.equal(f.el('matchResult').hidden,false);
  f.receive(state({phase:'matchover',scores:[2,0],replay:{active:true,paused:true,clips:[],position:0,speed:1}}));assert.equal(f.el('matchResult').hidden,true);
  f.receive(state({phase:'ready'}));assert.equal(f.el('matchResult').hidden,true);
});

test('resultado desconectado conserva contexto pero no ejecuta acciones hasta recibir estado fresco',()=>{
  const f=fixture();f.receive(state({phase:'matchover',scores:[0,2],objective:{nextAction:'retry'}}));f.el('resultActionBtn').fire('click');const sent=f.commands()[0];
  f.socket.receive({type:'host',online:false});assert.equal(f.el('matchResult').hidden,false);assert.equal(f.el('resultActionBtn').disabled,true);
  f.socket.receive({type:'host',online:true});assert.equal(f.el('resultActionBtn').disabled,true);
  f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true});assert.equal(f.el('matchResult').hidden,false);
  f.el('resultActionBtn').fire('click');assert.equal(f.commands().length,1);
  f.receive(state({phase:'matchover',scores:[0,2],objective:{nextAction:'retry'}}));assert.equal(f.el('resultActionBtn').disabled,false);
  f.receive(state({phase:'ready'}));assert.equal(f.el('matchResult').hidden,true);
});

test('menú sigue accesible sobre resultado y un ACK previo no cierra una nueva visita de ajustes',()=>{
  const f=fixture();f.receive(state({phase:'matchover',mode:'versus',scores:[2,0]}));f.el('resultActionBtn').fire('click');const sent=f.commands()[0];
  f.open();assert.equal(f.el('mobileMenu').open,true);f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true});
  assert.equal(f.el('mobileMenu').open,true);f.el('menuCloseBtn').fire('click');assert.equal(f.el('matchResult').hidden,true);
  assert.equal(f.commands().length,1);
});

test('revancha iniciada desde menú no vuelve a ofrecer el mismo resultado mientras llega la cuenta atrás',()=>{
  const f=fixture();f.receive(state({phase:'matchover',mode:'versus',scores:[2,0]}));f.open();f.el('menuStartBtn').fire('click');const sent=f.commands()[0];
  f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true});assert.equal(f.el('mobileMenu').open,false);assert.equal(f.el('matchResult').hidden,true);
  f.receive(state({phase:'matchover',mode:'versus',scores:[2,0]}));assert.equal(f.el('matchResult').hidden,true);
});

test('equipo del rival individual se presenta fijo por encuentro, pero Versus permite editar ambos',async()=>{
  const f=fixture();f.receive(state());f.open();await vm.runInContext('equipmentPromise',f.ctx);
  assert.equal(f.el('menuWeapon1').disabled,false);assert.equal(f.el('menuWeapon2').disabled,true);assert.equal(f.el('menuDefense2').disabled,true);
  assert.match(f.el('menuEquipmentNotice').textContent,/encuentro.*equipo del rival/i);
  const count=f.commands().length;f.change('menuWeapon2','axe');assert.equal(f.commands().length,count);
  f.receive(state({mode:'versus'}));assert.equal(f.el('menuWeapon2').disabled,false);assert.equal(f.el('menuDefense2').disabled,false);
});

test('actualizaciones del mismo resultado no roban foco ni capturan gestos nuevos',()=>{
  const f=fixture();f.receive(state({phase:'matchover',mode:'versus',scores:[2,0]}));f.el('menuBtn').focus();
  f.receive(state({phase:'matchover',mode:'versus',scores:[2,0],quality:'eco'}));assert.equal(f.document.activeElement,f.el('menuBtn'));
  assert.equal(f.commands().length,0);assert.equal(f.controls().at(-1).attackHeld,false);
  f.open();f.el('menuCloseBtn').fire('click');assert.equal(f.document.activeElement,f.el('resultActionBtn'));
});

test('carga bloquea comenzar y siguiente pero deja configurar o preparar sin cerrar menú',()=>{
  const f=fixture();f.receive(state({assets:{loading:true,ready:2,total:11},objective:{nextAction:'repeat'}}));f.open();
  assert.equal(f.el('menuStartBtn').disabled,true);assert.equal(f.el('menuNextBtn').disabled,true);assert.match(f.el('menuConfigNotice').textContent,/carg|prepar/i);
  f.el('menuStartBtn').fire('click');f.el('menuNextBtn').fire('click');assert.equal(f.commands().length,0);
  f.change('menuQuality','eco');assert.equal(f.commands()[0].command,'setQuality');
  assert.equal(f.el('menuResetBtn').disabled,false);assert.equal(f.el('mobileMenu').open,true);
});

test('resultado explica carga pendiente y habilita su acción cuando termina con fallback',()=>{
  const f=fixture();f.receive(state({phase:'matchover',scores:[2,0],objective:{nextAction:'advance'},assets:{loading:true,ready:0,total:11}}));
  assert.equal(f.el('resultActionBtn').disabled,true);assert.match(f.el('resultMessage').textContent,/carg|prepar/i);
  f.el('resultActionBtn').fire('click');assert.equal(f.commands().length,0);
  f.receive(state({phase:'matchover',scores:[2,0],objective:{nextAction:'advance'},assets:{loading:false,ready:0,total:11,errors:['Fallback local']}}));
  assert.equal(f.el('resultActionBtn').disabled,false);f.el('resultActionBtn').fire('click');assert.equal(f.commands()[0].command,'nextEncounter');
});

test('cargar escena neutraliza joysticks y no revive el gesto al terminar la carga',()=>{
  const f=fixture();f.receive(state());f.el('mainPad').fire('pointerdown',{pointerId:99,clientX:100,clientY:0});assert.equal(f.controls().at(-1).attackHeld,true);
  f.receive(state({assets:{loading:true,ready:0,total:11}}));assert.equal(f.el('mainPad').captures.size,0);assert.equal(f.controls().at(-1).attackHeld,false);
  f.el('mainPad').fire('pointerdown',{pointerId:100,clientX:100,clientY:0});assert.equal(f.controls().at(-1).attackHeld,false);
  f.receive(state({assets:{loading:false,ready:11,total:11}}));f.el('mainPad').fire('pointermove',{pointerId:99,clientX:100,clientY:0});assert.equal(f.controls().at(-1).attackHeld,false);
});

test('renderer fatal bloquea iniciar y resultado; una advertencia de fallback no lo hace',()=>{
  const f=fixture();f.receive(state({rendererError:'WebGL perdido'}));f.open();assert.equal(f.el('menuStartBtn').disabled,true);
  f.el('menuCloseBtn').fire('click');f.receive(state({phase:'matchover',scores:[2,0],rendererError:'WebGL perdido'}));assert.equal(f.el('resultActionBtn').disabled,true);
  f.receive(state({phase:'matchover',scores:[2,0],assets:{loading:false,total:11,ready:10,errors:['Modelo procedural']}}));assert.equal(f.el('resultActionBtn').disabled,false);
});

test('fluidez móvil: fixed primero y adaptación experimental explícita sin promesa FPS',()=>{
  assert.match(markup,/<label>Fluidez<select id="menuPerformanceMode" aria-describedby="menuPerformanceHelp">/);
  assert.match(markup,/<option value="fixed">Calidad fija<\/option><option value="adaptive">Adaptativa experimental<\/option>/);
  assert.match(markup,/id="menuPerformanceHelp"[^>]*>[\s\S]*?detalle[\s\S]*?resolución[\s\S]*?carga/);
  assert.doesNotMatch(markup.match(/id="menuPerformanceHelp"[^>]*>([\s\S]*?)<\/p>/)[1],/60|FPS|garanti/i);
  const f=fixture();f.receive(sanitizeMenuState(state()));f.open();assert.equal(f.el('menuPerformanceMode').value,'fixed');assert.equal(f.el('menuPerformanceMode').disabled,false);
});

test('fluidez móvil: ACK espera menu-state posterior aplicado y no cambia quality ni reenvía',()=>{
  const f=fixture();f.receive(state({performanceMode:'fixed'}));f.open();f.change('menuPerformanceMode','adaptive');
  const sent=f.commands().at(-1);assert.equal(sent.command,'setPerformanceMode');assert.equal(sent.value,'adaptive');assert.deepEqual(normalizeMenuCommand(sent),{requestId:sent.requestId,sentAt:sent.sentAt,command:'setPerformanceMode',value:'adaptive'});
  assert.equal(f.el('menuPerformanceMode').disabled,true);assert.equal(f.el('menuQuality').value,'high');
  f.socket.receive({type:'command-result',requestId:sent.requestId,ok:true,message:'Fluidez aplicada'});assert.equal(f.el('menuPerformanceMode').disabled,true);
  f.receive(sanitizeMenuState(state()));assert.equal(f.el('menuPerformanceMode').disabled,true);
  f.receive(state({performanceMode:'adaptive'}));assert.equal(f.el('menuPerformanceMode').disabled,false);assert.equal(f.el('menuPerformanceMode').value,'adaptive');assert.equal(f.el('menuQuality').value,'high');assert.equal(f.commands().length,1);assert.match(f.el('menuFeedback').textContent,/Fluidez aplicada/);
});

test('fluidez móvil: estado anterior al ACK no confirma y rechazo restaura selección autoritativa',()=>{
  const f=fixture();f.receive(state({performanceMode:'adaptive'}));f.open();f.change('menuPerformanceMode','fixed');const first=f.commands().at(-1);
  f.receive(state({performanceMode:'fixed'}));f.socket.receive({type:'command-result',requestId:first.requestId,ok:true});assert.equal(f.el('menuPerformanceMode').disabled,true);
  f.receive(state({performanceMode:'fixed'}));assert.equal(f.el('menuPerformanceMode').disabled,false);
  f.change('menuPerformanceMode','adaptive');const second=f.commands().at(-1);f.socket.receive({type:'command-result',requestId:second.requestId,ok:false,message:'Arena no disponible'});
  assert.equal(f.el('menuPerformanceMode').value,'fixed');assert.equal(f.el('menuPerformanceMode').disabled,false);assert.match(f.el('menuFeedback').textContent,/Arena no disponible/);
  const before=f.commands().length;f.change('menuPerformanceMode','fastest');assert.equal(f.commands().length,before);assert.equal(f.el('menuPerformanceMode').value,'fixed');
});

test('fluidez móvil: cambio visual durante combate no desbloquea opciones mecánicas',()=>{
  const f=fixture();f.receive(state({phase:'fight',configurable:false,performanceMode:'adaptive'}));f.open();
  assert.equal(f.el('menuPerformanceMode').disabled,false);assert.equal(f.el('menuMode').disabled,true);assert.equal(f.el('menuStartBtn').disabled,true);
  f.change('menuPerformanceMode','fixed');assert.equal(f.commands().at(-1).command,'setPerformanceMode');assert.equal(f.el('menuMode').disabled,true);assert.equal(f.el('menuStartBtn').disabled,true);
});
