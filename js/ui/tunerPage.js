// Tuner page: open strings, automatic string detection, reference tones and
// a choice of equal temperament or pure fifths/fourths.

import { INSTRUMENTS, instrumentInfo, detectionRange } from '../instruments.js';
import { midiOf, midiToFreq, freqToMidi, noteName, spellMidi } from '../theory.js';
import { Meter, fmtCents } from './meter.js';
import { MicError } from '../audio/mic.js';
import { periodicWave } from '../audio/timbre.js';

export const TUNER = { fullCents: 5, zeroCents: 30, holdSec: 0.8, smoothSec: 0.15, clarityMin: 0.88, gate: 0.003 };

/** Target sounding frequency of each open string. */
export function stringTargets(instId, system, a4 = 440) {
  const info = instrumentInfo(instId);
  const sounding = info.stringNotes.map((n) => midiOf(n) + info.transpose);
  const et = sounding.map((m) => midiToFreq(m, a4));
  if (system === 'equal') return et;
  if (system === 'fifths') {
    const iA = info.stringNotes.findIndex((n) => n.l === 5 && n.a === 0); // the A string
    return sounding.map((_, i) => et[iA] * Math.pow(3 / 2, i - iA));
  }
  if (system === 'fourths') {
    const iG = info.stringNotes.findIndex((n) => n.l === 4 && n.a === 0); // the G string
    return sounding.map((_, i) => et[iG] * Math.pow(4 / 3, i - iG));
  }
  return et;
}

export function systemsFor(instId) {
  const sys = INSTRUMENTS[instId].tuningSystem;
  if (!sys) return [['equal', 'Equal temperament']];
  return [['equal', 'Equal temperament'], sys === 'fourths' ? ['fourths', 'Pure fourths from G'] : ['fifths', 'Pure fifths from A']];
}

export class TunerPage {
  constructor({ engine, getA4, setA4, getInstrument, setInstrument, beforeStart }) {
    this.beforeStart = beforeStart;
    this.engine = engine;
    this.getA4 = getA4; this.setA4 = setA4;
    this.getInstrument = getInstrument; this.setInstrument = setInstrument;
    this.el = {
      inst: document.getElementById('t-instrument'),
      sys: document.getElementById('t-system'),
      a4: document.getElementById('t-a4'),
      strings: document.getElementById('tStrings'),
      start: document.getElementById('tStartBtn'),
      status: document.getElementById('tStatus'),
      error: document.getElementById('tError'),
    };
    this.meter = new Meter(document.getElementById('tMeter'));
    this.running = false;
    this.locked = null;
    this.system = 'equal';
    this.tones = new Map();
    this.smooth = [];
    this.inTuneSince = null;
    for (const id of Object.keys(INSTRUMENTS)) this.el.inst.add(new Option(instrumentInfo(id).name, id));
    this.el.inst.addEventListener('change', () => { this.setInstrument(this.el.inst.value); this.refresh(true); });
    this.el.sys.addEventListener('change', () => { this.system = this.el.sys.value; this.refresh(false); });
    this.el.a4.addEventListener('change', () => { this.setA4(this.el.a4.value); this.el.a4.value = this.getA4(); this.refresh(false); });
    this.el.start.addEventListener('click', () => (this.running ? this.stop() : this.start()));
    this.refresh(true);
  }

  refresh(instrumentChanged) {
    const inst = this.getInstrument();
    // the other instrument's name can change in Config
    [...this.el.inst.options].forEach((o) => { o.textContent = instrumentInfo(o.value).name; });
    this.el.inst.value = inst;
    this.el.a4.value = this.getA4();
    if (instrumentChanged) {
      this.el.sys.innerHTML = '';
      for (const [v, l] of systemsFor(inst)) this.el.sys.add(new Option(l, v));
      if (![...this.el.sys.options].some((o) => o.value === this.system)) this.system = 'equal';
      this.el.sys.value = this.system;
      this.locked = null;
      this.stopTones();
      if (this.running) this.start();
    }
    this.targets = stringTargets(inst, this.system, this.getA4());
    const info = instrumentInfo(inst);
    this.chromatic = !info.stringNotes.length;
    this.el.sys.closest('.field').hidden = this.chromatic;
    this.el.status.textContent = this.chromatic
      ? (info.family === 'voice' ? 'Sing a note – the nearest note is shown.' : `Play a note – the nearest note is shown${info.transpose ? ' as written for your instrument' : ''}.`)
      : 'Tap a string to lock onto it, or just play and the nearest string is chosen. 🔊 plays a reference note.';
    this.el.strings.innerHTML = '';
    this.stringEls = info.stringNotes.map((n, i) => {
      const d = document.createElement('div');
      d.className = 'string';
      const et = midiToFreq(midiOf(n) + info.transpose, this.getA4());
      const off = 1200 * Math.log2(this.targets[i] / et);
      d.innerHTML = `<span class="sn">${noteName(n)}</span><span class="small muted">${this.targets[i].toFixed(1)} Hz${Math.abs(off) > 0.05 ? ` (${off > 0 ? '+' : '−'}${Math.abs(off).toFixed(1)}¢)` : ''}</span>`;
      const play = document.createElement('button');
      play.className = 'play';
      play.type = 'button';
      play.textContent = '🔊';
      play.title = `Play ${noteName(n)} reference`;
      play.setAttribute('aria-pressed', this.tones.has(i) ? 'true' : 'false');
      play.addEventListener('click', (e) => { e.stopPropagation(); this.toggleTone(i, play); });
      d.appendChild(play);
      d.tabIndex = 0;
      d.title = 'Lock onto this string';
      const lock = () => { this.locked = this.locked === i ? null : i; this.markStrings(this.locked); };
      d.addEventListener('click', lock);
      d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lock(); } });
      this.el.strings.appendChild(d);
      return d;
    });
    this.markStrings(this.locked);
    this.meter.clear(this.running ? this.idleText() : '');
  }

  idleText() { return this.chromatic ? (this.getInstrument() === 'voice' ? 'Sing a note' : 'Play a note') : 'Play an open string'; }

  markStrings(near, tuned = null) {
    (this.stringEls || []).forEach((d, i) => {
      d.classList.toggle('near', i === near);
      d.classList.toggle('locked', i === this.locked);
      if (tuned != null && i === near) d.classList.toggle('tuned', tuned);
    });
  }

  async toggleTone(i, btn) {
    // inside the tap (iOS); keep the microphone's session if the tuner is listening
    this.engine.unlock(this.running ? null : 'playback');
    if (!this.tones.has(i)) this.engine.holdMediaSession(true); // heard even with the iPhone silent switch on
    const ctx = await this.engine.ensureContext();
    if (this.tones.has(i)) {
      const t = this.tones.get(i);
      t.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      t.osc.stop(ctx.currentTime + 0.3);
      this.tones.delete(i);
      this.engine.holdMediaSession(false);
      btn.setAttribute('aria-pressed', 'false');
      return;
    }
    // the instrument's own tone colour (open string, so no vibrato)
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(periodicWave(ctx, this.getInstrument(), this.targets[i]));
    osc.frequency.value = this.targets[i];
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.18, ctx.currentTime, 0.08);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    this.tones.set(i, { osc, g });
    btn.setAttribute('aria-pressed', 'true');
  }

  stopTones() {
    for (const { osc, g } of this.tones.values()) { try { g.gain.value = 0; osc.stop(); } catch { /* already stopped */ } this.engine.holdMediaSession(false); }
    this.tones.clear();
  }

  async start() {
    this.engine.unlock('play-and-record');
    if (this.beforeStart) this.beforeStart();
    this.el.error.hidden = true;
    const inst = this.getInstrument();
    // a voice whose range is not measured yet may be anywhere from bass to soprano
    const { minFreq, maxFreq } = inst === 'voice' ? { minFreq: 60, maxFreq: 1400 } : detectionRange(inst, this.getA4());
    try {
      this.el.start.disabled = true;
      this.starting = true;
      const ctx = await this.engine.start({ source: 'mic', minFreq, maxFreq, onFrames: (fs) => fs.forEach((f) => this.frame(f)) });
      if (!ctx) return; // stopped while starting
      this.running = true;
      this.el.start.textContent = 'Stop tuner';
      this.meter.clear(this.idleText());
    } catch (e) {
      this.el.error.textContent = e instanceof MicError ? e.message : 'Could not start: ' + e.message;
      this.el.error.hidden = false;
    } finally {
      this.starting = false;
      this.el.start.disabled = false;
    }
  }

  stop() {
    this.starting = false;
    this.engine.stop();
    this.running = false;
    this.el.start.textContent = 'Start tuner';
    this.meter.clear('');
    this.markStrings(this.locked);
  }

  deactivate() { if (this.running || this.starting) this.stop(); this.stopTones(); this.refresh(false); }

  frame(f) {
    if (!this.running) return;
    const voiced = f.rms > TUNER.gate && f.freq > 0 && f.clarity >= TUNER.clarityMin;
    if (!voiced) { this.smooth = []; this.inTuneSince = null; this.meter.clear(this.idleText()); this.markStrings(null); return; }
    this.smooth.push({ t: f.t, m: freqToMidi(f.freq, 440) });
    while (this.smooth.length && f.t - this.smooth[0].t > TUNER.smoothSec) this.smooth.shift();
    const m = this.smooth.reduce((a, x) => a + x.m, 0) / this.smooth.length;
    const freq = 440 * Math.pow(2, (m - 69) / 12);
    if (this.chromatic) { this.chromaticFrame(f, freq); return; }
    let idx = this.locked;
    if (idx == null) {
      let best = Infinity;
      this.targets.forEach((tf, i) => { const d = Math.abs(1200 * Math.log2(freq / tf)); if (d < best) { best = d; idx = i; } });
    }
    const cents = 1200 * Math.log2(freq / this.targets[idx]);
    const prec = { fullCents: TUNER.fullCents, zeroCents: TUNER.zeroCents };
    const shown = Math.abs(cents) > 300 ? null : cents;
    this.meter.setBar(0, shown, prec);
    const inst = instrumentInfo(this.getInstrument());
    const ok = shown != null && Math.abs(cents) <= TUNER.fullCents;
    if (ok) { if (this.inTuneSince == null) this.inTuneSince = f.t; } else this.inTuneSince = null;
    const tuned = ok && f.t - this.inTuneSince >= TUNER.holdSec;
    this.meter.setReadout(noteName(inst.stringNotes[idx]), shown == null ? 'too far from this string' : fmtCents(cents), tuned ? 'In tune ✓' : cents > 0 ? 'sharp – loosen' : 'flat – tighten');
    this.markStrings(idx, tuned);
  }

  /** Voice / other instrument: the nearest equal-tempered note (written pitch for transposing instruments). */
  chromaticFrame(f, freq) {
    const info = instrumentInfo(this.getInstrument());
    const a4 = this.getA4();
    const m = freqToMidi(freq, a4);
    const near = Math.round(m);
    const cents = (m - near) * 100;
    const prec = { fullCents: TUNER.fullCents, zeroCents: TUNER.zeroCents };
    this.meter.setBar(0, cents, prec);
    const ok = Math.abs(cents) <= TUNER.fullCents;
    if (ok) { if (this.inTuneSince == null) this.inTuneSince = f.t; } else this.inTuneSince = null;
    const tuned = ok && f.t - this.inTuneSince >= TUNER.holdSec;
    const written = near - (info.family === 'other' ? info.transpose : 0);
    const name = noteName(spellMidi(written, 'sharp'), { octave: true });
    this.meter.setReadout(name, fmtCents(cents), tuned ? 'In tune ✓' : cents > 0 ? 'sharp' : 'flat');
  }
}
