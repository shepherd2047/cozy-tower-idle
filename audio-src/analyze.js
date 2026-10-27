// Numeric "listening": peak / RMS / DC / clipping, loop-seam continuity and a coarse spectrum.
//   node analyze.js file.mp3 [reference.wav]
'use strict';
const S = require('./synth');
const db = x => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);

function fft(re, im) { // in-place radix-2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
function bands(x, sr) {
  const F = 4096, edges = [0, 100, 250, 500, 1000, 2000, 4000, 8000, sr / 2], acc = new Array(edges.length - 1).fill(0);
  for (let s = 0; s + F <= x.length; s += F * 2) {
    const re = new Float64Array(F), im = new Float64Array(F);
    for (let i = 0; i < F; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / F));
    fft(re, im);
    for (let k = 1; k < F / 2; k++) { const f = k * sr / F, p = re[k] * re[k] + im[k] * im[k]; for (let b = 0; b < acc.length; b++) if (f >= edges[b] && f < edges[b + 1]) acc[b] += p; }
  }
  const tot = acc.reduce((a, b) => a + b, 0) || 1;
  return acc.map((p, b) => `${edges[b]}-${Math.round(edges[b + 1])}Hz ${(100 * p / tot).toFixed(1)}%`).join(' | ');
}
function stats(x, sr, label) {
  let pk = 0, sq = 0, sum = 0, clip = 0;
  for (const v of x) { pk = Math.max(pk, Math.abs(v)); sq += v * v; sum += v; if (Math.abs(v) >= 0.999) clip++; }
  const N = x.length, diffs = new Float32Array(N - 1);
  for (let i = 1; i < N; i++) diffs[i - 1] = Math.abs(x[i] - x[i - 1]);
  const sorted = Float32Array.from(diffs).sort(), p99 = sorted[Math.floor(sorted.length * 0.99)], med = sorted[Math.floor(sorted.length / 2)];
  const seam = Math.abs(x[0] - x[N - 1]);
  // short-term RMS just before / after the seam vs the loop's typical 20 ms RMS
  const w = Math.round(0.02 * sr), rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) { const v = x[(i + N) % N]; s += v * v; } return Math.sqrt(s / (b - a)); };
  const before = rms(-w, 0), after = rms(0, w);
  console.log(`[${label}] ${(N / sr).toFixed(3)} s | peak ${db(pk)} dBFS | RMS ${db(Math.sqrt(sq / N))} dBFS | DC ${(sum / N).toExponential(1)} | clipped ${clip}`);
  console.log(`   seam step ${seam.toFixed(4)} (median step ${med.toFixed(4)}, p99 ${p99.toFixed(4)}) -> ${seam <= p99 ? 'OK' : 'CHECK'} | 20 ms RMS before/after seam ${db(before)} / ${db(after)} dB`);
  console.log('   spectrum ' + bands(x, sr));
  return { pk, N, seam, p99 };
}
function report(mp3, wav) {
  if (wav) stats(S.decode(wav), S.OUT_SR, 'wav');
  const d = S.decode(mp3), r = stats(d, S.OUT_SR, 'mp3 decoded');
  if (wav) { const ref = S.decode(wav).length; console.log(`   mp3 decoded length ${d.length} vs source ${ref} (${d.length - ref >= 0 ? '+' : ''}${d.length - ref} samples)`); }
  return r;
}
module.exports = { report, stats };
if (require.main === module) report(process.argv[2], process.argv[3]);
