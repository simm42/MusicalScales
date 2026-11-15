// From heard notes to scored notes: the patterns seen in a real cello recording
// (iPhone, 1 m away): repeats on open strings that run together with no dip in
// level, short scrapes at bow changes, and the alignment being pulled one place
// out by them.
import { test, eq, assert } from './harness.js';
import { buildExercise } from '../js/exercises.js';
import { buildSequence } from '../js/sequence.js';
import { refineNotes, dropShortBlips, hasOctaveSteps } from '../js/practice.js';
import { scoreRun } from '../js/scoring.js';
import { precisionAt } from '../js/precision.js';

const SPB = 1.1; // the player's tempo (seconds per beat), a little slower than set

/** Heard notes for an exercise played cleanly: one note per event, flat level (no bow-change dips). */
function heard(seq, { spb = SPB, t0 = 2 } = {}) {
  return seq.events.map((e, k) => {
    const next = seq.events[k + 1];
    const onset = t0 + e.onsetBeat * spb;
    const end = t0 + (next ? next.onsetBeat : e.onsetBeat + e.beats) * spb;
    return note(onset, end, e.midis[0]);
  });
}
function note(onset, end, midi) {
  const levels = [];
  for (let t = onset; t < end; t += 0.02) levels.push([t, -20]);
  return { onset, end, dur: end - onset, midi, nominal: Math.round(midi), frames: Math.round((end - onset) * 100), confirmed: true, levels };
}
/** Run two or more neighbouring heard notes together into one. */
function merge(notes, from, count) {
  const a = notes[from], b = notes[from + count - 1];
  notes.splice(from, count, note(a.onset, b.end, a.midi));
}
function score(seq, notes) {
  const { notes: kept, alignment } = refineNotes(notes, seq);
  return scoreRun({ expected: seq.events, detected: kept, alignment, prec: precisionAt(1) });
}
const cello = (rhythm) => buildSequence(buildExercise({ instrument: 'cello', type: 'scale', key: 'C', range: '1', rhythm }));

test('repeats that ran together on open strings are split by the rhythm', () => {
  const seq = cello('q2c'); // each scale note: quaver, quaver, crotchet
  const n = heard(seq);
  merge(n, 1, 2);   // C: second quaver and crotchet as one note (open C string)
  merge(n, 11, 3);  // G (events 12–14, one place earlier now): all three as one note (open G string)
  const r = score(seq, n);
  eq([r.missing, r.wrong, r.extras.length], [0, 0, 0]);
  assert(r.intonation > 99, 'intonation ' + r.intonation);
});

test('bow-change scrapes are dropped and do not shift the notes after them', () => {
  const seq = cello('q2c');
  const n = heard(seq);
  // a 0.1 s scrape at the 3rd harmonic of open C right after the second C, and one between F and G
  const s1 = n[1].end;
  n.splice(2, 0, note(s1 - 0.05, s1 + 0.05, 55));
  const k = n.findIndex((d) => d.midi === 43);
  n.splice(k, 0, note(n[k].onset - 0.06, n[k].onset + 0.04, 44.6));
  const r = score(seq, n);
  eq([r.missing, r.wrong, r.extras.length], [0, 0, 0]);
});

test('a scale note really left out stays missing, and the next note is not marked wrong in its place', () => {
  const seq = cello('crotchet');
  const n = heard(seq).filter((d) => d.midi !== 40 || d.onset > 10); // E on the way up not played
  const r = score(seq, n);
  eq([r.missing, r.wrong], [1, 0]);
});

test('fast playing keeps its short notes', () => {
  const seq = cello('q4');
  const n = heard(seq, { spb: 0.4 }); // ♩ = 150: 0.1 s semiquavers… all of them short
  eq(dropShortBlips(n).length, n.length);
  const r = score(seq, n);
  eq([r.missing, r.wrong, r.extras.length], [0, 0, 0]);
});

test('octave steps in the exercise itself are recognised', () => {
  assert(!hasOctaveSteps(cello('q2c').events));
  const octaves = buildSequence(buildExercise({ instrument: 'violin', type: 'dsBroken', key: 'G', range: '1', interval: '8ves' }));
  assert(hasOctaveSteps(octaves.events));
});
