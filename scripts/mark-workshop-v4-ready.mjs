import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyWorkshopRuntimeV4} from './verify-workshop-runtime-v4.mjs';
import {verifyWorkshop360V4} from './verify-workshop-360-v4.mjs';

assert(process.argv.includes('--visuals-reviewed'),'Review the nine reimport views and native day/night first');
const root=new URL('../',import.meta.url),out=new URL('public/assets/environment/workshop/',root);
const json=async url=>JSON.parse(await readFile(url,'utf8'));
const save=async(url,data)=>writeFile(url,JSON.stringify(data,null,2)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const surroundingsQA=await verifyWorkshop360V4({requireStable:true,writeReport:false});
assert(surroundingsQA.ok,JSON.stringify(surroundingsQA.errors));
const {receipt:qa}=await verifyWorkshopRuntimeV4(new URL('workshop-runtime-v4.glb',out),{writeReport:false});
assert(qa.ok,JSON.stringify(qa.errors));
assert(qa.featureEvidence.coverage.allDeclaredImplemented);
assert.equal(qa.immutableBaselines.length,6);assert(qa.immutableBaselines.every(v=>v.ok));
const contract=await json(new URL('asset-contract-v4.json',out));
const receipt=await json(new URL('export-receipt-v4.json',out));
const reimport=await json(new URL('reimport-verification-v4.json',out));
const geometry=await json(new URL('geometric-reimport-v4.json',out));
const native=await json(new URL('output/blender/verification-editable-v4.json',root));
const variants=await json(new URL('output/blender/preview-variants-v4.json',root));
assert(reimport.passed&&reimport.errors.length===0&&Object.values(reimport.checks).every(Boolean));
assert.equal(reimport.glbSha256,qa.glb.sha256);
assert(geometry.passed&&geometry.allOtherExportedGeometry.length===5);
assert.equal(geometry.glbSha256,qa.glb.sha256);
assert(geometry.allOtherExportedGeometry.every(v=>v.externalTriangleCrossings===0));
assert(native.passed&&variants.passed&&variants.sourceFilesUnchangedDuringRender&&variants.cameraPreserved);
assert.equal(receipt.sha256,qa.glb.sha256);
const names=['preview-glb-v4-eevee.png','preview-glb-v4-oblique.png','preview-v4-materials.png',
 'preview-v4-details.png','preview-v4-tools.png','preview-v4-copper.png','preview-v4-glass.png',
 'preview-v4-exterior.png','preview-v4-ceiling.png','preview-native-day-v4.png','preview-native-night-v4.png'];
assert(names.slice(0,9).every(n=>reimport.previews.some(p=>p.file===n)));
const previews=[];
for(const file of names){
 const b=await readFile(new URL(file,out));
 assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(b.readUInt32BE(16),1280);assert.equal(b.readUInt32BE(20),720);
 const renderEntry=reimport.previews.find(p=>p.file===file);
 if(renderEntry)assert.equal(hash(b),renderEntry.sha256,'GLB preview differs from its render receipt: '+file);
 previews.push({file,sha256:hash(b),resolution:[1280,720]});
}
const editables=[];
for(const variant of ['day','night']){
 const entry=variants[variant],b=await readFile(new URL(entry.path,root)),sha256=hash(b);
 assert.equal(sha256,entry.sha256);
 const preview=await readFile(new URL(entry.preview,root));
 assert.equal(hash(preview),entry.previewSha256);
 assert.equal(hash(preview),previews.find(p=>p.file==='preview-native-'+variant+'-v4.png').sha256);
 const evidence=native.variants.find(v=>entry.path.endsWith(v.file));
 assert(evidence&&evidence.sha256===sha256&&evidence.camerasPreserved&&evidence.linearCyclicFan&&evidence.sourceUnchanged);
 assert.equal(evidence.lights,22);assert.equal(evidence.visibleMeshes,56);
 assert(evidence.glassMaxBroadFaceTiltDegrees<5);
 editables.push({variant,path:entry.path,bytes:b.length,sha256,preview:entry.preview});
}
const surround=await json(new URL('workshop-360-v4.json',out));
assert.equal(surround.stable,true,'The paired 360 artifact must pass its own stable marker');
assert.equal(typeof surround.runtimeIntegrationVerified,'boolean');
assert.equal(hash(await readFile(new URL(surround.asset,out))),surround.sha256);
assert.equal(surround.selectedV4.sha256,qa.glb.sha256);
assert(surround.verification.passed);
assert.equal(surround.verification.windowProjectionRays.length,64);
assert(surround.verification.windowProjectionRays.every(r=>r.passed&&r.v4Hits===0));
assert.equal(surround.verification.closedRoomGuards.length,9);
assert(surround.verification.closedRoomGuards.every(r=>r.passed));
const date=new Date().toISOString();
contract.ready=contract.stable=true;
contract.verification='Final GLB parser, 16 feature evidence sets, six frozen baselines, seven separations, five BVH/triangle-SAT assemblies, native day/night fan/cameras, HDR and eleven reviewed views passed.';
contract.textureBudget.fileMiB=qa.glb.bytes/1048576;
contract.validation={...contract.validation,completedAt:date,glbSha256:qa.glb.sha256,visuallyInspected:true,
 previews,externalCrossings:0,fullGeometryTest:'geometric-reimport-v4.json',
 nativeVerification:'output/blender/verification-editable-v4.json',nativePreviews:'output/blender/preview-variants-v4.json',
 editables,runtimeIntegrationVerified:false};
receipt.ready=true;receipt.validation={completedAt:date,glbSha256:qa.glb.sha256,visuallyInspected:true,previewCount:11};
await save(new URL('asset-contract-v4.json',out),contract);
await save(new URL('export-receipt-v4.json',out),receipt);
const {receipt:final}=await verifyWorkshopRuntimeV4(new URL('workshop-runtime-v4.glb',out));
assert(final.ok&&final.readyForIntegration);
console.log(JSON.stringify({ready:true,sha256:qa.glb.sha256,bytes:qa.glb.bytes,triangles:qa.glb.triangles,
 groups:qa.glb.drawGroups,editables,externalCrossings:0,reviewedViews:11,runtimeIntegrationVerified:false},null,2));
