import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, readdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {SOUND_NAMES, renderSound} from '../public/audio/synthesis.js';

const bank = await import('../public/audio/foley-synthesis.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const names = ['blade-beat','blade-slide','shield-metal','shield-wood','wood-contact',
  'latex-rub','footstep-dry','footstep-wet','water-burst','blade-swish'];
const execute = promisify(execFile);
const oldManifestHash = '8bcf6bcaf982619c060a50bf403b4ed7f24508667c09f39c2e15ebcb1424cc16';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function render(name, options) {
  assert.equal(typeof bank.renderFoley, 'function', 'new Foley renderer is implemented');
  return bank.renderFoley(name, options);
}
function stats(samples, from = 0, to = samples.length) {
  let energy = 0, peak = 0, dc = 0, derivative = 0;
  for (let i = from; i < to; i++) {
    const value = samples[i];
    assert.ok(Number.isFinite(value), 'only finite audio samples');
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
    dc += value;
    if (i > from) derivative += (value - samples[i - 1]) ** 2;
  }
  return {peak, rms: Math.sqrt(energy / (to - from)), dc: dc / (to - from), brightness: derivative / Math.max(energy, 1e-12)};
}
const tailRatio = signal => stats(signal, 1600, 2400).rms / stats(signal, 0, 800).rms;

test('all ten new cues render bounded mono one-shots with finite samples and click-free headroom', () => {
  assert.deepEqual(bank.FOLEY_NAMES, names);
  for (const name of names) {
    const signal = render(name);
    assert.ok(signal instanceof Float32Array, name);
    assert.ok(signal.length >= 2205 && signal.length <= 28665, `${name}: .1 to 1.3 seconds`);
    const measured = stats(signal);
    assert.ok(measured.peak > .04 && measured.peak <= .78, `${name}: audible, unclipped headroom`);
    assert.ok(measured.rms > .004 && measured.rms < .23, `${name}: restrained useful level`);
    assert.ok(Math.abs(measured.dc) < .004, `${name}: no DC offset`);
    assert.equal(signal[0], 0);
    assert.equal(signal.at(-1), 0);
    assert.ok(Math.abs(signal[1]) < .015 && Math.abs(signal.at(-2)) < .015, `${name}: no endpoint step`);
  }
});

test('material and seed variations produce distinct reproducible waveforms at supported sample rates', () => {
  const hashes = new Set();
  for (const name of names) {
    const signal = render(name, {sampleRate: 8000, seed: 19});
    assert.deepEqual(signal, render(name, {sampleRate: 8000, seed: 19}), `${name}: reproducible seed`);
    assert.notDeepEqual(signal, render(name, {sampleRate: 8000, seed: 20}), `${name}: timbral seed variation`);
    assert.equal(render(name, {sampleRate: 48000}).length, render(name, {sampleRate: 8000}).length * 6);
    hashes.add(sha(Buffer.from(signal.buffer)));
  }
  assert.equal(hashes.size, 10, 'each material has distinct audio');
  assert.throws(() => render('missing'), /unknown.*foley/i);
  for (const sampleRate of [0, -1, 7999, 48001, 192000, Infinity, NaN, '22050']) {
    assert.throws(() => render('blade-beat', {sampleRate}), /sample.?rate/i);
  }
  for (const seed of [NaN, Infinity, 'seed', null]) {
    assert.throws(() => render('latex-rub', {seed}), /seed/i);
  }
});

test('steel and brass retain brighter/longer resonances than loaded wood', () => {
  const beat = render('blade-beat', {sampleRate: 8000});
  const metal = render('shield-metal', {sampleRate: 8000});
  const wood = render('shield-wood', {sampleRate: 8000});
  const loaded = render('wood-contact', {sampleRate: 8000});
  assert.ok(stats(beat).brightness > stats(loaded).brightness * 3, 'steel edge is brighter than loaded wooden thud');
  assert.ok(tailRatio(metal) > tailRatio(wood) * 3, 'brass shield rings longer than a hollow wooden shield');
  const slide = render('blade-slide', {sampleRate: 8000});
  assert.ok(tailRatio(slide) > tailRatio(beat) * 3, 'steel sliding sustains friction after the initial contact');
});

test('wet steps add water tails while latex rubbing and blade air remain nonimpact motions', () => {
  const dry = render('footstep-dry', {sampleRate: 8000});
  const wet = render('footstep-wet', {sampleRate: 8000});
  assert.ok(tailRatio(wet) > tailRatio(dry) * 2, 'wet ground adds a distinct trailing watery scuff');
  const latex = render('latex-rub', {sampleRate: 8000});
  assert.ok(stats(latex, 800, 2000).rms > stats(latex, 0, 80).rms * 5, 'latex squeaks under contact without a rupture crack');
  const swish = render('blade-swish', {sampleRate: 8000});
  assert.ok(stats(swish, 640, 1600).rms > stats(swish, 0, 80).rms * 5, 'blade air swells with motion');
});

test('pressure release keeps a jet tail distinct from the existing floor splash', () => {
  const burst = render('water-burst', {sampleRate: 8000});
  const splash = renderSound('splash', {sampleRate: 8000});
  const burstTail = stats(burst, 4000, 6400).rms / stats(burst, 0, 800).rms;
  const splashTail = stats(splash, 4000, 6400).rms / stats(splash, 0, 800).rms;
  assert.ok(burstTail > splashTail * 2, 'pressure release has sustained discharge beyond floor impact');
});

test('the original eighteen-cue API and all thirty-five workshop WAVs remain byte-for-byte intact', async () => {
  assert.deepEqual(SOUND_NAMES, ['wood','joint','metal','ring','whoosh','slosh','tension','puncture','tear',
    'jet','drip','splash','countdown','go','victory','defeat','draw','ui']);
  const root = new URL('../public/assets/audio/workshop/', import.meta.url);
  const raw = await readFile(new URL('manifest.json', root));
  assert.equal(sha(raw), oldManifestHash, 'original bank manifest is immutable');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.files.length, 35);
  for (const file of manifest.files) assert.equal(sha(await readFile(new URL(file.file, root))), file.sha256, file.file);
});

test('the new exporter emits only eleven bounded PCM16 WAVs and a manifest with exact hashes/levels', async () => {
  const output = await mkdtemp(join(tmpdir(), 'waterduel-foley-'));
  try {
    const result = await execute(process.execPath,
      ['scripts/export-foley-audio.mjs', '--output', output, '--sample-rate', '8000'],
      {cwd: new URL('..', import.meta.url), timeout: 30000});
    assert.match(result.stdout, /11.*WAV/i);
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.files.length, 11);
    assert.deepEqual(manifest.names, names);
    assert.equal(manifest.provenance.externalSamples, false);
    assert.equal(manifest.provenance.externalServices, false);
    assert.equal(manifest.preservedWorkshopManifestSHA256, oldManifestHash);
    let totalBytes = 0;
    for (const file of manifest.files) {
      const bytes = await readFile(join(output, file.file));
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
      assert.equal(bytes.readUInt16LE(20), 1);
      assert.equal(bytes.readUInt16LE(22), 1);
      assert.equal(bytes.readUInt16LE(34), 16);
      assert.equal(bytes.readUInt32LE(24), 8000);
      assert.equal(bytes.length, 44 + file.frames * 2);
      assert.equal(bytes.length, file.bytes);
      assert.equal(file.duration, file.frames / 8000);
      assert.equal(sha(bytes), file.sha256);
      let peak = 0, energy = 0;
      for (let i = 44; i < bytes.length; i += 2) {
        const sample = bytes.readInt16LE(i) / 32768;
        peak = Math.max(peak, Math.abs(sample));
        energy += sample * sample;
      }
      assert.equal(file.peak, peak, 'manifest reports exact delivered PCM peak');
      assert.equal(file.rms, Math.sqrt(energy / file.frames), 'manifest reports exact delivered PCM RMS');
      totalBytes += bytes.length;
    }
    assert.equal(totalBytes, manifest.totalBytes);
    assert.ok(totalBytes < 500000, 'small bounded offline Foley bank');
    assert.equal((await readdir(output)).length, 12);
    const rejected = await execute(process.execPath,
      ['scripts/export-foley-audio.mjs', '--output', output, '--sample-rate', '10000000'],
      {cwd: new URL('..', import.meta.url), timeout: 30000}).then(() => null, error => error);
    assert.ok(rejected && rejected.code === 1, 'unsafe allocation is rejected');
    assert.match(rejected.stderr, /sample.?rate/i);
    assert.equal((await readdir(output)).length, 12, 'invalid export does not add files');
  } finally {
    await rm(output, {recursive: true, force: true});
  }
});
