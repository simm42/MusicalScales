// Turns generated steps + rhythm/bowing options into notated glyphs and the
// list of expected note events the listener will look for. No DOM access.

import { midiOf } from './theory.js';

// Each pattern part: dur = VexFlow duration, beats in crotchets, rest flag.
// longEnds: bottom & top notes double length; longMid: also key notes between octaves.
export const RHYTHMS = {
  crotchet: { label: '1 crotchet', short: '♩', parts: [{ dur: 'q', beats: 1 }] },
  crotchetLong: { label: 'Crotchets, long bottom & top', short: '♩ long ends', parts: [{ dur: 'q', beats: 1 }], longEnds: true },
  crotchetLongMid: { label: 'Crotchets, long bottom, top & key notes', short: '♩ long ends + key notes', parts: [{ dur: 'q', beats: 1 }], longEnds: true, longMid: true },
  q2:       { label: '2 quavers', short: '2 ♪', parts: [{ dur: '8', beats: 0.5 }, { dur: '8', beats: 0.5 }] },
  q2c:      { label: '2 quavers + crotchet', short: '2 ♪ + ♩', parts: [{ dur: '8', beats: 0.5 }, { dur: '8', beats: 0.5 }, { dur: 'q', beats: 1 }] },
  q2r:      { label: '2 quavers + quaver rest', short: '2 ♪ + rest', parts: [{ dur: '8', beats: 0.5 }, { dur: '8', beats: 0.5 }, { dur: '8', beats: 0.5, rest: true }] },
  q4:       { label: '4 quavers', short: '4 ♪', parts: [{ dur: '8', beats: 0.5 }, { dur: '8', beats: 0.5 }, { dur: '8', beats: 0.5 }, { dur: '8', beats: 0.5 }] },
};

/** The crotchet rhythms are the ones that can be slurred. */
export function isCrotchetRhythm(r) { return r === 'crotchet' || r === 'crotchetLong' || r === 'crotchetLongMid'; }

export function patternBeats(rhythm) { return RHYTHMS[rhythm].parts.reduce((a, p) => a + p.beats, 0); }

const DUR_FOR_BEATS = { 1: 'q', 1.5: 'qd', 2: 'h', 3: 'hd', 4: 'w' };

/**
 * @param exercise result of buildExercise()
 * @returns {{glyphs: object[], events: object[], totalBeats: number}}
 */
export function buildSequence(exercise) {
  const s = exercise.settings;
  const transposeSemis = exercise.info.transpose;
  const steps = exercise.gen.steps.map((st, i) => ({ ...st, index: i }));
  const top = exercise.gen.topIndex;
  const last = steps.length - 1;

  // mark long notes and repeated top note
  const rh = RHYTHMS[s.rhythm] || RHYTHMS.crotchet;
  const longEnds = !!(rh.longEnds || s.longEnds);
  const longMid = !!(rh.longMid || s.longMidTonics);
  const list = [];
  steps.forEach((st, i) => {
    // "long tonic": first and last notes, and the top note when it is a key note
    // (not the top of a scale to a 6th/12th, or the top of a dominant 7th)
    const isEnd = i === 0 || i === last || (i === top && st.tonic);
    const long = (longEnds && isEnd) || (longMid && st.tonic && !isEnd && i !== top);
    list.push({ ...st, long, role: i === 0 ? 'bottom' : i === last ? 'end' : i === top ? 'top' : '' });
    if (i === top && s.repeatTop) list.push({ ...st, long: false, role: 'repeat' });
  });

  const pattern = RHYTHMS[s.rhythm] || RHYTHMS.crotchet;
  const pBeats = patternBeats(s.rhythm);
  const glyphs = [];
  let beat = 0;
  let beamGroup = 0;
  list.forEach((st, si) => {
    if (st.long) {
      const beats = 2 * pBeats;
      glyphs.push({ kind: 'note', notes: st.notes, dur: DUR_FOR_BEATS[beats] || 'h', beats, onsetBeat: beat, stepIndex: si, role: st.role, beamGroup: null, long: true });
      beat += beats;
      return;
    }
    beamGroup++;
    for (const p of pattern.parts) {
      glyphs.push({ kind: p.rest ? 'rest' : 'note', notes: st.notes, dur: p.dur, beats: p.beats, onsetBeat: beat, stepIndex: si, role: st.role, beamGroup: p.dur === '8' ? beamGroup : null });
      beat += p.beats;
    }
  });

  // events = played notes
  const events = [];
  glyphs.forEach((g, gi) => {
    if (g.kind !== 'note') return;
    g.eventIndex = events.length;
    events.push({
      index: events.length,
      glyphIndex: gi,
      notes: g.notes,
      writtenMidis: g.notes.map(midiOf),
      midis: g.notes.map((n) => midiOf(n) + transposeSemis), // sounding
      onsetBeat: g.onsetBeat,
      beats: 0,
      role: g.role,
      stepIndex: g.stepIndex, // position in the scale, whatever the rhythm
      slurred: false,
    });
  });
  for (let i = 0; i < events.length; i++) {
    const next = events[i + 1];
    const g = glyphs[events[i].glyphIndex];
    events[i].beats = next ? next.onsetBeat - events[i].onsetBeat : g.beats;
  }

  // slurs: only with one note per step
  const groups = [];
  // notes per bow (0 = separate bows); `slurred` is the practice-page switch
  const t = exercise.type;
  const per = s.slurred && isCrotchetRhythm(s.rhythm) && t && t.slurs && t.slurs.length
    ? (t.slurs.includes(Number(s.slur)) ? Number(s.slur) : t.slurs[0])
    : 0;
  if (per > 1) {
    let cur = [];
    const flush = () => { if (cur.length > 1) groups.push(cur); cur = []; };
    for (const e of events) {
      // a long (double-length) note always has a bow to itself
      if (glyphs[e.glyphIndex].long) { flush(); continue; }
      const prev = cur[cur.length - 1];
      if (prev && prev.midis[0] === e.midis[0]) flush(); // same pitch twice needs a bow change
      cur.push(e);
      if (cur.length === per) flush();
    }
    flush();
    groups.forEach((grp, gid) => {
      grp.forEach((e, k) => {
        if (k > 0) e.slurred = true;
        const g = glyphs[e.glyphIndex];
        g.slurGroup = gid;
        if (k === 0) g.slurStart = true;
        if (k === grp.length - 1) g.slurEnd = true;
      });
    });
  }
  // consecutive same pitch (repeated quavers, repeated top) – needs a re-articulation onset
  for (let i = 1; i < events.length; i++) events[i].sameAsPrev = events[i].midis.join() === events[i - 1].midis.join();

  return { glyphs, events, slurGroups: groups.length, totalBeats: beat, steps: list.map((st) => st.notes) };
}
