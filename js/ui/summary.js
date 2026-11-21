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

const shiftName = (s) => ({ 12: 'an octave up', 19: 'an octave and a fifth up', 24: 'two octaves up', '-12': 'an octave down', '-19': 'an octave and a fifth down' }[String(Math.round(s))] || 'at a harmonic');

/** Whole numbers as they are, part errors to one decimal ("1.4"). */
const fmtErrors = (x) => (x == null ? '–' : Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));

function scrapeNote(result, prec) {
  const s = result.scrapes;
  if (!s || !s.length) return '';
  const counted = s.reduce((a, x) => a + x.weight, 0);
  const extras = result.extras.length;
  return `<p class="muted small">${s.length} bow-change scrape${s.length === 1 ? '' : 's'} heard${counted > 0.05
    ? ` – counted as ${fmtErrors(counted)} error${Math.abs(counted - 1) < 0.05 ? '' : 's'} at ${esc(prec.name)} precision (longer and louder scrapes count more)`
    : ` – too small to count at ${esc(prec.name)} precision`}${extras ? `; ${extras} extra note${extras === 1 ? '' : 's'}` : ''}.</p>`;
}

/** A piece: the tempo it was played at against its written tempo, and what playing slower cost. */
function tempoNote(result) {
  const target = result.targetBpm;
  if (!target) return '';
  const played = Math.round(result.playedBpm || result.setBpm || 0);
  if (!played) return '';
  const pct = Math.round((played / target) * 100);
  const set = result.setBpm && Math.abs(result.setBpm - played) >= 3 ? ` (practice tempo ♩ = ${Math.round(result.setBpm)})` : '';
  const f = result.tempoFactor ?? 1;
  if (f >= 0.9995) return `<p class="small">Tempo: ♩ ≈ ${played}${set} – ${pct >= 97 ? 'at' : 'close to'} the written ♩ = ${target}, so nothing was taken off.</p>`;
  const cut = (1 - f) * 100;
  return `<p class="small">Tempo: ♩ ≈ ${played}${set}, ${pct}% of the written ♩ = ${target}, so the total was reduced by ${cut < 1 ? cut.toFixed(1) : Math.round(cut)}%. Practising slower is a good way to learn a piece – play at the written tempo for the full score.</p>`;
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
/**
 * @param {boolean} [o.details] the sound-analysis notes (scrapes, notes heard at a harmonic,
 *   re-checked notes): Test mode only – students see the plain result
 */
export function renderSummary(el, { result, seq, labels = null, prec, settings = {}, title = 'Your result', details = false }) {
  if (!result) { el.innerHTML = ''; return; }
  // note names come from the sequence (live run) or are given (a stored run)
  const label = (r, i) => (labels ? labels[i] : seq.events[r.event].notes.map((n) => noteName(n, { octave: true })).join(' + '));
  const statusPill = (r) => {
    if (r.status === 'missing') return '<span class="pill missing">missing</span>';
    if (r.status === 'wrong') return '<span class="pill wrong">wrong note</span>';
    let p = '<span class="pill ok">ok</span>';
    if (r.unsteady) p += ' <span class="pill unsteady" title="pitch wobbled more than ±20 cents">unsteady</span>';
    if (!details) return p;
    if (r.approx) p += ' <span class="pill unsteady" title="octave double stops can only be measured approximately">approx.</span>';
    if (r.heardShift) p += ` <span class="pill unsteady" title="The microphone heard this note at a harmonic (common with low strings on phone microphones); it was scored as the right note">heard ${esc(shiftName(r.heardShift))}</span>`;
    else if (r.rechecked) p += ' <span class="pill unsteady" title="Part of this note was heard off (a slide or a stray reading); it was scored on the part at the right pitch">re-checked</span>';
    return p;
  };
  const centsCell = (r) => (r.cents ? r.cents.map((c) => (c == null ? 'not heard' : fmtCents(c).replace(' cents', ''))).join(' / ') : '–');
  const timingCell = (r) => {
    if (r.status === 'missing' || r.timingDev == null) return '–';
    const p = Math.round(r.timingDev * 100);
    return p === 0 ? '0%' : `${p > 0 ? '+' : '−'}${Math.abs(p)}%`;
  };
  const rows = result.perNote.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(label(r, i))}</td><td>${centsCell(r)}</td><td>${r0(r.intonation)}</td><td>${timingCell(r)}</td><td>${r0(r.timing)}</td><td style="text-align:left">${statusPill(r)}</td></tr>`).join('');
  const tempo = result.bpm ? ` · tempo ≈ ♩ ${Math.round(result.bpm)}` : '';
  // singing is always listened to as if with vibrato
  const vib = settings.instrument === 'voice' ? ' · Sung' : settings.vibrato == null ? '' : ` · Vibrato ${settings.vibrato ? 'on' : 'off'}`;
  const timed = settings.metronome == null ? '' : settings.metronome ? ' · timed against the metronome' : ' · timed against your own pulse';
  el.innerHTML = `
    <div class="summary">
      ${title ? `<h3 style="margin:0 0 10px">${esc(title)}</h3>` : ''}
      <div class="totals">
        <div class="stat total"><div class="v">${r0(result.total)}</div><div class="l">Total / 100</div></div>
        <div class="stat"><div class="v">${r0(result.intonation)}</div><div class="l">Intonation (75%)</div></div>
        <div class="stat"><div class="v">${r0(result.timing)}</div><div class="l">Timing (25%)</div></div>
        <div class="stat"><div class="v">${fmtErrors(result.errors ?? result.extras.length)}</div><div class="l">Errors${result.penalty != null ? ` (−${fmtErrors(result.penalty)})` : ''}</div></div>
      </div>
      ${tempoNote(result)}
      ${offsetNotice(result)}
      ${details ? scrapeNote(result, prec) : ''}
      <p class="muted small">Precision: ${esc(prec.name)} (full marks within ±${prec.fullCents.toFixed(0)} cents)${vib} · ${result.missing} missing · ${result.wrong} wrong${tempo}${timed}</p>
      ${chart(result, prec)}
      <div class="table-wrap"><table class="notes">
        <thead><tr><th>#</th><th>Note</th><th>Cents</th><th>Tuning</th><th>Timing</th><th>Score</th><th style="text-align:left">Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
}
