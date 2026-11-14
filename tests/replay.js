// Re-analyse captured recordings with the current code and draw diagnostics.
import { decodeWav } from '../js/audio/wav.js';
import { analyseRecording } from '../js/practice.js';
import { DEFAULT_SETTINGS } from '../js/exercises.js';
import { noteName, freqToMidi } from '../js/theory.js';
import { SEG } from '../js/segmenter.js';

const out = document.getElementById('out');
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
window.__replay = [];

function chart(r, meta) {
  const { frames, notes, seq, gate, a4 } = { ...r, a4: meta.a4 || 440 };
  if (!frames.length) return '';
  const tMin = frames[0].t, tMax = frames[frames.length - 1].t;
  const exp = seq.events.flatMap((e) => e.midis);
  const mLo = Math.min(...exp) - 5, mHi = Math.max(...exp) + 14;
  const W = Math.max(1000, Math.round((tMax - tMin) * 60)), H = 420, P = 300; // pitch panel height
  const x = (t) => ((t - tMin) / (tMax - tMin || 1)) * (W - 40) + 30;
  const y = (m) => P - ((m - mLo) / (mHi - mLo)) * (P - 10);
  const dbY = (db) => P + 10 + ((-10 - db) / 70) * (H - P - 20); // -10..-80 dBFS
  let s = `<svg viewBox="0 0 ${W} ${H}" style="min-width:${W}px">`;
  for (let m = Math.ceil(mLo); m <= mHi; m++) {
    const isExp = exp.includes(m);
    s += `<line x1="30" x2="${W - 10}" y1="${y(m)}" y2="${y(m)}" stroke="${isExp ? '#c9c2e0' : '#eee'}" stroke-width="${isExp ? 1 : 0.5}"/>`;
    if (m % 12 === 0) s += `<text x="2" y="${y(m) + 4}" font-size="10" fill="#888">C${m / 12 - 1}</text>`;
  }
  // frames: dot per frame; dark = would count as sound, light = rejected
  for (const f of frames) {
    if (!(f.freq > 0)) continue;
    const m = freqToMidi(f.freq, a4);
    if (m < mLo || m > mHi) continue;
    const voiced = f.rms >= gate && f.clarity >= SEG.clarityMin;
    s += `<circle cx="${x(f.t).toFixed(1)}" cy="${y(m).toFixed(1)}" r="${voiced ? 1.6 : 1}" fill="${voiced ? '#333' : '#e0a0a0'}"/>`;
  }
  // notes heard live (green, drawn slightly below) and in this replay (purple)
  const liveNotes = (meta.live && meta.live.notes) || [];
  for (const n of liveNotes) if (n.midi != null) s += `<rect x="${x(n.onset)}" y="${y(n.midi) + 4}" width="${Math.max(1, x(n.end) - x(n.onset))}" height="3" fill="#1f8a4c" opacity=".8"><title>live ${n.midi}</title></rect>`;
  for (const n of notes) if (n.midi != null) s += `<rect x="${x(n.onset)}" y="${y(n.midi) - 3}" width="${Math.max(1, x(n.end) - x(n.onset))}" height="6" fill="#6b3fa0" opacity=".45"/>`;
  // live state changes (Play now, count-in…)
  for (const st of ((meta.log && meta.log.states) || [])) if (st.t >= tMin && st.t <= tMax) s += `<line x1="${x(st.t)}" x2="${x(st.t)}" y1="0" y2="${P}" stroke="#999" stroke-dasharray="2 3"/><text x="${x(st.t) + 2}" y="10" font-size="9" fill="#666">${esc(st.s)}</text>`;
  // live gate over time
  const gl = (meta.log && meta.log.gates) || [];
  if (gl.length > 1) s += `<path d="${gl.map((g, i) => `${i ? 'L' : 'M'}${x(g.t).toFixed(1)},${dbY(20 * Math.log10(g.gate)).toFixed(1)}`).join('')}" fill="none" stroke="#1f8a4c" stroke-dasharray="3 2"/>`;
  // level panel
  s += `<line x1="30" x2="${W - 10}" y1="${dbY(20 * Math.log10(gate))}" y2="${dbY(20 * Math.log10(gate))}" stroke="#b3261e" stroke-dasharray="4 3"/>`;
  s += `<text x="${W - 120}" y="${dbY(20 * Math.log10(gate)) - 3}" font-size="10" fill="#b3261e">loudness gate</text>`;
  let path = '';
  frames.forEach((f, i) => { path += `${i ? 'L' : 'M'}${x(f.t).toFixed(1)},${dbY(20 * Math.log10((f.level ?? f.rms) + 1e-9)).toFixed(1)}`; });
  s += `<path d="${path}" fill="none" stroke="#1a73e8" stroke-width="1"/>`;
  let cpath = '';
  frames.forEach((f, i) => { cpath += `${i ? 'L' : 'M'}${x(f.t).toFixed(1)},${(P + 10 + (1 - f.clarity) * (H - P - 20)).toFixed(1)}`; });
  s += `<path d="${cpath}" fill="none" stroke="#f29900" stroke-width="0.7" opacity=".7"/>`;
  for (let t = Math.ceil(tMin); t <= tMax; t++) s += `<text x="${x(t)}" y="${H - 2}" font-size="9" fill="#888">${(t - tMin).toFixed(0)}s</text>`;
  s += `<text x="32" y="${P + 22}" font-size="10" fill="#1a73e8">level (dBFS)</text><text x="110" y="${P + 22}" font-size="10" fill="#f29900">clarity (top = 1)</text>`;
  return `<div class="wrap">${s}</svg></div>`;
}

function render(name, meta, r) {
  const res = r.result;
  const ev = r.seq.events;
  const rows = res.perNote.map((p, i) => {
    const d = p.note != null ? r.notes[p.note] : null;
    return `<tr class="${p.status}"><td>${i + 1}</td><td style="text-align:left">${ev[p.event].notes.map((n) => noteName(n, { octave: true })).join('+')}</td><td>${ev[p.event].midis.join('+')}</td>
      <td>${d && d.midi != null ? d.midi.toFixed(2) : ''}</td><td>${p.cents ? p.cents.map((c) => (c == null ? '–' : c.toFixed(0))).join('/') : ''}</td>
      <td>${d ? d.onset.toFixed(2) : ''}</td><td>${d ? (d.end - d.onset).toFixed(2) : ''}</td><td>${p.timingDev != null ? (p.timingDev * 100).toFixed(0) + '%' : ''}</td><td style="text-align:left">${p.status}${p.unsteady ? ' unsteady' : ''}</td></tr>`;
  }).join('');
  const extras = res.extras.map((n) => `${n.onset.toFixed(2)}s ${n.midi != null ? n.midi.toFixed(1) : ''}`).join(', ');
  let peak = 0;
  for (const f of r.frames) peak = Math.max(peak, f.rms);
  const live = meta.live ? `live score ${Math.round(meta.live.total)} (missing ${meta.live.missing}, wrong ${meta.live.wrong}, extras ${meta.live.extras})` : 'no live score';
  const au = meta.audio || {};
  const tr = au.track || {};
  const st = tr.settings || {};
  const proc = ['echoCancellation', 'noiseSuppression', 'autoGainControl'].map((k) => `${k} ${st[k] === true ? '<b class="wrong">ON</b>' : st[k] === false ? 'off' : '?'}`).join(', ');
  const details = [
    meta.userNotes ? `<b>Notes:</b> ${esc(meta.userNotes)}` : '',
    `app ${esc(meta.appVersion || 'before version tracking')} · end: ${esc((meta.log && meta.log.endReason) || '?')}`,
    tr.label != null ? `microphone: ${esc(tr.label || 'unnamed')} · ${st.sampleRate || '?'} Hz · ${st.channelCount || '?'} ch · ${proc}` : '',
    au.context ? `audio context ${au.context.sampleRate} Hz · base latency ${au.context.baseLatency != null ? (au.context.baseLatency * 1000).toFixed(0) + ' ms' : '?'} · window ${au.windowSize || '?'} · session ${esc(au.audioSession || 'n/a')}` : '',
    meta.calibration ? `calibration: correcting ${Math.round(meta.calibration.correctCents || 0)}¢, clarity ${meta.calibration.clarity.toFixed(2)}, noise ${(20 * Math.log10(meta.calibration.noiseRms)).toFixed(0)} dBFS, quietest string ${(20 * Math.log10(meta.calibration.quietestRms)).toFixed(0)} dBFS` : 'no calibration',
    meta.a4Effective && meta.a4Effective !== meta.a4 ? `A used for listening: ${meta.a4Effective.toFixed(1)} Hz (set: ${meta.a4})` : '',
    meta.calibration && meta.calibration.strings ? `calibration strings: ${meta.calibration.strings.map((x) => (x.skipped ? `${x.string} skipped` : `${x.string} ${x.cents > 0 ? '+' : ''}${x.cents}¢ ${x.levelDb} dB clarity ${x.clarity}${x.octave ? ' (octave)' : ''}`)).join(' · ')} · calibrated ${esc(meta.calibration.date || '')} with ${esc(meta.calibration.microphone || '?')}` : '',
    meta.calibrationApplied ? `calibration effect: A ${meta.calibrationApplied.a4.toFixed(1)} Hz, clarity ≥ ${meta.calibrationApplied.clarityMin.toFixed(2)} (weak ≥ ${meta.calibrationApplied.clarityWeak.toFixed(2)}), gate ≤ ${(20 * Math.log10(meta.calibrationApplied.maxGate)).toFixed(0)} dBFS` : '',
    meta.result && meta.result.globalOffset ? `<b class="wrong">whole run off by ${meta.result.globalOffset.cents}¢</b> (${meta.result.globalOffset.matched}/${meta.result.globalOffset.of} would match)` : '',
    meta.selfTest ? (meta.selfTest.error ? `device self-test error: ${esc(meta.selfTest.error)}` : `device self-test: ${meta.selfTest.passed}/${meta.selfTest.total} passed in ${meta.selfTest.seconds} s${meta.selfTest.failed.length ? ' – failed: ' + esc(meta.selfTest.failed.map((f) => f.name + ' (' + f.error + ')').join('; ')) : ''}`) : 'no device self-test',
  ].filter(Boolean).map((t) => `<div class="muted small">${t}</div>`).join('');
  const onsets = ((meta.log && meta.log.onsets) || []).map((o) => `${o.t.toFixed(2)}s heard ${o.heard ?? '?'} → ${o.matched >= 0 ? '#' + (o.matched + 1) : 'extra'}`).join(' · ');
  const summary = {
    file: name, title: r.exercise.title, total: +res.total.toFixed(1), intonation: +res.intonation.toFixed(1), timing: +res.timing.toFixed(1),
    missing: res.missing, wrong: res.wrong, extras: res.extras.length, detected: r.notes.length, expected: ev.length,
    noiseFloor: +r.noiseFloor.toFixed(5), gate: +r.gate.toFixed(5), maxFrameRms: +peak.toFixed(4), liveTotal: meta.live ? Math.round(meta.live.total) : null,
  };
  window.__replay.push(summary);
  const div = document.createElement('div');
  div.className = 'run';
  div.innerHTML = `<h2>${esc(name)}</h2>
    <div><b>${esc(r.exercise.info.name)}: ${esc(r.exercise.title)}</b> · ${meta.synthetic ? 'synthetic' : 'microphone'} · ${esc(meta.created || '')}</div>
    <div>Replayed now: <b>${res.total.toFixed(0)}</b> (intonation ${res.intonation.toFixed(0)}, timing ${res.timing.toFixed(0)}, missing ${res.missing}, wrong ${res.wrong}, extras ${res.extras.length}) · ${live}</div>
    <div class="muted">detected ${r.notes.length} notes for ${ev.length} expected · noise floor ${(20 * Math.log10(r.noiseFloor)).toFixed(1)} dBFS · gate ${(20 * Math.log10(r.gate)).toFixed(1)} dBFS · loudest frame ${(20 * Math.log10(peak + 1e-9)).toFixed(1)} dBFS · ${esc(meta.userAgent || '')}</div>
    ${details}
    ${extras ? `<div class="muted">extra notes: ${esc(extras)}</div>` : ''}
    ${onsets ? `<details><summary>Live follower (${(meta.log.onsets || []).length} note starts)</summary><div class="small">${esc(onsets)}</div></details>` : ''}
    ${chart(r, meta)}
    <details><summary>Per-note detail</summary><table><tr><th>#</th><th>note</th><th>exp midi</th><th>heard midi</th><th>cents</th><th>onset</th><th>dur</th><th>timing</th><th>status</th></tr>${rows}</table></details>`;
  out.appendChild(div);
}

async function analyseBuffer(name, buf) {
  const { samples, sampleRate, meta } = decodeWav(buf);
  const m = meta || { settings: {}, a4: 440 };
  const settings = { ...DEFAULT_SETTINGS, ...(m.settings || {}) };
  const r = analyseRecording({ samples, sampleRate, settings, a4: m.a4 || 440, startTime: m.startTime || 0, metronomeT0: m.metronomeT0 ?? null, calibration: m.calibration || null });
  render(name, m, r);
}

async function fromFolder() {
  try {
    const res = await fetch('../debug-recordings/');
    if (!res.ok) throw new Error('no folder');
    const html = await res.text();
    const files = [...html.matchAll(/href="([^"]+\.wav)"/gi)].map((m) => decodeURIComponent(m[1]));
    if (!files.length) { out.textContent = 'No recordings in debug-recordings/ yet.'; return; }
    out.textContent = '';
    for (const f of files) {
      const buf = await (await fetch('../debug-recordings/' + encodeURIComponent(f))).arrayBuffer();
      try { await analyseBuffer(f, buf); } catch (e) { out.insertAdjacentHTML('beforeend', `<p class="wrong">${esc(f)}: ${esc(e.message)}</p>`); }
    }
  } catch {
    out.textContent = 'No debug-recordings folder found – choose files above.';
  }
  window.__replayDone = true;
}

document.getElementById('files').addEventListener('change', async (e) => {
  out.textContent = '';
  window.__replay = [];
  for (const f of e.target.files) await analyseBuffer(f.name, await f.arrayBuffer());
});

fromFolder();
