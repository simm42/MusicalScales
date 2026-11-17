// Live score follower: decides which expected note the student is on, to
// move the arrow. No DOM access.
//
//  - A note is looked for a little way ahead. Repeats of the note just
//    played are skipped over first: repeated quavers often run together into
//    one heard note, so the next pitch can be several events on.
//  - A note heard an octave (or an octave and a fifth) out still matches,
//    unless the exercise itself steps by octaves.
//  - If the arrow gets stuck – a note that doesn't fit, or the same place for
//    much longer than the player's tempo suggests – the last few notes heard
//    are compared with the music further on, and the arrow jumps to where
//    they fit best.

const SHIFTS = [0, 12, -12, 19, -19, 24];

export const FOLLOW = {
  lookahead: 2,      // events looked at beyond the current note's repeats
  history: 5,        // notes heard, used to find the place again
  searchAhead: 16,   // how far on to look for it
  minFit: 3,         // heard notes that must fit to jump (fewer early in a run)
  stuckFactor: 2.5,  // stuck: on one place this many times longer than expected…
  stuckMinSec: 1.5,  // …and at least this long
  maxBeatsUnknown: 6, // furthest jump (in beats) before the player's tempo is known
};

export class Follower {
  constructor(events, { lookahead = FOLLOW.lookahead, pitchless = false, fold = false } = {}) {
    this.events = events;
    this.lookahead = lookahead;
    this.pitchless = pitchless;
    this.fold = fold;
    this.pos = 0;          // next expected event
    this.current = -1;     // event currently sounding (matched)
    this.provisionalExtras = 0;
    this.heard = [];       // recent onsets {nominal, t}
    this.matches = [];     // matched onsets {event, t} (for the player's tempo)
    this.lastMoveT = null; // when the arrow last moved on
    this.jumps = 0;
  }

  /** Does a heard nominal pitch fit an event (with `harmonic`, also an octave or so out)? */
  fits(nominal, k, harmonic = false) {
    const e = this.events[k];
    if (!e) return false;
    const shifts = harmonic && this.fold ? SHIFTS : [0];
    return e.midis.some((m) => shifts.some((s) => m + s === nominal));
  }

  /** The events a new note may be: the rest of the current repeats, then `lookahead` more. */
  window() {
    const ev = this.events;
    let j = this.pos;
    const last = this.matches.length ? ev[this.matches[this.matches.length - 1].event] : null;
    const same = (k) => last && ev[k] && ev[k].midis.length === last.midis.length && ev[k].midis.every((m, i) => m === last.midis[i]);
    while (j < ev.length && same(j)) j++;
    return [this.pos, Math.min(ev.length, j + 1 + this.lookahead)];
  }

  /** A new note has started. @returns matched event index or -1 */
  onset(nominal, t = null) {
    if (this.pos >= this.events.length) { this.provisionalExtras++; return -1; }
    if (this.pitchless || nominal == null) return this.moveTo(this.pos, t);
    const entry = { nominal, t, matched: false };
    this.heard.push(entry);
    if (this.heard.length > FOLLOW.history) this.heard.shift();
    const [from, to] = this.window();
    // the note just played, sounding again (a bounce, a re-bow): it may be its next repeat, but not a
    // later return to the same pitch past a note that was never heard (E F E: the F must be heard first)
    const lastEv = this.matches.length ? this.events[this.matches[this.matches.length - 1].event] : null;
    const isLast = (k) => lastEv && this.events[k].midis.length === lastEv.midis.length && this.events[k].midis.every((m, i) => m === lastEv.midis[i]);
    const reachable = (k) => {
      if (!lastEv || !isLast(k)) return true;
      for (let q = from; q < k; q++) if (!isLast(q)) return false;
      return true;
    };
    // the exact note nearby first; only then the same note heard an octave (or so) out
    for (const harmonic of [false, true]) {
      for (let k = from; k < to; k++) if (this.fits(nominal, k, harmonic) && reachable(k)) { entry.matched = true; return this.moveTo(k, t); }
    }
    // doesn't fit nearby: perhaps the arrow has fallen behind
    const k = this.refind(t);
    if (k >= 0) { this.jumps++; entry.matched = true; return this.moveTo(k, t); }
    this.provisionalExtras++;
    return -1;
  }

  moveTo(k, t) {
    this.current = k;
    this.pos = k + 1;
    this.matches.push({ event: k, t });
    if (this.matches.length > 12) this.matches.shift();
    this.lastMoveT = t;
    return k;
  }

  /**
   * Where is the player, judging by the last notes heard? From each candidate
   * place ahead, walk back through the music: the heard notes should appear in
   * the same order (gaps allowed – notes can go unheard, repeats run
   * together). To jump:
   *  - at least two heard notes not placed yet must fit at or beyond the arrow
   *    (notes already placed, or that fit where the arrow already was, are no
   *    evidence of moving on);
   *  - at least three of the last five must fit overall;
   *  - exact pitches only – a note heard an octave out is never a reason to jump;
   *  - no further than the time since the last matched note allows at the
   *    player's tempo.
   * The nearest place that passes is taken.
   * @returns event index, or -1 if nowhere fits well enough
   */
  refind(t = null) {
    const h = this.heard;
    if (h.length < 2) return -1;
    const need = Math.min(FOLLOW.minFit, h.length);
    const ev = this.events;
    // how far on the player can have got since the last matched note
    const last = this.matches[this.matches.length - 1];
    const spb = this.secondsPerBeat();
    const here = ev[Math.min(this.pos, ev.length - 1)];
    const maxBeats = last && last.t != null && t != null
      ? (spb ? 1.5 * (t - last.t) / spb + 2 : FOLLOW.maxBeatsUnknown)
      : FOLLOW.maxBeatsUnknown;
    for (let k = this.pos; k < Math.min(ev.length, this.pos + FOLLOW.searchAhead); k++) {
      if (here && ev[k].onsetBeat != null && here.onsetBeat != null && ev[k].onsetBeat - here.onsetBeat > maxBeats) break;
      const newest = h[h.length - 1];
      if (!this.fits(newest.nominal, k)) continue; // the newest note must be this one
      let fit = 1, ahead = 1, j = k - 1;
      for (let i = h.length - 2; i >= 0 && j >= 0; i--) {
        let found = -1;
        for (let q = j; q >= Math.max(0, j - 6); q--) if (this.fits(h[i].nominal, q)) { found = q; break; }
        if (found < 0) continue; // a stray note: try the next one back
        fit++;
        // evidence of moving on: a note not placed yet that fits at or beyond the arrow
        if (found >= this.pos && !h[i].matched) ahead++;
        j = found - 1;
      }
      if (ahead >= 2 && fit >= need) return k; // the nearest place that fits
    }
    return -1;
  }

  /** The player's tempo: seconds per beat between recent matched notes (null until known). */
  secondsPerBeat() {
    const r = [];
    for (let i = 1; i < this.matches.length; i++) {
      const a = this.matches[i - 1], b = this.matches[i];
      const beats = this.events[b.event].onsetBeat - this.events[a.event].onsetBeat;
      if (a.t != null && b.t != null && beats > 0 && b.t > a.t) r.push((b.t - a.t) / beats);
    }
    if (r.length < 2) return null;
    r.sort((x, y) => x - y);
    return r[Math.floor(r.length / 2)];
  }

  /**
   * Called as time passes. If the arrow has stayed put much longer than the
   * notes there should last, look again at where the last notes heard fit.
   * @returns true if the arrow moved
   */
  tick(t) {
    if (this.pitchless || this.lastMoveT == null || this.pos >= this.events.length || this.heard.length < 2) return false;
    const spb = this.secondsPerBeat();
    if (!spb) return false;
    // the time the notes still to come at this place should take: the current note and its repeats
    let beats = 0;
    const here = this.arrow;
    for (let k = here; k < this.events.length && this.events[k].midis[0] === this.events[here].midis[0]; k++) beats += this.events[k].beats;
    const limit = Math.max(FOLLOW.stuckMinSec, FOLLOW.stuckFactor * beats * spb);
    if (t - this.lastMoveT < limit) return false;
    // only move on if something was heard after the arrow last moved
    if (!this.heard.some((x) => x.t != null && x.t > this.lastMoveT)) return false;
    const k = this.refind(t);
    if (k < 0 || k <= this.arrow) { this.lastMoveT = t; return false; } // nothing better: check again later
    this.jumps++;
    this.heard.forEach((x) => { x.matched = true; });
    this.moveTo(k, t);
    this.current = -1; // the note that fitted has started already
    return true;
  }

  /** The sounding note ended. */
  release() { this.current = -1; }

  /** Event the arrow should point at. */
  get arrow() { return this.current >= 0 ? this.current : Math.min(this.pos, this.events.length - 1); }

  get finished() { return this.pos >= this.events.length; }
}
