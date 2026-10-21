import test from 'node:test';
import assert from 'node:assert/strict';
import {JointImpactDamage} from '../public/physics/joint-impact.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';

// Owned pose witnesses; the tracker must neither run nor mutate a rig.
const fighter=slot=>({slot,pose:{mainShoulder:{x:0,y:2,z:.17},mainElbow:{x:.4,y:2,z:.17},mainHand:{x:.8,y:2,z:.17},
  offShoulder:{x:0,y:2,z:-.1},offElbow:{x:-.4,y:2,z:-.1},frontHip:{x:.1,y:1,z:.19},kneeF:{x:.1,y:.5,z:.19},backHip:{x:-.1,y:1,z:-.17},kneeB:{x:-.1,y:.5,z:-.17}},
  rig:{scale:1,isBodyAttached:()=>true}});
function contact(overrides={}){
  return {a:fighter(1),b:fighter(2),bodyA:'weapon',keyA:'weapon',bodyB:'mainForearm',keyB:'mainForearm',
    pointA:{x:1,y:2,z:.17},pointB:{x:.8,y:2,z:.17},normal:{x:0,y:1,z:0},impulse:.3,closingSpeed:2,peakClosingSpeed:2,source:'body',...overrides};
}
const forSlot=(changes,slot)=>changes.filter(change=>change.slot===slot);

test('An observed mechanical impact targets the struck hinge and gives the attacking wrist only a smaller load',()=>{
  const c=contact(),before=structuredClone({a:c.a.pose,b:c.b.pose}),changes=new JointImpactDamage().process([c],0);
  const wrist=forSlot(changes,1),elbow=forSlot(changes,2);
  assert.equal(wrist.length,1);assert.equal(wrist[0].joint,'wrist');
  assert.equal(elbow.length,1);assert.equal(elbow[0].joint,'mainElbow');
  assert.ok(wrist[0].amount>=.01&&wrist[0].amount<elbow[0].amount);
  assert.ok(elbow[0].amount<=.25);assert.deepEqual({a:c.a.pose,b:c.b.pose},before);
  assert.deepEqual(Object.keys(elbow[0]).sort(),['amount','at','closingSpeed','impulse','joint','slot']);
  elbow[0].at.x=100;assert.equal(c.pointB.x,.8,'changes own their impact point');
});

test('Zero impulse, slow motion, separation and subthreshold energy cannot cause idle fatigue',()=>{
  for(const patch of [{impulse:0},{impulse:.034},{closingSpeed:.54,peakClosingSpeed:.54},{closingSpeed:-2,peakClosingSpeed:0},{impulse:.035,closingSpeed:.55,peakClosingSpeed:.55}]){
    const tracker=new JointImpactDamage(),c=contact(patch);
    for(let i=0;i<360;i++)assert.deepEqual(tracker.process([c],i/120),[]);
  }
});

test('Body, steel and guard duplicates aggregate the strongest impact per joint and do not depend on order',()=>{
  const weak=contact({impulse:.08,closingSpeed:1,peakClosingSpeed:1}),strong={...weak,impulse:.3,closingSpeed:2,peakClosingSpeed:2};
  const expected=new JointImpactDamage().process([strong],0);
  const duplicates=[{...weak,source:'body'},{...strong,source:'steel'},{...strong,source:'guard'},strong];
  assert.deepEqual(new JointImpactDamage().process(duplicates,0),expected);
  assert.deepEqual(new JointImpactDamage().process([...duplicates].reverse(),0),expected);
});

test('Different simultaneous contacts still produce only the maximum, rather than a sum, for a struck hinge',()=>{
  const first=contact({impulse:.1,closingSpeed:1,peakClosingSpeed:1});
  const second=contact({a:first.a,b:first.b,bodyA:'mainUpper',keyA:'mainUpper'});
  const expected=forSlot(new JointImpactDamage().process([second],0),2);
  const tracker=new JointImpactDamage(),changes=tracker.process([first,second],0);
  assert.deepEqual(forSlot(changes,2),expected);
  assert.deepEqual(tracker.process([first,second],1/120),[],'both episodes were consumed even though changes were aggregated');
});

test('A sustained contact never repeats damage; zero impulse observations keep the episode occupied',()=>{
  const tracker=new JointImpactDamage(),c=contact();assert.equal(tracker.process([c],0).length,2);
  for(let i=1;i<=120;i++)assert.deepEqual(tracker.process([{...c,impulse:i<110?0:.3}],i/120),[]);
  assert.deepEqual(tracker.process([],1.05),[]);
  assert.deepEqual(tracker.process([c],1.1),[],'less than .12 seconds of separation does not rearm');
  tracker.process([],1.2);tracker.process([],1.23);
  assert.equal(tracker.process([c],1.23).length,2,'a real separation rearms the impact');
});

test('Zero impulse on first geometric touch may precede the first real impact',()=>{
  const tracker=new JointImpactDamage(),c=contact();assert.deepEqual(tracker.process([{...c,impulse:0}],0),[]);
  assert.equal(tracker.process([c],1/120).length,2);
  assert.deepEqual(tracker.process([c],2/120),[]);
});

test('Key/body-only zero observations maintain an episode without fabricated points or normals',()=>{
  const tracker=new JointImpactDamage(),c=contact();assert.equal(tracker.process([c],0).length,2);
  const touch={a:c.a,b:c.b,bodyA:c.bodyA,bodyB:c.bodyB,keyA:c.keyA,keyB:c.keyB,impulse:0,source:'body'};
  for(let i=1;i<=60;i++)assert.deepEqual(tracker.process([touch],i/120),[]);
  assert.deepEqual(tracker.process([c],.51),[],'the ongoing solver contact is not a new blow');
  tracker.process([],.7);assert.equal(tracker.process([c],.7).length,2);
});

test('Observation step subdivision cannot multiply an impact or change its severity',()=>{
  const c=contact(),run=step=>{const tracker=new JointImpactDamage(),out=[];for(let t=0;t<.5;t+=step)out.push(...tracker.process([c],t));return out;};
  assert.deepEqual(run(1/60),run(1/120));
});

test('Separation episodes distinguish the actual opposing body, not the source channel',()=>{
  const tracker=new JointImpactDamage(),c=contact();tracker.process([c],0);
  const other=contact({bodyA:'mainUpper',keyA:'mainUpper'}),changes=tracker.process([c,other],1/120);
  assert.equal(forSlot(changes,2).length,1);assert.equal(forSlot(changes,2)[0].joint,'mainElbow');
  assert.deepEqual(tracker.process([other],2/120),[]);
});

test('Each arm/leg body maps to its hinge; torso, neck and pelvis never receive changes',()=>{
  const mapping={mainUpper:'mainShoulder',mainForearm:'mainElbow',offUpper:'offShoulder',offForearm:'offElbow',frontThigh:'frontHip',frontShin:'frontKnee',backThigh:'backHip',backShin:'backKnee'};
  for(const [body,joint]of Object.entries(mapping)){
    const changes=forSlot(new JointImpactDamage().process([contact({bodyB:body,keyB:body})],0),2);
    assert.equal(changes.length,1,body);assert.equal(changes[0].joint,joint);
  }
  for(const body of ['torso','neck','pelvis','unknown'])assert.deepEqual(forSlot(new JointImpactDamage().process([contact({bodyB:body,keyB:body})],0),2),[]);
  assert.equal(forSlot(new JointImpactDamage().process([contact({bodyB:'weapon',keyB:'main-palm'})],0),2)[0].joint,'wrist');
});

test('Larger observed hinge leverage causes more damage, with bounded outputs for violent finite impacts',()=>{
  const amount=pointB=>forSlot(new JointImpactDamage().process([contact({pointB,impulse:.1,closingSpeed:1.2,peakClosingSpeed:1.2})],0),2)[0].amount;
  assert.ok(amount({x:.8,y:2,z:.17})>amount({x:.4,y:2,z:.17}));
  const violent=new JointImpactDamage().process([contact({impulse:1e100,closingSpeed:1e100,peakClosingSpeed:1e100})],0);
  assert.equal(violent.length,2);
  for(const change of violent)assert.ok(Number.isFinite(change.amount)&&change.amount>=.01&&change.amount<=.25);
  assert.deepEqual(new JointImpactDamage().process([contact({impulse:1e200,closingSpeed:1e200,peakClosingSpeed:1e200})],0),[],'overflow is invalid mechanical evidence');
});

test('Mirrored slots/poses preserve damage and contact identity is orientation-independent',()=>{
  const c=contact(),normal={x:-c.normal.x,y:-c.normal.y,z:-c.normal.z};
  const reversed={...c,a:c.b,b:c.a,bodyA:c.bodyB,bodyB:c.bodyA,keyA:c.keyB,keyB:c.keyA,pointA:c.pointB,pointB:c.pointA,normal};
  assert.deepEqual(new JointImpactDamage().process([c],0),new JointImpactDamage().process([reversed],0));
  const tracker=new JointImpactDamage();tracker.process([c],0);assert.deepEqual(tracker.process([reversed],.01),[]);
});

test('Invalid observations fail closed without poisoning a later valid impact',()=>{
  for(const patch of [{a:null},{b:null},{a:fighter(2)},{impulse:NaN},{closingSpeed:Infinity},{normal:{x:NaN,y:0}},{pointB:{x:NaN,y:2}},{source:'synthetic'}]){
    const tracker=new JointImpactDamage();assert.deepEqual(tracker.process([contact(patch)],0),[]);
    assert.equal(tracker.process([contact()],.01).length,2);
  }
  const tracker=new JointImpactDamage();assert.deepEqual(tracker.process(null,0),[]);assert.deepEqual(tracker.process([contact()],NaN),[]);
  assert.equal(tracker.process([contact()],0).length,2);
});

test('Detached bodies and missing pose witnesses cannot receive mechanical damage',()=>{
  const c=contact();c.b.rig.isBodyAttached=()=>false;
  assert.deepEqual(forSlot(new JointImpactDamage().process([c],0),2),[]);
  delete c.a.pose.mainHand;assert.deepEqual(new JointImpactDamage().process([c],0),[]);
});

test('A new tracker resets contact episodes; retained changes never mutate on a later step',()=>{
  const c=contact(),tracker=new JointImpactDamage(),first=tracker.process([c],0),saved=structuredClone(first);
  tracker.process([c],.01);tracker.process([],1);assert.deepEqual(first,saved);
  assert.deepEqual(new JointImpactDamage().process([c],0),saved);
});

test('Actual rig pose witnesses are read without changing solver state or creating detached parts',()=>{
  const a={slot:1,rig:new ArticulatedRig({baseX:-1.3})},b={slot:2,rig:new ArticulatedRig({dir:-1,baseX:1.3})};
  a.pose=a.rig.pose();b.pose=b.rig.pose();
  const before=structuredClone({a:a.pose,b:b.pose,qA:[...a.rig.q],qB:[...b.rig.q],vA:[...a.rig.velocity],vB:[...b.rig.velocity]});
  const changes=new JointImpactDamage().process([contact({a,b,pointA:{...a.pose.tip},pointB:{...b.pose.mainHand}})],0);
  assert.equal(changes.length,2);assert.equal(forSlot(changes,2)[0].joint,'mainElbow');
  assert.deepEqual({a:a.rig.pose(),b:b.rig.pose(),qA:[...a.rig.q],qB:[...b.rig.q],vA:[...a.rig.velocity],vB:[...b.rig.velocity]},before);
});
