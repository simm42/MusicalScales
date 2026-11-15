// Voice (sol-fa, range finder, sung performances) and the "other" instrument.
import { test, eq, assert, near } from './harness.js';
import { parseNote, midiOf, noteName, midiToFreq } from '../js/theory.js';
import { buildExercise, typesForInstrument, rangesFor, isPlayable, normalise, typeLabel } from '../js/exercises.js';
import { compactSettings, expandSettings, encodeShare, decodeShare, sameSettings } from '../js/practiceList.js';
import { buildSequence } from '../js/sequence.js';
import { instrumentInfo, classifyVoice, detectionRange, assignClefs } from '../js/instruments.js';
import { useProfiles, cleanOther, setProfile, getProfile } from '../js/profiles.js';
import { movableSyllable, fixedSyllable, syllablesFor } from '../js/solfege.js';
import { precisionAt } from '../js/precision.js';
import { HoldTracker, judgeHold, summariseVoice, measureNoise, measureString, summarise, VOICE_CAL } from '../js/calibration.js';
import { renderPerformance, tone } from '../js/audio/synth.js';
import { analyseSignal } from '../js/pitch.js';
import { segmentFrames } from '../js/segmenter.js';
import { align } from '../js/align.js';
import { scoreRun } from '../js/scoring.js';
import { shortestNoteSec } from '../js/practice.js';

const N = (s) => parseNote(s);
const sylls = (ex) => { const f = syllablesFor(ex); return ex.gen.steps.slice(0, ex.gen.topIndex + 1).map((s) => f(s.notes[0])); };
const names = (ex) => ex.gen.steps.map((s) => noteName(s.notes[0], { octave: true, unicode: false }));

/** Run a test with the given device profiles (nothing saved), then go back to the stored ones. */
async function withProfiles(p, fn) {
  useProfiles(p);
  try { await fn(); } finally { useProfiles(null); }
}

// ---------------------------------------------------------------- sol-fa
test('sol-fa: movable Do in major, minor on Do and minor on La', () => {
  const ex = (s) => buildExercise({ instrument: 'voice', type: 'scale', range: '1', ...s });
  return withProfiles({}, () => {
    eq(sylls(ex({ key: 'D', mode: 'major' })), ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti', 'Do']);
    eq(sylls(ex({ key: 'A', mode: 'minor', form: 'harmonic', solfege: 'movable' })), ['Do', 'Re', 'Me', 'Fa', 'Sol', 'Le', 'Ti', 'Do']);
    eq(sylls(ex({ key: 'A', mode: 'minor', form: 'harmonic', solfege: 'movableLa' })), ['La', 'Ti', 'Do', 'Re', 'Mi', 'Fa', 'Si', 'La']);
    eq(sylls(ex({ key: 'E', mode: 'minor', form: 'melodic', solfege: 'movableLa' })), ['La', 'Ti', 'Do', 'Re', 'Mi', 'Fi', 'Si', 'La']);
    // melodic minor descends natural
    const mel = ex({ key: 'C', mode: 'minor', form: 'melodic', solfege: 'movable' });
    const f = syllablesFor(mel);
    eq(mel.gen.steps.map((s) => f(s.notes[0])), ['Do', 'Re', 'Me', 'Fa', 'Sol', 'La', 'Ti', 'Do', 'Te', 'Le', 'Sol', 'Fa', 'Me', 'Re', 'Do']);
  });
});

test('sol-fa: fixed Do follows the letter names; chromatic syllables', () => {
  eq(fixedSyllable(N('B4')), 'Si');
  eq(fixedSyllable(N('F#4')), 'Fa♯');
  eq(fixedSyllable(N('Bb3'), { accidental: false }), 'Si');
  return withProfiles({}, () => {
    const ex = buildExercise({ instrument: 'voice', type: 'scale', key: 'Eb', mode: 'major', range: '1', solfege: 'fixed' });
    eq(sylls(ex), ['Mi♭', 'Fa', 'Sol', 'La♭', 'Si♭', 'Do', 'Re', 'Mi♭']);
    const chrom = buildExercise({ instrument: 'voice', type: 'chromatic', start: 'C', range: '1', solfege: 'movable' });
    const f = syllablesFor(chrom);
    eq(chrom.gen.steps.slice(0, 13).map((s) => f(s.notes[0])), ['Do', 'Di', 'Re', 'Ri', 'Mi', 'Fa', 'Fi', 'Sol', 'Si', 'La', 'Li', 'Ti', 'Do']);
    eq(chrom.gen.steps.slice(13, 18).map((s) => f(s.notes[0])), ['Ti', 'Te', 'La', 'Le', 'Sol']);
    // dominant 7th: Sol Ti Re Fa … resolving to Do
    const d7 = buildExercise({ instrument: 'voice', type: 'dom7', key: 'C', range: '1', solfege: 'movable' });
    const g = syllablesFor(d7);
    eq(d7.gen.steps.map((s) => g(s.notes[0])), ['Sol', 'Ti', 'Re', 'Fa', 'Sol', 'Fa', 'Re', 'Ti', 'Do']);
  });
  // not sung: no syllables
});

test('sol-fa: only for the voice', () => {
  eq(syllablesFor(buildExercise({ instrument: 'violin', type: 'scale', key: 'G', range: '1' })), null);
  eq(movableSyllable(N('G#4'), { l: 4, a: 0 }), 'Di');
});

// ---------------------------------------------------------------- voice types and placement
test('voice types from a range (female names preferred)', () => {
  const t = (lo, hi) => classifyVoice(midiOf(N(lo)), midiOf(N(hi))).id;
  eq(t('C4', 'C6'), 'soprano');
  eq(t('A3', 'A5'), 'mezzo');
  eq(t('F3', 'F5'), 'contralto');
  eq(t('E3', 'E5'), 'contralto'); // countertenor / contralto overlap: the female name
  eq(t('C3', 'C5'), 'tenor');
  eq(t('A2', 'A4'), 'baritone');
  eq(t('E2', 'E4'), 'bass');
  eq(t('B3', 'G5'), 'mezzo');
});

test('voice: clef, transposition and an exercise in the middle of the range', () => {
  return withProfiles({ voice: { low: midiOf(N('G3')), high: midiOf(N('D6')), type: 'mezzo' } }, () => {
    const info = instrumentInfo('voice');
    eq([info.clef, info.transpose, info.family], ['treble', 0, 'voice']);
    // C major, one octave: C4–C5 or C5–C6 fit; C5 sits nearer the middle of G3–D6
    const ex = buildExercise({ instrument: 'voice', type: 'scale', key: 'C', range: '1' });
    assert(ex.ok);
    eq(names(ex)[0], 'C4'); // the range's middle is A♯4: C4–C5 (middle G4) sits nearer than C5–C6
    assert(!isPlayable(ex.settings, { range: '3' }));
    eq(typesForInstrument('voice'), ['scale', 'arpeggio', 'chromatic', 'dom7', 'dim7']);
    assert(rangesFor('voice', 'scale').includes('6th'));
    const r = detectionRange('voice');
    assert(r.minFreq < midiToFreq(midiOf(N('G3'))) && r.maxFreq > midiToFreq(midiOf(N('D6'))));
  }).then(() => withProfiles({ voice: { low: midiOf(N('C3')), high: midiOf(N('C5')), type: 'tenor' } }, () => {
    const info = instrumentInfo('voice');
    eq([info.clef, info.clefAnnotation, info.transpose], ['treble', '8vb', -12]);
    const ex = buildExercise({ instrument: 'voice', type: 'scale', key: 'D', range: '1' });
    assert(ex.ok);
    const seq = buildSequence(ex);
    // written an octave above what is sung
    eq(seq.events[0].midis[0], ex.lowMidi - 12);
    assert(seq.events[0].midis[0] >= midiOf(N('C3')));
  })).then(() => withProfiles({ voice: { low: midiOf(N('E2')), high: midiOf(N('E4')) } }, () => {
    eq(instrumentInfo('voice').clef, 'bass');
    eq(instrumentInfo('voice').detail, 'Bass');
  })).then(() => withProfiles({ voice: { override: 'soprano' } }, () => {
    // not measured: the chosen type's usual range
    eq([instrumentInfo('voice').lowest, instrumentInfo('voice').highest], ['C4', 'C6']);
  }));
});

// ---------------------------------------------------------------- other instrument
test('other instrument: range, transposition and clef', () => withProfiles({ other: { name: 'Clarinet in B♭', low: midiOf(N('E3')), high: midiOf(N('C7')), transpose: -2, clef: 'auto' } }, () => {
  const info = instrumentInfo('other');
  eq([info.name, info.clef, info.transpose, info.lowest, info.highest], ['Clarinet in B♭', 'treble', -2, 'E3', 'C7']);
  const ex = buildExercise({ instrument: 'other', type: 'scale', key: 'G', range: '2' });
  assert(ex.ok);
  eq(names(ex)[0], 'G3');
  const seq = buildSequence(ex);
  eq(seq.events[0].midis[0], midiOf(N('G3')) - 2); // sounds a tone lower: F3
  assert(typesForInstrument('other').includes('dsBroken') && !typesForInstrument('other').includes('dsParallel'));
}).then(() => withProfiles({ other: { low: midiOf(N('Bb1')), high: midiOf(N('E5')), transpose: 0, clef: 'auto' } }, () => {
  const info = instrumentInfo('other'); // bassoon
  eq([info.name, info.clef], ['Other instrument', 'bass']);
  eq(assignClefs('other', [midiOf(N('C3')), midiOf(N('F4')), midiOf(N('G4')), midiOf(N('A4')), midiOf(N('B4'))]), ['bass', 'tenor', 'tenor', 'tenor', 'tenor']);
  eq(info.calNames.length, 2);
})));

test('other instrument: calibration spots a wrong transposition', () => withProfiles({ other: { low: midiOf(N('E3')), high: midiOf(N('C7')), transpose: 0 } }, () => {
  const info = instrumentInfo('other');
  const quiet = analyseSignal(Float32Array.from({ length: 48000 * 2 }, () => 0.002 * (Math.random() * 2 - 1)), 48000, { minFreq: 40, maxFreq: 2000 });
  // really a B♭ instrument: everything sounds a tone lower than written
  const notes = info.calNotes.map((n, i) => {
    const sig = tone(midiToFreq(midiOf(n) - 2), 2, 48000, { noise: 0.002 });
    return measureString(analyseSignal(sig, 48000, { minFreq: 40, maxFreq: 2500 }), 'other', i);
  });
  const cal = summarise('other', measureNoise(quiet), notes);
  near(cal.meanCents, -200, 5);
  eq(cal.correctCents, 0);
  assert(cal.advice.some((a) => !a.ok && /transposition/.test(a.text)), JSON.stringify(cal.advice));
}));

test('other instrument: the highest note is always at least an octave above the lowest', () => {
  eq([cleanOther({ low: 60, high: 65 }).low, cleanOther({ low: 60, high: 65 }).high], [60, 72]);
  eq(cleanOther({ low: 70, high: 50 }).high, 82);
  eq([cleanOther({ low: 105, high: 108 }).low, cleanOther({ low: 105, high: 108 }).high], [96, 108]); // the lowest is capped so an octave still fits
  eq(cleanOther({ low: 60, high: 84, transpose: -40 }).transpose, -24);
  return withProfiles({}, () => {
    eq(setProfile('other', { low: 64, high: 70 }).high, 76);
    eq(getProfile('other').high, 76);
  });
});

test('other instrument: the setup travels with the syllabus item and share link', () => withProfiles({ other: { name: 'Flute', low: 60, high: 96, transpose: 0 } }, () => {
  const clarinet = { name: 'Clarinet in B♭', low: midiOf(N('E3')), high: midiOf(N('C7')), transpose: -2, clef: 'auto' };
  const s = normalise({ instrument: 'other', type: 'scale', key: 'G', range: '2', otherSetup: clarinet });
  const item = compactSettings(s);
  eq(item.otherSetup.name, 'Clarinet in B♭');
  // a share link keeps it, even on a device set up for a flute
  const back = decodeShare(encodeShare([{ name: 'x', autoName: true, settings: item }]))[0];
  eq(back.settings.otherSetup, item.otherSetup);
  // and the exercise is built for the item's instrument, not this device's
  const ex = buildExercise(expandSettings(back.settings));
  eq([ex.info.name, ex.info.transpose, names(ex)[0]], ['Clarinet in B♭', -2, 'G3']);
  // without a setup the device's instrument is used
  eq(buildExercise({ instrument: 'other', type: 'scale', key: 'G', range: '1' }).info.name, 'Flute');
  // a different setup is a different exercise (its results are kept apart)
  assert(!sameSettings(s, { ...s, otherSetup: { ...clarinet, transpose: -3 } }));
  // other instruments carry no setup
  assert(!('otherSetup' in compactSettings({ instrument: 'violin' })));
}));

test('broken double stops are "broken intervals" off the strings', () => {
  eq(typeLabel('dsBroken', 'violin'), 'Double stops – broken steps');
  eq(typeLabel('dsBroken', 'other'), 'Broken intervals');
  return withProfiles({}, () => {
    const t = buildExercise({ instrument: 'other', type: 'dsBroken', key: 'C', range: '1' }).title;
    assert(/broken intervals/.test(t) && !/double/i.test(t), t);
  });
});

// ---------------------------------------------------------------- range finder
function heldFrames(midi, { sec = 2.2, vibrato = 0, driftCents = 0, clarity = 0.95, start = 0 } = {}) {
  const out = [];
  for (let t = 0; t <= sec; t += 0.01) {
    const cents = vibrato * Math.sin(2 * Math.PI * 5.5 * t) + driftCents * (t / sec);
    out.push({ t: start + t, freq: midiToFreq(midi + cents / 100), clarity, rms: 0.05 });
  }
  return out;
}
function track(frames) {
  const tr = new HoldTracker(440, 0.002);
  for (const f of frames) { const r = tr.push(f); if (r) return judgeHold(r); }
  return null;
}

test('range finder: a steady note with vibrato is accepted, a wavering or rough one is not', () => {
  const ok = track(heldFrames(57, { vibrato: 60 }));
  assert(ok && ok.steady, JSON.stringify(ok));
  eq(ok.midi, 57);
  const wobbly = track(heldFrames(84, { driftCents: -90 }));
  assert(wobbly && !wobbly.steady && wobbly.drift > VOICE_CAL.maxDriftCents, JSON.stringify(wobbly));
  const rough = track(heldFrames(84, { clarity: 0.6 }));
  assert(rough && !rough.steady);
  // a break in the note starts the hold again
  const broken = [...heldFrames(60, { sec: 1.2 }), ...heldFrames(60, { sec: 1.2, start: 1.6 })];
  eq(track(broken), null);
  // a jump to another note starts again
  eq(track([...heldFrames(60, { sec: 1.5 }), ...heldFrames(64, { sec: 1.0, start: 1.51 })]), null);
});

test('range finder: summary sets the voice type and listening thresholds', () => {
  const low = { midi: 55, drift: 10, clarity: 0.9, rms: 0.03 };
  const high = { midi: 81, drift: 20, clarity: 0.85, rms: 0.05 };
  const cal = summariseVoice(0.0005, low, high);
  eq(cal.voice.type, 'mezzo');
  eq(cal.correctCents, 0);
  assert(cal.snrDb > 30);
  const narrow = summariseVoice(0.0005, low, { ...high, midi: 64 });
  assert(narrow.advice.some((a) => !a.ok && /less than an octave/.test(a.text)));
});

// ---------------------------------------------------------------- listening to singing
function sungRun(settings, perfOpts = {}, voice = true) {
  const ex = buildExercise(settings);
  const seq = buildSequence(ex);
  const perf = renderPerformance(seq, { bpm: 72, detune: () => 0, timbre: 'voice', sung: true, dipFloor: 0.05, noise: 0.002, seed: 11, ...perfOpts });
  const { minFreq, maxFreq } = detectionRange(settings.instrument);
  const frames = analyseSignal(perf.signal, 48000, { minFreq, maxFreq });
  const notes = segmentFrames(frames, { a4: 440, vibrato: false, voice, shortestNoteSec: shortestNoteSec(seq, perfOpts.bpm || 72), minFreq, maxFreq, repeatPitches: [...new Set(seq.events.filter((e) => e.sameAsPrev).map((e) => e.midis[0]))] });
  const alignment = align(notes, seq.events);
  return { seq, notes, result: scoreRun({ expected: seq.events, detected: notes, alignment, prec: precisionAt(2, 'voice') }) };
}

test('singing: a sol-fa scale with consonants, scoops and vibrato is heard note for note', () => withProfiles({ voice: { low: 55, high: 79 } }, () => {
  const { seq, notes, result } = sungRun({ instrument: 'voice', type: 'scale', key: 'D', mode: 'major', range: '1' });
  eq([result.missing, result.wrong, result.extras.length], [0, 0, 0], `notes ${notes.length} for ${seq.events.length}`);
  assert(result.intonation > 90, 'intonation ' + result.intonation);
}));

test('singing: repeated notes (two quavers each) and an arpeggio', () => withProfiles({ voice: { low: 55, high: 79 } }, () => {
  const q = sungRun({ instrument: 'voice', type: 'scale', key: 'F', mode: 'major', range: '1', rhythm: 'q2' }, { bpm: 60 });
  eq([q.result.missing, q.result.wrong, q.result.extras.length], [0, 0, 0], `notes ${q.notes.length} for ${q.seq.events.length}`);
  const a = sungRun({ instrument: 'voice', type: 'arpeggio', key: 'G', mode: 'minor', range: '1' });
  eq([a.result.missing, a.result.wrong, a.result.extras.length], [0, 0, 0], `notes ${a.notes.length} for ${a.seq.events.length}`);
}));

test('singing: a big scoop up into each note is part of the note, not an extra one', () => withProfiles({ voice: { low: 55, high: 79 } }, () => {
  const big = { sung: { scoopCents: 120, scoopSec: 0.15 } };
  const a = sungRun({ instrument: 'voice', type: 'scale', key: 'A', mode: 'major', range: '1' }, big);
  eq([a.result.missing, a.result.wrong, a.result.extras.length], [0, 0, 0], `notes ${a.notes.length} for ${a.seq.events.length}`);
  const q = sungRun({ instrument: 'voice', type: 'scale', key: 'Bb', mode: 'major', range: '1', rhythm: 'q4' }, { bpm: 60, sung: { scoopCents: 100, scoopSec: 0.15 } });
  eq([q.result.missing, q.result.wrong, q.result.extras.length], [0, 0, 0], `notes ${q.notes.length} for ${q.seq.events.length}`);
  // the string settings would hear each scoop as a note of its own
  const strings = sungRun({ instrument: 'voice', type: 'scale', key: 'A', mode: 'major', range: '1' }, big, false);
  assert(strings.result.extras.length > 5);
}));

test('singing: fast repeated quavers are still split (the scoop window follows the tempo)', () => withProfiles({ voice: { low: 55, high: 79 } }, () => {
  const q = sungRun({ instrument: 'voice', type: 'scale', key: 'D', mode: 'major', range: '1', rhythm: 'q4' }, { bpm: 160, sung: { scoopCents: 50, scoopSec: 0.08 } });
  eq([q.result.missing, q.result.wrong, q.result.extras.length], [0, 0, 0], `notes ${q.notes.length} for ${q.seq.events.length}`);
}));

test('singing: tolerances are wider than for strings', () => {
  near(precisionAt(2, 'voice').fullCents, precisionAt(2).fullCents * 1.5, 1e-9);
  assert(precisionAt(2, 'voice').zeroTiming > precisionAt(2).zeroTiming);
});
