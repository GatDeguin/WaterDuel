import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {DuelEngine} from '../public/engine.js';
import {firstWeaponContact,firstWeaponPointContact} from '../public/physics/weapon-bind.js';

const bytes=await readFile(new URL('./fixtures/weapon-bind-pre-selected-sampler-1.7.2.js.txt',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'f828849fda02f47c0131c76b41be45f08ae0bb2241c1001dc47555176be56cd1','The original CCD source oracle is pinned without edits.');
const source=bytes.toString('utf8').replace("'./articulated-rig.js'",JSON.stringify(new URL('../public/physics/articulated-rig.js',import.meta.url).href));
const before=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const state=r=>({q:[...r.q],previousQ:[...r.previousQ],velocity:[...r.velocity],target:[...r.target],depth:{...r.depth},equipment:{...r.equipment},length:r.swordLength,previousLength:r.previousSwordLength,flex:r.weaponFlex?{offset:r.weaponFlex.offset,previous:r.weaponFlex.previousOffset}:null});

function* fixtures(){
  for(const weapon of ['sword','spear','axe','maul'])for(const dir of [-1,1])for(const scale of [1,1.18])for(const flexible of [false,true]){
    const g=new DuelEngine();g.setMode('versus');g.setLoadout(1,{weapon,defense:'knife'});g.setLoadout(2,{weapon,defense:'none'});
    yield g.fighters.map((f,i)=>{
      f.dir=i===0?dir:-dir;f.baseX=-f.dir*1.53;f.boss=scale>1;
      const r=new ArticulatedRig({dir:f.dir,scale,baseX:f.baseX,pose:g.buildPose(f),gravity:0,flexibleWeapons:flexible});
      r.previousQ=r.q.slice();r.previousQ[1]+=.04;r.q[13]+=.08*Math.sin(dir+i);r.q[4]+=.03;r.previousSwordLength=r.swordLength*.99;
      if(r.weaponFlex?.maximum){r.weaponFlex.offset=.014*dir;r.weaponFlex.previousOffset=-.011*dir;}
      return r;
    });
  }
}

test('selected weapon CCD retains exact entry, manifold and anchors for rigid/flexible weapons, both roles and boss scale',()=>{
  let pairs=0,flexed=0,twoHanded=0;
  for(const pair of fixtures()){
    const saved=pair.map(state);
    assert.deepEqual(firstWeaponContact(...pair),before.firstWeaponContact(...pair));
    for(const r of pair){
      const p=r.pose().tip,from={x:p.x-.2,y:p.y+.1,z:.177},to={x:p.x+.2,y:p.y-.1,z:.177};
      assert.deepEqual(firstWeaponPointContact(r,from,to),before.firstWeaponPointContact(r,from,to));
      flexed+=r.collisionPanels().filter(p=>p.key.startsWith('weapon-flex-')).length===3;
      twoHanded+=r.twoHanded;
    }
    assert.deepEqual(pair.map(state),saved,'queries cannot change physical state');pairs++;
  }
  assert.equal(pairs,32);assert.ok(flexed>0);assert.ok(twoHanded>0);
});

test('real selected queries avoid whole-rig interpolation and cache each time/key only within the current query',()=>{
  const r=new ArticulatedRig({gravity:0,flexibleWeapons:true});r.previousQ=r.q.slice();r.weaponFlex.offset=.025;r.weaponFlex.previousOffset=-.014;
  const geometry=r.collisionGeometryAt.bind(r),full=r.collisionPanelsAt.bind(r),seen=new Set();let fullCalls=0,selectedCalls=0;
  r.collisionPanelsAt=(...args)=>{fullCalls++;return full(...args);};
  r.collisionGeometryAt=(t,key)=>{assert.equal(seen.has(`${t}:${key}`),false,'one interpolation per distinct time/key');seen.add(`${t}:${key}`);selectedCalls++;return geometry(t,key);};
  const p=r.pose().tip,from={x:p.x-.4,y:p.y,z:.177},to={x:p.x+.4,y:p.y,z:.177};
  const expected=before.firstWeaponPointContact(r,from,to);fullCalls=0;
  assert.deepEqual(firstWeaponPointContact(r,from,to),expected);assert.ok(selectedCalls>0);assert.equal(fullCalls,0);
  seen.clear();r.q[0]+=6;r.previousQ[0]+=6;
  assert.deepEqual(firstWeaponPointContact(r,from,to),before.firstWeaponPointContact(r,from,to));
  assert.equal(firstWeaponPointContact({...r,collisionPanelsAt:null},from,to),null);
});

const rectangle=(key,x=0)=>({body:'weapon',key,axes:[{x:1,y:0},{x:0,y:1}],center:{x,y:0},vertices:[{x:x-.5,y:-.017},{x:x-.5,y:.017},{x:x+.5,y:.017},{x:x+.5,y:-.017}],z:.177,depth:.034});
test('legacy and selected adapters retain Map last-key semantics, missing keys and negative caching',()=>{
  for(const selected of [false,true])for(const key of ['blade',NaN,-0]){
    const panels=[rectangle(key,3),rectangle(key,0)],calls=new Map();
    const r={q:[],previousQ:[],collisionPanels:()=>panels,collisionPanelsAt:t=>panels};
    if(selected)r.collisionGeometryAt=(t,k)=>{const id=`${t}:${String(k)}`;calls.set(id,(calls.get(id)??0)+1);return panels.filter(p=>p.key===k||p.key!==p.key&&k!==k);};
    const from={x:-1,y:0,z:.177},to={x:1,y:0,z:.177};
    assert.deepEqual(firstWeaponPointContact(r,from,to),before.firstWeaponPointContact(r,from,to));
    assert.ok([...calls.values()].every(n=>n===1));
  }
  let calls=0;const p=rectangle('absent'),missing={q:[],previousQ:[],collisionPanels:()=>[p,p],collisionPanelsAt:()=>[],collisionGeometryAt:()=>{calls++;return [];}};
  const from={x:-1,y:0,z:.177},to={x:1,y:0,z:.177};
  assert.equal(firstWeaponPointContact(missing,from,to),before.firstWeaponPointContact(missing,from,to));assert.equal(calls,1);
  firstWeaponPointContact(missing,from,to);assert.equal(calls,2,'a new query must not retain a prior miss');
});

test('severed real weapons keep the legacy sampler, and topology changes never reuse a parent hit',()=>{
  const source=new ArticulatedRig({baseX:-1.53,gravity:0}),target=new ArticulatedRig({dir:-1,baseX:1.53,gravity:0});
  firstWeaponContact(source,target);source.damageJoint('wrist',1);const fragment=source.fragments[0];
  fragment.previous={x:fragment.x-.2,y:fragment.y+.03,angle:-.05};assert.equal(typeof fragment.collisionGeometryAt,'undefined');
  for(const actor of [source,fragment]){
    assert.deepEqual(firstWeaponContact(actor,target),before.firstWeaponContact(actor,target));
    const p=target.pose().tip,from={x:p.x-.5,y:p.y,z:.177},to={x:p.x+.5,y:p.y,z:.177};
    assert.deepEqual(firstWeaponPointContact(actor,from,to),before.firstWeaponPointContact(actor,from,to));
  }
});
