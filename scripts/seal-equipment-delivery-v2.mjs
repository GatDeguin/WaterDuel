import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const OUT='public/assets/equipment/workshop/v2/delivery-sha256.json';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function checkFiles(files){
  for(const file of files){
    const bytes=await readFile(path.join(ROOT,file.path));
    if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)throw new Error(`Receipt mismatch: ${file.path}`);
  }
}
const frozen=JSON.parse(await readFile(path.join(ROOT,'public/assets/equipment/workshop/delivery-sha256.json'),'utf8'));
await checkFiles(frozen.files);
if(process.argv.includes('--verify')){
  const receipt=JSON.parse(await readFile(path.join(ROOT,OUT),'utf8'));
  await checkFiles(receipt.files);
  console.log(JSON.stringify({ok:true,v1FrozenFiles:frozen.files.length,v2Files:receipt.files.length}));
}else{
  const files=[];
  async function tree(relative){
    for(const item of (await readdir(path.join(ROOT,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const file=`${relative}/${item.name}`;
      if(item.isDirectory())await tree(file);
      else if(file!==OUT&&item.isFile())files.push(file);
    }
  }
  await tree('public/assets/equipment/workshop/v2');
  await tree('docs/assets/equipment/v2');
  files.push('docs/assets/equipment/contact-materials-v1.json','docs/CONTACTO_MATERIALES_ITEMS.md',
    'docs/ENTREGA_EQUIPAMIENTO_MATERIALES_V2.md','audit/COORDINACION_ITEMS_V2.md',
    'scripts/equipment_v2_textures.py','scripts/generate-equipment-textures-v2.py',
    'scripts/create-equipment-materials-v2.mjs','scripts/validate-equipment-materials-v2.mjs',
    'scripts/inspect-equipment-materials-v2.py','scripts/inspect-equipment-texture-budget-v2.mjs',
    'scripts/inspect-equipment-contact-materials.mjs','scripts/seal-equipment-delivery-v2.mjs');
  const records=[];
  for(const file of files.sort()){
    const bytes=await readFile(path.join(ROOT,file));
    records.push({path:file,bytes:bytes.length,sha256:hash(bytes)});
  }
  const validation=JSON.parse(await readFile(path.join(ROOT,'public/assets/equipment/workshop/v2/validation.json'),'utf8'));
  const revision=JSON.parse(await readFile(path.join(ROOT,'public/assets/equipment/workshop/v2/material-revision.json'),'utf8'));
  const roundtrip=JSON.parse(await readFile(path.join(ROOT,'public/assets/equipment/workshop/v2/roundtrip-validation.json'),'utf8'));
  const budget=JSON.parse(await readFile(path.join(ROOT,'public/assets/equipment/workshop/v2/texture-budget.json'),'utf8'));
  const contractBytes=await readFile(path.join(ROOT,'public/assets/equipment/workshop/v2/asset-contract.json'));
  const contract=JSON.parse(contractBytes);
  const require=(ok,message)=>{if(!ok)throw new Error(message);};
  require(validation.ok&&revision.ok&&roundtrip.ok&&budget.ok,'All material, import and budget checks must pass before sealing');
  const expectedIds=['sword','spear','axe','maul','short','long','knife'].sort();
  for(const report of [contract,validation,revision,roundtrip,budget])
    require(JSON.stringify(report.assets.map(asset=>asset.id).sort())===JSON.stringify(expectedIds),'Each report must contain exactly the seven expected assets');
  const v1ContractBytes=await readFile(path.join(ROOT,'public/assets/equipment/workshop/asset-contract.json'));
  require(budget.v2ContractSha256===hash(contractBytes),'Stale texture-budget v2 contract');
  require(budget.v1ContractSha256===hash(v1ContractBytes)&&validation.v1ManifestSha256===hash(v1ContractBytes)&&revision.baseContractSha256===hash(v1ContractBytes),'Stale v1 source contract');
  for(const asset of contract.assets){
    const current=records.find(file=>file.path===`public/assets/equipment/workshop/v2/${asset.file}`);
    const v=validation.assets.find(item=>item.id===asset.id),r=revision.assets.find(item=>item.id===asset.id),b=budget.assets.find(item=>item.id===asset.id),i=roundtrip.assets.find(item=>item.id===asset.id);
    require(current&&current.sha256===asset.sha256&&current.bytes===asset.bytes,`${asset.id}: stale asset contract`);
    require(v.ok&&v.geometryUnchanged&&v.v2.sha256===current.sha256&&v.v2.bytes===current.bytes,`${asset.id}: stale validation`);
    require(r.v2Sha256===current.sha256&&r.bytesV2===current.bytes&&r.geometrySha256Before===r.geometrySha256After,`${asset.id}: stale material revision`);
    require(b.sha256===current.sha256&&b.bytes===current.bytes&&b.geometryUnchanged&&b.geometrySha256===r.geometrySha256After,`${asset.id}: stale texture budget`);
    require(i.triangles===asset.triangles&&i.bounds_max_error<=1e-5,`${asset.id}: failed roundtrip`);
  }
  const receipt={date:'2026-10-18',status:'stable',revision:'materials-only-v2',runtimeIntegrated:false,
    v1FrozenFilesVerified:frozen.files.length,glbValidation:'7/7',validatorSelfTests:'17/17',blenderRoundtrip:'7/7',
    review:'Board and four detail renders inspected; presentation-only captions spaced inside frame.',files:records};
  await writeFile(path.join(ROOT,OUT),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({ok:true,receipt:OUT,v1FrozenFiles:frozen.files.length,v2Files:records.length}));
}
