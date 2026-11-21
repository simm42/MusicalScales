// Keeping the store small and the data kept: pieces not practised for 6 months keep
// only their scores, and the request to the browser to keep the data for good.
import { test, eq, assert } from './harness.js';
import { compact, compactAll, recordRun, detailCleared, RES } from '../js/results.js';
import { storageState, askToKeep } from '../js/persist.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 21, 12);
const lv = (t) => Array.from({ length: 5 }, () => [t, t, t, 1]);
const pieceRun = (d, t = 80) => ({ d, t, i: t, ti: t, e: 1, lv: lv(t), pc: 1, sec: null, tempo: 72, tbpm: 96, steps: new Array(200).fill(3.5), notes: new Array(200).fill([3.5, 90, 90, 0, 2]) });
const scaleRun = (d, t = 80) => ({ d, t, i: t, ti: t, e: 1, lv: lv(t), rhythm: 'crotchet', steps: [1, 2], notes: [[1, 90, 90, 0, 2]] });
const rec = (runs) => ({ runs, older: [], days: [], months: [] });

test('a piece not practised for 6 months keeps only its scores', () => {
  const last = NOW - (RES.pieceDetailDays + 1) * DAY;
  const r = rec([pieceRun(last - 2 * DAY, 70), pieceRun(last - DAY, 80), pieceRun(last, 90)]);
  const before = JSON.stringify(r).length;
  compact(r, NOW);
  eq(r.runs.length, 0, 'no full runs left');
  assert(detailCleared(r));
  assert(JSON.stringify(r).length < before / 10, 'much smaller');
  // the scores are still there, as day averages
  const days = r.days.map((x) => x.day);
  eq(days.length, 3);
  assert(r.days.every((x) => Array.isArray(x.lv) && x.lv[2][0] != null), 'scores kept at every level');
});

test('practised within 6 months, or a scale: the full runs stay', () => {
  const recent = rec([pieceRun(NOW - (RES.pieceDetailDays - 1) * DAY)]);
  compact(recent, NOW);
  eq(recent.runs.length, 1);
  assert(!detailCleared(recent));
  const scale = rec([scaleRun(NOW - 400 * DAY)]);
  compact(scale, NOW);
  eq(scale.runs.length, 1, 'syllabus exercises keep their last 10 runs');
  assert(!detailCleared(rec([])), 'a piece never played is not "cleared"');
});

test('a cleared piece practised again starts new full runs', () => {
  const store = { 'piece:p': rec([pieceRun(NOW - 300 * DAY)]) };
  compactAll(store, NOW);
  assert(detailCleared(store['piece:p']));
  recordRun(store, 'piece:p', pieceRun(NOW), NOW);
  eq(store['piece:p'].runs.length, 1);
  assert(!detailCleared(store['piece:p']));
  assert(store['piece:p'].days.length >= 1, 'its older scores are still there');
});

/** A stand-in for navigator.storage. */
function fakeStorage({ persisted = false, grant = false, throws = false } = {}) {
  const calls = { persist: 0 };
  return {
    calls,
    persisted: async () => { if (throws) throw new Error('no'); return persisted; },
    persist: async () => { calls.persist++; persisted = grant; return grant; },
  };
}

test('asking the browser to keep the data', async () => {
  const yes = fakeStorage({ grant: true });
  eq(await storageState(yes), 'may-clear');
  eq(await askToKeep(yes), 'kept');
  eq(await storageState(yes), 'kept');
  const no = fakeStorage({ grant: false });
  eq(await askToKeep(no), 'may-clear');
  const already = fakeStorage({ persisted: true });
  eq(await askToKeep(already), 'kept');
  eq(already.calls.persist, 0, 'not asked again');
  eq(await askToKeep(fakeStorage({ throws: true })), 'unknown');
  eq(await askToKeep(null), 'unknown', 'a browser without the Storage API');
  eq(await storageState({}), 'unknown');
});
