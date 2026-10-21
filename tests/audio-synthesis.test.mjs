import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// A missing renderer produces assertion failures during the initial red run.
const synthesis = await import('../public/audio/synthesis.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const names = ['wood','joint','metal','ring','whoosh','slosh','tension','puncture',
  'tear','jet','drip','splash','countdown','go','victory','defeat','draw','ui'];
const execute = promisify(execFile);

function sound(name, options) {
  assert.equal(typeof synthesis.renderSound, 'function', 'the sound renderer is implemented');
  return synthesis.renderSound(name, options);
}
function music(options) {
  assert.equal(typeof synthesis.renderMusic, 'function', 'the music renderer is implemented');
  return synthesis.renderMusic(options);
}
function statistics(samples) {
  let energy = 0, peak = 0, sum = 0;
  for (const sample of samples) {
    assert.ok(Number.isFinite(sample), 'audio contains only finite samples');
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
    sum += sample;
  }
  return {peak, rms: Math.sqrt(energy / samples.length), mean: sum / samples.length};
}
function energyAt(samples, start, frequency) {
  let real = 0, imaginary = 0;
  const count = 1600;
  for (let i = 0; i < count; i++) {
    const value = samples[Math.round(start * 8000) + i] * (.5 - .5 * Math.cos(2 * Math.PI * i / (count - 1)));
    real += value * Math.cos(2 * Math.PI * frequency * i / 8000);
    imaginary += value * Math.sin(2 * Math.PI * frequency * i / 8000);
  }
  return real * real + imaginary * imaginary;
}

test('every gameplay cue renders audible mono audio with headroom and click-free ends', () => {
  assert.deepEqual(synthesis.SOUND_NAMES, names);
  for (const name of names) {
    const samples = sound(name);
    assert.ok(samples instanceof Float32Array, name);
    assert.ok(samples.length >= 1764 && samples.length <= 66150, `${name}: bounded one-shot duration`);
    const stats = statistics(samples);
    assert.ok(stats.peak > .025 && stats.peak <= .85, `${name}: audible peak with headroom`);
    assert.ok(stats.rms > .002 && stats.rms < .3, `${name}: useful energy without excessive level`);
    assert.ok(Math.abs(stats.mean) < .008, `${name}: no meaningful DC offset`);
    assert.equal(samples[0], 0, `${name}: soft start`);
    assert.equal(samples.at(-1), 0, `${name}: soft end`);
    assert.ok(Math.abs(samples[1]) < .025, `${name}: onset has no hard step`);
    assert.ok(Math.abs(samples.at(-2)) < .025, `${name}: release has no hard step`);
  }
});

test('effect variations are deterministic for a seed and distinct across materials and seeds', () => {
  const hashes = new Set();
  for (const name of names) {
    const first = sound(name, {seed: 27, sampleRate: 8000});
    assert.deepEqual(first, sound(name, {seed: 27, sampleRate: 8000}), name);
    assert.notDeepEqual(first, sound(name, {seed: 28, sampleRate: 8000}), `${name}: seeded variation`);
    hashes.add(createHash('sha256').update(Buffer.from(first.buffer)).digest('hex'));
  }
  assert.equal(hashes.size, names.length, 'each material/event has its own waveform');
});

test('renderers honor sample rate and reject unknown cues or unsafe allocations', () => {
  const reference = sound('splash', {sampleRate: 8000});
  assert.equal(sound('splash', {sampleRate: 48000}).length, reference.length * 6);
  assert.throws(() => sound('missing'), /unknown sound/i);
  for (const sampleRate of [0, -1, NaN, Infinity, 7999, 192000, '22050']) {
    assert.throws(() => sound('wood', {sampleRate}), /sample.?rate/i);
    assert.throws(() => music({sampleRate}), /sample.?rate/i);
  }
  assert.throws(() => music({stem: 'missing'}), /unknown.*stem/i);
  assert.throws(() => music({mode: 'missing'}), /unknown.*mode/i);
});

test('the 96 BPM score supplies synchronized stereo stems and a 20 second mix', () => {
  assert.deepEqual(synthesis.MUSIC_STEMS, ['wood', 'metal', 'bass']);
  const stems = ['wood','metal','bass'].map(stem => music({sampleRate: 8000, stem}));
  const mix = music({sampleRate: 8000});
  assert.equal(mix.sampleRate, 8000);
  assert.equal(mix.bpm, 96);
  assert.equal(mix.bars, 8);
  assert.equal(mix.duration, 20);
  for (const rendered of [...stems, mix]) {
    assert.equal(rendered.channels.length, 2);
    for (const channel of rendered.channels) {
      assert.ok(channel instanceof Float32Array);
      assert.equal(channel.length, 160000);
      const stats = statistics(channel);
      assert.ok(stats.peak < .65 && stats.rms > .005 && stats.rms < .12);
      assert.ok(Math.abs(stats.mean) < .002);
    }
    assert.notDeepEqual(rendered.channels[0], rendered.channels[1], 'stereo spatial detail');
  }
  for (let channel = 0; channel < 2; channel++) {
    for (let i = 0; i < mix.channels[channel].length; i++) {
      const sum = stems.reduce((value, stem) => value + stem.channels[channel][i], 0);
      assert.ok(Math.abs(sum - mix.channels[channel][i]) < 1e-6, 'stems retain mix gain and alignment');
    }
  }
  assert.deepEqual(mix.channels, music({sampleRate: 8000}).channels, 'reproducible score');
});

test('music tails cross the loop boundary without a silence gate or discontinuity', () => {
  for (const mode of ['lydian','dorian','aeolian','phrygian']) {
    for (const stem of ['wood','metal','bass','mix']) {
      for (const channel of music({stem, mode}).channels) {
      const start = statistics(channel.subarray(0, 441));
      const end = statistics(channel.subarray(channel.length - 441));
      assert.ok(start.rms > .0001 && end.rms > .0001, `${stem}: sustained wraparound tails`);
      assert.ok(Math.abs(channel[0] - channel.at(-1)) < .012, `${stem}: continuous wraparound`);
      const boundarySlope = channel[0] - channel.at(-1);
      const nextSlope = channel[1] - channel[0];
      assert.ok(Math.abs(boundarySlope - nextSlope) < .012, `${stem}: no slope click`);
      }
    }
  }
});

test('the four arrangements audibly voice their characteristic modal degrees on a common tonic', () => {
  assert.deepEqual(synthesis.MUSIC_MODES, ['lydian','dorian','aeolian','phrygian']);
  // Compare actual rendered fundamentals in a short exposed bell note. These
  // frequencies and times are independent musical expectations, not renderer metadata.
  const arrangements = Object.fromEntries(['lydian','dorian','aeolian','phrygian'].map(mode =>
    [mode, music({mode, stem: 'metal', sampleRate: 8000})]));
  const probes = [
    ['lydian', 6.5825, 415.3047, 391.9954, 'raised fourth G sharp'],
    ['dorian', 3.145, 493.8833, 466.1638, 'natural sixth B'],
    ['aeolian', 3.145, 466.1638, 493.8833, 'minor sixth B flat'],
    ['phrygian', 8.4575, 311.1270, 329.6276, 'minor second E flat'],
  ];
  for (const [mode, start, expected, other, label] of probes) {
    const channel = arrangements[mode].channels[0];
    assert.ok(energyAt(channel, start, expected) > energyAt(channel, start, other) * 8, `${mode}: ${label}`);
    assert.equal(channel.length, 160000, `${mode}: common clock and loop length`);
  }
  // The bass follows each scale too: Phrygian A takes an E-flat fifth,
  // while Dorian B takes F natural. A fixed seven-semitone fifth would borrow
  // notes from outside those modes despite the melody being correctly labeled.
  for (const [mode, start, expected, other] of [
    ['phrygian', 4.0825, 155.5635, 164.8138],
    ['dorian', 6.5825, 174.6141, 184.9972],
  ]) {
    const channel = music({mode, stem: 'bass', sampleRate: 8000}).channels[0];
    assert.ok(energyAt(channel, start, expected) > energyAt(channel, start, other) * 8,
      `${mode}: diatonic bass harmony without borrowed perfect fifths`);
  }
  const hashes = new Set(Object.values(arrangements).map(arrangement =>
    createHash('sha256').update(Buffer.from(arrangement.channels[0].buffer)).digest('hex')));
  assert.equal(hashes.size, 4, 'four musical arrangements, not four labels for the same audio');
});

test('the defeat phrase uses a minor third and neutral start/draw cues share the modal tonic', () => {
  const defeat = sound('defeat', {sampleRate: 8000});
  assert.ok(energyAt(defeat, .23, 349.2282) > energyAt(defeat, .23, 369.9944) * 5,
    'defeat supports the minor result music instead of sounding an F sharp');
  for (const name of ['go', 'draw']) {
    const samples = sound(name, {sampleRate: 8000});
    assert.ok(energyAt(samples, .01, 587.3295) > energyAt(samples, .01, 739.9888) * 5,
      `${name}: common D tonic`);
  }
});

test('the exporter writes bounded original PCM16 files with verifiable provenance and hashes', async () => {
  const output = await mkdtemp(join(tmpdir(), 'waterduel-audio-'));
  try {
    const result = await execute(process.execPath, ['scripts/export-game-audio.mjs', '--output', output, '--sample-rate', '8000'],
      {cwd: new URL('..', import.meta.url), timeout: 30000});
    assert.match(result.stdout, /35.*WAV/i);
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    assert.match(manifest.provenance.method, /procedural/i);
    assert.equal(manifest.provenance.externalSamples, false);
    assert.equal(manifest.music.bpm, 96);
    assert.equal(manifest.music.bars, 8);
    assert.equal(manifest.files.length, 35);
    assert.deepEqual(manifest.music.modes, ['lydian','dorian','aeolian','phrygian']);
    assert.equal(manifest.files.filter(file => file.kind === 'music').length, 16);
    assert.deepEqual(new Set(manifest.files.filter(file => file.kind === 'effect').map(file => file.name)), new Set(names));
    let bytes = 0;
    for (const entry of manifest.files) {
      const wav = await readFile(join(output, entry.file));
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
      assert.equal(wav.readUInt16LE(20), 1, 'uncompressed PCM');
      assert.equal(wav.readUInt16LE(34), 16);
      assert.equal(wav.readUInt32LE(24), 8000);
      assert.equal(wav.readUInt16LE(22), entry.channels);
      assert.equal(wav.length, 44 + entry.frames * entry.channels * 2);
      assert.equal(entry.duration, entry.frames / 8000);
      assert.equal(createHash('sha256').update(wav).digest('hex'), entry.sha256);
      assert.equal(wav.length, entry.bytes);
      assert.ok(entry.peak > 0 && entry.peak < .85 && entry.rms > 0);
      bytes += wav.length;
    }
    assert.ok(bytes < 14_000_000, 'bounded offline bank at the test sample rate');
    assert.equal((await readdir(output)).length, 36, 'only declared audio and manifest files');
  } finally {
    await rm(output, {recursive: true, force: true});
  }
});
