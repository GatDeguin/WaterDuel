import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as current from '../public/physics/apron-cloth.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';

// Immutable pre-optimization solver: the oracle retains its original arithmetic,
// collision samples, order and ten iterations independently of the new solver.
const frozen=await readFile(new URL('./fixtures/apron-cloth-pre-1.14.js.txt',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(frozen).digest('hex'),'cf3d7c3c3f85c716cdce6b6ab5b146d204bf1c10d77485e3be1e2f1cd15878ba');
const origin=new URL('../public/physics/apron-cloth.js',import.meta.url),source=frozen
  .replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_match,prefix,quote,specifier)=>prefix+quote+new URL(specifier,origin).href+quote);
const before=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const STEP=1/120;
const bits=values=>Buffer.from(Float64Array.from(values).buffer);
const frame=(tick=0,scale=1,dir=1,y=1.12)=>{
  const angle=.23*Math.sin(tick*.13),c=Math.cos(angle),s=Math.sin(angle);
  return new Float64Array([dir*c*scale,s*scale,-.07*s*scale,0,-dir*s*scale,c*scale,.09*s*scale,0,
    .035*s*scale,-.025*s*scale,scale,0,.027*Math.sin(tick*.21),y+.035*Math.cos(tick*.17),.045*Math.sin(tick*.11),1]);
};
const makePair=(variant='normal',descriptor=null)=>[new before.ApronCloth(variant,descriptor),new current.ApronCloth(variant,descriptor)];
function exact(pair,label,{surface=false}={}){
  const [expected,actual]=pair,a=expected.snapshot(),b=actual.snapshot();
  assert.deepEqual(b,a,label+'/snapshot');
  assert.deepEqual({positions:actual.positions,velocities:actual.velocities,rest:actual.rest,frame:actual.frame,
    accumulator:actual.accumulator,wetness:actual.wetness,contact:actual.contact,contactNodes:actual.contactNodes,constraints:actual.constraints},
  {positions:expected.positions,velocities:expected.velocities,rest:expected.rest,frame:expected.frame,
    accumulator:expected.accumulator,wetness:expected.wetness,contact:expected.contact,contactNodes:expected.contactNodes,constraints:expected.constraints},label+'/live');
  for(const key of ['positions','velocities','rest','normals','directors']){
    assert.deepEqual(bits(b.cloth[key].flat()),bits(a.cloth[key].flat()),label+'/'+key+'/Float64 bits');
  }
  if(surface)for(let panel=0;panel<12;panel++){
    const indices=a.cloth.triangles[panel],canonical=[0,1,2].map(k=>indices.reduce((sum,i)=>sum+a.cloth.rest[i][k]/3,0));
    canonical[2]+=(panel%2?1:-1)*expected.thickness;
    const sa=before.apronSurfaceSample(a.cloth,canonical,panel,1.18),sb=current.apronSurfaceSample(b.cloth,canonical,panel,1.18);
    assert.deepEqual(sb,sa,label+'/surface/'+panel);
    assert.deepEqual(bits(Object.values(sb).flat()),bits(Object.values(sa).flat()),label+'/surface bits/'+panel);
  }
}
const poseAt=(tick,scale)=>{
  const point=(x,y,z)=>({x:x*scale,y:y*scale,z:z*scale}),s=Math.sin(tick*.19);
  return {frontHip:point(-.055,1.15,.12),kneeF:point(.02+s*.04,.87,.16+s*.05),ankleF:point(-.03,.61,.14),
    backHip:point(.06,1.16,.1),kneeB:point(.06-s*.04,.89,.19),footB:point(.02,.62,.12),
    clothLegs:{frontThigh:tick%17<12,frontShin:tick%13<9,backThigh:tick%11<8,backShin:tick%19<14}};
};

test('Surface sampling retains the tie rule and typed director when interpolated directions cancel',()=>{
  const rest=[[0,0,0],[1,0,0],[0,1,0]],canonical=[.5,0,.125];
  const cloth={rest,positions:rest,triangles:[[0,1,2]],
    directors:[new Float32Array([1,-0,0]),new Float32Array([-1,0,0]),new Float32Array([0,0,1])]};
  const expected=before.apronSurfaceSample(cloth,canonical,0,1.17);
  const actual=current.apronSurfaceSample(cloth,canonical,0,1.17);
  assert.equal(actual.director,cloth.directors[0]);
  assert.deepEqual(actual,expected);
});

test('Scalar cloth retains every Float64 bit of moving wet normal/boss cloth and leg attachment changes',()=>{
  let contacts=0;
  for(const variant of ['normal','boss'])for(const dir of [-1,1])for(const scale of [.83,1.18]){
    const pair=makePair(variant);
    for(const cloth of pair){cloth.advance(0,{frame:frame(0,scale,dir)});cloth.wetness={top:.63,bottom:.91};cloth.velocities[8]=[.19,-.11,.43];}
    exact(pair,`${variant}/${dir}/${scale}/initial`,{surface:true});
    for(let tick=1;tick<=36;tick++){
      for(const cloth of pair){
        if(tick===11)cloth.wetness.top=.97;
        cloth.advance([STEP,STEP/2,STEP*1.5,STEP*2][tick%4],{frame:frame(tick,scale,dir),pose:poseAt(tick,scale),gravity:tick<24?-9.81:0});
      }
      exact(pair,`${variant}/${dir}/${scale}/${tick}`,{surface:tick%12===0});contacts+=Number(pair[1].contact);
    }
  }
  assert.ok(contacts>30,'the corpus exercises actual capsule contact');
});

test('Scalar cloth preserves floor contact, multiple capsules, zero-length axes and mutable collider inputs',()=>{
  let touchedFloor=false,touchedCapsule=false;
  for(const variant of ['normal','boss']){
    const pair=makePair(variant),colliders=[{a:[-.055,.92,.13],b:[.035,.63,.13],radius:.09},
      {a:[.04,.84,.16],b:[.04,.84,.16],radius:.06},{a:[0,.76,.11],b:[0,.63,.24],radius:.065}];
    for(const cloth of pair)cloth.advance(0,{frame:frame()});
    for(let tick=1;tick<=42;tick++){
      colliders[0].a[0]=-.055+.06*Math.sin(tick*.2);colliders[1].radius=tick%7?.06:0;
      const options={frame:frame(tick,1,1,1.12-.86*Math.min(1,tick/24)),colliders:tick<28?colliders:[]};
      for(const cloth of pair){if(tick===8)cloth.wetness.bottom=1;cloth.advance(STEP,options);}
      exact(pair,`${variant}/capsules-floor/${tick}`,{surface:tick%14===0});
      const cloth=pair[1],floor=TABLE_TOP+(cloth.thickness*Math.hypot(cloth.frame[8],cloth.frame[9],cloth.frame[10])+8e-6);
      touchedCapsule||=tick<12&&cloth.contact;touchedFloor||=cloth.positions.some((p,i)=>i>=3&&p[1]===floor&&cloth.contactNodes[i]);
    }
  }
  assert.ok(touchedCapsule&&touchedFloor,'both contact paths are exercised');
});

test('Scalar cloth keeps collider aliases live while samples and constraints move the twelve nodes',()=>{
  for(const variant of ['normal','boss']){
    const pair=makePair(variant);
    for(const cloth of pair)cloth.advance(0,{frame:frame()});
    for(let tick=0;tick<12;tick++){
      for(const cloth of pair){
        // These arrays are intentionally the solver's live nodes: caching a
        // capsule axis across projections would change the public input behavior.
        const colliders=[{a:cloth.positions[6],b:cloth.positions[10],radius:.045},
          {a:cloth.positions[4],b:cloth.positions[4],radius:.025}];
        cloth.advance(STEP,{frame:frame(tick+1),colliders});
      }
      exact(pair,`${variant}/live capsule aliases/${tick}`);
    }
  }
});

test('Scalar cloth retains signed zeros, kinematic pin refresh, direct integration and caller-owned snapshots',()=>{
  const descriptor={pivot:[-0,-0,-0],bounds:{min:[-.12,-.32,-.018],max:[.12,-0,.018]}},pair=makePair('normal',descriptor);
  const identity=new Float64Array([1,-0,-0,0,-0,1,-0,0,-0,-0,1,0,-0,-0,-0,1]);
  for(const cloth of pair){
    cloth.advance(0,{frame:identity});cloth.wetness.top=-0;
    for(let i=0;i<12;i++){cloth.positions[i][2]=-0;cloth.velocities[i]=[-0,-0,-0];}
  }
  assert.ok(pair[1].positions.every(p=>Object.is(p[2],-0)),'signed-zero input is present');
  exact(pair,'signed zeros/initial');
  const held=pair[1].snapshot(),owned=structuredClone(held);
  for(let tick=0;tick<12;tick++){
    for(const cloth of pair){
      cloth.advance(0,{frame:identity});
      cloth.integrate(STEP,tick%2?-0:0,[{a:[-0,-0,-0],b:[0,-0,0],radius:.04}],1);
    }
    exact(pair,'signed zeros/direct/'+tick,{surface:tick===11});
  }
  assert.deepEqual(held,owned,'retained snapshots do not borrow scratch arrays');
  for(const cloth of pair){cloth.positions[0][0]=.2;cloth.rest[11][1]-=.03;cloth.advance(STEP,{frame:frame(9)});}
  exact(pair,'mutable rest and refreshed pins');
});

test('Scalar cloth preserves interior-only capsule contacts and zero-weight sample node updates',()=>{
  const descriptor={pivot:[0,0,.1],bounds:{min:[-.45,-.6,.09],max:[.45,0,.11]}},pair=makePair('boss',descriptor);
  const m=new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,0,1.3,0,1]);
  for(const cloth of pair)cloth.advance(0,{frame:m});
  const initial=pair[0].positions,triangle=before.APRON_TRIANGLES[8],center=[0,1,2].map(k=>triangle.reduce((sum,i)=>sum+initial[i][k]/3,0));
  const collider={a:[...center],b:[center[0],center[1],center[2]+.001],radius:.018};
  assert.ok(initial.every(p=>Math.hypot(...p.map((v,k)=>v-center[k]))>.04),'no initial node is inside the capsule');
  let touched=false;
  for(let tick=0;tick<10;tick++){
    for(const cloth of pair)cloth.advance(STEP,{frame:m,gravity:0,colliders:[collider]});
    touched||=pair[1].contact;
    exact(pair,'interior-only/'+tick,{surface:tick===9});
  }
  assert.ok(touched,'the interior sample still resolves a collision');
});

test('Scalar capsule projection retains the original bits at random and degenerate three-dimensional contacts',async()=>{
  // Test the real private helper without adding a testing API to the solver.
  const expose=async(text,adapter)=>{
    const code=text.replace(/(from\s*)(['"])(\.[^'"\n]+)\2/g,(_match,prefix,quote,specifier)=>prefix+quote+new URL(specifier,origin).href+quote);
    return import('data:text/javascript;base64,'+Buffer.from(code+'\nexport const project='+adapter+';').toString('base64'));
  };
  const a=await expose(frozen,'(p,c,radius)=>capsulePush(p,c,radius)'),
    b=await expose(await readFile(origin,'utf8'),'(p,c,radius)=>{const push=[0,0,0];return capsulePush(p[0],p[1],p[2],c,radius,push)?push:null;}');
  let seed=0x4150524e,contacts=0,separated=0;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),vector=()=>Array.from({length:3},()=>random()*4-2);
  const compare=(p,c,radius,label)=>{
    const expected=a.project(p,c,radius),actual=b.project(p,c,radius);
    assert.deepEqual(actual,expected,label);
    if(expected){assert.deepEqual(bits(actual),bits(expected),label+'/Float64 bits');contacts++;}else separated++;
  };
  for(let i=0;i<2400;i++){
    const c={a:vector(),b:vector(),radius:random()*.18},t=random(),radius=random()*.08,
      p=c.a.map((v,k)=>v+t*(c.b[k]-v)+(random()-.5)*.4);
    if(i%7===0)c.b=[...c.a];
    if(i%11===0)p.splice(0,3,...c.a);
    compare(p,c,radius,'random capsule/'+i);
  }
  for(const zero of [-0,0])for(const magnitude of [0,Number.MIN_VALUE,1e-11,1e-10,1e-9,1e150,1e300,Infinity,NaN]){
    compare([zero,zero,zero],{a:[zero,zero,zero],b:[magnitude,zero,zero],radius:.05},.018,'axis boundary/'+String(magnitude));
    compare([magnitude,zero,zero],{a:[zero,zero,zero],b:[zero,zero,zero],radius:.05},.018,'distance boundary/'+String(magnitude));
  }
  const endpoints=[values=>values,values=>Float32Array.from(values),values=>Float64Array.from(values),values=>Int16Array.from(values),
    values=>[...values,.25],values=>values.slice(0,2)];
  for(const [ia,convertA] of endpoints.entries())for(const [ib,convertB] of endpoints.entries())for(let i=0;i<24;i++){
    const c={a:convertA([.037,-.131,.02]),b:convertB([.17,.263,-.06]),radius:.12},p=[.045+i*.004,-.123+i*.005,.035];
    compare(p,c,.018,`endpoint representations/${ia}/${ib}/${i}`);
  }
  assert.ok(contacts>700&&separated>100,'both intersecting and separated projections are covered');
});
