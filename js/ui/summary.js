// End-of-run summary: totals, cents-per-note chart and per-note table.

import { noteName } from '../theory.js';
import { badness, badnessColor } from '../precision.js';
import { readPalette, fmtCents } from './meter.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r0 = (x) => Math.round(x);

function chart(result, prec) {
  const pal = readPalette();
  const rows = result.perNote;
  const n = rows.length;
  const W = Math.max(320, n * 16 + 40), H = 160, mid = H / 2, left = 34, step = (W - left - 6) / n, LIM = 50;
  const y = (c) => mid - (Math.max(-LIM, Math.min(LIM, c)) / LIM) * (mid - 10);
  let s = `<div class="table-wrap"><svg class="chart" style="min-width:${Math.min(W, n * 11 + 40)}px" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cents sharp or flat for each note">`;
  s += `<rect x="${left}" y="${y(prec.fullCents)}" width="${W - left - 6}" height="${y(-prec.fullCents) - y(prec.fullCents)}" fill="rgb(${pal.good.join(',')})" opacity=".12"/>`;
  for (const c of [-50, -25, 0, 25, 50]) {
    s += `<line x1="${left}" x2="${W - 6}" y1="${y(c)}" y2="${y(c)}" stroke="currentColor" opacity="${c === 0 ? 0.5 : 0.15}"/>`;
    s += `<text x="${left - 4}" y="${y(c) + 4}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">${c > 0 ? '+' : ''}${c}</text>`;
  }
  rows.forEach((r, i) => {
    const x = left + i * step + step * 0.18;
    const w = step * 0.64;
    if (r.status === 'missing') {
      s += `<text x="${x + w / 2}" y="${mid + 4}" font-size="11" text-anchor="middle" fill="currentColor" opacity=".45">×</text>`;
      return;
    }
    const cs = r.cents || [];
    cs.forEach((c, k) => {
      if (c == null) return;
      const ww = w / cs.length;
      const xx = x + k * ww;
      const col = r.status === 'wrong' ? `rgb(${pal.bad.join(',')})` : badnessColor(badness(c, prec), pal);
      const yy = y(c);
      s += `<rect x="${xx}" y="${Math.min(yy, mid)}" width="${Math.max(1, ww - 1)}" height="${Math.max(1.5, Math.abs(yy - mid))}" fill="${col}" rx="1.5"><title>${r0(c)} cents</title></rect>`;
    });
  });
  return s + '</svg></div>';
}

function offsetNotice(result) {
  const g = result.globalOffset;
  if (!g) return '';
  const c = Math.abs(g.cents);
  const amount = c >= 100 ? `${(c / 100).toFixed(1).replace(/\.0$/, '')} semitone${c >= 150 ? 's' : ''}` : `${c} cents`;
  return `<div class="notice error"><b>Everything sounded about ${amount} ${g.cents < 0 ? 'lower' : 'higher'} than expected.</b>
    Shifted by that amount, ${g.matched} of ${g.of} notes would match (only ${g.matchedAsPlayed} as played). Check that the instrument is tuned to the A set in the options –
    or, if a recording is playing, that it really is this exercise at concert pitch. If your microphone or device shifts the pitch, use <b>Calibrate microphone</b> on the Tuner page.</div>`;
}

/**
 * @param {HTMLElement} el
 * @param {object} o  { result, seq, prec, settings, title }
 */
export function renderSummary(el, { result, seq, prec, settings }) {
  if (!result) { el.innerHTML = ''; return; }
  const ev = seq.events;
  const label = (r) => ev[r.event].notes.map((n) => noteName(n, { octave: true })).join(' + ');
  const statusPill = (r) => {
    if (r.status === 'missing') return '<span class="pill missing">missing</span>';
    if (r.status === 'wrong') return '<span class="pill wrong">wrong note</span>';
    let p = '<span class="pill ok">ok</span>';
    if (r.unsteady) p += ' <span class="pill unsteady" title="pitch wobbled more than ±20 cents">unsteady</span>';
    if (r.approx) p += ' <span class="pill unsteady" title="octave double stops can only be measured approximately">approx.</span>';
    return p;
  };
  const centsCell = (r) => (r.cents ? r.cents.map((c) => (c == null ? 'not heard' : fmtCents(c).replace(' cents', ''))).join(' / ') : '–');
  const timingCell = (r) => {
    if (r.status === 'missing' || r.timingDev == null) return '–';
    const p = Math.round(r.timingDev * 100);
    return p === 0 ? '0%' : `${p > 0 ? '+' : '−'}${Math.abs(p)}%`;
  };
  const rows = result.perNote.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(label(r))}</td><td>${centsCell(r)}</td><td>${r0(r.intonation)}</td><td>${timingCell(r)}</td><td>${r0(r.timing)}</td><td style="text-align:left">${statusPill(r)}</td></tr>`).join('');
  const tempo = result.bpm ? ` · tempo ≈ ♩ ${Math.round(result.bpm)}` : '';
  el.innerHTML = `
    <div class="summary">
      <h3 style="margin:0 0 10px">Your result</h3>
      <div class="totals">
        <div class="stat total"><div class="v">${r0(result.total)}</div><div class="l">Total / 100</div></div>
        <div class="stat"><div class="v">${r0(result.intonation)}</div><div class="l">Intonation (75%)</div></div>
        <div class="stat"><div class="v">${r0(result.timing)}</div><div class="l">Timing (25%)</div></div>
        <div class="stat"><div class="v">${result.extras.length}</div><div class="l">Extra notes (−${result.penalty})</div></div>
      </div>
      ${offsetNotice(result)}
      <p class="muted small">Precision: ${esc(prec.name)} (full marks within ±${prec.fullCents.toFixed(0)} cents) · Vibrato ${settings.vibrato ? 'on' : 'off'} · ${result.missing} missing · ${result.wrong} wrong${tempo}${settings.metronome ? ' · timed against the metronome' : ' · timed against your own pulse'}</p>
      ${chart(result, prec)}
      <div class="table-wrap"><table class="notes">
        <thead><tr><th>#</th><th>Note</th><th>Cents</th><th>Tuning</th><th>Timing</th><th>Score</th><th style="text-align:left">Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
}
