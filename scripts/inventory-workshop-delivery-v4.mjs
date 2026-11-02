// Read the frozen v4 delivery; write only a separate promotion inventory.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url),dir='public/assets/environment/workshop/';
const json=async file=>JSON.parse(await readFile(new URL(file,root),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const contract=await json(dir+'asset-contract-v4.json');
const receipt=await json(dir+'export-receipt-v4.json');
const qa=await json(dir+'verification-v4.json');
const surround=await json(dir+'workshop-360-v4.json');
assert(contract.ready&&contract.stable&&receipt.ready&&qa.ok&&qa.readyForIntegration);
assert.equal(receipt.sha256,'9dafb0641072e9ec5e281e43aa0ad1282468fb21b84bfd0955d9166813f1afbe');
const sets={
 runtime:[
  'workshop-runtime-v4.glb','asset-contract-v4.json','features-v4.json','export-receipt-v4.json',
  'light-directions-v4.json','lighting-day-v4.json','lighting-night-v4.json',
  'reflection-v4.hdr','reflection-v4.json','workshop-360-v4.glb','workshop-360-v4.json',
 ].map(file=>dir+file),
 authoring:[
  'output/blender/WaterDuel_Atelier_v4.blend','output/blender/WaterDuel_Atelier_v4_noche.blend',
  'output/blender/WaterDuel_Workshop360_v4.blend',
 ],
 evidence:[
  ...['verification-v4.json','verification-360-v4.json','reimport-verification-v4.json','geometry-verification-v4.json',
   'geometric-reimport-v4.json','build-report-v4.json',
   'preview-glb-v4-eevee.png','preview-glb-v4-oblique.png','preview-v4-materials.png',
   'preview-v4-details.png','preview-v4-tools.png','preview-v4-copper.png','preview-v4-glass.png',
   'preview-v4-exterior.png','preview-v4-ceiling.png','preview-native-day-v4.png','preview-native-night-v4.png',
  ].map(file=>dir+file),
  'output/blender/verification-editable-v4.json','output/blender/preview-variants-v4.json',
  'output/blender/WaterDuel_Atelier_v4_dia.png','output/blender/WaterDuel_Atelier_v4_noche.png',
 ],
 documentation:[
  'docs/ENTREGA_ESCENOGRAFIA_RUNTIME_V4.md','output/blender/LEEME_v4.txt',
  'docs/superpowers/specs/2026-11-02-workshop-v4.md','docs/superpowers/plans/2026-11-02-workshop-v4.md',
 ],
 reproduction:[
  'create-workshop-v4.py','bake-export-workshop-v4.py','workshop-materials-v4.py','workshop-props-v4.py',
  'workshop-detail-wood-v4.py','render-variants-workshop-v4.py','verify-native-workshop-v4.py',
  'check-window-surface-v4.py','build-workshop-clearance-v4.mjs','prepare-workshop-features-v4.mjs',
  'verify-workshop-runtime-v4.mjs','reimport-workshop-runtime-v4.py','workshop-clearance-v4.py',
  'create-workshop-360-v4.py','verify-workshop-360-v4.mjs','mark-workshop-360-v4-ready.mjs',
  'mark-workshop-v4-ready.mjs','inventory-workshop-delivery-v4.mjs',
 ].map(file=>'scripts/'+file),
};
const files=Object.values(sets).flat();assert.equal(new Set(files).size,files.length);
const details=[];
for(const [role,paths] of Object.entries(sets))for(const path of paths){
 const bytes=await readFile(new URL(path,root));
 details.push({path,role,bytes:bytes.length,MiB:Number((bytes.length/1048576).toFixed(3)),sha256:hash(bytes)});
}
for(const editable of contract.validation.editables)
 assert.equal(details.find(file=>file.path===editable.path)?.sha256,editable.sha256);
assert.equal(details.find(file=>file.path===dir+surround.asset).sha256,surround.sha256);
assert.equal(details.find(file=>file.path===dir+receipt.file).sha256,receipt.sha256);
const inventory={schemaVersion:1,delivery:'WaterDuel escenografía v4',releaseDateLocal:'2026-11-02',
 snapshotOfValidatedRelease:receipt.validation.completedAt,root:'D:/2026/WaterDuel',
 surroundingsStableAt:surround.validation?.completedAt??null,
 mainAssetSha256:receipt.sha256,runtimeIntegrationVerified:false,
 contractStates:{main:{ready:contract.ready,stable:contract.stable},surround:{stable:surround.stable,verificationPassed:surround.verification.passed,runtimeIntegrationVerified:surround.runtimeIntegrationVerified??null}},
 instructions:{selection:'Explicit relative file paths for curated promotion; no recursive copy.',
  runtime:'GLBs embed their textures; external texture folders and bake caches are not required for loading.',
  reproduction:'These scripts run inside the existing WaterDuel project with its prior source, verifiers and immutable baselines retained.',
  freeze:'This inventory generator reads the current frozen sources, assets and sidecars without modifying them.',
  evidence:'Include evidence with the contracts for complete offline audit. Runtime GPU validation remains with Principal.'},
 excluded:['Screenshots with QR','output/qa-v4/**','output/blender/WaterDuel_v4_Working.blend',
  'output/blender/runtime-bake-cache*','public/assets/environment/workshop/textures*/**',
  'older source/GLB versions already retained in the project','unrelated workspace files'],
 sets,files,details,sourceFiles:details.filter(file=>file.role==='authoring'),
 totals:{files:files.length,bytes:details.reduce((sum,file)=>sum+file.bytes,0)}};
const target=new URL('audit/ESCENOGRAFIA_V4_ENTREGABLES.json',root);
const refresh=process.argv.includes('--refresh-after-360-stable');
const previousHash='0c35257437c597b796bedbaa5d2aea5c8c633cc484bd731715bb4a7e637b4a27';
if(refresh){
 const previousBytes=await readFile(target);assert.equal(hash(previousBytes),previousHash,'Unexpected inventory superseded');
 const previous=JSON.parse(previousBytes);
 const closureChanges=new Set([dir+'workshop-360-v4.json',dir+'features-v4.json',dir+'verification-v4.json',
  'scripts/mark-workshop-v4-ready.mjs','scripts/verify-workshop-runtime-v4.mjs',
  'scripts/inventory-workshop-delivery-v4.mjs','docs/ENTREGA_ESCENOGRAFIA_RUNTIME_V4.md']);
 for(const file of previous.details)if(!closureChanges.has(file.path)){
  const current=details.find(entry=>entry.path===file.path);
  assert(current&&current.sha256===file.sha256,'Frozen file changed during stable closure: '+file.path);
 }
 assert(surround.stable&&surround.runtimeIntegrationVerified===false&&surround.validation?.scope==='offline artifact');
 inventory.supersedesInventorySha256=previousHash;
}
const bytes=JSON.stringify(inventory,null,2)+'\n';
try{await writeFile(target,bytes,{flag:'wx'});}catch(error){
 if(error.code!=='EEXIST')throw error;
 const existing=await readFile(target);
 if(refresh){assert.equal(hash(existing),previousHash);await writeFile(target,bytes);}
 else assert.equal(existing.toString('utf8'),bytes,'Refusing to modify an existing promotion inventory');
}
for(const file of details)assert.equal(hash(await readFile(new URL(file.path,root))),file.sha256,'Frozen file changed: '+file.path);
console.log(JSON.stringify({inventory:'audit/ESCENOGRAFIA_V4_ENTREGABLES.json',sources:inventory.sourceFiles,
 totals:inventory.totals,contractStates:inventory.contractStates,existingDeliveryUnchanged:true},null,2));
