// PDF report of syllabus and piece results, made entirely in the browser with jsPDF
// (vendor/jspdf.umd.min.js, loaded only when a PDF is requested).

import { chartPalette, svgToPng, mistakesChart } from './ui/charts.js';
import { Surface3D } from './ui/surface3d.js';
import { itemData, summaryData, chartsSvg, summaryChartsSvg, dateTime, playedHow, TWO_WEEKS, CLEARED_NOTE, PIECE_SURFACES, barGroupText, shortDate } from './ui/resultsPage.js';
import { pieceBarSurfaces, pieceMistakes } from './barSurface.js';
import { lastRuns, atLevel, surfaceRuns, sameShape, detailCleared } from './results.js';
import { precisionAt } from './precision.js';

let loading = null;
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/jspdf.umd.min.js', import.meta.url).href;
      s.onload = () => resolve(window.jspdf.jsPDF);
      s.onerror = () => { loading = null; reject(new Error('the PDF library could not be loaded')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// the built-in PDF fonts only cover Latin-1
const plain = (s) => String(s ?? '')
  .replace(/♭/g, 'b').replace(/♯/g, '#').replace(/[𝄫]/g, 'bb').replace(/[𝄪]/g, 'x')
  .replace(/♩/g, 'crotchet').replace(/♪/g, 'quaver').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');

const W_SVG = 760, H_SVG = 230;

/**
 * @param {object} o
 * @param {object[]} o.list syllabus
 * @param {object} o.results results store
 * @param {string} o.studentName
 * @param {string[]} o.items ids to include
 * @param {object} o.charts { surface, mistakes, twoWeeks, sixMonths, allTime, table }
 * @param {'all'|'2w'} o.range
 * @returns {Promise<{doc, save, filename, pages, blob}>}
 */
export async function makePdf(o) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pal = chartPalette(true);
  const now = Date.now();
  const level = o.precision ?? 2;
  const M = 15, PW = 210, PH = 297, CW = PW - 2 * M;
  let y = M;
  const need = (h) => { if (y + h > PH - M) { doc.addPage(); y = M; } };
  const text = (t, size = 10, style = 'normal', color = [28, 26, 34]) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(plain(t), CW);
    need(lines.length * size * 0.42 + 1);
    doc.text(lines, M, y + size * 0.35);
    y += lines.length * size * 0.42 + 1.5;
  };
  const image = async (svg, h = 54) => {
    if (!svg) return;
    // charts taller than the standard (the summary, with its colour key) keep their proportions
    const sh = Number((/height="(\d+(?:\.\d+)?)"/.exec(svg) || [])[1]) || H_SVG;
    if (sh !== H_SVG) h = (h * sh) / H_SVG;
    const jpg = await svgToPng(svg, W_SVG, sh, 2, 'image/jpeg', 0.88);
    need(h + 2);
    doc.addImage(jpg, 'JPEG', M, y, CW, h);
    y += h + 3;
  };
  const legend = () => {
    need(6);
    doc.setFontSize(8);
    let x = M;
    for (const [name, col] of [['Total', pal.total], ['Intonation', pal.intonation], ['Timing', pal.timing], ['Errors (bars, right scale)', pal.errors]]) {
      doc.setFillColor(col);
      doc.rect(x, y + 1, 5, 1.6, 'F');
      doc.setTextColor(102, 98, 111);
      doc.text(name, x + 6.5, y + 2.6);
      x += 7 + doc.getTextWidth(name) + 6;
    }
    y += 5;
  };

  // ---- title page header and summary (always all history)
  text('Scale practice results', 20, 'bold', [107, 63, 160]);
  if (o.studentName) text(`Student: ${o.studentName}`, 12, 'bold');
  text(`Made ${dateTime(now)} - ${o.range === '2w' ? 'exercises: past 2 weeks' : 'all history'} - summary: all history - scores at ${precisionAt(level).name} precision`, 9, 'normal', [102, 98, 111]);
  y += 3;
  const sum = summaryData(o.results, o.list.map((x) => ({ id: x.id, name: plain(x.name) })), now, level);
  const ss = summaryChartsSvg(sum, pal, W_SVG);
  text('Summary - total score per day for each exercise, past 6 months', 12, 'bold');
  if (ss.sixMonths) await image(ss.sixMonths); else text('No runs yet.', 10, 'normal', [102, 98, 111]);
  if (ss.allTime) { text('Summary - total score per month for each exercise, all history', 12, 'bold'); await image(ss.allTime); }

  // ---- each chosen exercise
  for (const id of o.items) {
    const item = o.list.find((x) => x.id === id);
    if (!item) continue;
    const data = itemData(o.results, id, now, level);
    const since = now - TWO_WEEKS;
    if (o.range === '2w') { data.sixMonths = null; data.allTime = null; }
    doc.addPage();
    y = M;
    text(item.name, 15, 'bold', [107, 63, 160]);
    const svg = chartsSvg(data, pal, W_SVG);
    if (!data.any) { text('No runs yet.', 10, 'normal', [102, 98, 111]); continue; }
    const cleared = item.piece && detailCleared(o.results[id]);
    const prec = precisionAt(o.precision ?? 2, item.settings.instrument);
    const recentRuns = () => (o.range === '2w' ? lastRuns(o.results, id).filter((r) => r.d >= since) : data.last10);
    if ((o.charts.surface || o.charts.mistakes) && cleared) text(CLEARED_NOTE, 9, 'normal', [102, 98, 111]);
    else if (item.piece) {
      // a piece: three plots by groups of bars, then where the mistakes are, bar by bar
      const recent = recentRuns();
      const full = surfaceRuns(recent);
      const runs = sameShape(full);
      const bars = o.charts.surface ? pieceBarSurfaces(runs, prec) : null;
      if (bars) {
        text(`Last ${runs.length} runs - bar by bar (oldest at the back)`, 11, 'bold');
        text(`Each run is a strip across the piece, averaged ${barGroupText(bars.size)}, with bar numbers along the front. Higher and greener is better: green from 90, amber about 60, red at 30 and below (${prec.name} precision). Missing notes count as 0; bars not played are left blank.`, 9, 'normal', [102, 98, 111]);
        if (full.length < recent.length) text(`${recent.length - full.length} run${recent.length - full.length === 1 ? '' : 's'} with more than half the notes missing left out.`, 9, 'normal', [102, 98, 111]);
        if (runs.length < full.length) text(`${full.length - runs.length} earlier run${full.length - runs.length === 1 ? '' : 's'} left out: the piece has been edited since.`, 9, 'normal', [102, 98, 111]);
        for (const p of PIECE_SURFACES) {
          const c = document.createElement('canvas');
          c.width = 1200; c.height = 500;
          new Surface3D(c, { runs: bars[p.key], labels: bars.labels.map(plain), scores: true, palette: { ...pal }, interactive: false });
          const h = (CW * 0.8 * 500) / 1200;
          need(h + 9);
          text(`${p.title} - ${p.note}`, 10, 'bold');
          doc.addImage(c.toDataURL('image/jpeg', 0.88), 'JPEG', M + CW * 0.1, y, CW * 0.8, h);
          y += h + 3;
        }
      }
      const mk = o.charts.mistakes ? pieceMistakes(sameShape(recent), prec) : null;
      if (mk) {
        text('Where the mistakes are - bar by bar', 11, 'bold');
        text(`Each row is a run (newest at the bottom); the last row adds them all up. A bar is redder the more of its notes had a mistake: missed, a wrong note or far out of tune (${Math.round(prec.zeroCents)} cents or more), or badly out of time.`, 9, 'normal', [102, 98, 111]);
        await image(mistakesChart({ data: mk, width: W_SVG, palette: pal, dates: shortDate }));
      }
    } else if (o.charts.surface) {
      const recent = o.range === '2w' ? lastRuns(o.results, id).filter((r) => r.d >= since) : data.last10;
      const full = surfaceRuns(recent); // runs with more than half the notes missing are left out
      const runs = item.piece ? sameShape(full) : full; // a piece edited since: older runs don't line up
      text(`Last ${runs.length} runs - how sharp or flat each note was (oldest at the back)`, 11, 'bold');
      if (item.piece) text('Every note of the piece left to right, with bar numbers along the front. Each run is a strip with one tile per note, coloured by how in tune it was. Bars not played in a run are left blank.', 9, 'normal', [102, 98, 111]);
      if (full.length < recent.length) text(`${recent.length - full.length} run${recent.length - full.length === 1 ? '' : 's'} with more than half the notes missing left out.`, 9, 'normal', [102, 98, 111]);
      if (runs.length < full.length) text(`${full.length - runs.length} earlier run${full.length - runs.length === 1 ? '' : 's'} left out: the piece has been edited since.`, 9, 'normal', [102, 98, 111]);
      const c = document.createElement('canvas');
      c.width = 1200; c.height = 608;
      const labels = (runs.length && runs[runs.length - 1].labels) || [];
      new Surface3D(c, { runs, labels: labels.map(plain), perNote: !!item.piece, palette: { ...pal }, interactive: false, prec: precisionAt(o.precision ?? 2, item.settings.instrument) });
      need(CW * 608 / 1200 + 2);
      doc.addImage(c.toDataURL('image/jpeg', 0.88), 'JPEG', M, y, CW, CW * 608 / 1200);
      y += CW * 608 / 1200 + 3;
    }
    if (o.charts.twoWeeks) { text('Last 2 weeks - every run', 11, 'bold'); legend(); if (svg.twoWeeks) await image(svg.twoWeeks); else text('No runs in the last 2 weeks.', 9, 'normal', [102, 98, 111]); }
    if (o.charts.sixMonths && data.sixMonths) { text('Past 6 months - average per day', 11, 'bold'); legend(); if (svg.sixMonths) await image(svg.sixMonths); else text('No runs in the past 6 months.', 9, 'normal', [102, 98, 111]); }
    if (o.charts.allTime && svg.allTime) { text('All time - average per month', 11, 'bold'); legend(); await image(svg.allTime); }
    if (o.charts.table) {
      const runs = (o.range === '2w' ? data.twoWeeks : (data.twoWeeks.length ? data.twoWeeks : data.last10)).slice(-15).reverse();
      text('Recent runs', 11, 'bold');
      const cols = [['When', 38], ['Played', 72], ['Total', 15], ['Into.', 15], ['Timing', 15], ['Errors', 15]];
      const row = (cells, bold) => {
        need(6);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(28, 26, 34);
        let x = M;
        cells.forEach((cv, k) => { doc.text(plain(cv).slice(0, k === 1 ? 52 : 30), x, y + 3.5); x += cols[k][1]; });
        y += 5;
        doc.setDrawColor(228, 225, 234);
        doc.line(M, y - 0.8, M + CW, y - 0.8);
      };
      row(cols.map((c) => c[0]), true);
      for (const r0 of runs) { const r = r0.lv ? { ...r0, ...atLevel(r0, level) } : r0; row([dateTime(r.d), playedHow(r) || '-', Math.round(r.t), Math.round(r.i), Math.round(r.ti), r.e ?? '-']); }
      if (!runs.length) text('No runs in this period.', 9, 'normal', [102, 98, 111]);
    }
  }

  // page numbers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(150, 146, 160);
    doc.text(`Scale Practice${o.studentName ? ' - ' + plain(o.studentName) : ''} - page ${p} of ${pages}`, PW / 2, PH - 7, { align: 'center' });
  }
  const d = new Date(now);
  const who = plain(o.studentName || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const filename = `scale-practice-results-${who ? who + '-' : ''}${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.pdf`;
  return { doc, pages, filename, save: () => doc.save(filename), blob: () => doc.output('blob') };
}
