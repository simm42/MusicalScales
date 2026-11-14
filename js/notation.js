// Score rendering with VexFlow (loaded as a classic script: window.Vex).

import { assignClefs } from './instruments.js';
import { vexKeySpec, keySigAccidental, LETTERS, midiOf } from './theory.js';

const VF = () => window.Vex.Flow;
const ACC_SYM = { '-2': 'bb', '-1': 'b', 0: 'n', 1: '#', 2: '##' };
const REST_KEY = { treble: 'b/4', alto: 'c/4', tenor: 'a/3', bass: 'd/3' };
const GLYPH_W = { w: 54, hd: 50, h: 46, qd: 40, q: 36, 8: 30 };

const vexKey = (n) => `${LETTERS[n.l].toLowerCase()}/${n.o}`;

function fgColor(el) {
  const c = getComputedStyle(el).getPropertyValue('--score-ink').trim();
  return c || getComputedStyle(el).color || '#000';
}

function newRenderer(container, width, height) {
  const V = VF();
  const r = new V.Renderer(container, V.Renderer.Backends.SVG);
  r.resize(width, height);
  const ctx = r.getContext();
  const ink = fgColor(container);
  ctx.setFillStyle(ink);
  ctx.setStrokeStyle(ink);
  return ctx;
}

/** Clef + key signature only. */
export function renderKeySignature(container, exercise) {
  container.innerHTML = '';
  const V = VF();
  const width = 110 + 11 * Math.abs(exercise.fifths);
  const ctx = newRenderer(container, width + 10, 130);
  const stave = new V.Stave(0, 20, width);
  stave.addClef(exercise.info.clef);
  if (exercise.fifths) stave.addKeySignature(vexKeySpec(exercise.fifths));
  stave.setEndBarType(V.Barline.type.NONE);
  stave.setContext(ctx).draw();
  return { arrowTargets: [] };
}

/**
 * Full score. Returns positions for the follow arrow and an element per event
 * for colouring notes after scoring.
 */
export function renderScore(container, exercise, seq, { clefMode = 'change' } = {}) {
  container.innerHTML = '';
  const V = VF();
  const width = Math.max(200, Math.floor(container.clientWidth || 800));
  const glyphs = seq.glyphs;

  // clef per step (a step's repeated quavers/rests share its clef)
  const stepIds = [...new Set(glyphs.map((g) => g.stepIndex))];
  const stepMidi = stepIds.map((si) => midiOf(glyphs.find((g) => g.stepIndex === si).notes[0]));
  const stepClef = new Map(assignClefs(exercise.info.id, stepMidi, clefMode).map((c, k) => [stepIds[k], c]));
  const clefs = glyphs.map((g) => stepClef.get(g.stepIndex));

  // line breaking at step boundaries
  const keyW = 11 * Math.abs(exercise.fifths);
  const startW = 50 + keyW + 10;
  const lines = [];
  const lineUsed = [];
  let cur = [];
  let used = startW;
  let i = 0;
  while (i < glyphs.length) {
    let j = i;
    while (j + 1 < glyphs.length && glyphs[j + 1].stepIndex === glyphs[i].stepIndex) j++;
    const chunk = glyphs.slice(i, j + 1).map((g, k) => i + k);
    const w = chunk.reduce((a, gi) => a + GLYPH_W[glyphs[gi].dur] + (glyphs[gi].notes.some((n) => n.a) ? 8 : 0), 0);
    if (cur.length && used + w > width - 20) { lines.push(cur); lineUsed.push(used); cur = []; used = startW; }
    cur.push(...chunk);
    used += w;
    i = j + 1;
  }
  if (cur.length) { lines.push(cur); lineUsed.push(used); }

  const lineH = clefMode === 'change' ? 130 : 170;
  const topPad = clefMode === 'change' ? 40 : 70;
  const ctx = newRenderer(container, width, lines.length * lineH + 30);

  const noteObjs = new Array(glyphs.length);
  const staveOf = new Array(glyphs.length);

  lines.forEach((line, li) => {
    const y = topPad + li * lineH - 20;
    const isLast = li === lines.length - 1;
    // a short final line keeps natural spacing instead of stretching across the page
    const staveW = isLast && lines.length > 1 ? Math.min(width - 12, Math.max(lineUsed[li] * 1.1 + 20, 200)) : width - 12;
    const stave = new V.Stave(5, y, staveW);
    const lineClef = clefs[line[0]];
    stave.addClef(lineClef);
    if (exercise.fifths) stave.addKeySignature(vexKeySpec(exercise.fifths));
    stave.setEndBarType(li === lines.length - 1 ? V.Barline.type.END : V.Barline.type.SINGLE);
    stave.setContext(ctx).draw();

    // accidental state per letter+octave, reset each line
    const state = {};
    const accFor = (n) => {
      const key = n.l + ':' + n.o;
      const curAcc = key in state ? state[key] : keySigAccidental(exercise.fifths, n.l);
      state[key] = n.a;
      return curAcc === n.a ? null : ACC_SYM[String(n.a)];
    };

    const tickables = [];
    let clef = lineClef;
    for (const gi of line) {
      const g = glyphs[gi];
      if (clefs[gi] !== clef) { clef = clefs[gi]; tickables.push(new V.ClefNote(clef, 'small')); }
      let note;
      if (g.kind === 'rest') {
        note = new V.StaveNote({ clef, keys: [REST_KEY[clef]], duration: g.dur.replace('d', '') + 'r' });
      } else {
        note = new V.StaveNote({ clef, keys: g.notes.map(vexKey), duration: g.dur.replace('d', ''), auto_stem: true });
        g.notes.forEach((n, k) => { const a = accFor(n); if (a) note.addModifier(new V.Accidental(a), k); });
      }
      if (g.dur.endsWith('d')) V.Dot.buildAndAttach([note], { all: true });
      noteObjs[gi] = note;
      staveOf[gi] = stave;
      tickables.push(note);
    }

    const voice = new V.Voice({ num_beats: 4, beat_value: 4 }).setMode(V.Voice.Mode.SOFT);
    voice.addTickables(tickables);
    // beams within each step pattern
    const beams = [];
    let group = [];
    let gid = null;
    const flush = () => { if (group.length > 1) beams.push(new V.Beam(group, true)); group = []; };
    for (const gi of line) {
      const g = glyphs[gi];
      if (g.kind === 'note' && g.beamGroup != null && g.beamGroup === gid) group.push(noteObjs[gi]);
      else { flush(); if (g.kind === 'note' && g.beamGroup != null) group = [noteObjs[gi]]; }
      gid = g.kind === 'note' ? g.beamGroup : null;
    }
    flush();

    new V.Formatter().joinVoices([voice]).format([voice], staveW + 5 - stave.getNoteStartX() - 25);
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());
  });

  // slurs (split where a slur group crosses a line break)
  const lineOf = new Map();
  lines.forEach((line, li) => line.forEach((gi) => lineOf.set(gi, li)));
  const groups = new Map();
  glyphs.forEach((g, gi) => { if (g.slurGroup != null) { if (!groups.has(g.slurGroup)) groups.set(g.slurGroup, []); groups.get(g.slurGroup).push(gi); } });
  // A slur that crosses a line break is drawn in pieces: running off the end of
  // one line and in from the start of the next, as in printed music.
  const headPoint = (note, below) => {
    const ys = note.getYs();
    return { x: note.getAbsoluteX() + note.getGlyphWidth() / 2, y: below ? Math.max(...ys) + 7 : Math.min(...ys) - 7 };
  };
  const arc = (x1, y1, x2, y2, below) => {
    const dir = below ? 1 : -1;
    const span = Math.abs(x2 - x1);
    const h = Math.min(16, 6 + span * 0.06) * dir;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2 + h;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.quadraticCurveTo(cx, cy + 2.2 * dir, x1, y1);
    ctx.closePath();
    ctx.fill();
  };
  for (const members of groups.values()) {
    const byLine = new Map();
    for (const gi of members) { const li = lineOf.get(gi); if (!byLine.has(li)) byLine.set(li, []); byLine.get(li).push(gi); }
    const firstGi = members[0], lastGi = members[members.length - 1];
    for (const part of byLine.values()) {
      const opensHere = part.includes(firstGi);
      const closesHere = part.includes(lastGi);
      const a = noteObjs[part[0]], b = noteObjs[part[part.length - 1]];
      if (opensHere && closesHere) {
        if (part.length < 2) continue;
        new V.Curve(a, b, { cps: [{ x: 0, y: 12 }, { x: 0, y: 12 }] }).setContext(ctx).draw();
        continue;
      }
      // the side follows the first note of the whole slur: under the heads when its stem is up
      const below = noteObjs[firstGi].getStemDirection() === 1;
      const stave = staveOf[part[0]];
      const startX = stave.getNoteStartX() - 6;
      const endX = stave.getX() + stave.getWidth() - 4;
      const pa = headPoint(a, below), pb = headPoint(b, below);
      if (opensHere) arc(pa.x, pa.y, endX, pb.y + (below ? 4 : -4), below);           // runs off the end of the line
      else if (closesHere) arc(startX, pa.y + (below ? 4 : -4), pb.x, pb.y, below);   // comes in from the start
      else arc(startX, pa.y, endX, pb.y, below);                                     // a whole line inside the slur
    }
  }

  // arrow targets and colourable elements, per event
  const targets = [];
  glyphs.forEach((g, gi) => {
    if (g.kind !== 'note') return;
    const note = noteObjs[gi];
    const stave = staveOf[gi];
    const x = note.getAbsoluteX() + note.getGlyphWidth() / 2;
    const ys = note.getYs();
    let top = Math.min(stave.getYForLine(0), ...ys);
    if (note.getStemDirection && note.getStemDirection() === 1 && note.hasStem()) top = Math.min(top, Math.min(...ys) - 35);
    targets[g.eventIndex] = { x, y: top - 8, el: note.getSVGElement ? note.getSVGElement() : null };
  });
  return { arrowTargets: targets };
}

/** Add a CSS state class to a rendered event's note. */
export function markNote(targets, eventIndex, cls) {
  const t = targets && targets[eventIndex];
  if (!t || !t.el) return;
  t.el.classList.remove('n-good', 'n-ok', 'n-bad', 'n-missing');
  if (cls) t.el.classList.add(cls);
}
