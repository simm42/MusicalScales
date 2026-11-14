// Turns analysis frames into note events using two onset detectors:
//  1. pitch change (slurred notes) and
//  2. re-articulation at the same pitch (bow changes, repeated quavers).
// No DOM access.

import { freqToMidi } from './theory.js';

export const SEG = {
  clarityMin: 0.85,          // clearly pitched frame
  // Less clear frames (weak fundamentals through small speakers/mics, room echo)
  // still count when their pitch is steady over a few frames or continues the note.
  clarityWeak: 0.45,
  weakRun: 6,
  weakSpread: 0.35,          // semitones
  gateOverFloor: 2,          // frame must be this many times louder (RMS) than the measured noise floor (+6 dB)
  absMinRms: 0.0012,
  noiseMaxClarity: 0.6,      // frames clearer than this are music, not background noise
  defaultNoiseFloor: 0.0005,
  maxNoiseFloor: 0.008,
  startupSkipSec: 0.5,       // microphones click or thump as they switch on
  noiseWindowFrames: 300,    // ~3 s of background noise kept for the running estimate
  minNoteMs: 70,
  changeSemis: 0.6,          // distance from current note that counts as a new pitch
  changeSemisVibrato: 0.7,
  stableMs: 60,              // a new pitch must hold this long
  stableMsVibrato: 120,
  gapMs: 30,                 // this much silence ends a note
  holdDropDb: 6,             // unclear frames within this much of the note's level keep it going…
  holdMaxMs: 400,            // …for at most this long
  // bow change = a quick level dip: falls by dipDb within dipWindowMs, then rises
  // by dipRecoverDb within dipWindowMs. Vibrato swells are slower than this.
  dipDb: 4.5,
  dipDbVibrato: 6,
  dipRecoverDb: 3,
  dipDbRough: 3,             // …or this much when the pitch clarity drops at the same moment
  dipDbRoughVibrato: 5,
  dipRoughness: 0.08,        // clarity drop that counts as "rough"
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
  // skip the first moment: microphones often click or thump as they switch on
  const t0 = frames.length ? frames[0].t : 0;
  const noisy = frames.filter((f) => f.t - t0 >= SEG.startupSkipSec && f.rms > 0 && !(f.clarity >= SEG.noiseMaxClarity && f.freq > 0)).map((f) => f.rms);
  if (noisy.length < 3) return SEG.defaultNoiseFloor;
  return Math.min(SEG.maxNoiseFloor, Math.max(0.0002, quantile(noisy, 0.2)));
}

export class Segmenter {
  /**
   * @param {object} o
   * @param {number} o.a4
   * @param {number} o.noiseFloor RMS of background noise
   * @param {number} [o.clarityMin] / [o.clarityWeak] / [o.maxGate] overrides from microphone calibration
   * @param {boolean} o.vibrato
   * @param {number} o.minFreq @param {number} o.maxFreq
   * @param {boolean} [o.pitchless] segment by level only (double stops played together)
   * @param {(t:number)=>boolean} [o.clickMask] true while a metronome click may be in the analysis
   *   window: such frames cannot start a note or a pitch change
   * @param {number[]} [o.repeatPitches] sounding MIDI pitches that are played twice in a row in this
   *   exercise; a loudness dip only splits a note at one of these pitches (when given)
   * @param {boolean} [o.repeats=true] the music has the same pitch twice in a row, so a bow-change
   *   dip must split a note. When false, level dips are ignored (room echo makes the level wobble).
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
    this.noiseFloor = o.noiseFloor || SEG.defaultNoiseFloor;
    this.clarityMin = o.clarityMin ?? SEG.clarityMin;
    this.clarityWeak = Math.min(this.clarityMin, o.clarityWeak ?? SEG.clarityWeak);
    this.updateGate();
    this.noiseHist = [];
    this.changeSemis = o.vibrato ? SEG.changeSemisVibrato : SEG.changeSemis;
    this.stable = (o.vibrato ? SEG.stableMsVibrato : SEG.stableMs) / 1000;
    this.dipDb = o.vibrato ? SEG.dipDbVibrato : SEG.dipDb;
    this.useDips = o.pitchless || o.repeats !== false;
    this.repeatPitches = !o.pitchless && o.repeatPitches ? new Set(o.repeatPitches) : null;
    this.dipDbRough = o.vibrato ? SEG.dipDbRoughVibrato : SEG.dipDbRough;
    this.recent = [];
    this.backdate = null;
  }

  isVoiced(f) {
    this.backdate = null;
    this.masked = false;
    if (f.rms < this.gate) { this.recent = []; return false; }
    if (this.o.clickMask && this.o.clickMask(f.t)) {
      this.recent = [];
      this.masked = true; // a click: neither starts a note nor ends one
      return false;
    }
    if (this.o.pitchless) return true;
    if (!(f.freq > 0) || f.freq < this.o.minFreq || f.freq > this.o.maxFreq || f.clarity < this.clarityWeak) { this.recent = []; return false; }
    if (f.clarity >= this.clarityMin) { this.recent = []; return true; }
    const m = freqToMidi(f.freq, this.o.a4);
    // continues the sounding note, or the new pitch it is changing to
    if (this.cur) {
      if (Math.abs(m - this.cur.nominal()) <= this.changeSemis) return true;
      if (this.cand && Math.abs(m - this.cand.semi) <= 0.5) return true;
    }
    // a steady pitch over several frames is music, even if not very clear
    this.recent.push({ t: f.t, m });
    if (this.recent.length > SEG.weakRun) this.recent.shift();
    const steady = this.recent.length >= SEG.weakRun && this.recent.every((x) => Math.abs(x.m - m) <= SEG.weakSpread);
    if (steady) this.backdate = this.recent[0].t;
    return steady;
  }

  updateGate() {
    let g = Math.max(SEG.absMinRms, this.noiseFloor * SEG.gateOverFloor);
    if (this.o.maxGate) g = Math.min(g, Math.max(SEG.absMinRms, this.o.maxGate)); // never above the instrument's own level
    this.gate = g;
  }

  /**
   * Keep measuring the background noise whenever nothing is being played, so a
   * student can start in their own time and the estimate only gets better.
   */
  trackNoise(f) {
    if (this.cur || (f.freq > 0 && f.clarity >= SEG.noiseMaxClarity) || !(f.rms > 0)) return;
    this.noiseHist.push(f.rms);
    if (this.noiseHist.length > SEG.noiseWindowFrames) this.noiseHist.shift();
    if (this.noiseHist.length >= 20 && this.noiseHist.length % 10 === 0) {
      this.noiseFloor = Math.min(SEG.maxNoiseFloor, Math.max(0.0002, quantile(this.noiseHist, 0.2)));
      this.updateGate();
    }
  }

  push(f) {
    this.lastT = f.t;
    this.trackNoise(f);
    const voiced = this.isVoiced(f);
    const db = 20 * Math.log10((f.level ?? f.rms) + 1e-9);
    if (!voiced) {
      if (this.masked) return;
      if (this.cur) {
        // pitch briefly unclear but the sound carries on at much the same level
        // (room echo, distance, a weak fundamental): the note is still sounding
        const recent = this.cur.levels.slice(-10).reduce((a, x) => Math.max(a, x.db), -Infinity);
        if (f.rms >= this.gate && db > recent - SEG.holdDropDb && f.t - (this.cur.lastVoiced ?? f.t) < SEG.holdMaxMs / 1000) {
          const at = this.dipAt(this.cur, f.t, db, f.clarity);
          if (at != null) this.cur.pendingSplit = at;
          return;
        }
        if (this.silentSince == null) this.silentSince = f.t;
        if (f.t - this.silentSince >= SEG.gapMs / 1000) this.close(this.silentSince);
        else {
          // a brief unvoiced moment is usually a bow change: remember a completed dip
          const at = this.dipAt(this.cur, f.t, db, f.clarity);
          if (at != null) this.cur.pendingSplit = at;
        }
      }
      return;
    }
    this.silentSince = null;
    if (this.cur) this.cur.lastVoiced = f.t;
    const fr = { t: f.t, midi: this.o.pitchless ? null : freqToMidi(f.freq, this.o.a4), db, peaks: f.peaks };
    if (!this.cur) { this.open(this.backdate ?? f.t, [fr]); return; }
    const cur = this.cur;

    // --- detector 2: re-articulation (quick level dip then recovery)
    let at = this.dipAt(cur, f.t, db, f.clarity);
    if (at == null && cur.pendingSplit != null) at = cur.pendingSplit;
    cur.pendingSplit = null;
    if (!this.useDips) at = null;
    // only where the music really repeats a pitch (room echo makes the level wobble elsewhere)
    if (at != null && this.repeatPitches && !this.repeatPitches.has(cur.nominal())) at = null;
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
  dipAt(cur, t, db, c = 1) {
    const W = SEG.dipWindowMs / 1000;
    const h = cur.levels;
    h.push({ t, db, c });
    while (h.length && t - h[0].t > 2 * W + 0.02) h.shift();
    // lowest point within the last window (not the newest frame)
    let mi = -1;
    for (let k = h.length - 2; k >= 0 && t - h[k].t <= W; k--) if (mi < 0 || h[k].db < h[mi].db) mi = k;
    if (mi < 0 || db - h[mi].db < SEG.dipRecoverDb) return null;
    let pre = -Infinity, preC = 0;
    for (let k = mi - 1; k >= 0 && h[mi].t - h[k].t <= W; k--) { pre = Math.max(pre, h[k].db); preC = Math.max(preC, h[k].c ?? 1); }
    // a bow change also roughens the tone briefly: with a clarity drop, a shallower dip is enough
    let dipC = 1;
    for (let k = Math.max(0, mi - 2); k <= Math.min(h.length - 1, mi + 2); k++) dipC = Math.min(dipC, h[k].c ?? 1);
    // …but not after a short loud spike (a metronome click), which also lowers clarity
    const typical = median(h.map((x) => x.db));
    const spike = pre - typical > 2;
    const need = !spike && preC - dipC >= SEG.dipRoughness ? Math.min(this.dipDb, this.dipDbRough) : this.dipDb;
    if (pre - h[mi].db < need) return null;
    const minT = h[mi].t;
    cur.levels = [{ t, db, c }];
    return minT;
  }

  open(t, frames) {
    const self = this;
    this.cur = {
      onset: t,
      frames,
      levels: frames.map((x) => ({ t: x.t, db: x.db, c: 1 })),
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
    // level trace, used later to find a soft re-articulation inside a merged repeated note
    if (!this.o.pitchless) note.levels = cur.frames.map((x) => [x.t, x.db]);
    if (!this.o.pitchless) {
      const ms = mid.map((x) => x.midi);
      // vibrato: mean over the middle (whole cycles on average); otherwise the median
      // vibrato: mean over the middle (whole cycles on average), ignoring stray frames
      // far from the note's centre; otherwise the median
      const med = median(ms);
      const core = ms.filter((x) => Math.abs(x - med) <= 0.8);
      note.midi = this.o.vibrato && core.length ? core.reduce((a, b) => a + b, 0) / core.length : med;
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
