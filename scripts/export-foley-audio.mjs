import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FOLEY_NAMES, renderFoley} from '../public/audio/foley-synthesis.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
let output = resolve(projectRoot, 'public/assets/audio/foley-v2');
let sampleRate = 22050;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) output = resolve(args[++i]);
  else if (args[i] === '--sample-rate' && args[i + 1]) sampleRate = Number(args[++i]);
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}

// Validate the rate through the renderer before allocating buffers or writing files.
const cues = FOLEY_NAMES.map(name => ({name, kind: 'effect', file: `${name}.wav`,
  samples: renderFoley(name, {sampleRate, seed: 1})}));
const workshopManifest = await readFile(resolve(projectRoot, 'public/assets/audio/workshop/manifest.json'));
const preservedWorkshopManifestSHA256 = createHash('sha256').update(workshopManifest).digest('hex');

const gap = Math.round(.28 * sampleRate);
const frames = cues.reduce((length, cue) => length + cue.samples.length + gap, gap);
const montage = new Float32Array(frames);
const chapters = [];
let cursor = gap;
for (const cue of cues) {
  montage.set(cue.samples, cursor);
  chapters.push({name: cue.name, start: cursor / sampleRate, duration: cue.samples.length / sampleRate});
  cursor += cue.samples.length + gap;
}
const bank = [...cues, {name: 'foley-montage', kind: 'preview', file: 'foley-montage.wav', samples: montage}];
const totalBytes = bank.reduce((total, cue) => total + 44 + cue.samples.length * 2, 0);
if (totalBytes > 4_000_000) throw new Error('Foley bank exceeds the 4 MB export budget');

function pcmWave(samples) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  let peak = 0, energy = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (!Number.isFinite(sample) || Math.abs(sample) >= 1) throw new Error('Invalid or clipping Foley audio');
    const quantized = Math.round(sample * 32767);
    buffer.writeInt16LE(quantized, 44 + i * 2);
    const decoded = quantized / 32768;
    peak = Math.max(peak, Math.abs(decoded));
    energy += decoded * decoded;
  }
  return {buffer, peak, rms: Math.sqrt(energy / samples.length)};
}

await mkdir(output, {recursive: true});
const files = [];
for (const cue of bank) {
  const encoded = pcmWave(cue.samples);
  await writeFile(resolve(output, cue.file), encoded.buffer);
  files.push({name: cue.name, kind: cue.kind, file: cue.file, channels: 1, sampleRate,
    frames: cue.samples.length, duration: cue.samples.length / sampleRate,
    bytes: encoded.buffer.length, peak: encoded.peak, rms: encoded.rms,
    sha256: createHash('sha256').update(encoded.buffer).digest('hex')});
}
const manifest = {
  schemaVersion: 1, title: 'WaterDuel — Foley de contacto y movimiento', names: [...FOLEY_NAMES],
  provenance: {method: 'Original deterministic procedural Foley synthesis authored for WaterDuel',
    externalSamples: false, externalServices: false, dependencies: [], seed: 1,
    source: 'public/audio/foley-synthesis.js', exporter: 'scripts/export-foley-audio.mjs',
    originalLayers: 'Locally synthesized wood, metal and puncture layers from public/audio/synthesis.js',
    rights: 'Project-original synthesized audio; no third-party recordings or samples'},
  preservedWorkshopManifestSHA256,
  format: {container: 'WAV', encoding: 'PCM signed 16-bit little-endian', sampleRate, channels: 1},
  totalBytes, files, preview: {file: 'foley-montage.wav', chapters},
};
await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Exported ${files.length} original Foley WAV files (${totalBytes} bytes) to ${output}`);
