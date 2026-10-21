import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {HostSession} from '../public/host-session.js';
import {STEP} from '../public/engine.js';
import {WEAPONS,DEFENSES} from '../public/equipment.js';

const markup=await readFile(new URL('../public/qa/equipment-selection.html',import.meta.url),'utf8');
const moduleSource=markup.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import[^\n]+;\s*$/gm,'');
class Element{
 constructor(){this.value='';this.textContent='';this.disabled=false;this.children=[];this.listeners=new Map();this.width=1280;this.height=720;}
 replaceChildren(...children){this.children=children;}
 addEventListener(name,fn){this.listeners.set(name,fn);}
 fire(name){return this.listeners.get(name)?.();}
}
function fixture(){
 const elements=new Map([...markup.matchAll(/id="([^"]+)"/g)].map(match=>[match[1],new Element()]));
 const frames=[];let renderer;
 class TestRenderer{
  constructor(){renderer=this;this.assetStatus={ready:0,total:11,loading:true,errors:[]};this.assetScene={equipment:{}};this.stats={draws:0};this.disposed=false;}
  async loadAssets(callback){this.assetStatus={ready:11,total:11,loading:false,errors:[]};this.assetScene.equipment=Object.fromEntries(['sword','spear','axe','maul','short','long','knife'].map(id=>[id,{}]));callback(this.assetStatus);}
  render(scene){this.scene=scene;}
  dispose(){this.disposed=true;}
 }
 const events=new Map();let reloads=0;
 const context=vm.createContext({document:{getElementById:id=>elements.get(id),createElement:()=>new Element()},
  HostSession,STEP,WEAPONS,DEFENSES,Renderer3D:TestRenderer,performance:{now:()=>0},Date,console,
  requestAnimationFrame:fn=>frames.push(fn),addEventListener:(name,fn)=>events.set(name,fn),location:{reload:()=>reloads++}});
 new vm.Script(moduleSource,{filename:'equipment-selection.html'}).runInContext(context);
 const el=id=>elements.get(id),state=()=>JSON.parse(el('result').textContent);
 return {el,state,renderer,events,frames,get reloads(){return reloads;},change(id,value){assert.equal(el(id).disabled,false);el(id).value=value;el(id).fire('change');},click(id){assert.equal(el(id).disabled,false);el(id).fire('click');}};
}

test('fixture pública inicia en Versus, presenta cuatro armas/cuatro secundarias y no incluye transporte autenticado',()=>{
 const f=fixture();assert.equal(f.state().mode,'versus');assert.equal(f.state().assets.ready,11);
 for(const n of [1,2]){
  assert.deepEqual(f.el('weapon'+n).children.map(item=>item.value),['sword','spear','axe','maul']);
  assert.deepEqual(f.el('defense'+n).children.map(item=>item.value),['short','long','none','knife']);
 }
 assert.doesNotMatch(moduleSource,/WebSocket|\/api\/session|hostToken|controller\.html|fetch\s*\(/);
});

test('selectores reales de la fixture cambian equipos e intercambian ambos jugadores mediante HostSession',()=>{
 const f=fixture();f.change('weapon1','spear');f.change('defense1','long');f.change('weapon2','axe');f.change('defense2','knife');
 assert.deepEqual(f.state().loadouts,[{weapon:'spear',defense:'long'},{weapon:'axe',defense:'knife'}]);
 f.click('swap');assert.deepEqual(f.state().loadouts,[{weapon:'axe',defense:'knife'},{weapon:'spear',defense:'long'}]);
 assert.ok(f.state().commands.every(item=>item.ok));
});

test('mazo ocupa ambas manos en ambos slots y cuchillo solo es una elección secundaria',()=>{
 const f=fixture();
 for(const n of [1,2]){
  f.change('defense'+n,'knife');f.change('weapon'+n,'maul');
  assert.deepEqual(f.state().loadouts[n-1],{weapon:'maul',defense:'none'});assert.equal(f.el('defense'+n).disabled,true);
  f.change('weapon'+n,'sword');assert.equal(f.el('defense'+n).disabled,false);f.change('defense'+n,'knife');
  assert.deepEqual(f.state().loadouts[n-1],{weapon:'sword',defense:'knife'});
  assert.ok(!f.el('weapon'+n).children.some(option=>option.value==='knife'));
 }
});

test('cuenta atrás bloquea selección/intercambio y reset devuelve preparación conservando el equipo',()=>{
 const f=fixture();f.change('weapon1','maul');const before=f.state().loadouts;f.click('fight');assert.equal(f.state().phase,'countdown');
 for(const id of ['weapon1','defense1','weapon2','defense2','swap','fight'])assert.equal(f.el(id).disabled,true);
 f.click('reset');assert.equal(f.state().phase,'ready');assert.deepEqual(f.state().loadouts,before);
 assert.equal(f.el('weapon1').disabled,false);assert.equal(f.el('defense1').disabled,true);
 f.frames.shift()(17);assert.equal(f.renderer.scene.mode,'versus');f.events.get('pagehide')();assert.equal(f.renderer.disposed,true);
});

test('volver desde caché de navegación reinicia la fixture cuyo renderer fue dispuesto',()=>{
 const f=fixture();f.events.get('pagehide')();assert.equal(f.renderer.disposed,true);
 assert.equal(typeof f.events.get('pageshow'),'function');
 f.events.get('pageshow')({persisted:false});assert.equal(f.reloads,0);
 f.events.get('pageshow')({persisted:true});assert.equal(f.reloads,1);
});
