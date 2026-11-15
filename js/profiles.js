// Per-device settings for the two instruments whose range is not fixed:
//  voice – the singer's measured range (sounding MIDI) and voice type
//  other – any instrument: written lowest/highest note, transposition, clef, name
// Stored only in this browser. No other imports, so instruments.js can use it.

const KEY = 'scales.profiles.v1';

export const DEFAULT_PROFILES = {
  // low/high: sounding MIDI numbers measured by the range finder (null = not measured)
  // type: voice type found from the range; override: voice type chosen by hand ('' = use the range)
  voice: { low: null, high: null, type: null, override: '', measured: null },
  // low/high: WRITTEN MIDI numbers; transpose: semitones from written to sounding
  other: { name: '', low: 60, high: 84, transpose: 0, clef: 'auto' },
};

export const OTHER_LIMITS = { lowest: 21, highest: 108, minSpan: 12 }; // A0–C8, at least an octave

const intIn = (x, lo, hi, def) => {
  if (x == null || x === '') return def;
  const n = Math.round(Number(x));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

/**
 * A valid "other instrument" setup: the highest note is always at least an
 * octave above the lowest (raised if needed), transposition +12 to −24.
 */
export function cleanOther(p = {}) {
  const d = DEFAULT_PROFILES.other;
  const { lowest, highest, minSpan } = OTHER_LIMITS;
  const low = intIn(p.low, lowest, highest - minSpan, d.low);
  const high = Math.max(low + minSpan, intIn(p.high, lowest, highest, d.high));
  return {
    name: String(p.name ?? '').trim().slice(0, 40),
    low,
    high,
    transpose: intIn(p.transpose, -24, 12, 0),
    clef: ['auto', 'treble', 'alto', 'tenor', 'bass'].includes(p.clef) ? p.clef : 'auto',
  };
}

let cache = null;
let temporary = false;

function load() {
  if (cache) return cache;
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { stored = {}; }
  cache = {
    voice: { ...DEFAULT_PROFILES.voice, ...(stored.voice || {}) },
    other: cleanOther({ ...DEFAULT_PROFILES.other, ...(stored.other || {}) }),
  };
  return cache;
}

export function getProfile(id) { return load()[id] || null; }
export function getProfiles() { return JSON.parse(JSON.stringify(load())); }

export function setProfile(id, patch) {
  const all = load();
  all[id] = { ...(all[id] || DEFAULT_PROFILES[id]), ...patch };
  if (id === 'other') all[id] = cleanOther(all[id]);
  if (!temporary) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ } }
  return all[id];
}

/**
 * Use the given profiles in memory only (replaying a recording made on another
 * device, or tests). Nothing is saved. Pass null to go back to the stored ones.
 */
export function useProfiles(profiles) {
  if (profiles == null) { cache = null; temporary = false; return; }
  temporary = true;
  cache = {
    voice: { ...DEFAULT_PROFILES.voice, ...(profiles.voice || {}) },
    other: cleanOther({ ...DEFAULT_PROFILES.other, ...(profiles.other || {}) }),
  };
}
