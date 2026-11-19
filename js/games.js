// Pitch-training games: the rules, without any screen or sound. No DOM access
// (apart from localStorage for the scores), so it can be tested.
//
//  Name the note (listening): a note (or two) is played; choose its name from
//  four. Easier levels give the key and play it first; harder ones don't.
//  Sing the note: sing the note(s) asked for. Easier levels give the key and
//  play the note; harder ones only name it, then two or three in a row, then
//  without the key.

import { transpose, spellMidi, noteName, midiOf, parsePc } from './theory.js';

// ---------------------------------------------------------------- levels

export const LISTEN_LEVELS = [
  { id: 1, notes: 1, key: true, hearKey: true, keys: 'easy', label: 'One note', detail: 'The key is shown and played first.' },
  { id: 2, notes: 1, key: true, hearKey: false, keys: 'easy', label: 'One note', detail: 'The key is shown but not played.' },
  { id: 3, notes: 2, key: true, hearKey: true, keys: 'easy', label: 'Two notes', detail: 'Two notes in the key. The key is shown and played first.' },
  { id: 4, notes: 2, key: true, hearKey: false, keys: 'all', label: 'Two notes', detail: 'Two notes in the key. The key is shown but not played.' },
  { id: 5, notes: 1, key: false, hearKey: false, keys: 'all', label: 'One note, no key', detail: 'No key given – just the note.' },
  { id: 6, notes: 2, key: false, hearKey: false, keys: 'all', label: 'Two notes, no key', detail: 'Two notes in the same (secret) key.' },
];

export const SING_LEVELS = [
  { id: 1, notes: 1, key: true, hearKey: true, hearNote: true, keys: 'easy', label: 'Copy the note', detail: 'The key and the note are played – sing it back.' },
  { id: 2, notes: 1, key: true, hearKey: true, hearNote: false, keys: 'easy', label: 'One note', detail: 'The key is played; the note is only named.' },
  { id: 3, notes: 1, key: true, hearKey: false, hearNote: false, keys: 'easy', label: 'One note, key not played', detail: 'The key is shown but not played.' },
  { id: 4, notes: 2, key: true, hearKey: true, hearNote: false, keys: 'easy', label: 'Two notes in a row', detail: 'The key is played; sing the two notes in order.' },
  { id: 5, notes: 3, key: true, hearKey: true, hearNote: false, keys: 'all', label: 'Three notes in a row', detail: 'The key is played; sing the three notes in order.' },
  { id: 6, notes: 3, key: true, hearKey: false, hearNote: false, keys: 'all', label: 'Three notes, key not played', detail: 'The key is shown but not played.' },
  { id: 7, notes: 1, key: false, hearKey: false, hearNote: false, keys: 'all', label: 'One note, no key', detail: 'No key, no sound – sing the note named.' },
];

export const GAME = {
  listenRound: 10,     // questions in a round
  singRound: 6,
  unlockAt: 0.7,       // a round this good unlocks the next level
  singHoldSec: 0.5,    // hold the note this long…
  singCents: [50, 50, 40, 40, 40, 35, 35], // …within this many cents (by level)
  singTimeoutSec: 10,  // per note
  singGapSec: 0.25,    // a breath or a wobble this short doesn't start the hold again
  singClarity: 0.6,    // a sung vowel is accepted as pitched from this clarity…
  singRms: 0.0015,     // …and this loudness
};

const EASY_KEYS = ['C', 'G', 'D', 'A', 'F', 'Bb', 'Eb'];
const ALL_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const SOLFA = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'];

/** Small repeatable random numbers (tests pass a seed). */
export function rng(seed = Date.now()) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
function shuffle(r, a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

/** A major key: its seven notes (spelled for the key) and how to spell other notes. */
export function majorKey(name) {
  const tonic = parsePc(name);
  const degrees = MAJOR.map((semis, d) => { const n = transpose({ ...tonic, o: 4 }, d, semis); return { l: n.l, a: n.a }; });
  const flats = degrees.some((p) => p.a < 0) || name === 'F';
  return { name, tonic, degrees, pref: flats ? 'flat' : 'sharp', title: `${noteName({ ...tonic, o: 0 })} major` };
}

const pcOf = (m) => ((m % 12) + 12) % 12;
const pcName = (p) => noteName({ ...p, o: 0 });
const pcSemis = (p) => pcOf(midiOf({ ...p, o: 4 }));

/**
 * Where the notes go: the key note's octave chosen so that the scale sits in
 * a comfortable part of the range (sounding MIDI numbers).
 */
export function tonicMidi(key, lowMidi, highMidi) {
  const t = pcSemis(key.tonic);
  // lowest tonic at or above low + 3, keeping a whole octave above it within range if possible
  let m = Math.ceil((lowMidi + 3 - t) / 12) * 12 + t;
  if (m + 12 > highMidi && m - 12 >= lowMidi) m -= 12;
  return m;
}

/** The key note, its third and fifth and the octave: played to set the key. */
export const keyChord = (tonic) => [tonic, tonic + 4, tonic + 7, tonic + 12];

// ---------------------------------------------------------------- name the note

/**
 * One question.
 * @returns {{ key, keyShown, hearKey, reference:number[], notes:Array<{midi, name, degree}>, choices:string[][] }}
 */
export function listenQuestion(level, { low, high, r = rng() }) {
  const L = LISTEN_LEVELS.find((x) => x.id === level) || LISTEN_LEVELS[0];
  const key = majorKey(pick(r, L.keys === 'easy' ? EASY_KEYS : ALL_KEYS));
  const tonic = tonicMidi(key, low, high);
  const notes = [];
  for (let i = 0; i < L.notes; i++) {
    let d;
    do { d = Math.floor(r() * 8); } while (notes.some((n) => n.degree === d % 7)); // two different notes
    const degree = d % 7;
    const midi = tonic + MAJOR[degree] + (d === 7 ? 12 : 0);
    notes.push({ midi, degree, name: pcName(key.degrees[degree]) });
  }
  const choices = notes.map((n) => answerChoices(n, key, L.key, r));
  return { level: L.id, key, keyShown: L.key, hearKey: L.hearKey, reference: L.hearKey ? keyChord(tonic) : [], notes, choices };
}

/**
 * Four names to choose from, one of them right. With the key known the others
 * are other notes of the key (mostly near ones); without it, notes a semitone
 * or a tone either side – harder to tell apart.
 */
export function answerChoices(note, key, keyKnown, r = rng()) {
  const right = note.name;
  let pool;
  if (keyKnown) {
    const near = [1, -1, 2, -2, 3, -3].map((s) => key.degrees[(note.degree + s + 7) % 7]);
    pool = near.map(pcName);
  } else {
    pool = [1, -1, 2, -2, 3, -3].map((s) => pcName(spellMidi(note.midi + s, key.pref)));
  }
  const others = [...new Set(pool.filter((n) => n !== right))];
  const chosen = shuffle(r, others.slice(0, 4)).slice(0, 3);
  return shuffle(r, [right, ...chosen]);
}

// ---------------------------------------------------------------- sing the note

/** Sol-fa syllable (movable Do) of a key's degree. */
export const solfa = (degree) => SOLFA[degree];

/**
 * One question: the notes to sing in order, in a comfortable part of the voice.
 * @returns {{ key, keyShown, hearKey, hearNote, reference:number[], notes:Array<{midi, name, degree, sol}> }}
 */
export function singQuestion(level, { low, high, r = rng() }) {
  const L = SING_LEVELS.find((x) => x.id === level) || SING_LEVELS[0];
  const key = majorKey(pick(r, L.keys === 'easy' ? EASY_KEYS : ALL_KEYS));
  const tonic = tonicMidi(key, low, Math.max(high, low + 12));
  const notes = [];
  let prev = null;
  for (let i = 0; i < L.notes; i++) {
    let degree;
    // in a row: mostly steps and small leaps, never the same note twice running
    do { degree = prev == null ? Math.floor(r() * 7) : prev + pick(r, [-2, -1, 1, 1, 2, 3, -3]); } while (degree < 0 || degree > 6 || degree === prev);
    prev = degree;
    notes.push({ midi: tonic + MAJOR[degree], degree, name: pcName(key.degrees[degree]), sol: solfa(degree) });
  }
  return { level: L.id, key, keyShown: L.key, hearKey: L.hearKey, hearNote: L.hearNote, reference: L.hearKey ? keyChord(tonic) : [], notes };
}

/**
 * Is a sung pitch the note asked for? Any octave counts (men and women sing
 * the same note an octave apart). @returns {{ ok:boolean, cents:number }}
 */
export function sungMatches(midi, target, toleranceCents) {
  let d = (midi - target) * 100;
  d = ((d % 1200) + 1800) % 1200 - 600; // nearest octave of the target
  return { ok: Math.abs(d) <= toleranceCents, cents: d };
}

/**
 * Follows a sung note: it counts once held steadily on the target (any
 * octave) for long enough. push() each pitch reading.
 */
export class HoldJudge {
  constructor(target, { tolerance = 50, holdSec = GAME.singHoldSec, gapSec = GAME.singGapSec } = {}) {
    this.target = target; this.tolerance = tolerance; this.holdSec = holdSec; this.gapSec = gapSec;
    this.since = null; this.lastOk = null; this.readings = [];
  }
  /** @param {number|null} midi a voiced reading, or null for silence/noise. @returns cents when done, else null */
  push(t, midi) {
    const m = midi == null ? null : sungMatches(midi, this.target, this.tolerance);
    if (!m || !m.ok) {
      // a short gap (a breath, a wobble, a stray reading) doesn't start again
      if (this.since != null && t - this.lastOk <= this.gapSec) return null;
      this.since = null; this.readings = [];
      return null;
    }
    if (this.since == null) this.since = t;
    this.lastOk = t;
    this.readings.push(m.cents);
    if (t - this.since >= this.holdSec) {
      const s = this.readings.slice().sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    }
    return null;
  }
}

// ---------------------------------------------------------------- scores and levels unlocked

const KEY = 'scales.games.v1';
const empty = () => ({ listen: { best: {} }, sing: { best: {} } });

export function loadProgress(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { const p = JSON.parse(storage.getItem(KEY)); return { ...empty(), ...(p || {}) }; } catch { return empty(); }
}
export function saveProgress(p, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { storage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

/** Record a finished round (fraction right, 0–1). @returns { best, newBest, unlocked } */
export function recordRound(p, game, level, fraction) {
  const g = p[game] || (p[game] = { best: {} });
  const levels = game === 'listen' ? LISTEN_LEVELS : SING_LEVELS;
  const hasNext = level < levels.length;
  const nextWasOpen = hasNext && isUnlocked(p, game, level + 1);
  const was = g.best[level] ?? null;
  const newBest = was == null || fraction > was;
  if (newBest) g.best[level] = Math.round(fraction * 100) / 100;
  return { best: g.best[level], newBest, unlocked: hasNext && !nextWasOpen && isUnlocked(p, game, level + 1) };
}

/** Level 1 is always open; the next opens after a round of 70 % or more. */
export function isUnlocked(p, game, level) {
  if (level <= 1) return true;
  const prev = (p[game] && p[game].best[level - 1]) ?? null;
  return prev != null && prev >= GAME.unlockAt;
}

/** Stars for a round: ★ 50 %, ★★ 70 %, ★★★ 90 %. */
export const stars = (fraction) => (fraction >= 0.9 ? 3 : fraction >= 0.7 ? 2 : fraction >= 0.5 ? 1 : 0);
