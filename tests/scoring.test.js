import { test, near, assert, eq } from './harness.js';
import { analyseSignal } from '../js/pitch.js';
import { renderPerformance } from '../js/audio/synth.js';
import { segmentFrames } from '../js/segmenter.js';
import { buildExercise } from '../js/exercises.js';
import { buildSequence } from '../js/sequence.js';
import { detectionRange } from '../js/instruments.js';
import { align } from '../js/align.js';
import { scoreRun } from '../js/scoring.js';
import { precisionAt, linearScore } from '../js/precision.js';
import { Follower } from '../js/follower.js';

function run(settings, perfOpts, precision = 2) {
  const ex = buildExercise(settings);
  const seq = buildSequence(ex);
  const perf = renderPerformance(seq, { bpm: 72, ...perfOpts });
  const { minFreq, maxFreq } = detectionRange(settings.instrument);
  const frames = analyseSignal(perf.signal, 48000, { minFreq, maxFreq });
  const notes = segmentFrames(frames, { a4: 440, vibrato: !!perfOpts.vibratoCents, minFreq, maxFreq });
  const alignment = align(notes, seq.events);
  return { seq, perf, notes, alignment, result: scoreRun({ expected: seq.events, detected: notes, alignment, prec: precisionAt(precision) }) };
}

test('precision interpolation', () => {
  eq(precisionAt(0).fullCents, 15);
  eq(precisionAt(4).zeroCents, 15);
  near(precisionAt(2.5).fullCents, 6, 1e-9);
  eq(linearScore(5, 5, 25), 100);
  eq(linearScore(15, 5, 25), 50);
  eq(linearScore(-30, 5, 25), 0);
});

test('perfect performance scores ~100', () => {
  const { result } = run({ instrument: 'violin', type: 'scale', key: 'A', range: '2' }, { detune: () => 0 });
  assert(result.total > 97, 'total ' + result.total);
  eq(result.missing, 0);
  eq(result.extras.length, 0);
});

test('known detuning is reported per note', () => {
  const det = (i) => (i % 3 === 0 ? 20 : i % 3 === 1 ? -10 : 0);
  const { result } = run({ instrument: 'cello', type: 'scale', key: 'D', range: '1' }, { detune: det });
  result.perNote.forEach((r) => near(r.cents[0], det(r.event), 3, `note ${r.event}`));
  // at Intermediate (7..35 cents): 20c -> ~53.6, -10c -> ~89.3, 0 -> 100
  near(result.intonation, (53.6 * 5 + 89.3 * 5 + 100 * 5) / 15, 6);
});

test('missing note gets zero and extra note is penalised', () => {
  const { result } = run({ instrument: 'violin', type: 'scale', key: 'G', range: '1' }, { detune: () => 0, missing: [5], extras: [{ after: 9, midi: 80 }] });
  eq(result.perNote[5].status, 'missing');
  eq(result.perNote[5].intonation, 0);
  eq(result.perNote[5].timing, 0);
  eq(result.extras.length, 1);
  eq(result.penalty, 3);
  eq(result.missing, 1);
});

test('wrong note detected as wrong', () => {
  const { result } = run({ instrument: 'violin', type: 'scale', key: 'G', range: '1' }, { detune: (i) => (i === 3 ? 100 : 0) });
  eq(result.perNote[3].status, 'wrong');
  eq(result.perNote[3].intonation, 0);
  eq(result.perNote.filter((r) => r.status === 'ok').length, 14);
});

test('timing jitter lowers timing score; tighter precision lowers it further', () => {
  const steady = run({ instrument: 'violin', type: 'scale', key: 'G', range: '2' }, { detune: () => 0 });
  const jittery = run({ instrument: 'violin', type: 'scale', key: 'G', range: '2' }, { detune: () => 0, jitter: 0.15 });
  assert(steady.result.timing > 92, 'steady ' + steady.result.timing);
  assert(jittery.result.timing < steady.result.timing - 10, 'jittery ' + jittery.result.timing);
  const strict = scoreRun({ expected: jittery.seq.events, detected: jittery.notes, alignment: jittery.alignment, prec: precisionAt(4) });
  assert(strict.timing < jittery.result.timing, 'strict ' + strict.timing);
});

test('alignment handles inserted and dropped notes', () => {
  const ev = [60, 62, 64, 65, 67].map((m, i) => ({ midis: [m], onsetBeat: i }));
  const det = [60, 62, 61.9, 65, 67].map((m, i) => ({ midi: m, onset: i * 0.5, end: i * 0.5 + 0.4 }));
  const a = align(det, ev);
  // 61.9 ≈ D, so E is "wrong", not extra+missing
  eq(a.pairs.map((p) => p.note), [0, 1, 2, 3, 4]);
  const det2 = [60, 62, 63, 64, 65, 67].map((m, i) => ({ midi: m, onset: i * 0.5, end: i * 0.5 + 0.4 }));
  const a2 = align(det2, ev);
  eq(a2.extras, [2]);
  const det3 = [60, 62, 65, 67].map((m, i) => ({ midi: m, onset: i * 0.5, end: i * 0.5 + 0.4 }));
  const a3 = align(det3, ev);
  eq(a3.pairs[2].note, null);
});

test('follower moves with the student and tolerates a skipped note', () => {
  const ev = [60, 62, 64, 65, 67].map((m) => ({ midis: [m] }));
  const f = new Follower(ev);
  eq(f.onset(60), 0);
  eq(f.onset(62), 1);
  eq(f.onset(65), 3); // skipped 64
  eq(f.onset(70), -1); // stray note
  eq(f.arrow, 3);
  f.release();
  eq(f.arrow, 4);
});

test('metronome grid timing with constant latency is not penalised', () => {
  const ev = [0, 1, 2, 3, 4, 5].map((b) => ({ midis: [60], onsetBeat: b, notes: [] }));
  const det = ev.map((e) => ({ midi: 60, onset: 2 + e.onsetBeat * 0.5 + 0.12, end: 2 + e.onsetBeat * 0.5 + 0.5 }));
  const alignment = { pairs: ev.map((e, i) => ({ event: i, note: i })), extras: [] };
  const r = scoreRun({ expected: ev, detected: det, alignment, prec: precisionAt(2), metronome: { t0: 2, spb: 0.5 } });
  near(r.timing, 100, 1e-6);
});

import { analyseRecording } from '../js/practice.js';
import { encodeWav, decodeWav } from '../js/audio/wav.js';

function highpass(x, fc, sr) { // speaker that can't reproduce low notes: 4th-order roll-off
  for (let pass = 0; pass < 2; pass++) {
    const w = 2 * Math.PI * fc / sr, cs = Math.cos(w), al = Math.sin(w) / Math.SQRT2;
    const b0 = (1 + cs) / 2, b1 = -(1 + cs), b2 = (1 + cs) / 2, a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y; }
  }
  return x;
}
function roomEcho(x, sr) {
  const out = Float32Array.from(x);
  for (const [d, g] of [[0.023, 0.3], [0.041, 0.25], [0.067, 0.2], [0.089, 0.15]]) { const D = Math.round(d * sr); for (let i = out.length - 1; i >= D; i--) out[i] += g * out[i - D]; }
  return out;
}

test('recording played through a speaker, starting straight away, scores ~100', () => {
  const settings = { instrument: 'cello', type: 'scale', key: 'C', range: '2' };
  const seq = buildSequence(buildExercise(settings));
  for (const fc of [120, 200]) {
    const perf = renderPerformance(seq, { bpm: 72, detune: () => 0, timbre: 'cello', leadIn: 0.05, noise: 0.002 });
    const sig = roomEcho(highpass(perf.signal, fc, 48000), 48000);
    const r = analyseRecording({ samples: sig, sampleRate: 48000, settings, a4: 440 });
    assert(r.result.total > 95, `speaker roll-off ${fc} Hz: total ${r.result.total.toFixed(1)}, missing ${r.result.missing}, wrong ${r.result.wrong}`);
  }
});

test('captured WAV round trip keeps samples and run details', () => {
  const x = new Float32Array(4800).map((_, i) => 0.5 * Math.sin(i / 10));
  const meta = { settings: { instrument: 'bass', key: 'E' }, a4: 442, startTime: 3.25 };
  const { blob } = encodeWav(x, 48000, meta);
  return blob.arrayBuffer().then((buf) => {
    const d = decodeWav(buf);
    eq(d.sampleRate, 48000);
    eq(d.meta, meta);
    near(d.samples[123], x[123], 1e-4);
  });
});

import { measureNoise, measureString, summarise, applyCalibration } from '../js/calibration.js';
import { tone } from '../js/audio/synth.js';
import { instrumentInfo } from '../js/instruments.js';
import { midiOf, midiToFreq } from '../js/theory.js';

function calibrateSynthetic(instrument, shiftCents, { noise = 0.002 } = {}) {
  const info = instrumentInfo(instrument);
  const quiet = analyseSignal(Float32Array.from({ length: 48000 * 2 }, () => noise * (Math.random() * 2 - 1)), 48000, { minFreq: 40, maxFreq: 1500 });
  const strings = info.stringNotes.map((n, i) => {
    const f = midiToFreq(midiOf(n) + info.transpose + shiftCents / 100);
    const sig = tone(f, 2, 48000, { noise });
    return measureString(analyseSignal(sig, 48000, { minFreq: 25, maxFreq: 1500 }), instrument, i);
  });
  return summarise(instrument, measureNoise(quiet), strings);
}

test('calibration: tuned strings read in tune; a shifted microphone path is detected', () => {
  const ok = calibrateSynthetic('violin', 0);
  near(ok.meanCents, 0, 3);
  eq(ok.correctCents, 0);
  assert(ok.snrDb > 20, 'snr ' + ok.snrDb);
  const shifted = calibrateSynthetic('cello', -345);
  near(shifted.correctCents, -345, 4);
  assert(shifted.advice.some((a) => !a.ok && /semitones lower/.test(a.text)));
  const bass = calibrateSynthetic('bass', 12);
  near(bass.correctCents, 12, 4);
});

test('calibration corrects a shifted recording so a perfect scale scores ~100', () => {
  const settings = { instrument: 'cello', type: 'scale', key: 'C', range: '2' };
  const seq = buildSequence(buildExercise(settings));
  const shift = -345;
  const perf = renderPerformance(seq, { bpm: 72, detune: () => 0, timbre: 'cello', a4: 440 * Math.pow(2, shift / 1200) });
  const raw = analyseRecording({ samples: perf.signal, sampleRate: 48000, settings, a4: 440 });
  assert(raw.result.total < 20, 'uncorrected should fail: ' + raw.result.total);
  const cal = calibrateSynthetic('cello', shift);
  const fixed = analyseRecording({ samples: perf.signal, sampleRate: 48000, settings, a4: 440, calibration: cal });
  assert(fixed.result.total > 95, 'corrected total ' + fixed.result.total.toFixed(1));
  const applied = applyCalibration(cal, 440);
  near(1200 * Math.log2(applied.a4 / 440), shift, 4);
});
