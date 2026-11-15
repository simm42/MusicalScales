// Sol-fa syllables for singing. No DOM access.
//
//  fixed      C is always Do (Do Re Mi Fa Sol La Si); accidentals are not sung,
//             so C♯ is shown "Do♯" but sung "Do".
//  movable    the key note is Do. Minor keys are sung from Do too
//             (Do Re Me Fa Sol Le Te), with the usual chromatic syllables:
//             raised Di Ri Fi Si Li, lowered Ra Me Se Le Te.
//  movableLa  as movable, but minor keys are sung from La (La Ti Do Re Mi Fa Sol;
//             the raised 6th and 7th of the melodic/harmonic minor are Fi and Si).
// Exercises with no key (chromatic scale, diminished 7th) take the starting note as Do.

import { midiOf, transpose, parsePc } from './theory.js';

const FIXED = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
const MOVABLE = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'];
const RAISED = { 0: 'Di', 1: 'Ri', 3: 'Fi', 4: 'Si', 5: 'Li' };
const LOWERED = { 1: 'Ra', 2: 'Me', 4: 'Se', 5: 'Le', 6: 'Te' };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const ACC = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };

/** Syllable of a note relative to a Do (pitch class {l, a}). */
export function movableSyllable(n, doPc) {
  const deg = (((n.l - doPc.l) % 7) + 7) % 7;
  const doMidi = midiOf({ ...doPc, o: 4 });
  const semis = (((midiOf({ ...n, o: 4 }) - doMidi) % 12) + 12) % 12;
  let alt = semis - MAJOR[deg];
  if (alt > 6) alt -= 12;
  if (alt < -6) alt += 12;
  if (alt === 1 && RAISED[deg]) return RAISED[deg];
  if (alt === -1 && LOWERED[deg]) return LOWERED[deg];
  return MOVABLE[deg];
}

/** Fixed Do: the letter's syllable, with the accidental shown (not sung). */
export function fixedSyllable(n, { accidental = true } = {}) {
  return FIXED[n.l] + (accidental ? ACC[String(n.a)] : '');
}

/** Pitch class that is Do for an exercise's settings, or null for fixed Do. */
export function doFor(settings, keyKind) {
  const sys = settings.solfege || 'movable';
  if (sys === 'fixed') return null;
  const tonic = parsePc(keyKind === 'start' ? settings.start : settings.key);
  if (sys === 'movableLa' && settings.mode === 'minor' && keyKind === 'key') {
    const rel = transpose({ ...tonic, o: 4 }, 2, 3); // relative major: the minor tonic becomes La
    return { l: rel.l, a: rel.a };
  }
  return tonic;
}

/**
 * Syllable function for an exercise, or null when it is not sung.
 * @returns {(note:{l,a,o})=>string|null}
 */
export function syllablesFor(exercise) {
  if (!exercise || !exercise.info || exercise.info.family !== 'voice') return null;
  const s = exercise.settings;
  const doPc = doFor(s, exercise.type.keyKind);
  return doPc ? (n) => movableSyllable(n, doPc) : (n) => fixedSyllable(n);
}

