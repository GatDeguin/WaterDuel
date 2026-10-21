import {renderSound} from './synthesis.js';

/** Additional original Foley. The original workshop bank and music stay immutable. */
export const FOLEY_NAMES = Object.freeze([
  'blade-beat','blade-slide','shield-metal','shield-wood','wood-contact',
  'latex-rub','footstep-dry','footstep-wet','water-burst','blade-swish',
]);

const DURATIONS = {
  'blade-beat': .52, 'blade-slide': .74, 'shield-metal': .92, 'shield-wood': .42,
  'wood-contact': .4, 'latex-rub': .72, 'footstep-dry': .34, 'footstep-wet': .48,
  'water-burst': 1.2, 'blade-swish': .42,
};
const TAU = Math.PI * 2;

function randomSource(seed) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) throw new TypeError('Seed must be a finite number');
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function envelope(t, length, attack, release) {
  return Math.sin(Math.min(1, t / attack) * Math.PI / 2) ** 2 *
    Math.sin(Math.min(1, Math.max(0, (length - t) / release)) * Math.PI / 2) ** 2;
}

function resonator(out, sampleRate, random, {
  at = 0, length = .3, frequency, modes = [[1, 1]], decay = .08,
  attack = .001, gain = .2, sweep = 0, flex = 0,
}) {
  const start = Math.round(at * sampleRate);
  const count = Math.min(Math.round(length * sampleRate), out.length - start);
  const pitch = frequency * (.98 + random() * .04);
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const phase = TAU * pitch * (t + sweep * t * t / (2 * length));
    const bending = flex * Math.sin(TAU * (pitch * .47 * t + .7 * t * t)) * (.6 + .4 * Math.sin(TAU * 7 * t));
    let value = 0;
    for (let mode = 0; mode < modes.length; mode++) {
      const [ratio, level] = modes[mode];
      if (pitch * ratio * (1 + Math.max(0, sweep)) > sampleRate * .43) continue;
      value += Math.sin(phase * ratio + bending) * level * Math.exp(-t * (1 + mode * .18) / decay);
    }
    out[start + i] += value * gain * envelope(t, length, attack, .035);
  }
}

// Filtered friction with optional stick-slip grains, distinct from an impact's
// pitched resonances. The band limit tracks sample rate to avoid aliasing.
function friction(out, sampleRate, random, {
  at = 0, length = .3, low = 200, high = 2200, gain = .2,
  attack = .01, release = .08, decay = 1, grains = 0, swell = false,
}) {
  const start = Math.round(at * sampleRate);
  const count = Math.min(Math.round(length * sampleRate), out.length - start);
  const fastRate = 1 - Math.exp(-TAU * Math.min(high, sampleRate * .43) / sampleRate);
  const slowRate = 1 - Math.exp(-TAU * low / sampleRate);
  let fast = 0, slow = 0;
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    fast += fastRate * (random() * 2 - 1 - fast);
    slow += slowRate * (fast - slow);
    const grain = grains ? .2 + .8 * (.5 + .5 * Math.sin(TAU * grains * t + .7 * Math.sin(TAU * 11 * t))) ** 3 : 1;
    const motion = swell ? Math.sin(Math.PI * t / length) ** 2 : Math.exp(-t / decay);
    out[start + i] += (fast - slow) * gain * grain * motion * envelope(t, length, attack, release);
  }
}

function mix(out, source, sampleRate, at, gain) {
  const start = Math.round(at * sampleRate);
  const count = Math.min(source.length, out.length - start);
  for (let i = 0; i < count; i++) out[start + i] += source[i] * gain;
}

function footstep(out, sampleRate, random) {
  resonator(out, sampleRate, random, {frequency: 91, length: .3, gain: .25, decay: .045,
    modes: [[1, 1], [2.31, .22], [4.17, .055]]});
  resonator(out, sampleRate, random, {at: .031, frequency: 168, length: .21, gain: .12, decay: .037,
    modes: [[1, 1], [2.43, .17]]});
  friction(out, sampleRate, random, {at: .025, length: .19, gain: .11, low: 60, high: 950,
    attack: .014, release: .06, decay: .057, grains: 53});
}

function droplets(out, sampleRate, random, count, from, until, gain) {
  for (let i = 0; i < count; i++) {
    resonator(out, sampleRate, random, {at: from + random() * (until - from), length: .13,
      frequency: 420 + random() * 1050, sweep: .45 + random() * .5,
      gain: gain * (.35 + random() * .65), decay: .027 + random() * .02,
      modes: [[1, 1], [1.91, .13]], attack: .003});
  }
}

/** Mono one-shots at 8–48 kHz, all locally synthesized and reproducible. */
export function renderFoley(name, {sampleRate = 22050, seed = 1} = {}) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
    throw new RangeError('Sample rate must be an integer between 8000 and 48000 Hz');
  }
  if (!FOLEY_NAMES.includes(name)) throw new RangeError(`Unknown Foley sound: ${name}`);
  const random = randomSource(seed);
  const out = new Float32Array(Math.round(DURATIONS[name] * sampleRate));
  const ring = options => resonator(out, sampleRate, random, options);
  const rub = options => friction(out, sampleRate, random, options);
  const original = (sound, at, gain) => mix(out, renderSound(sound, {sampleRate, seed}), sampleRate, at, gain);
  switch (name) {
    case 'blade-beat':
      ring({frequency: 1020, length: .51, gain: .29, decay: .087,
        modes: [[1, 1], [1.47, .46], [2.71, .3], [4.13, .13], [5.37, .04]]});
      rub({length: .032, low: 1700, high: 6200, gain: .25, attack: .0006, release: .012, decay: .009});
      original('metal', 0, .21);
      break;
    case 'blade-slide':
      rub({length: .7, low: 520, high: 4100, gain: .27, attack: .024, release: .13, grains: 72, swell: true});
      ring({frequency: 850, length: .71, gain: .12, decay: .43, attack: .04, sweep: .18,
        modes: [[1, 1], [1.63, .29], [3.11, .15]], flex: .15});
      ring({at: .17, frequency: 1370, length: .46, gain: .07, decay: .22, attack: .02,
        modes: [[1, 1], [2.39, .16]]});
      break;
    case 'shield-metal':
      ring({frequency: 258, length: .91, gain: .32, decay: .28,
        modes: [[1, 1], [1.42, .64], [2.09, .39], [2.93, .23], [4.37, .12], [6.24, .055]]});
      ring({frequency: 930, length: .5, gain: .09, decay: .095, modes: [[1, 1], [2.67, .26]]});
      rub({length: .027, low: 500, high: 4200, gain: .15, attack: .001, decay: .009});
      break;
    case 'shield-wood':
      ring({frequency: 174, length: .41, gain: .36, decay: .052,
        modes: [[1, 1], [1.53, .44], [2.41, .2], [4.7, .07]]});
      ring({at: .012, frequency: 425, length: .16, gain: .1, decay: .025, modes: [[1, 1], [2.13, .17]]});
      original('wood', 0, .23);
      break;
    case 'wood-contact':
      ring({frequency: 88, length: .39, gain: .37, decay: .064, sweep: -.15,
        modes: [[1, 1], [1.73, .19], [2.57, .07]]});
      ring({at: .018, frequency: 157, length: .24, gain: .1, decay: .054, sweep: -.08,
        modes: [[1, 1], [2.37, .2]], flex: .1});
      rub({length: .065, low: 40, high: 700, gain: .14, attack: .002, decay: .02});
      break;
    case 'latex-rub':
      ring({frequency: 285, length: .69, gain: .19, decay: .65, attack: .073, sweep: .38, flex: 1.7,
        modes: [[1, 1], [1.97, .19], [3.04, .055]]});
      ring({at: .22, frequency: 390, length: .45, gain: .12, decay: .33, attack: .05, sweep: -.24,
        modes: [[1, 1], [2.03, .17]], flex: 1.2});
      rub({length: .68, low: 350, high: 1250, gain: .055, attack: .055, grains: 39, swell: true});
      break;
    case 'footstep-dry':
      footstep(out, sampleRate, random);
      break;
    case 'footstep-wet':
      footstep(out, sampleRate, random);
      rub({at: .027, length: .4, low: 130, high: 1400, gain: .27, attack: .012, release: .09, decay: .26, grains: 17});
      droplets(out, sampleRate, random, 7, .065, .32, .085);
      break;
    case 'water-burst':
      ring({frequency: 134, length: .24, gain: .28, decay: .034, sweep: -.65, flex: .8,
        modes: [[1, 1], [1.61, .17]]});
      rub({at: .018, length: 1.12, low: 190, high: 2900, gain: .37,
        attack: .012, release: .18, decay: 1.15, grains: 23});
      original('puncture', 0, .17);
      droplets(out, sampleRate, random, 20, .12, .98, .095);
      break;
    case 'blade-swish':
      rub({length: .4, low: 550, high: 3000, gain: .3, attack: .06, release: .14, swell: true});
      ring({frequency: 280, length: .35, gain: .055, decay: .28, attack: .08, sweep: -.38,
        modes: [[1, 1]], flex: .2});
      break;
  }
  // Remove very-low-frequency bias and taper ends without flattening dynamics.
  const dcPole = Math.exp(-TAU * 18 / sampleRate);
  let previous = 0, filtered = 0, peak = 0;
  for (let i = 0; i < out.length; i++) {
    const input = out[i];
    filtered = input - previous + dcPole * filtered;
    previous = input;
    out[i] = filtered * envelope(i / sampleRate, (out.length - 1) / sampleRate, .001, .008);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > .7) for (let i = 0; i < out.length; i++) out[i] *= .7 / peak;
  out[0] = out[out.length - 1] = 0;
  return out;
}
