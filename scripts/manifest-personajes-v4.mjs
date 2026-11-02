import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Deliberately curated: never copy a directory or the publication checkout.
const runtime=[
  'public/physics/articulated-rig.js','public/engine.js','public/render3d.js',
  'public/physics/character-intent.js','public/rendering/asset-rig.js','public/rendering/asset-gpu.js',
  'public/rendering/character-neck.js','public/rendering/physical-feet.js','public/rendering/character-resources.js',
  'public/rendering/joint-damage.js','public/rendering/combat-wear.js','public/rendering/contact-shadows.js',
  'public/physics/apron-cloth.js','public/physics/apron.js','public/physics/surface-state.js',
  'public/rendering/apron-deform.js','public/rendering/apron-parts.js','public/rendering/apron-color.js',
  'public/physics/foot-geometry.js','public/physics/shin-geometry.js','public/physics/fluid-solids.js',
  'public/physics/joint-impact.js','public/physics/limb-state.js',
  'public/physics/body-evasion.js','public/physics/weapon-bind.js'
];
const tests=[
  'tests/character-intent.test.mjs','tests/character-damage-v4.test.mjs','tests/character-resources-v4.test.mjs',
  'tests/character-neck-v4.test.mjs','tests/character-feet-consumers-v4.test.mjs',
  'tests/character-v4-contract.test.mjs','tests/character-v4-feet.test.mjs','tests/character-v4-foot-consumers.test.mjs',
  'tests/character-v4-shin-floor.test.mjs','tests/test_character_atlas_v4.py','tests/apron-cloth.test.mjs',
  'tests/rig-v4-independent-113.test.mjs','tests/articulated-rig.test.mjs','tests/asset-rig.test.mjs',
  'tests/asset-gpu.test.mjs','tests/rig-selfcontact.test.mjs','tests/joint-detachment.test.mjs',
  'tests/rig-goal-y-only-exact.test.mjs','tests/rig-passive-equivalence.test.mjs','tests/head-contact-pose-exact.test.mjs',
  'tests/joint-damage-render.test.mjs','tests/apron-physics.test.mjs','tests/render.test.mjs','tests/inter-rig-contact.test.mjs','tests/body-evasion.test.mjs',
  'tests/inter-rig-legacy-approach.test.mjs','tests/inter-rig-heads-v4.test.mjs',
  'tests/active-floor.test.mjs','tests/stance-reference.test.mjs','tests/character-crouch-motor-v4.test.mjs',
  'tests/weapon-friction.test.mjs','tests/rig-contact-response-v4.test.mjs',
  'tests/ai.test.mjs','tests/manual-weapon-parry.test.mjs','tests/weapon-bind.test.mjs',
  'tests/weapon-manifold-scalar-exact.test.mjs',
  'tests/collision-geometry-exact.test.mjs','tests/detached-fluid-contact.test.mjs',
  'tests/fixtures/rig-v4-geometry-reference-113.mjs',
  'tests/fixtures/rig-v4-numerical-reference.mjs','tests/fixtures/procedural-legacy-characters-1.12.json',
  'tests/fixtures/water-mannequin-v3-baseline.json',
  'tests/fixtures/engine-pre-character-v4-1.12.js.txt','tests/fixtures/articulated-rig-pre-character-v4-1.12.js.txt'
];
const scripts=[
  'scripts/character_v4_geometry.py','scripts/build-water-mannequin-v4.py','scripts/inspect-water-mannequin-v4.py',
  'scripts/create-character-atlas-v4.py','scripts/preview-water-mannequin-v4.py',
  'scripts/check-character-v4-poses.mjs','scripts/finalize-water-mannequin-v4.mjs','scripts/manifest-personajes-v4.mjs'
];
const sources=[
  'docs/assets/characters/v4/atlas-layout.json','docs/assets/characters/v4/models-preview.blend',
  'docs/assets/characters/v4/textures/body-basecolor.png','docs/assets/characters/v4/textures/body-normal.png',
  'docs/assets/characters/v4/textures/body-orm.png','docs/assets/characters/v4/textures/atlas-stats.json',
  'docs/assets/characters/v4/textures/atlas-map-preview.png','docs/assets/characters/v4/textures/atlas-material-detail.png'
];
const assets=[
  'public/assets/characters/water-mannequin/v4/asset-info.json',
  'public/assets/characters/water-mannequin/v4/rig-contract.json',
  'public/assets/characters/water-mannequin/v4/pose-sweep.json',
  'public/assets/characters/water-mannequin/v4/waterduel-models-v4.png',
  'public/assets/characters/water-mannequin/v4/delivery-sha256.json',
  'public/assets/characters/water-mannequin/v4/validation-mint.json',
  'public/assets/characters/water-mannequin/v4/validation-amber.json',
  'public/assets/characters/water-mannequin/v4/validation-boss.json'
];
for(const name of ['water-mannequin','water-mannequin-amber','water-mannequin-boss']){
  for(const suffix of ['.blend','-construction.json','-physical.json'])sources.push(`docs/assets/characters/v4/${name}${suffix}`);
  for(const suffix of ['.glb','-roundtrip.json'])assets.push(`public/assets/characters/water-mannequin/v4/${name}${suffix}`);
}
const documents=[
  'docs/superpowers/specs/2026-11-02-personajes-selected-design.md',
  'docs/superpowers/plans/2026-11-02-personajes-selected.md',
  'audit/COORDINACION_PERSONAJES_V4.md','audit/PERSONAJES_V4_TRAZABILIDAD.md',
  'audit/PERSONAJES_V4_ORACULOS.md','audit/PERSONAJES_V4_LEGACY_RENDER.md',
  'audit/PERSONAJES_V4_HEAD_APPROACH.json','audit/PERSONAJES_V4_HEAD_APPROACH.md',
  'audit/PERSONAJES_V4_HEAD_RECIPE.json','audit/PERSONAJES_V4_HEAD_CROUCH.json',
  'audit/PERSONAJES_V4_POSE_SWEEP.txt','audit/PERSONAJES_V4_ASSET_RECEIPT.txt',
  'audit/TESTS_PERSONAJES_V4_MIGRACIONES_FINAL.txt','audit/TESTS_PERSONAJES_V4_CROUCH_FINAL.txt',
  'audit/PERSONAJES_V4_FISICA.md','audit/PERSONAJES_V4_STANCE_DIAGNOSTIC.json',
  'audit/PERSONAJES_V4_STANCE_ABLATION.json','audit/PERSONAJES_V4_CROUCH_SUPPORT.json',
  'audit/PERSONAJES_V4_CROUCH_PUSH_ABLATION.json','audit/PERSONAJES_V4_CROUCH_PHYSICAL_TARGET_ABLATION.json',
  'audit/PERSONAJES_V4_CONTACT_COST.json','audit/PERSONAJES_V4_CONTACT_COMPACT_ABBA.json',
  'audit/PERSONAJES_V4_KNIFE_SOCKET_PRECISION.json',
  'audit/articulated-rig-v4-before-signed-contact.js.txt',
  'audit/articulated-rig-v4-rich-contact.js.txt','audit/weapon-bind-v4-rich-contact.js.txt'
];
const qa=['public/qa/personajes-v4.html','public/qa/personajes-v4.js'];
const root=new URL('../',import.meta.url);
async function receipt(file){
  const bytes=await readFile(new URL(file,root));
  return {file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
const save=(file,value)=>writeFile(new URL(file,root),JSON.stringify(value,null,2)+'\n');
await save('audit/PERSONAJES_V4_PRODUCTION_MANIFEST.json',await Promise.all(runtime.map(receipt)));
const files=[...new Set([...runtime,...tests,...scripts,...sources,...assets,...documents,...qa,
  'audit/PERSONAJES_V4_PRODUCTION_MANIFEST.json','audit/PERSONAJES_V4_PROMOTION_FILES.json',
  'audit/PERSONAJES_V4_PROMOTION_RECEIPTS.json'])];
// The path list includes itself. Receipts exclude themselves to avoid a cycle.
await save('audit/PERSONAJES_V4_PROMOTION_FILES.json',files);
const receipts=[];for(const file of files)if(file!=='audit/PERSONAJES_V4_PROMOTION_RECEIPTS.json')receipts.push(await receipt(file));
await save('audit/PERSONAJES_V4_PROMOTION_RECEIPTS.json',{schema:4,files:receipts});
console.log(JSON.stringify({ok:true,files:files.length,runtime:runtime.length,totalBytes:receipts.reduce((sum,r)=>sum+r.bytes,0)}));
