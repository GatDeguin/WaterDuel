import {STEP,neutral} from './engine.js';
import {Renderer3D} from './render3d.js';
import {HostSession} from './host-session.js';
import {RemoteInputBuffer,isFreshRemoteInput} from './remote-input.js';
import {FrameMetrics} from './performance.js';
import {RecordedGameAudio as GameAudio} from './audio/recorded-game-audio.js';
import {HostQRCodes} from './host-qr.js';
import {AdaptiveQuality} from './adaptive-quality.js';
import {mobileSession} from './mobile-session.js';

const canvas=document.getElementById('gameCanvas');
const mobileMode=document.documentElement?.dataset?.mobileGame==='true';
let mobileFocused=true;
const remoteInputs=new RemoteInputBuffer(),audio=new GameAudio(),metrics=new FrameMetrics();
const adaptiveQuality=new AdaptiveQuality();
let renderer=null,credentials=null,socket=null,hasAuthority=false,serverOffset=0;
let retry=null,discoverRetry=null,authorityBlocked=false,presence=[false,false];
const joinCodes=new HostQRCodes(document.getElementById('joinCodes'),{onExpired:()=>{
  clearTimeout(discoverRetry);discoverRetry=setTimeout(discoverSession,0);
}});
const keys=new Set(),pulses=[false,false];
let accumulator=0,previous=performance.now(),lastState=0,presentationWasPaused=false;
let storage=null;try{storage=window.localStorage;}catch{}

function clearInputs(){keys.clear();pulses.fill(false);for(const slot of [1,2])remoteInputs.disconnect(slot);if(mobileMode)mobileSession.neutralize();accumulator=0;}
function mobilePaused(){return mobileMode&&(!mobileFocused||mobileSession.paused);}
function audioPaused(){return document.hidden||!hasAuthority||!!host.playback||mobilePaused();}
const host=new HostSession({storage,onNeutralize:clearInputs,onSettings:kind=>{
  if(kind==='quality'||kind==='performance'||kind==='replay')adaptiveQuality.reset();
  if(kind==='quality'||kind==='replay'){renderer?.waterSurfaces.clear();if(renderer)renderer.quality={high:1.55,ultra:2,eco:1}[host.game.quality];}
  if(kind==='replay')audio.setPaused(audioPaused());
  if(kind==='audio'){audio.configure(host.audioOn,host.volume);if(mobileMode)audio.unlock();}
},onEvent:(name,data)=>{
  if(typeof metrics!=='undefined')metrics.markEvent?.(name,performance.now());
  const jointEvent=name==='joint-damage'||name==='joint-break';
  audio.handleEvent(jointEvent?'material-contact':name,jointEvent?{...data,jointEvent:name}:data,host.game);
  const event=jointEvent?name:{burst:'burst',clang:'clang',countdown:'countdown',matchover:'victory'}[name];
  const eventSlot=name==='burst'?(data.draw?0:data.loser):data.defender||data.slot||data.winner||0;
  if(event)send({type:'event',name:event,slot:eventSlot||0});
}});
const game=host.game;
if(mobileMode){
  hasAuthority=true;
  mobileSession.bindHost(host,{onInteraction:()=>audio.unlock(),onPause:()=>{
    clearInputs();previous=performance.now();audio.setPaused(audioPaused());
  }});
  document.addEventListener('pointerdown',()=>audio.unlock(),{capture:true});
  for(const name of ['resize','orientationchange'])window.addEventListener(name,()=>{host.neutralize();previous=performance.now();});
}
function refreshJoinCodes(){
  try{joinCodes.setSession(credentials,serverOffset);}
  catch{
    // A presentation failure must not prevent the authoritative host handshake.
    joinCodes.hide();console.warn?.('No se pudieron presentar los QR de conexión. La arena continúa conectándose.');
  }
}
function send(message){if(mobileMode){if(message.type==='event')mobileSession.event(message.name,message.slot);return;}if(hasAuthority&&socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));}
function broadcast(){
  if(mobileMode){mobileSession.publish();return;}
  send({type:'state',phase:game.phase,mode:game.mode,score:game.scores,time:game.elapsed});
  send({type:'menu-state',state:host.menuState()});
}
function renderError(error){host.rendererError=mobileMode?'No se pudo presentar la arena 3D. Probá recargar o usar un navegador compatible con WebGL 2.':'No se pudo presentar la arena 3D. Revisá la consola de la PC.';console.error(error);broadcast();}
function createRenderer(){
  adaptiveQuality.reset();
  try{
    renderer=new Renderer3D(canvas);renderer.quality={high:1.55,ultra:2,eco:1}[game.quality];host.rendererError='';
    const loadingRenderer=renderer;
    const loading=renderer.loadAssets?.(status=>{if(renderer!==loadingRenderer)return;const wasBlocked=host.presentationBlocked;host.assetStatus={...status,loading:status.loading||!!loadingRenderer.prepareGame&&!loadingRenderer.prepared};if(wasBlocked!==host.presentationBlocked)adaptiveQuality.reset();broadcast();});
    if(loading?.then||loadingRenderer.prepareGame)Promise.resolve(loading).then(async()=>{
      if(renderer!==loadingRenderer)return;
      await loadingRenderer.prepareGame?.(game);if(renderer!==loadingRenderer)return;
      host.assetStatus={...loadingRenderer.assetStatus,...host.assetStatus,loading:false};clearInputs();previous=performance.now();adaptiveQuality.reset();broadcast();
    }).catch(error=>{if(renderer===loadingRenderer)renderError(error);});
  }
  catch(error){renderer=null;renderError(error);}
}
createRenderer();
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();adaptiveQuality.reset();renderer?.dispose();renderer=null;renderError(new Error('WebGL context lost'));});
canvas.addEventListener('webglcontextrestored',createRenderer);
// The two corner invitations are the only PC overlay. These keys remain a local input fallback.
window.addEventListener('keydown',event=>{
  if(mobileMode)return; // The local pads and native drawer controls own these keys.
  audio.unlock();if(host.playback)return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code))event.preventDefault();
  keys.add(event.code);if(!event.repeat&&event.code==='Space')pulses[0]=true;if(!event.repeat&&event.code==='Enter')pulses[1]=true;
});
window.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',()=>{adaptiveQuality.reset();clearInputs();for(const slot of [1,2])game.setControl(slot,neutral());if(mobileMode){mobileFocused=false;audio.setPaused(true);}});
window.addEventListener('focus',()=>{adaptiveQuality.reset();if(mobileMode){mobileFocused=true;clearInputs();previous=performance.now();audio.setPaused(audioPaused());}});
canvas.addEventListener('pointerdown',()=>audio.unlock());
document.addEventListener('visibilitychange',()=>{adaptiveQuality.reset();clearInputs();previous=performance.now();audio.setPaused(audioPaused());});
function keyboard(){
  const pressed=(...codes)=>codes.some(code=>keys.has(code)),axis=(positive,negative)=>Number(pressed(...positive))-Number(pressed(...negative));
  return [
    {...neutral(),mainY:axis(['KeyW'],['KeyS']),mainX:axis(['KeyD'],['KeyA']),lean:axis(['KeyE'],['KeyQ']),offY:axis(['KeyX'],['KeyZ']),offX:axis(['KeyV'],['KeyC']),thrust:pressed('Space')||pulses[0],guard:pressed('ShiftLeft','ShiftRight')},
    {...neutral(),mainY:axis(['ArrowUp'],['ArrowDown']),mainX:axis(['ArrowRight'],['ArrowLeft']),lean:axis(['KeyM'],['KeyN']),offY:axis(['Period'],['Comma']),offX:axis(['KeyL'],['KeyK']),thrust:pressed('Enter')||pulses[1],guard:pressed('Slash')},
  ];
}
function connectHost(){
  if(!credentials||socket?.readyState===WebSocket.OPEN||socket?.readyState===WebSocket.CONNECTING)return;
  const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);socket=ws;
  ws.onopen=()=>ws.send(JSON.stringify({type:'hello',role:'host',key:credentials.hostToken}));
  ws.onmessage=event=>{
    if(socket!==ws)return;let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message.type==='welcome'){
      hasAuthority=true;authorityBlocked=false;presence=message.connected.map(Boolean);
      refreshJoinCodes();
      audio.setPaused(document.hidden||!!host.playback);broadcast();
    }else if(message.type==='presence'){
      presence[message.slot-1]=!!message.online;remoteInputs.disconnect(message.slot);if(!message.online)game.disconnect(message.slot);broadcast();
    }else if(message.type==='control'){
      if(host.playback||!hasAuthority||!isFreshRemoteInput(message,Date.now()+serverOffset))return;
      remoteInputs.receive(message.slot,message,performance.now(),Date.now()+serverOffset-message.sentAt);
    }else if(message.type==='command'){
      if(!hasAuthority)return;
      const age=Date.now()+serverOffset-message.sentAt;
      const validEnvelope=[1,2].includes(message.slot)&&Number.isSafeInteger(message.relayId)&&message.relayId>0;
      const result=!validEnvelope||!Number.isFinite(age)||age>2500||age< -1000?
        {ok:false,message:'El comando venció. Volvé a intentarlo desde el móvil.'}:host.handleCommand(message);
      send({type:'command-result',slot:message.slot,requestId:message.requestId,relayId:message.relayId,...result});broadcast();
    }else if(message.type==='ping'){
      ws.send(JSON.stringify({type:'pong',at:message.at}));
    }else if(message.type==='session-expired'){
      credentials=null;joinCodes.hide();hasAuthority=false;audio.setPaused(true);clearInputs();ws.close();clearTimeout(discoverRetry);discoverRetry=setTimeout(discoverSession,250);
    }else if(message.type==='error'&&message.code==='HOST_BUSY'){
      authorityBlocked=true;hasAuthority=false;joinCodes.hide();audio.setPaused(true);host.neutralize();
    }
  };
  ws.onerror=()=>{};
  ws.onclose=()=>{
    if(socket!==ws)return;socket=null;hasAuthority=false;joinCodes.hide();presence=[false,false];audio.setPaused(true);host.neutralize();
    for(const slot of [1,2])game.disconnect(slot);
    clearTimeout(retry);if(credentials)retry=setTimeout(discoverSession,authorityBlocked?5000:2000);
  };
}
async function discoverSession(){
  try{
    const before=Date.now(),response=await fetch('/api/session',{cache:'no-store',signal:AbortSignal.timeout(3500)});
    if(!response.ok)throw new Error('Servidor de sesión no disponible');
    credentials=await response.json();serverOffset=(credentials.serverTime||Date.now())-(before+Date.now())/2;
    refreshJoinCodes();connectHost();
  }catch{
    // Keep the scene visible; invalid invitations never leave stale QR codes.
    joinCodes.hide();
    clearTimeout(discoverRetry);discoverRetry=setTimeout(discoverSession,3000);
  }
}
function animate(now){
  const callbackStart=performance.now();
  requestAnimationFrame(animate);
  const rawMs=now-previous,dt=Math.max(0,Math.min(rawMs/1000,.085));previous=now;
  const presentationPaused=!renderer||host.presentationBlocked;
  // Ignore hidden input and discard the first resumed frame's old holds. A
  // loading scene must not accumulate a countdown or catch-up simulation.
  if(presentationPaused||presentationWasPaused)host.neutralize();
  presentationWasPaused=presentationPaused;
  const paused=!hasAuthority||!!host.playback||document.hidden||presentationPaused||mobilePaused();
  accumulator=paused?0:accumulator+dt;
  const local=mobileMode?[mobileSession.sample(),neutral()]:keyboard(),simulationStart=performance.now();let steps=0;
  while(accumulator>=STEP&&steps<10){
    for(let index=0;index<2;index++){
      if(game.mode==='solo'&&index===1)continue;
      const remote=presence[index]?remoteInputs.sample(index+1,performance.now()):null;
      game.setControl(index+1,remote||(!presence[index]?local[index]:neutral()),{connected:!!remote});
    }
    host.update(STEP);accumulator-=STEP;steps++;
  }
  if(steps)pulses.fill(false);if(steps===10)accumulator=0;
  const renderStart=performance.now(),{scene,time}=host.renderState(document.hidden||presentationPaused||mobileMode&&!mobileFocused?0:dt,accumulator);
  adaptiveQuality.configure(host.performanceMode,game.quality);
  const qualityEligible=!paused&&!!renderer;
  if(renderer)try{renderer.render(scene,time,adaptiveQuality.profile(game.phase,!qualityEligible,performance.now()));}catch(error){renderer.dispose();renderer=null;renderError(error);}
  const renderedAt=performance.now();
  audio.update(game,{paused,dt,camera:renderer?.stats?.camera});
  const audioMs=performance.now()-renderedAt;
  if(!document.hidden)metrics.record({frameMs:rawMs,simulationMs:renderStart-simulationStart+audioMs,renderMs:renderedAt-renderStart,phase:host.playback?'replay':game.phase,heapBytes:performance.memory?.usedJSHeapSize,now,eligible:!paused&&!host.playback&&!host.presentationBlocked});
  if(now-lastState>=250){host.performanceReport=metrics.report();broadcast();lastState=now;}
  const callbackEnd=performance.now();
  adaptiveQuality.observe({now:callbackEnd,workMs:callbackEnd-callbackStart,phase:game.phase,eligible:qualityEligible&&!!renderer});
}
if(!mobileMode)discoverSession();requestAnimationFrame(animate);
