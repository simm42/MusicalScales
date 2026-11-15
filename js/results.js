// Results for syllabus items, kept in this browser only.
//
// For each item:
//   runs   – the newest 10 runs in full (per-note detail, per-scale-note cents)
//   older  – earlier runs: date, scores, errors
//   days   – runs older than a month, averaged per day
//   months – day averages older than a year, averaged per month
//
// Scores depend on the precision level, so every record keeps total,
// intonation, timing and errors for all five levels in `lv`
// (lv[level] = [t, i, ti, e]; errors are extra notes plus bow-change scrapes,
// which count more at stricter levels). Older records have no per-level
// errors and use `e`. Queries take the level to show. No DOM access (localStorage only in load/save) – the rest is pure.

const KEY = 'scales.results.v1';
const DAY = 86400000;
const LEVELS = 5;

export const RES = { fullRuns: 10, dayAfterDays: 30, monthAfterDays: 365 };

export function loadResults() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
export function saveResults(store) {
  try { localStorage.setItem(KEY, JSON.stringify(store)); return true; } catch { return false; }
}

const pad = (n) => String(n).padStart(2, '0');
export function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function monthKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
export function dayStart(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }
export function monthStart(key) { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).getTime(); }

const r1 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10) / 10);
const STATUS = { ok: 0, wrong: 1, missing: 2 };
const STATUS_NAME = ['ok', 'wrong', 'missing'];

/** Scores per level for any record (older records without `lv` use their one set of scores). */
export function levelsOf(x) {
  if (Array.isArray(x.lv) && x.lv.length === LEVELS) return x.lv.map((l) => (l.length >= 4 && l[3] != null ? l : [l[0], l[1], l[2], x.e ?? null]));
  const one = [x.t ?? null, x.i ?? null, x.ti ?? null, x.e ?? null];
  return Array.from({ length: LEVELS }, () => one.slice());
}

/** A record's scores at one precision level: {t, i, ti, e}. */
export function atLevel(x, level = 2) {
  const [t, i, ti, e] = levelsOf(x)[Math.max(0, Math.min(LEVELS - 1, Math.round(level)))];
  return { t, i, ti, e: e ?? x.e ?? null };
}

/**
 * Build a full run record from a scored result.
 * @param {object} result from scoreRun()
 * @param {object} seq from buildSequence() – gives each note's position in the scale
 * @param {Array} lv scores at every level, from scoresAtLevels()
 */
export function makeRun(result, seq, rhythm, when = Date.now(), noteName = null, lv = null) {
  const n = seq.steps ? seq.steps.length : 0;
  const sum = new Array(n).fill(0);
  const cnt = new Array(n).fill(0);
  for (const p of result.perNote) {
    if (p.status !== 'ok' || !p.cents) continue;
    const vals = p.cents.filter((c) => c != null);
    if (!vals.length) continue;
    const si = seq.events[p.event].stepIndex;
    if (si == null || si >= n) continue;
    sum[si] += vals.reduce((a, b) => a + b, 0) / vals.length;
    cnt[si]++;
  }
  const run = {
    d: when,
    rhythm,
    t: r1(result.total),
    i: r1(result.intonation),
    ti: r1(result.timing),
    e: r1(result.errors ?? result.extras.length),
    missing: result.missing,
    wrong: result.wrong,
    steps: sum.map((s, k) => (cnt[k] ? r1(s / cnt[k]) : null)),
    labels: noteName && seq.steps ? seq.steps.map((notes) => notes.map((x) => noteName(x)).join('+')) : null,
    // per note: [cents, tuning score, timing score, status, timing deviation %, flags?, cents of each string?]
    // flags: 1 = unsteady, 2 = approximate (octave double stop)
    notes: result.perNote.map((p) => {
      const row = [p.cents ? r1(p.cents.filter((c) => c != null)[0] ?? null) : null, Math.round(p.intonation), Math.round(p.timing), STATUS[p.status] ?? 2, r1(p.timingDev != null ? p.timingDev * 100 : null)];
      const flags = (p.unsteady ? 1 : 0) | (p.approx ? 2 : 0) | (p.heardShift ? 4 : 0) | (p.rechecked && !p.heardShift ? 8 : 0);
      const multi = p.cents && p.cents.length > 1;
      if (flags || multi) row.push(flags);
      if (multi) row.push(p.cents.map(r1));
      return row;
    }),
  };
  // for the detailed summary on the Results tab
  if (noteName) run.nl = result.perNote.map((p) => (seq.events[p.event] ? seq.events[p.event].notes.map(noteName).join(' + ') : ''));
  if (result.penalty != null) run.pen = r1(result.penalty);
  if (result.bpm) run.bpm = Math.round(result.bpm);
  if (result.globalOffset) run.off = result.globalOffset;
  if (lv) run.lv = lv;
  return run;
}

/**
 * Turn a stored full run back into the shape the end-of-run summary draws.
 * Runs saved before note names were stored need `labels` from the caller.
 */
export function runDetail(run, labels = null) {
  if (!run || !Array.isArray(run.notes)) return null;
  const perNote = run.notes.map((n) => ({
    cents: n[6] ? n[6] : n[0] == null ? null : [n[0]],
    intonation: n[1] ?? 0,
    timing: n[2] ?? 0,
    status: STATUS_NAME[n[3]] ?? 'missing',
    timingDev: n[4] == null ? null : n[4] / 100,
    unsteady: !!(n[5] & 1),
    approx: !!(n[5] & 2),
    heardShift: n[5] & 4 ? 12 : 0, // (which harmonic is not kept)
    rechecked: n[5] & 8 ? 'part' : null,
  }));
  const names = run.nl || labels;
  return {
    result: {
      perNote,
      total: run.t, intonation: run.i, timing: run.ti,
      extras: new Array(Math.round(run.e || 0)).fill(null),
      errors: run.e ?? null,
      penalty: run.pen ?? null,
      missing: run.missing ?? perNote.filter((p) => p.status === 'missing').length,
      wrong: run.wrong ?? perNote.filter((p) => p.status === 'wrong').length,
      bpm: run.bpm || null,
      globalOffset: run.off || null,
    },
    labels: names && names.length === perNote.length ? names : perNote.map((_, k) => `Note ${k + 1}`),
  };
}

const summaryOf = (r) => ({ d: r.d, lv: levelsOf(r), e: r.e ?? null, rhythm: r.rhythm, slurred: r.slurred });

/** Weighted merge of a run summary or an aggregate into an aggregate (per level). */
function mergeInto(agg, x) {
  const xn = x.n || 1;
  const an = agg.n || 0;
  const xl = levelsOf(x);
  if (!agg.lv) agg.lv = Array.from({ length: LEVELS }, () => [null, null, null, null]);
  for (let L = 0; L < LEVELS; L++) for (let k = 0; k < 4; k++) {
    if (agg.lv[L].length < 4) agg.lv[L].push(null);
    const xv = xl[L][k];
    if (xv == null) continue;
    const av = agg.lv[L][k];
    agg.lv[L][k] = av == null || !an ? xv : (av * an + xv * xn) / (an + xn);
  }
  if (x.e != null) {
    const xw = x.en ?? xn;
    const aw = agg.en || 0;
    agg.e = aw ? (agg.e * aw + x.e * xw) / (aw + xw) : x.e;
    agg.en = aw + xw;
  }
  agg.n = an + xn;
  return agg;
}

function emptyRecord() { return { runs: [], older: [], days: [], months: [] }; }

/** Apply the storage rules: 10 full runs, then summaries, then per-day, then per-month. */
export function compact(rec, now = Date.now()) {
  rec.runs.sort((a, b) => a.d - b.d);
  while (rec.runs.length > RES.fullRuns) rec.older.push(summaryOf(rec.runs.shift()));
  rec.older.sort((a, b) => a.d - b.d);
  const dayCut = now - RES.dayAfterDays * DAY;
  const keepOlder = [];
  for (const o of rec.older) {
    if (o.d >= dayCut) { keepOlder.push(o); continue; }
    const key = dayKey(o.d);
    let agg = rec.days.find((x) => x.day === key);
    if (!agg) { agg = { day: key, n: 0 }; rec.days.push(agg); }
    mergeInto(agg, o);
  }
  rec.older = keepOlder;
  const monthCut = now - RES.monthAfterDays * DAY;
  const keepDays = [];
  for (const dd of rec.days) {
    if (dayStart(dd.day) >= monthCut) { keepDays.push(dd); continue; }
    const key = dd.day.slice(0, 7);
    let agg = rec.months.find((x) => x.month === key);
    if (!agg) { agg = { month: key, n: 0 }; rec.months.push(agg); }
    mergeInto(agg, dd);
  }
  rec.days = keepDays.sort((a, b) => (a.day < b.day ? -1 : 1));
  rec.months.sort((a, b) => (a.month < b.month ? -1 : 1));
  return rec;
}

export function recordRun(store, itemId, run, now = Date.now()) {
  const rec = store[itemId] || (store[itemId] = emptyRecord());
  rec.runs.push(run);
  compact(rec, now);
  return rec;
}

/** Move an item's old score history (earlier versions) into the results store. */
export function migrateHistory(store, item, now = Date.now()) {
  if (!item.history || !item.history.length) return false;
  const rec = store[item.id] || (store[item.id] = emptyRecord());
  for (const h of item.history) rec.older.push({ d: h.d, t: h.t, i: h.i, ti: h.ti, e: null });
  compact(rec, now);
  delete item.history;
  return true;
}

export function compactAll(store, now = Date.now()) { for (const id of Object.keys(store)) compact(store[id], now); return store; }

// ---------------------------------------------------------------- queries (scores at one level)

const recOf = (store, id) => store[id] || emptyRecord();
const project = (x, level, extra = {}) => ({ ...extra, ...atLevel(x, level) });

/** Newest full runs (oldest first), for the 3D surface. */
export function lastRuns(store, id, n = RES.fullRuns) { return recOf(store, id).runs.slice(-n); }

/** Runs worth drawing on the 3D plot: those with no more than half of their notes missing. */
export function surfaceRuns(runs) {
  return runs.filter((r) => {
    const n = Array.isArray(r.notes) ? r.notes.length : 0;
    if (!n) return true;
    const missing = r.missing ?? r.notes.filter((x) => x[3] === 2).length;
    return missing <= n / 2;
  });
}

/** Every individual run since a time (full and summarised), oldest first. */
export function runsSince(store, id, since, level = 2) {
  const rec = recOf(store, id);
  return [...rec.older, ...rec.runs]
    .filter((r) => r.d >= since)
    .sort((a, b) => a.d - b.d)
    .map((r) => project(r, level, { d: r.d, rhythm: r.rhythm, slurred: r.slurred }));
}

function groupDaily(rec, since) {
  const map = new Map();
  const add = (key, x) => { if (!map.has(key)) map.set(key, { day: key, n: 0 }); mergeInto(map.get(key), x); };
  for (const d of rec.days) if (dayStart(d.day) >= since - DAY) add(d.day, d);
  for (const r of [...rec.older, ...rec.runs]) if (r.d >= since) add(dayKey(r.d), r);
  return [...map.values()].filter((x) => dayStart(x.day) >= dayStart(dayKey(since))).sort((a, b) => (a.day < b.day ? -1 : 1));
}

function groupMonthly(rec) {
  const map = new Map();
  const add = (key, x) => { if (!map.has(key)) map.set(key, { month: key, n: 0 }); mergeInto(map.get(key), x); };
  for (const m of rec.months) add(m.month, m);
  for (const d of rec.days) add(d.day.slice(0, 7), d);
  for (const r of [...rec.older, ...rec.runs]) add(monthKey(r.d), r);
  return [...map.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

/** Per-day averages since a time; days without runs are not included. */
export function daily(store, id, since, level = 2) {
  return groupDaily(recOf(store, id), since).map((x) => project(x, level, { day: x.day, n: x.n }));
}

/** Per-month averages over all history. */
export function monthly(store, id, level = 2) {
  return groupMonthly(recOf(store, id)).map((x) => project(x, level, { month: x.month, n: x.n }));
}

/** Earliest time with any result for these items (null if none). */
export function firstTime(store, ids) {
  let first = null;
  for (const id of ids) {
    const rec = recOf(store, id);
    const cands = [
      ...rec.months.map((m) => monthStart(m.month)),
      ...rec.days.map((d) => dayStart(d.day)),
      ...rec.older.map((o) => o.d),
      ...rec.runs.map((r) => r.d),
    ];
    for (const c of cands) if (first == null || c < first) first = c;
  }
  return first;
}

export function runCount(store, id) {
  const rec = recOf(store, id);
  return rec.runs.length + rec.older.length + rec.days.reduce((a, d) => a + d.n, 0) + rec.months.reduce((a, m) => a + m.n, 0);
}

/** Latest and best total for a syllabus card, at one precision level. */
export function cardStats(store, id, level = 2) {
  const rec = recOf(store, id);
  const recent = [...rec.older, ...rec.runs].sort((a, b) => a.d - b.d).map((r) => atLevel(r, level));
  const all = [...recent, ...rec.days.map((d) => atLevel(d, level)), ...rec.months.map((m) => atLevel(m, level))].map((x) => x.t).filter((x) => x != null);
  return {
    last: recent.length ? Math.round(recent[recent.length - 1].t) : null,
    best: all.length ? Math.round(Math.max(...all)) : null,
    count: runCount(store, id),
    trend: recent.slice(-20).map((r) => r.t),
  };
}

/** Daily averages across several items (each run counts once). */
export function summaryDaily(store, ids, since, level = 2) {
  const map = new Map();
  for (const id of ids) for (const d of groupDaily(recOf(store, id), since)) {
    if (!map.has(d.day)) map.set(d.day, { day: d.day, n: 0 });
    mergeInto(map.get(d.day), d);
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).map((x) => project(x, level, { day: x.day, n: x.n }));
}

export function summaryMonthly(store, ids, level = 2) {
  const map = new Map();
  for (const id of ids) for (const m of groupMonthly(recOf(store, id))) {
    if (!map.has(m.month)) map.set(m.month, { month: m.month, n: 0 });
    mergeInto(map.get(m.month), m);
  }
  return [...map.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).map((x) => project(x, level, { month: x.month, n: x.n }));
}

export const DAYS = DAY;
