import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DuelEngine,STEP} from '../public/engine.js';
import {WEAPONS} from '../public/equipment.js';
import {BALLOON_RADII} from '../public/physics/dimensions.js';
import {EQUIPMENT_MESHES,drawWeapon} from '../public/rendering/equipment.js';
import {equipmentTransform,prepareEquipment} from '../public/rendering/asset-rig.js';
import {parseGLB} from '../public/rendering/glb.js';
import {weaponActor} from '../public/physics/limb-state.js';
import {fragmentMatrix} from '../public/rendering/joint-damage.js';

const pal={wood:0,edge:0,light:0,metal:0,steel:0,leather:0};
const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const near=(a,b,e=2e-5)=>assert.ok(Math.hypot(...a.map((x,i)=>x-b[i]))<e,`${a} != ${b}`);
function pair(){
  const g=new DuelEngine();g.setMode('versus');g.setLoadout(1,{weapon:'axe',defense:'none'});g.setLoadout(2,{weapon:'axe',defense:'none'});
  for(const f of g.fighters){f.rig.q[13]=.60;f.pose=f.rig.pose();}
  return g;
}
test('the real imported axe presents a mirrored inward cutting edge for either fighter',async()=>{
  const bytes=await fs.readFile(new URL('../public/assets/equipment/workshop/v2/axe.glb',import.meta.url));
  const asset=prepareEquipment(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),'axe');
  const g=pair(),cut=[.3024,.8408,0],points=[];
  assert.ok(asset.parts.some(part=>Array.from(part.positions).some((x,i)=>i%3===0&&x>.30)),'test uses the delivered asymmetric blade');
  for(const f of g.fighters){
    const t=equipmentTransform(f,'axe'),p=point(t.matrix,cut),axis=point(t.matrix,[0,cut[1],0]);points.push(p);
    assert.ok(f.dir*(p[0]-axis[0])>.1,'the raised blade projects toward the rival, not its holder');
    near(point(t.matrix,[0,0,0]),[f.pose.mainHand.x,f.pose.mainHand.y,f.pose.mainHand.z]);
    near(point(t.matrix,[0,.92,0]),[f.pose.tip.x,f.pose.tip.y,f.pose.tip.z]);
    const determinant=t.matrix[0]*(t.matrix[5]*t.matrix[10]-t.matrix[6]*t.matrix[9])-t.matrix[4]*(t.matrix[1]*t.matrix[10]-t.matrix[2]*t.matrix[9])+t.matrix[8]*(t.matrix[1]*t.matrix[6]-t.matrix[2]*t.matrix[5]);
    assert.ok(determinant>0,'rolling the axe retains outward winding instead of mirroring triangles');
  }
  near([points[0][0],points[0][1]],[-points[1][0],points[1][1]]);
});
test('procedural blade and physical head bounds share the same inward face in both slots',()=>{
  const g=pair();
  for(const f of g.fighters){
    const calls=[];drawWeapon({draw:(shape,m)=>calls.push({shape,m})},f,pal);
    const head=calls.find(c=>c.shape==='axeHead'),p=point(head.m,[.56,.28,0]),axis=point(head.m,[0,.28,0]);
    assert.ok(f.dir*(p[0]-axis[0])>.1);
    const proxy=f.rig.collisionPanels().find(p=>p.key==='weapon-head'),dx=f.pose.tip.x-f.pose.mainHand.x,dy=f.pose.tip.y-f.pose.mainHand.y,l=Math.hypot(dx,dy),u={x:dx/l,y:dy/l};
    const centerline={x:f.pose.tip.x-u.x*WEAPONS.axe.headLength/2,y:f.pose.tip.y-u.y*WEAPONS.axe.headLength/2};
    assert.ok(f.dir*(proxy.center.x-centerline.x)>0,'collision steel uses the same rolled head');
    const mesh=EQUIPMENT_MESHES.axeHead;
    for(let i=0;i<mesh.p.length;i+=3){const v=point(head.m,mesh.p.slice(i,i+3));assert.ok(v[0]>=proxy.minX-.003&&v[0]<=proxy.maxX+.003&&v[1]>=proxy.minY-.003&&v[1]<=proxy.maxY+.003,'head collision bounds cover visible steel');}
  }
});
test('mirrored axe cutting-edge sweeps puncture the same physical balloon with the same material velocity',()=>{
  const section=Math.sqrt(1-((.17-.025)/(BALLOON_RADII.z+.006))**2),speeds=[];
  for(const slot of [1,2]){
    const hits=[],g=new DuelEngine((name,data)=>{if(name==='burst')hits.push(data);});g.setLoadout(slot,{weapon:'axe'});g.setLoadout(3-slot,{defense:'none'});g.phase='fight';
    const a=g.fighters[slot-1],b=g.fighters[2-slot],dir=a.dir;
    a.previousTip={x:0,y:.7,z:.17};a.previousWeaponDirection={x:dir*Math.cos(-.1),y:Math.sin(-.1)};
    a.pose={...a.pose,mainHand:{x:-dir*.92,y:.7,z:.17},tip:{x:0,y:.7,z:.17}};
    b.pose={...b.pose,head:{x:dir*.4128*section,y:.5488,z:.025}};b.previousHead={...b.pose.head};
    g.detectHits();assert.equal(hits.length,1,`slot ${slot} reaches its visible cutting edge`);assert.equal(hits[0].winner,slot);speeds.push(hits[0].relativeSpeed);
    assert.ok(Math.abs(hits[0].relativeSpeed-2*Math.hypot(.0072,.1512)*Math.sin(.05)/STEP)<1e-9);
  }
  assert.equal(speeds[0],speeds[1]);
});
test('a detached axe retains the corrected source cutting edge and its rotated physical compound',()=>{
  const g=pair(),f=g.fighters[1];f.rig.damageJoint('wrist',1);f.pose=f.rig.pose();
  const fragment=f.rig.fragments[0],source={...f,pose:fragment.sourcePose},t=equipmentTransform(source,'axe');
  const edge=point(t.matrix,[.3024,.8408,0]),actor=weaponActor(f);assert.ok(actor?.detachedAttack);
  const axis=point(t.matrix,[0,.8408,0]);assert.ok(source.dir*(edge[0]-axis[0])>0);
  const before=fragment.collisionPanels().find(p=>p.key==='weapon-head');fragment.angle+=.4;
  const after=fragment.collisionPanels().find(p=>p.key==='weapon-head');assert.notDeepEqual(after.vertices,before.vertices);
  const expected=fragment.worldPointAt({x:edge[0],y:edge[1],z:edge[2]},1),visible=point(fragmentMatrix(fragment.transform(),t.matrix),[.3024,.8408,0]);
  near(visible,[expected.x,expected.y,expected.z]);
  for(const axis of after.axes){
    const offset=(expected.x-after.center.x)*axis.x+(expected.y-after.center.y)*axis.y;
    const half=Math.max(...after.vertices.map(p=>Math.abs((p.x-after.center.x)*axis.x+(p.y-after.center.y)*axis.y)));
    assert.ok(Math.abs(offset)<=half+1e-6,'the falling visible cutting edge stays inside its rotated physical head');
  }
});
