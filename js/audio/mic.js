// Audio engine: microphone (or a synthetic test performance) → AudioWorklet →
// analysis worker → frames delivered to the page. Everything stays local.

import { hold, release } from '../wakelock.js';

const HOP = 512;
const STALL_MS = 3000; // no sound analysed for this long: the audio has stopped

export class MicError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

const MIC_CONSTRAINTS = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  video: false,
};

function micError(e) {
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return new MicError('denied', 'Microphone access was blocked. Allow the microphone for this site in your browser settings and try again.');
  if (e && e.name === 'NotFoundError') return new MicError('nodevice', 'No microphone was found on this device.');
  return new MicError('other', 'Could not start the microphone: ' + (e && e.message));
}

export function micSupportProblem() {
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'unsupported';
  return null;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.worker = null;
    this.node = null;
    this.source = null;
    this.stream = null;
    this.onFrames = null;
    this.running = false;
    // keepMic: hold one microphone stream open while the app is open, so the
    // browser asks for permission once and Start begins at once
    this.keepMic = false;
    this.held = null;
    this.releaseWhenStopped = false;
  }

  /** The held microphone stream, if it is still live. */
  heldStream() {
    const s = this.held;
    // iOS silences ("mutes") the microphone while the app is in the background,
    // but the track still says live: a muted track sends nothing
    return s && s.getAudioTracks().some((t) => t.readyState === 'live' && !t.muted) ? s : null;
  }

  /** A live microphone stream: the held one, or a new one (asks permission the first time). */
  async openMic() {
    const live = this.heldStream();
    if (live) return live;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS); } catch (e) { throw micError(e); }
    if (this.keepMic) {
      this.held = stream;
      // the system can end it (a phone call, another app taking the microphone): open again when needed
      const drop = () => {
        if (this.held !== stream) return;
        this.held = null;
        if (this.stream !== stream) stream.getTracks().forEach((t) => t.stop()); // in use: stop() closes it
      };
      stream.getAudioTracks().forEach((t) => { t.addEventListener('ended', drop); t.addEventListener('mute', drop); });
    }
    return stream;
  }

  /**
   * Open the microphone now (when the app opens, or comes back into view), so
   * that Start needs no permission question. Errors are returned, not thrown.
   */
  async warmUp() {
    if (!this.keepMic || micSupportProblem()) return null;
    try { await this.openMic(); return null; } catch (e) { return e; }
  }

  /** Close the held microphone (the keep-open option was switched off). */
  releaseMic() {
    if (this.running && this.stream === this.held) { this.releaseWhenStopped = true; return; }
    if (this.held) this.held.getTracks().forEach((t) => t.stop());
    this.held = null;
  }

  /**
   * The app went into the background. iOS silences the microphone and pauses
   * this app's audio; a fresh microphone request on return wakes it again.
   * Call after stopping anything that is listening.
   */
  sleep() {
    if (this.held && this.stream !== this.held) this.held.getTracks().forEach((t) => t.stop());
    if (this.stream !== this.held) this.held = null;
    this.slept = true;
  }

  setKeepMic(on) {
    this.keepMic = !!on;
    if (!this.keepMic) this.releaseMic();
  }

  /** Must be called from a user gesture (tap/click) the first time – iOS requirement. */
  async ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
  }

  /**
   * Call synchronously at the very start of every tap/click handler that will
   * make or record sound. iOS only lets audio start inside the tap itself –
   * anything after an await or timer stays silent.
   */
  unlock(sessionType = null) {
    if (sessionType) this.setSessionType(sessionType);
    // iOS leaves the context "interrupted" after the app was in the background; one
    // that stopped delivering sound is not to be trusted either: start a new one
    // (after the app was in the background, too: iOS may not say so until later)
    const stale = this.ctx && (this.ctx.state === 'closed' || this.ctx.state === 'interrupted' || this.stalled || this.slept);
    if (stale && !this.running) {
      try { if (this.ctx.state !== 'closed') this.ctx.close(); } catch { /* ignore */ }
      this.ctx = null;
    }
    if (!this.running) { this.stalled = false; this.slept = false; }
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    try {
      // a one-sample silent sound started inside the tap unlocks output on older iOS
      const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.connect(this.ctx.destination);
      src.start(0);
    } catch { /* not needed elsewhere */ }
  }

  /**
   * iPhones mute Web Audio when the ring/silent switch is on, but not media
   * elements. While a looping silent <audio> plays, Web Audio sounds come through
   * too (metronome, reference tones). Call with true inside the tap.
   */
  holdMediaSession(on) {
    try {
      if (on) {
        if (!this.silentEl) {
          // 1 s of silence as a WAV (16-bit mono, 8 kHz)
          const n = 8000, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
          const w = (p, s) => { for (let i = 0; i < 4; i++) dv.setUint8(p + i, s.charCodeAt(i)); };
          w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true);
          dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 8000, true); dv.setUint32(28, 16000, true);
          dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
          this.silentEl = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
          this.silentEl.loop = true;
          this.silentEl.setAttribute('playsinline', '');
        }
        this.mediaHolds = (this.mediaHolds || 0) + 1;
        const p = this.silentEl.play();
        if (p && p.catch) p.catch(() => {});
      } else if (this.silentEl) {
        this.mediaHolds = Math.max(0, (this.mediaHolds || 1) - 1);
        if (!this.mediaHolds) this.silentEl.pause();
      }
    } catch { /* not needed elsewhere */ }
  }

  /**
   * iOS audio session (Safari 16.4+): 'playback' plays even with the ring/silent
   * switch on and uses the loudspeaker; 'play-and-record' is needed while the
   * microphone is on. Other browsers ignore this.
   */
  setSessionType(type) {
    // while the microphone is held open, stay in play-and-record: switching to
    // playback would interrupt it (and play-and-record ignores the silent switch too)
    if (type === 'playback' && this.heldStream()) type = 'play-and-record';
    try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch { /* unsupported */ }
  }

  /**
   * @param {object} o
   * @param {'mic'|'buffer'} o.source
   * @param {AudioBuffer} [o.buffer] synthetic performance to analyse
   * @param {boolean} [o.monitor] also play the buffer through the speakers
   * @param {number} o.minFreq
   * @param {number} o.maxFreq
   * @param {boolean} [o.peaks] spectrum peaks for double stops
   * @param {boolean} [o.capture] keep a copy of everything the microphone hears (fault-finding)
   * @param {(frames:object[])=>void} o.onFrames
   */
  async start(o) {
    if (o.source === 'mic') this.setSessionType('play-and-record');
    const ready = this.ensureContext(); // before any await, so it still counts as part of the tap
    await this.stop();
    const ctx = await ready;
    this.onFrames = o.onFrames;
    this.captured = o.capture ? [] : null;

    if (o.source === 'mic') {
      const problem = micSupportProblem();
      if (problem === 'insecure') throw new MicError('insecure', 'The microphone only works when this page is opened over https:// (or from localhost).');
      if (problem) throw new MicError('unsupported', 'This browser does not support microphone input.');
      this.stream = await this.openMic();
      this.source = ctx.createMediaStreamSource(this.stream);
      // what the browser really gave us (webcam mics sometimes ignore "auto-gain off" etc.)
      try {
        const track = this.stream.getAudioTracks()[0];
        this.trackInfo = {
          label: track.label,
          settings: track.getSettings ? track.getSettings() : null,
          capabilities: track.getCapabilities ? track.getCapabilities() : null,
        };
      } catch { this.trackInfo = null; }
    } else {
      const src = ctx.createBufferSource();
      src.buffer = o.buffer;
      this.source = src;
      if (o.monitor) src.connect(ctx.destination);
    }

    this.worker = new Worker(new URL('./pitch-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      if (e.data.type === 'frames') this.lastFrameAt = performance.now();
      if (e.data.type === 'frames' && this.onFrames) this.onFrames(e.data.frames);
      if (e.data.type === 'ready') this.windowSize = e.data.windowSize;
    };
    const init = { type: 'init', sampleRate: ctx.sampleRate, minFreq: o.minFreq, maxFreq: o.maxFreq, hop: HOP, peaks: !!o.peaks };

    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    this.sink = sink;

    if (ctx.audioWorklet) {
      await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', processorOptions: { chunk: HOP, capture: !!o.capture } });
      if (o.capture) this.node.port.onmessage = (e) => { if (this.captured && e.data.samples) this.captured.push(e.data); };
      const ch = new MessageChannel();
      this.node.port.postMessage({ port: ch.port1 }, [ch.port1]);
      this.worker.postMessage({ ...init, port: ch.port2 }, [ch.port2]);
    } else {
      // Fallback for very old browsers
      this.worker.postMessage(init);
      const sp = ctx.createScriptProcessor(HOP, 1, 1);
      sp.onaudioprocess = (ev) => {
        const data = new Float32Array(ev.inputBuffer.getChannelData(0));
        if (this.captured) this.captured.push({ samples: data.slice(), frame: Math.round(ev.playbackTime * ctx.sampleRate) });
        this.worker.postMessage({ type: 'chunk', samples: data, frame: Math.round(ev.playbackTime * ctx.sampleRate) }, [data.buffer]);
      };
      this.node = sp;
    }
    this.source.connect(this.node);
    this.node.connect(sink);
    if (o.source !== 'mic') this.source.start(ctx.currentTime + 0.05);
    this.running = true;
    hold('listening'); // keep the screen on while listening (a locked phone stops the microphone)
    this.lastFrameAt = performance.now();
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (!this.running || document.hidden) return;
      if (performance.now() - this.lastFrameAt > STALL_MS) {
        clearInterval(this.watchdog);
        this.stalled = true; // the next tap starts a new audio context
        if (this.onStall) this.onStall();
      }
    }, 500);
    return ctx;
  }

  /** Details of the audio set-up, for fault-finding. */
  describe() {
    const c = this.ctx;
    return {
      context: c ? { sampleRate: c.sampleRate, baseLatency: c.baseLatency ?? null, outputLatency: c.outputLatency ?? null, state: c.state } : null,
      track: this.trackInfo || null,
      windowSize: this.windowSize || null,
      hop: HOP,
      audioSession: navigator.audioSession ? navigator.audioSession.type : null,
    };
  }

  /** Everything captured since start(): { samples, sampleRate, startTime } or null. */
  takeCapture() {
    const parts = this.captured;
    this.captured = null;
    if (!parts || !parts.length || !this.ctx) return null;
    const n = parts.reduce((a, p) => a + p.samples.length, 0);
    const samples = new Float32Array(n);
    let o = 0;
    for (const p of parts) { samples.set(p.samples, o); o += p.samples.length; }
    return { samples, sampleRate: this.ctx.sampleRate, startTime: parts[0].frame / this.ctx.sampleRate };
  }

  setPeaks(on) { if (this.worker) this.worker.postMessage({ type: 'config', peaks: on }); }

  async stop() {
    if (this.running) release('listening');
    this.running = false;
    clearInterval(this.watchdog);
    try { if (this.source && this.source.stop) this.source.stop(); } catch { /* not started */ }
    for (const n of [this.source, this.node, this.sink]) { try { if (n) n.disconnect(); } catch { /* ignore */ } }
    // the held microphone stays open (unless keeping it open was just switched off)
    if (this.stream && (this.stream !== this.held || this.releaseWhenStopped)) {
      this.stream.getTracks().forEach((t) => t.stop());
      if (this.stream === this.held) this.held = null;
    }
    this.releaseWhenStopped = false;
    if (this.worker) this.worker.terminate();
    this.source = this.node = this.sink = this.stream = this.worker = null;
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }
}
