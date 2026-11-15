// Microphone calibration from the open strings of a tuned instrument.
// Measures, for this device + room + instrument: background noise, how loud
// and how clearly pitched each string comes through, and whether the pitch the
// microphone hears is shifted. Stored only in this browser.

import { instrumentInfo, classifyVoice } from './instruments.js';
import { midiOf, freqToMidi, spellMidi, noteName } from './theory.js';

const KEY = 'scales.calibration.v1';

export const CAL = {
  quietSec: 3,
  startupSkipSec: 0.5,
  stringSec: 1.5,        // steady sound needed per string
  steadySemis: 0.4,
  minClarity: 0.4,
  inTuneCents: 8,        // offsets within this need no correction
  maxSpreadCents: 20,    // strings must agree this well for a reliable correction
};

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const quantile = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : NaN; };
const dB = (x) => 20 * Math.log10(x + 1e-12);

export function loadCalibrations() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
export function loadCalibration(instrument) { return loadCalibrations()[instrument] || null; }
export function saveCalibration(instrument, cal) {
  const all = loadCalibrations();
  if (cal) all[instrument] = cal; else delete all[instrument];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

/** Background noise from frames recorded while the player stays quiet. */
export function measureNoise(frames) {
  if (!frames.length) return null;
  const t0 = frames[0].t;
  const r = frames.filter((f) => f.t - t0 >= CAL.startupSkipSec && f.rms > 0).map((f) => f.rms);
  return r.length ? quantile(r, 0.5) : null;
}

/**
 * One open string: frames while it was played. The steadiest pitch is taken;
 * its offset from the string's equal-tempered pitch is reported in cents.
 */
export function measureString(frames, instrument, stringIndex, a4 = 440) {
  const info = instrumentInfo(instrument);
  const target = midiOf(info.calNotes[stringIndex]) + info.transpose;
  const ok = frames.filter((f) => f.freq > 0 && f.clarity >= CAL.minClarity);
  if (ok.length < 5) return null;
  const ms = ok.map((f) => freqToMidi(f.freq, a4));
  const med = median(ms);
  const steady = ok.filter((f, i) => Math.abs(ms[i] - med) <= CAL.steadySemis);
  let cents = (median(steady.map((f) => freqToMidi(f.freq, a4))) - target) * 100;
  let octave = 0;
  while (cents > 600) { cents -= 1200; octave++; }
  while (cents < -600) { cents += 1200; octave--; }
  return {
    cents,
    octave,              // detector heard the string an octave away (weak fundamental)
    rms: median(steady.map((f) => f.rms)),
    clarity: median(steady.map((f) => f.clarity)),
    frames: steady.length,
  };
}

/** Combine the measurements into a stored calibration with plain-English advice. */
export function summarise(instrument, noiseRms, strings, a4 = 440, extra = {}) {
  const done = strings.filter(Boolean);
  if (!done.length || noiseRms == null) return null;
  const offsets = done.map((s) => s.cents);
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const spread = Math.max(...offsets) - Math.min(...offsets);
  const quietest = Math.min(...done.map((s) => s.rms));
  const clarity = Math.min(...done.map((s) => s.clarity));
  const snr = dB(quietest) - dB(noiseRms);
  const advice = [];
  let correctCents = 0;
  const bowed = instrumentInfo(instrument).family === 'strings';
  if (Math.abs(mean) <= CAL.inTuneCents) {
    advice.push({ ok: true, text: bowed ? 'The open strings read in tune, so the microphone hears true pitch.' : 'The notes read in tune, so the microphone hears true pitch (and the transposition is right).' });
  } else if (!bowed && Math.abs(mean) >= 50 && spread <= CAL.maxSpreadCents) {
    correctCents = 0;
    const semis = Math.round(mean / 100);
    advice.push({ ok: false, text: `The notes sounded about ${Math.abs(mean / 100).toFixed(1)} semitones ${mean > 0 ? 'higher' : 'lower'} than expected. Check the transposition in Config${semis ? ` (it may need to be ${semis > 0 ? 'raised' : 'lowered'} by ${Math.abs(semis)} semitone${Math.abs(semis) === 1 ? '' : 's'})` : ''}, then calibrate again. No pitch correction is applied.` });
  } else if (spread <= CAL.maxSpreadCents) {
    correctCents = mean;
    const semis = Math.abs(mean) / 100;
    if (Math.abs(mean) >= 50) {
      advice.push({ ok: false, text: `Everything sounds ${semis.toFixed(1)} semitones ${mean > 0 ? 'higher' : 'lower'} than it should. Something between the instrument and the app is changing the pitch (for example the microphone or a recording played back at the wrong speed). The app will correct for it, but the Tuner page cannot.` });
    } else {
      advice.push({ ok: false, text: `The strings read ${Math.round(Math.abs(mean))} cents ${mean > 0 ? 'sharp' : 'flat'}. If you tune to A = ${(a4 * Math.pow(2, mean / 1200)).toFixed(1)} Hz that is fine – the app will now treat that as in tune.` });
    }
  } else {
    advice.push({ ok: false, text: bowed ? `The strings disagree by ${Math.round(spread)} cents, so no pitch correction is applied. Tune the strings again and recalibrate.`
      : `The two notes disagree by ${Math.round(spread)} cents, so no pitch correction is applied. Tune, play long steady notes and calibrate again.` });
  }
  if (snr < 15) advice.push({ ok: false, text: `Your instrument is only ${Math.round(snr)} dB louder than the background. Move closer to the microphone or find a quieter room.` });
  else advice.push({ ok: true, text: `Your instrument is ${Math.round(snr)} dB louder than the background.` });
  if (clarity < 0.75) advice.push({ ok: true, text: `Some ${bowed ? 'strings come' : 'notes come'} through with a weak or unclear pitch (common with small microphones); listening has been made more tolerant.` });
  if (done.some((s) => s.octave)) advice.push({ ok: true, text: `A ${bowed ? 'string' : 'note'} was heard an octave out (its lowest frequencies are hard for this microphone to pick up).` });
  return {
    date: new Date().toISOString(),
    a4,
    noiseRms,
    quietestRms: quietest,
    clarity,
    snrDb: snr,
    offsets: Object.fromEntries(strings.map((s, i) => [i, s ? Math.round(s.cents * 10) / 10 : null])),
    // full per-string measurements (for fault-finding)
    strings: strings.map((s, i) => (s ? {
      string: instrumentInfo(instrument).calNames[i],
      cents: Math.round(s.cents * 10) / 10,
      octave: s.octave,
      levelDb: Math.round(dB(s.rms) * 10) / 10,
      clarity: Math.round(s.clarity * 1000) / 1000,
      frames: s.frames,
    } : { string: instrumentInfo(instrument).calNames[i], skipped: true })),
    noiseDb: Math.round(dB(noiseRms) * 10) / 10,
    instrument,
    ...extra,
    meanCents: mean,
    spreadCents: spread,
    correctCents,
    advice,
  };
}

/**
 * How a calibration changes listening: thresholds for the segmenter and the
 * pitch correction (as an effective A) for analysis and scoring.
 */
export function applyCalibration(cal, a4 = 440) {
  if (!cal) return { a4, segmenter: {} };
  const clarityMin = Math.max(0.6, Math.min(0.85, cal.clarity - 0.1));
  const clarityWeak = Math.max(0.3, Math.min(0.45, cal.clarity - 0.35));
  return {
    a4: a4 * Math.pow(2, (cal.correctCents || 0) / 1200),
    segmenter: {
      noiseFloor: cal.noiseRms,
      clarityMin,
      clarityWeak,
      maxGate: cal.quietestRms * Math.pow(10, -18 / 20), // a gate never higher than 18 dB below the quietest open string
    },
  };
}

// ---------------------------------------------------------------- voice range

export const VOICE_CAL = {
  minFreq: 60,           // listen from below a bass's low E…
  maxFreq: 1400,         // …to above a soprano's top C
  holdSec: 2,            // the note must be held this long
  minClarity: 0.5,       // frames clearer than this count as singing
  jumpSemis: 1.5,        // a bigger jump starts the hold again
  gapSec: 0.2,           // a break longer than this starts the hold again
  windowSec: 0.5,        // pitch averaged over this (covers several vibrato cycles)…
  maxDriftCents: 35,     // …and those averages must stay this close together
  steadyClarity: 0.7,    // a strained or creaky note comes through unclear
  minSpanSemis: 5,
};

/**
 * Follows one sustained sung note. push() each analysis frame; it returns the
 * frames of a complete hold (VOICE_CAL.holdSec of unbroken singing near one
 * pitch) once there is one, else null.
 */
export class HoldTracker {
  constructor(a4 = 440, gate = 0.0015) { this.a4 = a4; this.gate = gate; this.reset(); }
  reset() { this.frames = []; this.lastVoiced = null; }
  get progress() { return this.frames.length ? Math.min(1, (this.frames[this.frames.length - 1].t - this.frames[0].t) / VOICE_CAL.holdSec) : 0; }
  get currentMidi() { return this.frames.length ? median(this.frames.slice(-10).map((f) => f.m)) : null; }
  push(f) {
    const voiced = f.rms >= this.gate && f.freq > 0 && f.clarity >= VOICE_CAL.minClarity;
    if (!voiced) {
      if (this.lastVoiced != null && f.t - this.lastVoiced > VOICE_CAL.gapSec) this.reset();
      return null;
    }
    if (this.lastVoiced != null && f.t - this.lastVoiced > VOICE_CAL.gapSec) this.reset(); // a break in the note
    const m = freqToMidi(f.freq, this.a4);
    const ref = this.currentMidi;
    if (ref != null && Math.abs(m - ref) > VOICE_CAL.jumpSemis) this.frames = [];
    this.lastVoiced = f.t;
    this.frames.push({ ...f, m });
    if (f.t - this.frames[0].t >= VOICE_CAL.holdSec) { const out = this.frames; this.reset(); return out; }
    return null;
  }
}

/**
 * Judge a held note: its pitch (nearest semitone), how far the pitch drifted
 * (the spread of half-second averages, so vibrato does not count) and how
 * clear it was. Notes that drift or come through unclear are not "comfortable".
 */
export function judgeHold(frames, a4 = 440) {
  const ms = frames.map((f) => f.m ?? freqToMidi(f.freq, a4));
  const t0 = frames[0].t;
  const windows = [];
  for (let k = 0; k * VOICE_CAL.windowSec <= frames[frames.length - 1].t - t0; k++) {
    const w = ms.filter((_, i) => frames[i].t - t0 >= k * VOICE_CAL.windowSec && frames[i].t - t0 < (k + 1) * VOICE_CAL.windowSec);
    if (w.length >= 3) windows.push(w.reduce((a, b) => a + b, 0) / w.length);
  }
  const drift = windows.length ? (Math.max(...windows) - Math.min(...windows)) * 100 : Infinity;
  const clarity = median(frames.map((f) => f.clarity));
  const midiExact = median(ms);
  return {
    midi: Math.round(midiExact),
    cents: (midiExact - Math.round(midiExact)) * 100,
    drift,
    clarity,
    rms: median(frames.map((f) => f.rms)),
    steady: drift <= VOICE_CAL.maxDriftCents && clarity >= VOICE_CAL.steadyClarity,
  };
}

export const voiceNoteName = (m) => noteName(spellMidi(m, 'sharp'), { octave: true });

/** Calibration record for the voice: the same listening thresholds as for strings, plus the range. */
export function summariseVoice(noiseRms, low, high, a4 = 440, extra = {}) {
  if (noiseRms == null || !low || !high) return null;
  const quietest = Math.min(low.rms, high.rms);
  const clarity = Math.min(low.clarity, high.clarity);
  const snr = dB(quietest) - dB(noiseRms);
  const type = classifyVoice(low.midi, high.midi);
  const span = high.midi - low.midi;
  const advice = [{ ok: true, text: `Your comfortable range is ${voiceNoteName(low.midi)}–${voiceNoteName(high.midi)} (${span} semitones): a ${type.name.toLowerCase()} range. Exercises are written in the ${type.clef} clef${type.clefAnnotation ? ', sung an octave lower than written,' : ''} and placed to sit in the middle of your range.` }];
  if (span < 12) advice.push({ ok: false, text: 'Your range is less than an octave, so one-octave exercises will not fit. Try “to a 6th”, or measure again after warming up.' });
  if (snr < 15) advice.push({ ok: false, text: `Your voice is only ${Math.round(snr)} dB louder than the background. Move closer to the microphone or find a quieter room.` });
  else advice.push({ ok: true, text: `Your voice is ${Math.round(snr)} dB louder than the background.` });
  return {
    date: new Date().toISOString(),
    a4,
    noiseRms,
    quietestRms: quietest,
    clarity,
    snrDb: snr,
    offsets: {},
    strings: [],
    voice: {
      low: low.midi, high: high.midi, type: type.id,
      lowDrift: Math.round(low.drift), highDrift: Math.round(high.drift),
      lowClarity: Math.round(low.clarity * 1000) / 1000, highClarity: Math.round(high.clarity * 1000) / 1000,
    },
    noiseDb: Math.round(dB(noiseRms) * 10) / 10,
    instrument: 'voice',
    ...extra,
    meanCents: 0,
    spreadCents: 0,
    correctCents: 0, // a voice has no fixed pitch to check the microphone against
    advice,
  };
}

// "the violin", but a name the player typed keeps its capitals ("the Clarinet in B♭")
const lowerName = (n) => (/^[A-Z][a-z ]*$/.test(n) ? n.toLowerCase() : n);

export function describeCalibration(cal, instrumentName) {
  if (!cal && instrumentName === 'Voice') return 'Range not measured yet – sing your lowest and highest notes on the Tuner tab.';
  if (!cal) return `Microphone not calibrated for the ${lowerName(instrumentName)} – see the Tuner tab.`;
  if (cal.voice) return `Range ${voiceNoteName(cal.voice.low)}–${voiceNoteName(cal.voice.high)} measured on ${new Date(cal.date).toLocaleDateString()}.`;
  const d = new Date(cal.date);
  const corr = cal.correctCents ? `, correcting ${cal.correctCents > 0 ? '+' : '−'}${Math.round(Math.abs(cal.correctCents))} cents` : '';
  return `Microphone calibrated for the ${lowerName(instrumentName)} on ${d.toLocaleDateString()}${corr}.`;
}
