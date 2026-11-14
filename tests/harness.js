// Minimal in-browser test harness.
const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }

export function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }
export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e} got ${a}`);
}
export function near(actual, expected, tol, msg = '') {
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`${msg} expected ${expected}±${tol} got ${actual}`);
}

export async function run(out) {
  const results = [];
  for (const t of tests) {
    const t0 = performance.now();
    try { await t.fn(); results.push({ name: t.name, ok: true, ms: performance.now() - t0 }); }
    catch (e) { results.push({ name: t.name, ok: false, error: e.message, ms: performance.now() - t0 }); console.error(t.name, e); }
  }
  const failed = results.filter((r) => !r.ok);
  if (out) {
    out.innerHTML = `<h2 class="${failed.length ? 'fail' : 'pass'}">${results.length - failed.length} / ${results.length} passed</h2>` +
      results.map((r) => `<div class="${r.ok ? 'pass' : 'fail'}">${r.ok ? '✔' : '✘'} ${r.name} <small>${r.ms.toFixed(0)} ms</small>${r.ok ? '' : `<pre>${r.error}</pre>`}</div>`).join('');
  }
  window.__testResults = { total: results.length, failed: failed.map((f) => `${f.name}: ${f.error}`) };
  return results;
}
