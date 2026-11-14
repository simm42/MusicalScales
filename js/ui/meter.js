// Vertical tuner bar(s) with a large note readout.
// Bar grows upwards when sharp, downwards when flat; colour goes from green
// (in tune) through amber to red according to the precision tolerances.

import { badness, badnessColor } from '../precision.js';

const RANGE = 50; // cents shown from centre to the end of the bar

export function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const rgb = (n) => cs.getPropertyValue(n).split(',').map((x) => parseInt(x, 10));
  return { good: rgb('--good-rgb'), warn: rgb('--warn-rgb'), bad: rgb('--bad-rgb') };
}

export class Meter {
  constructor(container) {
    this.root = container;
    this.root.innerHTML = '';
    this.metersEl = document.createElement('div');
    this.metersEl.className = 'meters';
    this.readout = document.createElement('div');
    this.readout.className = 'readout';
    this.readout.innerHTML = '<div class="note">–</div><div class="cents">&nbsp;</div><div class="hint"></div>';
    this.root.append(this.metersEl, this.readout);
    this.bars = [];
    this.setCount(1);
    this.palette = readPalette();
  }

  setCount(n) {
    if (this.bars.length === n) return;
    this.metersEl.innerHTML = '';
    this.bars = [];
    for (let i = 0; i < n; i++) {
      const m = document.createElement('div');
      m.className = 'meter';
      m.setAttribute('role', 'img');
      for (const c of [-25, -10, 10, 25]) {
        const t = document.createElement('div');
        t.className = 'tick';
        t.style.top = `${50 - (c / RANGE) * 50}%`;
        m.appendChild(t);
      }
      const zero = document.createElement('div');
      zero.className = 'zero';
      const bar = document.createElement('div');
      bar.className = 'bar';
      m.append(zero, bar);
      this.metersEl.appendChild(m);
      this.bars.push({ m, bar });
    }
  }

  refreshPalette() { this.palette = readPalette(); }

  /** cents: number or null (silence). prec: tolerances for colour. */
  setBar(i, cents, prec) {
    const b = this.bars[i];
    if (!b) return;
    if (cents == null || !isFinite(cents)) {
      b.bar.style.height = '0';
      b.m.setAttribute('aria-label', 'no note');
      return;
    }
    const frac = Math.min(1, Math.abs(cents) / RANGE) * 50;
    const h = Math.max(1.5, frac);
    b.bar.style.height = `${h}%`;
    b.bar.style.top = cents >= 0 ? `${50 - h}%` : '50%';
    b.bar.style.backgroundColor = badnessColor(badness(cents, prec), this.palette);
    b.m.setAttribute('aria-label', `${cents >= 0 ? '+' : ''}${Math.round(cents)} cents`);
  }

  setReadout(note, centsText, hint = '') {
    const [n, c, h] = this.readout.children;
    n.textContent = note || '–';
    c.innerHTML = centsText || '&nbsp;';
    h.textContent = hint;
  }

  clear(hint = '') {
    this.bars.forEach((_, i) => this.setBar(i, null));
    this.setReadout('–', '', hint);
  }
}

export function fmtCents(c) {
  if (c == null || !isFinite(c)) return '–';
  const r = Math.round(c);
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)} cents`;
}
