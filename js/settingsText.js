// Plain-English description of the selected playing options.

import { RHYTHMS, isCrotchetRhythm } from './sequence.js';
import { EXERCISE_TYPES, slurGroup } from './exercises.js';
import { isBowed } from './instruments.js';

export function describeOptions(s) {
  const t = EXERCISE_TYPES[s.type];
  const parts = [];
  const rhythm = {
    crotchet: 'One crotchet per note',
    crotchetLong: 'Crotchets, bottom and top notes twice as long',
    crotchetLongMid: 'Crotchets, bottom, top and key notes between octaves twice as long',
    q2: 'Two quavers on each note',
    q2c: 'Two quavers and a crotchet on each note',
    q2r: 'Two quavers and a quaver rest on each note',
    q4: 'Four quavers on each note',
  }[s.rhythm] || RHYTHMS.crotchet.label;
  parts.push(rhythm);
  if (s.repeatTop) parts.push('top note repeated');
  const bowed = isBowed(s.instrument);
  if (s.instrument === 'voice') parts.push(s.solfege === 'fixed' ? 'sung to fixed Do' : s.solfege === 'movableLa' ? 'sung to movable Do, minor on La' : 'sung to movable Do');
  else if (t.doubleStop) parts.push('both notes together, separate bows');
  else if (slurGroup(s) > 1) parts.push(`slurred ${slurGroup(s)} notes ${bowed ? 'to a bow' : 'at a time'}`);
  else parts.push(bowed ? 'separate bows' : 'detached');
  if (s.metronome) parts.push(`with metronome at ♩ = ${s.bpm}`);
  return parts.join(' · ');
}

/** Short label for syllabus cards: only what belongs to the exercise itself. */
export function shortOptions(s) {
  const bits = [];
  if (s.repeatTop) bits.push('top repeated');
  return bits.join(', ');
}
