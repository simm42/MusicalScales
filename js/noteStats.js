// What goes wrong in a piece, note by note, over its stored runs: which notes are often
// sharp or flat – clearly out (beyond the level's in-tune zone) a quarter of the times or more,
// however in tune they are the rest of the time – and which notes go out after a particular
// note (a shift, a stretch, a string crossing). No DOM access.

import { barsOfSteps } from './barSurface.js';
import { noteName, parseNote, midiOf } from './theory.js';

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };

export const STATS = {
  minNotes: 4,     // times a note must be measured before saying it is often out
  minPair: 3,      // times a note must come after the same note before judging the pair
  often: 0.25,     // a note is often sharp (or flat) when it is out that way this share of the times…
  oftenMin: 2,     // …and at least this many times – however in tune it is the rest of the time
  pairOften: 0.5,  // after a particular note: out that way at least half the times…
  pairMore: 0.25,  // …and this much more often than the same note elsewhere
};

/**
 * A stored note name ("F♯4", "D3 · Re" when singing) as { name, midi }; null for a double stop
 * ("D3 + A3") or anything unreadable.
 */
export function storedNote(label) {
  if (!label || typeof label !== 'string' || label.includes('+')) return null;
  const txt = label.split('·')[0].trim();
  try { const n = parseNote(txt); return { name: noteName(n, { octave: true }), midi: midiOf(n) }; } catch { return null; }
}

/**
 * Every note heard in a piece's runs, with the note before it. Each run is read by what it
 * stored itself – its note names (nl) and bars (labels) – so runs from before the piece was
 * edited count too; the piece's notes now (events) are used only for runs without names.
 * @param {object[]} runs stored full runs of the piece
 * @param {object[]} events the whole piece's notes now (pieceSequence(...).events), in order
 * @returns {object[]} { name, midi, bar, status, cents, prev: {name, midi}|null, run }
 */
export function noteObservations(runs, events = []) {
  const out = [];
  runs.forEach((run, ri) => {
    if (!run.labels || !run.labels.length || !Array.isArray(run.notes)) return;
    const barOf = barsOfSteps(run.labels);
    const bars = Math.max(...barOf);
    const from = run.sec ? run.sec[0] : 1, to = run.sec ? run.sec[1] : bars;
    const start = barOf.findIndex((b) => b >= from);
    const count = barOf.filter((b) => b >= from && b <= to).length;
    if (start < 0 || run.notes.length !== count) return;
    const single = (ev) => ev && ev.midis && ev.midis.length === 1 && ev.notes && ev.notes.length === 1;
    // the note at k: by the name the run stored, else (an old run) by the piece as it is now
    const fromEvents = events.length === run.labels.length;
    const noteAt = (k) => {
      if (Array.isArray(run.nl) && run.nl.length === run.notes.length) return storedNote(run.nl[k]);
      const ev = fromEvents ? events[start + k] : null;
      return single(ev) ? { name: noteName(ev.notes[0], { octave: true }), midi: ev.midis[0] } : null;
    };
    run.notes.forEach((n, k) => {
      const here = noteAt(k);
      if (!here) return; // double stops are left out
      out.push({
        ...here,
        bar: barOf[start + k],
        status: n[3] === 0 ? 'ok' : n[3] === 1 ? 'wrong' : 'missing',
        cents: n[3] === 0 && n[0] != null ? n[0] : null,
        prev: k > 0 ? noteAt(k - 1) : null,
        run: ri,
      });
    });
  });
  return out;
}

/**
 * How a set of readings falls: { n, mean, sd, inTune, sharp, flat, sharpBy, flatBy } – shares
 * 0–1 of n; out = beyond the level's in-tune zone; sharpBy / flatBy: the average of the
 * readings that were out that way (cents).
 */
function summary(cents, prec) {
  const n = cents.length;
  if (!n) return { n: 0, mean: null, sd: null, inTune: 0, sharp: 0, flat: 0, sharpN: 0, flatN: 0, sharpBy: null, flatBy: null };
  const full = prec.fullCents;
  const hi = cents.filter((c) => c > full), lo = cents.filter((c) => c < -full);
  return {
    n, mean: mean(cents), sd: sd(cents),
    inTune: cents.filter((c) => Math.abs(c) <= full).length / n,
    sharp: hi.length / n, flat: lo.length / n, sharpN: hi.length, flatN: lo.length,
    sharpBy: hi.length ? mean(hi) : null, flatBy: lo.length ? mean(lo) : null,
  };
}

/** Is it often out that way – a quarter of the times or more – whatever the average says? */
const often = (s, way, minN = STATS.minNotes) => s.n >= minN && s[`${way}N`] >= STATS.oftenMin && s[way] >= STATS.often - 1e-9;

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
 *   notes: per written note (lowest first) – { name, midi, played, missed, wrong, bars, ...summary, oftenSharp, oftenFlat }
 *   sharp / flat: the notes often out that way, most often first
 *   pairs: notes often out after a particular note, and more often than elsewhere –
 *     { name, prev, way, n, k, share, elseN, elseK, elseShare, by, bars }
 *   moves: how in tune a note is after the same note, a step, a skip or a leap – { kind, n, inTune, sharp, flat, meanAbs }
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
      ...s, oftenSharp: often(s, 'sharp'), oftenFlat: often(s, 'flat'),
    };
  }).sort((a, b) => a.midi - b.midi);

  // a note after a particular note: often out there, and more often than elsewhere
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
    const here = summary(p.list.map((o) => o.cents), prec);
    const other = summary(obs.filter((o) => o.name === p.name && o.cents != null && !(o.prev && o.prev.name === p.prev)).map((o) => o.cents), prec);
    for (const way of ['sharp', 'flat']) {
      const k = here[`${way}N`];
      const more = here[way] - (other.n ? other[way] : 0);
      if (k < STATS.oftenMin || here[way] < STATS.pairOften - 1e-9 || more < STATS.pairMore - 1e-9) continue;
      pairs.push({
        name: p.name, prev: p.prev, move: p.move, kind: moveKind(p.move), way,
        n: here.n, k, share: here[way], by: here[`${way}By`],
        elseN: other.n, elseK: other[`${way}N`], elseShare: other.n ? other[way] : null, more,
        bars: [...new Set(p.list.map((o) => o.bar))].sort((a, b) => a - b),
      });
    }
  }
  pairs.sort((a, b) => b.more * Math.sqrt(b.n) - a.more * Math.sqrt(a.n));

  // in tune after each kind of movement
  const moves = MOVES.map((kind) => {
    const cents = obs.filter((o) => o.prev && o.cents != null && moveKind(o.midi - o.prev.midi) === kind).map((o) => o.cents);
    const s = summary(cents, prec);
    return { kind, n: s.n, inTune: s.inTune, sharp: s.sharp, flat: s.flat, mean: s.mean, meanAbs: cents.length ? mean(cents.map(Math.abs)) : null };
  }).filter((m) => m.n > 0);

  // most often out first
  const list = (way) => notes.filter((x) => x[way === 'sharp' ? 'oftenSharp' : 'oftenFlat']).sort((a, b) => b[way] - a[way] || b[`${way}N`] - a[`${way}N`]);
  return { runs: new Set(obs.map((o) => o.run)).size, heard: obs.filter((o) => o.cents != null).length, notes, sharp: list('sharp'), flat: list('flat'), pairs, moves };
}
