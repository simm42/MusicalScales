// Pitch detection: McLeod Pitch Method (normalised square difference function
// computed with an FFT), plus a windowed spectrum peak finder used for double
// stops. No DOM access – runs in a Web Worker and in the tests.

export const MPM_THRESHOLD = 0.9;      // fraction of highest key maximum to accept
export const MIN_WINDOW = 2048;
export const MAX_WINDOW = 8192;

/** In-place iterative radix-2 FFT. re/im are Float64Arrays of power-of-two length. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export function windowSizeFor(sampleRate, minFreq) {
  const need = 3 * sampleRate / minFreq;
  let n = MIN_WINDOW;
  while (n < need && n < MAX_WINDOW) n <<= 1;
  return n;
}

export class MPM {
  constructor(size, sampleRate) {
    this.size = size;
    this.sr = sampleRate;
    this.re = new Float64Array(size * 2);
    this.im = new Float64Array(size * 2);
    this.nsdf = new Float64Array(size);
  }

  /** @returns {{freq:number, clarity:number, rms:number}} freq 0 if none */
  detect(x, minFreq, maxFreq) {
    const N = this.size, re = this.re, im = this.im, nsdf = this.nsdf;
    let energy = 0;
    for (let i = 0; i < N; i++) { const v = x[i]; re[i] = v; im[i] = 0; energy += v * v; }
    for (let i = N; i < 2 * N; i++) { re[i] = 0; im[i] = 0; }
    const rms = Math.sqrt(energy / N);
    if (energy < 1e-10) return { freq: 0, clarity: 0, rms };
    fft(re, im);
    for (let i = 0; i < 2 * N; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    fft(re, im, true);
    const scale = 1 / (2 * N);
    const tauMax = Math.min(N - 2, Math.ceil(this.sr / minFreq) + 2);
    const tauMin = Math.max(2, Math.floor(this.sr / maxFreq) - 1);
    let m = 2 * energy;
    nsdf[0] = 1;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      m -= x[tau - 1] * x[tau - 1] + x[N - tau] * x[N - tau];
      nsdf[tau] = m > 1e-12 ? (2 * re[tau] * scale) / m : 0;
    }
    // key maxima: highest point between each positive-going and negative-going zero crossing
    const peaks = [];
    let tau = 1;
    while (tau < tauMax && nsdf[tau] > 0) tau++; // leave the zero-lag lobe
    let best = -1, bestTau = -1;
    for (; tau <= tauMax; tau++) {
      if (nsdf[tau] > 0) {
        if (nsdf[tau] > best && nsdf[tau] >= nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1]) { best = nsdf[tau]; bestTau = tau; }
      } else if (bestTau > 0) {
        peaks.push(bestTau); best = -1; bestTau = -1;
      }
    }
    if (bestTau > 0) peaks.push(bestTau);
    const valid = peaks.filter((p) => p >= tauMin);
    if (!valid.length) return { freq: 0, clarity: 0, rms };
    let maxVal = 0;
    for (const p of valid) maxVal = Math.max(maxVal, nsdf[p]);
    const pick = valid.find((p) => nsdf[p] >= MPM_THRESHOLD * maxVal);
    const interp = (p) => {
      const a = nsdf[p - 1], b = nsdf[p], c = nsdf[p + 1];
      const den = a - 2 * b + c;
      const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
      return { t: p + shift, v: Math.min(1, b - 0.25 * (a - c) * shift) };
    };
    const first = interp(pick);
    let t = first.t;
    // High notes have short periods, so interpolation error is large in cents.
    // Refine using the peak at a multiple of the period (≈ 128 samples away).
    const k = Math.floor(128 / first.t);
    if (k >= 2) {
      const guess = Math.round(k * first.t);
      if (guess + 2 <= tauMax) {
        let p = guess;
        for (let q = guess - 2; q <= guess + 2; q++) if (nsdf[q] > nsdf[p]) p = q;
        if (nsdf[p] > 0.8 * first.v && nsdf[p] >= nsdf[p - 1] && nsdf[p] >= nsdf[p + 1]) t = interp(p).t / k;
      }
    }
    return { freq: this.sr / t, clarity: first.v, rms };
  }
}

/** Hann-windowed magnitude spectrum with interpolated peaks (for double stops). */
export class PeakFinder {
  constructor(size, sampleRate) {
    this.size = size;
    this.sr = sampleRate;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.win = new Float64Array(size);
    for (let i = 0; i < size; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    this.mag = new Float64Array(size / 2);
  }

  /** @returns {Array<[freq, dB]>} strongest peaks, at most `max`, above floor */
  peaks(x, minFreq, maxFreq, max = 32, floorDb = -50) {
    const N = this.size, re = this.re, im = this.im, mag = this.mag;
    for (let i = 0; i < N; i++) { re[i] = x[i] * this.win[i]; im[i] = 0; }
    fft(re, im);
    let top = 1e-20;
    for (let k = 0; k < N / 2; k++) { mag[k] = Math.hypot(re[k], im[k]); if (mag[k] > top) top = mag[k]; }
    const kMin = Math.max(2, Math.floor((minFreq * N) / this.sr));
    const kMax = Math.min(N / 2 - 2, Math.ceil((maxFreq * N) / this.sr));
    const out = [];
    for (let k = kMin; k <= kMax; k++) {
      if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) {
        const db = 20 * Math.log10(mag[k] / top);
        if (db < floorDb) continue;
        const a = Math.log(mag[k - 1] + 1e-20), b = Math.log(mag[k] + 1e-20), c = Math.log(mag[k + 1] + 1e-20);
        const den = a - 2 * b + c;
        const p = den !== 0 ? 0.5 * (a - c) / den : 0;
        out.push([((k + p) * this.sr) / N, db]);
      }
    }
    out.sort((u, v) => v[1] - u[1]);
    return out.slice(0, max);
  }
}

/**
 * Streams samples into overlapping frames and analyses each one.
 * Frame time = centre of the analysis window, in seconds of the input clock.
 */
export class FrameAnalyzer {
  constructor({ sampleRate, minFreq, maxFreq, hop = 512, peaks = false }) {
    this.sr = sampleRate;
    this.minFreq = minFreq;
    this.maxFreq = maxFreq;
    this.hop = hop;
    this.size = windowSizeFor(sampleRate, minFreq);
    this.mpm = new MPM(this.size, sampleRate);
    this.peakFinder = peaks ? new PeakFinder(8192, sampleRate) : null;
    this.bufLen = Math.max(this.size, this.peakFinder ? 8192 : 0);
    this.buf = new Float32Array(this.bufLen);
    this.frameBuf = new Float32Array(this.size);
    this.peakBuf = this.peakFinder ? new Float32Array(8192) : null;
    this.filled = 0;
    this.sinceHop = 0;
    this.clock = null; // sample index of the next incoming sample
  }

  setPeaks(on) {
    if (on && !this.peakFinder) {
      this.peakFinder = new PeakFinder(8192, this.sr);
      this.peakBuf = new Float32Array(8192);
      if (this.bufLen < 8192) { const nb = new Float32Array(8192); nb.set(this.buf.subarray(this.bufLen - Math.min(this.filled, this.bufLen)), 8192 - Math.min(this.filled, this.bufLen)); this.buf = nb; this.bufLen = 8192; }
    }
    if (!on) this.peakFinder = null;
  }

  /** Push samples; returns the frames produced. `startSample` = clock of samples[0]. */
  push(samples, startSample) {
    if (this.clock == null || startSample != null) this.clock = startSample ?? 0;
    const frames = [];
    const L = this.bufLen;
    let i = 0;
    while (i < samples.length) {
      const n = Math.min(samples.length - i, this.hop - this.sinceHop);
      // shift buffer left by n and append
      this.buf.copyWithin(0, n);
      this.buf.set(samples.subarray(i, i + n), L - n);
      this.filled = Math.min(L, this.filled + n);
      this.sinceHop += n;
      this.clock += n;
      i += n;
      if (this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        if (this.filled >= this.size) frames.push(this.analyse());
      }
    }
    return frames;
  }

  analyse() {
    const L = this.bufLen;
    this.frameBuf.set(this.buf.subarray(L - this.size));
    const r = this.mpm.detect(this.frameBuf, this.minFreq, this.maxFreq);
    // short-window level centred on the frame time: sharper for bow-change dips
    // Pitch-synchronous: a whole number of periods (≥ ~5 ms) so the level does not
    // ripple with the waveform; falls back to one period of the lowest note.
    let len;
    if (r.freq > 0 && r.clarity > 0.5) {
      const period = this.sr / r.freq;
      len = Math.round(period * Math.max(1, Math.ceil(256 / period)));
    } else len = Math.max(this.hop, Math.ceil(this.sr / this.minFreq));
    len = Math.min(this.size, len);
    let e = 0;
    const c0 = Math.floor(this.size / 2 - len / 2);
    for (let i = c0; i < c0 + len; i++) e += this.frameBuf[i] * this.frameBuf[i];
    const frame = { t: (this.clock - this.size / 2) / this.sr, freq: r.freq, clarity: r.clarity, rms: r.rms, level: Math.sqrt(e / len) };
    if (this.peakFinder && this.filled >= 8192) {
      this.peakBuf.set(this.buf.subarray(L - 8192));
      frame.peaks = this.peakFinder.peaks(this.peakBuf, this.minFreq * 0.9, Math.min(this.sr / 2.2, this.maxFreq * 4));
    }
    return frame;
  }
}

/** Analyse a whole signal offline (tests, synthetic runs). */
export function analyseSignal(signal, sampleRate, { minFreq, maxFreq, hop = 512, peaks = false, startTime = 0 } = {}) {
  const fa = new FrameAnalyzer({ sampleRate, minFreq, maxFreq, hop, peaks });
  const out = [];
  const chunk = 2048;
  for (let i = 0; i < signal.length; i += chunk) {
    out.push(...fa.push(signal.subarray(i, i + chunk), i === 0 ? Math.round(startTime * sampleRate) : undefined));
  }
  return out;
}
