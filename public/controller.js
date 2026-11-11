import {RadialJoystick,weaponGesture,movementGesture} from './joysticks.js';
import {connectMobileController} from './mobile-session.js';
import {AUDIO_EFFECTS,ALL_EFFECTS_MASK,validEffectMask,effectEnabled,setEffectEnabled} from './audio/effect-controls.js';
import {SOUND_SLIDERS,SOUND_COMMANDS} from './audio/sound-settings.js';
import {contactHaptic} from './item-haptics.js';
import {CAMPAIGN_TIERS,STORY_CHAPTERS} from './campaign-progression.js';

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const localMode=document.documentElement?.dataset?.mobileGame==='true';
const slot=localMode?1:Number(params.get('slot'));
const key=params.get('key')||'';
const shell=$('controllerShell'),state={offX:0,offY:0,mainX:0,mainY:0,lean:0,bodyY:0,wrist:0,thrust:false,guard:false,attackHeld:false,headX:0,headZ:0};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
let ws=null,seq=0,reconnect=null,motionEnabled=false,baseGamma=null,baseBeta=null,headSensorTimer=null,damageTimer=null,inputFocused=true,hostOnline=false,invitationInvalid=false,serverOffset=0;
let welcomed=false,menuOpen=false,menuVisit=0,menuState=null,menuStateSerial=0,requestId=0,equipmentPromise=null,equipmentCatalog=null,seekDragging=false;
let equipmentOpen=false,armoryOptionsKey=null;
let resultState=null,resultVisit=0,resultAccepted=false,resultOffline=false,resultNeedsControlFocus=false;
let quickStartAccepted=false;
let rumbleUntil=0,rumblePriority=0;
const pendingCommands=new Map();
const soundDragging=new Set();
const effectInputs=new Map();
let authoritativeEffectMask=null;
const soundLabel=(id,value)=>id==='menuReverbDecay'?`${(value/1000).toFixed(1).replace('.',',')} s`:`${value}%`;
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
      if(m.name==='clang'){
        if(Object.hasOwn(m,'impact')){
          const contact=contactHaptic(m.impact,slot);
          if(contact)rumble(contact.pattern,contact.priority,80);
        }else if(m.slot===0||m.slot===slot)rumble(27);
      }
      if(m.name==='countdown')rumble(15);
      if((m.name==='joint-damage'||m.name==='joint-break')&&m.slot===slot)
        rumble(m.name==='joint-break'?[45,25,80,25,110]:[18,22,32],m.name==='joint-break'?2:1);
    }
    if(m.type==='error'){if(m.code==='INVALID_INVITATION')invitationInvalid=true;warning(m.message||'Error de sesión');updateConnection();}
  };
  conn.onerror=()=>{};
  conn.onclose=()=>{if(ws!==conn)return;welcomed=false;hostOnline=false;menuState=null;neutralize();cancelCommands('Mando desconectado. Las acciones pendientes no se reenviarán.');updateConnection();clearTimeout(reconnect);if(!invitationInvalid)reconnect=setTimeout(connect,1600);};
}
function rumble(pattern,priority=0,minimumInterval=0){
  if(document.hidden||!inputFocused||!welcomed||!hostOnline||typeof navigator.vibrate!=='function')return;
  const now=Date.now();
  if(now<rumbleUntil&&(priority<rumblePriority||priority===rumblePriority&&priority<3))return;
  const duration=Array.isArray(pattern)?pattern.reduce((sum,value)=>sum+value,0):pattern;
  rumbleUntil=now+Math.max(duration,minimumInterval);rumblePriority=priority;
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
  try{ws.send(JSON.stringify({type:'control',seq:++seq,sentAt:Date.now()+serverOffset,...state,
    ...(clear===true?{neutralize:true}:armoryPreviewRequested()?{armoryView:true}:{})}));}catch{}
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
  soundDragging.clear();
  for(const reset of resetControls)reset();
  setEquipmentOpen(false);
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
function pendingFor(id){for(const item of pendingCommands.values())if(item.element===id)return item;}
const awaiting=id=>!!pendingFor(id);
const commandStateFields={setMode:'mode',setExperience:'experience',setDifficulty:'difficulty',setBestOf:'bestOf',setArena:'arena',setQuality:'quality',setPerformanceMode:'performanceMode',setCamera:'camera',setLighting:'lighting',setAudio:'audioOn',...SOUND_COMMANDS};
const preparationCommands=new Set(['setMode','setExperience','setDifficulty','setBestOf','setArena','setLoadout','setCampaignTier']);
const arenaActionCommands=new Set(['start','reset','nextEncounter','resetCampaign','replayOpen','replayClose','beginAdvancedCampaign']);
const returnToControlsCommands=new Set(['start','nextEncounter','replayClose','beginAdvancedCampaign']);
const resultCommand=(s,outcome)=>s.mode==='solo'&&s.experience==='campaign'&&outcome==='win'&&s.objective?.completed&&s.objective?.campaignTier==='normal'&&s.objective?.advancedUnlocked?'beginAdvancedCampaign':s.mode==='solo'&&outcome!=='draw'&&['advance','retry'].includes(s.objective?.nextAction)?'nextEncounter':'start';
const activityCommand=s=>s?.mode==='solo'&&s.experience==='campaign'&&s.objective?.completed?(s.objective.campaignTier==='normal'&&s.objective.advancedUnlocked?'beginAdvancedCampaign':'start'):'nextEncounter';
function storyAdvanceLabel(objective){
  const story=objective?.story;
  if(objective?.nextAction!=='advance'||!story?.nextChapter)return '';
  if(story.nextChapter>story.chapter)return 'SIGUIENTE CAPÍTULO';
  return story.nextRole==='boss'?'ENFRENTAR AL JEFE':'';
}
function feedback(message,error=false,element=null){
  if(element==='quickStartBtn'){
    const box=$('quickStartFeedback');box.textContent=safeText(message);box.hidden=!message;box.classList.toggle('error',error);return;
  }
  $('menuFeedback').textContent=safeText(message);$('menuFeedback').classList.toggle('error',error);
  if(element==='resultActionBtn')resultFeedback(message,error);
}
function resultFeedback(message,error=false){const box=$('resultFeedback');box.textContent=safeText(message);box.hidden=!message;box.classList.toggle('error',error);}
function cancelCommands(message){
  if(!pendingCommands.size)return;
  const surface=awaiting('resultActionBtn')?'resultActionBtn':awaiting('quickStartBtn')?'quickStartBtn':null;
  for(const item of pendingCommands.values())clearTimeout(item.timer);
  pendingCommands.clear();feedback(message,true,surface);
}
function commandResult(message){
  if(!Number.isSafeInteger(message.requestId))return;const pending=pendingCommands.get(message.requestId);if(!pending)return;
  if(pending.acknowledged)return;
  if(message.ok&&pending.command.startsWith('set')){
    pending.acknowledged=true;pending.ackSerial=menuStateSerial;pending.message=message.message;
    if(message.requestId===requestId)feedback('La arena respondió. Esperando el estado aplicado…');renderMenu();return;
  }
  clearTimeout(pending.timer);pendingCommands.delete(message.requestId);
  if(message.ok&&pending.element==='quickStartBtn')quickStartAccepted=true;
  if(message.requestId===requestId)feedback(message.message||(message.ok?'Acción confirmada por la arena.':'La arena rechazó la acción.'),!message.ok,pending.element);
  if(message.ok&&resultState&&['start','nextEncounter','beginAdvancedCampaign'].includes(pending.command)&&pending.resultVisit===resultVisit){resultAccepted=true;resultNeedsControlFocus=true;}
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
      applied=equipment?.weapon===pending.value.weapon&&equipment?.defense===pending.value.defense&&
        (equipment?.knifeGrip??'normal')===(pending.value.knifeGrip??'normal');
    }
    if(pending.command==='setEffectEnabled')applied=validEffectMask(menuState?.effectMask)&&effectEnabled(menuState.effectMask,pending.value.id)===pending.value.enabled;
    if(pending.command==='setCampaignTier')applied=menuState?.experience==='campaign'&&menuState?.objective?.campaignTier===pending.value;
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
    const signature=JSON.stringify([s.mode,s.experience,s.objective?.campaignTier,s.bestOf,s.round,...scores]);
    if(!resultState||resultState.signature!==signature){
      discardResultCommands();resultVisit++;resultAccepted=false;entered=true;resultFeedback('');
      const winner=scores[0]===scores[1]?0:scores[0]>scores[1]?1:2;
      const outcome=s.mode==='solo'&&slot===2?'observer':winner===0?'draw':winner===slot?'win':'lose';
      const command=resultCommand(s,outcome);
      resultState={signature,outcome,command};neutralize();
    }
    if(resultOffline){resultOffline=false;resultFeedback('');}
    // The next action can arrive in the same final state after its activity
    // reducer. Do not create a new result or steal focus for that update.
    resultState.command=resultCommand(s,resultState.outcome);
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
  if(s)$('resultScore').textContent=$('scoreText').textContent;
  $('resultTitle').textContent=({win:'GANASTE',lose:'PERDISTE',draw:'EMPATE',observer:'ACTIVIDAD INDIVIDUAL'})[outcome];
  $('resultMessage').textContent=sceneIssue||(outcome==='observer'?'Esta partida la continúa el JUGADOR 1 desde su mando.':outcome==='draw'?'El resultado está igualado. Podés repetir la partida.':outcome==='win'?(s?.mode==='solo'&&s?.objective?.nextAction==='advance'?'Seguí con el próximo rival.':'Continuá con otra partida.'):'Volvé a intentarlo contra el mismo rival.');
  const campaignFinal=outcome==='win'&&s?.mode==='solo'&&s?.experience==='campaign'&&s?.objective?.completed;
  if(campaignFinal){
    const tier=s.objective.campaignTier;
    $('resultTitle').textContent=tier==='bosses'?'JEFES DEL TALLER SUPERADO':tier==='advanced'?'MAESTRÍA COMPLETADA':'CAMPAÑA COMPLETADA';
    $('resultMessage').textContent=sceneIssue||(tier==='bosses'||s.objective.story?s.objective.instruction:s.objective.trophy==='master'?'Trofeo del Maestro: dominaste la campaña avanzada del taller.':'Trofeo del Campeón: venciste al Maestro Hidráulico. La campaña avanzada está desbloqueada.');
  }
  const nextLabel=outcome==='win'?storyAdvanceLabel(s?.objective):'';
  if(!sceneIssue&&outcome==='win'&&s?.objective?.story?.nextOpponent)$('resultMessage').textContent=s.objective.instruction;
  button.textContent=awaiting('resultActionBtn')?'PREPARANDO…':nextLabel?`✓ ${nextLabel}`:({win:'✓ SEGUIR',lose:'↻ REVANCHA',draw:'↻ REPETIR PARTIDA',observer:''})[outcome];
  if(!awaiting('resultActionBtn')&&resultState.command==='beginAdvancedCampaign')button.textContent='✓ INICIAR CAMPAÑA AVANZADA';
  button.hidden=outcome==='observer';button.disabled=!online||preparing||changingArena||resultAccepted||button.hidden||!!sceneIssue;
  button.setAttribute('aria-busy',String(awaiting('resultActionBtn')));
  if(!online){resultOffline=true;resultFeedback(connected()?'Esperando el estado actual de la arena…':'Sin conexión con la arena. El resultado se conserva; reconectá para continuar.',true);}
  if(entered&&!menuOpen&&online&&!document.hidden&&inputFocused)(button.hidden||button.disabled?$('menuBtn'):button).focus?.();
}
function options(element,items,selected){
  const nodes=items.map(item=>{const option=document.createElement('option');option.value=String(item.id);option.textContent=item.label;option.disabled=item.disabled===true;return option;});
  element.replaceChildren(...nodes);element.value=String(selected??items[0]?.id??'');
}
function armoryPreviewRequested(){
  return equipmentOpen&&menuOpen&&inputFocused&&!document.hidden&&connected()&&menuState?.configurable===true&&
    ['ready','matchover'].includes(menuState.phase)&&!menuState.replay?.active&&!presentationBlocked();
}
function setEquipmentOpen(open){
  equipmentOpen=open;
  $('menuEquipmentPanel').hidden=!open;
  $('menuEquipmentToggle').setAttribute('aria-expanded',String(open));
  $('mobileMenu').classList.toggle('armory-preview',armoryPreviewRequested());
}
function gearAvailable(armory,group,id){
  return id===(group==='weapons'?'sword':'none')||armory?.[group]?.[id]?.unlocked===true;
}
function renderArmory(s,campaign){
  $('menuCampaignArmory').hidden=!campaign;
  if(!equipmentCatalog)return;
  const armory=campaign?s?.campaignArmory??{}:null;
  const key=armory?JSON.stringify(armory):'free';
  if(key===armoryOptionsKey)return;
  armoryOptionsKey=key;
  const selection=s?.fighters?.find(f=>f.slot===1)?.equipment;
  const wall=[];
  for(const [group,catalog,selectId,selected] of [
    ['weapons',equipmentCatalog.WEAPONS,'menuWeapon1',selection?.weapon],
    ['defenses',equipmentCatalog.DEFENSES,'menuDefense1',selection?.defense],
  ]){
    const items=Object.values(catalog).map(item=>{
      if(!armory)return item;
      const unlocked=gearAvailable(armory,group,item.id);
      if(item.id!=='none'){
        const row=document.createElement('li');
        const rival=safeText(armory[group]?.[item.id]?.rival,64);
        row.textContent=`${item.label} · ${unlocked?'Desbloqueado':rival?`Vencé a ${rival}`:'Bloqueado'}`;
        row.classList.toggle('armory-unlocked',unlocked);wall.push(row);
      }
      return {...item,disabled:!unlocked,label:unlocked?item.label:`${item.label} · Bloqueado`};
    });
    options($(selectId),items,selected??(group==='weapons'?'sword':armory?'none':'short'));
  }
  $('menuArmoryItems').replaceChildren(...wall);
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
function installEffectControls(){
  if(effectInputs.size)return;
  const groups=new Map();
  for(const effect of AUDIO_EFFECTS){
    if(!groups.has(effect.group)){
      const fieldset=document.createElement('fieldset'),legend=document.createElement('legend'),list=document.createElement('div');
      legend.textContent=effect.group;list.classList.add('menu-effect-list');fieldset.appendChild(legend);fieldset.appendChild(list);$('menuEffectGroups').appendChild(fieldset);groups.set(effect.group,list);
    }
    const label=document.createElement('label'),input=document.createElement('input'),caption=document.createElement('span');
    label.classList.add('menu-check');label.classList.add('menu-effect-toggle');input.type='checkbox';input.id='menuEffect_'+effect.id;
    input.setAttribute('aria-label',effect.label);caption.textContent=effect.label;label.appendChild(input);label.appendChild(caption);groups.get(effect.group).appendChild(label);
    input.addEventListener('change',()=>{if(!command('setEffectEnabled',{id:effect.id,enabled:input.checked},input.id))renderMenu();});
    effectInputs.set(effect.id,input);
  }
}
function renderEffectControls(s,usable){
  const count=$('menuEffectsCount'),hint=$('menuEffectsHint'),enable=$('menuEffectsEnableAll'),disable=$('menuEffectsDisableAll');
  // Before the first authority state, keep startup/connection independent of
  // catalogue DOM creation. A disconnect retains the last confirmed mask.
  if(!s&&authoritativeEffectMask===null){enable.disabled=true;disable.disabled=true;count.textContent='Esperando arena';return;}
  installEffectControls();
  const valid=!!s&&validEffectMask(s.effectMask);
  if(valid)authoritativeEffectMask=s.effectMask;
  let displayed=authoritativeEffectMask??ALL_EFFECTS_MASK,bulkPending=false,anyPending=false;
  for(const pending of pendingCommands.values()){
    if(pending.command==='setEffectMask'){displayed=pending.value;bulkPending=true;anyPending=true;}
    if(pending.command==='setEffectEnabled'){displayed=setEffectEnabled(displayed,pending.value.id,pending.value.enabled);anyPending=true;}
  }
  let active=0;
  for(const effect of AUDIO_EFFECTS){
    const input=effectInputs.get(effect.id);input.checked=effectEnabled(displayed,effect.id);if(input.checked)active++;
    input.disabled=!usable||!valid||bulkPending||awaiting(input.id);input.setAttribute('aria-busy',String(awaiting(input.id)||bulkPending));
  }
  enable.disabled=disable.disabled=!usable||!valid||anyPending;
  enable.setAttribute('aria-busy',String(awaiting(enable.id)));disable.setAttribute('aria-busy',String(awaiting(disable.id)));
  const text=`${active} / ${AUDIO_EFFECTS.length} activos${anyPending?' · pendiente':''}`;
  if(count.textContent!==text)count.textContent=text;
  const message=!usable?'Sin conexión. Se conserva la última selección confirmada.':!valid?'Esperando que la arena confirme los efectos.':
    !s.audioOn?'Podés preparar los efectos; el sonido general sigue apagado.':Number(s.volume)===0?'Podés preparar los efectos; el volumen general sigue en 0%.':
    s.effectsVolume===0?'Podés preparar los efectos; su volumen sigue en 0%.':anyPending?'Esperando confirmación de la arena para los cambios indicados.':'Elegí qué sonidos participan en el duelo. La música conserva su propio volumen.';
  if(hint.textContent!==message)hint.textContent=message;
}
function updateSoundLabel(slider){
  const label=soundLabel(slider.id,Number(slider.value)),output=$(slider.id+'Value');
  if(output.textContent!==label)output.textContent=label;
  if(slider.getAttribute('aria-valuetext')!==label)slider.setAttribute('aria-valuetext',label);
}
function renderSoundControls(s,usable){
  const audio=$('menuAudio'),toggle=pendingFor(audio.id);
  audio.disabled=!usable||!!toggle;
  if(s)audio.checked=toggle?.value??!!s.audioOn;
  for(const {id,field,fallback,min,max} of SOUND_SLIDERS){
    const slider=$(id),pending=pendingFor(id);
    slider.disabled=!usable||!!pending;
    if(!soundDragging.has(id))slider.value=String(pending?.value??clamp(Number.isFinite(s?.[field])?s[field]:fallback,min,max));
    updateSoundLabel(slider);
  }
  renderEffectControls(s,usable);
}
function renderStory(objective){
  const list=$('menuStoryChapters'),story=objective?.story;
  list.hidden=!story;
  if(!story)return;
  const active=story.nextChapter||story.chapter,signature=`${active}:${objective.completed}`;
  if(list.dataset.signature===signature)return;
  list.dataset.signature=signature;
  list.replaceChildren(...STORY_CHAPTERS.map(({title,boss},index)=>{
    const number=index+1,cleared=objective.completed||number<active;
    const item=document.createElement('li'),name=document.createElement('strong'),leader=document.createElement('small');
    item.dataset.cleared=String(cleared);
    if(!cleared&&number===active)item.setAttribute('aria-current','step');
    name.textContent=`${number}. ${title}`;
    leader.textContent=cleared?`Vencido · ${boss.name}`:boss.name;
    item.appendChild(name);item.appendChild(leader);return item;
  }));
}
function renderMenu(){
  const online=connected(),s=menuState,usable=online&&!!s;
  const sceneIssue=presentationReason(s);
  const preparing=[...pendingCommands.values()].some(item=>preparationCommands.has(item.command));
  const changingArena=[...pendingCommands.values()].some(item=>arenaActionCommands.has(item.command));
  const configurable=usable&&!!s.configurable&&!changingArena;
  const campaign=s?.mode==='solo'&&s?.experience==='campaign',campaignObjective=s?.objective;
  $('mobileMenu').classList.toggle('armory-preview',armoryPreviewRequested());
  renderArmory(s,campaign);
  $('menuCampaignControls').hidden=!campaign;
  const tierPending=[...pendingCommands.values()].find(item=>item.command==='setCampaignTier');
  $('menuCampaignTier').value=tierPending?.value??campaignObjective?.campaignTier??'normal';
  $('menuCampaignTier').disabled=!campaign||!configurable||preparing;
  $('menuCampaignAdvancedOption').disabled=!campaignObjective?.advancedUnlocked;
  $('menuCampaignAdvancedOption').textContent=campaignObjective?.advancedUnlocked?'Campaña avanzada · siete nuevos encuentros':'Campaña avanzada · bloqueada';
  $('menuCampaignReward').textContent=campaignObjective?.campaignTier==='bosses'?'Cuatro duelos. Cada victoria suma el equipo del rival al mural.':campaignObjective?.trophy==='master'?'Trofeo del Maestro obtenido.':campaignObjective?.advancedUnlocked?'Trofeo del Campeón obtenido. Tu equipo se conserva.':'Vencé a los cuatro jefes de la historia para desbloquear la campaña avanzada.';
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
  const quick=$('quickStartBtn'),quickReady=usable&&s.phase==='ready'&&!sceneIssue&&!s.replay?.active;
  if(!quickReady)quickStartAccepted=false;
  quick.hidden=!quickReady;
  quick.disabled=!quickReady||preparing||changingArena||quickStartAccepted;
  const quickPending=awaiting(quick.id)||quickStartAccepted;
  quick.textContent=quickPending?'Iniciando…':'Jugar';
  quick.setAttribute('aria-busy',String(quickPending));
  if(!quickReady)$('quickStartFeedback').hidden=true;
  $('menuConnection').textContent=!online?'Sin conexión con la arena. Los mandos se mantienen en neutro.':!s?'Conectado. Esperando las opciones de la arena.':'Conectado a la arena · los cambios requieren confirmación.';
  for(const [id,key]of Object.entries(menuFields)){if(s?.[key]!==undefined)$(id).value=String(s[key]);$(id).disabled=!usable||awaiting(id);}
  for(const id of mechanicalFields)$(id).disabled=!configurable||awaiting(id);
  if(s?.mode==='versus')$('menuExperience').disabled=true;
  if(s?.mode==='solo'&&s?.experience!=='duel'){for(const id of ['menuDifficulty','menuBestOf'])$(id).disabled=true;}
  if(s?.experience==='campaign'&&s?.mode==='solo'){for(const id of ['menuDifficulty','menuBestOf','menuArena'])$(id).disabled=true;}
  if(['fight','countdown'].includes(s?.phase)&&!s?.replay?.active)$('menuCamera').disabled=true;
  $('menuConfigNotice').textContent=sceneIssue|| (changingArena?'Esperando la acción solicitada. Los cambios de combate quedan en pausa.':preparing?'Esperando que la arena aplique tu selección antes de comenzar.':configurable?'Elegí las opciones y tocá Comenzar. Al confirmarse, volvés directamente a los mandos.':'La partida está en curso. Las opciones de combate se habilitan al terminar o preparar otra partida.');
  if(s){
    const own=s.fighters?.find(f=>f.slot===slot);if(own?.emblem){$('seatSymbol').textContent=own.emblem.glyph;$('seatSymbol').setAttribute('aria-label',own.emblem.name);for(const id of ['offKnob','mainKnob'])$(id).dataset.emblem=own.emblem.glyph;}
    const report=$('menuPerformanceReport');if(report){const labels={steady:'Duelo estable',clash:'Choques',detach:'Desprendimientos',burst:'Ruptura'};report.textContent=Object.entries(labels).map(([kind,label])=>{const m=s.performance?.[kind];return m?`${label}: ${m.fpsMean.toFixed(1)} FPS · P95 ${m.frameP95Ms.toFixed(1)} ms · pico ${m.sessionMaxMs.toFixed(1)} ms (${m.samples} cuadros)`:`${label}: sin muestras`;}).join('\n');}
    const scores=Array.isArray(s.scores)?s.scores:[0,0];$('menuScore').textContent=`${Number(scores[0])||0} : ${Number(scores[1])||0}`;$('scoreText').textContent=$('menuScore').textContent;
    $('menuRound').textContent=safeText(s.round,8);$('menuClock').textContent=safeText(s.clock,24);$('menuMatchMessage').textContent=safeText(s.message);
    const labels={ready:'EN ESPERA',countdown:'PREPARADOS',fight:'¡DUELO ACTIVO!',burst:'RONDA RESUELTA',matchover:'FIN DE PARTIDA'};$('phaseText').textContent=labels[s.phase]??safeText(s.phase,30);
    if(shell.dataset.phase!==s.phase)shell.dataset.phase=s.phase;
  }
  renderSoundControls(s,usable);
  $('menuCombatNotice').hidden=!['fight','countdown'].includes(s?.phase);
  $('menuCombatNotice').textContent=sceneIssue?'La partida está en pausa mientras se prepara la arena. Tus mandos permanecen en neutro.':localMode?'El juego está pausado mientras el menú está abierto. Cerralo para continuar.':'El duelo continúa mientras el menú está abierto. Tu muñeco queda con los mandos en neutro.';
  if(sceneIssue)$('phaseText').textContent=s?.assets?.loading?'CARGANDO ARENA':'ARENA EN PAUSA';
  const objective=s?.objective??{};$('menuObjectiveTitle').textContent=safeText(objective.title||'Actividad');$('menuObjectiveInstruction').textContent=safeText(objective.instruction||'Prepará tu muñeco para el próximo duelo.');
  renderStory(objective);
  $('menuObjectiveProgress').textContent=Number(objective.total)>0?`${Number(objective.progress)||0} / ${Number(objective.total)}${objective.completed?' · COMPLETADO':''}`:'';
  $('controlObjective').textContent=Number(objective.total)>0?`${$('menuObjectiveProgress').textContent} · ${safeText(objective.instruction)}`:'';$('controlObjective').hidden=!$('controlObjective').textContent;
  for(const n of [1,2]){
    const fighter=s?.fighters?.find(f=>f.slot===n),weapon=$(`menuWeapon${n}`),defense=$(`menuDefense${n}`),grip=$(`menuKnifeGrip${n}`);
    $(`menuFighter${n}`).textContent=`J${n} · ${safeText(fighter?.name||'Esperando rival',60)}`;
    $(`menuGuard${n}`).textContent=fighter?`${safeText(fighter.guardLabel,32)} ${Math.round(clamp(Number(fighter.guardPercent)||0,0,100))}% · ${Array.isArray(fighter.wins)?fighter.wins.filter(Boolean).length:0} victorias`:'';
    if(fighter?.equipment){weapon.value=safeText(fighter.equipment.weapon,24);defense.value=safeText(fighter.equipment.defense,24);grip.value=fighter.equipment.knifeGrip==='reverse'?'reverse':'normal';}
    const equipmentPending=awaiting(weapon.id)||awaiting(defense.id)||awaiting(grip.id),fixedOpponent=n===2&&s?.mode==='solo'&&['duel','campaign','parry','moving','depth'].includes(s?.experience);
    weapon.disabled=!configurable||!equipmentCatalog||!!s?.trainingEquipmentLocked||equipmentPending||fixedOpponent;
    defense.disabled=!configurable||!equipmentCatalog||!!s?.trainingEquipmentLocked||equipmentPending||fixedOpponent||!!equipmentCatalog?.WEAPONS?.[weapon.value]?.twoHanded;
    $(`menuKnifeGripField${n}`).hidden=defense.value!=='knife';
    grip.disabled=defense.disabled||defense.value!=='knife';
    if(n===slot&&fighter?.name)$('seatName').textContent=safeText(fighter.name,60);
  }
  $('menuEquipmentNotice').textContent=campaign?'Elegí las piezas que ganaste en la historia. El mazo ocupa ambas manos.':s?.trainingEquipmentLocked?s.trainingEquipmentReason||'Equipo de escuela fijado para aprender los mismos movimientos.':s?.mode==='solo'&&s?.experience==='duel'?'El encuentro establece el equipo del rival. Elegí tu arma y defensa antes de combatir.':'El mazo ocupa ambas manos. Elegí arma y defensa antes de combatir.';
  for(const id of menuButtons){$(id).disabled=!usable||awaiting(id);$(id).setAttribute('aria-busy',String(awaiting(id)));}
  const storyLabel=storyAdvanceLabel(objective);
  $('menuStartBtn').disabled=!usable||!!sceneIssue||!!s?.replay?.active||!['ready','matchover'].includes(s?.phase)||preparing||changingArena;$('menuStartBtn').textContent=awaiting('menuStartBtn')?'INICIANDO…':s?.phase==='matchover'?(storyLabel||(objective.story&&objective.nextAction==='advance'?'SIGUIENTE ENCUENTRO':'REVANCHA')):'COMENZAR';
  const startVisible=!s||!s.replay?.active&&['ready','matchover'].includes(s.phase);
  $('menuStartBtn').hidden=!startVisible;$('menuBackBtn').hidden=startVisible;
  $('menuNextBtn').hidden=!objective.nextAction;$('menuNextBtn').disabled=!usable||!!sceneIssue||!!s?.replay?.active||!objective.nextAction||preparing||changingArena||campaign&&objective.completed&&!configurable;$('menuNextBtn').textContent=awaiting('menuNextBtn')?'PREPARANDO…':objective.nextAction==='retry'?'REINTENTAR ENCUENTRO':objective.nextAction==='repeat'?'REPETIR ACTIVIDAD':storyLabel||'SIGUIENTE ENCUENTRO';
  if(!awaiting('menuNextBtn')&&campaign&&objective.completed)$('menuNextBtn').textContent=activityCommand(s)==='beginAdvancedCampaign'?'INICIAR CAMPAÑA AVANZADA':'REPETIR ÚLTIMO ENCUENTRO';
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
$('quickStartBtn').addEventListener('click',()=>{if(!menuOpen)command('start',undefined,'quickStartBtn');});
$('menuBtn').addEventListener('click',openMenu);
$('menuCloseBtn').addEventListener('click',closeMenu);
$('menuBackBtn').addEventListener('click',()=>closeMenu({toControls:true}));
const menuPages=Object.entries({Game:'menuGameTitle',Controls:'menuControlsTitle',Equipment:'menuEquipmentTitle',Presentation:'menuPresentationTitle',Sound:'menuSoundTitle',Replay:'menuReplayTitle'}).map(([name,id])=>({
  name,heading:$(id),button:$('menuJump'+name),panel:$('menuPage'+name)
}));
for(const page of menuPages){
  page.heading.tabIndex=-1;
  page.button.addEventListener('click',()=>{
    if(equipmentOpen&&page.name!=='Equipment'){setEquipmentOpen(false);send();}
    for(const entry of menuPages){
      entry.panel.hidden=entry!==page;
      entry.button.setAttribute('aria-current',String(entry===page));
    }
    $('menuContent').scrollTop=0;
    page.heading.focus({preventScroll:true});
  });
}
$('menuEquipmentToggle').addEventListener('click',()=>{setEquipmentOpen(!equipmentOpen);send();});
for(const event of ['pointerdown','focusin'])$('mobileMenu').addEventListener(event,({target})=>{
  if(equipmentOpen&&target&&!$('menuEquipmentSection').contains?.(target)){setEquipmentOpen(false);send();}
});
$('mobileMenu').addEventListener('cancel',event=>{event.preventDefault();closeMenu();});$('mobileMenu').addEventListener('close',()=>{if(menuOpen)closeMenu();});
$('mobileMenu').addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();closeMenu();return;}if(event.key!=='Tab')return;
  const items=[...($('mobileMenu').querySelectorAll?.('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary,a[href]')??[])].filter(e=>{
    const closed=e.closest?.('details:not([open])');
    return !e.hidden&&!e.closest?.('[hidden]')&&(!closed||e===closed.firstElementChild);
  });
  if(!items.length)return;const first=items[0],last=items.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
for(const [id,commandName,allowed,numeric]of [
  ['menuMode','setMode',['solo','versus']],['menuExperience','setExperience',['duel','training','practice','precision','campaign','parry','moving','depth']],['menuDifficulty','setDifficulty',['rookie','normal','expert','boss']],
  ['menuBestOf','setBestOf',['3','5'],true],['menuArena','setArena',['atelier','midnight','dojo']],['menuQuality','setQuality',['high','ultra','eco']],['menuPerformanceMode','setPerformanceMode',['adaptive','fixed']],['menuCamera','setCamera',['combat','detail']],['menuLighting','setLighting',['cinematic','neutral']],['menuReplaySpeed','replaySpeed',['0.25','0.5','1'],true]
])$(id).addEventListener('change',()=>{const value=$(id).value;if(!allowed.includes(value)){renderMenu();return;}command(commandName,numeric?Number(value):value,id);});
$('menuCampaignTier').addEventListener('change',()=>{const value=$('menuCampaignTier').value;if(!CAMPAIGN_TIERS.includes(value)||value==='advanced'&&!menuState?.objective?.advancedUnlocked){renderMenu();return;}if(!command('setCampaignTier',value,'menuCampaignTier'))renderMenu();});
$('menuStartBtn').addEventListener('click',()=>{
  const objective=menuState?.objective,continueStory=menuState?.phase==='matchover'&&objective?.story&&objective.nextAction==='advance';
  command(continueStory?'nextEncounter':'start',undefined,'menuStartBtn');
});
for(const [id,name]of [['menuResetBtn','reset'],['menuCampaignResetBtn','resetCampaign'],['menuReplayToggleBtn','replayToggle'],['menuReplayCloseBtn','replayClose'],['menuReplayClearBtn','replayClear']])$(id).addEventListener('click',()=>command(name,undefined,id));
$('menuNextBtn').addEventListener('click',()=>command(activityCommand(menuState),undefined,'menuNextBtn'));
$('menuAudio').addEventListener('change',()=>command('setAudio',$('menuAudio').checked,'menuAudio'));
for(const [id,mask]of [['menuEffectsEnableAll',ALL_EFFECTS_MASK],['menuEffectsDisableAll',0]])$(id).addEventListener('click',()=>{if(!command('setEffectMask',mask,id))renderMenu();});
for(const {id,command:action,min,max} of SOUND_SLIDERS){
  const slider=$(id);
  slider.addEventListener('input',()=>{soundDragging.add(id);updateSoundLabel(slider);});
  slider.addEventListener('change',()=>{
    soundDragging.delete(id);
    const value=Number(slider.value);
    if(!Number.isFinite(value)||!command(action,Math.round(clamp(value,min,max)),id))renderMenu();
  });
}
$('menuReplayOpenBtn').addEventListener('click',()=>{const id=Number($('menuReplayClip').value);if(Number.isSafeInteger(id)&&id>0)command('replayOpen',id,'menuReplayOpenBtn');});
$('menuReplaySeek').addEventListener('input',()=>{seekDragging=true;$('menuReplayPosition').textContent=`${Math.round(Number($('menuReplaySeek').value)/10)}%`;});
$('menuReplaySeek').addEventListener('change',()=>{seekDragging=false;const fraction=Number($('menuReplaySeek').value)/1000;if(Number.isFinite(fraction))command('replaySeek',clamp(fraction,0,1),'menuReplaySeek');});
for(const n of [1,2])for(const type of ['Weapon','Defense','KnifeGrip'])$(`menu${type}${n}`).addEventListener('change',()=>{
  if(!equipmentCatalog)return;
  const knifeGrip=$(`menuKnifeGrip${n}`).value;
  if(!['normal','reverse'].includes(knifeGrip)){renderMenu();return;}
  const loadout=equipmentCatalog.normalizeLoadout({weapon:$(`menuWeapon${n}`).value,defense:$(`menuDefense${n}`).value,knifeGrip});
  if(n===1&&menuState?.mode==='solo'&&menuState.experience==='campaign'&&
    (!gearAvailable(menuState.campaignArmory,'weapons',loadout.weapon)||!gearAvailable(menuState.campaignArmory,'defenses',loadout.defense))){renderMenu();return;}
  command('setLoadout',{slot:n,...loadout},`menu${type}${n}`);
});
renderMenu();
$('mobileHeadTouch').addEventListener('change',()=>{
  $('mobileHeadPanel').hidden=!$('mobileHeadTouch').checked;
  neutralize();
  if($('mobileHeadTouch').checked)closeMenu({toControls:true});
});
setInterval(send,33);
setInterval(()=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'ping',at:Date.now()}));},2000);
connect();
