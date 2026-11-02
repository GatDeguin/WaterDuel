// Close the offline artifact gate; game GPU QA remains a separate state.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyWorkshop360V4} from './verify-workshop-360-v4.mjs';
import {verifyWorkshopRuntimeV4} from './verify-workshop-runtime-v4.mjs';

const root=new URL('../',import.meta.url),dir='public/assets/environment/workshop/';
const json=async file=>JSON.parse(await readFile(new URL(file,root),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=async file=>hash(await readFile(new URL(file,root)));
const save=async(file,value)=>writeFile(new URL(file,root),JSON.stringify(value,null,2)+'\n');
const inventory=await json('audit/ESCENOGRAFIA_V4_ENTREGABLES.json');
const changing=new Set([dir+'workshop-360-v4.json',dir+'features-v4.json',dir+'verification-v4.json']);
const closureChanges=new Set([...changing,'scripts/mark-workshop-v4-ready.mjs',
 'scripts/verify-workshop-runtime-v4.mjs','scripts/inventory-workshop-delivery-v4.mjs',
 'docs/ENTREGA_ESCENOGRAFIA_RUNTIME_V4.md']);
const protectedFiles=[];
for(const file of inventory.details){
 const sha256=await digest(file.path);
 if(!closureChanges.has(file.path))assert.equal(sha256,file.sha256,'Frozen deliverable changed: '+file.path);
 if(!changing.has(file.path))protectedFiles.push({path:file.path,sha256});
}
const contractPath=dir+'workshop-360-v4.json';
const contract=await json(contractPath),oldContractHash=await digest(contractPath);
const featuresPath=dir+'features-v4.json',features=await json(featuresPath);
const references=features.features.flatMap(row=>row.evidence).filter(item=>item.kind==='file'&&item.path==='workshop-360-v4.json');
assert.equal(references.length,1);assert.equal(references[0].sha256,oldContractHash);
assert.equal(contract.sha256,'5bc507ab91bf5e0a39a827d2eb35ad81ff8494f83e952f2499dd15c483c408a4');
assert.equal(contract.selectedV4.sha256,'9dafb0641072e9ec5e281e43aa0ad1282468fb21b84bfd0955d9166813f1afbe');
const before=await verifyWorkshop360V4({requireStable:false,writeReport:false});
assert(before.ok,JSON.stringify(before.errors));
assert.equal(before.glbSha256,contract.sha256);
assert(contract.runtimeIntegrationVerified===undefined||contract.runtimeIntegrationVerified===false,
 'This marker closes the offline pre-integration release only');
contract.stable=true;
contract.runtimeIntegrationVerified=false;
contract.stableSemantics='The immutable geometry, PBR resources, coordinates, openings, room guards and camera/light contract passed offline artifact validation. This does not certify game activation or GPU QA.';
contract.validation={...(contract.validation??{}),completedAt:contract.validation?.completedAt??new Date().toISOString(),
 scope:'offline artifact',glbSha256:contract.sha256,verifier:'scripts/verify-workshop-360-v4.mjs',
 report:'verification-360-v4.json',windowRays:64,closedRoomGuards:9,runtimeIntegrationVerified:false};
await save(contractPath,contract);
references[0].sha256=await digest(contractPath);
await save(featuresPath,features);
const after=await verifyWorkshop360V4({requireStable:true,writeReport:true});
assert(after.ok,JSON.stringify(after.errors));
const {receipt:main}=await verifyWorkshopRuntimeV4();
assert(main.ok,JSON.stringify(main.errors));
assert.equal(main.glb.sha256,contract.selectedV4.sha256);
for(const file of protectedFiles)assert.equal(await digest(file.path),file.sha256,'Protected file changed: '+file.path);
console.log(JSON.stringify({stable:true,runtimeIntegrationVerified:false,glbSha256:contract.sha256,
 mainGlbSha256:main.glb.sha256,mainReadyForIntegration:main.readyForIntegration,
 sidecarSha256:references[0].sha256,featuresSha256:await digest(featuresPath),
 verification:'public/assets/environment/workshop/verification-360-v4.json',
 protectedFilesUnchanged:protectedFiles.length},null,2));
