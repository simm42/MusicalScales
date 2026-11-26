// Small SVG charts for the Results tab and the PDF: total / intonation /
// timing as lines (0–100) and errors as bars on a right-hand axis.

import { pieceBarSurfaces } from '../barSurface.js';

export const SERIES = [
  { key: 't', name: 'Total', colorKey: 'total', width: 2.6 },
  { key: 'i', name: 'Intonation', colorKey: 'intonation', width: 1.6 },
  { key: 'ti', name: 'Timing', colorKey: 'timing', width: 1.6 },
];

/** Palette from the page's CSS variables (current theme) or a fixed light one for print. */
export function chartPalette(light = false) {
  if (light) {
    return { fg: '#1c1a22', muted: '#66626f', grid: '#e4e1ea', bg: '#ffffff', total: '#6b3fa0', intonation: '#1a73e8', timing: '#0f9d8a', errors: '#c62f2f', dark: false };
  }
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
  const dark = cs.getPropertyValue('color-scheme').trim() === 'dark';
  return {
    fg: v('--fg', '#1c1a22'), muted: v('--muted', '#66626f'), grid: v('--border', '#e4e1ea'), bg: 'transparent',
    total: v('--accent', '#6b3fa0'), intonation: dark ? '#7cb2ff' : '#1a73e8', timing: dark ? '#4fd1bd' : '#0f9d8a', errors: v('--bad', '#c62f2f'),
    dark,
  };
}

// one colour per syllabus exercise (no orange); lighter versions for the dark theme
const ITEM_COLORS = ['#6b3fa0', '#1a73e8', '#0f9d8a', '#c2185b', '#2e7d32', '#3949ab', '#00838f', '#8e24aa', '#546e7a', '#6d4c41', '#ad1457', '#558b2f'];
const ITEM_COLORS_DARK = ['#b79cf0', '#7cb2ff', '#4fd1bd', '#f48fb1', '#81c784', '#9fa8da', '#4dd0e1', '#ce93d8', '#b0bec5', '#bcaaa4', '#f06292', '#aed581'];
export const itemColor = (k, palette) => (palette.dark ? ITEM_COLORS_DARK : ITEM_COLORS)[k % ITEM_COLORS.length];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (x) => (x == null || !isFinite(x) ? '–' : Math.round(x * 10) / 10);

/**
 * @param {object} o
 * @param {object[]} o.points  {t, i, ti, e} (null values leave gaps)
 * @param {string[]} o.labels  x label for each point
 * @param {string[]} [o.tips]  hover text for each point
 * @param {string[]} [o.keys]  which of t/i/ti to draw (default all)
 * @param {boolean} [o.errors] draw the error bars (default true)
 * @returns {string} SVG markup
 */
export function lineChart({ points, labels, tips = [], keys = ['t', 'i', 'ti'], errors = true, width = 760, height = 230, palette = chartPalette(), title = '' }) {
  const n = points.length;
  const L = 38, R = errors ? 34 : 12, T = 12, B = 34;
  const W = width - L - R, H = height - T - B;
  const x = (k) => L + (n <= 1 ? W / 2 : (k / (n - 1)) * W);
  const y = (v) => T + H - (Math.max(0, Math.min(100, v)) / 100) * H;
  // errors use the bottom 40 % of the chart so they don't hide the lines
  const eMax = Math.max(3, ...points.map((p) => p.e || 0));
  const ye = (v) => T + H - (v / eMax) * H * 0.4;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}" font-family="Helvetica, Arial, sans-serif">`;
  if (palette.bg && palette.bg !== 'transparent') s += `<rect width="${width}" height="${height}" fill="${palette.bg}"/>`;
  for (const g of [0, 25, 50, 75, 100]) {
    s += `<line x1="${L}" x2="${L + W}" y1="${y(g)}" y2="${y(g)}" stroke="${palette.grid}" stroke-width="1"/>`;
    s += `<text x="${L - 6}" y="${y(g) + 4}" font-size="11" text-anchor="end" fill="${palette.muted}">${g}</text>`;
  }
  if (errors) {
    for (const g of [0, Math.round(eMax / 2), eMax]) s += `<text x="${L + W + 6}" y="${ye(g) + 4}" font-size="11" fill="${palette.errors}">${g}</text>`;
    const bw = Math.max(2, Math.min(18, (W / Math.max(1, n)) * 0.5));
    points.forEach((p, k) => {
      if (!p.e) return;
      s += `<rect x="${x(k) - bw / 2}" y="${ye(p.e)}" width="${bw}" height="${T + H - ye(p.e)}" fill="${palette.errors}" opacity=".28"><title>${esc(labels[k] || '')}: ${fmt(p.e)} error${p.e === 1 ? '' : 's'}</title></rect>`;
    });
  }
  // x labels: at most ~9
  const every = Math.max(1, Math.ceil(n / 9));
  labels.forEach((lab, k) => {
    // every few, and always the last – dropping a regular one that would run into it
    if (k !== n - 1 && (k % every !== 0 || (n - 1 - k) < every * 0.6)) return;
    s += `<text x="${x(k)}" y="${T + H + 18}" font-size="11" text-anchor="middle" fill="${palette.muted}">${esc(lab)}</text>`;
  });
  for (const ser of SERIES.filter((d) => keys.includes(d.key))) {
    const col = palette[ser.colorKey];
    let d = '';
    let pen = false;
    points.forEach((p, k) => {
      const v = p[ser.key];
      if (v == null || !isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    if (d) s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${ser.width}" stroke-linejoin="round" stroke-linecap="round"/>`;
    points.forEach((p, k) => {
      const v = p[ser.key];
      if (v == null || !isFinite(v)) return;
      const r = n > 40 ? 1.6 : ser.key === 't' ? 3.2 : 2.4;
      s += `<circle cx="${x(k).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r}" fill="${col}"><title>${esc(tips[k] || labels[k] || '')}\n${ser.name}: ${fmt(v)}</title></circle>`;
    });
  }
  return s + '</svg>';
}

/**
 * One line per series (a syllabus exercise each) over shared x labels, with
 * the colour key drawn inside the chart (so the PDF gets it too).
 * @param {object} o
 * @param {string[]} o.labels  x labels (days or months)
 * @param {Array<{name:string, values:(number|null)[], counts?:number[]}>} o.series  values per label (null = not practised)
 */
export function multiLineChart({ labels, series, width = 760, height = 230, palette = chartPalette(), title = '' }) {
  const n = labels.length;
  const L = 38, R = 12, T = 12, B = 34;
  // colour key below the chart: as many columns as fit
  const cols = Math.max(1, Math.floor((width - L) / 240));
  const keyRows = Math.ceil(series.length / cols);
  const keyH = keyRows * 18 + 6;
  const W = width - L - R, H = height - T - B;
  const total = height + keyH;
  const x = (k) => L + (n <= 1 ? W / 2 : (k / (n - 1)) * W);
  const y = (v) => T + H - (Math.max(0, Math.min(100, v)) / 100) * H;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${total}" width="${width}" height="${total}" role="img" aria-label="${esc(title)}" font-family="Helvetica, Arial, sans-serif">`;
  if (palette.bg && palette.bg !== 'transparent') s += `<rect width="${width}" height="${total}" fill="${palette.bg}"/>`;
  for (const g of [0, 25, 50, 75, 100]) {
    s += `<line x1="${L}" x2="${L + W}" y1="${y(g)}" y2="${y(g)}" stroke="${palette.grid}" stroke-width="1"/>`;
    s += `<text x="${L - 6}" y="${y(g) + 4}" font-size="11" text-anchor="end" fill="${palette.muted}">${g}</text>`;
  }
  const every = Math.max(1, Math.ceil(n / 9));
  labels.forEach((lab, k) => {
    // every few, and always the last – dropping a regular one that would run into it
    if (k !== n - 1 && (k % every !== 0 || (n - 1 - k) < every * 0.6)) return;
    s += `<text x="${x(k)}" y="${T + H + 18}" font-size="11" text-anchor="middle" fill="${palette.muted}">${esc(lab)}</text>`;
  });
  series.forEach((ser, si) => {
    const col = itemColor(si, palette);
    // an exercise's own points are joined across days it was not practised
    const pts = ser.values.map((v, k) => (v == null || !isFinite(v) ? null : [x(k), y(v), v, k])).filter(Boolean);
    if (pts.length > 1) s += `<path d="${pts.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/>`;
    const r = n > 40 ? 1.8 : 2.8;
    for (const [px, py, v, k] of pts) {
      const c = ser.counts && ser.counts[k];
      s += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r}" fill="${col}"><title>${esc(ser.name)}
${esc(labels[k])}: total ${fmt(v)}${c ? ` (${c} run${c === 1 ? '' : 's'})` : ''}</title></circle>`;
    }
  });
  // the key
  const colW = (width - L) / cols;
  const maxChars = Math.max(12, Math.floor(colW / 6.6) - 3);
  series.forEach((ser, si) => {
    const cx = L + (si % cols) * colW, cy = height + 4 + Math.floor(si / cols) * 18;
    const name = ser.name.length > maxChars ? ser.name.slice(0, maxChars - 1) + '…' : ser.name;
    s += `<rect x="${cx}" y="${cy + 3}" width="14" height="4" rx="2" fill="${itemColor(si, palette)}"/>`;
    s += `<text x="${cx + 20}" y="${cy + 9}" font-size="11.5" fill="${palette.fg}"><title>${esc(ser.name)}</title>${esc(name)}</text>`;
  });
  return s + '</svg>';
}

export function legendHtml(keys = ['t', 'i', 'ti'], errors = true, palette = chartPalette()) {
  const items = SERIES.filter((d) => keys.includes(d.key)).map((d) => `<span><i style="background:${palette[d.colorKey]}"></i>${d.name}</span>`);
  if (errors) items.push(`<span><i style="background:${palette.errors};opacity:.5;height:9px"></i>Errors (right scale)</span>`);
  return `<div class="chart-legend">${items.join('')}</div>`;
}

/** Render SVG markup to an image data URL (for the PDF; JPEG keeps files small). */
export function svgToPng(svg, width, height, scale = 2, type = 'image/png', quality = 0.9) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = width * scale;
      c.height = height * scale;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL(type, quality));
    };
    img.onerror = () => reject(new Error('chart could not be drawn'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/**
 * A piece's mistakes, bar by bar: one row per run (oldest at the top, newest below), then a
 * row adding them all up. Each cell is shaded by the share of the bar's notes with a mistake,
 * with the number of them when there is room; empty where the run didn't play that bar.
 * @param {object} o { data: from pieceMistakes(), width, palette, dates: (ts) => label }
 * @returns {string} SVG markup
 */
export function mistakesChart({ data, width = 760, palette = chartPalette(), dates = (d) => new Date(d).toLocaleDateString() }) {
  if (!data || !data.rows.length) return '';
  const L = 78, R = 8, T = 20, rowH = 18, gap = 8;
  const B = data.bars, W = width - L - R, cw = W / B;
  const rows = data.rows.length;
  const H = T + rows * rowH + gap + rowH + 22;
  const x = (b) => L + b * cw;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" font-family="Helvetica, Arial, sans-serif">`;
  if (palette.bg && palette.bg !== 'transparent') s += `<rect width="${width}" height="${H}" fill="${palette.bg}"/>`;
  const tip = (c, what, b) => {
    if (!c) return `${what} · bar ${b + 1}: not played`;
    if (!c.n) return `${what} · bar ${b + 1}: no mistakes (${c.notes} note${c.notes === 1 ? '' : 's'})`;
    const parts = [c.missed && `${c.missed} missed`, c.tune && `${c.tune} wrong or far out of tune`, c.time && `${c.time} badly timed`].filter(Boolean);
    return `${what} · bar ${b + 1}: ${parts.join(', ')} (${c.n} of ${c.notes} note${c.notes === 1 ? '' : 's'})`;
  };
  const cell = (c, b, y, what, strong = false) => {
    if (!c) return '';
    const share = c.notes ? c.n / c.notes : 0;
    const fill = c.n ? palette.errors : palette.grid;
    const op = c.n ? (strong ? 0.3 : 0.22) + 0.75 * share : 0.55;
    let out = `<rect x="${x(b) + 0.5}" y="${y + 1}" width="${Math.max(1, cw - 1)}" height="${rowH - 2}" fill="${fill}" opacity="${Math.min(1, op).toFixed(2)}"><title>${esc(tip(c, what, b))}</title></rect>`;
    if (c.n && cw >= 13) out += `<text x="${x(b) + cw / 2}" y="${y + rowH / 2 + 4}" font-size="10.5" text-anchor="middle" fill="${palette.fg}" pointer-events="none">${c.n}</text>`;
    return out;
  };
  data.rows.forEach((r, j) => {
    const y = T + j * rowH;
    s += `<text x="${L - 6}" y="${y + rowH / 2 + 4}" font-size="11" text-anchor="end" fill="${palette.muted}">${esc(dates(r.d))}</text>`;
    r.cells.forEach((c, b) => { s += cell(c, b, y, dates(r.d), false); });
  });
  const yAll = T + rows * rowH + gap;
  s += `<text x="${L - 6}" y="${yAll + rowH / 2 + 4}" font-size="11" font-weight="bold" text-anchor="end" fill="${palette.fg}">All runs</text>`;
  data.all.forEach((c, b) => { s += cell(c, b, yAll, 'All runs', true); });
  // bar numbers along the top, thinned to fit
  const every = Math.max(1, Math.ceil(22 / cw));
  for (let b = 0; b < B; b++) {
    if (b % every && b !== B - 1) continue;
    if (b === B - 1 && b % every && (b % every) < every / 2) continue;
    s += `<text x="${x(b) + cw / 2}" y="${T - 6}" font-size="10.5" text-anchor="middle" fill="${palette.muted}">${b + 1}</text>`;
  }
  s += `<text x="${L + W / 2}" y="${H - 6}" font-size="11" text-anchor="middle" fill="${palette.muted}">bar</text>`;
  return s + '</svg>';
}

// green / amber / red, as on the 3D plots (scores: green from 90, amber about 60, red at 30)
const SCORE_SCALE = { good: [31, 138, 76], warn: [201, 138, 0], bad: [198, 47, 47] };
function scoreColor(v, scale = SCORE_SCALE) {
  const b = Math.max(0, Math.min(1, (90 - v) / 60));
  const mix = (c1, c2, t) => c1.map((x, k) => Math.round(x + (c2[k] - x) * t));
  return `rgb(${(b < 0.5 ? mix(scale.good, scale.warn, b / 0.5) : mix(scale.warn, scale.bad, (b - 0.5) / 0.5)).join(',')})`;
}

/**
 * One run of a piece, bar by bar: overall, intonation and timing as three column charts, the bars
 * grouped as on the Results page's 3D plots (two or three at a time in a long piece).
 * @param {object} o { run: a stored piece run, prec, palette, scale: {good,warn,bad} RGB, width }
 * @returns {string} HTML ('' if the run can't be laid out by bar)
 */
export function pieceRunCharts({ run, prec, palette = chartPalette(), scale = SCORE_SCALE, width = 760 }) {
  const b = pieceBarSurfaces([run], prec);
  if (!b || b.overall[0].steps.every((v) => v == null)) return '';
  const G = b.groups.length;
  const chart = (title, values) => {
    const L = 34, R = 6, T = 8, H = 92, B = 18, W = width - L - R, cw = W / G;
    const h = T + H + B;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" font-family="Helvetica, Arial, sans-serif" role="img" aria-label="${esc(title)} by bar">`;
    for (const g of [0, 50, 100]) {
      const y = T + H - (H * g) / 100;
      s += `<line x1="${L}" x2="${L + W}" y1="${y}" y2="${y}" stroke="${palette.grid}" stroke-width="1"/><text x="${L - 5}" y="${y + 4}" font-size="10.5" text-anchor="end" fill="${palette.muted}">${g}</text>`;
    }
    values.forEach((v, g) => {
      if (v == null) return;
      const x = L + g * cw, y = T + H - (H * v) / 100;
      const grp = b.groups[g];
      const where = grp.from === grp.to ? `Bar ${grp.from}` : `Bars ${grp.from}–${grp.to}`;
      s += `<rect x="${(x + Math.min(2, cw * 0.15)).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, cw - 2 * Math.min(2, cw * 0.15)).toFixed(1)}" height="${(T + H - y).toFixed(1)}" fill="${scoreColor(v, scale)}" rx="1.5"><title>${esc(where)}: ${Math.round(v)}</title></rect>`;
    });
    const every = Math.max(1, Math.ceil(26 / cw));
    b.labels.forEach((lab, g) => { if (g % every === 0) s += `<text x="${(L + g * cw + cw / 2).toFixed(1)}" y="${T + H + 13}" font-size="10.5" text-anchor="middle" fill="${palette.muted}">${esc(lab)}</text>`; });
    return `<h4 class="run-bars-title">${esc(title)}</h4>${s}</svg>`;
  };
  const by = b.size === 1 ? 'bar by bar' : `${b.size} bars at a time`;
  return `<div class="run-bars"><p class="muted small">This run ${by} – higher and greener is better (missing notes count as 0; bar numbers along the bottom).</p>
    ${chart('Overall', b.overall[0].steps)}${chart('Intonation', b.intonation[0].steps)}${chart('Timing (tempo)', b.timing[0].steps)}</div>`;
}
