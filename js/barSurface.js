// A piece's 3D plots on the Results page and in the PDF: drawing every note is too busy,
// so each run is averaged over groups of bars – one bar at a time for a short piece, two
// or three for a long one, so there are never more than MAX_BAR_GROUPS along the front.
// Three plots: overall (intonation 75 %, timing 25 %), intonation, and timing (tempo).
// No DOM access.

import { linearScore } from './precision.js';

export const MAX_BAR_GROUPS = 32;

/** The bar (from 1) of each note of the whole piece, from a run's labels (the bar number under the first note of each bar). */
export function barsOfSteps(labels) {
  let bar = 1;
  return (labels || []).map((l) => { const n = Number(l); if (l !== '' && l != null && n > 0) bar = n; return bar; });
}

/** A stored note's scores at a precision level: [intonation, timing], 0–100 (a missing note scores 0 for both). */
export function noteScores(n, prec) {
  const status = n[3];
  if (status === 2) return [0, 0];
  let inton = 0;
  if (status === 0) {
    const cents = Array.isArray(n[6]) ? n[6] : [n[0]];
    const cs = cents.filter((c) => c != null);
    inton = cs.length ? cs.reduce((a, c) => a + linearScore(c, prec.fullCents, prec.zeroCents), 0) / cents.length : (n[1] ?? 0);
  }
  const timing = n[4] != null ? linearScore(n[4] / 100, prec.fullTiming, prec.zeroTiming) : (n[2] ?? 0);
  return [inton, timing];
}

/**
 * The three plots for a piece's runs.
 * @param {object[]} runs stored full runs, oldest first (all the same shape: see sameShape)
 * @param {object} prec precision tolerances to score the notes at
 * @returns {{ groups:{from,to}[], size:number, labels:string[], overall:object[], intonation:object[], timing:object[] } | null}
 *   each plot is [{ d, steps: value per bar group (null where nothing was played) }]
 */
export function pieceBarSurfaces(runs, prec, maxGroups = MAX_BAR_GROUPS) {
  const newest = runs.length ? runs[runs.length - 1] : null;
  if (!newest || !newest.labels || !newest.labels.length) return null;
  const barOf = barsOfSteps(newest.labels);
  const bars = Math.max(...barOf);
  const size = Math.max(1, Math.ceil(bars / maxGroups));
  const G = Math.ceil(bars / size);
  const groups = Array.from({ length: G }, (_, g) => ({ from: g * size + 1, to: Math.min(bars, (g + 1) * size) }));
  const groupOf = (bar) => Math.floor((bar - 1) / size);
  const plots = { overall: [], intonation: [], timing: [] };
  for (const run of runs) {
    const sum = { overall: new Array(G).fill(0), intonation: new Array(G).fill(0), timing: new Array(G).fill(0) };
    const cnt = new Array(G).fill(0);
    const notes = Array.isArray(run.notes) ? run.notes : [];
    // the run's notes are those of the bars it played, in order (a chosen section, or the whole piece)
    const from = run.sec ? run.sec[0] : 1, to = run.sec ? run.sec[1] : bars;
    const start = barOf.findIndex((b) => b >= from);
    const count = barOf.filter((b) => b >= from && b <= to).length;
    if (start >= 0 && notes.length === count) {
      notes.forEach((n, k) => {
        const g = groupOf(barOf[start + k]);
        const [i, t] = noteScores(n, prec);
        sum.intonation[g] += i;
        sum.timing[g] += t;
        sum.overall[g] += 0.75 * i + 0.25 * t;
        cnt[g]++;
      });
    }
    for (const key of Object.keys(plots)) plots[key].push({ d: run.d, steps: sum[key].map((s, g) => (cnt[g] ? s / cnt[g] : null)) });
  }
  // each group by its first bar (the plot's front edge is short of room)
  const labels = groups.map((x) => String(x.from));
  return { groups, size, labels, ...plots };
}

/**
 * Where the mistakes are, bar by bar (not grouped), for each run: notes missed, wrong or
 * very out of tune (as far out as scores nothing at this precision), and very badly timed.
 * A note with more than one of these counts once in `n`, the number of notes with a mistake.
 * @returns {{ bars:number, rows:{ d, cells:({notes, n, missed, tune, time}|null)[] }[], all:({notes, n, missed, tune, time}|null)[] } | null}
 *   a cell is null for a bar the run didn't play; `all` adds up every run.
 */
export function pieceMistakes(runs, prec) {
  const newest = runs.length ? runs[runs.length - 1] : null;
  if (!newest || !newest.labels || !newest.labels.length) return null;
  const barOf = barsOfSteps(newest.labels);
  const bars = Math.max(...barOf);
  const blank = () => ({ notes: 0, n: 0, missed: 0, tune: 0, time: 0 });
  const all = Array.from({ length: bars }, () => null);
  const rows = runs.map((run) => {
    const cells = Array.from({ length: bars }, () => null);
    const notes = Array.isArray(run.notes) ? run.notes : [];
    const from = run.sec ? run.sec[0] : 1, to = run.sec ? run.sec[1] : bars;
    const start = barOf.findIndex((b) => b >= from);
    const count = barOf.filter((b) => b >= from && b <= to).length;
    if (start < 0 || notes.length !== count) return { d: run.d, cells };
    notes.forEach((x, k) => {
      const b = barOf[start + k] - 1;
      const c = cells[b] || (cells[b] = blank());
      const a = all[b] || (all[b] = blank());
      const missed = x[3] === 2;
      const cents = Array.isArray(x[6]) ? x[6] : [x[0]];
      const tune = x[3] === 1 || (x[3] === 0 && cents.some((v) => v != null && Math.abs(v) >= prec.zeroCents));
      const time = !missed && x[4] != null && Math.abs(x[4] / 100) >= prec.zeroTiming;
      for (const t of [c, a]) {
        t.notes++;
        if (missed) t.missed++;
        if (tune) t.tune++;
        if (time) t.time++;
        if (missed || tune || time) t.n++;
      }
    });
    return { d: run.d, cells };
  });
  return { bars, rows, all };
}
