// A single practice run: microphone → frames → notes → live follower,
// then alignment + scoring at the end.

import { Segmenter, estimateNoiseFloor, SEG } from './segmenter.js';
import { Follower } from './follower.js';
import { align, detectGlobalOffset, scaleCost, foldPitch } from './align.js';
import { scoreRun } from './scoring.js';
import { Metronome } from './metronome.js';
import { detectionRange } from './instruments.js';
import { freqToMidi } from './theory.js';
import { evaluateDoubleStop, liveDoubleStop, doubleStopCost } from './doublestop.js';
import { renderPerformance, toAudioBuffer } from './audio/synth.js';
import { analyseSignal, windowSizeFor } from './pitch.js';
import { buildExercise } from './exercises.js';
import { buildSequence } from './sequence.js';
import { precisionAt } from './precision.js';
import { applyCalibration } from './calibration.js';

/**
 * Frames whose analysis window may contain a metronome click (clicks fall on
 * every beat from the count-in onwards).
 */
export function clickMask(t0, spb, windowSec = 0.085) {
  const margin = (windowSec || 0.085) / 2 + 0.03;
  return (t) => {
    const d = (((t - t0) % spb) + spb) % spb;
    return d <= margin || spb - d <= margin;
  };
}

/** The exercise's shortest note at the set tempo, in seconds. */
export function shortestNoteSec(seq, bpm) {
  const beats = Math.min(...seq.events.map((e) => e.beats).filter((b) => b > 0));
  return isFinite(beats) ? (beats * 60) / bpm : null;
}

/** Pitches the exercise plays twice in a row (sounding MIDI). */
export function repeatPitches(seq) {
  return [...new Set(seq.events.filter((e) => e.sameAsPrev).map((e) => e.midis[0]))];
}

/**
 * As one note hands over to the next, the detector can briefly hear a note an
 * octave out (a weak fundamental). Drop short notes that sit exactly one or two
 * octaves from a neighbouring note they touch.
 */
export function dropOctaveBlips(notes, { maxDur = 0.25, maxGap = 0.08 } = {}) {
  return notes.filter((d, i) => {
    if (d.midi == null || d.dur > maxDur) return true;
    for (const j of [i - 1, i + 1]) {
      const n = notes[j];
      if (!n || n.midi == null || n.dur <= d.dur) continue;
      const gap = j < i ? d.onset - n.end : n.onset - d.end;
      if (gap > maxGap) continue;
      for (const k of [12, -12, 24, -24]) if (Math.abs(d.midi + k - n.midi) <= 0.6) return false;
    }
    return true;
  });
}

/**
 * Scrapes and clicks at bow changes: notes much shorter than this player's
 * typical note that touch a longer note. "Short" is judged against the run
 * itself, so fast playing keeps its short notes.
 */
export function dropShortBlips(notes, opts = {}) { return findShortBlips(notes, opts).kept; }

/**
 * As dropShortBlips, also returning what was dropped as scrapes: when, how
 * long, and how loud compared with the note it touched (dB, 0 = as loud).
 */
export function findShortBlips(notes, { frac = 0.3, cap = 0.2, maxGap = 0.1 } = {}) {
  const durs = notes.filter((d) => d.dur >= 0.15).map((d) => d.dur).sort((a, b) => a - b);
  if (durs.length < 4) return { kept: notes, scrapes: [] };
  const maxDur = Math.min(cap, frac * durs[Math.floor(durs.length / 2)]);
  const kept = [], scrapes = [];
  notes.forEach((d, i) => {
    let host = null;
    if (d.dur < maxDur) {
      for (const j of [i - 1, i + 1]) {
        const n = notes[j];
        if (!n || n.dur <= d.dur) continue;
        const gap = j < i ? d.onset - n.end : n.onset - d.end;
        if (gap <= maxGap && (!host || n.dur > host.dur)) host = n;
      }
    }
    if (!host) { kept.push(d); return; }
    scrapes.push({ onset: d.onset, dur: d.dur, relDb: relLevel(d, host) });
  });
  return { kept, scrapes };
}

/** Loudest moment of a blip compared with the typical level of the note it touches (dB). */
function relLevel(d, host) {
  const peak = (d.levels || []).reduce((m, x) => Math.max(m, x[1]), -Infinity);
  const ref = (host.levels || []).map((x) => x[1]).sort((a, b) => a - b);
  if (!isFinite(peak) || !ref.length) return 0;
  return peak - ref[Math.floor(ref.length / 2)];
}

/** Does the exercise itself step an octave from one note to the next (broken octaves)? */
export function hasOctaveSteps(events) {
  return events.some((e, k) => k > 0 && e.midis.length === 1 && events[k - 1].midis.length === 1
    && Math.abs(e.midis[0] - events[k - 1].midis[0]) % 12 === 0 && e.midis[0] !== events[k - 1].midis[0]);
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/** Part of a heard note, from start to end (level and pitch readings cut to match). */
function pieceOf(d, start, end) {
  const inside = ([t]) => t >= start && t < end;
  const pitches = d.pitches ? d.pitches.filter(inside) : null;
  const ms = pitches ? pitches.map((p) => p[1]).filter((m) => m != null) : [];
  return {
    ...d, onset: start, end, dur: end - start, split: true,
    levels: d.levels ? d.levels.filter(inside) : d.levels,
    pitches,
    midi: ms.length >= 3 ? median(ms) : d.midi,
  };
}

/** Several heard pieces as one note; their pitches are taken to the run's octave first. */
function joinPieces(parts, target, fold) {
  const toTarget = (m) => (m == null ? m : m - foldPitch(m, target, fold).shift);
  const pitches = parts.flatMap((p) => (p.pitches || []).map(([t, m]) => [t, toTarget(m)]));
  const ms = pitches.map((p) => p[1]).filter((m) => m != null);
  const first = parts[0], last = parts[parts.length - 1];
  return {
    ...first, onset: first.onset, end: last.end, dur: last.end - first.onset, split: true,
    levels: parts.flatMap((p) => p.levels || []),
    pitches,
    midi: ms.length >= 3 ? median(ms) : toTarget(first.midi),
    unsteady: parts.some((p) => p.unsteady),
  };
}

/**
 * A short unsteady sound between two notes whose pitch lies between them is a
 * slide from one to the next (a shift), not a note: it becomes the start of
 * the next note.
 */
export function mergeGlides(notes, { frac = 0.5, maxGap = 0.08 } = {}) {
  const durs = notes.filter((d) => d.dur >= 0.15).map((d) => d.dur);
  if (durs.length < 4) return notes;
  const maxDur = frac * median(durs);
  const out = [];
  for (let i = 0; i < notes.length; i++) {
    const d = notes[i], prev = out[out.length - 1], next = notes[i + 1];
    const glide = d.unsteady && d.dur < maxDur && prev && next && d.midi != null && prev.midi != null && next.midi != null
      && d.onset - prev.end <= maxGap && next.onset - d.end <= maxGap
      && Math.min(prev.midi, next.midi) + 0.3 < d.midi && d.midi < Math.max(prev.midi, next.midi) - 0.3;
    if (!glide) { out.push(d); continue; }
    // the slide joins the next note (its pitch is measured on the next note's own readings)
    notes[i + 1] = { ...next, onset: d.onset, dur: next.end - d.onset, levels: [...(d.levels || []), ...(next.levels || [])], pitches: [...(d.pitches || []), ...(next.pitches || [])], glide: true };
  }
  return out;
}

/**
 * Repeated notes (several of one pitch in a row) are easily heard wrongly: on
 * an open string the repeats run together with no dip in level, or one note is
 * chopped into pieces. Where a run of repeats was heard as a different number
 * of notes, reshape it with the rhythm at the player's own tempo: expected
 * boundaries are snapped to boundaries that were heard, or cut at the
 * quietest moment nearby; pieces between two boundaries become one note.
 * @returns new notes array, or null if nothing changed
 */
export function reshapeRuns(notes, events, alignment, { fold = false, tol = 0.3 } = {}) {
  const noteOf = alignment.pairs.map((p) => p.note);
  const near = (n, target) => notes[n].midi != null && Math.abs(foldPitch(notes[n].midi, target, fold).diff) <= 0.5;
  const ok = (j) => noteOf[j] != null && near(noteOf[j], events[j].midis[0]);
  // the player's tempo: seconds per beat between neighbouring well-matched notes
  const rates = [];
  for (let j = 0; j + 1 < events.length; j++) {
    if (!ok(j) || !ok(j + 1)) continue;
    const beats = events[j + 1].onsetBeat - events[j].onsetBeat;
    const dt = notes[noteOf[j + 1]].onset - notes[noteOf[j]].onset;
    if (beats > 0 && dt > 0) rates.push(dt / beats);
  }
  if (rates.length < 4) return null;
  const spb = median(rates);
  const lenOf = (j) => ((events[j + 1] ? events[j + 1].onsetBeat - events[j].onsetBeat : events[j].beats) || events[j].beats) * spb;
  const extra = new Set(alignment.extras);

  const replace = new Map(); // first member note -> new notes; other members -> []
  for (let s = 0; s < events.length;) {
    let t = s;
    while (t + 1 < events.length && events[t + 1].midis.length === 1 && events[s].midis.length === 1 && events[t + 1].midis[0] === events[s].midis[0]) t++;
    const run = []; for (let j = s; j <= t; j++) run.push(j);
    s = t + 1;
    if (run.length < 2) continue;
    const target = events[run[0]].midis[0];
    // a near miss paired into the run may be a real wrong note: leave the run alone
    if (run.some((j) => noteOf[j] != null && !ok(j) && notes[noteOf[j]].midi != null && Math.abs(notes[noteOf[j]].midi - target) <= 2.5)) continue;
    let members = [...new Set(run.filter(ok).map((j) => noteOf[j]))].sort((a, b) => a - b);
    if (!members.length || members.some((n) => replace.has(n))) continue;
    // unpaired pieces of the same pitch touching the run belong to it
    let grew = true, extras = 0;
    while (grew) {
      grew = false;
      const a = members[0] - 1, b = members[members.length - 1] + 1;
      if (a >= 0 && extra.has(a) && near(a, target) && notes[members[0]].onset - notes[a].end <= 0.1) { members.unshift(a); extras++; grew = true; }
      if (b < notes.length && extra.has(b) && near(b, target) && notes[b].onset - notes[members[members.length - 1]].end <= 0.1) { members.push(b); extras++; grew = true; }
    }
    // also unpaired same-pitch pieces in between
    for (let n = members[0] + 1; n < members[members.length - 1]; n++) if (!members.includes(n)) { if (extra.has(n) && near(n, target)) { members.push(n); extras++; } else { members = null; break; } }
    if (!members) continue;
    members.sort((a, b) => a - b);
    if (members.length === run.length && !extras) continue; // heard as it was played

    const first = notes[members[0]], last = notes[members[members.length - 1]];
    const lens = run.map(lenOf);
    const total = lens.reduce((a, b) => a + b, 0);
    const spanRatio = (last.end - first.onset) / total;
    // much shorter: not this run at the player's tempo (longer is fine – the last note is often held on)
    if (spanRatio < 0.6) continue;
    const ratio = Math.min(1.25, Math.max(0.8, spanRatio));
    // boundaries heard: where one member ends and the next begins
    const heardCuts = [];
    for (let k = 1; k < members.length; k++) heardCuts.push(notes[members[k]].onset, notes[members[k - 1]].end);
    const cuts = [];
    let cum = 0;
    for (let k = 0; k < run.length - 1; k++) {
      cum += lens[k];
      let at = first.onset + ratio * cum;
      const win = 0.35 * ratio * Math.min(lens[k], lens[k + 1]);
      const snap = heardCuts.filter((x) => Math.abs(x - at) <= win).sort((x, y) => Math.abs(x - at) - Math.abs(y - at))[0];
      if (snap != null) at = snap;
      else {
        // inside a note: the quietest moment nearby (a slight bow change)
        const host = members.map((n) => notes[n]).find((d) => d.onset < at && d.end > at);
        const lv = host && host.levels ? host.levels.filter(([tt]) => Math.abs(tt - at) <= Math.min(0.12, win)) : [];
        if (lv.length >= 3) at = lv.reduce((m, x) => (x[1] < m[1] ? x : m))[0];
      }
      cuts.push(at);
    }
    const bounds = [first.onset, ...cuts, last.end];
    if (bounds.some((b, k) => k > 0 && b - bounds[k - 1] < 0.08)) continue;
    // each stretch: the heard pieces inside it, joined (nothing heard = still missing)
    const pieces = [];
    for (let k = 0; k < run.length; k++) {
      const a = bounds[k], b = bounds[k + 1];
      const parts = members.map((n) => notes[n]).filter((d) => Math.min(d.end, b) - Math.max(d.onset, a) >= 0.06)
        .map((d) => pieceOf(d, Math.max(d.onset, a), Math.min(d.end, b)));
      if (!parts.length) continue; // nothing heard in this stretch: that repeat stays missing
      // which repeat it is, so that the alignment cannot put a gap in the wrong place
      pieces.push({ ...joinPieces(parts, target, fold), forEvent: run[k] });
    }
    if (!pieces.length) continue;
    members.forEach((n, k) => replace.set(n, k === 0 ? pieces : []));
  }
  if (!replace.size) return null;
  const out = [];
  notes.forEach((d, i) => { if (replace.has(i)) out.push(...replace.get(i)); else out.push(d); });
  return out;
}

/**
 * Reshaped repeats know which event they are: within a run of one pitch the
 * alignment may pair them one place out (a repeat missing at the start rather
 * than in the middle). Move each to its own event where that one is free.
 */
export function followHints(notes, alignment) {
  const eventOf = new Map(alignment.pairs.filter((p) => p.note != null).map((p) => [p.note, p.event]));
  notes.forEach((d, i) => {
    if (d.forEvent == null || !eventOf.has(i)) return;
    const cur = eventOf.get(i);
    if (cur === d.forEvent || alignment.pairs[d.forEvent].note != null) return;
    alignment.pairs[d.forEvent].note = i;
    alignment.pairs[cur].note = null;
    eventOf.set(i, d.forEvent);
  });
  return alignment;
}

/**
 * From the segmenter's notes to the notes that are scored: drop octave slips
 * and bow-change scrapes, align with the exercise, split repeats that ran
 * together, align again. Used live and when re-analysing a recording.
 */
export function refineNotes(notes, seq, { doubleStop = false, cost, scrapes: keepScrapes = true } = {}) {
  let out = notes;
  let scrapes = [];
  // notes heard an octave (or an octave and a fifth) out are taken as the right note heard at a
  // harmonic – unless the exercise itself steps by octaves
  const fold = !doubleStop && !hasOctaveSteps(seq.events);
  if (!doubleStop) {
    // short octave slips at a change of note (the detector's mistakes, not the player's: not counted);
    // longer ones are kept – which of the two is the real note is decided against the music below
    out = dropOctaveBlips(out);
    // music with staccato or tenuto (a piece) has short notes on purpose: only very short blips are scrapes
    const detached = seq.events.some((e) => e.articulation);
    const b = findShortBlips(out, detached ? { cap: 0.06 } : undefined);
    out = b.kept;
    // bow-change scrapes count as (part) errors, more strictly at higher precision; not for singers (consonants)
    if (keepScrapes) scrapes = b.scrapes;
    out = mergeGlides(out);
  }
  const c = doubleStop ? cost : scaleCost(seq.events, undefined, 3, { fold });
  let alignment = align(out, seq.events, c);
  if (!doubleStop) {
    const fixed = splitMergedRepeats(out, seq.events, alignment);
    if (fixed) { out = fixed; alignment = align(out, seq.events, c); }
    const reshaped = reshapeRuns(out, seq.events, alignment, { fold });
    if (reshaped) { out = reshaped; alignment = followHints(out, align(out, seq.events, c)); }
  }
  return { notes: out, alignment, scrapes, fold };
}

/**
 * A repeated note played with a soft re-articulation (no sharp bow-change dip)
 * is heard as one long note and its repeat as "missing". Where the music
 * expects the same pitch twice and one is missing while its neighbour was heard
 * as a single over-long note, split that note at the deepest level dip near the
 * expected boundary. Without any dip the repeat stays missing.
 * @returns new notes array, or null if nothing changed
 */
export function splitMergedRepeats(notes, events, alignment, { minDipDb = 4 } = {}) {
  let changed = false;
  const out = notes.slice();
  const splitAt = new Map(); // note index -> { at, firstIsMatched }
  alignment.pairs.forEach((p) => {
    if (p.note != null) return;
    const e = events[p.event];
    const tryPartner = (k, partnerIsFirst) => {
      if (k < 0 || k >= events.length) return false;
      const partner = alignment.pairs[k];
      if (partner.note == null || splitAt.has(partner.note)) return false;
      const d = notes[partner.note];
      if (d.midi == null || Math.abs(d.midi - e.midis[0]) > 0.5 || !d.levels || d.levels.length < 10) return false;
      const first = partnerIsFirst ? events[k] : e;
      const second = partnerIsFirst ? e : events[k];
      const frac = first.beats / (first.beats + second.beats);
      const expected = d.onset + frac * d.dur;
      // search ±35 % of the shorter part around the expected boundary
      const span = 0.35 * Math.min(frac, 1 - frac) * d.dur;
      const inner = d.levels.filter(([t]) => t > d.onset + 0.1 * d.dur && t < d.end - 0.05 * d.dur);
      const win = inner.filter(([t]) => Math.abs(t - expected) <= span);
      if (win.length < 3) return false;
      let min = win[0];
      for (const x of win) if (x[1] < min[1]) min = x;
      const sorted = inner.map((x) => x[1]).sort((a, b) => a - b);
      const typical = sorted[Math.floor(sorted.length * 0.6)];
      if (typical - min[1] < minDipDb) return false;
      splitAt.set(partner.note, min[0]);
      return true;
    };
    // the missing event's same-pitch neighbour: before it, or after it
    if (e.sameAsPrev && tryPartner(p.event - 1, true)) changed = true;
    else if (events[p.event + 1] && events[p.event + 1].sameAsPrev && tryPartner(p.event + 1, false)) changed = true;
  });
  if (!changed) return null;
  const result = [];
  out.forEach((d, i) => {
    if (!splitAt.has(i)) { result.push(d); return; }
    const at = splitAt.get(i);
    result.push(pieceOf(d, d.onset, at));
    result.push(pieceOf(d, at, d.end));
  });
  return result;
}

export const RUN = {
  calibrateSec: 0.8,
  endAfterLastSec: 1.5,
  endAfterSilenceSec: 4,
};

export class PracticeSession {
  /**
   * @param {object} o
   * @param {import('./audio/mic.js').AudioEngine} o.engine
   * @param {object} o.exercise  @param {object} o.seq  @param {object} o.settings
   * @param {number} o.a4 @param {object} o.prec
   * @param {object|null} o.synth synthetic performance options (debug), or null for the microphone
   * @param {object|null} [o.calibration] microphone calibration for this instrument
   * @param {object} o.on callbacks: state, pitch, arrow, noteDone, done, error
   */
  constructor(o) {
    this.o = o;
    this.on = o.on;
    this.doubleStop = !!o.exercise.type.doubleStop;
    this.frames = [];
    this.calFrames = [];
    const applied = applyCalibration(o.calibration, o.a4);
    this.a4 = applied.a4;          // includes any pitch correction from calibration
    this.segOpts = applied.segmenter;
    this.segmenter = null;
    // notes heard at an octave still move the arrow, unless the exercise steps by octaves
    // the arrow shows what is due next: it moves on once a note has sounded for about its
    // length (its sounding length – a scale's rhythm can put a rest after it)
    this.follower = new Follower(o.seq.events, {
      pitchless: this.doubleStop, fold: !this.doubleStop && !hasOctaveSteps(o.seq.events),
      spb: o.settings && o.settings.bpm ? 60 / o.settings.bpm : null,
      sound: o.seq.events.map((e) => { const g = o.seq.glyphs && o.seq.glyphs[e.glyphIndex]; return g && g.beats > 0 ? Math.min(g.beats, e.beats) : e.beats; }),
    });
    this.shown = null; // what the arrow shows now (an event, or a beat within a rest)
    this.metronome = null;
    this.t0 = null;
    this.startT = null;
    this.lastVoiced = null;
    this.lastNoteEnd = null;
    this.anyNote = false;
    this.curMatch = -1;
    this.smooth = [];
    this.stopped = false;
    // fault-finding log (included in test-mode downloads)
    this.log = { states: [], onsets: [], gates: [], endReason: null, clock: [], tempo: { set: o.settings.bpm, target: o.targetBpm || null } };
  }

  state(name, extra) {
    this.log.states.push({ t: +(this.o.engine.now() || 0).toFixed(3), s: name, extra: extra ?? null });
    this.on.state(name, extra);
  }

  clockMark(label) {
    this.log.clock.push({ label, audio: this.o.engine.now(), wall: performance.now() });
  }

  async start() {
    const { engine, settings } = this.o;
    const { minFreq, maxFreq } = detectionRange(settings.instrument, this.a4);
    this.minFreq = minFreq; this.maxFreq = maxFreq;
    this.state('starting');
    let buffer = null;
    if (this.o.synth) {
      const ctx = await engine.ensureContext();
      if (this.stopped) return;
      const perf = renderPerformance(this.o.seq, { sampleRate: ctx.sampleRate, a4: this.o.a4, ...this.o.synth });
      buffer = toAudioBuffer(ctx, perf.signal, ctx.sampleRate);
      this.truth = perf.truth;
    }
    await engine.start({
      source: buffer ? 'buffer' : 'mic', buffer, monitor: !!buffer && this.o.synth.monitor !== false, minFreq, maxFreq, peaks: this.doubleStop, capture: !!this.o.capture,
      onFrames: (frames) => frames.forEach((f) => this.frame(f)),
    });
    // stopped (Stop, or another tab) while the microphone was starting: nothing more to do
    if (this.stopped) { engine.stop(); return; }
    this.state('calibrating');
    this.clockMark('start');
    this.on.arrow(0);
  }

  beginListening() {
    const { settings } = this.o;
    const a4 = this.a4;
    const measured = estimateNoiseFloor(this.calFrames);
    // a calibrated room level is more reliable than the first second; take the lower
    const floor = this.segOpts.noiseFloor ? Math.min(this.segOpts.noiseFloor, measured) : measured;
    this.noiseFloor = floor;
    this.segmenter = new Segmenter({
      ...this.segOpts,
      a4, noiseFloor: floor, vibrato: settings.vibrato, voice: settings.instrument === 'voice', shortestNoteSec: shortestNoteSec(this.o.seq, settings.bpm), minFreq: this.minFreq, maxFreq: this.maxFreq, pitchless: this.doubleStop,
      repeats: this.o.seq.events.some((e) => e.sameAsPrev),
      repeatPitches: repeatPitches(this.o.seq),
      onOnset: (n) => {
        this.anyNote = true;
        const jumpsBefore = this.follower.jumps;
        this.curMatch = this.follower.onset(n.nominal, n.onset);
        this.log.onsets.push({ t: +n.onset.toFixed(3), heard: n.nominal, matched: this.curMatch, ...(this.follower.jumps > jumpsBefore ? { refound: true } : {}) });
        this.showDue(n.onset);
      },
      onNote: (n) => {
        this.lastNoteEnd = n.end;
        const k = this.curMatch;
        this.curMatch = -1;
        this.follower.release(n.end);
        this.showDue(n.end);
        if (k >= 0) {
          const e = this.o.seq.events[k];
          let cents;
          if (this.doubleStop) cents = evaluateDoubleStop(n, e, a4).cents;
          else cents = [(n.midi - e.midis[0]) * 100];
          this.on.noteDone(k, cents);
        }
      },
    });
    // a student (or recording) that started during the room check still counts
    for (const f of this.calFrames) this.segmenter.push(f);
    if (settings.metronome && this.o.engine.ctx) {
      this.metronome = new Metronome(this.o.engine.ctx);
      this.t0 = this.metronome.start(settings.bpm, { onCountIn: (b) => this.state('countin', b) });
      this.segmenter.o.clickMask = clickMask(this.t0, 60 / settings.bpm, this.o.engine.windowSize / this.o.engine.ctx.sampleRate);
      setTimeout(() => { if (!this.stopped) this.state('listening'); }, Math.max(0, (this.t0 - this.o.engine.now()) * 1000));
    } else {
      this.state('listening');
    }
  }

  frame(f) {
    if (this.stopped) return;
    // the arrow stuck in one place for too long: find where the player is from the last notes heard
    if (this.follower && this.follower.tick(f.t)) {
      this.log.onsets.push({ t: +f.t.toFixed(3), refound: true, matched: this.follower.arrow });
    }
    if (this.follower && this.segmenter) this.showDue(f.t);
    if (this.startT == null) this.startT = f.t;
    this.frames.push(f);
    if (!this.segmenter) {
      this.calFrames.push(f);
      if (f.t - this.startT >= RUN.calibrateSec) this.beginListening();
      return;
    }
    this.segmenter.push(f);
    this.live(f);
    if (!this.lastGateLog || f.t - this.lastGateLog >= 0.5) {
      this.lastGateLog = f.t;
      this.log.gates.push({ t: +f.t.toFixed(2), floor: +this.segmenter.noiseFloor.toPrecision(3), gate: +this.segmenter.gate.toPrecision(3) });
    }
    // automatic end
    if (this.segmenter.sounding) this.lastVoiced = f.t;
    const quietFor = this.lastVoiced != null ? f.t - this.lastVoiced : 0;
    if (this.anyNote && !this.segmenter.sounding) {
      if (this.follower.finished && quietFor >= RUN.endAfterLastSec) this.finish('finished: last note played, then quiet');
      else if (quietFor >= RUN.endAfterSilenceSec) this.finish(`ended after ${RUN.endAfterSilenceSec} s of silence`);
    }
  }

  /** Point the arrow at what is due to be played (moving along a rest in time). */
  showDue(t) {
    const d = this.follower.due(t);
    if (d.restBeat != null) {
      this.shown = null;
      if (this.on.rest) this.on.rest(d.restBeat);
      return;
    }
    if (this.shown === d.event) return;
    this.shown = d.event;
    this.on.arrow(d.event);
  }

  /** The note being played now (for the tuning bar), else the one due. */
  soundingEvent() { return this.follower.current >= 0 ? this.follower.current : this.follower.arrow; }

  live(f) {
    const { settings } = this.o;
    const a4 = this.a4;
    const gate = this.segmenter.gate; // follows the running background-noise estimate
    if (this.doubleStop) {
      const ev = this.o.seq.events[this.soundingEvent()];
      const pair = f.rms >= gate ? liveDoubleStop(f.peaks, ev, a4) : null;
      this.on.pitch(pair ? { pair, event: ev } : null);
      return;
    }
    const voiced = f.rms >= gate && f.freq > 0 && f.clarity >= 0.6 && f.freq >= this.minFreq && f.freq <= this.maxFreq;
    if (!voiced) { this.smooth = []; this.on.pitch(null); return; }
    let m = freqToMidi(f.freq, a4);
    // fold an octave error towards the expected note for display only
    const k = this.soundingEvent();
    const ev = this.o.seq.events[k];
    if (ev) {
      const exp = ev.midis[0];
      const r = Math.round(m);
      if (Math.abs(r - exp) === 12) m += exp - r;
    }
    // smoothing: ~1 vibrato cycle with vibrato, a few frames without
    const span = settings.vibrato || settings.instrument === 'voice' ? 0.2 : 0.035;
    this.smooth.push({ t: f.t, m });
    while (this.smooth.length && f.t - this.smooth[0].t > span) this.smooth.shift();
    const avg = this.smooth.reduce((a, x) => a + x.m, 0) / this.smooth.length;
    this.on.pitch({ midi: avg, event: k });
  }

  finish(reason = 'Stop pressed') {
    if (this.stopped) return;
    this.stopped = true;
    this.log.endReason = reason;
    this.clockMark('end');
    if (this.metronome) this.metronome.stop();
    this.o.engine.stop();
    if (!this.segmenter) { this.on.done(null); return; }
    this.segmenter.flush();
    const notes = this.segmenter.notes;
    const { seq, prec } = this.o;
    const a4 = this.a4;
    const cost = this.doubleStop ? doubleStopCost(a4) : undefined;
    const refined = refineNotes(notes, seq, { doubleStop: this.doubleStop, cost, scrapes: this.o.settings.instrument !== 'voice' });
    notes.splice(0, notes.length, ...refined.notes); // in place: the capture refers to these notes by index
    const alignment = refined.alignment;
    const result = scoreRun({
      expected: seq.events, detected: notes, alignment, prec,
      metronome: this.t0 != null ? { t0: this.t0, spb: 60 / this.o.settings.bpm } : null,
      doubleStopEval: this.doubleStop ? (n, e) => evaluateDoubleStop(n, e, a4) : null,
      scrapes: refined.scrapes,
      fold: refined.fold,
      targetBpm: this.o.targetBpm || null,
      setBpm: this.o.settings.bpm,
      piece: !!this.o.exercise.isPiece,
    });
    result.noiseFloor = this.noiseFloor;
    if (!this.doubleStop) result.globalOffset = detectGlobalOffset(notes, seq.events);
    this.on.done(result);
  }

  stop() { this.finish(); }

  abort() {
    this.stopped = true;
    if (this.metronome) this.metronome.stop();
    this.o.engine.stop();
  }
}

/**
 * Re-run the whole listening pipeline on a recording, exactly as a live run
 * would (same calibration, segmenter, alignment and scoring). Used by the
 * replay page to study recordings captured in test mode.
 * @param {object} o { samples, sampleRate, settings, a4, startTime, metronomeT0, calibration }
 */
export function analyseRecording(o) {
  const { samples, sampleRate, settings, startTime = 0, metronomeT0 = null, calibration: cal = null } = o;
  const applied = applyCalibration(cal, o.a4 ?? 440);
  const a4 = applied.a4;
  const exercise = buildExercise(settings);
  const seq = buildSequence(exercise);
  const s = exercise.settings;
  const doubleStop = !!exercise.type.doubleStop;
  const { minFreq, maxFreq } = detectionRange(s.instrument, a4);
  const frames = analyseSignal(samples, sampleRate, { minFreq, maxFreq, peaks: doubleStop, startTime });
  const t0 = frames.length ? frames[0].t : startTime;
  const measured = estimateNoiseFloor(frames.filter((f) => f.t - t0 < RUN.calibrateSec));
  const noiseFloor = applied.segmenter.noiseFloor ? Math.min(applied.segmenter.noiseFloor, measured) : measured;
  const segmenter = new Segmenter({ ...applied.segmenter, a4, noiseFloor, vibrato: s.vibrato, voice: s.instrument === 'voice', shortestNoteSec: shortestNoteSec(seq, s.bpm), minFreq, maxFreq, pitchless: doubleStop, repeats: seq.events.some((e) => e.sameAsPrev), repeatPitches: repeatPitches(seq),
    clickMask: metronomeT0 != null ? clickMask(metronomeT0, 60 / s.bpm, windowSizeFor(sampleRate, minFreq) / sampleRate) : undefined });
  for (const f of frames) segmenter.push(f); // same as live: calibration frames are analysed too
  segmenter.flush();
  const notes = segmenter.notes;
  const refined = refineNotes(notes, seq, { doubleStop, cost: doubleStop ? doubleStopCost(a4) : undefined, scrapes: s.instrument !== 'voice' });
  notes.splice(0, notes.length, ...refined.notes);
  const alignment = refined.alignment;
  const prec = precisionAt(s.precision, s.instrument);
  const result = scoreRun({
    expected: seq.events, detected: notes, alignment, prec,
    metronome: metronomeT0 != null ? { t0: metronomeT0, spb: 60 / s.bpm } : null,
    doubleStopEval: doubleStop ? (n, e) => evaluateDoubleStop(n, e, a4) : null,
    scrapes: refined.scrapes,
    fold: refined.fold,
  });
  if (!doubleStop) result.globalOffset = detectGlobalOffset(notes, seq.events);
  const gate = segmenter.gate;
  return { exercise, seq, frames, notes, alignment, result, noiseFloor: segmenter.noiseFloor, gate, prec, minFreq, maxFreq };
}
