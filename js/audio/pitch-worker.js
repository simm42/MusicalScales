// Web Worker: runs pitch analysis off the main thread.
import { FrameAnalyzer } from '../pitch.js';

let analyzer = null;
let batch = [];

function handleChunk({ samples, frame }) {
  if (!analyzer) return;
  const frames = analyzer.push(samples, frame);
  if (frames.length) {
    batch.push(...frames);
    postMessage({ type: 'frames', frames: batch });
    batch = [];
  }
}

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    analyzer = new FrameAnalyzer({ sampleRate: msg.sampleRate, minFreq: msg.minFreq, maxFreq: msg.maxFreq, hop: msg.hop || 512, peaks: !!msg.peaks });
    if (msg.port) msg.port.onmessage = (ev) => handleChunk(ev.data);
    postMessage({ type: 'ready', windowSize: analyzer.size });
  } else if (msg.type === 'config' && analyzer) {
    if ('minFreq' in msg) analyzer.minFreq = msg.minFreq;
    if ('maxFreq' in msg) analyzer.maxFreq = msg.maxFreq;
    if ('peaks' in msg) analyzer.setPeaks(msg.peaks);
  } else if (msg.type === 'chunk') {
    handleChunk(msg);
  }
};
