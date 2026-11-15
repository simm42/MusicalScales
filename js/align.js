// Global alignment (Needleman–Wunsch) of detected notes against expected
// events. Insertions = extra notes, deletions = missing notes,
// substitutions = wrong notes. No DOM access.

export const ALIGN = { extraCost: 1.0, missingCost: 1.0, wrongCost: 0.9, farCost: 1.6 };

/** Cost of pairing detected note d with expected event e (single-note mode). */
export function pitchCost(d, e) {
  const target = e.midis[0];
  const diff = d.midi - target;
  const ad = Math.abs(diff);
  if (ad <= 0.5) return ad * 0.1;
  if (Math.abs(ad - 12) <= 0.5) return ALIGN.wrongCost; // octave displaced
  if (ad <= 2.5) return ALIGN.wrongCost;
  return ALIGN.farCost;
}

/**
 * Single-note cost that knows the exercise: a "wrong" note whose pitch is that
 * of a nearby note of the exercise is almost always the alignment being one
 * place out (a repeat that was merged or missed), not the player playing a
 * wrong note. Pairing it here is made dearer than a missing note plus an extra
 * one, so it is matched where it belongs.
 */
export function scaleCost(expected, base = pitchCost, reach = 3) {
  return (d, e, i, j) => {
    const c = base(d, e);
    if (d.midi == null || c < ALIGN.wrongCost - 1e-9 || j == null) return c;
    for (let k = Math.max(0, j - reach); k <= Math.min(expected.length - 1, j + reach); k++) {
      if (k !== j && Math.abs(d.midi - expected[k].midis[0]) <= 0.5 && Math.abs(expected[k].midis[0] - e.midis[0]) > 0.5) {
        return ALIGN.missingCost + ALIGN.extraCost + 0.1;
      }
    }
    return c;
  };
}

/**
 * @param {object[]} detected notes
 * @param {object[]} expected events
 * @param {(d,e)=>number} [cost]
 * @returns {{pairs: Array<{event:number, note:number|null}>, extras:number[]}}
 */
export function align(detected, expected, cost = pitchCost) {
  const n = detected.length, m = expected.length;
  const W = m + 1;
  const D = new Float64Array((n + 1) * W);
  const B = new Uint8Array((n + 1) * W); // 1 diag, 2 up (extra), 3 left (missing)
  for (let i = 1; i <= n; i++) { D[i * W] = i * ALIGN.extraCost; B[i * W] = 2; }
  for (let j = 1; j <= m; j++) { D[j] = j * ALIGN.missingCost; B[j] = 3; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = D[(i - 1) * W + j - 1] + cost(detected[i - 1], expected[j - 1], i - 1, j - 1);
      const up = D[(i - 1) * W + j] + ALIGN.extraCost;
      const left = D[i * W + j - 1] + ALIGN.missingCost;
      let best = diag, b = 1;
      if (up < best - 1e-9) { best = up; b = 2; }
      if (left < best - 1e-9) { best = left; b = 3; }
      D[i * W + j] = best;
      B[i * W + j] = b;
    }
  }
  const pairs = expected.map((_, j) => ({ event: j, note: null }));
  const extras = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const b = B[i * W + j];
    if (b === 1) { pairs[j - 1].note = i - 1; i--; j--; }
    else if (b === 2) { extras.push(i - 1); i--; }
    else { j--; }
  }
  extras.reverse();
  return { pairs, extras, cost: D[n * W + m] };
}

/**
 * Was nearly everything played at the same wrong pitch? (instrument tuned to a
 * different A, or a recording playing at the wrong pitch). Tries shifting all
 * detected notes by whole semitones plus their common fraction and reports the
 * shift that makes far more notes match. Returns null when there is none.
 */
export function detectGlobalOffset(detected, expected) {
  const pitched = detected.filter((d) => d.midi != null && isFinite(d.midi));
  if (pitched.length < 5 || expected.length < 5) return null;
  const matches = (shift) => {
    const moved = pitched.map((d) => ({ ...d, midi: d.midi - shift }));
    const a = align(moved, expected);
    return a.pairs.filter((p) => p.note != null && Math.abs(moved[p.note].midi - expected[p.event].midis[0]) <= 0.5).length;
  };
  const fr = pitched.map((d) => d.midi - Math.round(d.midi)).sort((x, y) => x - y);
  const frac = fr[Math.floor(fr.length / 2)];
  const base = matches(0);
  let best = { shift: 0, n: base };
  for (let k = -7; k <= 7; k++) {
    const s = k + frac;
    if (Math.abs(s) < 0.4) continue;
    const n = matches(s);
    if (n > best.n) best = { shift: s, n };
  }
  if (best.shift !== 0 && best.n >= 0.7 * expected.length && base <= 0.5 * expected.length) {
    return { cents: Math.round(best.shift * 100), matched: best.n, matchedAsPlayed: base, of: expected.length };
  }
  return null;
}
