import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DuelEngine,STEP,neutral} from '../public/engine.js';
import {weaponGesture} from '../public/joysticks.js';
import {captureReplayState} from '../public/replay.js';
import {firstWeaponContact,firstWeaponPointContact} from '../public/physics/weapon-bind.js';

// Frozen raw source remains the independent allocating SAT/boundary oracle.
// Its old response is not an N16 dynamics oracle: the trajectory reference
// below transplants only its SAT helpers into the current signed solver.
const fixture=await fs.readFile(new URL('./fixtures/weapon-bind-pre-selected-sampler-1.7.2.js.txt',import.meta.url));
assert.equal(createHash('sha256').update(fixture).digest('hex'),'f828849fda02f47c0131c76b41be45f08ae0bb2241c1001dc47555176be56cd1');
const oldSource=fixture.toString('utf8').replace("'./articulated-rig.js'",JSON.stringify(new URL('../public/physics/articulated-rig.js',import.meta.url).href));
const oldURL='data:text/javascript;base64,'+Buffer.from(oldSource).toString('base64'),before=await import(oldURL);
const currentSource=(await fs.readFile(new URL('../public/physics/weapon-bind.js',import.meta.url),'utf8')).replace("'./articulated-rig.js'",JSON.stringify(new URL('../public/physics/articulated-rig.js',import.meta.url).href));
const satRange=source=>{
  const start=source.indexOf('const project='),end=source.indexOf('// Bound on travel of any material point over this step.');
  assert.ok(start>=0&&end>start);assert.equal(source.indexOf('const project=',start+1),-1);
  return {start,end,text:source.slice(start,end)};
};
// Whitelist: project, half, anchor, located, support, separation, manifold.
// Old support+manifold replace the optimized supportFace arrangement together.
// Every transplanted byte comes from the pinned RAW, including map/filter SAT.
const archivedSAT=satRange(oldSource),optimizedSAT=satRange(currentSource);
assert.notEqual(archivedSAT.text,optimizedSAT.text);
const n16SATSource=currentSource.slice(0,optimizedSAT.start)+archivedSAT.text+currentSource.slice(optimizedSAT.end);
assert.equal(satRange(n16SATSource).text,archivedSAT.text);
assert.equal(n16SATSource.slice(0,optimizedSAT.start),currentSource.slice(0,optimizedSAT.start));
assert.equal(n16SATSource.slice(satRange(n16SATSource).end),currentSource.slice(optimizedSAT.end),'CCD sampling, signed response and metadata remain current verbatim');
const n16SATURL='data:text/javascript;base64,'+Buffer.from(n16SATSource).toString('base64');
const engineURL=new URL('../public/engine.js',import.meta.url),engineSource=await fs.readFile(engineURL,'utf8');
assert.equal(engineSource.split("'./physics/weapon-bind.js'").length,2);
const referenceSource=engineSource.replace("'./physics/weapon-bind.js'",JSON.stringify(n16SATURL))
  .replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_match,prefix,quote,specifier)=>prefix+quote+new URL(specifier,engineURL).href+quote);
const {DuelEngine:ReferenceEngine}=await import('data:text/javascript;base64,'+Buffer.from(referenceSource).toString('base64'));
const capture=g=>({replay:captureReplayState(g),rigs:g.fighters.map(f=>f.rig.diagnostics()),steel:g.lastWeaponContact,body:g.lastBodyContacts});
const helperModule=source=>import('data:text/javascript;base64,'+Buffer.from(source.slice(0,source.indexOf('function separation('))+'\nexport {project,half,located};\n').toString('base64'));
const [currentHelpers,legacyHelpers]=await Promise.all([helperModule(currentSource),helperModule(oldSource)]);
// A one-ULP mutation in the actual transplanted reference must be observable.
assert.equal(n16SATSource.split('max:Math.max(...a)').length,2);
const perturbedHelpers=await helperModule(n16SATSource.replace('max:Math.max(...a)','max:Math.max(...a)+Number.EPSILON'));

test('scalar SAT helpers retain empty, nonfinite, signed-zero and extreme projection arithmetic',()=>{
  const clouds=[[],[{x:0,y:-0}],[{x:-0,y:0}],[{x:-1,y:2},{x:3,y:-4}],
    [{x:NaN,y:0},{x:1,y:2}],[{x:Infinity,y:0},{x:-Infinity,y:1}],[{x:1e200,y:-1e200},{x:-1e200,y:1e200}]];
  for(const vertices of clouds)for(const n of [{x:1,y:0},{x:-0,y:1},{x:.6,y:.8},{x:NaN,y:1}]){
    const panel={vertices,axes:[{x:1,y:0},{x:-0,y:1}],center:{x:-0,y:0},z:-0};
    assert.deepEqual(currentHelpers.project(panel,n),legacyHelpers.project(panel,n));
    assert.equal(Object.is(currentHelpers.half(panel,n),legacyHelpers.half(panel,n)),true);
    for(const uv of [[0,-0],[1,-1],[NaN,0]])assert.deepEqual(currentHelpers.located(panel,uv),legacyHelpers.located(panel,uv));
  }
  const unit={vertices:[{x:0,y:0},{x:1,y:0}]},axis={x:1,y:0};
  assert.equal(perturbedHelpers.project(unit,axis).max,1+Number.EPSILON);
  assert.notDeepEqual(currentHelpers.project(unit,axis),perturbedHelpers.project(unit,axis),'one ULP in the transplanted SAT must fail exact comparison');
});

test('scalar SAT and shared manifold supports preserve complete real weapon-contact trajectories exactly',t=>{
  let ticks=0,steel=0;
  for(const weapon of ['sword','spear','axe','maul'])for(const recipe of ['neutral','bind']){
    const startTicks=ticks,startSteel=steel;
    const make=Type=>{
      let seed=0x57445141;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),original=Math.random;Math.random=random;
      try{const events=[],game=new Type((name,data)=>events.push({name,data}));game.setMode('versus');game.setScenario('practice');game.setLoadout(1,{weapon});game.setLoadout(2,{weapon});game.aiEnabled=false;game.phase='fight';return {game,events,random};}finally{Math.random=original;}
    };
    const a=make(DuelEngine),b=make(ReferenceEngine);
    // N16 keeps this sustained maul contact alive: extend the same neutral
    // trajectory by 60 steps while retaining every original sample/recipe.
    const duration=weapon==='maul'&&recipe==='neutral'?180:120;
    for(let i=0;i<duration&&a.game.phase==='fight';i++){
      for(const {game,random} of [a,b]){
        game.setControl(1,recipe==='bind'?{...weaponGesture({x:.9,y:.15*Math.sin(i*.05)}),lean:.2}:neutral());
        game.setControl(2,recipe==='bind'?{...weaponGesture({x:.9,y:-.15*Math.sin(i*.05)}),lean:.2}:neutral());
        const original=Math.random;Math.random=random;try{game.update(STEP);}finally{Math.random=original;}
      }
      assert.equal(a.game.phase,b.game.phase);assert.deepEqual(a.events,b.events);ticks++;steel+=!!a.game.lastWeaponContact;
      if(i%4===0||a.game.phase!=='fight')assert.deepEqual(capture(a.game),capture(b.game),`${weapon}/${recipe}/${i}`);
    }
    assert.deepEqual(capture(a.game),capture(b.game));
    t.diagnostic(`${weapon}/${recipe}: ${ticks-startTicks} ticks, ${steel-startSteel} steel contacts.`);
  }
  t.diagnostic(`N16 trajectories: ${ticks} ticks, ${steel} real steel contacts; complete events/replay/rig/contact equality.`);
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
