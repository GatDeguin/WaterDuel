import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {STEP,neutral} from '../public/engine.js';
import {HostSession} from '../public/host-session.js';
import {RemoteInputBuffer,isFreshRemoteInput} from '../public/remote-input.js';
import {FrameMetrics} from '../public/performance.js';
import {AdaptiveQuality} from '../public/adaptive-quality.js';
import {captureReplayState} from '../public/replay.js';

async function until(predicate,timeout=3500){
  const deadline=Date.now()+timeout;
  do{const value=predicate();if(value)return value;await delay(10);}while(Date.now()<deadline);
  throw Error('No se completó la operación del host dentro del plazo.');
}
function events(){
  const handlers=new Map();
  return {addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);},
    emit(type,value={}){for(const handler of handlers.get(type)??[])handler({preventDefault(){},...value});}};
}

/** Real HTTP/WS and HostSession. Only canvas/audio are stubs; RAF and host wall time are controlled. */
async function runtime(t,{qrFails=false,initialLoading=false,allowRendererError=false}={}){
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const base=`http://127.0.0.1:${port}`,child=spawn(process.execPath,['server.mjs'],{
    cwd:new URL('..',import.meta.url),stdio:'ignore',env:{...process.env,HTTPS:'0',HOST:'127.0.0.1',PORT:String(port),PUBLIC_URL:base},
  });
  const state={host:null,sockets:[],sent:[],received:[],renders:[],engineEvents:[],held:[],holdCommands:false,wallShift:0,now:0,
    audio:null,audioEvents:[],audioUpdates:[],audioPauses:[],audioUnlocks:[],legacyTones:[],qrUpdates:[],qrHides:0,sessionFetches:0,qrWarnings:0,rendererErrors:[]};
  const timers=new Set(),pads=[],raf=[],window=events(),canvas=events(),document={...events(),hidden:false,
    getElementById(id){if(id==='joinCodes')return null;assert.equal(id,'gameCanvas','El runtime PC sólo busca su canvas y las dos invitaciones.');return canvas;}};
  let stopped=false;
  const storage=new Map();window.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  class HostProbe extends HostSession{
    constructor(options){super({...options,onEvent:(name,data)=>{state.engineEvents.push({name,data});options.onEvent(name,data);}});state.host=this;this.updateCalls=0;}
    update(dt){this.updateCalls++;super.update(dt);}
  }
  class RendererStub{
    constructor(){this.waterSurfaces=new Map();this.stats={camera:null};}
    loadAssets(onStatus){state.onAssets=onStatus;if(initialLoading)onStatus({loading:true,ready:0,total:11,names:[],errors:[],gpuBytesApprox:0});}
    render(scene,time,profile){const camera={eye:[time,2,10],target:[0,1.9,0]};this.stats.camera=camera;state.renders.push({scene,time,profile,camera});}
    dispose(){}
  }
  class AudioStub{
    constructor(){state.audio=this;this.paused=false;}
    configure(){}unlock(){state.audioUnlocks.push({paused:this.paused,at:state.now});}
    tone(...args){state.legacyTones.push(args);}
    handleEvent(name,data,game){state.audioEvents.push({name,data,game});}
    update(game,options){state.audioUpdates.push({game,options,clock:game.clock,updateCalls:state.host?.updateCalls});}
    setPaused(paused){this.paused=paused;state.audioPauses.push({paused,at:state.now});}
  }
  class HostDate extends Date{static now(){return Date.now()+state.wallShift;}}
  class QRStub{
    constructor(root,options){state.qrOptions=options;}
    setSession(value,offset){state.qrUpdates.push({slots:Object.keys(value.links??{}),expiresAt:value.expiresAt,offset});if(qrFails)throw new TypeError('QR fixture failure');}
    hide(){state.qrHides++;}
  }
  class ObservedWebSocket{
    static OPEN=WebSocket.OPEN;static CONNECTING=WebSocket.CONNECTING;
    constructor(url){
      this.native=new WebSocket(url);state.sockets.push(this);
      this.native.addEventListener('open',event=>this.onopen?.(event));
      this.native.addEventListener('error',event=>this.onerror?.(event));
      this.native.addEventListener('close',event=>this.onclose?.(event));
      this.native.addEventListener('message',event=>{
        const message=JSON.parse(event.data);state.received.push(message);
        if(state.holdCommands&&message.type==='command')state.held.push(()=>this.onmessage?.(event));
        else this.onmessage?.(event);
      });
    }
    get readyState(){return this.native.readyState;}
    send(data){state.sent.push(JSON.parse(data));this.native.send(data);}
    close(){this.native.close();}
  }
  t.after(async()=>{
    stopped=true;for(const timer of timers)clearTimeout(timer);
    for(const pad of pads)pad.socket.close();for(const socket of state.sockets)socket.close();
    const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await Promise.race([exit,delay(800)]);
  });
  let session;
  for(let attempt=0;attempt<100;attempt++){
    try{const response=await fetch(base+'/api/session');if(response.ok){session=await response.json();break;}}catch{}
    await delay(20);
  }
  assert.ok(session,'Arranca un servidor local aislado sin reutilizar la autoridad del juego abierto.');
  const source=await readFile(new URL('../public/game.js',import.meta.url),'utf8');
  const imports=source.match(/^import[^\n]+;\s*$/gm)??[];assert.ok(imports.length>=6);
  // Evaluate the current production entry point, injecting its imported objects.
  // This is not a copied implementation of the message handler or frame loop.
  vm.runInNewContext(source.replace(/^import[^\n]+;\s*$/gm,''),{
    STEP,neutral,Renderer3D:RendererStub,HostSession:HostProbe,RemoteInputBuffer,isFreshRemoteInput,FrameMetrics,AdaptiveQuality,GameAudio:AudioStub,HostQRCodes:QRStub,
    document,window,location:{protocol:'http:',host:`127.0.0.1:${port}`},WebSocket:ObservedWebSocket,Date:HostDate,AbortSignal,
    performance:{now:()=>state.now},console:{error:error=>{if(allowRendererError)state.rendererErrors.push(error);else throw error;},warn:()=>state.qrWarnings++},
    fetch:(url,options)=>{if(url==='/api/session')state.sessionFetches++;return fetch(new URL(url,base),options);},requestAnimationFrame:callback=>raf.push(callback),
    setTimeout:(fn,ms)=>{if(stopped)return 0;const timer=setTimeout(()=>{timers.delete(timer);if(!stopped)fn();},ms);timers.add(timer);return timer;},
    clearTimeout:timer=>{timers.delete(timer);clearTimeout(timer);},
  },{filename:'public/game.js'});
  await until(()=>state.sent.some(message=>message.type==='menu-state'));
  const socket=new WebSocket(base.replace('http:','ws:')+'/ws'),messages=[];
  socket.addEventListener('message',event=>messages.push(JSON.parse(event.data)));
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.send(JSON.stringify({type:'hello',role:'controller',slot:1,key:new URL(session.links[1]).searchParams.get('key')}));
  await until(()=>messages.find(message=>message.type==='welcome'));let requestId=0;
  const pad={socket,messages,send:message=>socket.send(JSON.stringify(message)),
    command(name,value){const id=++requestId;socket.send(JSON.stringify({type:'command',requestId:id,sentAt:Date.now(),command:name,...(value===undefined?{}:{value})}));return id;},
    result:id=>until(()=>messages.find(message=>message.type==='command-result'&&message.requestId===id)),
  };pads.push(pad);
  return {state,pad,window,document,canvas,assets:status=>state.onAssets(status),advance(frames=1,frameMs=1000/60){for(let index=0;index<frames;index++){
    const callback=raf.shift();assert.equal(typeof callback,'function');state.now+=frameMs;callback(state.now);
  }},deliverCommands(){const held=state.held.splice(0);for(const deliver of held)deliver();}};
}

test('mobile performance mode changes only the render policy; blur and replay gates preserve the host loop',async t=>{
  const r=await runtime(t),h=r.state.host;
  r.advance();assert.equal(r.state.renders.at(-1).profile.mode,'fixed');
  const before=h.updateCalls,id=r.pad.command('setPerformanceMode','fixed');
  assert.equal((await r.pad.result(id)).ok,true);assert.equal(h.updateCalls,before);
  assert.equal(h.game.quality,'high');r.advance();assert.equal(r.state.renders.at(-1).profile.mode,'fixed');
  const next=r.pad.command('setPerformanceMode','adaptive');assert.equal((await r.pad.result(next)).ok,true);
  r.window.emit('blur');const beforeBlur=h.updateCalls;r.advance();
  assert.ok(h.updateCalls>beforeBlur,'visible LAN arena continues with controls neutralized');
  assert.equal(r.state.renders.at(-1).profile.mode,'adaptive');
  r.document.hidden=true;r.document.emit('visibilitychange');r.advance();
  assert.equal(r.state.renders.at(-1).profile.mode,'fixed');
});

test('RAF no consume carga inicial ni conserva entradas ocultas y acepta comenzar sólo al terminar',async t=>{
  const r=await runtime(t,{initialLoading:true}),{state,pad}=r,h=state.host;
  pad.send({type:'control',seq:1,sentAt:Date.now(),mainX:1,thrust:true});
  await until(()=>state.received.find(message=>message.type==='control'&&message.seq===1));
  r.window.emit('keydown',{code:'Space',repeat:false});r.advance(8);
  assert.equal(h.updateCalls,0);assert.equal(h.game.clock,0);assert.deepEqual(h.game.fighters[0].controller,neutral());
  assert.equal(state.audioUpdates.at(-1).options.paused,true);
  const refused=pad.command('start');assert.equal((await pad.result(refused)).ok,false);assert.equal(h.game.phase,'ready');
  r.assets({loading:false,ready:10,total:11,names:[],errors:['Fallback procedural'],gpuBytesApprox:0});
  r.advance(1);assert.ok(h.game.clock>0&&h.game.clock<.04,'no recupera los cuadros consumidos por carga');
  assert.deepEqual(h.game.fighters[0].controller,neutral());assert.equal(state.audioUpdates.at(-1).options.paused,false);
  const start=pad.command('start');assert.equal((await pad.result(start)).ok,true);assert.equal(h.game.phase,'countdown');
});

test('recarga y renderer nulo congelan cuenta atrás antes de RAF y retoman con entradas neutras',async t=>{
  const r=await runtime(t,{allowRendererError:true}),{state,pad}=r,h=state.host;
  const id=pad.command('start');assert.equal((await pad.result(id)).ok,true);r.advance(2);
  const before={clock:h.game.clock,phaseClock:h.game.phaseClock,updates:h.updateCalls};
  r.assets({loading:true,ready:0,total:11,names:[],errors:[]});r.window.emit('keydown',{code:'Space',repeat:false});r.advance(10);
  assert.deepEqual({clock:h.game.clock,phaseClock:h.game.phaseClock,updates:h.updateCalls},before);
  assert.deepEqual(h.game.fighters[0].controller,neutral());
  r.canvas.emit('webglcontextlost');r.advance(4);assert.equal(state.rendererErrors.length,1);
  assert.deepEqual({clock:h.game.clock,phaseClock:h.game.phaseClock,updates:h.updateCalls},before);
  r.canvas.emit('webglcontextrestored');r.assets({loading:false,ready:11,total:11,names:[],errors:[]});r.advance(1);
  assert.ok(h.game.clock>before.clock&&h.game.clock-before.clock<.04);assert.deepEqual(h.game.fighters[0].controller,neutral());
});

test('game.js real recibe menú autenticado, aplica fases, responde relayId y publica DTO; neutralize borra el pulso antes de RAF',async t=>{
  const r=await runtime(t),{state,pad}=r,h=state.host;
  let id=pad.command('setMode','versus');assert.equal((await pad.result(id)).ok,true);assert.equal(h.game.mode,'versus');
  const envelope=state.sent.find(message=>message.type==='command-result'&&message.requestId===id);
  assert.equal(envelope.slot,1);assert.ok(Number.isSafeInteger(envelope.relayId)&&envelope.relayId>0);
  id=pad.command('setBestOf',5);assert.equal((await pad.result(id)).ok,true);
  await until(()=>pad.messages.find(message=>message.type==='menu-state'&&message.state.mode==='versus'&&message.state.bestOf===5));
  id=pad.command('start');assert.equal((await pad.result(id)).ok,true);assert.equal(h.game.phase,'countdown');
  id=pad.command('setBestOf',3);assert.equal((await pad.result(id)).ok,false);assert.equal(h.game.bestOf,5);
  pad.send({type:'control',seq:1,sentAt:Date.now(),mainX:1,thrust:true});
  await until(()=>state.received.find(message=>message.type==='control'&&message.seq===1));
  pad.send({type:'control',seq:2,sentAt:Date.now(),neutralize:true,mainX:1,thrust:true});
  await until(()=>state.received.find(message=>message.type==='control'&&message.seq===2));
  r.advance(1,STEP*1000+.001);assert.deepEqual(h.game.fighters[0].controller,neutral());
  assert.equal(state.engineEvents.some(event=>event.name==='thrust'),false);
  assert.ok(h.updateCalls>0);assert.ok(h.game.clock>0);
  pad.send({type:'control',seq:3,sentAt:Date.now(),mainX:.7,thrust:true});
  await until(()=>state.received.find(message=>message.type==='control'&&message.seq===3));r.advance(1,STEP*1000+.001);
  assert.equal(h.game.fighters[0].controller.thrust,true,'Una secuencia nueva conserva su pulso legítimo.');
  assert.equal(h.game.fighters[0].controller.mainX,.7);
});

test('game.js vuelve a comprobar edad tras el relay; una entrega demorada o reloj adelantado no cambia reglas',async t=>{
  const r=await runtime(t),{state,pad}=r,h=state.host;state.holdCommands=true;
  let id=pad.command('setBestOf',5);await until(()=>state.held.length===1);
  state.wallShift=3000;r.deliverCommands();assert.equal((await pad.result(id)).ok,false);assert.equal(h.game.bestOf,3);
  state.wallShift=0;id=pad.command('setArena','dojo');await until(()=>state.held.length===1);
  state.wallShift=-1500;r.deliverCommands();assert.equal((await pad.result(id)).ok,false);assert.equal(h.game.arena,'atelier');
  state.wallShift=0;state.holdCommands=false;id=pad.command('setBestOf',5);
  assert.equal((await pad.result(id)).ok,true);assert.equal(h.game.bestOf,5);
});

test('RAF presenta replay y escena sin avanzar simulación, grabación o progreso; perder autoridad también congela y neutraliza',async t=>{
  const r=await runtime(t),{state,pad}=r,h=state.host;r.advance(2);
  // A static visual fixture isolates transport/RAF pause. It does not certify a
  // physical hit; contact provenance is exercised in host-session.test.mjs.
  const first=captureReplayState(h.game),last=captureReplayState(h.game);first.time=0;last.time=1;
  const clip={id:1001,frames:[first,last],startTime:0,endTime:1,duration:1,complete:true};
  Object.defineProperty(h.recorder,'clips',{configurable:true,get:()=>[clip]});
  let pauses=state.audioPauses.length;
  let id=pad.command('replayOpen',clip.id);assert.equal((await pad.result(id)).ok,true);assert.ok(h.playback);
  assert.ok(state.audioPauses.length>pauses,'Abrir replay detiene audio antes del próximo RAF.');
  assert.equal(state.audioPauses.at(-1).paused,true);
  const frozen=()=>JSON.stringify({clock:h.game.clock,elapsed:h.game.elapsed,phaseClock:h.game.phaseClock,scores:h.game.scores,
    poses:h.game.fighters.map(f=>f.pose),bytes:h.recorder.bytes,progress:h.individual.objectiveIndex});
  const before=frozen(),updates=h.updateCalls,renders=state.renders.length;
  pad.send({type:'control',seq:1,sentAt:Date.now(),mainX:1,thrust:true});
  await until(()=>state.received.find(message=>message.type==='control'&&message.seq===1));r.advance(8);
  assert.equal(h.updateCalls,updates);assert.equal(frozen(),before);assert.ok(state.renders.length>renders);
  assert.equal(state.renders.at(-1).scene.replay,true);assert.ok(h.playback.time>0);
  assert.equal(state.audioUpdates.at(-1).game,h.game,'El audio usa el juego autoritativo incluso mientras se presenta una vista de replay.');
  assert.equal(state.audioUpdates.at(-1).options.paused,true);
  pauses=state.audioPauses.length;
  id=pad.command('replayClose');assert.equal((await pad.result(id)).ok,true);
  assert.ok(state.audioPauses.length>pauses);assert.equal(state.audioPauses.at(-1).paused,false);
  delete h.recorder.clips;r.advance();
  assert.equal(h.playback,null);assert.deepEqual(h.game.fighters[0].controller,neutral());assert.ok(h.updateCalls>updates);
  pauses=state.audioPauses.length;const beforeDisconnectRenders=state.renders.length;
  state.sockets[0].close();await until(()=>state.sockets[0].readyState===WebSocket.CLOSED);
  await delay(10);const disconnected=frozen(),stoppedUpdates=h.updateCalls;
  assert.equal(state.renders.length,beforeDisconnectRenders,'La pérdida de autoridad se procesa antes de otro RAF.');
  assert.ok(state.audioPauses.length>pauses,'Cerrar socket detiene audio de inmediato.');
  assert.equal(state.audioPauses.at(-1).paused,true);
  r.window.emit('keydown',{code:'Space',repeat:false});r.advance(12);
  assert.equal(h.updateCalls,stoppedUpdates);assert.equal(frozen(),disconnected);
  assert.deepEqual(h.game.fighters[0].controller,neutral());
  assert.equal(state.audioUpdates.at(-1).game,h.game);assert.equal(state.audioUpdates.at(-1).options.paused,true);
});

test('Un evento real de comienzo llega una sola vez al audio nuevo; update recibe el juego autoritativo después de simular',async t=>{
  const r=await runtime(t),{state,pad}=r,h=state.host;
  const before=state.audioEvents.length,id=pad.command('start');assert.equal((await pad.result(id)).ok,true);
  const starts=state.engineEvents.filter(event=>event.name==='start');assert.equal(starts.length,1);
  const played=state.audioEvents.slice(before);assert.equal(played.length,1);
  assert.equal(played[0].name,'start');assert.equal(played[0].data,starts[0].data);assert.equal(played[0].game,h.game);
  assert.deepEqual(state.legacyTones,[],'El hook anterior tone no duplica el mismo evento.');
  assert.equal(state.audioUpdates.length,0);r.advance(1,STEP*1000+.001);
  assert.equal(state.audioUpdates.length,1);const audio=state.audioUpdates[0];
  assert.equal(audio.game,h.game);assert.equal(audio.options.paused,false);
  assert.ok(Number.isFinite(audio.options.dt)&&audio.options.dt>0&&audio.options.dt<=.085);
  assert.ok(audio.updateCalls>0);assert.equal(audio.updateCalls,h.updateCalls);assert.equal(audio.clock,h.game.clock);assert.ok(audio.clock>0);
  assert.equal(audio.options.camera,state.renders.at(-1).camera,'El oyente recibe la cámara presentada en este mismo cuadro, no la anterior.');
});
test('El sobre háptico identifica al perdedor del pinchazo y a ambos en empate, sin confundirlo con el ganador',async t=>{
  const {state}=await runtime(t),game=state.host.game;
  // Exercise routing of the engine event contract; this test does not simulate
  // or claim a physical puncture. Collision is covered by the engine fixtures.
  for(const [data,slot]of [[{winner:1,loser:2,draw:false},2],[{winner:2,loser:1,draw:false},1],[{winner:0,loser:0,draw:true},0]]){
    game.onEvent('burst',data);
    assert.equal(state.sent.filter(message=>message.type==='event'&&message.name==='burst').at(-1).slot,slot);
  }
  for(const name of ['joint-damage','joint-break'])for(const slot of [1,2]){
    const data={slot,joint:'mainElbow',damage:.65,amount:.15,contact:true,at:{x:0,y:2,z:.17}};
    game.onEvent(name,data);
    assert.equal(state.sent.filter(message=>message.type==='event'&&message.name===name).at(-1).slot,slot);
    const sound=state.audioEvents.at(-1);assert.equal(sound.name,'material-contact');assert.equal(sound.data.jointEvent,name);
    assert.equal(sound.data.slot,slot);assert.equal(Object.hasOwn(data,'jointEvent'),false);
  }
});

test('Ocultar o restaurar la pestaña actualiza pausa de audio sin esperar un RAF',async t=>{
  const r=await runtime(t),{state,document}=r,h=state.host;r.advance();
  let pauses=state.audioPauses.length;const renders=state.renders.length,clock=h.game.clock;
  document.hidden=true;document.emit('visibilitychange');
  assert.equal(state.renders.length,renders);assert.equal(h.game.clock,clock);
  assert.ok(state.audioPauses.length>pauses,'visibilitychange silencia audio incluso si el navegador detiene RAF.');
  assert.equal(state.audioPauses.at(-1).paused,true);
  r.advance();assert.equal(h.game.clock,clock);assert.equal(state.audioUpdates.at(-1).options.paused,true);
  pauses=state.audioPauses.length;const updates=h.updateCalls;
  document.hidden=false;document.emit('visibilitychange');
  assert.equal(h.updateCalls,updates);assert.ok(state.audioPauses.length>pauses);assert.equal(state.audioPauses.at(-1).paused,false);
  r.advance();assert.equal(state.audioUpdates.at(-1).options.paused,false);assert.ok(h.game.clock>clock);
});

test('Recuperar autoridad actualiza pausa antes del primer gesto y sin esperar RAF',async t=>{
  const r=await runtime(t),{state,window}=r;r.advance();
  state.sockets[0].close();
  await until(()=>state.sockets[0].readyState===WebSocket.CLOSED&&state.audio.paused);
  const renders=state.renders.length;
  await until(()=>state.received.filter(message=>message.type==='welcome').length===2);
  assert.equal(state.renders.length,renders,'La reconexión se verifica antes de ejecutar otro RAF.');
  window.emit('keydown',{code:'KeyW',repeat:false});
  assert.equal(state.audioUnlocks.at(-1).paused,false,'El primer gesto ve el audio despausado.');
  assert.equal(state.audioPauses.at(-1).paused,false);
});

test('Recuperar autoridad con pestaña oculta conserva silencio antes de RAF',async t=>{
  const r=await runtime(t),{state,document}=r;r.advance();document.hidden=true;document.emit('visibilitychange');
  state.sockets[0].close();await until(()=>state.sockets[0].readyState===WebSocket.CLOSED);
  const renders=state.renders.length;
  await until(()=>state.received.filter(message=>message.type==='welcome').length===2);
  assert.equal(state.renders.length,renders);assert.equal(state.audio.paused,true);
  assert.equal(state.audioPauses.at(-1).paused,true);
});

test('Los QR reciben las dos invitaciones, se ocultan al perder conexión y se renuevan redescubriendo la sesión',async t=>{
  const {state}=await runtime(t);
  assert.deepEqual(state.qrUpdates.at(-1).slots,['1','2']);assert.ok(Number.isFinite(state.qrUpdates.at(-1).expiresAt));
  const hides=state.qrHides,fetches=state.sessionFetches,updates=state.qrUpdates.length;
  state.sockets[0].close();await until(()=>state.qrHides>hides);
  await until(()=>state.received.filter(message=>message.type==='welcome').length===2);
  assert.ok(state.sessionFetches>fetches,'La reconexión consulta invitaciones actuales antes de usar otra vez sus claves.');
  assert.ok(state.qrUpdates.length>updates);assert.deepEqual(state.qrUpdates.at(-1).slots,['1','2']);
  const refreshes=state.sessionFetches;state.qrOptions.onExpired();
  await until(()=>state.sessionFetches>refreshes);assert.equal(state.host.game.phase,'ready');
});

test('Un fallo de presentación QR no bloquea la autoridad, el inicio móvil ni la simulación',async t=>{
  const r=await runtime(t,{qrFails:true}),{state,pad}=r;
  assert.ok(state.qrWarnings>0);assert.ok(state.qrHides>0);
  assert.ok(state.received.some(message=>message.type==='welcome'));
  const id=pad.command('start');assert.equal((await pad.result(id)).ok,true);r.advance();
  assert.equal(state.host.game.phase,'countdown');assert.ok(state.host.updateCalls>0);
});

test('El relay conserva extensión, retirada y cabeza, sin estocadas temporizadas, y soltar neutraliza',async t=>{
  const r=await runtime(t),{state,pad}=r,h=state.host;
  for(const [name,value] of [['setMode','versus'],['setLoadout',{slot:1,weapon:'sword',defense:'none'}],['setLoadout',{slot:2,weapon:'sword',defense:'none'}],['start',undefined]]){
    const id=pad.command(name,value);assert.equal((await pad.result(id)).ok,true);
  }
  r.advance(195);assert.equal(h.game.phase,'fight');
  let minimumExtension=Infinity,minimumHeld=Infinity;
  for(let seq=1;seq<=8;seq++){
    pad.send({type:'control',seq,sentAt:Date.now(),mainX:1,mainY:-1,attackHeld:true,headX:2,headZ:-.3});
    await until(()=>state.received.some(message=>message.type==='control'&&message.seq===seq));r.advance(10);
    const f=h.game.fighters[0],p=f.pose;
    minimumHeld=Math.min(minimumHeld,f.lunge);
    minimumExtension=Math.min(minimumExtension,Math.hypot(p.tip.x-p.mainHand.x,p.tip.y-p.mainHand.y,(p.tip.z??0)-(p.mainHand.z??0)));
  }
  const input=state.received.find(message=>message.type==='control'&&message.seq===8);
  assert.equal(input.attackHeld,true);assert.equal(input.axes.headX,1);assert.equal(input.axes.headZ,-.3);
  assert.equal(h.game.fighters[0].controller.attackHeld,true);assert.equal(h.game.fighters[0].controller.headX,1);
  assert.ok(minimumHeld>.8,'la extensión sostenida no reinicia ciclos mientras el nivel sigue activo');
  assert.ok(minimumExtension>1.1,'la hoja real se extiende desde su mano, no sólo una bandera de red');
  const attacks=state.engineEvents.filter(event=>event.name==='thrust'&&event.data.slot===1).length;assert.equal(attacks,0,'sostener el joystick no fabrica pulsos de estocada');
  for(let seq=9;seq<=16;seq++){
    pad.send({type:'control',seq,sentAt:Date.now(),mainX:-1,mainY:0,attackHeld:true,headX:2,headZ:-.3});
    await until(()=>state.received.some(message=>message.type==='control'&&message.seq===seq));r.advance(10);
  }
  const collected=h.game.fighters[0],collectedPose=collected.pose;
  const collectedLength=Math.hypot(collectedPose.tip.x-collectedPose.mainHand.x,collectedPose.tip.y-collectedPose.mainHand.y,(collectedPose.tip.z??0)-(collectedPose.mainHand.z??0));
  assert.equal(collected.controller.attackHeld,true,'el relay conserva el nivel del gesto durante la retirada');
  assert.equal(collected.controller.mainX,-1);assert.equal(collected.controller.headX,1);assert.equal(collected.controller.headZ,-.3);
  assert.ok(collected.lunge<.01,'el gesto hacia atrás recibido por red elimina la extensión sostenida');
  assert.ok(collectedLength<minimumExtension-.1,'la retirada recibida por red recoge físicamente la hoja');
  assert.equal(state.engineEvents.filter(event=>event.name==='thrust'&&event.data.slot===1).length,attacks);
  pad.send({type:'control',seq:17,sentAt:Date.now(),neutralize:true,attackHeld:true,headX:1,headZ:1});
  await until(()=>state.received.some(message=>message.type==='control'&&message.seq===17));r.advance(45);
  const released=state.received.find(message=>message.type==='control'&&message.seq===17);
  assert.equal(released.attackHeld,undefined);assert.equal(released.axes.headX,undefined);
  assert.deepEqual(h.game.fighters[0].controller,neutral());
  assert.equal(state.engineEvents.filter(event=>event.name==='thrust'&&event.data.slot===1).length,attacks);
  const f=h.game.fighters[0],p=f.pose,retracted=Math.hypot(p.tip.x-p.mainHand.x,p.tip.y-p.mainHand.y,(p.tip.z??0)-(p.mainHand.z??0));
  assert.ok(f.lunge<.01,'soltar elimina la extensión retenida');assert.ok(retracted<minimumExtension-.1,'la hoja real se recoge');
});
