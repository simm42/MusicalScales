// Stand-alone metronome on the Tuner page: tempo, beats per bar, tap tempo,
// and a flashing beat light. Uses the same tempo as the Practice page.

import { Metronome } from '../metronome.js';

export class MetronomeCard {
  constructor({ engine, getBpm, setBpm }) {
    this.engine = engine;
    this.getBpm = getBpm;
    this.setBpm = setBpm;
    this.el = {
      bpm: document.getElementById('mBpm'),
      slider: document.getElementById('mSlider'),
      beats: document.getElementById('mBeats'),
      start: document.getElementById('mStart'),
      tap: document.getElementById('mTap'),
      lights: document.getElementById('mLights'),
    };
    this.metro = null;
    this.taps = [];
    try { this.el.beats.value = localStorage.getItem('scales.metroBeats') || '4'; } catch { /* ignore */ }
    this.refresh();
    const changeBpm = (v) => {
      const bpm = Math.min(240, Math.max(30, Math.round(Number(v) || 60)));
      this.setBpm(bpm);
      this.refresh();
      if (this.running) this.restart();
    };
    this.el.bpm.addEventListener('change', () => changeBpm(this.el.bpm.value));
    this.el.slider.addEventListener('input', () => { this.el.bpm.value = this.el.slider.value; });
    this.el.slider.addEventListener('change', () => changeBpm(this.el.slider.value));
    this.el.beats.addEventListener('change', () => {
      try { localStorage.setItem('scales.metroBeats', this.el.beats.value); } catch { /* ignore */ }
      this.drawLights();
      if (this.running) this.restart();
    });
    this.el.start.addEventListener('click', () => (this.running ? this.stop() : this.start()));
    this.el.tap.addEventListener('click', () => this.tap());
    this.drawLights();
  }

  get running() { return !!(this.metro && this.metro.running); }
  get beats() { return Number(this.el.beats.value) || 4; }

  refresh() {
    const bpm = this.getBpm();
    this.el.bpm.value = bpm;
    this.el.slider.value = bpm;
  }

  drawLights() {
    this.el.lights.innerHTML = '';
    for (let k = 0; k < Math.max(1, this.beats); k++) {
      const d = document.createElement('span');
      d.className = 'm-light' + (k === 0 && this.beats > 1 ? ' accent' : '');
      this.el.lights.appendChild(d);
    }
  }

  async start() {
    // inside the tap (iOS), and keep a media session so the clicks are heard with the silent switch on
    this.engine.unlock('playback');
    this.engine.holdMediaSession(true);
    const ctx = await this.engine.ensureContext();
    if (!this.metro || this.metro.ctx !== ctx) this.metro = new Metronome(ctx);
    this.restart();
    this.el.start.textContent = '■ Stop';
    this.el.start.classList.add('primary');
  }

  restart() {
    const lights = this.el.lights.children;
    this.metro.start(this.getBpm(), {
      countIn: 0,
      beatsPerBar: this.beats,
      onBeat: (k) => {
        for (const l of lights) l.classList.remove('on');
        const l = lights[k % lights.length];
        if (l) { l.classList.add('on'); setTimeout(() => l.classList.remove('on'), 120); }
      },
    });
  }

  stop() {
    if (this.metro) this.metro.stop();
    this.engine.holdMediaSession(false);
    this.el.start.textContent = '▶ Start metronome';
    this.el.start.classList.remove('primary');
  }

  tap() {
    const now = performance.now();
    this.taps = this.taps.filter((t) => now - t < 3000);
    this.taps.push(now);
    if (this.taps.length >= 3) {
      const gaps = this.taps.slice(1).map((t, k) => t - this.taps[k]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const bpm = Math.min(240, Math.max(30, Math.round(60000 / avg)));
      this.setBpm(bpm);
      this.refresh();
      if (this.running) this.restart();
    }
  }
}
