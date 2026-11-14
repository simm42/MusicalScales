// Plays the exercise to the student (a clean synthetic performance) and
// reports which note is sounding so the arrow can follow.

import { renderPerformance, toAudioBuffer } from './audio/synth.js';

export class Player {
  constructor(engine) {
    this.engine = engine;
    this.src = null;
    this.raf = null;
  }

  get playing() { return !!this.src; }

  /**
   * @param {object} seq from buildSequence
   * @param {object} o { bpm, a4, onEvent(index), onEnd() }
   */
  async play(seq, { bpm = 60, a4 = 440, instrument = 'violin', onEvent, onEnd } = {}) {
    this.stop();
    const ctx = await this.engine.ensureContext();
    const perf = renderPerformance(seq, {
      sampleRate: ctx.sampleRate, bpm, a4, detune: () => 0, noise: 0, leadIn: 0.25, tail: 0.6, amp: 0.2, dipFloor: 0.05, timbre: instrument,
    });
    const src = ctx.createBufferSource();
    src.buffer = toAudioBuffer(ctx, perf.signal, ctx.sampleRate);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.value = 0.8;
    src.connect(lp).connect(g).connect(ctx.destination);
    const t0 = ctx.currentTime + 0.05;
    src.start(t0);
    this.src = src;
    let last = -1;
    const tick = () => {
      if (this.src !== src) return;
      const t = ctx.currentTime - t0;
      let k = -1;
      for (let i = 0; i < perf.truth.length && perf.truth[i].onset <= t; i++) k = i;
      if (k !== last && k >= 0) { last = k; if (onEvent) onEvent(k); }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    src.onended = () => {
      if (this.src !== src) return;
      this.cleanup();
      if (onEnd) onEnd();
    };
  }

  cleanup() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.src = null;
  }

  stop() {
    const s = this.src;
    this.cleanup();
    if (s) { try { s.onended = null; s.stop(); } catch { /* already stopped */ } }
  }
}
