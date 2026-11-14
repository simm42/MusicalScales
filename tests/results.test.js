import { test, eq, near, assert } from './harness.js';
import {
  RES, recordRun, makeRun, compact, migrateHistory, lastRuns, runsSince, daily, monthly,
  summaryDaily, summaryMonthly, firstTime, cardStats, dayKey, DAYS, atLevel,
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
