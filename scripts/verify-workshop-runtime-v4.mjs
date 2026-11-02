// V4 asset QA; older verifiers and frozen deliveries remain read-only.
// node scripts/verify-workshop-runtime-v4.mjs [workshop-runtime-v4.glb]
// node scripts/verify-workshop-runtime-v4.mjs --self-test
import assert from 'node:assert/strict';
import {readFile, writeFile, stat, realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyV3Buffer} from './verify-workshop-runtime-v3.mjs';
import {parseGLB} from '../public/rendering/glb.js';
import {verifyWorkshop360V4} from './verify-workshop-360-v4.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIRECTORY = path.join(ROOT, 'public/assets/environment/workshop');
const DEFAULT_FILE = path.join(DIRECTORY, 'workshop-runtime-v4.glb');
const FEATURE_IDS = [4, 6, 7, 10, ...Array.from({length: 12}, (_, i) => 11 + i)];
const BASELINES = [
  ['output/blender/WaterDuel_Atelier.blend', '2e92513be1f17a2e2d5cc357dddc8cd8d0e1dd62abbde226f4ec09c3a717b755'],
  ['output/blender/WaterDuel_Atelier_v2.blend', 'd9c9f0bdbd58bc59c1ab1ee16422ac8ff9b7315c8ecd7436795248d47fcc2117'],
  ['output/blender/WaterDuel_Atelier_v3.blend', '8a693a0c42e75f3f1316ca4f22d687ea3df6ce30c0fbb600991c5803b54544ff'],
  ['public/assets/environment/workshop/workshop-runtime.glb', '1eb31ceef5913e3cce87cdc4397b5223ad678028957933de78e9b930c950c66d'],
  ['public/assets/environment/workshop/workshop-runtime-v2.glb', 'cec471597e48f5df50d23a2b7c894d01c44bce4402c607d6b001e7dd8d8d99b5'],
  ['public/assets/environment/workshop/workshop-runtime-v3.glb', '1a947c7e2a5b2387e5a0db4cd55169445dad91d2a0fda59bac5c51c0751bb930'],
];
const check = (condition, message) => assert.ok(condition, message);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function finiteJSON(value, label = 'JSON') {
  if (typeof value === 'number') check(Number.isFinite(value), `${label}: non-finite number`);
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) finiteJSON(child, `${label}.${key}`);
}
function vec3(value, label) {
  check(Array.isArray(value) && value.length === 3 && value.every(Number.isFinite), `${label}: expected finite VEC3`);
  return value;
}

// RGBE flat, legacy runs, and adaptive scanline RLE. Format specification:
// https://radsite.lbl.gov/radiance/refer/Notes/picture_format.html
export function verifyRadianceHDR(bytes) {
  check(Buffer.isBuffer(bytes) && bytes.length > 32, 'HDR: truncated header');
  let offset = 0;
  const line = () => {
    const end = bytes.indexOf(10, offset); check(end >= offset && end < 65536, 'HDR: truncated/excessive text header');
    const value = bytes.toString('ascii', offset, end).replace(/\r$/, ''); offset = end + 1; return value;
  };
  check(['#?RADIANCE', '#?RGBE'].includes(line()), 'HDR: invalid Radiance signature');
  let format = null;
  for (let value = line(); value !== ''; value = line()) if (value.startsWith('FORMAT=')) format = value.slice(7).trim();
  check(format === '32-bit_rle_rgbe', 'HDR: expected RGBE format');
  const resolution = /^([+-])Y\s+(\d+)\s+([+-])X\s+(\d+)\s*$/.exec(line());
  check(resolution, 'HDR: expected Y/X resolution line');
  const height = Number(resolution[2]), width = Number(resolution[4]), pixels = width * height;
  check(width > 0 && height > 0 && width <= 32767 && height <= 16384 && pixels <= 64_000_000, 'HDR: invalid/excessive dimensions');
  const byte = () => {check(offset < bytes.length, 'HDR: truncated pixel data'); return bytes[offset++];};
  const min = [Infinity, Infinity, Infinity], max = [0, 0, 0], sum = [0, 0, 0];
  let decoded = 0;
  const include = p => {
    const scale = p[3] ? 2 ** (p[3] - 136) : 0;
    for (let channel = 0; channel < 3; channel++) {
      const value = p[channel] * scale; check(Number.isFinite(value), 'HDR: non-finite decoded radiance');
      min[channel] = Math.min(min[channel], value); max[channel] = Math.max(max[channel], value); sum[channel] += value;
    }
    decoded++;
  };
  const encodings = new Set(), scanline = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    const adaptive = width >= 8 && bytes[offset] === 2 && bytes[offset + 1] === 2 && !(bytes[offset + 2] & 128);
    encodings.add(adaptive ? 'adaptive RLE' : 'flat / legacy RLE');
    if (adaptive) {
      check(byte() === 2 && byte() === 2 && (byte() * 256 + byte()) === width, 'HDR: invalid RLE scanline width');
      for (let channel = 0; channel < 4; channel++) {
        let x = 0;
        while (x < width) {
          const code = byte(), count = code > 128 ? code - 128 : code;
          check(count > 0 && x + count <= width, 'HDR: invalid RLE pixel run');
          if (code > 128) {const value = byte(); for (let i = 0; i < count; i++) scanline[(x++ * 4) + channel] = value;}
          else for (let i = 0; i < count; i++) scanline[(x++ * 4) + channel] = byte();
        }
      }
      for (let x = 0; x < width; x++) include(scanline.subarray(x * 4, x * 4 + 4));
    } else {
      let previous = null, shift = 0, x = 0;
      while (x < width) {
        const p = [byte(), byte(), byte(), byte()];
        if (p[0] === 1 && p[1] === 1 && p[2] === 1) {
          const count = p[3] * 2 ** shift;
          check(previous && shift <= 24 && x + count <= width, 'HDR: invalid legacy pixel run');
          for (let i = 0; i < count; i++) include(previous);
          x += count; shift += 8;
        } else {include(p); previous = p; shift = 0; x++;}
      }
    }
  }
  check(decoded === pixels, 'HDR: incomplete pixel count');
  check(bytes.length === offset || (bytes.length - offset <= 4 && /^\s*$/.test(bytes.toString('ascii', offset))), 'HDR: unexpected trailing pixel data');
  check(max.some(value => value > 0), 'HDR: black/zero placeholder map');
  return {ok: true, format: 'Radiance RGBE', encoding: encodings.size === 1 ? [...encodings][0] : 'mixed scanlines', width, height,
    pixels, decodedPixels: decoded, orientation: resolution[1] + 'Y ' + resolution[3] + 'X',
    minRawRGB: min, maxRawRGB: max, meanRawRGB: sum.map(value => value / pixels),
    hasSpatialVariation: max.some((value, i) => value > min[i]),
    scope: 'All encoded RGBE pixels decoded and finite/nonzero. Header exposure is not applied; this does not verify renderer integration.'};
}

export function verifyNightLighting(value) {
  finiteJSON(value, 'Night lighting');
  check(value?.version === 4 && value.variant === 'night', 'Night lighting: expected version4 / night variant');
  const lights = value.lights ?? value.lighting?.hints ?? value.hints;
  check(Array.isArray(lights) && lights.length > 0 && lights.length <= 24, 'Night lighting: expected 1..24 lights');
  let positiveLights = 0;
  const names = new Set();
  const report = lights.map(light => {
    check(typeof light.name === 'string' && light.name.length > 0 && !names.has(light.name), 'Night lighting: invalid/repeated light name'); names.add(light.name);
    check(['AREA', 'POINT', 'SPOT', 'SUN'].includes(light.type), 'Night lighting: unsupported light type');
    if (light.type !== 'SUN' || light.position !== undefined) vec3(light.position, light.name + '.position');
    const color = vec3(light.colorLinear ?? light.color, light.name + '.colorLinear');
    check(color.every(v => v >= 0), 'Night lighting: negative color');
    const powerField = ['scaledWatts', 'energy', 'intensity', 'power'].find(key => light[key] !== undefined);
    const power = light[powerField]; check(Number.isFinite(power) && power >= 0, 'Night lighting: invalid finite power');
    if (power > 0 && color.some(v => v > 0)) positiveLights++;
    return {name: light.name, type: light.type, powerField, power};
  });
  check(positiveLights > 0, 'Night lighting: no positive light energy');
  const overrides = value.materialOverrides ?? {};
  check(overrides && typeof overrides === 'object', 'Night lighting: invalid materialOverrides');
  return {ok: true, variant: value.variant, lights: lights.length, positiveLights, lightReport: report,
    materialOverrideNames: Array.isArray(overrides) ? overrides.map(row => row.name ?? row.material ?? null) : Object.keys(overrides),
    scope: 'Readable, finite night preset with positive lights. Native material overrides and visual night appearance require separate Blender QA.'};
}

function assetLoader(directory) {
  return async reference => {
    check(reference && typeof reference.path === 'string' && !path.isAbsolute(reference.path), 'Feature file: expected relative path');
    const candidate = path.resolve(directory, reference.path), lexical = path.relative(directory, candidate);
    check(lexical !== '..' && !lexical.startsWith('..' + path.sep) && !path.isAbsolute(lexical), 'Feature file: path leaves workshop namespace');
    const file = await realpath(candidate);
    const relative = path.relative(await realpath(directory), file);
    check(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Feature file: path leaves workshop namespace');
    const info = await stat(file); check(info.isFile() && info.size > 0 && info.size <= 256 * 1024 * 1024, 'Feature file: invalid/excessive file');
    const bytes = await readFile(file); return {file, bytes, sha256: hash(bytes)};
  };
}

export async function verifyFeaturesV4(parsed, receipt, {assetSha256, loadAsset = assetLoader(DIRECTORY)} = {}) {
  finiteJSON(receipt, 'Feature receipt');
  check(receipt?.version === 4 && receipt.asset === 'workshop-runtime-v4.glb', 'Feature receipt: incorrect version/asset');
  check(typeof assetSha256 === 'string' && /^[a-f\d]{64}$/i.test(assetSha256) &&
    typeof receipt.assetSha256 === 'string' && receipt.assetSha256.toLowerCase() === assetSha256.toLowerCase(),
  'Feature receipt: candidate SHA256 missing/mismatch');
  check(Array.isArray(receipt.features), 'Feature receipt: missing features');
  const ids = receipt.features.map(row => Number(row.id));
  check(ids.length === FEATURE_IDS.length && new Set(ids).size === ids.length && FEATURE_IDS.every(id => ids.includes(id)),
    'Feature receipt: selected IDs must be exactly 4,6,7,10,11..22');
  const usedMaterials = new Set(parsed.primitives.map(p => p.material).filter(i => Number.isInteger(i) && i >= 0));
  const usedImages = new Set();
  const imageBindings = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key.endsWith('Texture') && child && Number.isInteger(child.index)) {
        const source = parsed.json.textures?.[child.index]?.source;
        if (Number.isInteger(source) && source >= 0) usedImages.add(source);
      } else imageBindings(child);
    }
  };
  for (const index of usedMaterials) imageBindings(parsed.json.materials?.[index]);
  const activeMaterialNames = [...usedMaterials].map(i => parsed.json.materials?.[i]?.name).filter(Boolean);
  const activeImageNames = [...usedImages].map(i => parsed.json.images?.[i]?.name).filter(Boolean);
  const cache = new Map();
  const fileEvidence = async reference => {
    const key = reference?.path; check(typeof key === 'string', 'Feature file: missing path');
    if (!cache.has(key)) cache.set(key, await loadAsset(reference));
    const loaded = cache.get(key); check(loaded?.bytes?.length > 0, 'Feature file: empty/unreadable ' + key);
    const sha256 = hash(loaded.bytes);
    if (reference.sha256 !== undefined) check(/^[a-f\d]{64}$/i.test(reference.sha256) && reference.sha256.toLowerCase() === sha256,
      'Feature file: SHA256 checksum mismatch ' + key);
    return {...loaded, sha256};
  };
  const features = [];
  for (const row of receipt.features) {
    check(typeof row.label === 'string' && row.label.trim().length > 0, 'Feature: missing label');
    check(['implemented', 'partial', 'deferred'].includes(row.status), 'Feature ' + row.id + ': invalid/missing status');
    check(typeof row.implementation === 'string' && row.implementation.trim().length > 0, 'Feature ' + row.id + ': missing concrete implementation');
    check(Array.isArray(row.limitations) && row.limitations.every(v => typeof v === 'string'), 'Feature ' + row.id + ': limitations must be an array');
    check(Array.isArray(row.evidence) && (row.status === 'deferred' || row.evidence.length > 0), 'Feature ' + row.id + ': missing asset evidence');
    const evidence = [];
    for (const item of row.evidence) {
      if (item.kind === 'file') {
        const file = await fileEvidence(item); evidence.push({kind: item.kind, path: item.path, bytes: file.bytes.length, sha256: file.sha256, role: item.role ?? null});
      } else {
        const names = item.kind === 'node' ? parsed.primitives.map(p => p.nodeName) :
          item.kind === 'material' ? activeMaterialNames : item.kind === 'image' ? activeImageNames : null;
        check(names && typeof item.name === 'string' && names.includes(item.name), 'Feature ' + row.id + ': missing/unsupported ' + item.kind + ' ' + item.name);
        evidence.push({kind: item.kind, name: item.name, presentInActiveAsset: true});
      }
    }
    features.push({id: Number(row.id), label: row.label, declaredStatus: row.status,
      implementation: row.implementation, evidence, limitations: row.limitations});
  }
  const references = receipt.assets;
  for (const key of ['reflection', 'nightLighting']) check(references?.[key] && /^[a-f\d]{64}$/i.test(references[key].sha256),
    'Feature receipt: missing pinned auxiliary asset ' + key);
  const reflection = await fileEvidence(references.reflection), night = await fileEvidence(references.nightLighting);
  const reflectionReport = verifyRadianceHDR(reflection.bytes), nightReport = verifyNightLighting(JSON.parse(night.bytes.toString('utf8')));
  const implemented = features.filter(row => row.declaredStatus === 'implemented').map(row => row.id);
  return {ok: true, version: 4, assetSha256, coverage: {selectedIds: FEATURE_IDS, presentedIds: ids,
    declaredImplementedIds: implemented, partialIds: features.filter(row => row.declaredStatus === 'partial').map(row => row.id),
    deferredIds: features.filter(row => row.declaredStatus === 'deferred').map(row => row.id), allDeclaredImplemented: implemented.length === FEATURE_IDS.length},
    features, assets: {reflection: {...reflectionReport, path: references.reflection.path, bytes: reflection.bytes.length, sha256: reflection.sha256},
      nightLighting: {...nightReport, path: references.nightLighting.path, bytes: night.bytes.length, sha256: night.sha256}},
    activeEvidenceScope: {materialIndices: [...usedMaterials].sort((a, b) => a - b), imageIndices: [...usedImages].sort((a, b) => a - b)},
    visualClaimsVerified: false, runtimeIntegrationVerified: false,
    scope: 'Checks all selected receipt entries, existing GLB/file evidence and decoded auxiliary assets. Declared implementation status is not an independent judgement of photorealism, native override correctness or runtime integration.'};
}

export function verifyGlassSurfaceV4(parsed) {
  const used = new Set(parsed.primitives.map(primitive => primitive.material));
  const materials = (parsed.json.materials ?? []).flatMap((material, index) =>
    used.has(index) && material.name === 'Workshop v4 PBR | old undulating window glass' ? [{material, index}] : []);
  check(materials.length === 1, 'Glass: expected exactly one active window glass material');
  const {material, index} = materials[0];
  check(material.doubleSided !== true, 'Glass: double-sided blending repeats transparent rear surfaces and causes chevrons');
  const alpha = material.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1;
  check(material.alphaMode === 'BLEND' && Number.isFinite(alpha) && Math.abs(alpha - .66) <= 1e-6,
    'Glass: preserve transparent BLEND alpha 0.66');
  return {ok: true, material: material.name, materialIndex: index, doubleSided: false, alphaMode: material.alphaMode, alpha,
    scope: 'Regression for overlapping front/rear transparent slab surfaces confirmed by isolated Eevee renders. Visual appearance requires the separate actual-GLB preview review.'};
}

export function verifyV4Buffer(bytes, contract) {
  const report = verifyV3Buffer(bytes, {...contract, version: 3, asset: 'workshop-runtime-v3.glb'});
  report.version = 4;
  if (report.metadata) report.metadata = {...report.metadata, version: 4, asset: contract?.asset,
    inheritedChecks: 'Unchanged strict v3 binary/PBR/resource/rotor/seven-clearance checks. Only dispatch version and asset fields are adapted in memory.'};
  if (contract?.version !== 4 || contract?.asset !== 'workshop-runtime-v4.glb') report.errors.push('Contract: expected version4 / workshop-runtime-v4.glb');
  try {
    const parsed = parseGLB(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    report.glassSurface = verifyGlassSurfaceV4(parsed);
  } catch (error) {
    report.glassSurface = {ok: false, error: error.message};
    report.errors.push(error.message);
  }
  report.ok = report.errors.length === 0;
  report.status = report.ok ? 'verified' : 'failed';
  // Feature coverage and auxiliary files have not yet been verified here.
  report.readyForIntegration = false;
  return report;
}

async function immutableFile([relative, expectedSha256]) {
  const file = path.join(ROOT, relative), bytes = await readFile(file), sha256 = hash(bytes);
  return {ok: sha256 === expectedSha256, file, bytes: bytes.length, sha256, expectedSha256};
}

export async function verifyWorkshopRuntimeV4(file = DEFAULT_FILE, {writeReport = true} = {}) {
  const input = file instanceof URL ? fileURLToPath(file) : path.resolve(file), directory = path.dirname(input);
  const contractFile = path.join(directory, 'asset-contract-v4.json'), featureFile = path.join(directory, 'features-v4.json');
  const paths = [input, contractFile, featureFile], results = await Promise.allSettled(paths.map(p => readFile(p)));
  const missing = results.flatMap((r, i) => r.status === 'rejected' && r.reason.code === 'ENOENT' ? [paths[i]] : []);
  const pending = list => ({receipt: {ok: null, version: 4, status: 'pending', file: input, missing: list, errors: [], readyForIntegration: false}, output: null});
  if (missing.length && results.every(r => r.status === 'fulfilled' || r.reason.code === 'ENOENT')) return pending(missing);
  let receipt;
  try {
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    const bytes = results[0].value, contract = JSON.parse(results[1].value);
    receipt = {...verifyV4Buffer(bytes, contract), file: input, contractFile, featureFile};
    const parsed = parseGLB(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    receipt.featureEvidence = await verifyFeaturesV4(parsed, JSON.parse(results[2].value), {assetSha256: hash(bytes), loadAsset: assetLoader(directory)});
    receipt.surroundings = await verifyWorkshop360V4({requireStable:true,writeReport:false});
    check(receipt.surroundings.ok,'Paired 360 artifact is not stable: '+JSON.stringify(receipt.surroundings.errors));
    const baselines = await Promise.allSettled(BASELINES.map(immutableFile));
    receipt.immutableBaselines = baselines.map((r, i) => r.status === 'fulfilled' ? r.value :
      {ok: false, file: path.join(ROOT, BASELINES[i][0]), error: r.reason.message});
    for (const baseline of receipt.immutableBaselines) if (!baseline.ok) receipt.errors.push('Immutable baseline changed/unreadable: ' + baseline.file);
    check(hash(await readFile(input)) === hash(bytes), 'Candidate changed during verification');
  } catch (error) {
    if (error.code === 'ENOENT') return pending([error.path ?? error.message]);
    receipt = {...receipt, version: 4, file: input, contractFile, featureFile, errors: [...(receipt?.errors ?? []), error.message]};
  }
  receipt.ok = receipt.errors.length === 0;
  receipt.status = receipt.ok ? 'verified' : 'failed';
  receipt.readyForIntegration = receipt.ok && receipt.metadata?.ready === true && receipt.featureEvidence?.coverage.allDeclaredImplemented === true;
  receipt.scope = {binaryAndPBR: true, strictRotorAndClearances: true, frozenBaselines: 6, auxiliaryAssetsDecoded: true,
    evidenceReferences: true, visualClaimsVerified: false, runtimeIntegrationVerified: false, BlenderExecution: false};
  const output = writeReport ? path.join(directory, 'verification-v4.json') : null;
  if (output) await writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
  return {receipt, output};
}

async function selfTest() {
  const hdr = () => Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n'), Buffer.from([128, 64, 32, 129, 64, 32, 16, 129])]);
  const night = {version: 4, variant: 'night', lights: [{name: 'Lamp', type: 'POINT', position: [0, 1, 0], colorLinear: [1, .5, .2], scaledWatts: 20}]};
  const digest = 'a'.repeat(64), files = {'reflection-v4.hdr': hdr(), 'lighting-night-v4.json': Buffer.from(JSON.stringify(night))};
  const reference = name => ({path: name, sha256: hash(files[name])});
  const makeReceipt = () => ({version: 4, asset: 'workshop-runtime-v4.glb', assetSha256: digest,
    features: FEATURE_IDS.map(id => ({id, label: 'Feature ' + id, status: 'implemented', implementation: 'Concrete asset change ' + id,
      evidence: [{kind: 'node', name: 'Wood'}], limitations: []})),
    assets: {reflection: reference('reflection-v4.hdr'), nightLighting: reference('lighting-night-v4.json')}});
  const parsed = {json: {materials: [{name: 'Oak', pbrMetallicRoughness: {baseColorTexture: {index: 0}}}],
    images: [{name: 'Oak color'}], textures: [{source: 0}]}, primitives: [{nodeName: 'Wood', material: 0}]};
  const options = {assetSha256: digest, loadAsset: async ref => ({bytes: files[ref.path], file: ref.path, sha256: hash(files[ref.path])})};
  let passed = 0;
  const test = async (label, fn) => {await fn(); passed++; console.log(`ok ${passed} - ${label}`);};
  await test('window glass rejects double-sided blending and retains alpha 0.66', () => {
    const glass = {json: {materials: [{name: 'Workshop v4 PBR | old undulating window glass', alphaMode: 'BLEND',
      pbrMetallicRoughness: {baseColorFactor: [1, 1, 1, .6600000262260437]}}]}, primitives: [{material: 0}]};
    assert.equal(verifyGlassSurfaceV4(glass).ok, true);
    glass.json.materials[0].doubleSided = false;
    assert.equal(verifyGlassSurfaceV4(glass).ok, true);
    glass.json.materials[0].doubleSided = true;
    assert.throws(() => verifyGlassSurfaceV4(glass), /double-sided|rear surfaces/);
    glass.json.materials[0].doubleSided = false;
    glass.json.materials[0].pbrMetallicRoughness.baseColorFactor[3] = 1;
    assert.throws(() => verifyGlassSurfaceV4(glass), /alpha 0.66/);
    glass.json.materials[0].pbrMetallicRoughness.baseColorFactor[3] = .66;
    glass.primitives = [];
    assert.throws(() => verifyGlassSurfaceV4(glass), /active window glass/);
  });
  await test('decodes complete flat RGBE pixels and rejects truncation or black placeholders', () => {
    const result = verifyRadianceHDR(hdr()); assert.equal(result.width, 2); assert.equal(result.height, 1); assert.equal(result.pixels, 2);
    assert.throws(() => verifyRadianceHDR(hdr().subarray(0, -1)), /truncated|pixel/);
    const black = hdr(); black.fill(0, black.length - 8); assert.throws(() => verifyRadianceHDR(black), /black|zero/);
  });
  await test('decodes adaptive RGBE runs/literals and rejects overrun scanlines', () => {
    const header = Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 8\n');
    const body = Buffer.from([2, 2, 0, 8, 136, 128, 8, 64, 63, 62, 61, 60, 59, 58, 57, 136, 32, 136, 129]);
    const result = verifyRadianceHDR(Buffer.concat([header, body]));
    assert.equal(result.encoding, 'adaptive RLE'); assert.equal(result.decodedPixels, 8);
    assert.equal(result.meanRawRGB[1], 60.5 / 128); assert.equal(result.hasSpatialVariation, true);
    const bad = Buffer.from(body); bad[4] = 137;
    assert.throws(() => verifyRadianceHDR(Buffer.concat([header, bad])), /RLE pixel run/);
    assert.throws(() => verifyRadianceHDR(Buffer.concat([header, body.subarray(0, -1)])), /truncated pixel/);
  });
  await test('decodes legacy pixel repeats without accepting trailing pixels', () => {
    const header = Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n');
    const result = verifyRadianceHDR(Buffer.concat([header, Buffer.from([128, 64, 32, 129, 1, 1, 1, 1])]));
    assert.deepEqual(result.meanRawRGB, [1, .5, .25]);
    assert.throws(() => verifyRadianceHDR(Buffer.concat([hdr(), Buffer.from([0, 0, 0, 0])])), /trailing pixel/);
  });
  await test('chooses HDR encoding per scanline and forbids legacy runs across rows', () => {
    const header = Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 8\n');
    const adaptive = Buffer.from([2, 2, 0, 8, 136, 128, 136, 64, 136, 32, 136, 129]);
    const flat = Buffer.from(Array.from({length: 8}, () => [128, 64, 32, 129]).flat());
    assert.equal(verifyRadianceHDR(Buffer.concat([header, adaptive, flat])).decodedPixels, 16);
    const narrow = Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n');
    assert.throws(() => verifyRadianceHDR(Buffer.concat([narrow, Buffer.from([128, 64, 32, 129, 1, 1, 1, 3])])), /legacy pixel run/);
  });
  await test('rejects a namespace escape even when the requested external path does not exist', async () => {
    await assert.rejects(() => assetLoader(DIRECTORY)({path: '../__v4_missing_outside_namespace__.hdr'}), /leaves workshop namespace/);
  });
  await test('night preset requires a night variant, real lights and finite power', () => {
    assert.equal(verifyNightLighting(night).ok, true);
    assert.throws(() => verifyNightLighting({...night, variant: 'day'}), /variant/);
    assert.throws(() => verifyNightLighting({...night, lights: []}), /lights/);
    assert.throws(() => verifyNightLighting({...night, lights: [{...night.lights[0], scaledWatts: Infinity}]}), /finite|power|scaledWatts/);
  });
  await test('requires all sixteen selected IDs and evidence existing in the active GLB', async () => {
    const result = await verifyFeaturesV4(parsed, makeReceipt(), options); assert.equal(result.coverage.allDeclaredImplemented, true);
    const incomplete = makeReceipt(); incomplete.features.pop(); await assert.rejects(() => verifyFeaturesV4(parsed, incomplete, options), /IDs|missing/);
    const missing = makeReceipt(); missing.features[0].evidence = [{kind: 'node', name: 'Absent'}];
    await assert.rejects(() => verifyFeaturesV4(parsed, missing, options), /Absent|missing/);
  });
  await test('rejects unused materials/images while accepting actual active bindings', async () => {
    const unused = structuredClone(parsed);
    unused.json.materials.push({name: 'Unused material', normalTexture: {index: 1}});
    unused.json.textures.push({source: 1}); unused.json.images.push({name: 'Unused image'});
    const receipt = makeReceipt(); receipt.features[0].evidence = [{kind: 'material', name: 'Unused material'}];
    await assert.rejects(() => verifyFeaturesV4(unused, receipt, options), /Unused material|missing/);
    receipt.features[0].evidence = [{kind: 'image', name: 'Unused image'}];
    await assert.rejects(() => verifyFeaturesV4(unused, receipt, options), /Unused image|missing/);
    receipt.features[0].evidence = [{kind: 'material', name: 'Oak'}, {kind: 'image', name: 'Oak color'}];
    assert.equal((await verifyFeaturesV4(unused, receipt, options)).ok, true);
  });
  await test('rejects flags-only claims and stale asset or auxiliary checksums', async () => {
    const flags = makeReceipt(); flags.features[0] = {id: 4, implemented: true};
    await assert.rejects(() => verifyFeaturesV4(parsed, flags, options), /status|implementation|label/);
    const stale = makeReceipt(); stale.assetSha256 = 'b'.repeat(64);
    await assert.rejects(() => verifyFeaturesV4(parsed, stale, options), /SHA|checksum/);
    const changed = makeReceipt(); changed.assets.reflection.sha256 = 'b'.repeat(64);
    await assert.rejects(() => verifyFeaturesV4(parsed, changed, options), /SHA|checksum/);
  });
  await test('rejects an unbound receipt when both expected and declared GLB hashes are absent', async () => {
    const receipt = makeReceipt(); delete receipt.assetSha256;
    await assert.rejects(() => verifyFeaturesV4(parsed, receipt, {...options, assetSha256: undefined}), /SHA|checksum/);
  });
  await test('partial coverage stays explicit without claiming visual or runtime validation', async () => {
    const receipt = makeReceipt(); receipt.features[0].status = 'partial'; receipt.features[0].limitations = ['Integration pending'];
    const result = await verifyFeaturesV4(parsed, receipt, options);
    assert.equal(result.coverage.allDeclaredImplemented, false); assert.equal(result.visualClaimsVerified, false);
    assert.equal(result.runtimeIntegrationVerified, false);
  });
  return {ok: true, tests: passed};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--self-test')) console.log(JSON.stringify(await selfTest()));
    else {
      const {receipt, output} = await verifyWorkshopRuntimeV4(process.argv[2] ?? DEFAULT_FILE);
      console.log(JSON.stringify({ok: receipt.ok, status: receipt.status, report: output, missing: receipt.missing,
        readyForIntegration: receipt.readyForIntegration, bytes: receipt.glb?.bytes, sha256: receipt.glb?.sha256,
        triangles: receipt.glb?.triangles, drawGroups: receipt.glb?.drawGroups, textureObjectMiB: receipt.resourceBudget?.textureObjectMiB,
        features: receipt.featureEvidence?.coverage, auxiliaryAssets: receipt.featureEvidence && {
          reflection: {path: receipt.featureEvidence.assets.reflection.path, pixels: receipt.featureEvidence.assets.reflection.decodedPixels},
          night: {path: receipt.featureEvidence.assets.nightLighting.path, lights: receipt.featureEvidence.assets.nightLighting.lights}},
        crossingClearance: receipt.crossingClearance?.checks.map(c => ({id: c.id, axis: c.axis, gap: c.measuredClearance, ok: c.ok})),
        immutableBaselines: receipt.immutableBaselines?.map(b => ({file: b.file, ok: b.ok, sha256: b.sha256})), errors: receipt.errors}, null, 2));
      if (receipt.ok === false) process.exitCode = 1;
    }
  } catch (error) {console.error(JSON.stringify({ok: false, error: error.message})); process.exitCode = 1;}
}
