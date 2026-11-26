// "What goes wrong" for a piece on the Results tab: the notes that lean sharp or flat, the
// notes that go out after a particular note, how in tune notes are after steps and leaps,
// and every note in a table. The numbers come from noteStats.js.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const c0 = (x) => (x == null ? '–' : `${x > 0.5 ? '+' : x < -0.5 ? '−' : ''}${Math.abs(Math.round(x))}`);
const pct = (x) => `${Math.round(x * 100)}%`;
const barsText = (bars, max = 8) => {
  const list = bars.length > max ? [...bars.slice(0, max), '…'] : bars;
  return `${bars.length === 1 ? 'bar' : 'bars'} ${list.join(', ')}`;
};
const MOVE_WORDS = { same: 'the same note again', 'step up': 'a step up', 'step down': 'a step down', 'skip up': 'a skip up (a third)', 'skip down': 'a skip down (a third)', 'leap up': 'a leap up (a fourth or more)', 'leap down': 'a leap down (a fourth or more)' };

/**
 * @param {object} st from pieceNoteStats()
 * @param {object} prec precision tolerances (in tune = within fullCents)
 * @returns {string} HTML
 */
export function noteStatsHtml(st, prec) {
  if (!st || !st.heard) return '<p class="muted">No notes heard yet in the runs kept.</p>';
  const full = Math.round(prec.fullCents);
  const leanLine = (x) => `<li><b>${esc(x.name)}</b> – ${c0(x.mean)} cents on average, ${x.lean} ${Math.round((x.lean === 'sharp' ? x.sharp : x.flat) * x.n)} of the ${x.n} times it was measured (${esc(barsText(x.bars))}).</li>`;
  const leans = st.sharp.length || st.flat.length
    ? `${st.sharp.length ? `<p class="stat-head">Often sharp</p><ul class="stat-list">${st.sharp.map(leanLine).join('')}</ul>` : ''}
       ${st.flat.length ? `<p class="stat-head">Often flat</p><ul class="stat-list">${st.flat.map(leanLine).join('')}</ul>` : ''}`
    : '<p>No note leans clearly sharp or flat – well done.</p>';
  const pairLine = (p) => `<li><b>${esc(p.name)} after ${esc(p.prev)}</b>, ${esc(MOVE_WORDS[p.kind] || p.kind)}: ${c0(p.mean)} cents on average over ${p.n} time${p.n === 1 ? '' : 's'}${p.elsewhere != null ? `; elsewhere ${esc(p.name)} is ${c0(p.elsewhere)}` : ''}. ${esc(barsText(p.bars))}.${Math.abs(p.move) >= 3 ? ' A shift or a stretch – check the fingering and the hand position here.' : ''}</li>`;
  const pairs = st.pairs.length
    ? `<ul class="stat-list">${st.pairs.slice(0, 8).map(pairLine).join('')}</ul>`
    : '<p class="muted">No note goes clearly out of tune after one particular note.</p>';
  const moves = st.moves.length ? `<div class="table-wrap"><table class="notes stat-table"><thead><tr><th style="text-align:left">After…</th><th>Times</th><th>In tune</th><th>Average</th><th>Average off</th></tr></thead><tbody>
    ${st.moves.map((m) => `<tr><td style="text-align:left">${esc(MOVE_WORDS[m.kind] || m.kind)}</td><td>${m.n}</td><td>${pct(m.inTune)}</td><td>${c0(m.mean)}</td><td>${Math.round(m.meanAbs)}</td></tr>`).join('')}
    </tbody></table></div>` : '';
  const table = `<div class="table-wrap"><table class="notes stat-table"><thead><tr><th style="text-align:left">Note</th><th>Played</th><th>In tune</th><th>Sharp</th><th>Flat</th><th>Average</th><th>Wrong</th><th>Missed</th></tr></thead><tbody>
    ${st.notes.map((x) => `<tr class="${x.lean ? `lean-${x.lean}` : ''}"><td style="text-align:left">${esc(x.name)}</td><td>${x.played}</td><td>${x.n ? pct(x.inTune) : '–'}</td><td>${x.n ? pct(x.sharp) : '–'}</td><td>${x.n ? pct(x.flat) : '–'}</td><td>${c0(x.mean)}</td><td>${x.wrong || ''}</td><td>${x.missed || ''}</td></tr>`).join('')}
    </tbody></table></div>`;
  return `<p class="muted small">From the last ${st.runs} run${st.runs === 1 ? '' : 's'} (${st.heard} notes measured). In tune means within ±${full} cents at this precision; sharp and flat are beyond that. A note is only called sharp or flat when it leans that way clearly and again and again.</p>
    ${leans}
    <h4>Notes that go out after a particular note</h4>
    <p class="muted small">A note can be fine on its own but go out after a particular note – often a shift, a stretch or a string crossing.</p>
    ${pairs}
    <h4>In tune after steps and leaps</h4>
    <p class="muted small">How in tune a note is, by how it was reached. Average: which way it leans (cents); average off: how far out, either way.</p>
    ${moves}
    <details class="stat-details"><summary>Every note</summary>${table}</details>`;
}
