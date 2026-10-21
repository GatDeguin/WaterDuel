// Independent v3 asset QA. Reuses strict v2 binary/rotor checks without executing its CLI.
// node scripts/verify-workshop-runtime-v3.mjs [workshop-runtime-v3.glb]
// node scripts/verify-workshop-runtime-v3.mjs --self-test
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyV2Buffer} from './verify-workshop-runtime-v2.mjs';
import {parseGLB} from '../public/rendering/glb.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_FILE = path.join(ROOT, 'public/assets/environment/workshop/workshop-runtime-v3.glb');
const TOLERANCE = 1e-5;
const REQUIRED_CROSSINGS = ['drafting-board', 'apron-left', 'apron-right', 'rear-pennant-left', 'rear-pennant-right'];
const FLOOR_CROSSINGS = ['apron-left-floor', 'apron-right-floor'];
const BASELINES = [
  ['output/blender/WaterDuel_Atelier.blend', '2e92513be1f17a2e2d5cc357dddc8cd8d0e1dd62abbde226f4ec09c3a717b755'],
  ['output/blender/WaterDuel_Atelier_v2.blend', 'd9c9f0bdbd58bc59c1ab1ee16422ac8ff9b7315c8ecd7436795248d47fcc2117'],
  ['public/assets/environment/workshop/workshop-runtime.glb', '1eb31ceef5913e3cce87cdc4397b5223ad678028957933de78e9b930c950c66d'],
  ['public/assets/environment/workshop/workshop-runtime-v2.glb', 'cec471597e48f5df50d23a2b7c894d01c44bce4402c607d6b001e7dd8d8d99b5'],
];
const check = (condition, message) => assert.ok(condition, message);
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const point = (matrix, positions, offset) => [0, 1, 2].map(i => matrix[i] * positions[offset] +
  matrix[4 + i] * positions[offset + 1] + matrix[8 + i] * positions[offset + 2] + matrix[12 + i]);
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function finiteVector(value, label) {
  check(Array.isArray(value) && value.length === 3 && value.every(Number.isFinite), `${label}: expected finite VEC3`);
  return value;
}
function regionBox(region, label) {
  check(region, `${label}: missing region`);
  const min = finiteVector(region.min, label), max = finiteVector(region.max, label);
  check(min.every((v, i) => v < max[i]), `${label}: empty/reversed region`);
  return {center: min.map((v, i) => (v + max[i]) / 2), half: min.map((v, i) => (max[i] - v) / 2)};
}

// Separating-axis test includes long triangles whose centroids lie outside the
// region. It intentionally counts contact within the fixed numerical tolerance.
function triangleIntersectsBox(triangle, box) {
  const p = triangle.map(v => subtract(v, box.center));
  for (let i = 0; i < 3; i++) if (Math.min(...p.map(v => v[i])) > box.half[i] + TOLERANCE ||
    Math.max(...p.map(v => v[i])) < -box.half[i] - TOLERANCE) return false;
  const edges = [subtract(p[1], p[0]), subtract(p[2], p[1]), subtract(p[0], p[2])];
  const axes = [cross(edges[0], edges[1])];
  for (const edge of edges) for (const basis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) axes.push(cross(edge, basis));
  for (const axis of axes) {
    const length = Math.hypot(...axis); if (length < 1e-12) continue;
    const projection = p.map(v => dot(v, axis)), radius = dot(axis.map(Math.abs), box.half);
    if (Math.min(...projection) > radius + TOLERANCE * length || Math.max(...projection) < -radius - TOLERANCE * length) return false;
  }
  return true;
}

const triangleAt = (primitive, ordinal) => [0, 1, 2].map(j =>
  point(primitive.worldMatrix, primitive.positions, primitive.indices[ordinal * 3 + j] * 3));
const emptyBounds = () => ({min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]});
function include(bounds, triangle) {
  for (const vertex of triangle) for (let axis = 0; axis < 3; axis++) {
    check(Number.isFinite(vertex[axis]), 'Selection: non-finite geometry');
    bounds.min[axis] = Math.min(bounds.min[axis], vertex[axis]); bounds.max[axis] = Math.max(bounds.max[axis], vertex[axis]);
  }
}

function componentsFor(primitive, cache) {
  if (cache.has(primitive)) return cache.get(primitive);
  const count = primitive.indices.length / 3, parent = Int32Array.from({length: count}, (_, i) => i), positions = new Map();
  const find = i => {while (parent[i] !== i) {parent[i] = parent[parent[i]]; i = parent[i];} return i;};
  for (let i = 0; i < count; i++) for (const vertex of triangleAt(primitive, i)) {
    const key = vertex.map(v => Math.round(v / TOLERANCE)).join(',');
    if (positions.has(key)) parent[find(i)] = find(positions.get(key)); else positions.set(key, i);
  }
  const groups = new Map(), componentByTriangle = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const root = find(i); componentByTriangle[i] = root;
    if (!groups.has(root)) groups.set(root, {triangles: [], bounds: emptyBounds()});
    const group = groups.get(root); group.triangles.push(i); include(group.bounds, triangleAt(primitive, i));
  }
  const result = {groups, componentByTriangle}; cache.set(primitive, result); return result;
}

function selectedBounds(parsed, selector, label, cache) {
  check(Array.isArray(selector?.nodeNames) && selector.nodeNames.length > 0 &&
    selector.nodeNames.every(name => typeof name === 'string' && name.length > 0) &&
    new Set(selector.nodeNames).size === selector.nodeNames.length, `${label}: invalid nodeNames`);
  const box = selector.region ? regionBox(selector.region, label) : null, names = new Set(selector.nodeNames);
  const primitives = parsed.primitives.filter(p => names.has(p.nodeName));
  for (const name of names) check(primitives.filter(p => p.nodeName === name).length === 1,
    `${label}: expected one active primitive for node ${name}`);
  if (selector.triangleIndices !== undefined) check(names.size === 1, `${label}: triangleIndices requires one node; use triangleIndicesByNode for several`);
  if (selector.triangleIndicesByNode) check(Object.keys(selector.triangleIndicesByNode).length === names.size &&
    Object.keys(selector.triangleIndicesByNode).every(name => names.has(name)), `${label}: triangleIndicesByNode keys differ from nodeNames`);
  const componentBounds = selector.componentBounds;
  let tolerance = TOLERANCE;
  if (componentBounds) {
    regionBox(componentBounds, label + '.componentBounds');
    tolerance = componentBounds.tolerance ?? TOLERANCE;
    check(Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= 1e-4, `${label}: invalid componentBounds tolerance`);
  }
  const inside = bounds => bounds.min.every((v, i) => v >= componentBounds.min[i] - tolerance &&
    bounds.max[i] <= componentBounds.max[i] + tolerance);
  const measured = emptyBounds(), triangleIndicesByNode = {};
  let triangles = 0, components = 0, regionHits = 0;
  for (const primitive of primitives) {
    const info = componentsFor(primitive, cache);
    let indices = selector.triangleIndicesByNode !== undefined
      ? selector.triangleIndicesByNode[primitive.nodeName] : selector.triangleIndices;
    if (indices === undefined) {
      check(componentBounds, `${label}: requires explicit triangleIndices or componentBounds`);
      indices = [...info.groups.values()].filter(group => inside(group.bounds)).flatMap(group => group.triangles);
    }
    check(Array.isArray(indices) && indices.length > 0 && new Set(indices).size === indices.length &&
      indices.every(i => Number.isInteger(i) && i >= 0 && i < primitive.indices.length / 3),
    `${label}: empty/invalid triangleIndices for ${primitive.nodeName}`);
    const selected = new Set(indices), roots = new Set(indices.map(i => info.componentByTriangle[i]));
    for (const root of roots) check(info.groups.get(root).triangles.every(i => selected.has(i)),
      `${label}: triangleIndices omit faces of a complete connected component in ${primitive.nodeName}`);
    components += roots.size;
    for (const ordinal of indices) {
      const triangle = triangleAt(primitive, ordinal); include(measured, triangle); triangles++;
      if (box && triangleIntersectsBox(triangle, box)) regionHits++;
    }
    triangleIndicesByNode[primitive.nodeName] = [...indices].sort((a, b) => a - b);
  }
  check(triangles > 0, `${label}: selection has no triangles`);
  if (box) check(regionHits > 0, `${label}: selected components do not intersect region`);
  if (componentBounds) check(inside(measured), `${label}: measured vertices lie outside componentBounds`);
  return {nodeNames: selector.nodeNames, region: selector.region, componentBounds, triangles, components,
    completeComponents: true, componentWeldTolerance: TOLERANCE, triangleIndicesByNode, bounds: measured};
}

export function verifyCrossingClearance(parsed, proof) {
  check(proof?.coordinateSpace === 'runtime world', 'crossingClearance.coordinateSpace: expected runtime world');
  check(Array.isArray(proof.checks) && proof.checks.length > 0, 'crossingClearance.checks: missing geometric evidence');
  const ids = new Set(), cache = new WeakMap();
  const checks = proof.checks.map(item => {
    check(typeof item.id === 'string' && item.id.length > 0 && !ids.has(item.id), 'Crossing: missing/repeated id'); ids.add(item.id);
    check([0, 1, 2].includes(item.axis), `${item.id}: axis must be 0, 1 or 2`);
    check(Number.isFinite(item.minClearance) && item.minClearance > TOLERANCE, `${item.id}: invalid minClearance`);
    check(Number.isFinite(item.measuredClearance), `${item.id}: missing finite declared measuredClearance`);
    const back = selectedBounds(parsed, item.back, item.id + '.back', cache);
    const front = selectedBounds(parsed, item.front, item.id + '.front', cache);
    const measuredClearance = front.bounds.min[item.axis] - back.bounds.max[item.axis];
    check(measuredClearance + TOLERANCE >= item.minClearance,
      `${item.id}: clearance ${measuredClearance} is below required separation ${item.minClearance}`);
    check(Math.abs(measuredClearance - item.measuredClearance) <= TOLERANCE,
      `${item.id}: declared clearance ${item.measuredClearance} disagrees with measured ${measuredClearance}`);
    return {id: item.id, ok: true, axis: item.axis, minClearance: item.minClearance,
      measuredClearance, declaredClearance: item.measuredClearance, back, front};
  });
  return {ok: true, coordinateSpace: proof.coordinateSpace, numericalTolerance: TOLERANCE, checks,
    selection: 'Explicit triangle ordinals per unique node primitive, or complete components contained in componentBounds. Components weld positions across UV/normal seams at 1e-5m; optional regions use triangle/AABB SAT.',
    scope: 'Proves signed axis separation for the specified node/region pairs, not absence of all intersections throughout the workshop.'};
}

export function verifyCrossingAxes(checks) {
  for (const id of [...REQUIRED_CROSSINGS, ...FLOOR_CROSSINGS]) {
    check(checks.some(item => item.id === id), `Missing required crossing id ${id}`);
  }
  for (const item of checks) {
    const axis = FLOOR_CROSSINGS.includes(item.id) ? 1 : 2;
    check(item.axis === axis, `${item.id}: expected runtime ${axis === 1 ? 'Y floor' : 'Z depth'} separation`);
  }
}

/** Keep dispatch version adaptation isolated; all v2 rotor and resource checks remain strict. */
export function verifyV3Buffer(bytes, contract) {
  const report = verifyV2Buffer(bytes, {...contract, version: 2, asset: 'workshop-runtime-v2.glb'});
  report.version = 3;
  if (report.metadata) report.metadata = {...report.metadata, version: 3, asset: contract?.asset,
    inheritedChecks: 'v2 strict binary/PBR/coordinate/rotor/resource checks; version and asset dispatch fields adapted in memory only.'};
  if (contract?.version !== 3 || contract?.asset !== 'workshop-runtime-v3.glb') report.errors.push('Contract: expected version3 / workshop-runtime-v3.glb');
  try {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    report.crossingClearance = verifyCrossingClearance(parseGLB(arrayBuffer), contract?.crossingClearance);
    verifyCrossingAxes(report.crossingClearance.checks);
  } catch (error) {report.errors.push('crossingClearance: ' + error.message);}
  report.ok = report.errors.length === 0;
  report.status = report.ok ? 'verified' : 'failed';
  report.readyForIntegration = report.ok && contract?.ready === true;
  return report;
}

async function immutableFile(relative, expectedSha256) {
  const file = path.join(ROOT, relative), bytes = await readFile(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {ok: sha256 === expectedSha256, file, bytes: bytes.length, sha256, expectedSha256};
}

export async function verifyWorkshopRuntimeV3(file = DEFAULT_FILE, {writeReport = true} = {}) {
  const input = file instanceof URL ? fileURLToPath(file) : path.resolve(file);
  const directory = path.dirname(input), contractFile = path.join(directory, 'asset-contract-v3.json');
  const results = await Promise.allSettled([readFile(input), readFile(contractFile, 'utf8')]);
  const missing = results.map((result, i) => result.status === 'rejected' && result.reason.code === 'ENOENT'
    ? [input, contractFile][i] : null).filter(Boolean);
  if (missing.length && results.every(result => result.status === 'fulfilled' || result.reason.code === 'ENOENT')) {
    return {receipt: {ok: null, status: 'pending', version: 3, file: input, contractFile, missing,
      readyForIntegration: false, errors: []}, output: null};
  }
  let receipt;
  try {
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    receipt = {...verifyV3Buffer(results[0].value, JSON.parse(results[1].value)), file: input, contractFile};
    const preservation = await Promise.allSettled(BASELINES.map(([relative, sha]) => immutableFile(relative, sha)));
    receipt.immutableBaselines = preservation.map((result, i) => result.status === 'fulfilled' ? result.value :
      {ok: false, file: path.join(ROOT, BASELINES[i][0]), error: result.reason.message});
    for (const baseline of receipt.immutableBaselines) if (!baseline.ok) receipt.errors.push(`Immutable baseline: ${baseline.file}: ${baseline.error ?? 'SHA256 changed'}`);
  } catch (error) {
    receipt = {...receipt, version: 3, file: input, contractFile, errors: [...(receipt?.errors ?? []), error.message]};
  }
  receipt.ok = receipt.errors.length === 0;
  receipt.status = receipt.ok ? 'verified' : 'failed';
  receipt.readyForIntegration = receipt.ok && receipt.metadata?.ready === true;
  receipt.scope = {binaryAndPBR: true, runtimeParser: true, CPUFanRotation: true, declaredCrossingRegions: true,
    immutableFiles: true, renderOrGPUExecution: false};
  const output = writeReport ? path.join(directory, 'verification-v3.json') : null;
  if (output) await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  return {receipt, output};
}

function selfTest() {
  const make = (name, z) => ({nodeName: name, worldMatrix: identity(),
    positions: new Float32Array([-1, -1, z, 1, -1, z, 0, 1, z]), indices: new Uint32Array([0, 1, 2])});
  const parsed = () => ({primitives: [make('Back', 0), make('Front', .02)]});
  const region = {min: [-2, -2, -.1], max: [2, 2, .1]};
  const proof = () => ({coordinateSpace: 'runtime world', checks: [{id: 'panel', axis: 2,
    minClearance: .01, measuredClearance: .02,
    back: {nodeNames: ['Back'], triangleIndices: [0], region}, front: {nodeNames: ['Front'], triangleIndices: [0], region}}]});
  let passed = 0;
  const test = (label, fn) => {fn(); passed++; console.log(`ok ${passed} - ${label}`);};
  test('measures actual GLB separation without trusting a passed flag', () => {
    const result = verifyCrossingClearance(parsed(), proof());
    assert.equal(result.ok, true); assert.ok(Math.abs(result.checks[0].measuredClearance - .02) < TOLERANCE);
  });
  test('rejects a real crossing despite an unchanged positive declaration', () => {
    const p = parsed(); p.primitives[1] = make('Front', -.01);
    assert.throws(() => verifyCrossingClearance(p, proof()), /clearance|separation/);
  });
  test('rejects stale measured clearance and empty selectors', () => {
    const p = proof(); p.checks[0].measuredClearance = .04;
    assert.throws(() => verifyCrossingClearance(parsed(), p), /declared|measured/);
    p.checks[0].measuredClearance = .02; p.checks[0].back.region = {min: [4, 4, 4], max: [5, 5, 5]};
    assert.throws(() => verifyCrossingClearance(parsed(), p), /empty|no triangles|region/);
  });
  test('includes a long triangle crossing a region with its centroid outside', () => {
    const p = proof(); p.checks[0].back.region = p.checks[0].front.region = {min: [.8, -.9, -.1], max: [.9, -.8, .1]};
    assert.equal(verifyCrossingClearance(parsed(), p).checks[0].back.triangles, 1);
  });
  test('rejects absent evidence, invalid coordinate space and non-finite thresholds', () => {
    assert.throws(() => verifyCrossingClearance(parsed(), {passed: true}), /coordinateSpace|checks/);
    const p = proof(); p.coordinateSpace = 'source Blender';
    assert.throws(() => verifyCrossingClearance(parsed(), p), /coordinateSpace/);
    p.coordinateSpace = 'runtime world'; p.checks[0].minClearance = Infinity;
    assert.throws(() => verifyCrossingClearance(parsed(), p), /minClearance/);
  });
  test('rejects partial connected components and invalid triangle ordinals', () => {
    const p = parsed(); p.primitives[0].positions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    p.primitives[0].indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    assert.throws(() => verifyCrossingClearance(p, proof()), /complete connected component/);
    const q = proof(); q.checks[0].back.triangleIndices = [99];
    assert.throws(() => verifyCrossingClearance(parsed(), q), /triangleIndices/);
  });
  test('selects complete components by guarded bounds when ordinals are omitted', () => {
    const p = proof(); delete p.checks[0].back.triangleIndices;
    p.checks[0].back.componentBounds = {min: [-2, -2, -.01], max: [2, 2, .01], tolerance: 1e-5};
    assert.equal(verifyCrossingClearance(parsed(), p).checks[0].back.components, 1);
    p.checks[0].back.componentBounds.max[0] = .5;
    assert.throws(() => verifyCrossingClearance(parsed(), p), /triangleIndices|componentBounds/);
  });
  test('welds UV seam positions before testing component completeness', () => {
    const p = parsed(); p.primitives[0].positions = new Float32Array([
      -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]);
    p.primitives[0].indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
    assert.throws(() => verifyCrossingClearance(p, proof()), /complete connected component/);
    const q = proof(); q.checks[0].back.triangleIndices = [0, 1];
    assert.equal(verifyCrossingClearance(p, q).checks[0].back.components, 1);
  });
  test('SAT guard rejects an empty triangle corner even when AABBs overlap', () => {
    const p = proof(); p.checks[0].back.region = {min: [.8, .8, -.1], max: [.9, .9, .1]};
    assert.throws(() => verifyCrossingClearance(parsed(), p), /do not intersect region/);
  });
  test('rejects null explicit indices instead of silently selecting by bounds', () => {
    const p = proof(); delete p.checks[0].back.triangleIndices;
    p.checks[0].back.triangleIndicesByNode = {Back: null};
    p.checks[0].back.componentBounds = region;
    assert.throws(() => verifyCrossingClearance(parsed(), p), /triangleIndices/);
  });
  test('permits Y separation only for the two required floor checks', () => {
    const checks = [...REQUIRED_CROSSINGS.map(id => ({id, axis: 2})), ...FLOOR_CROSSINGS.map(id => ({id, axis: 1}))];
    assert.doesNotThrow(() => verifyCrossingAxes(checks));
    assert.throws(() => verifyCrossingAxes(checks.slice(0, -1)), /Missing required crossing/);
    assert.throws(() => verifyCrossingAxes(checks.map(item => item.id === 'drafting-board' ? {...item, axis: 1} : item)), /Z depth/);
    assert.throws(() => verifyCrossingAxes(checks.map(item => item.id === 'apron-left-floor' ? {...item, axis: 2} : item)), /Y floor/);
    assert.throws(() => verifyCrossingAxes([...checks, {id: 'arbitrary', axis: 1}]), /Z depth/);
    assert.throws(() => verifyCrossingAxes([...checks, {id: 'arbitrary', axis: 0}]), /Z depth/);
  });
  return {ok: true, tests: passed};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--self-test')) console.log(JSON.stringify(selfTest()));
    else {
      const {receipt, output} = await verifyWorkshopRuntimeV3(process.argv[2] ?? DEFAULT_FILE);
      console.log(JSON.stringify({ok: receipt.ok, status: receipt.status, report: output,
        readyForIntegration: receipt.readyForIntegration, missing: receipt.missing,
        bytes: receipt.glb?.bytes, sha256: receipt.glb?.sha256, triangles: receipt.glb?.triangles,
        drawGroups: receipt.glb?.drawGroups, textureObjectMiB: receipt.resourceBudget?.textureObjectMiB,
        crossingClearance: receipt.crossingClearance && {ok: receipt.crossingClearance.ok,
          checks: receipt.crossingClearance.checks.map(item => ({id: item.id, axis: item.axis,
            gap: item.measuredClearance, ok: item.ok}))},
        immutableBaselines: receipt.immutableBaselines, errors: receipt.errors}, null, 2));
      if (receipt.ok === false) process.exitCode = 1;
    }
  } catch (error) {console.error(JSON.stringify({ok: false, error: error.message})); process.exitCode = 1;}
}
