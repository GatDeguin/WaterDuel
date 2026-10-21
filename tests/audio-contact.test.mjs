import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../public/audio/contact-audio.js').catch(()=>({}));
const plan=(name,data,game)=>{assert.equal(typeof module.contactAudio,'function','Se implementa la política material');return module.contactAudio(name,data,game);};
const game=defense=>({fighters:[{slot:1,equipment:{defense},pose:{head:{x:-2}}}]});

test('material impacts follow measured load/speed and world position',()=>{
  const soft=plan('material-contact',{material:'wood',at:{x:-2},impulse:.004,closingSpeed:.12});
  const hard=plan('material-contact',{material:'wood',at:{x:2},impulse:.15,closingSpeed:2});
  assert.equal(soft.cues[0].name,'wood-contact');assert.equal(soft.cues[0].x,-2);
  assert.equal(hard.cues[0].x,2);assert.ok(hard.cues[0].intensity>soft.cues[0].intensity);
  assert.ok(hard.cues.every(c=>Number.isFinite(c.intensity)&&c.intensity<=1));
});
test('unbroken latex contact never becomes a puncture or water explosion',()=>{
  const result=plan('material-contact',{material:'latex',impulse:.08,closingSpeed:1,at:{x:-1}});
  assert.deepEqual(result.cues.map(c=>c.name),['latex-rub']);
});
test('steel impact and measured tangential sliding have distinct cues',()=>{
  const hit={weaponBind:true,at:{x:0},impulse:.1,closingSpeed:1};
  assert.ok(plan('clang',hit).cues.some(c=>c.name==='blade-beat'));
  assert.ok(!plan('clang',hit).cues.some(c=>c.name==='blade-slide'));
  const slide=plan('clang',{...hit,closingSpeed:0,slideSpeed:.8});
  assert.deepEqual(slide.cues.map(c=>c.name),['blade-slide']);
});
test('shield material comes from explicit metadata then canonical defense identity',()=>{
  for(const [defense,want]of [['short','shield-metal'],['long','shield-wood'],['knife','blade-beat']]){
    assert.equal(plan('clang',{defender:1,at:{x:-2}},game(defense)).cues[0].name,want);
  }
  assert.equal(plan('clang',{defender:1,defenseMaterial:'wood'},game('short')).cues[0].name,'shield-wood');
  assert.equal(plan('clang',{defender:1,defenseMaterial:'metal'},game('long')).cues[0].name,'shield-metal');
});
test('explicit wood and ambiguous composite weapons never become guaranteed steel',()=>{
  const hit={weaponBind:true,at:{x:0},impulse:.1,closingSpeed:1};
  assert.equal(plan('clang',{...hit,material:'wood'}).cues[0].name,'wood-contact');
  for(const material of ['composite','unknown']){
    const result=plan('clang',{...hit,material});assert.ok(result.cues.length);
    assert.ok(result.cues.every(c=>!['blade-beat','ring','blade-slide','shield-metal'].includes(c.name)));
    assert.equal(plan('material-contact',{...hit,material}).cues[0].name,'joint');
  }
  const mixed={fighters:[{equipment:{weapon:'maul'}},{equipment:{weapon:'sword'}}]};
  assert.ok(plan('clang',hit,mixed).cues.every(c=>c.name==='joint'));
});
test('resting, separating, invalid and unknown contacts cannot manufacture impacts',()=>{
  for(const extra of [{impulse:0,closingSpeed:0},{impulse:.1,closingSpeed:-1},{impulse:.1,closingSpeed:0},{impulse:NaN,closingSpeed:1},{impulse:Infinity,closingSpeed:1}]){
    assert.deepEqual(plan('material-contact',{material:'wood',at:{x:0},...extra}).cues,[]);
    assert.deepEqual(plan('clang',{weaponBind:true,at:{x:0},...extra}).cues,[]);
  }
  assert.deepEqual(plan('material-contact',{material:'imaginary',impulse:.1,closingSpeed:1}).cues,[]);
  assert.deepEqual(plan('unknown',{material:'wood',impulse:.1,closingSpeed:1}).cues,[]);
});
test('force-only contact metadata contributes without NaN and keys stay bounded',()=>{
  const result=plan('material-contact',{material:'wood',force:12,closingSpeed:.7,bodyA:'arm',bodyB:'torso',at:{x:Infinity}});
  assert.ok(result.cues.length);assert.ok(result.key.length<160);
  assert.ok(result.cues.every(c=>Number.isFinite(c.x)&&Number.isFinite(c.intensity)));
});
test('peak approach speed survives the near-zero final solver residual',()=>{
  const data={material:'wood',bodyA:'weapon',bodyB:'weapon',impulse:.17214796736943533,
    closingSpeed:.00025263580598955393,peakClosingSpeed:1.1,force:20.657756084332238,at:{x:.1574456822}};
  assert.equal(plan('material-contact',data).cues[0]?.name,'wood-contact');
});
test('delivered mixed material aliases preserve wood and damp leather correctly',()=>{
  const hit={weaponBind:true,impulse:.1,closingSpeed:1};
  assert.ok(plan('clang',{...hit,material:'wood_metal_mixed'}).cues.every(c=>!['ring','blade-beat'].includes(c.name)));
  assert.ok(plan('clang',{...hit,material:'metal_mixed'}).cues.some(c=>c.name==='blade-beat'));
  const leather=plan('clang',{...hit,material:'leather'});assert.ok(leather.cues.length);
  assert.ok(leather.cues.every(c=>c.name==='joint'&&c.intensity<.4));
  assert.equal(plan('clang',{...hit,material:'wood',defenseMaterial:'metal'}).cues[0].name,'wood-contact');
});
test('a rupture has latex and pressure-water onset, with physical floor contacts separate',()=>{
  const result=plan('burst',{loser:2,at:{x:1.8},relativeSpeed:2,contact:true});
  assert.deepEqual(result.cues.map(c=>c.name),['puncture','tear','water-burst']);
  assert.ok(result.cues.every(c=>c.x===1.8));assert.ok(!result.cues.some(c=>['splash','drip','jet'].includes(c.name)));
});
test('double puncture keeps both actual contact positions and is pure',()=>{
  const data={draw:true,at:{x:0},impacts:[{slot:1,x:-2,relativeSpeed:.6},{slot:2,x:2,relativeSpeed:3}]};
  const before=JSON.stringify(data),result=plan('burst',data);
  assert.equal(JSON.stringify(data),before);assert.equal(result.cues.length,6);
  assert.equal(result.cues.filter(c=>c.name==='water-burst').length,2);
  assert.ok(result.cues.some(c=>c.x===-2));assert.ok(result.cues.some(c=>c.x===2));
  assert.ok(result.cues.find(c=>c.x===2).intensity>result.cues.find(c=>c.x===-2).intensity);
});
