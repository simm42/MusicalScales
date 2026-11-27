// "What goes wrong" for a piece on the Results tab (and the PDF): the notes that are often
// sharp or flat, the notes that go out after a particular note, how in tune notes are after
// steps and leaps, and every note in a table. The numbers come from noteStats.js. What counts
// is how often a note is clearly out – not its average, which a mostly-in-tune note pulls back –
// and how it has gone lately: put right, getting better, or only started lately.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const c0 = (x) => (x == null ? '–' : `${x > 0.5 ? '+' : x < -0.5 ? '−' : ''}${Math.abs(Math.round(x))}`);
export const pct = (x) => `${Math.round(x * 100)}%`;
const barsText = (bars, max = 8) => {
  const list = bars.length > max ? [...bars.slice(0, max), '…'] : bars;
  return `${bars.length === 1 ? 'bar' : 'bars'} ${list.join(', ')}`;
};
export const MOVE_WORDS = { same: 'the same note again', 'step up': 'a step up', 'step down': 'a step down', 'skip up': 'a skip up (a third)', 'skip down': 'a skip down (a third)', 'leap up': 'a leap up (a fourth or more)', 'leap down': 'a leap down (a fourth or more)' };

const runsWord = (n) => `the last ${n} run${n === 1 ? '' : 's'}`;
/** How a problem has gone lately, in words (after the rest): '' when nothing to say. */
export const trendWords = (t, way) => {
  if (!t) return '';
  if (t.state === 'better') return ` Getting better: ${way} ${t.k} of the ${t.n} times in ${runsWord(t.runs)} (${pct(t.share)}), against ${t.beforeK} of ${t.beforeN} before (${pct(t.beforeShare)}).`;
  if (t.state === 'lately') return ` More often lately: ${way} ${t.k} of the ${t.n} times in ${runsWord(t.runs)} (${pct(t.share)}).`;
  return '';
};
/** A note often out one way, in words (after its name): "flat 4 of 12 times (33%), by −22 cents when it was …". */
export const oftenWords = (x, way) => `: ${way} ${x[`${way}N`]} of the ${x.n} times measured (${pct(x[way])}), by ${c0(x[`${way}By`])} cents on average when it was; in tune ${pct(x.inTune)} of the time (${barsText(x.bars)}).${trendWords(x[`${way}Trend`], way)}`;
/** A problem put right lately, in words (after its name, or "E2 after F2"). */
export const fixedWords = (f) => ` – was often ${f.way} (${f.trend.beforeK} of ${f.trend.beforeN} times before, ${pct(f.trend.beforeShare)}); not ${f.way} once in ${runsWord(f.trend.runs)} (${f.trend.n} times measured).`;
const dm = (ts) => { const d = new Date(ts); return `${d.getDate()}/${d.getMonth() + 1}`; };
/** A note often out after a particular note, in words (after "D4 after E4"). */
export const pairWords = (p) => `, ${MOVE_WORDS[p.kind] || p.kind}: ${p.way} ${p.k} of ${p.n} times (${pct(p.share)}), by ${c0(p.by)} cents on average${p.elseN ? `; elsewhere ${p.name} is ${p.way} ${p.elseK} of ${p.elseN} times (${pct(p.elseShare)})` : ''}. ${barsText(p.bars)}.${Math.abs(p.move) >= 3 ? ' A shift or a stretch – check the fingering and the hand position here.' : ''}${trendWords(p.trend, p.way)}`;
/** The opening line: how much it is based on, and what counts as out. */
export const statsIntro = (st, prec) => `From the ${st.runs} run${st.runs === 1 ? '' : 's'} kept${st.from != null && st.runs > 1 && dm(st.from) !== dm(st.to) ? `, ${dm(st.from)} to ${dm(st.to)}` : ''} (${st.heard} notes measured; a piece keeps its runs of the last 6 weeks, up to 100). In tune means within ±${Math.round(prec.fullCents)} cents at this precision; sharp and flat are beyond that. A note is listed when it is out the same way a quarter of the times or more – however in tune it is the rest of the time. Each is checked against the latest runs (those of the last week – at least 5, at most 10): one not out once lately is no longer listed as a problem.`;

/**
 * @param {object} st from pieceNoteStats()
 * @param {object} prec precision tolerances (in tune = within fullCents)
 * @returns {string} HTML
 */
export function noteStatsHtml(st, prec) {
  if (!st || !st.heard) return '<p class="muted">No notes heard yet in the runs kept.</p>';
  const line = (way) => (x) => `<li><b>${esc(x.name)}</b>${esc(oftenWords(x, way))}</li>`;
  const leans = st.sharp.length || st.flat.length
    ? `${st.sharp.length ? `<p class="stat-head">Often sharp</p><ul class="stat-list">${st.sharp.map(line('sharp')).join('')}</ul>` : ''}
       ${st.flat.length ? `<p class="stat-head">Often flat</p><ul class="stat-list">${st.flat.map(line('flat')).join('')}</ul>` : ''}`
    : '<p>No note is often sharp or flat – well done.</p>';
  const fixedName = (f) => (f.prev ? `${f.name} after ${f.prev}` : f.name);
  const fixed = st.fixed && st.fixed.length
    ? `<p class="stat-head">Put right lately</p><ul class="stat-list">${st.fixed.map((f) => `<li><b>${esc(fixedName(f))}</b>${esc(fixedWords(f))}</li>`).join('')}</ul>`
    : '';
  const pairLine = (p) => `<li><b>${esc(p.name)} after ${esc(p.prev)}</b>${esc(pairWords(p))}</li>`;
  const pairs = st.pairs.length
    ? `<ul class="stat-list">${st.pairs.slice(0, 8).map(pairLine).join('')}</ul>`
    : '<p class="muted">No note goes out more often after one particular note.</p>';
  const moves = st.moves.length ? `<div class="table-wrap"><table class="notes stat-table"><thead><tr><th style="text-align:left">After…</th><th>Times</th><th>In tune</th><th>Sharp</th><th>Flat</th><th>Average off</th></tr></thead><tbody>
    ${st.moves.map((m) => `<tr><td style="text-align:left">${esc(MOVE_WORDS[m.kind] || m.kind)}</td><td>${m.n}</td><td>${pct(m.inTune)}</td><td>${pct(m.sharp)}</td><td>${pct(m.flat)}</td><td>${Math.round(m.meanAbs)}</td></tr>`).join('')}
    </tbody></table></div>` : '';
  const table = `<div class="table-wrap"><table class="notes stat-table"><thead><tr><th style="text-align:left">Note</th><th>Played</th><th>In tune</th><th>Sharp</th><th>Flat</th><th>Average</th><th>Wrong</th><th>Missed</th></tr></thead><tbody>
    ${st.notes.map((x) => `<tr class="${x.oftenSharp || x.oftenFlat ? 'lean-sharp' : ''}"><td style="text-align:left">${esc(x.name)}</td><td>${x.played}</td><td>${x.n ? pct(x.inTune) : '–'}</td><td>${x.n ? pct(x.sharp) : '–'}</td><td>${x.n ? pct(x.flat) : '–'}</td><td>${c0(x.mean)}</td><td>${x.wrong || ''}</td><td>${x.missed || ''}</td></tr>`).join('')}
    </tbody></table></div>`;
  return `<p class="muted small">${esc(statsIntro(st, prec))}</p>
    ${leans}
    ${fixed}
    <h4>Notes that go out after a particular note</h4>
    <p class="muted small">A note can be fine on its own but go out after a particular note – often a shift, a stretch or a string crossing. Listed when it is out the same way at least half the times after that note, and a quarter (or more) of the times more often than elsewhere.</p>
    ${pairs}
    <h4>In tune after steps and leaps</h4>
    <p class="muted small">How often a note is in tune, sharp or flat, by how it was reached. Average off: how far out, either way (cents).</p>
    ${moves}
    <details class="stat-details"><summary>Every note</summary>${table}</details>`;
}
