// Double stops played together: measure each of the two expected notes from
// spectrum peaks. Partials shared by both notes are skipped; where nothing
// unshared is left (octaves) the reading is flagged as approximate.
// No DOM access.

import { midiToFreq } from './theory.js';

export const DS = { searchCents: 60, collideCents: 35, presentDb: -42, presentFraction: 0.4, partials: [1, 2, 3] };

const cents = (f, ref) => 1200 * Math.log2(f / ref);

function partialPlan(f, other) {
  const plan = [];
  let approx = false;
  for (const k of DS.partials) {
    const pf = k * f;
    const collides = [1, 2, 3, 4, 5, 6, 7, 8].some((j) => Math.abs(cents(pf, j * other)) < DS.collideCents);
    if (!collides) plan.push(k);
  }
  if (!plan.length) { plan.push(1); approx = true; }
  return { plan, approx };
}

/** Measure one note in one frame's peaks. @returns cents or null */
function measure(peaks, f, plan) {
  let wsum = 0, csum = 0;
  for (const k of plan) {
    const target = k * f;
    let best = null;
    for (const [pf, db] of peaks) {
      if (db < DS.presentDb) continue;
      const c = cents(pf, target);
      if (Math.abs(c) <= DS.searchCents && (!best || db > best[1])) best = [c, db];
    }
    if (best) { const w = Math.pow(10, best[1] / 20) / k; wsum += w; csum += w * best[0]; }
  }
  return wsum > 0 ? csum / wsum : null;
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

/** Evaluate a segmented note against the expected pair. */
export function evaluateDoubleStop(note, event, a4 = 440) {
  const [lo, hi] = event.midis.map((m) => midiToFreq(m, a4));
  const pl = partialPlan(lo, hi), ph = partialPlan(hi, lo);
  const frames = note.peakFrames || [];
  const rl = [], rh = [];
  for (const peaks of frames) {
    const a = measure(peaks, lo, pl.plan); if (a != null) rl.push(a);
    const b = measure(peaks, hi, ph.plan); if (b != null) rh.push(b);
  }
  const need = Math.max(1, DS.presentFraction * frames.length);
  return {
    cents: [rl.length >= need ? median(rl) : null, rh.length >= need ? median(rh) : null],
    approx: pl.approx || ph.approx,
  };
}

/** Live reading for one frame. */
export function liveDoubleStop(peaks, event, a4 = 440) {
  if (!peaks || !event || event.midis.length < 2) return null;
  const [lo, hi] = event.midis.map((m) => midiToFreq(m, a4));
  return [measure(peaks, lo, partialPlan(lo, hi).plan), measure(peaks, hi, partialPlan(hi, lo).plan)];
}

/** Alignment cost for double stops. */
export function doubleStopCost(a4) {
  return (note, event) => {
    const r = evaluateDoubleStop(note, event, a4);
    const found = r.cents.filter((c) => c != null).length;
    return found === 2 ? 0 : found === 1 ? 0.9 : 1.6;
  };
}
