// Editing fingering and position changes in a piece's text, by where each note is written.
import { test, eq, assert } from './harness.js';
import { parsePiece } from '../js/pieceText.js';
import { pieceSequence, setFingering, setShift } from '../js/pieces.js';
import { instrumentInfo } from '../js/instruments.js';
import { lineLayout } from '../js/notation.js';

const HEAD = 'T: Test\nM: 4/4\nL: 1/8\nK: D\n';
/** The note tokens of a piece, in order. */
const notesOf = (text) => parsePiece(text).tokens.filter((t) => t.kind === 'note');
const at = (tok) => ({ line: tok.line, col: tok.col });

test('add, change and remove the fingering of a note', () => {
  let text = HEAD + 'D2 E2 .F2 !tenuto!G2 |]\n';
  const [d, , f, g] = notesOf(text);
  text = setFingering(text, at(d), d.notes[0], 0);
  eq(notesOf(text)[0].notes[0].f, 0, 'D gets 0');
  text = setFingering(text, at(notesOf(text)[0]), d.notes[0], 3);
  eq(notesOf(text)[0].notes[0].f, 3, 'changed to 3, not added twice');
  assert(!/!0!/.test(text), 'the old finger is gone');
  // a staccato note keeps its dot; a tenuto note keeps its line
  text = setFingering(text, at(notesOf(text)[2]), f.notes[0], 2);
  text = setFingering(text, at(notesOf(text)[3]), g.notes[0], 4);
  const t = notesOf(text);
  eq(t[2].notes[0].f, 2); eq(t[2].art, 'staccato');
  eq(t[3].notes[0].f, 4); eq(t[3].art, 'tenuto');
  // removing
  text = setFingering(text, at(t[0]), t[0].notes[0], null);
  eq(notesOf(text)[0].notes[0].f, undefined, 'removed');
  eq(notesOf(text).length, 4, 'still four notes');
  assert(parsePiece(text).ok, 'the text still reads');
});

test('fingering inside a double stop goes to the note chosen', () => {
  let text = HEAD + '[DA]2 !1![DA]2 [!1!D!3!A]2 z2 |]\n';
  const [c1, c2, c3] = notesOf(text);
  // c1: the upper note (A4) gets 2
  text = setFingering(text, at(c1), c1.notes[1], 2);
  let t = notesOf(text);
  eq(t[0].notes[1].f, 2); eq(t[0].notes[0].f, undefined);
  // c2: !1! before the [ belongs to its first note (D); setting D to 0 replaces it
  text = setFingering(text, at(t[1]), c2.notes[0], 0);
  t = notesOf(text);
  eq(t[1].notes[0].f, 0); eq(t[1].notes[1].f, undefined);
  assert(!text.includes('!1![DA]'), 'the old fingering before the [ is gone');
  // c3: change A from 3 to 4, leaving D's 1 alone
  text = setFingering(text, at(t[2]), c3.notes[1], 4);
  t = notesOf(text);
  eq(t[2].notes[0].f, 1); eq(t[2].notes[1].f, 4);
  assert(parsePiece(text).ok);
});

test('position changes: !shift! added and removed, drawn before the note', () => {
  let text = HEAD + 'D2 !2!E2 F2 G2 |]\n';
  const e = notesOf(text)[1];
  text = setShift(text, at(e), true);
  assert(text.includes('!shift!'), 'written into the text');
  let t = notesOf(text);
  eq(t[1].shift, true); eq(t[1].notes[0].f, 2, 'the fingering is kept');
  eq(t[0].shift, undefined);
  // the glyph carries it to the score
  const seq = pieceSequence(parsePiece(text), instrumentInfo('violin'));
  eq(seq.glyphs.filter((g) => g.shift).length, 1);
  // not added twice; then removed
  text = setShift(text, at(t[1]), true);
  eq((text.match(/!shift!/g) || []).length, 1);
  text = setShift(text, at(notesOf(text)[1]), false);
  assert(!text.includes('!shift!'));
  eq(notesOf(text)[1].notes[0].f, 2);
});

test('a note that can\'t be found leaves the text unchanged', () => {
  const text = HEAD + 'D2 E2 |]\n';
  eq(setFingering(text, { line: 9, col: 1 }, { l: 1, o: 4 }, 1), text);
  eq(setShift(text, { line: 5, col: 3 }, true), text, 'column 3 is a space, not a note');
});

test('a position-change line gets room above and below the stave', () => {
  const plain = [{ kind: 'note', notes: [{ l: 6, o: 4, a: 0 }] }];
  const shifted = [{ kind: 'note', notes: [{ l: 6, o: 4, a: 0 }], shift: true }];
  const a = lineLayout([[0]], plain, ['treble']).extents[0];
  const b = lineLayout([[0]], shifted, ['treble']).extents[0];
  assert(b.above > a.above && b.below > a.below);
});
