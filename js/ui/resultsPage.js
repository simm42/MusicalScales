// Results tab: per syllabus item – 3D surface of the last 10 runs, runs in
// the last 2 weeks, daily averages for 6 months, monthly all-time; and a
// summary across the whole syllabus. Also hosts the PDF export controls.

import { lastRuns, runsSince, daily, monthly, firstTime, summaryDaily, summaryMonthly, atLevel, runDetail, surfaceRuns, DAYS } from '../results.js';
import { renderSummary } from './summary.js';
import { RHYTHMS } from '../sequence.js';
import { lineChart, legendHtml, chartPalette } from './charts.js';
import { Surface3D } from './surface3d.js';
import { readPalette } from './meter.js';
import { precisionAt } from '../precision.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const SIX_MONTHS = 182 * DAYS;
export const TWO_WEEKS = 14 * DAYS;

export function dayLabel(key) { const [, m, d] = key.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; }
export function monthLabel(key) { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${String(y).slice(2)}`; }
export function dateTime(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function playedHow(r) {
  if (!r || !r.rhythm) return '';
  const rh = RHYTHMS[r.rhythm] ? RHYTHMS[r.rhythm].label : r.rhythm;
  // voice / other instruments store how they were performed as a word ('sung', 'detached')
  if (typeof r.slurred === 'string') return `${rh}, ${r.slurred}`;
  return r.slurred ? `${rh}, slurred ${r.slurred}` : `${rh}, separate bows`;
}

/** Everything needed to draw one item's results (also used by the PDF). */
export function itemData(store, id, now = Date.now(), level = 2) {
  const recent = runsSince(store, id, now - TWO_WEEKS, level);
  const first = firstTime(store, [id]);
  return {
    last10: lastRuns(store, id),
    twoWeeks: recent,
    sixMonths: daily(store, id, now - SIX_MONTHS, level),
    allTime: first != null && first < now - SIX_MONTHS ? monthly(store, id, level) : null,
    any: first != null,
  };
}

export function summaryData(store, ids, now = Date.now(), level = 2) {
  const first = firstTime(store, ids);
  return {
    sixMonths: summaryDaily(store, ids, now - SIX_MONTHS, level),
    allTime: first != null && first < now - SIX_MONTHS ? summaryMonthly(store, ids, level) : null,
    any: first != null,
  };
}

/** The four standard charts as SVG strings. */
export function chartsSvg(data, palette, width = 760) {
  const out = {};
  if (data.twoWeeks) {
    out.twoWeeks = data.twoWeeks.length ? lineChart({
      points: data.twoWeeks, labels: data.twoWeeks.map((_, k) => `${k + 1}`),
      tips: data.twoWeeks.map((r, k) => `Run ${k + 1} · ${dateTime(r.d)}${r.rhythm ? ' · ' + playedHow(r) : ''}`),
      palette, width, title: 'Runs in the last 2 weeks',
    }) : null;
  }
  if (data.sixMonths) {
    out.sixMonths = data.sixMonths.length ? lineChart({
      points: data.sixMonths, labels: data.sixMonths.map((d) => dayLabel(d.day)),
      tips: data.sixMonths.map((d) => `${dayLabel(d.day)} · ${d.n} run${d.n === 1 ? '' : 's'}`),
      palette, width, title: 'Daily averages, past 6 months',
    }) : null;
  }
  if (data.allTime) {
    out.allTime = lineChart({
      points: data.allTime, labels: data.allTime.map((m) => monthLabel(m.month)),
      tips: data.allTime.map((m) => `${monthLabel(m.month)} · ${m.n} run${m.n === 1 ? '' : 's'}`),
      palette, width, title: 'Monthly averages, all time',
    });
  }
  return out;
}

export function summaryChartsSvg(data, palette, width = 760) {
  const opts = { keys: ['t'], errors: false, palette, width };
  return {
    sixMonths: data.sixMonths.length ? lineChart({ ...opts, points: data.sixMonths, labels: data.sixMonths.map((d) => dayLabel(d.day)), tips: data.sixMonths.map((d) => `${dayLabel(d.day)} · ${d.n} run${d.n === 1 ? '' : 's'}`), title: 'Average total per day' }) : null,
    allTime: data.allTime ? lineChart({ ...opts, points: data.allTime, labels: data.allTime.map((m) => monthLabel(m.month)), title: 'Average total per month' }) : null,
  };
}

export class ResultsPage {
  constructor({ getList, getResults, getStudentName, setStudentName, getPrecision = () => 2, labelsFor = () => null }) {
    this.labelsFor = labelsFor;
    this.picked = {}; // chosen run (its time) per item for the detailed summary
    this.getPrecision = getPrecision;
    this.getList = getList;
    this.getResults = getResults;
    this.getStudentName = getStudentName;
    this.setStudentName = setStudentName;
    this.sel = document.getElementById('resSelect');
    this.body = document.getElementById('resBody');
    this.dirty = true;
    this.current = 'summary';
    this.sel.addEventListener('change', () => { this.current = this.sel.value; this.render(); });
    document.getElementById('pdfBtn').addEventListener('click', () => this.exportPdf(null));
    document.getElementById('pdfMoreBtn').addEventListener('click', () => this.togglePdfOptions());
    // redraw charts in the new size/theme
    let t = null;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (!document.getElementById('tab-results').hidden) this.render(); }, 250); });
  }

  invalidate() { this.dirty = true; }

  show() {
    const list = this.getList();
    const ids = new Set(list.map((x) => x.id));
    if (this.current !== 'summary' && !ids.has(this.current)) this.current = 'summary';
    this.sel.innerHTML = '';
    this.sel.add(new Option('Summary – whole syllabus', 'summary'));
    for (const it of list) this.sel.add(new Option(it.name, it.id));
    this.sel.value = this.current;
    this.render();
    this.dirty = false;
  }

  render() {
    const store = this.getResults();
    const list = this.getList();
    const pal = chartPalette();
    const width = Math.max(320, Math.min(900, this.body.clientWidth || 760));
    if (!list.length) { this.body.innerHTML = '<p class="muted">Add exercises to the syllabus on the Config tab. Runs of syllabus exercises are saved here.</p>'; return; }
    const level = this.getPrecision();
    const levelNote = `<p class="muted small">Scores shown at <b>${esc(precisionAt(level).name)}</b> precision (change it in Config – every run is kept at all five levels).</p>`;
    if (this.current === 'summary') {
      const data = summaryData(store, list.map((x) => x.id), Date.now(), level);
      const svg = summaryChartsSvg(data, pal, width);
      this.body.innerHTML = `${levelNote}
        <div class="res-block"><h3>Average total score per day – past 6 months</h3><p class="muted small">All syllabus exercises together; days without practice are left out.</p>
          ${svg.sixMonths || '<p class="muted">No runs yet.</p>'}</div>
        ${svg.allTime ? `<div class="res-block"><h3>Average total score per month – all history</h3>${svg.allTime}</div>` : ''}
        <div class="res-block"><h3>Exercises</h3>${this.summaryTable(store, list)}</div>`;
      this.body.querySelectorAll('[data-item]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.current = a.dataset.item; this.sel.value = this.current; this.render(); }));
      return;
    }
    const item = list.find((x) => x.id === this.current);
    const data = itemData(store, item.id, Date.now(), level);
    const svg = chartsSvg(data, pal, width);
    const last = data.last10;
    // runs with more than half the notes missing would only draw holes
    const plotted = surfaceRuns(last);
    const left = last.length - plotted.length;
    const labels = (plotted.length && plotted[plotted.length - 1].labels) || (last.length && last[last.length - 1].labels) || [];
    this.body.innerHTML = `${levelNote}
      <div class="res-block"><h3>Last ${plotted.length || 10} runs – how sharp or flat each note was</h3>
        ${left ? `<p class="muted small">${left} of the last ${last.length} runs ${left === 1 ? 'is' : 'are'} left out because more than half the notes were missing.</p>` : ''}
        <p class="muted small">Notes of the scale left to right, oldest run at the back, newest at the front. Hills are sharp, valleys flat. Colours as in the summary after a run: green within ±${Math.round(precisionAt(this.getPrecision(), item.settings.instrument).fullCents)} cents, through amber, to red at ±${Math.round(precisionAt(this.getPrecision(), item.settings.instrument).zeroCents)} (${precisionAt(this.getPrecision()).name} precision). Drag to turn it.</p>
        <div class="surface-wrap"><canvas id="surface" width="${Math.round(width * 1.5)}" height="${Math.round(width * 0.75)}"></canvas></div></div>
      <div class="res-block"><h3>Last 2 weeks – every run</h3>${legendHtml(undefined, true, pal)}${svg.twoWeeks || '<p class="muted">No runs in the last 2 weeks.</p>'}</div>
      <div class="res-block"><h3>Past 6 months – average per day</h3>${legendHtml(undefined, true, pal)}${svg.sixMonths || '<p class="muted">No runs in the past 6 months.</p>'}</div>
      ${svg.allTime ? `<div class="res-block"><h3>All time – average per month</h3>${legendHtml(undefined, true, pal)}${svg.allTime}</div>` : ''}
      <div class="res-block"><h3>Recent runs</h3>${this.runsTable(data.twoWeeks.length ? data.twoWeeks : last)}</div>
      ${last.length ? `<div class="res-block"><h3>Run in detail</h3>
        <div class="field"><label for="runPick">Choose one of the last ${last.length} runs</label>
          <select id="runPick">${last.slice().reverse().map((r) => `<option value="${r.d}">${esc(dateTime(r.d))} · ${Math.round(r.t)} / 100${playedHow(r) ? ' · ' + esc(playedHow(r)) : ''}</option>`).join('')}</select></div>
        <div id="runDetail"></div></div>` : ''}`;
    if (last.length) {
      const pick = this.body.querySelector('#runPick');
      if (last.some((r) => r.d === this.picked[item.id])) pick.value = String(this.picked[item.id]);
      const show = () => {
        const run = last.find((r) => String(r.d) === pick.value) || last[last.length - 1];
        this.picked[item.id] = run.d;
        this.renderRun(this.body.querySelector('#runDetail'), item, run);
      };
      pick.addEventListener('change', show);
      show();
    }
    const canvas = this.body.querySelector('#surface');
    this.surface = new Surface3D(canvas, { runs: plotted, labels, palette: { ...pal, bg: 'transparent' }, prec: precisionAt(this.getPrecision(), item.settings.instrument), colors: readPalette() });
  }

  /** The same detailed summary as after a run, for a stored run (scored at the precision it was played at). */
  renderRun(el, item, run) {
    let names = null;
    if (!run.nl) { try { names = this.labelsFor(item, run); } catch { names = null; } }
    const d = runDetail(run, names);
    if (!d) { el.innerHTML = '<p class="muted">The details of this run were not kept.</p>'; return; }
    renderSummary(el, { result: d.result, labels: d.labels, prec: precisionAt(run.level ?? 2, item.settings.instrument), settings: { vibrato: run.vib, metronome: run.met, instrument: item.settings.instrument }, title: null });
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = `Played ${dateTime(run.d)}${playedHow(run) ? ' – ' + playedHow(run) : ''}. Scores are as marked at the time, at the precision used then.`;
    el.prepend(note);
  }

  runsTable(runs) {
    if (!runs.length) return '<p class="muted">No runs yet.</p>';
    const rows = runs.slice(-15).reverse().map((r) => ({ ...r, ...(r.lv ? atLevel(r, this.getPrecision()) : {}) })).map((r) => `<tr><td>${esc(dateTime(r.d))}</td><td style="text-align:left">${esc(playedHow(r) || '–')}</td><td>${Math.round(r.t)}</td><td>${Math.round(r.i)}</td><td>${Math.round(r.ti)}</td><td>${r.e ?? '–'}</td></tr>`).join('');
    return `<div class="table-wrap"><table class="notes"><thead><tr><th>When</th><th style="text-align:left">Played</th><th>Total</th><th>Intonation</th><th>Timing</th><th>Errors</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  summaryTable(store, list) {
    const now = Date.now();
    const rows = list.map((it) => {
      const recent = runsSince(store, it.id, now - TWO_WEEKS, this.getPrecision());
      const avg = recent.length ? Math.round(recent.reduce((a, r) => a + r.t, 0) / recent.length) : null;
      const last = lastRuns(store, it.id, 1)[0];
      const lastT = last ? atLevel(last, this.getPrecision()).t : null;
      return `<tr><td style="text-align:left"><a href="#" data-item="${esc(it.id)}">${esc(it.name)}</a></td><td>${last ? esc(dateTime(last.d)) : '–'}</td><td>${lastT != null ? Math.round(lastT) : '–'}</td><td>${recent.length}</td><td>${avg ?? '–'}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="notes"><thead><tr><th style="text-align:left">Exercise</th><th>Last run</th><th>Last total</th><th>Runs (2 weeks)</th><th>Average (2 weeks)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ------------------------------------------------------------ PDF
  togglePdfOptions() {
    const box = document.getElementById('pdfOptions');
    const btn = document.getElementById('pdfMoreBtn');
    const open = box.hidden;
    box.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const list = this.getList();
    box.innerHTML = `
      <div class="field"><label for="pdfName">Student name</label><input type="text" id="pdfName" maxlength="80" value="${esc(this.getStudentName())}"></div>
      <div class="cols">
        <fieldset><legend>Exercises</legend>
          <label class="check"><input type="checkbox" checked disabled> Summary (always included, all history)</label>
          ${list.map((it) => `<label class="check"><input type="checkbox" data-pdf-item="${esc(it.id)}" checked> ${esc(it.name)}</label>`).join('')}
        </fieldset>
        <fieldset><legend>For each exercise</legend>
          <label class="check"><input type="checkbox" data-pdf-chart="surface" checked> 3D surface of the last 10 runs</label>
          <label class="check"><input type="checkbox" data-pdf-chart="twoWeeks" checked> Last 2 weeks – every run</label>
          <label class="check"><input type="checkbox" data-pdf-chart="sixMonths" checked> Past 6 months – daily averages</label>
          <label class="check"><input type="checkbox" data-pdf-chart="allTime" checked> All time – monthly averages</label>
          <label class="check"><input type="checkbox" data-pdf-chart="table" checked> Table of recent runs</label>
        </fieldset>
        <fieldset><legend>History</legend>
          <label class="check"><input type="radio" name="pdfRange" value="all" checked> All history</label>
          <label class="check"><input type="radio" name="pdfRange" value="2w"> Past 2 weeks only</label>
        </fieldset>
      </div>
      <div class="row"><button class="btn primary" type="button" id="pdfCustomBtn">⬇ Create PDF with these options</button></div>`;
    box.querySelector('#pdfName').addEventListener('change', (e) => this.setStudentName(e.target.value.trim()));
    box.querySelector('#pdfCustomBtn').addEventListener('click', () => {
      const items = [...box.querySelectorAll('[data-pdf-item]')].filter((c) => c.checked).map((c) => c.dataset.pdfItem);
      const charts = Object.fromEntries([...box.querySelectorAll('[data-pdf-chart]')].map((c) => [c.dataset.pdfChart, c.checked]));
      const range = box.querySelector('input[name="pdfRange"]:checked').value;
      this.setStudentName(box.querySelector('#pdfName').value.trim());
      this.exportPdf({ items, charts, range });
    });
  }

  async exportPdf(options) {
    const msg = document.getElementById('pdfMsg');
    const btn = document.getElementById('pdfBtn');
    btn.disabled = true;
    msg.textContent = 'Making the PDF…';
    try {
      const { makePdf } = await import('../pdf.js');
      const list = this.getList();
      const opts = options || { items: list.map((x) => x.id), charts: { surface: true, twoWeeks: true, sixMonths: true, allTime: true, table: true }, range: 'all' };
      const out = await makePdf({ list, results: this.getResults(), studentName: this.getStudentName(), precision: this.getPrecision(), ...opts });
      out.save();
      msg.textContent = `PDF ready: ${out.filename} (${out.pages} page${out.pages === 1 ? '' : 's'}).`;
    } catch (e) {
      console.error(e);
      msg.textContent = 'Sorry – the PDF could not be made: ' + (e && e.message);
    }
    btn.disabled = false;
  }
}
