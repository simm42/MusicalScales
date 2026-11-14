// Synthetic string-like audio for tests and the ?debug=synth mode.
// No DOM access.

import { midiToFreq } from '../theory.js';
import { harmonicAmps, waveTable, timbreInfo } from './timbre.js';

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
    dipFloor = 0.15, clicks = null, vibratoAmDb = 0, timbre = null,
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
  const T = timbre ? timbreInfo(timbre) : null;
  const TAB = 2048;
  const nr2 = rng(seed + 2);
  let hp = 0, lpn = 0; // simple filters for bow noise
  for (let k = 0; k < truth.length; k++) {
    const tr = truth[k];
    if (tr.missing) continue;
    const next = truth[k + 1];
    const legatoNext = !!(next && next.slurred && !next.missing);
    const start = Math.round(tr.onset * sampleRate);
    const soundEnd = legatoNext ? next.onset : tr.end;
    const end = Math.round(soundEnd * sampleRate);
    const noteLen = (end - start) / sampleRate;
    const extra = extras.find((x) => x.after === tr.index);
    const extraFrom = extra ? Math.round((soundEnd - 0.2) * sampleRate) : Infinity;
    const attack = T ? T.attack : 0.025;
    const release = T ? 0.06 : 0.035;
    for (let v = 0; v < tr.midis.length; v++) {
      const baseF = midiToFreq(tr.midis[v] + tr.cents / 100, a4);
      const extraF = extra ? midiToFreq(extra.midi, a4) : 0;
      const tab = T ? waveTable(harmonicAmps(timbre, baseF, sampleRate), TAB) : null;
      if (!tr.slurred) phases[v] = 0;
      // instrument playback: gentle vibrato that starts after the note has settled
      const vDepth = T ? (noteLen > 0.35 ? T.vibrato : 0) : vibratoCents;
      for (let i = start; i < end && i < n; i++) {
        const tt = (i - start) / sampleRate;
        const isExtra = i >= extraFrom;
        const f0 = isExtra ? extraF : baseF;
        const vib = Math.sin(2 * Math.PI * vibratoRate * (i / sampleRate));
        const vAmt = T ? vDepth * Math.min(1, Math.max(0, (tt - 0.15) / 0.2)) : vDepth;
        const f = f0 * Math.pow(2, (vAmt * vib) / 1200);
        phases[v] += (2 * Math.PI * f) / sampleRate;
        // bow envelope: attack unless slurred; release before a bow change/rest
        let env = vibratoAmDb ? Math.pow(10, (vibratoAmDb * vib) / 20) : 1; // vibrato also swells the level
        if (!tr.slurred) env *= Math.min(1, dipFloor + tt / attack);
        const toEnd = (end - i) / sampleRate;
        if (!legatoNext) env *= Math.min(1, dipFloor + toEnd / release);
        if (isExtra) { const te = (i - extraFrom) / sampleRate; env *= Math.min(1, 0.15 + te / 0.02); }
        let s;
        if (tab) {
          let ph = phases[v] / (2 * Math.PI);
          ph -= Math.floor(ph);
          const x = ph * TAB;
          const i0 = x | 0;
          s = tab[i0] + (tab[i0 + 1] - tab[i0]) * (x - i0);
          // bow noise: a little at the start of each bow stroke and a trace throughout
          if (v === 0) {
            const w = gauss(nr2);
            hp = 0.95 * (hp + w - lpn); lpn = w;
            const burst = tr.slurred ? 0 : Math.exp(-tt / 0.04);
            s += hp * T.noise * (0.3 + 4 * burst);
          }
          s *= 1.3;
        } else {
          const nh = Math.max(1, Math.min(10, Math.floor((sampleRate * 0.45) / f)));
          s = 0;
          for (let h = 1; h <= nh; h++) s += Math.sin(h * phases[v]) / h;
        }
        out[i] += amp * env * s * 0.5;
      }
    }
  }
  // metronome clicks leaking into the microphone: short decaying tone bursts
  if (clicks) {
    const { start = leadIn, spb: cs = spb, amp: ca = 0.2, freq: cf = 1320 } = clicks;
    for (let ct = start; ct < total; ct += cs) {
      const i0 = Math.round(ct * sampleRate);
      for (let i = 0; i < 0.03 * sampleRate && i0 + i < n; i++) out[i0 + i] += ca * Math.exp(-i / (0.006 * sampleRate)) * Math.sin((2 * Math.PI * cf * i) / sampleRate);
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
