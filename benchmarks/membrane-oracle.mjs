/** Frozen-source oracle and real-engine input recording for membrane refactors. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DuelEngine,STEP} from '../public/engine.js';
import {containedWaterFrame} from '../public/physics/dimensions.js';
import {HEAD_VOLUME} from '../public/physics/fluid.js';
import {weaponGesture} from '../public/joysticks.js';

export const BASELINE_SHA='18c07d32878df7fe5cdb6216a638f31a20d036b1d4bb901ae55d77e9f674090b';
export async function loadPriorMembrane(){
  const path=new URL('./baselines/membrane-pre-final-1.4.mjs',import.meta.url),source=await readFile(path,'utf8');
  if(createHash('sha256').update(source).digest('hex')!==BASELINE_SHA)throw Error('La fuente congelada de membrana cambió.');
  const original=new URL('../public/physics/membrane.js',import.meta.url);
  return import('data:text/javascript;base64,'+Buffer.from(source.replace(/from '([^']+)'/g,(_,path)=>`from '${new URL(path,original).href}'`)).toString('base64'));
}
export function intactTrace({scale=1,steps=120,subdivisions=2}={}){
  const head={x:0,y:2.4,z:.025},calls=[];
  for(let i=0;i<steps;i++){
    const time=i*STEP,slosh=.08*Math.sin(i/15);
    calls.push({method:'advance',args:[STEP,{head:{x:.08*Math.sin(time*2),y:2.4-.22*Math.sin(time)**2,z:.025+.05*Math.sin(time)},
      waterVolume:HEAD_VOLUME*scale**3,waterFrame:containedWaterFrame(slosh,time),slosh}]});
  }
  return {name:`retained-${subdivisions}-${scale}`,configuration:{scale,subdivisions},head,calls};
}
export function realContactTrace({afterBurst=300,maxFrames=1800,boss=false}={}){
  const events=[],game=new DuelEngine((name,data)=>{if(name==='burst')events.push(data);});
  game.setMode('versus');if(boss)game.setMode('solo');game.setDifficulty(boss?'boss':'normal');game.resetMatch();game.setScenario('practice');game.aiEnabled=false;game.start();
  const membrane=game.fighters[1].membrane,head={...membrane.support},calls=[];
  for(const method of ['advance','puncture']){
    const original=membrane[method];
    membrane[method]=function(...args){calls.push({method,args:structuredClone(args)});return original.apply(this,args);};
  }
  let burstFrames=-1,frame=0;
  for(;frame<maxFrames;frame++){
    game.setControl(1,{...weaponGesture({x:1,y:.63}),lean:1});
    game.setControl(2,{mainX:-1,mainY:-1,offY:-1});game.update(STEP);
    if(events.length){if(burstFrames<0)burstFrames=0;if(++burstFrames>=afterBurst)break;}
  }
  if(!events.some(e=>e.contact===true&&!e.demonstration))throw Error(`La receta de ${frame} pasos no produjo un contacto real.`);
  return {name:boss?'real-contact-boss':'real-contact-normal',configuration:{scale:membrane.scale,subdivisions:membrane.subdivisions},head,calls,
    receipt:{frames:frame+1,contact:events[0],scores:[...game.scores],phase:game.phase,nodes:membrane.nodes.length,fractures:membrane.fractureEvents,
      water:{initial:game.fighters[1].fluid.initialVolume,retained:game.fighters[1].fluid.retainedVolume,released:game.fighters[1].fluid.releasedVolume},
      passive:game.fighters[1].rig.passive,headY:game.fighters[1].pose.head.y,hipY:game.fighters[1].pose.hip.y,minimumNodeY:Math.min(...membrane.nodes.map(p=>p.y))}};
}
export function replayMembrane(Membrane,trace){
  const m=new Membrane(trace.configuration);m.attach(trace.head);
  for(const call of trace.calls)m[call.method](...call.args);
  return m;
}
