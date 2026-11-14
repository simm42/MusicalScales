// Plain-English description of the selected playing options.

import { RHYTHMS } from './sequence.js';
import { EXERCISE_TYPES } from './exercises.js';

export function describeOptions(s) {
  const t = EXERCISE_TYPES[s.type];
  const parts = [];
  const rhythm = {
    crotchet: 'One crotchet per note',
    q2: 'Two quavers on each note',
    q2c: 'Two quavers and a crotchet on each note',
    q2r: 'Two quavers and a quaver rest on each note',
    q4: 'Four quavers on each note',
  }[s.rhythm] || RHYTHMS.crotchet.label;
  parts.push(rhythm);
  if (s.longEnds) parts.push('bottom and top notes twice as long');
  if (s.longMidTonics) parts.push('key notes between octaves twice as long');
  if (s.repeatTop) parts.push('top note repeated');
  if (t.doubleStop) parts.push('both notes together, separate bows');
  else if (s.slur > 1) parts.push(`slurred ${s.slur} notes to a bow`);
  else parts.push('separate bows');
  if (s.metronome) parts.push(`with metronome at ♩ = ${s.bpm}`);
  return parts.join(' · ');
}

/** Short label for practice-list cards. */
export function shortOptions(s) {
  const bits = [];
  if (s.rhythm !== 'crotchet') bits.push({ q2: '2 quavers', q2c: '2 quavers + crotchet', q2r: '2 quavers + rest', q4: '4 quavers' }[s.rhythm]);
  if (s.slur > 1) bits.push(`slurred ${s.slur}`);
  if (s.longEnds) bits.push('long tonic');
  if (s.longMidTonics) bits.push('long middle tonics');
  if (s.repeatTop) bits.push('top repeated');
  if (s.metronome) bits.push(`♩=${s.bpm}`);
  return bits.join(', ');
}
