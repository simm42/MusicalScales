// Installable app: the offline file list in sw.js must cover everything the app loads.
import { test, eq, assert } from './harness.js';

const base = new URL('../', import.meta.url);

async function appFiles() {
  const src = await (await fetch(new URL('sw.js', base), { cache: 'no-store' })).text();
  const block = /const APP_FILES = \[([\s\S]*?)\];/.exec(src);
  assert(block, 'APP_FILES not found in sw.js');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => new URL(m[1], base).pathname);
}

test('the offline list has every module the app imports (and every listed file exists)', async () => {
  const files = await appFiles();
  const listed = new Set(files);
  const missing = [];
  const broken = [];
  for (const path of files) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) { broken.push(path); continue; }
    if (!path.endsWith('.js')) continue;
    const text = await res.text();
    // static and dynamic imports, workers and worklets (new URL('./x.js', import.meta.url))
    const refs = [
      ...text.matchAll(/\bfrom\s+'(\.[^']+)'/g),
      ...text.matchAll(/\bimport\(\s*'(\.[^']+)'\s*\)/g),
      ...text.matchAll(/new URL\(\s*'(\.[^']+)'\s*,\s*import\.meta\.url\s*\)/g),
    ].map((m) => m[1]);
    for (const r of refs) {
      const target = new URL(r, new URL(path, location.origin)).pathname;
      if (target.includes('/tests/')) continue; // the self-test is never needed offline
      if (!listed.has(target)) missing.push(`${target} (from ${path})`);
    }
  }
  eq(broken, [], 'listed files that do not exist');
  eq(missing, [], 'add these to APP_FILES in sw.js');
});

test('the app manifest is valid and its icons are kept offline', async () => {
  const m = await (await fetch(new URL('manifest.webmanifest', base), { cache: 'no-store' })).json();
  eq([m.name, m.display, m.start_url], ['Scale Practice', 'standalone', './']);
  const files = new Set(await appFiles());
  for (const ic of m.icons) assert(files.has(new URL(ic.src, base).pathname), ic.src + ' not in APP_FILES');
  assert(m.icons.some((i) => i.sizes === '512x512') && m.icons.some((i) => i.sizes === '192x192'), 'needs 192 and 512 icons');
});
