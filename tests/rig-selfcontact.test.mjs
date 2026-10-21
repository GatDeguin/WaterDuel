import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';

const run=(rig,n=120)=>{for(let i=0;i<n;i++)rig.step(1/120);};
const panel=(a,b,width)=>{
  const l=Math.hypot(b.x-a.x,b.y-a.y),x=-(b.y-a.y)/l*width/2,y=(b.x-a.x)/l*width/2;
  return [{x:a.x+x,y:a.y+y},{x:a.x-x,y:a.y-y},{x:b.x-x,y:b.y-y},{x:b.x+x,y:b.y+y}];
};
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
// Sutherland–Hodgman area, independent of production's separating-axis contacts.
const overlapArea=(subject,clip)=>{
  let result=subject;
  for(let i=0;i<clip.length;i++){
    const a=clip[i],b=clip[(i+1)%clip.length],source=result;result=[];
    for(let k=0;k<source.length;k++){
      const p=source[k],q=source[(k+1)%source.length],cp=cross(a,b,p),cq=cross(a,b,q);
      if(cp>=0)result.push(p);
      if((cp>=0)!==(cq>=0)){const t=cp/(cp-cq);result.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});}
    }
  }
  return Math.abs(result.reduce((sum,p,i)=>{const q=result[(i+1)%result.length];return sum+p.x*q.y-p.y*q.x;},0))/2;
};
const forearmChestArea=(rig,side='main')=>{
  const p=rig.pose(),dx=p.shoulder.x-p.hip.x,dy=p.shoulder.y-p.hip.y,l=Math.hypot(dx,dy);
  const a={x:p.hip.x+dx*.28,y:p.hip.y+dy*.28},b={x:p.shoulder.x-dx/l*.12,y:p.shoulder.y-dy/l*.12};
  return overlapArea(panel(p[`${side}Elbow`],p[`${side}Hand`],.17),panel(a,b,side==='main'?.35:.32));
};
const folded=(dir=1,wrist=0)=>{
  const rig=new ArticulatedRig({dir,gravity:0});
  rig.q[4]=1.15;rig.q[5]=2.7;rig.q[13]=wrist;rig.target.set(rig.q);
  return rig;
};

// Mutation caught: removing the unilateral contact solve lets this legal folded
// forearm remain inside the chest forever, even with perfectly anchored feet.
test('El antebrazo plegado sale del panel de pecho sin estirar piezas ni deslizar apoyos',()=>{
  for(const dir of [1,-1]){
    const rig=folded(dir);assert.ok(forearmChestArea(rig)>.01,'Fixture contiene penetración real de madera');
    run(rig);
    assert.ok(forearmChestArea(rig)<.00005,`Área interpenetrada ${forearmChestArea(rig)}`);
    const p=rig.pose();assert.ok(Math.abs(Math.hypot(p.mainHand.x-p.mainElbow.x,p.mainHand.y-p.mainElbow.y)-.52)<1e-10);
    assert.ok(rig.diagnostics().contacts.every(c=>c.error<.0002));
  }
});

test('Los antebrazos que se cruzan en XY conservan libertad porque su madera ocupa capas z separadas',()=>{
  const rig=new ArticulatedRig({gravity:0});
  // The wider v2 shoulder sockets need a different crossing pose. Both
  // forearms intersect in XY, while all other rigid panels stay separated.
  rig.q[4]=-2.8;rig.q[5]=2.6;rig.q[6]=-1.5;rig.q[7]=-.8;rig.q[13]=-.785;rig.target.set(rig.q);
  const p=rig.pose(),initial=rig.q.slice();
  assert.ok(overlapArea(panel(p.mainElbow,p.mainHand,.17),panel(p.offElbow,p.offHand,.17))>.005,'El fixture debe cruzar ambos prismas en proyección');
  run(rig,30);
  assert.ok(rig.q.every((q,i)=>Math.abs(q-initial[i])<1e-10),'No se debe empujar una capa que está físicamente separada');
});

test('El volumen compartido de los enlaces vecinos permanece libre dentro de su bisagra',()=>{
  const rig=new ArticulatedRig({gravity:0});rig.q[4]=-1.8;rig.q[5]=2.7;rig.target.set(rig.q);
  const p=rig.pose(),initial=rig.q.slice();
  assert.ok(overlapArea(panel(p.mainShoulder,p.mainElbow,.21),panel(p.mainElbow,p.mainHand,.17))>.01);
  run(rig,30);
  assert.ok(rig.q.every((q,i)=>Math.abs(q-initial[i])<1e-10),'Las piezas vecinas necesitan su exclusión de pivote');
});

test('El diagnóstico de autocontacto mide la penetración y la velocidad normal del contacto real',()=>{
  const rig=folded(),before=rig.diagnostics();
  assert.ok(Array.isArray(before.selfContacts),'El panel de depuración debe exponer contactos físicos');
  const contact=before.selfContacts.find(c=>c.keyA==='chest-front'&&c.b==='mainForearm');
  assert.ok(contact?.penetration>.05,'La profundidad debe proceder de las piezas que realmente colisionan');
  assert.equal(contact.normalVelocity,0);
  run(rig);
  assert.ok(rig.diagnostics().maxSelfPenetration<.001,'El diagnóstico no debe seguir mostrando madera atravesada');
});

test('La velocidad del contacto coincide con la derivada geométrica cuando el pecho también rota',()=>{
  const rig=folded();rig.velocity[3]=.2;rig.velocity[4]=.4;rig.velocity[5]=-.3;
  const before=rig.diagnostics().selfContacts.find(c=>c.keyA==='chest-front'&&c.b==='mainForearm'),epsilon=1e-7;
  for(let i=0;i<rig.q.length;i++)rig.q[i]+=rig.velocity[i]*epsilon;
  const after=rig.diagnostics().selfContacts.find(c=>c.keyA==='chest-front'&&c.b==='mainForearm');
  const measured=-(after.penetration-before.penetration)/epsilon;
  assert.ok(Math.abs(measured-before.normalVelocity)<1e-6,`Derivada geométrica ${measured}, Jacobiana ${before.normalVelocity}`);
});

test('El autocontacto disipa el impulso que cierra y deja libre el impulso que separa',()=>{
  for(const sign of [-1,1]){
    // Isolate the forearm/chest impulse. At wrist=0 the longer v2 leg also
    // touches the blade; that original multi-contact fixture remains above in
    // the penetration, support and diagnostic tests, with the same thresholds.
    const rig=folded(1,Math.PI/4);run(rig,300);rig.target.set(rig.q);rig.velocity.fill(0);
    const c=rig.diagnostics().selfContacts.find(c=>c.keyA==='chest-front'&&c.b==='mainForearm');
    rig.reactImpulse({body:c.b,point:c.pointB,impulse:{x:c.normal.x*.08*sign,y:c.normal.y*.08*sign}});
    const before=rig.diagnostics();
    assert.equal(Math.sign(before.selfContacts[0].normalVelocity),sign);
    rig.step(1/120);const after=rig.diagnostics();
    assert.ok(after.kineticEnergy<=before.kineticEnergy+1e-9,'La restricción unilateral no debe añadir restitución artificial');
    assert.ok(after.selfContacts.every(c=>c.normalVelocity>=-1e-7));
    assert.ok(after.contacts.every(c=>c.error<.0002));
    if(sign<0)assert.ok(after.selfContactImpulse>.001,'El cierre debe producir impulso mecánico medido');
    else assert.equal(after.selfContactImpulse,0,'Una pieza que sale no debe adherirse al torso');
  }
});

test('La resolución del autocontacto conserva simetría y reloj fijo a 30 y 120 Hz',()=>{
  const left=folded(1),right=folded(-1),slow=folded(1);
  for(let i=0;i<120;i++){left.step(1/120);right.step(1/120);if(i%4===0)slow.step(1/30);}
  for(let i=0;i<left.q.length;i++){
    assert.ok(Math.abs(left.q[i]-slow.q[i])<1e-10);assert.ok(Math.abs(left.velocity[i]-slow.velocity[i])<1e-10);
  }
  for(const key of ['hip','shoulder','mainElbow','mainHand','tip','footF','footB']){
    const a=left.pose()[key],b=right.pose()[key];assert.ok(Math.abs(a.x+b.x)<1e-9&&Math.abs(a.y-b.y)<1e-9,`${key} pierde simetría`);
  }
});

test('El antebrazo defensivo también encuentra el panel posterior en su capa de profundidad',()=>{
  for(const dir of [1,-1]){
    const rig=new ArticulatedRig({dir,gravity:0});rig.q[6]=-1.42;rig.q[7]=-2.75;rig.target.set(rig.q);
    assert.ok(forearmChestArea(rig,'off')>.01);
    assert.ok(rig.diagnostics().selfContacts.some(c=>c.keyA==='chest-back'&&c.b==='offForearm'));
    run(rig);
    assert.ok(forearmChestArea(rig,'off')<.00005);
    assert.ok(rig.diagnostics().contacts.every(c=>c.error<.0002));
  }
});
