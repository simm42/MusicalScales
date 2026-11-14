// Turns analysis frames into note events using two onset detectors:
//  1. pitch change (slurred notes) and
//  2. re-articulation at the same pitch (bow changes, repeated quavers).
// No DOM access.

import { freqToMidi } from './theory.js';

export const SEG = {
  clarityMin: 0.85,
  gateOverFloor: 2.5,        // frame must be this many times louder (RMS) than the measured noise floor (~ +8 dB)
  absMinRms: 0.0012,
  noiseMaxClarity: 0.6,      // frames clearer than this are music, not background noise
  defaultNoiseFloor: 0.0005,
  maxNoiseFloor: 0.008,
  minNoteMs: 70,
  changeSemis: 0.6,          // distance from current note that counts as a new pitch
  changeSemisVibrato: 0.7,
  stableMs: 60,              // a new pitch must hold this long
  stableMsVibrato: 120,
  gapMs: 30,                 // this much silence ends a note
  // bow change = a quick level dip: falls by dipDb within dipWindowMs, then rises
  // by dipRecoverDb within dipWindowMs. Vibrato swells are slower than this.
  dipDb: 4.5,
  dipDbVibrato: 6,
  dipRecoverDb: 3,
  dipWindowMs: 70,
  trim: 0.15,                // fraction trimmed from each end of a note before measuring pitch
  unsteadyCents: 20,
};

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const quantile = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : NaN; };

/**
 * Background-noise level. Only noise-like frames (no clear pitch) count, so a
 * student who starts playing straight away – or a recording that is already
 * running – is not mistaken for background noise.
 */
export function estimateNoiseFloor(frames) {
  const noisy = frames.filter((f) => f.rms > 0 && !(f.clarity >= SEG.noiseMaxClarity && f.freq > 0)).map((f) => f.rms);
  if (noisy.length < 3) return SEG.defaultNoiseFloor;
  return Math.min(SEG.maxNoiseFloor, Math.max(0.0002, quantile(noisy, 0.3)));
}

export class Segmenter {
  /**
   * @param {object} o
   * @param {number} o.a4
   * @param {number} o.noiseFloor RMS of background noise
   * @param {boolean} o.vibrato
   * @param {number} o.minFreq @param {number} o.maxFreq
   * @param {boolean} [o.pitchless] segment by level only (double stops played together)
   * @param {(note)=>void} [o.onOnset] called once a new note is confirmed
   * @param {(note)=>void} [o.onNote] called when a note is complete
   */
  constructor(o) {
    this.o = o;
    this.cur = null;
    this.cand = null;
    this.silentSince = null;
    this.notes = [];
    this.lastT = 0;
    this.gate = Math.max(SEG.absMinRms, (o.noiseFloor || 0) * SEG.gateOverFloor);
    this.changeSemis = o.vibrato ? SEG.changeSemisVibrato : SEG.changeSemis;
    this.stable = (o.vibrato ? SEG.stableMsVibrato : SEG.stableMs) / 1000;
    this.dipDb = o.vibrato ? SEG.dipDbVibrato : SEG.dipDb;
  }

  isVoiced(f) {
    if (f.rms < this.gate) return false;
    if (this.o.pitchless) return true;
    return f.freq > 0 && f.clarity >= SEG.clarityMin && f.freq >= this.o.minFreq && f.freq <= this.o.maxFreq;
  }

  push(f) {
    this.lastT = f.t;
    const voiced = this.isVoiced(f);
    const db = 20 * Math.log10((f.level ?? f.rms) + 1e-9);
    if (!voiced) {
      if (this.cur) {
        if (this.silentSince == null) this.silentSince = f.t;
        if (f.t - this.silentSince >= SEG.gapMs / 1000) this.close(this.silentSince);
        else {
          // a brief unvoiced moment is usually a bow change: remember a completed dip
          const at = this.dipAt(this.cur, f.t, db);
          if (at != null) this.cur.pendingSplit = at;
        }
      }
      return;
    }
    this.silentSince = null;
    const fr = { t: f.t, midi: this.o.pitchless ? null : freqToMidi(f.freq, this.o.a4), db, peaks: f.peaks };
    if (!this.cur) { this.open(f.t, [fr]); return; }
    const cur = this.cur;

    // --- detector 2: re-articulation (quick level dip then recovery)
    let at = this.dipAt(cur, f.t, db);
    if (at == null && cur.pendingSplit != null) at = cur.pendingSplit;
    cur.pendingSplit = null;
    if (at != null && at - cur.onset >= SEG.minNoteMs / 1000) {
      const after = cur.frames.filter((x) => x.t >= at);
      cur.frames = cur.frames.filter((x) => x.t < at);
      this.close(at);
      this.open(at, [...after, fr]);
      return;
    }

    if (this.o.pitchless) { cur.frames.push(fr); this.maybeConfirm(f.t); return; }

    // --- detector 1: pitch change
    const nominal = cur.nominal();
    if (Math.abs(fr.midi - nominal) > this.changeSemis) {
      const semi = Math.round(fr.midi);
      if (this.cand && Math.abs(fr.midi - this.cand.semi) <= 0.5) this.cand.frames.push(fr);
      else {
        if (this.cand) cur.frames.push(...this.cand.frames);
        this.cand = { semi, startT: f.t, frames: [fr] };
      }
      if (f.t - this.cand.startT >= this.stable && this.cand.frames.length >= 3) {
        const c = this.cand;
        this.cand = null;
        this.close(c.startT);
        this.open(c.startT, c.frames);
      }
    } else {
      if (this.cand) { cur.frames.push(...this.cand.frames); this.cand = null; }
      cur.frames.push(fr);
    }
    this.maybeConfirm(f.t);
  }

  /** Record the level; returns the time of a completed bow-change dip, or null. */
  dipAt(cur, t, db) {
    const W = SEG.dipWindowMs / 1000;
    const h = cur.levels;
    h.push({ t, db });
    while (h.length && t - h[0].t > 2 * W + 0.02) h.shift();
    // lowest point within the last window (not the newest frame)
    let mi = -1;
    for (let k = h.length - 2; k >= 0 && t - h[k].t <= W; k--) if (mi < 0 || h[k].db < h[mi].db) mi = k;
    if (mi < 0 || db - h[mi].db < SEG.dipRecoverDb) return null;
    let pre = -Infinity;
    for (let k = mi - 1; k >= 0 && h[mi].t - h[k].t <= W; k--) pre = Math.max(pre, h[k].db);
    if (pre - h[mi].db < this.dipDb) return null;
    const minT = h[mi].t;
    cur.levels = [{ t, db }];
    return minT;
  }

  open(t, frames) {
    const self = this;
    this.cur = {
      onset: t,
      frames,
      levels: frames.map((x) => ({ t: x.t, db: x.db })),
      confirmed: false,
      nominal() {
        if (this._nom != null && this.frames.length >= 6) return this._nom;
        const ms = this.frames.slice(0, 6).map((x) => x.midi);
        this._nom = Math.round(median(ms));
        return this._nom;
      },
    };
    this.cand = null;
    void self;
  }

  maybeConfirm(t) {
    const cur = this.cur;
    if (!cur || cur.confirmed) return;
    if (t - cur.onset >= Math.max(SEG.minNoteMs / 1000, this.stable) && cur.frames.length >= 3) {
      cur.confirmed = true;
      if (this.o.onOnset) this.o.onOnset({ onset: cur.onset, nominal: this.o.pitchless ? null : cur.nominal() });
    }
  }

  close(end) {
    const cur = this.cur;
    this.cur = null;
    if (this.cand) { cur.frames.push(...this.cand.frames); this.cand = null; }
    if (!cur) return;
    const dur = end - cur.onset;
    if (dur < SEG.minNoteMs / 1000 || cur.frames.length < 3) return;
    const lo = cur.onset + SEG.trim * dur, hi = end - SEG.trim * dur;
    let mid = cur.frames.filter((x) => x.t >= lo && x.t <= hi);
    if (mid.length < 2) mid = cur.frames;
    const note = { onset: cur.onset, end, dur, frames: cur.frames.length, confirmed: cur.confirmed };
    if (!this.o.pitchless) {
      const ms = mid.map((x) => x.midi);
      // vibrato: mean over the middle (whole cycles on average); otherwise the median
      note.midi = this.o.vibrato ? ms.reduce((a, b) => a + b, 0) / ms.length : median(ms);
      note.nominal = Math.round(note.midi);
      const spread = (quantile(ms, 0.9) - quantile(ms, 0.1)) * 50; // half the 10–90 % range, in cents
      note.wobble = spread;
      note.unsteady = !this.o.vibrato && spread > SEG.unsteadyCents;
    } else {
      note.peakFrames = mid.map((x) => x.peaks).filter(Boolean);
    }
    this.notes.push(note);
    if (this.o.onNote) this.o.onNote(note);
  }

  /** End of input: close any sounding note. */
  flush(t) { if (this.cur) this.close(t ?? this.lastT); }

  get sounding() { return !!this.cur; }
}

/** Convenience for tests: segment a list of frames. */
export function segmentFrames(frames, o) {
  const floorFrames = frames.filter((f) => f.t < (o.calibrateUntil ?? 0.8));
  const seg = new Segmenter({ ...o, noiseFloor: o.noiseFloor ?? estimateNoiseFloor(floorFrames) });
  for (const f of frames) seg.push(f);
  seg.flush();
  return seg.notes;
}
