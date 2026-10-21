import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildPages} from '../scripts/build-pages.mjs';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'waterduel-pages-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const dir of ['public/assets/models','public/qa','.local'])await mkdir(path.join(root,dir),{recursive:true});
  await writeFile(path.join(root,'package.json'),JSON.stringify({version:'1.6.0'}));
  await writeFile(path.join(root,'public/mobile.html'),'<html data-mobile-game="true"><a href="./?view=desktop">desde la PC</a><script type="module" src="./game.js"></script></html>');
  await writeFile(path.join(root,'public/index.html'),'<script src="./entry.js"></script>');
  await writeFile(path.join(root,'public/controller.html'),'LAN controller');
  await writeFile(path.join(root,'public/game.js'),'export const ready=true;');
  await writeFile(path.join(root,'public/assets/models/fighter.glb'),Buffer.from([0,1,127,255]));
  await writeFile(path.join(root,'public/qa/probe.html'),'private QA');
  await writeFile(path.join(root,'.local/installation.json'),'private installation');
  return root;
}
test('Pages inicia el juego local en la raíz y conserva recursos binarios bajo una subcarpeta',async t=>{
  const root=await fixture(t),result=await buildPages({root});
  const html=await readFile(path.join(result.output,'index.html'),'utf8');
  assert.match(html,/data-mobile-game="true"/);assert.match(html,/src="\.\/game.js"/);
  assert.doesNotMatch(html,/entry\.js|view=desktop/);assert.match(html,/github\.com\/GatDeguin\/WaterDuel/);
  assert.equal(await readFile(path.join(result.output,'mobile.html'),'utf8'),html);
  assert.deepEqual(await readFile(path.join(result.output,'assets/models/fighter.glb')),Buffer.from([0,1,127,255]));
  assert.equal(new URL('./game.js','https://gatdeguin.github.io/WaterDuel/').pathname,'/WaterDuel/game.js');
  assert.equal(result.version,'1.6.0');assert.ok(result.files.includes('assets/models/fighter.glb'));
  assert.ok(!(await readdir(result.output)).some(name=>['qa','controller.html','.local'].includes(name)));
  assert.equal(await readFile(path.join(result.output,'.nojekyll'),'utf8'),'');
});
test('Reconstruir Pages elimina archivos obsoletos sólo dentro de su salida dedicada',async t=>{
  const root=await fixture(t),first=await buildPages({root});
  await writeFile(path.join(first.output,'stale.js'),'old');
  const second=await buildPages({root});
  assert.ok(!(await readdir(second.output)).includes('stale.js'));
  assert.equal(await readFile(path.join(root,'.local/installation.json'),'utf8'),'private installation');
});
test('El enlace LAN se adapta aunque cambie su texto visible',async t=>{
  const root=await fixture(t),source=path.join(root,'public/mobile.html');
  await writeFile(source,(await readFile(source,'utf8')).replace('desde la PC','en la computadora'));
  const {output}=await buildPages({root}),html=await readFile(path.join(output,'index.html'),'utf8');
  assert.doesNotMatch(html,/view=desktop/);
  assert.match(html,/href="https:\/\/github\.com\/GatDeguin\/WaterDuel#conectar-los-celulares"/);
});
test('Pages rechaza enlaces de salida y recursos enlazados antes de copiar',async t=>{
  const root=await fixture(t);
  await symlink(path.join(root,'.local'),path.join(root,'.runtime'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(buildPages({root}),/enlaces/i);
  assert.equal(await readFile(path.join(root,'.local/installation.json'),'utf8'),'private installation');
  await rm(path.join(root,'.runtime'));
  await symlink(path.join(root,'.local'),path.join(root,'public/assets/linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(buildPages({root}),/enlaces/i);
});
