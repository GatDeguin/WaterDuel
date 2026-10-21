import test from 'node:test';
import assert from 'node:assert/strict';
import {DuelEngine,STEP} from '../public/engine.js';
import {TABLE_TOP,BALLOON_RADII} from '../public/physics/dimensions.js';
import fs from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms} from '../public/rendering/asset-rig.js';
import {segmentEllipsoidContact} from '../public/physics/head-contact.js';

const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const xyz=p=>[p.x,p.y,p.z??0],point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
async function character(){const b=await fs.readFile(new URL('../public/assets/characters/water-mannequin/v2/water-mannequin-amber.glb',import.meta.url));return prepareCharacter(parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));}
function woodHits(c,f,attacker){
  const matrices=characterTransforms(c,f),hand=xyz(attacker.pose.mainHand),tip=xyz(attacker.pose.tip),length=Math.hypot(...sub(tip,hand)),a=hand.map((v,i)=>v+(tip[i]-v)*(.15/length)),d=sub(tip,a),hits=[];
  for(let i=0;i<c.parts.length;i++){
    const p=c.parts[i];if(!/Wood/i.test(`${p.nodeName} ${p.material?.name??''}`))continue;
    const vertex=index=>point(matrices[i],p.positions.subarray(index*3,index*3+3));
    for(let j=0;j<p.indices.length;j+=3){
      const v0=vertex(p.indices[j]),e1=sub(vertex(p.indices[j+1]),v0),e2=sub(vertex(p.indices[j+2]),v0),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-10)continue;
      const s=sub(a,v0),u=dot(s,h)/det;if(u<0||u>1)continue;const q=cross(s,e1),v=dot(d,q)/det;if(v<0||u+v>1)continue;
      const t=dot(e2,q)/det;if(t>=0&&t<=1)hits.push({bone:p.boneName,t});
    }
  }return hits;
}

function start(g){g.setMode('versus');g.start();for(let i=0;i<81;i++)g.update(.04);assert.equal(g.phase,'fight');}
function stable(f){const d=f.rig.diagnostics();assert.ok(d.contacts.every(c=>c.error<.0002));assert.ok(d.coordinates.every(q=>Number.isFinite(q.position)&&q.position>=q.min-1e-8&&q.position<=q.max+1e-8));}

test('Los globos intactos no se interpenetran y el caso original conserva su pinchazo temprano',()=>{
  const bursts=[],g=new DuelEngine((type,data)=>{if(type==='burst')bursts.push(data);});start(g);let minimum=Infinity;
  for(let step=0;step<300;step++){
    g.setControl(1,{lean:1,headX:1});g.setControl(2,{lean:1,headX:-1});g.update(STEP);
    const [a,b]=g.fighters,p=a.pose.head,q=b.pose.head,s=a.balloonSize+b.balloonSize;
    const normalized=Math.hypot((p.x-q.x)/(BALLOON_RADII.x*s),(p.y-q.y)/(BALLOON_RADII.y*s),(p.z-q.z)/(BALLOON_RADII.z*s));
    if(a.globIntact&&b.globIntact)minimum=Math.min(minimum,normalized);for(const f of g.fighters)stable(f);
  }
  assert.ok(minimum>=1-1e-5,`minimum ${minimum}`);
  // A bare tip may now puncture without an attack pulse. Head separation must
  // still hold; only measured latex contacts may account for the score.
  const expected=[0,0];for(const burst of bursts){assert.equal(burst.contact,true);if(burst.winner)expected[burst.winner-1]++;}
  assert.ok(bursts.some(b=>b.contact===true),'el fixture original conserva la perforación temprana de punta libre');assert.deepEqual(g.scores,expected);
});

test('Dos humanos con armas bajas acercan sus globos vivos sin solaparlos ni perforarse',()=>{
  const g=new DuelEngine();g.setLoadout(1,{defense:'none'});g.setLoadout(2,{defense:'none'});start(g);
  let minimum=Infinity;
  for(let tick=0;tick<390;tick++){
    const lean=tick<90?0:1;
    g.setControl(1,{mainX:-1,mainY:-1,wrist:-1,lean,headX:lean});
    g.setControl(2,{mainX:-1,mainY:-1,wrist:-1,lean,headX:-lean});g.update(STEP);
    const [a,b]=g.fighters;assert.ok(a.globIntact&&b.globIntact,'la preparación y el acercamiento mantienen ambos globos vivos');
    const p=a.pose.head,q=b.pose.head,s=a.balloonSize+b.balloonSize;
    minimum=Math.min(minimum,Math.hypot((p.x-q.x)/(BALLOON_RADII.x*s),(p.y-q.y)/(BALLOON_RADII.y*s),(p.z-q.z)/(BALLOON_RADII.z*s)));
    for(const f of g.fighters)stable(f);
  }
  assert.ok(minimum>=1-1e-5,`minimum ${minimum}`);assert.ok(minimum<1.15,`el control debe ejercitar cercanía real: ${minimum}`);assert.deepEqual(g.scores,[0,0]);
});

test('La lanza activa encuentra la mesa en ambos slots conservando apoyos',()=>{
  for(const slot of [1,2]){
    const g=new DuelEngine();g.setLoadout(slot,{weapon:'spear',defense:'none'});g.setLoadout(3-slot,{defense:'none'});start(g);
    let minimum=Infinity;
    for(let i=0;i<180;i++){
      g.setControl(slot,{mainX:1,mainY:-1,wrist:-1,attackHeld:true});g.setControl(3-slot,{mainX:-1,mainY:-1});g.update(STEP);
      const f=g.fighters[slot-1];minimum=Math.min(minimum,f.pose.tip.y);stable(f);
    }
    assert.ok(minimum>=TABLE_TOP-1e-5,`slot ${slot} min ${minimum}`);
  }
});

test('La madera rival detiene la hoja real del GLB; sólo un pinchazo posterior libre puede otorgar victoria',async()=>{
  const c=await character(),events=[];let g;
  g=new DuelEngine((type,data)=>{
    const event={type,data};events.push(event);
    if(type==='material-contact')event.scores=[...g.scores];
    if(type==='burst'){
      const def=g.fighters[data.loser-1],atk=g.fighters[data.winner-1];
      event.wood=woodHits(c,def,atk);event.block=def.rig.firstTimberContact(atk.previousTip,atk.pose.tip);
      event.head=segmentEllipsoidContact(atk.previousTip,atk.pose.tip,def.pose.head,Object.fromEntries(Object.entries(BALLOON_RADII).map(([key,radius])=>[key,(radius+.006)*def.balloonSize])),{previousCenter:def.previousHead});
    }
  });g.setLoadout(2,{defense:'none'});start(g);
  for(let i=0;i<80;i++){
    g.setControl(1,{lean:1,mainX:1,mainY:-.5,attackHeld:true});g.setControl(2,{lean:1,mainX:-1,mainY:-1});g.update(STEP);
    for(const contact of g.lastBodyContacts??[])assert.ok(contact.penetration<.001,`tick${i+1} ${contact.bodyA}/${contact.bodyB} ${contact.penetration}`);
    if(i%20===19)assert.deepEqual(woodHits(c,g.fighters[1],g.fighters[0]),[],`wood GLB at tick${i+1}`);
  }
  assert.ok(events.some(e=>e.type==='material-contact'&&e.data.material==='wood'&&e.data.impulse>0));
  assert.deepEqual(woodHits(c,g.fighters[1],g.fighters[0]),[],'original tick80 has no actual timber triangles across the blade');
  const scores=[0,0];for(const e of events){if(e.type==='burst'&&e.data.winner)scores[e.data.winner-1]++;if(e.type==='material-contact')assert.deepEqual(e.scores,scores,'wood feedback itself never changes score');}
  assert.deepEqual(g.scores,scores);
  for(const e of events.filter(e=>e.type==='burst')){assert.equal(e.data.contact,true);assert.deepEqual(e.wood,[],'the deflected blade reaches latex without crossing timber');assert.ok(e.head);assert.ok(!e.block||e.block.t>e.head.t);}
  assert.ok(Array.isArray(g.lastBodyContacts),'engine exposes measured contact diagnostics');
  for(const c of g.lastBodyContacts??[])assert.ok(c.penetration<.001,`${c.bodyA}/${c.bodyB} ${c.penetration}`);
  for(const f of g.fighters)stable(f);
});

test('La primera entrada en madera fina XYZ bloquea un headhit posterior del mismo punto material',()=>{
  const events=[],g=new DuelEngine((type,data)=>events.push({type,data}));g.setMode('versus');g.phase='fight';
  const [atk,def]=g.fighters,p=def.rig.collisionPanels().find(p=>p.key==='main-palm'),axis=p.axes[1],along=p.axes[0];
  const center={x:p.center.x+along.x*.065,y:p.center.y+along.y*.065,z:p.z};
  const from={x:center.x-axis.x*.5,y:center.y-axis.y*.5,z:center.z},to={x:center.x+axis.x*1.25,y:center.y+axis.y*1.25,z:center.z};
  const wood=def.rig.firstTimberContact(from,to);assert.ok(wood&&wood.key==='main-palm');assert.ok(wood.t>0&&wood.t<.4);
  assert.equal(def.rig.firstTimberContact({...from,z:10},{...to,z:10}),null,'XYZ slab rejects separated depth');
  // Analytic isolation fixture: the real rig/palm remains intact. Only the
  // head/strike proxy is positioned behind it to test classification priority.
  def.pose.head={x:center.x+axis.x*.85,y:center.y+axis.y*.85,z:center.z};def.previousHead={...def.pose.head};def.guard=false;
  atk.previousTip=from;atk.pose.mainHand={x:from.x-axis.x*.2,y:from.y-axis.y*.2,z:center.z};atk.pose.tip=to;atk.lunge=1;def.lunge=0;
  g.detectHits();assert.deepEqual(g.scores,[0,0]);assert.ok(!events.some(e=>e.type==='burst'));assert.equal(def.membrane.punctured,false);
});

test('El piso activo conserva extremos y cabezales de las cuatro armas con apoyos en ambos tamaños',()=>{
  for(const weapon of ['sword','spear','axe','maul'])for(const boss of [false,true])for(const dir of [-1,1]){
    // Component integration uses the real controller/intent/rig path, without
    // a rival puncturing first. Boss input here is a mechanism range fixture,
    // not a claim of mobile authority over the single-player AI.
    const g=new DuelEngine();if(boss)g.setDifficulty('boss');else g.setMode('versus');
    const f=g.fighters[boss?1:0];g.setLoadout(f.slot,{weapon,defense:'none'});f.dir=dir;g.initializeRig(f);g.phase='fight';
    g.setControl(f.slot,{mainX:1,mainY:-1,wrist:-1,attackHeld:true});let touched=false;
    for(let i=0;i<180;i++){
      g.updateFighter(f,STEP);const d=f.rig.diagnostics();
      assert.ok(d.minimumWeaponY>=TABLE_TOP-1e-5,`${weapon}/${boss}/${dir}/${i}: ${d.minimumWeaponY}`);
      touched ||=d.minimumWeaponY<TABLE_TOP+.0002;stable(f);
    }
    if(weapon==='spear')assert.ok(touched,'spear fixture must actually exercise the active floor constraint');
  }
});
