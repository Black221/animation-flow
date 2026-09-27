// WAV files, read and written without any library (browser and Node alike): PCM 16/24/32-bit and 32-bit float.
export interface AudioData { sampleRate: number; channels: Float32Array[] }

export function encodeWav(a: AudioData, bits: 16 | 32 = 16): Uint8Array {
  const n = a.channels[0]?.length ?? 0, ch = a.channels.length, bps = bits / 8, data = n * ch * bps;
  const buf = new ArrayBuffer(44 + data), v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, a.sampleRate, true); v.setUint32(28, a.sampleRate * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const x = a.channels[c]![i]!;
    if (bits === 32) v.setFloat32(o, x, true);
    else v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(x * 32767))), true);
    o += bps;
  }
  return new Uint8Array(buf);
}

export function decodeWav(bytes: Uint8Array): AudioData {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = 0, ch = 0, sr = 0, bits = 0, o = 12, dataAt = -1, dataLen = 0;
  while (o + 8 <= bytes.length) {
    const id = tag(o), len = v.getUint32(o + 4, true);
    if (id === 'fmt ') { fmt = v.getUint16(o + 8, true); ch = v.getUint16(o + 10, true); sr = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); if (fmt === 0xfffe) fmt = v.getUint16(o + 32, true); }
    else if (id === 'data') { dataAt = o + 8; dataLen = Math.min(len, bytes.length - dataAt); break; }
    o += 8 + len + (len % 2);
  }
  if (dataAt < 0 || !ch || !sr) throw new Error('WAV file without format or data');
  const bps = bits / 8, n = Math.floor(dataLen / (bps * ch)), out = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const p = dataAt + (i * ch + c) * bps;
    let x: number;
    if (fmt === 3 && bits === 32) x = v.getFloat32(p, true);
    else if (bits === 16) x = v.getInt16(p, true) / 32768;
    else if (bits === 24) { const b = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16); x = b / 8388608; }
    else if (bits === 32) x = v.getInt32(p, true) / 2147483648;
    else if (bits === 8) x = (v.getUint8(p) - 128) / 128;
    else throw new Error(`unsupported WAV: ${bits}-bit, format ${fmt}`);
    out[c]![i] = x;
  }
  return { sampleRate: sr, channels: out };
}
