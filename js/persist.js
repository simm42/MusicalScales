// Asking the browser to keep the app's data (syllabus, results, pieces) for good.
//
// Without this, browsers may clear a site's data when the device runs short of
// space, and Safari clears it after 7 days of Safari use without opening the site.
// navigator.storage.persist() asks for it to be kept until the person deletes it.
// The browser decides: Chrome and Edge say yes when the site is installed or used a
// lot, Firefox asks the person, Safari decides by itself. A "no" is not an error –
// exporting a copy (Config → Export everything) is still the safe way.

const api = () => (typeof navigator !== 'undefined' && navigator.storage) || null;

/** 'kept' (the browser keeps it for good), 'may-clear', or 'unknown' (the browser can't say). */
export async function storageState(storage = api()) {
  if (!storage || typeof storage.persisted !== 'function') return 'unknown';
  try { return (await storage.persisted()) ? 'kept' : 'may-clear'; } catch { return 'unknown'; }
}

/** Ask for the data to be kept. @returns the state afterwards, as storageState(). */
export async function askToKeep(storage = api()) {
  if (!storage || typeof storage.persist !== 'function') return storageState(storage);
  try {
    if (await storage.persisted()) return 'kept';
    return (await storage.persist()) ? 'kept' : 'may-clear';
  } catch { return storageState(storage); }
}
