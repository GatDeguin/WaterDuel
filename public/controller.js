import {RadialJoystick,weaponGesture,movementGesture} from './joysticks.js';
import {connectMobileController} from './mobile-session.js';

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const localMode=document.documentElement?.dataset?.mobileGame==='true';
const slot=localMode?1:Number(params.get('slot'));
const key=params.get('key')||'';
const shell=$('controllerShell'),state={offX:0,offY:0,mainX:0,mainY:0,lean:0,bodyY:0,wrist:0,thrust:false,guard:false,attackHeld:false,headX:0,headZ:0};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
let ws=null,seq=0,reconnect=null,motionEnabled=false,baseGamma=null,baseBeta=null,headSensorTimer=null,damageTimer=null,inputFocused=true,hostOnline=false,invitationInvalid=false,serverOffset=0;
let welcomed=false,menuOpen=false,menuVisit=0,menuState=null,menuStateSerial=0,requestId=0,equipmentPromise=null,equipmentCatalog=null,seekDragging=false,volumeDragging=false;
let resultState=null,resultVisit=0,resultAccepted=false,resultOffline=false,resultNeedsControlFocus=false;
let rumbleUntil=0,rumblePriority=0;
const pendingCommands=new Map();
const resetControls=[];
const presentationBlocked=()=>menuState?.assets?.loading===true||!!menuState?.rendererError;
const controlsEnabled=()=>!menuOpen&&!resultState&&!presentationBlocked()&&!document.hidden&&inputFocused&&welcomed&&hostOnline&&!invitationInvalid;
function warning(message){const box=$('warning');box.hidden=!message;box.textContent=message;}
if(!localMode&&((slot!==1&&slot!==2)||!key)){warning('Este mando necesita el QR o enlace personal del jugador que muestra la consola del servidor. Abrilo desde un teléfono conectado a la misma Wi-Fi.');$('connLabel').textContent='ESCANEÁ EL QR';}
else{
  shell.dataset.slot=String(slot);
  $('seatNumber').textContent=String(slot).padStart(2,'0');
  $('seatName').textContent=slot===1?'MINT MAMBA':'AMBER ACE';
  $('seatSymbol').textContent=slot===1?'◎':'◉';
}
function updateConnection(){
  let label='CONECTANDO';
  if(ws?.readyState===WebSocket.OPEN)label=hostOnline?'CONECTADO':'ESPERANDO ARENA';
  if(ws?.readyState===WebSocket.CLOSED)label='RECONECTANDO';
  if(invitationInvalid)label='VOLVÉ A ESCANEAR EL QR';
  $('connLabel').textContent=label;
  $('socketDot').classList.toggle('online',ws?.readyState===WebSocket.OPEN&&hostOnline);
  renderMenu();
}
function connect(){
  if(!localMode&&((slot!==1&&slot!==2)||!key)||invitationInvalid)return;
  if(ws && [WebSocket.OPEN,WebSocket.CONNECTING].includes(ws.readyState))return;
  const conn=localMode?connectMobileController():new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);ws=conn;
  conn.onopen=()=>{conn.send(JSON.stringify({type:'hello',role:'controller',slot,key}));updateConnection();};
  conn.onmessage=e=>{
    let m;try{m=JSON.parse(e.data)}catch{return;}
    if(m.type==='welcome'){welcomed=true;hostOnline=!!m.hostOnline;if(Number.isFinite(m.serverTime))serverOffset=m.serverTime-Date.now();neutralize();warning('');updateConnection();}
    if(m.type==='host'){hostOnline=!!m.online;if(!hostOnline){menuState=null;neutralize();cancelCommands('La arena se desconectó. Volvé a elegir la acción cuando regrese.');}updateConnection();}
    if(m.type==='ping')conn.send(JSON.stringify({type:'pong',at:m.at}));
    if(m.type==='pong'){
      const now=Date.now();serverOffset=m.serverTime-(m.at+now)/2;
      $('rttLabel').textContent=`RTT ${Math.max(0,now-m.at)} ms`;
    }
    if(m.type==='session-expired'){
      invitationInvalid=true;neutralize();warning('La invitación caducó. Usá el nuevo QR o enlace del jugador que muestra la consola del servidor.');updateConnection();
    }
    if(m.type==='state'){
      $('phaseText').textContent=({ready:'EN ESPERA',countdown:'PREPARADOS',fight:'¡DUELO ACTIVO!',burst:'RONDA RESUELTA',matchover:'FIN DE PARTIDA'})[m.phase]||String(m.phase).toUpperCase();
      $('scoreText').textContent=`${m.score?.[0]||0} : ${m.score?.[1]||0}`;
    }
    if(m.type==='menu-state'&&hostOnline&&m.state&&typeof m.state==='object'&&!Array.isArray(m.state)){const wasBlocked=presentationBlocked();menuState=m.state;if(wasBlocked||presentationBlocked())neutralize();menuStateSerial++;settleAppliedCommands();renderMenu();}
    if(m.type==='command-result')commandResult(m);
    if(m.type==='event'){
      if(m.name==='burst'&&(m.slot===slot||m.slot===0))damageFeedback();
      if(m.name==='clang')rumble(27);
      if(m.name==='countdown')rumble(15);
      if((m.name==='joint-damage'||m.name==='joint-break')&&m.slot===slot)
        rumble(m.name==='joint-break'?[45,25,80,25,110]:[18,22,32],m.name==='joint-break'?2:1);
    }
    if(m.type==='error'){if(m.code==='INVALID_INVITATION')invitationInvalid=true;warning(m.message||'Error de sesión');updateConnection();}
  };
  conn.onerror=()=>{};
  conn.onclose=()=>{if(ws!==conn)return;welcomed=false;hostOnline=false;menuState=null;neutralize();cancelCommands('Mando desconectado. Las acciones pendientes no se reenviarán.');updateConnection();clearTimeout(reconnect);if(!invitationInvalid)reconnect=setTimeout(connect,1600);};
}
function rumble(pattern,priority=0){
  if(document.hidden||!inputFocused||!welcomed||!hostOnline)return;
  const now=Date.now();
  if(now<rumbleUntil&&(priority<rumblePriority||priority===rumblePriority&&priority<3))return;
  const duration=Array.isArray(pattern)?pattern.reduce((sum,value)=>sum+value,0):pattern;
  rumbleUntil=now+duration;rumblePriority=priority;
  try{navigator.vibrate?.(pattern)}catch{}
}
function stopRumble(){
  if(Date.now()<rumbleUntil)try{navigator.vibrate?.(0)}catch{}
  rumbleUntil=0;rumblePriority=0;
}
function damageFeedback(){
  rumble([90,30,90],3);clearTimeout(damageTimer);
  shell.classList.toggle('reduce-damage-motion',!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  shell.classList.add('damage-feedback');damageTimer=setTimeout(()=>{shell.classList.remove('damage-feedback');damageTimer=null;},210);
}
function send(clear=false){
  if(ws?.readyState!==WebSocket.OPEN)return;
  try{ws.send(JSON.stringify({type:'control',seq:++seq,sentAt:Date.now()+serverOffset,...state,...(clear===true?{neutralize:true}:{})}));}catch{}
}

function installPad(id,knobId,prefix,label,axis='radial'){
  const pad=$(id),output=$(prefix+'PadValue');
  function describe({x,y}){
    if(output){
      const movement=[x?`${x>0?'ACERCARSE':'ALEJARSE'} ${Math.round(Math.abs(x)*100)}%`:'',y?`${y>0?'FINTA AL FONDO':'AGACHARSE'} ${Math.round(Math.abs(y)*100)}%`:''].filter(Boolean).join(' · ');
      output.textContent=prefix==='off'?(movement||'QUIETO'):
        `${x<-.08?(Math.hypot(x,y)>.25?'PARADA':'RECOGIENDO'):Math.hypot(x,y)>.25?'ARMA EXTENDIDA':x||y?'APUNTANDO':'EN NEUTRO'} · MUÑECA ${Math.round(45*weaponGesture({x,y}).wrist)}°`;
    }
    pad.setAttribute('aria-label',`${label}. Horizontal ${Math.round(x*100)}%, vertical ${Math.round(y*100)}%.${prefix==='main'?` Muñeca ${Math.round(45*weaponGesture({x,y}).wrist)} grados.`:''}`);
  }
  const joystick=new RadialJoystick({element:pad,knob:$(knobId),axis,enabled:controlsEnabled,onChange:value=>{
    if(prefix==='off')Object.assign(state,movementGesture(value));
    else Object.assign(state,weaponGesture(value));
    describe(value);send();}});
  resetControls.push(()=>{joystick.reset({notify:false});describe(joystick.value);});
  describe(joystick.value);
}
installPad('offPad','offKnob','off','Movimiento: izquierda alejarse, derecha acercarse, arriba finta al fondo, abajo agacharse');
installPad('mainPad','mainKnob','main','Arma: izquierda recoge y busca desviar el arma rival, derecha extiende, arriba o abajo orienta e inclina la muñeca');
function clearHeadSensor(){clearTimeout(headSensorTimer);headSensorTimer=null;baseGamma=null;baseBeta=null;}
function headSet(x,z){
  state.headX=Number.isFinite(x)?clamp(x,-1,1):0;state.headZ=Number.isFinite(z)?clamp(z,-1,1):0;
  $('headPadValue').textContent=state.headX||state.headZ?`↔ ${Math.round(state.headX*100)} · PROFUNDIDAD ${Math.round(state.headZ*100)}`:'CABEZA CENTRADA';send();
}
function stopMotion(){
  motionEnabled=false;clearHeadSensor();$('motionStopBtn').hidden=true;$('motionBtn').textContent='◉ ACTIVAR ESQUIVA 3D';$('motionStatus').textContent='ESQUIVA TÁCTIL · LISTO';
}
const headJoystick=new RadialJoystick({element:$('headPad'),knob:$('headKnob'),enabled:controlsEnabled,onChange:value=>{stopMotion();headSet(value.x,value.y);}});
resetControls.push(()=>headJoystick.reset({notify:false}));
$('motionBtn').addEventListener('click',async()=>{
  const fail=message=>{stopMotion();headSet(0,0);warning(message);};
  if(!window.isSecureContext){fail('La inclinación requiere un contexto seguro HTTPS. Podés usar el mando táctil de cabeza por Wi-Fi local.');return;}
  if(!('DeviceOrientationEvent' in window)){fail('El dispositivo no expone sensores de orientación. Usá el mando táctil de cabeza.');return;}
  try{
    if(typeof DeviceOrientationEvent.requestPermission==='function'){
      const granted=await DeviceOrientationEvent.requestPermission();if(granted!=='granted'){fail('El permiso del sensor fue rechazado. El mando táctil sigue disponible.');return;}
    }
    clearHeadSensor();motionEnabled=true;headJoystick.reset({notify:false});headSet(0,0);
    $('motionStopBtn').hidden=false;
    $('motionBtn').textContent='◉ RECALIBRAR ESQUIVA';
    $('motionStatus').textContent='ESQUIVA 3D · CALIBRANDO';warning('');
  }catch{fail('No se pudo activar la inclinación. El mando táctil de cabeza sigue disponible.');}
});
$('motionStopBtn').addEventListener('click',()=>{
  stopMotion();headJoystick.reset({notify:false});headSet(0,0);
});
window.addEventListener('deviceorientation',e=>{
  if(!controlsEnabled()||!motionEnabled)return;
  if(!Number.isFinite(e.gamma)||!Number.isFinite(e.beta)){clearHeadSensor();headSet(0,0);return;}
  if(baseGamma===null||baseBeta===null){baseGamma=e.gamma;baseBeta=e.beta;}
  // beta wraps at ±180 degrees: use its shortest signed angular change.
  const betaDelta=((e.beta-baseBeta+540)%360)-180;
  headSet((e.gamma-baseGamma)/25,betaDelta/25);$('motionStatus').textContent='ESQUIVA 3D · SENSOR ACTIVO';
  clearTimeout(headSensorTimer);headSensorTimer=setTimeout(()=>{clearHeadSensor();headSet(0,0);$('motionStatus').textContent='ESQUIVA PAUSADA · RECALIBRÁ AL MOVER';},400);
});
function neutralize(){
  stopRumble();
  for(const reset of resetControls)reset();
  Object.assign(state,{offX:0,offY:0,mainX:0,mainY:0,lean:0,bodyY:0,wrist:0,thrust:false,guard:false,attackHeld:false,headX:0,headZ:0});
  clearHeadSensor();$('headPadValue').textContent='CABEZA CENTRADA';send(true);
}
window.addEventListener('blur',()=>{inputFocused=false;neutralize();});
window.addEventListener('focus',()=>{inputFocused=true;clearHeadSensor();});
window.addEventListener('pagehide',neutralize);
window.addEventListener('resize',neutralize);
window.addEventListener('orientationchange',neutralize);
document.addEventListener('visibilitychange',()=>{if(document.hidden)neutralize();});
window.addEventListener('contextmenu',e=>e.preventDefault());

// All arena menus live on authenticated handsets. The host is authoritative.
const menuFields={menuMode:'mode',menuExperience:'experience',menuDifficulty:'difficulty',menuBestOf:'bestOf',menuArena:'arena',menuQuality:'quality',menuPerformanceMode:'performanceMode',menuCamera:'camera',menuLighting:'lighting'};
const mechanicalFields=['menuMode','menuExperience','menuDifficulty','menuBestOf','menuArena'];
const menuButtons=['menuStartBtn','menuResetBtn','menuNextBtn','menuCampaignResetBtn','menuReplayOpenBtn','menuReplayClearBtn','menuReplayToggleBtn','menuReplayCloseBtn'];
const safeText=(value,max=360)=>String(value??'').slice(0,max);
const connected=()=>welcomed&&hostOnline&&!invitationInvalid&&ws?.readyState===WebSocket.OPEN;
function presentationReason(s){return s?.assets?.loading===true?'La arena está cargando el escenario y los modelos. Esperá a que termine para comenzar.':s?.rendererError?'La arena 3D no está disponible. Esperá a que se recupere para comenzar.':'';}
const awaiting=id=>[...pendingCommands.values()].some(item=>item.element===id);
const commandStateFields={setMode:'mode',setExperience:'experience',setDifficulty:'difficulty',setBestOf:'bestOf',setArena:'arena',setQuality:'quality',setPerformanceMode:'performanceMode',setCamera:'camera',setLighting:'lighting',setAudio:'audioOn',setVolume:'volume'};
const preparationCommands=new Set(['setMode','setExperience','setDifficulty','setBestOf','setArena','setLoadout']);
const arenaActionCommands=new Set(['start','reset','nextEncounter','resetCampaign','replayOpen','replayClose']);
const returnToControlsCommands=new Set(['start','nextEncounter','replayClose']);
function feedback(message,error=false,element=null){
  $('menuFeedback').textContent=safeText(message);$('menuFeedback').classList.toggle('error',error);
  if(element==='resultActionBtn')resultFeedback(message,error);
}
function resultFeedback(message,error=false){const box=$('resultFeedback');box.textContent=safeText(message);box.hidden=!message;box.classList.toggle('error',error);}
function cancelCommands(message){
  if(!pendingCommands.size)return;const resultPending=awaiting('resultActionBtn');for(const item of pendingCommands.values())clearTimeout(item.timer);pendingCommands.clear();feedback(message,true,resultPending?'resultActionBtn':null);
}
function commandResult(message){
  if(!Number.isSafeInteger(message.requestId))return;const pending=pendingCommands.get(message.requestId);if(!pending)return;
  if(pending.acknowledged)return;
  if(message.ok&&pending.command.startsWith('set')){
    pending.acknowledged=true;pending.ackSerial=menuStateSerial;pending.message=message.message;
    if(message.requestId===requestId)feedback('La arena respondió. Esperando el estado aplicado…');renderMenu();return;
  }
  clearTimeout(pending.timer);pendingCommands.delete(message.requestId);
  if(message.requestId===requestId)feedback(message.message||(message.ok?'Acción confirmada por la arena.':'La arena rechazó la acción.'),!message.ok,pending.element);
  if(message.ok&&resultState&&['start','nextEncounter'].includes(pending.command)&&pending.resultVisit===resultVisit){resultAccepted=true;resultNeedsControlFocus=true;}
  renderMenu();
  // An ACK belongs to the menu visit that sent it. Returning manually and
  // opening settings again must not let an old response dismiss that visit.
  if(message.ok&&menuOpen&&pending.menuVisit===menuVisit&&returnToControlsCommands.has(pending.command)){
    closeMenu({toControls:pending.command!=='replayClose'||['countdown','fight'].includes(menuState?.phase)});
  }
}
function settleAppliedCommands(){
  for(const [id,pending]of pendingCommands){
    if(!pending.acknowledged||menuStateSerial<=pending.ackSerial)continue;
    const field=commandStateFields[pending.command];let applied=field&&menuState?.[field]===pending.value;
    if(pending.command==='setLoadout'){
      const equipment=menuState?.fighters?.find(f=>f.slot===pending.value.slot)?.equipment;
      applied=equipment?.weapon===pending.value.weapon&&equipment?.defense===pending.value.defense;
    }
    if(!applied)continue;clearTimeout(pending.timer);pendingCommands.delete(id);
    if(id===requestId)feedback(pending.message||'Estado aplicado confirmado por la arena.');
  }
}
function command(command,value,element){
  if(!connected()||!menuState||$(element)?.disabled||$(element)?.hidden)return false;
  if(requestId>=Number.MAX_SAFE_INTEGER||pendingCommands.size>=8){feedback('Esperá la respuesta de la arena antes de pedir otra acción.',true);return false;}
  const id=++requestId,timer=setTimeout(()=>{
    const pending=pendingCommands.get(id);if(!pending)return;pendingCommands.delete(id);
    feedback(pending.acknowledged?'La arena respondió, pero el estado actual no confirma el cambio solicitado. Revisalo antes de volver a intentarlo.':'La arena no confirmó esta acción. Revisá el estado y volvé a intentarlo.',true,pending.element);renderMenu();
  },8000);
  pendingCommands.set(id,{element,timer,command,value,menuVisit,resultVisit,acknowledged:false,ackSerial:null});
  try{ws.send(JSON.stringify({type:'command',requestId:id,sentAt:Date.now()+serverOffset,command,value}));feedback('Esperando confirmación de la arena…',false,element);renderMenu();return true;}
  catch{clearTimeout(timer);pendingCommands.delete(id);feedback('No se pudo enviar la acción. Volvé a intentarlo al reconectar.',true,element);renderMenu();return false;}
}
function discardResultCommands(){
  for(const [id,item]of pendingCommands)if(item.element==='resultActionBtn'){clearTimeout(item.timer);pendingCommands.delete(id);}
}
function renderResult({preparing,changingArena}){
  const s=menuState,overlay=$('matchResult'),button=$('resultActionBtn');let entered=false;
  if(s&&(s.phase!=='matchover'||s.replay?.active)){
    if(resultState){resultState=null;resultVisit++;resultAccepted=false;discardResultCommands();resultFeedback('');}
    resultOffline=false;
  }else if(s){
    const scores=[Number(s.scores?.[0])||0,Number(s.scores?.[1])||0];
    const signature=JSON.stringify([s.mode,s.experience,s.bestOf,s.round,...scores]);
    if(!resultState||resultState.signature!==signature){
      discardResultCommands();resultVisit++;resultAccepted=false;entered=true;resultFeedback('');
      const winner=scores[0]===scores[1]?0:scores[0]>scores[1]?1:2;
      const outcome=s.mode==='solo'&&slot===2?'observer':winner===0?'draw':winner===slot?'win':'lose';
      const command=s.mode==='solo'&&winner&&['advance','retry'].includes(s.objective?.nextAction)?'nextEncounter':'start';
      resultState={signature,outcome,command};neutralize();
    }
    if(resultOffline){resultOffline=false;resultFeedback('');}
    // The next action can arrive in the same final state after its activity
    // reducer. Do not create a new result or steal focus for that update.
    resultState.command=s.mode==='solo'&&resultState.outcome!=='draw'&&['advance','retry'].includes(s.objective?.nextAction)?'nextEncounter':'start';
  }
  const active=!!resultState;
  $('playPads').inert=active;$('playControls').classList.toggle('has-result',active&&!resultAccepted);
  if(active)$('playPads').setAttribute('aria-hidden','true');else $('playPads').removeAttribute?.('aria-hidden');
  overlay.hidden=!active||resultAccepted||menuOpen;
  if(!active){
    if(resultNeedsControlFocus&&!menuOpen&&['countdown','fight'].includes(s?.phase)){resultNeedsControlFocus=false;$('mainPad').focus?.();}
    return;
  }
  const outcome=resultState.outcome,online=connected()&&!!s;
  const sceneIssue=presentationReason(s);
  overlay.dataset.outcome=outcome;
  $('resultTitle').textContent=({win:'GANASTE',lose:'PERDISTE',draw:'EMPATE',observer:'ACTIVIDAD INDIVIDUAL'})[outcome];
  $('resultMessage').textContent=sceneIssue||(outcome==='observer'?'Esta partida la continúa el JUGADOR 1 desde su mando.':outcome==='draw'?'El resultado está igualado. Podés repetir la partida.':outcome==='win'?(s?.mode==='solo'&&s?.objective?.nextAction==='advance'?'Seguí con el próximo rival.':'Continuá con otra partida.'):'Volvé a intentarlo contra el mismo rival.');
  button.textContent=awaiting('resultActionBtn')?'PREPARANDO…':({win:'✓ SEGUIR',lose:'↻ REVANCHA',draw:'↻ REPETIR PARTIDA',observer:''})[outcome];
  button.hidden=outcome==='observer';button.disabled=!online||preparing||changingArena||resultAccepted||button.hidden||!!sceneIssue;
  button.setAttribute('aria-busy',String(awaiting('resultActionBtn')));
  if(!online){resultOffline=true;resultFeedback(connected()?'Esperando el estado actual de la arena…':'Sin conexión con la arena. El resultado se conserva; reconectá para continuar.',true);}
  if(entered&&!menuOpen&&online&&!document.hidden&&inputFocused)(button.hidden||button.disabled?$('menuBtn'):button).focus?.();
}
function options(element,items,selected){
  const nodes=items.map(item=>{const option=document.createElement('option');option.value=String(item.id);option.textContent=item.label;return option;});
  element.replaceChildren(...nodes);element.value=String(selected??items[0]?.id??'');
}
function loadEquipment(){
  if(equipmentPromise)return equipmentPromise;
  equipmentPromise=import('./equipment.js').then(catalog=>{
    equipmentCatalog=catalog;for(const n of [1,2]){
      options($(`menuWeapon${n}`),Object.values(catalog.WEAPONS),menuState?.fighters?.find(f=>f.slot===n)?.equipment?.weapon);
      options($(`menuDefense${n}`),Object.values(catalog.DEFENSES),menuState?.fighters?.find(f=>f.slot===n)?.equipment?.defense);
    }renderMenu();return true;
  }).catch(()=>{equipmentPromise=null;feedback('No se pudo cargar el catálogo local de equipo. Podés seguir usando los mandos.',true);return false;});return equipmentPromise;
}
function openMenu(){
  if(!connected()||menuOpen)return;menuOpen=true;menuVisit++;neutralize();shell.inert=true;shell.setAttribute('aria-hidden','true');$('menuBtn').setAttribute('aria-expanded','true');
  if(localMode)ws.send(JSON.stringify({type:'ui-state',menuOpen:true}));
  document.body?.classList.add('menu-open');const dialog=$('mobileMenu');dialog.dataset.slot=String(slot);if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  $('menuCloseBtn').focus?.();renderMenu();loadEquipment();
}
function closeMenu({toControls=false}={}){
  if(!menuOpen)return;menuOpen=false;neutralize();shell.inert=false;shell.removeAttribute?.('aria-hidden');$('menuBtn').setAttribute('aria-expanded','false');
  if(localMode)ws.send(JSON.stringify({type:'ui-state',menuOpen:false}));
  document.body?.classList.remove('menu-open');const dialog=$('mobileMenu');if(typeof dialog.close==='function'&&dialog.open)dialog.close();else dialog.removeAttribute?.('open');renderResult({preparing:false,changingArena:[...pendingCommands.values()].some(item=>arenaActionCommands.has(item.command))});$(resultState&&!resultAccepted&&!$('resultActionBtn').hidden?'resultActionBtn':toControls?'mainPad':'menuBtn').focus?.();
}
function renderMenu(){
  const online=connected(),s=menuState,usable=online&&!!s;
  const sceneIssue=presentationReason(s);
  const preparing=[...pendingCommands.values()].some(item=>preparationCommands.has(item.command));
  const changingArena=[...pendingCommands.values()].some(item=>arenaActionCommands.has(item.command));
  const configurable=usable&&!!s.configurable&&!changingArena;
  const ownFighter=s?.fighters?.find(fighter=>fighter.slot===slot);
  $('autoDefenseStatus').textContent=usable&&ownFighter?`${safeText(ownFighter.guardLabel,32)} · ${Math.round(clamp(Number(ownFighter.guardPercent)||0,0,100))}%`:'ESPERANDO ARENA';
  const rendererError=typeof s?.rendererError==='string'?safeText(s.rendererError,240).trim():'';
  for(const id of ['rendererWarning','menuRendererWarning']){
    const alert=$(id);if(alert.textContent!==rendererError)alert.textContent=rendererError;alert.hidden=!rendererError;
  }
  const assets=s?.assets,assetTotal=Number.isFinite(assets?.total)?clamp(Math.round(assets.total),0,4096):0;
  const assetReady=Number.isFinite(assets?.ready)?clamp(Math.round(assets.ready),0,assetTotal):0;
  const assetErrors=Array.isArray(assets?.errors)?assets.errors.filter(error=>typeof error==='string').slice(0,12).map(error=>safeText(error,160)).filter(Boolean):[];
  let assetMessage='',assetState='ready';
  if(assetErrors.length){assetState='error';assetMessage=`Carga 3D con incidencias · ${assetReady} de ${assetTotal} listos.\n${assetErrors.join('\n')}`;}
  else if(assets?.loading===true){assetState='loading';assetMessage=`Cargando escenario y modelos 3D · ${assetReady} de ${assetTotal} listos.`;}
  else if(assetTotal>0){assetState=assetReady>=assetTotal?'ready':'loading';assetMessage=assetReady>=assetTotal?
    `Escenario y modelos 3D listos · ${assetReady} de ${assetTotal}.`:`Carga 3D incompleta · ${assetReady} de ${assetTotal} listos.`;}
  for(const id of ['assetsStatus','menuAssetsStatus']){
    const status=$(id);if(status.textContent!==assetMessage)status.textContent=assetMessage;
    status.dataset.state=assetState;status.hidden=!assetMessage||localMode&&id==='assetsStatus'&&assetState==='ready';
  }
  $('menuBtn').disabled=!online;
  $('menuConnection').textContent=!online?'Sin conexión con la arena. Los mandos se mantienen en neutro.':!s?'Conectado. Esperando las opciones de la arena.':'Conectado a la arena · los cambios requieren confirmación.';
  for(const [id,key]of Object.entries(menuFields)){if(s?.[key]!==undefined)$(id).value=String(s[key]);$(id).disabled=!usable||awaiting(id);}
  for(const id of mechanicalFields)$(id).disabled=!configurable||awaiting(id);
  if(s?.mode==='versus')$('menuExperience').disabled=true;
  if(s?.mode==='solo'&&s?.experience!=='duel'){for(const id of ['menuDifficulty','menuBestOf'])$(id).disabled=true;}
  if(s?.experience==='campaign'&&s?.mode==='solo'){for(const id of ['menuDifficulty','menuBestOf','menuArena'])$(id).disabled=true;}
  if(['fight','countdown'].includes(s?.phase)&&!s?.replay?.active)$('menuCamera').disabled=true;
  $('menuConfigNotice').textContent=sceneIssue|| (changingArena?'Esperando la acción solicitada. Los cambios de combate quedan en pausa.':preparing?'Esperando que la arena aplique tu selección antes de comenzar.':configurable?'Elegí las opciones y tocá Comenzar. Al confirmarse, volvés directamente a los mandos.':'La partida está en curso. Las opciones de combate se habilitan al terminar o preparar otra partida.');
  for(const id of ['menuAudio','menuVolume'])$(id).disabled=!usable||awaiting(id);
  if(s){
    const scores=Array.isArray(s.scores)?s.scores:[0,0];$('menuScore').textContent=`${Number(scores[0])||0} : ${Number(scores[1])||0}`;$('scoreText').textContent=$('menuScore').textContent;
    $('menuRound').textContent=safeText(s.round,8);$('menuClock').textContent=safeText(s.clock,24);$('menuMatchMessage').textContent=safeText(s.message);
    $('menuAudio').checked=!!s.audioOn;if(!volumeDragging)$('menuVolume').value=String(clamp(Number(s.volume)||0,0,100));$('menuVolumeValue').textContent=`${$('menuVolume').value}%`;
    const labels={ready:'EN ESPERA',countdown:'PREPARADOS',fight:'¡DUELO ACTIVO!',burst:'RONDA RESUELTA',matchover:'FIN DE PARTIDA'};$('phaseText').textContent=labels[s.phase]??safeText(s.phase,30);
  }
  $('menuCombatNotice').hidden=!['fight','countdown'].includes(s?.phase);
  $('menuCombatNotice').textContent=sceneIssue?'La partida está en pausa mientras se prepara la arena. Tus mandos permanecen en neutro.':localMode?'El juego está pausado mientras el menú está abierto. Cerralo para continuar.':'El duelo continúa mientras el menú está abierto. Tu muñeco queda con los mandos en neutro.';
  if(sceneIssue)$('phaseText').textContent=s?.assets?.loading?'CARGANDO ARENA':'ARENA EN PAUSA';
  const objective=s?.objective??{};$('menuObjectiveTitle').textContent=safeText(objective.title||'Actividad');$('menuObjectiveInstruction').textContent=safeText(objective.instruction||'Prepará tu muñeco para el próximo duelo.');
  $('menuObjectiveProgress').textContent=Number(objective.total)>0?`${Number(objective.progress)||0} / ${Number(objective.total)}${objective.completed?' · COMPLETADO':''}`:'';
  $('controlObjective').textContent=Number(objective.total)>0?`${$('menuObjectiveProgress').textContent} · ${safeText(objective.instruction)}`:'';$('controlObjective').hidden=!$('controlObjective').textContent;
  for(const n of [1,2]){
    const fighter=s?.fighters?.find(f=>f.slot===n),weapon=$(`menuWeapon${n}`),defense=$(`menuDefense${n}`);
    $(`menuFighter${n}`).textContent=`J${n} · ${safeText(fighter?.name||'Esperando rival',60)}`;
    $(`menuGuard${n}`).textContent=fighter?`${safeText(fighter.guardLabel,32)} ${Math.round(clamp(Number(fighter.guardPercent)||0,0,100))}% · ${Array.isArray(fighter.wins)?fighter.wins.filter(Boolean).length:0} victorias`:'';
    if(fighter?.equipment){weapon.value=safeText(fighter.equipment.weapon,24);defense.value=safeText(fighter.equipment.defense,24);}
    const equipmentPending=awaiting(weapon.id)||awaiting(defense.id),fixedOpponent=n===2&&s?.mode==='solo'&&['duel','campaign'].includes(s?.experience);
    weapon.disabled=!configurable||!equipmentCatalog||!!s?.trainingEquipmentLocked||equipmentPending||fixedOpponent;
    defense.disabled=!configurable||!equipmentCatalog||!!s?.trainingEquipmentLocked||equipmentPending||fixedOpponent||!!equipmentCatalog?.WEAPONS?.[weapon.value]?.twoHanded;
    if(n===slot&&fighter?.name)$('seatName').textContent=safeText(fighter.name,60);
  }
  $('menuEquipmentNotice').textContent=s?.trainingEquipmentLocked?'Equipo de escuela fijado para aprender los mismos movimientos.':s?.mode==='solo'&&['duel','campaign'].includes(s?.experience)?'El encuentro establece el equipo del rival. Elegí tu arma y defensa antes de combatir; el mazo ocupa ambas manos.':'El mazo ocupa ambas manos. Elegí arma y defensa antes de combatir.';
  for(const id of menuButtons){$(id).disabled=!usable||awaiting(id);$(id).setAttribute('aria-busy',String(awaiting(id)));}
  $('menuStartBtn').disabled=!usable||!!sceneIssue||!!s?.replay?.active||!['ready','matchover'].includes(s?.phase)||preparing||changingArena;$('menuStartBtn').textContent=awaiting('menuStartBtn')?'INICIANDO…':s?.phase==='matchover'?'REVANCHA':'COMENZAR';
  $('menuNextBtn').hidden=!objective.nextAction;$('menuNextBtn').disabled=!usable||!!sceneIssue||!!s?.replay?.active||!objective.nextAction||preparing||changingArena;$('menuNextBtn').textContent=awaiting('menuNextBtn')?'PREPARANDO…':objective.nextAction==='retry'?'REINTENTAR ENCUENTRO':objective.nextAction==='repeat'?'REPETIR ACTIVIDAD':'SIGUIENTE ENCUENTRO';
  $('menuResetBtn').disabled=!usable||preparing||changingArena;
  $('menuResetBtn').textContent=awaiting('menuResetBtn')?'PREPARANDO…':'PREPARAR NUEVA PARTIDA';
  $('menuCampaignResetBtn').disabled=!configurable||preparing;
  const replay=s?.replay??{},clips=Array.isArray(replay.clips)?replay.clips.filter(c=>Number.isSafeInteger(c.id)&&c.complete):[],select=$('menuReplayClip');
  const signature=JSON.stringify(clips.map(c=>[c.id,c.duration]));
  if(select.dataset.clips!==signature&&s){const selected=select.value;options(select,clips.length?clips.map(c=>({id:c.id,label:`Momento ${c.id} · ${Math.max(0,Number(c.duration)||0).toFixed(1)} s`})):[{id:'',label:'Todavía no hay repeticiones completas'}],clips.some(c=>String(c.id)===selected)?selected:clips[0]?.id);select.dataset.clips=signature;}
  select.disabled=!usable||!clips.length||!!replay.active;$('menuReplayControls').hidden=!replay.active;
  $('menuReplayOpenBtn').disabled=!usable||!clips.length||!!replay.active||['fight','countdown'].includes(s?.phase)||changingArena;
  $('menuReplayClearBtn').disabled=!usable||!clips.length||!!replay.active||awaiting('menuReplayClearBtn');
  for(const id of ['menuReplaySeek','menuReplaySpeed','menuReplayToggleBtn','menuReplayCloseBtn'])$(id).disabled=!usable||!replay.active||awaiting(id);
  if(!seekDragging)$('menuReplaySeek').value=String(Math.round(clamp(Number(replay.position)||0,0,1)*1000));$('menuReplayPosition').textContent=`${Math.round(Number($('menuReplaySeek').value)/10)}%`;
  $('menuReplaySpeed').value=String(replay.speed??.5);$('menuReplayToggleBtn').textContent=replay.paused?'REPRODUCIR':'PAUSAR';
  renderResult({preparing,changingArena});
}
$('resultActionBtn').addEventListener('click',()=>{if(resultState&&!menuOpen&&!resultAccepted)command(resultState.command,undefined,'resultActionBtn');});
$('menuBtn').addEventListener('click',openMenu);for(const id of ['menuCloseBtn','menuBackBtn'])$(id).addEventListener('click',closeMenu);
$('mobileMenu').addEventListener('cancel',event=>{event.preventDefault();closeMenu();});$('mobileMenu').addEventListener('close',()=>{if(menuOpen)closeMenu();});
$('mobileMenu').addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();closeMenu();return;}if(event.key!=='Tab')return;
  const items=[...($('mobileMenu').querySelectorAll?.('button:not(:disabled),select:not(:disabled),input:not(:disabled)')??[])].filter(e=>!e.hidden&&!e.closest?.('[hidden]'));
  if(!items.length)return;const first=items[0],last=items.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
for(const [id,commandName,allowed,numeric]of [
  ['menuMode','setMode',['solo','versus']],['menuExperience','setExperience',['duel','training','practice','precision','campaign']],['menuDifficulty','setDifficulty',['rookie','normal','expert','boss']],
  ['menuBestOf','setBestOf',['3','5'],true],['menuArena','setArena',['atelier','midnight','dojo']],['menuQuality','setQuality',['high','ultra','eco']],['menuPerformanceMode','setPerformanceMode',['adaptive','fixed']],['menuCamera','setCamera',['combat','detail']],['menuLighting','setLighting',['cinematic','neutral']],['menuReplaySpeed','replaySpeed',['0.25','0.5','1'],true]
])$(id).addEventListener('change',()=>{const value=$(id).value;if(!allowed.includes(value)){renderMenu();return;}command(commandName,numeric?Number(value):value,id);});
for(const [id,name]of [['menuStartBtn','start'],['menuResetBtn','reset'],['menuNextBtn','nextEncounter'],['menuCampaignResetBtn','resetCampaign'],['menuReplayToggleBtn','replayToggle'],['menuReplayCloseBtn','replayClose'],['menuReplayClearBtn','replayClear']])$(id).addEventListener('click',()=>command(name,undefined,id));
$('menuAudio').addEventListener('change',()=>command('setAudio',$('menuAudio').checked,'menuAudio'));
$('menuVolume').addEventListener('input',()=>{volumeDragging=true;$('menuVolumeValue').textContent=`${$('menuVolume').value}%`;});
$('menuVolume').addEventListener('change',()=>{volumeDragging=false;const volume=Number($('menuVolume').value);if(Number.isFinite(volume))command('setVolume',Math.round(clamp(volume,0,100)),'menuVolume');});
$('menuReplayOpenBtn').addEventListener('click',()=>{const id=Number($('menuReplayClip').value);if(Number.isSafeInteger(id)&&id>0)command('replayOpen',id,'menuReplayOpenBtn');});
$('menuReplaySeek').addEventListener('input',()=>{seekDragging=true;$('menuReplayPosition').textContent=`${Math.round(Number($('menuReplaySeek').value)/10)}%`;});
$('menuReplaySeek').addEventListener('change',()=>{seekDragging=false;const fraction=Number($('menuReplaySeek').value)/1000;if(Number.isFinite(fraction))command('replaySeek',clamp(fraction,0,1),'menuReplaySeek');});
for(const n of [1,2])for(const type of ['Weapon','Defense'])$(`menu${type}${n}`).addEventListener('change',()=>{
  if(!equipmentCatalog)return;const loadout=equipmentCatalog.normalizeLoadout({weapon:$(`menuWeapon${n}`).value,defense:$(`menuDefense${n}`).value});command('setLoadout',{slot:n,...loadout},`menu${type}${n}`);
});
renderMenu();
if(localMode){
  $('mobileHeadTouch')?.addEventListener('change',()=>{
    neutralize();$('mobileHeadPanel').hidden=!$('mobileHeadTouch').checked;
    if($('mobileHeadTouch').checked)closeMenu({toControls:true});
  });
}
setInterval(send,33);
setInterval(()=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'ping',at:Date.now()}));},2000);
connect();
