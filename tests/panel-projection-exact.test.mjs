import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DuelEngine} from '../public/engine.js';

// Compare the actual private helpers against a frozen independent prior source.
// The engine/contact suites exercise their consumers; no new public physics API
// is introduced only to expose an optimization detail to tests.
const source=await readFile(new URL('../public/physics/articulated-rig.js',import.meta.url),'utf8');
const frozen=await readFile(new URL('./fixtures/panel-projection-pre-1.10.js.txt',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(frozen).digest('hex'),'fc62ccbfaa05c016a550fb968b3fe44ff893a1830efbcef2f079e444b3023b78');
const part=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to);assert.ok(a>=0&&b>a,'the actual runtime helper remains locatable');return source.slice(a,b);};
const compile=code=>new Function(code+'\nreturn {projection,supportFace};')();
const before=compile(frozen),current=compile(part('const projection=','const sharesContactFace=')+'\n'+part('const supportFace=','const support='));
const bits=record=>Buffer.from(Float64Array.from(Object.values(record)).buffer);
function exact(panel,n,tangent,label){
 for(const name of ['projection','supportFace']){
  const a=before[name](panel,n,tangent),b=current[name](panel,n,tangent);
  assert.deepEqual(b,a,`${label}/${name}`);assert.deepEqual(bits(b),bits(a),`${label}/${name}/Float64 bits`);
 }
}

test('Panel projections and supporting faces preserve every Float64 bit for actual posed weapon/body panels',()=>{
 let cases=0;
 for(const weapon of ['sword','spear','axe','maul'])for(const dir of [-1,1])for(const boss of [false,true]){
  const game=new DuelEngine();game.setMode('versus');game.setLoadout(1,{weapon,defense:'knife'});
  const f=game.fighters[0];f.dir=dir;f.baseX=-dir*1.53;f.boss=boss;game.initializeRig(f);
  for(let pose=0;pose<8;pose++){
   f.rig.q[3]=-.5+pose*.13;f.rig.q[4]=-2.2+pose*.15;f.rig.q[5]=.3+pose*.16;f.rig.q[13]=-.5+pose*.12;
   for(const panel of f.rig.collisionPanels())for(const n of [...panel.axes,{x:.6,y:.8},{x:-.8,y:.6}]){
    exact(panel,n,{x:-n.y,y:n.x},`${weapon}/${dir}/${boss}/${pose}/${panel.key}`);cases++;
   }
  }
 }
 assert.ok(cases>5000);
});

test('Projection boundaries retain degenerate faces, strict face tolerance, signed zero and nonfinite behavior',()=>{
 const planes=[{vertices:[]},{vertices:[{x:0,y:-0},{x:-0,y:0}]},{vertices:[{x:1,y:1},{x:1-1e-7,y:-1},{x:1-1e-7+Number.EPSILON,y:2}]},{vertices:[{x:NaN,y:1},{x:2,y:Infinity}]},{vertices:[{x:1e300,y:-1e300},{x:-1e300,y:1e300}]}];
 for(const panel of planes)for(const n of [{x:1,y:0},{x:-1,y:-0},{x:0,y:1},{x:.6,y:.8}])exact(panel,n,{x:-n.y,y:n.x},'boundary');
});
