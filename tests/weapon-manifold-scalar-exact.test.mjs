import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DuelEngine,STEP,neutral} from '../public/engine.js';
import {weaponGesture} from '../public/joysticks.js';
import {captureReplayState} from '../public/replay.js';
import {firstWeaponContact,firstWeaponPointContact} from '../public/physics/weapon-bind.js';

// This already-frozen independent implementation retains the allocating SAT
// helpers and identical friction/response rules. Its bytes are never adapted.
const fixture=await fs.readFile(new URL('./fixtures/weapon-bind-pre-selected-sampler-1.7.2.js.txt',import.meta.url));
assert.equal(createHash('sha256').update(fixture).digest('hex'),'f828849fda02f47c0131c76b41be45f08ae0bb2241c1001dc47555176be56cd1');
const oldSource=fixture.toString('utf8').replace("'./articulated-rig.js'",JSON.stringify(new URL('../public/physics/articulated-rig.js',import.meta.url).href));
const oldURL='data:text/javascript;base64,'+Buffer.from(oldSource).toString('base64'),before=await import(oldURL);
const engineURL=new URL('../public/engine.js',import.meta.url),engineSource=await fs.readFile(engineURL,'utf8');
assert.equal(engineSource.split("'./physics/weapon-bind.js'").length,2);
const referenceSource=engineSource.replace("'./physics/weapon-bind.js'",JSON.stringify(oldURL))
  .replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_match,prefix,quote,specifier)=>prefix+quote+new URL(specifier,engineURL).href+quote);
const {DuelEngine:ReferenceEngine}=await import('data:text/javascript;base64,'+Buffer.from(referenceSource).toString('base64'));
const capture=g=>({replay:captureReplayState(g),rigs:g.fighters.map(f=>f.rig.diagnostics()),steel:g.lastWeaponContact,body:g.lastBodyContacts});
const currentSource=(await fs.readFile(new URL('../public/physics/weapon-bind.js',import.meta.url),'utf8')).replace("'./articulated-rig.js'",JSON.stringify(new URL('../public/physics/articulated-rig.js',import.meta.url).href));
const helperModule=source=>import('data:text/javascript;base64,'+Buffer.from(source.slice(0,source.indexOf('function separation('))+'\nexport {project,half,located};\n').toString('base64'));
const [currentHelpers,legacyHelpers]=await Promise.all([helperModule(currentSource),helperModule(oldSource)]);

test('scalar SAT helpers retain empty, nonfinite, signed-zero and extreme projection arithmetic',()=>{
  const clouds=[[],[{x:0,y:-0}],[{x:-0,y:0}],[{x:-1,y:2},{x:3,y:-4}],
    [{x:NaN,y:0},{x:1,y:2}],[{x:Infinity,y:0},{x:-Infinity,y:1}],[{x:1e200,y:-1e200},{x:-1e200,y:1e200}]];
  for(const vertices of clouds)for(const n of [{x:1,y:0},{x:-0,y:1},{x:.6,y:.8},{x:NaN,y:1}]){
    const panel={vertices,axes:[{x:1,y:0},{x:-0,y:1}],center:{x:-0,y:0},z:-0};
    assert.deepEqual(currentHelpers.project(panel,n),legacyHelpers.project(panel,n));
    assert.equal(Object.is(currentHelpers.half(panel,n),legacyHelpers.half(panel,n)),true);
    for(const uv of [[0,-0],[1,-1],[NaN,0]])assert.deepEqual(currentHelpers.located(panel,uv),legacyHelpers.located(panel,uv));
  }
});

test('scalar SAT and shared manifold supports preserve complete real weapon-contact trajectories exactly',()=>{
  let ticks=0,steel=0;
  for(const weapon of ['sword','spear','axe','maul'])for(const recipe of ['neutral','bind']){
    const make=Type=>{
      let seed=0x57445141;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),original=Math.random;Math.random=random;
      try{const events=[],game=new Type((name,data)=>events.push({name,data}));game.setMode('versus');game.setScenario('practice');game.setLoadout(1,{weapon});game.setLoadout(2,{weapon});game.aiEnabled=false;game.phase='fight';return {game,events,random};}finally{Math.random=original;}
    };
    const a=make(DuelEngine),b=make(ReferenceEngine);
    for(let i=0;i<120&&a.game.phase==='fight';i++){
      for(const {game,random} of [a,b]){
        game.setControl(1,recipe==='bind'?{...weaponGesture({x:.9,y:.15*Math.sin(i*.05)}),lean:.2}:neutral());
        game.setControl(2,recipe==='bind'?{...weaponGesture({x:.9,y:-.15*Math.sin(i*.05)}),lean:.2}:neutral());
        const original=Math.random;Math.random=random;try{game.update(STEP);}finally{Math.random=original;}
      }
      assert.equal(a.game.phase,b.game.phase);assert.deepEqual(a.events,b.events);ticks++;steel+=!!a.game.lastWeaponContact;
      if(i%4===0||a.game.phase!=='fight')assert.deepEqual(capture(a.game),capture(b.game),`${weapon}/${recipe}/${i}`);
    }
    assert.deepEqual(capture(a.game),capture(b.game));
  }
  assert.ok(ticks>600);assert.ok(steel>250,'sustained physical steel contacts must actually be exercised');
});

test('SAT support boundaries preserve signed zero, grazing faces and first-entry ordering',()=>{
  const rig=(dir,offset,width,skew=0)=>{
    const panel=t=>{const y=offset*(1-2*t);return {body:'weapon',key:'weapon',material:'steel',axes:[{x:1,y:0},{x:-0,y:1}],center:{x:0,y},vertices:[{x:-.5,y:y-width/2},{x:.5,y:y-width/2+skew},{x:.5,y:y+width/2},{x:-.5,y:y+width/2}],z:.177,depth:.034};};
    return {dir,q:[0,-offset],previousQ:[0,offset],scale:1,swordLength:1,previousSwordLength:1,collisionPanels:()=>[panel(1)],collisionPanelsAt:t=>[panel(t)]};
  };
  for(const dir of [-1,1])for(const offset of [0,.034,.0340001,.4])for(const skew of [0,1e-7,1e-7+Number.EPSILON]){
    const a=rig(dir,0,.034,skew),b=rig(-dir,offset,.034);
    assert.deepEqual(firstWeaponContact(a,b),before.firstWeaponContact(a,b));
    const from={x:-1,y:0,z:.177},to={x:1,y:0,z:.177};assert.deepEqual(firstWeaponPointContact(b,from,to),before.firstWeaponPointContact(b,from,to));
  }
});
