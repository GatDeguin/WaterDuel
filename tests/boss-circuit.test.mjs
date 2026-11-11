import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMPAIGN,BOSS_CAMPAIGN,BOSS_CAMPAIGN_STORAGE_KEY} from '../public/campaign-progression.js';
import {HostSession} from '../public/host-session.js';
import {SINGLE_PLAYER_STORAGE_KEY} from '../public/single-player.js';
import {STEP} from '../public/engine.js';

function arena(stage){
  const values=new Map();
  if(stage!==undefined)values.set(BOSS_CAMPAIGN_STORAGE_KEY,JSON.stringify({version:1,stage,completed:false}));
  const host=new HostSession({storage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},opponentSeed:75});
  let requestId=0;
  const command=(command,value)=>host.handleCommand({type:'command',requestId:++requestId,sentAt:Date.now(),command,value});
  assert.equal(command('setExperience','campaign').ok,true);
  assert.equal(command('setCampaignTier','bosses').ok,true);
  return {host,game:host.game,command,values};
}

test('El mando elige cuatro jefes con progreso independiente y desbloquea su equipo',()=>{
  const {host,game,command,values}=arena();
  for(const [stage,encounter] of BOSS_CAMPAIGN.entries()){
    const state=host.menuState(),rival=game.fighters[1];
    assert.equal(state.objective.campaignTier,'bosses');
    assert.equal(state.objective.total,4);
    assert.equal(state.objective.progress,stage);
    assert.equal(state.fighters[1].name,encounter.name);
    assert.deepEqual(rival.equipment,encounter.opponentLoadout);
    assert.equal(rival.balloonColor,encounter.opponentColor);
    assert.ok(rival.boss);
    assert.equal(game.weather,['night','full-moon','rain','storm'][stage]);
    game.winner=1;game.scores=[2,0];game.phase='matchover';
    game.onEvent('matchover',{winner:1});
    const {weapons,defenses}=host.individual.campaignArmory;
    assert.ok(weapons[rival.equipment.weapon].unlocked&&defenses[rival.equipment.defense].unlocked);
    if(stage<3)assert.equal(command('nextEncounter').ok,true);
  }
  assert.deepEqual(JSON.parse(values.get(BOSS_CAMPAIGN_STORAGE_KEY)),{version:1,stage:3,completed:true});
  assert.equal(values.has(SINGLE_PLAYER_STORAGE_KEY),false);
  assert.equal(host.menuState().objective.completed,true);
  assert.equal(command('setCampaignTier','normal').ok,true);
  assert.equal(host.menuState().objective.total,CAMPAIGN.length);
  assert.equal(game.bossArchetype,null);
  assert.equal(command('setCampaignTier','bosses').ok,true);
  assert.equal(game.loadouts[1].weapon,'maul');
  assert.equal(host.menuState().objective.completed,true);
});

for(const [stage,archetype,pattern] of [[0,'sword','sword-disengage'],[1,'spear','spear-pressure-line'],[2,'axe','axe-crown']]){
  test(`El jefe con ${archetype} telegrafía su arma y puede ganar por contacto físico`,()=>{
    const {game,command}=arena(stage);
    const events=[],onEvent=game.onEvent;
    game.onEvent=(name,data)=>{events.push({name,data});onEvent(name,data);};
    assert.equal(command('start').ok,true);
    while(game.phase==='countdown')game.update(.04);
    assert.equal(game.phase,'fight');
    assert.equal(game.bossArchetype,archetype);
    assert.ok(game.fighters.every(f=>f.globIntact));
    for(let tick=0;tick<1800&&game.phase==='fight';tick++){
      game.setControl(1,{lean:-1});
      game.update(STEP);
    }
    assert.ok(events.some(e=>e.name==='ai-state'&&e.data.slot===2&&e.data.state==='windup'&&e.data.pattern===pattern));
    const puncture=events.find(e=>e.name==='burst');
    assert.ok(puncture?.data.contact===true&&puncture.data.winner===2&&puncture.data.relativeSpeed>0);
  });
}
