// Verification for the separately versioned workshop and its runtime fan rotor.
// Usage: node scripts/verify-workshop-runtime-v2.mjs [workshop-runtime-v2.glb]
//        node scripts/verify-workshop-runtime-v2.mjs --self-test
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyGlbBuffer, verifyCoordinateContract} from './verify-workshop-glb.mjs';
import {parseGLB} from '../public/rendering/glb.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_FILE = path.join(ROOT, 'public/assets/environment/workshop/workshop-runtime-v2.glb');
const SOURCE_FILE = path.join(ROOT, 'output/blender/WaterDuel_Atelier.blend');
const V1_FILE = path.join(ROOT, 'public/assets/environment/workshop/workshop-runtime.glb');
const SOURCE_SHA = '2e92513be1f17a2e2d5cc357dddc8cd8d0e1dd62abbde226f4ec09c3a717b755';
const V1_SHA = '1eb31ceef5913e3cce87cdc4397b5223ad678028957933de78e9b930c950c66d';
const ROTOR_NAME = 'Workshop_FanRotor';
const SOURCE_BLADES = Array.from({length: 5}, (_, i) => `Fan swept brass blade ${String(i + 1).padStart(2, '0')}`);
const TOLERANCE = 1e-5, MiB = 1024 * 1024;
const LIMITS = {triangles: 500_000, drawGroups: 60, fileBytes: 64 * MiB, textureBytesWithMipmaps: 200 * MiB};
const check = (condition, message) => assert.ok(condition, message);
const near = (a, b, tolerance = TOLERANCE) => Math.abs(a - b) <= tolerance;
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translation = p => {const m = identity(); m.splice(12, 3, ...p); return m;};
const multiply = (a, b) => Array.from({length: 16}, (_, i) => {
  const row = i % 4, col = Math.floor(i / 4);
  return [0, 1, 2, 3].reduce((sum, k) => sum + a[k * 4 + row] * b[col * 4 + k], 0);
});
const point = (m, p, offset = 0) => [0, 1, 2].map(i =>
  m[i] * p[offset] + m[4 + i] * p[offset + 1] + m[8 + i] * p[offset + 2] + m[12 + i]);
const rotationZ = angle => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};
function vector(value, length, label) {
  check(Array.isArray(value) && value.length === length && value.every(Number.isFinite), `${label}: invalid finite vector`);
  return value;
}
function finiteJSON(value, label = 'Contract') {
  if (typeof value === 'number') check(Number.isFinite(value), `${label}: non-finite number`);
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) finiteJSON(child, `${label}.${key}`);
  }
}
function bounds(positions, matrix = identity()) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (const [axis, v] of point(matrix, positions, i).entries()) {
    check(Number.isFinite(v), 'Fan: non-finite vertex'); min[axis] = Math.min(min[axis], v); max[axis] = Math.max(max[axis], v);
  }
  return {min, max, size: max.map((v, i) => v - min[i])};
}
const positionKey = p => p.map(v => Math.round(v / TOLERANCE)).join(',');
function triangleKey(primitive, index) {
  return [0, 1, 2].map(i => positionKey(point(primitive.worldMatrix, primitive.positions,
    primitive.indices[index + i] * 3))).sort().join('|');
}

function checkStaticDuplicates(parsed, rotor) {
  const rotorVertices = new Set(), rotorTriangles = new Set(), matchedVertices = new Set();
  for (let i = 0; i < rotor.positions.length; i += 3) rotorVertices.add(positionKey(point(rotor.worldMatrix, rotor.positions, i)));
  for (let i = 0; i < rotor.indices.length; i += 3) rotorTriangles.add(triangleKey(rotor, i));
  let matchedTriangles = 0, staticPrimitives = 0;
  for (const primitive of parsed.primitives) {
    if (primitive.nodeIndex === rotor.nodeIndex) continue;
    staticPrimitives++;
    for (let i = 0; i < primitive.positions.length; i += 3) {
      const key = positionKey(point(primitive.worldMatrix, primitive.positions, i));
      if (rotorVertices.has(key)) matchedVertices.add(key);
    }
    for (let i = 0; i < primitive.indices.length; i += 3) {
      if (rotorTriangles.has(triangleKey(primitive, i))) matchedTriangles++;
    }
  }
  const overlap = matchedVertices.size / rotorVertices.size;
  check(matchedTriangles === 0, `Fan: duplicate static rotor triangles (${matchedTriangles})`);
  check(matchedVertices.size < Math.max(8, rotorVertices.size * .25),
    `Fan: substantial duplicate static rotor vertex overlap (${matchedVertices.size}/${rotorVertices.size})`);
  return {ok: true, staticPrimitives, rotorUniqueVertices: rotorVertices.size, matchedStaticTriangles: matchedTriangles,
    matchedStaticUniqueVertices: matchedVertices.size, matchedVertexFraction: overlap, positionTolerance: TOLERANCE,
    scope: 'Compares quantized world-space triangles and substantial vertex overlap at rest; does not prove absence of remodelled duplicates.'};
}

export function verifyFanRotor(parsed, fan) {
  check(fan && fan.name === ROTOR_NAME, `Fan: expected name ${ROTOR_NAME}`);
  const pivot = vector(fan.pivot, 3, 'Fan pivot'), axis = vector(fan.axis, 3, 'Fan axis');
  check(axis.every((v, i) => near(v, [0, 0, 1][i], 1e-8)), 'Fan axis: expected runtime world +Z');
  check(fan.coordinateSpace === 'runtime world', 'Fan: expected runtime world coordinateSpace');
  check(Number.isFinite(fan.angularSpeed) && near(fan.angularSpeed, 7.2, 1e-8), 'Fan angularSpeed: expected 7.2 radians/second');
  check(Array.isArray(fan.sourceObjects) && fan.sourceObjects.length === 5 &&
    [...fan.sourceObjects].sort().every((name, i) => name === [...SOURCE_BLADES].sort()[i]),
  'Fan: expected exactly the five source blade names');
  const json = parsed.json, matches = json.nodes.map((node, index) => ({node, index})).filter(({node}) => node.name === ROTOR_NAME);
  check(matches.length === 1, 'Fan: expected exactly one rotor node');
  const {node, index} = matches[0], translationValue = vector(node.translation, 3, 'Fan node.translation');
  check(translationValue.every((v, i) => near(v, pivot[i])), 'Fan node.translation: does not match runtime pivot');
  check(node.matrix === undefined && !(node.children?.length), 'Fan: rotor must use TRS with no child meshes');
  check((node.scale ?? [1, 1, 1]).every(v => near(v, 1)) &&
    (node.rotation ?? [0, 0, 0, 1]).every((v, i) => near(v, i === 3 ? 1 : 0)),
  'Fan: local rest rotation/scale must be identity');
  const world = parsed.nodes[index].worldMatrix, expectedWorld = translation(pivot);
  check(world.length === 16 && [...world].every((v, i) => near(v, expectedWorld[i])),
    'Fan: rest world matrix must be translation(pivot), without inherited rotation/scale');
  let staticMeshNodes = 0;
  for (const [nodeIndex, staticNode] of json.nodes.entries()) {
    if (nodeIndex === index || staticNode.mesh === undefined) continue;
    const matrix = parsed.nodes[nodeIndex]?.worldMatrix;
    check(matrix && [...matrix].every((v, i) => near(v, identity()[i])),
      `Static mesh ${staticNode.name ?? nodeIndex}: world transform must be identity`);
    staticMeshNodes++;
  }
  check(Number.isInteger(node.mesh) && json.meshes[node.mesh]?.primitives.length === 1,
    'Fan: expected single mesh primitive/material');
  check(json.nodes.filter(n => n.mesh === node.mesh).length === 1, 'Fan: duplicate node instance of rotor mesh');
  check(!json.nodes.some((n, i) => i !== index && SOURCE_BLADES.includes(n.name)), 'Fan: source blade node remains static');
  const dynamic = parsed.primitives.filter(primitive => primitive.nodeIndex === index);
  check(dynamic.length === 1 && dynamic[0].material >= 0, 'Fan: expected exactly one active primitive with PBR material');
  const rotor = dynamic[0], positions = rotor.positions;
  check(positions.length >= 9 && positions.length % 3 === 0, 'Fan: invalid local positions');
  const localBounds = bounds(positions), radiusRange = fan.expectedRadiusRange ?? [.64, .72];
  vector(radiusRange, 2, 'Fan expectedRadiusRange');
  check(radiusRange[0] > 0 && radiusRange[1] > radiusRange[0], 'Fan: invalid expected radius interval');
  let radius = 0, outermost = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const r = Math.hypot(positions[i], positions[i + 1]); if (r > radius) {radius = r; outermost = i;}
  }
  check(radius >= radiusRange[0] && radius <= radiusRange[1], `Fan local radius: ${radius} outside [${radiusRange}]`);
  check(localBounds.min[0] < 0 && localBounds.max[0] > 0 && localBounds.min[1] < 0 && localBounds.max[1] > 0 &&
    Math.max(Math.abs(localBounds.min[2]), Math.abs(localBounds.max[2])) < radius * .5,
  'Fan: local blades must straddle the pivot in XY and lie in a thin Z slab');
  const inversePivot = translation(pivot.map(v => -v)), samples = [];
  let maxRadiusDrift = 0, maxAxialDrift = 0, maxPivotDrift = 0, maxRestoreError = 0;
  for (const degrees of [0, 90, 180, 360]) {
    const angle = degrees * Math.PI / 180;
    const orbit = multiply(multiply(translation(pivot), rotationZ(angle)), inversePivot);
    const model = multiply(orbit, world), movedPivot = point(orbit, pivot);
    let maxVertexDisplacement = 0;
    maxPivotDrift = Math.max(maxPivotDrift, Math.hypot(...movedPivot.map((v, i) => v - pivot[i])));
    for (let i = 0; i < positions.length; i += 3) {
      const rest = point(world, positions, i), moved = point(model, positions, i);
      maxRadiusDrift = Math.max(maxRadiusDrift,
        Math.abs(Math.hypot(moved[0] - pivot[0], moved[1] - pivot[1]) - Math.hypot(rest[0] - pivot[0], rest[1] - pivot[1])));
      maxAxialDrift = Math.max(maxAxialDrift, Math.abs(moved[2] - rest[2]));
      maxVertexDisplacement = Math.max(maxVertexDisplacement, Math.hypot(...moved.map((v, j) => v - rest[j])));
    }
    if (degrees === 360) maxRestoreError = maxVertexDisplacement;
    if (degrees === 90 || degrees === 180) check(maxVertexDisplacement > radius * .1, `Fan: ${degrees}-degree test did not move blades`);
    samples.push({degrees, secondsAtAngularSpeed: angle / fan.angularSpeed, modelMatrixColumnMajor: model,
      pivot: movedPivot, bounds: bounds(positions, model), outermostVertex: point(model, positions, outermost), maxVertexDisplacement});
  }
  check(maxRadiusDrift < TOLERANCE && maxAxialDrift < TOLERANCE && maxPivotDrift < TOLERANCE && maxRestoreError < TOLERANCE,
    'Fan: CPU rotation changed radius/depth/pivot or failed to restore the rest pose');
  return {ok: true, name: ROTOR_NAME, nodeIndex: index, meshIndex: node.mesh, materialIndex: rotor.material,
    pivot, axis, angularSpeed: fan.angularSpeed, angularSpeedUnit: 'radians/second', coordinateSpace: fan.coordinateSpace,
    sourceObjects: fan.sourceObjects, vertices: positions.length / 3, triangles: rotor.indices.length / 3,
    localBounds, worldBoundsAtRest: bounds(positions, world), measuredRadialRadius: radius, expectedRadiusRange: radiusRange,
    staticMeshTransforms: {ok: true, checkedNodes: staticMeshNodes, allIdentity: true},
    restWorldMatrixColumnMajor: [...world], duplicateCheck: checkStaticDuplicates(parsed, rotor),
    motion: {ok: true, convention: 'glTF column-major matrices, column vectors',
      engineFormula: 'model(theta) = T(pivot) * Rz(theta) * T(-pivot) * restWorld; theta = angularSpeed * seconds',
      localGeometryFormula: 'With restWorld=T(pivot), model(theta)=T(pivot)*Rz(theta). Apply exactly once to mesh-local vertices.',
      maxRadiusDrift, maxAxialDrift, maxPivotDrift, maxRestoreError, samples}};
}

/** Pure verification; never writes files or imports Blender. */
export function verifyV2Buffer(bytes, contract) {
  let report = {version: 2, errors: []};
  const validate = (key, fn) => {
    try {report[key] = fn();} catch (error) {report.errors.push(`${key}: ${error.message}`);}
  };
  validate('glb', () => verifyGlbBuffer(bytes));
  if (report.glb) report.errors.push(...report.glb.errors);
  validate('metadata', () => {
    finiteJSON(contract);
    check(contract.version === 2 && contract.asset === 'workshop-runtime-v2.glb', 'Contract: incorrect version or asset name');
    check(typeof contract.ready === 'boolean', 'Contract: ready must be a boolean');
    check(contract.source?.sha256 === SOURCE_SHA && path.resolve(ROOT, contract.source.path) === SOURCE_FILE,
      'Contract: immutable source path/SHA mismatch');
    check(contract.coordinateTransform?.appliedToGeometry === true && contract.coordinateTransform.nodeTransformRequired === true,
      'Contract: source conversion must be applied; nodeTransformRequired=true declares the separate rotor translation');
    check(contract.physics?.staticWaterRemoved === true, 'Contract: static water exclusion must be declared');
    return {ok: true, version: contract.version, ready: contract.ready, source: contract.source,
      staticWaterRemoved: contract.physics.staticWaterRemoved,
      scope: 'Metadata declarations; independent source/v1 file hashes are checked separately.'};
  });
  validate('coordinateContract', () => verifyCoordinateContract(contract));
  validate('fanRotor', () => {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return verifyFanRotor(parseGLB(arrayBuffer), contract.fanRotor);
  });
  if (report.glb) validate('resourceBudget', () => {
    const {triangles, drawGroups, bytes: fileBytes, decodedTextureBytesWithMipmaps: uniqueImageBytes,
      decodedTextureObjectsBytesWithMipmaps: textureObjectBytes} = report.glb;
    check(triangles <= LIMITS.triangles && drawGroups <= LIMITS.drawGroups, 'Scene exceeds triangle/draw-group limit');
    check(fileBytes <= LIMITS.fileBytes, 'GLB exceeds 64 MiB file target');
    check(uniqueImageBytes <= LIMITS.textureBytesWithMipmaps && textureObjectBytes <= LIMITS.textureBytesWithMipmaps,
      'GLB exceeds 200 MiB theoretical RGBA8 texture allocation with mipmaps');
    return {ok: true, limits: LIMITS, triangles, drawGroups, fileBytes, fileMiB: fileBytes / MiB,
      uniqueImageBytes, uniqueImageMiB: uniqueImageBytes / MiB, textureObjectBytes, textureObjectMiB: textureObjectBytes / MiB,
      estimate: 'sum(width*height*4*4/3); texture objects include repeated source images where GLB binds separate texture indices.'};
  });
  report.ok = report.errors.length === 0;
  report.status = report.ok ? 'verified' : 'failed';
  report.readyForIntegration = report.ok && contract?.ready === true;
  return report;
}

async function immutableFile(file, expectedSha256) {
  const bytes = await readFile(file), sha256 = createHash('sha256').update(bytes).digest('hex');
  return {ok: sha256 === expectedSha256, file, bytes: bytes.length, sha256, expectedSha256};
}

/** Missing v2 inputs are pending and do not overwrite any earlier receipt. */
export async function verifyWorkshopRuntimeV2(file = DEFAULT_FILE, {writeReport = true} = {}) {
  const input = file instanceof URL ? fileURLToPath(file) : path.resolve(file);
  const directory = path.dirname(input), contractFile = path.join(directory, 'asset-contract-v2.json');
  const results = await Promise.allSettled([readFile(input), readFile(contractFile, 'utf8')]);
  const missing = results.map((result, i) => result.status === 'rejected' && result.reason.code === 'ENOENT'
    ? [input, contractFile][i] : null).filter(Boolean);
  if (missing.length && results.every(result => result.status === 'fulfilled' || result.reason.code === 'ENOENT')) {
    return {receipt: {ok: null, status: 'pending', version: 2, file: input, contractFile, missing,
      readyForIntegration: false, errors: []}, output: null};
  }
  let receipt;
  try {
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    const contract = JSON.parse(results[1].value);
    receipt = {...verifyV2Buffer(results[0].value, contract), file: input, contractFile};
    const preservation = await Promise.allSettled([immutableFile(SOURCE_FILE, SOURCE_SHA), immutableFile(V1_FILE, V1_SHA)]);
    receipt.immutableBaselines = preservation.map((result, i) => result.status === 'fulfilled' ? result.value :
      {ok: false, file: [SOURCE_FILE, V1_FILE][i], error: result.reason.message});
    for (const baseline of receipt.immutableBaselines) if (!baseline.ok) receipt.errors.push(`Immutable baseline: ${baseline.file}: ${baseline.error ?? 'SHA256 changed'}`);
  } catch (error) {
    receipt = {...receipt, version: 2, file: input, contractFile, errors: [...(receipt?.errors ?? []), error.message]};
  }
  receipt.ok = receipt.errors.length === 0;
  receipt.status = receipt.ok ? 'verified' : 'failed';
  receipt.readyForIntegration = receipt.ok && receipt.metadata?.ready === true;
  receipt.scope = {binaryAndPBR: true, runtimeParser: true, CPUFanRotation: true, immutableFiles: true,
    renderOrGPUExecution: false, note: 'This receipt verifies asset structure and CPU transforms; render/reimport and game integration are separate checks.'};
  const output = writeReport ? path.join(directory, 'verification-v2.json') : null;
  if (output) await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  return {receipt, output};
}

function selfTest() {
  const pivot = [-4.2, 1.7, -2.2], matrix = translation(pivot);
  const positions = new Float32Array([.68, .01, .03, .52, .17, .02, -.2, -.5, -.03]);
  const fan = {name: ROTOR_NAME, pivot, axis: [0, 0, 1], angularSpeed: 7.2,
    coordinateSpace: 'runtime world', sourceObjects: SOURCE_BLADES, expectedRadiusRange: [.64, .72]};
  const fixture = () => ({json: {nodes: [{name: ROTOR_NAME, mesh: 0, translation: pivot}],
    meshes: [{primitives: [{material: 0}]}]}, nodes: [{name: ROTOR_NAME, meshIndex: 0, worldMatrix: matrix}],
    primitives: [{nodeName: ROTOR_NAME, nodeIndex: 0, meshIndex: 0, material: 0, worldMatrix: matrix,
      positions, indices: new Uint32Array([0, 1, 2])}]});
  let passed = 0;
  const test = (label, fn) => {fn(); passed++; console.log(`ok ${passed} - ${label}`);};
  test('rotor giratorio conserva pivote, radio y vuelve a su reposo tras 360 grados', () => {
    const report = verifyFanRotor(fixture(), fan);
    assert.equal(report.ok, true); assert.ok(report.motion.maxRestoreError < 1e-6);
    const quarter = report.motion.samples.find(sample => sample.degrees === 90);
    assert.ok(quarter.maxVertexDisplacement > .1);
    assert.ok(quarter.outermostVertex.every((v, i) => near(v, [-4.21, 2.38, -2.17][i])),
      'positive runtime +Z rotation must map local +X towards +Y with the pivot translation applied once');
  });
  test('rechaza translation distinta del pivote', () => {
    const p = fixture(); p.json.nodes[0].translation = [0, 0, 0];
    assert.throws(() => verifyFanRotor(p, fan), /translation|pivot/);
  });
  test('rechaza coordenadas de vértices mundiales horneadas como locales', () => {
    const p = fixture(); p.primitives[0].positions = positions.map((v, i) => v + pivot[i % 3]);
    assert.throws(() => verifyFanRotor(p, fan), /radius|local/);
  });
  test('rechaza aspas duplicadas en un grupo estático distinto', () => {
    const p = fixture(); p.json.nodes.push({name: 'Static', mesh: 1});
    p.nodes.push({name: 'Static', meshIndex: 1, worldMatrix: identity()});
    p.primitives.push({...p.primitives[0], nodeName: 'Static', nodeIndex: 1, meshIndex: 1,
      positions: positions.map((v, i) => v + pivot[i % 3]), worldMatrix: identity()});
    assert.throws(() => verifyFanRotor(p, fan), /duplicate/);
  });
  test('rechaza un transform adicional en cualquier mesh estático', () => {
    const p = fixture(); p.json.nodes.push({name: 'Static', mesh: 1});
    p.nodes.push({name: 'Static', meshIndex: 1, worldMatrix: translation([.1, 0, 0])});
    assert.throws(() => verifyFanRotor(p, fan), /Static mesh.*identity/);
  });
  test('rechaza un eje distinto al eje mundial Z', () => {
    assert.throws(() => verifyFanRotor(fixture(), {...fan, axis: [0, 1, 0]}), /axis/);
  });
  test('rechaza nodos rotor repetidos y rotor ausente', () => {
    const p = fixture(); p.json.nodes.push({...p.json.nodes[0]});
    assert.throws(() => verifyFanRotor(p, fan), /exactly one/);
    p.json.nodes = []; assert.throws(() => verifyFanRotor(p, fan), /exactly one/);
  });
  test('rechaza velocidades no finitas', () => {
    assert.throws(() => verifyFanRotor(fixture(), {...fan, angularSpeed: Infinity}), /angularSpeed/);
  });
  return {ok: true, tests: passed};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--self-test')) console.log(JSON.stringify(selfTest()));
    else {
      const {receipt, output} = await verifyWorkshopRuntimeV2(process.argv[2] ?? DEFAULT_FILE);
      console.log(JSON.stringify({ok: receipt.ok, status: receipt.status, report: output,
        readyForIntegration: receipt.readyForIntegration, missing: receipt.missing,
        bytes: receipt.glb?.bytes, sha256: receipt.glb?.sha256, triangles: receipt.glb?.triangles,
        drawGroups: receipt.glb?.drawGroups, materials: receipt.glb?.materials,
        textureObjectMiB: receipt.resourceBudget?.textureObjectMiB, fanRotor: receipt.fanRotor &&
          {name: receipt.fanRotor.name, pivot: receipt.fanRotor.pivot, measuredRadialRadius: receipt.fanRotor.measuredRadialRadius,
            duplicateCheck: receipt.fanRotor.duplicateCheck, motionPassed: receipt.fanRotor.motion.ok},
        immutableBaselines: receipt.immutableBaselines, errors: receipt.errors}, null, 2));
      if (receipt.ok === false) process.exitCode = 1;
    }
  } catch (error) {console.error(JSON.stringify({ok: false, error: error.message})); process.exitCode = 1;}
}
