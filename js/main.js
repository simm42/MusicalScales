// Page wiring: settings form, exercise display, practice runs, list, tuner tab, theme.

import { INSTRUMENTS, instrumentInfo, VOICE_TYPES, voiceSetup, classifyVoice, isBowed } from './instruments.js';
import {
  EXERCISE_TYPES, DEFAULT_SETTINGS, RANGE_LABELS, EXERCISE_FIELDS, GLOBAL_FIELDS, normalise, buildExercise, isPlayable,
  typesForInstrument, rangesFor, keyListFor, pickFields, slurGroup, SOLFEGE_SYSTEMS, typeLabel,
} from './exercises.js';
import { getProfile, setProfile, getProfiles, OTHER_LIMITS } from './profiles.js';
import { syllablesFor } from './solfege.js';
import { buildSequence, RHYTHMS, isCrotchetRhythm } from './sequence.js';
import { loadResults, saveResults, recordRun, makeRun, migrateHistory, cardStats, compactAll } from './results.js';
import { ResultsPage } from './ui/resultsPage.js';
import { pcName, parsePc, noteName, spellMidi } from './theory.js';
import { renderScore, renderKeySignature, markNote } from './notation.js';
import { describeOptions, shortOptions } from './settingsText.js';
import { precisionAt, linearScore, scoreClass } from './precision.js';
import { AudioEngine, MicError } from './audio/mic.js';
import { PracticeSession } from './practice.js';
import { Player } from './playback.js';
import { encodeWav } from './audio/wav.js';
import { APP_VERSION } from './version.js';
import { SEG } from './segmenter.js';
import { RUN } from './practice.js';
import { scoresAtLevels } from './scoring.js';
import { Meter, fmtCents } from './ui/meter.js';
import { renderSummary } from './ui/summary.js';
import { TunerPage } from './ui/tunerPage.js';
import { CalibrationWizard } from './ui/calibrationWizard.js';
import { MetronomeCard } from './ui/metronomeCard.js';
import { noteIcon, RHYTHM_ICONS } from './ui/noteIcons.js';
import { startAnalytics, ANALYTICS_ON } from './analytics.js';
import { setupPwa } from './pwa.js';
import { makeBackup, readBackup, restoreBackup, backupFilename } from './backup.js';
import { loadCalibration, describeCalibration } from './calibration.js';
import {
  loadList, saveList, makeItem, expandSettings, compactSettings, sameSettings,
  encodeShare, decodeShare, exportJson, importJson,
} from './practiceList.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'scales.prefs.v1';

// ---------------------------------------------------------------- state
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } }
const prefs = { a4: 440, view: null, tab: 'practice', ...loadPrefs() };
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } }

// Global (practice, display, listening) options live in prefs.global; the
// exercise itself comes from the selected syllabus item or the Config form.
if (!prefs.global) {
  prefs.global = pickFields(normalise({ ...DEFAULT_SETTINGS, ...(prefs.settings || {}) }), GLOBAL_FIELDS);
  if ((prefs.settings || {}).slur > 1) prefs.global.slurred = true; // earlier versions: slurring was part of the exercise
}
let settings = normalise({ ...DEFAULT_SETTINGS, ...(prefs.settings || {}), ...prefs.global });
// the other instrument as set for the current exercise
if (settings.instrument === 'other') setProfile('other', settings.otherSetup);
let list = loadList();
// syllabus items for the other instrument made before its setup was kept in the item: take this device's
if (list.some((x) => x.settings.instrument === 'other' && !x.settings.otherSetup)) {
  list.forEach((x) => { if (x.settings.instrument === 'other') x.settings = compactSettings(expandSettings(x.settings)); });
  saveList(list);
}
let results = compactAll(loadResults());
// scores kept inside items by earlier versions move to the results store
if (list.some((x) => migrateHistory(results, x))) { saveList(list); saveResults(results); }
let activeId = prefs.activeId && list.some((x) => x.id === prefs.activeId) ? prefs.activeId : null;
let editingId = null;
let exercise = null;
let seq = null;
let rendered = { arrowTargets: [] };
let session = null;
let lastResult = null;
let arrowIndex = 0;
let syllables = null; // sol-fa syllable per note when singing

const engine = new AudioEngine();
const player = new Player();
const meter = new Meter($('liveTuner'));
const DEBUG_MODE = new URLSearchParams(location.search).get('debug'); // 'synth' | 'capture' | other
const DEBUG = DEBUG_MODE != null;

const a4 = () => Math.min(446, Math.max(415, Number(prefs.a4) || 440));
const prec = () => precisionAt(settings.precision, settings.instrument);
const isVoice = () => settings.instrument === 'voice';
const verb = () => (isVoice() ? 'sing' : 'play');
const idleStatus = () => (isVoice() ? 'Press Start, wait for “Sing now”, then sing.' : 'Press Start, wait for “Play now”, then play.');
const instName = (id) => instrumentInfo(id).name;

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
  fillSelect(sel('instrument'), Object.keys(INSTRUMENTS).map((v) => ({ value: v, label: instName(v) })), s.instrument);
  syncInstrumentFields();
  fillSelect(sel('type'), typesForInstrument(s.instrument).map((v) => ({ value: v, label: typeLabel(v, s.instrument) })), s.type);
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
  for (const k of ['repeatTop', 'hint', 'vibrato', 'metronome']) sel(k).checked = !!s[k];
  // singers always get vibrato-tolerant listening, and sing every note to its own syllable
  sel('vibrato').closest('label').hidden = isVoice();
  sel('slur').closest('.field').hidden = isVoice();
  $('slurNote').hidden = isVoice();
  $('f-solfege').hidden = !isVoice();
  $('f-solfegeLetters').hidden = !isVoice();
  sel('solfegeLetters').checked = !!s.solfegeLetters;
  fillSelect(sel('solfege'), Object.entries(SOLFEGE_SYSTEMS).map(([value, label]) => ({ value, label })), s.solfege);
  // notes per bow when the Practice page's "Slurred" switch is on
  const per = isBowed(s.instrument) ? 'to a bow' : 'to a slur';
  const slurOpts = t.slurs.length
    ? t.slurs.map((n, k) => ({ value: k === 0 ? 0 : n, label: `${n} notes ${per}${k === 0 ? ' (usual)' : ''}` }))
    : [{ value: 0, label: t.doubleStop ? 'Separate bows only' : 'Not slurred' }];
  fillSelect(sel('slur'), slurOpts, t.slurs.length && s.slur === t.slurs[0] ? 0 : s.slur);
  sel('slur').disabled = !t.slurs.length;
  sel('display').value = s.display;
  sel('clefMode').value = s.clefMode;
  sel('bpm').value = s.bpm;
  sel('precision').value = s.precision;
  $('precisionName').textContent = prec().name;
  sel('a4').value = a4();
  $('calInfo').textContent = describeCalibration(loadCalibration(s.instrument), instName(s.instrument));
  $('saveItemBtn').hidden = !editingId;
  $('addBtn').textContent = editingId ? 'Add as new' : 'Add to syllabus';
  renderRhythmBar();
  // name field: empty means "use the automatic name", shown as the placeholder
  const editing = editingId && list.find((x) => x.id === editingId);
  $('o-itemName').placeholder = autoName(s);
  if (document.activeElement !== $('o-itemName')) $('o-itemName').value = editing && !editing.autoName ? editing.name : '';
}

form.addEventListener('change', (e) => {
  const el = e.target;
  if (!el.name && el.id !== 'o-a4') return;
  if (el.id === 'o-a4') { prefs.a4 = Math.min(446, Math.max(415, Number(el.value) || 440)); savePrefs(); syncForm(); return; }
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (['slur', 'bpm', 'precision'].includes(el.name)) v = Number(v);
  if (GLOBAL_FIELDS.includes(el.name)) { setGlobal({ [el.name]: v }); return; }
  const next = { ...settings };
  if (el.name === 'key') next[EXERCISE_TYPES[settings.type].keyKind === 'start' ? 'start' : 'key'] = v;
  else next[el.name] = v;
  if (el.name === 'instrument') Object.assign(next, playableRange(next));
  setSettings(next);
});

/** After a change of instrument or range, keep a range that fits (a voice may not manage two octaves). */
function playableRange(s) {
  const n = normalise(s);
  if (isPlayable(n, {})) return {};
  for (const r of ['1', '6th', '2', '12th', '3']) {
    if (rangesFor(n.instrument, n.type).includes(r) && isPlayable(n, { range: r })) return { range: r };
    if (rangesFor(n.instrument, n.type).includes(r) && n.octaveUp && isPlayable(n, { range: r, octaveUp: false })) return { range: r, octaveUp: false };
  }
  return {};
}

// ---------------------------------------------------------------- voice and other instrument (device profiles)
const NOTE_OPTIONS = (() => {
  const out = [];
  for (let m = 21; m <= 108; m++) {
    const sh = spellMidi(m, 'sharp'), fl = spellMidi(m, 'flat');
    let label = noteName(sh, { octave: true });
    if (sh.a) label += ' / ' + noteName(fl, { octave: true });
    if (m === 60) label += ' (middle C)';
    out.push({ value: m, label });
  }
  return out;
})();

const TRANSPOSE_HINTS = {
  12: 'piccolo, glockenspiel, xylophone', 3: 'E♭ clarinet', 2: 'D trumpet', 0: 'concert pitch: flute, oboe, piano…',
  '-2': 'B♭: clarinet, trumpet, soprano sax', '-3': 'A: clarinet', '-5': 'G: alto flute', '-7': 'F: horn, cor anglais',
  '-9': 'E♭: alto sax, tenor horn', '-12': 'guitar, bass guitar, contrabassoon', '-14': 'B♭: tenor sax, bass clarinet, euphonium (treble clef)', '-21': 'E♭: baritone sax',
};
function tonesText(semis) {
  const t = Math.abs(semis) / 2;
  const whole = Math.floor(t), half = t - whole > 0;
  const num = whole ? `${whole}${half ? '½' : ''}` : '½';
  return `${num} tone${t > 1 ? 's' : ''}`;
}
const TRANSPOSE_OPTIONS = (() => {
  const out = [];
  for (let k = 12; k >= -24; k--) {
    const hint = TRANSPOSE_HINTS[k];
    const label = k === 0 ? 'None – sounds as written' : `Sounds ${tonesText(k)} ${k > 0 ? 'higher' : 'lower'} (${k > 0 ? '+' : '−'}${Math.abs(k)} semitone${Math.abs(k) === 1 ? '' : 's'})`;
    out.push({ value: k, label: hint ? `${label} – ${hint}` : label });
  }
  return out;
})();

function syncInstrumentFields() {
  const inst = settings.instrument;
  $('f-voice').hidden = inst !== 'voice';
  $('f-other').hidden = inst !== 'other';
  if (inst === 'voice') {
    const v = voiceSetup();
    const info = instrumentInfo('voice');
    const p = getProfile('voice');
    const range = `${noteName(spellMidi(v.low, 'sharp'), { octave: true })}–${noteName(spellMidi(v.high, 'sharp'), { octave: true })}`;
    const clef = `${v.type.clef} clef${info.clefAnnotation ? ', sung an octave lower than written' : ''}`;
    $('voiceInfo').textContent = v.measured
      ? `Your range: ${range} (measured ${new Date(v.date || Date.now()).toLocaleDateString()}). ${v.type.name} – ${clef}.`
      : `Range not measured yet – using a typical ${v.type.name.toLowerCase()} range (${range}), ${clef}. Measure your own range on the Tuner tab.`;
    const auto = v.measured ? `From my range (${classifyVoice(p.low, p.high).name})` : 'Mezzo-soprano (typical range, until measured)';
    fillSelect($('o-voiceType'), [{ value: '', label: auto }, ...VOICE_TYPES.map((t) => ({
      value: t.id, label: `${t.name} (${noteName(spellMidi(t.low, 'sharp'), { octave: true })}–${noteName(spellMidi(t.high, 'sharp'), { octave: true })})`,
    }))], p.override || '');
    $('measureVoiceBtn').textContent = v.measured ? 'Measure my range again' : 'Measure my range';
  }
  if (inst === 'other') {
    const p = getProfile('other');
    if (document.activeElement !== $('o-otherName')) $('o-otherName').value = p.name || '';
    // the highest note is always at least an octave above the lowest
    fillSelect($('o-otherLow'), NOTE_OPTIONS.filter((o) => o.value <= OTHER_LIMITS.highest - OTHER_LIMITS.minSpan), p.low);
    fillSelect($('o-otherHigh'), NOTE_OPTIONS.filter((o) => o.value >= p.low + OTHER_LIMITS.minSpan), p.high);
    fillSelect($('o-otherTranspose'), TRANSPOSE_OPTIONS, p.transpose);
    const autoClef = instrumentInfo('other').clef;
    fillSelect($('o-otherClef'), [
      { value: 'auto', label: `Automatic (${p.clef === 'auto' ? autoClef : 'from the range'})` },
      { value: 'treble', label: 'Treble' }, { value: 'alto', label: 'Alto' }, { value: 'tenor', label: 'Tenor' }, { value: 'bass', label: 'Bass' },
    ], p.clef || 'auto');
  }
}

/** A device profile changed: everything that depends on the instrument's range is rebuilt. */
function profileChanged() {
  // the other instrument's setup is part of the exercise: a syllabus item made for
  // a different setup is no longer the one being practised (its results stay apart)
  const other = settings.instrument === 'other';
  const next = other ? { ...settings, otherSetup: getProfile('other') } : settings;
  setSettings({ ...next, ...playableRange(next) }, { keepActive: !other });
  if (tunerPage) tunerPage.refresh(true);
  if (calWizard) calWizard.refresh();
  if (resultsPage) resultsPage.invalidate();
}

$('o-voiceType').addEventListener('change', () => { setProfile('voice', { override: $('o-voiceType').value }); profileChanged(); });
$('measureVoiceBtn').addEventListener('click', () => { setTab('tuner'); $('calCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('o-otherName').addEventListener('change', () => { setProfile('other', { name: $('o-otherName').value.trim().slice(0, 40) }); profileChanged(); });
$('o-otherLow').addEventListener('change', () => {
  const before = getProfile('other').high;
  const p = setProfile('other', { low: Number($('o-otherLow').value) }); // raises the highest note if needed
  $('otherMsg').textContent = p.high !== before ? 'The highest note was raised to keep it at least an octave above the lowest.' : '';
  profileChanged();
});
$('o-otherHigh').addEventListener('change', () => {
  $('otherMsg').textContent = '';
  setProfile('other', { high: Number($('o-otherHigh').value) });
  profileChanged();
});
$('o-otherTranspose').addEventListener('change', () => { setProfile('other', { transpose: Number($('o-otherTranspose').value) }); profileChanged(); });
$('o-otherClef').addEventListener('change', () => { setProfile('other', { clef: $('o-otherClef').value }); profileChanged(); });
sel('precision').addEventListener('input', () => { $('precisionName').textContent = precisionAt(sel('precision').value).name; });

/** Change global (practice/display/listening) options – they apply to every exercise. */
function setGlobal(patch) {
  if ('precision' in patch && resultsPage) resultsPage.invalidate();
  prefs.global = pickFields(normalise({ ...settings, ...patch }), GLOBAL_FIELDS);
  setSettings({ ...settings, ...prefs.global }, { keepActive: true });
}

function setSettings(next, { keepActive = false } = {}) {
  settings = normalise(next);
  // everything that reads the device's other instrument follows the exercise's setup
  if (settings.instrument === 'other') setProfile('other', settings.otherSetup);
  prefs.global = pickFields(settings, GLOBAL_FIELDS);
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
  $('exTitle').textContent = `${instName(settings.instrument)}: ${exercise.title}`;
  syllables = syllablesFor(exercise);
  $('exOptions').textContent = describeOptions(settings);
  // the full score already shows the rhythm, long notes and slurs
  $('exOptions').hidden = settings.display === 'score';
  $('exInvalid').hidden = exercise.ok;
  if (!exercise.ok) $('exInvalid').textContent = exercise.reason + ' Choose fewer octaves or a lower starting octave.';
  $('startBtn').disabled = !exercise.ok;
  $('playBtn').disabled = !exercise.ok;
  lastResult = null;
  $('summary').innerHTML = '';
  setStatus(idleStatus());
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
    if (settings.display === 'score') rendered = renderScore(scoreEl, exercise, seq, { clefMode: settings.clefMode, compact: isPhoneLandscape(), syllables });
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
  followScroll(t);
}

/** Keep the current note visible: scroll the score box down (and across) as it is played. */
function followScroll(t) {
  const box = $('scoreWrap');
  if (box.scrollHeight <= box.clientHeight + 4 && box.scrollWidth <= box.clientWidth + 4) return;
  const wantTop = Math.max(0, t.y - 40 - box.clientHeight * 0.15);
  const visibleTop = box.scrollTop, visibleBottom = box.scrollTop + box.clientHeight;
  const top = (t.y - 40 < visibleTop || t.y + 120 > visibleBottom) ? wantTop : box.scrollTop;
  const left = (t.x < box.scrollLeft + 20 || t.x > box.scrollLeft + box.clientWidth - 20) ? Math.max(0, t.x - box.clientWidth / 3) : box.scrollLeft;
  if (top === box.scrollTop && left === box.scrollLeft) return;
  box.scrollTo({ top, left, behavior: 'smooth' });
  // some browsers/power-saving modes don't animate: make sure it gets there
  clearTimeout(followScroll.timer);
  followScroll.timer = setTimeout(() => {
    if (Math.abs(box.scrollTop - Math.min(top, box.scrollHeight - box.clientHeight)) > 2) box.scrollTop = top;
    if (Math.abs(box.scrollLeft - Math.min(left, box.scrollWidth - box.clientWidth)) > 2) box.scrollLeft = left;
  }, 400);
}

// Redraw only when the width changes: phone address bars collapsing fire
// height-only resizes, and a redraw would wipe the live note colours.
// Watching the score box itself also catches rotation and iPhone safe-area changes.
let resizeTimer = null;
let lastWidth = $('scoreWrap').clientWidth;
const onScoreBoxResize = () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = $('scoreWrap').clientWidth;
    if (!w || w === lastWidth || settings.display !== 'score') return;
    lastWidth = w;
    redrawKeepingColours();
  }, 200);
};
if (window.ResizeObserver) new ResizeObserver(onScoreBoxResize).observe($('scoreWrap'));
else window.addEventListener('resize', onScoreBoxResize);

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

/** Note name, with its sol-fa syllable when singing ("G4 · Sol"). */
function labelNote(n, octave = true) {
  const name = noteName(n, { octave });
  return syllables ? `${name} · ${syllables(n)}` : name;
}

/** Name on the tuner gauge: when singing, the syllable – with the letter name if that option is on. */
function gaugeNote(n) {
  if (!syllables) return noteName(n, { octave: true });
  return settings.solfegeLetters ? `${syllables(n)} · ${noteName(n, { octave: true })}` : syllables(n);
}

function liveNoteName(midiSounding) {
  const written = Math.round(midiSounding) - exercise.info.transpose;
  const ev = seq.events[arrowIndex];
  if (ev) {
    const k = ev.writtenMidis.indexOf(written);
    if (k >= 0) return gaugeNote(ev.notes[k]);
  }
  return gaugeNote(spellMidi(written, exercise.fifths < 0 ? 'flat' : 'sharp'));
}

function hintText() {
  if (!settings.hint || settings.display === 'score') return '';
  const ev = seq.events[arrowIndex];
  if (!ev) return '';
  if (syllables) return `Next: ${syllables(ev.notes[0])}${settings.solfegeLetters ? ` (${noteName(ev.notes[0])})` : ''}`;
  return `Next: ${ev.notes.map((n) => noteName(n)).join(' + ')}`;
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
    // a sung performance: a consonant before each note and a scoop up into it
    sung: isVoice() ? true : null,
    vibratoCents: isVoice() ? Math.max(Number(v('d-vibrato')) || 0, 30) : Number(v('d-vibrato')) || 0,
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
        if (st === 'listening') setStatus(isVoice() ? 'Sing now' : 'Play now', true);
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
  // a run that ended by itself: ignore a late tap on Stop (it would start a new run)
  const auto = finished && finished.log && finished.log.endReason && finished.log.endReason !== 'Stop pressed';
  if (auto) {
    const b = $('startBtn');
    b.disabled = true;
    clearTimeout(finishSession.timer);
    finishSession.timer = setTimeout(() => { b.disabled = !exercise || !exercise.ok; }, 1000);
  }
  $('arrow').hidden = true;
  meter.clear();
  offerCapture(finished, result);
  if (!result) { setStatus('Stopped.'); return; }
  const played = result.perNote.some((r) => r.status !== 'missing');
  if (!played) { setStatus(`No notes were heard. Check the microphone and ${verb()} a little louder, or move closer.`); return; }
  setStatus(`Finished – score ${Math.round(result.total)} / 100.`);
  lastResult = result;
  renderSummary($('summary'), { result, seq, prec: prec(), settings, labels: syllables ? seq.events.map((ev) => ev.notes.map((n) => labelNote(n)).join(' + ')) : null });
  colourAll(result);
  showSummary();
  const item = activeId && list.find((x) => x.id === activeId);
  if (item && sameSettings(expandSettings(item.settings), settings)) {
    const run = makeRun(result, seq, settings.rhythm, Date.now(), (n) => labelNote(n), scoresAtLevels(result, undefined, (lv) => precisionAt(lv, settings.instrument)));
    run.level = settings.precision;
    // notes per bow, 0 = separate bows; the voice and other instruments say it in a word
    run.slurred = isVoice() ? 'sung' : slurGroup(settings) || (isBowed(settings.instrument) ? 0 : 'detached');
    run.vib = !!settings.vibrato;
    run.met = !!settings.metronome;
    recordRun(results, item.id, run);
    saveResults(results);
    renderList();
    if (resultsPage) resultsPage.invalidate();
    setStatus(`Finished – score ${Math.round(result.total)} / 100. Saved to the results for “${item.name}”.`);
  }
}

function stopSession(silent = false) {
  if (!session) return;
  const s = session;
  session = null;
  if (silent) { s.abort(); $('startBtn').textContent = 'Start'; setStatus(idleStatus()); meter.clear(); }
  else s.stop();
}

// ---------------------------------------------------------------- play the exercise
function stopPlayback() {
  if (!player.playing) return;
  player.stop();
  $('playBtn').textContent = '▶ Play';
  $('arrow').hidden = true;
  meter.clear();
  setStatus(idleStatus());
}

$('playBtn').addEventListener('click', async () => {
  if (player.playing) { stopPlayback(); return; }
  if (!exercise.ok) return;
  stopSession(true);
  player.prime(); // must happen inside the tap (iOS)
  hideTabBar();
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
        meter.setReadout(ev.notes.map((n) => gaugeNote(n)).join(' + '), '', '');
      },
      onEnd: () => { $('playBtn').textContent = '▶ Play'; $('arrow').hidden = true; meter.clear(); setStatus('Now you try: press Start.'); },
    });
    await playing;
    if (player.playing) setStatus(isVoice() ? `Playing the exercise at ♩ = ${settings.bpm}…` : `Playing the exercise at ♩ = ${settings.bpm} on the ${/^[A-Z][a-z ]*$/.test(instName(settings.instrument)) ? instName(settings.instrument).toLowerCase() : instName(settings.instrument)}…`);
  } catch (e) {
    $('playBtn').textContent = '▶ Play';
    setStatus('Could not play: ' + (e && e.message));
  }
});

$('startBtn').addEventListener('click', () => {
  if (session) { const s = session; s.stop(); }
  else { engine.unlock(DEBUG && $('d-use') && $('d-use').checked ? 'playback' : 'play-and-record'); startSession(); hideTabBar(); }
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
  return `${ex.info.name}: ${ex.title}${extra ? ' – ' + extra : ''}`;
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
    const st = cardStats(results, item.id, settings.precision);
    const h = st.trend.map((t) => ({ t }));
    const last = st.last;
    const best = st.best;
    li.innerHTML = `<div class="name">${esc(item.name)}</div>
      <div class="actions">
        <button data-act="edit" title="Change options" aria-label="Change options">⚙</button>
        <button data-act="rename" title="Rename" aria-label="Rename">✎</button>
        <button data-act="up" title="Move up" aria-label="Move up" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button data-act="down" title="Move down" aria-label="Move down" ${idx === list.length - 1 ? 'disabled' : ''}>↓</button>
        <button data-act="del" title="Remove" aria-label="Remove">✕</button>
      </div>
      <div class="meta">${last == null ? 'Not played yet' : `Last ${last} · Best ${best} · ${st.count} run${st.count === 1 ? '' : 's'}`} ${sparkline(h)}</div>`;
    li.addEventListener('click', (e) => {
      const act = e.target.closest('button') && e.target.closest('button').dataset.act;
      if (act) { listAction(act, item, idx); return; }
      selectItem(item);
    });
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === li) selectItem(item); });
    ul.appendChild(li);
  });
}

function selectItem(item, goPractise = true) {
  activeId = item.id;
  editingId = null;
  setSettings({ ...expandSettings(item.settings), ...prefs.global }, { keepActive: true });
  if (goPractise && !isWide()) setTab('practice');
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
    if (!confirm(`Remove “${item.name}” from the syllabus? Its results will be deleted too.`)) return;
    list.splice(idx, 1);
    delete results[item.id];
    saveResults(results);
    if (resultsPage) resultsPage.invalidate();
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
    setSettings({ ...expandSettings(item.settings), ...prefs.global }, { keepActive: true });
    $('optionsView').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('addMsg').textContent = `Editing “${item.name}”. Change options, then press Save changes.`;
  }
  saveList(list);
  renderList();
}

$('addBtn').addEventListener('click', () => {
  const typed = $('o-itemName').value.trim().slice(0, 120);
  const item = makeItem(settings, typed || autoName(settings), !typed);
  $('o-itemName').value = '';
  list.push(item);
  activeId = item.id;
  editingId = null;
  saveList(list);
  prefs.activeId = activeId; savePrefs();
  syncForm();
  renderList();
  $('addMsg').textContent = `Added “${item.name}”. Your syllabus has ${list.length} exercise${list.length === 1 ? '' : 's'}.`;
  if (resultsPage) resultsPage.invalidate();
});

$('saveItemBtn').addEventListener('click', () => {
  const item = list.find((x) => x.id === editingId);
  if (!item) return;
  item.settings = compactSettings(settings);
  const typed = $('o-itemName').value.trim().slice(0, 120);
  if (typed) { item.name = typed; item.autoName = false; }
  else { item.name = autoName(settings); item.autoName = true; }
  $('o-itemName').value = '';
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
  $('shareMsg').innerHTML = `${copied ? 'Link copied. ' : ''}Send this link to share your syllabus (scores are not included):<br><input type="text" readonly style="width:100%" value="${esc(url)}" onclick="this.select()">`;
});

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([exportJson(list, results)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'scale-practice-syllabus.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});

// ---------------------------------------------------------------- move to another device (everything in one file)
/** Save a file: the share sheet on phones (Save to Files, AirDrop, email…), else a download. */
async function saveFile(text, name, type) {
  const file = typeof File === 'function' ? new File([text], name, { type }) : null;
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    // the file only: a title or text would be saved as an extra .txt file by "Save to Files"
    try { await navigator.share({ files: [file] }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; /* else fall back to a download */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return 'downloaded';
}

$('backupBtn').addEventListener('click', async () => {
  const name = backupFilename(prefs.studentName);
  const how = await saveFile(makeBackup(localStorage, { appVersion: APP_VERSION }), name, 'application/json');
  $('backupMsg').textContent = how === 'cancelled' ? '' : how === 'shared'
    ? `Backup ready: ${name}. Open it with Import everything on the new device.`
    : `Saved ${name} (usually in Downloads). Open it with Import everything on the new device.`;
});

$('restoreBtn').addEventListener('click', () => $('restoreFile').click());
$('restoreFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let read;
  try { read = readBackup(await file.text()); } catch (err) { $('backupMsg').textContent = err.message; return; }
  const s = read.summary;
  const when = s.exported && !isNaN(s.exported) ? s.exported.toLocaleString() : 'an unknown date';
  const ok = confirm(`Replace everything on this device with the backup${s.student ? ` for ${s.student}` : ''} from ${when}?\n\n`
    + `It has ${s.exercises} exercise${s.exercises === 1 ? '' : 's'} in the syllabus and ${s.runs} run${s.runs === 1 ? '' : 's'} of results.\n\n`
    + 'The syllabus, results and settings on this device now will be replaced. This device\'s microphone calibrations are kept.');
  if (!ok) return;
  stopSession(true);
  stopPlayback();
  try { restoreBackup(read.backup, localStorage); } catch { $('backupMsg').textContent = 'Sorry – the backup could not be saved on this device (storage full or blocked).'; return; }
  // start afresh from the restored data (without any #list= link, which would be imported again)
  location.replace(location.pathname + location.search);
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
    $('shareMsg').textContent = 'That file is not a syllabus.';
  }
});

function addImported(items, source) {
  if (!items.length) { $('shareMsg').textContent = 'There were no exercises to import.'; return; }
  const ok = confirm(`Add ${items.length} exercise${items.length === 1 ? '' : 's'} from the ${source} to your syllabus?`);
  if (!ok) return;
  for (const it of items) {
    if (it.importedResults) { results[it.id] = it.importedResults; delete it.importedResults; }
    migrateHistory(results, it);
  }
  compactAll(results);
  saveResults(results);
  list.push(...items);
  saveList(list);
  renderList();
  if (resultsPage) resultsPage.invalidate();
  $('shareMsg').textContent = `Added ${items.length} exercise${items.length === 1 ? '' : 's'}.`;
}

function checkShareLink() {
  const m = /[#&]list=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try { addImported(decodeShare(m[1]), 'shared link'); }
  catch { $('shareMsg').textContent = 'The shared link could not be read.'; }
}

// ---------------------------------------------------------------- student name (Config; used for PDF results)
$('studentName').value = prefs.studentName || '';
$('studentName').addEventListener('change', () => { prefs.studentName = $('studentName').value.trim().slice(0, 80); savePrefs(); });

// ---------------------------------------------------------------- rhythm buttons (Practice page)
function renderRhythmBar() {
  const bar = $('rhythmBar');
  if (!bar.childElementCount) {
    for (const [id, r] of Object.entries(RHYTHMS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'radio');
      b.dataset.rhythm = id;
      if (RHYTHM_ICONS[id]) { b.innerHTML = noteIcon(RHYTHM_ICONS[id]); b.setAttribute('aria-label', r.label); }
      else b.textContent = r.short;
      b.title = r.label;
      b.addEventListener('click', () => { if (settings.rhythm !== id) setGlobal({ rhythm: id }); });
      bar.appendChild(b);
    }
  }
  for (const b of bar.children) if (b.dataset.rhythm) b.setAttribute('aria-checked', String(b.dataset.rhythm === settings.rhythm));
  // Slurred / separate bows switch, to the right of the rhythms
  let sw = $('slurBtn');
  if (!sw) {
    sw = document.createElement('button');
    sw.type = 'button';
    sw.id = 'slurBtn';
    sw.className = 'chip toggle';
    sw.addEventListener('click', () => setGlobal({ slurred: !settings.slurred }));
    bar.appendChild(sw);
  }
  const t = EXERCISE_TYPES[settings.type];
  const can = t.slurs.length > 0 && isCrotchetRhythm(settings.rhythm);
  const per = slurGroup({ ...settings, slurred: true });
  sw.hidden = isVoice(); // every sung note has its own syllable
  sw.disabled = !can;
  sw.setAttribute('aria-pressed', String(!!settings.slurred && can));
  sw.textContent = settings.slurred && can ? `⌒ Slurred ${per}` : '⌒ Slurred';
  sw.title = !t.slurs.length ? 'This exercise is played with separate bows'
    : !isCrotchetRhythm(settings.rhythm) ? 'Slurs apply to the crotchet rhythms'
    : settings.slurred ? `Slurred, ${per} notes to a bow – tap for separate bows` : 'Separate bows – tap to slur';
}

// ---------------------------------------------------------------- landscape phones: let the tab bar scroll away
const phoneLandscapeQuery = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
function isPhoneLandscape() { return phoneLandscapeQuery.matches; }
/** Scroll so the practice box starts at the top of the screen (the tab bar goes out of view). */
function hideTabBar() {
  if (!isPhoneLandscape() || $('tab-practice').hidden) return;
  const top = $('tab-practice').getBoundingClientRect().top + window.scrollY - 4;
  if (Math.abs(window.scrollY - top) > 2) window.scrollTo({ top, behavior: 'smooth' });
  setTimeout(() => { if (isPhoneLandscape() && Math.abs(window.scrollY - top) > 2) window.scrollTo(0, top); }, 450);
}
/** Landscape phones: the score fills the screen, so bring the summary into view after a run. */
function showSummary() {
  if (!isPhoneLandscape() || $('tab-practice').hidden) return;
  const top = $('summary').getBoundingClientRect().top + window.scrollY - 6;
  window.scrollTo({ top, behavior: 'smooth' });
  setTimeout(() => { if (isPhoneLandscape() && Math.abs(window.scrollY - top) > 40) window.scrollTo(0, top); }, 600);
}
phoneLandscapeQuery.addEventListener('change', () => {
  if (settings.display === 'score') redrawKeepingColours();
  setTimeout(hideTabBar, 300);
});

// ---------------------------------------------------------------- tabs (Practice | Config | Results | Tuner)
const wideQuery = window.matchMedia('(min-width: 1600px)');
const isWide = () => wideQuery.matches;
let resultsPage = null;

let tunerPage = null;
let calWizard = null;
let metroCard = null;
function setTab(tab) {
  // on very wide screens Practice and Config share one page
  if (tab === 'config' && isWide()) tab = 'practice';
  prefs.tab = tab; savePrefs();
  const wide = isWide();
  document.querySelector('.tabs [data-tab="config"]').classList.toggle('wide-hidden', wide);
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  const pc = tab === 'practice' || tab === 'config';
  $('pcLayout').hidden = !pc;
  $('pcLayout').classList.toggle('both', wide);
  $('tab-practice').hidden = tab !== 'practice';
  $('tab-config').hidden = !(tab === 'config' || (wide && tab === 'practice'));
  $('tab-results').hidden = tab !== 'results';
  $('tab-tuner').hidden = tab !== 'tuner';
  if (tab !== 'practice') { stopSession(true); stopPlayback(); }
  else setTimeout(hideTabBar, 50);
  if (tab === 'results') {
    if (!resultsPage) {
      resultsPage = new ResultsPage({
        getList: () => list,
        getResults: () => results,
        getStudentName: () => ($('studentName').value.trim() || prefs.studentName || ''),
        getPrecision: () => settings.precision,
        // note names for runs saved before they were stored: rebuild the exercise as it was played
        labelsFor: (item, run) => {
          const s = normalise({ ...expandSettings(item.settings), rhythm: run.rhythm });
          const ex = buildExercise(s);
          const sq = buildSequence(ex);
          const syl = syllablesFor(ex);
          return sq.events.map((ev) => ev.notes.map((n) => noteName(n, { octave: true }) + (syl ? ' · ' + syl(n) : '')).join(' + '));
        },
        setStudentName: (n) => { prefs.studentName = n; savePrefs(); $('studentName').value = n; },
      });
    }
    resultsPage.show();
  }
  if (tab === 'tuner') {
    stopSession(true);
    stopPlayback();
    if (!tunerPage) {
      tunerPage = new TunerPage({
        engine,
        getA4: a4,
        setA4: (v) => { prefs.a4 = Math.min(446, Math.max(415, Number(v) || 440)); savePrefs(); },
        getInstrument: () => settings.instrument,
        setInstrument: (inst) => { const next = { ...settings, instrument: inst }; setSettings({ ...next, ...playableRange(next) }); if (calWizard) calWizard.refresh(); },
        beforeStart: () => { if (calWizard) calWizard.cancel(''); },
      });
      metroCard = new MetronomeCard({
        engine,
        getBpm: () => settings.bpm,
        setBpm: (bpm) => setGlobal({ bpm }),
      });
      calWizard = new CalibrationWizard({
        engine,
        getInstrument: () => settings.instrument,
        getA4: a4,
        beforeStart: () => { if (tunerPage.running) tunerPage.stop(); tunerPage.stopTones(); if (metroCard && metroCard.running) metroCard.stop(); },
        onChange: () => { syncForm(); updateExercise(); if (tunerPage) tunerPage.refresh(true); },
      });
    } else { tunerPage.refresh(true); calWizard.refresh(); metroCard.refresh(); }
  } else {
    if (calWizard) calWizard.cancel('');
    if (metroCard && metroCard.running) metroCard.stop();
    if (tunerPage) tunerPage.deactivate();
    if (pc) { syncForm(); if (tab === 'practice') redrawKeepingColours(); }
  }
}
wideQuery.addEventListener('change', () => setTab(prefs.tab || 'practice'));
document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

const THEMES = ['auto', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('scales.theme', t); } catch { /* ignore */ }
  $('themeBtn').innerHTML = { auto: '◐<span class="theme-label"> Auto</span>', light: '☀<span class="theme-label"> Light</span>', dark: '☾<span class="theme-label"> Dark</span>' }[t];
  $('themeBtn').setAttribute('aria-label', `Colour theme: ${t}. Click to change.`);
  meter.refreshPalette();
  if (tunerPage) tunerPage.meter.refreshPalette();
  if (exercise) redrawKeepingColours();
}
let theme = (() => { try { return localStorage.getItem('scales.theme') || 'auto'; } catch { return 'auto'; } })();
$('themeBtn').addEventListener('click', () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; applyTheme(theme); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme === 'auto') applyTheme('auto'); });

// ---------------------------------------------------------------- debug: capture what the microphone hears
let pendingCapture = null;
const r3 = (x, d = 3) => (x == null || !isFinite(x) ? null : +x.toFixed(d));

function captureMeta(sess, result, cap) {
  const ex = exercise;
  const segm = sess && sess.segmenter;
  return {
    app: 'scale-practice', kind: 'capture', version: 2, appVersion: APP_VERSION, created: new Date().toISOString(),
    settings: compactSettings(settings), title: ex ? ex.title : null, a4: a4(), a4Effective: sess ? sess.a4 : a4(),
    sampleRate: cap.sampleRate, startTime: cap.startTime,
    metronomeT0: sess && sess.t0 != null ? sess.t0 : null,
    synthetic: !!(sess && sess.o.synth),
    noiseFloor: sess ? sess.noiseFloor : null,
    calibration: sess ? sess.o.calibration || null : null,
    // what the calibration changed: effective A and listening thresholds
    calibrationApplied: sess && sess.o.calibration ? { a4: sess.a4, ...sess.segOpts } : null,
    calibrationsStored: loadCalibrationsSafe(),
    profiles: getProfiles(), // voice range / other instrument as set on this device
    audio: engine.describe(),
    analysis: sess ? { minFreq: sess.minFreq, maxFreq: sess.maxFreq, seg: { ...SEG }, run: { ...RUN }, finalNoiseFloor: segm ? segm.noiseFloor : null, finalGate: segm ? segm.gate : null } : null,
    log: sess ? sess.log : null,
    expected: seq ? seq.events.map((e) => ({ midis: e.midis, onsetBeat: e.onsetBeat, beats: e.beats })) : null,
    live: result ? {
      total: result.total, intonation: result.intonation, timing: result.timing, missing: result.missing, wrong: result.wrong, extras: result.extras.length, bpm: result.bpm,
      notes: (segm ? segm.notes : []).map((n) => ({ onset: r3(n.onset), end: r3(n.end), midi: n.midi != null ? r3(n.midi) : null, wobble: r3(n.wobble, 1) })),
      perNote: result.perNote.map((p) => ({ e: p.event, n: p.note, s: p.status, c: p.cents ? p.cents.map((c) => r3(c, 1)) : null, i: r3(p.intonation, 1), td: r3(p.timingDev), ts: r3(p.timing, 1) })),
    } : null,
    // the run's results in full, as shown in the summary
    result: result ? {
      total: r3(result.total, 1), intonation: r3(result.intonation, 1), timing: r3(result.timing, 1), penalty: result.penalty,
      missing: result.missing, wrong: result.wrong, bpm: r3(result.bpm, 1), globalOffset: result.globalOffset || null,
      precision: { level: settings.precision, ...precisionAt(settings.precision, settings.instrument) },
      notes: result.perNote.map((p) => {
        const ev = seq.events[p.event];
        const d = p.note != null && segm ? segm.notes[p.note] : null;
        return {
          n: p.event + 1,
          expected: ev.notes.map((x) => noteName(x, { octave: true, unicode: false })).join('+'),
          expectedMidi: ev.midis,
          heardMidi: d && d.midi != null ? r3(d.midi) : null,
          onset: d ? r3(d.onset) : null,
          duration: d ? r3(d.end - d.onset) : null,
          cents: p.cents ? p.cents.map((c) => r3(c, 1)) : null,
          intonationScore: r3(p.intonation, 1),
          timingDeviation: r3(p.timingDev),
          timingScore: r3(p.timing, 1),
          status: p.status,
          unsteady: !!p.unsteady,
        };
      }),
      extras: result.extras.map((x) => ({ onset: r3(x.onset), duration: r3(x.end - x.onset), heardMidi: x.midi != null ? r3(x.midi) : null })),
    } : null,
    selfTest: window.__selfTest || null,
    // compact live pitch track: [time, freq, clarity, rms, level]
    liveFrames: sess ? sess.frames.map((f) => [r3(f.t), r3(f.freq, 2), r3(f.clarity), +(f.rms || 0).toPrecision(3), +(f.level || 0).toPrecision(3)]) : null,
    screen: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    userAgent: navigator.userAgent,
  };
}

function loadCalibrationsSafe() {
  try { return JSON.parse(localStorage.getItem('scales.calibration.v1')) || null; } catch { return null; }
}

function offerCapture(sess, result) {
  const box = $('d-captureOut');
  if (!box) return;
  const cap = engine.takeCapture();
  if (!cap) return;
  pendingCapture = { cap, meta: captureMeta(sess, result, cap) };
  let peak = 0;
  for (let i = 0; i < cap.samples.length; i++) peak = Math.max(peak, Math.abs(cap.samples[i]));
  const clipped = cap.samples.reduce((n, v) => n + (Math.abs(v) >= 0.999 ? 1 : 0), 0);
  const tr = pendingCapture.meta.audio && pendingCapture.meta.audio.track;
  const st = tr && tr.settings;
  const processing = st ? ['echoCancellation', 'noiseSuppression', 'autoGainControl'].filter((k) => st[k] === true) : [];
  box.innerHTML = `<div class="field"><label for="d-notes">What did you do? (optional)</label><textarea id="d-notes" rows="2" style="width:100%" placeholder="e.g. iPhone playing the recording 1 m from the webcam, calibrated first"></textarea></div>
    <p><button type="button" class="btn primary" id="d-download">⬇ Download recording</button></p>
    <p class="small muted">${(cap.samples.length / cap.sampleRate).toFixed(1)} s at ${cap.sampleRate} Hz · loudest sample ${(20 * Math.log10(peak + 1e-9)).toFixed(1)} dBFS${clipped ? ` · ⚠ ${clipped} samples clipped – move a little further from the microphone` : ''}${tr ? ` · microphone: ${esc(tr.label || 'unnamed')}` : ''}${processing.length ? ` · ⚠ the browser left ${processing.join(', ')} switched on` : ''}.
    The file contains this recording, the exercise settings, the score and the app's listening details – nothing else.</p>`;
  $('d-download').addEventListener('click', () => {
    const { cap: c, meta } = pendingCapture;
    meta.userNotes = $('d-notes').value.trim();
    const { blob } = encodeWav(c.samples, c.sampleRate, meta);
    const stamp = meta.created.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const s = settings;
    const name = `scale-capture-${s.instrument}-${s.type}-${(s.type === 'chromatic' || s.type === 'dim7' ? s.start : s.key).replace('#', 's')}-${stamp}.wav`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  });
}

// ---------------------------------------------------------------- debug (synthetic performance)
async function runSelfTest() {
  const btn = $('d-selftest');
  const out = $('d-selftestOut');
  btn.disabled = true;
  out.textContent = 'Running…';
  const t0 = performance.now();
  try {
    const h = await import('../tests/harness.js');
    for (const m of ['theory', 'audio', 'scoring', 'list', 'voice']) await import(`../tests/${m}.test.js`);
    const box = document.createElement('div');
    const results = await h.run(box);
    const failed = results.filter((r) => !r.ok);
    window.__selfTest = {
      appVersion: APP_VERSION, when: new Date().toISOString(), seconds: r3((performance.now() - t0) / 1000, 1),
      total: results.length, passed: results.length - failed.length,
      failed: failed.map((f) => ({ name: f.name, error: f.error })),
      timings: results.map((r) => ({ name: r.name, ms: Math.round(r.ms), ok: r.ok })),
    };
    out.innerHTML = failed.length ? `<b style="color:var(--bad)">${failed.length} of ${results.length} failed</b>: ${failed.map((f) => esc(f.name)).join('; ')}` : `<b style="color:var(--good)">All ${results.length} passed</b> in ${window.__selfTest.seconds} s`;
  } catch (e) {
    window.__selfTest = { appVersion: APP_VERSION, when: new Date().toISOString(), error: String(e && e.message) };
    out.textContent = 'Self-test could not run: ' + (e && e.message);
  }
  btn.disabled = false;
}

function setupDebug() {
  if (!DEBUG) return;
  const p = $('debugPanel');
  p.hidden = false;
  p.innerHTML = `<b>Test mode – device self-test</b>
    <p class="small muted" style="margin:4px 0">Runs the app's automatic checks on this device (about a minute on a phone). The results are added to recordings you download.</p>
    <p><button type="button" class="btn" id="d-selftest">Run self-test</button> <span class="small" id="d-selftestOut"></span></p>
    <b>Test mode – record what the microphone hears</b>
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
  $('d-selftest').addEventListener('click', runSelfTest);
}

// ---------------------------------------------------------------- start up
function init() {
  startAnalytics();
  setupPwa();
  if (ANALYTICS_ON) $('privacyNote').textContent = 'Your sound, scores and settings never leave your device. Anonymous page visits are counted (no cookies, no personal data) to see how the site is used.';
  setupDebug();
  applyTheme(theme);
  syncForm();
  updateExercise();
  renderList();
  setTab(['practice', 'config', 'results', 'tuner'].includes(prefs.tab) ? prefs.tab : (list.length ? 'practice' : 'config'));
  checkShareLink();
}

if (window.Vex) init();
else window.addEventListener('load', init);
