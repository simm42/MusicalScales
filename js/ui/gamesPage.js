// Games tab: "Ear training" (listening, levels in ear.js) and "Sing the note" (singing).
// The rules are in games.js and ear.js; this is the screen, the sound and the microphone.

import {
  SING_LEVELS, GAME, singQuestion, HoldJudge,
  loadProgress, saveProgress, recordRound, isUnlocked, stars, rng,
} from '../games.js';
import { EAR_LEVELS, EAR_STAGES, earLevel, earQuestion, earStars, passFraction, answerRight, openStrings, shapeWords } from '../ear.js';
import { instrumentInfo, voiceSetup } from '../instruments.js';
import { noteName, spellMidi, freqToMidi } from '../theory.js';
import { Meter, fmtCents } from './meter.js';
import { MicError } from '../audio/mic.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
/** Ear training's own pass marks (Sing the note uses 70 % throughout). */
const EAR_RULES = { count: EAR_LEVELS.length, passOf: passFraction };

/** A few sounds as a little "sequence" the synthesiser can play: each { midis, beats, hold }. */
function seqOf(sounds) {
  const events = [], glyphs = [];
  sounds.forEach((s, i) => {
    glyphs.push({ beats: s.hold });
    events.push({ index: i, glyphIndex: i, beats: s.beats, midis: s.midis, slurred: false });
  });
  return { events, glyphs };
}

/** The key (if played) and/or notes, as sounds. */
function soundSeq(reference, notes) {
  return seqOf([
    ...reference.map((m, k) => ({ midis: [m], beats: k === reference.length - 1 ? (notes.length ? 2 : 1) : 0.5, hold: 0.45 })),
    ...notes.map((m) => ({ midis: [m], beats: 1.1, hold: 0.95 })),
  ]);
}

/** A tune's shape as a little picture: "udu" → a line going up, down, up. */
function shapeSvg(s) {
  const n = s.length + 1, w = 84, h = 44, pad = 8;
  let y = 0;
  const ys = [0, ...[...s].map((c) => (y += c === 'u' ? 1 : -1))];
  const mn = Math.min(...ys), mx = Math.max(...ys);
  const X = (i) => pad + ((w - 2 * pad) * i) / (n - 1);
  const Y = (v) => (mx === mn ? h / 2 : h - pad - ((h - 2 * pad) * (v - mn)) / (mx - mn));
  const pts = ys.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  return `<svg class="shape" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${ys.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="4" fill="currentColor"/>`).join('')}</svg>`;
}

export class GamesPage {
  constructor({ root, engine, player, getInstrument, getA4 }) {
    this.root = root;
    this.engine = engine;
    this.player = player;
    this.getInstrument = getInstrument;
    this.getA4 = getA4;
    this.progress = loadProgress();
    this.view = 'home';
    this.r = rng();
  }

  show() { if (this.view === 'home') this.home(); }

  /** Leaving the tab: stop any sound and the microphone. */
  stop() {
    this.player.stop();
    this.stopListening();
    this.view = 'home';
  }

  // ---------------------------------------------------------------- home
  home() {
    this.stop();
    this.progress = loadProgress();
    const singButtons = SING_LEVELS.map((L) => {
      const open = isUnlocked(this.progress, 'sing', L.id);
      const best = (this.progress.sing || { best: {} }).best[L.id];
      return `<button type="button" class="game-level" data-game="sing" data-level="${L.id}" ${open ? '' : 'disabled'}
        title="${esc(L.detail)}"><span class="lv">Level ${L.id}</span><span class="nm">${esc(L.label)}</span>
        <span class="st">${open ? (best != null ? `${starText(stars(best))} ${Math.round(best * 100)}%` : 'Not played yet') : '🔒 Score 70% on the level before'}</span></button>`;
    }).join('');
    const earButton = (L) => {
      const open = isUnlocked(this.progress, 'ear', L.id, passFraction);
      const best = (this.progress.ear || { best: {} }).best[L.id];
      const prev = L.id > 1 ? earLevel(L.id - 1) : null;
      return `<button type="button" class="game-level" data-game="ear" data-level="${L.id}" ${open ? '' : 'disabled'}
        title="${esc(L.how + ' ' + L.ask)}"><span class="lv">Level ${L.id}</span><span class="nm">${esc(L.title)}</span>
        <span class="st">${open ? (best != null ? `${starText(earStars(L.id, best))} ${Math.round(best * L.total)} of ${L.total}` : 'Not played yet') : `🔒 ${prev.pass} of ${prev.total} on the level before`}</span></button>`;
    };
    const stages = EAR_STAGES.map((S) => `<div class="ear-stage"><h4>${esc(S.title)}</h4><p class="muted small">${esc(S.intro)}</p>
      <div class="game-levels">${EAR_LEVELS.filter((L) => L.stage === S.id).map(earButton).join('')}</div></div>`).join('');
    this.root.innerHTML = `
      <h2>Games</h2>
      <p class="muted">Train your ear and your voice. Each level is a round of questions; pass it to open the next.</p>
      <div class="game-cards">
        <div class="game-card ear-card">
          <h3>🎧 Ear training</h3>
          <p class="muted small">From the very start – which way does the music go? – to naming notes in a key and hearing when a note is a little sharp or flat. Little and often works best: a few rounds a day.</p>
          ${stages}
        </div>
        <div class="game-card">
          <h3>🎤 Sing the note</h3>
          <p class="muted small">Sing the note asked for, and hold it until it turns green. At first the key and the note are played; later only the name is given, then two or three notes in a row.</p>
          <div class="game-levels">${singButtons}</div>
        </div>
      </div>`;
    this.root.querySelectorAll('.game-level').forEach((b) => b.addEventListener('click', () => {
      const level = Number(b.dataset.level);
      if (b.dataset.game === 'ear') this.startEar(level); else this.startSing(level);
    }));
  }

  header(title, i, total, score) {
    return `<div class="game-head"><button type="button" class="btn" data-act="home">← Games</button>
      <b>${esc(title)}</b><span class="muted small">Question ${Math.min(i + 1, total)} of ${total} · ${score} right</span></div>`;
  }

  /** Play the key (if allowed) and/or the notes; resolves when finished. Call inside a tap. */
  playSounds(reference, notes) { return this.playSeq(soundSeq(reference, notes)); }

  /** Play a little sequence; onEvent(k) as each sound starts. Resolves when finished. */
  playSeq(seq, onEvent = null) {
    this.player.prime();
    const inst = this.getInstrument();
    // how long it should take (100 beats a minute, plus the lead-in and tail)
    const expectMs = (seq.events.reduce((a, e) => a + e.beats, 0) * 0.6 + 1.2) * 1000;
    return new Promise((resolve) => {
      let done = false;
      let guard = null;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        this.playing = false;
        this.quietUntil = performance.now() + 400; // the room still rings for a moment
        resolve();
      };
      // never wait for ever: some phones don't say when a sound has finished
      guard = setTimeout(finish, expectMs + 1500);
      this.playing = true;
      this.player.play(seq, { bpm: 100, a4: this.getA4(), instrument: inst === 'voice' ? 'voice' : inst, onEvent: onEvent || undefined, onEnd: finish }).catch(finish);
    });
  }

  // ---------------------------------------------------------------- ear training
  /** Where the questions are played: the instrument's range from C3 up, at most two octaves or so (phone speakers). */
  earRange() {
    const info = instrumentInfo(this.getInstrument());
    const low = info.lowestMidi + info.transpose, high = info.highestMidi + info.transpose;
    const lo = Math.max(low + 5, 48);
    return { low: lo, high: Math.min(Math.max(high, lo + 19), Math.max(84, lo + 19)), strings: openStrings(info) };
  }

  startEar(level) {
    this.view = 'ear';
    const L = earLevel(level);
    this.round = { game: 'ear', level: L.id, i: 0, right: 0, total: L.total };
    this.nextEar(true);
  }

  nextEar(first = false) {
    const R = this.round;
    if (R.i >= R.total) { this.endRound(); return; }
    R.q = earQuestion(R.level, { ...this.earRange(), r: this.r });
    R.picked = [];
    R.checked = false;
    this.renderEar();
    if (!first) this.playEar();
  }

  playEar() {
    const R = this.round;
    R.started = true;
    const btn = this.root.querySelector('[data-act="play"]');
    if (btn) btn.textContent = '▶ Play again';
    return this.playSeq(seqOf(R.q.play));
  }

  /** The answers, in the way the level asks for them. */
  answersHtml(q) {
    const btn = (o, extra = '') => `<button type="button" class="choice${extra}" data-id="${esc(o.id)}" ${o.off ? 'disabled' : ''}>${o.svg || ''}<span class="cl">${esc(o.label)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</button>`;
    if (q.answer === 'ladder' || q.answer === 'letters') {
      const n = q.correct.length;
      const slots = n > 1 ? `<div class="ear-slots">${q.correct.map((_, k) => `<span class="ear-slot" data-k="${k}">${k + 1}</span>`).join('')}</div>` : '';
      return `${slots}<div class="ladder">${q.options.map((o) => btn(o, o.off ? ' off' : '')).join('')}</div>`;
    }
    if (q.answer === 'shape') return `<div class="choices shapes">${q.options.map((o) => btn({ ...o, svg: shapeSvg(o.id), label: shapeWords(o.id) })).join('')}</div>`;
    return `<div class="choices ear-choices n${q.options.length}">${q.options.map((o) => btn(o)).join('')}</div>`;
  }

  renderEar() {
    const R = this.round, q = R.q, L = earLevel(R.level);
    this.root.innerHTML = `${this.header(`Ear training · Level ${R.level}`, R.i, R.total, R.right)}
      <p class="ear-title"><b>${esc(L.title)}</b></p>
      <p class="muted small">${esc(L.how)} ${esc(L.tip)}</p>
      ${q.info ? `<p>${esc(q.info)}</p>` : ''}
      <div class="row"><button type="button" class="btn primary big" data-act="play">▶ ${R.i === 0 && !R.started ? 'Start' : 'Play again'}</button></div>
      <p class="game-ask">${esc(L.ask)}</p>
      ${this.answersHtml(q)}
      <p class="game-feedback" role="status"></p>
      <p class="muted small ear-compare" hidden>Tap any answer to hear it.</p>
      <div class="row">${q.correct.length > 1 ? '<button type="button" class="btn" data-act="clear">↺ Start the answer again</button>' : ''}<button type="button" class="btn primary" data-act="next" hidden>Next ▶</button></div>`;
    this.wire({
      home: () => this.home(),
      play: () => this.playEar(),
      next: () => { R.i++; this.nextEar(); },
      clear: () => { if (R.checked) return; R.picked = []; this.showPicked(); },
    });
    this.root.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => this.earPick(b.dataset.id)));
  }

  /** Fill the answer slots (questions with more than one note). */
  showPicked() {
    const R = this.round;
    this.root.querySelectorAll('.ear-slot').forEach((el) => {
      const k = Number(el.dataset.k), id = R.picked[k];
      const o = id != null && R.q.options.find((x) => x.id === id);
      el.textContent = o ? o.label : String(k + 1);
      el.classList.toggle('filled', !!o);
    });
  }

  earPick(id) {
    const R = this.round, q = R.q;
    // after answering: tap an answer to hear it
    if (R.checked) { if (q.hear[id] != null) this.playSeq(seqOf([{ midis: [q.hear[id]], beats: 1.1, hold: 0.9 }])); return; }
    if (!R.started) { this.say('Press ▶ Start to hear the question first.'); return; }
    R.picked.push(id);
    this.showPicked();
    if (R.picked.length < q.correct.length) return;
    // all answered: mark it
    R.checked = true;
    const rights = q.correct.map((_, k) => answerRight(q, k, R.picked[k]));
    const got = rights.filter(Boolean).length / q.correct.length;
    R.right += got;
    const label = (x) => (q.options.find((o) => o.id === x) || { label: x }).label;
    const words = (x) => (q.answer === 'shape' ? shapeWords(x) : label(x));
    this.root.querySelectorAll('.choice').forEach((b) => {
      const isRight = q.correct.some((c, k) => answerRight(q, k, b.dataset.id) && c != null);
      if (isRight) b.classList.add('right');
      else if (R.picked.includes(b.dataset.id)) b.classList.add('wrong');
      // tap to hear (where the answers have a sound of their own)
      b.disabled = q.hear[b.dataset.id] == null;
    });
    this.root.querySelectorAll('.ear-slot').forEach((el) => { const k = Number(el.dataset.k); el.classList.add(rights[k] ? 'right' : 'wrong'); });
    const answer = q.correct.map(words).join(' then ');
    const extra = q.answer.startsWith('tuning') && q.cents ? ` (${q.cents > 0 ? '+' : '−'}${Math.abs(q.cents)} cents)` : '';
    const all = got === 1;
    this.say(all ? `✓ Right – ${answer}${extra}.` : `✗ It was ${answer}${extra}${q.correct.length === 1 ? ` – you chose ${words(R.picked[0])}` : ''}.`, all);
    this.root.querySelector('.game-head .muted').textContent = `Question ${R.i + 1} of ${R.total} · ${Math.round(R.right * 10) / 10} right`;
    if (Object.keys(q.hear).length && !q.answer.startsWith('direction')) this.root.querySelector('.ear-compare').hidden = false;
    const clear = this.root.querySelector('[data-act="clear"]');
    if (clear) clear.hidden = true;
    const next = this.root.querySelector('[data-act="next"]');
    next.hidden = false;
    next.textContent = R.i + 1 >= R.total ? 'See your score ▶' : 'Next ▶';
    // in a key: the note walks home to Do, so its place is heard as well as named
    if (q.after.length) this.playSeq(seqOf(q.after));
  }

  say(text, good = null) {
    const f = this.root.querySelector('.game-feedback');
    if (!f) return;
    f.textContent = text;
    f.classList.toggle('good', good === true);
    f.classList.toggle('bad', good === false);
  }

  wire(actions) {
    this.root.querySelectorAll('[data-act]').forEach((b) => {
      const fn = actions[b.dataset.act];
      if (fn) b.addEventListener('click', fn);
    });
  }

  // ---------------------------------------------------------------- sing the note
  singRange() {
    const v = voiceSetup();
    return { low: v.low, high: v.high };
  }

  startSing(level) {
    this.view = 'sing';
    this.round = { game: 'sing', level, i: 0, right: 0, total: GAME.singRound, notesAsked: 0, notesRight: 0 };
    this.nextSing();
  }

  nextSing() {
    const R = this.round;
    if (R.i >= R.total) { this.endRound(); return; }
    R.q = singQuestion(R.level, { ...this.singRange(), r: this.r });
    R.j = 0;
    R.results = R.q.notes.map(() => null);
    R.done = false;
    this.renderSing();
    if (this.listening) this.beginQuestion();
  }

  renderSing() {
    const R = this.round, q = R.q, L = SING_LEVELS.find((x) => x.id === R.level);
    const keyLine = q.keyShown ? `Key: <b>${esc(q.key.title)}</b>` : 'Key: <b>not given</b>';
    const target = (n, k) => `<span class="sing-target" data-k="${k}">${q.keyShown ? `${esc(n.sol)}<small>${esc(n.name)}</small>` : esc(n.name)}</span>`;
    this.root.innerHTML = `${this.header(`Sing the note · Level ${R.level}`, R.i, R.total, R.notesRight)}
      <p class="muted small">${esc(L.detail)}</p>
      <p>${keyLine}</p>
      <p class="game-ask">${q.notes.length > 1 ? 'Sing these notes in order – hold each one until it turns green:' : 'Sing this note and hold it until it turns green:'}</p>
      <div class="sing-targets">${q.notes.map(target).join('<span class="muted">→</span>')}</div>
      <div class="sing-meter tuner big" id="singMeter"></div>
      <p class="small sing-hint" role="status"></p>
      <div class="row">
        ${this.listening ? '' : '<button type="button" class="btn primary big" data-act="start">🎤 Start</button>'}
        ${q.hearKey ? '<button type="button" class="btn" data-act="key">▶ Hear the key</button>' : ''}
        ${q.hearNote ? '<button type="button" class="btn" data-act="note">▶ Hear the note</button>' : ''}
        <button type="button" class="btn" data-act="skip">Skip</button>
      </div>
      <p class="game-feedback" role="status"></p>
      <div class="row"><button type="button" class="btn primary" data-act="next" hidden>Next ▶</button></div>`;
    this.meter = new Meter(this.root.querySelector('#singMeter'));
    this.meter.clear(this.listening ? '' : 'Press Start');
    this.wire({
      home: () => this.home(),
      start: () => this.startListening(),
      key: () => this.hear(q.reference, []),
      note: () => this.hear([], q.notes.map((n) => n.midi)),
      skip: () => this.finishQuestion(true),
      next: () => { R.i++; this.nextSing(); },
    });
  }

  /** The first tap starts the microphone (it then stays on for the round). */
  async startListening() {
    this.engine.unlock('play-and-record');
    this.player.prime();
    const btn = this.root.querySelector('[data-act="start"]');
    if (btn) btn.disabled = true;
    try {
      this.starting = true;
      const ctx = await this.engine.start({ source: 'mic', minFreq: 60, maxFreq: 1400, onFrames: (fs) => fs.forEach((f) => this.frame(f)) });
      this.starting = false;
      if (!ctx) { if (btn) btn.disabled = false; return; } // stopped while starting
      this.listening = true;
      this.lastFrameAt = this.lastVoicedAt = performance.now();
      clearInterval(this.checker);
      this.checker = setInterval(() => this.checkHearing(), 1000);
      if (btn) btn.remove();
      this.beginQuestion();
    } catch (e) {
      this.starting = false;
      if (btn) btn.disabled = false;
      this.say(e instanceof MicError ? e.message : 'Could not start the microphone: ' + (e && e.message), false);
    }
  }

  stopListening() {
    if (this.listening || this.starting) this.engine.stop();
    this.starting = false;
    this.listening = false;
    clearTimeout(this.noteTimer);
    clearInterval(this.checker);
  }

  /** The app went into the background, or the microphone stopped: stop, and offer Start again. */
  pause(message = 'Paused – press 🎤 Start to carry on.') {
    if (this.view !== 'sing' || !this.listening) return;
    this.stopListening();
    this.player.stop();
    this.playing = false;
    const R = this.round;
    if (R && !R.done) { this.renderSing(); this.say(message); }
  }

  /** Every second while listening: say so if nothing is being heard. */
  checkHearing() {
    if (this.view !== 'sing' || !this.listening || this.playing || !this.round || this.round.done) return;
    const now = performance.now();
    if (now - this.lastFrameAt > 2500) { this.pause('The microphone stopped sending sound – press 🎤 Start again.'); return; }
    if (this.judge && now - this.lastVoicedAt > 3500 && now > (this.quietUntil || 0) + 3500) {
      const hint = this.root.querySelector('.sing-hint');
      if (hint) hint.textContent = 'Can\u2019t hear you – sing a little louder, or come closer to the microphone.';
    }
  }

  /** Play what the level allows, then listen for the first note. */
  async beginQuestion() {
    const R = this.round, q = R.q;
    if (q.hearKey || q.hearNote) {
      this.say(q.hearNote ? 'Listen…' : 'Listen to the key…');
      await this.playSounds(q.reference, q.hearNote ? q.notes.map((n) => n.midi) : []);
      if (this.round !== R || R.q !== q) return;
    }
    this.listenFor(0);
  }

  hear(reference, notes) {
    clearTimeout(this.noteTimer);
    this.playSounds(reference, notes).then(() => { if (this.round && !this.round.done) this.listenFor(this.round.j); });
  }

  listenFor(j) {
    const R = this.round, q = R.q;
    R.j = j;
    if (!this.listening) { this.say('Press 🎤 Start when you are ready to sing.'); return; }
    this.root.querySelectorAll('.sing-target').forEach((el) => el.classList.toggle('now', Number(el.dataset.k) === j));
    const tol = GAME.singCents[R.level - 1] ?? 40;
    this.judge = new HoldJudge(q.notes[j].midi, { tolerance: tol });
    this.say(`Sing ${q.keyShown ? q.notes[j].sol + ' (' + q.notes[j].name + ')' : q.notes[j].name}…`);
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => this.noteResult(null), GAME.singTimeoutSec * 1000);
    this.smooth = [];
  }

  /** A pitch reading from the microphone. */
  frame(f) {
    if (this.view !== 'sing' || !this.round || !this.meter) return;
    this.lastFrameAt = performance.now();
    // the app's own sound (the key, the note) is not listened to
    if (this.playing || performance.now() < (this.quietUntil || 0)) { this.smooth = []; return; }
    const voiced = f.freq > 0 && f.clarity >= GAME.singClarity && f.rms >= GAME.singRms;
    let midi = null;
    if (voiced) {
      this.lastVoicedAt = performance.now();
      const hint = this.root.querySelector('.sing-hint');
      if (hint && hint.textContent) hint.textContent = '';
      this.smooth = this.smooth || [];
      this.smooth.push(freqToMidi(f.freq, this.getA4()));
      if (this.smooth.length > 5) this.smooth.shift();
      const s = this.smooth.slice().sort((a, b) => a - b);
      midi = s[Math.floor(s.length / 2)];
    } else this.smooth = [];
    // the bar always shows what is being sung (against the note asked for, in any octave)
    const target = this.round.q.notes[Math.min(this.round.j || 0, this.round.q.notes.length - 1)].midi;
    if (midi == null) this.meter.clear('');
    else {
      let c = (midi - target) * 100;
      c = ((c % 1200) + 1800) % 1200 - 600;
      this.meter.setBar(0, c, { fullCents: 20, zeroCents: 60 });
      this.meter.setReadout(noteName(spellMidi(Math.round(midi), this.round.q.key.pref)), fmtCents(c), '');
    }
    if (!this.judge || this.round.done) return;
    const done = this.judge.push(f.t, midi);
    if (done != null) this.noteResult(done);
  }

  /** One note sung (cents) or timed out (null). */
  noteResult(cents) {
    const R = this.round;
    if (!R || R.done) return;
    clearTimeout(this.noteTimer);
    R.results[R.j] = cents;
    const el = this.root.querySelector(`.sing-target[data-k="${R.j}"]`);
    if (el) el.classList.add(cents == null ? 'missed' : 'sung');
    if (R.j + 1 < R.q.notes.length) { this.listenFor(R.j + 1); return; }
    this.finishQuestion(false);
  }

  finishQuestion(skipped) {
    const R = this.round;
    if (!R || R.done) return;
    R.done = true;
    clearTimeout(this.noteTimer);
    this.judge = null;
    const got = R.results.filter((c) => c != null).length;
    R.notesAsked += R.q.notes.length;
    R.notesRight += got;
    R.right += got / R.q.notes.length;
    this.root.querySelectorAll('.sing-target').forEach((el) => el.classList.remove('now'));
    const all = got === R.q.notes.length;
    this.say(skipped ? 'Skipped.' : all ? `✓ Well sung!${R.q.notes.length === 1 ? ` (${fmtCents(R.results[0])})` : ''}` : `${got} of ${R.q.notes.length} – keep going!`, skipped ? null : all);
    this.root.querySelector('.game-head .muted').textContent = `Question ${R.i + 1} of ${R.total} · ${R.notesRight} right`;
    const next = this.root.querySelector('[data-act="next"]');
    next.hidden = false;
    next.textContent = R.i + 1 >= R.total ? 'See your score ▶' : 'Next ▶';
    const skip = this.root.querySelector('[data-act="skip"]');
    if (skip) skip.disabled = true;
  }

  // ---------------------------------------------------------------- end of a round
  endRound() {
    const R = this.round;
    this.stopListening();
    const ear = R.game === 'ear';
    const fraction = R.game === 'sing' ? (R.notesAsked ? R.notesRight / R.notesAsked : 0) : R.right / R.total;
    const res = ear ? recordRound(this.progress, 'ear', R.level, fraction, EAR_RULES) : recordRound(this.progress, 'sing', R.level, fraction);
    saveProgress(this.progress);
    const count = ear ? EAR_LEVELS.length : SING_LEVELS.length;
    const hasNext = R.level < count && (ear ? isUnlocked(this.progress, 'ear', R.level + 1, passFraction) : isUnlocked(this.progress, 'sing', R.level + 1));
    const L = ear ? earLevel(R.level) : null;
    const n = ear ? earStars(R.level, fraction) : stars(fraction);
    const passText = ear ? `Get ${L.pass} of ${L.total} right to open the next level.` : 'Score 70% or more to open the next level.';
    this.view = 'end';
    this.root.innerHTML = `
      <div class="game-end">
        <h2>${ear ? `Ear training · Level ${R.level}` : `Sing the note · Level ${R.level}`}</h2>
        ${ear ? `<p class="muted">${esc(L.title)}</p>` : ''}
        <p class="game-score">${ear ? `${Math.round(R.right * 10) / 10} of ${R.total}` : `${Math.round(fraction * 100)}%`}</p>
        <p class="game-stars" aria-label="${n} stars">${starText(n)}</p>
        <p>${res.newBest ? 'A new best score for this level!' : ear ? `Your best: ${Math.round(res.best * R.total)} of ${R.total}` : `Your best: ${Math.round(res.best * 100)}%`}</p>
        ${res.unlocked ? `<p class="good"><b>Level ${R.level + 1} is now open!</b></p>` : R.level < count && !hasNext ? `<p class="muted">${passText}</p>` : ''}
        <div class="row">
          <button type="button" class="btn" data-act="again">Play again</button>
          ${hasNext ? '<button type="button" class="btn primary" data-act="nextLevel">Next level ▶</button>' : ''}
          <button type="button" class="btn" data-act="home">All games</button>
        </div>
      </div>`;
    this.wire({
      again: () => (ear ? this.startEar(R.level) : this.startSing(R.level)),
      nextLevel: () => (ear ? this.startEar(R.level + 1) : this.startSing(R.level + 1)),
      home: () => this.home(),
    });
  }
}
