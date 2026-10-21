import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP,neutral} from '../public/engine.js';
for(const style of ['boss','balanced'])test(`El Maestro abre con espacio y preparación legible (${style})`,()=>{
  const events=[],g=new DuelEngine((name,data)=>events.push({name,data,clock:g.clock,phaseClock:g.phaseClock}));
  g.setDifficulty('boss');g.setAIStyle(style);g.start();
  let fightAt=null;
  for(let i=0;i<900;i++){
    g.setControl(1,neutral());g.update(STEP);
    if(fightAt===null&&g.phase==='fight')fightAt=g.clock;
    const loss=events.find(e=>e.name==='burst'&&e.data.loser===1);
    if(loss){assert.ok(loss.clock-fightAt>=1.6,`pinchazo a ${loss.clock-fightAt}s`);break;}
    if(fightAt!==null&&g.clock-fightAt>=2.2)break;
  }
  assert.ok(fightAt!==null);assert.ok(events.some(e=>e.name==='ai-state'&&e.data.state==='windup'),'el ataque tiene preparación visible');
  assert.ok(g.fighters[1].baseX<=2.2&&g.fighters[0].baseX>=-2.2);
});
