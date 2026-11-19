// Moving to another device: everything this app keeps in the browser, in one
// file. No DOM access (the page wires up the buttons), so it can be tested.
//
// Microphone calibrations are exported but only the voice's is restored: they
// describe the old device's microphone and room and would mislead on a new one.
// (The voice's record goes with the singer's measured range.)

export const BACKUP_KEYS = {
  list: 'scales.list.v1',
  results: 'scales.results.v1',
  prefs: 'scales.prefs.v1', // settings, student name, A, current exercise
  profiles: 'scales.profiles.v1', // voice range, other instrument
  calibration: 'scales.calibration.v1',
  theme: 'scales.theme',
  metroBeats: 'scales.metroBeats',
  games: 'scales.games.v1', // best scores and levels opened in the games
};
const RAW = new Set(['theme', 'metroBeats']); // stored as plain strings, not JSON

export const BACKUP_KIND = 'full-backup';

function readKey(storage, name) {
  const v = storage.getItem(BACKUP_KEYS[name]);
  if (v == null) return undefined;
  if (RAW.has(name)) return v;
  try { return JSON.parse(v); } catch { return undefined; }
}

/** The whole app state as a JSON string. */
export function makeBackup(storage, { now = new Date(), appVersion = null } = {}) {
  const data = {};
  for (const name of Object.keys(BACKUP_KEYS)) {
    const v = readKey(storage, name);
    if (v !== undefined) data[name] = v;
  }
  return JSON.stringify({ app: 'scale-practice', kind: BACKUP_KIND, version: 1, exported: now.toISOString(), appVersion, data }, null, 1);
}

/** What a backup holds, for the "replace everything?" question. */
export function describeBackup(b) {
  const list = Array.isArray(b.data.list) ? b.data.list : [];
  const results = b.data.results && typeof b.data.results === 'object' ? b.data.results : {};
  let runs = 0;
  for (const rec of Object.values(results)) {
    if (!rec) continue;
    runs += (rec.runs || []).length + (rec.older || []).length;
    for (const a of [...(rec.days || []), ...(rec.months || [])]) runs += a.n || 0;
  }
  return {
    exported: b.exported ? new Date(b.exported) : null,
    student: (b.data.prefs && b.data.prefs.studentName) || '',
    exercises: list.length,
    runs,
  };
}

/**
 * Parse and check a backup file. Throws an Error with a message for the user.
 * @returns {{ backup, summary }}
 */
export function readBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error('That file is not a Scale Practice backup.'); }
  if (!b || b.app !== 'scale-practice' || b.kind !== BACKUP_KIND || !b.data || typeof b.data !== 'object') {
    if (b && (Array.isArray(b) || Array.isArray(b.items))) throw new Error('That file holds only a syllabus – use Import under Syllabus instead.');
    throw new Error('That file is not a Scale Practice backup.');
  }
  if (b.version > 1) throw new Error('That backup was made by a newer version of the app. Reload the page to update, then try again.');
  return { backup: b, summary: describeBackup(b) };
}

/**
 * Replace everything on this device with the backup. Keys the backup does not
 * have are cleared, so the device ends up exactly as the old one was – apart
 * from the microphone calibrations, which stay those of this device.
 */
export function restoreBackup(b, storage) {
  for (const [name, key] of Object.entries(BACKUP_KEYS)) {
    if (name === 'calibration') continue;
    const v = b.data[name];
    if (v === undefined || v === null) storage.removeItem(key);
    else storage.setItem(key, RAW.has(name) ? String(v) : JSON.stringify(v));
  }
  // the singer's range comes with its measurement; this device's microphone calibrations stay
  const here = readKey(storage, 'calibration') || {};
  const cal = b.data.calibration && b.data.calibration.voice;
  if (cal) here.voice = cal;
  else delete here.voice;
  if (Object.keys(here).length) storage.setItem(BACKUP_KEYS.calibration, JSON.stringify(here));
  else storage.removeItem(BACKUP_KEYS.calibration);
}

export function backupFilename(studentName, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const who = String(studentName || '').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `scale-practice-backup${who ? '-' + who : ''}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
