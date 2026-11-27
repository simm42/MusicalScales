import { test, eq, near, assert } from './harness.js';
import {
  RES, recordRun, makeRun, compact, migrateHistory, lastRuns, runsSince, daily, monthly,
  summaryDaily, summaryMonthly, firstTime, cardStats, dayKey, DAYS, atLevel, runDetail, surfaceRuns,
} from '../js/results.js';
import { scoresAtLevels } from '../js/scoring.js';
import { precisionAt } from '../js/precision.js';
import { buildExercise } from '../js/exercises.js';
import { buildSequence } from '../js/sequence.js';
import { noteName } from '../js/theory.js';

const NOW = new Date(2026, 10, 14, 12, 0, 0).getTime(); // 14 Nov 2026, noon
const run = (d, t, e = 0) => ({ d, rhythm: 'crotchet', t, i: t, ti: t, e, steps: [], notes: [] });

test('only the newest 10 runs are kept in full', () => {
  const store = {};
  for (let k = 0; k < 13; k++) recordRun(store, 'a', run(NOW - (13 - k) * 3600e3, 50 + k), NOW);
  const rec = store.a;
  eq(rec.runs.length, RES.fullRuns);
  eq(rec.older.length, 3);
  eq(rec.older.map((o) => atLevel(o).t), [50, 51, 52]);
  assert(!('steps' in rec.older[0]), 'older runs keep only the four scores');
  eq(lastRuns(store, 'a').map((r) => r.t)[9], 62);
});

test('summaries older than a month become daily averages, older than a year monthly', () => {
  const store = {};
  // 12 recent runs so that older ones fall out of the full list
  for (let k = 0; k < 12; k++) recordRun(store, 'a', run(NOW - k * 60e3, 90), NOW);
  // two runs on the same day 40 days ago, one with 1 error, one with 3
  recordRun(store, 'a', run(NOW - 40 * DAYS, 60, 1), NOW);
  recordRun(store, 'a', run(NOW - 40 * DAYS + 3600e3, 80, 3), NOW);
  // three runs in one month 400 days ago, on different days
  for (const [dd, t] of [[400, 30], [401, 40], [402, 50]]) recordRun(store, 'a', run(NOW - dd * DAYS, t, 2), NOW);
  const rec = compact(store.a, NOW);
  eq(rec.days.length, 1);
  eq(rec.days[0].n, 2);
  near(atLevel(rec.days[0]).t, 70, 1e-9);
  near(rec.days[0].e, 2, 1e-9);
  eq(rec.months.length >= 1, true);
  const mTotal = rec.months.reduce((a, m) => a + m.n, 0);
  eq(mTotal, 3);
  eq(rec.older.every((o) => NOW - o.d <= RES.dayAfterDays * DAYS), true);
});

test('weighted averages when aggregates merge', () => {
  const store = {};
  for (let k = 0; k < 11; k++) recordRun(store, 'a', run(NOW - k * 60e3, 100), NOW);
  // day with 3 runs of 40 and 1 run of 80 → 50
  for (const t of [40, 40, 40, 80]) recordRun(store, 'a', run(NOW - 50 * DAYS + t * 1000, t), NOW);
  const d = daily(store, 'a', NOW - 180 * DAYS).find((x) => x.day === dayKey(NOW - 50 * DAYS));
  eq(d.n, 4);
  near(d.t, 50, 1e-9);
});

test('chart queries: two weeks, per day, per month, summary across items', () => {
  const store = {};
  for (let k = 0; k < 20; k++) recordRun(store, 'a', run(NOW - k * 2 * DAYS, 60 + k), NOW); // every 2 days for 40 days
  for (let k = 0; k < 5; k++) recordRun(store, 'b', run(NOW - k * DAYS - 3600e3, 90), NOW);
  const twoWeeks = runsSince(store, 'a', NOW - 14 * DAYS);
  eq(twoWeeks.length, 8); // days 0,2,…,14
  assert(twoWeeks[0].d < twoWeeks[7].d, 'oldest first');
  const perDay = daily(store, 'a', NOW - 180 * DAYS);
  eq(perDay.length, 20);
  const perMonth = monthly(store, 'a');
  eq(perMonth.reduce((a, m) => a + m.n, 0), 20);
  const sd = summaryDaily(store, ['a', 'b'], NOW - 180 * DAYS);
  const today = sd.find((x) => x.day === dayKey(NOW));
  eq(today.n, 2); // a's run today + b's run today
  near(today.t, (60 + 90) / 2, 1e-9);
  eq(summaryMonthly(store, ['a', 'b']).reduce((a, m) => a + m.n, 0), 25);
  assert(firstTime(store, ['a', 'b']) <= NOW - 38 * DAYS);
});

test('old score history migrates into results', () => {
  const store = {};
  const item = { id: 'x', history: [{ d: NOW - 3 * DAYS, t: 70, i: 80, ti: 40 }, { d: NOW - 60 * DAYS, t: 50, i: 60, ti: 20 }] };
  assert(migrateHistory(store, item, NOW));
  assert(!item.history, 'history removed from the item');
  eq(store.x.older.length, 1);
  eq(store.x.days.length, 1);
  eq(store.x.older[0].e, null);
  eq(cardStats(store, 'x').last, 70);
  eq(cardStats(store, 'x').count, 2);
});

test('a full run records cents per scale note, whatever the rhythm', () => {
  const ex = buildExercise({ instrument: 'violin', type: 'scale', key: 'G', range: '1', rhythm: 'q2' });
  const seq = buildSequence(ex);
  eq(seq.steps.length, 15);
  // fake result: every note 10 cents sharp, except one note missing
  const perNote = seq.events.map((e, k) => (k === 3 ? { event: k, status: 'missing', cents: null, intonation: 0, timing: 0 } : { event: k, status: 'ok', cents: [10 + (k % 2)], intonation: 90, timing: 95 }));
  const r = makeRun({ total: 90, intonation: 90, timing: 95, extras: [{}], missing: 1, wrong: 0, perNote }, seq, 'q2', NOW, (n) => noteName(n, { octave: true }));
  eq(r.steps.length, 15);
  near(r.steps[0], 10.5, 1e-9); // both quavers of the first note averaged
  near(r.steps[1], 10, 1e-9); // one of the two quavers on step 1 was missing
  eq(r.e, 1);
  eq(r.labels[0], 'G3');
  eq(r.notes.length, seq.events.length);
});

test('runs with more than half the notes missing are left off the 3D plot', () => {
  const notes = (miss) => Array.from({ length: 10 }, (_, k) => [0, 100, 100, k < miss ? 2 : 0, 0]);
  const runs = [{ d: 1, notes: notes(5), missing: 5 }, { d: 2, notes: notes(6), missing: 6 }, { d: 3, notes: notes(0), missing: 0 }, { d: 4, notes: notes(8) }, { d: 5 }];
  eq(surfaceRuns(runs).map((r) => r.d), [1, 3, 5]);
});

test('a stored run gives back the detailed summary', () => {
  const ex = buildExercise({ instrument: 'violin', type: 'scale', key: 'D', range: '1', rhythm: 'crotchet' });
  const seq = buildSequence(ex);
  const perNote = seq.events.map((e, k) => (k === 2 ? { event: k, status: 'missing', cents: null, intonation: 0, timing: 0, timingDev: null }
    : { event: k, status: k === 5 ? 'wrong' : 'ok', cents: k === 4 ? [3, -8] : [k - 4], intonation: 80 + k, timing: 90, timingDev: 0.05, unsteady: k === 6 }));
  const r = makeRun({ total: 84, intonation: 82, timing: 90, extras: [{}, {}], penalty: 6, missing: 1, wrong: 1, bpm: 72.4, perNote }, seq, 'crotchet', NOW, (n) => noteName(n, { octave: true }));
  const d = runDetail(JSON.parse(JSON.stringify(r)));
  eq(d.labels.length, seq.events.length);
  eq(d.labels[0], 'D4');
  eq(d.result.perNote[2].status, 'missing');
  eq(d.result.perNote[5].status, 'wrong');
  eq(d.result.perNote[4].cents, [3, -8]);
  eq(d.result.perNote[0].cents, [-4]);
  assert(d.result.perNote[6].unsteady && !d.result.perNote[0].unsteady, 'unsteady flag kept');
  near(d.result.perNote[1].timingDev, 0.05, 1e-9);
  eq([d.result.total, d.result.extras.length, d.result.penalty, d.result.missing, d.result.wrong, d.result.bpm], [84, 2, 6, 1, 1, 72]);
  // an older run without note names takes them from the caller, or numbers the notes
  delete r.nl;
  eq(runDetail(r).labels[0], 'Note 1');
  eq(runDetail(r, d.labels).labels[0], 'D4');
});


test('scores are kept for all five precision levels, also after averaging', () => {
  // a run with notes 10 cents out and slightly uneven timing
  const perNote = Array.from({ length: 8 }, (_, k) => ({ event: k, status: 'ok', cents: [10], intonation: 0, timing: 0, timingDev: 0.06 }));
  perNote.push({ event: 8, status: 'missing', cents: null, intonation: 0, timing: 0 });
  const result = { perNote, penalty: 3 };
  const lv = scoresAtLevels(result, undefined, precisionAt);
  eq(lv.length, 5);
  // Beginner (full marks within 15 c) gives full intonation on the 8 played notes; Expert gives far less
  near(lv[0][1], 800 / 9, 0.2);
  assert(lv[4][1] < lv[2][1] && lv[2][1] < lv[0][1], 'stricter levels score lower');
  assert(lv[4][0] < lv[0][0]);
  const store = {};
  for (let k = 0; k < 14; k++) recordRun(store, 'a', { d: NOW - (40 + k) * DAYS, rhythm: 'crotchet', lv, e: 1, steps: [], notes: [] }, NOW);
  const d = daily(store, 'a', NOW - 180 * DAYS, 4);
  near(d[0].t, lv[4][0], 1e-6);
  near(daily(store, 'a', NOW - 180 * DAYS, 0)[0].t, lv[0][0], 1e-6);
  eq(cardStats(store, 'a', 0).best, Math.round(lv[0][0]));
  eq(cardStats(store, 'a', 4).best, Math.round(lv[4][0]));
});

// ---------------------------------------------------------------- a piece's plots, bar by bar
import { pieceBarSurfaces, pieceMistakes, barsOfSteps, MAX_BAR_GROUPS } from '../js/barSurface.js';
import { mistakesChart } from '../js/ui/charts.js';

/** A stored piece run: `bars` bars of `per` notes; notes given as [cents, , , status, timing %]. */
const pieceRun = (d, bars, per, note = () => [0, 100, 100, 0, 0], sec = null) => {
  const labels = [];
  for (let b = 1; b <= bars; b++) for (let k = 0; k < per; k++) labels.push(k ? '' : String(b));
  const from = sec ? sec[0] : 1, to = sec ? sec[1] : bars;
  const notes = [];
  for (let b = from; b <= to; b++) for (let k = 0; k < per; k++) notes.push(note(b, k));
  return { d, labels, notes, sec, steps: labels.map(() => null) };
};

test('a piece: runs averaged over groups of bars, at most 32 along the front', () => {
  eq(barsOfSteps(['1', '', '2', '', '', '3']), [1, 1, 2, 2, 2, 3]);
  const p = precisionAt(1);
  // 10 bars: one bar at a time; bar 3 has a missing note (both scores 0), bar 5 is far out of tune
  const note = (b, k) => (b === 3 && k === 0 ? [null, 0, 0, 2, null] : b === 5 ? [60, 0, 100, 0, 0] : [0, 100, 100, 0, 0]);
  const s = pieceBarSurfaces([pieceRun(1, 10, 4, note)], p);
  eq(s.size, 1); eq(s.labels.length, 10); eq(s.labels[0], '1');
  near(s.intonation[0].steps[2], 75, 1e-9, 'one of four notes missing');
  near(s.timing[0].steps[2], 75, 1e-9);
  near(s.intonation[0].steps[4], 0, 1e-9, '60 cents scores nothing at Elementary');
  near(s.timing[0].steps[4], 100, 1e-9);
  near(s.overall[0].steps[4], 25, 1e-9, 'overall = 75 % intonation + 25 % timing');
  near(s.overall[0].steps[0], 100, 1e-9);
  // 70 bars: three at a time, 24 groups
  const long = pieceBarSurfaces([pieceRun(1, 70, 2)], p);
  eq(long.size, 3); eq(long.labels.length, 24); eq(long.labels[1], '4'); eq(long.labels[23], '70'); eq(long.groups[1], { from: 4, to: 6 });
  assert(long.labels.length <= MAX_BAR_GROUPS);
  // 64 bars: two at a time
  eq(pieceBarSurfaces([pieceRun(1, 64, 2)], p).size, 2);
  // a run of bars 4–6 fills just those; a run whose notes don't line up stays blank
  const sec = pieceBarSurfaces([pieceRun(1, 10, 4, undefined, [4, 6]), { ...pieceRun(2, 10, 4), notes: [[0, 100, 100, 0, 0]] }], p);
  eq(sec.overall[0].steps.map((v) => v != null), [false, false, false, true, true, true, false, false, false, false]);
  assert(sec.overall[1].steps.every((v) => v == null));
});

test('a piece: where the mistakes are, bar by bar, with every run added up', () => {
  const p = precisionAt(1); // Elementary: 45 cents, 50 % timing score nothing
  const note = (b, k) => (b === 2 && k === 0 ? [null, 0, 0, 2, null] // missed
    : b === 2 && k === 1 ? [null, 0, 80, 1, 5] // wrong note
      : b === 3 && k === 0 ? [50, 0, 100, 0, 0] // far out of tune
        : b === 4 && k === 2 ? [5, 90, 0, 0, 70] // badly timed
          : b === 4 && k === 3 ? [48, 0, 0, 0, -60] // both: one note with a mistake
            : [10, 100, 100, 0, 10]);
  const m = pieceMistakes([pieceRun(1, 5, 4, note), pieceRun(2, 5, 4, note, [2, 3])], p);
  eq(m.bars, 5);
  const r = m.rows[0].cells;
  eq(r[0].n, 0); eq(r[0].notes, 4);
  eq([r[1].n, r[1].missed, r[1].tune, r[1].time], [2, 1, 1, 0]);
  eq([r[2].n, r[2].tune], [1, 1]);
  eq([r[3].n, r[3].tune, r[3].time], [2, 1, 2]);
  // the second run played bars 2–3 only
  eq(m.rows[1].cells.map((c) => (c ? c.n : null)), [null, 2, 1, null, null]);
  eq(m.all.map((c) => c.n), [0, 4, 2, 2, 0]);
  eq(m.all[1].notes, 8);
  const svg = mistakesChart({ data: m, width: 600, palette: { fg: '#000', muted: '#666', grid: '#ddd', bg: '#fff', errors: '#c00' }, dates: () => 'd' });
  assert(svg.startsWith('<svg') && svg.includes('All runs') && svg.includes('1 missed, 1 wrong or far out of tune'));
});

// ---------------------------------------------------------------- what goes wrong, note by note
import { pieceNoteStats, noteObservations, moveKind, storedNote } from '../js/noteStats.js';
import { pieceSequence, pieceNoteLabels } from '../js/pieces.js';
import { parsePiece } from '../js/pieceText.js';
import { instrumentInfo } from '../js/instruments.js';
import { pieceRunCharts } from '../js/ui/charts.js';

test('a piece: which notes are often sharp or flat, and which go out after a particular note', () => {
  // D E F♯ G | A G F♯ E | D E D2 | (D after E three times a run; D after F♯ never)
  const text = 'T: x\nM: 4/4\nL: 1/4\nK: D\nD E F G | A G F E | D E D2 |]\n';
  const seq = pieceSequence(parsePiece(text), instrumentInfo('violin'));
  const labels = pieceNoteLabels(seq);
  const names = seq.events.map((e) => e.notes.map((n) => n.l).join());
  eq(seq.events.length, 11);
  // F♯ is always 15–21 cents sharp; D straight after E is 22–28 sharp, other D in tune
  const cents = (i, run) => {
    const ev = seq.events[i], prev = seq.events[i - 1];
    const isFs = ev.midis[0] % 12 === 6, isD = ev.midis[0] % 12 === 2;
    if (isFs) return 15 + ((run + i) % 4) * 2;
    if (isD && prev && prev.midis[0] % 12 === 4) return 22 + ((run + i) % 4) * 2;
    return ((run * 3 + i) % 5) - 2;
  };
  const runs = Array.from({ length: 5 }, (_, run) => ({ d: run, labels, sec: null, notes: seq.events.map((_, i) => [cents(i, run), 100, 100, 0, 0]) }));
  const p = precisionAt(1); // in tune within ±10
  const st = pieceNoteStats(runs, seq.events, p);
  eq(st.runs, 5); eq(st.heard, 55);
  eq(st.sharp.map((x) => x.name).sort(), ['D4', 'F♯4'], 'F♯ always, and D overall (because of what follows)');
  eq(st.flat.length, 0);
  const fs = st.notes.find((x) => x.name === 'F♯4');
  eq([fs.played, fs.n, fs.sharp], [10, 10, 1]);
  // …but D4 is only sharp after E4: the pairs find it
  eq(st.pairs.length, 1);
  const pr = st.pairs[0];
  eq([pr.name, pr.prev, pr.way, pr.n, pr.k, pr.kind], ['D4', 'E4', 'sharp', 10, 10, 'step down']);
  eq([pr.elseN, pr.elseK], [5, 0], 'elsewhere (the first note) D4 is in tune');
  assert(pr.by > 20, String(pr.by));
  eq(pr.bars, [3]);
  assert(st.moves.some((m) => m.kind === 'step down' && m.n > 0));
  eq([moveKind(0), moveKind(2), moveKind(-3), moveKind(7)], ['same', 'step up', 'skip down', 'leap up']);
  // runs read by the names they stored: the piece edited since (or no text at all) doesn't matter
  const nl = seq.events.map((e) => `${'CDEFGAB'[e.notes[0].l]}${e.notes[0].a > 0 ? '♯' : ''}${e.notes[0].o}`);
  const named = runs.map((r) => ({ ...r, nl }));
  const edited = pieceSequence(parsePiece(['T: x', 'M: 4/4', 'L: 1/4', 'K: C', 'C D E F | G A B c |]'].join('\n')), instrumentInfo('violin')).events;
  for (const ev of [edited, []]) {
    const sn = pieceNoteStats(named, ev, p);
    eq(sn.heard, 55); eq(sn.sharp.map((x) => x.name).sort(), ['D4', 'F♯4']);
    eq(sn.pairs.map((x) => `${x.name}<${x.prev}`), ['D4<E4']);
  }
  eq(storedNote('D3 · Re'), { name: 'D3', midi: 50 }); eq(storedNote('F♯4'), { name: 'F♯4', midi: 66 });
  eq(storedNote('D3 + A3'), null); eq(storedNote(''), null);
  // F♯ in tune after E, sharp after G: the pair after G is the problem, not the one after E
  const less = (i, run) => (seq.events[i].midis[0] % 12 === 6 ? (seq.events[i - 1].midis[0] % 12 === 4 ? run % 3 : 30 + (run % 3)) : ((run + i) % 5) - 2);
  const st2 = pieceNoteStats(Array.from({ length: 5 }, (_, run) => ({ d: run, labels, sec: null, notes: seq.events.map((_, i) => [less(i, run), 100, 100, 0, 0]) })), seq.events, p);
  eq(st2.sharp.map((x) => x.name), ['F♯4'], 'sharp half the time');
  eq(st2.pairs.map((x) => `${x.name}<${x.prev}`), ['F♯4<G4']);
  // the same note always out, wherever it comes from, is not a problem of one particular note before it
  const always = (i) => (seq.events[i].midis[0] % 12 === 6 ? 25 : 0);
  eq(pieceNoteStats([0, 1, 2, 3].map((run) => ({ d: run, labels, sec: null, notes: seq.events.map((_, i) => [always(i), 100, 100, 0, 0]) })), seq.events, p).pairs.length, 0);
  // a lean inside the in-tune zone isn't called sharp: 8 cents at Elementary (±10)
  const st3 = pieceNoteStats([0, 1, 2, 3].map((run) => ({ d: run, labels, sec: null, notes: seq.events.map((_, i) => [seq.events[i].midis[0] % 12 === 6 ? 8 : 0, 100, 100, 0, 0]) })), seq.events, p);
  eq(st3.sharp.length, 0);
  // often flat but in tune the rest of the time: D4 flat by 25 in 2 of its 3 places, in 4 runs (8 of 12)
  const sometimes = (i, run) => (seq.events[i].midis[0] % 12 === 2 && i !== 0 ? -25 + (run % 3) : (run + i) % 3 - 1);
  const st4 = pieceNoteStats([0, 1, 2, 3].map((run) => ({ d: run, labels, sec: null, notes: seq.events.map((_, i) => [sometimes(i, run), 100, 100, 0, 0]) })), seq.events, p);
  eq(st4.flat.map((x) => x.name), ['D4']);
  const often = st4.flat[0];
  eq([Math.round(often.flat * often.n), often.n], [8, 12]);
  // a quarter of the time well out, in tune the rest: listed, though the average (−7.5) is in tune
  const quarter = (k) => (i, run) => (seq.events[i].midis[0] % 12 === 2 && i === 8 && run < k ? -30 : 0);
  const runsOf = (f) => [0, 1, 2, 3].map((run) => ({ d: run, labels, sec: null, notes: seq.events.map((_, i) => [f(i, run), 100, 100, 0, 0]) }));
  const sq = pieceNoteStats(runsOf(quarter(3)), seq.events, p);
  eq(sq.flat.map((x) => x.name), ['D4']);
  eq([sq.flat[0].flatN, sq.flat[0].n, Math.round(sq.flat[0].mean * 10) / 10, sq.flat[0].flatBy], [3, 12, -7.5, -30]);
  // 2 of 12 (17 %) and 1 of 12 aren't "often"
  eq(pieceNoteStats(runsOf(quarter(2)), seq.events, p).flat.length, 0);
  eq(pieceNoteStats(runsOf(quarter(1)), seq.events, p).flat.length, 0);
  // a run of bars 2–3 lines up with the piece's notes; a run that doesn't line up is left out
  const sec = { d: 9, labels, sec: [2, 3], notes: seq.events.slice(4).map(() => [0, 100, 100, 0, 0]) };
  const obs = noteObservations([sec, { d: 10, labels, sec: null, notes: [[0, 100, 100, 0, 0]] }], seq.events);
  eq(obs.length, 7); eq(obs[0].bar, 2); eq(obs[0].prev, null, 'the first note played has no note before it');
  // a missed note and a wrong one are counted, but not measured
  const odd = [{ d: 1, labels, sec: null, notes: seq.events.map((_, i) => (i === 0 ? [null, 0, 0, 2, null] : i === 1 ? [null, 0, 50, 1, 5] : [0, 100, 100, 0, 0])) }];
  const so = pieceNoteStats(odd, seq.events, p);
  const d4 = so.notes.find((x) => x.name === 'D4'), e4 = so.notes.find((x) => x.name === 'E4');
  eq([d4.missed, d4.played, d4.n], [1, 3, 2]); eq([e4.wrong, e4.n], [1, 2]);
  assert(names.length === 11);
});

import { fixedWords, oftenWords, pairWords } from '../js/ui/noteStatsView.js';

test('a piece: problems checked against the latest runs – put right, getting better, started lately', () => {
  const text = 'T: x\nM: 4/4\nL: 1/4\nK: D\nD E F G | A G F E | D E D2 |]\n';
  const seq = pieceSequence(parsePiece(text), instrumentInfo('violin'));
  const labels = pieceNoteLabels(seq);
  const p = precisionAt(1); // in tune within ±10
  const DAY = 86400000;
  const isD = (i) => seq.events[i].midis[0] % 12 === 2;
  // runs on the given days; f(i, run) gives the cents of note i
  const runsOn = (days, f, sec = null) => days.map((day, run) => ({ d: day * DAY, labels, sec, notes: seq.events.map((_, i) => [f(i, run), 100, 100, 0, 0]) }));
  const days = [0, 1, 2, 3, 4, 5, 20, 21, 22, 23, 24, 25];
  // D4 flat every time in the first 6 runs, in tune in the 6 of the last week: put right
  const fixed = pieceNoteStats(runsOn(days, (i, run) => (isD(i) && run < 6 ? -30 : 0)), seq.events, p);
  eq(fixed.flat.length, 0, 'no longer listed');
  eq(fixed.fixed.map((f) => `${f.name} ${f.way}`), ['D4 flat']);
  const f = fixed.fixed[0];
  eq([f.trend.runs, f.trend.n, f.trend.beforeK, f.trend.beforeN], [6, 18, 18, 18]);
  assert(fixedWords(f).includes('not flat once in the last 6 runs (18 times measured)'), fixedWords(f));
  assert(!fixed.notes.find((x) => x.name === 'D4').oftenFlat, 'not highlighted in the table');
  eq(fixed.from, 0); eq(fixed.to, 25 * DAY);
  // put right for longer, so the good runs dilute it overall (under a quarter): still said to be put right
  const longer = pieceNoteStats(runsOn([0, 1, 2, 3, 4, ...Array.from({ length: 16 }, (_, k) => 20 + k)],(i, run) => (isD(i) && run < 5 ? -30 : 0)), seq.events, p);
  assert(longer.notes.find((x) => x.name === 'D4').flat < 0.25);
  eq(longer.flat.length, 0);
  eq(longer.fixed.map((x) => `${x.name} ${x.way} ${x.trend.runs}`), ['D4 flat 8']);
  // …once in the latest runs: still listed, and getting better
  const better = pieceNoteStats(runsOn(days, (i, run) => (isD(i) && (run < 6 || (run === 6 && i === 0)) ? -30 : 0)), seq.events, p);
  eq(better.flat.map((x) => x.name), ['D4']);
  const bt = better.flat[0].flatTrend;
  eq([bt.state, bt.k, bt.n, bt.beforeK, bt.beforeN], ['better', 1, 18, 18, 18]);
  assert(oftenWords(better.flat[0], 'flat').includes('Getting better: flat 1 of the 18 times in the last 6 runs (6%), against 18 of 18 before (100%).'), oftenWords(better.flat[0], 'flat'));
  // still as bad lately: no trend
  const same = pieceNoteStats(runsOn(days, (i) => (isD(i) ? -30 : 0)), seq.events, p);
  eq(same.flat[0].flatTrend, null);
  // runs of other bars (no D in bar 2) don't count as playing D well
  const other = runsOn(days.slice(0, 6), (i) => (isD(i) ? -30 : 0)).concat(runsOn(days.slice(6), () => 0, [2, 2]).map((r) => ({ ...r, notes: r.notes.slice(4, 8) })));
  const so = pieceNoteStats(other, seq.events, p);
  eq(so.flat.map((x) => x.name), ['D4'], 'still listed: not measured lately');
  eq(so.fixed.length, 0);
  // out in every one of the last 5 runs, after 25 in tune: diluted overall (17 %), listed as started lately
  const month = Array.from({ length: 30 }, (_, k) => k);
  const late = pieceNoteStats(runsOn(month, (i, run) => (isD(i) && run >= 25 ? -30 : 0)), seq.events, p);
  const d4 = late.notes.find((x) => x.name === 'D4');
  assert(d4.flat < 0.25, String(d4.flat));
  eq(late.flat.map((x) => x.name), ['D4']);
  eq([d4.flatTrend.state, d4.flatTrend.runs, d4.flatTrend.k, d4.flatTrend.n], ['lately', 8, 15, 24]);
  assert(oftenWords(d4, 'flat').includes('More often lately: flat 15 of the 24 times in the last 8 runs (63%).'));
  // a note after a particular note, put right lately
  const afterE = (i) => i > 0 && isD(i) && seq.events[i - 1].midis[0] % 12 === 4;
  const pf = pieceNoteStats(runsOn(days, (i, run) => (afterE(i) && run < 6 ? 25 : 0)), seq.events, p);
  eq(pf.pairs.length, 0);
  eq(pf.fixed.map((x) => (x.prev ? `${x.name}<${x.prev}` : x.name)).sort(), ['D4', 'D4<E4']);
  // …getting better: once lately
  const pb = pieceNoteStats(runsOn(days, (i, run) => (afterE(i) && (run < 6 || (run === 6 && i === 8)) ? 25 : 0)), seq.events, p);
  eq(pb.pairs.map((x) => x.trend && x.trend.state), ['better']);
  assert(pairWords(pb.pairs[0]).includes('Getting better'), pairWords(pb.pairs[0]));
});

import { saveResults, trimPieceRuns, fullRuns } from '../js/results.js';

test('a piece keeps its runs of the last 6 weeks, up to 100 – and always its newest 10', () => {
  const H = 3600e3, DAY = 86400000;
  const prun = (d) => ({ d, t: 80, i: 80, ti: 80, e: 0, pc: 1, sec: null, steps: [1, 2], notes: [[1, 90, 90, 0, 2]] });
  const store = {};
  for (let k = 0; k < 120; k++) recordRun(store, 'piece:a', prun(NOW - (120 - k) * H), NOW);
  eq(store['piece:a'].runs.length, RES.pieceRuns, '100 at most');
  eq(fullRuns(store, 'piece:a').length, 100);
  eq(lastRuns(store, 'piece:a').length, 10, 'the plots still take the newest 10');
  // older than 6 weeks: summarised, unless one of the newest 10
  const old = {};
  for (let k = 0; k < 15; k++) recordRun(old, 'piece:b', prun(NOW - 50 * DAY + k * H), NOW);
  for (let k = 0; k < 5; k++) recordRun(old, 'piece:b', prun(NOW - k * H), NOW);
  eq(old['piece:b'].runs.length, 10);
  const mix = {};
  for (let k = 0; k < 5; k++) recordRun(mix, 'piece:c', prun(NOW - 50 * DAY + k * H), NOW);
  for (let k = 0; k < 20; k++) recordRun(mix, 'piece:c', prun(NOW - 20 * DAY + k * H), NOW);
  eq(mix['piece:c'].runs.length, 20, 'all 20 of the last 6 weeks, none older');
  // scales: still 10
  const sc = {};
  for (let k = 0; k < 20; k++) recordRun(sc, 's', run(NOW - (20 - k) * H, 70), NOW);
  eq(sc.s.runs.length, 10);
});

test('storage full: the oldest extra piece runs are summarised until the store fits', () => {
  const H = 3600e3;
  const prun = (d) => ({ d, t: 80, i: 80, ti: 80, e: 0, pc: 1, sec: null, steps: new Array(50).fill(1.5), notes: new Array(50).fill([1.5, 90, 90, 0, 2]) });
  const make = () => {
    const store = {};
    for (let k = 0; k < 40; k++) recordRun(store, 'piece:a', prun(NOW - (80 - k) * H), NOW);
    for (let k = 0; k < 40; k++) recordRun(store, 'piece:b', prun(NOW - (40 - k) * H), NOW);
    return store;
  };
  const full = make();
  const size = JSON.stringify(full).length;
  const limited = (max) => ({ data: null, setItem(k, v) { if (v.length > max) throw new Error('full'); this.data = v; } });
  const box = limited(Math.round(size * 0.6));
  assert(saveResults(full, box), 'saved after making room');
  assert(box.data.length <= size * 0.6);
  const a = full['piece:a'].runs.length, b = full['piece:b'].runs.length;
  assert(a + b < 80 && a >= 10 && b >= 10, `${a} ${b}`);
  assert(a <= b, 'the oldest runs (piece a) go first');
  // nothing more to summarise: every piece keeps its newest 10, and it says it could not save
  const none = make();
  eq(saveResults(none, limited(10)), false);
  eq([none['piece:a'].runs.length, none['piece:b'].runs.length], [10, 10]);
  eq(trimPieceRuns(none), false);
  assert(saveResults(make(), limited(1e9)), 'fits: nothing summarised');
});

test('a piece: one run bar by bar – overall, intonation and timing', () => {
  const run = pieceRun(1, 6, 3, (b) => (b === 2 ? [50, 0, 100, 0, 0] : [0, 100, 100, 0, 0]));
  const html = pieceRunCharts({ run, prec: precisionAt(1), palette: { fg: '#000', muted: '#666', grid: '#ddd', bg: '#fff' }, width: 500 });
  assert(html.includes('Overall') && html.includes('Intonation') && html.includes('Timing'));
  eq((html.match(/<svg/g) || []).length, 3);
  assert(html.includes('Bar 2: 0') && html.includes('Bar 1: 100'), 'bar 2 scored nothing for intonation');
  eq(pieceRunCharts({ run: { ...run, notes: [] }, prec: precisionAt(1) }), '', 'nothing to draw');
});
