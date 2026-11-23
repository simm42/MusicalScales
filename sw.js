// Service worker: lets the installed app open and work without a connection.
// Network first – when online you always get the newest version (and the copy
// kept for offline use is refreshed); offline, the kept copy is used.
// Nothing here sends data anywhere: it only stores the app's own files.
//
// When adding a file to the app, add it to APP_FILES too (tests/pwa.test.js
// checks that every module the app imports is listed).

const CACHE = 'scale-practice-v1';

const APP_FILES = [
  './', './index.html', './manifest.webmanifest',
  './css/styles.css',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
  './js/align.js', './js/analytics.js', './js/backup.js', './js/barSurface.js', './js/calibration.js', './js/doublestop.js', './js/exercises.js', './js/follower.js', './js/games.js',
  './js/instruments.js', './js/main.js', './js/metronome.js', './js/notation.js', './js/pdf.js', './js/persist.js', './js/pieces.js', './js/pieceText.js', './js/pitch.js', './js/playback.js',
  './js/practice.js', './js/practiceList.js', './js/precision.js', './js/profiles.js', './js/pwa.js', './js/results.js', './js/scoring.js',
  './js/segmenter.js', './js/sequence.js', './js/settingsText.js', './js/solfege.js', './js/theory.js', './js/version.js', './js/wakelock.js',
  './js/audio/capture-worklet.js', './js/audio/mic.js', './js/audio/pitch-worker.js', './js/audio/synth.js', './js/audio/timbre.js', './js/audio/wav.js',
  './js/ui/calibrationWizard.js', './js/ui/charts.js', './js/ui/gamesPage.js', './js/ui/meter.js', './js/ui/metronomeCard.js', './js/ui/noteIcons.js', './js/ui/piecesPage.js',
  './js/ui/resultsPage.js', './js/ui/summary.js', './js/ui/surface3d.js', './js/ui/tunerPage.js',
  './vendor/jspdf.umd.min.js', './vendor/vexflow.js',
];

// test pages and recordings are never kept
const SKIP = /\/(tests|debug-recordings)\//;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // one by one, so one missing file does not stop the rest
    await Promise.all(APP_FILES.map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // only the app's own files (never the visit counter or anything else)
  if (req.method !== 'GET' || url.origin !== self.location.origin || SKIP.test(url.pathname) || req.headers.has('range')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(stripSearch(req, url), res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(stripSearch(req, url));
      if (hit) return hit;
      if (req.mode === 'navigate') { const page = await cache.match('./index.html'); if (page) return page; }
      throw err;
    }
  })());
});

/** Keep one copy per file whatever the query string (?debug=…, share links use the #). */
function stripSearch(req, url) {
  if (!url.search) return req;
  return new Request(url.origin + url.pathname);
}
