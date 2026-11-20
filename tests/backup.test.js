// Moving to another device: export everything, import everything.
import { test, eq, assert } from './harness.js';
import { makeBackup, readBackup, restoreBackup, backupFilename, BACKUP_KEYS } from '../js/backup.js';
import { importJson } from '../js/practiceList.js';

/** A stand-in for localStorage. */
function store(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

const OLD = () => store({
  'scales.list.v1': JSON.stringify([{ id: 'a1', name: 'G major', autoName: true, settings: { instrument: 'violin', key: 'G' } }, { id: 'b2', name: 'Voice', autoName: true, settings: { instrument: 'voice' } }]),
  'scales.results.v1': JSON.stringify({ a1: { runs: [{ d: 1, t: 90 }, { d: 2, t: 92 }], older: [{ d: 0 }], days: [{ day: '2026-01-01', n: 3 }], months: [] } }),
  'scales.prefs.v1': JSON.stringify({ studentName: 'Ann Lee', a4: 442, global: { precision: 3 } }),
  'scales.profiles.v1': JSON.stringify({ voice: { low: 55, high: 79 }, other: { name: 'Flute', low: 60, high: 96 } }),
  'scales.calibration.v1': JSON.stringify({ violin: { correctCents: 12, note: 'old phone' }, voice: { voice: { low: 55, high: 79 } } }),
  'scales.theme': 'dark',
  'scales.metroBeats': '3',
  'unrelated.key': 'not ours',
});

test('export everything, then import it on a new device', () => {
  const old = OLD();
  const text = makeBackup(old, { now: new Date(2026, 10, 15, 10, 0), appVersion: 'test' });
  const { backup, summary } = readBackup(text);
  eq([summary.student, summary.exercises, summary.runs], ['Ann Lee', 2, 6]);
  assert(!('unrelated.key' in backup.data), 'only the app\'s own data');

  // the new device already has its own microphone calibration and an old syllabus
  const fresh = store({
    'scales.calibration.v1': JSON.stringify({ cello: { correctCents: -4 } }),
    'scales.list.v1': '[]',
    'scales.metroBeats': '4',
  });
  restoreBackup(backup, fresh);
  const d = fresh.dump();
  for (const k of ['scales.list.v1', 'scales.results.v1', 'scales.prefs.v1', 'scales.profiles.v1', 'scales.theme', 'scales.metroBeats']) {
    eq(d[k], old.getItem(k), k);
  }
  // microphone calibrations stay those of this device; the voice range's record comes along
  const cal = JSON.parse(d['scales.calibration.v1']);
  eq(Object.keys(cal).sort(), ['cello', 'voice']);
  eq(cal.cello.correctCents, -4);
});

test('import everything clears what the backup does not have', () => {
  const backup = readBackup(makeBackup(store({ 'scales.list.v1': '[]' }))).backup;
  const dev = store({ 'scales.results.v1': '{"x":{}}', 'scales.theme': 'light', 'scales.calibration.v1': '{"voice":{"v":1}}' });
  restoreBackup(backup, dev);
  const d = dev.dump();
  eq(d['scales.list.v1'], '[]');
  assert(!('scales.results.v1' in d) && !('scales.theme' in d), 'old results and theme cleared');
  assert(!('scales.calibration.v1' in d), 'a voice range from before is not kept when the backup has none');
});

test('wrong files are refused with a clear message', () => {
  const msg = (t) => { try { readBackup(t); return null; } catch (e) { return e.message; } };
  assert(/not a Scale Practice backup/.test(msg('hello')));
  assert(/not a Scale Practice backup/.test(msg('{"app":"other"}')));
  assert(/only a syllabus/.test(msg(JSON.stringify({ app: 'scale-practice', version: 2, items: [] }))));
  assert(/newer version/.test(msg(JSON.stringify({ app: 'scale-practice', kind: 'full-backup', version: 9, data: {} }))));
});

test('the syllabus Import also takes a full backup (its exercises and results)', () => {
  const items = importJson(makeBackup(OLD()));
  eq(items.map((x) => x.name), ['G major', 'Voice']);
  eq(items[0].importedResults.runs.length, 2);
});

test('backup file name', () => {
  eq(backupFilename('Ann Lee', new Date(2026, 10, 5)), 'scale-practice-backup-Ann-Lee-2026-11-05.json');
  eq(backupFilename('', new Date(2026, 0, 9)), 'scale-practice-backup-2026-01-09.json');
  eq(Object.keys(BACKUP_KEYS).length, 9);
});
