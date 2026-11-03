import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DuelEngine,FOOTWORK,STEP} from '../public/engine.js';
import {HostSession} from '../public/host-session.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';
import {firstWeaponContact} from '../public/physics/weapon-bind.js';

const raw=await readFile(new URL('./fixtures/engine-pre-opening-1.13.1.js.txt',import.meta.url));
assert.equal(createHash('sha256').update(raw).digest('hex'),'ab55912da7216cdb3e8a5c8c52d5fcf9f68026e6981f3e19c8471b33f7dd9d2d','literal solo/AI opening oracle from published 1.13.1');
const relocate=(source,url,overrides={})=>source.replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_m,p,q,path)=>p+q+(overrides[path]??new URL(path,url).href)+q);
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const oldURL=data(relocate(raw.toString(),new URL('../public/engine.js',import.meta.url))),before=await import(oldURL);
const hostURL=new URL('../public/host-session.js',import.meta.url),oldHost=await import(data(relocate(await readFile(hostURL,'utf8'),hostURL,{'./engine.js':oldURL})));
function originalSolo(game,old,label){
  assert.equal(game.phase,old.phase,label+' phase');
  assert.deepEqual(game.fighters,old.fighters,label+' complete original fighter inputs/state');
  for(let i=0;i<2;i++){
    assert.equal(game.fighters[i].openingWrist,undefined,label+' no versus-only wrist offset');
    assert.deepEqual(game.fighters[i].rig.pose(),old.fighters[i].rig.pose(),label+' exact pose');
    assert.deepEqual(game.fighters[i].rig.collisionPanels(),old.fighters[i].rig.collisionPanels(),label+' exact physical geometry');
  }
}

// Independent SAT over the public physical panel vertices. This deliberately
// does not use weapon-bind's selected first contact or its anchored manifold:
// the reported failure hides an axe head behind a simultaneous shaft contact.
function panelOverlaps(game,steelOnly=true){
  const [a,b]=game.fighters.map(f=>f.rig.collisionPanels().filter(p=>!steelOnly||p.body==='weapon'&&p.material!=='wood'));
  const contacts=[];
  for(const x of a)for(const y of b){
    if(Math.abs(x.z-y.z)>=(x.depth+y.depth)/2-1e-7)continue;
    let penetration=Infinity;
    for(const axis of [...x.axes,...y.axes]){
      const A=x.vertices.map(v=>v.x*axis.x+v.y*axis.y),B=y.vertices.map(v=>v.x*axis.x+v.y*axis.y);
      penetration=Math.min(penetration,Math.min(Math.max(...A),Math.max(...B))-Math.max(Math.min(...A),Math.min(...B)));
    }
    if(penetration>1e-6)contacts.push({keyA:x.key,keyB:y.key,penetration});
  }
  return contacts;
}
function duel(weapons=['sword','axe']){
  const game=new DuelEngine();game.setMode('versus');
  for(const [index,weapon] of weapons.entries())game.setLoadout(index+1,{weapon,defense:'none'});
  return game;
}
function clearOpening(game,label){
  assert.equal(game.phase,'countdown');
  assert.deepEqual(panelOverlaps(game),[],`${label}: opposing physical steel must start clear`);
  for(const f of game.fighters){
    assert.ok(Math.abs(f.baseX)<=FOOTWORK.arenaHalfWidth,`${label}: base stays inside the arena`);
    const opponent=game.fighters.find(other=>other!==f),nearHead=opponent.pose.head.x-f.dir*BALLOON_RADII.x*opponent.balloonSize;
    for(const p of f.rig.collisionPanels().filter(p=>p.body==='weapon'))
      assert.ok(p.vertices.every(v=>f.dir*(nearHead-v.x)>0),`${label}: steel and grip stay outside the opposing balloon`);
  }
}

test('duel countdown starts without sword/axe shaft or head penetration in either slot order',()=>{
  for(const weapons of [['sword','axe'],['axe','sword']]){
    const game=duel(weapons);game.start();clearOpening(game,weapons.join('/'));
  }
});

test('every versus primary pairing fits a clear physical opening',()=>{
  for(const left of ['sword','spear','axe','maul'])for(const right of ['sword','spear','axe','maul']){
    const game=duel([left,right]);game.start();clearOpening(game,`versus/${left}/${right}`);
    assert.deepEqual(panelOverlaps(game,false),[],`versus/${left}/${right}: opposing timber and equipment start clear`);
    assert.equal(firstWeaponContact(...game.fighters.map(f=>f.rig)),null,'an immediate CCD query must not sweep through the old inspection pose');
    for(const f of game.fighters){
      assert.deepEqual(f.rig.collisionPanelsAt(0),f.rig.collisionPanelsAt(1),'initial history describes one stationary opening pose');
      assert.ok(f.rig.velocity.every(v=>v===0));assert.equal(f.controller.wrist,0);
    }
  }
});

test('versus steel remains clear for the entire breathing countdown, including long and heavy equipment',()=>{
  for(const weapons of [['sword','axe'],['axe','sword'],['spear','spear'],['maul','maul'],['axe','maul']]){
    const game=duel(weapons);game.clock=17;game.start();
    let steps=0;
    while(game.phase==='countdown'&&steps<386){
      clearOpening(game,`${weapons.join('/')}/tick-${steps}`);
      game.update(STEP);steps++;
    }
    assert.equal(game.phase,'fight');assert.ok(steps>380);
    assert.ok(game.fighters.every(f=>f.openingWrist===undefined&&f.controller.wrist===0),'the opening offset is released without becoming player control');
    assert.deepEqual(game.scores,[0,0]);assert.ok(game.fighters.every(f=>f.globIntact));
  }
});

test('a fresh opening clears collision observations from the previous ready state',()=>{
  const game=duel();game.lastWeaponContact={at:{x:0,y:2},impulse:1};game.lastBodyContacts=[{penetration:1}];
  game.start();assert.equal(game.lastWeaponContact,null);assert.deepEqual(game.lastBodyContacts,[]);
});

test('next rounds and rematches rebuild the clear physical opening in either slot order',()=>{
  for(const weapons of [['sword','axe'],['axe','sword']]){
    const game=duel(weapons);game.start();
    game.phase='burst';game.phaseClock=3.25;game.update(STEP);
    clearOpening(game,`${weapons.join('/')}/next round`);
    game.phase='matchover';game.start();clearOpening(game,`${weapons.join('/')}/rematch`);
  }
});

test('solo and boss equipment openings retain the literal 1.13.1 AI inputs',()=>{
  for(const difficulty of ['rookie','normal','expert','boss'])for(const left of ['sword','spear','axe','maul'])for(const right of ['sword','spear','axe','maul']){
    const game=new DuelEngine(),old=new before.DuelEngine();
    for(const g of [game,old]){g.setDifficulty(difficulty);g.setLoadout(1,{weapon:left,defense:'none'});g.setLoadout(2,{weapon:right,defense:'none'});g.start();}
    originalSolo(game,old,`${difficulty}/${left}/${right}`);
  }
});

test('campaign start and next encounter retain the literal original solo opening',()=>{
  const hosts=[new HostSession({opponentSeed:83}),new oldHost.HostSession({opponentSeed:83})];let requestId=0;
  const command=(command,value)=>hosts.map(host=>host.handleCommand({type:'command',requestId:++requestId,sentAt:0,command,...(value===undefined?{}:{value})}));
  assert.ok(command('setExperience','campaign').every(result=>result.ok));
  assert.ok(command('start').every(result=>result.ok));originalSolo(hosts[0].game,hosts[1].game,'campaign start');
  for(const host of hosts){host.game.phase='matchover';host.game.winner=1;host.game.onEvent('matchover',{winner:1});}
  assert.ok(command('nextEncounter').every(result=>result.ok));originalSolo(hosts[0].game,hosts[1].game,'campaign next encounter');
});

test('solo reset preserves prior contact observations exactly like the original engine',()=>{
  const game=new DuelEngine(),old=new before.DuelEngine();
  for(const g of [game,old]){g.lastWeaponContact={at:{x:0,y:2},impulse:1};g.lastBodyContacts=[{penetration:1}];g.start();}
  assert.deepEqual(game.lastWeaponContact,old.lastWeaponContact);assert.deepEqual(game.lastBodyContacts,old.lastBodyContacts);
});

test('ready inspection and practice retain their reference pose, and duel fighters can still approach',()=>{
  const practice=duel();
  const ready=practice.fighters.map(f=>({hand:{...f.pose.mainHand},tip:{...f.pose.tip}}));
  practice.setScenario('practice');practice.start();
  assert.deepEqual(practice.fighters.map(f=>({hand:f.pose.mainHand,tip:f.pose.tip})),ready);
  const game=duel();game.start();const initial=game.fighters[1].baseX-game.fighters[0].baseX;
  game.phase='fight';game.setControl(1,{lean:1});game.setControl(2,{lean:1});game.update(STEP);
  assert.ok(game.fighters[1].baseX-game.fighters[0].baseX<initial,'the opening does not prevent ordinary forward footwork');
});
