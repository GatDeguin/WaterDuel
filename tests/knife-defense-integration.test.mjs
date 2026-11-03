import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DuelEngine,STEP,parryContact} from '../public/engine.js';
import {DEFENSES} from '../public/equipment.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';
import {knifeTip,knifeFrame,knifeWorldNormal} from '../public/knife-technique.js';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms,equipmentTransform,deformEquipmentPoint} from '../public/rendering/asset-rig.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z??0)-(b.z??0));
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const point=(m,p)=>({x:m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],y:m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],z:m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]});
// N16 scenarios retain every contact/impulse assertion below. These four
// input sequences were measured with a real countdown (audit/knife-n16-root-results-113-ba5f.json).
// The new versus opening changes initial wrists. J1/reverse now aims from the
// observed dagger before advancing; all physical assertions and 285 ticks stay.
// The original inputs and RED/geometry evidence are preserved in
// audit/sword-axe-recovery-1.13.2/validation/knife/.
const settled={countdown:true,defPrepLean:1,atkPrepLean:0,offMainY:-1,offWrist:-1};
const recipes=[{slot:1,grip:'normal',aim:.2,wrist:.35,offY:-.25,...settled},
  {slot:1,grip:'reverse',aim:0,wrist:.35,defLean:.25,thrustTick:-1,aimAtObservedKnife:true,...settled},
  {slot:2,grip:'normal',aim:.2,wrist:.35,offY:-.25,...settled},
  {slot:2,grip:'reverse',aim:-.4,wrist:.35,defLean:.25,thrustTick:-1,...settled}];
function aimAtKnife(game,slot,mainY){
  const attacker=game.fighters[2-slot],defender=game.fighters[slot-1],hand=attacker.pose.mainHand,tip=attacker.pose.tip;
  const frame=knifeFrame(defender.pose.offHand,defender.pose.defenseTip);
  assert.ok(frame&&Math.abs(frame.u.z)>1e-9&&Math.abs(frame.w.z)>1e-9,'observed finite tilted knife frame');
  // Intersect the actual tilted knife profile with the attacking blade's z
  // layer. Its .012 half-depth and .055 ellipse width match parryContact;
  // aiming at the XY midpoint would miss this thin 3D slice.
  const half=frame.length/2,z=(tip.z??.17)-frame.center.z,span=.012*Math.abs(frame.w.z);
  const limits=[(z-span)/frame.u.z,(z+span)/frame.u.z].sort((a,b)=>a-b);
  const low=Math.max(-half,limits[0]),high=Math.min(half,limits[1]);assert.ok(low<=high,'the observed blade plane intersects the real knife');
  const u=(low+high)/2,w=(z-u*frame.u.z)/frame.w.z;
  const target={x:frame.center.x+u*frame.u.x+w*frame.w.x,y:frame.center.y+u*frame.u.y+w*frame.w.y};
  const desired=Math.atan2(target.y-hand.y,Math.max(.3,attacker.dir*(target.x-hand.x)));
  const actual=Math.atan2(tip.y-hand.y,attacker.dir*(tip.x-hand.x)),error=Math.atan2(Math.sin(desired-actual),Math.cos(desired-actual));
  const base=(desired-Math.atan2(.58*mainY,attacker.rig.swordLength))/(Math.PI/4);
  const width=.055*Math.sqrt(Math.max(0,1-(u/half)**2)),range=Math.hypot(target.x-hand.x,target.y-hand.y);
  return {wrist:Math.max(-1,Math.min(1,base+error)),lean:Math.abs(error)<=Math.atan2(width,range)?1:0};
}
function realParry({slot,grip,aim,wrist,attackerWeapon='sword',offMainY=slot===1?-1:1,offWrist=slot===1?-1:1,requireImpulse=true,offY=1,countdown=false,defPrepLean=0,defLean=0,atkPrepLean=-1,thrustTick=145,aimAtObservedKnife=false}){
  let game,observed=null;const contacts=[];
  game=new DuelEngine((name,data)=>{
    if(name!=='clang'||data.defender!==slot)return;contacts.push(data);
    if(requireImpulse&&data.impulse<=1e-5||observed)return;
    observed={event:data,score:game.scores.slice(),attacker:structuredClone(game.fighters[2-slot].rig.lastImpulse),defender:structuredClone(game.fighters[slot-1].rig.lastImpulse)};
  });
  game.setMode('versus');game.setLoadout(slot,{weapon:'sword',defense:'knife',...(grip==='reverse'?{knifeGrip:'reverse'}:{})});
  game.setLoadout(3-slot,{weapon:attackerWeapon,defense:'none'});
  if(countdown){game.start();for(let i=0;i<100&&game.phase==='countdown';i++)game.update(.04);assert.equal(game.phase,'fight');}
  else game.phase='fight';
  for(let i=0;i<285&&game.phase==='fight'&&!observed;i++){
    game.setControl(slot,{guard:true,offX:.85,offY,mainX:-1,mainY:offMainY,wrist:offWrist,lean:i<75?defPrepLean:defLean});
    game.setControl(3-slot,i<75?{mainX:-1,mainY:-1,wrist:-1,lean:atkPrepLean}:{mainX:1,mainY:aim,wrist,lean:1,thrust:i===thrustTick,...(aimAtObservedKnife?aimAtKnife(game,slot,aim):{})});
    game.update(STEP);
  }
  return {game,observed,contacts};
}
function guardPose(slot,grip){
  const game=new DuelEngine();game.setMode('versus');game.setLoadout(slot,{weapon:'sword',defense:'knife',...(grip==='reverse'?{knifeGrip:'reverse'}:{})});game.phase='fight';
  const f=game.fighters[slot-1];
  for(let i=0;i<100;i++){game.setControl(slot,{guard:true,offX:.85,offY:1,mainX:-1,mainY:-1});game.clock+=STEP;game.updateFighter(f,STEP);}
  return {game,f};
}
function segmentTouchesPanel(a,b,panel){
  const local=p=>[...panel.axes.map(n=>(p.x-panel.center.x)*n.x+(p.y-panel.center.y)*n.y),(p.z??0)-panel.z];
  const x=local(a),y=local(b),half=[...panel.axes.map(n=>Math.max(...panel.vertices.map(v=>Math.abs((v.x-panel.center.x)*n.x+(v.y-panel.center.y)*n.y)))),panel.depth/2];
  let enter=0,exit=1;
  for(let axis=0;axis<3;axis++){
    const d=y[axis]-x[axis];if(Math.abs(d)<1e-12){if(Math.abs(x[axis])>half[axis])return false;continue;}
    let lo=(-half[axis]-x[axis])/d,hi=(half[axis]-x[axis])/d;if(lo>hi)[lo,hi]=[hi,lo];enter=Math.max(enter,lo);exit=Math.min(exit,hi);if(enter>exit)return false;
  }
  return true;
}

test('Normal conserva la intención anterior; reverse invierte la hoja real y recoge la guardia fuera del globo',()=>{
  for(const slot of [1,2]){
    const normal=guardPose(slot,'normal'),reverse=guardPose(slot,'reverse'),a=normal.f,b=reverse.f;
    assert.equal(b.equipment.knifeGrip,'reverse');assert.equal(b.pose.equipment.knifeGrip,'reverse');
    const intent=normal.game.buildPose(a),expected=knifeTip(intent.offHand,{dir:a.dir});
    assert.deepEqual(intent.defenseTip,expected);
    assert.ok((b.pose.defenseTip.y-b.pose.offHand.y)*(a.pose.defenseTip.y-a.pose.offHand.y)<0,'la hoja debe apuntar al lado inverso');
    assert.ok(distance(b.pose.offHand,b.pose.offShoulder)<distance(a.pose.offHand,a.pose.offShoulder)-.025,'la defensa inversa recoge el brazo hacia el cuerpo');
    const head=b.pose.head,hand=b.pose.offHand;
    assert.ok(((hand.x-head.x)/BALLOON_RADII.x)**2+((hand.y-head.y)/BALLOON_RADII.y)**2+(((hand.z??.17)-(head.z??.025))/BALLOON_RADII.z)**2>=1,'la mano no puede quedar dentro del globo');
    assert.deepEqual(b.pose.shieldRadiusX,0);assert.deepEqual(b.pose.shieldRadiusY,0);
  }
});

test('La palma física sigue la mano invertida mientras la hoja conserva su punta y perfil de parada',()=>{
  for(const slot of [1,2])for(const grip of ['normal','reverse']){
    const {f}=guardPose(slot,grip),p=f.pose,palm=f.rig.collisionPanels().find(panel=>panel.key==='off-palm');
    const blade={x:p.defenseTip.x-p.offHand.x,y:p.defenseTip.y-p.offHand.y};
    const alignment=palm.axes[0].x*blade.x+palm.axes[0].y*blade.y;
    assert.ok(grip==='reverse'?alignment<0:alignment>0,'la palma no gira junto a la hoja al cambiar su agarre relativo');
    const center={x:(p.offHand.x+p.defenseTip.x)/2,y:(p.offHand.y+p.defenseTip.y)/2,z:((p.offHand.z??.17)+(p.defenseTip.z??.17))/2};
    const hit=parryContact({x:center.x-.2,y:center.y,z:center.z},{x:center.x+.2,y:center.y,z:center.z},p,DEFENSES.knife);
    assert.ok(hit,'el barrido debe tocar la hoja realmente situada en la pose');
    const world=knifeWorldNormal(p.offHand,p.defenseTip,hit.normal);assert.ok(Object.values(world).every(Number.isFinite));
    assert.equal(parryContact({x:center.x-.2,y:center.y,z:center.z+1},{x:center.x+.2,y:center.y,z:center.z+1},p,DEFENSES.knife),null,'no aparece cobertura artificial en profundidad');
  }
});

test('Los sockets de daga GLB v2 y v3 coinciden con la punta física en ambos agarres y jugadores',async()=>{
  const {assertKnifeSocketContract}=await import('./helpers/knife-socket-reference.mjs');
  for(const version of ['v2','v3']){
    const bytes=await readFile(new URL(`../public/assets/equipment/workshop/${version}/knife.glb`,import.meta.url));
    const asset=parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const socket=asset.nodes.find(node=>node.name==='Socket_Strike').worldMatrix.subarray(12,15);
    for(const slot of [1,2])for(const grip of ['normal','reverse']){
      const {f}=guardPose(slot,grip),transform=equipmentTransform(f,'knife');
      // Three separate CPU contracts: ideal F64 alignment remains <1e-7,
      // the submitted matrix is exactly fround(reference), and the virtual
      // endpoint obeys propagated input-quantization bounds. No GPU execution.
      const uniforms32={...transform,deformStart:Math.fround(transform.deformStart),deformEnd:Math.fround(transform.deformEnd),extension:Math.fround(transform.extension)};
      assertKnifeSocketContract({asset,hand:f.pose.offHand,tip:f.pose.defenseTip,transform,
        localPoint64:deformEquipmentPoint([0,.42,0],transform),
        localPoint32:deformEquipmentPoint(socket,uniforms32)});
    }
  }
});

test('Los mandos producen una parada real con desvío tangencial y reacción opuesta, sin asignar puntos',()=>{
  for(const recipe of recipes){
    const {slot,grip}=recipe,{observed}=realParry(recipe);
    assert.ok(observed,`${slot}/${grip}: los mismos motores deben producir contacto real con la daga`);
    const {event,attacker,defender}=observed;
    assert.equal(event.bodyB,'offWeapon');assert.ok(Math.abs(event.frictionImpulse)>1e-6);
    assert.ok(event.dissipatedWork>=0&&Number.isFinite(event.dissipatedWork));
    assert.ok(Math.hypot(event.velocityAfter.x-event.velocityBefore.x,event.velocityAfter.y-event.velocityBefore.y)>1e-5);
    near(attacker.impulse.x+defender.impulse.x,0);near(attacker.impulse.y+defender.impulse.y,0);
    assert.equal(attacker.body,'weapon');assert.equal(defender.body,'offWeapon');assert.deepEqual(observed.score,[0,0]);
  }
});

test('La mano GLB conserva el agarre real en su socket y sus vértices de palma invierten respecto de la hoja',async()=>{
  const bytes=await readFile(new URL('../public/assets/characters/water-mannequin/v3/water-mannequin.glb',import.meta.url));
  const character=prepareCharacter(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
  const partIndex=character.parts.findIndex(p=>p.boneName==='hand.L'&&p.nodeName==='WD_Beech_Wood_Grain');
  assert.ok(partIndex>=0);const part=character.parts[partIndex],m=character.bones.get('hand.L').worldMatrix;
  const axis=[0,1,2].map(i=>-m[i*4]/(m[i*4]**2+m[i*4+1]**2+m[i*4+2]**2));
  const vertices=Array.from({length:part.positions.length/3},(_,i)=>Array.from(part.positions.subarray(i*3,i*3+3)));
  const sorted=vertices.map(p=>({p,s:p.reduce((sum,v,i)=>sum+v*axis[i],0)})).sort((a,b)=>a.s-b.s);
  for(const slot of [1,2])for(const grip of ['normal','reverse']){
    const {f}=guardPose(slot,grip),matrix=characterTransforms(character,f)[partIndex];
    const socket=point(matrix,part.anchorSocket);near(distance(socket,f.pose.offHand),0,2e-6);
    const a=point(matrix,sorted[0].p),b=point(matrix,sorted.at(-1).p),tip=f.pose.defenseTip,hand=f.pose.offHand;
    const dot=(b.x-a.x)*(tip.x-hand.x)+(b.y-a.y)*(tip.y-hand.y)+(b.z-a.z)*((tip.z??.17)-(hand.z??.17));
    assert.ok(grip==='reverse'?dot<0:dot>0,'son vértices reales de la palma, no sólo un target auxiliar');
  }
});

test('El desprendimiento real retira la parada inversa aun si queda una pose de guardia anterior',()=>{
  for(const recipe of recipes.filter(r=>r.grip==='reverse')){
    const {game,observed,contacts}=realParry({...recipe,requireImpulse:false});assert.ok(observed);
    const f=game.fighters[recipe.slot-1],count=contacts.length;assert.equal(f.guard,true);
    f.rig.damageJoint('offElbow',1);assert.equal(f.rig.isBodyAttached('offForearm'),false);assert.equal(f.rig.isBodyAttached('offWeapon'),false);
    assert.equal(f.rig.diagnostics().bodies.some(body=>body.name==='offWeapon'),false);
    game.detectHits();assert.equal(contacts.length,count,'el mismo barrido real no puede chocar con una daga fantasma');
    game.updateFighter(f,STEP);assert.equal(f.guard,false);
  }
});

test('Un brazo dañado conserva topología y números finitos; cambiar a otra defensa retira la hoja invertida',()=>{
  for(const slot of [1,2]){
    const {game,f}=guardPose(slot,'reverse');f.rig.damageJoint('offElbow',.6);
    for(let i=0;i<40;i++){game.clock+=STEP;game.updateFighter(f,STEP);}
    assert.equal(f.rig.isBodyAttached('offWeapon'),true);
    assert.ok(f.rig.diagnostics().coordinates.every(q=>Number.isFinite(q.position)&&Number.isFinite(q.velocity)));
    game.resetMatch();assert.equal(game.setLoadout(slot,{defense:'short'}),true);
    const current=game.fighters[slot-1];assert.equal('knifeGrip'in current.equipment,false);assert.equal('defenseTip'in current.pose,false);
    assert.equal(current.rig.diagnostics().bodies.some(body=>body.name==='offWeapon'),false);
  }
});

test('El filo real .125–.42 de la daga evita madera propia al estabilizar ambas guardias y lados',()=>{
  for(const slot of [1,2])for(const grip of ['normal','reverse']){
    const game=new DuelEngine();game.setMode('versus');game.setLoadout(slot,{defense:'knife',...(grip==='reverse'?{knifeGrip:'reverse'}:{})});game.phase='fight';const f=game.fighters[slot-1];
    for(let i=0;i<100;i++){
      game.setControl(slot,{guard:true,offX:.85,offY:1,mainX:-1,mainY:-1});game.clock+=STEP;game.updateFighter(f,STEP);
      const {offHand:h,defenseTip:t}=f.pose,from={x:h.x+(t.x-h.x)*(.125/.42),y:h.y+(t.y-h.y)*(.125/.42),z:h.z+(t.z-h.z)*(.125/.42)};
      for(const panel of f.rig.collisionPanels()){
        if(panel.body==='weapon'&&panel.material!=='wood')continue;
        assert.equal(segmentTouchesPanel(from,t,panel),false,`${slot}/${grip}/tick${i}: el filo toca ${panel.key}`);
      }
      assert.ok(f.rig.diagnostics().maxSelfPenetration<1e-5);
    }
  }
});
