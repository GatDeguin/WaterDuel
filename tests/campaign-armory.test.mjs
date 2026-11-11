import test from 'node:test';
import assert from 'node:assert/strict';
import {HostSession} from '../public/host-session.js';
import {CAMPAIGN,SINGLE_PLAYER_STORAGE_KEY} from '../public/single-player.js';
import {sanitizeMenuState} from '../public/remote-menu.js';
import {captureReplayState,replayView} from '../public/replay.js';
import {sampleWeather} from '../public/weather.js';

const memory=(entries=[])=>{
  const values=new Map(entries);
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
};
const command=(host,name,value)=>host.handleCommand({type:'command',requestId:1,sentAt:1,command:name,value});
const equip=(host,weapon,defense)=>command(host,'setLoadout',{slot:1,weapon,defense});
const story=host=>assert.equal(command(host,'setExperience','campaign').ok,true);
function result(host,winner=1,data={}){
  const game=host.game;
  game.phase='matchover';game.winner=winner;game.scores=winner===1?[2,0]:[0,2];
  game.onEvent('matchover',{winner,...data});
}

test('La historia presta espada y mano libre, valida premios y restaura las selecciones de Versus',()=>{
  const storage=memory(),host=new HostSession({storage});
  assert.equal(command(host,'setMode','versus').ok,true);
  assert.equal(equip(host,'maul','none').ok,true);
  assert.equal(command(host,'setLoadout',{slot:2,weapon:'axe',defense:'knife',knifeGrip:'reverse'}).ok,true);
  const versus=structuredClone(host.game.loadouts);
  assert.equal(command(host,'setMode','solo').ok,true);
  assert.equal(command(host,'setExperience','training').ok,true);
  story(host);
  assert.deepEqual(host.game.loadouts[0],{weapon:'sword',defense:'none'});
  const initial=host.menuState().campaignArmory;
  const firstAxe=CAMPAIGN.findIndex(entry=>entry.opponentLoadout.weapon==='axe');
  assert.deepEqual(initial.weapons.axe,{unlocked:false,rival:CAMPAIGN[firstAxe].name});
  assert.deepEqual(initial.defenses.short,{unlocked:false,rival:CAMPAIGN[0].name});
  assert.equal(equip(host,'axe','none').ok,false);
  assert.equal(equip(host,'sword','short').ok,false);
  result(host,1,{demonstration:true});
  assert.equal(host.menuState().campaignArmory.defenses.short.unlocked,false);
  result(host,2);
  assert.equal(host.menuState().campaignArmory.defenses.short.unlocked,false);
  assert.equal(command(host,'nextEncounter').ok,true);
  result(host);
  assert.equal(host.menuState().campaignArmory.defenses.short.unlocked,true);
  assert.equal(host.menuState().campaignArmory.weapons.axe.unlocked,false);
  assert.equal(equip(host,'sword','short').ok,true);
  assert.equal(command(host,'nextEncounter').ok,true);
  assert.deepEqual(host.game.loadouts[0],{weapon:'sword',defense:'short'});
  assert.equal(command(host,'reset').ok,true);
  for(let stage=1;stage<firstAxe;stage++){
    result(host);
    assert.equal(host.menuState().campaignArmory.weapons.axe.unlocked,false);
    assert.equal(command(host,'nextEncounter').ok,true);
  }
  result(host);
  assert.equal(equip(host,'axe','long').ok,true);
  assert.equal(command(host,'setMode','versus').ok,true);
  assert.deepEqual(host.game.loadouts,versus);
  assert.equal(host.menuState().campaignArmory,undefined);
  assert.equal(command(host,'setMode','solo').ok,true);
  assert.deepEqual(host.game.loadouts[0],{weapon:'axe',defense:'long'});
  const restored=new HostSession({storage});story(restored);
  assert.equal(restored.menuState().campaignArmory.weapons.axe.unlocked,true);
  assert.equal(restored.menuState().campaignArmory.defenses.long.unlocked,true);
  assert.equal(restored.menuState().campaignArmory.defenses.knife.unlocked,true);
  assert.equal(command(host,'resetCampaign').ok,true);
  assert.deepEqual(host.game.loadouts[0],{weapon:'sword',defense:'none'});
  assert.equal(host.menuState().campaignArmory.weapons.axe.unlocked,false);
  assert.equal(storage.getItem(SINGLE_PLAYER_STORAGE_KEY),null);
});

test('Las partidas guardadas v1 derivan premios del prefijo ganado y el DTO acota el catálogo',()=>{
  const raw=JSON.stringify({version:1,stage:3,completed:false,weapons:['maul']});
  const storage=memory([[SINGLE_PLAYER_STORAGE_KEY,raw]]),host=new HostSession({storage});
  story(host);
  const {weapons,defenses}=host.menuState().campaignArmory;
  assert.deepEqual(Object.keys(weapons).filter(id=>weapons[id].unlocked),['sword','axe']);
  assert.deepEqual(Object.keys(defenses).filter(id=>defenses[id].unlocked),['short','long','none','knife']);
  assert.equal(equip(host,'maul','none').ok,false);
  assert.equal(storage.getItem(SINGLE_PLAYER_STORAGE_KEY),raw);
  const dto=sanitizeMenuState({mode:'solo',experience:'campaign',campaignArmory:{
    weapons:{axe:{unlocked:1,rival:'https://ejemplo.test/x'},inventado:{unlocked:true}},
  }}).campaignArmory;
  assert.equal(dto.weapons.axe.unlocked,false);
  assert.equal(dto.weapons.axe.rival,'[dirección omitida]');
  assert.equal(Object.hasOwn(dto.weapons,'inventado'),false);
  assert.equal(dto.weapons.sword.unlocked,true);
  assert.equal(dto.defenses.none.unlocked,true);
});

test('La cámara del mural usa permisos temporales independientes y sólo funciona entre partidas',()=>{
  let now=10;
  const host=new HostSession({armoryNow:()=>now});story(host);
  const view=()=>host.renderState().scene.armoryView===true;
  assert.equal(view(),false);
  host.setArmoryView(1,true,200);host.setArmoryView(2,true);
  assert.equal(view(),true);
  host.clearArmoryView(1);
  assert.equal(view(),true,'un mando no cierra el mural de otro');
  now=460;assert.equal(view(),false,'el permiso vence aunque no avance el reloj de la partida');
  host.setArmoryView(1,true,451);assert.equal(view(),false);
  host.playback={};host.setArmoryView(1,true);host.playback=null;assert.equal(view(),false);
  host.setArmoryView(1,true);assert.equal(view(),true);
  assert.equal(command(host,'start').ok,true);
  host.setArmoryView(1,true);assert.equal(view(),false);
  assert.equal(command(host,'reset').ok,true);assert.equal(view(),false);
});

test('El clima usa el encuentro guardado y se retira al dejar la historia',()=>{
  const storage=memory([[SINGLE_PLAYER_STORAGE_KEY,JSON.stringify({version:2,stage:CAMPAIGN.length-1,completed:true})]]);
  const host=new HostSession({storage});
  host.game.clock=12;
  story(host);
  assert.equal(host.renderState().scene.weather,'storm');
  assert.equal(host.renderState().scene.weatherStart,12);
  host.game.clock=19;
  assert.equal(command(host,'setCampaignTier','advanced').ok,true);
  assert.equal(host.renderState().scene.weather,'night');
  assert.equal(host.renderState().scene.weatherStart,19);
  assert.equal(command(host,'setExperience','duel').ok,true);
  assert.equal(host.renderState().scene.weather,undefined);
  assert.equal(host.renderState().scene.weatherStart,undefined);
});

test('La tormenta se sincroniza con el inicio y la revancha, y continúa entre rondas',()=>{
  const storage=memory([[SINGLE_PLAYER_STORAGE_KEY,JSON.stringify({version:2,stage:CAMPAIGN.length-1,completed:false})]]);
  const host=new HostSession({storage}),game=host.game;
  story(host);
  game.clock=10;
  assert.equal(command(host,'start').ok,true);
  assert.equal(game.weatherStart,10);
  assert.equal(sampleWeather(game.weather,game.clock-game.weatherStart).flash,0);

  // A tied round repeats the same round number and must not reset the storm.
  game.clock=14;game.phase='burst';game.phaseClock=3.25;game.winner=0;
  host.update(1/120);
  assert.equal(game.phase,'countdown');
  assert.equal(game.round,1);
  assert.equal(game.weatherStart,10);

  const frame=replayView(captureReplayState(game));
  assert.deepEqual(sampleWeather(frame.weather,frame.clock-frame.weatherStart),
    sampleWeather(game.weather,game.clock-game.weatherStart));

  game.clock=20;result(host,2);
  assert.equal(command(host,'start').ok,true);
  assert.equal(game.weather,'storm');
  assert.equal(game.weatherStart,20);
  assert.equal(sampleWeather(game.weather,game.clock-game.weatherStart).thunderAt,null);
});
