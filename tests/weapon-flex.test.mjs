import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {firstWeaponContact,firstWeaponPointContact,resolveWeaponBind} from '../public/physics/weapon-bind.js';
const api=await import('../public/physics/weapon-flex.js').catch(()=>null);

test('La hoja elástica sólo almacena energía cedida por un contacto, y la disipa al quedar libre',()=>{
  assert.ok(api,'falta el modo físico de flexión');
  const f=new api.WeaponFlex('sword');
  assert.equal(f.energy(),0);f.excite(1,0);assert.equal(f.energy(),0,'sin trabajo disponible no hay oscilación');
  f.excite(1,.012);assert.ok(f.energy()>0&&f.energy()<=.012+1e-12);
  const initial=f.energy();for(let i=0;i<360;i++){const previous=f.energy();f.advance(1/120);assert.ok(f.energy()<=previous+1e-12);assert.ok(Math.abs(f.offset)<=f.maximum);}
  assert.ok(f.energy()<initial*.001);assert.ok(Number.isFinite(f.offset));
});
test('El contacto real cede trabajo al modo elástico sin superar el trabajo disipado ni alterar targets',()=>{
  const a=new ArticulatedRig({gravity:0,baseX:-1.53,flexibleWeapons:true}),b=new ArticulatedRig({gravity:0,dir:-1,baseX:1.53,flexibleWeapons:true});
  b.q[1]+=.025;const c=firstWeaponContact(a,b);assert.ok(c);
  a.reactImpulse({point:c.pointA,impulse:{x:c.normal.x*.06,y:c.normal.y*.06}});
  b.reactImpulse({point:c.pointB,impulse:{x:-c.normal.x*.06,y:-c.normal.y*.06}});
  const before=a.diagnostics().kineticEnergy+b.diagnostics().kineticEnergy,targets=[a.target.slice(),b.target.slice()],r=resolveWeaponBind(a,b,{project:false}),stored=a.weaponFlex.energy()+b.weaponFlex.energy();
  assert.ok(r.impulse>0);assert.ok(stored>0,'acero cargado debe flexionar');
  assert.ok(stored<=r.dissipatedWork+1e-12);assert.ok(r.flexWork<=r.dissipatedWork+1e-12);
  assert.ok(a.diagnostics().kineticEnergy+b.diagnostics().kineticEnergy+stored<=before+1e-9,'la suma rígida+modo no excede la energía previa al choque');
  assert.deepEqual(a.target,targets[0]);assert.deepEqual(b.target,targets[1]);
  a.step(1/120);b.step(1/120);assert.ok(Math.abs(a.weaponFlex.offset)>0);assert.ok(a.pose().weaponCurve);
  for(const [rig,sign] of [[a,-1],[b,1]]){
    const p=rig.pose(),angle=p.angles.weapon,straight={x:p.mainHand.x+Math.cos(angle)*rig.swordLength,y:p.mainHand.y+Math.sin(angle)*rig.swordLength};
    assert.ok(sign*((p.tip.x-straight.x)*c.normal.x+(p.tip.y-straight.y)*c.normal.y)>0,'ambos slots doblan en el sentido de su propia carga, no al espejo contrario');
  }
});
test('CCD detecta acero que se acerca sólo por flexión, sin mover ni girar las coordenadas rígidas',()=>{
  const r=new ArticulatedRig({gravity:0,flexibleWeapons:true});assert.ok(r.weaponFlex);
  r.weaponFlex.previousOffset=-.035;r.weaponFlex.offset=.035;r.previousQ=r.q.slice();
  const p=r.pose(),base=r.collisionPanelsAt(0).find(p=>p.key==='weapon'),end=r.collisionPanelsAt(1).find(p=>p.key==='weapon');
  const target={x:(end.vertices[2].x+end.vertices[3].x)/2,y:(end.vertices[2].y+end.vertices[3].y)/2,z:.177};
  assert.ok(Math.hypot(target.x-base.center.x,target.y-base.center.y)>0);
  const contact=firstWeaponPointContact(r,target,target);assert.ok(contact&&contact.t>0&&contact.t<=1);
  assert.ok(p.weaponCurve.every(p=>[p.x,p.y,p.z].every(Number.isFinite)));
});
test('La curva conserva longitud de arco y raíz, con signo simétrico y sin flexión en mazo/hacha',()=>{
  assert.ok(api,'falta el modo físico de flexión');
  const length=1.02,bend=.025,n=400;let total=0,previous=api.bladeLocalAt(length,bend,0);
  assert.deepEqual(previous,{x:0,y:0});
  for(let i=1;i<=n;i++){const p=api.bladeLocalAt(length,bend,i/n);total+=Math.hypot(p.x-previous.x,p.y-previous.y);previous=p;}
  assert.ok(Math.abs(total-length)<1e-7);
  const mirror=api.bladeLocalAt(length,-bend,1);assert.equal(previous.x,mirror.x);assert.equal(previous.y,-mirror.y);
  for(const id of ['maul','axe']){const f=new api.WeaponFlex(id);f.excite(1,1);f.advance(1/120);assert.equal(f.energy(),0);assert.equal(f.offset,0);}
});
test('La punta y las superficies reales siguen la misma curva; no cambia el acero rígido por defecto',()=>{
  const rigid=new ArticulatedRig({gravity:0}),rig=new ArticulatedRig({gravity:0,flexibleWeapons:true});
  assert.ok(rig.weaponFlex,'falta opt-in físico de hojas elásticas');
  assert.equal(rigid.weaponFlex,null);
  rig.weaponFlex.offset=.025;rig.weaponFlex.previousOffset=.01;
  const pose=rig.pose();assert.equal(pose.weaponCurve.length,5);assert.deepEqual(pose.weaponCurve[0],pose.mainHand);assert.deepEqual(pose.weaponCurve[4],pose.tip);
  const panels=rig.collisionPanels().filter(p=>p.body==='weapon'&&p.material!=='wood');assert.equal(panels.length,4);
  const last=panels.find(p=>p.key==='weapon');assert.ok(last.vertices.some(p=>Math.hypot(p.x-pose.tip.x,p.y-pose.tip.y)<.02));
  for(const t of [0,.25,.5,.75,1]){
    const all=rig.collisionPanelsAt(t),geometry=rig.collisionGeometryAt(t);
    assert.deepEqual(geometry,all,'consultas CCD rápidas y completas deben coincidir');
    for(const p of all.filter(p=>p.key.startsWith('weapon-flex-')||p.key==='weapon'))assert.deepEqual(rig.collisionGeometryAt(t,p.key),[p]);
  }
});
