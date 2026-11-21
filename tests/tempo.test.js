// A piece's own tempo: the slow-tempo discount, the Q: line, and what is kept with a run.
// Also the fixes from the code review: damaged results, all-or-nothing restore, and a
// microphone start that is stopped while it waits.
import { test, eq, near, assert } from './harness.js';
import { tempoFactor, scoreRun, scoresAtLevels } from '../js/scoring.js';
import { precisionAt } from '../js/precision.js';
import { parsePiece } from '../js/pieceText.js';
import { setTempoLine, STARTER } from '../js/pieces.js';
import { makeRun, runDetail, recordRun, runsSince, normaliseStore, normaliseRecord, compactAll, RES } from '../js/results.js';
import { playedHow } from '../js/ui/resultsPage.js';
import { restoreBackup, BACKUP_KEYS } from '../js/backup.js';
import { AudioEngine } from '../js/audio/mic.js';

test('slow-tempo discount: 50% of the speed costs 20%, a little slower almost nothing', () => {
  eq(tempoFactor(96, 96), 1);
  eq(tempoFactor(120, 96), 1, 'faster costs nothing');
  near(tempoFactor(48, 96), 0.8, 1e-9);
  near(tempoFactor(0.95 * 96, 96), 0.996, 0.001);
  assert(1 - tempoFactor(0.95 * 96, 96) < 0.005, '5% slower costs under half a percent');
  near(tempoFactor(0.9 * 96, 96), 0.988, 0.001);
  near(tempoFactor(0.75 * 96, 96), 0.947, 0.001);
  near(tempoFactor(24, 96), 0.434, 0.001);
  eq(tempoFactor(1, 96), 0, 'never below nothing');
  eq(tempoFactor(null, 96), 1, 'no tempo measured: no change');
  eq(tempoFactor(60, null), 1, 'no written tempo: no change');
  // it only gets steeper the slower you go
  let last = 1;
  for (let pct = 100; pct >= 30; pct -= 5) { const f = tempoFactor(pct, 100); assert(f <= last); last = f; }
});

/** Eight crotchets played perfectly in tune, one every `spb` seconds. */
function evenRun(spb, opts = {}) {
  const expected = Array.from({ length: 8 }, (_, k) => ({ notes: [{ l: 'C', a: 0, o: 4 }], midis: [60 + k], onsetBeat: k, beats: 1 }));
  const detected = expected.map((e, k) => ({ onset: 1 + k * spb, end: 1 + k * spb + spb * 0.9, dur: spb * 0.9, midi: 60 + k }));
  const alignment = { pairs: expected.map((_, k) => ({ event: k, note: k })), extras: [] };
  return scoreRun({ expected, detected, alignment, prec: precisionAt(2), ...opts });
}

test('a piece played at half its written tempo scores 80%, at all five levels', () => {
  const full = evenRun(0.5, { targetBpm: 120, setBpm: 120 }); // 120 a minute
  near(full.total, 100, 1e-6);
  eq(full.tempoFactor, 1);
  const half = evenRun(1, { targetBpm: 120, setBpm: 60 }); // measured: 60 a minute
  near(half.playedBpm, 60, 1e-6);
  near(half.tempoFactor, 0.8, 1e-9);
  near(half.total, 80, 1e-6);
  for (const [t] of scoresAtLevels(half, undefined, (lv) => precisionAt(lv))) near(t, 80, 0.06);
  // a scale (no written tempo) is never discounted
  near(evenRun(1).total, 100, 1e-6);
});

test('the tempo played is measured from the notes, not taken from the setting', () => {
  // set to the written tempo but played at three-quarter speed (no metronome)
  const r = evenRun(2 / 3, { targetBpm: 120, setBpm: 120 });
  near(r.playedBpm, 90, 0.01);
  near(r.tempoFactor, tempoFactor(90, 120), 1e-9);
  // with the metronome, its tempo is the tempo played
  const m = evenRun(1, { targetBpm: 120, setBpm: 60, metronome: { t0: 1, spb: 1 } });
  near(m.playedBpm, 60, 1e-9);
  // too few notes to measure: the practice tempo is used
  const expected = [0, 1].map((k) => ({ notes: [{ l: 'C', a: 0, o: 4 }], midis: [60], onsetBeat: k, beats: 1 }));
  const few = scoreRun({ expected, detected: [{ onset: 1, end: 1.5, midi: 60 }, { onset: 2, end: 2.5, midi: 60 }], alignment: { pairs: [{ event: 0, note: 0 }, { event: 1, note: 1 }], extras: [] }, prec: precisionAt(2), targetBpm: 100, setBpm: 80 });
  eq(few.playedBpm, 80);
});

test('the tempo line: set, changed and taken out, the rest of the piece unchanged', () => {
  const noQ = 'T: Song\nM: 3/4\nL: 1/8\nK: G\nG2 A2 B2 |]\n';
  const withQ = setTempoLine(noQ, 72);
  eq(parsePiece(withQ).tempo, 72);
  assert(/Q: 1\/4=72\nK: G/.test(withQ), 'just before K:');
  eq(parsePiece(setTempoLine(STARTER, 100)).tempo, 100);
  eq(setTempoLine(STARTER, 100).split('\n').filter((l) => /^Q:/.test(l)).length, 1, 'replaced, not added');
  eq(parsePiece(setTempoLine(withQ, null)).tempo, null);
  eq(setTempoLine(withQ, null), noQ);
  // a Q: in the music (a tempo change) is left alone
  const change = 'T: x\nQ: 1/4=60\nK: C\nC2 D2 |\nQ: 1/4=90\nE2 F2 |]';
  assert(setTempoLine(change, 66).includes('Q: 1/4=90'));
  eq(parsePiece(setTempoLine(change, 66)).tempo, 66);
});

test('a piece run keeps its tempo: in the record, the summary and the results table', () => {
  const result = evenRun(2 / 3, { targetBpm: 120, setBpm: 90 });
  const seq = { events: Array.from({ length: 8 }, (_, k) => ({ notes: [{ l: 'C', a: 0, o: 4 }], resultStep: k, stepIndex: 0 })), steps: Array.from({ length: 8 }, () => []) };
  const run = makeRun(result, seq, null, 1000);
  Object.assign(run, { pc: 1, sec: [2, 5], tempo: 90, tbpm: 120, pbpm: 90, tf: Math.round(result.tempoFactor * 1000) / 1000 });
  eq(playedHow(run), 'bars 2–5 · ♩ = 90 (75%)');
  eq(playedHow({ pc: 1, sec: null }), 'whole piece', 'older runs without a tempo');
  const d = runDetail(run);
  eq(d.result.targetBpm, 120);
  eq(d.result.playedBpm, 90);
  near(d.result.tempoFactor, 0.947, 0.001);
  // once it is no longer one of the last 10 runs, its tempo is still shown
  const store = {};
  recordRun(store, 'piece:p', run, 2000);
  for (let k = 0; k < RES.fullRuns; k++) recordRun(store, 'piece:p', { ...run, d: 1001 + k, tempo: 120, tbpm: 120 }, 2000);
  const oldest = runsSince(store, 'piece:p', 0)[0];
  eq(oldest.d, 1000);
  eq(playedHow(oldest), 'bars 2–5 · ♩ = 90 (75%)');
});

test('damaged results are tidied when loaded, so the app still starts', () => {
  const store = normaliseStore({
    good: { runs: [{ d: 5, t: 90 }], older: [], days: [], months: [] },
    noArrays: { runs: [{ d: 6, t: 80 }] },
    empty: { runs: [] },
    junk: 'hello',
    bad: { runs: [null, { t: 3 }, { d: 'x' }, { d: 7, t: '<img>', e: '<b>' }], older: 'no', days: [{ day: 'nope' }, { day: '2026-01-02', n: 1 }], months: [{ month: '2026-01' }] },
  });
  eq(Object.keys(store).sort().join(), 'bad,good,noArrays');
  eq(store.noArrays.older.length, 0);
  eq(store.bad.runs.length, 1);
  eq(store.bad.runs[0].t, null, 'not a number: dropped');
  eq(store.bad.runs[0].e, null);
  eq(store.bad.days.length, 1);
  compactAll(store); // this threw before, and stopped the app from starting
  eq(normaliseRecord({ runs: 'x' }), null);
  eq(Object.keys(normaliseStore(null)).length, 0);
  eq(Object.keys(normaliseStore([1, 2])).length, 0);
});

test('a restore that runs out of room puts everything back as it was', () => {
  const m = new Map([['scales.list.v1', '["old"]'], ['scales.results.v1', '{"a":1}'], ['scales.theme', 'dark']]);
  const storage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (k === BACKUP_KEYS.pieces) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
  };
  const snap = () => JSON.stringify([...m].sort());
  const before = snap();
  let threw = false;
  try { restoreBackup({ data: { list: ['new'], results: {}, pieces: [{ text: 'x' }] } }, storage); } catch { threw = true; }
  assert(threw, 'the error still reaches the page, which says so');
  eq(snap(), before);
});

test('a microphone start stopped while waiting for permission gives up', async () => {
  const engine = new AudioEngine();
  const ctx = { sampleRate: 48000, state: 'running', destination: {} };
  engine.ensureContext = async () => ctx;
  let grant;
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }], getAudioTracks: () => [] };
  engine.openMic = () => new Promise((res) => { grant = () => res(stream); });
  const starting = engine.start({ source: 'mic', minFreq: 100, maxFreq: 1000, onFrames: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  assert(grant, 'waiting for the microphone');
  engine.stop(); // Stop pressed, or another tab, while the question is showing
  grant();
  eq(await starting, null);
  eq(engine.running, false);
  eq(engine.worker, null, 'no pitch worker left running');
  eq(stopped, 1, 'the microphone opened for it is closed again');
});
