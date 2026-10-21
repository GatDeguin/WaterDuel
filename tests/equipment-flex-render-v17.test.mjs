import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticulatedRig} from '../public/physics/articulated-rig.js';
import {equipmentTransform,deformEquipmentPoint} from '../public/rendering/asset-rig.js';
import {drawWeapon} from '../public/rendering/equipment.js';
import {WEAPONS} from '../public/equipment.js';

const transform=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
const near=(a,b,epsilon=2e-6)=>assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<epsilon,`${a} != ${b}`);
const palette={wood:0xa16c42,edge:0x78502f,light:0xc99e67,metal:0xd4af63,steel:0xa9b9b7,leather:0x62442f,dark:0x106a62};
function bent(id,dir,offset){
  const rig=new ArticulatedRig({gravity:0,dir,flexibleWeapons:true});
  rig.setIntent({...rig.pose(),equipment:{weapon:id,defense:'none'}},{baseX:dir===1?-1.53:1.53});
  rig.weaponFlex.offset=offset;const pose=rig.pose();
  return {dir,equipment:{weapon:id,defense:'none'},pose};
}

test('la punta visible de la hoja curva coincide con la punta física para ambos signos y lados',()=>{
  for(const id of ['sword','spear'])for(const dir of [1,-1])for(const bend of [-.02,.02]){
    const f=bent(id,dir,bend),t=equipmentTransform(f,id),p=f.pose;
    assert.equal(t.flexOffset,bend);assert.equal(t.flexDirection,dir);assert.equal(t.flexLength,p.weaponFlex.length);
    near(transform(t.matrix,deformEquipmentPoint([0,WEAPONS[id].length,0],t)),[p.tip.x,p.tip.y,p.tip.z]);
    near(transform(t.matrix,[0,0,0]),[p.mainHand.x,p.mainHand.y,p.mainHand.z]);
    near(deformEquipmentPoint([.03,-.12,.01],t),[.03,-.12,.01]);
    const root=p.weaponRootDirection;near([t.matrix[4],t.matrix[5],t.matrix[6]],[root.x,root.y,root.z]);
  }
});

test('el respaldo procedural no conserva una hoja recta debajo de la curva y termina en la punta física',()=>{
  const f=bent('sword',1,.025),calls=[],renderer={draw:(shape,m,color,material)=>calls.push({shape,m:Array.from(m),material})};
  drawWeapon(renderer,f,palette);
  const blades=calls.filter(c=>c.material===16&&['box','rapierBlade'].includes(c.shape));
  assert.ok(blades.length>=4,'el contorno de respaldo sigue segmentos de la curva');
  const tip=f.pose.tip,last=blades.at(-1);near(transform(last.m,[0,.5,0]),[tip.x,tip.y,tip.z]);
  const directions=blades.map(c=>Math.atan2(c.m[5],c.m[4]));assert.ok(Math.max(...directions)-Math.min(...directions)>.01);
});
