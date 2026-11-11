import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DuelEngine,STEP} from '../public/engine.js';
import {BOSS_CAMPAIGN} from '../public/campaign-progression.js';
import {captureReplayState,replayView} from '../public/replay.js';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms,detachedCharacterTransforms} from '../public/rendering/asset-rig.js';
import {batchRigidCharacter} from '../public/rendering/rigid-batches.js';
import {rivalCharacterEntries,puppetAsset} from '../public/rendering/boss-rival-assets.js';

async function loadCharacter(file){
  const bytes=await readFile(new URL(`../public/assets/characters/water-mannequin/v4/${file}.glb`,import.meta.url));
  return parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}

function gameFor(encounter){
  const game=new DuelEngine();
  game.bossArchetype=encounter.bossArchetype;
  game.setLoadout(2,encounter.opponentLoadout);
  game.setDifficulty('boss');
  game.setAIStyle('boss');
  return game;
}

test('Las armaduras del GLB son exclusivas, comparten la base y mantienen los pivotes físicos',async()=>{
  const [asset,master]=await Promise.all([loadCharacter('water-mannequin-rivals'),loadCharacter('water-mannequin-boss')]);
  const body=prepareCharacter(master),prepared=batchRigidCharacter(prepareCharacter(asset),asset.materials);
  const uploaded={parts:prepared.parts.map(part=>({nodeName:part.nodeName,material:part.material,vao:{}})),materials:asset.materials};
  const entries=rivalCharacterEntries(prepared,uploaded),shoulders={};
  const common=uploaded.parts.find(part=>part.nodeName.startsWith('WD_Boss_Beech'));
  for(const [style,entry] of Object.entries(entries)){
    const parts=entry.prepared.parts,armor=parts.filter(part=>part.nodeName.startsWith('Rival_'));
    assert.ok(armor.length>=6&&armor.every(part=>part.nodeName.startsWith(`Rival_${style}_`)));
    assert.ok(entry.gpu.parts.includes(common));
    assert.deepEqual(entry.prepared.source.hip,body.source.hip);
    assert.deepEqual(entry.prepared.source.mainGrip,body.source.mainGrip);
    for(const name of ['chest','upper_arm.L','upper_arm.R','forearm.R','foot.L','foot.R'])
      assert.deepEqual(entry.prepared.bones.get(name).worldMatrix,body.bones.get(name).worldMatrix);
    assert.equal(entry.prepared.apronVariant,'boss');
    shoulders[style]=new Set(armor.filter(part=>part.boneName.startsWith('upper_arm')).map(part=>part.boneName));

    const game=gameFor(BOSS_CAMPAIGN.find(encounter=>encounter.bossArchetype===style)),fighter=game.fighters[1];
    assert.equal(puppetAsset(entries,fighter),entry);
    const matrices=characterTransforms(entry.prepared,fighter);
    assert.ok(matrices.every(matrix=>matrix.every(Number.isFinite)));
    const fragment={sourcePose:fighter.pose,bodies:['mainForearm'],transform:[1,0,0,0,0,1,0,0,0,0,1,0,.1,.2,.3,1]};
    const detached=detachedCharacterTransforms(entry.prepared,fighter,fragment,matrices);
    const bracer=parts.findIndex(part=>part.boneName==='forearm.R'&&part.nodeName.startsWith('Rival_'));
    assert.ok(bracer>=0&&Math.abs(detached[bracer][12]-matrices[bracer][12]-.1)<1e-6);
    assert.equal(detached[parts.findIndex(part=>part.boneName==='chest')],null);
  }
  assert.deepEqual([...shoulders.sword],['upper_arm.L']);
  assert.ok(shoulders.spear.has('upper_arm.R')&&shoulders.spear.has('upper_arm.L'));
  assert.ok(shoulders.axe.has('upper_arm.R')&&shoulders.axe.has('upper_arm.L'));
  assert.equal(puppetAsset({boss:body},{slot:2,boss:true,bossArchetype:'axe'}),body);
});

test('Guardias y pisadas se distinguen sobre el rig y la identidad persiste al reventar el globo',()=>{
  const signatures=new Map();
  for(const encounter of BOSS_CAMPAIGN){
    const game=gameFor(encounter),fighter=game.fighters[1];
    for(let i=0;i<90;i++)game.update(.035);
    const {pose,rig}=fighter,key=encounter.opponentLoadout.weapon;
    rig.setIntent(game.buildPose(fighter),{baseX:fighter.baseX-.21});
    rig.step(STEP);
    signatures.set(key,{hand:pose.mainHand.y-pose.mainShoulder.y,duration:rig.gait.swing.duration,delay:rig.gait.swing.delay,lift:rig.gait.swing.lift});
    assert.equal(replayView(captureReplayState(game)).fighters[1].bossArchetype,encounter.bossArchetype);
    game.phase='burst';game.presentation.capture(game);
    assert.equal(game.presentationState(0).fighters[1].bossArchetype,encounter.bossArchetype);
  }
  assert.equal(new Set([...signatures.values()].map(s=>s.duration)).size,4);
  assert.ok(signatures.get('sword').duration<signatures.get('spear').duration);
  assert.ok(signatures.get('spear').lift<signatures.get('axe').lift);
  assert.ok(signatures.get('axe').delay>signatures.get('maul').delay);
  assert.ok(signatures.get('axe').hand>signatures.get('spear').hand+.05);
});
