// The student's syllabus: saved exercises. (Scores live in results.js.)
// Stored only in this browser (localStorage). Share links put the list after
// the '#' of the URL, which browsers never send to the server.

import { DEFAULT_SETTINGS, EXERCISE_FIELDS, normalise } from './exercises.js';

const KEY = 'scales.list.v1';
const HISTORY_MAX = 20;
// only the exercise itself belongs to a syllabus item; rhythm, display and
// listening options are global preferences
const FIELDS = EXERCISE_FIELDS;

export function compactSettings(s) {
  const n = normalise(s);
  const out = {};
  for (const k of FIELDS) if (n[k] !== DEFAULT_SETTINGS[k]) out[k] = n[k];
  return out;
}
export function expandSettings(c) { return normalise({ ...DEFAULT_SETTINGS, ...c }); }

export function sameSettings(a, b) { return JSON.stringify(compactSettings(a)) === JSON.stringify(compactSettings(b)); }

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function makeItem(settings, name, autoName = true) {
  return { id: uid(), name, autoName, settings: compactSettings(settings) };
}

export function loadList() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => x && x.settings) : [];
  } catch { return []; }
}

export function saveList(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}


// ---- share / export -----------------------------------------------------
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Only names and settings are shared – never the student's scores. */
export function encodeShare(list) {
  return b64urlEncode(JSON.stringify({ v: 1, items: list.map((x) => ({ n: x.name, a: x.autoName ? 1 : 0, s: compactSettings(expandSettings(x.settings)) })) }));
}

export function decodeShare(str) {
  const data = JSON.parse(b64urlDecode(str));
  if (!data || !Array.isArray(data.items)) throw new Error('Not a practice list');
  return data.items.map((x) => ({ id: uid(), name: String(x.n || 'Exercise').slice(0, 120), autoName: !!x.a, settings: compactSettings(expandSettings(x.s || {})) }));
}

/** Export the syllabus with its results (for moving to another device). */
export function exportJson(list, results = {}) {
  const res = {};
  for (const x of list) if (results[x.id]) res[x.id] = results[x.id];
  return JSON.stringify({ app: 'scale-practice', version: 2, items: list, results: res }, null, 2);
}

/**
 * @returns items with new ids; each carries `importedResults` (its results
 * record from the file, if any) and possibly an old-style `history`.
 */
export function importJson(text) {
  const data = JSON.parse(text);
  const items = Array.isArray(data) ? data : data.items;
  if (!Array.isArray(items)) throw new Error('Not a syllabus file');
  const results = (!Array.isArray(data) && data.results) || {};
  return items.filter((x) => x && x.settings).map((x) => {
    const item = {
      id: uid(),
      name: String(x.name || 'Exercise').slice(0, 120),
      autoName: !!x.autoName,
      settings: compactSettings(expandSettings(x.settings)),
    };
    if (Array.isArray(x.history) && x.history.length) item.history = x.history.slice(-HISTORY_MAX);
    if (results[x.id]) item.importedResults = results[x.id];
    return item;
  });
}
