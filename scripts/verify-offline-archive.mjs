#!/usr/bin/env node
// Read-only verifier for WaterDuel's ZIP32 STORE delivery contract.
// Deliberately independent of scripts/package.mjs and its helpers.
import { createHash } from 'node:crypto';
import { open, lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = 'WaterDuel/';
const MANIFEST = `${ROOT}MANIFEST.sha256`;
const CHUNK = 1024 * 1024;
const MAX_CENTRAL = 64 * 1024 * 1024;
const MAX_MANIFEST = 16 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  return c >>> 0;
});

export class ArchiveVerificationError extends Error {
  constructor(code) { super(code); this.name = 'ArchiveVerificationError'; this.code = code; }
}
function requireValue(condition, code) { if (!condition) throw new ArchiveVerificationError(code); }
function utf8(bytes, code) {
  try { return decoder.decode(bytes); } catch { throw new ArchiveVerificationError(code); }
}
function pathKey(name) { return name.normalize('NFC').toLowerCase(); }
function validateName(name, directory = false) {
  requireValue(name.startsWith(ROOT) && name.normalize('NFC') === name && !/[\\:*?"<>|\x00-\x1f\x7f]/u.test(name), 'E_PATH');
  if (directory) { requireValue(name === ROOT, 'E_PATH'); return; }
  const parts = name.slice(ROOT.length).split('/');
  requireValue(parts.length > 0 && parts.every(part => part && part !== '.' && part !== '..'
    && !/[. ]$/u.test(part) && !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)), 'E_PATH');
}
async function readExactly(handle, size, at, code) {
  requireValue(Number.isSafeInteger(size) && size >= 0 && Number.isSafeInteger(at) && at >= 0, code);
  const bytes = Buffer.alloc(size);
  for (let done = 0; done < size;) {
    const { bytesRead } = await handle.read(bytes, done, size - done, at + done);
    requireValue(bytesRead > 0, code); done += bytesRead;
  }
  return bytes;
}
async function digestRange(handle, start, size, { crc = false, capture = false } = {}) {
  const hash = createHash('sha256'), captured = [];
  const buffer = Buffer.alloc(Math.min(CHUNK, Math.max(1, size)));
  let state = 0xffffffff;
  for (let done = 0; done < size;) {
    const length = Math.min(buffer.length, size - done);
    const { bytesRead } = await handle.read(buffer, 0, length, start + done);
    requireValue(bytesRead > 0, 'E_READ');
    const bytes = buffer.subarray(0, bytesRead); hash.update(bytes);
    if (crc) for (const byte of bytes) state = (state >>> 8) ^ crcTable[(state ^ byte) & 255];
    if (capture) captured.push(Buffer.from(bytes));
    done += bytesRead;
  }
  return { sha256: hash.digest('hex'), crc32: (state ^ 0xffffffff) >>> 0,
    bytes: capture ? Buffer.concat(captured) : undefined };
}

async function readEntries(handle, size) {
  requireValue(size >= 22 && size <= 0xffffffff, 'E_EOCD');
  const end = await readExactly(handle, 22, size - 22, 'E_EOCD');
  requireValue(end.readUInt32LE(0) === 0x06054b50 && end.readUInt16LE(20) === 0, 'E_EOCD');
  requireValue(end.readUInt16LE(4) === 0 && end.readUInt16LE(6) === 0, 'E_FORMAT');
  const count = end.readUInt16LE(10), centralSize = end.readUInt32LE(12), centralAt = end.readUInt32LE(16);
  requireValue(count > 0 && count < 0xffff && count === end.readUInt16LE(8)
    && centralSize <= MAX_CENTRAL && centralAt + centralSize === size - 22, 'E_CENTRAL');
  const central = await readExactly(handle, centralSize, centralAt, 'E_CENTRAL');
  const entries = [], keys = new Set();
  let at = 0;
  for (let index = 0; index < count; index++) {
    requireValue(at + 46 <= central.length && central.readUInt32LE(at) === 0x02014b50, 'E_CENTRAL');
    const h = central.subarray(at, at + 46), nameLength = h.readUInt16LE(28);
    requireValue(nameLength > 0 && nameLength <= 4096 && at + 46 + nameLength <= central.length, 'E_CENTRAL');
    requireValue(h.readUInt16LE(4) === 0x314 && h.readUInt16LE(6) === 20
      && h.readUInt16LE(8) === 0x800 && h.readUInt16LE(10) === 0
      && h.readUInt16LE(12) === 0 && h.readUInt16LE(14) === 0x21
      && h.readUInt16LE(30) === 0 && h.readUInt16LE(32) === 0 && h.readUInt16LE(34) === 0, 'E_FORMAT');
    const rawName = central.subarray(at + 46, at + 46 + nameLength);
    const name = utf8(rawName, 'E_PATH'), directory = name.endsWith('/');
    validateName(name, directory);
    const key = pathKey(name);
    requireValue(!keys.has(key), 'E_PATH_COLLISION'); keys.add(key);
    const mode = h.readUInt32LE(38) >>> 16, type = mode & 0o170000;
    requireValue(type === (directory ? 0o040000 : 0o100000), 'E_ENTRY_TYPE');
    const compressed = h.readUInt32LE(20), length = h.readUInt32LE(24), offset = h.readUInt32LE(42);
    requireValue(compressed === length && length !== 0xffffffff && offset !== 0xffffffff, 'E_FORMAT');
    requireValue(!directory || (length === 0 && h.readUInt32LE(16) === 0), 'E_ENTRY_TYPE');
    entries.push({ name, rawName, directory, size: length, crc32: h.readUInt32LE(16), offset, header: Buffer.from(h) });
    at += 46 + nameLength;
  }
  requireValue(at === central.length && entries.some(entry => entry.name === ROOT)
    && entries.some(entry => entry.name === MANIFEST), 'E_CENTRAL');
  const fileKeys = new Set(entries.filter(entry => !entry.directory).map(entry => pathKey(entry.name)));
  for (const key of fileKeys) {
    const parts = key.split('/');
    for (let n = 2; n < parts.length; n++) requireValue(!fileKeys.has(parts.slice(0, n).join('/')), 'E_PATH_COLLISION');
  }
  let next = 0;
  for (const entry of [...entries].sort((a, b) => a.offset - b.offset)) {
    requireValue(entry.offset === next && entry.offset + 30 <= centralAt, 'E_LAYOUT');
    const h = await readExactly(handle, 30, entry.offset, 'E_LOCAL_HEADER'), c = entry.header;
    requireValue(h.readUInt32LE(0) === 0x04034b50 && h.readUInt16LE(4) === c.readUInt16LE(6)
      && h.readUInt16LE(6) === c.readUInt16LE(8) && h.readUInt16LE(8) === c.readUInt16LE(10)
      && h.readUInt16LE(10) === c.readUInt16LE(12) && h.readUInt16LE(12) === c.readUInt16LE(14)
      && h.readUInt32LE(14) === entry.crc32 && h.readUInt32LE(18) === entry.size
      && h.readUInt32LE(22) === entry.size && h.readUInt16LE(26) === entry.rawName.length
      && h.readUInt16LE(28) === 0, 'E_LOCAL_HEADER');
    const localName = await readExactly(handle, entry.rawName.length, entry.offset + 30, 'E_LOCAL_HEADER');
    requireValue(localName.equals(entry.rawName), 'E_LOCAL_HEADER');
    entry.dataAt = entry.offset + 30 + entry.rawName.length;
    next = entry.dataAt + entry.size;
    requireValue(next <= centralAt, 'E_LAYOUT');
  }
  requireValue(next === centralAt, 'E_LAYOUT');
  return entries;
}

function checkManifest(bytes, entries) {
  const text = utf8(bytes, 'E_MANIFEST');
  requireValue(text.endsWith('\n') && !text.includes('\r'), 'E_MANIFEST');
  const listed = new Set(), byName = new Map(entries.filter(entry => !entry.directory).map(entry => [entry.name, entry]));
  for (const line of text.slice(0, -1).split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    requireValue(match, 'E_MANIFEST');
    const name = `${ROOT}${match[2]}`; validateName(name);
    requireValue(name !== MANIFEST && !listed.has(pathKey(name)), 'E_MANIFEST');
    listed.add(pathKey(name));
    const entry = byName.get(name);
    requireValue(entry, 'E_MANIFEST_COVERAGE');
    requireValue(entry.sha256 === match[1], 'E_MANIFEST_HASH');
  }
  requireValue(listed.size === byName.size - 1, 'E_MANIFEST_COVERAGE');
  return listed.size;
}
function samePath(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
async function checkExtracted(extracted, entries) {
  const root = path.resolve(extracted), rootStat = await lstat(root);
  requireValue(!rootStat.isSymbolicLink() && rootStat.isDirectory(), 'E_EXTRACTED_LINK');
  requireValue(samePath(root, await realpath(root)), 'E_EXTRACTED_LINK');
  const expected = new Map(entries.filter(entry => !entry.directory).map(entry => [entry.name.slice(ROOT.length), entry]));
  const directories = new Set(['']);
  for (const name of expected.keys()) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  const seen = new Set();
  async function walk(relative) {
    const folder = path.join(root, ...relative.split('/').filter(Boolean));
    for (const name of await readdir(folder)) {
      const child = relative ? `${relative}/${name}` : name;
      const target = path.resolve(root, ...child.split('/'));
      requireValue(isWithin(root, target), 'E_EXTRACTED_LINK');
      const stat = await lstat(target);
      requireValue(!stat.isSymbolicLink(), 'E_EXTRACTED_LINK');
      requireValue(isWithin(root, await realpath(target)), 'E_EXTRACTED_LINK');
      if (stat.isDirectory()) {
        requireValue(directories.has(child), 'E_EXTRACTED_EXTRA'); await walk(child);
      } else {
        requireValue(stat.isFile(), 'E_EXTRACTED_TYPE');
        const entry = expected.get(child); requireValue(entry, 'E_EXTRACTED_EXTRA');
        requireValue(stat.size === entry.size, 'E_EXTRACTED_HASH');
        const handle = await open(target, 'r');
        try {
          requireValue((await digestRange(handle, 0, stat.size)).sha256 === entry.sha256, 'E_EXTRACTED_HASH');
        } finally { await handle.close(); }
        seen.add(child);
      }
    }
  }
  await walk('');
  requireValue(seen.size === expected.size, 'E_EXTRACTED_MISSING');
  return { checked: true, files: seen.size };
}

export async function verifyOfflineArchive({ archive, extracted } = {}) {
  try {
    requireValue(typeof archive === 'string' && archive.length > 0
      && (extracted === undefined || (typeof extracted === 'string' && extracted.length > 0)), 'E_USAGE');
    const archivePath = path.resolve(archive), stat = await lstat(archivePath);
    requireValue(stat.isFile() && !stat.isSymbolicLink(), 'E_ARCHIVE_TYPE');
    const handle = await open(archivePath, 'r');
    try {
      const entries = await readEntries(handle, stat.size);
      let manifestBytes;
      for (const entry of entries) {
        if (entry.name === MANIFEST) requireValue(entry.size <= MAX_MANIFEST, 'E_MANIFEST_LIMIT');
        const result = await digestRange(handle, entry.dataAt, entry.size, { crc: true, capture: entry.name === MANIFEST });
        requireValue(result.crc32 === entry.crc32, 'E_CRC');
        entry.sha256 = result.sha256;
        if (entry.name === MANIFEST) manifestBytes = result.bytes;
      }
      const manifestFiles = checkManifest(manifestBytes, entries);
      const archiveSha256 = (await digestRange(handle, 0, stat.size)).sha256;
      const extractedResult = extracted === undefined ? { checked: false } : await checkExtracted(extracted, entries);
      const finalStat = await handle.stat();
      requireValue(finalStat.size === stat.size && finalStat.mtimeMs === stat.mtimeMs, 'E_INPUT_CHANGED');
      return { ok: true, format: 'ZIP32-STORE-WaterDuel', bytes: stat.size, entries: entries.length,
        files: entries.filter(entry => !entry.directory).length, manifestFiles,
        payloadBytes: entries.reduce((total, entry) => total + entry.size, 0), archiveSha256,
        manifestSha256: entries.find(entry => entry.name === MANIFEST).sha256, extracted: extractedResult };
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof ArchiveVerificationError) throw error;
    throw new ArchiveVerificationError('E_IO');
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node scripts/verify-offline-archive.mjs ARCHIVE.zip [--extracted EXTRACTED_PROJECT_ROOT]\n');
    return;
  }
  requireValue((args.length === 1 || (args.length === 3 && args[1] === '--extracted')) && !args[0].startsWith('--'), 'E_USAGE');
  process.stdout.write(`${JSON.stringify(await verifyOfflineArchive({ archive: args[0], extracted: args[2] }), null, 2)}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    // Never echo untrusted file contents, filenames, OS errors or credentials.
    process.stderr.write(`${JSON.stringify({ ok: false, code: error instanceof ArchiveVerificationError ? error.code : 'E_IO' })}\n`);
    process.exitCode = 1;
  });
}
