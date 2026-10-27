// Tiny offline synth shared by gen-music.js and gen-sfx.js.
// Everything is rendered at SR = 44100 Hz into Float32Arrays, then decimated (optionally cyclically,
// for seamless loops) to 22050 Hz mono and encoded to MP3 with a local ffmpeg (libmp3lame).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SR = 44100;
const OUT_SR = 22050;
const TAU = Math.PI * 2;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const dbToGain = db => Math.pow(10, db / 20);

// deterministic PRNG (mulberry32) so every render is reproducible
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- oscillators (phase in cycles, 0..1)
function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
const osc = {
  sine: (p) => Math.sin(TAU * p),
  tri: (p) => { const x = p % 1; return x < 0.5 ? 4 * x - 1 : 3 - 4 * x; },
  saw: (p, dt) => { const x = p % 1; return 2 * x - 1 - polyBlep(x, dt); },
  // band-limited pulse, made zero-mean
  pulse: (p, dt, duty = 0.5) => {
    const x = p % 1; let v = x < duty ? 1 : -1;
    v += polyBlep(x, dt); v -= polyBlep((x + 1 - duty) % 1, dt);
    return v - (2 * duty - 1);
  },
};

// ---------------------------------------------------------------- envelopes & filters
// ADSR value at time t for a note held `hold` seconds
function adsr(t, hold, a, d, s, r) {
  if (t < 0) return 0;
  let v;
  if (t < a) v = t / a;
  else if (t < a + d) v = 1 - (1 - s) * (t - a) / d;
  else v = s;
  if (t > hold) {
    const lv = hold < a ? hold / a : hold < a + d ? 1 - (1 - s) * (hold - a) / d : s;
    v = lv * Math.max(0, 1 - (t - hold) / r);
  }
  return v;
}
class OnePoleLP {
  constructor(fc) { this.set(fc); this.y = 0; }
  set(fc) { this.a = 1 - Math.exp(-TAU * fc / SR); }
  run(x) { this.y += this.a * (x - this.y); return this.y; }
}
class OnePoleHP {
  constructor(fc) { this.lp = new OnePoleLP(fc); }
  run(x) { return x - this.lp.run(x); }
}
// RBJ biquad (lowpass / highpass / bandpass)
class Biquad {
  constructor(type, fc, q = 0.707) { this.type = type; this.q = q; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(fc); }
  set(fc) {
    const w = TAU * Math.min(fc, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * this.q);
    let b0, b1, b2; const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    if (this.type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (this.type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; } // band-pass, 0 dB peak
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y;
  }
}

// ---------------------------------------------------------------- effects
// Freeverb-style mono reverb (4 damped combs + 2 allpasses)
function reverb(input, { room = 0.8, damp = 0.3, scale = 1 } = {}) {
  const out = new Float32Array(input.length);
  const combs = [1557, 1617, 1491, 1422].map(n => ({ buf: new Float32Array(Math.round(n * scale)), i: 0, f: 0 }));
  const aps = [556, 441].map(n => ({ buf: new Float32Array(Math.round(n * scale)), i: 0 }));
  for (let n = 0; n < input.length; n++) {
    const x = input[n] * 0.25; let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i]; c.f = o * (1 - damp) + c.f * damp;
      c.buf[c.i] = x + c.f * room; c.i = (c.i + 1) % c.buf.length; y += o;
    }
    for (const a of aps) { const b = a.buf[a.i]; const v = -y + b; a.buf[a.i] = y + b * 0.5; a.i = (a.i + 1) % a.buf.length; y = v; }
    out[n] = y;
  }
  return out;
}
// feedback delay with a darkening filter in the loop
function delay(input, seconds, fb, lpHz = 3000) {
  const d = Math.round(seconds * SR), out = new Float32Array(input.length), lp = new OnePoleLP(lpHz);
  const buf = new Float32Array(d); let i = 0;
  for (let n = 0; n < input.length; n++) {
    const o = buf[i]; buf[i] = input[n] + lp.run(o) * fb; i = (i + 1) % d; out[n] = o;
  }
  return out;
}

// ---------------------------------------------------------------- utilities
function peak(buf) { let p = 0; for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i])); return p; }
function normalize(buf, db) { const p = peak(buf) || 1, g = dbToGain(db) / p; for (let i = 0; i < buf.length; i++) buf[i] *= g; return buf; }
function removeDC(buf) { let m = 0; for (let i = 0; i < buf.length; i++) m += buf[i]; m /= buf.length; for (let i = 0; i < buf.length; i++) buf[i] -= m; return m; }
// fold everything past `len` back onto the start: the loop then contains its own reverb / release tails
function wrapTail(buf, len) {
  const out = new Float32Array(len);
  for (let i = 0; i < buf.length; i++) out[i % len] += buf[i];
  return out;
}
// equal-power crossfade loop for noise-like material: needs buf.length >= len + xf
function crossfadeLoop(buf, len, xf) {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = buf[i];
  for (let i = 0; i < xf; i++) { const k = i / xf; out[i] = buf[i] * Math.sin(k * Math.PI / 2) + buf[len + i] * Math.cos(k * Math.PI / 2); }
  return out;
}
// 2:1 decimation with a 95-tap windowed-sinc lowpass at ~10 kHz; `cyclic` keeps loops seamless
function decimate2(buf, cyclic) {
  const taps = 95, half = (taps - 1) / 2, fc = 10000 / SR, h = new Float32Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const n = i - half, s = n === 0 ? 2 * fc : Math.sin(TAU * fc * n) / (Math.PI * n);
    const w = 0.42 - 0.5 * Math.cos(TAU * i / (taps - 1)) + 0.08 * Math.cos(2 * TAU * i / (taps - 1)); // Blackman
    h[i] = s * w; sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const N = buf.length, out = new Float32Array(Math.floor(N / 2));
  for (let o = 0; o < out.length; o++) {
    const c = o * 2; let acc = 0;
    for (let k = 0; k < taps; k++) {
      let j = c + k - half;
      if (cyclic) j = ((j % N) + N) % N; else if (j < 0 || j >= N) continue;
      acc += buf[j] * h[k];
    }
    out[o] = acc;
  }
  return out;
}
function writeWav(file, buf, sr) {
  const n = buf.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buf[i] * 32767))), 44 + i * 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, b);
}
const FFMPEG = process.env.FFMPEG || 'C:/Program Files/Kdenlive/bin/ffmpeg.exe';
function encodeMp3(wav, mp3, kbps) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', kbps + 'k', '-ac', '1', mp3]);
  return fs.statSync(mp3).size;
}
// decode any file back to mono float32 at `sr` (for numeric checks)
function decode(file, sr = OUT_SR) {
  const raw = execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(sr), '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

module.exports = { SR, OUT_SR, TAU, mtof, dbToGain, rng, osc, adsr, OnePoleLP, OnePoleHP, Biquad, reverb, delay,
  peak, normalize, removeDC, wrapTail, crossfadeLoop, decimate2, writeWav, encodeMp3, decode, FFMPEG };
