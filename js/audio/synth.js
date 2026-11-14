// Synthetic string-like audio for tests and the ?debug=synth mode.
// No DOM access.

import { midiToFreq } from '../theory.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); };
}
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

/** A steady harmonic-rich tone. */
export function tone(freq, seconds, sampleRate, { harmonics = 10, vibratoCents = 0, vibratoRate = 5.5, noise = 0, amp = 0.3, weakFundamental = false, seed = 1 } = {}) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const r = rng(seed);
  const nh = Math.max(1, Math.min(harmonics, Math.floor((sampleRate * 0.45) / freq)));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f = freq * Math.pow(2, (vibratoCents * Math.sin(2 * Math.PI * vibratoRate * t)) / 1200);
    phase += (2 * Math.PI * f) / sampleRate;
    let v = 0;
    for (let k = 1; k <= nh; k++) v += (k === 1 && weakFundamental ? 0.15 : 1) * Math.sin(k * phase) / k;
    out[i] = amp * v * 0.5 + (noise ? noise * gauss(r) : 0);
  }
  return out;
}

/**
 * Render a performance of a practice sequence.
 * @param {object} seq from buildSequence()
 * @param {object} o options
 * @returns {{signal: Float32Array, truth: object[], leadIn: number}}
 */
export function renderPerformance(seq, o = {}) {
  const {
    sampleRate = 48000, bpm = 80, a4 = 440, detuneSd = 0, detune = null, jitter = 0, vibratoCents = 0,
    vibratoRate = 5.5, missing = [], extras = [], noise = 0.002, leadIn = 1.2, tail = 2.0, seed = 7, amp = 0.25,
  } = o;
  const r = rng(seed);
  const spb = 60 / bpm;
  const events = seq.events;
  // onset times with jitter
  const truth = [];
  let t = leadIn;
  for (const e of events) {
    const g = seq.glyphs[e.glyphIndex];
    const dur = e.beats * spb * (1 + jitter * gauss(r));
    const cents = detune ? detune(e.index) : detuneSd * gauss(r);
    truth.push({ index: e.index, onset: t, end: t + Math.max(0.08, g.beats * spb * (dur / (e.beats * spb))), dur, midis: e.midis, cents, slurred: e.slurred, missing: missing.includes(e.index) });
    t += dur;
  }
  const total = t + tail;
  const n = Math.round(total * sampleRate);
  const out = new Float32Array(n);
  const nr = rng(seed + 1);
  for (let i = 0; i < n; i++) out[i] = noise * gauss(nr);

  const phases = [0, 0];
  for (let k = 0; k < truth.length; k++) {
    const tr = truth[k];
    if (tr.missing) continue;
    const next = truth[k + 1];
    const legatoNext = !!(next && next.slurred && !next.missing);
    const start = Math.round(tr.onset * sampleRate);
    const soundEnd = legatoNext ? next.onset : tr.end;
    const end = Math.round(soundEnd * sampleRate);
    const extra = extras.find((x) => x.after === tr.index);
    const extraFrom = extra ? Math.round((soundEnd - 0.2) * sampleRate) : Infinity;
    for (let v = 0; v < tr.midis.length; v++) {
      const baseF = midiToFreq(tr.midis[v] + tr.cents / 100, a4);
      const extraF = extra ? midiToFreq(extra.midi, a4) : 0;
      if (!tr.slurred) phases[v] = 0;
      for (let i = start; i < end && i < n; i++) {
        const tt = (i - start) / sampleRate;
        const isExtra = i >= extraFrom;
        const f0 = isExtra ? extraF : baseF;
        const f = f0 * Math.pow(2, (vibratoCents * Math.sin(2 * Math.PI * vibratoRate * (i / sampleRate))) / 1200);
        phases[v] += (2 * Math.PI * f) / sampleRate;
        // bow envelope: attack 25 ms unless slurred; release 35 ms before a bow change/rest
        let env = 1;
        if (!tr.slurred) env = Math.min(1, tt / 0.025);
        const toEnd = (end - i) / sampleRate;
        if (!legatoNext) env *= Math.min(1, 0.15 + toEnd / 0.035);
        if (isExtra) { const te = (i - extraFrom) / sampleRate; env *= Math.min(1, 0.15 + te / 0.02); }
        const nh = Math.max(1, Math.min(10, Math.floor((sampleRate * 0.45) / f)));
        let s = 0;
        for (let h = 1; h <= nh; h++) s += Math.sin(h * phases[v]) / h;
        out[i] += amp * env * s * 0.5;
      }
    }
  }
  return { signal: out, truth, leadIn, total };
}

/** Wrap a Float32Array in an AudioBuffer for the engine. */
export function toAudioBuffer(ctx, signal, sampleRate) {
  const buf = ctx.createBuffer(1, signal.length, sampleRate);
  buf.copyToChannel(signal, 0);
  return buf;
}
