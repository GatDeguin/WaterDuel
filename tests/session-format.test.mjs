import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP,neutral} from '../public/engine.js';
import {matchView} from '../public/match-view.js';

test('Mejor de cinco termina a tres victorias y el HUD usa el mismo formato',()=>{
 const g=new DuelEngine();assert.equal(g.setBestOf(5),true);assert.equal(g.bestOf,5);assert.equal(g.roundsToWin,3);
 g.scores=[2,1];g.winner=1;g.phase='burst';g.phaseClock=3.24;g.update(.02);
 assert.equal(g.phase,'countdown','dos victorias no bastan');
 g.scores=[3,1];g.winner=1;g.phase='burst';g.phaseClock=3.24;g.update(.02);
 assert.equal(g.phase,'matchover');const view=matchView(g);assert.equal(view.fighters[0].wins.length,3);assert.equal(view.formatLabel,'MEJOR DE 5 · A 3');
});
test('El formato no cambia en pelea/cuenta atrás/ruptura ni acepta valores inválidos',()=>{
 const g=new DuelEngine();for(const n of [0,4,7,Infinity,'5',null])assert.equal(g.setBestOf(n),false);
 for(const phase of ['fight','countdown','burst']){g.phase=phase;assert.equal(g.setBestOf(5),false);assert.equal(g.bestOf,3);}
 g.phase='matchover';assert.equal(g.setBestOf(5),true);g.resetMatch();assert.equal(g.bestOf,5);
});
test('Práctica conserva los contactos/puntos reales pero reinicia rondas sin declarar ganador de partida',()=>{
 const events=[],g=new DuelEngine((name,data)=>events.push({name,data}));
 assert.equal(g.setScenario('practice'),true);g.scores=[6,0];g.winner=1;g.phase='burst';g.phaseClock=3.24;g.update(.02);
 assert.equal(g.phase,'countdown');assert.deepEqual(g.scores,[6,0]);assert.equal(events.some(e=>e.name==='matchover'),false);
 assert.equal(matchView(g).formatLabel,'PRÁCTICA LIBRE');
 assert.equal(g.setScenario('duel'),false);g.phase='ready';assert.equal(g.setScenario('duel'),true);
});
test('Desactivar IA en modo individual deja el objetivo neutral usando el mismo rig físico',()=>{
 const events=[],g=new DuelEngine((name,data)=>events.push({name,data}));g.phase='fight';g.aiEnabled=false;
 g.fighters[1].controller={...neutral(),thrust:true,lean:1};
 for(let i=0;i<30;i++)g.update(STEP);
 assert.deepEqual(g.fighters[1].controller,neutral());assert.equal(events.some(e=>e.name==='thrust'&&e.data.slot===2),false);
 assert.equal(g.fighters[1].pose.dynamic,true);assert.equal(g.fighters[1].globIntact,true);
});
test('La detección competitiva emite impacto propio y velocidad observada; la demo no se hace pasar por contacto',()=>{
 const events=[],g=new DuelEngine((name,data)=>events.push({name,data}));g.mode='versus';g.phase='fight';const [a,b]=g.fighters,h=b.pose.head;
 a.previousTip={x:h.x-.6,y:h.y,z:.17};a.pose={...a.pose,tip:{x:h.x+.1,y:h.y,z:.17}};a.lunge=.8;
 g.detectHits();const event=events.find(e=>e.name==='burst').data;
 assert.equal(event.contact,true);assert.equal(event.demonstration,false);assert.ok(event.relativeSpeed>0);assert.ok(Number.isFinite(event.impact.x));
 const x=event.impact.x;b.pose.head.x+=2;assert.equal(event.impact.x,x);
 g.resetMatch();g.phase='fight';g.burst(g.fighters[1],g.fighters[0],g.fighters[1].pose.head,false,{demonstration:true});
 const demo=events.filter(e=>e.name==='burst').at(-1).data;assert.equal(demo.contact,false);assert.equal(demo.demonstration,true);
});
