// Ear training: the levels, each level's questions, pass marks, and the way home to Do.
import { test, eq, assert, near } from './harness.js';
import {
  EAR_LEVELS, EAR_STAGES, earQuestion, earLevel, passFraction, earStars, guessPassChance, walkHome, cadence, answerRight, openStrings, SOLFA,
} from '../js/ear.js';
import { recordRound, isUnlocked, rng } from '../js/games.js';
import { instrumentInfo } from '../js/instruments.js';

const NAME_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcOfName = (n) => (NAME_PC[n[0]] + (n.includes('♯') ? 1 : n.includes('♭') ? -1 : 0) + 12) % 12;
const pcOf = (m) => ((Math.round(m) % 12) + 12) % 12;
const RANGE = { low: 48, high: 79 };

test('ear training: levels in order, each in a stage, with how, ask and answer', () => {
  EAR_LEVELS.forEach((L, i) => {
    eq(L.id, i + 1);
    assert(EAR_STAGES.some((S) => S.id === L.stage), `level ${L.id} stage`);
    assert(L.how && L.ask && L.answer && L.title && L.tip, `level ${L.id} is described`);
  });
  // the stages come in order: nothing needs a name before the names
  const order = EAR_LEVELS.map((L) => EAR_STAGES.findIndex((S) => S.id === L.stage));
  assert(order.every((x, k) => k === 0 || x >= order[k - 1]), 'stages in order');
  const firstName = EAR_LEVELS.findIndex((L) => ['ladder', 'letters', 'fromA', 'strings'].includes(L.answer));
  assert(EAR_LEVELS.slice(0, firstName).every((L) => ['direction', 'direction3', 'shape', 'size'].includes(L.answer)), 'sounds before names');
});

test('ear training: guessing can\'t pass a level', () => {
  for (const L of EAR_LEVELS) {
    const c = guessPassChance(L.id);
    assert(c < 0.03, `level ${L.id}: a guesser passes ${(c * 100).toFixed(1)} % of the time`);
    assert(passFraction(L.id) >= 0.7, `level ${L.id} pass mark`);
  }
  near(guessPassChance(1), 79 / 4096, 1e-9);
  // stars: ★ at the pass mark, ★★★ for (nearly) all right
  eq([earStars(1, 9 / 12), earStars(1, 10 / 12), earStars(1, 11 / 12), earStars(1, 1)], [0, 1, 2, 3]);
  eq([earStars(5, 0.6), earStars(5, 0.7), earStars(5, 0.9), earStars(5, 1)], [0, 1, 2, 3]);
});

test('ear training: higher or lower, the gap as the level says, in range, and both ways', () => {
  for (const id of [1, 2, 3, 4]) {
    const L = earLevel(id), r = rng(id);
    const seen = new Set();
    for (let k = 0; k < 200; k++) {
      const q = earQuestion(id, { ...RANGE, r });
      const [a, b] = q.play.map((s) => s.midis[0]);
      const gap = Math.abs(b - a);
      seen.add(q.correct[0]);
      eq(q.correct[0], b > a ? 'up' : b < a ? 'down' : 'same');
      if (gap) assert((gap >= L.gaps[0] && gap <= L.gaps[1]) || (L.easy && gap >= L.easy[0] && gap <= L.easy[1]), `level ${id}: gap ${gap}`);
      assert(Math.min(a, b) >= 48 && Math.max(a, b) <= 79, 'in range');
      eq(q.options.length, id === 4 ? 3 : 2);
    }
    eq(seen.size, id === 4 ? 3 : 2, `level ${id}: every answer comes up`);
  }
  // the same note comes up about a third of the time on level 4
  const r = rng(9);
  const same = Array.from({ length: 600 }, () => earQuestion(4, { ...RANGE, r })).filter((q) => q.correct[0] === 'same').length;
  assert(same > 150 && same < 250, String(same));
});

test('ear training: tune shapes – the picture is the way the notes went', () => {
  for (const id of [5, 6]) {
    const L = earLevel(id), r = rng(id);
    for (let k = 0; k < 100; k++) {
      const q = earQuestion(id, { ...RANGE, r });
      const m = q.play.map((s) => s.midis[0]);
      eq(m.length, L.notes);
      const shape = m.slice(1).map((x, i) => (x > m[i] ? 'u' : 'd')).join('');
      eq(q.correct[0], shape);
      eq(q.options.length, 4); eq(new Set(q.options.map((o) => o.id)).size, 4);
      assert(q.options.some((o) => o.id === shape));
      assert(m.every((x) => x >= 48 && x <= 79));
    }
  }
});

test('ear training: step, skip or leap – by places in the scale', () => {
  const r = rng(3);
  const seen = new Set();
  for (let k = 0; k < 200; k++) {
    const q = earQuestion(7, { ...RANGE, r });
    const [a, b] = q.play.map((s) => s.midis[0]);
    const d = Math.abs(b - a);
    const want = d <= 2 ? 'step' : d <= 4 ? 'skip' : 'leap';
    eq(q.correct[0], want, `${a} → ${b}`);
    seen.add(want);
  }
  eq(seen.size, 3);
});

test('ear training: notes in a key – the cadence, the note, the ladder and the way home', () => {
  for (const id of [8, 9, 10, 11, 12, 13, 17]) {
    const L = earLevel(id), r = rng(id * 5);
    for (let k = 0; k < 60; k++) {
      const q = earQuestion(id, { ...RANGE, r });
      eq(q.play.slice(0, 4).map((s) => s.midis.length), [3, 3, 3, 3], 'the key set by four chords');
      const t = q.play[0].midis[0] + 12; // the key note
      const notes = q.play.slice(4).map((s) => s.midis[0]);
      eq(notes.length, L.notes || 1);
      eq(q.correct.length, notes.length);
      notes.forEach((m, i) => {
        const d = Number(q.correct[i]);
        assert(L.degrees.includes(d), `level ${id}: degree ${d} is in the level`);
        eq(m, q.hear[String(d)], 'the note is the rung it names');
        eq(pcOf(m - t), [0, 2, 4, 5, 7, 9, 11, 0][d]);
      });
      // the ladder: high Do at the top, rungs outside the level not offered
      eq(q.options.map((o) => o.id), ['7', '6', '5', '4', '3', '2', '1', '0']);
      q.options.forEach((o) => eq(!!o.off, !L.degrees.includes(Number(o.id))));
      if (id === 17) assert(q.options.every((o) => /^[A-G]/.test(o.label) && SOLFA.includes(o.sub)), 'letters, with sol-fa underneath');
      // the way home: from the last note to Do
      const last = Number(q.correct[q.correct.length - 1]);
      const home = q.after.map((s) => s.midis[0]);
      eq(home[0], q.hear[String(last)]);
      assert(pcOf(home[home.length - 1] - t) === 0, 'ends on Do');
    }
  }
  eq(walkHome(2), [2, 1, 0]); eq(walkHome(4), [4, 5, 6, 7]); eq(walkHome(6), [6, 7]); eq(walkHome(0), [0]);
  // low Do and high Do are both Do
  const q = { correct: ['0'], same: { 0: '7', 7: '0' } };
  assert(answerRight(q, 0, '7') && answerRight(q, 0, '0') && !answerRight(q, 0, '4'));
  // two notes in a row are two different notes
  const r = rng(12);
  for (let k = 0; k < 100; k++) { const x = earQuestion(12, { ...RANGE, r }); assert(Number(x.correct[0]) % 7 !== Number(x.correct[1]) % 7); }
  eq(cadence(60).length, 4);
});

test('ear training: sharp or flat – by as many cents as the level says', () => {
  for (const id of [14, 15, 16]) {
    const L = earLevel(id), r = rng(id);
    let inTune = 0;
    for (let k = 0; k < 300; k++) {
      const q = earQuestion(id, { ...RANGE, r });
      const [a, b] = q.play.map((s) => s.midis[0]);
      const c = Math.round((b - a) * 100);
      eq(c, q.cents);
      eq(q.correct[0], c > 0 ? 'sharp' : c < 0 ? 'flat' : 'in');
      if (!c) { inTune++; continue; }
      const ok = (Math.abs(c) >= L.cents[0] && Math.abs(c) <= L.cents[1]) || (L.easy && Math.abs(c) >= L.easy[0] && Math.abs(c) <= L.easy[1]);
      assert(ok, `level ${id}: ${c} cents`);
    }
    if (id === 15) assert(inTune > 70 && inTune < 130, String(inTune)); else eq(inTune, 0);
  }
});

test('ear training: names from an A, and the open strings with no help', () => {
  const r = rng(18);
  for (let k = 0; k < 100; k++) {
    const q = earQuestion(18, { ...RANGE, r });
    const [a, m] = q.play.map((s) => s.midis[0]);
    eq(pcOf(a), 9, 'the first note is an A');
    eq(pcOfName(q.correct[0]), pcOf(m));
    assert(Math.abs(m - a) <= 9 && m !== a);
    eq(q.options.length, 7);
    eq(pcOf(q.hear[q.correct[0]]), pcOf(m), 'the right answer sounds as the note');
  }
  const cello = openStrings(instrumentInfo('cello'));
  eq(cello, [36, 43, 50, 57]);
  const bass = openStrings(instrumentInfo('bass'));
  assert(bass[0] < 36, 'the double bass sounds an octave lower');
  for (let k = 0; k < 50; k++) {
    const q = earQuestion(19, { ...RANGE, strings: cello, r });
    eq(q.options.map((o) => o.id), ['C', 'G', 'D', 'A']);
    eq(q.play.length, 1, 'one note, nothing to compare it with');
    const m = q.play[0].midis[0];
    assert(m >= 48, 'lifted to where a phone can play it');
    eq(pcOfName(q.correct[0]), pcOf(m));
  }
  // no strings (the voice): C E G A
  eq(earQuestion(19, { ...RANGE, r }).options.map((o) => o.id), ['C', 'E', 'G', 'A']);
});

test('ear training: each level opens at the pass mark of the one before', () => {
  const p = { ear: { best: {} }, sing: { best: {} } };
  const rules = { count: EAR_LEVELS.length, passOf: passFraction };
  let res = recordRound(p, 'ear', 1, 9 / 12, rules);
  eq(res.unlocked, false);
  assert(!isUnlocked(p, 'ear', 2, passFraction));
  res = recordRound(p, 'ear', 1, 10 / 12, rules);
  eq(res.unlocked, true);
  assert(isUnlocked(p, 'ear', 2, passFraction));
  recordRound(p, 'ear', 4, 0.7, rules);
  assert(isUnlocked(p, 'ear', 5, passFraction), '7 of 10 opens the next');
  assert(!isUnlocked(p, 'sing', 2), 'Sing the note keeps its own levels');
});
