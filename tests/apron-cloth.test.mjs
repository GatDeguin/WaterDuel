import test from 'node:test';
import assert from 'node:assert/strict';
import * as apron from '../public/physics/apron.js';
import {TABLE_TOP} from '../public/physics/dimensions.js';
import fs from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms} from '../public/rendering/asset-rig.js';
import {wetApronFromParcels} from '../public/physics/surface-state.js';
import {DuelEngine,STEP} from '../public/engine.js';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {captureReplayState,replayView} from '../public/replay.js';
import {deformApronPart} from '../public/rendering/apron-deform.js';
import * as apronDeform from '../public/rendering/apron-deform.js';
import {surfaceEmblem} from '../public/rendering/emblems.js';
import {apronSurfaceOverride} from '../public/rendering/apron-color.js';
import {Renderer3D} from '../public/render3d.js';
const load=async variant=>{const b=await fs.readFile(new URL(`../public/assets/characters/water-mannequin/v4/water-mannequin${variant==='boss'?'-boss':''}.glb`,import.meta.url));return prepareCharacter(parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));};
const frame=(x=0,y=1.2,z=0)=>new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1]);
const make=variant=>{assert.equal(typeof apron.ApronCloth,'function','v4 must expose the reduced cloth solver');const c=new apron.ApronCloth(variant);c.advance(0,{frame:frame()});return c;};
const run=(c,n,options={})=>{for(let i=0;i<n;i++)c.advance(1/120,{frame:frame(),...options});};
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);

test('active apron retains second order motion after belt shock and damps at rest, normal and boss',()=>{
  for(const variant of ['normal','boss']){
    const c=make(variant);run(c,60);c.advance(1/120,{frame:frame(0,1.2,.07),passive:false});
    const shock=c.snapshot().cloth.positions;run(c,8,{frame:frame(0,1.2,.07)});const swinging=c.snapshot().cloth.positions;
    assert.ok(distance(shock[10],swinging[10])>.001,'active solver cannot reset angle/velocity every frame');
    run(c,720,{frame:frame(0,1.2,.07)});const settled=c.snapshot().cloth.positions;run(c,120,{frame:frame(0,1.2,.07)});
    assert.ok(distance(settled[10],c.snapshot().cloth.positions[10])<.001,'motion settles without added energy');
  }
});

test('asymmetric real leg contact produces twist and local bending instead of one rigid hinge',()=>{
  const c=make('boss');run(c,60);
  const before=c.snapshot().cloth.positions;
  const capsule={a:[before[7][0]-.06,before[7][1],before[7][2]-.035],b:[before[7][0]-.06,before[7][1]-.2,before[7][2]-.035],radius:.085};
  let touched=false;for(let i=0;i<24;i++){run(c,1,{colliders:[capsule]});touched||=c.snapshot().contact;}const s=c.snapshot().cloth;
  assert.ok(Math.abs(s.positions[6][2]-s.positions[8][2])>.005,'left/right deformation must differ');
  const first=s.normals[0],last=s.normals.at(-1);
  assert.ok(distance(first,last)>.02,'panel normals must differ to evidence local fold');
  assert.ok(touched,'collision reports the actual constrained surface');
});

test('floor and snapshot ownership use all twelve live nodes',()=>{
  for(const variant of ['normal','boss']){
    const c=make(variant);let touched=false;for(let i=0;i<270;i++){run(c,1,{frame:frame(0,1.2-.71*Math.min(1,(i+1)/120)),passive:true});touched||=c.contact;}const a=c.snapshot(),b=c.snapshot();
    assert.equal(a.cloth.positions.length,12);assert.equal(a.cloth.revision,4);
    assert.ok(a.cloth.positions.every(p=>p[1]>=TABLE_TOP));assert.ok(touched);
    a.cloth.positions[11][0]=123;a.cloth.rest[0][0]=456;a.cloth.normals[0][0]=789;
    assert.deepEqual(c.snapshot(),b,'snapshot owns nested geometry arrays');
  }
});

test('v4 preparation keeps belt stitches and buckle rigid and binds all cloth triangles to panels preserving UV1',async()=>{
  for(const variant of ['normal','boss']){
    const prepared=await load(variant),cloth=prepared.parts.filter(p=>p.accessory==='apron'&&/Woven/.test(p.nodeName));
    assert.ok(cloth.length>=12,'surface is partitioned across independently deforming triangles');
    assert.ok(cloth.every(p=>Number.isInteger(p.apronPanel)&&p.uv1?.length===p.positions.length/3*2));
    assert.ok(prepared.parts.some(p=>p.accessory!=='apron'&&/Woven/.test(p.nodeName)),'belt stitches remain owned by rigid pelvis');
    assert.ok(prepared.apron.pivot[1]<.15,'belt geometry cannot raise the cloth anchor');
    const physical=make(variant).geometry;
    for(const bound of ['min','max'])assert.ok(distance(prepared.apron.bounds[bound],physical.bounds[bound])<1e-6,'v4 measured canonical geometry agrees with the physical descriptor');
  }
});

test('wetting tests the deformed triangles in two regions rather than the obsolete hinge box',()=>{
  const c=make('normal');run(c,1,{frame:frame(0,1.2,.2)});const snapshot=c.snapshot(),s=snapshot.cloth;
  const center=t=>[0,1,2].map(k=>s.triangles[t].reduce((sum,i)=>sum+s.positions[i][k]/3,0));
  const particle=at=>({x:at[0],y:at[1],z:at[2],r:.002,volume:.0001,free:true});
  const wet=at=>wetApronFromParcels(c,snapshot,[{released:true,particles:[particle(at)]}],1/120);
  assert.equal(wet(center(0)),1);assert.ok(c.wetness.top>0);assert.equal(c.wetness.bottom,0);
  assert.equal(wet(center(11)),1);assert.ok(c.wetness.bottom>0);
  const saved={...c.wetness};assert.equal(wet([0,1.15,-.25]),0);assert.deepEqual(c.wetness,saved);
});

test('fixed clock produces identical cloth state at 30 and 120 Hz with stationary input',()=>{
  for(const variant of ['normal','boss']){
    const a=make(variant),b=make(variant);
    for(let i=0;i<60;i++)a.advance(1/30,{frame:frame(0,1.2,.035)});
    for(let i=0;i<240;i++)b.advance(1/120,{frame:frame(0,1.2,.035)});
    assert.deepEqual(a.snapshot().cloth.positions,b.snapshot().cloth.positions);
  }
});

test('every rendered v4 cloth and hem vertex shares the solver surface and stays above floor in real falls',async()=>{
  for(const variant of ['normal','boss']){
    const prepared=await load(variant);
    for(const dir of [1,-1]){
      const game=new DuelEngine();if(variant==='boss')game.setDifficulty('boss');const f=game.fighters[1];f.dir=dir;game.initializeRig(f);
      const initialHip=f.pose.hip.y;f.rig.collapse();
      for(let step=1;step<=360;step++){
        f.rig.step(STEP);if(step%60)continue;f.pose=f.rig.pose();const matrices=characterTransforms(prepared,f);
        for(let i=0;i<prepared.parts.length;i++){
          const source=prepared.parts[i];if(source.accessory!=='apron')continue;const part=apronDeform.deformApronGeometry(source,f.pose.apron)??source;
          const m=matrices[i],det=m[0]*(m[5]*m[10]-m[6]*m[9])-m[4]*(m[1]*m[10]-m[2]*m[9])+m[8]*(m[1]*m[6]-m[2]*m[5]);
          assert.ok(Math.abs(det)>1e-12,`${variant}/${dir}/${step}: non-singular PBR frame`);
          for(let v=0;v<part.positions.length;v+=3)assert.ok(point(m,part.positions.subarray(v,v+3))[1]>=TABLE_TOP-2e-5,`${variant}/${dir}/${step}: ${part.nodeName} floor`);
        }
      }
      assert.ok(f.pose.hip.y<initialHip-.3,'the apron cannot support its owner');
    }
  }
});

test('continuous render maps exact simulation nodes; replay owns cloth and preserves explicit legacy hinge',async()=>{
  const game=new DuelEngine(),f=game.fighters[0],prepared=await load('normal');
  for(let i=0;i<8;i++)f.rig.step(STEP);f.pose=f.rig.pose();const saved=captureReplayState(game),view=replayView(saved),s=view.fighters[0].pose.apron;
  const identity=frame(0,0,0);
  for(let panel=0;panel<12;panel++){
    const indices=s.cloth.triangles[panel],part={apronPanel:panel,apronFromBone:identity,positions:new Float32Array(indices.flatMap(i=>s.cloth.rest[i])),normals:new Float32Array([0,0,1,0,0,1,0,0,1])};
    const m=deformApronPart(part,s),geometry=apronDeform.deformApronGeometry(part,s);
    for(let j=0;j<3;j++)assert.ok(distance(point(m,geometry.positions.subarray(j*3,j*3+3)),s.cloth.positions[indices[j]])<1e-6);
  }
  view.fighters[0].pose.apron.cloth.positions[10][2]=123;
  assert.notEqual(saved.fighters[0].pose.apron.cloth.positions[10][2],123);assert.notEqual(f.pose.apron.cloth.positions[10][2],123);
  const legacy={...f.pose.apron,angle:.3,canonicalMatrix:apron.apronMatrix(f.pose.apron.canonicalMatrix,prepared.apron.pivot,.3)};delete legacy.cloth;
  const old={...f,pose:{...f.pose,apron:legacy}},matrices=characterTransforms(prepared,old);
  for(let i=0;i<prepared.parts.length;i++){
    const part=prepared.parts[i];if(part.accessory!=='apron')continue;
    assert.equal(deformApronPart(part,legacy),null);
    const p=part.positions.subarray(0,3);assert.ok(distance(point(matrices[i],p),point(legacy.canonicalMatrix,point(part.apronFromBone,p)))<1e-6);
  }
});

test('moisture damps local physical motion and dries without feeding accessory forces into the body',()=>{
  const dry=make('normal'),wet=make('normal');wet.wetness.top=wet.wetness.bottom=1;
  for(const c of [dry,wet])c.velocities[10][2]=.5;
  let dryEnergy=0,wetEnergy=0;
  for(let i=0;i<120;i++){
    for(const c of [dry,wet])run(c,1,{gravity:0});
    dryEnergy+=dry.velocities.flat().reduce((sum,v)=>sum+v*v,0);wetEnergy+=wet.velocities.flat().reduce((sum,v)=>sum+v*v,0);
  }
  assert.ok(wetEnergy<dryEnergy);assert.ok(wet.wetness.bottom<1&&wet.wetness.bottom>.9);
  const a=new ArticulatedRig(),b=new ArticulatedRig();a.apron.wetness.top=a.apron.wetness.bottom=1;a.collapse();b.collapse();
  for(let i=0;i<120;i++){a.step(STEP);b.step(STEP);}
  assert.deepEqual(a.q,b.q,'wet or dry accessory cannot hold up or move the body');
});

test('real rig poses and their cloth snapshots agree at 30 and 120 Hz',()=>{
  for(const apronVariant of ['normal','boss']){
    const a=new ArticulatedRig({apronVariant,scale:apronVariant==='boss'?1.18:1}),b=new ArticulatedRig({apronVariant,scale:apronVariant==='boss'?1.18:1});a.collapse();b.collapse();
    for(let i=0;i<120;i++){a.step(STEP);if(i%4===0)b.step(1/30);}
    assert.deepEqual(a.pose().apron,b.pose().apron);
  }
});

test('zero-time body contact correction keeps belt pins attached without advancing free nodes',()=>{
  const c=make('normal'),before=c.snapshot().cloth;
  c.advance(0,{frame:frame(.02,1.2,.01)});const after=c.snapshot().cloth;
  for(let i=0;i<3;i++)assert.ok(distance(after.positions[i],[before.positions[i][0]+.02,before.positions[i][1],before.positions[i][2]+.01])<1e-12);
  assert.deepEqual(after.positions.slice(3),before.positions.slice(3));assert.deepEqual(after.velocities,before.velocities);
});

test('a detached leg ceases colliding with cloth at its old articulated points',()=>{
  const reference=make('boss'),detached=make('boss'),attached=make('boss'),p=reference.snapshot().cloth.positions[7];
  const v=p=>({x:p[0],y:p[1],z:p[2]}),pose={frontHip:v([p[0]-.06,p[1]+.04,p[2]-.035]),kneeF:v([p[0]-.06,p[1]-.2,p[2]-.035])};
  run(reference,24);run(detached,24,{pose:{...pose,clothLegs:{frontThigh:false,frontShin:false}}});run(attached,24,{pose});
  assert.deepEqual(detached.snapshot().cloth.positions,reference.snapshot().cloth.positions);
  assert.ok(distance(attached.snapshot().cloth.positions[6],reference.snapshot().cloth.positions[6])>.005);
});

test('apron emblem retains global placement and stable ownership across surface panels',()=>{
  assert.equal(typeof apronDeform.apronEmblemBindings,'function');
  const part=(positions,apronPanel)=>({accessory:'apron',nodeName:'WD_Woven_Sash',positions,apronPanel});
  const prepared={parts:[part([-1,0,0,0,1,0],0),part([0,0,0,1,1,0],1)]},owner={};
  const bindings=apronDeform.apronEmblemBindings(prepared,owner).panels;
  assert.equal(bindings.length,2);for(const b of bindings){assert.deepEqual(b.center,[0,.3]);assert.deepEqual(b.scale,[.48,.12]);}
  assert.notEqual(bindings[0].owner,bindings[1].owner);
  assert.equal(apronDeform.apronEmblemBindings(prepared,owner).panels[0].owner,bindings[0].owner);
  assert.notEqual(apronDeform.apronEmblemBindings(prepared,{}).panels[0].owner,bindings[0].owner);
});

test('a global emblem crossing a panel seam maps each material anchor through its own panel matrix',()=>{
  const positions=[-1,-1,0,0,-1,0,0,1,0,-1,-1,0,0,1,0,-1,1,0,0,-1,0,1,-1,0,1,1,0,0,-1,0,1,1,0,0,1,0];
  const fighter={slot:1},settings={positions,center:[0,0],scale:[.2,.2]},flat=surfaceEmblem(fighter,{...settings,owner:{}});
  const m=frame(0,0,.25),mapped=surfaceEmblem(fighter,{...settings,owner:{},matrixForVertex:()=>m});
  assert.equal(mapped.p.length,flat.p.length);assert.ok(mapped.p.length>0);
  for(let i=2;i<mapped.p.length;i+=3)assert.ok(Math.abs(mapped.p[i]-flat.p[i]-.25)<1e-9,'panel-specific transforms apply to each pigment anchor');
});

test('thick cloth and brass cuts remain continuous through real falls and asymmetric torsion',async(t)=>{
  for(const variant of ['normal','boss']){
    const prepared=await load(variant),groups=new Map();
    prepared.parts.forEach((part,index)=>{
      if(part.accessory!=='apron')return;
      for(let vertex=0;vertex<part.positions.length/3;vertex++){
        const p=point(part.apronFromBone,part.positions.subarray(vertex*3,vertex*3+3)),key=p.map(v=>Math.round(v*1e6)).join(',');
        if(!groups.has(key))groups.set(key,[]);groups.get(key).push({index,vertex,panel:part.apronPanel});
      }
    });
    const seams=[...groups.values()].filter(group=>new Set(group.map(v=>v.panel)).size>1);assert.ok(seams.length>0);
    const game=new DuelEngine();if(variant==='boss')game.setDifficulty('boss');const f=game.fighters[1];f.rig.collapse();
    let maximum=0;
    const inspect=()=>{
      const matrices=characterTransforms(prepared,f),geometry=prepared.parts.map(part=>apronDeform.deformApronGeometry(part,f.pose.apron)??part);
      for(const group of seams){
        const world=group.map(({index,vertex})=>point(matrices[index],geometry[index].positions.subarray(vertex*3,vertex*3+3)));
        for(const p of world)maximum=Math.max(maximum,distance(p,world[0]));
      }
      for(const part of geometry.filter(part=>part.accessory==='apron'))for(let i=0;i<part.normals.length;i+=3){
        const n=part.normals.subarray(i,i+3);assert.ok(n.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...n)-1)<1e-5);
      }
    };
    for(let step=1;step<=120;step++){
      f.rig.step(STEP);if(step%10)continue;f.pose=f.rig.pose();inspect();
    }
    const cloth=make(variant);run(cloth,60);const p=cloth.positions[7];
    run(cloth,24,{colliders:[{a:[p[0]-.06,p[1],p[2]-.035],b:[p[0]-.06,p[1]-.2,p[2]-.035],radius:.085}]});
    f.pose={...f.pose,apron:cloth.snapshot()};inspect();
    t.diagnostic(`${variant}: maximum seam distance ${maximum} m (fall + asymmetric torsion)`);
    assert.ok(maximum<2e-5,`${variant}: originally coincident cuts separate ${maximum} m`);
  }
});

test('shared thickness rotates through ninety degrees without shrinking or singular model frames',async()=>{
  for(const variant of ['normal','boss']){
    const prepared=await load(variant),c=new apron.ApronCloth(variant),m=new Float64Array([1,0,0,0,0,0,1,0,0,-1,0,0,0,1.2,0,1]);c.advance(0,{frame:m});const snapshot=c.snapshot();
    for(const part of prepared.parts.filter(p=>p.accessory==='apron')){
      const geometry=apronDeform.deformApronGeometry(part,snapshot),matrix=deformApronPart(part,snapshot);
      assert.deepEqual(Array.from(matrix),Array.from(frame(0,0,0)));
      for(let i=0;i<part.positions.length;i+=3){
        const canonical=point(part.apronFromBone,part.positions.subarray(i,i+3)),expected=point(m,canonical),actual=Array.from(geometry.positions.subarray(i,i+3));
        assert.ok(distance(actual,expected)<1e-6,'rigid 90 degree orientation must preserve the original nonzero thickness');
      }
    }
  }
});

test('v4 renderer submits deformed geometry for live and detached cloth and moist regions remain material-bound',async()=>{
  const prepared=await load('normal'),game=new DuelEngine(),f=game.fighters[0],calls=[];
  const entry={prepared,gpu:{parts:prepared.parts.map(p=>({...p})),materials:prepared.asset.materials}},renderer={assetScene:{characters:{mint:entry}},assetPoseCache:new WeakMap(),assetPart:(...args)=>calls.push(args),depthOnly:true};
  f.pose.apron.wetness={top:.8,bottom:.1};Renderer3D.prototype.detailedPuppet.call(renderer,f);
  for(const call of calls){
    const index=entry.gpu.parts.indexOf(call[1]),part=prepared.parts[index];if(part.accessory!=='apron')continue;
    assert.equal(call[3].geometry,apronDeform.deformApronGeometry(part,f.pose.apron));
    const wet=apronSurfaceOverride(f,part,entry.gpu.materials[part.material]);assert.equal(wet.wetTop,wet.wetBottom);assert.ok([.8,.1].includes(wet.wetTop));
  }
  const fragment={id:1,bodies:['pelvis'],joint:'frontHip',sourcePose:f.pose,transform:frame(.3,0,.2)};
  calls.length=0;Renderer3D.prototype.drawDetachedPuppet.call(renderer,{...f,pose:{...f.pose,detached:[fragment]}},0,{},true);
  const call=calls.find(call=>call[3]?.geometry);assert.ok(call,'detached source pose must retain its continuous cloth geometry');
  const p=Array.from(call[3].geometry.positions.subarray(0,3)),world=point(call[2],p);
  assert.ok(distance(world,[p[0]+.3,p[1],p[2]+.2])<1e-6);
});
