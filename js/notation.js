// Score rendering with VexFlow (loaded as a classic script: window.Vex).

import { assignClefs } from './instruments.js';
import { vexKeySpec, keySigAccidental, LETTERS, midiOf } from './theory.js';

const VF = () => window.Vex.Flow;
const ACC_SYM = { '-2': 'bb', '-1': 'b', 0: 'n', 1: '#', 2: '##' };
const REST_KEY = { treble: 'b/4', alto: 'c/4', tenor: 'a/3', bass: 'd/3' };
const GLYPH_W = { w: 54, hd: 50, h: 46, qd: 40, q: 36, '8d': 34, 8: 30, '16d': 30, 16: 27, 32: 25 };

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
  stave.addClef(exercise.info.clef, 'default', exercise.info.clefAnnotation || undefined);
  if (exercise.fifths) stave.addKeySignature(vexKeySpec(exercise.fifths));
  stave.setEndBarType(V.Barline.type.NONE);
  stave.setContext(ctx).draw();
  return { arrowTargets: [] };
}

/**
 * Full score. Returns positions for the follow arrow and an element per event
 * for colouring notes after scoring.
 * @param {(note)=>string|null} [o.syllables] sol-fa syllable shown under each note (singing)
 */
export function renderScore(container, exercise, seq, { clefMode = 'change', compact = false, syllables = null } = {}) {
  container.innerHTML = '';
  const V = VF();
  const width = Math.max(200, Math.floor(container.clientWidth || 800));
  const glyphs = seq.glyphs;

  // A piece (pieces.js) carries its own clef, key and bars on each glyph; its
  // lines break only between bars (stepIndex = bar number).
  const piece = !!exercise.isPiece;
  let clefs;
  if (piece) clefs = glyphs.map((g) => g.clef || exercise.info.clef);
  else {
    // clef per step (a step's repeated quavers/rests share its clef)
    const stepIds = [...new Set(glyphs.map((g) => g.stepIndex))];
    const stepMidi = stepIds.map((si) => midiOf(glyphs.find((g) => g.stepIndex === si).notes[0]));
    const stepClef = new Map(assignClefs(exercise.info.id, stepMidi, clefMode).map((c, k) => [stepIds[k], c]));
    clefs = glyphs.map((g) => stepClef.get(g.stepIndex));
  }
  const fifthsOf = (gi) => (piece && glyphs[gi].fifths != null ? glyphs[gi].fifths : exercise.fifths);

  // line breaking at step boundaries
  const keyW = 11 * Math.max(Math.abs(exercise.fifths), ...(piece ? glyphs.map((g) => Math.abs(g.fifths || 0)) : [0]));
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
    const w = chunk.reduce((a, gi) => a + (GLYPH_W[glyphs[gi].dur] || 30) + (glyphs[gi].notes.some((n) => n.a) ? 8 : 0), 0) + (piece ? 12 : 0);
    if (cur.length && used + w > width - 20) { lines.push(cur); lineUsed.push(used); cur = []; used = startW; }
    cur.push(...chunk);
    used += w;
    i = j + 1;
  }
  if (cur.length) { lines.push(cur); lineUsed.push(used); }

  // compact: tighter line spacing for short (landscape phone) screens
  const lineH = (clefMode === 'change' ? (compact ? 108 : 130) : (compact ? 140 : 170)) + (syllables ? 22 : 0);
  // a treble clef with a small 8 below (tenor voice: sung an octave lower)
  const homeAnn = exercise.info.clefAnnotation || undefined;
  const annFor = (c) => (c === exercise.info.clef ? homeAnn : undefined);
  const topPad = clefMode === 'change' ? (compact ? 34 : 40) : (compact ? 56 : 70);
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
    const lineFifths = fifthsOf(line[0]);
    stave.addClef(lineClef, 'default', annFor(lineClef));
    if (lineFifths) stave.addKeySignature(vexKeySpec(lineFifths));
    if (piece && li === 0 && exercise.meterText) stave.addTimeSignature(exercise.meterText);
    stave.setEndBarType(li === lines.length - 1 ? V.Barline.type.END : V.Barline.type.SINGLE);
    stave.setContext(ctx).draw();

    // accidental state per letter+octave, reset each line (and, in a piece, each bar)
    let state = {};
    let fifths = lineFifths;
    const accFor = (n) => {
      const key = n.l + ':' + n.o;
      const curAcc = key in state ? state[key] : keySigAccidental(fifths, n.l);
      state[key] = n.a;
      return curAcc === n.a ? null : ACC_SYM[String(n.a)];
    };

    const tickables = [];
    let clef = lineClef;
    for (const gi of line) {
      const g = glyphs[gi];
      if (piece && g.keyChange != null && gi !== line[0]) {
        tickables.push(new V.KeySigNote(vexKeySpec(g.keyChange), vexKeySpec(fifths)));
        fifths = g.keyChange;
        state = {};
      }
      if (clefs[gi] !== clef) { clef = clefs[gi]; tickables.push(new V.ClefNote(clef, 'small', annFor(clef))); }
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
      // a bar line after it (not at the end of the line, where the stave ends anyway)
      if (piece && g.barAfter && gi !== line[line.length - 1]) {
        tickables.push(new V.BarNote(g.barAfter === '||' || g.barAfter === '|]' ? V.Barline.type.DOUBLE : V.Barline.type.SINGLE));
        state = {};
      }
    }
    // triplets and other tuplets (made before formatting, so the spacing allows for them)
    const tuplets = [];
    if (piece) {
      let run = [], tid = null;
      const end = () => { if (run.length > 1) { const t = glyphs[run[0]].tuplet; tuplets.push(new V.Tuplet(run.map((gi) => noteObjs[gi]), { num_notes: t.p, notes_occupied: t.q })); } run = []; };
      for (const gi of line) {
        const t = glyphs[gi].tuplet;
        if (t && t.id === tid) run.push(gi);
        else { end(); if (t) run = [gi]; }
        tid = t ? t.id : null;
      }
      end();
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
    // staccato dots and tenuto lines, on the notehead side (the stems are known once beamed)
    if (piece) {
      for (const gi of line) {
        const g = glyphs[gi];
        if (g.kind !== 'note' || !g.articulation) continue;
        const note = noteObjs[gi];
        const below = note.getStemDirection() === V.Stem.UP;
        note.addModifier(new V.Articulation(g.articulation === 'staccato' ? 'a.' : 'a-').setPosition(below ? V.Modifier.Position.BELOW : V.Modifier.Position.ABOVE), 0);
      }
      // fingering numbers above the note (as copied from the music – often chosen to practise a position)
      for (const gi of line) {
        const g = glyphs[gi];
        if (g.kind !== 'note' || g.tiedFrom) continue;
        // above the stave, as printed; in a double stop the upper note's finger on top
        g.notes.forEach((n, k) => {
          if (n.f == null) return;
          const a = new V.Annotation(String(n.f)).setVerticalJustification(V.Annotation.VerticalJustify.TOP);
          a.setFont('Arial', compact ? 10 : 12, 'bold');
          noteObjs[gi].addModifier(a, k);
        });
      }
    }

    new V.Formatter().joinVoices([voice]).format([voice], staveW + 5 - stave.getNoteStartX() - 25);
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());
    tuplets.forEach((t) => t.setContext(ctx).draw());
    // ties: to the next note on the same line, or running off the end of the line
    if (piece) {
      for (const gi of line) {
        const g = glyphs[gi];
        if (!g.tieNext || g.kind !== 'note') continue;
        const next = line.includes(gi + 1) ? noteObjs[gi + 1] : null;
        const idx = g.notes.map((_, k) => k);
        try { new V.StaveTie({ first_note: noteObjs[gi], last_note: next, first_indices: idx, last_indices: idx }).setContext(ctx).draw(); } catch { /* a tie that can't be drawn is left out */ }
      }
    }

    // sol-fa syllables on one line under the stave, like the words of a song
    if (syllables) {
      const notesHere = line.filter((gi) => glyphs[gi].kind === 'note');
      const lowest = Math.max(stave.getYForLine(4), ...notesHere.map((gi) => Math.max(...noteObjs[gi].getYs())));
      const y = Math.max(stave.getYForLine(4) + 26, lowest + 20);
      ctx.save();
      ctx.setFont('Arial', compact ? 11 : 13, 'normal', 'italic');
      for (const gi of notesHere) {
        const syl = syllables(glyphs[gi].notes[0]);
        if (!syl) continue;
        const note = noteObjs[gi];
        const w = ctx.measureText(syl).width;
        ctx.fillText(syl, note.getAbsoluteX() + note.getGlyphWidth() / 2 - w / 2, y);
      }
      ctx.restore();
    }
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
    if (g.kind !== 'note' || g.eventIndex == null) return; // (a tied continuation is not an event)
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
