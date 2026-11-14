// A single practice run: microphone → frames → notes → live follower,
// then alignment + scoring at the end.

import { Segmenter, estimateNoiseFloor, SEG } from './segmenter.js';
import { Follower } from './follower.js';
import { align } from './align.js';
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
  }

  async start() {
    const { engine, settings } = this.o;
    const { minFreq, maxFreq } = detectionRange(settings.instrument, this.a4);
    this.minFreq = minFreq; this.maxFreq = maxFreq;
    this.on.state('starting');
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
    this.on.state('calibrating');
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
      a4, noiseFloor: floor, vibrato: settings.vibrato, minFreq: this.minFreq, maxFreq: this.maxFreq, pitchless: this.doubleStop,
      repeats: this.o.seq.events.some((e) => e.sameAsPrev),
      onOnset: (n) => {
        this.anyNote = true;
        this.curMatch = this.follower.onset(n.nominal);
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
      this.t0 = this.metronome.start(settings.bpm, { onCountIn: (b) => this.on.state('countin', b) });
      this.segmenter.o.clickMask = clickMask(this.t0, 60 / settings.bpm, this.o.engine.windowSize / this.o.engine.ctx.sampleRate);
      setTimeout(() => { if (!this.stopped) this.on.state('listening'); }, Math.max(0, (this.t0 - this.o.engine.now()) * 1000));
    } else {
      this.on.state('listening');
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
    // automatic end
    if (this.segmenter.sounding) this.lastVoiced = f.t;
    const quietFor = this.lastVoiced != null ? f.t - this.lastVoiced : 0;
    if (this.anyNote && !this.segmenter.sounding) {
      if (this.follower.finished && quietFor >= RUN.endAfterLastSec) this.finish();
      else if (quietFor >= RUN.endAfterSilenceSec) this.finish();
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
    const span = settings.vibrato ? 0.2 : 0.035;
    this.smooth.push({ t: f.t, m });
    while (this.smooth.length && f.t - this.smooth[0].t > span) this.smooth.shift();
    const avg = this.smooth.reduce((a, x) => a + x.m, 0) / this.smooth.length;
    this.on.pitch({ midi: avg });
  }

  finish() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.metronome) this.metronome.stop();
    this.o.engine.stop();
    if (!this.segmenter) { this.on.done(null); return; }
    this.segmenter.flush();
    const notes = this.segmenter.notes;
    const { seq, prec } = this.o;
    const a4 = this.a4;
    const cost = this.doubleStop ? doubleStopCost(a4) : undefined;
    const alignment = align(notes, seq.events, cost);
    const result = scoreRun({
      expected: seq.events, detected: notes, alignment, prec,
      metronome: this.t0 != null ? { t0: this.t0, spb: 60 / this.o.settings.bpm } : null,
      doubleStopEval: this.doubleStop ? (n, e) => evaluateDoubleStop(n, e, a4) : null,
    });
    result.noiseFloor = this.noiseFloor;
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
  const segmenter = new Segmenter({ ...applied.segmenter, a4, noiseFloor, vibrato: s.vibrato, minFreq, maxFreq, pitchless: doubleStop, repeats: seq.events.some((e) => e.sameAsPrev),
    clickMask: metronomeT0 != null ? clickMask(metronomeT0, 60 / s.bpm, windowSizeFor(sampleRate, minFreq) / sampleRate) : undefined });
  for (const f of frames) segmenter.push(f); // same as live: calibration frames are analysed too
  segmenter.flush();
  const notes = segmenter.notes;
  const alignment = align(notes, seq.events, doubleStop ? doubleStopCost(a4) : undefined);
  const prec = precisionAt(s.precision);
  const result = scoreRun({
    expected: seq.events, detected: notes, alignment, prec,
    metronome: metronomeT0 != null ? { t0: metronomeT0, spb: 60 / s.bpm } : null,
    doubleStopEval: doubleStop ? (n, e) => evaluateDoubleStop(n, e, a4) : null,
  });
  const gate = segmenter.gate;
  return { exercise, seq, frames, notes, alignment, result, noiseFloor: segmenter.noiseFloor, gate, prec, minFreq, maxFreq };
}
