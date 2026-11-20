// Pieces: reading the music text, the notes and lengths it makes, and joining pieces.
// (Short made-up tunes only – no published music.)
import { test, eq, assert, near } from './harness.js';
import { parsePiece, extractPieceText, parseKey } from '../js/pieceText.js';
import { pieceSequence, pieceExercise, joinPieces, newPiece, splitLength, loadPieces, savePieces, STARTER, AI_PROMPT, fixPrompt, chatGptLink } from '../js/pieces.js';
import { instrumentInfo } from '../js/instruments.js';
import { midiOf } from '../js/theory.js';

const head = (k = 'C', m = '4/4') => `T: Test\nM: ${m}\nL: 1/8\nK: ${k}\n`;
const notes = (P) => P.tokens.filter((t) => t.kind === 'note');
const midis = (P) => notes(P).map((t) => t.notes.map(midiOf));
const cello = instrumentInfo('cello');
const violin = instrumentInfo('violin');

test('pieces: notes, octaves and lengths', () => {
  const P = parsePiece(head() + 'C D E F | G A B c | C, c\' z2 c4 |]\n');
  assert(P.ok, JSON.stringify(P.errors));
  eq(P.title, 'Test');
  eq(P.meter.text, '4/4');
  eq(midis(P).map((m) => m[0]), [60, 62, 64, 65, 67, 69, 71, 72, 48, 84, 72]);
  eq(notes(P).map((t) => t.beats), [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2]);
  eq(P.tokens.filter((t) => t.kind === 'rest').map((t) => t.beats), [1]);
  eq(P.tokens.filter((t) => t.kind === 'bar').length, 3);
});

test('pieces: lengths with / and dotted rhythm (> and <)', () => {
  const P = parsePiece(head() + 'A/2 A/ A3 A6 | A>B A<B |]\n');
  assert(P.ok, JSON.stringify(P.errors));
  eq(notes(P).map((t) => t.beats), [0.25, 0.25, 1.5, 3, 0.75, 0.25, 0.25, 0.75]);
});

test('pieces: accidentals last to the end of the bar; the key signature applies', () => {
  const P = parsePiece(head('G') + 'F ^c c =F | F c _B B |]\n');
  assert(P.ok, JSON.stringify(P.errors));
  // G major: F is F sharp; ^c lasts the bar; =F naturalises
  eq(midis(P).map((m) => m[0]), [66, 73, 73, 65, 66, 72, 70, 70]);
});

test('pieces: keys, modes and clefs', () => {
  eq(parseKey('D').fifths, 2);
  eq(parseKey('Bb').fifths, -2);
  eq(parseKey('Em').fifths, 1);
  eq(parseKey('F#m').fifths, 3);
  eq(parseKey('A dorian').fifths, 1);
  eq(parseKey('D clef=bass').clef, 'bass');
  eq(parseKey('C clef=alto').clef, 'alto');
  assert(parseKey('H').error, 'an unknown key is an error');
});

test('pieces: key and time changes in the middle', () => {
  const P = parsePiece(head('C', '3/4') + 'C D E | F2 G |\n[K:D] F2 F | [M:2/4] G A |]\n');
  assert(P.ok, JSON.stringify(P.errors));
  eq(midis(P).slice(-4).map((m) => m[0]), [66, 66, 67, 69]);
  const seq = pieceSequence(P, cello);
  const fifths = seq.glyphs.filter((g) => g.kind === 'note').map((g) => g.fifths);
  eq(fifths[0], 0);
  eq(fifths[fifths.length - 1], 2);
  eq(seq.bars, 4);
});

test('pieces: tied notes are one note to play; slurs and triplets', () => {
  const P = parsePiece(head() + 'c2- c2 (3cde (fg) a2 |]\n');
  assert(P.ok, JSON.stringify(P.errors));
  const seq = pieceSequence(P, violin);
  eq(seq.events.length, 7, 'the tie joins two notes into one');
  near(seq.events[0].beats ?? seq.glyphs[0].beats, 2, 1e-9);
  const trip = notes(P).filter((t) => t.tuplet);
  eq(trip.length, 3);
  near(trip.reduce((a, t) => a + t.beats, 0), 1, 1e-9, 'a triplet of quavers fills a crotchet');
  assert(notes(P).some((t) => t.slurStart), 'slur start');
  near(seq.totalBeats, 5, 1e-9);
});

test('pieces: repeats are written out; endings are refused', () => {
  const P = parsePiece(head() + '|: C D E F :| G4 G4 |]\n');
  assert(P.ok, JSON.stringify(P.errors));
  eq(midis(P).map((m) => m[0]), [60, 62, 64, 65, 60, 62, 64, 65, 67, 67]);
  const E = parsePiece(head() + '|: C D E F |1 G4 :|2 A4 |]\n');
  assert(!E.ok, 'first and second time bars are not read');
  assert(/repeat out in full/.test(E.errors[0].message));
});

test('pieces: double stops and chords', () => {
  const P = parsePiece(head('D') + '[DA]2 [D2A2] [GDB]2 z2 |]\n');
  eq(P.errors, []);
  const n = notes(P);
  eq(n[0].notes.map(midiOf), [62, 69]);
  eq(n[0].beats, 1);
  eq(n[1].beats, 1, 'the length written inside the brackets');
  assert(P.warnings.some((w) => /3 notes/.test(w.message)), 'a three-note chord is warned about');
});

test('pieces: mistakes are reported with their line', () => {
  const P = parsePiece(head() + 'C D E F |\nC D X F |]\n');
  assert(!P.ok);
  eq(P.errors[0].line, 6);
  assert(/Can't read "X"/.test(P.errors[0].message));
  const V = parsePiece(head() + 'V:1\nC D\nV:2\nE F |]\n');
  assert(!V.ok && /second voice/.test(V.errors[0].message), 'a second part is refused');
  const M = parsePiece('M: three\nK: C\nC |]\n');
  assert(!M.ok, 'a bad time signature');
});

test('pieces: lengths are split into notes that can be written', () => {
  const durs = (b) => splitLength(b).map((d) => d[1]);
  eq(durs(1), ['q']);
  eq(durs(1.5), ['qd']);
  eq(durs(2.5), ['h', '8']);
  eq(durs(5), ['w', 'q']);
  near(splitLength(3.75).reduce((a, d) => a + d[0], 0), 3.75, 1e-9);
});

test('pieces: lines of music break between bars', () => {
  const P = parsePiece(head('C', '3/4') + 'C2 D2 E2 | F2 G2 A2 | B6 |]\n');
  const seq = pieceSequence(P, cello);
  eq([...new Set(seq.glyphs.map((g) => g.stepIndex))], [0, 1, 2]);
  eq(seq.events.length, 7);
  assert(seq.glyphs.filter((g) => g.barAfter).length >= 2);
});

test('pieces: the answer from a chat app is found in its reply', () => {
  const reply = 'Here is the transcription:\n\n```abc\nT: Tune\nM: 2/4\nL: 1/8\nK: G\nG A B c | d4 |]\n```\n\nLet me know if you need anything else.';
  const t = extractPieceText(reply);
  assert(t.startsWith('T: Tune'), t);
  assert(!/Let me know/.test(t));
  assert(parsePiece(t).ok);
  const bare = extractPieceText('Sure!\nT: Bare\nK: D\nD E F G |]');
  assert(/^T: Bare/.test(bare), bare);
  assert(/not readable/.test(extractPieceText('```\n% not readable – blurry\n```')));
});

test('pieces: joining A + B keeps both keys and times and can be read', () => {
  const a = newPiece('One', head('G', '3/4') + 'G2 A2 B2 | d6 |]\n');
  const b = newPiece('Two', 'T: Two\nM: 2/4\nL: 1/8\nQ: 1/4=80\nK: F\nF G A B | c4 |]\n');
  const j = joinPieces(a, b);
  eq(j.name, 'One + Two');
  assert(j.id !== a.id && j.id !== b.id);
  const P = parsePiece(j.text);
  assert(P.ok, JSON.stringify(P.errors) + '\n' + j.text);
  eq(P.meter.text, '3/4');
  eq(P.key.fifths, 1);
  const m = midis(P).map((x) => x[0]);
  eq(m.slice(0, 4), [67, 69, 71, 74]);
  eq(m.slice(4), [65, 67, 69, 70, 72], 'the second piece in F (B flat)');
  assert(/% ---- Two ----/.test(j.text));
});

test('pieces: bars that do not add up are pointed out', () => {
  const checks = (t) => parsePiece(t).warnings.filter((w) => w.check);
  // a short pickup and a short last bar are fine
  eq(checks(head('C', '3/4') + 'G2 | c2 d2 e2 | f4 |]\n'), []);
  const w = checks(head('C', '3/4') + 'c2 d2 e2 | f2 g2 a2 b2 | c6 | d2 e2 | c6 |]\n');
  eq(w.map((x) => x.message.slice(0, 26)), ['Bar 2 adds up to 4/4, but ', 'Bar 4 adds up to 2/4, but ']);
  // a repeat played twice is checked once; a time change is followed
  eq(checks(head('C', '2/4') + '|: c2 d2 :| [M:3/4] e2 f2 g2 |]\n'), []);
});

test('pieces: notes an octave or more away from the clef are pointed out', () => {
  const checks = (t) => parsePiece(t).warnings.filter((w) => w.check);
  // bass clef written without commas: two octaves too high
  const high = checks(head('C clef=bass', '3/4') + 'C2 E2 G2 | c2 G2 E2 | C6 |]\n');
  eq(high.length, 1);
  assert(/above the bass clef staff/.test(high[0].message) && /G,, B,, D, F, A,/.test(high[0].message), high[0].message);
  eq(checks(head('C clef=bass', '3/4') + 'C,,2 E,,2 G,,2 | C,2 G,,2 E,,2 | C,,6 |]\n'), [], 'the cello C string');
  eq(checks(head('G clef=treble') + 'G A B c d e f g |]\n'), []);
  eq(checks(head('C') + 'C,, D,, E,, F,, |]\n'), [], 'no clef written: nothing is assumed');
});

test('pieces: the instructions explain octaves by staff position, and the example is right', () => {
  assert(/ONLY its length, never its octave/.test(AI_PROMPT));
  assert(/Bass clef:.*lines from the bottom: G,, B,, D, F, A,/.test(AI_PROMPT));
  assert(/Treble clef:.*lines from the bottom: E G B d f/.test(AI_PROMPT));
  assert(/Reading/.test(AI_PROMPT));
  const example = AI_PROMPT.split('```')[1];
  const P = parsePiece(example);
  assert(P.ok, JSON.stringify(P.errors));
  eq(P.warnings, [], 'the example has no warnings');
  eq(P.clef, 'bass');
  assert(/^The app checked/.test(fixPrompt([{ line: 6, check: true, message: 'Bar 7 adds up to 5/4' }])));
  assert(/line 6: Bar 7/.test(fixPrompt([{ line: 6, check: true, message: 'Bar 7 adds up to 5/4' }])));
});

test('pieces: the practice exercise and saved pieces', () => {
  const p = newPiece('Mine', head('D', '3/4') + 'Q: 1/4=90\nD2 F2 A2 | d6 |]\n');
  const { ok, exercise, seq } = pieceExercise(p, violin, {});
  assert(ok);
  assert(exercise.isPiece);
  eq(exercise.title, 'Mine');
  eq(exercise.meterText, '3/4');
  eq(seq.events.length, 4);
  const store = { v: {}, getItem(k) { return this.v[k] ?? null; }, setItem(k, v) { this.v[k] = String(v); } };
  savePieces([p], store);
  eq(loadPieces(store).map((x) => x.name), ['Mine']);
  eq(loadPieces({ getItem: () => 'not json' }), []);
  assert(parsePiece(STARTER).ok, 'the example piece can be read');
  assert(/top staff/i.test(AI_PROMPT) && /one code block/i.test(AI_PROMPT));
  const link = chatGptLink();
  assert(link.startsWith('https://chatgpt.com/?q='), 'opens ChatGPT');
  eq(decodeURIComponent(link.split('?q=')[1]), AI_PROMPT, 'with the instructions filled in');
  assert(/send me a photo/i.test(AI_PROMPT) && /go back to the Scale Practice app/i.test(AI_PROMPT), 'asks for the photo and says how to come back');
  assert(/line 3/i.test(fixPrompt([{ line: 3, col: 1, message: 'x' }])));
});
