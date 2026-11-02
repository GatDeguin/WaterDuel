import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const OUTPUT='audit/ITEMS_SELECTED_2026-11-02_MANIFEST.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const assetDir='public/assets/equipment/workshop/v3/';
const migratedTest='tests/knife-defense-integration.test.mjs';
const archiveDir='audit/items-n16-test-migration-113/';
const archive={
 manifest:archiveDir+'ITEMS_SELECTED_2026-11-02_MANIFEST.before-n16.json',
 test:archiveDir+'knife-defense-integration.before.mjs.txt',
 guide:archiveDir+'ENTREGA_ITEMS_SELECCIONADOS.before-n16.md.txt',
 seal:archiveDir+'seal-selected-items.before-n16.mjs.txt',
 n16Test:archiveDir+'knife-defense-integration.n16-8of8.mjs.txt',
 n16Log:archiveDir+'knife-n16-migration-8of8.log.txt',
};
const historicalManifestSha='1e2e8598d79deb39f5883dda117d5dead956d52e39774410ddec7b4930b7b4e4';
const precisionDir='audit/items-knife-contract-113-revision3/';
const precision={manifest:precisionDir+'MANIFEST.before-revision3.json',
 guide:precisionDir+'ENTREGA_ITEMS_SELECCIONADOS.before-revision3.md.txt',
 seal:precisionDir+'seal-selected-items.before-revision3.mjs.txt',
 test:precisionDir+'knife-defense-integration.tested.mjs.txt',
 helper:precisionDir+'knife-socket-reference.tested.mjs.txt',
 staticTest:precisionDir+'knife-socket-reference-113.tested.mjs.txt',
 recipeClosure:precisionDir+'recipe-closure-summary.json',recipeResults:precisionDir+'recipe-final-results.json',
 receipt:precisionDir+'receipt.json',log:precisionDir+'functional-16of16.stdout.txt'};
const precisionTests=['tests/helpers/knife-socket-reference.mjs','tests/knife-socket-reference-113.test.mjs'];
const precisionGuide='docs/ENTREGA_ITEMS_CONTRATO_CPU_REV3_2026-11-02.md';
const runtime=['public/equipment.js','public/knife-technique.js','public/item-haptics.js','public/engine.js',
 'public/physics/articulated-rig.js','public/rendering/asset-rig.js','public/auto-defense.js','public/remote-menu.js',
 'public/controller.js','public/controller.html','public/mobile.html','public/game.js','public/mobile-session.js','server.mjs',
 'public/render3d.js','public/qa/equipment-selection.html'];
const tests=['tests/knife-technique.test.mjs','tests/knife-defense-integration.test.mjs','tests/item-knife-contract.test.mjs',
 'tests/item-haptics.test.mjs','tests/item-haptics-transport.test.mjs','tests/controller-menu.test.mjs','tests/controller.test.mjs',
 'tests/mobile-runtime.test.mjs','tests/host-runtime.test.mjs','tests/qa-equipment-selection.test.mjs'];
const docs=['docs/ENTREGA_ITEMS_SELECCIONADOS_2026-11-02.md','docs/superpowers/specs/2026-11-02-items-selected-design.md',
 'docs/superpowers/plans/2026-11-02-items-selected.md','scripts/seal-selected-items.mjs'];
const logs=['audit/TESTS_ITEMS_SELECTED_REGRESSION.txt','audit/TESTS_ITEMS_SELECTED_FOCAL.txt'];
const shared=new Set([...runtime,...tests].filter(file=>!['public/knife-technique.js','public/item-haptics.js','public/qa/equipment-selection.html',
 'tests/knife-technique.test.mjs','tests/item-knife-contract.test.mjs',
 'tests/item-haptics.test.mjs','tests/item-haptics-transport.test.mjs','tests/qa-equipment-selection.test.mjs'].includes(file)));
async function check(records){for(const r of records){const bytes=await readFile(path.join(ROOT,r.path??r.file));if(bytes.length!==r.bytes||sha(bytes)!==r.sha256)throw Error(`Hash mismatch: ${r.path??r.file}`);}}
async function historicalCut(){
 // The archive is created exclusively before the documentation migration.
 // This utility never writes it or derives replacement historical hashes.
 if(OUTPUT===archive.manifest)throw Error('Active output cannot overwrite historical receipt');
 const bytes=await readFile(path.join(ROOT,archive.manifest));
 if(bytes.length!==14414||sha(bytes)!==historicalManifestSha)throw Error('Historical manifest mismatch');
 const historic=JSON.parse(bytes),redirects=new Map([[migratedTest,archive.test],
  ['docs/ENTREGA_ITEMS_SELECCIONADOS_2026-11-02.md',archive.guide],['scripts/seal-selected-items.mjs',archive.seal]]);
 if(historic.files.length!==51)throw Error('Unexpected historical file count');
 await check(historic.files.map(file=>({...file,path:redirects.get(file.path)??file.path})));
 const originals=[...redirects].map(([originalPath,backupPath])=>{
  const original=historic.files.find(file=>file.path===originalPath);
  if(!original)throw Error(`Historical original missing: ${originalPath}`);
  return {originalPath,backupPath,bytes:original.bytes,sha256:original.sha256};
 });
 const original=await readFile(path.join(ROOT,archive.test),'utf8'),n16=await readFile(path.join(ROOT,archive.n16Test),'utf8');
 const assertions=text=>text.split(/\r?\n/).filter(line=>/\bassert\.|\bnear\(/.test(line)).map(line=>line.trim());
 if(!assertions(original).every(line=>assertions(n16).includes(line))||!n16.includes('const near=(a,b,tol=1e-7)')||!n16.includes('i<285'))
  throw Error('Archived N16 test changed an original assertion or threshold');
 const log=await readFile(path.join(ROOT,archive.n16Log),'utf8');
 const number=label=>Number(log.match(new RegExp('(?:ℹ|#)\\s*'+label+'\\s+(\\d+)'))?.[1]);
 if(number('tests')!==8||number('pass')!==8||number('fail')!==0||number('skipped')!==0)throw Error('Archived N16 evidence must be 8/8 without skips');
 return {manifest:{path:archive.manifest,bytes:bytes.length,sha256:historicalManifestSha},
  originalFilesVerified:51,directOriginalFiles:48,redirectedOriginals:originals,
  integrationMigration:{path:migratedTest,classification:'sharedReference',
   scope:'ARRANGE/control recipes migrated to real countdown and N16 by Principal; original assertions and thresholds retained.',
   originalTest:originals.find(file=>file.originalPath===migratedTest),
   testedSnapshot:{path:archive.n16Test,bytes:Buffer.byteLength(n16),sha256:sha(Buffer.from(n16))},
   evidence:{path:archive.n16Log,bytes:Buffer.byteLength(log),sha256:sha(Buffer.from(log)),
    producer:'Principal',command:'node --test tests/knife-defense-integration.test.mjs',tests:8,passed:8,failed:0,skipped:0},
   assertionsPreserved:true,socketTolerance:1e-7,fightTicks:285}};
}
async function previousRevision(){
 // Keep revision 2's original hashes. Only the two deliberately updated
 // teaching files are redirected; shared-reference hashes were observations.
 const bytes=await readFile(path.join(ROOT,precision.manifest));
 const expected='dc0d9782204b314cc0a8c6f789799525d8f2c93e379b8c8cc15b43776cea934c';
 if(bytes.length!==18427||sha(bytes)!==expected)throw Error('Revision 2 historical manifest mismatch');
 const old=JSON.parse(bytes),redirects=new Map([
  ['docs/ENTREGA_ITEMS_SELECCIONADOS_2026-11-02.md',precision.guide],['scripts/seal-selected-items.mjs',precision.seal]]);
 if(old.manifestRevision!==2||old.files.length!==56)throw Error('Unexpected revision 2 history');
 await check(old.files.map(r=>({...r,path:redirects.get(r.path)??r.path})));
 return {manifest:{path:precision.manifest,bytes:bytes.length,sha256:expected},originalFilesVerified:56,directOriginalFiles:54,
  redirectedOriginals:[...redirects].map(([originalPath,backupPath])=>({originalPath,backupPath,...Object.fromEntries(
   Object.entries(old.files.find(r=>r.path===originalPath)).filter(([key])=>key!=='path'))}))};
}
async function cpuPrecisionCut(){
 const bytes=await readFile(path.join(ROOT,precision.receipt));
 const expected='04521d02c15980dec3455a6543016f767b94a09b3a5ca17b30417fd8fe5351f6';
 if(bytes.length!==14240||sha(bytes)!==expected)throw Error('Revision 3 focal receipt mismatch');
 const r=JSON.parse(bytes),result=r.result;
 if(r.manifestRevision!==3||result.tests!==16||result.passed!==16||result.failed||result.skipped||result.cancelled||result.todo||result.exitCode)
  throw Error('Current focal evidence must be 16/16 without skips');
 await check([r.stdout,...r.snapshots,...r.recipeEvidence,...r.previousRevision]);
 const log=await readFile(path.join(ROOT,r.stdout.path),'utf8');
 const number=label=>Number(log.match(new RegExp('(?:ℹ|#)\\s*'+label+'\\s+([\\d.]+)'))?.[1]);
 if(number('tests')!==16||number('pass')!==16||number('fail')!==0||number('skipped')!==0||number('cancelled')!==0||number('todo')!==0||number('duration_ms')!==result.durationMs)
  throw Error('Current focal stdout disagrees with its receipt');
 const guard=JSON.parse(log.trim().split(/\r?\n/).at(-1)),records=r.sourceGuard.records;
 const map=Object.fromEntries(records.map(record=>[record.path,record.sha256]));
 if(records.length!==51||new Set(records.map(record=>record.path)).size!==51||
  JSON.stringify(Object.keys(map))!==JSON.stringify(Object.keys(map).sort())||
  guard.sourceFiles!==51||guard.drift.length||guard.beforeDigest!==guard.afterDigest||
  sha(Buffer.from(JSON.stringify(map)))!==guard.beforeDigest||
  r.sourceGuard.beforeDigest!==guard.beforeDigest||r.sourceGuard.afterDigest!==guard.afterDigest||r.sourceGuard.drift.length||
  guard.engineBefore!==map['public/engine.js']||guard.engineAfter!==map['public/engine.js'])throw Error('Focal source hash guard mismatch');
 const old=await readFile(path.join(ROOT,archive.n16Test),'utf8'),current=await readFile(path.join(ROOT,precision.test),'utf8');
 const originalA="{slot:1,grip:'reverse',aim:.2,",originalB="{slot:2,grip:'reverse',aim:.2,";
 const changedA="{slot:1,grip:'reverse',aim:0,",changedB="{slot:2,grip:'reverse',aim:-.4,";
 if(!current.includes(changedA)||!current.includes(changedB))throw Error('Missing qualified reverse recipes');
 const normalized=current.replace(changedA,originalA).replace(changedB,originalB);
 const outsideSocket=text=>{
  const start=text.indexOf("test('Los sockets de daga GLB v2 y v3 coinciden con la punta física en ambos agarres y jugadores'");
  const end=text.indexOf('\ntest(',start+1);
  if(start<0||end<0)throw Error('Socket migration block missing');
  return [text.slice(0,start),text.slice(end)];
 };
 if(JSON.stringify(outsideSocket(old))!==JSON.stringify(outsideSocket(normalized)))throw Error('Migration changed bytes outside socket block and two aims');
 for(const snapshot of r.snapshots){
  const source=records.find(record=>record.path===snapshot.originalPath);
  if(!source||source.sha256!==snapshot.sha256||source.bytes!==snapshot.bytes)throw Error('Test snapshot does not match the executed cut');
 }
 const closure=JSON.parse(await readFile(path.join(ROOT,precision.recipeClosure),'utf8'));
 if(closure.fileHashes['final-recipes-results.json']!==r.recipeEvidence.find(record=>record.path===precision.recipeResults)?.sha256)
  throw Error('Archived recipe results do not match their source closure');
 const liveDrift=[];
 for(const record of records){const data=await readFile(path.join(ROOT,record.path));if(sha(data)!==record.sha256||data.length!==record.bytes)liveDrift.push(record.path);}
 return {receipt:{path:precision.receipt,bytes:bytes.length,sha256:expected},command:r.command,result,
  precisionContract:r.precisionContract,migration:r.migration,snapshots:r.snapshots,
  stdout:r.stdout,recipeEvidence:r.recipeEvidence,sourceFiles:51,sourceMapDigest:guard.beforeDigest,
  testedEngine:map['public/engine.js'],testedRig:map['public/physics/articulated-rig.js'],liveSourceDrift:liveDrift,
  integrationClassification:'sharedReference; tested snapshot protected independently',
  scope:'Focal CPU virtual endpoint/matrix representation and physical knife integration, not GPU/global/visual validation.'};
}
const assets=JSON.parse(await readFile(path.join(ROOT,assetDir+'delivery-sha256.json'),'utf8'));
await check(assets.files);
const history=await historicalCut();
const previous=await previousRevision(),cpuContract=await cpuPrecisionCut();
if(process.argv.includes('--verify')){
 const receipt=JSON.parse(await readFile(path.join(ROOT,OUTPUT),'utf8'));await check(receipt.files);
 if(receipt.files.some(file=>file.path===migratedTest)||!receipt.sharedReferences.some(file=>file.path===migratedTest))throw Error('Migrated test must remain a shared reference');
 if(receipt.manifestRevision!==3||receipt.currentCpuContract?.receipt.sha256!==cpuContract.receipt.sha256||
  precisionTests.some(file=>!receipt.files.some(record=>record.path===file)))throw Error('Revision 3 curated precision records missing');
 console.log(JSON.stringify({ok:true,files:receipt.files.length,assetFiles:assets.files.length,
  historicalOriginalFiles:history.originalFilesVerified,historicalDirectFiles:48,historicalBackupFiles:3,
  revision2OriginalFiles:previous.originalFilesVerified,revision2DirectFiles:54,revision2BackupFiles:2,
  n16Evidence:'8/8; earlier archived Principal run, not re-executed',
  currentCpuEvidence:'16/16; archived current focal run, not re-executed',currentSourceDrift:cpuContract.liveSourceDrift}));
}else{
 const proof=JSON.parse(await readFile(path.join(ROOT,assetDir+'validation.json'),'utf8'));
 if(!proof.passed||proof.assets.length!==7)throw Error('Asset validation must pass');
 const evidence=[];
 for(const file of logs){
  const text=await readFile(path.join(ROOT,file),'utf8');
  const count=Number(text.match(/(?:ℹ|#)\s*tests\s+(\d+)/)?.[1]),passed=Number(text.match(/(?:ℹ|#)\s*pass\s+(\d+)/)?.[1]),failed=Number(text.match(/(?:ℹ|#)\s*fail\s+(\d+)/)?.[1]);
  if(!count||passed!==count||failed!==0)throw Error(`Failed/incomplete test evidence: ${file}`);
  evidence.push({log:file,tests:count,passed,failed});
 }
 const names=new Set([...runtime,...tests,...docs,...logs,...Object.values(archive),...Object.values(precision),...precisionTests,precisionGuide,...assets.files.map(r=>r.path??r.file),assetDir+'delivery-sha256.json',assetDir+'validation.json']);
 const records=[],sharedReferences=[];
 for(const file of [...names].sort()){
  const bytes=await readFile(path.join(ROOT,file)),entry={path:file,bytes:bytes.length,sha256:sha(bytes)};
  if(file===migratedTest)entry.migration='Rev3 replaces only the socket block with 3 CPU precision gates and reverse aims 0/-.4; other bytes retained. Original/N16/current tested snapshots archived separately.';
  (shared.has(file)?sharedReferences:records).push(entry);
 }
 const receipt={manifestRevision:3,date:'2026-11-02',createdAt:new Date().toISOString(),selection:[26,27,34,36,37,44],
  status:'Original Items and N16 cuts preserved; new focal 16/16 CPU contract archived with stable source pins.',historicalCut:history,
  previousRevision:previous,currentCpuContract:cpuContract,
  localRuntime:'Equipment loader points to workshop/v3; optional reverse grip and measured contact haptics integrated.',
  publication:'Unchanged; controlled by Principal.',visualRuntimeQA:'Pending joint stable runtime window with Principal; GLB offline renders inspected.',
  physicalHandsetHaptics:'Not measured; policy and LAN/local transport verified.',
  evidence,evidenceScope:'206/206 and104/104 describe the original Items cut. The earlier N16 strict-socket run is separately archived 8/8. CurrentCpuContract is a new 16/16 focal CPU virtual-endpoint/matrix and physical integration run; it does not claim GPU, global or visual validation. Shared hashes are observations; executed artifacts have protected snapshots.',
  sharedReferences,assetValidation:{passed:7,baselinesPreserved:14,textureAdditions:0},
  verificationCommands:[
   'node --test tests/knife-technique.test.mjs tests/knife-defense-integration.test.mjs tests/item-knife-contract.test.mjs tests/item-haptics.test.mjs tests/item-haptics-transport.test.mjs tests/controller-menu.test.mjs tests/qa-equipment-selection.test.mjs',
   'node --test tests/knife-technique.test.mjs tests/knife-defense-integration.test.mjs tests/item-knife-contract.test.mjs tests/item-haptics.test.mjs tests/item-haptics-transport.test.mjs tests/controller-menu.test.mjs tests/qa-equipment-selection.test.mjs tests/auto-defense.test.mjs tests/remote-menu.test.mjs tests/mobile-session.test.mjs tests/mobile-runtime.test.mjs tests/controller.test.mjs tests/guard-mount.test.mjs tests/guard-contact-episodes.test.mjs tests/equipment.test.mjs tests/equipment-render.test.mjs tests/asset-rig.test.mjs tests/replay.test.mjs',
   'node --test --test-concurrency=1 tests/knife-defense-integration.test.mjs tests/knife-socket-reference-113.test.mjs',
   'node scripts/validate-equipment-craft-v3.mjs','node scripts/seal-selected-items.mjs --verify'],files:records};
 await writeFile(path.join(ROOT,OUTPUT),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({ok:true,manifest:OUTPUT,files:records.length,evidence}));
}
