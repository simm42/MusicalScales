// Small SVG charts for the Results tab and the PDF: total / intonation /
// timing as lines (0–100) and errors as bars on a right-hand axis.

export const SERIES = [
  { key: 't', name: 'Total', colorKey: 'total', width: 2.6 },
  { key: 'i', name: 'Intonation', colorKey: 'intonation', width: 1.6 },
  { key: 'ti', name: 'Timing', colorKey: 'timing', width: 1.6 },
];

/** Palette from the page's CSS variables (current theme) or a fixed light one for print. */
export function chartPalette(light = false) {
  if (light) {
    return { fg: '#1c1a22', muted: '#66626f', grid: '#e4e1ea', bg: '#ffffff', total: '#6b3fa0', intonation: '#1a73e8', timing: '#0f9d8a', errors: '#c62f2f' };
  }
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
  const dark = cs.getPropertyValue('color-scheme').trim() === 'dark';
  return {
    fg: v('--fg', '#1c1a22'), muted: v('--muted', '#66626f'), grid: v('--border', '#e4e1ea'), bg: 'transparent',
    total: v('--accent', '#6b3fa0'), intonation: dark ? '#7cb2ff' : '#1a73e8', timing: dark ? '#4fd1bd' : '#0f9d8a', errors: v('--bad', '#c62f2f'),
  };
}

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
    if (k % every !== 0 && k !== n - 1) return;
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
