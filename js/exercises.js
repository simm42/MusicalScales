// Exercise catalogue and settings -> placed exercise. No DOM access.

import {
  MAJOR_KEYS, MINOR_KEYS, START_NOTES, parsePc, pcName, generateSteps, shiftSteps,
  stepsMidiRange, keyFifths, transpose, noteName, midiOf,
} from './theory.js';
import { instrumentInfo } from './instruments.js';

const ALL = ['violin', 'viola', 'cello', 'bass'];
const UPPER = ['violin', 'viola', 'cello'];

export const EXERCISE_TYPES = {
  scale:        { label: 'Scale', instruments: ALL, keyKind: 'key', tonality: true, forms: true, ranges: ['1', '2', '3', '6th', '12th'], bassOnlyRanges: ['6th', '12th'], slurs: [2, 4, 7] },
  arpeggio:     { label: 'Arpeggio', instruments: ALL, keyKind: 'key', tonality: true, forms: false, ranges: ['1', '2', '3', '12th'], bassOnlyRanges: ['12th'], slurs: [2, 3, 6, 9] },
  chromatic:    { label: 'Chromatic scale', instruments: ALL, keyKind: 'start', ranges: ['1', '2', '3'], slurs: [3, 4, 6, 12] },
  dom7:         { label: 'Dominant 7th', instruments: ALL, keyKind: 'majorKey', ranges: ['1', '2', '3'], slurs: [2, 4] },
  dim7:         { label: 'Diminished 7th', instruments: ALL, keyKind: 'start', ranges: ['1', '2', '3'], slurs: [2, 4] },
  dsBroken:     { label: 'Double stops – broken steps', instruments: UPPER, keyKind: 'key', tonality: true, forms: true, intervals: true, ranges: ['1', '2'], slurs: [2] },
  dsParallel:   { label: 'Double stops – together', instruments: UPPER, keyKind: 'key', tonality: true, forms: true, intervals: true, ranges: ['1', '2'], slurs: [], doubleStop: true },
  brokenThirds: { label: 'Scale in broken thirds', instruments: ['bass'], keyKind: 'key', tonality: true, forms: true, ranges: ['1', '2'], slurs: [2] },
  runningThirds:{ label: 'Scale in running thirds', instruments: ['bass'], keyKind: 'key', tonality: true, forms: true, ranges: ['1', '2'], slurs: [3] },
  thumbScale:   { label: 'Thumb-position scale', instruments: ['cello', 'bass'], keyKind: 'key', tonality: true, forms: true, ranges: ['1'], slurs: [2, 4, 7] },
};

export const MINOR_FORMS = { natural: 'natural', harmonic: 'harmonic', melodic: 'melodic' };
export const INTERVAL_LABELS = { '3rds': 'thirds', '6ths': 'sixths', '8ves': 'octaves' };
export const RANGE_LABELS = { 1: '1 octave', 2: '2 octaves', 3: '3 octaves', '6th': 'to a 6th', '12th': 'to a 12th' };

export const DEFAULT_SETTINGS = {
  instrument: 'violin',
  type: 'scale',
  mode: 'major',
  key: 'G',
  start: 'G',
  form: 'harmonic',
  interval: '6ths',
  range: '2',
  octaveUp: false,
  rhythm: 'crotchet',
  longEnds: false,
  longMidTonics: false,
  repeatTop: false,
  slur: 0,
  display: 'score',
  clefMode: 'change',
  metronome: false,
  bpm: 60,
  precision: 2,
  vibrato: false,
  hint: false,
};

export function typesForInstrument(inst) {
  return Object.entries(EXERCISE_TYPES).filter(([, t]) => t.instruments.includes(inst)).map(([id]) => id);
}

export function rangesFor(inst, type) {
  const t = EXERCISE_TYPES[type];
  return t.ranges.filter((r) => inst === 'bass' || !(t.bassOnlyRanges || []).includes(r));
}

export function keyListFor(s) {
  const t = EXERCISE_TYPES[s.type];
  if (t.keyKind === 'start') return START_NOTES;
  if (t.keyKind === 'majorKey') return MAJOR_KEYS;
  return s.mode === 'minor' ? MINOR_KEYS : MAJOR_KEYS;
}

/** Normalise settings so that every field is valid for the chosen instrument/type. */
export function normalise(input) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  if (!EXERCISE_TYPES[s.type] || !EXERCISE_TYPES[s.type].instruments.includes(s.instrument)) s.type = 'scale';
  const t = EXERCISE_TYPES[s.type];
  if (!t.tonality) s.mode = 'major';
  if (t.keyKind === 'start') { if (!START_NOTES.includes(s.start)) s.start = 'G'; }
  else if (!keyListFor(s).includes(s.key)) s.key = s.mode === 'minor' ? 'A' : 'C';
  const ranges = rangesFor(s.instrument, s.type);
  if (!ranges.includes(String(s.range))) s.range = ranges[0];
  s.range = String(s.range);
  if (!t.intervals) s.interval = '6ths';
  if (s.rhythm !== 'crotchet' || !t.slurs.includes(Number(s.slur))) s.slur = 0;
  s.slur = Number(s.slur);
  s.bpm = Math.min(200, Math.max(30, Number(s.bpm) || 60));
  s.precision = Math.min(4, Math.max(0, Number(s.precision)));
  return s;
}

function rootPc(s) {
  const t = EXERCISE_TYPES[s.type];
  return parsePc(t.keyKind === 'start' ? s.start : s.key);
}

/**
 * Build the exercise for a settings object: generated steps placed on the
 * instrument, title, key signature. Returns { ok:false, reason } if it does
 * not fit the instrument's range.
 */
export function buildExercise(input) {
  const s = normalise(input);
  const info = instrumentInfo(s.instrument);
  const t = EXERCISE_TYPES[s.type];
  const pc = rootPc(s);
  const root = { ...pc, o: 0 };
  let gen = generateSteps({ type: s.type, mode: s.mode, form: s.form, range: s.range, interval: s.interval }, root);
  const { lo } = stepsMidiRange(gen);
  const floor = s.type === 'thumbScale' ? info.thumbMidi : info.lowestMidi;
  let k = Math.ceil((floor - lo) / 12);
  if (s.octaveUp) k += 1;
  gen = shiftSteps(gen, k);
  const range = stepsMidiRange(gen);
  const fifths = t.keyKind === 'key' ? keyFifths(pc, s.mode) : t.keyKind === 'majorKey' ? keyFifths(pc, 'major') : 0;
  const title = makeTitle(s, gen);
  const res = { settings: s, info, type: t, gen, fifths, title, lowMidi: range.lo, highMidi: range.hi };
  if (range.hi > info.highestMidi) {
    const top = gen.steps.flatMap((x) => x.notes).find((n) => midiOf(n) === range.hi);
    return { ...res, ok: false, reason: `The top note (${noteName(top, { octave: true })}) is above the ${info.name.toLowerCase()} range set for this tool (${info.highest}).` };
  }
  return { ...res, ok: true };
}

/** Is a given variant (e.g. another range or octaveUp) playable? Used to disable options. */
export function isPlayable(s, patch) {
  try { return buildExercise({ ...s, ...patch }).ok; } catch { return false; }
}

const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);

export function makeTitle(s, gen) {
  const t = EXERCISE_TYPES[s.type];
  const K = t.keyKind === 'start' ? pcName(parsePc(s.start)) : pcName(parsePc(s.key));
  const modeTxt = s.mode === 'minor' ? `minor${t.forms ? ` (${s.form})` : ''}` : 'major';
  const range = RANGE_LABELS[s.range];
  switch (s.type) {
    case 'scale': return `${K} ${modeTxt} scale, ${range}`;
    case 'arpeggio': return `${K} ${s.mode} arpeggio, ${range}`;
    case 'chromatic': return `Chromatic scale starting on ${K}, ${range}`;
    case 'dom7': {
      const first = gen ? gen.steps[0].notes[0] : transpose({ ...parsePc(s.key), o: 4 }, -3, -5);
      return `Dominant 7th in the key of ${K} (starting on ${noteName(first)}), ${range}`;
    }
    case 'dim7': return `Diminished 7th starting on ${K}, ${range}`;
    case 'dsBroken': return `${K} ${modeTxt} in ${INTERVAL_LABELS[s.interval]}, broken steps, ${range}`;
    case 'dsParallel': return `${K} ${modeTxt} in ${INTERVAL_LABELS[s.interval]}, double stops, ${range}`;
    case 'brokenThirds': return `${K} ${modeTxt} scale in broken thirds, ${range}`;
    case 'runningThirds': return `${K} ${modeTxt} scale in running thirds, ${range}`;
    case 'thumbScale': return `${K} ${modeTxt} scale in thumb position, ${range}`;
    default: return cap(t.label);
  }
}
