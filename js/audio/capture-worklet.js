// AudioWorklet: collects mono input into chunks and posts them, with the
// audio-clock sample index of their first sample, to the analysis worker.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunk = (options.processorOptions && options.processorOptions.chunk) || 512;
    this.buf = new Float32Array(this.chunk);
    this.n = 0;
    this.start = 0;
    this.out = null;
    this.port.onmessage = (e) => { if (e.data && e.data.port) this.out = e.data.port; };
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const ch = input[0];
      for (let i = 0; i < ch.length; i++) {
        if (this.n === 0) this.start = currentFrame + i;
        this.buf[this.n++] = ch[i];
        if (this.n === this.chunk) {
          if (this.out) this.out.postMessage({ samples: this.buf, frame: this.start }, [this.buf.buffer]);
          this.buf = new Float32Array(this.chunk);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
