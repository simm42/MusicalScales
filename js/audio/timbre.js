// Approximate tone colours of the four bowed strings. A bowed string vibrates
// roughly as a sawtooth (all harmonics, falling as 1/k); the wooden body then
// boosts some frequency regions (air and wood resonances, the "bridge hill").
// No samples are used – everything is synthesised.

// res: [centre Hz, gain, width as a fraction of the centre]
export const TIMBRES = {
  violin: { res: [[280, 1.0, 0.18], [470, 1.4, 0.15], [560, 1.2, 0.12], [2600, 1.5, 0.35], [3600, 0.8, 0.25]], base: 0.3, rolloff: 0.85, maxH: 24, vibrato: 16, attack: 0.05, noise: 0.012 },
  viola:  { res: [[230, 1.1, 0.2], [380, 1.3, 0.18], [1700, 1.1, 0.4], [2400, 0.6, 0.3]], base: 0.3, rolloff: 0.95, maxH: 24, vibrato: 15, attack: 0.06, noise: 0.012 },
  cello:  { res: [[100, 1.0, 0.25], [190, 1.4, 0.2], [580, 1.0, 0.25], [1500, 0.9, 0.4]], base: 0.3, rolloff: 1.0, maxH: 30, vibrato: 13, attack: 0.07, noise: 0.01 },
  bass:   { res: [[60, 1.0, 0.3], [110, 1.3, 0.25], [300, 0.9, 0.3], [900, 0.6, 0.4]], base: 0.35, rolloff: 1.05, maxH: 30, vibrato: 10, attack: 0.09, noise: 0.008 },
};

function bodyGain(t, f) {
  let g = t.base;
  for (const [fc, amp, w] of t.res) { const x = (f - fc) / (fc * w); g += amp / (1 + x * x); }
  return g;
}

/** Harmonic amplitudes (index 0 = fundamental) for a note on an instrument. */
export function harmonicAmps(instrument, f0, sampleRate = 48000) {
  const t = TIMBRES[instrument] || TIMBRES.violin;
  const n = Math.max(1, Math.min(t.maxH, Math.floor((sampleRate * 0.45) / f0)));
  const amps = [];
  let sum = 0;
  for (let k = 1; k <= n; k++) { const a = bodyGain(t, k * f0) / Math.pow(k, t.rolloff); amps.push(a); sum += a * a; }
  const norm = 1 / Math.sqrt(sum);
  return amps.map((a) => a * norm);
}

/** One cycle of the waveform as a lookup table. */
export function waveTable(amps, size = 2048) {
  const tab = new Float32Array(size + 1);
  for (let i = 0; i < size; i++) {
    const ph = (2 * Math.PI * i) / size;
    let s = 0;
    for (let k = 0; k < amps.length; k++) s += amps[k] * Math.sin((k + 1) * ph);
    tab[i] = s;
  }
  tab[size] = tab[0];
  return tab;
}

/** Web Audio PeriodicWave with this instrument's colour (for steady reference tones). */
export function periodicWave(ctx, instrument, f0) {
  const amps = harmonicAmps(instrument, f0, ctx.sampleRate);
  const real = new Float32Array(amps.length + 1);
  const imag = new Float32Array(amps.length + 1);
  amps.forEach((a, k) => { imag[k + 1] = a; });
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

export function timbreInfo(instrument) { return TIMBRES[instrument] || TIMBRES.violin; }
