// Instrument data. All pitches are WRITTEN pitches; `transpose` is the number
// of semitones from written to sounding (the double bass sounds an octave lower).
// Edit this table to change ranges, starting notes or clef-change points.
// The voice and "other instrument" take their range from the device profile
// (profiles.js): the singer's measured range, or the notes chosen in Config.

import { parseNote, midiOf, spellMidi, noteName } from './theory.js';
import { getProfile, cleanOther } from './profiles.js';

export const INSTRUMENTS = {
  violin: {
    name: 'Violin',
    clef: 'treble',
    strings: ['G3', 'D4', 'A4', 'E5'],
    lowest: 'G3',
    highest: 'E7',
    transpose: 0,
    clefChanges: [],
    tuningSystem: 'fifths',
  },
  viola: {
    name: 'Viola',
    clef: 'alto',
    strings: ['C3', 'G3', 'D4', 'A4'],
    lowest: 'C3',
    highest: 'A6',
    transpose: 0,
    // [clef, go up into it at or above, drop back out below]
    clefChanges: [['treble', 'G5', 'D5']],
    tuningSystem: 'fifths',
  },
  cello: {
    name: 'Cello',
    clef: 'bass',
    strings: ['C2', 'G2', 'D3', 'A3'],
    lowest: 'C2',
    highest: 'C6',
    transpose: 0,
    thumbStart: 'D4',
    clefChanges: [['tenor', 'E4', 'C4'], ['treble', 'F5', 'C5']],
    tuningSystem: 'fifths',
  },
  bass: {
    name: 'Double bass',
    clef: 'bass',
    strings: ['E2', 'A2', 'D3', 'G3'],
    lowest: 'E2',
    highest: 'G5',
    transpose: -12,
    thumbStart: 'D4',
    clefChanges: [['tenor', 'E4', 'C4'], ['treble', 'F5', 'C5']],
    tuningSystem: 'fourths',
  },
  voice: { name: 'Voice', dynamic: true },
  other: { name: 'Other instrument', dynamic: true },
};

export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS);

/** Bowed strings have open strings, bows and a string tuner. */
export const isBowed = (id) => !!INSTRUMENTS[id] && !INSTRUMENTS[id].dynamic;

// Traditional voice types with their usual ranges (sounding MIDI). Where a male
// and a female name would fit the same range the female one is used, so there
// is no countertenor. Tenors read the treble clef an octave higher than they sing.
export const VOICE_TYPES = [
  { id: 'soprano', name: 'Soprano', low: 60, high: 84, female: true, clef: 'treble', transpose: 0 },
  { id: 'mezzo', name: 'Mezzo-soprano', low: 57, high: 81, female: true, clef: 'treble', transpose: 0 },
  { id: 'contralto', name: 'Contralto', low: 53, high: 77, female: true, clef: 'treble', transpose: 0 },
  { id: 'tenor', name: 'Tenor', low: 48, high: 72, female: false, clef: 'treble', clefAnnotation: '8vb', transpose: -12 },
  { id: 'baritone', name: 'Baritone', low: 45, high: 69, female: false, clef: 'bass', transpose: 0 },
  { id: 'bass', name: 'Bass', low: 40, high: 64, female: false, clef: 'bass', transpose: 0 },
];
export const voiceType = (id) => VOICE_TYPES.find((v) => v.id === id) || null;
const DEFAULT_VOICE = 'mezzo';

/**
 * The voice type whose usual range best matches a sung range (sounding MIDI):
 * mostly the middle of the range, partly the lowest note. Female names win
 * close calls.
 */
export function classifyVoice(low, high) {
  const mid = (low + high) / 2;
  let best = null, bestCost = Infinity;
  for (const v of VOICE_TYPES) {
    const cost = Math.abs(mid - (v.low + v.high) / 2) + 0.5 * Math.abs(low - v.low) - (v.female ? 1 : 0);
    if (cost < bestCost) { bestCost = cost; best = v; }
  }
  return best;
}

/** The voice as currently set up: measured range (or a typical one) and type. */
export function voiceSetup() {
  const p = getProfile('voice') || {};
  const measured = p.low != null && p.high != null && p.high > p.low;
  const type = voiceType(p.override) || (measured ? voiceType(p.type) || classifyVoice(p.low, p.high) : voiceType(DEFAULT_VOICE));
  return {
    type,
    measured,
    low: measured ? p.low : type.low,
    high: measured ? p.high : type.high,
    date: p.measured || null,
    overridden: !!voiceType(p.override),
  };
}

/** Clef for an instrument of a given written range, chosen from the middle of the range. */
export function autoClef(lowMidi, highMidi) { return (lowMidi + highMidi) / 2 >= 57 ? 'treble' : 'bass'; }

const CLEF_CHANGES = {
  treble: [],
  alto: [['treble', 'G5', 'D5']],
  tenor: [['treble', 'F5', 'C5']],
  bass: [['tenor', 'E4', 'C4'], ['treble', 'F5', 'C5']],
};

const nameOf = (m) => noteName(spellMidi(m, 'sharp'), { octave: true, unicode: false });

/** A natural note at or just above (dir 1) / below (dir -1) a MIDI number. */
function naturalNear(m, dir) {
  for (let k = 0; k < 3; k++) { const x = m + dir * k; const n = spellMidi(x, 'sharp'); if (n.a === 0) return n; }
  return spellMidi(m, 'sharp');
}

function dynamicInstrument(id, setup) {
  if (id === 'voice') {
    const v = voiceSetup();
    const t = v.type;
    return {
      name: 'Voice', detail: t.name, voiceType: t.id, clef: t.clef, clefAnnotation: t.clefAnnotation || null,
      strings: [], transpose: t.transpose, clefChanges: [], tuningSystem: null, family: 'voice', placement: 'centre',
      lowestMidi: v.low - t.transpose, highestMidi: v.high - t.transpose, calNotes: [],
    };
  }
  const p = setup ? cleanOther(setup) : getProfile('other');
  const low = p.low, high = p.high;
  const clef = ['treble', 'alto', 'tenor', 'bass'].includes(p.clef) ? p.clef : autoClef(low, high);
  // two comfortable reference notes for the microphone calibration, a little inside the range
  const a = naturalNear(Math.min(low + 5, high), 1), b = naturalNear(Math.max(high - 5, low), -1);
  const calNotes = midiOf(b) - midiOf(a) >= 5 ? [a, b] : [a];
  return {
    name: (p.name || '').trim() || 'Other instrument', detail: null, clef, clefAnnotation: null, strings: [],
    transpose: Number(p.transpose) || 0, clefChanges: CLEF_CHANGES[clef], tuningSystem: null, family: 'other', placement: 'lowest',
    lowestMidi: low, highestMidi: high, calNotes,
  };
}

/**
 * @param {string} id
 * @param {object} [setup] the other instrument's setup (from a syllabus item); else this device's
 */
export function instrumentInfo(id, setup = null) {
  const inst = INSTRUMENTS[id];
  if (!inst) throw new Error('Unknown instrument ' + id);
  if (inst.dynamic) {
    const d = dynamicInstrument(id, setup);
    return {
      ...d, id, dynamic: true,
      lowest: nameOf(d.lowestMidi), highest: nameOf(d.highestMidi),
      thumbMidi: null, stringNotes: [], calNames: d.calNotes.map((n) => noteName(n, { octave: true, unicode: false })),
    };
  }
  const stringNotes = inst.strings.map(parseNote);
  return {
    ...inst,
    id,
    family: 'strings',
    placement: 'lowest',
    clefAnnotation: null,
    lowestMidi: midiOf(parseNote(inst.lowest)),
    highestMidi: midiOf(parseNote(inst.highest)),
    thumbMidi: inst.thumbStart ? midiOf(parseNote(inst.thumbStart)) : null,
    stringNotes,
    calNotes: stringNotes,
    calNames: inst.strings,
  };
}

/** Lowest/highest SOUNDING frequency the detector should accept for this instrument. */
export function detectionRange(id, a4 = 440) {
  const info = instrumentInfo(id);
  // singers scoop into notes and slide between them: a little more room
  const extra = info.family === 'voice' ? 2 : 0;
  const lo = info.lowestMidi + info.transpose - 2 - extra;
  const hi = info.highestMidi + info.transpose + 3 + extra;
  const f = (m) => a4 * Math.pow(2, (m - 69) / 12);
  return { minFreq: f(lo), maxFreq: f(hi) };
}

/**
 * Choose a clef for every note (written MIDI numbers, one per glyph; null for rests).
 * mode 'home' keeps the home clef; 'change' switches with hysteresis and avoids
 * very short excursions.
 */
export function assignClefs(id, midis, mode = 'change') {
  const info = instrumentInfo(id);
  const home = info.clef;
  if (mode !== 'change' || !info.clefChanges.length) return midis.map(() => home);
  const levels = [home, ...info.clefChanges.map((c) => c[0])];
  const upAt = [null, ...info.clefChanges.map((c) => midiOf(parseNote(c[1])))];
  const downBelow = [null, ...info.clefChanges.map((c) => midiOf(parseNote(c[2])))];
  let level = 0;
  const raw = midis.map((m) => {
    if (m == null) return level;
    while (level + 1 < levels.length && m >= upAt[level + 1]) level++;
    while (level > 0 && m < downBelow[level]) level--;
    return level;
  });
  // runs shorter than 4 notes stay in the previous clef (ledger lines) to avoid flicker
  const out = raw.slice();
  let i = 0;
  while (i < out.length) {
    let j = i;
    while (j + 1 < out.length && out[j + 1] === out[i]) j++;
    if (j - i + 1 < 4 && i > 0) for (let k = i; k <= j; k++) out[k] = out[i - 1];
    i = j + 1;
  }
  return out.map((lv) => levels[lv]);
}
