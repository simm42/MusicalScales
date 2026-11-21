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
 * @param {number} [o.scale] draw smaller (0.5 = half size, so twice as much fits across) –
 *   TV mode. Positions returned (arrow, bars) are in the page's pixels either way.
 */
export function renderScore(container, exercise, seq, { clefMode = 'change', compact = false, syllables = null, scale = 1 } = {}) {
  container.innerHTML = '';
  const V = VF();
  const s = scale > 0 && scale < 1 ? scale : 1;
  // laid out as if the box were 1/s as wide, then shrunk to fit it
  const width = Math.max(200, Math.floor((container.clientWidth || 800) / s));
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
    const w = chunk.reduce((a, gi) => a + (GLYPH_W[glyphs[gi].dur] || 30) + (glyphs[gi].notes.some((n) => n.a) ? 8 : 0) + (glyphs[gi].shift ? 10 : 0), 0) + (piece ? 12 : 0);
    if (cur.length && used + w > width - 20) { lines.push(cur); lineUsed.push(used); cur = []; used = startW; }
    cur.push(...chunk);
    used += w;
    i = j + 1;
  }
  if (cur.length) { lines.push(cur); lineUsed.push(used); }

  // a treble clef with a small 8 below (tenor voice: sung an octave lower)
  const homeAnn = exercise.info.clefAnnotation || undefined;
  const annFor = (c) => (c === exercise.info.clef ? homeAnn : undefined);

  // Each line gets the room its own music needs: notes high above or low below the stave
  // (ledger lines), stems, fingering, slurs, dots and sol-fa syllables – music close to the
  // stave packs tightly, so more lines fit on a phone. compact: a little tighter still.
  const { topLine, height } = lineLayout(lines, glyphs, clefs, { compact, syllables: !!syllables, clefAnnotation: !!homeAnn });
  const ctx = newRenderer(container, width, height);
  const pencil = getComputedStyle(container).getPropertyValue('--score-pencil').trim() || '#8f8a99';

  const noteObjs = new Array(glyphs.length);
  const staveOf = new Array(glyphs.length);
  const staves = [];

  lines.forEach((line, li) => {
    const y = topLine[li] - 4 * SP; // a stave's box starts four spaces above its top line
    const isLast = li === lines.length - 1;
    // a short final line keeps natural spacing instead of stretching across the page
    const staveW = isLast && lines.length > 1 ? Math.min(width - 12, Math.max(lineUsed[li] * 1.1 + 20, 200)) : width - 12;
    const stave = new V.Stave(5, y, staveW);
    staves[li] = stave;
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
    const withAcc = new Set(); // notes drawn with an accidental (a position-change line goes further left)
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
        g.notes.forEach((n, k) => { const a = accFor(n); if (a) { note.addModifier(new V.Accidental(a), k); withAcc.add(gi); } });
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

    // position changes: a light, pencilled slash just before the note, leaning about 7.5° from
    // upright, from two spaces below the stave to two spaces above it
    for (const gi of line) {
      if (!glyphs[gi].shift || !noteObjs[gi]) continue;
      const note = noteObjs[gi];
      const x = note.getAbsoluteX() - (withAcc.has(gi) ? 16 : 6);
      const yTop = stave.getYForLine(0) - 2 * SP, yBot = stave.getYForLine(4) + 2 * SP;
      const dx = (yBot - yTop) * Math.tan((7.5 * Math.PI) / 180);
      ctx.save();
      ctx.setStrokeStyle(pencil);
      ctx.setLineWidth(1.6);
      if (ctx.setLineCap) ctx.setLineCap('round');
      ctx.beginPath();
      ctx.moveTo(x - dx / 2, yBot);
      ctx.lineTo(x + dx / 2, yTop);
      ctx.stroke();
      ctx.restore();
    }
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

  // every note and rest (the arrow goes over rests too) and, in a piece, each bar's area
  // on the page (to choose a section by tapping or dragging across bars)
  const glyphTargets = [];
  const barBoxes = [];
  lines.forEach((line, li) => {
    const stave = staves[li];
    for (const gi of line) {
      const note = noteObjs[gi];
      if (!note) continue;
      const ys = note.getYs ? note.getYs() : [stave.getYForLine(0)];
      glyphTargets[gi] = { x: note.getAbsoluteX() + note.getGlyphWidth() / 2, y: Math.min(stave.getYForLine(0), ...ys) - 8, ys: ys.slice(), line: li, staveEnd: stave.getX() + stave.getWidth() - 6 };
    }
    if (!piece) return;
    const barsHere = [...new Set(line.map((gi) => glyphs[gi].stepIndex))];
    const xsOf = (b) => line.filter((gi) => glyphs[gi].stepIndex === b && glyphTargets[gi]).map((gi) => glyphTargets[gi].x);
    barsHere.forEach((b, k) => {
      const xs = xsOf(b);
      const prev = k > 0 ? xsOf(barsHere[k - 1]) : null, next = k < barsHere.length - 1 ? xsOf(barsHere[k + 1]) : null;
      const x0 = prev ? (Math.max(...prev) + Math.min(...xs)) / 2 + 4 : stave.getNoteStartX() - 6;
      const x1 = next ? (Math.max(...xs) + Math.min(...next)) / 2 + 4 : stave.getX() + stave.getWidth();
      barBoxes[b] = { x0, x1, y0: stave.getYForLine(0) - 26, y1: stave.getYForLine(4) + 22, line: li };
    });
  });

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
  if (s !== 1) {
    // shrink the drawing; positions given back follow it
    const svg = container.querySelector('svg');
    if (svg) {
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('width', String(Math.round(width * s)));
      svg.setAttribute('height', String(Math.round(height * s)));
      svg.style.width = `${Math.round(width * s)}px`;
      svg.style.height = `${Math.round(height * s)}px`;
    }
    for (const t of targets) if (t) { t.x *= s; t.y *= s; }
    for (const t of glyphTargets) if (t) { t.x *= s; t.y *= s; t.staveEnd *= s; t.ys = t.ys.map((v) => v * s); }
    for (const b of barBoxes) if (b) { b.x0 *= s; b.x1 *= s; b.y0 *= s; b.y1 *= s; }
  }
  return { arrowTargets: targets, glyphTargets, barBoxes };
}

// ---------------------------------------------------------------- spacing between lines of music

const SP = 10; // VexFlow's space between two stave lines
// the diatonic step (7 × octave + letter) that sits on VexFlow's line 0 for each clef
const CLEF_BASE = { treble: 28, bass: 16, alto: 22, tenor: 20, percussion: 28 };

/** A note's place on the stave: 1 = bottom line, 3 = middle line, 5 = top line (halves are spaces). */
export function staveLineOf(n, clef) {
  return (7 * n.o + n.l - (CLEF_BASE[clef] ?? 28)) / 2;
}

/**
 * Where each line's top stave line goes, and the height of the whole score.
 * Room above a line: its highest note (or stem), the follow arrow, fingering, slurs and
 * tuplet numbers. Room below: its lowest note (or stem), dots and slurs under the notes,
 * the 8 under a tenor's clef and sol-fa syllables. Lines are never closer than a minimum.
 */
export function lineLayout(lines, glyphs, clefs, { compact = false, syllables = false, clefAnnotation = false } = {}) {
  const midOf = (gi) => {
    const ls = glyphs[gi].notes.map((n) => staveLineOf(n, clefs[gi]));
    return (Math.min(...ls) + Math.max(...ls)) / 2;
  };
  const extents = lines.map((line) => {
    // stems follow VexFlow's rule (middle of the chord below the middle line: stem up);
    // beamed notes share one direction, from the average of the group
    const groups = new Map();
    for (const gi of line) {
      const g = glyphs[gi];
      if (g.kind !== 'note' || g.beamGroup == null) continue;
      const e = groups.get(g.beamGroup) || { sum: 0, n: 0 };
      e.sum += midOf(gi); e.n += 1;
      groups.set(g.beamGroup, e);
    }
    let top = 0, bottom = 4 * SP; // the stave itself, measured down from its top line
    let finger = false, slur = false, tuplet = false, dots = false;
    for (const gi of line) {
      const g = glyphs[gi];
      if (g.kind !== 'note' || !g.notes.length) continue;
      const ls = g.notes.map((n) => staveLineOf(n, clefs[gi]));
      const hi = Math.max(...ls), lo = Math.min(...ls);
      const grp = g.beamGroup != null && groups.get(g.beamGroup);
      const stemUp = (grp && grp.n > 1 ? grp.sum / grp.n : (hi + lo) / 2) < 3;
      const yHi = (5 - hi) * SP, yLo = (5 - lo) * SP;
      const acc = g.notes.some((n) => n.a);
      top = Math.min(top, stemUp ? yHi - 35 : yHi - (acc ? 14 : 6));
      bottom = Math.max(bottom, stemUp ? yLo + 6 : yLo + 35);
      if (g.notes.some((n) => n.f != null)) finger = true;
      if (g.slurGroup != null) slur = true;
      if (g.tuplet) tuplet = true;
      if (g.articulation) dots = true;
      // a position-change line reaches two spaces beyond the stave either side
      if (g.shift) { top = Math.min(top, -2 * SP - 4); bottom = Math.max(bottom, 6 * SP + 4); }
    }
    const above = -top + 22 + (finger ? 14 : 0) + (slur || tuplet ? 10 : 0);
    let below = bottom - 4 * SP + 8 + (slur || dots ? 8 : 0) + (clefAnnotation ? 10 : 0);
    if (syllables) below = Math.max(below, Math.max(26, bottom - 4 * SP + 20) + 8);
    return { above, below };
  });
  const PAD = 6;
  const minStep = compact ? 76 : 86; // top line to top line, at least
  const topLine = [];
  extents.forEach((e, li) => {
    topLine.push(li === 0 ? PAD + e.above
      : Math.max(topLine[li - 1] + 4 * SP + extents[li - 1].below + e.above, topLine[li - 1] + minStep));
  });
  const last = extents.length - 1;
  const height = Math.ceil(last < 0 ? 60 : topLine[last] + 4 * SP + extents[last].below + PAD);
  return { topLine, height, extents };
}

/** Add a CSS state class to a rendered event's note. */
export function markNote(targets, eventIndex, cls) {
  const t = targets && targets[eventIndex];
  if (!t || !t.el) return;
  t.el.classList.remove('n-good', 'n-ok', 'n-bad', 'n-missing');
  if (cls) t.el.classList.add(cls);
}
