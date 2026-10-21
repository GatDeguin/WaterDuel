import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMenuCommand,sanitizeMenuState} from '../public/remote-menu.js';
import {HostSession} from '../public/host-session.js';
let requestId=0;
const command=value=>({type:'command',requestId:++requestId,sentAt:1234,command:'setPerformanceMode',value});

test('fluidez: comando estricto admite sólo adaptive/fixed sin coerciones ni datos extra',()=>{
  for(const value of ['adaptive','fixed']){
    const source={...command(value),secret:'omit',quality:'eco'},clean=normalizeMenuCommand(source);
    assert.deepEqual(clean,{requestId:source.requestId,sentAt:1234,command:'setPerformanceMode',value});
  }
  for(const value of [undefined,null,true,false,0,1,'Adaptive','fixed ','eco',{},[],new String('adaptive')])assert.equal(normalizeMenuCommand(command(value)),null);
});

test('fluidez: menuState sanitiza el modo, devuelve copia fresca y deja quality independiente',()=>{
  for(const value of ['adaptive','fixed']){
    const source={performanceMode:value,quality:'ultra'},first=sanitizeMenuState(source),second=sanitizeMenuState(source);
    assert.equal(first.performanceMode,value);assert.equal(first.quality,'ultra');assert.notEqual(first,second);
    source.performanceMode='bad';first.performanceMode='bad';assert.equal(second.performanceMode,value);
    assert.equal(sanitizeMenuState(second).performanceMode,value);
  }
  for(const performanceMode of [undefined,null,'bad',true,{},['fixed']])assert.equal(sanitizeMenuState({performanceMode}).performanceMode,'fixed');
});

test('fluidez: estado ausente o inválido conserva fixed sin activar el experimento',()=>{
  for(const state of [undefined,null,[],{},'adaptive',false,{performanceMode:undefined},{performanceMode:'Adaptive'},{performanceMode:0},{performanceMode:NaN},{performanceMode:new String('adaptive')}]){
    const first=sanitizeMenuState(state);assert.equal(first.performanceMode,'fixed');assert.equal(sanitizeMenuState(first).performanceMode,'fixed');
  }
  assert.equal(sanitizeMenuState({performanceMode:'adaptive'}).performanceMode,'adaptive','la opción experimental requiere el valor explícito válido');
});

test('fluidez: Host inicia fixed sin callbacks y cambiar modo sólo notifica performance',()=>{
  const settings=[],neutralizations=[];const host=new HostSession({onSettings:value=>settings.push(value),onNeutralize:()=>neutralizations.push(true)});
  assert.equal(host.performanceMode,'fixed');assert.equal(host.menuState().performanceMode,'fixed');assert.deepEqual(settings,[]);
  const game=host.game,fighters=[...game.fighters],quality=game.quality;
  game.phase='fight';game.clock=12;game.phaseClock=2;const scores=[...game.scores];
  assert.equal(host.handleCommand(command('adaptive')).ok,true);
  assert.equal(host.performanceMode,'adaptive');assert.equal(host.menuState().performanceMode,'adaptive');assert.deepEqual(settings,['performance']);assert.deepEqual(neutralizations,[]);
  assert.equal(host.game,game);fighters.forEach((fighter,i)=>assert.equal(game.fighters[i],fighter));assert.equal(game.phase,'fight');assert.equal(game.clock,12);assert.equal(game.phaseClock,2);assert.deepEqual(game.scores,scores);assert.equal(game.quality,quality);
  assert.equal(host.handleCommand({...command('adaptive'),value:'fastest'}).ok,false);assert.equal(host.performanceMode,'adaptive');assert.deepEqual(settings,['performance']);
  const menu=host.menuState();menu.performanceMode='fixed';assert.equal(host.menuState().performanceMode,'adaptive');
});

test('fluidez: modo de presentación permite combate/replay y setQuality conserva su techo por separado',()=>{
  const settings=[],host=new HostSession({onSettings:value=>settings.push(value)});
  for(const phase of ['ready','countdown','fight','burst','matchover']){
    host.game.phase=phase;assert.equal(host.handleCommand(command('fixed')).ok,true,phase);assert.equal(host.handleCommand(command('adaptive')).ok,true,phase);
  }
  host.playback={paused:true};assert.equal(host.handleCommand(command('fixed')).ok,true);assert.equal(host.playback.paused,true);host.playback=null;
  assert.equal(host.handleCommand({...command('fixed'),command:'setQuality',value:'ultra'}).ok,true);
  assert.equal(host.performanceMode,'fixed');assert.equal(host.game.quality,'ultra');assert.equal(host.menuState().quality,'ultra');assert.equal(settings.at(-1),'quality');
  assert.equal(host.handleCommand(command('adaptive')).ok,true);assert.equal(host.game.quality,'ultra');assert.equal(settings.at(-1),'performance');
});
