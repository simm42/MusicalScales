// Instrument data. All pitches are WRITTEN pitches; `transpose` is the number
// of semitones from written to sounding (the double bass sounds an octave lower).
// Edit this table to change ranges, starting notes or clef-change points.

import { parseNote, midiOf } from './theory.js';

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
    clefChanges: [['treble', 'D5', 'A4']],
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
    clefChanges: [['tenor', 'E4', 'C4'], ['treble', 'C5', 'G4']],
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
    clefChanges: [['tenor', 'E4', 'C4'], ['treble', 'C5', 'G4']],
    tuningSystem: 'fourths',
  },
};

export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS);

export function instrumentInfo(id) {
  const inst = INSTRUMENTS[id];
  if (!inst) throw new Error('Unknown instrument ' + id);
  return {
    ...inst,
    id,
    lowestMidi: midiOf(parseNote(inst.lowest)),
    highestMidi: midiOf(parseNote(inst.highest)),
    thumbMidi: inst.thumbStart ? midiOf(parseNote(inst.thumbStart)) : null,
    stringNotes: inst.strings.map(parseNote),
  };
}

/** Lowest/highest SOUNDING frequency the detector should accept for this instrument. */
export function detectionRange(id, a4 = 440) {
  const info = instrumentInfo(id);
  const lo = info.lowestMidi + info.transpose - 2;
  const hi = info.highestMidi + info.transpose + 3;
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
