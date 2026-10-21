import test from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import makes the first red state an explicit missing-feature assertion.
const implementation=await import('../public/physics/articulated-rig.js').catch(()=>null);
test('El módulo ofrece un rig articulado con masas e inercias por segmento',()=>{
  assert.ok(implementation?.ArticulatedRig,'Falta el multibody dinámico ArticulatedRig');
  const rig=new implementation.ArticulatedRig({baseX:-1.53,gravity:0});
  const d=rig.diagnostics();
  assert.equal(d.coordinates.length,14);
  assert.ok(d.bodies.length>=12);
  for(const b of d.bodies){assert.ok(b.mass>0);assert.ok(b.inertia>0);}
  assert.ok(d.massMatrix[4][5]!==0,'Hombro y codo deben compartir inercia acoplada');
});

const create=options=>new implementation.ArticulatedRig({gravity:0,...options});
const run=(rig,seconds,dt=1/120)=>{for(let t=0;t<seconds-1e-9;t+=dt)rig.step(dt);return rig;};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

test('La dinámica conserva longitudes rígidas de brazos y piernas en ambos tamaños',()=>{
  const rig=create();assert.equal(typeof rig.step,'function','Falta integrar subpasos articulados');
  for(const scale of [1,1.18]){
    const r=create({scale});run(r,.5);const p=r.pose();
    for(const [a,b,length] of [['mainShoulder','mainElbow',.52],['mainElbow','mainHand',.52],['offShoulder','offElbow',.48],['offElbow','offHand',.47],['frontHip','kneeF',.53],['kneeF','footF',.55],['backHip','kneeB',.53],['kneeB','footB',.55]])assert.ok(Math.abs(dist(p[a],p[b])-length*scale)<1e-10);
  }
});

test('Un impulso en la hoja se propaga al antebrazo, hombro y torso según masa/inercia',()=>{
  const light=create(),heavy=create({massScale:2}),shoulder=create();
  assert.equal(typeof light.reactImpulse,'function','Falta resolver impulso Jᵀp');
  const p=light.pose();
  light.reactImpulse({body:'weapon',point:p.tip,impulse:{x:0,y:.12}});
  heavy.reactImpulse({body:'weapon',point:heavy.pose().tip,impulse:{x:0,y:.12}});
  shoulder.reactImpulse({body:'torso',point:shoulder.pose().mainShoulder,impulse:{x:0,y:.12}});
  const a=light.diagnostics(),b=heavy.diagnostics(),c=shoulder.diagnostics();
  assert.ok(Math.abs(a.coordinates[5].velocity)>.03);
  assert.ok(Math.abs(a.coordinates[3].velocity)>1e-5,'El torso debe recibir reacción de la cadena');
  assert.ok(Math.abs(b.coordinates[5].velocity)<Math.abs(a.coordinates[5].velocity)*.55);
  assert.ok(Math.abs(a.coordinates[13].velocity-c.coordinates[13].velocity)>.5,'La muñeca con inercia debe distinguir golpe en hoja de golpe en torso');
  run(light,3);
  assert.ok(Math.abs(light.diagnostics().coordinates[5].position-light.diagnostics().coordinates[5].target)<.04,'El motor amortiguado recupera intención');
});

test('Los topes articulares y el solver permanecen finitos después de impactos fuertes',()=>{
  const rig=create({gravity:-9.81});
  for(let i=0;i<360;i++){
    if(i%31===0)rig.reactImpulse({body:'weapon',point:rig.pose().tip,impulse:{x:(i%2?1:-1)*.7,y:.5}});
    rig.step(1/120);
    const diagnostic=rig.diagnostics();
    for(const q of diagnostic.coordinates){assert.ok(Number.isFinite(q.position)&&Number.isFinite(q.velocity));assert.ok(q.position>=q.min-1e-8&&q.position<=q.max+1e-8,`${q.name}: ${q.position}`);}
    assert.ok(Number.isFinite(diagnostic.kineticEnergy)&&diagnostic.kineticEnergy>=0);
    for(const c of diagnostic.contacts)assert.ok(c.error<.0002,'El apoyo debe permanecer fijo después del impacto');
  }
});

test('El mismo tiempo a 30 y 120 Hz produce el mismo estado físico',()=>{
  const slow=create({gravity:-9.81}),fast=create({gravity:-9.81});
  run(slow,1,1/30);run(fast,1,1/120);
  const a=slow.diagnostics(),b=fast.diagnostics();
  for(let i=0;i<a.coordinates.length;i++){assert.ok(Math.abs(a.coordinates[i].position-b.coordinates[i].position)<1e-10);assert.ok(Math.abs(a.coordinates[i].velocity-b.coordinates[i].velocity)<1e-10);}
});

test('El pie de apoyo se ancla al mundo mientras el otro se eleva y recoloca',()=>{
  const rig=create(),initial=rig.pose(),intent=structuredClone(initial);
  for(const p of Object.values(intent))if(p&&typeof p.x==='number')p.x+=.48;
  rig.setIntent(intent,{baseX:.48,baseVX:.3});
  let sawSwing=false,raised=false;
  for(let i=0;i<150;i++){
    rig.step(1/120);const p=rig.pose(),d=rig.diagnostics();
    for(const c of d.contacts){
      if(c.stance)assert.ok(dist(c,p[c.key])<.0002,`El apoyo ${c.key} deslizó ${dist(c,p[c.key])}`);
      else{sawSwing=true;if(p[c.key].y>initial[c.key].y+.04)raised=true;}
    }
  }
  assert.ok(sawSwing&&raised);assert.ok(rig.pose().hip.x-initial.hip.x>.25);
});

test('La carga del agua utiliza masa y centro de masa para cambiar el torque del cuello',()=>{
  const left=create({gravity:-9.81}),right=create({gravity:-9.81}),empty=create({gravity:-9.81});
  for(const [r,offset] of [[left,-.2],[right,.2]]){
    const p=r.pose();r.setIntent(p,{waterLoad:{mass:1.15,center:{x:p.head.x+offset,y:p.head.y-.08},inertia:.07}});r.step(1/120);
  }
  empty.step(1/120);
  const a=left.diagnostics(),b=right.diagnostics(),c=empty.diagnostics();
  assert.ok(a.gravityTorque[12]>b.gravityTorque[12]+4,'genera momentos opuestos según centro de masa');
  assert.ok(b.massMatrix[12][12]>c.massMatrix[12][12]);
  assert.ok(a.coordinates[12].velocity>b.coordinates[12].velocity);
});

test('El impulso y la pose son simétricos al espejar el jugador',()=>{
  const a=create({dir:1}),b=create({dir:-1});
  a.reactImpulse({body:'weapon',point:a.pose().tip,impulse:{x:.08,y:.12}});
  b.reactImpulse({body:'weapon',point:b.pose().tip,impulse:{x:-.08,y:.12}});
  run(a,.3);run(b,.3);
  for(const key of ['hip','shoulder','head','mainHand','tip','footF','footB']){assert.ok(Math.abs(a.pose()[key].x+b.pose()[key].x)<1e-9);assert.ok(Math.abs(a.pose()[key].y-b.pose()[key].y)<1e-9);}
});

test('Las orientaciones de los mecanismos coinciden con sus segmentos en ambos jugadores',()=>{
  for(const dir of [1,-1]){
    const rig=create({dir}),p=rig.pose();
    for(const frame of Object.values(p.bodyFrames)){
      if(dist(frame.origin,frame.end)<.001)continue;
      const angle=Math.atan2(frame.end.y-frame.origin.y,frame.end.x-frame.origin.x);
      assert.ok(Math.abs(Math.sin(angle-frame.angle))<1e-10&&Math.cos(angle-frame.angle)>.99999,'El eje de cojinete/actuador debe seguir el enlace');
    }
  }
});

test('El contacto del pie coloca la suela de .075 sobre el tablero sin corregir el render',()=>{
  const rig=create();run(rig,.5);
  for(const key of ['footF','footB'])assert.ok(Math.abs(rig.pose()[key].y-.075-.3245)<1e-6);
});

test('Los impulsos inválidos se rechazan sin envenenar el estado',()=>{
  const rig=create();
  assert.equal(rig.reactImpulse({body:'weapon',point:{x:1e300,y:1e300},impulse:{x:1,y:1}}),false);
  assert.equal(rig.reactImpulse({body:'weapon',point:rig.pose().tip,impulse:{x:NaN,y:1}}),false);
  run(rig,.1);
  assert.ok(rig.diagnostics().coordinates.every(q=>Number.isFinite(q.position)&&Number.isFinite(q.velocity)));
});

test('La masa efectiva predice la respuesta de velocidad en el punto de contacto',()=>{
  const rig=create(),point=rig.pose().tip,normal={x:0,y:1};
  assert.equal(typeof rig.effectiveInverseMass,'function','Falta masa efectiva de contacto');
  const inverseMass=rig.effectiveInverseMass({body:'weapon',point,normal}),before=rig.pointVelocity({body:'weapon',point});
  rig.reactImpulse({body:'weapon',point,impulse:{x:0,y:.05}});
  const after=rig.pointVelocity({body:'weapon',point});
  assert.ok(inverseMass>0);assert.ok(Math.abs(after.y-before.y-inverseMass*.05)<1e-8);
});

test('El contacto compartido de armas aplica impulso acotado simétrico y disipa energía',()=>{
  assert.equal(typeof implementation.resolveRigContact,'function','Falta resolver contacto compartido IA/humano');
  const a=create({dir:1,baseX:-1.53}),b=create({dir:-1,baseX:1.53}),point={x:0,y:1.84},normal={x:1,y:0};
  a.reactImpulse({body:'weapon',point,impulse:{x:.2,y:0}});b.reactImpulse({body:'weapon',point,impulse:{x:-.2,y:0}});
  const before=a.diagnostics().kineticEnergy+b.diagnostics().kineticEnergy;
  const contact=implementation.resolveRigContact(a,b,{point,normal,maxImpulse:.04,restitution:.1});
  assert.ok(contact.impulse>0&&contact.impulse<=.04);
  assert.ok(a.diagnostics().kineticEnergy+b.diagnostics().kineticEnergy<=before+1e-9);
  const A=a.diagnostics().lastImpulse.impulse,B=b.diagnostics().lastImpulse.impulse;
  assert.ok(Math.abs(A.x+B.x)<1e-12&&Math.abs(A.y+B.y)<1e-12);
});

test('El COM del agua se interpreta respecto de la cabeza física medida',()=>{
  const rig=create({gravity:-9.81}),physical=rig.pose(),intent=structuredClone(physical);
  intent.head.x+=.3;
  rig.setIntent(intent,{waterLoad:{mass:1,center:{x:physical.head.x+.2,y:physical.head.y},referenceHead:physical.head}});
  const localAngle=physical.angles.neck-Math.PI/2,offset=rig.diagnostics().waterLoad.offset;
  assert.ok(Math.abs(offset.x-.2*Math.cos(localAngle))<1e-8);
  assert.ok(Math.abs(offset.y+.2*Math.sin(localAngle))<1e-8);
});

test('El cruce de dos hojas movidas por intención genera una reacción mecánica positiva',()=>{
  const a=create({dir:1,baseX:-1.53}),b=create({dir:-1,baseX:1.53});
  for(const r of [a,b]){
    const p=r.pose();p.mainElbow.x+=r.dir*.04;p.mainElbow.y+=.03;p.mainHand.x+=r.dir*.14;p.mainHand.y+=.10;p.tip.x+=r.dir*.14;p.tip.y+=.30;
    r.setIntent(p,{baseX:r.intentBase});r.step(1/120);
  }
  const A=a.pose(),B=b.pose(),u={x:A.tip.x-A.mainHand.x,y:A.tip.y-A.mainHand.y},v={x:B.tip.x-B.mainHand.x,y:B.tip.y-B.mainHand.y};
  const delta={x:B.mainHand.x-A.mainHand.x,y:B.mainHand.y-A.mainHand.y},cross=(p,q)=>p.x*q.y-p.y*q.x;
  const denominator=cross(u,v),t=cross(delta,v)/denominator,s=cross(delta,u)/denominator;
  assert.ok(t>0&&t<1&&s>0&&s<1,'El fixture debe producir un cruce interior de ambas hojas');
  const point={x:A.mainHand.x+u.x*t,y:A.mainHand.y+u.y*t},normal={x:-u.y,y:u.x};
  if(normal.x*delta.x+normal.y*delta.y<0){normal.x=-normal.x;normal.y=-normal.y;}
  const before=a.pointVelocity({body:'weapon',point}),contact=implementation.resolveRigContact(a,b,{point,normal});
  assert.ok(contact.impulse>0);assert.ok(contact.closingSpeed>0);
  const afterA=a.pointVelocity({body:'weapon',point}),afterB=b.pointVelocity({body:'weapon',point});
  const closingAfter=-((afterB.x-afterA.x)*contact.normal.x+(afterB.y-afterA.y)*contact.normal.y);
  assert.ok(closingAfter<-contact.closingSpeed*.09,'La restitución .1 debe cambiar cierre por separación');
  assert.ok(dist(before,afterA)>1e-6,'La hoja debe desviarse, no emitir sólo una señal estética');
});

test('El impulso directo limita la magnitud y la normal extrema no introduce NaN',()=>{
  const rig=create(),point=rig.pose().tip;
  rig.reactImpulse({body:'weapon',point,impulse:{x:50,y:50}});
  const applied=rig.diagnostics().lastImpulse.impulse;
  assert.ok(Math.hypot(applied.x,applied.y)<=5+1e-12);
  assert.ok(Number.isFinite(rig.effectiveInverseMass({body:'weapon',point,normal:{x:1e308,y:1e308}})));
});

test('El control de equilibrio sostiene cabeza pesada durante intención sostenida sin caer a topes',()=>{
  for(const [dir,scale,lean] of [[1,1,0],[-1,1,.35],[-1,1.18,.35]]){
    const rig=create({dir,scale,gravity:-9.81}),intent=rig.pose(),angle=-dir*lean,c=Math.cos(angle),s=Math.sin(angle);
    for(const key of ['shoulder','head','mainShoulder','mainElbow','mainHand','offShoulder','offElbow','offHand','tip']){
      const x=intent[key].x-intent.hip.x,y=intent[key].y-intent.hip.y;intent[key].x=intent.hip.x+c*x-s*y;intent[key].y=intent.hip.y+s*x+c*y;
    }
    for(let i=0;i<1200;i++){
      const head=rig.pose().head;
      rig.setIntent(intent,{waterLoad:{mass:1.77642*scale**3,center:{x:head.x,y:head.y-.08*scale},referenceHead:head}});rig.step(1/120);
    }
    const d=rig.diagnostics(),p=rig.pose();
    assert.ok(p.head.y>intent.head.y-.2*scale,`La cabeza cargada colapsó: ${p.head.y}`);
    assert.ok(Math.abs(d.coordinates[2].position)<.25,'Pelvis no debe apoyarse en el tope para sostener intención ordinaria');
    assert.ok(Math.abs(d.coordinates[3].position)<.65,'El tronco debe conservar control bajo su carga legal');
    assert.ok(Math.abs(d.coordinates[12].position)<.25,'El cuello no cae a su tope por la carga estable');
  }
});

test('La intención de muñeca no teletransporta la hoja y su motor actúa dentro de los topes',()=>{
  const rig=create(),before=rig.pose(),intent=structuredClone(before);
  const angle=Math.atan2(intent.tip.y-intent.mainHand.y,intent.tip.x-intent.mainHand.x)+Math.PI/4;
  intent.tip.x=intent.mainHand.x+Math.cos(angle)*1.02;intent.tip.y=intent.mainHand.y+Math.sin(angle)*1.02;
  rig.setIntent(intent);
  assert.ok(dist(before.tip,rig.pose().tip)<1e-10,'setIntent no debe cambiar el estado físico del arma');
  const d=rig.diagnostics();assert.ok(d.coordinates.some(q=>q.name==='wrist'),'La muñeca necesita estado propio e inercia');
  run(rig,.6);
  const after=rig.pose(),wrist=rig.diagnostics().coordinates.find(q=>q.name==='wrist');
  assert.ok(dist(after.tip,before.tip)>.25);
  assert.ok(wrist.position<=Math.PI/4&&wrist.position>=-Math.PI/4);
  assert.ok(Math.abs(wrist.position-wrist.target)<.08);
});

test('Los actuadores sostienen una intención alta contra el peso seco sin borrar la carga del agua',()=>{
  const rig=create({gravity:-9.81}),intent=rig.pose(),origin=intent.mainShoulder,c=Math.cos(.35),s=Math.sin(.35);
  for(const key of ['mainElbow','mainHand','tip']){const x=intent[key].x-origin.x,y=intent[key].y-origin.y;intent[key].x=origin.x+c*x-s*y;intent[key].y=origin.y+s*x+c*y;}
  rig.setIntent(intent);run(rig,2);
  const actual=rig.pose(),desiredAngle=Math.atan2(intent.tip.y-intent.mainHand.y,intent.tip.x-intent.mainHand.x);
  assert.ok(dist(actual.mainHand,intent.mainHand)<.08,'La mano no debe sostenerse varios decímetros por debajo de la orden');
  assert.ok(Math.abs(actual.angles.weapon-desiredAngle)<.08,'La orientación de la hoja debe sostener la intención sin caída seca acumulada');
});

test('El equilibrio activo acota amplificación de lean bajo carga legal sin cancelar momento del agua',()=>{
  const rig=create({gravity:-9.81}),intent=rig.pose(),angle=-.35,c=Math.cos(angle),s=Math.sin(angle);
  for(const key of ['shoulder','head','mainShoulder','mainElbow','mainHand','offShoulder','offElbow','offHand','tip']){
    const x=intent[key].x-intent.hip.x,y=intent[key].y-intent.hip.y;intent[key].x=intent.hip.x+c*x-s*y;intent[key].y=intent.hip.y+s*x+c*y;
  }
  for(let i=0;i<480;i++){const head=rig.pose().head;rig.setIntent(intent,{waterLoad:{mass:1.77642,center:{x:head.x,y:head.y-.08},referenceHead:head}});rig.step(1/120);}
  const actual=rig.pose(),desired=Math.atan2(intent.shoulder.y-intent.hip.y,intent.shoulder.x-intent.hip.x);
  assert.ok(Math.abs(actual.angles.torso-desired)<.08,'La serie pelvis/tronco no debe amplificar la inclinación de intención hasta interpenetrar cabezas');
});
