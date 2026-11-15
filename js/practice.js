// A single practice run: microphone → frames → notes → live follower,
// then alignment + scoring at the end.

import { Segmenter, estimateNoiseFloor, SEG } from './segmenter.js';
import { Follower } from './follower.js';
import { align, detectGlobalOffset } from './align.js';
import { scoreRun } from './scoring.js';
import { Metronome } from './metronome.js';
import { detectionRange } from './instruments.js';
import { freqToMidi } from './theory.js';
import { evaluateDoubleStop, liveDoubleStop, doubleStopCost } from './doublestop.js';
import { renderPerformance, toAudioBuffer } from './audio/synth.js';
import { analyseSignal, windowSizeFor } from './pitch.js';
import { buildExercise } from './exercises.js';
import { buildSequence } from './sequence.js';
import { precisionAt } from './precision.js';
import { applyCalibration } from './calibration.js';

/**
 * Frames whose analysis window may contain a metronome click (clicks fall on
 * every beat from the count-in onwards).
 */
export function clickMask(t0, spb, windowSec = 0.085) {
  const margin = (windowSec || 0.085) / 2 + 0.03;
  return (t) => {
    const d = (((t - t0) % spb) + spb) % spb;
    return d <= margin || spb - d <= margin;
  };
}

/** The exercise's shortest note at the set tempo, in seconds. */
export function shortestNoteSec(seq, bpm) {
  const beats = Math.min(...seq.events.map((e) => e.beats).filter((b) => b > 0));
  return isFinite(beats) ? (beats * 60) / bpm : null;
}

/** Pitches the exercise plays twice in a row (sounding MIDI). */
export function repeatPitches(seq) {
  return [...new Set(seq.events.filter((e) => e.sameAsPrev).map((e) => e.midis[0]))];
}

/**
 * As one note hands over to the next, the detector can briefly hear a note an
 * octave out (a weak fundamental). Drop short notes that sit exactly one or two
 * octaves from a neighbouring note they touch.
 */
export function dropOctaveBlips(notes, { maxDur = 0.25, maxGap = 0.08 } = {}) {
  return notes.filter((d, i) => {
    if (d.midi == null || d.dur > maxDur) return true;
    for (const j of [i - 1, i + 1]) {
      const n = notes[j];
      if (!n || n.midi == null || n.dur <= d.dur) continue;
      const gap = j < i ? d.onset - n.end : n.onset - d.end;
      if (gap > maxGap) continue;
      for (const k of [12, -12, 24, -24]) if (Math.abs(d.midi + k - n.midi) <= 0.6) return false;
    }
    return true;
  });
}

/**
 * A repeated note played with a soft re-articulation (no sharp bow-change dip)
 * is heard as one long note and its repeat as "missing". Where the music
 * expects the same pitch twice and one is missing while its neighbour was heard
 * as a single over-long note, split that note at the deepest level dip near the
 * expected boundary. Without any dip the repeat stays missing.
 * @returns new notes array, or null if nothing changed
 */
export function splitMergedRepeats(notes, events, alignment, { minDipDb = 4 } = {}) {
  let changed = false;
  const out = notes.slice();
  const splitAt = new Map(); // note index -> { at, firstIsMatched }
  alignment.pairs.forEach((p) => {
    if (p.note != null) return;
    const e = events[p.event];
    const tryPartner = (k, partnerIsFirst) => {
      if (k < 0 || k >= events.length) return false;
      const partner = alignment.pairs[k];
      if (partner.note == null || splitAt.has(partner.note)) return false;
      const d = notes[partner.note];
      if (d.midi == null || Math.abs(d.midi - e.midis[0]) > 0.5 || !d.levels || d.levels.length < 10) return false;
      const first = partnerIsFirst ? events[k] : e;
      const second = partnerIsFirst ? e : events[k];
      const frac = first.beats / (first.beats + second.beats);
      const expected = d.onset + frac * d.dur;
      // search ±35 % of the shorter part around the expected boundary
      const span = 0.35 * Math.min(frac, 1 - frac) * d.dur;
      const inner = d.levels.filter(([t]) => t > d.onset + 0.1 * d.dur && t < d.end - 0.05 * d.dur);
      const win = inner.filter(([t]) => Math.abs(t - expected) <= span);
      if (win.length < 3) return false;
      let min = win[0];
      for (const x of win) if (x[1] < min[1]) min = x;
      const sorted = inner.map((x) => x[1]).sort((a, b) => a - b);
      const typical = sorted[Math.floor(sorted.length * 0.6)];
      if (typical - min[1] < minDipDb) return false;
      splitAt.set(partner.note, min[0]);
      return true;
    };
    // the missing event's same-pitch neighbour: before it, or after it
    if (e.sameAsPrev && tryPartner(p.event - 1, true)) changed = true;
    else if (events[p.event + 1] && events[p.event + 1].sameAsPrev && tryPartner(p.event + 1, false)) changed = true;
  });
  if (!changed) return null;
  const result = [];
  out.forEach((d, i) => {
    if (!splitAt.has(i)) { result.push(d); return; }
    const at = splitAt.get(i);
    result.push({ ...d, end: at, dur: at - d.onset, levels: d.levels.filter(([t]) => t < at), split: true });
    result.push({ ...d, onset: at, dur: d.end - at, levels: d.levels.filter(([t]) => t >= at), split: true });
  });
  return result;
}

export const RUN = {
  calibrateSec: 0.8,
  endAfterLastSec: 1.5,
  endAfterSilenceSec: 4,
};

export class PracticeSession {
  /**
   * @param {object} o
   * @param {import('./audio/mic.js').AudioEngine} o.engine
   * @param {object} o.exercise  @param {object} o.seq  @param {object} o.settings
   * @param {number} o.a4 @param {object} o.prec
   * @param {object|null} o.synth synthetic performance options (debug), or null for the microphone
   * @param {object|null} [o.calibration] microphone calibration for this instrument
   * @param {object} o.on callbacks: state, pitch, arrow, noteDone, done, error
   */
  constructor(o) {
    this.o = o;
    this.on = o.on;
    this.doubleStop = !!o.exercise.type.doubleStop;
    this.frames = [];
    this.calFrames = [];
    const applied = applyCalibration(o.calibration, o.a4);
    this.a4 = applied.a4;          // includes any pitch correction from calibration
    this.segOpts = applied.segmenter;
    this.segmenter = null;
    this.follower = new Follower(o.seq.events, { pitchless: this.doubleStop });
    this.metronome = null;
    this.t0 = null;
    this.startT = null;
    this.lastVoiced = null;
    this.lastNoteEnd = null;
    this.anyNote = false;
    this.curMatch = -1;
    this.smooth = [];
    this.stopped = false;
    // fault-finding log (included in test-mode downloads)
    this.log = { states: [], onsets: [], gates: [], endReason: null, clock: [] };
  }

  state(name, extra) {
    this.log.states.push({ t: +(this.o.engine.now() || 0).toFixed(3), s: name, extra: extra ?? null });
    this.on.state(name, extra);
  }

  clockMark(label) {
    this.log.clock.push({ label, audio: this.o.engine.now(), wall: performance.now() });
  }

  async start() {
    const { engine, settings } = this.o;
    const { minFreq, maxFreq } = detectionRange(settings.instrument, this.a4);
    this.minFreq = minFreq; this.maxFreq = maxFreq;
    this.state('starting');
    let buffer = null;
    if (this.o.synth) {
      const ctx = await engine.ensureContext();
      const perf = renderPerformance(this.o.seq, { sampleRate: ctx.sampleRate, a4: this.o.a4, ...this.o.synth });
      buffer = toAudioBuffer(ctx, perf.signal, ctx.sampleRate);
      this.truth = perf.truth;
    }
    await engine.start({
      source: buffer ? 'buffer' : 'mic', buffer, monitor: !!buffer && this.o.synth.monitor !== false, minFreq, maxFreq, peaks: this.doubleStop, capture: !!this.o.capture,
      onFrames: (frames) => frames.forEach((f) => this.frame(f)),
    });
    this.state('calibrating');
    this.clockMark('start');
    this.on.arrow(0);
  }

  beginListening() {
    const { settings } = this.o;
    const a4 = this.a4;
    const measured = estimateNoiseFloor(this.calFrames);
    // a calibrated room level is more reliable than the first second; take the lower
    const floor = this.segOpts.noiseFloor ? Math.min(this.segOpts.noiseFloor, measured) : measured;
    this.noiseFloor = floor;
    this.segmenter = new Segmenter({
      ...this.segOpts,
      a4, noiseFloor: floor, vibrato: settings.vibrato, voice: settings.instrument === 'voice', shortestNoteSec: shortestNoteSec(this.o.seq, settings.bpm), minFreq: this.minFreq, maxFreq: this.maxFreq, pitchless: this.doubleStop,
      repeats: this.o.seq.events.some((e) => e.sameAsPrev),
      repeatPitches: repeatPitches(this.o.seq),
      onOnset: (n) => {
        this.anyNote = true;
        this.curMatch = this.follower.onset(n.nominal);
        this.log.onsets.push({ t: +n.onset.toFixed(3), heard: n.nominal, matched: this.curMatch });
        this.on.arrow(this.follower.arrow);
      },
      onNote: (n) => {
        this.lastNoteEnd = n.end;
        const k = this.curMatch;
        this.curMatch = -1;
        this.follower.release();
        this.on.arrow(this.follower.arrow);
        if (k >= 0) {
          const e = this.o.seq.events[k];
          let cents;
          if (this.doubleStop) cents = evaluateDoubleStop(n, e, a4).cents;
          else cents = [(n.midi - e.midis[0]) * 100];
          this.on.noteDone(k, cents);
        }
      },
    });
    // a student (or recording) that started during the room check still counts
    for (const f of this.calFrames) this.segmenter.push(f);
    if (settings.metronome && this.o.engine.ctx) {
      this.metronome = new Metronome(this.o.engine.ctx);
      this.t0 = this.metronome.start(settings.bpm, { onCountIn: (b) => this.state('countin', b) });
      this.segmenter.o.clickMask = clickMask(this.t0, 60 / settings.bpm, this.o.engine.windowSize / this.o.engine.ctx.sampleRate);
      setTimeout(() => { if (!this.stopped) this.state('listening'); }, Math.max(0, (this.t0 - this.o.engine.now()) * 1000));
    } else {
      this.state('listening');
    }
  }

  frame(f) {
    if (this.stopped) return;
    if (this.startT == null) this.startT = f.t;
    this.frames.push(f);
    if (!this.segmenter) {
      this.calFrames.push(f);
      if (f.t - this.startT >= RUN.calibrateSec) this.beginListening();
      return;
    }
    this.segmenter.push(f);
    this.live(f);
    if (!this.lastGateLog || f.t - this.lastGateLog >= 0.5) {
      this.lastGateLog = f.t;
      this.log.gates.push({ t: +f.t.toFixed(2), floor: +this.segmenter.noiseFloor.toPrecision(3), gate: +this.segmenter.gate.toPrecision(3) });
    }
    // automatic end
    if (this.segmenter.sounding) this.lastVoiced = f.t;
    const quietFor = this.lastVoiced != null ? f.t - this.lastVoiced : 0;
    if (this.anyNote && !this.segmenter.sounding) {
      if (this.follower.finished && quietFor >= RUN.endAfterLastSec) this.finish('finished: last note played, then quiet');
      else if (quietFor >= RUN.endAfterSilenceSec) this.finish(`ended after ${RUN.endAfterSilenceSec} s of silence`);
    }
  }

  live(f) {
    const { settings } = this.o;
    const a4 = this.a4;
    const gate = this.segmenter.gate; // follows the running background-noise estimate
    if (this.doubleStop) {
      const ev = this.o.seq.events[this.follower.arrow];
      const pair = f.rms >= gate ? liveDoubleStop(f.peaks, ev, a4) : null;
      this.on.pitch(pair ? { pair, event: ev } : null);
      return;
    }
    const voiced = f.rms >= gate && f.freq > 0 && f.clarity >= 0.6 && f.freq >= this.minFreq && f.freq <= this.maxFreq;
    if (!voiced) { this.smooth = []; this.on.pitch(null); return; }
    let m = freqToMidi(f.freq, a4);
    // fold an octave error towards the expected note for display only
    const ev = this.o.seq.events[this.follower.arrow];
    if (ev) {
      const exp = ev.midis[0];
      const r = Math.round(m);
      if (Math.abs(r - exp) === 12) m += exp - r;
    }
    // smoothing: ~1 vibrato cycle with vibrato, a few frames without
    const span = settings.vibrato || settings.instrument === 'voice' ? 0.2 : 0.035;
    this.smooth.push({ t: f.t, m });
    while (this.smooth.length && f.t - this.smooth[0].t > span) this.smooth.shift();
    const avg = this.smooth.reduce((a, x) => a + x.m, 0) / this.smooth.length;
    this.on.pitch({ midi: avg });
  }

  finish(reason = 'Stop pressed') {
    if (this.stopped) return;
    this.stopped = true;
    this.log.endReason = reason;
    this.clockMark('end');
    if (this.metronome) this.metronome.stop();
    this.o.engine.stop();
    if (!this.segmenter) { this.on.done(null); return; }
    this.segmenter.flush();
    const notes = this.segmenter.notes;
    const { seq, prec } = this.o;
    const a4 = this.a4;
    const cost = this.doubleStop ? doubleStopCost(a4) : undefined;
    if (!this.doubleStop) { const kept = dropOctaveBlips(notes); notes.splice(0, notes.length, ...kept); }
    let alignment = align(notes, seq.events, cost);
    if (!this.doubleStop) {
      const fixed = splitMergedRepeats(notes, seq.events, alignment);
      if (fixed) { notes.splice(0, notes.length, ...fixed); alignment = align(notes, seq.events, cost); }
    }
    const result = scoreRun({
      expected: seq.events, detected: notes, alignment, prec,
      metronome: this.t0 != null ? { t0: this.t0, spb: 60 / this.o.settings.bpm } : null,
      doubleStopEval: this.doubleStop ? (n, e) => evaluateDoubleStop(n, e, a4) : null,
    });
    result.noiseFloor = this.noiseFloor;
    if (!this.doubleStop) result.globalOffset = detectGlobalOffset(notes, seq.events);
    this.on.done(result);
  }

  stop() { this.finish(); }

  abort() {
    this.stopped = true;
    if (this.metronome) this.metronome.stop();
    this.o.engine.stop();
  }
}

/**
 * Re-run the whole listening pipeline on a recording, exactly as a live run
 * would (same calibration, segmenter, alignment and scoring). Used by the
 * replay page to study recordings captured in test mode.
 * @param {object} o { samples, sampleRate, settings, a4, startTime, metronomeT0, calibration }
 */
export function analyseRecording(o) {
  const { samples, sampleRate, settings, startTime = 0, metronomeT0 = null, calibration: cal = null } = o;
  const applied = applyCalibration(cal, o.a4 ?? 440);
  const a4 = applied.a4;
  const exercise = buildExercise(settings);
  const seq = buildSequence(exercise);
  const s = exercise.settings;
  const doubleStop = !!exercise.type.doubleStop;
  const { minFreq, maxFreq } = detectionRange(s.instrument, a4);
  const frames = analyseSignal(samples, sampleRate, { minFreq, maxFreq, peaks: doubleStop, startTime });
  const t0 = frames.length ? frames[0].t : startTime;
  const measured = estimateNoiseFloor(frames.filter((f) => f.t - t0 < RUN.calibrateSec));
  const noiseFloor = applied.segmenter.noiseFloor ? Math.min(applied.segmenter.noiseFloor, measured) : measured;
  const segmenter = new Segmenter({ ...applied.segmenter, a4, noiseFloor, vibrato: s.vibrato, voice: s.instrument === 'voice', shortestNoteSec: shortestNoteSec(seq, s.bpm), minFreq, maxFreq, pitchless: doubleStop, repeats: seq.events.some((e) => e.sameAsPrev), repeatPitches: repeatPitches(seq),
    clickMask: metronomeT0 != null ? clickMask(metronomeT0, 60 / s.bpm, windowSizeFor(sampleRate, minFreq) / sampleRate) : undefined });
  for (const f of frames) segmenter.push(f); // same as live: calibration frames are analysed too
  segmenter.flush();
  const notes = segmenter.notes;
  if (!doubleStop) { const kept = dropOctaveBlips(notes); notes.splice(0, notes.length, ...kept); }
  let alignment = align(notes, seq.events, doubleStop ? doubleStopCost(a4) : undefined);
  if (!doubleStop) {
    const fixed = splitMergedRepeats(notes, seq.events, alignment);
    if (fixed) { notes.splice(0, notes.length, ...fixed); alignment = align(notes, seq.events); }
  }
  const prec = precisionAt(s.precision, s.instrument);
  const result = scoreRun({
    expected: seq.events, detected: notes, alignment, prec,
    metronome: metronomeT0 != null ? { t0: metronomeT0, spb: 60 / s.bpm } : null,
    doubleStopEval: doubleStop ? (n, e) => evaluateDoubleStop(n, e, a4) : null,
  });
  if (!doubleStop) result.globalOffset = detectGlobalOffset(notes, seq.events);
  const gate = segmenter.gate;
  return { exercise, seq, frames, notes, alignment, result, noiseFloor: segmenter.noiseFloor, gate, prec, minFreq, maxFreq };
}
