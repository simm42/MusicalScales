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
function note(onset, end, midi, { unsteady = false } = {}) {
  const levels = [], pitches = [];
  for (let t = onset; t < end; t += 0.02) { levels.push([t, -20]); pitches.push([t, midi]); }
  return { onset, end, dur: end - onset, midi, nominal: Math.round(midi), frames: Math.round((end - onset) * 100), confirmed: true, levels, pitches, unsteady };
}
/** Run two or more neighbouring heard notes together into one. */
function merge(notes, from, count) {
  const a = notes[from], b = notes[from + count - 1];
  notes.splice(from, count, note(a.onset, b.end, a.midi));
}
function score(seq, notes) {
  const { notes: kept, alignment, fold } = refineNotes(notes, seq);
  return scoreRun({ expected: seq.events, detected: kept, alignment, prec: precisionAt(1), fold });
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

// ---------------------------------------------------------------- bow-change scrapes as errors
import { scrapeSize, scrapeWeight } from '../js/precision.js';
import { scoresAtLevels } from '../js/scoring.js';
import { makeRun, recordRun, atLevel, lastRuns } from '../js/results.js';

test('scrapes count by length and loudness: free for beginners, a whole error for experts', () => {
  const s = scrapeSize(0.1, 0); // 0.1 s, as loud as the note
  eq(s, 1);
  eq(scrapeWeight(s, precisionAt(0)), 0);
  eq(scrapeWeight(s, precisionAt(4)), 1);
  assert(scrapeWeight(s, precisionAt(2)) > 0 && scrapeWeight(s, precisionAt(2)) < scrapeWeight(s, precisionAt(3)), 'stricter levels count more');
  // quieter and shorter counts less
  assert(scrapeSize(0.05, -12) < 0.2);
  eq(scrapeWeight(scrapeSize(0.05, -12), precisionAt(3)), 0);
  // even a beginner pays for a long, loud scrape
  assert(scrapeWeight(scrapeSize(0.19, 6), precisionAt(0)) > 0);
});

test('scrapes are found with their loudness, scored, and kept per level with the run', () => {
  const seq = cello('crotchet');
  const n = heard(seq);
  const loud = note(n[3].end - 0.06, n[3].end + 0.06, 51); // 0.12 s, as loud as the notes
  n.splice(4, 0, loud);
  const { notes: kept, alignment, scrapes } = refineNotes(n, seq);
  eq(scrapes.length, 1);
  assert(Math.abs(scrapes[0].relDb) < 0.5, 'as loud as the note');
  const at = (lv) => scoreRun({ expected: seq.events, detected: kept, alignment, prec: precisionAt(lv), scrapes });
  const beg = at(0), exp = at(4);
  eq([beg.errors, beg.missing, beg.wrong], [0, 0, 0]);
  eq(exp.errors, 1);
  assert(exp.total < beg.total);
  // stored with the run: errors per level
  const lv = scoresAtLevels(exp, undefined, precisionAt);
  eq(lv.map((l) => l[3]), [0, 0, lv[2][3], lv[3][3], 1]);
  const store = {};
  recordRun(store, 'x', { ...makeRun(exp, seq, 'crotchet', 1000), lv }, 2000);
  const run = lastRuns(store, 'x')[0];
  eq([atLevel(run, 0).e, atLevel(run, 4).e], [0, 1]);
  // older runs without errors per level still show their one count
  eq(atLevel({ t: 80, i: 80, ti: 80, e: 2, lv: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]] }, 3).e, 2);
});

test('singers’ consonants are not scrapes', () => {
  const seq = cello('crotchet');
  const n = heard(seq);
  n.splice(4, 0, note(n[3].end - 0.06, n[3].end + 0.06, 51));
  eq(refineNotes(n, seq, { scrapes: false }).scrapes.length, 0);
});

// ---------------------------------------------------------------- notes heard far off: look more closely
import { lookCloser } from '../js/scoring.js';

test('a note heard an octave or an octave and a fifth up is the right note heard at a harmonic', () => {
  const at = (m) => note(0, 0.5, m);
  eq([Math.round(lookCloser(at(48.03), 36).cents), lookCloser(at(48.03), 36).shift], [3, 12]);
  const third = lookCloser(at(55.0), 36); // the 3rd harmonic of open C (G an octave and a fifth up)
  eq([third.shift, Math.round(third.cents)], [19.02, -2]);
  eq(lookCloser(at(24.1), 36).shift, -12);
  // a real wrong note is still wrong: F♯ where F was expected, a tone off
  eq(lookCloser(at(54), 53.0 - 1), null);
  eq(lookCloser(at(54.6), 53), null);
  // not when the exercise itself steps by octaves
  eq(lookCloser(at(48), 36, false), null);
});

test('a note that slides in, or flickers an octave, is scored on the part at the right pitch', () => {
  const d = note(0, 0.6, 36);
  d.pitches = d.pitches.map(([t], k) => [t, k < 18 ? 48 : 36.1]); // 60 % an octave up, then the real note
  const c = lookCloser(d, 36);
  eq([c.how, c.shift, Math.round(c.cents)], ['part', 0, 10]);
});

test('open C heard an octave up at the start, then a slip mid-note: no missing, wrong or extra notes', () => {
  const seq = cello('q2c');
  const n = heard(seq);
  // first quaver heard entirely as C3; second quaver flips to C3 near its end
  n[0] = note(n[0].onset, n[0].end, 48);
  const q2 = n[1];
  n.splice(1, 1, note(q2.onset, q2.end - 0.1, 36), note(q2.end - 0.1, q2.end, 48));
  const r = score(seq, n);
  eq([r.missing, r.wrong, r.extras.length], [0, 0, 0]);
  assert(r.perNote[0].heardShift === 12, 'first note marked as heard an octave up');
});

test('a slide between two notes becomes the start of the next one', () => {
  const seq = cello('crotchet');
  const n = heard(seq);
  const k = 4; // between F (41) and G (43)
  const g = note(n[k].onset - 0.15, n[k].onset, 42, { unsteady: true }); // F♯, sliding from F up to G
  n[k - 1] = { ...n[k - 1], end: g.onset, dur: g.onset - n[k - 1].onset };
  n.splice(k, 0, g);
  const r = score(seq, n);
  eq([r.missing, r.wrong, r.extras.length], [0, 0, 0]);
});

test('a crotchet chopped in three after two quavers run together is put back as played', () => {
  const seq = cello('q2c');
  const n = heard(seq);
  const k = n.findIndex((d) => d.midi === 43); // G: quaver, quaver, crotchet
  const [a, b, c] = n.slice(k, k + 3);
  n.splice(k, 3, note(a.onset, b.end, 43), note(c.onset, c.onset + 0.35, 43), note(c.onset + 0.35, c.onset + 0.8, 43), note(c.onset + 0.8, c.end, 43));
  const r = score(seq, n);
  eq([r.missing, r.wrong, r.extras.length], [0, 0, 0]);
});
