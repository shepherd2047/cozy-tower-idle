// Original sound effects, tuned to the BGM (F major / F-major pentatonic F G A C D).
//   node gen-sfx.js   -> assets/resources/sfx/*.mp3 (existing names keep their .meta / uuid) + preview/sfx_reel.mp3
'use strict';
const path = require('path');
const fs = require('fs');
const S = require('./synth');
const { SR, TAU, mtof, osc, Biquad, OnePoleLP } = S;
const R = S.rng(777);
const noise = () => R() * 2 - 1;

const OUT = path.join(__dirname, '..', 'assets', 'resources', 'sfx');
const TMP = path.join(__dirname, 'build', 'sfx');
const reel = [];

function render(len, fn) { const b = new Float32Array(Math.round(len * SR)); for (let i = 0; i < b.length; i++) b[i] = fn(i / SR, i); return b; }
function mixInto(dst, src, at = 0, g = 1) { const o = Math.round(at * SR); for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * g; return dst; }
// small bright room for the one-shots
function space(buf, amt = 0.18, extra = 0.4) {
  const padded = new Float32Array(buf.length + Math.round(extra * SR)); padded.set(buf);
  const wet = S.reverb(padded, { room: 0.7, damp: 0.4, scale: 0.6 });
  for (let i = 0; i < padded.length; i++) padded[i] += wet[i] * amt;
  return padded;
}
function trimTail(buf, thrDb = -60) { // drop trailing near-silence, then a 5 ms fade
  const thr = S.dbToGain(thrDb) * S.peak(buf); let e = buf.length - 1;
  while (e > 0 && Math.abs(buf[e]) < thr) e--;
  const out = buf.slice(0, Math.min(buf.length, e + Math.round(0.01 * SR))), f = Math.round(0.005 * SR);
  for (let i = 0; i < f && i < out.length; i++) out[out.length - 1 - i] *= i / f;
  return out;
}
function save(name, buf, { db = -3, loop = false, kbps = 48 } = {}) {
  let b = loop ? buf : trimTail(buf);
  S.removeDC(b);
  let d = S.decimate2(b, loop);
  S.normalize(d, db);
  const wav = path.join(TMP, name + '.wav'), mp3 = path.join(OUT, name + '.mp3');
  S.writeWav(wav, d, S.OUT_SR);
  const size = S.encodeMp3(wav, mp3, kbps);
  const dec = S.decode(mp3); let pk = 0; for (const v of dec) pk = Math.max(pk, Math.abs(v));
  let seam = '';
  if (loop) { const st = require('./analyze').stats(dec, S.OUT_SR, name + ' (loop)'); seam = st.seam <= st.p99 ? ' seam OK' : ' seam CHECK'; }
  console.log(`${name.padEnd(16)} ${(d.length / S.OUT_SR).toFixed(2)} s  ${(size / 1024).toFixed(1).padStart(5)} KB  peak ${(20 * Math.log10(pk)).toFixed(1)} dBFS${seam}`);
  reel.push({ name, d, loop });
}

// ---------------------------------------------------------------- voices
// bell / music-box ping (same timbre as the BGM's music box, shorter)
function bell(m, len = 0.6, decay = 0.35, bright = 1) {
  const f = mtof(m);
  return render(len, t => Math.min(1, t / 0.002) * (Math.sin(TAU * f * t) * Math.exp(-t / decay)
    + 0.3 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / (decay * 0.35))
    + 0.09 * bright * Math.sin(TAU * 5.4 * f * t) * Math.exp(-t / 0.05)));
}
// soft "bloop": sine with a quick downward pitch settle
function bloop(m, len = 0.16, from = 7) {
  const f = mtof(m); let ph = 0;
  return render(len, t => { const fr = f * Math.pow(2, from * Math.exp(-t / 0.018) / 12); ph += fr / SR;
    return Math.min(1, t / 0.002) * Math.exp(-t / 0.05) * (Math.sin(TAU * ph) + 0.15 * Math.sin(TAU * 2 * ph)); });
}
function marimba(m, len = 0.25, decay = 0.07) {
  const f = mtof(m);
  return render(len, t => Math.min(1, t / 0.001) * (Math.sin(TAU * f * t) * Math.exp(-t / decay) + 0.25 * Math.sin(TAU * 4 * f * t) * Math.exp(-t / (decay * 0.25))));
}
function noiseBurst(len, fc, q, decay, attack = 0.002) {
  const bp = new Biquad('bp', fc, q);
  return render(len, t => Math.min(1, t / attack) * Math.exp(-t / decay) * bp.run(noise()));
}
const P = [65, 67, 69, 72, 74, 77, 79, 81, 84, 86, 89, 91, 93]; // F-major pentatonic F4..A6

// ---------------------------------------------------------------- orb / area clicks (3 pentatonic variants, picked at random in code)
[[84, ''], [86, '_1'], [81, '_2']].forEach(([m, suf]) => {
  const b = bloop(m, 0.2, 5); mixInto(b, bell(m + 12, 0.2, 0.06, 0.5), 0, 0.25);
  save('area_click' + suf, space(b, 0.12, 0.2), { db: -4 });
});

// ---------------------------------------------------------------- swipe-cast melody: 8 rising pentatonic chimes F5..A6
['cast_n0', 'cast_n1', 'cast_n2', 'cast_n3', 'cast_n4', 'cast_n5', 'cast_n6', 'cast_n7'].forEach((nm, i) => {
  const m = [77, 79, 81, 84, 86, 89, 91, 93][i];
  const b = bell(m, 0.7, 0.28, 0.8); mixInto(b, bell(m + 12, 0.3, 0.05, 0), 0, 0.12);
  save(nm, space(b, 0.22, 0.35), { db: -4 });
});
// direction-change sparkle tick: two tiny high pings
{ const b = new Float32Array(Math.round(0.16 * SR)); mixInto(b, bell(96, 0.12, 0.03, 0.4), 0, 0.8); mixInto(b, bell(101, 0.12, 0.025, 0.4), 0.035, 0.6);
  save('cast_tick', space(b, 0.2, 0.15), { db: -6 }); }
// mote lands in the orb: soft plink with a tiny upward glide
{ const f = mtof(96); let ph = 0;
  const b = render(0.25, t => { ph += f * (1 + 0.06 * (1 - Math.exp(-t / 0.02))) / SR; return Math.min(1, t / 0.002) * Math.exp(-t / 0.06) * Math.sin(TAU * ph); });
  save('mote_arrive', space(b, 0.25, 0.25), { db: -6 }); }
// fervor maxed: pentatonic glissando up two octaves + sparkle dust + a held F major bell chord
{ const b = new Float32Array(Math.round(1.6 * SR));
  [77, 79, 81, 84, 86, 89, 91, 93, 96, 98, 101].forEach((m, i) => mixInto(b, bell(m, 0.6, 0.18, 1), i * 0.03, 0.5 + 0.03 * i));
  for (const m of [89, 93, 96]) mixInto(b, bell(m, 1.3, 0.6, 0.6), 0.33, 0.35);
  const hp = new Biquad('hp', 5000, 0.7); mixInto(b, render(0.9, t => Math.sin(Math.PI * Math.min(1, t / 0.9)) * 0.15 * hp.run(noise())), 0.05);
  save('fervor_max', space(b, 0.3, 0.6), { db: -3 }); }

// ---------------------------------------------------------------- swipe loops (2.0 s, seamless): airy swish (dark) + shimmer (bright)
{ const L = Math.round(2.0 * SR), XF = Math.round(0.25 * SR);
  const bp = new Biquad('bp', 1100, 0.9), lp = new OnePoleLP(3000);
  const raw = render((L + XF) / SR, t => { bp.set(900 + 350 * Math.sin(TAU * 1.5 * t) + 150 * Math.sin(TAU * 3.5 * t)); return lp.run(bp.run(noise())) * (0.8 + 0.2 * Math.sin(TAU * 2.5 * t)); });
  save('cast_swish', S.crossfadeLoop(raw, L, XF), { loop: true, db: -4, kbps: 40 }); }
{ const L = Math.round(2.0 * SR), XF = Math.round(0.25 * SR), Lx = L + XF;
  const hp = new Biquad('hp', 4500, 0.7);
  const raw = render(Lx / SR, () => hp.run(noise()) * 0.35);
  // sparkle dust: little high pentatonic pings scattered through the loop
  for (let k = 0; k < 26; k++) mixInto(raw, bell(P[8 + Math.floor(R() * 5)] + 12, 0.25, 0.04 + 0.04 * R(), 0.6), R() * (Lx / SR - 0.25), 0.25 + 0.25 * R());
  save('cast_shimmer', S.crossfadeLoop(raw, L, XF), { loop: true, db: -4, kbps: 40 }); }

// ---------------------------------------------------------------- world sounds
// cloudling ball absorbed by the orb (fires often): tiny soft blip on C7
save('spirit_ball', bloop(96, 0.08, 3), { db: -8 });
// log enters the portal: hollow wooden marimba "tok" (C5)
{ const b = marimba(72, 0.2, 0.06); mixInto(b, noiseBurst(0.03, 1500, 2, 0.006), 0, 0.3); save('wood', b, { db: -5 }); }
// tower block lands: low soft "tuk" on F4 with a dusty tick (fires up to ~20/s while building)
{ const b = marimba(65, 0.15, 0.045); mixInto(b, noiseBurst(0.04, 900, 1.2, 0.008), 0, 0.4); save('magic_material', b, { db: -6 }); }
// sparkles running up the new tower
{ const b = new Float32Array(Math.round(0.4 * SR)); mixInto(b, bell(96, 0.3, 0.08, 1), 0, 0.7); mixInto(b, bell(100, 0.3, 0.07, 1), 0.05, 0.5);
  save('tower_particles', space(b, 0.3, 0.3), { db: -5 }); }
// buy: cute two-note coin pop C6 -> F6 (soft square)
{ const b = new Float32Array(Math.round(0.25 * SR));
  for (const [m, at] of [[84, 0], [89, 0.06]]) { const f = mtof(m), lp = new OnePoleLP(3500);
    mixInto(b, render(0.16, t => Math.min(1, t / 0.002) * Math.exp(-t / 0.05) * lp.run(osc.pulse(f * t, f / SR, 0.5))), at, 0.6); }
  save('button_click', space(b, 0.12, 0.15), { db: -5 }); }
// UI tap / tutorial pop: quick bubble pop
{ let ph = 0; const b = render(0.09, t => { ph += (500 + 500 * (1 - Math.exp(-t / 0.012))) / SR; return Math.min(1, t / 0.002) * Math.exp(-t / 0.025) * Math.sin(TAU * ph); });
  save('tooltip_hover', b, { db: -5 }); }
// wizard teleports between areas: "bwoop" down + sparkle up
{ let ph = 0; const b = render(0.4, t => { ph += (1100 * Math.exp(-t / 0.09) + 300) / SR; return Math.min(1, t / 0.003) * Math.exp(-t / 0.1) * Math.sin(TAU * ph); });
  mixInto(b, bell(93, 0.3, 0.06, 1), 0.09, 0.35); mixInto(b, bell(98, 0.3, 0.05, 1), 0.13, 0.25);
  save('wizard_teleport', space(b, 0.25, 0.3), { db: -5 }); }
// tower build starts: rising filtered-noise whoosh with a swelling F chord underneath
{ const len = 1.7, bp = new Biquad('bp', 300, 1.2);
  const b = render(len, t => { const k = t / len; bp.set(250 + 3200 * k * k); return Math.sin(Math.PI * Math.min(1, k * 1.15)) * bp.run(noise()); });
  for (const m of [65, 69, 72]) { const f = mtof(m); mixInto(b, render(len, t => 0.08 * Math.pow(t / len, 1.5) * Math.sin(Math.PI * Math.min(1, t / len * 1.1)) * osc.tri(f * t)), 0); }
  save('build_whoosh', space(b, 0.25, 0.4), { db: -5 }); }
// tower finished: arpeggio F A C F A + soft chord bloom
{ const b = new Float32Array(Math.round(2.0 * SR));
  [77, 81, 84, 89, 93].forEach((m, i) => mixInto(b, bell(m, 1.2, 0.5, 0.8), i * 0.09, 0.45));
  for (const m of [65, 69, 72, 77]) { const f = mtof(m), lp = new OnePoleLP(1400); mixInto(b, render(1.6, t => 0.12 * Math.min(1, t / 0.3) * Math.exp(-Math.max(0, t - 0.3) / 0.45) * lp.run(osc.saw(f * t * 1.003, f / SR) + osc.saw(f * t * 0.997, f / SR))), 0.1); }
  save('tower_done', space(b, 0.3, 0.6), { db: -3 }); }
// spirit / cloudling / druid summoned: quick upward pentatonic swirl
{ const b = new Float32Array(Math.round(0.6 * SR));
  [84, 86, 89, 93].forEach((m, i) => mixInto(b, bell(m, 0.4, 0.12, 1), i * 0.035, 0.45));
  const hp = new Biquad('hp', 5000, 0.7); mixInto(b, render(0.3, t => Math.sin(Math.PI * t / 0.3) * 0.12 * hp.run(noise())), 0);
  save('summon', space(b, 0.3, 0.35), { db: -5 }); }
// spirit tome finishes a book: paper "fwip"
{ const b = new Float32Array(Math.round(0.16 * SR));
  mixInto(b, noiseBurst(0.07, 2500, 1.5, 0.018, 0.006), 0, 1); mixInto(b, noiseBurst(0.08, 3500, 1.5, 0.02, 0.008), 0.05, 0.7);
  save('book', b, { db: -7 }); }

// ---------------------------------------------------------------- listening reel
{ const gap = Math.round(0.35 * S.OUT_SR); let len = 0;
  const items = reel.map(r => r.loop ? (() => { const x = new Float32Array(r.d.length * 2); x.set(r.d); x.set(r.d, r.d.length); return x; })() : r.d);
  for (const x of items) len += x.length + gap;
  const all = new Float32Array(len); let o = 0;
  for (const x of items) { all.set(x, o); o += x.length + gap; }
  // a 4/s swipe-melody demo at the end, as the game plays it
  const demo = new Float32Array(Math.round(4 * S.OUT_SR)), notes = reel.filter(r => r.name.startsWith('cast_n'));
  const seq = [0, 1, 2, 3, 4, 5, 6, 7, 5, 7, 6, 7, 5, 6, 4, 7];
  seq.forEach((k, i) => { const d = notes[k].d, at = Math.round(i * 0.25 * S.OUT_SR); for (let j = 0; j < d.length && at + j < demo.length; j++) demo[at + j] += d[j] * 0.5; });
  const out = new Float32Array(all.length + demo.length); out.set(all); out.set(demo, all.length);
  S.normalize(out, -1);
  const w = path.join(__dirname, 'build', 'sfx_reel.wav'); S.writeWav(w, out, S.OUT_SR);
  S.encodeMp3(w, path.join(__dirname, 'preview', 'sfx_reel.mp3'), 96);
  console.log('reel order: ' + reel.map(r => r.name).join(', ') + ', swipe-melody demo');
}
