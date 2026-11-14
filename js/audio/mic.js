// Audio engine: microphone (or a synthetic test performance) → AudioWorklet →
// analysis worker → frames delivered to the page. Everything stays local.

const HOP = 512;

export class MicError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
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
   * iOS audio session (Safari 16.4+): 'playback' plays even with the ring/silent
   * switch on and uses the loudspeaker; 'play-and-record' is needed while the
   * microphone is on. Other browsers ignore this.
   */
  setSessionType(type) {
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
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
          video: false,
        });
      } catch (e) {
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw new MicError('denied', 'Microphone access was blocked. Allow the microphone for this site in your browser settings and try again.');
        if (e && e.name === 'NotFoundError') throw new MicError('nodevice', 'No microphone was found on this device.');
        throw new MicError('other', 'Could not start the microphone: ' + (e && e.message));
      }
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
    this.running = false;
    try { if (this.source && this.source.stop) this.source.stop(); } catch { /* not started */ }
    for (const n of [this.source, this.node, this.sink]) { try { if (n) n.disconnect(); } catch { /* ignore */ } }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.worker) this.worker.terminate();
    this.source = this.node = this.sink = this.stream = this.worker = null;
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }
}
