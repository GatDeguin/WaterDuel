import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {firstWeaponContact,resolveWeaponBind,weaponBindManifold} from '../public/physics/weapon-bind.js';
import {BALLOON_RADII,TABLE_TOP} from '../public/physics/dimensions.js';
const raw=await fs.readFile(new URL('./fixtures/sword-axe-countdown-1.13.1.json',import.meta.url));
assert.equal(createHash('sha256').update(raw).digest('hex'),'97e45a719cf9e14eb37d3028ed997bae851cca5d85915d86dff4ab4ff4023ff4','captured native source fixture is not regenerated from the fix');
const fixture=JSON.parse(raw,(_key,value)=>value?.$typed?new globalThis[value.$typed](value.data):value?.$set?new Set(value.$set):value);
assert.equal(fixture.engineSHA,'ab55912da7216cdb3e8a5c8c52d5fcf9f68026e6981f3e19c8471b33f7dd9d2d');
const steel=r=>r.collisionPanels().filter(p=>p.body==='weapon'&&p.material!=='wood');
function overlaps(a,b){const out=[];for(const x of steel(a))for(const y of steel(b)){
  if(Math.abs(x.z-y.z)>=(x.depth+y.depth)/2)continue;let depth=Infinity;
  for(const n of [...x.axes,...y.axes]){const A=x.vertices.map(p=>p.x*n.x+p.y*n.y),B=y.vertices.map(p=>p.x*n.x+p.y*n.y);depth=Math.min(depth,Math.max(...A)-Math.min(...B),Math.max(...B)-Math.min(...A));}
  if(depth>1e-6)out.push({keyA:x.key,keyB:y.key,depth});
}return out;}
function rigs(spec,{mirror=1,scale=1}={}){return spec.rigs.map(({state,pose,flex})=>{
  const r=new ArticulatedRig({dir:state.dir,scale:state.scale,baseX:state.q[0],pose,gravity:state.gravity,flexibleWeapons:true});
  Object.assign(r,structuredClone(state));Object.assign(r.weaponFlex,structuredClone(flex));
  // A component-size/mirror corpus derived from the frozen native pose. The
  // rig still builds its real equipment widths, boss soles, masses and DOFs.
  if(mirror!==1||scale!==1){
    r.dir*=mirror;r.scale*=scale;
    for(const q of [r.q,r.target,r.previousQ].filter(Boolean)){q[0]*=mirror*scale;q[1]=TABLE_TOP+(q[1]-TABLE_TOP)*scale;}
    for(const c of r.contacts){c.x*=mirror*scale;c.y=TABLE_TOP+(c.y-TABLE_TOP)*scale;c.offset*=mirror*scale;c.floor=TABLE_TOP+(c.floor-TABLE_TOP)*scale;}
    r.intentBase*=mirror*scale;r.gait.stanceBase*=mirror*scale;r.swordLength*=scale;
    if(r.previousSwordLength!==undefined)r.previousSwordLength*=scale;if(r.lastSwordLength!==undefined)r.lastSwordLength*=scale;
  }
  return r;
});}

test('zero-flex compound initial overlap exposes the real axe-head constraint as well as its shaft',()=>{
  for(const spec of fixture.cases){
    const [a,b]=rigs(spec),initial=overlaps(a,b);assert.ok(initial.some(c=>c.keyA==='weapon-head'||c.keyB==='weapon-head'),'recorded game spawn actually contains the axe head');
    assert.equal(a.weaponFlex.offset,0);assert.equal(b.weaponFlex.offset,0);
    const contact=firstWeaponContact(a,b);assert.equal(contact.t,0);
    const constraints=weaponBindManifold(a,b,contact);
    for(const pair of initial)assert.ok(constraints.some(c=>c.keyA==='steel:'+pair.keyA&&c.keyB==='steel:'+pair.keyB),'missing real collider '+JSON.stringify(pair));
  }
});

test('initial compound escape uses the coherent shallower side instead of pushing the sword farther into the axe',()=>{
  for(const spec of fixture.cases){
    const pair=rigs(spec),hit=firstWeaponContact(...pair),constraints=weaponBindManifold(...pair,hit);
    const expectedY=spec.weapons[0]==='sword'?-1:1;
    assert.ok(hit.normal.y*expectedY>.99,'shorter measured exit must account for the head above/below its shaft');
    assert.ok(constraints.every(c=>c.normal.x*hit.normal.x+c.normal.y*hit.normal.y>=0),'initial compound constraints must not fight on opposite sides');
  }
});

test('recorded sword/axe entrapment recovers through physical shared contacts in both slot orders',()=>{
  for(const spec of fixture.cases)for(const mirror of [-1,1])for(const scale of [1,1.18]){
    const pair=rigs(spec,{mirror,scale}),original=pair.map(r=>({target:r.target.slice(),water:structuredClone(r.waterLoad),length:r.swordLength}));
    assert.ok(overlaps(...pair).length>=2,'native captured penetration is non-vacuous');
    for(let tick=0;tick<8;tick++){
      for(const r of pair)r.step(1/120);
      const hit=resolveWeaponBind(...pair,{dt:1/120,project:false});
      const extraContacts=hit.at?()=>weaponBindManifold(...pair,hit):undefined;
      ArticulatedRig.resolvePair(...pair,{headRadiiA:BALLOON_RADII,headRadiiB:BALLOON_RADII,extraContacts});
    }
    assert.deepEqual(overlaps(...pair),[],`${JSON.stringify(spec.weapons)}/${mirror}/${scale} cannot leave the blade buried in a solid axe head`);
    for(const [i,r]of pair.entries()){
      assert.deepEqual(r.target,original[i].target);assert.deepEqual(r.waterLoad,original[i].water);assert.equal(r.swordLength,original[i].length);
      assert.ok(r.q.every(Number.isFinite)&&r.velocity.every(Number.isFinite));
    }
  }
});

test('a genuine entry from outside retains its original continuous time, normal, points and material anchors',async()=>{
  const bytes=await fs.readFile(new URL('./fixtures/weapon-bind-pre-query-1.13.js.txt',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'96250b199cac641d405f98d0180441e1ffe889754325480557e9fd5c804b7e9a');
  const source=bytes.toString('utf8').replace("'./articulated-rig.js'",JSON.stringify(new URL('../public/physics/articulated-rig.js',import.meta.url).href));
  const before=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  for(const spec of fixture.cases)for(const mirror of [-1,1]){
    const pair=rigs(spec,{mirror});for(const r of pair){r.previousQ=r.q.slice();r.previousQ[0]-=r.dir*1.1;}
    const old=before.firstWeaponContact(...pair),current=firstWeaponContact(...pair);
    assert.ok(old&&old.t>0&&old.t<1,'the sweep actually enters from outside');assert.deepEqual(current,old,'t>0 CCD is unchanged');
  }
});

test('a legacy selected sampler may omit a panel at t0 without breaking another real initial contact',()=>{
  const [a,b]=rigs(fixture.cases[0]),key='absent-at-start';
  const legacy={...a,collisionPanels:()=>{const p=a.collisionPanels();return [...p,{...p.find(x=>x.key==='weapon'),key}];},
    collisionPanelsAt:t=>{const p=a.collisionPanelsAt(t);return t===0?p:[...p,{...p.find(x=>x.key==='weapon'),key}];},
    collisionGeometryAt:(t,selected)=>selected===key?(t===0?[]:a.collisionGeometryAt(t,'weapon').map(p=>({...p,key}))):a.collisionGeometryAt(t,selected)};
  const hit=firstWeaponContact(legacy,b);assert.ok(hit&&hit.t===0);assert.notEqual(hit.keyA,key);
});
