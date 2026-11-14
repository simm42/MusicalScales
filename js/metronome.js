// Web Audio metronome with a one-bar count-in. Clicks are scheduled on the
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
   * @param {(beat:number)=>void} [onCountIn] called (approximately) on each count-in beat
   */
  start(bpm, { countIn = 4, onCountIn } = {}) {
    this.stop();
    const spb = 60 / bpm;
    const t0 = this.ctx.currentTime + 0.15 + countIn * spb;
    let next = t0 - countIn * spb;
    let beat = -countIn;
    const tick = () => {
      while (next < this.ctx.currentTime + 0.12) {
        this.click(next, (beat % 4 + 4) % 4 === 0);
        if (beat < 0 && onCountIn) {
          const b = beat;
          setTimeout(() => onCountIn(countIn + b + 1), Math.max(0, (next - this.ctx.currentTime) * 1000));
        }
        next += spb;
        beat++;
      }
    };
    tick();
    this.timer = setInterval(tick, 25);
    this.t0 = t0;
    this.spb = spb;
    return t0;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
