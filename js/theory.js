// Music theory core: note spelling by letter-name arithmetic, keys, and
// generators for every exercise type. No DOM access – safe to unit test.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_SEMI = [0, 2, 4, 5, 7, 9, 11];
const LETTER_FIFTHS = [0, 2, 4, -1, 1, 3, 5]; // position on circle of fifths for natural letters

// A note is { l: letter index 0-6, a: accidental (-2..2), o: octave (scientific) }

export function makeNote(l, a, o) { return { l, a, o }; }

export function parseNote(str) {
  const m = /^([A-Ga-g])(##|#|x|bb|b|♯|♭|♮)?(-?\d+)?$/.exec(String(str).trim());
  if (!m) throw new Error('Bad note: ' + str);
  const l = LETTERS.indexOf(m[1].toUpperCase());
  const accMap = { '#': 1, '♯': 1, '##': 2, x: 2, b: -1, '♭': -1, bb: -2, '♮': 0 };
  const a = m[2] ? accMap[m[2]] : 0;
  const o = m[3] !== undefined ? parseInt(m[3], 10) : 4;
  return { l, a, o };
}

export function midiOf(n) { return 12 * (n.o + 1) + LETTER_SEMI[n.l] + n.a; }

export function samePitchClassSpelling(a, b) { return a.l === b.l && a.a === b.a; }

const ACC_UNICODE = { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' };
const ACC_ASCII = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };

export function noteName(n, { octave = false, unicode = true } = {}) {
  const acc = (unicode ? ACC_UNICODE : ACC_ASCII)[String(n.a)];
  return LETTERS[n.l] + acc + (octave ? n.o : '');
}

/** Pitch-class name string such as 'F#' / 'Bb' -> {l, a} (octave ignored). */
export function parsePc(str) { const n = parseNote(str); return { l: n.l, a: n.a }; }
export function pcName(pc, unicode = true) { return noteName({ ...pc, o: 0 }, { unicode }); }

/** Move a note by a number of letter steps and semitones, keeping correct spelling. */
export function transpose(n, letterSteps, semis) {
  const L = n.l + letterSteps;
  const o = n.o + Math.floor(L / 7);
  const l = ((L % 7) + 7) % 7;
  const target = midiOf(n) + semis;
  const natural = 12 * (o + 1) + LETTER_SEMI[l];
  return { l, a: target - natural, o };
}

export function octaveShift(n, k) { return { l: n.l, a: n.a, o: n.o + k }; }

const SHARP_SPELL = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
const FLAT_SPELL = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];

/** Spell a MIDI number with a sharp or flat preference for black keys. */
export function spellMidi(midi, pref = 'sharp') {
  const pc = ((midi % 12) + 12) % 12;
  const [l, a] = (pref === 'flat' ? FLAT_SPELL : SHARP_SPELL)[pc];
  const o = Math.floor((midi - LETTER_SEMI[l] - a) / 12) - 1;
  return { l, a, o };
}

// ---------------------------------------------------------------- keys

export const MAJOR_KEYS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'Cb'];
export const MINOR_KEYS = ['A', 'A#', 'Bb', 'B', 'C', 'C#', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'Ab'];
export const START_NOTES = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];

/** Number of sharps (+) or flats (-) in the key signature. */
export function keyFifths(tonicPc, mode) {
  let pc = tonicPc;
  if (mode === 'minor') {
    const rel = transpose({ ...tonicPc, o: 4 }, 2, 3);
    pc = { l: rel.l, a: rel.a };
  }
  return LETTER_FIFTHS[pc.l] + 7 * pc.a;
}

const MAJOR_BY_FIFTHS = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
/** VexFlow key-signature spec (always expressed via the major key with the same signature). */
export function vexKeySpec(fifths) { return MAJOR_BY_FIFTHS[String(fifths)] || 'C'; }

/** Accidental the key signature gives to a letter (letter index 0-6). */
export function keySigAccidental(fifths, l) {
  const sharpOrder = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
  const flatOrder = [6, 2, 5, 1, 4, 0, 3];  // B E A D G C F
  if (fifths > 0) return sharpOrder.slice(0, fifths).includes(l) ? 1 : 0;
  if (fifths < 0) return flatOrder.slice(0, -fifths).includes(l) ? -1 : 0;
  return 0;
}

// ---------------------------------------------------------------- scales

const SCALE_SEMIS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  natural: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  melodic: [0, 2, 3, 5, 7, 9, 11],
};

function tables(mode, form) {
  if (mode === 'major') return { up: SCALE_SEMIS.major, down: SCALE_SEMIS.major };
  if (form === 'melodic') return { up: SCALE_SEMIS.melodic, down: SCALE_SEMIS.natural };
  if (form === 'harmonic') return { up: SCALE_SEMIS.harmonic, down: SCALE_SEMIS.harmonic };
  return { up: SCALE_SEMIS.natural, down: SCALE_SEMIS.natural };
}

function degreeNote(tonic, degree, table) {
  const oct = Math.floor(degree / 7);
  const d = ((degree % 7) + 7) % 7;
  return transpose(tonic, degree, table[d] + 12 * oct);
}

/** Span in scale degrees for a range code. */
export function spanDegrees(range) {
  if (range === '6th') return 5;
  if (range === '12th') return 11;
  return 7 * parseInt(range, 10);
}

const step = (notes, flags = {}) => ({ notes, tonic: false, ...flags });

function ascDesc(asc, desc) {
  const steps = [...asc, ...desc];
  return { steps, topIndex: asc.length - 1 };
}

function scaleSteps(tonic, mode, form, span) {
  const t = tables(mode, form);
  const asc = [], desc = [];
  for (let d = 0; d <= span; d++) asc.push(step([degreeNote(tonic, d, t.up)], { tonic: d % 7 === 0 }));
  for (let d = span - 1; d >= 0; d--) desc.push(step([degreeNote(tonic, d, t.down)], { tonic: d % 7 === 0 }));
  return ascDesc(asc, desc);
}

function arpeggioSteps(tonic, mode, span) {
  const t = tables(mode, 'harmonic');
  const degs = [];
  for (let k = 0; k * 7 <= span; k++) for (const c of [0, 2, 4]) { const d = 7 * k + c; if (d <= span) degs.push(d); }
  const asc = degs.map((d) => step([degreeNote(tonic, d, t.up)], { tonic: d % 7 === 0 }));
  const desc = degs.slice(0, -1).reverse().map((d) => step([degreeNote(tonic, d, t.up)], { tonic: d % 7 === 0 }));
  return ascDesc(asc, desc);
}

function chromaticSteps(start, octaves) {
  const m0 = midiOf(start);
  const n = 12 * octaves;
  const spell = (s, pref) => (s % 12 === 0 ? octaveShift(start, s / 12) : spellMidi(m0 + s, pref));
  const asc = [], desc = [];
  for (let s = 0; s <= n; s++) asc.push(step([spell(s, 'sharp')], { tonic: s % 12 === 0 }));
  for (let s = n - 1; s >= 0; s--) desc.push(step([spell(s, 'flat')], { tonic: s % 12 === 0 }));
  return ascDesc(asc, desc);
}

function dom7Steps(keyTonic, octaves) {
  // tonic given an octave; the dominant below it starts the exercise
  const dom = transpose(keyTonic, -3, -5); // a fourth below the tonic
  const chord = [[0, 0], [2, 4], [4, 7], [6, 10]];
  const asc = [];
  for (let k = 0; k < octaves; k++) for (const [ls, s] of chord) asc.push(step([transpose(dom, ls + 7 * k, s + 12 * k)]));
  asc.push(step([transpose(dom, 7 * octaves, 12 * octaves)]));
  const desc = asc.slice(1, -1).reverse().map((s) => step(s.notes));
  // resolve: leading note (3rd of the dominant) rises to the tonic
  desc.push(step([transpose(dom, 3, 5)], { tonic: true }));
  return ascDesc(asc, desc);
}

function dim7Steps(start, octaves) {
  const pref = start.a > 0 ? 'sharp' : 'flat';
  const m0 = midiOf(start);
  const semis = [];
  for (let k = 0; k < octaves; k++) semis.push(12 * k, 12 * k + 3, 12 * k + 6, 12 * k + 9);
  semis.push(12 * octaves);
  const spell = (s) => (s % 12 === 0 ? octaveShift(start, s / 12) : spellMidi(m0 + s, pref));
  const asc = semis.map((s) => step([spell(s)], { tonic: s % 12 === 0 }));
  const desc = semis.slice(0, -1).reverse().map((s) => step([spell(s)], { tonic: s % 12 === 0 }));
  return ascDesc(asc, desc);
}

export const DS_INTERVALS = { '3rds': 2, '6ths': 5, '8ves': 7 };

function doubleStopPairs(tonic, mode, form, span, gap) {
  const t = tables(mode, form);
  const up = [], down = [];
  for (let d = 0; d <= span; d++) up.push([degreeNote(tonic, d, t.up), degreeNote(tonic, d + gap, t.up)]);
  for (let d = span - 1; d >= 0; d--) down.push([degreeNote(tonic, d, t.down), degreeNote(tonic, d + gap, t.down)]);
  return { up, down };
}

function dsParallelSteps(tonic, mode, form, span, gap) {
  const { up, down } = doubleStopPairs(tonic, mode, form, span, gap);
  return ascDesc(up.map((p, i) => step(p, { tonic: i % 7 === 0 })), down.map((p, i) => step(p, { tonic: (span - 1 - i) % 7 === 0 })));
}

function dsBrokenSteps(tonic, mode, form, span, gap) {
  const { up, down } = doubleStopPairs(tonic, mode, form, span, gap);
  const asc = up.flatMap(([lo, hi]) => [step([lo]), step([hi])]);
  const desc = down.flatMap(([lo, hi]) => [step([lo]), step([hi])]);
  return ascDesc(asc, desc);
}

function brokenThirdsSteps(tonic, mode, form, span) {
  const t = tables(mode, form);
  const asc = [], desc = [];
  for (let i = 0; i <= span - 2; i++) asc.push(step([degreeNote(tonic, i, t.up)], { tonic: i % 7 === 0 }), step([degreeNote(tonic, i + 2, t.up)], { tonic: (i + 2) % 7 === 0 }));
  for (let i = span; i >= 2; i--) desc.push(step([degreeNote(tonic, i, t.down)], { tonic: i % 7 === 0 }), step([degreeNote(tonic, i - 2, t.down)], { tonic: (i - 2) % 7 === 0 }));
  // the top note ends the ascent and begins the descent: play it once
  desc.shift();
  return ascDesc(asc, desc);
}

function runningThirdsSteps(tonic, mode, form, span) {
  const t = tables(mode, form);
  const asc = [], desc = [];
  for (let i = 0; i <= span - 2; i++) for (const d of [i, i + 1, i + 2]) asc.push(step([degreeNote(tonic, d, t.up)], { tonic: d % 7 === 0 }));
  for (let i = span; i >= 2; i--) for (const d of [i, i - 1, i - 2]) desc.push(step([degreeNote(tonic, d, t.down)], { tonic: d % 7 === 0 }));
  desc.shift();
  return ascDesc(asc, desc);
}

/**
 * Generate the raw note steps for an exercise. `root` is the tonic/start note
 * with an octave; the caller places it on the instrument afterwards.
 */
export function generateSteps(spec, root) {
  const { type, mode = 'major', form = 'harmonic', range = '1', interval = '6ths' } = spec;
  const span = spanDegrees(range);
  const octs = Math.max(1, parseInt(range, 10) || 1);
  switch (type) {
    case 'scale':
    case 'thumbScale': return scaleSteps(root, mode, form, span);
    case 'arpeggio': return arpeggioSteps(root, mode, span);
    case 'chromatic': return chromaticSteps(root, octs);
    case 'dom7': return dom7Steps(root, octs);
    case 'dim7': return dim7Steps(root, octs);
    case 'dsParallel': return dsParallelSteps(root, mode, form, span, DS_INTERVALS[interval]);
    case 'dsBroken': return dsBrokenSteps(root, mode, form, span, DS_INTERVALS[interval]);
    case 'brokenThirds': return brokenThirdsSteps(root, mode, form, span);
    case 'runningThirds': return runningThirdsSteps(root, mode, form, span);
    default: throw new Error('Unknown exercise type ' + type);
  }
}

export function shiftSteps(gen, k) {
  if (!k) return gen;
  return { ...gen, steps: gen.steps.map((s) => ({ ...s, notes: s.notes.map((n) => octaveShift(n, k)) })) };
}

export function stepsMidiRange(gen) {
  let lo = Infinity, hi = -Infinity;
  for (const s of gen.steps) for (const n of s.notes) { const m = midiOf(n); lo = Math.min(lo, m); hi = Math.max(hi, m); }
  return { lo, hi };
}

// Frequency helpers --------------------------------------------------------
export function midiToFreq(m, a4 = 440) { return a4 * Math.pow(2, (m - 69) / 12); }
export function freqToMidi(f, a4 = 440) { return 69 + 12 * Math.log2(f / a4); }
