import test from 'node:test';
import assert from 'node:assert/strict';
import {HostSession} from '../public/host-session.js';
import {SinglePlayerSession,SINGLE_PLAYER_STORAGE_KEY} from '../public/single-player.js';
import {BOSS_CAMPAIGN_STORAGE_KEY,ADVANCED_CAMPAIGN_STORAGE_KEY,CAMPAIGN,STORY_CHAPTERS} from '../public/campaign-progression.js';
import {STEP} from '../public/engine.js';

function memory(entries=[]){
  const values=new Map(entries);
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
}
function openStory(storage=memory()){
  const host=new HostSession({storage,opponentSeed:128});
  let requestId=0;
  const command=(command,value)=>host.handleCommand({type:'command',command,value,requestId:++requestId,sentAt:Date.now()});
  assert.equal(command('setExperience','campaign').ok,true);
  return {host,command,storage,game:host.game};
}
function resolve(game,winner){
  game.phase='matchover';game.winner=winner;game.scores=winner===1?[2,0]:[0,2];
  game.onEvent('matchover',{winner});
}

test('Los cuatro capítulos llevan de los súbditos al jefe y cada victoria habilita sólo el próximo encuentro',()=>{
  const {host,game,command,storage}=openStory();
  assert.equal(command('nextEncounter').ok,false);
  const bosses=[];
  for(const [index,encounter] of CAMPAIGN.entries()){
    const chapter=STORY_CHAPTERS[encounter.chapter-1],rival=game.fighters[1],objective=host.menuState().objective;
    assert.equal(objective.story.chapter,encounter.chapter);
    assert.equal(objective.story.role,encounter.role);
    assert.equal(objective.progress,index);
    assert.equal(objective.total,11);
    assert.equal(game.opponentName,encounter.name);
    assert.equal(game.weather,encounter.weather);
    assert.deepEqual(rival.equipment,encounter.opponentLoadout);
    assert.equal(rival.boss,encounter.role==='boss');
    if(rival.boss){
      assert.equal(chapter.boss.name,encounter.name);
      assert.equal(rival.bossArchetype,encounter.bossArchetype);
      bosses.push(encounter.name);
    }
    if(index===2){
      resolve(game,2);
      assert.equal(host.menuState().objective.nextAction,'retry');
      assert.equal(command('nextEncounter').ok,true);
      assert.equal(game.opponentName,encounter.name);
      assert.equal(host.menuState().objective.progress,index);
    }
    resolve(game,1);
    const won=host.menuState().objective,next=CAMPAIGN[index+1];
    if(next){
      assert.equal(won.advancedUnlocked,false);
      assert.equal(won.story.nextOpponent,next.name);
      assert.equal(won.story.nextChapter,next.chapter);
      assert.equal(won.story.nextRole,next.role);
      assert.equal(command('nextEncounter').ok,true);
      assert.equal(game.phase,'countdown');
    }else{
      assert.equal(game.weather,'storm');
      assert.equal(won.completed,true);
      assert.equal(won.advancedUnlocked,true);
      assert.equal(won.trophy,'champion');
      assert.equal(command('nextEncounter').ok,false);
    }
  }
  assert.deepEqual(bosses,['El Mariscal de Latón','El Centinela de Presión','La Serradora Carmesí','El Maestro Hidráulico']);
  assert.deepEqual(JSON.parse(storage.getItem(SINGLE_PLAYER_STORAGE_KEY)),{version:2,stage:10,completed:true});
});

test('Un guardado antiguo conserva el equipo y vuelve a entrar en la historia por el primer combate pendiente',()=>{
  const raw=JSON.stringify({version:1,stage:4,completed:false}),storage=memory([[SINGLE_PLAYER_STORAGE_KEY,raw]]);
  let {host,game,command}=openStory(storage);
  assert.equal(game.opponentName,'El Mariscal de Latón');
  assert.equal(host.menuState().objective.progress,4);
  assert.equal(host.individual.campaignArmory.weapons.axe.unlocked,true);
  assert.equal(host.individual.campaignArmory.weapons.maul.unlocked,false);
  assert.equal(storage.getItem(SINGLE_PLAYER_STORAGE_KEY),raw);
  resolve(game,1);
  assert.deepEqual(JSON.parse(storage.getItem(SINGLE_PLAYER_STORAGE_KEY)),{version:2,stage:3,completed:false,legacyStage:4});
  ({host,game,command}=openStory(storage));
  const fought=[];
  while(!host.menuState().objective.completed){
    fought.push(game.opponentName);
    resolve(game,1);
    if(!host.menuState().objective.completed)assert.equal(command('nextEncounter').ok,true);
  }
  assert.deepEqual(fought,['La Punta de Cristal','El Péndulo Salvaje','El Centinela de Presión','La Serradora Carmesí','El Guardaválvulas','El Maestro Hidráulico']);
});

test('Trofeos, campaña avanzada y desafío de jefes conservan sus partidas anteriores por separado',()=>{
  const raw=JSON.stringify({version:1,stage:6,completed:true});
  const storage=memory([[SINGLE_PLAYER_STORAGE_KEY,raw],
    [ADVANCED_CAMPAIGN_STORAGE_KEY,JSON.stringify({version:1,stage:3,completed:false})],
    [BOSS_CAMPAIGN_STORAGE_KEY,JSON.stringify({version:1,stage:3,completed:true})]]);
  const session=new SinglePlayerSession({storage});session.select('campaign');
  assert.equal(session.view().completed,false);
  assert.equal(session.view().progress,6);
  assert.equal(session.view().trophy,'champion');
  assert.equal(session.view().advancedUnlocked,true);
  assert.equal(session.configuration().opponentName,'El Mariscal de Latón');
  assert.equal(session.campaignArmory.weapons.maul.unlocked,true);
  assert.equal(session.setCampaignTier('advanced'),true);
  assert.equal(session.stage,3);
  assert.equal(session.setCampaignTier('bosses'),true);
  assert.equal(session.view().completed,true);
  assert.equal(session.setCampaignTier('normal'),true);
  assert.equal(session.view().completed,false);
  assert.equal(storage.getItem(SINGLE_PLAYER_STORAGE_KEY),raw);
});

test('El Guardaválvulas disputa el penúltimo duelo con escudo largo y puede pinchar por contacto físico',()=>{
  const stage=CAMPAIGN.length-2,storage=memory([[SINGLE_PLAYER_STORAGE_KEY,JSON.stringify({version:2,stage,completed:false})]]);
  const {host,game,command}=openStory(storage),hits=[];
  const previous=game.onEvent;game.onEvent=(name,data)=>{if(name==='burst')hits.push(data);previous(name,data);};
  assert.equal(game.opponentName,'El Guardaválvulas');
  assert.equal(game.fighters[1].equipment.defense,'long');
  assert.equal(command('start').ok,true);
  while(game.phase==='countdown')game.update(.04);
  for(let tick=0;tick<1800&&game.phase==='fight';tick++){
    game.setControl(1,{lean:-1});
    game.update(STEP);
  }
  assert.ok(hits.some(hit=>hit.contact&&hit.winner===2&&hit.relativeSpeed>0));
  assert.equal(host.menuState().objective.story.chapter,4);
});
