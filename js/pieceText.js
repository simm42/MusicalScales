// The music text format for pieces: a strict subset of ABC notation – a plain
// text way of writing music that people and AI models already know. One line
// of music (one instrument part); double stops allowed. No DOM access.
//
// What is understood (anything else is reported with its line and column):
//
//   Header (one per line, K: last):  T: title   C: composer   M: 4/4 (or C, C|)
//                                    L: 1/8 (the unit note length)   Q: 1/4=96
//                                    K: G   K: Em   K: Bb   K: D clef=bass
//   Notes:     C D E F G A B = the octave from middle C;  c d e … b = the octave above;
//              , lowers an octave (C, = C below middle C), ' raises (c' = two above middle C)
//   Accidentals: ^ sharp  _ flat  = natural  ^^ double sharp  __ double flat
//              (an accidental lasts to the end of the bar, as in printed music)
//   Lengths:   multiples of L:  A = 1 unit, A2 = 2, A3 = 3, A/2 or A/ = half, A3/2 = 1½
//   Rests:     z (with a length like a note), Z = a whole bar's rest
//   Bars:      |   ||   |]   repeats |: … :| (played twice)
//   Ties:      A2-A   Slurs: (ABc)   Double stops: [DA] or [D2A2]
//   Staccato:  .A (a dot)   Tenuto: !tenuto!A (a line) – under a slur, a little gap before the next note
//   Triplets:  (3abc   Dotted pairs: A>B (= A3/2 B/2)   A<B
//   Changes in the middle:  [K:D] [M:3/4] [L:1/16] [Q:120] or a K:/M:/L: line
//   Ignored:   % comments, "chord names", other !decorations!, grace notes {…}, w: lyrics, ~ u v

import { parsePc, keyFifths, keySigAccidental, midiOf } from './theory.js';

const MODE_SHIFT = { '': 0, maj: 0, major: 0, ion: 0, ionian: 0, m: -3, min: -3, minor: -3, aeo: -3, aeolian: -3, mix: -1, mixolydian: -1, dor: -2, dorian: -2, phr: -4, phrygian: -4, lyd: 1, lydian: 1, loc: -5, locrian: -5 };
const CLEFS = ['treble', 'bass', 'alto', 'tenor'];

/** Pull the music out of an AI's answer: the first ``` block, or from the first header line. */
export function extractPieceText(reply) {
  const s = String(reply || '').replace(/\r\n?/g, '\n');
  const blocks = [...s.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const withKey = blocks.find((b) => /^\s*K:/m.test(b));
  if (withKey) return withKey.trim();
  if (blocks.length) return blocks[0].trim();
  const at = s.search(/^\s*(X|T|M|L|K):/m);
  return (at >= 0 ? s.slice(at) : s).trim();
}

/** Key field ("G", "Em", "Bb minor", "D clef=bass", "none") → { fifths, clef, name } or error. */
export function parseKey(v) {
  let clef = null;
  let rest = v.replace(/\bclef\s*=\s*(\w+)/i, (_, c) => { clef = c.toLowerCase(); return ''; });
  rest = rest.replace(/\b(treble|bass|alto|tenor)\b/i, (m) => { clef = clef || m.toLowerCase(); return ''; }).trim();
  if (clef && !CLEFS.includes(clef)) return { error: `Unknown clef "${clef}" (use treble, bass, alto or tenor)` };
  if (!rest || /^none$/i.test(rest)) return { fifths: 0, clef, name: 'C' };
  const m = /^([A-Ga-g])\s*([#b♯♭]?)\s*([A-Za-z]*)/.exec(rest);
  if (!m) return { error: `Can't read the key "${v}"` };
  const mode = m[3].toLowerCase();
  if (!(mode in MODE_SHIFT)) return { error: `Unknown mode "${m[3]}" in the key` };
  const acc = m[2] === '#' || m[2] === '♯' ? '#' : m[2] === 'b' || m[2] === '♭' ? 'b' : '';
  const tonic = parsePc(m[1].toUpperCase() + acc);
  const fifths = keyFifths(tonic, 'major') + MODE_SHIFT[mode];
  if (fifths < -7 || fifths > 7) return { error: `The key "${v}" needs more than seven sharps or flats` };
  return { fifths, clef, name: m[1].toUpperCase() + acc + (MODE_SHIFT[mode] === -3 ? 'm' : mode && MODE_SHIFT[mode] ? ' ' + mode : '') };
}

function parseFraction(v) {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(v);
  return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
}

function parseMeter(v) {
  const t = v.trim();
  if (t === 'C') return { num: 4, den: 4, text: '4/4' };
  if (t === 'C|') return { num: 2, den: 2, text: '2/2' };
  if (/^none$/i.test(t)) return null;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  return m ? { num: Number(m[1]), den: Number(m[2]), text: `${m[1]}/${m[2]}` } : undefined;
}

/** Q: "1/4=96", "96", "3/8=60" → crotchet beats per minute. */
function parseTempo(v) {
  const m = /(?:(\d+)\s*\/\s*(\d+)\s*=\s*)?(\d+(?:\.\d+)?)/.exec(v.replace(/"[^"]*"/g, ''));
  if (!m) return null;
  const unit = m[1] ? Number(m[1]) / Number(m[2]) : 0.25;
  return Math.round(Number(m[3]) * unit * 4);
}

/**
 * Read a piece. @returns { ok, errors:[{line,col,message}], warnings:[…], title, composer,
 *  meter, tempo, key:{fifths,name}, clef, tokens:[note|rest|bar] }
 * A note token: { kind:'note', notes:[{l,a,o}], beats, nominal, tie, slurStart, slurEnd, tuplet, line, col }
 * (beats in crotchets; nominal = written length before any triplet)
 */
export function parsePiece(text) {
  const errors = [], warnings = [];
  const P = { title: '', composer: '', meter: { num: 4, den: 4, text: '4/4' }, unit: null, tempo: null, key: { fifths: 0, name: 'C' }, clef: null, tokens: [] };
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let inBody = false;
  let unit = null;                 // fraction of a whole note
  let fifths = 0, clef = null;
  let barAcc = {};                 // accidentals in force this bar: "l:o" → a
  let tupletLeft = 0, tupletFactor = 1, tupletId = 0, curTuplet = null;
  let slurDepth = 0, pendingSlurStart = 0;
  let pendingBroken = null;        // factor for the next note after > or <
  let pendingArt = null;           // 'staccato' (.) or 'tenuto' (!tenuto!) for the next note
  let repeatFrom = 0;              // token index where the current repeat starts
  let sawVoice = false;
  const err = (line, col, message) => errors.push({ line: line + 1, col: col + 1, message });
  const unitOrDefault = () => unit ?? ((P.meter && P.meter.num / P.meter.den < 0.75) ? 1 / 16 : 1 / 8);

  const field = (key, val, li, col, inline) => {
    const v = val.trim();
    switch (key) {
      case 'X': case 'N': case 'Z': case 'S': case 'O': case 'R': case 'H': case 'B': case 'D': case 'G': case 'F': case 'I': case 'P': case 'r': case 's': case 'W': case 'U':
        return;
      case 'T': if (!P.title) P.title = v; else if (inBody) warnings.push({ line: li + 1, message: `A second title "${v}" was ignored` }); return;
      case 'C': if (!P.composer) P.composer = v; return;
      case 'w': return; // lyrics
      case 'V':
        if (sawVoice) err(li, col, 'Only one instrument part can be read – there is a second voice (V:) here.');
        sawVoice = true; return;
      case 'M': {
        const m = parseMeter(v);
        if (m === undefined) { err(li, col, `Can't read the time signature "${v}" (write it like 3/4)`); return; }
        if (inBody || inline) P.tokens.push({ kind: 'meter', meter: m });
        else P.meter = m;
        return;
      }
      case 'L': {
        const f = parseFraction(v);
        if (!f) { err(li, col, `Can't read the note length "${v}" (write it like 1/8)`); return; }
        unit = f;
        if (!inBody && !inline) P.unit = f;
        return;
      }
      case 'Q': { const t = parseTempo(v); if (t) { if (!inBody && !inline) P.tempo = t; else P.tokens.push({ kind: 'tempo', tempo: t }); } return; }
      case 'K': {
        const k = parseKey(v);
        if (k.error) { err(li, col, k.error); return; }
        if (!inBody && !inline) { P.key = { fifths: k.fifths, name: k.name }; P.clef = k.clef; }
        else P.tokens.push({ kind: 'key', fifths: k.fifths, name: k.name, clef: k.clef });
        fifths = k.fifths;
        if (k.clef) clef = k.clef;
        inBody = true;
        return;
      }
      default:
        warnings.push({ line: li + 1, message: `The field ${key}: was ignored` });
    }
  };

  const lastNote = () => { for (let i = P.tokens.length - 1; i >= 0; i--) if (P.tokens[i].kind === 'note' || P.tokens[i].kind === 'rest') return P.tokens[i]; return null; };

  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    const pct = line.indexOf('%');
    if (pct >= 0) line = line.slice(0, pct);
    if (!line.trim()) continue;
    const fm = /^\s*([A-Za-z]):(.*)$/.exec(line);
    // a field line; in the music only K M L Q T V w W P N I are fields ("G:|" is a G and a repeat)
    if (fm && (!inBody || 'KMLQTVwWPNI'.includes(fm[1]))) {
      field(fm[1], fm[2], li, line.indexOf(fm[1]), false);
      continue;
    }
    if (!inBody) { inBody = true; warnings.push({ line: li + 1, message: 'No K: (key) line before the music – C major assumed' }); }

    let i = 0;
    const s = line;
    while (i < s.length) {
      const ch = s[i];
      const col = i;
      if (ch === ' ' || ch === '\t' || ch === '`' || ch === '\\' || ch === '$') { i++; continue; }
      if (ch === '"') { const j = s.indexOf('"', i + 1); i = j < 0 ? s.length : j + 1; continue; } // chord names
      if (ch === '!' || ch === '+') { // decorations: staccato and tenuto are kept, the rest ignored
        const j = s.indexOf(ch, i + 1);
        const name = j < 0 ? '' : s.slice(i + 1, j).toLowerCase();
        if (name === 'staccato' || name === 'tenuto') pendingArt = name;
        i = j < 0 ? s.length : j + 1;
        continue;
      }
      if (ch === '{') { const j = s.indexOf('}', i + 1); i = j < 0 ? s.length : j + 1; continue; } // grace notes
      if (ch === '.') { pendingArt = 'staccato'; i++; continue; }
      if ('~HLMOPSTuvJR'.includes(ch)) { i++; continue; } // other one-letter decorations
      // inline field [K:..]
      if (ch === '[' && /^[A-Za-z]:/.test(s.slice(i + 1, i + 3))) {
        const j = s.indexOf(']', i);
        if (j < 0) { err(li, col, 'An inline field like [K:D] is not closed with ]'); break; }
        field(s[i + 1], s.slice(i + 3, j), li, col, true);
        i = j + 1;
        continue;
      }
      // bar lines and repeats
      if (ch === '|' || ch === ':' || (ch === '[' && s[i + 1] === '|')) {
        const m = /^(\[\||:*\|+\]?:*|:+\|*:*|\|\])(\d+)?/.exec(s.slice(i));
        const sym = m ? m[1] : ch;
        if (m && m[2]) { err(li, col, `First/second-time endings (${sym}${m[2]}) can't be read – please write the repeat out in full.`); }
        i += m ? m[0].length : 1;
        if (/^\[\d/.test(s.slice(i))) { err(li, i, 'First/second-time endings can\'t be read – please write the repeat out in full.'); i += 2; }
        const endRepeat = sym.startsWith(':');
        const startRepeat = sym.endsWith(':');
        P.tokens.push({ kind: 'bar', sym, line: li + 1 });
        barAcc = {};
        if (endRepeat) {
          // play the repeated section again (written out)
          const section = P.tokens.slice(repeatFrom, P.tokens.length - 1).map((t) => ({ ...t, repeated: true }));
          if (section.some((t) => t.kind === 'note' || t.kind === 'rest')) P.tokens.push(...section, { kind: 'bar', sym: '|', line: li + 1 });
        }
        if (startRepeat || endRepeat) repeatFrom = P.tokens.length;
        continue;
      }
      if (ch === '[' && /\d/.test(s[i + 1] || '')) { err(li, col, 'First/second-time endings can\'t be read – please write the repeat out in full.'); i += 2; continue; }
      if (ch === '(') {
        const m = /^\((\d)(?::(\d)?)?(?::(\d))?/.exec(s.slice(i));
        if (m) {
          const p = Number(m[1]);
          const q = m[2] ? Number(m[2]) : ({ 2: 3, 3: 2, 4: 3, 6: 2, 8: 3 }[p] || 2);
          tupletLeft = m[3] ? Number(m[3]) : p;
          tupletFactor = q / p;
          curTuplet = { id: ++tupletId, p, q };
          i += m[0].length;
          continue;
        }
        pendingSlurStart++;
        i++;
        continue;
      }
      if (ch === ')') {
        const n = lastNote();
        if (n && n.kind === 'note' && slurDepth + pendingSlurStart > 0) { n.slurEnd = true; slurDepth = Math.max(0, slurDepth - 1); }
        i++;
        continue;
      }
      if (ch === '-') { const n = lastNote(); if (n && n.kind === 'note') n.tie = true; i++; continue; }
      if (ch === '>' || ch === '<') {
        let k = 1;
        while (s[i + k] === ch) k++;
        const big = 2 - Math.pow(0.5, k), small = Math.pow(0.5, k);
        const n = lastNote();
        if (n) { const f = ch === '>' ? big : small; n.beats *= f; n.nominal *= f; }
        pendingBroken = ch === '>' ? small : big;
        i += k;
        continue;
      }
      // a note, a chord or a rest
      let notes = [], restKind = null, j = i, innerLen = '';
      const readNote = (pos) => {
        const m = /^(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)/.exec(s.slice(pos));
        if (!m) return null;
        const letter = m[2];
        const l = 'CDEFGAB'.indexOf(letter.toUpperCase());
        let o = letter === letter.toUpperCase() ? 4 : 5;
        for (const c of m[3]) o += c === "'" ? 1 : -1;
        const keyA = keySigAccidental(fifths, l);
        const slot = `${l}:${o}`;
        let a;
        if (m[1]) { a = { '^^': 2, '^': 1, '=': 0, '_': -1, '__': -2 }[m[1]]; barAcc[slot] = a; }
        else a = slot in barAcc ? barAcc[slot] : keyA;
        return { note: { l, a, o }, len: m[0].length };
      };
      if (ch === '[') {
        j = i + 1;
        while (j < s.length && s[j] !== ']') {
          if (s[j] === ' ') { j++; continue; }
          const r = readNote(j);
          if (!r) { err(li, j, `Can't read "${s[j]}" inside a double stop [ ]`); j++; continue; }
          notes.push(r.note);
          j += r.len;
          const d = /^(\d*)(\/*)(\d*)/.exec(s.slice(j));
          if (!innerLen && d[0]) innerLen = d[0]; // [D2A2]: the length written on the notes
          j += d[0].length;
          if (s[j] === '-') j++;
        }
        if (s[j] !== ']') { err(li, i, 'A double stop [ ] is not closed with ]'); break; }
        j++;
        if (!notes.length) { err(li, i, 'An empty [ ]'); i = j; continue; }
        if (notes.length > 2) warnings.push({ line: li + 1, message: `A chord of ${notes.length} notes – only the top two are listened for` });
        notes = notes.sort((x, y) => (x.o * 7 + x.l) - (y.o * 7 + y.l)).slice(-2);
      } else if (ch === 'z' || ch === 'x') { restKind = 'rest'; j = i + 1; }
      else if (ch === 'Z') { restKind = 'bar-rest'; j = i + 1; }
      else {
        const r = readNote(i);
        if (!r) { err(li, col, `Can't read "${ch}"`); i++; continue; }
        notes = [r.note];
        j = i + r.len;
      }
      // length (after the note, or after a double stop's ])
      let d = /^(\d*)(\/*)(\d*)/.exec(s.slice(j));
      j += d[0].length;
      if (!d[0] && innerLen) d = /^(\d*)(\/*)(\d*)/.exec(innerLen);
      let mult = d[1] ? Number(d[1]) : 1;
      if (d[2]) mult /= d[3] ? Number(d[3]) * Math.pow(2, d[2].length - 1) : Math.pow(2, d[2].length);
      if (!(mult > 0)) { err(li, col, 'A note length of 0'); mult = 1; }
      let beats;
      if (restKind === 'bar-rest') {
        const bars = d[1] ? Number(d[1]) : 1;
        const m = P.tokens.slice().reverse().find((t) => t.kind === 'meter');
        const meter = m ? m.meter : P.meter;
        beats = bars * (meter ? (meter.num * 4) / meter.den : 4);
      } else beats = unitOrDefault() * mult * 4;
      let nominal = beats;
      if (pendingBroken) { beats *= pendingBroken; nominal *= pendingBroken; pendingBroken = null; }
      if (tupletLeft > 0) { beats *= tupletFactor; tupletLeft--; }
      const tuplet = beats !== nominal && curTuplet ? curTuplet : null;
      const tok = restKind
        ? { kind: 'rest', beats, nominal, line: li + 1, col: col + 1, tuplet }
        : { kind: 'note', notes, beats, nominal, tie: false, slurStart: pendingSlurStart > 0, slurEnd: false, line: li + 1, col: col + 1, tuplet };
      if (!restKind && pendingSlurStart) { slurDepth += pendingSlurStart; pendingSlurStart = 0; }
      if (!restKind && pendingArt) tok.art = pendingArt;
      pendingArt = null;
      if (tok.kind === 'note' && s[j] === '-') { tok.tie = true; j++; }
      if (tupletLeft === 0) curTuplet = null;
      P.tokens.push(tok);
      i = j;
    }
  }
  if (!P.tokens.some((t) => t.kind === 'note')) err(0, 0, 'No notes were found.');
  if (!errors.length) warnings.push(...checkBars(P), ...checkRegister(P));
  P.unit = P.unit ?? unitOrDefault();
  P.clef = P.clef || null;
  P.errors = errors;
  P.warnings = warnings;
  P.ok = errors.length === 0;
  return P;
}

// ---------------------------------------------------------------- checks on music that can be read
// Likely misreadings of a photo. They are warnings ({ check: true }): the piece can still be practised.

/** Bars that don't add up to the time signature (a short first or last bar is allowed). */
function checkBars(P) {
  const bars = [];
  let meter = P.meter, cur = null;
  for (const t of P.tokens) {
    if (t.repeated) continue; // a repeat written out by the reader – its bars were checked the first time
    if (t.kind === 'meter') { meter = t.meter; continue; }
    if (t.kind === 'bar') { if (cur && cur.beats > 0) bars.push(cur); cur = null; continue; }
    if (t.kind !== 'note' && t.kind !== 'rest') continue;
    if (!cur) cur = { beats: 0, line: t.line, meter };
    cur.beats += t.beats;
  }
  if (cur && cur.beats > 0) bars.push(cur);
  const out = [];
  bars.forEach((b, i) => {
    if (!b.meter) return;
    const want = (b.meter.num * 4) / b.meter.den;
    const short = b.beats < want - 1e-6, long = b.beats > want + 1e-6;
    if (long || (short && i > 0 && i < bars.length - 1)) {
      const have = Math.round(((b.beats * b.meter.den) / 4) * 100) / 100;
      out.push({ line: b.line, check: true, message: `Bar ${i + 1} adds up to ${have}/${b.meter.den}, but the time signature is ${b.meter.text} – a note length or a note is probably wrong` });
    }
  });
  return out.slice(0, 6);
}

// the note on the middle line of each clef (MIDI)
const CLEF_MIDDLE = { treble: 71, alto: 60, tenor: 57, bass: 50 };
const CLEF_LINES = { treble: 'E G B d f', alto: 'F, A, C E G', tenor: 'D, F, A, C E', bass: 'G,, B,, D, F, A,' };

/** Most notes far above or below the staff of the clef: the octave was probably written wrongly. */
function checkRegister(P) {
  const clef = P.clef;
  if (!clef || !(clef in CLEF_MIDDLE)) return [];
  const m = P.tokens.filter((t) => t.kind === 'note' && !t.repeated).map((t) => midiOf(t.notes[0])).sort((a, b) => a - b);
  if (m.length < 4) return [];
  const median = m[m.length >> 1];
  const off = median - CLEF_MIDDLE[clef];
  if (Math.abs(off) <= 12) return []; // a tune low on the violin's G string sits an octave below the middle line
  return [{
    line: P.tokens.find((t) => t.kind === 'note').line, check: true,
    message: `Most notes are written more than an octave ${off > 0 ? 'above' : 'below'} the ${clef} clef staff, so the octave is probably wrong. On a ${clef} clef staff the five lines from the bottom are ${CLEF_LINES[clef]}`,
  }];
}
