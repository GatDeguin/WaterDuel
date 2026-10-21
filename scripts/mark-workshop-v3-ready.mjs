import{readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import assert from'node:assert/strict';
import{verifyWorkshopRuntimeV3}from'./verify-workshop-runtime-v3.mjs';
assert(process.argv.includes('--visuals-reviewed'),'Inspect all five GLB previews first');
const root=new URL('../',import.meta.url),out=new URL('public/assets/environment/workshop/',root);
const json=async url=>JSON.parse(await readFile(url,'utf8'));
const save=async(url,data)=>writeFile(url,JSON.stringify(data,null,2)+'\n');
const {receipt:qa}=await verifyWorkshopRuntimeV3(new URL('workshop-runtime-v3.glb',out),{writeReport:false});
assert(qa.ok,JSON.stringify(qa.errors));
const contract=await json(new URL('asset-contract-v3.json',out)),receipt=await json(new URL('export-receipt-v3.json',out));
const reimport=await json(new URL('reimport-verification-v3.json',out));
const geometry=await json(new URL('geometric-reimport-v3.json',out));
const materials=await json(new URL('material-comparison-v3.json',out));
const preservation=await json(new URL('geometry-preservation-v3.json',out));
const editable=await json(new URL('output/blender/verification-editable-v3.json',root));
const preview=await json(new URL('output/blender/preview-editable-v3.json',root));
assert(reimport.passed&&reimport.errors.length===0&&Object.values(reimport.checks).every(Boolean));
assert(geometry.passed&&geometry.allOtherExportedGeometry.every(c=>c.externalTriangleCrossings===0));
assert(materials.ok&&materials.candidate.sha256===qa.glb.sha256&&preservation.passed);
assert(editable.passed===true||editable.status==='passed'||editable.ok===true);
assert(preview.status==='passed'&&preview.sourcePreserved);
assert.equal(receipt.sha256,qa.glb.sha256);
const previews=['preview-glb-v3-eevee.png','preview-glb-v3-oblique.png','preview-board-v3.png','preview-apron-left-v3.png','preview-apron-right-v3.png'];
for(const name of previews){
 const b=await readFile(new URL(name,out));
 assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(b.readUInt32BE(16),1280);assert.equal(b.readUInt32BE(20),720);
}
const source=await readFile(new URL('output/blender/WaterDuel_Atelier_v3.blend',root));
const sourceHash=createHash('sha256').update(source).digest('hex');
assert.equal(sourceHash,preview.sourceSha256);
const date=new Date().toISOString();
contract.ready=contract.stable=true;
contract.verification='Final GLB parser, complete-component separations, BVH/triangle SAT against all external geometry, Blender reimport and five reviewed previews passed.';
contract.textureBudget.fileMiB=qa.glb.bytes/1048576;
contract.validation={...contract.validation,completedAt:date,glbSha256:qa.glb.sha256,
 visuallyInspected:true,previews,allFiveExternalCrossingCounts:0,materialComparison:'material-comparison-v3.json',
 preservation:'geometry-preservation-v3.json',fullGeometryTest:'geometric-reimport-v3.json',
 editable:{path:'output/blender/WaterDuel_Atelier_v3.blend',bytes:source.length,sha256:sourceHash,
 verification:'output/blender/verification-editable-v3.json',preview:'output/blender/WaterDuel_Atelier_v3_duelo.png'}};
receipt.ready=true;receipt.validation={glbSha256:qa.glb.sha256,completedAt:date,visuallyInspected:true};
await save(new URL('asset-contract-v3.json',out),contract);await save(new URL('export-receipt-v3.json',out),receipt);
const{receipt:final}=await verifyWorkshopRuntimeV3(new URL('workshop-runtime-v3.glb',out));
assert(final.ok&&final.readyForIntegration);
console.log(JSON.stringify({ready:true,sha256:qa.glb.sha256,bytes:qa.glb.bytes,triangles:qa.glb.triangles,
 groups:qa.glb.drawGroups,editable:contract.validation.editable,externalCrossings:0},null,2));
