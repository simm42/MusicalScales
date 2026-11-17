// Keep the screen on while the app is listening or making sound (a phone that
// locks itself mid-scale stops the microphone). Uses the Screen Wake Lock:
// iPhone Safari 16.4+, and Home Screen apps from iOS 18.4; Chrome, Edge,
// Android. Elsewhere it quietly does nothing.
//
// Anything that listens or plays calls hold(name) when it starts and
// release(name) when it stops. The screen stays on while anything is held,
// and for a little while after (time to read the result), then the phone's
// own auto-lock takes over again.

export const WAKE = { lingerMs: 120000 };

const holders = new Set();
let sentinel = null;
let lingerTimer = null;
let requesting = false;

const supported = () => typeof navigator !== 'undefined' && navigator.wakeLock && typeof navigator.wakeLock.request === 'function';
const wanted = () => holders.size > 0 || lingerTimer != null;

async function acquire() {
  if (sentinel || requesting || !supported() || (typeof document !== 'undefined' && document.hidden)) return;
  requesting = true;
  try {
    const s = await navigator.wakeLock.request('screen');
    sentinel = s;
    // the system lets go when the app goes into the background, or on low battery
    s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
    if (!wanted()) letGo(); // everything stopped while we were asking
  } catch { /* not allowed now (low power mode, not visible): fine */ }
  requesting = false;
}

function letGo() {
  const s = sentinel;
  sentinel = null;
  if (s) s.release().catch(() => {});
}

/** Something started listening or playing. */
export function hold(name) {
  holders.add(name);
  clearTimeout(lingerTimer);
  lingerTimer = null;
  acquire();
}

/** It stopped: keep the screen on a little longer, then let the phone lock as usual. */
export function release(name) {
  if (!holders.delete(name) || holders.size) return;
  clearTimeout(lingerTimer);
  lingerTimer = setTimeout(() => { lingerTimer = null; if (!holders.size) letGo(); }, WAKE.lingerMs);
}

/** For the self-test: whether the screen is being kept on right now. */
export function isAwake() { return !!sentinel; }

// back from the background: ask again if something still wants the screen on
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden && wanted()) acquire(); });
}
