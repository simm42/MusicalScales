// Scoring: intonation 75 %, timing 25 %, minus a penalty for each extra note.
// No DOM access.

import { linearScore } from './precision.js';

export const SCORING = { intonationWeight: 0.75, timingWeight: 0.25, extraPenalty: 3, wrongCents: 50 };

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

/**
 * @param {object} o
 * @param {object[]} o.expected events from buildSequence
 * @param {object[]} o.detected notes from the segmenter
 * @param {{pairs, extras}} o.alignment
 * @param {object} o.prec precision tolerances
 * @param {{t0:number, spb:number}|null} [o.metronome] beat grid
 * @param {(note, event)=>{cents:(number|null)[], approx?:boolean}} [o.doubleStopEval]
 */
export function scoreRun(o) {
  const { expected, detected, alignment, prec, metronome = null, doubleStopEval = null } = o;
  const per = alignment.pairs.map(({ event, note }) => {
    const e = expected[event];
    const row = { event, note, name: e.notes, status: 'missing', cents: null, intonation: 0, timing: 0 };
    if (note == null) return row;
    const d = detected[note];
    row.onset = d.onset;
    if (doubleStopEval) {
      const ev = doubleStopEval(d, e);
      row.cents = ev.cents;
      row.approx = !!ev.approx;
      if (ev.cents.some((c) => c == null || Math.abs(c) > SCORING.wrongCents)) { row.status = 'wrong'; row.intonation = 0; }
      else { row.status = 'ok'; row.intonation = ev.cents.reduce((a, c) => a + linearScore(c, prec.fullCents, prec.zeroCents), 0) / ev.cents.length; }
    } else {
      const cents = (d.midi - e.midis[0]) * 100;
      row.cents = [cents];
      row.unsteady = !!d.unsteady;
      if (Math.abs(cents) > SCORING.wrongCents) { row.status = 'wrong'; row.intonation = 0; row.playedMidi = d.midi; }
      else { row.status = 'ok'; row.intonation = linearScore(cents, prec.fullCents, prec.zeroCents); }
    }
    return row;
  });

  // ---- timing
  const matched = per.filter((r) => r.note != null);
  if (metronome) {
    const errs = matched.map((r) => r.onset - (metronome.t0 + expected[r.event].onsetBeat * metronome.spb));
    const offset = median(errs); // constant latency of the audio path
    matched.forEach((r, k) => {
      r.timingDev = (errs[k] - offset) / metronome.spb;
      r.timing = linearScore(r.timingDev, prec.fullTiming, prec.zeroTiming);
    });
  } else if (matched.length >= 2) {
    const rates = [];
    for (let k = 1; k < matched.length; k++) {
      const a = matched[k - 1], b = matched[k];
      const beats = expected[b.event].onsetBeat - expected[a.event].onsetBeat;
      rates.push(beats > 0 ? (b.onset - a.onset) / beats : NaN);
    }
    const ref = median(rates.filter((x) => isFinite(x) && x > 0));
    matched.forEach((r, k) => {
      const rate = k === 0 ? rates[0] : rates[k - 1];
      r.timingDev = isFinite(rate) && ref > 0 ? rate / ref - 1 : 0;
      r.timing = linearScore(r.timingDev, prec.fullTiming, prec.zeroTiming);
    });
    o.secondsPerBeat = ref;
  } else {
    matched.forEach((r) => { r.timing = 100; r.timingDev = 0; });
  }

  // ---- extra notes (only while the exercise was being played)
  let extras = [];
  if (matched.length) {
    const first = matched[0].onset - 0.3;
    const lastNote = detected[matched[matched.length - 1].note];
    const last = lastNote.end + 0.3;
    extras = alignment.extras.filter((i) => detected[i].onset >= first && detected[i].onset <= last);
  }

  const n = per.length || 1;
  const intonation = per.reduce((a, r) => a + r.intonation, 0) / n;
  const timing = per.reduce((a, r) => a + r.timing, 0) / n;
  const penalty = SCORING.extraPenalty * extras.length;
  const total = Math.max(0, Math.min(100, SCORING.intonationWeight * intonation + SCORING.timingWeight * timing - penalty));
  return {
    perNote: per,
    intonation,
    timing,
    extras: extras.map((i) => detected[i]),
    penalty,
    total,
    missing: per.filter((r) => r.status === 'missing').length,
    wrong: per.filter((r) => r.status === 'wrong').length,
    bpm: metronome ? 60 / metronome.spb : o.secondsPerBeat ? 60 / o.secondsPerBeat : null,
  };
}
