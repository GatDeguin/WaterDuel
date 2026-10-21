// Focused, native-Node selection/swap matrix. No server, browser, or runtime writes.
// Usage: node scripts/qa-items-selection.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HostSession} from '../public/host-session.js';
import {STEP} from '../public/engine.js';
import {parseGLB} from '../public/rendering/glb.js';
import {equipmentTransform,deformEquipmentPoint} from '../public/rendering/asset-rig.js';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const OUTPUT=path.join(ROOT,'audit/ITEMS_MATRIZ_SELECCION_2026-10-18.json');
// External acceptance rules supplied for this audit; never derived from the catalog/normalizer.
const ONE_HANDED=['sword','spear','axe'],DEFENSES=['short','long','none','knife'];
const VALID=[...ONE_HANDED.flatMap(weapon=>DEFENSES.map(defense=>({weapon,defense}))),{weapon:'maul',defense:'none'}];
const RUNTIME_FILES=['public/host-session.js','public/remote-menu.js','public/session-equipment.js','public/engine.js','public/equipment.js',
  'public/physics/articulated-rig.js','public/rendering/asset-rig.js','public/rendering/glb.js'];
const copy=value=>structuredClone(value),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const capture=host=>copy(host.game.loadouts);
const loadoutId=item=>`${item.weapon}/${item.defense}`;
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const xyz=p=>[p.x,p.y,p.z??0],distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
async function revision(){return Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async file=>[file,hash(await readFile(path.join(ROOT,file)))])));}

export async function auditItemsSelection(){
  assert.equal(VALID.length,13);
  const startedAt=new Date().toISOString(),beforeRevision=await revision(),commands=[],cases=[],matrix=[],maulSamples=[];
  let requestId=0,currentCase='setup';
  const execute=(host,command,value)=>{
    const packet={type:'command',requestId:++requestId,sentAt:Date.now(),command,...(value===undefined?{}:{value:copy(value)})};
    const before=capture(host),result=host.handleCommand(packet);
    commands.push({case:currentCase,api:'HostSession.handleCommand',packet,result:copy(result),phase:host.game.phase,before,after:capture(host)});return result;
  };
  const direct=(host,slot,selection)=>{
    const before=capture(host),result=host.game.setLoadout(slot,copy(selection));
    commands.push({case:currentCase,api:'DuelEngine.setLoadout',slot,selection:copy(selection),result,phase:host.game.phase,before,after:capture(host)});return result;
  };
  const run=(name,check)=>{
    currentCase=name;
    try{const evidence=check();cases.push({name,ok:true,...(evidence?{evidence}:{})});}
    catch(error){cases.push({name,ok:false,error:error.message});}
  };
  const assertEquipment=(host,expected)=>{
    assert.deepEqual(host.game.loadouts,expected,'authoritative saved loadouts');
    assert.deepEqual(host.game.fighters.map(f=>f.equipment),expected,'actual fighters');
    assert.deepEqual(host.game.fighters.map(f=>f.pose.equipment),expected,'actual articulated poses');
    assert.deepEqual(host.menuState().fighters.map(f=>f.equipment),expected,'published menu state');
    assert.deepEqual(host.game.scores,[0,0],'selection must not award points');
  };
  const versus=()=>{
    const host=new HostSession({opponentSeed:1802026});
    assert.equal(execute(host,'setMode','versus').ok,true);assert.equal(host.game.mode,'versus');assert.equal(host.managedOpponent,false);
    return host;
  };
  const host=versus();
  for(const slot of [1,2])for(const item of VALID)run(`selection-J${slot}-${loadoutId(item)}`,()=>{
    const expected=capture(host);expected[slot-1]=copy(item);
    assert.equal(execute(host,'setLoadout',{slot,...item}).ok,true);assertEquipment(host,expected);
    matrix.push({kind:'selection',slot,input:copy(item),expected:copy(item),ok:true});
  });
  for(const left of VALID)for(const right of VALID)run(`swap-${loadoutId(left)}--${loadoutId(right)}`,()=>{
    assert.equal(execute(host,'setLoadout',{slot:1,...left}).ok,true);
    assert.equal(execute(host,'setLoadout',{slot:2,...right}).ok,true);assertEquipment(host,[left,right]);
    // Snapshot both complete loadouts before the first command so shields/dagger travel with weapons.
    const [a,b]=capture(host);
    assert.equal(execute(host,'setLoadout',{slot:1,...b}).ok,true);
    assert.equal(execute(host,'setLoadout',{slot:2,...a}).ok,true);assertEquipment(host,[right,left]);
    matrix.push({kind:'swap',before:[copy(left),copy(right)],expected:[copy(right),copy(left)],ok:true});
  });
  for(const slot of [1,2])for(const defense of DEFENSES)run(`maul-normalizes-J${slot}-${defense}`,()=>{
    const expected=capture(host);expected[slot-1]={weapon:'maul',defense:'none'};
    assert.equal(execute(host,'setLoadout',{slot,weapon:'maul',defense}).ok,true);assertEquipment(host,expected);
    assert.equal(direct(host,slot,{defense}),true,'engine partial secondary selection is normalized');assertEquipment(host,expected);
    assert.equal(execute(host,'setLoadout',{slot,defense}).ok,false,'partial wire commands are invalid');assertEquipment(host,expected);
  });
  for(const slot of [1,2])for(const defense of DEFENSES)run(`knife-primary-rejected-J${slot}-${defense}`,()=>{
    const expected=capture(host);
    assert.equal(execute(host,'setLoadout',{slot,weapon:'knife',defense}).ok,false);
    assert.equal(direct(host,slot,{weapon:'knife',defense}),false);assertEquipment(host,expected);
  });
  let swapApi;
  run('dedicated-swap-command-is-not-supported',()=>{
    const expected=capture(host),hostMethods=Object.getOwnPropertyNames(Object.getPrototypeOf(host)).filter(name=>/swap/i.test(name)),
      engineMethods=Object.getOwnPropertyNames(Object.getPrototypeOf(host.game)).filter(name=>/swap/i.test(name));
    assert.deepEqual(hostMethods,[]);assert.deepEqual(engineMethods,[]);
    assert.equal(execute(host,'swapEquipment').ok,false);assertEquipment(host,expected);
    swapApi={dedicatedHostMethods:hostMethods,dedicatedEngineMethods:engineMethods,
      transportCommand:'setLoadout',commandsPerSwap:2,atomic:false,method:'Read both loadouts, then set slot 1 to former slot 2 and slot 2 to former slot 1.'};return swapApi;
  });
  const fightPair=[{weapon:'spear',defense:'knife'},{weapon:'axe',defense:'long'}];
  run('start-preserves-selected-equipment-and-reaches-real-fight',()=>{
    for(const slot of [1,2])assert.equal(execute(host,'setLoadout',{slot,...fightPair[slot-1]}).ok,true);
    assert.equal(execute(host,'start').ok,true);assert.equal(host.game.phase,'countdown');assertEquipment(host,fightPair);
    for(let step=0;step<100&&host.game.phase==='countdown';step++)host.update(.04);
    assert.equal(host.game.phase,'fight');assertEquipment(host,fightPair);
  });
  for(const slot of [1,2])for(const item of VALID)run(`fight-change-rejected-J${slot}-${loadoutId(item)}`,()=>{
    assert.equal(host.game.phase,'fight');
    assert.equal(execute(host,'setLoadout',{slot,...item}).ok,false);
    assert.equal(direct(host,slot,item),false);assertEquipment(host,fightPair);
  });

  const assetFile=path.join(ROOT,'public/assets/equipment/workshop/v2/maul.glb'),assetBytes=await readFile(assetFile),asset=parseGLB(assetBytes.buffer.slice(assetBytes.byteOffset,assetBytes.byteOffset+assetBytes.byteLength));
  const assetContract=JSON.parse(await readFile(path.join(ROOT,'public/assets/equipment/workshop/v2/asset-contract.json'),'utf8'));
  const sockets=Object.fromEntries(['Socket_Grip_Main','Socket_Grip_Secondary','Socket_Strike'].map(name=>{
    const node=asset.nodes.find(node=>node.name===name);assert.ok(node,name);return [name,Array.from(node.worldMatrix.subarray(12,15))];
  }));
  const tolerance=1e-4,maul={asset:'public/assets/equipment/workshop/v2/maul.glb',assetSha256:hash(assetBytes),tolerance,
    sockets,checkedPoses:0,maxMainHandError:0,maxSecondaryHandError:0,maxSecondaryGripError:0,maxStrikeError:0,worst:null,
    stepping:'Actual DuelEngine.updateFootwork/updateFighter and ArticulatedRig; damage adjudication is outside this attachment check.'};
  run('maul-v2-authored-sockets-and-current-hash',()=>{
    assert.equal(hash(assetBytes),assetContract.assets.find(item=>item.id==='maul').sha256);
    assert.ok(distance(sockets.Socket_Grip_Main,[0,0,0])<=1e-7);
    assert.ok(distance(sockets.Socket_Grip_Secondary,[0,-.22,0])<=1e-7);
    assert.ok(distance(sockets.Socket_Strike,[0,1.08,0])<=1e-7);
  });
  const physical=versus();
  for(const slot of [1,2])assert.equal(execute(physical,'setLoadout',{slot,weapon:'maul',defense:'none'}).ok,true);
  assert.equal(execute(physical,'start').ok,true);
  for(let step=0;step<100&&physical.game.phase==='countdown';step++)physical.update(.04);
  const inspectPose=(fighter,step)=>{
    assert.equal(fighter.pose.dynamic,true,'must use an actual articulated-rig pose');
    const t=equipmentTransform(fighter,'maul'),mapped=Object.fromEntries(Object.entries(sockets).map(([name,value])=>[name,point(t.matrix,deformEquipmentPoint(value,t))]));
    const errors={mainHand:distance(mapped.Socket_Grip_Main,xyz(fighter.pose.mainHand)),secondaryHand:distance(mapped.Socket_Grip_Secondary,xyz(fighter.pose.offHand)),
      secondaryGrip:distance(mapped.Socket_Grip_Secondary,xyz(fighter.pose.offGrip)),strike:distance(mapped.Socket_Strike,xyz(fighter.pose.tip))};
    const max=Math.max(...Object.values(errors)),sample={slot:fighter.slot,step,errors,mainHand:xyz(fighter.pose.mainHand),offHand:xyz(fighter.pose.offHand),offGrip:xyz(fighter.pose.offGrip),mapped};
    maul.checkedPoses++;maul.maxMainHandError=Math.max(maul.maxMainHandError,errors.mainHand);maul.maxSecondaryHandError=Math.max(maul.maxSecondaryHandError,errors.secondaryHand);
    maul.maxSecondaryGripError=Math.max(maul.maxSecondaryGripError,errors.secondaryGrip);maul.maxStrikeError=Math.max(maul.maxStrikeError,errors.strike);
    if(!maul.worst||max>Math.max(...Object.values(maul.worst.errors)))maul.worst=copy(sample);
    if(step%10===0||max>tolerance)maulSamples.push(sample);
    assert.ok(Object.values(errors).every(value=>Number.isFinite(value)&&value<=tolerance),`J${fighter.slot} step ${step}: maul socket/hand error ${max} exceeds ${tolerance}`);
  };
  run('maul-v2-both-hands-match-actual-rig-in-rest-and-motion',()=>{
    assert.equal(physical.game.phase,'fight');for(const fighter of physical.game.fighters)inspectPose(fighter,0);
    for(let step=1;step<=160;step++){
      for(const slot of [1,2])physical.game.setControl(slot,{mainX:Math.sin(step*.07),mainY:Math.cos(step*.03)*.6,wrist:Math.sin(step*.09)*.7,
        lean:Math.sin(step*.05)*.5,thrust:step===1||step===91,guard:step>110});
      physical.game.clock+=STEP;physical.game.updateFootwork(STEP);
      for(const fighter of physical.game.fighters){physical.game.updateFighter(fighter,STEP);inspectPose(fighter,step);}
    }
  });
  const afterRevision=await revision(),revisionStable=JSON.stringify(beforeRevision)===JSON.stringify(afterRevision);
  const failures=cases.filter(item=>!item.ok);if(!revisionStable)failures.push({name:'runtime-revision-stability',ok:false,error:'Runtime source hashes changed while this native audit was running.'});
  const report={ok:failures.length===0,startedAt,completedAt:new Date().toISOString(),node:process.version,
    classification:'Focused HostSession/engine API and actual-rig evidence; no browser, mobile transport, server, or GPU claim.',
    externalRules:{validLoadouts:VALID,expectedLoadoutsPerSlot:13,expectedSelections:26,expectedSwapPairs:169,maulForcesDefense:'none',knifePrimaryAllowed:false,
      preparationPhases:['ready','matchover'],fightSelectionAllowed:false,maulSocketTolerance:tolerance},
    counters:{cases:cases.length,passed:cases.filter(item=>item.ok).length,failed:failures.length,
      selections:matrix.filter(row=>row.kind==='selection').length,swaps:matrix.filter(row=>row.kind==='swap').length,
      hostCommands:commands.filter(command=>command.api==='HostSession.handleCommand').length,engineDirectCalls:commands.filter(command=>command.api==='DuelEngine.setLoadout').length,
      hostAccepted:commands.filter(command=>command.api==='HostSession.handleCommand'&&command.result.ok).length,
      hostRejected:commands.filter(command=>command.api==='HostSession.handleCommand'&&!command.result.ok).length,maulPoses:maul.checkedPoses},
    swapApi,revisionStable,runtimeSha256Before:beforeRevision,runtimeSha256After:afterRevision,
    scriptSha256:hash(await readFile(fileURLToPath(import.meta.url))),matrix,cases,commands,maul,maulSamples,failures};
  await writeFile(OUTPUT,JSON.stringify(report,null,2)+'\n');return report;
}

if(path.resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)){
  try{
    const report=await auditItemsSelection();console.log(JSON.stringify({ok:report.ok,report:OUTPUT,counters:report.counters,revisionStable:report.revisionStable,
      maul:{poses:report.maul.checkedPoses,maxMainHandError:report.maul.maxMainHandError,maxSecondaryHandError:report.maul.maxSecondaryHandError,maxStrikeError:report.maul.maxStrikeError},failures:report.failures},null,2));
    if(!report.ok)process.exitCode=1;
  }catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
