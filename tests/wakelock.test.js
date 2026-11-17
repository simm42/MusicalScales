// Keeping the screen on while listening or playing (with a stand-in for the browser's wake lock).
import { test, eq, assert } from './harness.js';
import { hold, release, isAwake, WAKE } from '../js/wakelock.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeWakeLock() {
  const log = [];
  const fake = {
    log,
    async request(type) {
      log.push('request ' + type);
      const listeners = [];
      return {
        addEventListener: (ev, fn) => { if (ev === 'release') listeners.push(fn); },
        release: async () => { log.push('release'); listeners.forEach((f) => f()); },
      };
    },
  };
  return fake;
}

test('the screen is kept on while anything listens or plays, and a little after', async () => {
  const had = Object.getOwnPropertyDescriptor(navigator, 'wakeLock');
  const fake = fakeWakeLock();
  Object.defineProperty(navigator, 'wakeLock', { value: fake, configurable: true });
  const linger = WAKE.lingerMs;
  WAKE.lingerMs = 60;
  try {
    hold('listening');
    hold('metronome');
    await wait(10);
    assert(isAwake(), 'on while listening');
    eq(fake.log, ['request screen']); // asked once, however many things want it
    release('listening');
    await wait(80);
    assert(isAwake(), 'still on: the metronome is going');
    release('metronome');
    await wait(20);
    assert(isAwake(), 'kept on a little longer to read the result');
    hold('play'); // starting again before it lets go: no new request
    release('play');
    await wait(100);
    assert(!isAwake(), 'then the phone may lock as usual');
    eq(fake.log, ['request screen', 'release']);
    release('nothing'); // stopping something never started does no harm
  } finally {
    WAKE.lingerMs = linger;
    if (had) Object.defineProperty(navigator, 'wakeLock', had); else delete navigator.wakeLock;
  }
});
