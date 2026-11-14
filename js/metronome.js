// Web Audio metronome with an optional count-in. Clicks are scheduled on the
// audio clock, which is also the clock the pitch frames are stamped with.

export class Metronome {
  constructor(ctx) {
    this.ctx = ctx;
    this.timer = null;
    this.out = ctx.createGain();
    this.out.gain.value = 0.35;
    this.out.connect(ctx.destination);
  }

  click(time, accent) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(accent ? 1 : 0.6, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    osc.connect(g).connect(this.out);
    osc.start(time);
    osc.stop(time + 0.04);
  }

  /**
   * Start clicking. @returns time (audio clock) of the first beat after the count-in.
   * @param {number} bpm crotchet beats per minute
   * @param {object} [o]
   * @param {number} [o.countIn=4] beats of count-in before beat 0
   * @param {number} [o.beatsPerBar=4] accent on the first beat of each bar (1 = no accents)
   * @param {(beat:number)=>void} [o.onCountIn] called on each count-in beat (1, 2, 3, …)
   * @param {(beatInBar:number)=>void} [o.onBeat] called on every beat, for a visual pulse
   */
  start(bpm, { countIn = 4, beatsPerBar = 4, onCountIn, onBeat } = {}) {
    this.stop();
    const spb = 60 / bpm;
    const t0 = this.ctx.currentTime + 0.15 + countIn * spb;
    let next = t0 - countIn * spb;
    let beat = -countIn;
    const bar = Math.max(1, beatsPerBar);
    const tick = () => {
      while (next < this.ctx.currentTime + 0.12) {
        const inBar = ((beat % bar) + bar) % bar;
        this.click(next, bar > 1 && inBar === 0);
        const delay = Math.max(0, (next - this.ctx.currentTime) * 1000);
        if (beat < 0 && onCountIn) { const b = beat; setTimeout(() => onCountIn(countIn + b + 1), delay); }
        if (onBeat) setTimeout(() => { if (this.timer) onBeat(inBar); }, delay);
        next += spb;
        beat++;
      }
    };
    this.timer = setInterval(tick, 25);
    tick();
    this.t0 = t0;
    this.spb = spb;
    return t0;
  }

  get running() { return !!this.timer; }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
