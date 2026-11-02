// Offline release checks for the existing v4 surroundings. Never rebuild GLBs.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseGLB} from '../public/rendering/glb.js';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('public/assets/environment/workshop/', ROOT);
const CURRENT = 'workshop-360-v4.glb', ORIGINAL = 'workshop-360.glb';
const EXPECTED = '5bc507ab91bf5e0a39a827d2eb35ad81ff8494f83e952f2499dd15c483c408a4';
const ORIGINAL_SHA = '18a1d202cee0b05b0b627880e775906350b877bf6e159099d607d0c70575e7d2';
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (value, message) => assert.ok(value, message);
const near = (a, b, tolerance = 1e-5) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < tolerance;
const decode = bytes => parseGLB(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

// Moller-Trumbore, two-sided, using the builder's unchanged tolerances.
export function rayTriangle(origin, direction, triangle, maxDistance) {
  const [a, b, c] = triangle;
  const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
  const fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
  const hx = direction[1] * fz - direction[2] * fy;
  const hy = direction[2] * fx - direction[0] * fz;
  const hz = direction[0] * fy - direction[1] * fx;
  const determinant = ex * hx + ey * hy + ez * hz;
  if (Math.abs(determinant) < 1e-10) return null;
  const sx = origin[0] - a[0], sy = origin[1] - a[1], sz = origin[2] - a[2];
  const u = (sx * hx + sy * hy + sz * hz) / determinant;
  if (u < -1e-8 || u > 1 + 1e-8) return null;
  const qx = sy * ez - sz * ey, qy = sz * ex - sx * ez, qz = sx * ey - sy * ex;
  const v = (direction[0] * qx + direction[1] * qy + direction[2] * qz) / determinant;
  if (v < -1e-8 || u + v > 1 + 1e-8) return null;
  const distance = (fx * qx + fy * qy + fz * qz) / determinant;
  return distance > 1e-7 && distance <= maxDistance ? distance : null;
}

function triangles(asset) {
  const result = [];
  for (const part of asset.primitives) {
    // All node transforms are required to be identity before this helper runs.
    for (let i = 0; i < part.indices.length; i += 3) result.push([0, 1, 2].map(corner => {
      const offset = part.indices[i + corner] * 3;
      return [...part.positions.subarray(offset, offset + 3)];
    }));
  }
  return result;
}
function hits(geometry, origin, direction, distance) {
  let count = 0, nearest = Infinity;
  for (const triangle of geometry) {
    const hit = rayTriangle(origin, direction, triangle, distance);
    if (hit !== null) {count++; nearest = Math.min(nearest, hit);}
  }
  return {count, nearest};
}
function binary(bytes) {
  const jsonLength = bytes.readUInt32LE(12), header = 20 + jsonLength;
  check(bytes.readUInt32LE(header + 4) === 0x004e4942, 'GLB: missing BIN chunk');
  return bytes.subarray(header + 8, header + 8 + bytes.readUInt32LE(header));
}

export function verifySurroundingsState(contract, requireStable = false) {
  check(contract.schemaVersion === 1 && contract.version === 4 && contract.asset === CURRENT,
    'Surroundings: incorrect schema/version/asset');
  check(typeof contract.stable === 'boolean', 'Surroundings: stable must be boolean');
  if (requireStable) {
    check(contract.stable === true, 'Surroundings: stable must be true for promotion');
    check(typeof contract.runtimeIntegrationVerified === 'boolean', 'Surroundings: explicit runtimeIntegrationVerified boolean required');
  } else if (contract.runtimeIntegrationVerified !== undefined) {
    check(typeof contract.runtimeIntegrationVerified === 'boolean', 'Surroundings: runtimeIntegrationVerified must be boolean');
  }
  const room = contract.cameraInterior;
  check(Array.isArray(room?.min) && Array.isArray(room.max) && room.min.length === 3 && room.max.length === 3 &&
    room.min.every((v, i) => Number.isFinite(v) && Number.isFinite(room.max[i]) && v < room.max[i]), 'Surroundings: invalid camera interior');
  return {stable: contract.stable, runtimeIntegrationVerified: contract.runtimeIntegrationVerified ?? null};
}

function windowDefinitions() {
  const s = 95 / 147, t = .3245 - 1.15 * s, rows = [];
  for (const [window, center] of [-4.65, 4.65].entries()) for (let col = 0; col < 4; col++) for (let row = 0; row < 8; row++) {
    rows.push({window, pane: [col, row], origin: [(center - 1.36 + col * .907) * s, (3.2 + row * .88) * s + t, -4.8],
      direction: [0, 0, -1], distance: 3.2});
  }
  return rows;
}
const GUARDS = [
  ['left rear return', [-9, 3, -5], [0, 0, -1], 2],
  ['right rear return', [9, 3, -5], [0, 0, -1], 2],
  ['upper rear panel', [0, 7.5, -5], [0, 0, -1], 2],
  ['bottom rear seal', [0, -.422, -5], [0, 0, -1], 2],
  ['left outer wall', [0, 3.5, 8], [-1, 0, 0], 14],
  ['right outer wall', [0, 3.5, 8], [1, 0, 0], 14],
  ['front outer wall', [0, 3.5, 8], [0, 0, 1], 10],
  ['roof', [0, 3.5, 8], [0, 1, 0], 6],
  ['floor extension', [0, 3.5, 8], [0, -1, 0], 5],
];

export function compareStoredRay(stored, actual, guard = false) {
  check(stored && stored.passed === true, 'Ray receipt: missing/failed stored row');
  for (const key of ['origin', 'direction']) assert.deepEqual(stored[key], actual[key], 'Ray receipt: changed ' + key);
  if (guard) {
    check(stored.id === actual.id && near(stored.nearestHit, actual.nearestHit) && near(stored.oldNearestHit, actual.oldNearestHit),
      'Guard receipt: id/distance differs from recomputed geometry');
  } else {
    check(stored.window === actual.window && stored.distance === actual.distance, 'Window receipt: changed window/distance');
    assert.deepEqual(stored.pane, actual.pane, 'Window receipt: changed pane');
    check(stored.oldHits === actual.oldHits && stored.v4Hits === actual.v4Hits, 'Window receipt: hit counts differ from recomputed geometry');
  }
}

function verifyPreservation(original, current, originalBytes, currentBytes, contract, oldContract) {
  const before = binary(originalBytes), after = binary(currentBytes);
  check(after.subarray(0, before.length).equals(before), 'Preservation: original binary prefix changed');
  for (const key of ['materials', 'images', 'textures', 'samplers', 'nodes', 'scenes', 'scene']) {
    assert.deepEqual(current.json[key], original.json[key], 'Preservation: changed ' + key);
  }
  for (const key of ['accessors', 'bufferViews']) {
    assert.deepEqual(current.json[key].slice(0, original.json[key].length), original.json[key], 'Preservation: original ' + key + ' changed');
    check(current.json[key].length === original.json[key].length + 5, 'Preservation: expected exactly five appended ' + key);
  }
  assert.deepEqual(current.images.map(image => hash(image.bytes)), original.images.map(image => hash(image.bytes)), 'Preservation: embedded image bytes changed');
  check(original.json.meshes.length === 14 && current.json.meshes.length === 14, 'Preservation: expected 14 meshes');
  for (let i = 0; i < original.json.meshes.length; i++) if (original.json.meshes[i].name !== 'Workshop360_wall') {
    assert.deepEqual(current.json.meshes[i], original.json.meshes[i], 'Preservation: unselected primitive changed');
  }
  const wallIndex = original.json.meshes.findIndex(mesh => mesh.name === 'Workshop360_wall');
  check(wallIndex >= 0 && current.json.meshes[wallIndex].name === 'Workshop360_wall', 'Preservation: wall primitive missing');
  const oldParts = original.primitives.filter(p => p.meshIndex === wallIndex), newParts = current.primitives.filter(p => p.meshIndex === wallIndex);
  check(oldParts.length === 1 && newParts.length === 1, 'Preservation: expected one active wall primitive');
  const a = oldParts[0], b = newParts[0], removed = new Set();
  for (let start = 0; start < a.indices.length; start += 3) {
    const selected = [0, 1, 2].every(j => {
      const i = a.indices[start + j] * 3;
      return a.positions[i + 2] > -6.481 && a.positions[i + 2] < -6.199 && Math.abs(a.positions[i]) <= 12.00001;
    });
    if (selected) removed.add(start);
  }
  check(removed.size === 12, 'Preservation: expected exactly 12 original closure triangles');
  const retained = [];
  for (let start = 0; start < a.indices.length; start += 3) if (!removed.has(start)) retained.push(...a.indices.subarray(start, start + 3));
  assert.deepEqual([...b.indices.subarray(0, retained.length)], retained, 'Preservation: unselected wall indices changed');
  for (const key of ['positions', 'normals', 'uv', 'colors']) {
    check(a[key] && b[key], 'Preservation: missing wall attribute ' + key);
    assert.deepEqual(b[key].subarray(0, a[key].length), a[key], 'Preservation: original wall attribute changed: ' + key);
  }
  check(b.indices.length - retained.length === 32 * 3 && b.positions.length - a.positions.length === 64 * 3,
    'Preservation: expected 32 new frame triangles and 64 seam vertices');
  check([...b.indices.subarray(retained.length)].every(index => index >= a.positions.length / 3), 'Preservation: frame reuses unrelated original vertices');
  const frame = verifyFrame(a, b, retained.length);
  assert.deepEqual(contract.cameraInterior, oldContract.cameraInterior, 'Preservation: cameraInterior changed');
  assert.deepEqual(contract.lighting, oldContract.lighting, 'Preservation: lighting hints changed');
  assert.deepEqual(contract.lightDirections, oldContract.lightDirections, 'Preservation: light frames changed');
  check(contract.lighting.hints.length === 2 && contract.lightDirections.lights.length === 2, 'Preservation: expected exactly two authored lights');
  return {originalBinaryPrefixExact: true, materialDefinitionsExact: true, embeddedImageBytesExact: true,
    other13PrimitivesExact: true, originalWallAttributesExact: true, unselectedWallTrianglesExact: true,
    removedClosureTriangles: removed.size, newFrameTriangles: 32, frame, cameraInteriorExact: true, twoLightingHintsExact: true};
}

function verifyFrame(original, current, retainedIndices) {
  const points = new Map(), edges = new Map(), neighbors = new Map();
  const key = p => p.map(value => Math.round(value * 1e6)).join(',');
  let volume = 0;
  for (let i = retainedIndices; i < current.indices.length; i += 3) {
    const triangle = [0, 1, 2].map(j => {
      const index = current.indices[i + j], point = [...current.positions.subarray(index * 3, index * 3 + 3)], id = key(point);
      points.set(id, point); if (!neighbors.has(id)) neighbors.set(id, new Set());
      return {point, id, index};
    });
    const [a, b, c] = triangle.map(v => v.point), u = b.map((v, j) => v - a[j]), v = c.map((x, j) => x - a[j]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], length = Math.hypot(...normal);
    check(length > 1e-12, 'Frame: degenerate triangle');
    for (const corner of triangle) {
      const n = current.normals.subarray(corner.index * 3, corner.index * 3 + 3);
      check(n.reduce((sum, value, j) => sum + value * normal[j], 0) / (Math.hypot(...n) * length) > .9999, 'Frame: corner normal disagrees with winding');
    }
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const x = triangle[a].id, y = triangle[b].id, id = [x, y].sort().join('|');
      const edge = edges.get(id) ?? {count: 0, orientation: 0}; edge.count++; edge.orientation += x < y ? 1 : -1; edges.set(id, edge);
      neighbors.get(x).add(y); neighbors.get(y).add(x);
    }
  }
  check(points.size === 16 && edges.size === 48 && [...edges.values()].every(e => e.count === 2 && e.orientation === 0),
    'Frame: not a closed consistently oriented aperture ring');
  const visited = new Set(), queue = [points.keys().next().value];
  for (let i = 0; i < queue.length; i++) if (!visited.has(queue[i])) {visited.add(queue[i]); queue.push(...neighbors.get(queue[i]));}
  check(visited.size === 16 && points.size - edges.size + 32 === 0, 'Frame: disconnected/wrong topology');
  const all = [...points.values()], low = [0, 1, 2].map(i => Math.min(...all.map(p => p[i]))), high = [0, 1, 2].map(i => Math.max(...all.map(p => p[i])));
  const innerWidth = Math.fround(7.11) - Math.fround(-7.11), innerHeight = Math.fround(6.885) - Math.fround(-.419);
  const expectedVolume = ((high[0] - low[0]) * (high[1] - low[1]) - innerWidth * innerHeight) * (high[2] - low[2]);
  check(volume > 0 && near(volume, expectedVolume), 'Frame: incorrect signed volume');
  return {manifoldAfterWeldingPositions: true, connected: true, weldedVertices: 16, edges: 48, triangles: 32,
    signedVolume: volume, expectedVolume, normalsMatchWinding: true};
}

/** Stable certifies this offline artifact. Runtime integration is an independent
 * boolean declaration; this verifier never executes a GPU or changes that flag. */
export async function verifyWorkshop360V4({requireStable = false, writeReport = false} = {}) {
  const report = {ok: false, version: 4, file: CURRENT, errors: [], checks: {}, requireStable,
    scope: {offlineArtifactVerification: true, GPUExecuted: false, runtimeIntegrationIndependentlyVerified: false}};
  try {
    check(typeof requireStable === 'boolean' && typeof writeReport === 'boolean', 'Options must be boolean');
    const names = [CURRENT, ORIGINAL, 'workshop-360-v4.json', 'workshop-360.json', 'workshop-runtime-v4.glb'];
    const bytes = await Promise.all(names.map(file => readFile(new URL(file, OUT))));
    const [currentBytes, originalBytes, contractBytes, oldContractBytes, mainBytes] = bytes;
    const contract = JSON.parse(contractBytes), oldContract = JSON.parse(oldContractBytes);
    Object.assign(report, verifySurroundingsState(contract, requireStable));
    const current = decode(currentBytes), original = decode(originalBytes), sha256 = hash(currentBytes);
    Object.assign(report, {glbSha256: sha256, sha256, bytes: currentBytes.length, contractSha256: hash(contractBytes)});
    check(sha256 === EXPECTED && contract.sha256 === sha256, 'Current GLB/contract differs from frozen SHA256');
    check(hash(originalBytes) === ORIGINAL_SHA && oldContract.sha256 === ORIGINAL_SHA, 'Original GLB/contract differs from frozen SHA256');
    check(contract.protected360?.sha256 === ORIGINAL_SHA && contract.protected360.asset === ORIGINAL, 'Protected original reference mismatch');
    check(contract.selectedV4?.asset === 'workshop-runtime-v4.glb' && contract.selectedV4.sha256 === hash(mainBytes), 'Selected main GLB reference mismatch');
    report.checks.sha256 = true;
    const triangleCount = current.primitives.reduce((n, p) => n + p.indices.length / 3, 0);
    Object.assign(report, {triangles: triangleCount, groups: current.primitives.length, materials: current.materials.length,
      embeddedImages: current.images.length, bounds: current.bounds});
    check(currentBytes.length === contract.bytes && currentBytes.length < 12 * 1024 * 1024, 'Download budget/declared bytes mismatch');
    check(triangleCount === 33440 && triangleCount === contract.triangles && triangleCount < 50000, 'Triangle count/budget mismatch');
    check(current.primitives.length === 14 && current.primitives.length === contract.batches && current.primitives.length <= 18, 'Draw-group count/budget mismatch');
    check(current.materials.length === 14 && current.images.length === 33, 'Expected 14 materials and 33 embedded images');
    check(current.skins.length === 0 && !(current.json.animations?.length), 'Surroundings must remain static');
    for (const asset of [original, current]) for (const p of asset.primitives) {
      assert.deepEqual([...p.worldMatrix], IDENTITY, 'Surroundings mesh transform must be identity');
      check(p.normals && p.uv && p.colors && /^Workshop360_/.test(p.nodeName), 'Surroundings lost attributes/name');
    }
    assert.deepEqual(current.bounds, contract.bounds, 'Geometry bounds differ from contract');
    report.checks.selfContainedStaticGeometry = report.checks.boundsAndBudgets = true;
    report.preservation = verifyPreservation(original, current, originalBytes, currentBytes, contract, oldContract);
    report.checks.originalPreservation = true;
    const before = triangles(original), after = triangles(current), stored = contract.verification;
    for (const triangle of after) check([0, 1, 2].some(axis => Math.max(...triangle.map(p => p[axis])) < contract.cameraInterior.min[axis] ||
      Math.min(...triangle.map(p => p[axis])) > contract.cameraInterior.max[axis]), 'Geometry enters the conservative camera interior');
    report.checks.cameraInteriorClear = true;
    check(stored?.passed === true && stored.windowProjectionRays?.length === 64 && stored.closedRoomGuards?.length === 9,
      'Stored geometry proof must contain 64 windows and 9 guards');
    report.windowProjectionRays = windowDefinitions().map((row, i) => {
      const oldHits = hits(before, row.origin, row.direction, row.distance), newHits = hits(after, row.origin, row.direction, row.distance);
      check(oldHits.count > 0 && newHits.count === 0, 'Window aperture obstructed at ' + row.window + ':' + row.pane);
      const result = {...row, oldHits: oldHits.count, v4Hits: newHits.count, passed: true};
      compareStoredRay(stored.windowProjectionRays[i], result); return result;
    });
    report.closedRoomGuards = GUARDS.map(([id, origin, direction, distance], i) => {
      const oldHit = hits(before, origin, direction, distance), newHit = hits(after, origin, direction, distance);
      check(oldHit.count > 0 && newHit.count > 0 && near(oldHit.nearest, newHit.nearest), 'Protected closure missing/moved: ' + id);
      const result = {id, origin, direction, distance, oldNearestHit: oldHit.nearest, nearestHit: newHit.nearest, passed: true};
      compareStoredRay(stored.closedRoomGuards[i], result, true); return result;
    });
    report.checks.windowApertures64 = report.checks.closedRoomGuards9 = report.checks.storedProofMatchesGeometry = true;
    for (let i = 0; i < names.length; i++) check(hash(await readFile(new URL(names[i], OUT))) === hash(bytes[i]), 'Input changed during verification: ' + names[i]);
    report.checks.inputsUnchanged = true;
    report.ok = true;
  } catch (error) {report.errors.push(error.message);}
  if (writeReport) {
    const file = new URL('verification-360-v4.json', OUT);
    report.reportFile = fileURLToPath(file);
    await writeFile(file, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

async function selfTest() {
  const triangle = [[-1, -1, 2], [1, -1, 2], [0, 1, 2]];
  assert.equal(rayTriangle([0, 0, 0], [0, 0, 1], triangle, 3), 2);
  assert.equal(rayTriangle([0, 0, 0], [0, 0, 1], [...triangle].reverse(), 3), 2);
  assert.equal(rayTriangle([0, 0, 0], [0, 0, 1], triangle, 2), 2);
  assert.equal(rayTriangle([0, 0, 0], [0, 0, 1], triangle, 1.99), null);
  assert.equal(rayTriangle([0, 0, 3], [0, 0, 1], triangle, 3), null);
  assert.equal(rayTriangle([0, 0, 0], [1, 0, 0], triangle, 3), null);
  assert.equal(rayTriangle([3, 0, 0], [0, 0, 1], triangle, 3), null);
  assert.equal(rayTriangle([0, 0, 0], [0, 0, 1], [[0, 0, 2], [1, 0, 2], [2, 0, 2]], 3), null);
  console.log('ok 1 - two-sided finite-segment triangle intersection, misses and degeneracies');
  const c = {schemaVersion: 1, version: 4, asset: CURRENT, stable: false, cameraInterior: {min: [-1, -1, -1], max: [1, 1, 1]}};
  assert.equal(verifySurroundingsState(c).stable, false);
  assert.throws(() => verifySurroundingsState(c, true), /stable must be true/);
  c.stable = true; assert.throws(() => verifySurroundingsState(c, true), /explicit runtimeIntegrationVerified/);
  for (const value of [false, true]) {c.runtimeIntegrationVerified = value; assert.equal(verifySurroundingsState(c, true).runtimeIntegrationVerified, value);}
  c.runtimeIntegrationVerified = 'false'; assert.throws(() => verifySurroundingsState(c, true), /boolean/);
  console.log('ok 2 - stable release gate remains independent of explicit runtime integration flag');
  const row = {...windowDefinitions()[0], oldHits: 2, v4Hits: 0, passed: true};
  compareStoredRay(row, row);
  assert.throws(() => compareStoredRay({...row, v4Hits: 2}, row), /hit counts/);
  assert.throws(() => compareStoredRay({...row, passed: false}, row), /stored row/);
  assert.throws(() => compareStoredRay({...row, origin: [0, 0, 0]}, row), /changed origin/);
  console.log('ok 3 - stored flags cannot substitute for recomputed windows or change test rays');
  const guard = {id: 'roof', origin: [0, 3.5, 8], direction: [0, 1, 0], nearestHit: 4.56, oldNearestHit: 4.56, passed: true};
  compareStoredRay(guard, guard, true);
  assert.throws(() => compareStoredRay({...guard, nearestHit: 1}, guard, true), /distance/);
  assert.throws(() => compareStoredRay({...guard, id: 'other'}, guard, true), /distance/);
  assert.equal(windowDefinitions().length, 64); assert.equal(GUARDS.length, 9);
  assert.equal(new Set(windowDefinitions().map(row => row.window + ':' + row.pane)).size, 64);
  console.log('ok 4 - guards preserve measured distances and definitions cover all 64 panes');
  return {ok: true, tests: 4};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--self-test')) console.log(JSON.stringify(await selfTest()));
    else {
      const report = await verifyWorkshop360V4({requireStable: process.argv.includes('--require-stable'), writeReport: process.argv.includes('--write-report')});
      console.log(JSON.stringify({...report, windowProjectionRays: report.windowProjectionRays?.length,
        closedRoomGuards: report.closedRoomGuards?.length}, null, 2));
      if (!report.ok) process.exitCode = 1;
    }
  } catch (error) {console.error(JSON.stringify({ok: false, error: error.message})); process.exitCode = 1;}
}
