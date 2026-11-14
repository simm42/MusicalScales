// Microphone calibration from the open strings of a tuned instrument.
// Measures, for this device + room + instrument: background noise, how loud
// and how clearly pitched each string comes through, and whether the pitch the
// microphone hears is shifted. Stored only in this browser.

import { instrumentInfo } from './instruments.js';
import { midiOf, freqToMidi } from './theory.js';

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
  const target = midiOf(info.stringNotes[stringIndex]) + info.transpose;
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
  if (Math.abs(mean) <= CAL.inTuneCents) {
    advice.push({ ok: true, text: 'The open strings read in tune, so the microphone hears true pitch.' });
  } else if (spread <= CAL.maxSpreadCents) {
    correctCents = mean;
    const semis = Math.abs(mean) / 100;
    if (Math.abs(mean) >= 50) {
      advice.push({ ok: false, text: `Everything sounds ${semis.toFixed(1)} semitones ${mean > 0 ? 'higher' : 'lower'} than it should. Something between the instrument and the app is changing the pitch (for example the microphone or a recording played back at the wrong speed). The app will correct for it, but the Tuner page cannot.` });
    } else {
      advice.push({ ok: false, text: `The strings read ${Math.round(Math.abs(mean))} cents ${mean > 0 ? 'sharp' : 'flat'}. If you tune to A = ${(a4 * Math.pow(2, mean / 1200)).toFixed(1)} Hz that is fine – the app will now treat that as in tune.` });
    }
  } else {
    advice.push({ ok: false, text: `The strings disagree by ${Math.round(spread)} cents, so no pitch correction is applied. Tune the strings again and recalibrate.` });
  }
  if (snr < 15) advice.push({ ok: false, text: `Your instrument is only ${Math.round(snr)} dB louder than the background. Move closer to the microphone or find a quieter room.` });
  else advice.push({ ok: true, text: `Your instrument is ${Math.round(snr)} dB louder than the background.` });
  if (clarity < 0.75) advice.push({ ok: true, text: 'Some strings come through with a weak or unclear pitch (common with small microphones); listening has been made more tolerant.' });
  if (done.some((s) => s.octave)) advice.push({ ok: true, text: 'A string was heard an octave out (its lowest frequencies are hard for this microphone to pick up).' });
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
      string: instrumentInfo(instrument).strings[i],
      cents: Math.round(s.cents * 10) / 10,
      octave: s.octave,
      levelDb: Math.round(dB(s.rms) * 10) / 10,
      clarity: Math.round(s.clarity * 1000) / 1000,
      frames: s.frames,
    } : { string: instrumentInfo(instrument).strings[i], skipped: true })),
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

export function describeCalibration(cal, instrumentName) {
  if (!cal) return `Microphone not calibrated for the ${instrumentName.toLowerCase()} – see the Tuner tab.`;
  const d = new Date(cal.date);
  const corr = cal.correctCents ? `, correcting ${cal.correctCents > 0 ? '+' : '−'}${Math.round(Math.abs(cal.correctCents))} cents` : '';
  return `Microphone calibrated for the ${instrumentName.toLowerCase()} on ${d.toLocaleDateString()}${corr}.`;
}
