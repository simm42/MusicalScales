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
