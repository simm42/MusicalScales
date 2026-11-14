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
      const diag = D[(i - 1) * W + j - 1] + cost(detected[i - 1], expected[j - 1]);
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
