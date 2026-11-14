// Live score follower: decides which expected note the student is on, to
// move the arrow. Greedy with a small lookahead. No DOM access.

export class Follower {
  constructor(events, { lookahead = 2, pitchless = false } = {}) {
    this.events = events;
    this.lookahead = lookahead;
    this.pitchless = pitchless;
    this.pos = 0;          // next expected event
    this.current = -1;     // event currently sounding (matched)
    this.provisionalExtras = 0;
  }

  /** A new note has started. @returns matched event index or -1 */
  onset(nominal) {
    if (this.pos >= this.events.length) { this.provisionalExtras++; return -1; }
    if (this.pitchless || nominal == null) { this.current = this.pos++; return this.current; }
    for (let k = this.pos; k < Math.min(this.events.length, this.pos + 1 + this.lookahead); k++) {
      if (this.events[k].midis.includes(nominal)) { this.current = k; this.pos = k + 1; return k; }
    }
    this.provisionalExtras++;
    return -1;
  }

  /** The sounding note ended. */
  release() { this.current = -1; }

  /** Event the arrow should point at. */
  get arrow() { return this.current >= 0 ? this.current : Math.min(this.pos, this.events.length - 1); }

  get finished() { return this.pos >= this.events.length; }
}
