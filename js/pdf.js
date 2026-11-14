// PDF report of syllabus results, made entirely in the browser with jsPDF
// (vendor/jspdf.umd.min.js, loaded only when a PDF is requested).

import { chartPalette, svgToPng } from './ui/charts.js';
import { Surface3D } from './ui/surface3d.js';
import { itemData, summaryData, chartsSvg, summaryChartsSvg, dateTime, playedHow, TWO_WEEKS } from './ui/resultsPage.js';
import { lastRuns, atLevel } from './results.js';
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
 * @param {object} o.charts { surface, twoWeeks, sixMonths, allTime, table }
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
    const jpg = await svgToPng(svg, W_SVG, H_SVG, 2, 'image/jpeg', 0.88);
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
  const sum = summaryData(o.results, o.list.map((x) => x.id), now, level);
  const ss = summaryChartsSvg(sum, pal, W_SVG);
  text('Summary - average total score per day, past 6 months (all syllabus exercises)', 12, 'bold');
  if (ss.sixMonths) await image(ss.sixMonths); else text('No runs yet.', 10, 'normal', [102, 98, 111]);
  if (ss.allTime) { text('Summary - average total score per month, all history', 12, 'bold'); await image(ss.allTime); }

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
    if (o.charts.surface) {
      const runs = o.range === '2w' ? lastRuns(o.results, id).filter((r) => r.d >= since) : data.last10;
      text(`Last ${runs.length} runs - how sharp or flat each note was (oldest at the back)`, 11, 'bold');
      const c = document.createElement('canvas');
      c.width = 1200; c.height = 608;
      const labels = (runs.length && runs[runs.length - 1].labels) || [];
      new Surface3D(c, { runs, labels: labels.map(plain), palette: { ...pal }, interactive: false, prec: precisionAt(o.precision ?? 2) });
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
