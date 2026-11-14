// Tiny inline SVG note pictures for the rhythm buttons (drawn rather than
// typed, because the minim and rest characters are missing from many phone fonts).
// Tokens: 'm' minim, 'c' crotchet, 'qq' two beamed quavers, 'r' quaver rest.

const H = 22, HEAD_Y = 16, STEM_TOP = 3;

function head(x, filled) {
  // slanted oval note head
  return `<ellipse cx="${x}" cy="${HEAD_Y}" rx="3.6" ry="2.6" transform="rotate(-22 ${x} ${HEAD_Y})" ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.3"'}/>`;
}
const stem = (x) => `<line x1="${x + 3.2}" y1="${HEAD_Y - 1}" x2="${x + 3.2}" y2="${STEM_TOP}" stroke="currentColor" stroke-width="1.2"/>`;

export function noteIcon(tokens) {
  let x = 4;
  let body = '';
  for (const t of tokens) {
    if (t === 'm' || t === 'c') {
      body += head(x, t === 'c') + stem(x);
      x += 11;
    } else if (t === 'qq') {
      body += head(x, true) + stem(x) + head(x + 9, true) + stem(x + 9);
      body += `<rect x="${x + 2.6}" y="${STEM_TOP}" width="${9 + 1.2}" height="2.6" fill="currentColor"/>`;
      x += 20;
    } else if (t === 'r') {
      // quaver rest: a dot with a tail
      body += `<circle cx="${x + 1.5}" cy="8" r="2" fill="currentColor"/>`;
      body += `<path d="M${x + 1.5} 9.5 Q${x + 4} 10 ${x + 6} 7.5 L${x + 2.8} 19" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`;
      x += 10;
    }
  }
  const w = x;
  return `<svg class="note-icon" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Pictures for the rhythms that need them (others keep their text label). */
export const RHYTHM_ICONS = {
  crotchetLong: ['m', 'c', 'c', 'm'],
  crotchetLongMid: ['m', 'c', 'm', 'c', 'm'],
  q2r: ['qq', 'r'],
};
