// Close asset QA only after the actual reimported previews have been inspected.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyWorkshopRuntimeV2} from './verify-workshop-runtime-v2.mjs';

assert(process.argv.includes('--visuals-reviewed'), 'Inspect full scene and both rotor previews before marking ready');
const root = new URL('../', import.meta.url);
const out = new URL('public/assets/environment/workshop/', root);
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const {receipt: verified} = await verifyWorkshopRuntimeV2(new URL('workshop-runtime-v2.glb', out), {writeReport: false});
assert(verified.ok, JSON.stringify(verified.errors));
const contract = await json(new URL('asset-contract-v2.json', out));
const receipt = await json(new URL('export-receipt-v2.json', out));
const reimport = await json(new URL('reimport-verification-v2.json', out));
const editable = await json(new URL('output/blender/verification-editable-v2.json', root));
assert(reimport.passed && reimport.errors.length === 0 && Object.values(reimport.checks).every(Boolean));
assert(editable.passed && editable.linearCyclicLoop && editable.lights === 22 && editable.cameras === 3);
assert.equal(receipt.sha256, verified.glb.sha256);
for (const file of ['preview-glb-v2-eevee.png', 'preview-fan-v2-000.png', 'preview-fan-v2-090.png']) {
  const bytes = await readFile(new URL(file, out));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), 1280);
  assert.equal(bytes.readUInt32BE(20), 720);
}
const editableBytes = await readFile(new URL('output/blender/WaterDuel_Atelier_v2.blend', root));
const date = new Date().toISOString();
contract.ready = contract.stable = true;
contract.verification = 'Independent GLB parser, runtime CPU fan transforms and Blender reimport passed; three real GLB previews visually inspected.';
contract.textureBudget = {...contract.textureBudget,
  fileMiB: verified.glb.bytes / 1048576,
  decodedRGBA8WithMipsMiBUniqueImages: verified.resourceBudget.uniqueImageMiB,
  decodedRGBA8WithMipsMiBTextureObjects: verified.resourceBudget.textureObjectMiB};
contract.validation = {...contract.validation, completedAt: date, glbSha256: receipt.sha256,
  visuallyInspected: true, fanPreviews: ['preview-fan-v2-000.png', 'preview-fan-v2-090.png'],
  stageTopMeasured: reimport.stageTopMeasured, boundsMaxError: reimport.boundsMaxError,
  activeVolumeClear: reimport.activeVolumeIntersections.length === 0,
  editable: {path: 'output/blender/WaterDuel_Atelier_v2.blend', sha256: hash(editableBytes),
    bytes: editableBytes.length, verification: 'output/blender/verification-editable-v2.json'}};
receipt.ready = true;
receipt.validation = {parser: 'verification-v2.json', reimport: 'reimport-verification-v2.json',
  visuallyInspected: true, completedAt: date};
await save(new URL('asset-contract-v2.json', out), contract);
await save(new URL('export-receipt-v2.json', out), receipt);
const {receipt: final} = await verifyWorkshopRuntimeV2(new URL('workshop-runtime-v2.glb', out));
assert(final.ok && final.readyForIntegration);
console.log(JSON.stringify({ready: true, sha256: receipt.sha256, bytes: receipt.bytes,
  triangles: receipt.triangles, groups: receipt.groups, editable: contract.validation.editable}, null, 2));
