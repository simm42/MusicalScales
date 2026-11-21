// Results tab: per syllabus item – 3D surface of the last 10 runs, runs in
// the last 2 weeks, daily averages for 6 months, monthly all-time; and a
// summary across the whole syllabus. Also hosts the PDF export controls.

import { lastRuns, runsSince, daily, monthly, firstTime, summaryDaily, summaryMonthly, atLevel, runDetail, surfaceRuns, sameShape, DAYS, detailCleared } from '../results.js';
import { renderSummary } from './summary.js';
import { RHYTHMS } from '../sequence.js';
import { lineChart, multiLineChart, legendHtml, chartPalette } from './charts.js';
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
/** A piece whose note-by-note detail was cleared after 6 months without practice. */
export const CLEARED_NOTE = 'Not practised for over 6 months, so only its scores are kept (in the charts below) – the note-by-note detail of each run was cleared to save space. Practise it again to start a new picture.';

export function playedHow(r) {
  if (r && r.pc) {
    const where = r.sec ? `bars ${r.sec[0]}–${r.sec[1]}` : 'whole piece';
    return r.tempo ? `${where} · ♩ = ${r.tempo}${r.tbpm ? ` (${Math.round((r.tempo / r.tbpm) * 100)}%)` : ''}` : where;
  }
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

/**
 * The summary: for each syllabus exercise, its average total per day (past 6
 * months) and per month (all history, when there is more than 6 months).
 * @param {Array<{id:string, name:string}>} items
 */
export function summaryData(store, items, now = Date.now(), level = 2) {
  const ids = items.map((x) => x.id);
  const first = firstTime(store, ids);
  const table = (rows, key) => {
    const labels = [...new Set(rows.flatMap((r) => r.points.map((p) => p[key])))].sort();
    return {
      keys: labels,
      series: rows.filter((r) => r.points.length).map((r) => {
        const at = new Map(r.points.map((p) => [p[key], p]));
        return { id: r.id, name: r.name, values: labels.map((l) => (at.has(l) ? at.get(l).t : null)), counts: labels.map((l) => (at.has(l) ? at.get(l).n : 0)) };
      }),
    };
  };
  const sixMonths = table(items.map((it) => ({ id: it.id, name: it.name, points: daily(store, it.id, now - SIX_MONTHS, level) })), 'day');
  const allTime = first != null && first < now - SIX_MONTHS
    ? table(items.map((it) => ({ id: it.id, name: it.name, points: monthly(store, it.id, level) })), 'month') : null;
  return { sixMonths, allTime, any: first != null };
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
  return {
    sixMonths: data.sixMonths.series.length ? multiLineChart({ labels: data.sixMonths.keys.map(dayLabel), series: data.sixMonths.series, palette, width, title: 'Total score per day for each exercise' }) : null,
    allTime: data.allTime && data.allTime.series.length ? multiLineChart({ labels: data.allTime.keys.map(monthLabel), series: data.allTime.series, palette, width, title: 'Total score per month for each exercise' }) : null,
  };
}

export class ResultsPage {
  constructor({ getList, getResults, getStudentName, setStudentName, getPrecision = () => 2, labelsFor = () => null, details = false }) {
    this.details = details;
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

  /** @param {string} [prefer] syllabus item to open on (the one being practised) */
  show(prefer = null) {
    const list = this.getList();
    const ids = new Set(list.map((x) => x.id));
    if (prefer && ids.has(prefer)) this.current = prefer;
    if (this.current !== 'summary' && !ids.has(this.current)) this.current = 'summary';
    this.sel.innerHTML = '';
    this.sel.add(new Option('Summary – syllabus and pieces', 'summary'));
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
    if (!list.length) { this.body.innerHTML = '<p class="muted">Add exercises to the syllabus on the Config tab, or pieces on the Pieces tab. Their runs are saved here.</p>'; return; }
    const level = this.getPrecision();
    const levelNote = `<p class="muted small">Scores shown at <b>${esc(precisionAt(level).name)}</b> precision (change it in Config – every run is kept at all five levels).</p>`;
    if (this.current === 'summary') {
      const data = summaryData(store, list, Date.now(), level);
      const svg = summaryChartsSvg(data, pal, width);
      this.body.innerHTML = `${levelNote}
        <div class="res-block"><h3>Total score per day – past 6 months</h3><p class="muted small">One line for each syllabus exercise and piece (its average on days it was practised). Days without any practice are left out.</p>
          ${svg.sixMonths || '<p class="muted">No runs yet.</p>'}</div>
        ${svg.allTime ? `<div class="res-block"><h3>Total score per month – all history</h3><p class="muted small">One line for each syllabus exercise and piece.</p>${svg.allTime}</div>` : ''}
        <div class="res-block"><h3>Exercises</h3>${this.summaryTable(store, list)}</div>`;
      this.body.querySelectorAll('[data-item]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.current = a.dataset.item; this.sel.value = this.current; this.render(); }));
      return;
    }
    const item = list.find((x) => x.id === this.current);
    const data = itemData(store, item.id, Date.now(), level);
    const svg = chartsSvg(data, pal, width);
    const last = data.last10;
    // runs with more than half the notes missing would only draw holes
    const fullEnough = surfaceRuns(last);
    // a piece edited since: its older runs' notes no longer line up with the piece
    const plotted = item.piece ? sameShape(fullEnough) : fullEnough;
    const edited = fullEnough.length - plotted.length;
    const left = last.length - fullEnough.length;
    const labels = (plotted.length && plotted[plotted.length - 1].labels) || (last.length && last[last.length - 1].labels) || [];
    const cleared = !!item.piece && detailCleared(store[item.id]);
    this.body.innerHTML = `${levelNote}
      <div class="res-block"><h3>Last ${plotted.length || 10} runs – how sharp or flat each note was</h3>
        ${left ? `<p class="muted small">${left} of the last ${last.length} runs ${left === 1 ? 'is' : 'are'} left out because more than half the notes were missing.</p>` : ''}
        ${edited ? `<p class="muted small">${edited} earlier run${edited === 1 ? ' is' : 's are'} left out because the piece has been edited since, so ${edited === 1 ? 'its' : 'their'} notes no longer line up. ${edited === 1 ? 'It is' : 'They are'} still in the charts and tables below.</p>` : ''}
        <p class="muted small">${item.piece ? 'Every note of the piece left to right (bar numbers along the front). Each run is a strip with one tile per note, raised if sharp and lowered if flat; bars not played in a run are left blank, so practising some bars shows just those.' : 'Notes of the scale left to right.'} Oldest run at the back, newest at the front. Hills are sharp, valleys flat. Colours as in the summary after a run: green within ±${Math.round(precisionAt(this.getPrecision(), item.settings.instrument).fullCents)} cents, through amber, to red at ±${Math.round(precisionAt(this.getPrecision(), item.settings.instrument).zeroCents)} (${precisionAt(this.getPrecision()).name} precision). Drag to turn it.</p>
        <div class="surface-wrap"${cleared ? ' hidden' : ''}><canvas id="surface" width="${Math.round(width * 1.5)}" height="${Math.round(width * 0.75)}"></canvas></div>
        ${cleared ? `<p class="notice">${esc(CLEARED_NOTE)}</p>` : ''}</div>
      <div class="res-block"><h3>Last 2 weeks – every run</h3>${legendHtml(undefined, true, pal)}${svg.twoWeeks || '<p class="muted">No runs in the last 2 weeks.</p>'}</div>
      <div class="res-block"><h3>Past 6 months – average per day</h3>${legendHtml(undefined, true, pal)}${svg.sixMonths || '<p class="muted">No runs in the past 6 months.</p>'}</div>
      ${svg.allTime ? `<div class="res-block"><h3>All time – average per month</h3>${legendHtml(undefined, true, pal)}${svg.allTime}</div>` : ''}
      <div class="res-block"><h3>Recent runs</h3>${this.runsTable(data.twoWeeks.length ? data.twoWeeks : last, cleared ? 'No runs in the last 6 months.' : undefined)}</div>
      ${last.length ? `<div class="res-block"><h3>Run in detail</h3>
        <div class="field"><label for="runPick">Choose one of the last ${last.length} runs</label>
          <select id="runPick">${last.slice().reverse().map((r) => `<option value="${esc(r.d)}">${esc(dateTime(r.d))} · ${Math.round(r.t)} / 100${playedHow(r) ? ' · ' + esc(playedHow(r)) : ''}</option>`).join('')}</select></div>
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
    this.surface = new Surface3D(canvas, { runs: plotted, labels, perNote: !!item.piece, palette: { ...pal, bg: 'transparent' }, prec: precisionAt(this.getPrecision(), item.settings.instrument), colors: readPalette() });
  }

  /** The same detailed summary as after a run, for a stored run (scored at the precision it was played at). */
  renderRun(el, item, run) {
    let names = null;
    if (!run.nl) { try { names = this.labelsFor(item, run); } catch { names = null; } }
    const d = runDetail(run, names);
    if (!d) { el.innerHTML = '<p class="muted">The details of this run were not kept.</p>'; return; }
    renderSummary(el, { result: d.result, labels: d.labels, prec: precisionAt(run.level ?? 2, item.settings.instrument), settings: { vibrato: run.vib, metronome: run.met, instrument: item.settings.instrument }, title: null, details: this.details });
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = `Played ${dateTime(run.d)}${playedHow(run) ? ' – ' + playedHow(run) : ''}. Scores are as marked at the time, at the precision used then.`;
    el.prepend(note);
  }

  runsTable(runs, none = 'No runs yet.') {
    if (!runs.length) return `<p class="muted">${esc(none)}</p>`;
    const rows = runs.slice(-15).reverse().map((r) => ({ ...r, ...(r.lv ? atLevel(r, this.getPrecision()) : {}) })).map((r) => `<tr><td>${esc(dateTime(r.d))}</td><td style="text-align:left">${esc(playedHow(r) || '–')}</td><td>${Math.round(r.t)}</td><td>${Math.round(r.i)}</td><td>${Math.round(r.ti)}</td><td>${esc(r.e ?? '–')}</td></tr>`).join('');
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
