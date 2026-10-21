import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseGLB} from '../public/rendering/glb.js';
import {prepareCharacter,characterTransforms} from '../public/rendering/asset-rig.js';
import {DuelEngine} from '../public/engine.js';
const api=await import('../public/rendering/combat-wear.js').catch(()=>null);
const I=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function fixture(){
  const positions=new Float32Array([-.2,-.2,.2,.2,-.2,.2,0,.2,.2]);
  const prepared={parts:[{boneName:'forearm.R',material:0,positions,indices:new Uint32Array([0,1,2])}],asset:{materials:[{pbrMetallicRoughness:{metallicFactor:0}}]}};
  const mark={id:1,body:'mainForearm',key:'mainForearm',position:{x:0,y:0,z:.18},normal:{x:0,y:0,z:1},tangent:{x:1,y:0,z:0},length:.1,impulse:.1,slideDistance:.03};
  const fighter={slot:1,dir:1,equipment:{weapon:'sword',defense:'none'},pose:{surface:{marks:[mark]},joints:{},mainElbow:{x:0,y:0,z:.1},mainHand:{x:.3,y:0,z:.17}}};
  return {fighter,prepared,matrices:[I()]};
}
test('Las marcas se proyectan al triángulo GLB y se agrupan sin mutar pose ni geometría',()=>{
  assert.ok(api,'falta dibujo de desgaste de combate');const {fighter,prepared,matrices}=fixture(),draws=[],before=JSON.stringify(fighter);
  const r={dynamicDraw:(...args)=>draws.push(args)};api.drawCombatWear(r,fighter,{geometry:{prepared,matrices}});
  assert.equal(draws.length,1);const mesh=draws[0][0];assert.ok(mesh.p.length>=9);assert.equal(mesh.p.length,mesh.n.length);
  for(let i=2;i<mesh.p.length;i+=3)assert.ok(Math.abs(mesh.p[i]-.20012)<1e-6,'la raya sigue la superficie real, no el proxy interior');
  assert.equal(JSON.stringify(fighter),before);assert.ok(mesh.p.every(Number.isFinite));assert.equal(draws[0][2],0);
  const old=mesh.p[0];matrices[0][12]=1;draws.length=0;api.drawCombatWear(r,fighter,{geometry:{prepared,matrices}});assert.ok(Math.abs(draws[0][0].p[0]-old-1)<1e-6);
});
test('El owner estable reutiliza el triángulo con snapshots nuevos y generation invalida una nueva ronda',()=>{
  assert.ok(api);const {fighter,prepared,matrices}=fixture(),owner={},generation={},draws=[];
  fighter.pose.surface.marks[0].anchor={local:{x:.2,y:0,z:0},normal:{x:0,y:0,z:1}};
  const part=prepared.parts[0],indices=part.indices;let reads=0;Object.defineProperty(part,'indices',{get(){reads++;return indices;}});
  const r={dynamicDraw:(...a)=>draws.push(a)};api.drawCombatWear(r,fighter,{owner,generation,geometry:{prepared,matrices}});assert.ok(reads>0);
  reads=0;const frame=structuredClone(fighter);api.drawCombatWear(r,frame,{owner,generation,geometry:{prepared,matrices}});assert.equal(reads,0,'no raycast por RAF aunque el fighter sea otro snapshot');
  api.drawCombatWear(r,frame,{owner,generation:{},geometry:{prepared,matrices}});assert.ok(reads>0,'una ronda nueva no hereda el ID1 de otra pelea');
});
test('Parche de winding inverso y fragmento rígido conserva el lado exterior y no comparte arrays',()=>{
  assert.ok(api);const {fighter,prepared,matrices}=fixture(),draws=[];prepared.parts[0].indices=new Uint32Array([0,2,1]);
  const delta=I();delta[12]=2;
  api.drawCombatWear({dynamicDraw:(...a)=>draws.push(a)},fighter,{geometry:{prepared,matrices},onlyBodies:new Set(['mainForearm']),transform:delta});
  assert.equal(draws.length,1);for(let i=2;i<draws[0][0].p.length;i+=3)assert.ok(Math.abs(draws[0][0].p[i]-.20012)<1e-6);
  assert.ok(draws[0][0].p[0]>1.9);const first=draws[0][0];draws.length=0;
  api.drawCombatWear({dynamicDraw:(...a)=>draws.push(a)},fighter,{geometry:{prepared,matrices}});assert.notEqual(draws[0][0].p,first.p);
});
test('Sobre el GLB v3 real sólo emite parches finitos proyectados y no cambia matrices ni física',async()=>{
  assert.ok(api);const bytes=await fs.readFile(new URL('../public/assets/characters/water-mannequin/v3/water-mannequin.glb',import.meta.url)),prepared=prepareCharacter(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))),game=new DuelEngine(),fighter=game.fighters[0],matrices=characterTransforms(prepared,fighter);
  const index=prepared.parts.findIndex(p=>p.boneName==='forearm.R'),part=prepared.parts[index],m=matrices[index],vertices=Array.from(part.indices.subarray(0,3),j=>[0,1,2].map(i=>m[i]*part.positions[j*3]+m[i+4]*part.positions[j*3+1]+m[i+8]*part.positions[j*3+2]+m[i+12]));
  const a=vertices[0],b=vertices[1],c=vertices[2],u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],norm=Math.hypot(...n);for(let i=0;i<3;i++)n[i]/=norm;
  const center=a.map((x,i)=>(x+b[i]+c[i])/3),p=center.map((x,i)=>x-n[i]*.002),before=matrices.map(m=>m.slice()),q=fighter.rig.q.slice();
  fighter.pose.surface={marks:[{id:1,body:'mainForearm',key:'mainForearm',position:{x:p[0],y:p[1],z:p[2]},normal:{x:n[0],y:n[1],z:n[2]},tangent:{x:u[0],y:u[1],z:u[2]},length:.012,impulse:.1}]};
  const draws=[],result=api.drawCombatWear({dynamicDraw:(...a)=>draws.push(a)},fighter,{geometry:{prepared,matrices}});
  assert.equal(result.marks,1);assert.ok(draws.length>=1&&draws.length<=3);for(const [mesh] of draws)assert.ok(mesh.p.every(Number.isFinite)&&mesh.n.every(Number.isFinite));
  assert.deepEqual(matrices,before);assert.deepEqual(fighter.rig.q,q);
});
test('Sin intersección fiable, sin impulso o en depthOnly no inventa una raya; recorta al triángulo',()=>{
  assert.ok(api);const {fighter,prepared,matrices}=fixture(),draws=[],r={dynamicDraw:(...a)=>draws.push(a)};
  api.drawCombatWear(r,fighter,{depthOnly:true,geometry:{prepared,matrices}});assert.equal(draws.length,0);
  fighter.pose.surface.marks[0].position.x=3;api.drawCombatWear(r,fighter,{geometry:{prepared,matrices}});assert.equal(draws.length,0);
  fighter.pose.surface.marks[0].id=2;fighter.pose.surface.marks[0].position.x=0;fighter.pose.surface.marks[0].impulse=0;api.drawCombatWear(r,fighter,{geometry:{prepared,matrices}});assert.equal(draws.length,0);
});
test('Grasa de bisagra es local y fina, agrupada aparte, nunca modifica la rugosidad global',()=>{
  assert.ok(api);const {fighter,prepared,matrices}=fixture(),draws=[];
  prepared.asset.materials[0].pbrMetallicRoughness.metallicFactor=1;fighter.pose.surface.marks=[];fighter.pose.joints={mainElbow:{damage:.6,detached:false}};
  api.drawCombatWear({dynamicDraw:(...a)=>draws.push(a)},fighter,{geometry:{prepared,matrices}});
  assert.equal(draws.length,1);assert.equal(draws[0][2],19);assert.ok(draws[0][0].p.length<=90);
  assert.ok(Array.from(draws[0][0].p).filter((_,i)=>i%3===0).every(v=>Math.abs(v)<.04));
});
test('Rayas opacas consumidas de inmediato reutilizan capacidad; la película pending conserva copia por cuadro',()=>{
  assert.ok(api);const {fighter,prepared,matrices}=fixture(),uploads=[],pending=[],owner={},renderer={flushDynamic:item=>uploads.push(item.mesh.p.buffer),dynamicDraw:(...a)=>pending.push(a)};
  api.drawCombatWear(renderer,fighter,{owner,geometry:{prepared,matrices}});api.drawCombatWear(renderer,structuredClone(fighter),{owner,geometry:{prepared,matrices}});
  assert.equal(uploads.length,2);assert.equal(uploads[0],uploads[1]);assert.equal(pending.length,0);
  prepared.asset.materials[0].pbrMetallicRoughness.metallicFactor=1;fighter.pose.surface.marks=[];fighter.pose.joints={};
  api.drawCombatWear(renderer,fighter,{owner,generation:1,geometry:{prepared,matrices}});api.drawCombatWear(renderer,structuredClone(fighter),{owner,generation:1,geometry:{prepared,matrices}});
  assert.equal(pending.length,2);assert.notEqual(pending[0][0].p.buffer,pending[1][0].p.buffer);assert.equal(pending[0][4],-.2);
});
