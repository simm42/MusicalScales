// Precision levels: how close a note must be to count as good. One table
// drives tuner colours, note colours in the score and the scoring curves.

export const LEVELS = [
  { name: 'Beginner',     fullCents: 15, zeroCents: 60, fullTiming: 0.15, zeroTiming: 0.60 },
  { name: 'Elementary',   fullCents: 10, zeroCents: 45, fullTiming: 0.10, zeroTiming: 0.50 },
  { name: 'Intermediate', fullCents: 7,  zeroCents: 35, fullTiming: 0.07, zeroTiming: 0.40 },
  { name: 'Advanced',     fullCents: 5,  zeroCents: 25, fullTiming: 0.05, zeroTiming: 0.30 },
  { name: 'Expert',       fullCents: 3,  zeroCents: 15, fullTiming: 0.03, zeroTiming: 0.20 },
];

// Singers: pitch tolerances one and a half times as wide, timing a third wider
// (a consonant before each vowel makes the start of a sung note less exact).
export const VOICE_TOLERANCE = { cents: 1.5, timing: 1.3 };

/** Interpolated tolerances for a slider value 0..4 (wider for the voice). */
export function precisionAt(value, instrument = null) {
  const v = Math.min(LEVELS.length - 1, Math.max(0, Number(value) || 0));
  const i = Math.min(LEVELS.length - 2, Math.floor(v));
  const f = v - i;
  const a = LEVELS[i], b = LEVELS[i + 1];
  const lerp = (k) => a[k] + (b[k] - a[k]) * f;
  const nearest = LEVELS[Math.round(v)];
  const c = instrument === 'voice' ? VOICE_TOLERANCE.cents : 1;
  const tm = instrument === 'voice' ? VOICE_TOLERANCE.timing : 1;
  return {
    value: v,
    name: f === 0 || f === 1 ? LEVELS[Math.round(v)].name : nearest.name,
    fullCents: lerp('fullCents') * c,
    zeroCents: lerp('zeroCents') * c,
    fullTiming: lerp('fullTiming') * tm,
    zeroTiming: lerp('zeroTiming') * tm,
  };
}

/** 100 inside `full`, linear down to 0 at `zero`. */
export function linearScore(dev, full, zero) {
  const d = Math.abs(dev);
  if (d <= full) return 100;
  if (d >= zero) return 0;
  return 100 * (1 - (d - full) / (zero - full));
}

/** 0 = perfect, 1 = at/after the zero-score tolerance; used for colours. */
export function badness(cents, prec) {
  const d = Math.abs(cents);
  if (d <= prec.fullCents) return 0;
  return Math.min(1, (d - prec.fullCents) / (prec.zeroCents - prec.fullCents));
}

/** Colour along green → amber → red for a badness 0..1 (uses CSS variables' RGB values). */
export function badnessColor(b, palette) {
  const { good, warn, bad } = palette;
  const mix = (c1, c2, t) => c1.map((v, k) => Math.round(v + (c2[k] - v) * t));
  const rgb = b < 0.5 ? mix(good, warn, b / 0.5) : mix(warn, bad, (b - 0.5) / 0.5);
  return `rgb(${rgb.join(',')})`;
}

export function scoreClass(score) {
  if (score == null) return 'n-missing';
  if (score >= 80) return 'n-good';
  if (score >= 40) return 'n-ok';
  return 'n-bad';
}
