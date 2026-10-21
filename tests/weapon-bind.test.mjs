import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {DuelEngine,STEP} from '../public/engine.js';
import {segmentEllipsoidContact} from '../public/physics/head-contact.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';

const implementation=await import('../public/physics/weapon-bind.js').catch(()=>null);
const api=name=>{assert.equal(typeof implementation?.[name],'function',`Falta ${name}: contacto continuo de armas`);return implementation[name];};
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
// Exact rectangular blades translated/rotated analytically. This fixture tests
// geometry only; physical response below uses the real articulated mass matrix.
function blade({x=0,y=0,toX=x,toY=y,angle=0,toAngle=angle,z=.177,width=.034,length=1,material}={}){
  const at=t=>{
    const a=angle+(toAngle-angle)*t,c=Math.cos(a),s=Math.sin(a),cx=x+(toX-x)*t,cy=y+(toY-y)*t;
    const vertices=[[-length/2,-width/2],[-length/2,width/2],[length/2,width/2],[length/2,-width/2]].map(([u,v])=>({x:cx+c*u-s*v,y:cy+s*u+c*v}));
    return [{body:'weapon',key:'weapon',material,axes:[{x:c,y:s},{x:-s,y:c}],center:{x:cx,y:cy},vertices,z,depth:.034,
      minX:Math.min(...vertices.map(v=>v.x)),maxX:Math.max(...vertices.map(v=>v.x)),minY:Math.min(...vertices.map(v=>v.y)),maxY:Math.max(...vertices.map(v=>v.y))}];
  };
  return {q:[toX,toY,toAngle],previousQ:[x,y,angle],scale:1,swordLength:length,previousSwordLength:length,
    collisionPanelsAt:at,collisionPanels:()=>at(1)};
}

test('El barrido encuentra hojas finas que se cruzan entre fotogramas sin solaparse al final',()=>{
  const a=blade(),b=blade({y:.4,toY:-.4});
  const c=api('firstWeaponContact')(a,b);assert.ok(c);
  near(c.t,(.4-.034)/.8,2e-6);near(c.normal.x,0);near(c.normal.y,1);
  assert.ok(c.t>0&&c.t<1);near(c.pointA.z,.177);
});

test('Profundidad, separación exterior y palma de madera no fabrican contacto de acero',()=>{
  const first=api('firstWeaponContact');
  assert.equal(first(blade(),blade({y:.4,toY:-.4,z:.212})),null);
  assert.equal(first(blade(),blade({y:.0341})),null);
  assert.equal(first(blade(),blade({material:'wood'})),null);
});

test('Intercambiar roles conserva instante y puntos y opone la normal',()=>{
  const first=api('firstWeaponContact'),a=blade({angle:.12}),b=blade({y:.4,toY:-.4});
  const ab=first(a,b),ba=first(b,a);assert.ok(ab&&ba);
  near(ab.t,ba.t);near(ab.normal.x,-ba.normal.x);near(ab.normal.y,-ba.normal.y);
  near(ab.pointA.x,ba.pointB.x);near(ab.pointA.y,ba.pointB.y);
});

test('El arco rotatorio real detecta contacto que la cuerda entre extremos no representa',()=>{
  const a=blade({x:.2,y:0,length:.13}),b=blade({y:.6,angle:-Math.PI/2,toAngle:Math.PI/2,length:1.3});
  const c=api('firstWeaponContact')(a,b);assert.ok(c&&c.t>0&&c.t<1);
  const A=a.collisionPanelsAt(c.t)[0],B=b.collisionPanelsAt(c.t)[0];
  assert.ok(Math.abs(c.pointA.y)<.018);assert.ok(B.vertices.some(v=>v.x>.12));assert.equal(A.body,'weapon');
});

test('La prioridad de acero es por trayectoria material XYZ y devuelve su primera entrada',()=>{
  const first=api('firstWeaponPointContact'),b=blade({x:0,y:0,angle:Math.PI/2,length:1});
  const c=first(b,{x:-1,y:0,z:.177},{x:1,y:0,z:.177});assert.ok(c);near(c.t,(1-.017)/2,2e-6);
  assert.equal(first(b,{x:-1,y:0,z:.3},{x:1,y:0,z:.3}),null);
  assert.equal(first(b,{x:-1,y:.51,z:.177},{x:1,y:.51,z:.177}),null);
});

test('Impulso unilateral real propaga fuerza opuesta sin añadir energía ni cambiar objetivos',()=>{
  const resolve=api('resolveWeaponBind');
  for(const mirror of [-1,1]){
    const a=new ArticulatedRig({dir:mirror,baseX:-mirror*1.53,gravity:0}),b=new ArticulatedRig({dir:-mirror,baseX:mirror*1.53,gravity:0});
    b.q[1]+=.025;a.previousQ=a.q.slice();b.previousQ=b.q.slice();
    const c=api('firstWeaponContact')(a,b);assert.ok(c);
    a.reactImpulse({point:c.pointA,impulse:{x:c.normal.x*.06,y:c.normal.y*.06}});
    b.reactImpulse({point:c.pointB,impulse:{x:-c.normal.x*.06,y:-c.normal.y*.06}});
    const before=a.diagnostics().kineticEnergy+b.diagnostics().kineticEnergy,targets=[Array.from(a.target),Array.from(b.target)];
    const r=resolve(a,b,{dt:1/120});assert.ok(r.impulse>0&&r.impulse<=.45);
    assert.ok(a.diagnostics().kineticEnergy+b.diagnostics().kineticEnergy<=before+1e-8);
    const A=a.lastImpulse.impulse,B=b.lastImpulse.impulse;near(A.x+B.x,0);near(A.y+B.y,0);
    assert.deepEqual(Array.from(a.target),targets[0]);assert.deepEqual(Array.from(b.target),targets[1]);
    const after=resolve(a,b,{dt:1/120});assert.equal(after.impulse,0,'Una hoja separándose no recibe un nuevo impulso');
  }
});

test('El motor resuelve el contacto antes del soporte y sin requerir una estocada ni regalar puntos',()=>{
  const events=[],g=new DuelEngine((type,data)=>events.push({type,data}));g.setMode('versus');g.phase='fight';
  assert.equal(typeof g.resolveWeaponContacts,'function','Falta el paso físico arma-arma anterior a detectHits');
  for(const [i,f] of g.fighters.entries()){
    f.rig=new ArticulatedRig({dir:f.dir,baseX:-f.dir*1.53,gravity:0});
    if(i)f.rig.q[1]+=.025;
    f.rig.previousQ=f.rig.q.slice();f.pose=f.rig.pose();f.previousHead={...f.pose.head};f.lunge=0;
  }
  const c=api('firstWeaponContact')(...g.fighters.map(f=>f.rig));assert.ok(c);
  g.fighters[0].rig.reactImpulse({point:c.pointA,impulse:{x:c.normal.x*.06,y:c.normal.y*.06}});
  const before=g.fighters.map(f=>({...f.pose.tip}));g.resolveWeaponContacts(STEP);
  for(const f of g.fighters)g.refreshRigPose(f,STEP);
  assert.ok(g.lastWeaponContact.impulse>0);assert.ok(events.some(e=>e.type==='clang'));
  assert.ok(g.fighters.some((f,i)=>Math.hypot(f.pose.tip.x-before[i].x,f.pose.tip.y-before[i].y)>1e-5),'La restricción modifica la posición física dentro del paso');
  assert.deepEqual(g.scores,[0,0]);assert.ok(g.fighters.every(f=>f.globIntact));
});

test('La proyección corrige el cruce barrido dentro del paso y los motores recuperan la intención',()=>{
  const resolve=api('resolveWeaponBind'),a=new ArticulatedRig({baseX:-1.53,gravity:0}),b=new ArticulatedRig({dir:-1,baseX:1.53,gravity:0});
  // Parallel material travels across the interior, rather than pivoting past
  // the finite hilt endpoint (which correctly releases its contact).
  b.previousQ=b.q.slice();b.previousQ[1]+=.10;b.q[1]-=.025;
  a.previousQ=a.q.slice();const hit=api('firstWeaponContact')(a,b);assert.ok(hit&&hit.t>0&&hit.t<1);
  b.velocity[1]=-.2;
  const targets=[Array.from(a.target),Array.from(b.target)],result=resolve(a,b,{dt:STEP});
  assert.ok(result.iterations>0);assert.ok(result.penetration<1e-5,`La hoja atravesó ${result.penetration}`);
  const qAtImpact=a.q.slice();for(let i=0;i<360;i++){a.step(STEP);b.step(STEP);}
  assert.ok(Math.abs(a.q[13]-a.target[13])<.025,'Recupera la muñeca sin una ventana de inmunidad');
  assert.ok(Math.abs(a.q[13]-qAtImpact[13])>1e-5,'El retorno procede de los actuadores');
  assert.deepEqual(Array.from(a.target),targets[0]);assert.deepEqual(Array.from(b.target),targets[1]);
});

test('Mantener la intención enfrentada usa fuerza por paso finita y no acumula energía ilimitada',()=>{
  const resolve=api('resolveWeaponBind'),a=new ArticulatedRig({baseX:-1.53,gravity:0}),b=new ArticulatedRig({dir:-1,baseX:1.53,gravity:0});
  let sum=0,maxEnergy=0,contacts=0;
  for(let i=0;i<180;i++){
    a.step(STEP);b.step(STEP);const c=resolve(a,b,{dt:STEP});
    assert.ok(c.impulse>=0&&c.impulse<=54*STEP+1e-12);sum+=c.impulse;contacts+=c.impulse>0;
    maxEnergy=Math.max(maxEnergy,a.diagnostics().kineticEnergy+b.diagnostics().kineticEnergy);
    assert.ok(Number.isFinite(maxEnergy));
    for(const r of [a,b])for(const foot of r.diagnostics().contacts)assert.ok(foot.error<.0002,'Conserva los apoyos tras cada contacto');
  }
  assert.ok(contacts>5,'El caso ejerce realmente contacto mantenido, no sólo separación libre');
  assert.ok(sum<=54*STEP*180);assert.ok(maxEnergy<5,`La energía creció a ${maxEnergy}`);
});

function steelPriority({slot=1,headX=.65,y=2.9}={}){
  const events=[],g=new DuelEngine((type,data)=>events.push({type,data}));g.setMode('versus');g.phase='fight';
  const atk=g.fighters[slot-1],def=g.fighters[2-slot],dir=atk.dir,r=def.rig;
  // Analytic priority isolation, like the existing timber/head fixture: keep a
  // real rigid weapon/collider and place the target proxy before/after it. This
  // is not a playable pose nor a score assignment.
  r.q[4]=-.45;r.q[13]=0;
  const hand=r.pose().mainHand;r.q[0]-=hand.x;r.q[1]+=2.2-hand.y;r.previousQ=r.q.slice();
  def.pose=r.pose();def.pose.head={x:dir*headX,y,z:.177};def.previousHead={...def.pose.head};def.guard=false;
  const from={x:-dir,y,z:.177},to={x:dir,y,z:.177};
  assert.equal(r.firstTimberContact(from,to),null,'La prioridad aislada no depende de interceptar madera');
  atk.previousTip=from;atk.pose.mainHand={x:-dir*1.2,y,z:.177};atk.pose.tip=to;atk.lunge=1;def.lunge=0;
  g.detectHits();return {g,events,def};
}

test('Acero anterior bloquea sólo su punto material: globo anterior y trayectorias libres aún se pinchan',()=>{
  for(const slot of [1,2]){
    const blocked=steelPriority({slot});assert.ok(blocked.def.globIntact);assert.deepEqual(blocked.g.scores,[0,0]);
    const earlier=steelPriority({slot,headX:-.35});assert.equal(earlier.def.globIntact,false,'El acero posterior no otorga inmunidad retroactiva');
    const clear=steelPriority({slot,y:3.3});assert.equal(clear.def.globIntact,false,'Un contacto en otra zona no protege el globo');
  }
});

function beatFixture(dir=1){
  const a=new ArticulatedRig({dir,baseX:-dir*1.35,gravity:0}),b=new ArticulatedRig({dir:-dir,baseX:dir*1.35,gravity:0}),h=a.pose().head,p=b.pose().mainHand;
  // Initial mechanism state: defender points at the real opposing head; the
  // attacking wrist is observed crossing upward through that physical blade.
  const neutralLocal=a.pose().angles.weapon*(dir===1?1:-1)+(dir===1?0:Math.PI);
  b.q[13]=Math.atan2(h.y-p.y,dir*(p.x-h.x))-neutralLocal;b.target=b.q.slice();b.previousQ=b.q.slice();
  a.q[13]=-.2;a.previousQ=a.q.slice();a.q[13]=.3;a.target=a.q.slice();a.velocity[13]=2;
  return {a,b};
}
function counterLine(a,b,path){
  const hand=path?.from??{...a.pose().mainHand,z:.177},head=b.pose().head,target={...head,y:head.y+(path?.dy??-.3),z:.177};
  const dx=target.x-hand.x,dy=target.y-hand.y,length=Math.hypot(dx,dy),tip=path?.to??{x:hand.x+dx/length*1.44,y:hand.y+dy/length*1.44,z:.177};
  // Read-only instantaneous geometry for a prospective next thrust, whose
  // length equals the catalogue's maximum sword length (1.02+.32+.10).
  const physical=b.collisionPanels(),frozen={q:[],collisionPanels:()=>physical,collisionPanelsAt:()=>physical};
  return {from:hand,to:tip,blade:api('firstWeaponPointContact')(frozen,hand,tip),head:segmentEllipsoidContact(hand,tip,head,BALLOON_RADII)};
}

test('El desvío abre una trayectoria de estocada alcanzable y la recuperación vuelve a cerrarla, en ambos roles',()=>{
  const resolve=api('resolveWeaponBind');
  for(const dir of [-1,1]){
    const {a,b}=beatFixture(dir),baseline=beatFixture(dir);
    const contact=resolve(a,b,{dt:STEP});assert.ok(contact.impulse>.01);
    for(let i=0;i<12;i++)for(const r of [a,b,baseline.a,baseline.b])r.step(STEP);
    // Search the actual visible head section for a counterthrust available from
    // the attacker's present hand. Each candidate is identical before/after the
    // defender's measured displacement: only enemy geometry changes.
    const opening=Array.from({length:28},(_,i)=>{
      const opened=counterLine(a,b,{dy:-.44+i*.02}),closed=counterLine(a,baseline.b,opened);
      return {opened,closed};
    }).find(({opened,closed})=>opened.head&&closed.head&&closed.blade&&closed.blade.t<closed.head.t&&!opened.blade);
    assert.ok(opening,'Una estocada alcanzable debe pasar de acero anterior a vía libre por el desplazamiento enemigo');
    const {opened}=opening;
    for(let i=0;i<360;i++){a.step(STEP);b.step(STEP);}
    assert.ok(counterLine(a,b,opened).blade,'Los motores recuperan la línea sin un temporizador de inmunidad');
  }
});

test('La misma secuencia física reproduce exactamente los impulsos y coordenadas',()=>{
  const run=()=>{
    const {a,b}=beatFixture(),impulses=[];
    for(let i=0;i<30;i++){a.step(STEP);b.step(STEP);impulses.push(api('resolveWeaponBind')(a,b,{dt:STEP}).impulse);}
    return {a:Array.from(a.q),b:Array.from(b.q),va:Array.from(a.velocity),vb:Array.from(b.velocity),impulses};
  };
  assert.deepEqual(run(),run());
});

test('El manifold compartido se recalcula sin repetir impulso y no toca puntuación ni intención',()=>{
  const manifold=api('weaponBindManifold'),{a,b}=beatFixture(),q=[Array.from(a.q),Array.from(b.q)];
  const hit=api('resolveWeaponBind')(a,b,{dt:STEP,project:false});
  assert.deepEqual(Array.from(a.q),q[0]);assert.deepEqual(Array.from(b.q),q[1]);
  const velocity=[Array.from(a.velocity),Array.from(b.velocity)],before=manifold(a,b,hit);
  assert.equal(before.length,1);assert.ok(before[0].penetration>0);assert.equal(before[0].projectOnly,true);
  assert.equal(before[0].bodyA,'weapon');assert.equal(before[0].bodyB,'weapon');
  for(let i=0;i<20;i++)manifold(a,b,hit);
  assert.deepEqual(Array.from(a.velocity),velocity[0]);assert.deepEqual(Array.from(b.velocity),velocity[1]);
  ArticulatedRig.projectContact(a,b,before[0]);
  assert.ok((manifold(a,b,hit)[0]?.penetration??0)<before[0].penetration);
});

test('Salir por el extremo finito libera el vínculo, aunque el viejo plano de entrada quede detrás',()=>{
  const a=blade(),b=blade({y:.4,toY:-.4,toX:2}),hit=api('firstWeaponContact')(a,b);assert.ok(hit&&hit.t<1);
  assert.deepEqual(api('weaponBindManifold')(a,b,hit),[],'No existe una pared infinita prolongando una hoja ya separada');
});

test('La transición real a combate resuelve acero, palma y madera juntos con un soporte por muñeco y paso',()=>{
  const events=[],g=new DuelEngine((type,data)=>events.push({type,data,clock:g.clock}));
  g.setLoadout(2,{defense:'none'});g.setMode('versus');g.start();
  for(let i=0;i<81;i++){
    g.update(.04);
    if(g.phase==='fight')for(const c of g.lastBodyContacts??[])assert.ok(c.penetration<.001,`first fight ${g.clock} ${c.keyA}/${c.keyB}: ${c.penetration}`);
  }
  assert.equal(g.phase,'fight');const advanceSupport=g.updateFighterSupport.bind(g);let supportCalls=0;
  g.updateFighterSupport=(...args)=>{supportCalls++;return advanceSupport(...args);};
  for(let i=0;i<8;i++){
    g.setControl(1,{lean:1,mainX:1,mainY:-.5,attackHeld:true});g.setControl(2,{lean:1,mainX:-1,mainY:-1});g.update(STEP);
    assert.equal(supportCalls,2*(i+1));
    for(const c of g.lastBodyContacts??[])assert.ok(c.penetration<.001,`tick${i+1} ${c.bodyA}/${c.bodyB}: ${c.penetration}`);
    assert.ok((g.lastWeaponContact?.penetration??0)<.001);
    for(const f of g.fighters)assert.ok(f.rig.diagnostics().contacts.every(c=>c.error<.0002));
  }
  const clangs=events.filter(e=>e.type==='clang'&&e.data.weaponBind);
  assert.equal(new Set(clangs.map(e=>e.clock)).size,clangs.length,'Una colisión no se vuelve a impulsar/publicar al iterar restricciones');
});

test('El deslizamiento casi tangencial conserva el primer contacto fino de hojas y punta',()=>{
  const first=api('firstWeaponContact'),point=api('firstWeaponPointContact');
  const c=first(blade(),blade({x:-.9,toX:.9,y:.035,toY:.033}));assert.ok(c);near(c.t,.5,6e-5);
  const p=point(blade(),{x:-.4,y:.018,z:.177},{x:.4,y:.016,z:.177});assert.ok(p);near(p.t,.5,6e-5);
});

test('El mínimo de un arco casi tangente y una punta estacionaria no desaparecen por agotar avance',()=>{
  const first=api('firstWeaponContact'),point=api('firstWeaponPointContact');
  for(const penetration of [1e-4,1e-5,1e-6]){
    const a=blade({length:.13,y:.6-Math.hypot(.5,.017)-.017+penetration});
    const b=blade({length:1,y:.6,angle:-1.2,toAngle:-Math.atan2(.5,.017)});
    assert.ok(first(a,b),`Arco entra realmente ${penetration}`);
  }
  const b=blade({angle:0,toAngle:Math.atan2(.017,.5)}),p={x:.5001,y:0,z:.177};
  assert.ok(point(b,p,p),'La hoja gira sobre la punta sin que el punto tenga traslación');
});

test('La salida rotatoria por un extremo no mantiene una pared fantasma por otra esquina remota',()=>{
  const a=blade(),b=blade({x:-.9,toX:.75,y:.034,toY:.3,toAngle:-Math.PI/3}),hit=api('firstWeaponContact')(a,b);assert.ok(hit);
  assert.deepEqual(api('weaponBindManifold')(a,b,hit),[]);
});

test('Acero intacto ya tiene contacto físico en espera y cuenta atrás sin puntuar fuera de combate',()=>{
  for(const phase of ['ready','countdown']){
    const g=new DuelEngine();g.setMode('versus');g.phase=phase;
    for(const [i,f] of g.fighters.entries()){
      f.rig=new ArticulatedRig({dir:f.dir,baseX:-f.dir*1.53,gravity:0});if(i)f.rig.q[1]+=.025;
      f.rig.previousQ=f.rig.q.slice();f.pose=f.rig.pose();f.previousHead={...f.pose.head};
    }
    g.solveFighterContacts(STEP);assert.ok(g.lastWeaponContact,'La escena de espera también respeta las armas sólidas');
    g.detectHits();assert.deepEqual(g.scores,[0,0]);assert.ok(g.fighters.every(f=>f.globIntact));
    g.fighters[0].globIntact=false;g.solveFighterContacts(STEP);assert.equal(g.lastWeaponContact,null);
  }
});

test('El audio recibe deslizamiento tangencial medido antes del impulso, sin fabricar velocidad por reloj',()=>{
  const {a,b}=beatFixture(),c=api('firstWeaponContact')(a,b);assert.ok(c);
  const before=api('weaponBindManifold')(a,b,c)[0],pointA=before?.pointA??c.pointA,pointB=before?.pointB??c.pointB;
  const va=a.pointVelocity({point:pointA}),vb=b.pointVelocity({point:pointB});
  const expected=Math.abs((va.x-vb.x)*-c.normal.y+(va.y-vb.y)*c.normal.x);
  const contact=api('resolveWeaponBind')(a,b,{dt:STEP,project:false});
  near(contact.slideSpeed,expected);assert.ok(contact.slideSpeed>0);assert.equal(contact.bodyA,'weapon');assert.equal(contact.bodyB,'weapon');
});
