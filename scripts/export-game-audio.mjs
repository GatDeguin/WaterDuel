import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SOUND_NAMES, MUSIC_STEMS, MUSIC_MODES, MODE_INTERVALS, renderSound, renderMusic} from '../public/audio/synthesis.js';
import {renderWorkshopMusic} from '../public/audio/music-synthesis.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
let output = resolve(projectRoot, 'public/assets/audio/workshop');
let sampleRate = 22050;
let scoreV3=false,explicitOutput=false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) {output = resolve(args[++i]);explicitOutput=true;}
  else if (args[i] === '--sample-rate' && args[i + 1]) sampleRate = Number(args[++i]);
  else if (args[i] === '--score-v3') scoreV3=true;
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}

// Renderer validation happens before creating the destination or allocating the bank.
if(scoreV3&&!explicitOutput)output=resolve(projectRoot,'public/assets/audio/workshop-score-v3');
const musicRenderer=scoreV3?renderWorkshopMusic:renderMusic;
const scores = MUSIC_MODES.map(mode => ({mode, ...musicRenderer({sampleRate, mode})}));
const effects = scoreV3?[]:SOUND_NAMES.map(name => ({name, channels: [renderSound(name, {sampleRate, seed: 1})]}));

function wave(channels) {
  const frames = channels[0].length;
  const dataBytes = frames * channels.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels.length, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels.length * 2, 28);
  buffer.writeUInt16LE(channels.length * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  let peak = 0, energy = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels.length; channel++) {
      const sample = channels[channel][frame];
      if (!Number.isFinite(sample) || Math.abs(sample) >= 1) throw new Error('Invalid or clipping audio');
      const quantized = Math.round(sample * 32767);
      buffer.writeInt16LE(quantized, 44 + (frame * channels.length + channel) * 2);
      const decoded = quantized / 32768;
      peak = Math.max(peak, Math.abs(decoded));
      energy += decoded * decoded;
    }
  }
  return {buffer, frames, peak, rms: Math.sqrt(energy / (frames * channels.length))};
}

const bank = effects.map(effect => ({...effect, kind: 'effect', file: `${effect.name}.wav`}));
for (const score of scores) {
  for (const stem of [...MUSIC_STEMS, 'mix']) {
    bank.push({name: `${score.mode}-${stem}`, mode: score.mode, stem, kind: 'music',
      file: `music-${score.mode}-${stem}.wav`,
      channels: stem === 'mix' ? score.channels : musicRenderer({sampleRate, stem, mode: score.mode}).channels});
  }
}

// Cues in SOUND_NAMES order, then five seconds from each of the four modes.
// Full 20 second mixes and stems are separate files; this montage stays compact.
const gap = Math.round(.3 * sampleRate);
const cueFrames = effects.reduce((total, effect) => total + effect.channels[0].length + gap, gap);
const excerptFrames = sampleRate * 5;
const montage = [new Float32Array(cueFrames + excerptFrames * scores.length),
  new Float32Array(cueFrames + excerptFrames * scores.length)];
const chapters = [];
let offset = gap;
for (const effect of effects) {
  chapters.push({name: effect.name, start: offset / sampleRate, duration: effect.channels[0].length / sampleRate});
  for (const channel of montage) channel.set(effect.channels[0], offset);
  offset += effect.channels[0].length + gap;
}
for (const score of scores) {
  chapters.push({name: `music-${score.mode}-mix`, start: offset / sampleRate, duration: 5});
  for (let channel = 0; channel < 2; channel++) {
    for (let i = 0; i < excerptFrames; i++) {
      const fade = Math.min(1, i / (sampleRate * .03), (excerptFrames - 1 - i) / (sampleRate * .03));
      montage[channel][offset + i] = score.channels[channel][i] * fade;
    }
  }
  offset += excerptFrames;
}
bank.push({name: 'listening-montage', kind: 'preview', file: 'listening-montage.wav', channels: montage});

await mkdir(output, {recursive: true});
const files = [];
let totalBytes = 0;
for (const entry of bank) {
  const encoded = wave(entry.channels);
  totalBytes += encoded.buffer.length;
  if (totalBytes > 80_000_000) throw new Error('Audio export exceeds the 80 MB bank budget');
  await writeFile(resolve(output, entry.file), encoded.buffer);
  files.push({name: entry.name, kind: entry.kind, ...(entry.mode ? {mode: entry.mode, stem: entry.stem} : {}),
    file: entry.file, channels: entry.channels.length,
    sampleRate, frames: encoded.frames, duration: encoded.frames / sampleRate,
    bytes: encoded.buffer.length, peak: encoded.peak, rms: encoded.rms,
    sha256: createHash('sha256').update(encoded.buffer).digest('hex')});
}
const manifest = {
  schemaVersion: 1,
  title: 'WaterDuel — Taller mecánico sutil',
  provenance: {method: 'Original deterministic procedural synthesis authored for WaterDuel',
    externalSamples: false, externalServices: false, dependencies: [],
    source: 'public/audio/synthesis.js', exporter: 'scripts/export-game-audio.mjs', seed: 1,
    rights: 'Project-original synthesized audio; no third-party recordings or samples'},
  format: {container: 'WAV', encoding: 'PCM signed 16-bit little-endian', sampleRate},
  music: {bpm: 96, bars: 8, meter: '4/4', tonic: 'D', duration: 20,
    ...(scoreV3?{version:3,arrangement:'Bowed chamber harmony, wooden answering phrases and brushed metal; original offline synthesis'}:{}),
    modes: [...MUSIC_MODES], intervals: MODE_INTERVALS, stems: [...MUSIC_STEMS],
    loop: 'Tail samples wrap into the beginning; use the full 20 second buffer',
    transitions: 'Modes and stems share tonic and clock; switch on a bar boundary with a short gain crossfade'},
  totalBytes, files, preview: {file: 'listening-montage.wav', chapters},
};
await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Exported ${files.length} original WAV files (${(totalBytes / 1_000_000).toFixed(2)} MB) to ${output}`);
