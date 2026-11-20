// Pieces: any music to practise with the arrow, the tuner bar and scoring.
// Saved on this device; joined (A + B); and the instructions given to an AI
// (ChatGPT or any other) to turn a photo of sheet music into the text format.
// No DOM access (apart from localStorage for the saved pieces).

import { parsePiece } from './pieceText.js';
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
    if (t.kind === 'key') { fifths = t.fifths; pendingKey = t.fifths; if (t.clef) pendingClef = t.clef; continue; }
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
      if (k < parts.length - 1) g.tieNext = true;
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
        glyphs[first].eventIndex = e.index;
        glyphs[first].beats = t.beats;
        events.push(e);
      }
      if (t.slurEnd) slurOpen = false;
      prevNoteTok = t;
    } else prevNoteTok = null;
  }
  for (let i = 1; i < events.length; i++) events[i].sameAsPrev = events[i].midis.join() === events[i - 1].midis.join();
  return { glyphs, events, totalBeats: beat, steps: [], bars: bar + (beat > barStart ? 1 : 0), piece: true };
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

1. One part only: the top staff of each system. Music with an accompaniment is fine (for example cello and piano, or a solo with a second part underneath).
   - First find the systems: staves joined at the left edge by a bracket, a brace or a line, and played at the same time, form one system; a new system starts after the gap below the last staff of a group. For example, cello with piano has three staves per system, and a solo with one accompanying part has two (staves 1 and 2, then 3 and 4, and so on).
   - Transcribe only the top staff of every system (the solo part - also when it is printed in smaller notes above the piano), and ignore every staff below it. With two staves per system that means staves 1, 3, 5 ...; with three, staves 1, 4, 7 ....
   - Join those top staves in order, as one continuous part.
2. Header lines, one per line, in this order:
   T: the title as printed (or Untitled)
   C: the composer, if printed (leave the line out otherwise)
   M: the time signature, e.g. M: 3/4 (M: C for common time)
   L: 1/8   (always 1/8)
   Q: the metronome mark, e.g. Q: 1/4=96 (leave the line out if none is printed)
   K: the key from the key signature, e.g. K: G, K: Bb, K: Em. Then the clef of the top staff: K: G clef=treble, K: D clef=bass, K: C clef=alto, K: F clef=tenor. Look at the clef sign itself - a bass clef has two dots either side of the fourth line; a treble clef curls round the second line; an alto or tenor (C) clef is centred on the middle or fourth line. Cello, double bass and bassoon music is usually in bass clef, viola in alto clef.
3. Pitches. In ABC the octave is shown ONLY by the letter case and by commas and apostrophes:
   C, D, E, F, G, A, B,  = the octave below middle C (one comma)
   C D E F G A B  = the octave from middle C up
   c d e f g a b  = the octave above that
   C,, D,, ... B,, = two octaves below middle C (two commas); c' d' ... = two octaves above middle C
   A number after a note is ONLY its length, never its octave: C2 means middle C held for a quarter note - it is not the note "C2". The cello's lowest note (its open C string) is C,, and its open strings are C,, G,, D, A,.
   Find each note by its place on the staff, counting lines and spaces from the bottom:
   - Bass clef: ledger lines below: C,, (2nd ledger line) D,, E,, (1st ledger line) F,, | lines from the bottom: G,, B,, D, F, A, | spaces from the bottom: A,, C, E, G, | above: B, then C (middle C, 1st ledger line above) D E (2nd ledger line)
   - Treble clef: below: C (middle C, 1st ledger line below) D | lines from the bottom: E G B d f | spaces from the bottom: F A c e | above: g a (1st ledger line above) b c' (2nd ledger line)
   - Alto clef: below: B,, (2nd ledger line) C, D, (1st ledger line) E, (just below) | lines from the bottom: F, A, C E G | spaces from the bottom: G, B, D F | above: A B (1st ledger line above) c
   - Tenor clef: below: G,, (2nd ledger line) A,, B,, (1st ledger line) C, (just below) | lines from the bottom: D, F, A, C E | spaces from the bottom: E, G, B, D | above: F G (1st ledger line above)
   A note on a line has the line through the middle of its head; a note in a space sits between two lines. Most notes in bass clef music have commas; if yours have none, you have the octave wrong.
4. Lengths are multiples of an eighth note: A = eighth, A2 = quarter, A3 = dotted quarter, A4 = half, A6 = dotted half, A8 = whole, A/2 = sixteenth, A3/2 = dotted eighth, A/4 = thirty-second. Rests: z with the same lengths (z2 = quarter rest, z8 = whole-bar rest in 4/4).
5. Accidentals: the key signature applies automatically - do not write it on every note. Write ^ (sharp), _ (flat) or = (natural) before a note only where an accidental is printed; it lasts to the end of the bar, as in printed music.
6. End every bar with | and the last bar with |]. Each bar must add up exactly to the time signature, counting a note without a number as 1: in 3/4 the numbers in every bar add up to 6, in 4/4 to 8, in 6/8 to 6, in 2/4 to 4. Only a pickup bar at the start (and the last bar after it) may be shorter.
7. Repeats: copy the repeat signs as printed - |: at the start of the repeated section and :| at its end (a :| with no |: before it repeats from the beginning). First and second-time endings, D.C., D.S. and coda can't be read: write those out in full, every note in the order it is played.
8. Ties: A2-A2. Slurs: (A B c). Triplets: (3ABc. Two notes played together (double stops): [DA].
9. Leave out everything else: dynamics, fingering, bowing marks, articulation, ornaments, grace notes, lyrics, chord symbols, bar numbers.
10. Never add notes that are not printed. If a note is unclear, write your best guess and add a comment line such as: % bar 5: second note unclear
11. If the photo is not sheet music, or is too unclear to read, answer with a code block containing only: % not readable - <reason>

STEP 3 - Answer in this order:
a) Under the heading "Reading", one short line per bar giving each note's place on the staff and its ABC, and the bar's total, for example:
   Bar 1: bottom line G,,2 ; 2nd line B,,2 ; middle line D,2 (2+2+2 = 6)
   Read the photo again for any bar whose total is wrong, and for any note that looks a step too high or low.
b) The ABC inside one code block (three backticks).
c) After the code block, only this line:
"Now tap Copy on the box above, go back to the Scale Practice app, paste it into the box under 'Paste the answer here' and tap Read the music."

An example of the code block:

\`\`\`
T: Example
M: 3/4
L: 1/8
Q: 1/4=90
K: G clef=bass
G,,2 B,,2 D,2 | G,4 F,2 | (E, D, C,2) A,,2 | G,,6 |]
\`\`\``;

/** A follow-up for the AI when its answer couldn't be read. */
/** ChatGPT, opened with the instructions already filled in. */
export const CHATGPT_URL = 'https://chatgpt.com/';
export function chatGptLink(prompt = AI_PROMPT) {
  return `${CHATGPT_URL}?q=${encodeURIComponent(prompt)}`;
}

export function fixPrompt(errors) {
  const list = errors.slice(0, 12).map((e) => `- line ${e.line}${e.col ? `, column ${e.col}` : ''}: ${e.message}`).join('\n');
  const intro = errors.every((e) => e.check)
    ? 'The app checked your ABC and found these likely mistakes. Please look at the photo again, correct them'
    : 'The app could not read your ABC. Please fix these problems';
  return `${intro} and send the whole piece again, following the same rules: the Reading lines, the ABC in one code block, then the same line about copying it back into the app.\n${list}`;
}
