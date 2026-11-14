// Minimal WAV writer/reader. Recordings made in test mode carry their run
// details as JSON in an extra 'smJS' chunk, which audio players ignore.

const CHUNK_ID = 'smJS';

export function encodeWav(samples, sampleRate, meta = null) {
  const pcmBytes = samples.length * 2;
  const json = meta ? new TextEncoder().encode(JSON.stringify(meta)) : new Uint8Array(0);
  const jsonPad = json.length % 2;
  const metaBytes = meta ? 8 + json.length + jsonPad : 0;
  const total = 12 + 24 + 8 + pcmBytes + metaBytes;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  let p = 0;
  const str = (s) => { for (let i = 0; i < 4; i++) dv.setUint8(p++, s.charCodeAt(i)); };
  str('RIFF'); dv.setUint32(p, total - 8, true); p += 4; str('WAVE');
  str('fmt '); dv.setUint32(p, 16, true); p += 4;
  dv.setUint16(p, 1, true); p += 2;            // PCM
  dv.setUint16(p, 1, true); p += 2;            // mono
  dv.setUint32(p, sampleRate, true); p += 4;
  dv.setUint32(p, sampleRate * 2, true); p += 4;
  dv.setUint16(p, 2, true); p += 2;
  dv.setUint16(p, 16, true); p += 2;
  str('data'); dv.setUint32(p, pcmBytes, true); p += 4;
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    let v = samples[i];
    if (v > 1 || v < -1) { clipped++; v = Math.max(-1, Math.min(1, v)); }
    dv.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7fff, true); p += 2;
  }
  if (meta) {
    str(CHUNK_ID); dv.setUint32(p, json.length, true); p += 4;
    new Uint8Array(buf, p, json.length).set(json); p += json.length + jsonPad;
  }
  return { blob: new Blob([buf], { type: 'audio/wav' }), clipped };
}

/** @returns {{samples: Float32Array, sampleRate: number, meta: object|null}} */
export function decodeWav(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const id = (p) => String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
  if (id(0) !== 'RIFF' || id(8) !== 'WAVE') throw new Error('Not a WAV file');
  let p = 12;
  let fmt = null, data = null, meta = null;
  while (p + 8 <= dv.byteLength) {
    const cid = id(p), size = dv.getUint32(p + 4, true), body = p + 8;
    if (cid === 'fmt ') fmt = { format: dv.getUint16(body, true), channels: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    else if (cid === 'data') data = { start: body, size: Math.min(size, dv.byteLength - body) };
    else if (cid === CHUNK_ID) meta = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, body, size)));
    p = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV file has no audio');
  const ch = fmt.channels, bytes = fmt.bits / 8;
  const frames = Math.floor(data.size / (bytes * ch));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const q = data.start + i * bytes * ch; // first channel only
    if (fmt.format === 3 && fmt.bits === 32) samples[i] = dv.getFloat32(q, true);
    else if (fmt.bits === 16) samples[i] = dv.getInt16(q, true) / 32768;
    else if (fmt.bits === 24) { const v = dv.getUint8(q) | (dv.getUint8(q + 1) << 8) | (dv.getInt8(q + 2) << 16); samples[i] = v / 8388608; }
    else if (fmt.bits === 32) samples[i] = dv.getInt32(q, true) / 2147483648;
    else if (fmt.bits === 8) samples[i] = (dv.getUint8(q) - 128) / 128;
  }
  return { samples, sampleRate: fmt.rate, meta };
}
