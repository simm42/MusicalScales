import { test, eq, assert } from './harness.js';
import { makeItem, compactSettings, expandSettings, encodeShare, decodeShare, exportJson, importJson, sameSettings } from '../js/practiceList.js';
import { DEFAULT_SETTINGS, EXERCISE_FIELDS, GLOBAL_FIELDS, normalise, pickFields } from '../js/exercises.js';

const s1 = normalise({ instrument: 'cello', type: 'scale', key: 'Eb', mode: 'minor', form: 'melodic', range: '3', slur: 7, repeatTop: true, precision: 3, vibrato: true, rhythm: 'q4' });
const s2 = normalise({ instrument: 'bass', type: 'runningThirds', key: 'G', range: '1', slur: 3 });
const ex = (s) => pickFields(normalise(s), EXERCISE_FIELDS);

test('syllabus items keep only exercise fields', () => {
  const c = compactSettings(s1);
  for (const k of GLOBAL_FIELDS) assert(!(k in c), `${k} should not be stored in an item`);
  eq(ex(expandSettings(c)), ex(s1));
  eq(compactSettings(DEFAULT_SETTINGS), {});
  assert(sameSettings(s1, { ...s1, rhythm: 'crotchet', precision: 0 }), 'rhythm/precision do not make a different item');
  assert(!sameSettings(s1, s2));
});

test('old long-note switches become rhythms', () => {
  eq(normalise({ rhythm: 'crotchet', longEnds: true }).rhythm, 'crotchetLong');
  eq(normalise({ rhythm: 'crotchet', longEnds: true, longMidTonics: true }).rhythm, 'crotchetLongMid');
  eq(normalise({ rhythm: 'nonsense' }).rhythm, 'crotchet');
  eq(normalise({ precision: 2.6 }).precision, 3);
  eq(normalise({ type: 'scale', slur: 7, rhythm: 'q2' }).slur, 7); // bowing kept with the exercise
});

test('share link round trip keeps names and exercise settings only', () => {
  const list = [makeItem(s1, 'Cello E♭ minor – 3 oct'), makeItem(s2, 'Bass running thirds')];
  const back = decodeShare(encodeShare(list));
  eq(back.length, 2);
  eq(back[0].name, 'Cello E♭ minor – 3 oct');
  eq(ex(expandSettings(back[0].settings)), ex(s1));
  eq(ex(expandSettings(back[1].settings)), ex(s2));
  assert(!('history' in back[0]) && !('importedResults' in back[0]));
});

test('export/import round trip carries results', () => {
  const list = [makeItem(s1, 'A'), makeItem(s2, 'B')];
  const results = { [list[1].id]: { runs: [{ d: 1, t: 70 }], older: [], days: [], months: [] } };
  const back = importJson(exportJson(list, results));
  eq(back.map((x) => x.name), ['A', 'B']);
  eq(back[1].importedResults.runs[0].t, 70);
  assert(!back[0].importedResults);
  eq(ex(expandSettings(back[0].settings)), ex(s1));
  assert(back[0].id !== list[0].id, 'imported items get new ids');
});

test('old list files with score history still import', () => {
  const old = JSON.stringify({ app: 'scale-practice', version: 1, items: [{ id: 'x', name: 'Old', settings: { key: 'D' }, history: [{ d: 5, t: 60, i: 70, ti: 40 }] }] });
  const back = importJson(old);
  eq(back[0].history.length, 1);
});

test('bad input is rejected', () => {
  let threw = false;
  try { decodeShare('not-valid'); } catch { threw = true; }
  assert(threw);
  threw = false;
  try { importJson('{"x":1}'); } catch { threw = true; }
  assert(threw);
});
