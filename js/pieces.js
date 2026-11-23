// Pieces: any music to practise with the arrow, the tuner bar and scoring.
// Saved on this device; joined (A + B); and the instructions given to an AI
// (Claude) to turn a photo of sheet music into the text format.
// No DOM access (apart from localStorage for the saved pieces).

import { parsePiece } from './pieceText.js';
import { b64urlEncode, b64urlDecode } from './practiceList.js';
import { midiOf } from './theory.js';

// ---------------------------------------------------------------- notes the app can draw, play and follow

// lengths that can be written as one note (in crotchet beats) → VexFlow duration
const WRITABLE = [[4, 'w'], [3, 'hd'], [2, 'h'], [1.5, 'qd'], [1, 'q'], [0.75, '8d'], [0.5, '8'], [0.375, '16d'], [0.25, '16'], [0.125, '32']];
const durFor = (beats) => (WRITABLE.find(([b]) => Math.abs(b - beats) < 1e-6) || [])[1] || null;

/** A length as written notes tied together (largest first). */
export function splitLength(beats) {
  const out = [];
  let left = beats;
  while (left > 1e-6 && out.length < 12) {
    const w = WRITABLE.find(([b]) => b <= left + 1e-6);
    if (!w) { out.push([left, '32']); break; }
    out.push(w);
    left -= w[0];
  }
  return out;
}

/**
 * Build what the score, the player and the listener need – the same shape as
 * a scale's sequence: glyphs (what is drawn) and events (notes to play).
 * @param P parsed piece  @param info instrument info (for the sounding pitch and clef)
 */
export function pieceSequence(P, info) {
  const glyphs = [], events = [];
  let beat = 0, bar = 0, barStart = 0;
  let meter = P.meter || { num: 4, den: 4 };
  let fifths = P.key.fifths;
  let clef = P.clef || info.clef;
  let pendingKey = null, pendingClef = null;
  let slurId = -1, slurOpen = false;
  let prevNoteTok = null;
  const beamIds = new Map();
  const beamUnit = () => (meter.den === 8 && meter.num % 3 === 0 && meter.num > 3 ? 1.5 : 1);

  for (const t of P.tokens) {
    if (t.kind === 'bar') {
      const last = glyphs[glyphs.length - 1];
      if (last && beat > barStart) { last.barAfter = t.sym; bar++; barStart = beat; }
      continue;
    }
    if (t.kind === 'meter') { if (t.meter) meter = t.meter; continue; }
    if (t.kind === 'key') { if (t.fifths != null) { fifths = t.fifths; pendingKey = t.fifths; } if (t.clef) pendingClef = t.clef; continue; }
    if (t.kind === 'tempo') continue;
    if (t.kind !== 'note' && t.kind !== 'rest') continue;

    // tied to the note before (same pitch): one longer event
    const tiedOn = t.kind === 'note' && prevNoteTok && prevNoteTok.tie
      && prevNoteTok.notes.length === t.notes.length && prevNoteTok.notes.every((n, k) => midiOf(n) === midiOf(t.notes[k]));
    // written as one note when possible (triplets keep their written length)
    const parts = t.tuplet ? [[t.beats, durFor(t.nominal) || '8']] : (durFor(t.beats) ? [[t.beats, durFor(t.beats)]] : splitLength(t.beats));
    if (t.kind === 'note' && t.slurStart) { slurId++; slurOpen = true; }
    const first = glyphs.length;
    parts.forEach(([b, dur], k) => {
      const inBar = beat - barStart;
      const short = /^(8|16|32)/.test(dur);
      let beamGroup = null;
      if (short && t.kind === 'note') {
        const key = `${bar}:${Math.floor(inBar / beamUnit() + 1e-6)}:${t.tuplet ? 't' + t.tuplet.id : ''}`;
        if (!beamIds.has(key)) beamIds.set(key, beamIds.size);
        beamGroup = beamIds.get(key);
      }
      const g = {
        kind: t.kind, notes: t.kind === 'note' ? t.notes : [], dur, beats: b, onsetBeat: beat, stepIndex: bar,
        beamGroup, fifths, clef, tuplet: t.tuplet || null, srcLine: t.line, srcCol: t.col,
      };
      if (pendingKey != null) { g.keyChange = pendingKey; pendingKey = null; }
      if (pendingClef) { g.clefChange = pendingClef; clef = pendingClef; g.clef = clef; pendingClef = null; }
      if (t.kind === 'note' && slurOpen) g.slurGroup = slurId;
      if (t.art && k === 0) g.articulation = t.art;
      if (t.shift && k === 0) g.shift = true; // a position change before this note
      if (k < parts.length - 1) g.tieNext = true;
      if (k > 0) g.tiedFrom = true; // the rest of a long note written as tied notes (fingering only on the first)
      glyphs.push(g);
      beat += b;
    });
    if (t.kind === 'note') {
      if (tiedOn && events.length) {
        const e = events[events.length - 1];
        glyphs[e.lastGlyph].tieNext = true;
        e.beats += t.beats;
        e.lastGlyph = glyphs.length - 1;
        glyphs[e.glyphIndex].beats = e.beats; // the player sounds the whole tied length
      } else {
        const e = {
          index: events.length, glyphIndex: first, lastGlyph: glyphs.length - 1,
          notes: t.notes, writtenMidis: t.notes.map(midiOf), midis: t.notes.map((n) => midiOf(n) + info.transpose),
          onsetBeat: glyphs[first].onsetBeat, beats: t.beats, stepIndex: bar,
          slurred: slurOpen && !t.slurStart,
        };
        // staccato / tenuto: the note is let go early, so even under a slur there is a gap before the next
        if (t.art) e.articulation = t.art;
        glyphs[first].eventIndex = e.index;
        glyphs[first].beats = t.beats;
        events.push(e);
      }
      if (t.slurEnd) slurOpen = false;
      prevNoteTok = t;
    } else prevNoteTok = null;
  }
  for (let i = 1; i < events.length; i++) events[i].sameAsPrev = events[i].midis.join() === events[i - 1].midis.join();
  const bars = bar + (beat > barStart ? 1 : 0);
  // results are kept note by note across the whole piece (resultStep), so a run of a few
  // bars fills just those notes on the Results page's 3D plot; the rest stay blank
  events.forEach((e) => { e.resultStep = e.index; });
  return { glyphs, events, totalBeats: beat, steps: events.map(() => []), bars, piece: true };
}

/** Labels for the 3D plot's notes: the bar number under the first note of each bar. */
export function pieceNoteLabels(seq) {
  return seq.events.map((e, k) => (k === 0 || seq.events[k - 1].stepIndex !== e.stepIndex ? String(e.stepIndex + 1) : ''));
}

/** The beat each bar starts on (bars counted from 0), and the end of the piece. */
export function barStarts(seq) {
  const starts = [];
  for (const g of seq.glyphs) if (starts[g.stepIndex] == null) starts[g.stepIndex] = g.onsetBeat;
  starts.push(seq.totalBeats);
  return starts;
}

/** A chosen section, kept within the piece: { from, to } bars counted from 0 (or null for the whole piece). */
export function clampSection(sec, bars) {
  if (!sec || !(bars > 0)) return null;
  let from = Math.max(0, Math.min(bars - 1, Math.round(sec.from)));
  let to = Math.max(0, Math.min(bars - 1, Math.round(sec.to)));
  if (from > to) [from, to] = [to, from];
  return from === 0 && to === bars - 1 ? null : { from, to };
}

/**
 * Just some bars of a piece, to practise on their own: the notes of those bars,
 * numbered from 0 and timed from the start of the first bar (so a rest at its start
 * is waited for). Each note keeps `full`, its number in the whole piece (for the score),
 * and its bar (stepIndex), so results line up with the whole piece's bars.
 * `timeline` lists every note and rest of the section with its beat, for the arrow.
 */
export function sectionSequence(seq, sec) {
  const starts = barStarts(seq);
  const from = sec ? sec.from : 0, to = sec ? sec.to : seq.bars - 1;
  const base = starts[from] ?? 0, end = starts[to + 1] ?? seq.totalBeats;
  const events = seq.events
    .filter((e) => e.stepIndex >= from && e.stepIndex <= to)
    .map((e, k) => ({ ...e, index: k, full: e.index, onsetBeat: e.onsetBeat - base, slurred: k === 0 ? false : e.slurred }));
  for (let i = 0; i < events.length; i++) events[i].sameAsPrev = i > 0 && events[i].midis.join() === events[i - 1].midis.join();
  const timeline = [];
  seq.glyphs.forEach((g, gi) => {
    if (g.stepIndex < from || g.stepIndex > to) return;
    timeline.push({ gi, kind: g.kind, beat: g.onsetBeat - base, beats: g.beats, tied: !!g.tiedFrom });
  });
  return { ...seq, events, totalBeats: end - base, section: sec ? { from, to } : null, startBeat: base, timeline };
}

/**
 * Everything the Practice page needs for a piece, shaped like a scale exercise.
 * @returns {{ ok, exercise, seq, parsed }}
 */
export function pieceExercise(piece, info, settings) {
  const parsed = parsePiece(piece.text);
  const seq = pieceSequence(parsed, info);
  const ok = parsed.ok && seq.events.length > 0;
  const low = info.lowestMidi, high = info.highestMidi;
  const outside = seq.events.filter((e) => e.writtenMidis.some((m) => m < low - 0 || m > high + 7)).length;
  const exercise = {
    ok, isPiece: true, piece, settings,
    title: piece.name || parsed.title || 'Untitled',
    info: { ...info, clef: parsed.clef || info.clef },
    fifths: parsed.key.fifths,
    keyName: parsed.key.name,
    meterText: parsed.meter ? parsed.meter.text : null,
    bars: seq.bars,
    tempo: parsed.tempo,
    beat: tempoBeat(parsed.meter),
    type: { doubleStop: false, label: 'Piece', slurs: [] },
    reason: ok ? '' : (parsed.errors[0] ? `Line ${parsed.errors[0].line}: ${parsed.errors[0].message}` : 'No notes.'),
    outside,
  };
  return { ok, exercise, seq, parsed };
}

// ---------------------------------------------------------------- saved pieces

const KEY = 'scales.pieces.v1';
const uid = () => 'p' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

export function loadPieces(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { const l = JSON.parse(storage.getItem(KEY)); return Array.isArray(l) ? l.filter((p) => p && typeof p.text === 'string') : []; } catch { return []; }
}
export function savePieces(list, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { storage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}
export function newPiece(name, text) {
  return { id: uid(), name: String(name || 'Untitled').slice(0, 120), text: String(text || ''), updated: Date.now() };
}

// ---------------------------------------------------------------- share links
// The piece travels after the '#' of the link, which browsers never send to a server:
// opening the link adds the piece to the other person's pieces on their device.

export function pieceShareCode(p) {
  return b64urlEncode(JSON.stringify({ v: 1, n: p.name, t: p.text }));
}
/** The link to send: this app's address with the piece after #piece= */
export function pieceShareLink(p, base) {
  return `${base}#piece=${pieceShareCode(p)}`;
}
/** @returns {{ name, text }} – throws if the code isn't a piece (e.g. cut short when sent) */
export function readPieceShare(code) {
  const d = JSON.parse(b64urlDecode(String(code || '')));
  if (!d || typeof d.t !== 'string' || !d.t.trim() || d.t.length > 100000) throw new Error('Not a piece');
  return { name: String(d.n || 'Shared piece').slice(0, 120), text: d.t };
}
/** Save a shared piece – unless exactly the same piece is already saved. */
export function addSharedPiece(shared, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const list = loadPieces(storage);
  const same = list.find((x) => x.name === shared.name && x.text === shared.text);
  if (same) return { piece: same, added: false };
  const piece = newPiece(shared.name, shared.text);
  if (!savePieces([...list, piece], storage)) throw new Error('Could not save');
  return { piece, added: true };
}

/**
 * The beat a tempo is counted in. Compound time (6/8, 9/8, 12/8) is felt in dotted crotchets,
 * so its metronome mark is ♩. = N (N × 1.5 crotchets a minute); everything else in crotchets.
 * Tempos are kept in crotchets inside the app; this is only how they are shown and written.
 */
export function tempoBeat(meter) {
  const compound = meter && meter.den === 8 && meter.num % 3 === 0 && meter.num > 3;
  return compound ? { unit: 1.5, sign: '♩.', q: '3/8', name: 'dotted crotchets' } : { unit: 1, sign: '♩', q: '1/4', name: 'crotchets' };
}

/**
 * The piece's written tempo set in its header as Q: 1/4=N (or Q: 3/8=N in compound time,
 * `beats` then being dotted crotchets), or the Q: line taken out when it is empty.
 * The rest of the text is left as it is.
 */
export function setTempoLine(text, beats, beat = tempoBeat(null)) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const k = lines.findIndex((l) => /^\s*K:/.test(l));
  const q = lines.slice(0, k < 0 ? lines.length : k).findIndex((l) => /^\s*Q:/.test(l));
  const v = Math.round(Number(beats));
  if (!(v > 0)) { if (q >= 0) lines.splice(q, 1); return lines.join('\n'); }
  const line = `Q: ${beat.q}=${v}`;
  if (q >= 0) lines[q] = line; else if (k >= 0) lines.splice(k, 0, line); else lines.unshift(line);
  return lines.join('\n');
}

// ---------------------------------------------------------------- editing fingering and position changes
// Tapping a note on the Practice page edits the piece's text in place: the note is found by
// where it is written (each glyph keeps srcLine and srcCol, 1-based), so nothing else changes.

const NOTE_AT = /^(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)/;
function noteAt(s, j) {
  const m = NOTE_AT.exec(s.slice(j));
  if (!m) return null;
  let o = m[2] === m[2].toUpperCase() ? 4 : 5;
  for (const c of m[3]) o += c === "'" ? 1 : -1;
  return { l: 'CDEFGAB'.indexOf(m[2].toUpperCase()), o, len: m[0].length };
}

/** Where the decorations (and spaces) written just before position ci begin – they belong to the note at ci. */
function decorationsStart(s, ci, stopAt = 0) {
  let k = ci;
  while (k > stopAt) {
    const c = s[k - 1];
    if (c === ' ' || c === '\t' || c === '.') { k--; continue; }
    if (c === '!' || c === '+') {
      const p = s.lastIndexOf(c, k - 2);
      if (p < stopAt || !/^[A-Za-z0-9+\-<>().\/]*$/.test(s.slice(p + 1, k - 1))) break;
      k = p;
      continue;
    }
    break;
  }
  return k;
}

function editLine(text, line, fn) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const li = line - 1;
  if (!(li >= 0 && li < lines.length)) return text;
  const r = fn(lines[li]);
  if (r == null) return text;
  lines[li] = r;
  return lines.join('\n');
}

const stripFingers = (seg) => seg.replace(/![0-5]!/g, '');

/**
 * Set (finger 0–5) or remove (null) the fingering of one note, found by where it is written.
 * In a double stop, `note` ({ l, o }) says which of its notes.
 * @returns the new text (unchanged if the note can't be found)
 */
export function setFingering(text, { line, col }, note, finger) {
  const mark = finger == null ? '' : `!${finger}!`;
  return editLine(text, line, (s) => {
    const ci = col - 1;
    if (s[ci] !== '[') {
      if (!noteAt(s, ci)) return null;
      const k = decorationsStart(s, ci);
      return s.slice(0, k) + stripFingers(s.slice(k, ci)) + mark + s.slice(ci);
    }
    // a double stop: the fingering goes inside the brackets, just before its note
    const close = s.indexOf(']', ci);
    if (close < 0) return null;
    let j = ci + 1, first = true;
    while (j < close) {
      const c = s[j];
      if (c === ' ' || c === '-' || c === '/' || /\d/.test(c)) { j++; continue; }
      if (c === '!') { const e = s.indexOf('!', j + 1); if (e < 0 || e > close) return null; j = e + 1; continue; }
      const n = noteAt(s, j);
      if (!n) return null;
      if (n.l === note.l && n.o === note.o) {
        const k = decorationsStart(s, j, ci + 1);
        let out = s.slice(0, k) + stripFingers(s.slice(k, j)) + mark + s.slice(j);
        // a fingering written before the [ belongs to its first note
        if (first) { const b = decorationsStart(out, ci); out = out.slice(0, b) + stripFingers(out.slice(b, ci)) + out.slice(ci); }
        return out;
      }
      first = false;
      j += n.len;
    }
    return null;
  });
}

/** Add (on) or remove a position change (!shift!) before one note, found by where it is written. */
export function setShift(text, { line, col }, on) {
  return editLine(text, line, (s) => {
    const ci = col - 1;
    if (s[ci] !== '[' && !noteAt(s, ci)) return null;
    const k = decorationsStart(s, ci);
    return s.slice(0, k) + s.slice(k, ci).replace(/!shift!/gi, '') + (on ? '!shift!' : '') + s.slice(ci);
  });
}

/** Header (up to and including the first K: line) and the music after it. */
export function splitHeader(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const k = lines.findIndex((l) => /^\s*K:/.test(l));
  if (k < 0) return { header: [], body: lines };
  return { header: lines.slice(0, k + 1), body: lines.slice(k + 1) };
}

/**
 * A + B: A as it is, then B with its own key, time and note length written as
 * changes in the middle – so it can be edited like any other piece.
 */
export function joinPieces(a, b) {
  const A = splitHeader(a.text), B = splitHeader(b.text);
  const name = `${a.name} + ${b.name}`;
  const head = A.header.length ? A.header.filter((l) => !/^\s*T:/.test(l)) : ['K: C'];
  const bFields = B.header.filter((l) => /^\s*[MLQK]:/.test(l));
  // K: last, as in a header
  bFields.sort((x, y) => (/^\s*K:/.test(x) ? 1 : 0) - (/^\s*K:/.test(y) ? 1 : 0));
  const text = [`T: ${name}`, ...head, ...trimEnd(A.body), `% ---- ${b.name} ----`, ...bFields, ...trimEnd(B.body)].join('\n') + '\n';
  return newPiece(name, text);
}
function trimEnd(lines) { const l = lines.slice(); while (l.length && !l[l.length - 1].trim()) l.pop(); return l; }

export const STARTER = `T: My piece
C:
M: 4/4
L: 1/8
Q: 1/4=80
K: D
D2 E2 F2 G2 | A2 B2 c2 d2 | d2 c2 B2 A2 | G2 F2 E2 D2 |]
`;

// ---------------------------------------------------------------- the instructions for an AI (photo → text)

export const AI_PROMPT = `You are helping a music student turn a photo of their sheet music into text for the Scale Practice app.

STEP 1 - If a photo of sheet music is already attached, go straight to step 2. Otherwise reply now with only this request, and nothing else:
"Please send me a photo of your sheet music: tap + (or the paperclip) and take a photo with your camera, or choose one from your photos. Hold the phone straight above the page, in good light, one page at a time."

STEP 2 - When the photo arrives, transcribe it into ABC notation. A program reads your answer, so follow these rules exactly:

1. One part only: the top staff of each system. Music with an accompaniment is fine (for example violin, viola, cello, double bass or a singer with piano, or a solo with a second part underneath).
   - First find the systems: staves joined at the left edge by a bracket, a brace or a line, and played at the same time, form one system; a new system starts after the gap below the last staff of a group. For example, a solo instrument or voice with piano has three staves per system, and a solo with one accompanying part has two (staves 1 and 2, then 3 and 4, and so on).
   - Transcribe only the top staff of every system (the solo part - also when it is printed in smaller notes above the piano), and ignore every staff below it. With two staves per system that means staves 1, 3, 5 ...; with three, staves 1, 4, 7 ....
   - Join those top staves in order, as one continuous part.
2. Header lines, one per line, in this order:
   T: the title as printed (or Untitled)
   C: the composer, if printed (leave the line out otherwise)
   M: the time signature, e.g. M: 3/4 (M: C for common time)
   L: 1/8   (always 1/8)
   Q: the metronome mark, e.g. Q: 1/4=96 - or Q: 3/8=60 when it is given for a dotted crotchet, as is usual in 6/8, 9/8 and 12/8 (leave the line out if none is printed)
   K: the key from the key signature, e.g. K: G, K: Bb, K: Em. Then the clef of the top staff: K: G clef=treble, K: D clef=bass, K: C clef=alto, K: F clef=tenor. Look at the clef sign itself - a bass clef has two dots either side of the fourth line; a treble clef curls round the second line; an alto or tenor (C) clef is centred on the middle or fourth line. Violin music is in treble clef; viola mostly in alto clef; cello mostly in bass clef (tenor or treble clef for high passages); double bass in bass clef; singers in treble or bass clef. If the clef changes in the middle, write the new clef where it changes, e.g. [K: clef=tenor] (the key stays the same). Write every note as printed, also for double bass and tenor voice, which sound an octave lower than written.
3. Pitches. In ABC the octave is shown ONLY by the letter case and by commas and apostrophes:
   C, D, E, F, G, A, B,  = the octave below middle C (one comma)
   C D E F G A B  = the octave from middle C up
   c d e f g a b  = the octave above that
   C,, D,, ... B,, = two octaves below middle C (two commas); c' d' ... = two octaves above middle C
   A number after a note is ONLY its length, never its octave: C2 means middle C held for a quarter note - it is not the note "C2". For reference, the open strings as written: violin G, D A e; viola C, G, D A; cello C,, G,, D, A,; double bass E,, A,, D, G,.
   Find each note by its place on the staff, counting lines and spaces from the bottom:
   - Bass clef: ledger lines below: C,, (2nd ledger line) D,, E,, (1st ledger line) F,, | lines from the bottom: G,, B,, D, F, A, | spaces from the bottom: A,, C, E, G, | above: B, then C (middle C, 1st ledger line above) D E (2nd ledger line)
   - Treble clef: below: C (middle C, 1st ledger line below) D | lines from the bottom: E G B d f | spaces from the bottom: F A c e | above: g a (1st ledger line above) b c' (2nd ledger line)
   - Alto clef: below: B,, (2nd ledger line) C, D, (1st ledger line) E, (just below) | lines from the bottom: F, A, C E G | spaces from the bottom: G, B, D F | above: A B (1st ledger line above) c
   - Tenor clef: below: G,, (2nd ledger line) A,, B,, (1st ledger line) C, (just below) | lines from the bottom: D, F, A, C E | spaces from the bottom: E, G, B, D | above: F G (1st ledger line above)
   A note on a line has the line through the middle of its head; a note in a space sits between two lines. Most notes in bass clef music have commas, and most notes in treble clef music have none; if yours don't fit the clef, you have the octave wrong.
4. Lengths are multiples of an eighth note: A = eighth, A2 = quarter, A3 = dotted quarter, A4 = half, A6 = dotted half, A8 = whole, A/2 = sixteenth, A3/2 = dotted eighth, A/4 = thirty-second. Rests: z with the same lengths (z2 = quarter rest, z8 = whole-bar rest in 4/4).
5. Accidentals: the key signature applies automatically - do not write it on every note. Write ^ (sharp), _ (flat) or = (natural) before a note only where an accidental is printed; it lasts to the end of the bar, as in printed music.
6. End every bar with | and the last bar with |]. Each bar must add up exactly to the time signature, counting a note without a number as 1: in 3/4 the numbers in every bar add up to 6, in 4/4 to 8, in 6/8 to 6, in 2/4 to 4. Only a pickup bar at the start (and the last bar after it) may be shorter.
7. Repeats: if the whole piece is repeated (a :| at the very end with no |: before it, or |: at the very start and :| at the very end), leave the repeat signs out and write the piece only once - the student is practising it, so one playthrough is enough. If only part of the piece is repeated, copy the repeat signs as printed - |: at the start of the repeated section and :| at its end. First and second-time endings, D.C., D.S. and coda can't be read: write those out in full, every note in the order it is played (but never the whole piece twice).
8. Ties: A2-A2. Slurs: (A B c). Triplets: (3ABc. Two notes played together (double stops): [DA].
9. Staccato dots and tenuto lines: copy them onto every note that has one. A staccato dot is a . before the note: .A2. A tenuto line (a short dash above or below the head) is !tenuto! before the note: !tenuto!A2. Keep them inside slurs too: dots or dashes under a slur mean the notes are separated within one bow (or one breath), so a slur over two dotted notes is (.C,2 .C,2) and over two dashed notes is (!tenuto!A2 !tenuto!B2). The dot after a note head that lengthens it (a dotted note) is not a staccato dot - write it as a length (A3, A6).
10. Fingering: copy every fingering number printed above or below a note as !0! to !5! before the note (on string instruments 0 = open string and 1 to 4 = fingers), together with any staccato dot or tenuto line: !0!G,,2 !2!.C,2 (!1!D, !3!F,). In a double stop put each number with its own note inside the brackets: [!1!D!3!A]. A number at the start of a line above the clef is a bar number, and a 3 over a group of notes is a triplet - neither is fingering.
   These are practice pieces, so trust the fingering exactly as printed. It is often chosen on purpose to practise a particular position, string, shift or hand shape, and may be quite different from the usual fingering - that is expected, not a mistake. Do not correct it, do not add fingering where none is printed, do not leave any out, and do not spend time checking whether it is a sensible fingering. Never use the fingering to decide or change a note: read every pitch only from its place on the staff.
11. Leave out everything else: dynamics, up-bow and down-bow signs, breath marks, accents, ornaments, grace notes, lyrics, chord symbols, bar numbers, and any other signs.
12. Never add notes that are not printed. If a note is unclear, write your best guess and add a comment line such as: % bar 5: second note unclear
13. If the photo is not sheet music, or is too unclear to read, answer with a code block containing only: % not readable - <reason>

STEP 3 - Answer in this order:
a) Under the heading "Reading", one short line per bar giving each note's place on the staff and its ABC (with any fingering, slur, staccato dot or tenuto line), and the bar's total, for example:
   Bar 1: bottom line !0!G,,2 ; 2nd line !4!B,,2 (slur starts, dot) ; 2nd line B,,2 (dot, slur ends) (2+2+2 = 6)
   Read the photo again for any bar whose total is wrong, for any note that looks a step too high or low, and for fingering numbers, dots or dashes you may have missed.
b) The ABC inside one code block (three backticks).
c) After the code block, only this line:
"Now tap Copy on the box above (or the copy icon under it), go back to the Scale Practice app, paste it into the box under 'Paste the answer here' and tap Read the music."

An example of the code block:

\`\`\`
T: Example
M: 3/4
L: 1/8
Q: 1/4=90
K: G clef=bass
!0!G,,2 (!4!.B,,2 .B,,2) | !1!G,4 F,2 | (E, D, C,2) !1!A,,2 | !0!G,,6 |]
\`\`\``;

/** Claude, opened in a new chat with the instructions already filled in (q is cut at about 14,000 characters). */
export const CLAUDE_URL = 'https://claude.ai/new';
export function claudeLink(prompt = AI_PROMPT) {
  return `${CLAUDE_URL}?q=${encodeURIComponent(prompt)}`;
}

/** A follow-up for the AI when its answer couldn't be read, or looks wrong. */

export function fixPrompt(errors) {
  const list = errors.slice(0, 12).map((e) => `- line ${e.line}${e.col ? `, column ${e.col}` : ''}: ${e.message}`).join('\n');
  const intro = errors.every((e) => e.check)
    ? 'The app checked your ABC and found these likely mistakes. Please look at the photo again, correct them'
    : 'The app could not read your ABC. Please fix these problems';
  return `${intro} and send the whole piece again, following the same rules: the Reading lines, the ABC in one code block, then the same line about copying it back into the app.\n${list}`;
}
