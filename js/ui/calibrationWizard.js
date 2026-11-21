// "Calibrate the microphone": stay quiet, then bow each open string – or, for
// another instrument, play two long notes; for the voice, sing your lowest and
// highest comfortable notes (this also measures the singer's range).

import { instrumentInfo, detectionRange, classifyVoice } from '../instruments.js';
import { noteName, freqToMidi, midiOf } from '../theory.js';
import { MicError } from '../audio/mic.js';
import {
  CAL, VOICE_CAL, measureNoise, measureString, summarise, saveCalibration, loadCalibration, describeCalibration,
  HoldTracker, judgeHold, summariseVoice, voiceNoteName,
} from '../calibration.js';
import { setProfile } from '../profiles.js';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const bar = (frac) => `<div style="height:8px;background:var(--surface-2);border-radius:4px;margin:8px 0"><div style="height:8px;width:${Math.round(frac * 100)}%;background:var(--accent);border-radius:4px"></div></div>`;

const INTRO = {
  strings: 'Tune your instrument first. The app then listens to the room for a few seconds and to each open string, and adjusts to this microphone, room and instrument. Calibrate again if you change device, microphone or room.',
  other: 'Tune your instrument first. The app then listens to the room for a few seconds and to two long notes, and adjusts to this microphone, room and instrument. It also checks the transposition set in Config. Calibrate again if you change device, microphone or room.',
  voice: 'Warm up first. The app listens to the room for a few seconds, then you sing your lowest and your highest comfortable notes, each held steadily for two seconds. This finds your voice type, the clef and where exercises sit, and adjusts listening to this microphone and room.',
};

export class CalibrationWizard {
  constructor({ engine, getInstrument, getA4, beforeStart, onChange }) {
    this.engine = engine;
    this.getInstrument = getInstrument;
    this.getA4 = getA4;
    this.beforeStart = beforeStart;
    this.onChange = onChange;
    this.el = {
      title: document.getElementById('calTitle'),
      intro: document.getElementById('calIntro'),
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
      const inst = this.getInstrument();
      saveCalibration(inst, null);
      if (inst === 'voice') setProfile('voice', { low: null, high: null, type: null, measured: null });
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
    const voice = info.family === 'voice';
    if (this.el.title) this.el.title.textContent = voice ? 'Measure your vocal range' : 'Calibrate the microphone';
    if (this.el.intro) this.el.intro.textContent = INTRO[info.family];
    this.el.status.textContent = describeCalibration(cal, info.name);
    this.el.clear.hidden = !cal;
    this.el.clear.textContent = voice ? 'Forget my range' : 'Remove calibration';
    this.el.start.textContent = voice ? (cal ? 'Measure again' : 'Measure my range') : (cal ? 'Calibrate again' : 'Calibrate microphone');
    this.el.skip.textContent = 'Skip this string';
    this.showAdvice(cal);
    this.el.step.hidden = true;
  }

  showAdvice(cal) {
    if (!cal) { this.el.advice.innerHTML = ''; return; }
    const info = instrumentInfo(this.getInstrument());
    let extra = '';
    if (cal.voice) {
      extra = `<li class="muted small">Lowest ${voiceNoteName(cal.voice.low)} (drift ${cal.voice.lowDrift}¢) · highest ${voiceNoteName(cal.voice.high)} (drift ${cal.voice.highDrift}¢)</li>`;
    } else {
      const names = (cal.strings || []).map((s) => s.string);
      const what = info.family === 'strings' ? 'Open strings measured' : 'Notes measured (written)';
      const offs = names.map((nm, i) => (cal.offsets[i] == null ? `${nm}: skipped` : `${nm} ${cal.offsets[i] > 0 ? '+' : ''}${Math.round(cal.offsets[i])}¢`)).join(' · ');
      if (offs) extra = `<li class="muted small">${what}: ${esc(offs)}</li>`;
    }
    this.el.advice.innerHTML = cal.advice.map((a) => `<li class="${a.ok ? 'ok' : 'warn'}">${a.ok ? '✓' : '!'} ${esc(a.text)}</li>`).join('') + extra;
  }

  setStep(html) { this.el.step.hidden = false; this.el.step.innerHTML = html; }

  async start() {
    if (this.running) return;
    this.engine.unlock('play-and-record'); // inside the tap (iOS)
    if (this.beforeStart) this.beforeStart();
    const inst = this.getInstrument();
    const info = instrumentInfo(inst);
    this.info = info;
    this.voice = info.family === 'voice';
    this.results = [];
    this.stringIndex = -1;
    this.prevMidi = null;
    this.steady = [];
    this.frames = [];
    this.phase = 'quiet';
    this.el.advice.innerHTML = '';
    let minFreq, maxFreq;
    if (this.voice) ({ minFreq, maxFreq } = VOICE_CAL); // the range is what we are measuring
    else {
      const range = detectionRange(inst, this.getA4());
      // listen a little wider than usual so that a shifted pitch is still found
      minFreq = range.minFreq / 1.6;
      maxFreq = info.family === 'other' ? range.maxFreq * 1.6 : range.maxFreq;
    }
    try {
      this.el.start.disabled = true;
      this.starting = true;
      const ctx = await this.engine.start({ source: 'mic', minFreq, maxFreq, onFrames: (fs) => fs.forEach((f) => this.frame(f)) });
      this.starting = false;
      if (!ctx) { this.el.start.disabled = false; return; } // stopped while starting
    } catch (e) {
      this.starting = false;
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
      if (this.voice) this.nextVoice();
      else this.nextString(undefined);
      return;
    }
    if (this.phase === 'low' || this.phase === 'high') { this.voiceFrame(f); return; }
    if (this.phase === 'string') {
      const i = this.stringIndex;
      const target = midiOf(this.info.calNotes[i]) + this.info.transpose;
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
    const name = noteName(this.info.calNotes[i]);
    const got = this.steady.length ? Math.min(1, (this.steady[this.steady.length - 1].t - this.steady[0].t) / CAL.stringSec) : 0;
    const reading = centsOff == null ? 'waiting for a steady note…' : `hearing ${centsOff >= 0 ? '+' : '−'}${Math.abs(Math.round(centsOff))}¢ from ${name}`;
    const n = this.info.calNotes.length;
    const prompt = this.info.family === 'strings'
      ? `<b>Bow your open ${name} string</b> – long, steady and at your normal playing volume (string ${i + 1} of ${n}).`
      : `<b>Play a long, steady ${noteName(this.info.calNotes[i], { octave: true })}</b>${this.info.transpose ? ' (written)' : ''} at your normal playing volume (note ${i + 1} of ${n}).`;
    this.setStep(`${prompt}${bar(got)}<span class="small muted">${reading}</span>`);
  }

  nextString(result) {
    if (this.stringIndex >= 0 && result !== undefined) this.results[this.stringIndex] = result;
    this.prevMidi = this.steady && this.steady.length ? freqToMidi(this.steady[Math.floor(this.steady.length / 2)].freq, this.getA4()) : null;
    this.stringIndex++;
    this.recent = [];
    this.steady = [];
    if (this.stringIndex >= this.info.calNotes.length) { this.finish(); return; }
    this.phase = 'string';
    this.el.skip.textContent = this.info.family === 'strings' ? 'Skip this string' : 'Skip this note';
    this.el.skip.hidden = false;
    this.render(null);
  }

  // ---------------------------------------------------------------- voice
  nextVoice() {
    this.phase = this.phase === 'quiet' ? 'low' : 'high';
    this.tracker = new HoldTracker(this.getA4(), Math.max(0.0015, this.noise * 3));
    this.voiceMsg = '';
    this.renderVoice();
  }

  renderVoice() {
    const low = this.phase === 'low';
    const cur = this.tracker.currentMidi;
    const hearing = cur == null ? 'waiting for a held note…' : `hearing ${voiceNoteName(Math.round(cur))}`;
    this.setStep(`<b>Sing your ${low ? 'lowest' : 'highest'} comfortable note</b> on “ah” and hold it steadily for ${VOICE_CAL.holdSec} seconds –
      ${low ? 'not a growl, a note you could sing a tune on' : 'not a squeak or a strain, a note you could sing a tune on'} (step ${low ? 1 : 2} of 2).
      ${bar(this.tracker.progress)}<span class="small muted">${hearing}</span>${this.voiceMsg ? `<p class="small" style="margin:6px 0 0">${this.voiceMsg}</p>` : ''}`);
  }

  voiceFrame(f) {
    const frames = this.tracker.push(f);
    if (!frames) { this.renderVoice(); return; }
    const j = judgeHold(frames, this.getA4());
    const low = this.phase === 'low';
    if (!j.steady) {
      const why = j.clarity < VOICE_CAL.steadyClarity ? 'came through rough or breathy' : `wavered by ${Math.round(j.drift)} cents`;
      this.voiceMsg = `⚠ That ${voiceNoteName(j.midi)} ${why}, so it is probably beyond your comfortable range. Try again, a note or two ${low ? 'higher' : 'lower'}.`;
      this.renderVoice();
      return;
    }
    if (low) {
      this.lowNote = j;
      this.nextVoice();
      this.voiceMsg = `✓ Lowest note: ${voiceNoteName(j.midi)}.`;
      this.renderVoice();
      return;
    }
    if (j.midi - this.lowNote.midi < VOICE_CAL.minSpanSemis) {
      this.voiceMsg = `⚠ That was ${voiceNoteName(j.midi)}, only ${j.midi - this.lowNote.midi} semitones above your lowest note (${voiceNoteName(this.lowNote.midi)}). Sing your highest comfortable note.`;
      this.renderVoice();
      return;
    }
    this.highNote = j;
    this.finishVoice();
  }

  finishVoice() {
    const audio = this.engine.describe ? this.engine.describe() : null;
    const cal = summariseVoice(this.noise, this.lowNote, this.highNote, this.getA4(), {
      microphone: audio && audio.track ? audio.track.label : null,
      micSettings: audio && audio.track ? audio.track.settings : null,
      userAgent: navigator.userAgent,
    });
    this.stop();
    if (!cal) { this.setStep('Nothing was measured, so nothing was saved.'); return; }
    saveCalibration('voice', cal);
    // a fresh measurement decides the voice type again
    setProfile('voice', { low: cal.voice.low, high: cal.voice.high, type: classifyVoice(cal.voice.low, cal.voice.high).id, override: '', measured: cal.date });
    this.refresh();
    this.setStep('<b>Range saved.</b> It is used whenever you sing on this device.');
    this.el.step.hidden = false;
    if (this.onChange) this.onChange();
  }

  finish() {
    const inst = this.getInstrument();
    const audio = this.engine.describe ? this.engine.describe() : null;
    const cal = summarise(inst, this.noise, this.results, this.getA4(), {
      microphone: audio && audio.track ? audio.track.label : null,
      micSettings: audio && audio.track ? audio.track.settings : null,
      userAgent: navigator.userAgent,
    });
    this.stop();
    if (!cal) { this.setStep(`No ${this.info.family === 'strings' ? 'open strings were' : 'notes were'} measured, so nothing was saved.`); return; }
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
    if (this.starting) { this.starting = false; this.engine.stop(); return; }
    if (!this.running) return;
    this.stop();
    this.refresh();
    this.setStep(msg);
  }
}
