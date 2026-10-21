import assert from 'node:assert/strict';

// Later authorization: physical joint damage/break cues and removal of phantom
// limb foley, including real detached-blade motion. The promotion snapshots and
// hashes remain immutable. These literal hunks are the entire permitted delta;
// no whitespace normalization or replacement current-source hash is used.
const lines=(...values)=>values.join('\n');
export const AUTHORIZED_JOINT_AUDIO=[
  {path:'public/audio/scene-audio.js',baselineSha256:'63b11abebff95fb5940cf8dfec6c062eae5dd9d98823fee9c096fc1c4206e9ca',hunks:[
    {id:'physical-actor-import',before:"import {getWeapon} from '../equipment.js';",after:lines(
      "import {getWeapon} from '../equipment.js';",
      "import {bodyAttached,weaponActor} from '../physics/limb-state.js';")},
    {id:'connected-point-ownership',before:"const POINTS=['head','hip','mainShoulder','mainElbow','mainHand','offShoulder','offElbow','offHand','tip',...FEET];",after:lines(
      "const POINTS=['head','hip','mainShoulder','mainElbow','mainHand','offShoulder','offElbow','offHand','tip',...FEET];",
      "const POINT_BODIES={mainElbow:'mainUpper',mainHand:'weapon',offElbow:'offUpper',offHand:'offForearm',tip:'weapon',footF:'frontShin',footB:'backShin'};",
      "const connected=(fighter,body)=>bodyAttached(fighter,body)&&!(fighter.pose?.detached??[]).some(fragment=>fragment.bodies.includes(body));")},
    {id:'exclude-ghost-endpoints',before:'  const pose={};for(const name of POINTS)pose[name]=point(fighter.pose?.[name]);',
      after:'  const pose={};for(const name of POINTS)pose[name]=POINT_BODIES[name]&&!connected(fighter,POINT_BODIES[name])?null:point(fighter.pose?.[name]);'},
    {id:'own-physical-blade-observation',before:lines(
      '  const weapon=getWeapon(fighter),weaponMass=clamp(finite(fighter.rig?.weaponMass)?fighter.rig.weaponMass:weapon.mass,.04,1.5);',
      '  return {fighter,pose,fluid,membrane,edges:membrane?.edges,parcels,surface,weapon:weapon.id,weaponMass,'),after:lines(
      '  const weapon=getWeapon(fighter),weaponMass=clamp(finite(fighter.rig?.weaponMass)?fighter.rig.weaponMass:weapon.mass,.04,1.5);',
      '  // A detached blade belongs to its independent physical actor. Parent endpoint',
      '  // motion cannot animate it, and changing actor establishes a new air baseline.',
      '  const actor=weaponActor(fighter),blade=actor?{source:actor.detachedAttack?actor.rig:fighter,',
      '    hand:point(actor.pose?.mainHand),tip:point(actor.pose?.tip),',
      '    mass:actor.detachedAttack?clamp(getWeapon(actor.pose).mass,.04,1.5):weaponMass}:null;',
      '  return {fighter,pose,fluid,membrane,edges:membrane?.edges,parcels,surface,weapon:weapon.id,weaponMass,',
      '    blade,')},
    {id:'blade-identity-boundary',before:'      if(next.pose.tip&&old.pose.tip&&next.pose.mainHand&&old.pose.mainHand){',
      after:'      if(next.blade&&old.blade&&next.blade.source===old.blade.source&&next.blade.tip&&old.blade.tip&&next.blade.hand&&old.blade.hand){'},
    {id:'measure-physical-blade-motion',before:'        const bladeSpeed=(distance(next.pose.tip,old.pose.tip)*.7+distance(next.pose.mainHand,old.pose.mainHand)*.3)/dt;',
      after:'        const bladeSpeed=(distance(next.blade.tip,old.blade.tip)*.7+distance(next.blade.hand,old.blade.hand)*.3)/dt;'},
    {id:'source-blade-mass-and-position',before:lines(
      '          const massRatio=next.weaponMass/.16;',
      "          emit('blade-swish',.08+bladeSpeed*.13*Math.sqrt(massRatio),.14,1,next.pose.tip.x,"),after:lines(
      '          const massRatio=next.blade.mass/.16;',
      "          emit('blade-swish',.08+bladeSpeed*.13*Math.sqrt(massRatio),.14,1,next.blade.tip.x,")},
  ]},
  {path:'public/audio/contact-audio.js',baselineSha256:'9d1256a7eb9bfff146a1e3b8eabd049c771cd0a9651f9d475b46c8bb78735f09',hunks:[
    {id:'known-physical-joints',before:"const material=value=>({wood_metal_mixed:'composite',metal_mixed:'metal'}[value]??value);",after:lines(
      "const material=value=>({wood_metal_mixed:'composite',metal_mixed:'metal'}[value]??value);",
      "const JOINTS=new Set(['mainShoulder','mainElbow','wrist','offShoulder','offElbow','frontHip','frontKnee','backHip','backKnee']);")},
    {id:'causal-joint-contact-cues',before:lines(
      'export function contactAudio(name,input={},game=null){',
      "  const data=input&&typeof input==='object'?input:{};"),after:lines(
      'export function contactAudio(name,input={},game=null){',
      "  const data=input&&typeof input==='object'?input:{};",
      "  const jointEvent=name==='material-contact'?data.jointEvent:name;",
      "  if(jointEvent==='joint-damage'||jointEvent==='joint-break'){",
      '    if(![1,2].includes(data.slot)||!JOINTS.has(data.joint)||!Number.isFinite(data.damage)||data.damage<=0||',
      '      data.amount!==undefined&&(!Number.isFinite(data.amount)||data.amount<=0)||',
      '      !Number.isFinite(data.at?.x)||!Number.isFinite(data.at?.y)||!Number.isFinite(data.at?.z??0))return empty();',
      "    const broken=jointEvent==='joint-break',hit=Math.sqrt(clamp(data.amount??data.damage,0,1)),x=clamp(data.at.x,-4,4);",
      "    return {key:`joint:${data.slot}:${data.joint}:${broken?'break':'damage'}`,cooldown:broken?.2:.12,",
      "      cues:[cue('wood-contact',x,(broken?.32:.12)+hit*.44,{priority:broken?3:2,rate:broken?.74:.94}),",
      "        cue('joint',x,.1+hit*(broken?.46:.24),{priority:broken?3:2,rate:broken?.76:1.02,delay:.012})]};",
      '  }')},
  ]},
];

export function transformAuthorizedJointAudio(bytes,spec,reverse=false){
  let source=bytes.toString('utf8');
  assert.ok(Buffer.from(source,'utf8').equals(bytes),'Audio source must be lossless UTF-8: '+spec.path);
  for(const hunk of reverse?[...spec.hunks].reverse():spec.hunks){
    const from=reverse?hunk.after:hunk.before,to=reverse?hunk.before:hunk.after;
    assert.ok(from&&to&&from!==to,'Invalid authorized hunk: '+hunk.id);
    assert.equal(source.split(from).length-1,1,'Authorized hunk missing or ambiguous: '+spec.path+' / '+hunk.id);
    source=source.replace(from,to);
  }
  return Buffer.from(source,'utf8');
}
