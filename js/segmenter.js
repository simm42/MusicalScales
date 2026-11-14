// Turns analysis frames into note events using two onset detectors:
//  1. pitch change (slurred notes) and
//  2. re-articulation at the same pitch (bow changes, repeated quavers).
// No DOM access.

import { freqToMidi } from './theory.js';

export const SEG = {
  clarityMin: 0.85,
  gateOverFloor: 3.2,        // frame must be this many times louder (RMS) than the measured noise floor (~ +10 dB)
  absMinRms: 0.0012,
  minNoteMs: 70,
  changeSemis: 0.6,          // distance from current note that counts as a new pitch
  changeSemisVibrato: 0.7,
  stableMs: 60,              // a new pitch must hold this long
  stableMsVibrato: 120,
  gapMs: 30,                 // this much silence ends a note
  dipDb: 6,                  // level dip (below recent peak) that marks a bow change
  dipRecoverDb: 4,
  dipMaxMs: 260,
  peakDecayDbPerS: 8,
  trim: 0.15,                // fraction trimmed from each end of a note before measuring pitch
  unsteadyCents: 20,
};

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const quantile = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : NaN; };

export function estimateNoiseFloor(frames) {
  const r = frames.map((f) => f.rms).filter((x) => x > 0);
  if (!r.length) return 0.0005;
  return Math.min(0.02, Math.max(0.0002, quantile(r, 0.3)));
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
  }

  isVoiced(f) {
    if (f.rms < this.gate) return false;
    if (this.o.pitchless) return true;
    return f.freq > 0 && f.clarity >= SEG.clarityMin && f.freq >= this.o.minFreq && f.freq <= this.o.maxFreq;
  }

  push(f) {
    const dt = this.lastT ? Math.max(0.001, f.t - this.lastT) : 0.01;
    this.lastT = f.t;
    const voiced = this.isVoiced(f);
    const db = 20 * Math.log10((f.level ?? f.rms) + 1e-9);
    if (!voiced) {
      if (this.cur) {
        if (this.silentSince == null) this.silentSince = f.t;
        if (f.t - this.silentSince >= SEG.gapMs / 1000) this.close(this.silentSince);
        else this.trackDip(this.cur, f.t, db, dt); // a brief unvoiced moment is usually a bow change
      }
      return;
    }
    this.silentSince = null;
    const fr = { t: f.t, midi: this.o.pitchless ? null : freqToMidi(f.freq, this.o.a4), db, peaks: f.peaks };
    if (!this.cur) { this.open(f.t, [fr]); return; }
    const cur = this.cur;

    // --- detector 2: re-articulation (level dip then recovery)
    this.trackDip(cur, f.t, db, dt);
    if (cur.dip) {
      if (fr.db > cur.dip.minDb + SEG.dipRecoverDb) {
        const quick = f.t - cur.dip.startT <= SEG.dipMaxMs / 1000;
        const at = cur.dip.minT;
        cur.dip = null;
        if (quick && at - cur.onset >= SEG.minNoteMs / 1000) {
          const after = cur.frames.filter((x) => x.t >= at);
          cur.frames = cur.frames.filter((x) => x.t < at);
          this.close(at);
          this.open(at, [...after, fr]);
          return;
        }
        cur.peakDb = fr.db;
      }
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

  trackDip(cur, t, db, dt) {
    cur.peakDb = Math.max(cur.peakDb - SEG.peakDecayDbPerS * dt, cur.dip ? -Infinity : db);
    if (!cur.dip && db < cur.peakDb - SEG.dipDb) cur.dip = { startT: t, minDb: db, minT: t };
    if (cur.dip && db < cur.dip.minDb) { cur.dip.minDb = db; cur.dip.minT = t; }
  }

  open(t, frames) {
    const self = this;
    this.cur = {
      onset: t,
      frames,
      peakDb: Math.max(...frames.map((x) => x.db)),
      dip: null,
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
