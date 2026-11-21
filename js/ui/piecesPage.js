// Pieces tab: saved pieces of music to practise with the arrow and tuner bar.
// A list, an editor (text on one side, the score drawn as you type), joining
// two pieces, and turning a photo into a piece with Claude.

import { parsePiece, extractPieceText } from '../pieceText.js';
import { loadPieces, savePieces, newPiece, joinPieces, pieceExercise, AI_PROMPT, fixPrompt, STARTER, claudeLink, pieceShareLink, readPieceShare, addSharedPiece } from '../pieces.js';
import { instrumentInfo } from '../instruments.js';
import { renderScore } from '../notation.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));


const FORMAT_HELP = `
<table class="fmt">
<tr><td><code>T: Title</code> <code>C: Composer</code></td><td>name and composer</td></tr>
<tr><td><code>M: 3/4</code></td><td>time signature</td></tr>
<tr><td><code>L: 1/8</code></td><td>note length 1 = a quaver (eighth)</td></tr>
<tr><td><code>Q: 1/4=96</code></td><td>tempo (crotchets a minute)</td></tr>
<tr><td><code>K: G</code> <code>K: Em</code> <code>K: D clef=bass</code></td><td>key (and clef) – the last header line</td></tr>
<tr><td><code>C D E F G A B c d e …</code></td><td>notes: capitals = from middle C up; small = the octave above</td></tr>
<tr><td><code>C,</code> &nbsp; <code>c'</code></td><td><code>,</code> an octave lower, <code>'</code> an octave higher</td></tr>
<tr><td><code>^F</code> <code>_B</code> <code>=F</code></td><td>sharp, flat, natural (to the end of the bar)</td></tr>
<tr><td><code>A</code> <code>A2</code> <code>A3</code> <code>A4</code> <code>A/2</code></td><td>quaver, crotchet, dotted crotchet, minim, semiquaver</td></tr>
<tr><td><code>z2</code></td><td>a crotchet rest</td></tr>
<tr><td><code>|</code> <code>|]</code></td><td>bar line, final bar line</td></tr>
<tr><td><code>A2-A2</code> &nbsp; <code>(ABc)</code> &nbsp; <code>(3ABc</code> &nbsp; <code>[DA]</code></td><td>tie, slur, triplet, two notes together</td></tr>
<tr><td><code>.A2</code> &nbsp; <code>!tenuto!A2</code> &nbsp; <code>(.A2 .A2)</code></td><td>staccato dot, tenuto line; under a slur, a short gap in the same bow</td></tr>
<tr><td><code>!0!A2</code> &nbsp; <code>!3!A2</code> &nbsp; <code>[!1!D!3!A]</code></td><td>fingering (0 = open string), shown above the note</td></tr>
<tr><td><code>% a note to yourself</code></td><td>a comment (ignored)</td></tr>
</table>`;

export class PiecesPage {
  constructor({ root, getInstrument, onPractise, onDeleted = () => {}, hasResults = () => false }) {
    this.root = root;
    this.getInstrument = getInstrument;
    this.onPractise = onPractise;
    this.onDeleted = onDeleted;
    this.hasResults = hasResults;
    this.view = 'list';
  }

  pieces() { return loadPieces(); }
  /** Off to the Practice page; coming back to the tab shows the list. */
  practise(p) { this.view = 'list'; this.onPractise(p); }
  store(list) { savePieces(list); }

  show() { if (this.view === 'list') this.list(); }

  /** Leaving the tab with unsaved changes in the editor: they stay as a draft until the tab is opened again. */
  leave() {}

  wire(actions, el = this.root) {
    el.querySelectorAll('[data-act]').forEach((b) => {
      const fn = actions[b.dataset.act];
      if (fn) b.addEventListener('click', (e) => fn(e, b));
    });
  }

  // ---------------------------------------------------------------- list
  list() {
    this.view = 'list';
    const list = this.pieces().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const card = (p) => {
      const P = parsePiece(p.text);
      const notes = P.tokens.filter((t) => t.kind === 'note').length;
      const bars = P.tokens.filter((t) => t.kind === 'bar').length;
      const info = P.ok ? `${esc(P.key.name)} · ${esc(P.meter ? P.meter.text : 'free time')} · ${bars} bar${bars === 1 ? '' : 's'} · ${notes} notes` : '<span class="bad">needs fixing – open it to see what</span>';
      return `<li class="piece" data-id="${esc(p.id)}">
        <div class="piece-main"><b>${esc(p.name)}</b><span class="muted small">${info}</span></div>
        <div class="piece-acts">
          <button type="button" class="btn primary" data-act="practise" ${P.ok ? '' : 'disabled'}>▶ Practise</button>
          <button type="button" class="btn" data-act="edit" title="Edit">✎ Edit</button>
          <button type="button" class="btn" data-act="share" title="Send a link to this piece">🔗 Share</button>
          <button type="button" class="btn" data-act="copy" title="Make a copy">⧉</button>
          <button type="button" class="btn" data-act="delete" title="Delete" aria-label="Delete">🗑</button>
        </div>
        <div class="piece-share" hidden></div></li>`;
    };
    this.root.innerHTML = `
      <h2>Pieces</h2>
      <div id="pcFlash"></div>
      <p class="muted">Any music to practise with the arrow, the tuner bar and scoring – saved on this device, so you can take your music with you.</p>
      <div class="row">
        <button type="button" class="btn primary" data-act="new">＋ New piece</button>
        <button type="button" class="btn" data-act="photo">📷 Decode music from a photo</button>
        <button type="button" class="btn" data-act="join" ${list.length >= 2 ? '' : 'disabled'} title="Join two pieces into one">⧉ Join two pieces</button>
        <button type="button" class="btn" data-act="paste" title="Add a piece someone sent you as a link">📥 Paste a shared link</button>
      </div>
      ${list.length ? `<ul class="pieces">${list.map(card).join('')}</ul>` : '<p class="empty">No pieces yet. Start a <b>new piece</b> and type the music, or <b>decode a photo</b> of sheet music with Claude.</p>'}
      <p class="small muted">For simple music for one instrument: one line of music (with double stops). Pieces with a piano or other accompaniment work too – only the top part is used. Orchestral scores, piano music for two hands and other multi-part music can't be practised here.</p>`;
    this.wire({
      new: () => this.edit(newPiece('My piece', STARTER), true),
      photo: () => this.photo(),
      join: () => this.join(),
      paste: () => this.pasteLink(),
    });
    this.root.querySelectorAll('.piece').forEach((li) => {
      const p = list.find((x) => x.id === li.dataset.id);
      this.wire({
        practise: () => this.practise(p),
        edit: () => this.edit(p),
        share: () => this.share(p, li),
        copy: () => { const c = newPiece(`${p.name} (copy)`, p.text); this.store([...this.pieces(), c]); this.list(); },
        delete: () => {
          if (!confirm(`Delete “${p.name}”${this.hasResults(p.id) ? ' and its results' : ''}? This can't be undone.`)) return;
          this.store(this.pieces().filter((x) => x.id !== p.id));
          this.onDeleted(p.id);
          this.list();
        },
      }, li);
    });
  }

  /** A link that adds this piece to someone else's pieces when they open it. */
  async share(p, li) {
    const box = li.querySelector('.piece-share');
    const url = pieceShareLink(p, location.origin + location.pathname);
    let how = '';
    // phones: the share sheet (Messages, WhatsApp, email…); otherwise copy the link
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.share) {
      try { await navigator.share({ title: p.name, text: `“${p.name}” – a piece to practise in Scale Practice. Open the link to add it to your pieces:`, url }); how = 'Shared.'; }
      catch (e) { if (e && e.name === 'AbortError') how = ''; }
    }
    if (!how) { try { await navigator.clipboard.writeText(url); how = 'Link copied – paste it into a message.'; } catch { how = 'Copy this link and send it:'; } }
    box.innerHTML = `<p class="small">${esc(how)} Whoever opens it gets “${esc(p.name)}” added to their pieces.</p>
      <input type="text" readonly value="${esc(url)}" aria-label="Link to this piece">
      <p class="small share-warning">⚠ Only share music you are allowed to share. Most published sheet music is protected by copyright – don't use these links to pass on copies of it. Share your own music, music that is out of copyright, or music you have permission to share. You are responsible for what you send.</p>`;
    box.hidden = false;
    box.querySelector('input').addEventListener('click', (e) => e.target.select());
  }

  /** A shared link pasted in (e.g. on iPhone, where a link opens in Safari, not the Home Screen app). */
  pasteLink() {
    const el = this.root.querySelector('#pcFlash');
    el.innerHTML = `<div class="notice"><label for="pcLink">Paste the link someone sent you:</label>
      <input type="text" id="pcLink" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…#piece=…" style="width:100%;box-sizing:border-box;margin:6px 0">
      <div class="row"><button type="button" class="btn primary" data-act="add">Add the piece</button> <button type="button" class="btn" data-act="cancel">Cancel</button></div></div>`;
    el.querySelector('#pcLink').focus();
    this.wire({
      add: () => {
        const m = /piece=([A-Za-z0-9_-]+)/.exec(el.querySelector('#pcLink').value);
        if (!m) { el.querySelector('label').textContent = 'That isn’t a link to a piece – paste the whole link:'; return; }
        let result;
        try { result = { ok: true, ...addSharedPiece(readPieceShare(m[1])) }; } catch { result = { ok: false }; }
        this.sharedArrived(result);
      },
      cancel: () => { el.innerHTML = ''; },
    }, el);
  }

  /** After opening a shared link: say what happened (the list is shown). */
  sharedArrived({ ok, piece, added }) {
    this.list();
    const el = this.root.querySelector('#pcFlash');
    if (!ok) { el.innerHTML = '<p class="notice error">The shared piece could not be read – the link may have been cut short when it was sent. Ask for it again.</p>'; return; }
    el.innerHTML = `<div class="notice"><p>${added ? `Added “${esc(piece.name)}” from a shared link.` : `“${esc(piece.name)}” from the shared link is already in your pieces.`}</p>
      <div class="row"><button type="button" class="btn primary" data-act="practise">▶ Practise it</button> <button type="button" class="btn" data-act="edit">✎ Look at it</button></div></div>`;
    this.wire({ practise: () => this.practise(piece), edit: () => this.edit(piece) }, el);
  }

  // ---------------------------------------------------------------- editor
  edit(piece, isNew = false) {
    this.view = 'edit';
    const draft = { ...piece };
    this.root.innerHTML = `
      <div class="game-head"><button type="button" class="btn" data-act="back">← Pieces</button><b>${isNew ? 'New piece' : 'Edit piece'}</b></div>
      <div class="field"><label for="pcName">Name</label><input type="text" id="pcName" maxlength="120" value="${esc(draft.name)}"></div>
      <div class="piece-edit">
        <div class="piece-text">
          <label for="pcText" class="small muted">The music (as text) – the score below follows as you type</label>
          <textarea id="pcText" spellcheck="false" autocapitalize="off" autocomplete="off" rows="14">${esc(draft.text)}</textarea>
          <details class="small"><summary>How to write the music</summary>${FORMAT_HELP}</details>
        </div>
        <div class="piece-preview">
          <ul class="piece-problems" id="pcProblems"></ul>
          <div id="pcScore" class="piece-score"></div>
        </div>
      </div>
      <div class="row">
        <button type="button" class="btn primary" data-act="save">Save</button>
        <button type="button" class="btn" data-act="practise">▶ Save and practise</button>
        <button type="button" class="btn" data-act="back">Cancel</button>
      </div>
      <p class="muted small" id="pcMsg" role="status"></p>`;
    const ta = this.root.querySelector('#pcText');
    const name = this.root.querySelector('#pcName');
    let timer = null;
    const refresh = () => { draft.text = ta.value; this.preview(draft); };
    ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refresh, 350); });
    refresh();
    const save = () => {
      draft.text = ta.value;
      draft.name = name.value.trim() || parsePiece(draft.text).title || 'Untitled';
      draft.updated = Date.now();
      const list = this.pieces();
      const i = list.findIndex((x) => x.id === draft.id);
      if (i >= 0) list[i] = draft; else list.push(draft);
      this.store(list);
      return draft;
    };
    const changed = () => ta.value !== piece.text || name.value.trim() !== piece.name;
    this.wire({
      back: () => { if (!changed() || isNew === 'saved' || confirm('Leave without saving your changes?')) this.list(); },
      save: () => { save(); isNew = 'saved'; piece = { ...draft }; this.root.querySelector('#pcMsg').textContent = `Saved “${draft.name}”.`; },
      practise: () => { const p = save(); if (parsePiece(p.text).ok) this.practise(p); else this.root.querySelector('#pcMsg').textContent = 'Saved – but fix the problems shown before practising.'; },
    });
    this.problemsEl = this.root.querySelector('#pcProblems');
    this.problemsEl.addEventListener('click', (e) => {
      const li = e.target.closest('[data-line]');
      if (li) selectLine(ta, Number(li.dataset.line));
    });
  }

  /** Draw the score and list any problems. */
  preview(piece) {
    const el = this.root.querySelector('#pcScore');
    const probs = this.root.querySelector('#pcProblems');
    if (!el) return;
    const info = instrumentInfo(this.getInstrument());
    const { exercise, seq, parsed } = pieceExercise(piece, info, {});
    const items = [
      ...parsed.errors.map((e) => `<li class="bad" data-line="${e.line}"><b>Line ${e.line}</b>, column ${e.col}: ${esc(e.message)}</li>`),
      ...parsed.warnings.map((w) => `<li class="${w.check ? 'warn' : 'muted'}" data-line="${w.line}">Line ${w.line}: ${esc(w.message)}</li>`),
    ];
    if (exercise.outside) items.push(`<li class="muted">${exercise.outside} note${exercise.outside === 1 ? ' is' : 's are'} outside the range of the ${esc(info.name.toLowerCase())}.</li>`);
    probs.innerHTML = items.join('');
    if (!seq.events.length || !window.Vex) { el.innerHTML = ''; return; }
    try { renderScore(el, exercise, seq, { clefMode: 'home' }); } catch (err) { console.error(err); el.innerHTML = '<p class="notice error">The score could not be drawn – check the music text.</p>'; }
  }

  // ---------------------------------------------------------------- join A + B
  join() {
    this.view = 'join';
    const list = this.pieces();
    const opts = (sel) => list.map((p, i) => `<option value="${esc(p.id)}" ${i === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    this.root.innerHTML = `
      <div class="game-head"><button type="button" class="btn" data-act="back">← Pieces</button><b>Join two pieces</b></div>
      <p class="muted">Makes a new piece: the first, then the second – their own keys and time signatures are kept. You can edit the joined piece like any other; the two originals stay as they are.</p>
      <div class="field"><label for="jA">First</label><select id="jA">${opts(0)}</select></div>
      <div class="field"><label for="jB">Then</label><select id="jB">${opts(1)}</select></div>
      <div class="row"><button type="button" class="btn primary" data-act="join">⧉ Join</button></div>`;
    this.wire({
      back: () => this.list(),
      join: () => {
        const a = list.find((p) => p.id === this.root.querySelector('#jA').value);
        const b = list.find((p) => p.id === this.root.querySelector('#jB').value);
        const j = joinPieces(a, b);
        this.store([...this.pieces(), j]);
        this.edit(j);
      },
    });
  }

  // ---------------------------------------------------------------- from a photo, with Claude
  photo() {
    this.view = 'photo';
    this.root.innerHTML = `
      <div class="game-head"><button type="button" class="btn" data-act="back">← Pieces</button><b>Decode music from a photo</b></div>
      <p>Claude (an AI assistant) reads a photo of your music and writes it as text; you paste that text back here. You need a Claude account.</p>
      <div class="notice photo-why">
        <b>Why you do this step yourself:</b> reading a photo needs an AI service, and those cost money to run. Doing it in Claude yourself keeps Scale Practice free.<br>
        <b>Copyright:</b> sheet music is usually protected by copyright. You are responsible for the music you photograph and decode this way – only use music you are allowed to copy, such as your own copy, for your own practice. Your photo goes to Claude, not to Scale Practice.
      </div>
      <ol class="photo-steps">
        <li><b>Open Claude</b> – it opens in a new window with the instructions already filled in. Sign in if asked, then send the instructions; Claude asks for a photo – take one with your camera or choose one from your photos. Hold the phone straight above the page, in good light, one page at a time.
          <div class="row"><button type="button" class="btn primary" data-act="open">🎼 Decode music with Claude</button></div>
          <p class="small"><b>Use Sonnet or Opus:</b> before you send, choose one of them in Claude's model menu if it's available – they read music more accurately than the smaller models.</p>
          <p class="small">The instructions didn't appear in Claude? Copy them and paste them into a new Claude chat yourself:</p>
          <div class="row"><button type="button" class="btn" data-act="copy">📋 Copy the instructions</button> <span class="small muted" id="phCopied" role="status"></span></div>
          <details class="small"><summary>Show the instructions</summary>
            <pre class="prompt-text">${esc(AI_PROMPT)}</pre></details>
        </li>
        <li><b>Copy Claude's answer</b> (tap Copy on the box it writes the music in), come back here and paste it below.
          <textarea id="phAnswer" rows="8" spellcheck="false" autocapitalize="off" placeholder="Paste the answer here"></textarea>
          <div class="row"><button type="button" class="btn primary" data-act="read">Read the music</button></div>
          <div id="phResult"></div>
        </li>
      </ol>
      <p class="small muted">Works best for simple music for one instrument. With a piano or other accompaniment, only the top part of each group of staves is used. Always check the result against your music – Claude can misread notes; you can correct anything in the editor.</p>`;
    this.wire({
      back: () => this.list(),
      open: () => { window.open(claudeLink(), '_blank', 'noopener'); },
      copy: async () => { this.root.querySelector('#phCopied').textContent = (await copyText(AI_PROMPT)) ? 'Copied – now paste it into a new Claude chat.' : 'Select the instructions below and copy them.'; },
      read: () => this.readAnswer(),
    });
  }

  readAnswer() {
    const raw = this.root.querySelector('#phAnswer').value;
    const out = this.root.querySelector('#phResult');
    const text = extractPieceText(raw);
    if (!text.trim()) { out.innerHTML = '<p class="bad">Paste Claude’s answer first.</p>'; return; }
    if (/^\s*%\s*not readable/i.test(text)) { out.innerHTML = `<p class="bad">Claude could not read the photo: ${esc(text.replace(/^\s*%\s*/, ''))}. Try a clearer photo.</p>`; return; }
    const P = parsePiece(text);
    const notes = P.tokens.filter((t) => t.kind === 'note').length;
    const checks = P.warnings.filter((w) => w.check);
    if (P.ok && checks.length) {
      const piece = newPiece(P.title || 'Untitled', text + '\n');
      out.innerHTML = `<p class="warn">Read “${esc(piece.name)}”: ${notes} notes – but ${checks.length === 1 ? 'something looks' : `${checks.length} things look`} wrong:</p>
        <ul class="piece-problems">${checks.map((w) => `<li>${esc(w.message)}.</li>`).join('')}</ul>
        <p class="small">Send Claude a correction request (paste it into the same conversation), or check it yourself in the editor.</p>
        <div class="row"><button type="button" class="btn primary" data-act="fix">📋 Copy a correction request</button>
          <button type="button" class="btn" data-act="open">Open in the editor</button> <span class="small muted" id="phFixCopied" role="status"></span></div>`;
      this.wire({
        fix: async () => { this.root.querySelector('#phFixCopied').textContent = (await copyText(fixPrompt(checks))) ? 'Copied – paste it into the same Claude chat.' : ''; },
        open: () => this.edit(piece, true),
      }, out);
      return;
    }
    if (P.ok) {
      const piece = newPiece(P.title || 'Untitled', text + '\n');
      out.innerHTML = `<p class="good">✓ Read “${esc(piece.name)}”: ${notes} notes. Check it against your music in the editor, then save it.</p>
        <div class="row"><button type="button" class="btn primary" data-act="open">Open in the editor</button></div>`;
      this.wire({ open: () => this.edit(piece, true) }, out);
      return;
    }
    const piece = newPiece(P.title || 'Untitled', text + '\n');
    out.innerHTML = `<p class="bad">The answer has ${P.errors.length} problem${P.errors.length === 1 ? '' : 's'}:</p>
      <ul class="piece-problems">${P.errors.slice(0, 8).map((e) => `<li class="bad">Line ${e.line}, column ${e.col}: ${esc(e.message)}</li>`).join('')}</ul>
      <p class="small">Send Claude a correction request (paste it into the same conversation), or fix it yourself in the editor.</p>
      <div class="row"><button type="button" class="btn primary" data-act="fix">📋 Copy a correction request</button>
        <button type="button" class="btn" data-act="open">Fix it myself</button> <span class="small muted" id="phFixCopied" role="status"></span></div>`;
    this.wire({
      fix: async () => { this.root.querySelector('#phFixCopied').textContent = (await copyText(fixPrompt(P.errors))) ? 'Copied – paste it into the same Claude chat.' : ''; },
      open: () => this.edit(piece, true),
    }, out);
  }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function selectLine(ta, line) {
  const lines = ta.value.split('\n');
  let start = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
  ta.focus();
  ta.setSelectionRange(start, start + (lines[line - 1] || '').length);
}
