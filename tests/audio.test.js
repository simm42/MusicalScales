import { test, near, assert, eq } from './harness.js';
import { MPM, windowSizeFor, analyseSignal } from '../js/pitch.js';
import { tone, renderPerformance } from '../js/audio/synth.js';
import { freqToMidi, midiToFreq } from '../js/theory.js';
import { segmentFrames } from '../js/segmenter.js';
import { buildExercise } from '../js/exercises.js';
import { buildSequence } from '../js/sequence.js';
import { detectionRange } from '../js/instruments.js';

function centsErr(f, target) { return 1200 * Math.log2(f / target); }

function detectSteady(freq, sr, minFreq, maxFreq, opts = {}) {
  const N = windowSizeFor(sr, minFreq);
  const sig = tone(freq, (N * 3) / sr, sr, opts);
  const mpm = new MPM(N, sr);
  return mpm.detect(sig.subarray(N, 2 * N), minFreq, maxFreq);
}

test('MPM accuracy across the string range (44.1 and 48 kHz)', () => {
  const cases = [
    ['bass E1', 41.2034, 'bass'], ['bass G2', 97.9989, 'bass'], ['cello C2', 65.4064, 'cello'], ['cello A3', 220, 'cello'],
    ['viola C3', 130.813, 'viola'], ['violin G3', 195.998, 'violin'], ['violin A4', 440, 'violin'], ['violin E6', 1318.51, 'violin'], ['violin E7', 2637.02, 'violin'],
  ];
  for (const sr of [44100, 48000]) {
    for (const [name, f0, inst] of cases) {
      const { minFreq, maxFreq } = detectionRange(inst);
      for (const cents of [-30, -10, -3, 0, 3, 10, 30]) {
        const f = f0 * Math.pow(2, cents / 1200);
        const r = detectSteady(f, sr, minFreq, maxFreq);
        assert(r.clarity > 0.9, `${name} clarity ${r.clarity}`);
        near(centsErr(r.freq, f), 0, 2, `${name} ${cents}c @${sr}`);
      }
    }
  }
});

test('MPM with weak fundamental and noise (cello/bass mic roll-off)', () => {
  const { minFreq, maxFreq } = detectionRange('bass');
  for (const f of [41.2, 55, 73.4, 98]) {
    const r = detectSteady(f, 48000, minFreq, maxFreq, { weakFundamental: true, noise: 0.01 });
    near(centsErr(r.freq, f), 0, 3, `bass ${f}`);
  }
});

test('vibrato: note centre recovered and no false onsets', () => {
  const ex = buildExercise({ instrument: 'violin', type: 'scale', key: 'D', range: '1', vibrato: true });
  const seq = buildSequence(ex);
  const perf = renderPerformance(seq, { bpm: 60, vibratoCents: 25, detune: () => 0, noise: 0.003 });
  const { minFreq, maxFreq } = detectionRange('violin');
  const frames = analyseSignal(perf.signal, 48000, { minFreq, maxFreq });
  const notes = segmentFrames(frames, { a4: 440, vibrato: true, minFreq, maxFreq });
  eq(notes.length, seq.events.length, 'note count');
  notes.forEach((n, i) => near((n.midi - seq.events[i].midis[0]) * 100, 0, 4, `note ${i}`));
});

function segTest(settings, perfOpts = {}) {
  const ex = buildExercise(settings);
  const seq = buildSequence(ex);
  const perf = renderPerformance(seq, { bpm: 72, ...perfOpts });
  const { minFreq, maxFreq } = detectionRange(settings.instrument);
  const frames = analyseSignal(perf.signal, 48000, { minFreq, maxFreq });
  const notes = segmentFrames(frames, { a4: 440, vibrato: false, minFreq, maxFreq });
  return { seq, perf, notes };
}

test('segmentation: separate bows', () => {
  const { seq, perf, notes } = segTest({ instrument: 'violin', type: 'scale', key: 'G', range: '2' });
  eq(notes.length, seq.events.length);
  notes.forEach((n, i) => near(n.onset, perf.truth[i].onset, 0.05, `onset ${i}`));
});

test('segmentation: slurred legato', () => {
  const { seq, perf, notes } = segTest({ instrument: 'cello', type: 'scale', key: 'C', range: '2', slur: 7 });
  eq(notes.length, seq.events.length);
  notes.forEach((n, i) => near(n.onset, perf.truth[i].onset, 0.06, `onset ${i}`));
});

test('segmentation: repeated quavers and rests', () => {
  for (const rhythm of ['q2', 'q2c', 'q2r', 'q4']) {
    const { seq, perf, notes } = segTest({ instrument: 'viola', type: 'arpeggio', key: 'C', range: '1', rhythm });
    eq(notes.length, seq.events.length, rhythm);
    notes.forEach((n, i) => near(n.onset, perf.truth[i].onset, 0.05, `${rhythm} onset ${i}`));
  }
});

test('segmentation: double bass low notes', () => {
  const { seq, notes } = segTest({ instrument: 'bass', type: 'scale', key: 'E', range: '1' }, { bpm: 60 });
  eq(notes.length, seq.events.length);
  notes.forEach((n, i) => near((n.midi - seq.events[i].midis[0]) * 100, 0, 5, `note ${i}`));
});

test('segmentation: background noise alone produces no notes', () => {
  const sig = new Float32Array(48000 * 3);
  let s = 3;
  for (let i = 0; i < sig.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; sig[i] = ((s / 0x7fffffff) - 0.5) * 0.02; }
  const { minFreq, maxFreq } = detectionRange('violin');
  const frames = analyseSignal(sig, 48000, { minFreq, maxFreq });
  eq(segmentFrames(frames, { a4: 440, minFreq, maxFreq }).length, 0);
});

test('frequency helpers', () => {
  near(midiToFreq(69), 440, 1e-9);
  near(freqToMidi(442, 442), 69, 1e-9);
});

import { evaluateDoubleStop, doubleStopCost } from '../js/doublestop.js';
import { align } from '../js/align.js';
import { stringTargets } from '../js/ui/tunerPage.js';
import { clickMask } from '../js/practice.js';

function dsRun(settings, perfOpts) {
  const ex = buildExercise(settings);
  const seq = buildSequence(ex);
  const perf = renderPerformance(seq, { bpm: 60, ...perfOpts });
  const { minFreq, maxFreq } = detectionRange(settings.instrument);
  const frames = analyseSignal(perf.signal, 48000, { minFreq, maxFreq, peaks: true });
  const notes = segmentFrames(frames, { a4: 440, minFreq, maxFreq, pitchless: true });
  return { seq, notes };
}

test('parallel double stops in sixths: each note measured', () => {
  const det = (i) => (i % 2 ? 15 : -10);
  const { seq, notes } = dsRun({ instrument: 'violin', type: 'dsParallel', key: 'Eb', mode: 'major', interval: '6ths', range: '1' }, { detune: det });
  eq(notes.length, seq.events.length, 'segments');
  notes.forEach((n, i) => {
    const r = evaluateDoubleStop(n, seq.events[i]);
    near(r.cents[0], det(i), 4, `lower ${i}`);
    near(r.cents[1], det(i), 4, `upper ${i}`);
    assert(!r.approx);
  });
});

test('parallel octaves are flagged approximate; missing upper note detected', () => {
  const { seq, notes } = dsRun({ instrument: 'violin', type: 'dsParallel', key: 'D', mode: 'major', interval: '8ves', range: '1' }, { detune: () => 0 });
  const r = evaluateDoubleStop(notes[2], seq.events[2]);
  assert(r.approx);
  near(r.cents[0], 0, 4);
  // a wrong pair: evaluate the note against an event a third higher
  const wrong = { midis: seq.events[2].midis.map((m) => m + 4) };
  const r2 = evaluateDoubleStop(notes[2], wrong);
  assert(r2.cents.every((c) => c == null), 'should not find notes a third away');
  const a = align(notes, seq.events, doubleStopCost(440));
  eq(a.pairs.filter((p) => p.note != null).length, seq.events.length);
});

test('tuner targets: equal temperament and pure fifths/fourths', () => {
  const et = stringTargets('violin', 'equal', 440);
  near(et[2], 440, 1e-6);
  near(et[0], 195.998, 0.01);
  const pf = stringTargets('cello', 'fifths', 440);
  near(1200 * Math.log2(pf[0] / 65.4064), -5.87, 0.05); // C string ~6 cents low
  near(pf[3], 220, 1e-6);
  const pb = stringTargets('bass', 'fourths', 440);
  near(pb[3], 97.9989, 0.01); // G string sounds G2
  near(1200 * Math.log2(pb[0] / 41.2034), 5.87, 0.05); // E string ~6 cents high
});

test('robustness: shallow (8 dB) bow-change dips, vibrato level swells, metronome click bleed', () => {
  for (const inst of ['violin', 'viola', 'cello', 'bass']) {
    const key = inst === 'bass' ? 'E' : 'C';
    const { minFreq, maxFreq } = detectionRange(inst);
    const seg = (seq, perfOpts, vibrato = false) => segmentFrames(analyseSignal(renderPerformance(seq, perfOpts).signal, 48000, { minFreq, maxFreq }), { a4: 440, minFreq, maxFreq, vibrato });
    const q4 = buildSequence(buildExercise({ instrument: inst, type: 'scale', key, range: '1', rhythm: 'q4' }));
    const n1 = seg(q4, { bpm: 72, dipFloor: 0.4, detune: () => 0 });
    assert(Math.abs(n1.length - q4.events.length) <= 1, `${inst} repeated quavers at -8 dB: ${n1.length}/${q4.events.length}`);
    const held = buildSequence(buildExercise({ instrument: inst, type: 'scale', key, range: '1', longEnds: true }));
    eq(seg(held, { bpm: 50, vibratoCents: 25, vibratoAmDb: 3, detune: () => 0 }, true).length, held.events.length, `${inst} vibrato swell`);
    const clicked = renderPerformance(held, { bpm: 60, detune: () => 0, clicks: { amp: 0.3, spb: 1 } });
    const n3 = segmentFrames(analyseSignal(clicked.signal, 48000, { minFreq, maxFreq }), { a4: 440, minFreq, maxFreq, clickMask: clickMask(clicked.leadIn, 1, 4096 / 48000) });
    eq(n3.length, held.events.length, `${inst} clicks`);
  }
});
