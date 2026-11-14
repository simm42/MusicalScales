import { test, eq, assert } from './harness.js';
import { parseNote, noteName, midiOf, keyFifths, parsePc, generateSteps, MAJOR_KEYS, MINOR_KEYS, START_NOTES } from '../js/theory.js';
import { buildExercise, typesForInstrument, rangesFor, EXERCISE_TYPES } from '../js/exercises.js';
import { buildSequence } from '../js/sequence.js';
import { assignClefs } from '../js/instruments.js';

const names = (ex) => ex.gen.steps.map((s) => s.notes.map((n) => noteName(n, { octave: true, unicode: false })).join('+'));

test('midi numbers', () => {
  eq(midiOf(parseNote('A4')), 69);
  eq(midiOf(parseNote('C4')), 60);
  eq(midiOf(parseNote('B#3')), 60);
  eq(midiOf(parseNote('Cb4')), 59);
  eq(midiOf(parseNote('E1')), 28);
});

test('key signatures', () => {
  eq(keyFifths(parsePc('C'), 'major'), 0);
  eq(keyFifths(parsePc('F#'), 'major'), 6);
  eq(keyFifths(parsePc('Cb'), 'major'), -7);
  eq(keyFifths(parsePc('C#'), 'minor'), 4);
  eq(keyFifths(parsePc('Eb'), 'minor'), -6);
  eq(keyFifths(parsePc('A#'), 'minor'), 7);
});

test('G major 2 octaves on violin', () => {
  const ex = buildExercise({ instrument: 'violin', type: 'scale', key: 'G', mode: 'major', range: '2' });
  assert(ex.ok);
  eq(names(ex).slice(0, 8), ['G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F#4', 'G4']);
  eq(names(ex)[14], 'G5');
  eq(names(ex).length, 29);
  eq(names(ex)[28], 'G3');
});

test('melodic minor ascends raised, descends natural', () => {
  const ex = buildExercise({ instrument: 'violin', type: 'scale', key: 'A', mode: 'minor', form: 'melodic', range: '1' });
  eq(names(ex), ['A3', 'B3', 'C4', 'D4', 'E4', 'F#4', 'G#4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4', 'B3', 'A3']);
});

test('harmonic minor in sharp key spells double sharp', () => {
  const ex = buildExercise({ instrument: 'violin', type: 'scale', key: 'G#', mode: 'minor', form: 'harmonic', range: '1' });
  eq(names(ex).slice(0, 8), ['G#3', 'A#3', 'B3', 'C#4', 'D#4', 'E4', 'F##4', 'G#4']);
});

test('natural minor', () => {
  const ex = buildExercise({ instrument: 'cello', type: 'scale', key: 'D', mode: 'minor', form: 'natural', range: '1' });
  eq(names(ex).slice(0, 8), ['D2', 'E2', 'F2', 'G2', 'A2', 'Bb2', 'C3', 'D3']);
});

test('arpeggio 3 octaves', () => {
  const ex = buildExercise({ instrument: 'violin', type: 'arpeggio', key: 'A', mode: 'minor', range: '3' });
  eq(names(ex).slice(0, 10), ['A3', 'C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6', 'E6', 'A6']);
  eq(names(ex).length, 19);
});

test('chromatic sharps up, flats down', () => {
  const ex = buildExercise({ instrument: 'violin', type: 'chromatic', start: 'D', range: '1' });
  eq(names(ex), ['D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4', 'C5', 'C#5', 'D5', 'Db5', 'C5', 'B4', 'Bb4', 'A4', 'Ab4', 'G4', 'Gb4', 'F4', 'E4', 'Eb4', 'D4']);
});

test('dominant 7th in C starts on G and resolves', () => {
  const ex = buildExercise({ instrument: 'violin', type: 'dom7', key: 'C', range: '1' });
  eq(names(ex), ['G3', 'B3', 'D4', 'F4', 'G4', 'F4', 'D4', 'B3', 'C4']);
  assert(ex.title.includes('starting on G'), ex.title);
});

test('dominant 7th 2 octaves in D starts on bottom A', () => {
  const ex = buildExercise({ instrument: 'violin', type: 'dom7', key: 'D', range: '2' });
  eq(names(ex)[0], 'A3');
  eq(names(ex)[8], 'A5');
  eq(names(ex).at(-1), 'D4');
});

test('diminished 7th on G', () => {
  const ex = buildExercise({ instrument: 'violin', type: 'dim7', start: 'G', range: '1' });
  eq(names(ex), ['G3', 'Bb3', 'Db4', 'E4', 'G4', 'E4', 'Db4', 'Bb3', 'G3']);
});

test('double stops in sixths, broken and parallel', () => {
  const b = buildExercise({ instrument: 'violin', type: 'dsBroken', key: 'Bb', mode: 'major', interval: '6ths', range: '1' });
  eq(names(b).slice(0, 4), ['Bb3', 'G4', 'C4', 'A4']);
  const p = buildExercise({ instrument: 'violin', type: 'dsParallel', key: 'D', mode: 'major', interval: '8ves', range: '1' });
  eq(names(p)[0], 'D4+D5');
  eq(names(p).length, 15);
});

test('bass broken and running thirds', () => {
  const b = buildExercise({ instrument: 'bass', type: 'brokenThirds', key: 'G', mode: 'major', range: '1' });
  eq(names(b).slice(0, 6), ['G2', 'B2', 'A2', 'C3', 'B2', 'D3']);
  eq(names(b).length, 30);
  eq(names(b).slice(12, 18), ['F#3', 'A3', 'G3', 'G3', 'E3', 'F#3']);
  eq(names(b).slice(-3), ['A2', 'F#2', 'G2']);
  const r = buildExercise({ instrument: 'bass', type: 'runningThirds', key: 'G', mode: 'major', range: '1' });
  eq(names(r).slice(0, 6), ['G2', 'A2', 'B2', 'A2', 'B2', 'C3']);
  eq(names(r).at(-1), 'G2');
});

test('bass ranges to a 6th and 12th', () => {
  const s6 = buildExercise({ instrument: 'bass', type: 'scale', key: 'C', mode: 'major', range: '6th' });
  eq(names(s6), ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'G3', 'F3', 'E3', 'D3', 'C3']);
  const a12 = buildExercise({ instrument: 'bass', type: 'arpeggio', key: 'F', mode: 'major', range: '12th' });
  eq(names(a12), ['F2', 'A2', 'C3', 'F3', 'A3', 'C4', 'A3', 'F3', 'C3', 'A2', 'F2']);
});

test('long tonic: ends always, top only when it is a key note', () => {
  const s6 = buildSequence(buildExercise({ instrument: 'bass', type: 'scale', key: 'C', range: '6th', longEnds: true }));
  eq(s6.glyphs.map((g) => g.dur).join(''), 'h' + 'q'.repeat(9) + 'h'); // 11 notes, 3/4 example
  const s12 = buildSequence(buildExercise({ instrument: 'bass', type: 'scale', key: 'Bb', range: '12th', longEnds: true }));
  eq(s12.events.length, 23);
  eq(s12.glyphs.filter((g) => g.dur === 'h').length, 2);
  const oct = buildSequence(buildExercise({ instrument: 'violin', type: 'scale', key: 'G', range: '2', longEnds: true }));
  eq(oct.glyphs.filter((g) => g.dur === 'h').length, 3);
  const ds = buildExercise({ instrument: 'bass', type: 'dsBroken', key: 'Bb', mode: 'major', interval: '3rds', range: '1' });
  assert(ds.ok, 'bass broken steps in thirds');
});

test('thumb position starts on D4', () => {
  const t = buildExercise({ instrument: 'cello', type: 'thumbScale', key: 'D', mode: 'major', range: '1' });
  eq(names(t)[0], 'D4');
});

test('starting notes are lowest possible', () => {
  eq(names(buildExercise({ instrument: 'violin', type: 'scale', key: 'A', range: '1' }))[0], 'A3');
  eq(names(buildExercise({ instrument: 'violin', type: 'scale', key: 'D', range: '1' }))[0], 'D4');
  eq(names(buildExercise({ instrument: 'viola', type: 'scale', key: 'F#', range: '2' }))[0], 'F#3');
  eq(names(buildExercise({ instrument: 'cello', type: 'scale', key: 'B', range: '3' }))[0], 'B2');
  eq(names(buildExercise({ instrument: 'bass', type: 'scale', key: 'Eb', range: '1' }))[0], 'Eb3');
  eq(names(buildExercise({ instrument: 'violin', type: 'scale', key: 'G', range: '1', octaveUp: true }))[0], 'G4');
});

test('out-of-range combinations are rejected', () => {
  const ex = buildExercise({ instrument: 'bass', type: 'scale', key: 'B', mode: 'major', range: '3' });
  assert(!ex.ok, 'B major 3 oct on bass should exceed G5');
  assert(buildExercise({ instrument: 'violin', type: 'scale', key: 'C', range: '3' }).ok);
});

test('every exercise type builds for every key on each instrument', () => {
  let built = 0;
  for (const inst of ['violin', 'viola', 'cello', 'bass']) {
    for (const type of typesForInstrument(inst)) {
      const t = EXERCISE_TYPES[type];
      const keys = t.keyKind === 'start' ? START_NOTES : MAJOR_KEYS;
      for (const range of rangesFor(inst, type)) for (const key of keys) {
        const ex = buildExercise({ instrument: inst, type, key, start: key, range, mode: 'major' });
        assert(ex.gen.steps.length > 3, `${inst} ${type} ${key}`);
        const seq = buildSequence(ex);
        assert(seq.events.length >= ex.gen.steps.length);
        built++;
      }
      if (t.tonality) for (const key of MINOR_KEYS) for (const form of ['natural', 'harmonic', 'melodic']) {
        const ex = buildExercise({ instrument: inst, type, key, mode: 'minor', form, range: rangesFor(inst, type)[0] });
        assert(ex.gen.steps.length > 3);
        built++;
      }
    }
  }
  assert(built > 500, 'built ' + built);
});

test('sequence: long ends, repeat top, rhythms and slurs', () => {
  const ex = buildExercise({ instrument: 'violin', type: 'scale', key: 'G', range: '1', longEnds: true, repeatTop: true });
  const seq = buildSequence(ex);
  eq(seq.events.length, 16);
  eq(seq.glyphs[0].dur, 'h');
  eq(seq.glyphs[7].dur, 'h');
  eq(seq.glyphs[8].dur, 'q');
  eq(seq.glyphs.at(-1).dur, 'h');
  assert(seq.events[8].sameAsPrev);

  const q2r = buildSequence(buildExercise({ instrument: 'violin', type: 'scale', key: 'G', range: '1', rhythm: 'q2r' }));
  eq(q2r.events.length, 30);
  eq(q2r.glyphs.length, 45);
  eq(q2r.events[2].onsetBeat, 1.5);
  eq(q2r.events[1].beats, 1);

  const sl = buildSequence(buildExercise({ instrument: 'violin', type: 'scale', key: 'G', range: '2', slur: 7, slurred: true }));
  eq(sl.slurGroups, 4); // 29 notes: 4 bows of 7, last tonic on its own
  assert(sl.events[1].slurred && !sl.events[7].slurred);
});

test('clef changes for cello 3 octaves', () => {
  const ex = buildExercise({ instrument: 'cello', type: 'scale', key: 'C', range: '3' });
  const midis = ex.gen.steps.map((s) => midiOf(s.notes[0]));
  const clefs = assignClefs('cello', midis, 'change');
  eq(clefs[0], 'bass');
  eq(clefs[21], 'tenor'); // C5 stays in tenor
  eq(clefs.at(-1), 'bass');
  eq(new Set(assignClefs('cello', midis, 'home')).size, 1);
  const a = buildExercise({ instrument: 'cello', type: 'scale', key: 'A', range: '3' });
  const am = a.gen.steps.map((s) => midiOf(s.notes[0]));
  eq(assignClefs('cello', am, 'change')[21], 'treble'); // A5
});

test('slurred switch: grouping from the exercise, only for crotchet rhythms', () => {
  const base = { instrument: 'violin', type: 'scale', key: 'G', range: '2', slur: 7 };
  eq(buildSequence(buildExercise({ ...base, slurred: false })).slurGroups, 0);
  eq(buildSequence(buildExercise({ ...base, slurred: true })).slurGroups, 4);
  eq(buildSequence(buildExercise({ ...base, slurred: true, rhythm: 'q2' })).slurGroups, 0);
  // no grouping chosen: the usual one for the exercise (2 for scales)
  eq(buildSequence(buildExercise({ ...base, slur: 0, slurred: true, range: '1' })).slurGroups, 7);
  eq(buildSequence(buildExercise({ ...base, slurred: true, rhythm: 'crotchetLong' })).slurGroups, 4);
});
