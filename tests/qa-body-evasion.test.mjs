import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {HostSession} from '../public/host-session.js';
import {STEP,neutral} from '../public/engine.js';
import {RadialJoystick,movementGesture,weaponGesture} from '../public/joysticks.js';
import {FEINT_DURATION,FEINT_PEAK_FRACTION} from '../public/physics/body-evasion.js';

const markup=await readFile(new URL('../public/qa/body-evasion-checks.html',import.meta.url),'utf8');
const source=markup.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import[^\n]+;\s*$/gm,'');
class Element{
 constructor(id){this.id=id;this.textContent='';this.disabled=false;this.dataset={};this.style={setProperty(){}};this.listeners=new Map();this.captures=new Set();this.attrs=new Map();this.classList={toggle(){}};this.width=1280;this.height=490;}
 addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(callback);}
 fire(type,data={}){const e={target:this,preventDefault(){},...data};for(const cb of this.listeners.get(type)??[])cb(e);}
 setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.get(k)??null;}
 getBoundingClientRect(){const size=/Knob$/.test(this.id)?28:100;return {left:0,top:0,width:size,height:size};}
 setPointerCapture(id){this.captures.add(id);}hasPointerCapture(id){return this.captures.has(id);}
 releasePointerCapture(id){if(this.captures.delete(id))this.fire('lostpointercapture',{pointerId:id});}
}
async function fixture(){
 const elements=new Map([...markup.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
 const frames=[],events=new Map();let renderer,clock=0,reloads=0;
 class TestRenderer{
  constructor(){renderer=this;this.assetStatus={ready:0,total:11,loading:true,names:[],errors:[]};this.stats={draws:0};}
  async loadAssets(callback){this.assetStatus={ready:11,total:11,loading:false,names:['fixture-renderer-boundary'],errors:[]};callback(this.assetStatus);return this.assetStatus;}
  render(scene,time){this.scene=scene;this.time=time;}dispose(){this.disposed=true;}
 }
 const document={hidden:false,getElementById:id=>elements.get(id),addEventListener:(name,fn)=>events.set('document:'+name,fn)};
 const context=vm.createContext({HostSession,STEP,neutral,RadialJoystick,movementGesture,weaponGesture,FEINT_DURATION,FEINT_PEAK_FRACTION,Renderer3D:TestRenderer,
  document,performance:{now:()=>clock},console,Date,requestAnimationFrame:callback=>frames.push(callback),
  addEventListener:(name,fn)=>events.set(name,fn),location:{reload:()=>reloads++}});
 new vm.Script(source,{filename:'body-evasion-checks.html'}).runInContext(context);
 await Promise.resolve();await Promise.resolve();
 const el=id=>{assert.ok(elements.has(id),id);return elements.get(id);};
 const state=()=>JSON.parse(el('snapshot').textContent);
 const advance=(count=1)=>{for(let i=0;i<count;i++){clock+=1000/120;assert.ok(frames.length);frames.shift()(clock);}};
 return {el,state,advance,events,document,renderer,frames,get reloads(){return reloads;},click(id){assert.equal(el(id).disabled,false);el(id).fire('click');},fight(){this.click('start');for(let i=0;i<410&&state().phase!=='fight';i++)advance();assert.equal(state().phase,'fight');}};
}

test('La fixture usa host real en Versus, dos pads reales y sólo expone evidencia local segura',async()=>{
 const f=await fixture(),s=f.state();assert.equal(s.mode,'versus');assert.equal(s.phase,'ready');assert.equal(s.assets.ready,11);
 assert.match(s.scope,/aislada/i);assert.equal(s.transport,'none');
 assert.doesNotMatch(source,/WebSocket|\/api\/session|hostToken|localStorage|fetch\s*\(/);
 f.el('offPad').fire('pointerdown',{pointerId:1,clientX:50,clientY:86});f.advance(2);assert.equal(f.state().fighters[0].control.bodyY??0,0);
 assert.equal(f.renderer.scene.mode,'versus');
});

test('El mando izquierdo entra por movementGesture y setControl cada STEP y agacha el rig real',async()=>{
 const f=await fixture();f.fight();const before=f.state().fighters[0].pelvis.y;
 f.el('offPad').fire('pointerdown',{pointerId:1,clientX:50,clientY:86});f.advance(70);
 const crouch=f.state().fighters[0];assert.equal(crouch.control.bodyY,-1);assert.equal(crouch.control.lean,0);
 assert.ok(crouch.evasion.crouch>.7);assert.ok(crouch.pelvis.y<before-.10);
 assert.ok(crouch.water.retained>0);assert.ok(crouch.membrane.support);assert.ok(crouch.feet.front&&crouch.feet.back);
 f.el('offPad').fire('pointerup',{pointerId:1});f.advance(35);assert.equal(f.state().fighters[0].control.bodyY,0);
});

test('Flecha arriba pide una única finta sostenida y el derecho actúa sin botón de ataque',async()=>{
 const f=await fixture();f.fight();
 f.el('offPad').fire('keydown',{key:'ArrowUp'});f.advance(35);assert.equal(f.state().fighters[0].control.bodyY,1);assert.ok(f.state().fighters[0].evasion.feint>0);
 f.advance(120);assert.equal(f.state().fighters[0].evasion.feint,0,'mantener arriba no reinicia la finta');
 f.el('offPad').fire('keyup',{key:'ArrowUp'});
 f.el('mainPad').fire('pointerdown',{pointerId:2,clientX:50,clientY:14});f.advance(20);
 const control=f.state().fighters[0].control;assert.equal(control.mainY,1);assert.equal(control.wrist,.65);assert.equal(control.attackHeld,true);assert.equal(control.thrust,false);
 assert.equal(f.state().fighters[1].control.mainY,-1);assert.equal(f.state().fighters[1].control.attackHeld,false);
});

test('Preparación, pérdida de foco y ocultación cancelan gestos, deuda y captura',async()=>{
 const f=await fixture();f.fight();f.el('offPad').fire('keydown',{key:'ArrowDown'});f.advance(3);
 f.events.get('blur')();f.advance(35);assert.equal(f.state().fighters[0].control.bodyY??0,0);assert.equal(f.state().paused,true);
 f.events.get('focus')();f.advance(3);assert.equal(f.state().fighters[0].control.bodyY??0,0);
 f.el('offPad').fire('pointerdown',{pointerId:7,clientX:50,clientY:86});f.click('prepare');
 assert.equal(f.state().phase,'ready');assert.equal(f.el('offPad').captures.size,0);assert.equal(f.state().fighters[0].control.bodyY??0,0);
 f.document.hidden=true;f.events.get('document:visibilitychange')();const clock=f.state().clock;f.advance(6);assert.equal(f.state().clock,clock);
});

test('Pagehide libera el renderer y volver desde bfcache reconstruye la fixture',async()=>{
 const f=await fixture();f.events.get('pagehide')();assert.equal(f.renderer.disposed,true);
 f.events.get('pageshow')({persisted:false});assert.equal(f.reloads,0);f.events.get('pageshow')({persisted:true});assert.equal(f.reloads,1);
});

test('Inspección abajo sólo entra en fight y sostiene una intención real hasta Centrar',async()=>{
 const f=await fixture();assert.equal(f.el('holdCrouch').disabled,true);assert.equal(f.el('inspectFeint').disabled,true);f.fight();
 const before=f.state().fighters[0].pelvis.y;f.click('holdCrouch');f.advance(70);
 let s=f.state();assert.equal(s.inspectionMode,'hold-crouch');assert.equal(s.paused,false);assert.equal(s.fighters[0].control.bodyY,-1);assert.ok(s.fighters[0].pelvis.y<before-.10);
 f.advance(60);assert.equal(f.state().fighters[0].control.bodyY,-1);
 f.click('centerInspection');f.advance(20);s=f.state();assert.equal(s.inspectionMode,'none');assert.equal(s.fighters[0].control.bodyY,0);
});

test('La inspección de finta pausa el scheduler al pico resuelto, sin mover poses manualmente',async()=>{
 const f=await fixture();f.fight();f.click('inspectFeint');
 for(let i=0;i<80&&!f.state().paused;i++)f.advance();
 const peak=f.state();assert.equal(peak.inspectionMode,'feint-peak');assert.equal(peak.paused,true);
 const peakAge=FEINT_DURATION*FEINT_PEAK_FRACTION;
 assert.ok(peak.fighters[0].evasion.age>=peakAge&&peak.fighters[0].evasion.age<peakAge+STEP+1e-12);
 assert.equal(peak.fighters[0].control.bodyY,1);assert.ok(peak.fighters[0].evasion.feint>.99);
 f.advance(100);const held=f.state();assert.equal(held.clock,peak.clock);assert.deepEqual(held.fighters[0].head,peak.fighters[0].head);assert.deepEqual(held.fighters[0].pelvis,peak.fighters[0].pelvis);
});

test('Centrar reanuda sin intención ni deuda de la pausa y Preparación borra la inspección',async()=>{
 const f=await fixture();f.fight();f.click('inspectFeint');for(let i=0;i<80&&!f.state().paused;i++)f.advance();
 f.advance(100);const clock=f.state().clock;f.click('centerInspection');assert.equal(f.state().paused,false);assert.equal(f.state().inspectionMode,'none');
 f.advance(20);const resumed=f.state();assert.equal(resumed.fighters[0].control.bodyY,0);assert.ok(resumed.clock>clock&&resumed.clock-clock<.2);
 f.click('holdCrouch');f.advance(20);f.click('prepare');assert.equal(f.state().phase,'ready');assert.equal(f.state().inspectionMode,'none');assert.equal(f.state().paused,false);
});
