// Games tab: "Name the note" (listening) and "Sing the note" (singing).
// The rules are in games.js; this is the screen, the sound and the microphone.

import {
  LISTEN_LEVELS, SING_LEVELS, GAME, listenQuestion, singQuestion, HoldJudge,
  loadProgress, saveProgress, recordRound, isUnlocked, stars, rng,
} from '../games.js';
import { instrumentInfo, voiceSetup } from '../instruments.js';
import { noteName, spellMidi, freqToMidi } from '../theory.js';
import { Meter, fmtCents } from './meter.js';
import { MicError } from '../audio/mic.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

/**
 * Name the note, easier: for each note its four choices in the order of the buttons, a pause,
 * and the note. The key isn't played as well – the choices already set the scene.
 * `marks` says what each sound is, to light it up.
 */
function easyListenSeq(q) {
  const events = [], glyphs = [], marks = [];
  const add = (midi, beats, sounding, mark) => {
    const i = events.length;
    glyphs.push({ beats: sounding });
    events.push({ index: i, glyphIndex: i, beats, midis: [midi], slurred: false });
    marks.push(mark);
  };
  q.notes.forEach((n, row) => {
    q.choiceMidis[row].forEach((m, k) => add(m, k === q.choiceMidis[row].length - 1 ? 1.7 : 0.8, 0.65, { row, name: q.choices[row][k] }));
    add(n.midi, row < q.notes.length - 1 ? 2.2 : 1.1, 0.95, { row, note: true });
  });
  return { seq: { events, glyphs }, marks };
}

/** A few notes as a little "sequence" the synthesiser can play: the key, a pause, then the notes. */
function soundSeq(reference, notes) {
  const events = [], glyphs = [];
  const add = (midi, beats, sounding) => {
    const i = events.length;
    glyphs.push({ beats: sounding });
    events.push({ index: i, glyphIndex: i, beats, midis: [midi], slurred: false });
  };
  reference.forEach((m, k) => add(m, k === reference.length - 1 ? (notes.length ? 2 : 1) : 0.5, 0.45));
  notes.forEach((m) => add(m, 1.1, 0.95));
  return { events, glyphs };
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
    const easy = !!this.progress.listenEasier;
    const levelButtons = (game, levels) => levels.map((L) => {
      const track = game === 'listen' && easy ? 'listenEasy' : game; // the easier version keeps its own scores
      const open = isUnlocked(this.progress, track, L.id);
      const best = (this.progress[track] || { best: {} }).best[L.id];
      return `<button type="button" class="game-level" data-game="${game}" data-level="${L.id}" ${open ? '' : 'disabled'}
        title="${esc(L.detail)}"><span class="lv">Level ${L.id}</span><span class="nm">${esc(L.label)}</span>
        <span class="st">${open ? (best != null ? `${starText(stars(best))} ${Math.round(best * 100)}%` : 'Not played yet') : '🔒 Score 70% on the level before'}</span></button>`;
    }).join('');
    this.root.innerHTML = `
      <h2>Games</h2>
      <p class="muted">Train your ear and your voice. Each level is a round of questions; score 70% or more to open the next level.</p>
      <div class="game-cards">
        <div class="game-card">
          <h3>🎧 Name the note</h3>
          <p class="muted small">A note is played – choose its name from four. At first the key is given and played; later it isn't, and there are two notes.</p>
          <label class="check small game-easy"><input type="checkbox" id="listenEasy" ${easy ? 'checked' : ''}> <span><b>Easier:</b> hear the four choices before each note <span class="muted">(its own scores and levels)</span></span></label>
          <div class="game-levels">${levelButtons('listen', LISTEN_LEVELS)}</div>
        </div>
        <div class="game-card">
          <h3>🎤 Sing the note</h3>
          <p class="muted small">Sing the note asked for, and hold it until it turns green. At first the key and the note are played; later only the name is given, then two or three notes in a row.</p>
          <div class="game-levels">${levelButtons('sing', SING_LEVELS)}</div>
        </div>
      </div>`;
    this.root.querySelector('#listenEasy').addEventListener('change', (e) => {
      this.progress.listenEasier = e.target.checked;
      saveProgress(this.progress);
      this.home();
    });
    this.root.querySelectorAll('.game-level').forEach((b) => b.addEventListener('click', () => {
      const level = Number(b.dataset.level);
      if (b.dataset.game === 'listen') this.startListen(level); else this.startSing(level);
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

  // ---------------------------------------------------------------- name the note
  listenRange() {
    const info = instrumentInfo(this.getInstrument());
    const low = info.lowestMidi + info.transpose, high = info.highestMidi + info.transpose;
    // phone speakers hardly play the lowest notes: keep the questions from C3 up
    const lo = Math.max(low + 5, 48);
    return { low: lo, high: Math.max(high, lo + 14) };
  }

  startListen(level) {
    this.view = 'listen';
    this.round = { game: 'listen', easy: !!this.progress.listenEasier, level, i: 0, right: 0, total: GAME.listenRound, asked: 0 };
    this.nextListen(true);
  }

  nextListen(first = false) {
    const R = this.round;
    if (R.i >= R.total) { this.endRound(); return; }
    R.q = listenQuestion(R.level, { ...this.listenRange(), r: this.r });
    R.picked = R.q.notes.map(() => null);
    R.checked = false;
    this.renderListen();
    if (!first) this.playQuestion();
  }

  playQuestion() {
    const R = this.round, q = R.q;
    if (!R.easy) return this.playSounds(q.reference, q.notes.map((n) => n.midi));
    // easier: each choice lights up as it sounds, then the note's row
    const { seq, marks } = easyListenSeq(q);
    const light = (mark) => {
      this.root.querySelectorAll('.choice.sounding').forEach((b) => b.classList.remove('sounding'));
      this.root.querySelectorAll('.choice-row.hearing').forEach((r) => r.classList.remove('hearing'));
      if (!mark) return;
      if (mark.note) { const row = this.root.querySelector(`.choice-row[data-row="${mark.row}"]`); if (row) row.classList.add('hearing'); return; }
      const b = [...this.root.querySelectorAll(`.choice[data-row="${mark.row}"]`)].find((x) => x.dataset.name === mark.name);
      if (b) b.classList.add('sounding');
    };
    return this.playSeq(seq, (k) => light(marks[k])).then(() => light(null));
  }

  renderListen() {
    const R = this.round, q = R.q, L = LISTEN_LEVELS.find((x) => x.id === R.level);
    const keyLine = q.keyShown ? `Key: <b>${esc(q.key.title)}</b>${q.hearKey && !R.easy ? ' – you hear the key first' : ''}` : 'Key: <b>not given</b>';
    const rows = q.notes.map((n, k) => `
      <div class="choice-row" data-row="${k}">
        ${q.notes.length > 1 ? `<span class="muted small">${k === 0 ? 'First' : 'Second'} note</span>` : ''}
        <div class="choices">${q.choices[k].map((c) => `<button type="button" class="choice" data-row="${k}" data-name="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        ${R.easy ? '<span class="hearing-label muted small">← now the note</span>' : ''}
      </div>`).join('');
    this.root.innerHTML = `${this.header(`Name the note · Level ${R.level}`, R.i, R.total, R.right)}
      <p class="muted small">${esc(L.detail)}${R.easy ? ` <b>Easier:</b> you hear the four choices (each lights up), then the note${q.hearKey ? ' – the key isn’t played' : ''}.` : ''}</p>
      <p>${keyLine}</p>
      <div class="row"><button type="button" class="btn primary big" data-act="play">▶ ${R.i === 0 && !R.started ? 'Start' : 'Play again'}</button></div>
      <p class="game-ask">${q.notes.length > 1 ? 'Which two notes were played, in order?' : 'Which note was played?'}</p>
      ${rows}
      <p class="game-feedback" role="status"></p>
      <div class="row"><button type="button" class="btn primary" data-act="next" hidden>Next ▶</button></div>`;
    this.wire({
      home: () => this.home(),
      play: () => { R.started = true; this.root.querySelector('[data-act="play"]').textContent = '▶ Play again'; this.playQuestion(); },
      next: () => { R.i++; this.nextListen(); },
    });
    this.root.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => this.pick(Number(b.dataset.row), b.dataset.name)));
  }

  pick(row, name) {
    const R = this.round;
    if (R.checked) return;
    if (!R.started) { this.say('Press ▶ Start to hear the note first.'); return; }
    R.picked[row] = name;
    this.root.querySelectorAll(`.choice[data-row="${row}"]`).forEach((b) => b.classList.toggle('picked', b.dataset.name === name));
    if (R.picked.some((p) => p == null)) return;
    // all answered: mark them
    R.checked = true;
    let allRight = true;
    R.q.notes.forEach((n, k) => {
      const ok = R.picked[k] === n.name;
      if (!ok) allRight = false;
      R.right += ok ? 1 / R.q.notes.length : 0;
      this.root.querySelectorAll(`.choice[data-row="${k}"]`).forEach((b) => {
        b.disabled = true;
        if (b.dataset.name === n.name) b.classList.add('right');
        else if (b.dataset.name === R.picked[k]) b.classList.add('wrong');
      });
    });
    const answer = R.q.notes.map((n) => n.name).join(' then ');
    this.say(allRight ? '✓ Right!' : `✗ It was ${answer}.`, allRight);
    this.root.querySelector('.game-head .muted').textContent = `Question ${R.i + 1} of ${R.total} · ${Math.round(R.right * 10) / 10} right`;
    const next = this.root.querySelector('[data-act="next"]');
    next.hidden = false;
    next.textContent = R.i + 1 >= R.total ? 'See your score ▶' : 'Next ▶';
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
    const fraction = R.game === 'sing' ? (R.notesAsked ? R.notesRight / R.notesAsked : 0) : R.right / R.total;
    const track = R.game === 'listen' && R.easy ? 'listenEasy' : R.game;
    const res = recordRound(this.progress, track, R.level, fraction);
    saveProgress(this.progress);
    const levels = R.game === 'listen' ? LISTEN_LEVELS : SING_LEVELS;
    const hasNext = R.level < levels.length && isUnlocked(this.progress, track, R.level + 1);
    this.view = 'end';
    this.root.innerHTML = `
      <div class="game-end">
        <h2>${R.game === 'listen' ? `Name the note${R.easy ? ' (easier)' : ''}` : 'Sing the note'} · Level ${R.level}</h2>
        <p class="game-score">${Math.round(fraction * 100)}%</p>
        <p class="game-stars" aria-label="${stars(fraction)} stars">${starText(stars(fraction))}</p>
        <p>${res.newBest ? 'A new best score for this level!' : `Your best: ${Math.round(res.best * 100)}%`}</p>
        ${res.unlocked ? `<p class="good"><b>Level ${R.level + 1} is now open!</b></p>` : fraction < GAME.unlockAt && R.level < levels.length && !hasNext ? '<p class="muted">Score 70% or more to open the next level.</p>' : ''}
        <div class="row">
          <button type="button" class="btn" data-act="again">Play again</button>
          ${hasNext ? '<button type="button" class="btn primary" data-act="nextLevel">Next level ▶</button>' : ''}
          <button type="button" class="btn" data-act="home">All games</button>
        </div>
      </div>`;
    this.wire({
      again: () => (R.game === 'listen' ? this.startListen(R.level) : this.startSing(R.level)),
      nextLevel: () => (R.game === 'listen' ? this.startListen(R.level + 1) : this.startSing(R.level + 1)),
      home: () => this.home(),
    });
  }
}
