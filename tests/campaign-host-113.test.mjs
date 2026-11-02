import test from 'node:test';
import assert from 'node:assert/strict';
import {HostSession} from '../public/host-session.js';
import {normalizeMenuCommand,sanitizeMenuState} from '../public/remote-menu.js';
import {MobileSession} from '../public/mobile-session.js';
import {SinglePlayerSession} from '../public/single-player.js';

const command=(name,value)=>({type:'command',requestId:1,sentAt:1,command:name,...(value===undefined?{}:{value})});
function prepared(completed=false){
 const data=new Map();if(completed)data.set('water-duel.single-player.v1',JSON.stringify({version:1,stage:6,completed:true}));
 const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 const host=new HostSession({storage,opponentSeed:113});host.handleCommand(command('setExperience','campaign'));
 return {host,data};
}

test('campaign tier commands accept only explicit known tiers and a valueless start action',()=>{
 for(const tier of ['normal','advanced'])assert.equal(normalizeMenuCommand(command('setCampaignTier',tier))?.value,tier);
 for(const value of [null,1,true,{},'master','ADVANCED'])assert.equal(normalizeMenuCommand(command('setCampaignTier',value)),null);
 assert.equal(normalizeMenuCommand(command('beginAdvancedCampaign'))?.command,'beginAdvancedCampaign');
 assert.equal(normalizeMenuCommand(command('beginAdvancedCampaign','advanced')),null);
});

test('campaign DTO bounds tier and reward while excluding arbitrary campaign fields',()=>{
 const dto=sanitizeMenuState({experience:'campaign',objective:{kind:'campaign',campaignTier:'advanced',advancedUnlocked:true,trophy:'master',privatePath:'C:/secret'}});
 assert.equal(dto.objective.campaignTier,'advanced');assert.equal(dto.objective.advancedUnlocked,true);assert.equal(dto.objective.trophy,'master');assert.equal('privatePath' in dto.objective,false);
 const bad=sanitizeMenuState({objective:{kind:'campaign',campaignTier:'evil',advancedUnlocked:1,trophy:'unknown'}}).objective;
 assert.equal(bad.campaignTier,'normal');assert.equal(bad.advancedUnlocked,false);assert.equal(bad.trophy,'none');
 assert.equal('campaignTier' in sanitizeMenuState({objective:{kind:'duel',campaignTier:'advanced'}}).objective,false);
});

test('host rejects locked campaign tier and prepares unlocked advanced without altering normal progress or audio',()=>{
 const locked=prepared();assert.equal(locked.host.handleCommand(command('setCampaignTier','advanced')).ok,false);
 const {host,data}=prepared(true),saved=data.get('water-duel.single-player.v1');host.audioOn=false;host.effectsVolume=0;
 assert.equal(host.handleCommand(command('setCampaignTier','advanced')).ok,true);
 assert.equal(host.game.phase,'ready');assert.equal(host.menuState().objective.campaignTier,'advanced');
 assert.equal(data.get('water-duel.single-player.v1'),saved);assert.equal(host.audioOn,false);assert.equal(host.effectsVolume,0);
 assert.equal(host.handleCommand(command('setCampaignTier','normal')).ok,true);assert.equal(host.menuState().objective.campaignTier,'normal');
});

test('campaign switching refuses combat, replay and versus without mutating the selection',()=>{
 for(const situation of ['fight','countdown','replay','versus']){
  const {host}=prepared(true);if(situation==='replay')host.playback={};else if(situation==='versus')host.game.mode='versus';else host.game.phase=situation;
  assert.equal(host.handleCommand(command('setCampaignTier','advanced')).ok,false,situation);assert.equal(host.individual.view(host.game).campaignTier,'normal');
 }
});

test('final-result action begins unlocked advanced once and respects renderer readiness',()=>{
 const {host}=prepared(true);host.game.phase='matchover';host.game.winner=1;host.individual.result='complete';
 host.assetStatus={loading:true,total:11,ready:10};assert.equal(host.handleCommand(command('beginAdvancedCampaign')).ok,false);
 delete host.assetStatus;assert.equal(host.handleCommand(command('beginAdvancedCampaign')).ok,true);assert.equal(host.game.phase,'countdown');assert.equal(host.individual.view(host.game).campaignTier,'advanced');
 assert.equal(host.handleCommand(command('beginAdvancedCampaign')).ok,false,'a repeated action cannot reset an ongoing countdown');
 assert.equal(prepared(false).host.handleCommand(command('beginAdvancedCampaign')).ok,false);
});

test('standalone mobile receives the advanced tier after its ACK and refuses a stale repeated command',async()=>{
 const {host}=prepared(true),session=new MobileSession({now:()=>500}),packets=[];session.bindHost(host);
 const link=session.connect();link.onmessage=event=>packets.push(JSON.parse(event.data));
 const tick=()=>new Promise(resolve=>setImmediate(resolve));await tick();link.send(JSON.stringify({type:'hello',role:'controller',slot:1}));await tick();packets.length=0;
 const request={type:'command',requestId:1,sentAt:500,command:'setCampaignTier',value:'advanced'};link.send(JSON.stringify(request));await tick();
 const ack=packets.findIndex(p=>p.type==='command-result'&&p.requestId===1);assert.ok(ack>=0);assert.equal(packets[ack].ok,true);
 assert.ok(packets.slice(ack+1).some(p=>p.type==='menu-state'&&p.state.objective?.campaignTier==='advanced'));
 const fighter=host.game.fighters[0];link.send(JSON.stringify(request));await tick();assert.equal(host.game.fighters[0],fighter);link.close();
});

test('both campaign tiers reject premature, contradictory and already-resolved match actors after next',()=>{
 for(const tier of ['normal','advanced']){
  const {host}=prepared(tier==='advanced'),s=host.individual;if(tier==='advanced')assert.equal(s.setCampaignTier(tier),true);
  const g={mode:'solo',phase:'fight',winner:1,fighters:[{slot:1},{slot:2}]};
  s.event('matchover',{winner:1},g);assert.equal(s.view().progress,0,'an event before matchover cannot award progress');
  g.phase='matchover';g.winner=2;s.event('matchover',{winner:1},g);assert.equal(s.view().progress,0,'event and authoritative winner must agree');
  g.winner=1;s.event('matchover',{winner:1},g);assert.equal(s.next(),true);assert.equal(s.stage,1);
  s.event('matchover',{winner:1},g);assert.equal(s.view().progress,1,'next does not make the same actor eligible again');assert.equal(s.result,'idle');
  g.fighters=[{slot:1},{slot:2}];s.event('matchover',{winner:1},g);assert.equal(s.view().progress,2,'a newly resolved match can progress');
 }
});
