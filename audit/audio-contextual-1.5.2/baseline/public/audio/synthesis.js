/** Original WaterDuel audio: a quiet mechanical toy workshop, synthesized locally.
 * No recordings, downloaded samples, AudioContext, or third-party dependencies.
 * The pure renderers work both in browsers and in the offline WAV exporter.
 */
export const SOUND_NAMES = Object.freeze([
  'wood','joint','metal','ring','whoosh','slosh','tension','puncture','tear',
  'jet','drip','splash','countdown','go','victory','defeat','draw','ui',
]);
export const MUSIC_STEMS = Object.freeze(['wood', 'metal', 'bass']);
export const MUSIC_MODES = Object.freeze(['lydian', 'dorian', 'aeolian', 'phrygian']);
export const MODE_INTERVALS = Object.freeze({
  lydian: Object.freeze([0, 2, 4, 6, 7, 9, 11]),
  dorian: Object.freeze([0, 2, 3, 5, 7, 9, 10]),
  aeolian: Object.freeze([0, 2, 3, 5, 7, 8, 10]),
  phrygian: Object.freeze([0, 1, 3, 5, 7, 8, 10]),
});

const TAU = Math.PI * 2;
const DURATIONS = {
  wood: .2, joint: .26, metal: .55, ring: 1.25, whoosh: .4, slosh: .68,
  tension: .55, puncture: .35, tear: .72, jet: .85, drip: .28, splash: 1,
  countdown: .18, go: .45, victory: 1.6, defeat: 1.5, draw: 1.1, ui: .1,
};

function checkSampleRate(sampleRate) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
    throw new RangeError('Sample rate must be an integer between 8000 and 48000 Hz');
  }
}

function randomSource(seed) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) throw new TypeError('Seed must be a finite number');
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function edge(t, length, attack = .002, release = .025) {
  const onset = Math.min(1, t / attack);
  const ending = Math.min(1, Math.max(0, (length - t) / release));
  return Math.sin(onset * Math.PI / 2) ** 2 * Math.sin(ending * Math.PI / 2) ** 2;
}

// Inharmonic modes make wood, steel and latex different even at the same pitch.
function tone(out, sampleRate, {
  at = 0, length = .3, frequency = 440, to = frequency, gain = .2,
  decay = .12, attack = .002, modes = [[1, 1], [2, .2]], fm = 0,
}) {
  const offset = Math.round(at * sampleRate);
  const count = Math.min(Math.round(length * sampleRate), out.length - offset);
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const phase = TAU * (frequency * t + (to - frequency) * t * t / (2 * length));
    const modulation = fm * Math.sin(TAU * frequency * .49 * t) * Math.exp(-t * 9);
    let value = 0;
    for (let m = 0; m < modes.length; m++) {
      const [ratio, level] = modes[m];
      if (Math.max(frequency, to) * ratio > sampleRate * .43) continue;
      value += Math.sin(phase * ratio + modulation) * level * Math.exp(-t / (decay / (1 + m * .27)));
    }
    out[offset + i] += value * gain * edge(t, length, attack);
  }
}

// Two low-pass states give colored air/water noise without a harsh full-band hiss.
function noise(out, sampleRate, random, {
  at = 0, length = .2, gain = .2, cutoff = 1600, lowCut = 100,
  decay = .2, attack = .003, pulse = 0,
}) {
  const offset = Math.round(at * sampleRate);
  const count = Math.min(Math.round(length * sampleRate), out.length - offset);
  const fast = 1 - Math.exp(-TAU * cutoff / sampleRate);
  const slow = 1 - Math.exp(-TAU * lowCut / sampleRate);
  let filtered = 0, low = 0;
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    filtered += fast * (random() * 2 - 1 - filtered);
    low += slow * (filtered - low);
    const flutter = pulse ? .65 + .35 * Math.sin(TAU * pulse * t) : 1;
    out[offset + i] += (filtered - low) * gain * edge(t, length, attack, .04) * Math.exp(-t / decay) * flutter;
  }
}

function bubbles(out, sampleRate, random, count, length, gain = .12) {
  for (let i = 0; i < count; i++) {
    const frequency = 420 + random() * 1050;
    const at = .015 + random() * Math.max(.01, length - .17);
    tone(out, sampleRate, {at, length: .13, frequency, to: frequency * (1.2 + random() * .35),
      gain: gain * (.4 + random() * .6), decay: .028 + random() * .025,
      modes: [[1, 1], [1.94, .12]], fm: .3});
  }
}

/** Render a mono one-shot. Seed selects subtle reproducible timbral variation. */
export function renderSound(name, {sampleRate = 22050, seed = 1} = {}) {
  checkSampleRate(sampleRate);
  if (!SOUND_NAMES.includes(name)) throw new RangeError(`Unknown sound: ${name}`);
  const random = randomSource(seed);
  const out = new Float32Array(Math.round(DURATIONS[name] * sampleRate));
  const detune = .97 + random() * .06;
  const strike = (options) => tone(out, sampleRate, {...options, frequency: options.frequency * detune,
    ...(options.to === undefined ? {} : {to: options.to * detune})});
  const air = options => noise(out, sampleRate, random, options);
  switch (name) {
    case 'wood':
      strike({length: .19, frequency: 310, gain: .37, decay: .037, modes: [[1, 1], [2.43, .36], [4.13, .13]]});
      air({length: .022, gain: .13, cutoff: 2600, decay: .008});
      break;
    case 'joint':
      strike({length: .23, frequency: 185, to: 165, gain: .23, decay: .061, modes: [[1, 1], [1.79, .25], [3.1, .12]], fm: .2});
      strike({at: .037, length: .12, frequency: 470, gain: .11, decay: .023, modes: [[1, 1], [2.41, .3]]});
      break;
    case 'metal':
      strike({length: .54, frequency: 650, gain: .21, decay: .13, modes: [[1, 1], [2.71, .34], [4.96, .14]]});
      air({length: .025, gain: .09, cutoff: 3200, decay: .009});
      break;
    case 'ring':
      strike({length: 1.24, frequency: 870, gain: .18, decay: .34, attack: .004,
        modes: [[1, 1], [2.76, .32], [5.4, .09]]});
      break;
    case 'whoosh':
      air({length: .39, gain: .34, cutoff: 1100, lowCut: 180, decay: .3, attack: .11});
      strike({length: .35, frequency: 105, to: 65, gain: .06, decay: .23, attack: .05, modes: [[1, 1]]});
      break;
    case 'slosh':
      air({length: .65, gain: .28, cutoff: 600, lowCut: 70, decay: .33, attack: .035, pulse: 7});
      strike({length: .48, frequency: 122, to: 83, gain: .13, decay: .17, attack: .012, modes: [[1, 1], [1.34, .3]], fm: .7});
      bubbles(out, sampleRate, random, 8, .63, .065);
      break;
    case 'tension':
      strike({length: .54, frequency: 160, to: 290, gain: .24, decay: .5, attack: .045,
        modes: [[1, 1], [1.96, .22], [3.06, .09]], fm: 1.1});
      break;
    case 'puncture':
      strike({length: .2, frequency: 570, to: 115, gain: .38, decay: .031,
        modes: [[1, 1], [1.72, .27]], fm: 1.5});
      air({length: .1, gain: .29, cutoff: 2400, lowCut: 400, decay: .025});
      bubbles(out, sampleRate, random, 3, .31, .085);
      break;
    case 'tear':
      air({length: .7, gain: .34, cutoff: 1700, lowCut: 240, decay: .27, attack: .009, pulse: 37});
      strike({length: .44, frequency: 300, to: 105, gain: .22, decay: .13,
        modes: [[1, 1], [1.43, .38], [2.13, .14]], fm: 1.8});
      break;
    case 'jet':
      air({length: .83, gain: .36, cutoff: 2200, lowCut: 350, decay: .75, attack: .035, pulse: 13});
      bubbles(out, sampleRate, random, 12, .8, .055);
      break;
    case 'drip':
      strike({length: .22, frequency: 660, to: 1240, gain: .3, decay: .034,
        modes: [[1, 1], [1.97, .16]], fm: .6});
      strike({at: .045, length: .19, frequency: 350, to: 510, gain: .08, decay: .045, modes: [[1, 1]]});
      break;
    case 'splash':
      air({length: .95, gain: .39, cutoff: 1250, lowCut: 80, decay: .23, attack: .012});
      strike({length: .37, frequency: 110, to: 58, gain: .25, decay: .085, modes: [[1, 1], [1.63, .24]], fm: .6});
      bubbles(out, sampleRate, random, 18, .95, .095);
      break;
    case 'countdown':
      strike({length: .17, frequency: 620, gain: .24, decay: .047, modes: [[1, 1], [2, .14]]});
      break;
    case 'go':
      for (let i = 0; i < 2; i++) strike({at: i * .075, length: .28, frequency: [587.33, 880][i],
        gain: .2, decay: .08, modes: [[1, 1], [2.76, .16]]});
      break;
    case 'victory':
      for (let i = 0; i < 4; i++) strike({at: i * .16, length: 1.1, frequency: [587.33, 739.99, 880, 1174.66][i],
        gain: .16, decay: .27, attack: .005, modes: [[1, 1], [2.76, .22], [5.4, .05]]});
      break;
    case 'defeat':
      for (let i = 0; i < 3; i++) strike({at: i * .21, length: 1.05, frequency: [440, 349.23, 293.66][i],
        gain: .15, decay: .24, attack: .008, modes: [[1, 1], [2, .2], [3.02, .07]]});
      break;
    case 'draw':
      for (const [at, frequency] of [[0, 587.33], [.2, 440], [.4, 587.33]]) strike({at, length: .68, frequency,
        gain: .16, decay: .17, attack: .005, modes: [[1, 1], [2.76, .18]]});
      break;
    case 'ui':
      strike({length: .095, frequency: 1040, gain: .16, decay: .021, modes: [[1, 1], [2.4, .12]]});
      break;
  }
  // Tiny end tapers prevent clicks; preserve natural dynamics instead of maximizing loudness.
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] *= edge(i / sampleRate, (out.length - 1) / sampleRate, .0015, .008);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > .72) for (let i = 0; i < out.length; i++) out[i] *= .72 / peak;
  out[0] = out[out.length - 1] = 0;
  return out;
}

const midiFrequency = note => 440 * 2 ** ((note - 69) / 12);

// Modular placement includes the previous cycle's ringing tail at sample zero.
// No fade-to-silence or seam crossfade truncates the percussion and bell decays.
function placeLoop(channels, samples, at, sampleRate, pan = 0, gain = 1) {
  const offset = Math.round(at * sampleRate);
  const left = Math.cos((pan + 1) * Math.PI / 4) * gain;
  const right = Math.sin((pan + 1) * Math.PI / 4) * gain;
  for (let i = 0; i < samples.length; i++) {
    const index = (offset + i) % channels[0].length;
    channels[0][index] += samples[i] * left;
    channels[1][index] += samples[i] * right;
  }
}

function scoreStem(stem, sampleRate, mode) {
  const channels = [new Float32Array(sampleRate * 20), new Float32Array(sampleRate * 20)];
  const beat = .625;
  const random = randomSource(173);
  const scale = MODE_INTERVALS[mode];
  const degreeNote = (degree, tonic = 62) => tonic + scale[degree % 7] + Math.floor(degree / 7) * 12;
  const addNote = (at, note, pan, options, echoes = false) => {
    const source = new Float32Array(Math.round(options.length * sampleRate));
    tone(source, sampleRate, {...options, frequency: midiFrequency(note)});
    placeLoop(channels, source, at * beat, sampleRate, pan);
    if (echoes) {
      placeLoop(channels, source, at * beat + .1875, sampleRate, -pan * .8, .22);
      placeLoop(channels, source, at * beat + .375, sampleRate, pan * .6, .075);
    }
  };
  for (let bar = 0; bar < 8; bar++) {
    if (stem === 'wood') {
      for (const [position, degree, velocity] of [[0, 0, 1], [1.5, 4, .57], [2, 0, .76], [3.5, 2, .49]]) {
        addNote(bar * 4 + position, degreeNote(degree), -.34 + random() * .17,
          {length: .48, gain: .085 * velocity, decay: .095, attack: .003,
            modes: [[1, 1], [2.43, .26], [4.13, .065]]});
      }
      // A quiet lower wooden gear turns just before each new bar, including the seam.
      addNote(bar * 4 + 3.8, 50, .3, {length: .5, gain: .027, decay: .13, attack: .004,
        modes: [[1, 1], [2.43, .17]]});
    } else if (stem === 'bass') {
      const rootDegree = [0, 4, 5, 0][bar % 4];
      const root = degreeNote(rootDegree, 38);
      addNote(bar * 4, root, -.06, {length: 3.5, gain: .075, decay: 1.2, attack: .035,
        modes: [[1, 1], [2, .23], [3, .055]]});
      addNote(bar * 4 + 2.5, degreeNote(rootDegree + 4, 38), .09, {length: 2, gain: .04, decay: .65, attack: .025,
        modes: [[1, 1], [2, .16]]});
    } else {
      const phrase = [
        [[.5, 7], [2.75, 9]], [[1, 5], [3.5, 4]],
        [[.75, 8], [2.5, 3]], [[1.5, 1], [3.75, 6]],
        [[.5, 7], [2.75, 10]], [[1, 9], [3.5, 8]],
        [[.75, 5], [2.5, 3]], [[1.5, 1], [3.75, 7]],
      ][bar];
      for (const [position, degree] of phrase) addNote(bar * 4 + position, degreeNote(degree), .34 + random() * .2,
        {length: 2.25, gain: .062, decay: .61, attack: .009,
          modes: [[1, 1], [2.76, .23], [5.4, .055]]}, true);
    }
  }
  return channels;
}

/** Eight modal bars on tonic D, 4/4 at 96 BPM. Every mode/stem shares one clock.
 * Lydian #4, Dorian natural 6, Aeolian b6 and Phrygian b2 are voiced in the melody;
 * the wooden pitched percussion and bass also follow the selected scale.
 */
export function renderMusic({sampleRate = 22050, stem = 'mix', mode = 'lydian'} = {}) {
  checkSampleRate(sampleRate);
  if (stem !== 'mix' && !MUSIC_STEMS.includes(stem)) throw new RangeError(`Unknown music stem: ${stem}`);
  if (!MUSIC_MODES.includes(mode)) throw new RangeError(`Unknown music mode: ${mode}`);
  const channels = [new Float32Array(sampleRate * 20), new Float32Array(sampleRate * 20)];
  for (const part of stem === 'mix' ? MUSIC_STEMS : [stem]) {
    const rendered = scoreStem(part, sampleRate, mode);
    for (let channel = 0; channel < 2; channel++) {
      for (let i = 0; i < channels[channel].length; i++) channels[channel][i] += rendered[channel][i];
    }
  }
  return {channels, sampleRate, bpm: 96, bars: 8, duration: 20};
}
