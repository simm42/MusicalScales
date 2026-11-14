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
   * @param {object} o
   * @param {'mic'|'buffer'} o.source
   * @param {AudioBuffer} [o.buffer] synthetic performance to analyse
   * @param {boolean} [o.monitor] also play the buffer through the speakers
   * @param {number} o.minFreq
   * @param {number} o.maxFreq
   * @param {boolean} [o.peaks] spectrum peaks for double stops
   * @param {(frames:object[])=>void} o.onFrames
   */
  async start(o) {
    await this.stop();
    const ctx = await this.ensureContext();
    this.onFrames = o.onFrames;

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
      this.node = new AudioWorkletNode(ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', processorOptions: { chunk: HOP } });
      const ch = new MessageChannel();
      this.node.port.postMessage({ port: ch.port1 }, [ch.port1]);
      this.worker.postMessage({ ...init, port: ch.port2 }, [ch.port2]);
    } else {
      // Fallback for very old browsers
      this.worker.postMessage(init);
      const sp = ctx.createScriptProcessor(HOP, 1, 1);
      sp.onaudioprocess = (ev) => {
        const data = new Float32Array(ev.inputBuffer.getChannelData(0));
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
