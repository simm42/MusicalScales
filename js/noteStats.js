// What goes wrong in a piece, note by note, over its stored runs: which notes are often
// sharp or flat, and which notes go out of tune after a particular note (a shift, a stretch,
// a string crossing). No DOM access.

import { barsOfSteps } from './barSurface.js';
import { noteName } from './theory.js';

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
/** How sure a lean is: the mean against its spread (a one-sample t). */
const tOf = (a) => { const s = sd(a); return a.length < 2 ? 0 : s === 0 ? (mean(a) === 0 ? 0 : Infinity) : mean(a) / (s / Math.sqrt(a.length)); };

export const STATS = {
  minNotes: 4,     // times a note must be heard before saying it leans sharp or flat
  minPair: 3,      // times a pair must come up
  lean: 6,         // cents: a lean smaller than this – or than the level's in-tune zone – isn't worth a mention
  pairWorse: 8,    // cents: how much worse a note is after a particular note than elsewhere
  sure: 2,         // t: how consistent the lean must be
};

/**
 * Every note heard in a piece's runs, with the note before it.
 * @param {object[]} runs stored full runs of the piece (all the same shape: see sameShape)
 * @param {object[]} events the whole piece's notes (pieceSequence(...).events), in order
 * @returns {object[]} { name, midi, bar, status, cents, prev: {name, midi}|null, run }
 */
export function noteObservations(runs, events) {
  const out = [];
  runs.forEach((run, ri) => {
    if (!run.labels || run.labels.length !== events.length || !Array.isArray(run.notes)) return;
    const barOf = barsOfSteps(run.labels);
    const bars = Math.max(...barOf);
    const from = run.sec ? run.sec[0] : 1, to = run.sec ? run.sec[1] : bars;
    const start = barOf.findIndex((b) => b >= from);
    const count = barOf.filter((b) => b >= from && b <= to).length;
    if (start < 0 || run.notes.length !== count) return;
    const single = (ev) => ev && ev.midis && ev.midis.length === 1 && ev.notes && ev.notes.length === 1;
    run.notes.forEach((n, k) => {
      const ev = events[start + k];
      if (!single(ev)) return; // double stops are left out
      const pe = k > 0 ? events[start + k - 1] : null;
      out.push({
        name: noteName(ev.notes[0], { octave: true }),
        midi: ev.midis[0],
        bar: barOf[start + k],
        status: n[3] === 0 ? 'ok' : n[3] === 1 ? 'wrong' : 'missing',
        cents: n[3] === 0 && n[0] != null ? n[0] : null,
        prev: single(pe) ? { name: noteName(pe.notes[0], { octave: true }), midi: pe.midis[0] } : null,
        run: ri,
      });
    });
  });
  return out;
}

/** How a set of readings leans: { n, mean, sd, t, inTune, sharp, flat } (shares 0–1 of n). */
function summary(cents, prec) {
  const n = cents.length;
  if (!n) return { n: 0, mean: null, sd: null, t: 0, inTune: 0, sharp: 0, flat: 0 };
  const full = prec.fullCents;
  return {
    n, mean: mean(cents), sd: sd(cents), t: tOf(cents),
    inTune: cents.filter((c) => Math.abs(c) <= full).length / n,
    sharp: cents.filter((c) => c > full).length / n,
    flat: cents.filter((c) => c < -full).length / n,
  };
}

/** Does it lean sharp or flat, clearly and consistently? 'sharp' | 'flat' | null */
function leanOf(s, prec, minN = STATS.minNotes) {
  if (s.n < minN || s.mean == null) return null;
  if (Math.abs(s.mean) < Math.max(STATS.lean, prec.fullCents) || Math.abs(s.t) < STATS.sure) return null;
  return s.mean > 0 ? 'sharp' : 'flat';
}

/** A movement from one note to the next, in words. */
export function moveKind(semis) {
  const d = Math.abs(semis);
  if (d === 0) return 'same';
  const way = semis > 0 ? 'up' : 'down';
  if (d <= 2) return `step ${way}`;
  if (d <= 4) return `skip ${way}`;
  return `leap ${way}`;
}
export const MOVES = ['same', 'step up', 'step down', 'skip up', 'skip down', 'leap up', 'leap down'];

/**
 * The statistics for a piece.
 * @returns {{ runs:number, heard:number, notes:object[], sharp:object[], flat:object[], pairs:object[], moves:object[] }}
 *   notes: per written note (lowest first) – { name, midi, played, missed, wrong, ...summary, lean }
 *   pairs: notes that go out after a particular note – { name, prev, n, mean, elsewhere, diff, bars, lean }
 *   moves: how in tune a note is after the same note, a step, a skip or a leap – { kind, n, mean, meanAbs, inTune }
 */
export function pieceNoteStats(runs, events, prec) {
  const obs = noteObservations(runs, events);
  const byName = new Map();
  for (const o of obs) {
    if (!byName.has(o.name)) byName.set(o.name, { name: o.name, midi: o.midi, list: [] });
    byName.get(o.name).list.push(o);
  }
  const notes = [...byName.values()].map((g) => {
    const cents = g.list.filter((o) => o.cents != null).map((o) => o.cents);
    const s = summary(cents, prec);
    return {
      name: g.name, midi: g.midi, played: g.list.length,
      missed: g.list.filter((o) => o.status === 'missing').length,
      wrong: g.list.filter((o) => o.status === 'wrong').length,
      bars: [...new Set(g.list.map((o) => o.bar))].sort((a, b) => a - b),
      ...s, lean: leanOf(s, prec),
    };
  }).sort((a, b) => a.midi - b.midi);

  // a note after a particular note, against the same note elsewhere
  const pairMap = new Map();
  for (const o of obs) {
    if (!o.prev || o.cents == null || o.prev.name === o.name) continue;
    const key = `${o.prev.name}>${o.name}`;
    if (!pairMap.has(key)) pairMap.set(key, { name: o.name, prev: o.prev.name, move: o.midi - o.prev.midi, list: [] });
    pairMap.get(key).list.push(o);
  }
  const pairs = [];
  for (const p of pairMap.values()) {
    if (p.list.length < STATS.minPair) continue;
    const here = p.list.map((o) => o.cents);
    const others = obs.filter((o) => o.name === p.name && o.cents != null && !(o.prev && o.prev.name === p.prev)).map((o) => o.cents);
    const s = summary(here, prec);
    const lean = leanOf(s, prec, STATS.minPair);
    if (!lean) continue;
    const elsewhere = others.length ? mean(others) : null;
    const diff = elsewhere == null ? s.mean : s.mean - elsewhere;
    // clearly worse here than elsewhere – further out, the same way it leans (or never heard elsewhere)
    if (Math.abs(s.mean) - Math.abs(elsewhere ?? 0) < STATS.pairWorse || Math.abs(diff) < STATS.pairWorse) continue;
    if (others.length >= 2) {
      const se = Math.sqrt((s.sd ** 2) / here.length + (sd(others) ** 2) / others.length);
      if (se > 0 && Math.abs(diff) / se < STATS.sure) continue;
    }
    pairs.push({ name: p.name, prev: p.prev, move: p.move, kind: moveKind(p.move), n: s.n, mean: s.mean, elsewhere, elsewhereN: others.length, diff, lean, bars: [...new Set(p.list.map((o) => o.bar))].sort((a, b) => a - b) });
  }
  pairs.sort((a, b) => Math.abs(b.diff) * Math.sqrt(b.n) - Math.abs(a.diff) * Math.sqrt(a.n));

  // in tune after each kind of movement
  const moves = MOVES.map((kind) => {
    const cents = obs.filter((o) => o.prev && o.cents != null && moveKind(o.midi - o.prev.midi) === kind).map((o) => o.cents);
    const s = summary(cents, prec);
    return { kind, n: s.n, mean: s.mean, meanAbs: cents.length ? mean(cents.map(Math.abs)) : null, inTune: s.inTune };
  }).filter((m) => m.n > 0);

  const lean = (w) => notes.filter((x) => x.lean === w).sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));
  return { runs: new Set(obs.map((o) => o.run)).size, heard: obs.filter((o) => o.cents != null).length, notes, sharp: lean('sharp'), flat: lean('flat'), pairs, moves };
}
