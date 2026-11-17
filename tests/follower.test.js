// The live arrow: following repeated quavers, octave slips, and finding the place again.
import { test, eq, assert } from './harness.js';
import { Follower } from '../js/follower.js';
import { buildExercise } from '../js/exercises.js';
import { buildSequence } from '../js/sequence.js';

const cello = (rhythm) => buildSequence(buildExercise({ instrument: 'cello', type: 'scale', key: 'C', range: '1', rhythm })).events;
const firstOf = (ev, midi, from = 0) => ev.findIndex((e, k) => k >= from && e.midis[0] === midi);

test('repeated quavers that run together do not leave the arrow behind', () => {
  const ev = cello('q4'); // four quavers on each note: C C C C D D D D …
  const f = new Follower(ev, { fold: true });
  let t = 0;
  // only one onset heard per scale note (the repeats ran together)
  for (const m of [36, 38, 40, 41, 43]) {
    const k = f.onset(m, (t += 1.2));
    eq(k, firstOf(ev, m), `note ${m}`);
    f.release();
  }
  eq(f.jumps, 0);
});

test('with two quavers and a crotchet, a lost repeat is skipped over', () => {
  const ev = cello('q2c'); // C C C(crotchet) D D D …
  const f = new Follower(ev, { fold: true });
  eq(f.onset(36, 0), 0);
  eq(f.onset(38, 1.1), 3); // the second C and the crotchet were heard as one note
  eq(f.onset(38, 1.6), 4);
});

test('a note heard an octave up still moves the arrow (not when the exercise steps by octaves)', () => {
  const ev = cello('crotchet');
  const f = new Follower(ev, { fold: true });
  eq(f.onset(48, 0), 0); // open C heard as C3
  eq(f.onset(38 + 12, 1), 1);
  const strict = new Follower(ev, { fold: false });
  eq(strict.onset(48, 0), -1);
});

test('the arrow finds the player again from the last notes heard', () => {
  const ev = cello('crotchet'); // C D E F G A B C B A G F E D C
  const f = new Follower(ev, { fold: true });
  f.onset(36, 0); f.release();
  // the player went on but the next three notes were not heard; then G A B
  eq(f.onset(43, 4), -1, 'one note alone is not enough to jump');
  f.release();
  eq(f.onset(45, 5), firstOf(ev, 45), 'two new notes that fit, in order: the arrow jumps to A');
  f.release();
  eq(f.onset(47, 6), firstOf(ev, 47));
  assert(f.jumps >= 1);
});

test('a stray note does not make the arrow jump', () => {
  const ev = cello('crotchet');
  const f = new Follower(ev, { fold: true });
  f.onset(36, 0); f.release();
  f.onset(38, 1); f.release();
  eq(f.onset(61, 1.5), -1); // nothing like the music
  f.release();
  eq(f.onset(40, 2), 2); // and it carries on where it was
  eq(f.jumps, 0);
});

test('stuck for much longer than the tempo suggests: the arrow catches up', () => {
  const ev = cello('crotchet');
  const f = new Follower(ev, { fold: true });
  // C D E at one note a second
  [36, 38, 40].forEach((m, k) => { f.onset(m, k); f.release(); });
  eq(f.arrow, 3);
  // then G and A were heard but did not fit at the time (two notes of history before them were C D E)
  f.heard.push({ nominal: 43, t: 4 }, { nominal: 45, t: 5 });
  assert(!f.tick(3.5), 'not stuck yet');
  assert(f.tick(6.5), 'stuck: moves on');
  eq(f.arrow, firstOf(ev, 45) + 1);
});

test('a note heard an octave up does not send the arrow an octave ahead (cello, F major)', () => {
  const ev = buildSequence(buildExercise({ instrument: 'cello', type: 'scale', key: 'F', range: '2', rhythm: 'q2r' })).events;
  const f = new Follower(ev, { fold: true });
  // as heard in a real run: F F, a stray F♯, G G G, then G3 (the G heard an octave up), then A A
  const heard = [[41, 1.66], [42, 2.43], [41, 3.59], [43, 4.03], [43, 4.73], [43, 4.85], [55, 6.2], [55, 6.43], [45, 6.49], [45, 7.32], [46, 8.88]];
  const got = heard.map(([m, t]) => { const k = f.onset(m, t); f.release(); return k; });
  eq(f.jumps, 0, 'no jump');
  eq(got.slice(-3), [firstOf(ev, 45), firstOf(ev, 45) + 1, firstOf(ev, 46)], 'A A B♭ in the first octave');
});

test('the top note sounding twice does not skip it on the way down', () => {
  const ev = buildSequence(buildExercise({ instrument: 'cello', type: 'scale', key: 'F', range: '2', rhythm: 'q2r' })).events;
  const f = new Follower(ev, { fold: true });
  const top = ev.findIndex((e) => e.midis[0] === 65); // F4: two quavers, then back down to E
  f.pos = top; f.matches.push({ event: top - 1, t: 33 }); // just played the second E on the way up
  eq(f.onset(64, 34.9), -1, 'the E again (a bounce) is not the E on the way down');
  f.release();
  eq(f.onset(65, 38.6), top, 'the top F is still where the arrow goes next');
});
