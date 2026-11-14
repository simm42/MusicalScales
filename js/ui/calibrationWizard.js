// "Calibrate the microphone": stay quiet, then bow each open string.

import { instrumentInfo, detectionRange } from '../instruments.js';
import { noteName, freqToMidi, midiOf } from '../theory.js';
import { MicError } from '../audio/mic.js';
import { CAL, measureNoise, measureString, summarise, saveCalibration, loadCalibration, describeCalibration } from '../calibration.js';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class CalibrationWizard {
  constructor({ engine, getInstrument, getA4, beforeStart, onChange }) {
    this.engine = engine;
    this.getInstrument = getInstrument;
    this.getA4 = getA4;
    this.beforeStart = beforeStart;
    this.onChange = onChange;
    this.el = {
      start: document.getElementById('calStart'),
      skip: document.getElementById('calSkip'),
      cancel: document.getElementById('calCancel'),
      clear: document.getElementById('calClear'),
      status: document.getElementById('calStatus'),
      step: document.getElementById('calStep'),
      advice: document.getElementById('calAdvice'),
    };
    this.running = false;
    this.el.start.addEventListener('click', () => this.start());
    this.el.cancel.addEventListener('click', () => this.cancel('Calibration cancelled.'));
    this.el.skip.addEventListener('click', () => this.nextString(null));
    this.el.clear.addEventListener('click', () => {
      saveCalibration(this.getInstrument(), null);
      this.refresh();
      if (this.onChange) this.onChange();
    });
    this.refresh();
  }

  refresh() {
    if (this.running) return;
    const inst = this.getInstrument();
    const info = instrumentInfo(inst);
    const cal = loadCalibration(inst);
    this.el.status.textContent = describeCalibration(cal, info.name);
    this.el.clear.hidden = !cal;
    this.el.start.textContent = cal ? 'Calibrate again' : 'Calibrate microphone';
    this.showAdvice(cal);
    this.el.step.hidden = true;
  }

  showAdvice(cal) {
    if (!cal) { this.el.advice.innerHTML = ''; return; }
    const info = instrumentInfo(this.getInstrument());
    const offs = info.stringNotes.map((n, i) => (cal.offsets[i] == null ? `${noteName(n)}: skipped` : `${noteName(n)} ${cal.offsets[i] > 0 ? '+' : ''}${Math.round(cal.offsets[i])}¢`)).join(' · ');
    this.el.advice.innerHTML = cal.advice.map((a) => `<li class="${a.ok ? 'ok' : 'warn'}">${a.ok ? '✓' : '!'} ${esc(a.text)}</li>`).join('') + `<li class="muted small">Open strings measured: ${esc(offs)}</li>`;
  }

  setStep(html) { this.el.step.hidden = false; this.el.step.innerHTML = html; }

  async start() {
    if (this.running) return;
    if (this.beforeStart) this.beforeStart();
    const inst = this.getInstrument();
    const info = instrumentInfo(inst);
    this.info = info;
    this.results = [];
    this.stringIndex = -1;
    this.prevMidi = null;
    this.steady = [];
    this.frames = [];
    this.phase = 'quiet';
    this.el.advice.innerHTML = '';
    const range = detectionRange(inst, this.getA4());
    // listen a little wider than usual so that a shifted pitch is still found
    try {
      this.el.start.disabled = true;
      await this.engine.start({ source: 'mic', minFreq: range.minFreq / 1.6, maxFreq: range.maxFreq, onFrames: (fs) => fs.forEach((f) => this.frame(f)) });
    } catch (e) {
      this.el.start.disabled = false;
      this.setStep(`<b>Could not start the microphone.</b> ${esc(e instanceof MicError ? e.message : e.message)}`);
      return;
    }
    this.running = true;
    this.el.cancel.hidden = false;
    this.el.clear.hidden = true;
    this.quietStart = null;
    this.setStep('<b>Stay quiet</b> – listening to the room…');
  }

  frame(f) {
    if (!this.running) return;
    if (this.phase === 'quiet') {
      if (this.quietStart == null) this.quietStart = f.t;
      this.frames.push(f);
      const left = CAL.quietSec - (f.t - this.quietStart);
      if (left > 0) { this.setStep(`<b>Stay quiet</b> – listening to the room… ${Math.ceil(left)}`); return; }
      this.noise = measureNoise(this.frames);
      this.nextString(undefined);
      return;
    }
    if (this.phase === 'string') {
      const i = this.stringIndex;
      const target = midiOf(this.info.stringNotes[i]) + this.info.transpose;
      const loud = f.rms >= Math.max(0.0015, this.noise * 3);
      if (!(loud && f.freq > 0 && f.clarity >= CAL.minClarity)) { this.recent = []; this.render(null); return; }
      const m = freqToMidi(f.freq, this.getA4());
      // the previous string may still be ringing (or still being bowed) as the prompt changes
      if (this.prevMidi != null && Math.abs(m - this.prevMidi) < 1) { this.render(null); return; }
      this.recent.push({ f, m });
      if (this.recent.length > 25) this.recent.shift();
      const med = this.recent.map((x) => x.m).sort((a, b) => a - b)[Math.floor(this.recent.length / 2)];
      if (this.recent.length >= 8 && Math.abs(m - med) <= CAL.steadySemis) this.steady.push(f);
      this.render(m - target);
      const got = this.steady.length ? this.steady[this.steady.length - 1].t - this.steady[0].t : 0;
      if (got >= CAL.stringSec) this.nextString(measureString(this.steady, this.getInstrument(), i, this.getA4()));
    }
  }

  render(centsOff) {
    const i = this.stringIndex;
    const name = noteName(this.info.stringNotes[i]);
    const got = this.steady.length ? Math.min(1, (this.steady[this.steady.length - 1].t - this.steady[0].t) / CAL.stringSec) : 0;
    const reading = centsOff == null ? 'waiting for a steady note…' : `hearing ${centsOff >= 0 ? '+' : '−'}${Math.abs(Math.round(centsOff))}¢ from ${name}`;
    this.setStep(`<b>Bow your open ${name} string</b> – long, steady and at your normal playing volume (string ${i + 1} of ${this.info.stringNotes.length}).
      <div style="height:8px;background:var(--surface-2);border-radius:4px;margin:8px 0"><div style="height:8px;width:${Math.round(got * 100)}%;background:var(--accent);border-radius:4px"></div></div>
      <span class="small muted">${reading}</span>`);
  }

  nextString(result) {
    if (this.stringIndex >= 0 && result !== undefined) this.results[this.stringIndex] = result;
    this.prevMidi = this.steady && this.steady.length ? freqToMidi(this.steady[Math.floor(this.steady.length / 2)].freq, this.getA4()) : null;
    this.stringIndex++;
    this.recent = [];
    this.steady = [];
    if (this.stringIndex >= this.info.stringNotes.length) { this.finish(); return; }
    this.phase = 'string';
    this.el.skip.hidden = false;
    this.render(null);
  }

  finish() {
    const inst = this.getInstrument();
    const cal = summarise(inst, this.noise, this.results, this.getA4());
    this.stop();
    if (!cal) { this.setStep('No open strings were measured, so nothing was saved.'); return; }
    saveCalibration(inst, cal);
    this.el.status.textContent = describeCalibration(cal, this.info.name);
    this.setStep('<b>Calibration saved.</b> It is used whenever you practise on this device with this instrument.');
    this.showAdvice(cal);
    this.el.clear.hidden = false;
    this.el.start.textContent = 'Calibrate again';
    if (this.onChange) this.onChange();
  }

  stop() {
    this.running = false;
    this.phase = null;
    this.engine.stop();
    this.el.start.disabled = false;
    this.el.skip.hidden = true;
    this.el.cancel.hidden = true;
  }

  cancel(msg) {
    if (!this.running) return;
    this.stop();
    this.refresh();
    this.setStep(msg);
  }
}
