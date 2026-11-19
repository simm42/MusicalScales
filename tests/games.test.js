// Pitch-training games: questions, answer choices, singing judged, scores and levels.
import { test, eq, assert, near } from './harness.js';
import {
  LISTEN_LEVELS, SING_LEVELS, GAME, listenQuestion, singQuestion, answerChoices, majorKey, tonicMidi,
  sungMatches, HoldJudge, recordRound, isUnlocked, stars, rng,
} from '../js/games.js';

const pcOf = (m) => ((m % 12) + 12) % 12;
const NAME_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcOfName = (n) => (NAME_PC[n[0]] + (n.includes('♯') ? 1 : n.includes('♭') ? -1 : 0) + 12) % 12;

test('name the note: four different choices, one of them right, and the note is in the key', () => {
  const r = rng(42);
  for (const L of LISTEN_LEVELS) {
    for (let k = 0; k < 30; k++) {
      const q = listenQuestion(L.id, { low: 48, high: 84, r });
      eq(q.notes.length, L.notes);
      if (q.notes.length === 2) assert(q.notes[0].name !== q.notes[1].name, 'two different notes');
      q.notes.forEach((n, i) => {
        const c = q.choices[i];
        eq(c.length, 4);
        eq(new Set(c).size, 4, 'all different');
        assert(c.includes(n.name), 'the right answer is offered');
        eq(pcOfName(n.name), pcOf(n.midi), 'the name is the note played');
        assert(q.key.degrees.some((p) => pcOfName(p.l != null ? 'CDEFGAB'[p.l] + (p.a > 0 ? '♯' : p.a < 0 ? '♭' : '') : '') === pcOf(n.midi)), 'in the key');
        assert(n.midi >= 48 && n.midi <= 84 + 12, 'in a comfortable range');
      });
      eq(q.keyShown, L.key);
      eq(q.reference.length, L.hearKey ? 4 : 0);
    }
  }
});

test('with the key known the wrong answers are other notes of the key; without it, near semitones', () => {
  const key = majorKey('D');
  const note = { midi: 66, degree: 2, name: 'F♯' };
  const withKey = answerChoices(note, key, true, rng(1));
  const keyNames = key.degrees.map((p) => 'CDEFGAB'[p.l] + (p.a > 0 ? '♯' : p.a < 0 ? '♭' : ''));
  assert(withKey.every((c) => keyNames.includes(c)), withKey.join(' '));
  const noKey = answerChoices(note, key, false, rng(1));
  assert(noKey.some((c) => !keyNames.includes(c)), 'near notes outside the key: ' + noKey.join(' '));
  assert(noKey.every((c) => Math.min(Math.abs(pcOfName(c) - 6), 12 - Math.abs(pcOfName(c) - 6)) <= 3), noKey.join(' '));
});

test('keys are spelled properly (B♭ in F major, F♯ in G major)', () => {
  const name = (key) => majorKey(key).degrees.map((p) => 'CDEFGAB'[p.l] + (p.a > 0 ? '♯' : p.a < 0 ? '♭' : '')).join(' ');
  eq(name('F'), 'F G A B♭ C D E');
  eq(name('G'), 'G A B C D E F♯');
  eq(name('Eb'), 'E♭ F G A♭ B♭ C D');
  eq(majorKey('Bb').pref, 'flat');
});

test('the key note sits low in the range with a whole octave above it', () => {
  const t = tonicMidi(majorKey('A'), 55, 79); // a voice G3–G5
  eq(pcOf(t), 9);
  assert(t >= 55 && t + 12 <= 79, String(t));
});

test('sing the note: notes in a row, in the singer\'s range, from the key', () => {
  const r = rng(7);
  for (const L of SING_LEVELS) {
    const q = singQuestion(L.id, { low: 55, high: 79, r });
    eq(q.notes.length, L.notes);
    q.notes.forEach((n, k) => {
      assert(n.midi >= 55 && n.midi <= 79, `${n.midi} in range`);
      assert(['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'].includes(n.sol));
      if (k) assert(n.degree !== q.notes[k - 1].degree, 'never the same note twice running');
    });
    eq(q.hearNote, L.hearNote);
  }
});

test('singing is judged in any octave, within the level\'s tolerance', () => {
  eq(sungMatches(67.2, 67, 40).ok, true);
  near(sungMatches(55.2, 67, 40).cents, 20, 1e-9); // an octave down counts
  eq(sungMatches(67.6, 67, 40).ok, false);
  const j = new HoldJudge(67, { tolerance: 40, holdSec: 0.5, gapSec: 0.25 });
  let done = null;
  for (let t = 0; t <= 0.3; t += 0.01) done = j.push(t, 67.05);
  eq(done, null, 'not held long enough yet');
  for (let t = 0.31; t <= 0.7; t += 0.01) j.push(t, null); // a long break starts again
  for (let t = 0.71; t <= 1.5 && done == null; t += 0.01) done = j.push(t, 66.9);
  near(done, -10, 1e-6);
  // a short breath or wobble in the middle does not
  const k = new HoldJudge(67, { tolerance: 40, holdSec: 0.5, gapSec: 0.25 });
  let d2 = null, at = null;
  for (let t = 0; t <= 1 && d2 == null; t += 0.01) {
    const m = t > 0.2 && t < 0.3 ? null : t >= 0.3 && t < 0.35 ? 69 : 67.1;
    d2 = k.push(t, m);
    if (d2 != null) at = t;
  }
  assert(d2 != null && at < 0.55, 'held through a 0.15 s gap: done at ' + at);
});

test('a round of 70% or more opens the next level; best scores and stars kept', () => {
  const p = { listen: { best: {} }, sing: { best: {} } };
  assert(isUnlocked(p, 'listen', 1) && !isUnlocked(p, 'listen', 2));
  let r = recordRound(p, 'listen', 1, 0.6);
  eq([r.newBest, r.unlocked], [true, false]);
  r = recordRound(p, 'listen', 1, 0.8);
  eq([r.best, r.unlocked], [0.8, true]);
  assert(isUnlocked(p, 'listen', 2));
  r = recordRound(p, 'listen', 1, 0.5);
  eq([r.best, r.newBest, r.unlocked], [0.8, false, false]);
  assert(!isUnlocked(p, 'sing', 2), 'each game has its own levels');
  eq([stars(0.4), stars(0.5), stars(0.7), stars(0.95)], [0, 1, 2, 3]);
  eq(GAME.unlockAt, 0.7);
});
