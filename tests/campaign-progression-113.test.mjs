import test from 'node:test';
import assert from 'node:assert/strict';
import {SinglePlayerSession,CAMPAIGN,SINGLE_PLAYER_STORAGE_KEY} from '../public/single-player.js';
import {WEAPONS,DEFENSES,normalizeLoadout} from '../public/equipment.js';

const ADVANCED_KEY='water-duel.campaign-advanced.v1';
const memory=(initial=[])=>{
  const values=new Map(initial);
  return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
};
const normalComplete=()=>[SINGLE_PLAYER_STORAGE_KEY,JSON.stringify({version:2,stage:CAMPAIGN.length-1,completed:true})];
const advanced=(s)=>{assert.equal(typeof s.setCampaignTier,'function');assert.equal(s.setCampaignTier('advanced'),true);s.select('campaign');};
function match(winner=1){return {mode:'solo',phase:'matchover',winner,scores:winner===1?[2,0]:[0,2],roundsToWin:2,fighters:[{slot:1},{slot:2}]};}
function win(s){const g=match();s.event('matchover',{winner:1},g);return g;}

test('advanced campaign is explicitly locked until the normal story is completed',()=>{
  const storage=memory(),s=new SinglePlayerSession({storage,seed:13});s.select('campaign');
  assert.equal(typeof s.setCampaignTier,'function');
  for(const value of ['advanced','ADVANCED',true,1,null,{},''])assert.equal(s.setCampaignTier(value),false);
  assert.equal(s.view().campaignTier,'normal');assert.equal(s.view().advancedUnlocked,false);assert.equal(s.view().trophy,'none');
  for(let i=0;i<CAMPAIGN.length;i++){win(s);if(i<CAMPAIGN.length-1)assert.equal(s.next(),true);}
  assert.equal(s.view().completed,true);assert.equal(s.view().advancedUnlocked,true);assert.equal(s.view().trophy,'champion');
  assert.equal(s.view().nextAction,'repeat');assert.match(s.view().instruction,/trofeo|campeón|ceremonia/i);
  assert.equal(s.next(),false,'completion does not silently create another encounter or erase a victory');
  assert.equal(s.setCampaignTier('advanced'),true);assert.equal(s.stage,0);assert.equal(s.view().completed,false);
  assert.equal(storage.getItem(SINGLE_PLAYER_STORAGE_KEY),normalComplete()[1]);
});

test('advanced encounters author seven legal, independent opponents without adding physical bonuses',()=>{
  const s=new SinglePlayerSession({storage:memory([normalComplete()]),seed:13});advanced(s);const opponents=[];
  for(let i=0;i<7;i++){
    const c=s.configuration();opponents.push(c);
    assert.ok(WEAPONS[c.opponentLoadout.weapon]);assert.ok(DEFENSES[c.opponentLoadout.defense]);
    assert.deepEqual(c.opponentLoadout,normalizeLoadout(c.opponentLoadout));
    assert.ok(['expert','boss'].includes(c.difficulty));assert.equal(c.bestOf,3);
    assert.notDeepEqual([c.opponentName,c.arena,c.aiStyle,c.opponentLoadout],[CAMPAIGN[i].name,CAMPAIGN[i].arena,CAMPAIGN[i].aiStyle,CAMPAIGN[i].opponentLoadout]);
    for(const field of ['massScale','damageScale','balloonSize','forceScale','punctureScale'])assert.equal(c[field],undefined);
    c.opponentLoadout.weapon='invalid';assert.notEqual(s.configuration().opponentLoadout.weapon,'invalid');
    if(i<6){win(s);assert.equal(s.next(),true);}
  }
  assert.equal(new Set(opponents.map(c=>c.opponentName)).size,7);assert.equal(opponents.at(-1).difficulty,'boss');assert.equal(opponents.at(-1).aiStyle,'boss');
  assert.match(s.view().title,/avanzad|maestr/i);
});

test('advanced progress, completion and trophy persist independently while normal bytes remain intact',()=>{
  const storage=memory([normalComplete()]),s=new SinglePlayerSession({storage,seed:13});advanced(s);
  for(let i=0;i<7;i++){win(s);if(i<6)assert.equal(s.next(),true);}
  const final=s.view();assert.equal(final.completed,true);assert.equal(final.progress,7);assert.equal(final.total,7);
  assert.equal(final.trophy,'master');assert.equal(final.nextAction,'repeat');assert.match(final.instruction,/maestr|trofeo/i);
  assert.deepEqual(JSON.parse(storage.getItem(ADVANCED_KEY)),{version:1,stage:6,completed:true});
  assert.equal(storage.getItem(SINGLE_PLAYER_STORAGE_KEY),normalComplete()[1]);
  const restored=new SinglePlayerSession({storage,seed:13});assert.equal(restored.campaignTier,'normal');
  advanced(restored);assert.equal(restored.stage,6);assert.equal(restored.view().completed,true);assert.equal(restored.view().trophy,'master');
  assert.equal(restored.setCampaignTier('normal'),true);assert.equal(restored.stage,CAMPAIGN.length-1);assert.equal(restored.view().completed,true);
  restored.resetProgress();assert.equal(restored.campaignTier,'normal');assert.equal(restored.stage,0);assert.equal(restored.view().trophy,'none');
  assert.equal(storage.getItem(SINGLE_PLAYER_STORAGE_KEY),null);assert.equal(storage.getItem(ADVANCED_KEY),null);assert.equal(restored.setCampaignTier('advanced'),false);
});

test('advanced changes clear transient objectives, resume their saved stage and preserve normal campaign progress',()=>{
  const storage=memory([normalComplete(),[ADVANCED_KEY,JSON.stringify({version:1,stage:3,completed:false})]]),s=new SinglePlayerSession({storage,seed:13});
  s.select('campaign');s.reference={old:true};s.hold=1;s.result='won';s.demoMatch=true;s.objectiveIndex=6;
  advanced(s);assert.equal(s.stage,3);assert.equal(s.result,'idle');assert.equal(s.reference,null);assert.equal(s.hold,0);assert.equal(s.objectiveIndex,0);assert.equal(s.demoMatch,false);
  s.select('duel');s.select('campaign');assert.equal(s.campaignTier,'advanced');assert.equal(s.stage,3);
  assert.equal(s.setCampaignTier('normal'),true);assert.equal(s.stage,CAMPAIGN.length-1);assert.equal(s.saved.completed,true);
  assert.equal(s.setCampaignTier('advanced'),true);assert.equal(s.stage,3);
});

test('advanced results reject demonstrations, draws, replay, wrong phase and duplicate completed matches',()=>{
  const storage=memory([normalComplete()]),s=new SinglePlayerSession({storage,seed:13});advanced(s);
  for(const [data,g] of [
    [{winner:1,demonstration:true},match()], [{winner:1,draw:true},match()], [{winner:1},{...match(),demonstration:true}],
    [{winner:1},{...match(),replay:true}], [{winner:1},{...match(),mode:'versus'}], [{winner:1},{...match(),phase:'fight'}],
    [{winner:1},match(2)], [{winner:0},match()]
  ]){s.event('matchover',data,g);assert.equal(s.result,'idle');assert.equal(s.view().progress,0);}
  const g=win(s);assert.equal(s.view().progress,1);s.event('matchover',{winner:1},g);assert.equal(s.view().progress,1);
  assert.equal(s.next(),true);assert.equal(s.stage,1);s.event('matchover',{winner:1},g);assert.equal(s.view().progress,1,'a resolved match cannot win a later encounter');
  const loss=match(2);s.event('matchover',{winner:2},loss);assert.equal(s.view().nextAction,'retry');assert.equal(s.next(),true);assert.equal(s.stage,1);
  const next=win(s);assert.notEqual(next,g);assert.equal(s.view().progress,2);
});

test('advanced storage is strictly validated and denied storage never prevents campaign play',()=>{
  for(const raw of ['oops','null','[]','{"version":2,"stage":3,"completed":false}','{"version":1,"stage":-1,"completed":false}',
    '{"version":1,"stage":1.5,"completed":false}','{"version":1,"stage":0,"completed":true}','{"version":1,"stage":6,"completed":"yes"}']){
    const s=new SinglePlayerSession({storage:memory([normalComplete(),[ADVANCED_KEY,raw]]),seed:13});advanced(s);assert.equal(s.stage,0);assert.equal(s.view().completed,false);
  }
  const blocked={getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}},s=new SinglePlayerSession({storage:blocked,seed:13});
  s.select('campaign');for(let i=0;i<CAMPAIGN.length;i++){win(s);if(i<CAMPAIGN.length-1)s.next();}advanced(s);win(s);assert.equal(s.next(),true);assert.equal(s.stage,1);assert.doesNotThrow(()=>s.resetProgress());
  const injected=memory([[ADVANCED_KEY,JSON.stringify({version:1,stage:6,completed:true})]]),locked=new SinglePlayerSession({storage:injected,seed:13});locked.select('campaign');
  assert.equal(locked.view().trophy,'none');assert.equal(locked.setCampaignTier('advanced'),false);
});
