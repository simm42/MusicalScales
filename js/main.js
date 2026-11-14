// Page wiring: settings form, exercise display, practice runs, list, tuner tab, theme.

import { INSTRUMENTS } from './instruments.js';
import {
  EXERCISE_TYPES, DEFAULT_SETTINGS, RANGE_LABELS, normalise, buildExercise, isPlayable,
  typesForInstrument, rangesFor, keyListFor,
} from './exercises.js';
import { buildSequence, RHYTHMS } from './sequence.js';
import { pcName, parsePc, noteName, spellMidi } from './theory.js';
import { renderScore, renderKeySignature, markNote } from './notation.js';
import { describeOptions, shortOptions } from './settingsText.js';
import { precisionAt, linearScore, scoreClass } from './precision.js';
import { AudioEngine, MicError } from './audio/mic.js';
import { PracticeSession } from './practice.js';
import { Player } from './playback.js';
import { encodeWav } from './audio/wav.js';
import { Meter, fmtCents } from './ui/meter.js';
import { renderSummary } from './ui/summary.js';
import { TunerPage } from './ui/tunerPage.js';
import { CalibrationWizard } from './ui/calibrationWizard.js';
import { loadCalibration, describeCalibration } from './calibration.js';
import {
  loadList, saveList, makeItem, expandSettings, compactSettings, sameSettings, recordResult,
  encodeShare, decodeShare, exportJson, importJson,
} from './practiceList.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'scales.prefs.v1';

// ---------------------------------------------------------------- state
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } }
const prefs = { a4: 440, view: null, tab: 'practice', ...loadPrefs() };
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } }

let settings = normalise(prefs.settings || DEFAULT_SETTINGS);
let list = loadList();
let activeId = prefs.activeId && list.some((x) => x.id === prefs.activeId) ? prefs.activeId : null;
let editingId = null;
let exercise = null;
let seq = null;
let rendered = { arrowTargets: [] };
let session = null;
let lastResult = null;
let arrowIndex = 0;

const engine = new AudioEngine();
const player = new Player(engine);
const meter = new Meter($('liveTuner'));
const DEBUG_MODE = new URLSearchParams(location.search).get('debug'); // 'synth' | 'capture' | other
const DEBUG = DEBUG_MODE != null;

const a4 = () => Math.min(446, Math.max(415, Number(prefs.a4) || 440));
const prec = () => precisionAt(settings.precision);

// ---------------------------------------------------------------- form
const form = $('optionsView');
const sel = (id) => $('o-' + id);

function fillSelect(el, options, value) {
  el.innerHTML = '';
  for (const o of options) {
    const opt = new Option(o.label, o.value);
    if (o.disabled) opt.disabled = true;
    el.add(opt);
  }
  el.value = String(value);
}

function syncForm() {
  const s = settings;
  const t = EXERCISE_TYPES[s.type];
  fillSelect(sel('instrument'), Object.entries(INSTRUMENTS).map(([v, i]) => ({ value: v, label: i.name })), s.instrument);
  fillSelect(sel('type'), typesForInstrument(s.instrument).map((v) => ({ value: v, label: EXERCISE_TYPES[v].label })), s.type);
  $('f-mode').hidden = !t.tonality;
  sel('mode').value = s.mode;
  $('l-key').textContent = t.keyKind === 'start' ? 'Starting on' : t.keyKind === 'majorKey' ? 'In the key of' : 'Key';
  const keyField = t.keyKind === 'start' ? 'start' : 'key';
  fillSelect(sel('key'), keyListFor(s).map((k) => ({ value: k, label: pcName(parsePc(k)) })), s[keyField]);
  $('f-form').hidden = !(t.forms && s.mode === 'minor');
  sel('form').value = s.form;
  $('f-interval').hidden = !t.intervals;
  sel('interval').value = s.interval;
  fillSelect(sel('range'), rangesFor(s.instrument, s.type).map((r) => ({ value: r, label: RANGE_LABELS[r] + (isPlayable(s, { range: r }) ? '' : ' (too high)'), disabled: !isPlayable(s, { range: r }) && r !== s.range })), s.range);
  sel('octaveUp').checked = s.octaveUp;
  sel('octaveUp').disabled = !s.octaveUp && !isPlayable(s, { octaveUp: true });
  fillSelect(sel('rhythm'), Object.entries(RHYTHMS).map(([v, r]) => ({ value: v, label: r.label })), s.rhythm);
  for (const k of ['longEnds', 'longMidTonics', 'repeatTop', 'hint', 'vibrato', 'metronome']) sel(k).checked = !!s[k];
  const slurOpts = [{ value: 0, label: t.doubleStop ? 'Separate bows (together)' : 'Separate bows' }];
  if (s.rhythm === 'crotchet') for (const n of t.slurs) slurOpts.push({ value: n, label: `Slurred, ${n} notes to a bow` });
  fillSelect(sel('slur'), slurOpts, s.slur);
  sel('slur').disabled = slurOpts.length === 1;
  sel('display').value = s.display;
  sel('clefMode').value = s.clefMode;
  sel('bpm').value = s.bpm;
  sel('precision').value = s.precision;
  $('precisionName').textContent = prec().name;
  sel('a4').value = a4();
  $('calInfo').textContent = describeCalibration(loadCalibration(s.instrument), INSTRUMENTS[s.instrument].name);
  $('saveItemBtn').hidden = !editingId;
  $('addBtn').textContent = editingId ? 'Add as new' : 'Add to my list';
}

form.addEventListener('change', (e) => {
  const el = e.target;
  if (!el.name && el.id !== 'o-a4') return;
  if (el.id === 'o-a4') { prefs.a4 = Math.min(446, Math.max(415, Number(el.value) || 440)); savePrefs(); syncForm(); return; }
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (['slur', 'bpm', 'precision'].includes(el.name)) v = Number(v);
  const next = { ...settings };
  if (el.name === 'key') next[EXERCISE_TYPES[settings.type].keyKind === 'start' ? 'start' : 'key'] = v;
  else next[el.name] = v;
  setSettings(next);
});
sel('precision').addEventListener('input', () => { $('precisionName').textContent = precisionAt(sel('precision').value).name; });

function setSettings(next, { keepActive = false } = {}) {
  settings = normalise(next);
  if (!keepActive && activeId) {
    const item = list.find((x) => x.id === activeId);
    if (!item || !sameSettings(expandSettings(item.settings), settings)) { if (!editingId) activeId = null; }
  }
  prefs.settings = compactSettings(settings);
  prefs.activeId = activeId;
  savePrefs();
  syncForm();
  updateExercise();
  renderList();
}

// ---------------------------------------------------------------- exercise display
function updateExercise() {
  stopSession(true);
  stopPlayback();
  exercise = buildExercise(settings);
  seq = buildSequence(exercise);
  $('exTitle').textContent = `${INSTRUMENTS[settings.instrument].name}: ${exercise.title}`;
  $('exOptions').textContent = describeOptions(settings);
  $('exInvalid').hidden = exercise.ok;
  if (!exercise.ok) $('exInvalid').textContent = exercise.reason + ' Choose fewer octaves or a lower starting octave.';
  $('startBtn').disabled = !exercise.ok;
  $('playBtn').disabled = !exercise.ok;
  lastResult = null;
  $('summary').innerHTML = '';
  meter.setCount(exercise.type.doubleStop ? 2 : 1);
  meter.clear();
  drawScore();
}

function drawScore() {
  const scoreEl = $('score');
  $('arrow').hidden = true;
  rendered = { arrowTargets: [] };
  if (!window.Vex) { scoreEl.textContent = ''; return; }
  try {
    if (settings.display === 'score') rendered = renderScore(scoreEl, exercise, seq, { clefMode: settings.clefMode });
    else if (settings.display === 'keysig') rendered = renderKeySignature(scoreEl, exercise);
    else scoreEl.innerHTML = '';
  } catch (err) {
    console.error(err);
    scoreEl.innerHTML = '<p class="notice error">Sorry – the score could not be drawn for this exercise.</p>';
  }
  if (lastResult) colourAll(lastResult);
}

function placeArrow(k) {
  arrowIndex = k;
  const a = $('arrow');
  const t = rendered.arrowTargets && rendered.arrowTargets[k];
  if (!t || settings.display !== 'score') { a.hidden = true; return; }
  a.hidden = false;
  a.style.left = `${t.x}px`;
  a.style.top = `${t.y}px`;
}

// Redraw only when the width changes: phone address bars collapsing fire
// height-only resizes, and a redraw would wipe the live note colours.
let resizeTimer = null;
let lastWidth = $('scoreWrap').clientWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = $('scoreWrap').clientWidth;
    if (w === lastWidth || settings.display !== 'score') return;
    lastWidth = w;
    redrawKeepingColours();
  }, 200);
});

/** Redraw the score but keep live note colours and the arrow (theme change, resize). */
function redrawKeepingColours() {
  const coloured = rendered.arrowTargets.map((t) => (t && t.el ? [...t.el.classList].find((c) => c.startsWith('n-')) : null));
  drawScore();
  coloured.forEach((c, k) => { if (c) markNote(rendered.arrowTargets, k, c); });
  if (session || player.playing) placeArrow(arrowIndex);
}

// ---------------------------------------------------------------- practice runs
function setStatus(text, strong = false) {
  const st = $('status');
  st.textContent = text;
  st.style.fontWeight = strong ? '700' : '';
  st.style.color = strong ? 'var(--accent)' : '';
}

function liveNoteName(midiSounding) {
  const written = Math.round(midiSounding) - exercise.info.transpose;
  const ev = seq.events[arrowIndex];
  if (ev) {
    const k = ev.writtenMidis.indexOf(written);
    if (k >= 0) return noteName(ev.notes[k], { octave: true });
  }
  return noteName(spellMidi(written, exercise.fifths < 0 ? 'flat' : 'sharp'), { octave: true });
}

function hintText() {
  if (!settings.hint || settings.display === 'score') return '';
  const ev = seq.events[arrowIndex];
  return ev ? `Next: ${ev.notes.map((n) => noteName(n)).join(' + ')}` : '';
}

function colourNote(k, cents) {
  const p = prec();
  const score = cents.some((c) => c == null) ? 0 : Math.min(...cents.map((c) => linearScore(c, p.fullCents, p.zeroCents)));
  markNote(rendered.arrowTargets, k, scoreClass(score));
}

function colourAll(result) {
  for (const r of result.perNote) markNote(rendered.arrowTargets, r.event, r.status === 'missing' ? 'n-missing' : scoreClass(r.intonation));
}

function synthOptions() {
  const v = (id) => $(id) && $(id).value;
  const list2 = (s) => String(s || '').split(',').map((x) => parseInt(x, 10)).filter((x) => !isNaN(x));
  const extraAfter = list2(v('d-extra'));
  const sd = Number(v('d-detune')) || 0;
  return {
    bpm: Number(v('d-bpm')) || 72,
    detuneSd: sd,
    jitter: (Number(v('d-jitter')) || 0) / 100,
    vibratoCents: Number(v('d-vibrato')) || 0,
    missing: list2(v('d-missing')),
    extras: extraAfter.map((i) => ({ after: i, midi: (seq.events[i] ? seq.events[i].midis[0] : 60) + 1 })),
    seed: Math.floor(Math.random() * 1e6),
    monitor: !!($('d-monitor') && $('d-monitor').checked),
  };
}

async function startSession() {
  if (!exercise.ok) return;
  stopPlayback();
  stopSession(true);
  $('micError').hidden = true;
  $('summary').innerHTML = '';
  lastResult = null;
  rendered.arrowTargets.forEach((_, k) => markNote(rendered.arrowTargets, k, null));
  const useSynth = DEBUG && $('d-use') && $('d-use').checked;
  const p = prec();
  const s = new PracticeSession({
    engine, exercise, seq, settings, a4: a4(), prec: p,
    synth: useSynth ? synthOptions() : null,
    capture: DEBUG && $('d-capture') && $('d-capture').checked,
    calibration: loadCalibration(settings.instrument),
    on: {
      state: (st, extra) => {
        if (st === 'starting') setStatus('Starting the microphone…');
        if (st === 'calibrating') setStatus('Listening to the room – stay quiet for a moment…');
        if (st === 'countin') setStatus(`Count-in… ${extra}`, true);
        if (st === 'listening') setStatus('Play now', true);
      },
      pitch: (pv) => {
        if (!pv) { meter.clear(hintText()); return; }
        if (pv.pair) {
          pv.pair.forEach((c, i) => meter.setBar(i, c, p));
          meter.setReadout(pv.event.notes.map((n) => noteName(n)).join(' + '), pv.pair.map((c) => (c == null ? '–' : fmtCents(c).replace(' cents', ''))).join(' / ') + ' cents', hintText());
          return;
        }
        const cents = (pv.midi - Math.round(pv.midi)) * 100;
        meter.setBar(0, cents, p);
        meter.setReadout(liveNoteName(pv.midi), fmtCents(cents), hintText());
      },
      arrow: (k) => placeArrow(k),
      noteDone: (k, cents) => colourNote(k, cents),
      done: (result) => finishSession(result),
    },
  });
  session = s;
  $('startBtn').textContent = 'Stop';
  try {
    await s.start();
  } catch (e) {
    session = null;
    $('startBtn').textContent = 'Start';
    setStatus('');
    $('micError').textContent = e instanceof MicError ? e.message : 'Could not start listening: ' + (e && e.message);
    $('micError').hidden = false;
  }
}

function finishSession(result) {
  const finished = session;
  session = null;
  $('startBtn').textContent = 'Start';
  $('arrow').hidden = true;
  meter.clear();
  offerCapture(finished, result);
  if (!result) { setStatus('Stopped.'); return; }
  const played = result.perNote.some((r) => r.status !== 'missing');
  if (!played) { setStatus('No notes were heard. Check the microphone and play a little louder, or move closer.'); return; }
  setStatus(`Finished – score ${Math.round(result.total)} / 100.`);
  lastResult = result;
  renderSummary($('summary'), { result, seq, prec: prec(), settings });
  colourAll(result);
  const item = activeId && list.find((x) => x.id === activeId);
  if (item && sameSettings(expandSettings(item.settings), settings)) { recordResult(item, result); saveList(list); renderList(); }
}

function stopSession(silent = false) {
  if (!session) return;
  const s = session;
  session = null;
  if (silent) { s.abort(); $('startBtn').textContent = 'Start'; setStatus('Press Start, wait for “Play now”, then play.'); meter.clear(); }
  else s.stop();
}

// ---------------------------------------------------------------- play the exercise
function stopPlayback() {
  if (!player.playing) return;
  player.stop();
  $('playBtn').textContent = '▶ Play';
  $('arrow').hidden = true;
  meter.clear();
  setStatus('Press Start, wait for “Play now”, then play.');
}

$('playBtn').addEventListener('click', async () => {
  if (player.playing) { stopPlayback(); return; }
  if (!exercise.ok) return;
  stopSession(true);
  $('playBtn').textContent = '■ Stop';
  setStatus('Preparing the sound…');
  await new Promise((r) => setTimeout(r, 30)); // let the message show before the sound is rendered
  try {
    const playing = player.play(seq, {
      bpm: settings.bpm,
      a4: a4(),
      instrument: settings.instrument,
      onEvent: (k) => {
        placeArrow(k);
        const ev = seq.events[k];
        meter.setReadout(ev.notes.map((n) => noteName(n, { octave: true })).join(' + '), '', '');
      },
      onEnd: () => { $('playBtn').textContent = '▶ Play'; $('arrow').hidden = true; meter.clear(); setStatus('Now you try: press Start.'); },
    });
    await playing;
    if (player.playing) setStatus(`Playing the exercise at ♩ = ${settings.bpm} on the ${INSTRUMENTS[settings.instrument].name.toLowerCase()}…`);
  } catch (e) {
    $('playBtn').textContent = '▶ Play';
    setStatus('Could not play: ' + (e && e.message));
  }
});

$('startBtn').addEventListener('click', () => {
  if (session) { const s = session; s.stop(); }
  else startSession();
});

// ---------------------------------------------------------------- practice list
function sparkline(hist) {
  if (!hist || hist.length < 2) return '';
  const w = 60, h = 16;
  const pts = hist.map((x, i) => `${(i / (hist.length - 1)) * w},${h - (x.t / 100) * h}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function autoName(s) {
  const ex = buildExercise(s);
  const extra = shortOptions(s);
  return `${INSTRUMENTS[s.instrument].name}: ${ex.title}${extra ? ' – ' + extra : ''}`;
}

function renderList() {
  renderNav();
  const ul = $('listItems');
  ul.innerHTML = '';
  $('listEmpty').hidden = list.length > 0;
  list.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = 'item' + (item.id === activeId ? ' active' : '');
    li.tabIndex = 0;
    const h = item.history || [];
    const last = h.length ? h[h.length - 1].t : null;
    const best = h.length ? Math.max(...h.map((x) => x.t)) : null;
    li.innerHTML = `<div class="name">${esc(item.name)}</div>
      <div class="actions">
        <button data-act="edit" title="Change options" aria-label="Change options">⚙</button>
        <button data-act="rename" title="Rename" aria-label="Rename">✎</button>
        <button data-act="up" title="Move up" aria-label="Move up" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button data-act="down" title="Move down" aria-label="Move down" ${idx === list.length - 1 ? 'disabled' : ''}>↓</button>
        <button data-act="del" title="Remove" aria-label="Remove">✕</button>
      </div>
      <div class="meta">${last == null ? 'Not played yet' : `Last ${last} · Best ${best} · ${h.length} run${h.length === 1 ? '' : 's'}`} ${sparkline(h)}</div>`;
    li.addEventListener('click', (e) => {
      const act = e.target.closest('button') && e.target.closest('button').dataset.act;
      if (act) { listAction(act, item, idx); return; }
      selectItem(item);
    });
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) selectItem(item); });
    ul.appendChild(li);
  });
}

function selectItem(item, scroll = true) {
  activeId = item.id;
  editingId = null;
  setSettings(expandSettings(item.settings), { keepActive: true });
  if (scroll) $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Back / Next through the list (wraps around)
function renderNav() {
  $('listNav').hidden = list.length === 0;
  const i = list.findIndex((x) => x.id === activeId);
  $('navPos').textContent = i >= 0 ? `${i + 1} of ${list.length}` : `${list.length} saved`;
}
function stepList(dir) {
  if (!list.length) return;
  const i = list.findIndex((x) => x.id === activeId);
  const j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
  selectItem(list[j], false);
}
$('prevBtn').addEventListener('click', () => stepList(-1));
$('nextBtn').addEventListener('click', () => stepList(1));

function listAction(act, item, idx) {
  if (act === 'del') {
    if (!confirm(`Remove “${item.name}” from your list?`)) return;
    list.splice(idx, 1);
    if (activeId === item.id) activeId = null;
    if (editingId === item.id) editingId = null;
  } else if (act === 'up' && idx > 0) { [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]; }
  else if (act === 'down' && idx < list.length - 1) { [list[idx + 1], list[idx]] = [list[idx], list[idx + 1]]; }
  else if (act === 'rename') {
    const n = prompt('Name for this exercise:', item.name);
    if (n && n.trim()) { item.name = n.trim().slice(0, 120); item.autoName = false; }
  } else if (act === 'edit') {
    activeId = item.id;
    editingId = item.id;
    setSettings(expandSettings(item.settings), { keepActive: true });
    setView('all');
    $('addMsg').textContent = `Editing “${item.name}”. Change options, then press Save changes.`;
  }
  saveList(list);
  renderList();
}

$('addBtn').addEventListener('click', () => {
  const item = makeItem(settings, autoName(settings));
  list.push(item);
  activeId = item.id;
  editingId = null;
  saveList(list);
  prefs.activeId = activeId; savePrefs();
  syncForm();
  renderList();
  $('addMsg').textContent = `Added “${item.name}”. Your list has ${list.length} exercise${list.length === 1 ? '' : 's'}.`;
});

$('saveItemBtn').addEventListener('click', () => {
  const item = list.find((x) => x.id === editingId);
  if (!item) return;
  item.settings = compactSettings(settings);
  if (item.autoName) item.name = autoName(settings);
  editingId = null;
  activeId = item.id;
  saveList(list);
  syncForm();
  renderList();
  $('addMsg').textContent = `Saved “${item.name}”.`;
});

$('shareBtn').addEventListener('click', async () => {
  if (!list.length) { $('shareMsg').textContent = 'Add some exercises first.'; return; }
  const url = `${location.origin}${location.pathname}#list=${encodeShare(list)}`;
  let copied = false;
  try { await navigator.clipboard.writeText(url); copied = true; } catch { /* not allowed */ }
  $('shareMsg').innerHTML = `${copied ? 'Link copied. ' : ''}Send this link to share your list (scores are not included):<br><input type="text" readonly style="width:100%" value="${esc(url)}" onclick="this.select()">`;
});

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([exportJson(list)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'scale-practice-list.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});

$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const items = importJson(await file.text());
    addImported(items, 'file');
  } catch (err) {
    $('shareMsg').textContent = 'That file is not a practice list.';
  }
});

function addImported(items, source) {
  if (!items.length) { $('shareMsg').textContent = 'There were no exercises to import.'; return; }
  const ok = confirm(`Add ${items.length} exercise${items.length === 1 ? '' : 's'} from the ${source} to your list?`);
  if (!ok) return;
  list.push(...items);
  saveList(list);
  renderList();
  setView('list');
  $('shareMsg').textContent = `Added ${items.length} exercise${items.length === 1 ? '' : 's'}.`;
}

function checkShareLink() {
  const m = /[#&]list=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try { addImported(decodeShare(m[1]), 'shared link'); }
  catch { $('shareMsg').textContent = 'The shared link could not be read.'; }
}

// ---------------------------------------------------------------- views, tabs, theme
function setView(v) {
  prefs.view = v; savePrefs();
  document.querySelectorAll('.seg [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  $('listView').hidden = false; // the list is always visible; options open below it
  $('optionsView').hidden = v !== 'all';
  if (v === 'list' && editingId) { editingId = null; syncForm(); $('addMsg').textContent = ''; }
}
document.querySelectorAll('.seg [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

let tunerPage = null;
let calWizard = null;
function setTab(tab) {
  prefs.tab = tab; savePrefs();
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('tab-practice').hidden = tab !== 'practice';
  $('tab-tuner').hidden = tab !== 'tuner';
  if (tab === 'tuner') {
    stopSession(true);
    stopPlayback();
    if (!tunerPage) {
      tunerPage = new TunerPage({
        engine,
        getA4: a4,
        setA4: (v) => { prefs.a4 = Math.min(446, Math.max(415, Number(v) || 440)); savePrefs(); },
        getInstrument: () => settings.instrument,
        setInstrument: (inst) => { setSettings({ ...settings, instrument: inst }); if (calWizard) calWizard.refresh(); },
        beforeStart: () => { if (calWizard) calWizard.cancel(''); },
      });
      calWizard = new CalibrationWizard({
        engine,
        getInstrument: () => settings.instrument,
        getA4: a4,
        beforeStart: () => { if (tunerPage.running) tunerPage.stop(); tunerPage.stopTones(); },
        onChange: () => syncForm(),
      });
    } else { tunerPage.refresh(true); calWizard.refresh(); }
  } else {
    if (calWizard) calWizard.cancel('');
    if (tunerPage) tunerPage.deactivate();
    syncForm();
    drawScore();
  }
}
document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

const THEMES = ['auto', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('scales.theme', t); } catch { /* ignore */ }
  $('themeBtn').textContent = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' }[t];
  $('themeBtn').setAttribute('aria-label', `Colour theme: ${t}. Click to change.`);
  meter.refreshPalette();
  if (tunerPage) tunerPage.meter.refreshPalette();
  if (exercise) redrawKeepingColours();
}
let theme = (() => { try { return localStorage.getItem('scales.theme') || 'auto'; } catch { return 'auto'; } })();
$('themeBtn').addEventListener('click', () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; applyTheme(theme); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme === 'auto') applyTheme('auto'); });

// ---------------------------------------------------------------- debug: capture what the microphone hears
let captureUrl = null;
function offerCapture(sess, result) {
  const box = $('d-captureOut');
  if (!box) return;
  const cap = engine.takeCapture();
  if (!cap) return;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const meta = {
    app: 'scale-practice', kind: 'capture', version: 1, created: new Date().toISOString(),
    settings: compactSettings(settings), a4: a4(), sampleRate: cap.sampleRate, startTime: cap.startTime,
    metronomeT0: sess && sess.t0 != null ? sess.t0 : null,
    synthetic: !!(sess && sess.o.synth),
    noiseFloor: sess ? sess.noiseFloor : null,
    calibration: sess ? sess.o.calibration || null : null,
    live: result ? {
      total: result.total, intonation: result.intonation, timing: result.timing, missing: result.missing, wrong: result.wrong, extras: result.extras.length,
      notes: (sess && sess.segmenter ? sess.segmenter.notes : []).map((n) => ({ onset: +n.onset.toFixed(3), end: +n.end.toFixed(3), midi: n.midi != null ? +n.midi.toFixed(3) : null })),
    } : null,
    userAgent: navigator.userAgent,
  };
  const { blob, clipped } = encodeWav(cap.samples, cap.sampleRate, meta);
  if (captureUrl) URL.revokeObjectURL(captureUrl);
  captureUrl = URL.createObjectURL(blob);
  const name = `scale-capture-${settings.instrument}-${settings.type}-${(settings.type === 'chromatic' || settings.type === 'dim7' ? settings.start : settings.key).replace('#', 's')}-${stamp}.wav`;
  let peak = 0;
  for (let i = 0; i < cap.samples.length; i++) peak = Math.max(peak, Math.abs(cap.samples[i]));
  box.innerHTML = `<p><a class="btn primary" href="${captureUrl}" download="${name}">⬇ Download recording (${(blob.size / 1048576).toFixed(1)} MB)</a></p>
    <p class="small muted">${(cap.samples.length / cap.sampleRate).toFixed(1)} s at ${cap.sampleRate} Hz · loudest sample ${(20 * Math.log10(peak + 1e-9)).toFixed(1)} dBFS${clipped ? ` · ⚠ ${clipped} samples clipped – move the speaker or instrument a little further away` : ''}. The file contains only this recording and the exercise settings.</p>`;
}

// ---------------------------------------------------------------- debug (synthetic performance)
function setupDebug() {
  if (!DEBUG) return;
  const p = $('debugPanel');
  p.hidden = false;
  p.innerHTML = `<b>Test mode – record what the microphone hears</b>
    <label class="check"><input type="checkbox" id="d-capture" ${DEBUG_MODE === 'capture' ? 'checked' : ''}> Keep a recording of each run so it can be downloaded for fault-finding</label>
    <div id="d-captureOut"></div>
    <b>Test mode – synthetic performance</b>
    <label class="check"><input type="checkbox" id="d-use" ${DEBUG_MODE === 'synth' ? 'checked' : ''}> Use a synthetic performance instead of the microphone</label>
    <label class="check"><input type="checkbox" id="d-monitor" checked> Play it through the speakers</label>
    <div class="field"><label for="d-bpm">Tempo ♩ =</label><input type="number" id="d-bpm" value="80"></div>
    <div class="field"><label for="d-detune">Random detune (cents SD)</label><input type="number" id="d-detune" value="8"></div>
    <div class="field"><label for="d-jitter">Timing jitter %</label><input type="number" id="d-jitter" value="4"></div>
    <div class="field"><label for="d-vibrato">Vibrato ± cents</label><input type="number" id="d-vibrato" value="0"></div>
    <div class="field"><label for="d-missing">Missing notes (#, comma)</label><input type="text" id="d-missing" value=""></div>
    <div class="field"><label for="d-extra">Extra note after (#, comma)</label><input type="text" id="d-extra" value=""></div>`;
}

// ---------------------------------------------------------------- start up
function init() {
  setupDebug();
  applyTheme(theme);
  syncForm();
  updateExercise();
  renderList();
  setView(prefs.view || (list.length ? 'list' : 'all'));
  setTab(prefs.tab === 'tuner' ? 'tuner' : 'practice');
  checkShareLink();
}

if (window.Vex) init();
else window.addEventListener('load', init);
