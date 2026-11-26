// Ear training: a sequence of levels that takes someone with a weak sense of pitch to a
// good one. The rules only – no screen or sound (see ui/gamesPage.js). No DOM access.
//
// How the levels are built, from the research on training pitch:
//  - Up or down first. Hearing which way the pitch moves (contour) is the first thing
//    children perceive and the thing people with a poor ear find hardest; it improves with
//    practice (Liu et al. 2017, pitch-direction training in amusia; Dowling's work on contour).
//  - Easy to hard. Training that starts with big, obvious differences and makes them smaller
//    learns faster than practising hard ones (Liu, Mercado, Church & Orduña 2008; Wisniewski
//    2017, 2019), and the occasional easy question keeps the learner on track (Ahissar &
//    Hochstein's "eureka" effect) – so the close levels mix in a few wider ones.
//  - Feedback on every answer, with the answer to hear, speeds learning.
//  - The same instrument sound throughout (a change of timbre throws pitch judgements), but
//    a different register each question, so it is the relation that is learnt, not one pitch.
//  - Notes in a key, by what they do (scale degrees, sol-fa): the key is set by a cadence, the
//    note is named by its place, then it walks home to Do (Benbassat's functional ear
//    training). The most stable notes come first – Do and Sol, then Mi (the tonal hierarchy:
//    Krumhansl), then the pentatonic Re and La, and Fa and Ti last (the Kodály order).
//  - Sounds before names (Gordon: aural before verbal): letter names come last, first inside
//    a key, then from a given A, and at the very end with no reference at all – a little
//    "absolute pitch", which some adults can learn on a small set of notes (Van Hedger et al. 2019).
//  - A tuning ear for string players: sharp or flat by a quarter tone, then 20–35 cents, then
//    10–20 – about where trained players' judgements lie.
//  - Pass marks that guessing can't reach: with two answers a round is 12 questions and needs
//    10; with three or more, 10 questions and 7 (a lucky guesser passes under 2 % of the time).

import { majorKey, tonicMidi, rng } from './games.js';
import { noteName, midiOf } from './theory.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const SOLFA = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti', 'Do'];
const EASY_KEYS = ['C', 'G', 'D', 'A', 'F', 'Bb', 'Eb'];
const ALL_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'];

export const EAR_STAGES = [
  { id: 'updown', title: 'Up or down', intro: 'Hear which way the music moves – the first thing to listen for.' },
  { id: 'shapes', title: 'Shapes of tunes', intro: 'Follow a few notes at once, and hear how far each one moves.' },
  { id: 'key', title: 'Notes in a key', intro: 'The key is played first; name each note by its place in it (sol-fa). After each answer it walks home to Do.' },
  { id: 'tuning', title: 'Tuning ear', intro: 'Is the second note sharp or flat? The ear for playing in tune.' },
  { id: 'names', title: 'Note names', intro: 'Letter names: in a key, then from an A, then with no help at all.' },
];

const TWO = { total: 12, pass: 10 };   // two answers
const MANY = { total: 10, pass: 7 };   // three or more

/**
 * Every level: how the notes are played (how), what is asked (ask), how it is answered (answer),
 * and what changes from the level before. Rounds and pass marks depend on how many answers there are.
 */
export const EAR_LEVELS = [
  // ---- up or down
  { id: 1, stage: 'updown', title: 'Higher or lower – big jumps', answer: 'direction', gaps: [8, 12], ...TWO,
    how: 'Two notes, one after the other, far apart.', ask: 'Was the second note higher or lower?',
    tip: 'Don’t worry about the names – just which way it went.' },
  { id: 2, stage: 'updown', title: 'Higher or lower – smaller jumps', answer: 'direction', gaps: [3, 7], easy: [8, 12], ...TWO,
    how: 'Two notes, a little closer together.', ask: 'Was the second note higher or lower?',
    tip: 'Hum the two notes after you hear them – your voice feels the way it moves.' },
  { id: 3, stage: 'updown', title: 'Higher or lower – close notes', answer: 'direction', gaps: [1, 2], easy: [3, 5], ...TWO,
    how: 'Two notes next to each other: a tone or a semitone apart.', ask: 'Was the second note higher or lower?',
    tip: 'The smallest steps in music – listen closely to the second note.' },
  { id: 4, stage: 'updown', title: 'Same, higher or lower?', answer: 'direction3', gaps: [1, 2], ...MANY,
    how: 'Two close notes – or the same note twice.', ask: 'Was the second note the same, higher or lower?',
    tip: 'About one question in three is the same note.' },
  // ---- shapes of tunes
  { id: 5, stage: 'shapes', title: 'Three-note shapes', answer: 'shape', notes: 3, steps: [2, 5], ...MANY,
    how: 'Three notes.', ask: 'Which picture shows how the tune moved?',
    tip: 'Up then down is a hill; down then up a valley.' },
  { id: 6, stage: 'shapes', title: 'Four-note shapes', answer: 'shape', notes: 4, steps: [1, 4], ...MANY,
    how: 'Four notes, some only a step apart.', ask: 'Which picture shows how the tune moved?',
    tip: 'Follow the tune as one line, not note by note.' },
  { id: 7, stage: 'shapes', title: 'Step, skip or leap?', answer: 'size', ...MANY,
    how: 'Two notes of a scale.', ask: 'Did it move by a step (the next note), a skip (missing one out) or a leap (further)?',
    tip: 'A step is like walking up a stair, a skip jumps one stair, a leap several.' },
  // ---- notes in a key
  { id: 8, stage: 'key', title: 'Do or Sol?', answer: 'ladder', degrees: [0, 4, 7], ...TWO,
    how: 'The key is played (chords), then one note.', ask: 'Was the note Do (the home note) or Sol?',
    tip: 'Do sounds finished, at rest; Sol sounds open, as if more is to come.' },
  { id: 9, stage: 'key', title: 'Do, Mi or Sol?', answer: 'ladder', degrees: [0, 2, 4, 7], ...MANY,
    how: 'The key is played, then one note.', ask: 'Which note was it?',
    tip: 'Do, Mi and Sol are the notes of the home chord.' },
  { id: 10, stage: 'key', title: 'Five notes: Do Re Mi Sol La', answer: 'ladder', degrees: [0, 1, 2, 4, 5, 7], ...MANY,
    how: 'The key is played, then one note.', ask: 'Which note was it?',
    tip: 'Re wants to step down to Do; La sits just above Sol.' },
  { id: 11, stage: 'key', title: 'The whole scale', answer: 'ladder', degrees: [0, 1, 2, 3, 4, 5, 6, 7], ...MANY,
    how: 'The key is played, then one note.', ask: 'Which note was it?',
    tip: 'Fa leans down to Mi; Ti pulls hard up to Do.' },
  { id: 12, stage: 'key', title: 'Two notes in a row', answer: 'ladder', degrees: [0, 1, 2, 3, 4, 5, 6, 7], notes: 2, ...MANY,
    how: 'The key is played, then two notes.', ask: 'Which two notes, in order?',
    tip: 'Hold the first note in your head while the second plays.' },
  { id: 13, stage: 'key', title: 'A three-note tune', answer: 'ladder', degrees: [0, 1, 2, 3, 4, 5, 6, 7], notes: 3, tune: true, ...MANY,
    how: 'The key is played, then a little tune of three notes.', ask: 'Which three notes, in order?',
    tip: 'Tunes mostly move by steps – listen for the one that jumps.' },
  // ---- tuning ear
  { id: 14, stage: 'tuning', title: 'Sharp or flat – a quarter tone', answer: 'tuning', cents: [40, 60], ...TWO,
    how: 'A note, then the same note played out of tune.', ask: 'Was the second note sharp (too high) or flat (too low)?',
    tip: 'Like tuning a string to a given note.' },
  { id: 15, stage: 'tuning', title: 'Sharp, flat or in tune?', answer: 'tuning3', cents: [20, 35], easy: [45, 55], ...MANY,
    how: 'A note, then the same note – in tune, or a little out.', ask: 'Was the second note sharp, flat or in tune?',
    tip: 'About one in three is in tune.' },
  { id: 16, stage: 'tuning', title: 'Sharp or flat – fine tuning', answer: 'tuning', cents: [10, 20], easy: [25, 35], ...TWO,
    how: 'A note, then the same note very slightly out of tune.', ask: 'Was the second note sharp or flat?',
    tip: 'This is as fine as a good string player hears – take your time.' },
  // ---- note names
  { id: 17, stage: 'names', title: 'Name the note in a key', answer: 'letters', degrees: [0, 1, 2, 3, 4, 5, 6, 7], ...MANY,
    how: 'The key is named and played, then one note.', ask: 'Which note was it – by its letter name?',
    tip: 'Find its sol-fa first, then its letter in this key.' },
  { id: 18, stage: 'names', title: 'Name it from an A', answer: 'fromA', ...MANY,
    how: 'An A is played (the note orchestras tune to), then another note – no sharps or flats.', ask: 'Which note was it?',
    tip: 'Count up or down the white notes from A.' },
  { id: 19, stage: 'names', title: 'Name it with no help', answer: 'strings', ...MANY,
    how: 'One note, with nothing to compare it with – one of your open strings.', ask: 'Which string was it?',
    tip: 'Each open string has its own colour – listen for it, as you would for a friend’s voice.' },
];

export const earLevel = (id) => EAR_LEVELS.find((L) => L.id === id) || EAR_LEVELS[0];
/** The share of a round needed to pass a level (and open the next). */
export const passFraction = (id) => { const L = earLevel(id); return L.pass / L.total; };
/** Stars for a round: ★ passed, ★★ halfway from the pass mark to full marks, ★★★ all (or nearly all) right. */
export function earStars(id, fraction) {
  const p = passFraction(id);
  return fraction >= 0.95 ? 3 : fraction >= (p + 1) / 2 - 1e-9 ? 2 : fraction >= p - 1e-9 ? 1 : 0;
}
/** The chance of passing a level's round by guessing. */
export function guessPassChance(id) {
  const L = earLevel(id);
  const k = { direction: 2, direction3: 3, shape: 4, size: 3, tuning: 2, tuning3: 3, fromA: 7, strings: 4, letters: L.degrees ? 7 : 4, ladder: L.degrees ? new Set(L.degrees.map((d) => d % 7)).size : 4 }[L.answer];
  const p = 1 / k;
  let c = 0;
  const choose = (n, r) => { let x = 1; for (let i = 1; i <= r; i++) x = (x * (n - r + i)) / i; return x; };
  for (let r = L.pass; r <= L.total; r++) c += choose(L.total, r) * p ** r * (1 - p) ** (L.total - r);
  return c;
}

const between = (r, [a, b]) => a + Math.floor(r() * (b - a + 1));
const pick = (r, a) => a[Math.floor(r() * a.length)];
function shuffle(r, a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

/** A sound: notes at once (midis, sounding MIDI – may be between semitones), how long until the next, how long it sounds. */
const snd = (midis, beats = 1.2, hold = 0.95) => ({ midis: [].concat(midis), beats, hold });

/** The key, set by chords: I – IV – V – I, around the key note, then a pause. */
export function cadence(t) {
  return [snd([t - 12, t - 8, t - 5], 0.9, 0.85), snd([t - 12, t - 7, t - 3], 0.9, 0.85), snd([t - 13, t - 10, t - 5], 0.9, 0.85), snd([t - 12, t - 8, t - 5], 2, 1.6)];
}

/** A note's way home to Do: Re, Mi and Fa step down; Sol, La and Ti step up to the Do above. */
export function walkHome(degree) {
  if (degree === 0 || degree === 7) return [degree];
  const out = [];
  if (degree <= 3) for (let d = degree; d >= 0; d--) out.push(d);
  else for (let d = degree; d <= 7; d++) out.push(d);
  return out;
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcOf = (m) => ((Math.round(m) % 12) + 12) % 12;
const name = (p) => noteName({ ...p, o: 0 });

/**
 * One question.
 * @param {number} level
 * @param {{low:number, high:number, strings?:number[], r?:Function}} o sounding range (MIDI); open strings (sounding MIDI)
 * @returns {{ level, answer, options:{id,label,sub?}[], correct:string[], play:object[], after:object[], hear:Object<string,number>, info:string }}
 *   correct: the right option for each note asked (in order); hear: what each option sounds like, to compare after answering
 */
export function earQuestion(level, { low, high, strings = [], r = rng() }) {
  const L = earLevel(level);
  const lo = Math.max(low, 45), hi = Math.max(high, lo + 19);
  const q = { level: L.id, answer: L.answer, options: [], correct: [], play: [], after: [], hear: {}, info: '' };
  // the occasional wider question in the close levels (one in five)
  const gapsOf = () => (L.easy && r() < 0.2 ? L.easy : L.gaps || L.cents);

  if (L.answer === 'direction' || L.answer === 'direction3') {
    const same = L.answer === 'direction3' && r() < 1 / 3;
    const gap = same ? 0 : between(r, gapsOf());
    const up = r() < 0.5;
    const first = up ? between(r, [lo, hi - gap]) : between(r, [lo + gap, hi]);
    const second = same ? first : first + (up ? gap : -gap);
    q.play = [snd(first), snd(second)];
    q.options = [{ id: 'up', label: '⬆ Higher' }, ...(L.answer === 'direction3' ? [{ id: 'same', label: '= Same' }] : []), { id: 'down', label: '⬇ Lower' }];
    q.correct = [same ? 'same' : up ? 'up' : 'down'];
    q.hear = { first, second };
    return q;
  }

  if (L.answer === 'shape') {
    const n = L.notes;
    const all = [];
    for (let m = 0; m < 2 ** (n - 1); m++) all.push([...Array(n - 1)].map((_, k) => ((m >> k) & 1 ? 'u' : 'd')).join(''));
    const shape = pick(r, all);
    const moves = [...shape].map((c) => (c === 'u' ? 1 : -1) * between(r, L.steps));
    let pos = 0, mn = 0, mx = 0;
    for (const m of moves) { pos += m; mn = Math.min(mn, pos); mx = Math.max(mx, pos); }
    let p = between(r, [lo - mn, hi - mx]);
    const notes = [p];
    for (const m of moves) { p += m; notes.push(p); }
    q.play = notes.map((m) => snd(m, 1, 0.9));
    const others = shuffle(r, all.filter((s) => s !== shape)).slice(0, 3);
    q.options = shuffle(r, [shape, ...others]).map((s) => ({ id: s, label: shapeWords(s) }));
    q.correct = [shape];
    return q;
  }

  if (L.answer === 'size') {
    const key = majorKey(pick(r, EASY_KEYS));
    const t = tonicMidi(key, lo, hi);
    const kind = pick(r, ['step', 'skip', 'leap']);
    const span = kind === 'step' ? 1 : kind === 'skip' ? 2 : between(r, [3, 5]);
    const deg = (d) => t + MAJOR[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    const up = r() < 0.5;
    const a = up ? between(r, [0, 7 - span]) : between(r, [span, 7]);
    const b = a + (up ? span : -span);
    q.play = [snd(deg(a)), snd(deg(b))];
    q.options = [{ id: 'step', label: 'Step', sub: 'the next note' }, { id: 'skip', label: 'Skip', sub: 'missing one out' }, { id: 'leap', label: 'Leap', sub: 'further' }];
    q.correct = [kind];
    return q;
  }

  if (L.answer === 'ladder' || L.answer === 'letters') {
    const key = majorKey(pick(r, L.id <= 9 ? EASY_KEYS : ALL_KEYS));
    const t = tonicMidi(key, lo, hi);
    const midiOfDeg = (d) => t + MAJOR[d % 7] + (d === 7 ? 12 : 0);
    const n = L.notes || 1;
    const degs = [];
    let prev = null;
    for (let i = 0; i < n; i++) {
      let d;
      do {
        d = L.tune && prev != null ? prev + pick(r, [-2, -1, -1, 1, 1, 2, 3, -3]) : pick(r, L.degrees);
      } while (d < 0 || d > 7 || !L.degrees.includes(d) || (prev != null && d % 7 === prev % 7));
      degs.push(d);
      prev = d;
    }
    q.play = [...cadence(t), ...degs.map((d, i) => snd(midiOfDeg(d), i === degs.length - 1 ? 1.4 : 1.1, 0.95))];
    q.after = walkHome(degs[degs.length - 1]).map((d) => snd(midiOfDeg(d), 0.7, 0.65));
    // the ladder: high Do at the top; rungs not in this level are shown but not offered
    q.options = [7, 6, 5, 4, 3, 2, 1, 0].map((d) => ({
      id: String(d),
      label: L.answer === 'letters' ? name(key.degrees[d % 7]) : SOLFA[d],
      sub: L.answer === 'letters' ? SOLFA[d] : name(key.degrees[d % 7]),
      off: !L.degrees.includes(d),
    }));
    q.correct = degs.map(String);
    q.same = { 0: '7', 7: '0' }; // low and high Do are both Do
    q.hear = Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), midiOfDeg(d)]));
    q.info = `Key: ${key.title}`;
    q.key = key;
    return q;
  }

  if (L.answer === 'tuning' || L.answer === 'tuning3') {
    const inTune = L.answer === 'tuning3' && r() < 1 / 3;
    const cents = inTune ? 0 : between(r, gapsOf()) * (r() < 0.5 ? 1 : -1);
    const ref = between(r, [lo + 2, hi - 2]);
    q.play = [snd(ref, 1.6, 1.4), snd(ref + cents / 100, 1.6, 1.4)];
    q.options = [{ id: 'flat', label: '♭ Flat', sub: 'too low' }, ...(L.answer === 'tuning3' ? [{ id: 'in', label: '✓ In tune' }] : []), { id: 'sharp', label: '♯ Sharp', sub: 'too high' }];
    q.correct = [cents === 0 ? 'in' : cents > 0 ? 'sharp' : 'flat'];
    q.cents = cents;
    return q;
  }

  if (L.answer === 'fromA') {
    // an A in the middle of the range, then a natural note within a sixth of it
    const a = 57 + 12 * Math.round((((lo + hi) / 2) - 57) / 12);
    const near = [];
    for (let m = a - 9; m <= a + 9; m++) if (m !== a && Object.values(NATURAL).includes(pcOf(m))) near.push(m);
    const m = pick(r, near);
    q.play = [snd(a, 1.6, 1.4), snd(m, 1.4, 1.1)];
    q.options = LETTERS.map((l) => ({ id: l, label: l }));
    q.correct = [LETTERS.find((l) => NATURAL[l] === pcOf(m))];
    q.hear = Object.fromEntries(LETTERS.map((l) => { let x = a + ((NATURAL[l] - 9 + 12) % 12); if (x - a > 6) x -= 12; return [l, x]; }));
    q.info = 'The first note is A.';
    return q;
  }

  // strings: one of the open strings, with nothing to compare it with
  const opens = strings.length ? strings : [60, 64, 67, 69];
  const lift = (m) => { let x = m; while (x < 48) x += 12; return x; };
  const pickM = pick(r, opens);
  const letter = (m) => LETTERS.find((l) => NATURAL[l] === pcOf(m)) || name({ l: 0, a: pcOf(m) }); // open strings are naturals
  q.play = [snd(lift(pickM), 2, 1.8)];
  q.options = opens.map((m) => ({ id: letter(m), label: letter(m) }));
  q.correct = [letter(pickM)];
  q.hear = Object.fromEntries(opens.map((m) => [letter(m), lift(m)]));
  return q;
}

/** A shape in words, for screen readers and as a caption: "up, then down". */
export function shapeWords(s) {
  return [...s].map((c) => (c === 'u' ? 'up' : 'down')).join(', then ');
}

/** The sounding MIDI of an instrument's open strings (none for the voice and other instruments). */
export function openStrings(info) {
  return (info.stringNotes || []).map((n) => midiOf(n) + (info.transpose || 0));
}

/** Is an answer right for a note (low and high Do are both Do)? */
export function answerRight(q, k, id) {
  return id === q.correct[k] || (q.same && q.same[q.correct[k]] === id);
}
