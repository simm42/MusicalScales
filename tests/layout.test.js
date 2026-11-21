// Spacing between lines of music: each line gets the room its own notes need.
import { test, eq, assert } from './harness.js';
import { staveLineOf, lineLayout } from '../js/notation.js';

const note = (l, o, extra = {}) => ({ kind: 'note', notes: [{ l, o, a: 0, ...extra }], beamGroup: null });

test('a note\'s place on the stave, in each clef', () => {
  eq(staveLineOf({ l: 2, o: 4 }, 'treble'), 1, 'E4: bottom line of the treble stave');
  eq(staveLineOf({ l: 3, o: 5 }, 'treble'), 5, 'F5: top line');
  eq(staveLineOf({ l: 0, o: 4 }, 'treble'), 0, 'middle C: one ledger line below');
  eq(staveLineOf({ l: 4, o: 2 }, 'bass'), 1, 'G2: bottom line of the bass stave');
  eq(staveLineOf({ l: 0, o: 4 }, 'alto'), 3, 'middle C: middle line of the alto stave');
  eq(staveLineOf({ l: 0, o: 4 }, 'tenor'), 4, 'middle C: fourth line of the tenor stave');
});

test('lines near the stave pack tightly; high notes get more room', () => {
  // G4 A4 B4 C5 on each line (treble), and one line reaching A6 (four ledger lines above)
  const near = [note(4, 4), note(5, 4), note(6, 4), note(0, 5)];
  const high = [note(5, 6), note(4, 6), note(3, 6), note(2, 6)];
  const glyphs = [...near, ...near, ...high, ...near];
  const clefs = glyphs.map(() => 'treble');
  const lines = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]];
  const { topLine, height } = lineLayout(lines, glyphs, clefs, {});
  const steps = topLine.slice(1).map((t, i) => t - topLine[i]);
  assert(steps[0] < 110, `two ordinary lines are close together (${steps[0]})`);
  assert(steps[1] > steps[0] + 20, `room for the ledger lines above the third line (${steps[1]} vs ${steps[0]})`);
  assert(height > topLine[3] + 40, 'the score is tall enough for its last line');
  // never closer than the minimum, however simple the music
  const rests = [{ kind: 'rest', notes: [] }, { kind: 'rest', notes: [] }];
  const r = lineLayout([[0], [1]], rests, ['treble', 'treble'], { compact: true });
  eq(r.topLine[1] - r.topLine[0], 76);
});

test('fingering, slurs and syllables add room', () => {
  const plain = [note(4, 4), note(5, 4)];
  const fingered = [note(4, 4, { f: 1 }), note(5, 4, { f: 2 })];
  const a = lineLayout([[0, 1]], plain, ['treble', 'treble']).extents[0];
  const b = lineLayout([[0, 1]], fingered, ['treble', 'treble']).extents[0];
  assert(b.above > a.above, 'fingering numbers need room above');
  const c = lineLayout([[0, 1]], plain, ['treble', 'treble'], { syllables: true }).extents[0];
  assert(c.below > a.below, 'sol-fa syllables need room below');
});
