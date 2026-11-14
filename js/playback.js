// Plays the exercise to the student (a clean synthetic performance) and
// reports which note is sounding so the arrow can follow.
//
// The sound is rendered to a WAV and played through an <audio> element rather
// than Web Audio: iPhones treat media elements as "playback", so they are heard
// even with the ring/silent switch on (Web Audio is muted by that switch).

import { renderPerformance } from './audio/synth.js';
import { encodeWav } from './audio/wav.js';

const RATE = 44100;
// a tiny silent WAV, played inside the tap so later playback is allowed (iOS)
const SILENT = (() => {
  const { blob } = encodeWav(new Float32Array(441), RATE);
  return URL.createObjectURL(blob);
})();

export class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', '');
    this.url = null;
    this.timer = null;
    this.active = false;
  }

  get playing() { return this.active; }

  /** Call synchronously inside the tap, before anything is awaited. */
  prime() {
    try {
      this.audio.src = SILENT;
      const p = this.audio.play();
      if (p && p.catch) p.catch(() => {});
    } catch { /* ignore */ }
  }

  /**
   * @param {object} seq from buildSequence
   * @param {object} o { bpm, a4, instrument, onEvent(index), onEnd() }
   */
  async play(seq, { bpm = 60, a4 = 440, instrument = 'violin', onEvent, onEnd } = {}) {
    this.stop();
    this.active = true;
    const perf = renderPerformance(seq, {
      sampleRate: RATE, bpm, a4, detune: () => 0, noise: 0, leadIn: 0.25, tail: 0.6, amp: 0.2, dipFloor: 0.05, timbre: instrument,
    });
    if (!this.active) return; // stopped while rendering
    // normalise so it is clearly audible on a phone speaker
    let peak = 0;
    for (let i = 0; i < perf.signal.length; i++) peak = Math.max(peak, Math.abs(perf.signal[i]));
    if (peak > 0) { const g = 0.85 / peak; for (let i = 0; i < perf.signal.length; i++) perf.signal[i] *= g; }
    const { blob } = encodeWav(perf.signal, RATE);
    this.url = URL.createObjectURL(blob);
    const audio = this.audio;
    audio.onended = () => {
      if (!this.active) return;
      this.cleanup();
      if (onEnd) onEnd();
    };
    audio.src = this.url;
    try {
      await audio.play();
    } catch (e) {
      this.cleanup();
      throw new Error('the browser blocked sound – tap Play again');
    }
    let last = -1;
    // a plain timer (animation frames are paused in some hidden/background views)
    this.timer = setInterval(() => {
      if (!this.active) return;
      const t = audio.currentTime;
      let k = -1;
      for (let i = 0; i < perf.truth.length && perf.truth[i].onset <= t; i++) k = i;
      if (k !== last && k >= 0) { last = k; if (onEvent) onEvent(k); }
    }, 30);
  }

  cleanup() {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
  }

  stop() {
    const was = this.active;
    this.cleanup();
    if (was) { try { this.audio.onended = null; this.audio.pause(); } catch { /* ignore */ } }
  }
}
