// Scoring: intonation 75 %, timing 25 %, minus a penalty for each extra note.
// No DOM access.

import { linearScore, scrapeSize, scrapeWeight } from './precision.js';
import { foldPitch, HARMONIC_SHIFTS } from './align.js';

export const SCORING = {
  intonationWeight: 0.75, timingWeight: 0.25, extraPenalty: 3, wrongCents: 50,
  // a piece played slower than its written tempo: the score is cut by `cut` at `at` of
  // the speed, on a log scale bent by `curve` so that a little slower costs almost nothing
  slowTempo: { at: 0.5, cut: 0.2, curve: 1.5 },
  tempoMinNotes: 4, // notes heard before the tempo measured from the run is trusted
};

/**
 * The share of the score kept when a piece is played slower than written: 1 at the
 * written tempo or faster. With the settings above: 95 % of the speed keeps 99.6 %,
 * 90 % → 98.8 %, 75 % → 94.7 %, 50 % → 80 %, 25 % → 43 %.
 */
export function tempoFactor(played, target, s = SCORING.slowTempo) {
  if (!(played > 0) || !(target > 0) || played >= target) return 1;
  const x = Math.log(target / played) / Math.log(1 / s.at);
  return Math.max(0, 1 - s.cut * Math.pow(x, s.curve));
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

/**
 * @param {object} o
 * @param {object[]} o.expected events from buildSequence
 * @param {object[]} o.detected notes from the segmenter
 * @param {{pairs, extras}} o.alignment
 * @param {object} o.prec precision tolerances
 * @param {{t0:number, spb:number}|null} [o.metronome] beat grid
 * @param {(note, event)=>{cents:(number|null)[], approx?:boolean}} [o.doubleStopEval]
 * @param {number} [o.targetBpm] a piece's written tempo: playing slower costs a little (tempoFactor)
 * @param {number} [o.setBpm] the tempo it was practised at (used when too few notes give a tempo)
 */
export function scoreRun(o) {
  const { expected, detected, alignment, prec, metronome = null, doubleStopEval = null, scrapes = [], fold = false } = o;
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
      let cents = (d.midi - e.midis[0]) * 100;
      row.unsteady = !!d.unsteady;
      if (Math.abs(cents) > SCORING.wrongCents) {
        // presume a competent player: before calling it wrong, look at the note more closely
        const closer = lookCloser(d, e.midis[0], fold);
        if (closer) { cents = closer.cents; row.heardShift = closer.shift; row.rechecked = closer.how; }
      }
      row.cents = [cents];
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
  let inPlay = () => false;
  if (matched.length) {
    const first = matched[0].onset - 0.3;
    const lastNote = detected[matched[matched.length - 1].note];
    const last = lastNote.end + 0.3;
    inPlay = (t) => t >= first && t <= last;
    extras = alignment.extras.filter((i) => inPlay(detected[i].onset));
  }
  // bow-change scrapes: part errors, by size and the precision level
  const scr = scrapes.filter((x) => inPlay(x.onset)).map((x) => {
    const size = scrapeSize(x.dur, x.relDb);
    return { onset: x.onset, dur: x.dur, relDb: x.relDb, size, weight: scrapeWeight(size, prec) };
  });
  const scrapeErrors = scr.reduce((a, x) => a + x.weight, 0);

  const n = per.length || 1;
  const intonation = per.reduce((a, r) => a + r.intonation, 0) / n;
  const timing = per.reduce((a, r) => a + r.timing, 0) / n;
  const extraPenalty = SCORING.extraPenalty * extras.length;
  const penalty = extraPenalty + SCORING.extraPenalty * scrapeErrors;
  // a piece: the tempo played – the metronome's, or measured from the notes
  const measured = o.secondsPerBeat && matched.length >= SCORING.tempoMinNotes ? 60 / o.secondsPerBeat : null;
  const playedBpm = metronome ? 60 / metronome.spb : measured || o.setBpm || null;
  const factor = o.targetBpm ? tempoFactor(playedBpm, o.targetBpm) : 1;
  const total = Math.max(0, Math.min(100, SCORING.intonationWeight * intonation + SCORING.timingWeight * timing - penalty)) * factor;
  return {
    perNote: per,
    tempoFactor: factor,
    targetBpm: o.targetBpm || null,
    setBpm: o.setBpm || null,
    playedBpm: o.targetBpm ? playedBpm : null,
    intonation,
    timing,
    extras: extras.map((i) => detected[i]),
    scrapes: scr,
    // errors: extra notes, plus scrapes counted as part errors at this level
    errors: extras.length + scrapeErrors,
    extraPenalty,
    penalty,
    total,
    missing: per.filter((r) => r.status === 'missing').length,
    wrong: per.filter((r) => r.status === 'wrong').length,
    bpm: metronome ? 60 / metronome.spb : o.secondsPerBeat ? 60 / o.secondsPerBeat : null,
  };
}

/**
 * A note that came out far from the expected pitch, looked at more closely.
 * Microphones (phones especially) often hear a low note at a harmonic, and a
 * note can start with a slide or a stray reading. So:
 *  - if at least a quarter of its pitch readings are at the expected note, it
 *    is that note, measured on those readings ('part');
 *  - else if most of it sits a harmonic away (an octave, an octave and a fifth,
 *    two octaves up; an octave or an octave and a fifth down), it is the
 *    expected note heard at a harmonic ('harmonic'), measured after the shift.
 * Otherwise it stays a wrong note.
 * @returns {{cents:number, shift:number, how:string}|null}
 */
export function lookCloser(d, target, fold = true) {
  const ms = (d.pitches || []).map((p) => p[1]).filter((m) => m != null);
  if (ms.length < 5) {
    if (!fold || d.midi == null) return null;
    const f = foldPitch(d.midi, target);
    return f.shift && Math.abs(f.diff) * 100 <= SCORING.wrongCents ? { cents: f.diff * 100, shift: f.shift, how: 'harmonic' } : null;
  }
  const at = (shift) => ms.filter((m) => Math.abs(m - shift - target) <= 0.5);
  const right = at(0);
  if (right.length >= Math.max(3, 0.25 * ms.length)) return { cents: (median(right) - target) * 100, shift: 0, how: 'part' };
  if (!fold) return null;
  let best = null;
  for (const s of HARMONIC_SHIFTS) {
    const h = at(s);
    if (h.length >= 0.5 * ms.length && (!best || h.length > best.h.length)) best = { s, h };
  }
  return best ? { cents: (median(best.h) - best.s - target) * 100, shift: best.s, how: 'harmonic' } : null;
}

/**
 * The same run re-scored at each of the five precision levels (Beginner …
 * Expert), so results stay comparable whatever the slider is set to.
 * Scrapes count more at stricter levels, so the errors are worked out per level too.
 * @returns {Array<[total, intonation, timing, errors]>} index = precision level 0–4
 */
export function scoresAtLevels(result, levels = [0, 1, 2, 3, 4], precisionAt) {
  return levels.map((lv) => {
    const p = precisionAt(lv);
    let inton = 0, timing = 0;
    for (const r of result.perNote) {
      if (r.status === 'ok' && r.cents && r.cents.length) {
        const cs = r.cents.filter((c) => c != null);
        inton += cs.length ? cs.reduce((a, c) => a + linearScore(c, p.fullCents, p.zeroCents), 0) / r.cents.length : 0;
      }
      if (r.status !== 'missing' && r.timingDev != null) timing += linearScore(r.timingDev, p.fullTiming, p.zeroTiming);
      else if (r.status !== 'missing') timing += r.timing; // no deviation recorded (single note)
    }
    const n = result.perNote.length || 1;
    inton /= n;
    timing /= n;
    const scrapeErrors = (result.scrapes || []).reduce((a, x) => a + scrapeWeight(x.size ?? scrapeSize(x.dur, x.relDb), p), 0);
    const base = result.extraPenalty ?? (result.scrapes ? SCORING.extraPenalty * (result.extras || []).length : result.penalty || 0);
    const penalty = base + SCORING.extraPenalty * scrapeErrors;
    const errors = result.extras ? Math.round((result.extras.length + scrapeErrors) * 10) / 10 : null;
    const total = Math.max(0, Math.min(100, SCORING.intonationWeight * inton + SCORING.timingWeight * timing - penalty)) * (result.tempoFactor ?? 1);
    return [Math.round(total * 10) / 10, Math.round(inton * 10) / 10, Math.round(timing * 10) / 10, errors];
  });
}
