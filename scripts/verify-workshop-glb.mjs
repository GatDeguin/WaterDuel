// Independent verification of the final, self-contained workshop GLB.
// Usage: node scripts/verify-workshop-glb.mjs [workshop-runtime.glb]
// Format reference: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const DEFAULT_FILE = new URL('../public/assets/environment/workshop/workshop-runtime.glb', import.meta.url);
const BUDGET = {drawGroups: 60, triangles: 500_000};
const COMPONENT = {5120: [1, 'readInt8'], 5121: [1, 'readUInt8'], 5122: [2, 'readInt16LE'],
  5123: [2, 'readUInt16LE'], 5125: [4, 'readUInt32LE'], 5126: [4, 'readFloatLE']};
const WIDTH = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16};
const check = (condition, message) => assert.ok(condition, message);
const integer = (value, label, min = 0) => {
  check(Number.isSafeInteger(value) && value >= min, `${label}: invalid integer`); return value;
};
const array = (value, label) => {check(Array.isArray(value), `${label}: expected array`); return value;};
const ref = (items, index, label) => {
  integer(index, label); check(index < items.length, `${label}: index outside array`); return items[index];
};
const near = (a, b, tolerance = 1e-8) => Math.abs(a - b) <= tolerance;
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const emptyBounds = () => ({min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]});
function include(bounds, point) {
  check(point.every(Number.isFinite), 'Geometry: non-finite world vertex');
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
}
const finishBounds = bounds => ({...bounds, size: bounds.max.map((v, i) => v - bounds.min[i])});
const multiply = (a, b) => Array.from({length: 16}, (_, i) => {
  const row = i % 4, col = Math.floor(i / 4); let value = 0;
  for (let k = 0; k < 4; k++) value += a[k * 4 + row] * b[col * 4 + k]; return value;
});
const transform = (m, p, offset) => [0, 1, 2].map(row =>
  m[row] * p[offset] + m[row + 4] * p[offset + 1] + m[row + 8] * p[offset + 2] + m[row + 12]);

function finiteJSON(value, label = 'JSON') {
  if (typeof value === 'number') check(Number.isFinite(value), `${label}: non-finite number`);
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) finiteJSON(child, `${label}.${key}`);
  }
}

function nodeMatrix(node, label) {
  if (node.matrix !== undefined) {
    check(node.translation === undefined && node.rotation === undefined && node.scale === undefined,
      `${label}: matrix and TRS cannot coexist`);
    check(array(node.matrix, label).length === 16 && node.matrix.every(Number.isFinite), `${label}: invalid matrix`);
    check([3, 7, 11].every(i => near(node.matrix[i], 0)) && near(node.matrix[15], 1), `${label}: non-affine matrix`);
    return node.matrix;
  }
  const t = node.translation ?? [0, 0, 0], q = node.rotation ?? [0, 0, 0, 1], s = node.scale ?? [1, 1, 1];
  check(array(t, label).length === 3 && array(q, label).length === 4 && array(s, label).length === 3,
    `${label}: invalid TRS dimensions`);
  check([...t, ...q, ...s].every(Number.isFinite), `${label}: non-finite TRS`);
  check(near(Math.hypot(...q), 1, 1e-4), `${label}: quaternion not normalized`);
  const [x, y, z, w] = q, x2 = 2 * x, y2 = 2 * y, z2 = 2 * z;
  return [(1 - y * y2 - z * z2) * s[0], (x * y2 + w * z2) * s[0], (x * z2 - w * y2) * s[0], 0,
    (x * y2 - w * z2) * s[1], (1 - x * x2 - z * z2) * s[1], (y * z2 + w * x2) * s[1], 0,
    (x * z2 + w * y2) * s[2], (y * z2 - w * x2) * s[2], (1 - x * x2 - y * y2) * s[2], 0, ...t, 1];
}

function imageSize(bytes, mime, label) {
  if (mime === 'image/png') {
    check(bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR', `${label}: invalid PNG header`);
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  check(mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216,
    `${label}: expected embedded PNG or JPEG`);
  for (let offset = 2; offset < bytes.length;) {
    check(bytes[offset++] === 255, `${label}: invalid JPEG marker`);
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++]; if (marker === 217 || marker === 218) break;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    check(offset + 2 <= bytes.length, `${label}: truncated JPEG segment`);
    const length = bytes.readUInt16BE(offset);
    check(length >= 2 && offset + length <= bytes.length, `${label}: invalid JPEG segment length`);
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      check(length >= 8, `${label}: truncated JPEG frame`);
      return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    }
    offset += length;
  }
  throw new Error(`${label}: JPEG dimensions missing`);
}

/** Decode the bytes independently of Blender and the exporter's metadata. */
export function verifyGlbBuffer(bytes) {
  check(Buffer.isBuffer(bytes) && bytes.length >= 28, 'GLB: truncated header');
  check(bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2, 'GLB: expected glTF version 2');
  check(bytes.readUInt32LE(8) === bytes.length && bytes.length % 4 === 0, 'GLB: invalid file length/alignment');
  const chunks = [];
  for (let offset = 12; offset < bytes.length;) {
    check(offset + 8 <= bytes.length, 'GLB: truncated chunk header');
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4), start = offset + 8;
    check(length % 4 === 0 && start + length <= bytes.length, 'GLB: invalid chunk bounds/alignment');
    chunks.push({type, data: bytes.subarray(start, start + length)}); offset = start + length;
  }
  check(chunks.length === 2 && chunks[0].type === 0x4e4f534a && chunks[1].type === 0x004e4942,
    'GLB: expected exactly JSON then BIN chunks');
  const gltf = JSON.parse(chunks[0].data.toString('utf8').trimEnd()), bin = chunks[1].data;
  finiteJSON(gltf); check(gltf.asset?.version === '2.0', 'glTF: expected asset.version 2.0');
  const buffers = array(gltf.buffers, 'buffers'), views = array(gltf.bufferViews, 'bufferViews');
  const accessors = array(gltf.accessors, 'accessors'), meshes = array(gltf.meshes, 'meshes');
  const nodes = array(gltf.nodes, 'nodes'), scenes = array(gltf.scenes, 'scenes');
  const materials = array(gltf.materials ?? [], 'materials'), images = array(gltf.images ?? [], 'images');
  const textures = array(gltf.textures ?? [], 'textures'), samplers = array(gltf.samplers ?? [], 'samplers');
  check(buffers.length === 1 && buffers[0].uri === undefined, 'GLB: expected one embedded buffer without URI');
  const bufferLength = integer(buffers[0].byteLength, 'buffer.byteLength', 1);
  check(bufferLength <= bin.length && bin.length - bufferLength <= 3, 'GLB: BIN length disagrees with buffer');
  check(!(gltf.animations?.length || gltf.skins?.length || gltf.cameras?.length), 'Scene: expected static geometry without animation, skins, or cameras');
  const extensions = gltf.extensionsUsed ?? [], required = gltf.extensionsRequired ?? [];
  check(!extensions.some(e => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'EXT_mesh_gpu_instancing',
    'KHR_texture_basisu', 'EXT_texture_webp'].includes(e)), 'GLB: decoder or GPU instancing extension cannot be verified here');
  check(required.every(e => ['KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_texture_transform'].includes(e)),
    'GLB: unsupported required extension');
  for (const [i, view] of views.entries()) {
    const label = `bufferViews[${i}]`, offset = integer(view.byteOffset ?? 0, `${label}.byteOffset`);
    const length = integer(view.byteLength, `${label}.byteLength`, 1);
    check(view.buffer === 0 && offset + length <= bufferLength, `${label}: outside embedded buffer`);
    if (view.byteStride !== undefined) check(Number.isInteger(view.byteStride) && view.byteStride >= 4 &&
      view.byteStride <= 252 && view.byteStride % 4 === 0, `${label}: invalid byteStride`);
    if (view.target !== undefined) check([34962, 34963].includes(view.target), `${label}: invalid target`);
  }
  const decoded = accessors.map((a, i) => {
    const label = `accessors[${i}]`, component = COMPONENT[a.componentType], width = WIDTH[a.type];
    check(component && width, `${label}: unsupported component type/shape`);
    const [cb, read] = component, count = integer(a.count, `${label}.count`, 1);
    const offset = integer(a.byteOffset ?? 0, `${label}.byteOffset`);
    check(count * width <= 20_000_000 && offset % cb === 0, `${label}: excessive size or invalid alignment`);
    check(!a.normalized || [5120, 5121, 5122, 5123].includes(a.componentType), `${label}: invalid normalized encoding`);
    const columns = a.type.startsWith('MAT') ? Number(a.type.slice(3)) : 1, rows = width / columns;
    const columnBytes = columns > 1 ? Math.ceil(rows * cb / 4) * 4 : rows * cb;
    const elementBytes = columnBytes * columns, values = new Float64Array(count * width);
    const componentOffset = j => Math.floor(j / rows) * columnBytes + (j % rows) * cb;
    if (a.bufferView !== undefined) {
      const view = ref(views, a.bufferView, `${label}.bufferView`), stride = view.byteStride ?? elementBytes;
      const start = (view.byteOffset ?? 0) + offset;
      check(start % cb === 0 && stride >= elementBytes && stride % cb === 0 &&
        offset + (count - 1) * stride + elementBytes <= view.byteLength, `${label}: invalid bufferView range/stride`);
      for (let k = 0; k < count; k++) for (let j = 0; j < width; j++) {
        values[k * width + j] = bin[read](start + k * stride + componentOffset(j));
      }
    } else check(a.sparse && offset === 0, `${label}: missing bufferView or sparse data`);
    if (a.sparse) {
      const sparse = a.sparse, n = integer(sparse.count, `${label}.sparse.count`, 1);
      const ic = COMPONENT[sparse.indices?.componentType];
      check(n <= count && [5121, 5123, 5125].includes(sparse.indices?.componentType), `${label}: invalid sparse indices`);
      const iv = ref(views, sparse.indices.bufferView, `${label}.sparse.indices`);
      const vv = ref(views, sparse.values?.bufferView, `${label}.sparse.values`);
      const io = integer(sparse.indices.byteOffset ?? 0, `${label}.sparse.indexOffset`);
      const vo = integer(sparse.values.byteOffset ?? 0, `${label}.sparse.valueOffset`);
      check(!iv.byteStride && !vv.byteStride && io + n * ic[0] <= iv.byteLength && vo + n * elementBytes <= vv.byteLength,
        `${label}: sparse data outside bufferView`);
      check(((iv.byteOffset ?? 0) + io) % ic[0] === 0 && ((vv.byteOffset ?? 0) + vo) % cb === 0, `${label}: unaligned sparse data`);
      let previous = -1;
      for (let k = 0; k < n; k++) {
        const index = bin[ic[1]]((iv.byteOffset ?? 0) + io + k * ic[0]);
        check(index > previous && index < count, `${label}: sparse indices not increasing/in range`); previous = index;
        for (let j = 0; j < width; j++) values[index * width + j] = bin[read]((vv.byteOffset ?? 0) + vo + k * elementBytes + componentOffset(j));
      }
    }
    const min = new Array(width).fill(Infinity), max = new Array(width).fill(-Infinity);
    for (let k = 0; k < count; k++) for (let j = 0; j < width; j++) {
      const v = values[k * width + j]; check(Number.isFinite(v), `${label}: non-finite binary value`);
      min[j] = Math.min(min[j], v); max[j] = Math.max(max[j], v);
    }
    for (const bound of ['min', 'max']) if (a[bound] !== undefined) {
      check(array(a[bound], `${label}.${bound}`).length === width, `${label}: incorrect bound dimensions`);
      const measured = bound === 'min' ? min : max;
      check(measured.every((v, j) => near(v, a[bound][j], 1e-5 * Math.max(1, Math.abs(v)))), `${label}: declared ${bound} disagrees with bytes`);
    }
    return {a, values, width, count, min, max};
  });
  const imageReport = images.map((image, i) => {
    const label = `images[${i}]`; check(image.uri === undefined, `${label}: image URI dependency forbidden`);
    const view = ref(views, image.bufferView, `${label}.bufferView`), start = view.byteOffset ?? 0;
    check(view.byteStride === undefined, `${label}: image bufferView must not be interleaved`);
    const data = bin.subarray(start, start + view.byteLength), [width, height] = imageSize(data, image.mimeType, label);
    check(width > 0 && height > 0 && width <= 16384 && height <= 16384, `${label}: invalid/excessive dimensions`);
    return {index: i, name: image.name ?? null, mimeType: image.mimeType, width, height, bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex')};
  });
  for (const [i, texture] of textures.entries()) {
    ref(images, texture.source, `textures[${i}].source`);
    if (texture.sampler !== undefined) ref(samplers, texture.sampler, `textures[${i}].sampler`);
  }
  const materialReport = materials.map((material, i) => {
    const label = `materials[${i}]`, pbr = material.pbrMetallicRoughness ?? {}, maps = {};
    for (const key of ['metallicFactor', 'roughnessFactor']) if (pbr[key] !== undefined) {
      check(pbr[key] >= 0 && pbr[key] <= 1, `${label}: invalid ${key}`);
    }
    if (pbr.baseColorFactor !== undefined) check(array(pbr.baseColorFactor, label).length === 4 &&
      pbr.baseColorFactor.every(v => v >= 0 && v <= 1), `${label}: invalid baseColorFactor`);
    const walk = (value, prefix = '') => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        const name = prefix ? `${prefix}.${key}` : key;
        if (key.endsWith('Texture') && child) {
          ref(textures, child.index, `${label}.${name}`);
          const uv = child.extensions?.KHR_texture_transform?.texCoord ?? child.texCoord ?? 0;
          integer(uv, `${label}.${name}.texCoord`);
          maps[name] = {texture: child.index, image: textures[child.index].source, texCoord: uv};
        } else walk(child, name);
      }
    }; walk(material);
    return {index: i, name: material.name ?? null, baseColorFactor: pbr.baseColorFactor ?? [1, 1, 1, 1],
      metallicFactor: pbr.metallicFactor ?? 1, roughnessFactor: pbr.roughnessFactor ?? 1,
      alphaMode: material.alphaMode ?? 'OPAQUE', doubleSided: material.doubleSided ?? false, maps};
  });
  let uniqueTriangles = 0, uniquePrimitives = 0, attributeVertices = 0, colorPrimitives = 0;
  const meshStats = meshes.map((mesh, i) => {
    let triangles = 0; const primitives = array(mesh.primitives, `meshes[${i}].primitives`);
    check(primitives.length > 0, `meshes[${i}]: empty mesh`);
    for (const [j, primitive] of primitives.entries()) {
      const label = `mesh ${i} primitive ${j}`, attrs = primitive.attributes ?? {};
      const p = ref(decoded, attrs.POSITION, `${label}.POSITION`);
      check(p.a.type === 'VEC3' && p.a.componentType === 5126 && !p.a.normalized && p.a.min && p.a.max,
        `${label}: expected float POSITION VEC3 with bounds`);
      check(!primitive.targets?.length, `${label}: morph targets forbidden in static scenery`);
      check((primitive.mode ?? 4) === 4, `${label}: expected triangle list`);
      const n = ref(decoded, attrs.NORMAL, `${label}.NORMAL`);
      check(n.a.type === 'VEC3' && n.a.componentType === 5126, `${label}: expected float NORMAL VEC3`);
      for (const [semantic, index] of Object.entries(attrs)) {
        check(ref(decoded, index, `${label}.${semantic}`).count === p.count, `${label}: attribute counts differ`);
        check(!/^(JOINTS|WEIGHTS)_/.test(semantic), `${label}: skin attribute in static mesh`);
      }
      let count = p.count;
      if (primitive.indices !== undefined) {
        const indices = ref(decoded, primitive.indices, `${label}.indices`);
        check(indices.a.type === 'SCALAR' && [5121, 5123, 5125].includes(indices.a.componentType) && !indices.a.normalized,
          `${label}: invalid index accessor`);
        check(indices.max[0] < p.count, `${label}: index outside POSITION`); count = indices.count;
      }
      check(count % 3 === 0, `${label}: incomplete triangle list`);
      const material = ref(materialReport, primitive.material, `${label}.material`);
      for (const info of Object.values(material.maps)) {
        const uv = ref(decoded, attrs[`TEXCOORD_${info.texCoord}`], `${label}.TEXCOORD_${info.texCoord}`);
        check(uv.a.type === 'VEC2' && (uv.a.componentType === 5126 || [5121, 5123].includes(uv.a.componentType) && uv.a.normalized),
          `${label}: invalid texture coordinate format`);
      }
      if (attrs.COLOR_0 !== undefined) {
        const c = decoded[attrs.COLOR_0]; check(['VEC3', 'VEC4'].includes(c.a.type) &&
          (c.a.componentType === 5126 || [5121, 5123].includes(c.a.componentType) && c.a.normalized), `${label}: invalid COLOR_0`);
        colorPrimitives++;
      }
      triangles += count / 3; attributeVertices += p.count; uniquePrimitives++;
    }
    uniqueTriangles += triangles; return {triangles, primitives: primitives.length};
  });
  const parents = new Array(nodes.length).fill(-1), matrices = nodes.map((node, i) => {
    check(node.skin === undefined && node.camera === undefined, `nodes[${i}]: skin/camera forbidden`);
    if (node.mesh !== undefined) ref(meshes, node.mesh, `nodes[${i}].mesh`);
    for (const child of node.children ?? []) {
      ref(nodes, child, `nodes[${i}].child`); check(parents[child] === -1, `nodes[${child}]: multiple parents`); parents[child] = i;
    }
    return nodeMatrix(node, `nodes[${i}]`);
  });
  const world = [], visiting = new Set();
  const worldMatrix = i => {
    if (world[i]) return world[i]; check(!visiting.has(i), 'Scene: hierarchy cycle'); visiting.add(i);
    world[i] = parents[i] < 0 ? matrices[i] : multiply(worldMatrix(parents[i]), matrices[i]);
    visiting.delete(i); return world[i];
  };
  for (let i = 0; i < nodes.length; i++) worldMatrix(i);
  for (const [i, scene] of scenes.entries()) for (const root of scene.nodes ?? []) {
    ref(nodes, root, `scenes[${i}].root`); check(parents[root] === -1, `scenes[${i}]: root has a parent`);
  }
  const sceneIndex = gltf.scene ?? 0, scene = ref(scenes, sceneIndex, 'scene'), active = new Set();
  const visit = i => {check(!active.has(i), 'Scene: repeated root/node'); active.add(i); for (const child of nodes[i].children ?? []) visit(child);};
  for (const root of array(scene.nodes, 'scene.nodes')) visit(root);
  const bounds = emptyBounds(), meshInstances = [], usedMaterials = new Set(); let triangles = 0, drawGroups = 0;
  for (const i of active) {
    const node = nodes[i]; if (node.mesh === undefined) continue;
    const mesh = meshes[node.mesh], stats = meshStats[node.mesh], local = emptyBounds();
    for (const primitive of mesh.primitives) {
      usedMaterials.add(primitive.material);
      const p = decoded[primitive.attributes.POSITION];
      for (let k = 0; k < p.count; k++) {const point = transform(world[i], p.values, k * 3); include(bounds, point); include(local, point);}
    }
    triangles += stats.triangles; drawGroups += stats.primitives;
    meshInstances.push({node: i, name: node.name ?? null, mesh: node.mesh, triangles: stats.triangles,
      drawGroups: stats.primitives, bounds: finishBounds(local)});
  }
  check(triangles > 0 && drawGroups > 0, 'Scene: no active mesh geometry');
  const budget = {limits: BUDGET, drawGroups, triangles,
    withinBudget: drawGroups <= BUDGET.drawGroups && triangles <= BUDGET.triangles};
  const materialMaps = {baseColor: 0, normal: 0, metallicRoughness: 0};
  for (const m of materialReport) {
    if (m.maps['pbrMetallicRoughness.baseColorTexture']) materialMaps.baseColor++;
    if (m.maps.normalTexture) materialMaps.normal++;
    if (m.maps['pbrMetallicRoughness.metallicRoughnessTexture']) materialMaps.metallicRoughness++;
  }
  const usedTextures = new Set(), usedImages = new Set();
  for (const index of usedMaterials) for (const binding of Object.values(materialReport[index].maps)) {
    usedTextures.add(binding.texture); usedImages.add(binding.image);
  }
  const usedTextureImageIndices = [...usedImages].sort((a, b) => a - b);
  // Theoretical RGBA8 allocation with a complete mip chain, counted once per
  // image source actually bound by a material in the active scene. This is not
  // a measurement of compressed PNG bytes or of a particular GPU driver.
  const decodedTextureBytesWithMipmaps = usedTextureImageIndices.reduce((sum, index) => {
    const {width, height} = imageReport[index]; return sum + width * height;
  }, 0) * 4 * 4 / 3;
  const decodedTextureObjectsBytesWithMipmaps = [...usedTextures].reduce((sum, index) => {
    const {width, height} = imageReport[textures[index].source]; return sum + width * height;
  }, 0) * 4 * 4 / 3;
  return {ok: budget.withinBudget, format: 'glTF 2.0 / GLB', selfContained: true, staticGeometry: true,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), scene: sceneIndex,
    meshes: meshes.length, nodes: nodes.length, activeNodes: active.size, meshInstances,
    uniqueTriangles, uniquePrimitives, attributeVertices, colorPrimitives, triangles, drawGroups, budget,
    bounds: finishBounds(bounds), materials: materials.length, materialReport, materialMaps,
    textures: textures.length, images: imageReport, imageBytes: imageReport.reduce((sum, image) => sum + image.bytes, 0),
    usedTextureCount: usedTextures.size, usedTextureImageCount: usedImages.size, usedTextureImageIndices,
    decodedTextureBytesWithMipmaps, decodedTextureMiBWithMipmaps: decodedTextureBytesWithMipmaps / (1024 * 1024),
    decodedTextureEstimate: 'Active unique image sources: sum(width * height * 4 * 4/3); theoretical RGBA8 full mip chain.',
    decodedTextureObjectsBytesWithMipmaps,
    decodedTextureObjectsMiBWithMipmaps: decodedTextureObjectsBytesWithMipmaps / (1024 * 1024),
    decodedTextureObjectsEstimate: 'Active texture indices: sum(source.width * source.height * 4 * 4/3); shared images counted per texture object.',
    extensionsUsed: extensions, extensionsRequired: required,
    errors: budget.withinBudget ? [] : ['Active scene exceeds the requested draw-group or triangle budget.']};
}

export function verifyCoordinateContract(contract) {
  const transform = contract.coordinateTransform, stage = contract.stage;
  check(transform && stage, 'Contract: missing coordinateTransform or stage');
  const s = 95 / 147, t = .3245 - 1.15 * s;
  check(transform.sourceUp === 'Z' && transform.runtimeUp === 'Y', 'Contract: incorrect up axes');
  check(near(transform.scale, s) && near(transform.translationRuntimeY, t), 'Contract: scale/translation mismatch');
  check(Array.isArray(transform.formula) && transform.formula.join(';').replace(/\s/g, '') ===
    'x=s*source.x;y=s*source.z+t;z=-s*source.y', 'Contract: incorrect axis transformation formula');
  check(near(stage.sourceTopZ, 1.15) && near(stage.runtimeTopY, .3245) && near(stage.runtimeBoardWidth, 7.6),
    'Contract: incorrect stage measurements');
  const calculatedTopY = stage.sourceTopZ * transform.scale + transform.translationRuntimeY;
  check(near(calculatedTopY, stage.runtimeTopY), 'Contract: stage top does not map to TABLE_TOP');
  return {ok: true, ...transform, stage: {...stage, calculatedTopY},
    scope: 'Checks the declared coordinate formula; does not identify the stage surface from merged geometry.'};
}

const localPath = file => file instanceof URL ? path.normalize(decodeURIComponent(file.pathname).replace(/^\/(?=[A-Za-z]:\/)/, '')) : path.resolve(file);
export async function verifyWorkshopGlb(file = DEFAULT_FILE) {
  const input = localPath(file), output = path.join(path.dirname(input), 'verification.json');
  let receipt;
  try {
    const bytes = await readFile(input);
    receipt = {...verifyGlbBuffer(bytes), file: input};
    receipt.coordinateContract = verifyCoordinateContract(JSON.parse(await readFile(path.join(path.dirname(input), 'asset-contract.json'), 'utf8')));
  } catch (error) {
    receipt = {...receipt, ok: false, file: input, errors: [...(receipt?.errors ?? []), error.message]};
  }
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  return {receipt, output};
}

if (process.argv[1] && path.resolve(process.argv[1]) === localPath(new URL(import.meta.url))) {
  try {
    const {receipt, output} = await verifyWorkshopGlb(process.argv[2] ?? DEFAULT_FILE);
    console.log(JSON.stringify({ok: receipt.ok, report: output, bytes: receipt.bytes, sha256: receipt.sha256,
      triangles: receipt.triangles, drawGroups: receipt.drawGroups, materials: receipt.materials,
      images: receipt.images?.length, usedTextureImageCount: receipt.usedTextureImageCount,
      decodedTextureBytesWithMipmaps: receipt.decodedTextureBytesWithMipmaps,
      decodedTextureMiBWithMipmaps: receipt.decodedTextureMiBWithMipmaps,
      decodedTextureObjectsBytesWithMipmaps: receipt.decodedTextureObjectsBytesWithMipmaps,
      decodedTextureObjectsMiBWithMipmaps: receipt.decodedTextureObjectsMiBWithMipmaps,
      bounds: receipt.bounds, errors: receipt.errors}, null, 2));
    if (!receipt.ok) process.exitCode = 1;
  } catch (error) {console.error(JSON.stringify({ok: false, error: error.message})); process.exitCode = 1;}
}
