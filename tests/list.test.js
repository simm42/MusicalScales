import { test, eq, assert } from './harness.js';
import { makeItem, compactSettings, expandSettings, encodeShare, decodeShare, exportJson, importJson, recordResult, sameSettings } from '../js/practiceList.js';
import { DEFAULT_SETTINGS, normalise } from '../js/exercises.js';

const s1 = normalise({ instrument: 'cello', type: 'scale', key: 'Eb', mode: 'minor', form: 'melodic', range: '3', slur: 7, longEnds: true, precision: 3.25, vibrato: true });
const s2 = normalise({ instrument: 'bass', type: 'runningThirds', key: 'G', range: '1', slur: 3 });

test('settings compact and expand losslessly', () => {
  eq(expandSettings(compactSettings(s1)), s1);
  eq(compactSettings(DEFAULT_SETTINGS), {});
  assert(sameSettings(s1, { ...s1 }));
  assert(!sameSettings(s1, s2));
});

test('share link round trip keeps names and settings, drops scores', () => {
  const list = [makeItem(s1, 'Cello E♭ minor – 3 oct'), makeItem(s2, 'Bass running thirds')];
  recordResult(list[0], { total: 81.2, intonation: 80, timing: 85 });
  const back = decodeShare(encodeShare(list));
  eq(back.length, 2);
  eq(back[0].name, 'Cello E♭ minor – 3 oct');
  eq(expandSettings(back[0].settings), s1);
  eq(expandSettings(back[1].settings), s2);
  eq(back[0].history.length, 0);
});

test('export/import round trip keeps history', () => {
  const list = [makeItem(s1, 'A'), makeItem(s2, 'B')];
  recordResult(list[1], { total: 70, intonation: 66, timing: 81 });
  const back = importJson(exportJson(list));
  eq(back.map((x) => x.name), ['A', 'B']);
  eq(back[1].history[0].t, 70);
  eq(expandSettings(back[0].settings), s1);
});

test('history keeps the last 20 results', () => {
  const it = makeItem(s1, 'A');
  for (let i = 0; i < 25; i++) recordResult(it, { total: i, intonation: i, timing: i });
  eq(it.history.length, 20);
  eq(it.history[0].t, 5);
});

test('bad input is rejected', () => {
  let threw = false;
  try { decodeShare('not-valid'); } catch { threw = true; }
  assert(threw);
  threw = false;
  try { importJson('{"x":1}'); } catch { threw = true; }
  assert(threw);
});
