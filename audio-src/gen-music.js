// "Orb Garden": original BGM loop for the Tower Wizard pastel remake.
// F major, 96 BPM, 4/4, 24 bars = exactly 60.0 s. Form A (music box) / B (chip flute) / A' (both + arps).
// Everything after the loop end (release + reverb + delay tails) is folded back onto the start, so the
// file is a true cycle: sample[N-1] flows into sample[0].
//   node gen-music.js            -> assets/resources/music/bgm_main.mp3 + preview/bgm_main_x2.mp3
'use strict';
const path = require('path');
const fs = require('fs');
const S = require('./synth');
const { SR, mtof, osc, adsr, OnePoleLP, Biquad } = S;

const BPM = 96, BEAT = 60 / BPM, BAR = 4 * BEAT, BARS = 24;
const LOOP = BARS * BAR;                       // 60 s
const N = Math.round(LOOP * SR), TAIL = Math.round(6 * SR);
const R = S.rng(20261025);
const hum = () => (R() - 0.5) * 0.008;         // +-4 ms of humanising

// ---------------------------------------------------------------- harmony (one chord per bar)
const CH = {
  F: { root: 53, pad: [65, 69, 72] }, Dm: { root: 50, pad: [62, 65, 69] }, Bb: { root: 46, pad: [62, 65, 70] },
  C: { root: 48, pad: [64, 67, 72] }, Am: { root: 45, pad: [64, 69, 72] }, Gm: { root: 43, pad: [62, 67, 70] },
  C7: { root: 48, pad: [64, 67, 70] },
};
const PROG = ['F', 'Dm', 'Bb', 'C', 'F', 'Am', 'Bb', 'C7',     // A
  'Bb', 'C', 'Am', 'Dm', 'Gm', 'C7', 'F', 'C',                  // B
  'F', 'Dm', 'Bb', 'C', 'Am', 'Dm', 'Gm', 'C7'];                // A'

// ---------------------------------------------------------------- melody: [beat, length, midi] per bar
const n = { C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81, Bb5: 82, C6: 84, D6: 86, E6: 88, F6: 89, G6: 91, A6: 93 };
const M = (s) => s.split(' ').map(t => { const [b, l, p] = t.split(':'); return [+b, +l, n[p]]; });
const MEL_A = [
  M('0:1:A5 1:1:C6 2:1:F6 3:.5:E6 3.5:.5:C6'), M('0:1.5:D6 1.5:.5:C6 2:1:A5 3:1:F5'),
  M('0:1:D6 1:1:F6 2:.5:D6 2.5:.5:C6 3:1:Bb5'), M('0:2:C6 2:1.5:G5'),
  M('0:1:A5 1:1:C6 2:1:F6 3:.5:G6 3.5:.5:A6'), M('0:1.5:E6 1.5:.5:C6 2:1:A5 3:1:C6'),
  M('0:.5:D6 .5:.5:C6 1:.5:Bb5 1.5:.5:A5 2:1:G5 3:1:Bb5'), M('0:1:G5 1:.5:A5 1.5:.5:Bb5 2:2:C6'),
];
const MEL_B = [
  M('0:2:D6 2:1:F6 3:1:D6'), M('0:2:E6 2:1:G6 3:1:E6'), M('0:1.5:C6 1.5:.5:E6 2:2:A6'), M('0:1.5:F6 1.5:.5:E6 2:2:D6'),
  M('0:1:Bb5 1:1:D6 2:1:G6 3:1:F6'), M('0:1:E6 1:1:D6 2:1:C6 3:1:Bb5'), M('0:1.5:A5 1.5:.5:C6 2:2:F6'), M('0:1:E6 1:1:D6 2:1:C6 3:1:G5'),
];
const MEL_A2 = [
  M('0:1:A5 1:1:C6 2:1:F6 3:1:A6'), M('0:.5:G6 .5:.5:F6 1:1:D6 2:1:A5 3:1:D6'),
  M('0:1.5:F6 1.5:.5:D6 2:1:Bb5 3:1:D6'), M('0:2:E6 2:2:C6'),
  M('0:1:C6 1:1:E6 2:1:A6 3:.5:G6 3.5:.5:E6'), M('0:1.5:F6 1.5:.5:E6 2:1:D6 3:1:A5'),
  M('0:1:Bb5 1:1:D6 2:1:G6 3:.5:F6 3.5:.5:D6'), M('0:1:E6 1:1:D6 2:1.5:C6'),
];

// ---------------------------------------------------------------- instruments (each adds into a track)
const tracks = {}; const track = k => tracks[k] || (tracks[k] = new Float32Array(N + TAIL));
function addNote(trk, t0, render, len) {
  const buf = track(trk), i0 = Math.max(0, Math.round(t0 * SR)), n = Math.min(Math.round(len * SR), buf.length - i0);
  for (let i = 0; i < n; i++) buf[i0 + i] += render(i / SR);
}
// music box / celesta: fundamental + octave + bright inharmonic "tine" partial
function musicBox(t0, dur, m, vel) {
  const f = mtof(m), len = Math.max(dur, 0) + 2.2;
  addNote('box', t0, t => {
    const a = Math.min(1, t / 0.003);
    return vel * a * (Math.sin(S.TAU * f * t) * Math.exp(-t / 1.1)
      + 0.28 * Math.sin(S.TAU * 2 * f * t) * Math.exp(-t / 0.35)
      + 0.10 * Math.sin(S.TAU * 5.4 * f * t) * Math.exp(-t / 0.07)
      + 0.04 * Math.sin(S.TAU * 3 * f * t + 1) * Math.exp(-t / 0.2));
  }, len);
}
// soft "chip flute": triangle + a little 50% pulse, lowpassed, delayed vibrato
function flute(t0, dur, m, vel) {
  const f = mtof(m), lp = new OnePoleLP(2600), lp2 = new OnePoleLP(3200), dt = f / SR; let ph = 0;
  addNote('flute', t0, t => {
    const vib = 1 + 0.010 * Math.sin(S.TAU * 5.2 * t) * Math.min(1, Math.max(0, (t - 0.18) / 0.25));
    ph += dt * vib;
    const x = osc.tri(ph) + 0.22 * osc.pulse(ph, dt, 0.5);
    return vel * adsr(t, dur * 0.92, 0.035, 0.12, 0.75, 0.14) * lp2.run(lp.run(x));
  }, dur + 0.2);
}
// warm pad: two detuned saws + triangle, double lowpass, slow swell
function pad(t0, dur, m, vel) {
  const f = mtof(m), dt = f / SR, lp = new Biquad('lp', 950, 0.6); let p1 = R(), p2 = R(), p3 = R();
  addNote('pad', t0, t => {
    p1 += dt * 1.004; p2 += dt * 0.996; p3 += dt;
    const x = 0.5 * osc.saw(p1, dt) + 0.5 * osc.saw(p2, dt) + 0.6 * osc.tri(p3);
    return vel * adsr(t, dur, 0.45, 0.4, 0.8, 0.9) * lp.run(x);
  }, dur + 0.95);
}
// round bass: triangle plus a 2nd harmonic so it survives phone speakers
function bass(t0, dur, m, vel) {
  const f = mtof(m), lp = new OnePoleLP(900);
  addNote('bass', t0, t => vel * adsr(t, dur, 0.008, 0.25, 0.65, 0.09) * lp.run(osc.tri(f * t) + 0.35 * Math.sin(S.TAU * 2 * f * t)), dur + 0.1);
}
// 25% pulse arpeggio blips
function arp(t0, m, vel) {
  const f = mtof(m), dt = f / SR, lp = new OnePoleLP(2200);
  addNote('arp', t0, t => vel * adsr(t, 0.07, 0.004, 0.08, 0.3, 0.12) * lp.run(osc.pulse(f * t, dt, 0.25)), 0.22);
}
// shaker: high-passed noise tick
function shaker(t0, vel) {
  const hp = new Biquad('hp', 6000, 0.7), lp = new OnePoleLP(11000);
  addNote('perc', t0, t => vel * Math.exp(-t / 0.018) * Math.min(1, t / 0.002) * lp.run(hp.run(R() * 2 - 1)), 0.12);
}
// soft felt kick
function kick(t0, vel) {
  addNote('perc', t0, t => { const f = 55 + 70 * Math.exp(-t / 0.03); return vel * Math.exp(-t / 0.12) * Math.sin(S.TAU * f * t); }, 0.4);
}
// rim "tok" on 2 and 4 in the busier sections
function tok(t0, vel) {
  const bp = new Biquad('bp', 1800, 4);
  addNote('perc', t0, t => vel * Math.exp(-t / 0.025) * (bp.run(R() * 2 - 1) * 1.5 + 0.4 * Math.sin(S.TAU * 820 * t)), 0.12);
}

// ---------------------------------------------------------------- arrangement
for (let bar = 0; bar < BARS; bar++) {
  const t = bar * BAR, ch = CH[PROG[bar]], sec = bar < 8 ? 'A' : bar < 16 ? 'B' : 'A2', bi = bar % 8;
  // pad: whole-bar chord (A section a touch softer)
  for (const m of ch.pad) pad(t + hum(), BAR - 0.05, m, sec === 'A' ? 0.10 : 0.12);
  // bass
  const r = ch.root, fifth = r + 7;
  if (sec === 'A' && bi < 4) { bass(t + hum(), BEAT * 2.6, r, 0.45); bass(t + 3 * BEAT + hum(), BEAT * 0.9, fifth, 0.32); }
  else {
    bass(t + hum(), BEAT * 1.4, r, 0.48); bass(t + 1.5 * BEAT + hum(), BEAT * 0.45, r + 12, 0.25);
    bass(t + 2 * BEAT + hum(), BEAT * 0.9, fifth, 0.38); bass(t + 3 * BEAT + hum(), BEAT * 0.6, bi % 2 ? r + 12 : r, 0.3);
  }
  // melody
  if (sec === 'A') for (const [b, l, m] of MEL_A[bi]) musicBox(t + b * BEAT + hum(), l * BEAT, m, 0.42 + (b === 0 ? 0.06 : 0));
  if (sec === 'B') {
    for (const [b, l, m] of MEL_B[bi]) flute(t + b * BEAT + hum(), l * BEAT, m - 12, 0.30);
    for (const b of [0, 2]) musicBox(t + b * BEAT + hum(), BEAT, ch.pad[(bar + b) % 3] + 24, 0.15);  // high sparkles
  }
  if (sec === 'A2') {
    for (const [b, l, m] of MEL_A2[bi]) { musicBox(t + b * BEAT + hum(), l * BEAT, m, 0.40); flute(t + b * BEAT + hum(), l * BEAT, m - 12, 0.11); }
  }
  // arpeggio eighths (B and A')
  if (sec !== 'A') {
    const tones = [ch.pad[0] + 12, ch.pad[1] + 12, ch.pad[2] + 12, ch.pad[1] + 12];
    for (let e = 0; e < 8; e++) arp(t + e * BEAT / 2 + hum(), tones[e % 4] + (e >= 4 && sec === 'A2' ? 0 : 0), (e % 2 ? 0.05 : 0.075) * (sec === 'B' ? 1 : 0.8));
  }
  // percussion: shaker from bar 5, kick + tok in B and A'
  if (bar >= 4) for (let e = 0; e < 8; e++) shaker(t + e * BEAT / 2 + hum(), (e % 2 ? 0.14 : 0.06) * (0.8 + 0.4 * R()));
  if (sec !== 'A') { kick(t, 0.35); kick(t + 2 * BEAT, 0.25); tok(t + BEAT + hum(), 0.06); tok(t + 3 * BEAT + hum(), 0.06); }
}

// ---------------------------------------------------------------- mix
const G = { box: 1.0, flute: 1.0, pad: 0.55, bass: 0.6, arp: 0.9, perc: 0.7 };
const SEND_REV = { box: 0.45, flute: 0.35, pad: 0.35, bass: 0.04, arp: 0.3, perc: 0.12 };
const SEND_DLY = { box: 0.22, flute: 0.18, arp: 0.1 };
const L = N + TAIL, dry = new Float32Array(L), revIn = new Float32Array(L), dlyIn = new Float32Array(L);
for (const k in tracks) {
  const tr = tracks[k];
  for (let i = 0; i < L; i++) { const v = tr[i] * G[k]; dry[i] += v; revIn[i] += v * (SEND_REV[k] || 0); dlyIn[i] += v * (SEND_DLY[k] || 0); }
}
const dly = S.delay(dlyIn, BEAT * 0.75, 0.32, 2800);
for (let i = 0; i < L; i++) revIn[i] += dly[i] * 0.5;
const wet = S.reverb(revIn, { room: 0.82, damp: 0.35 });
const mix = new Float32Array(L);
for (let i = 0; i < L; i++) mix[i] = dry[i] + dly[i] * 0.6 + wet[i] * 0.9;

let loop = S.wrapTail(mix, N);                 // fold every tail back onto the start: seamless cycle
const dc = S.removeDC(loop);
// gentle glue: soft knee saturation on the few loudest peaks, then normalize
const pre = S.peak(loop);
for (let i = 0; i < N; i++) { const x = loop[i] / pre * 1.15; loop[i] = Math.tanh(x) ; }
let out = S.decimate2(loop, true);             // 22.05 kHz, cyclic filter keeps the seam
S.normalize(out, -0.8);

// ---------------------------------------------------------------- write + verify
const root = path.join(__dirname, '..');
const wav = path.join(__dirname, 'build', 'bgm_main.wav');
const mp3 = path.join(root, 'assets', 'resources', 'music', 'bgm_main.mp3');
fs.mkdirSync(path.dirname(mp3), { recursive: true });
S.writeWav(wav, out, S.OUT_SR);
const KBPS = +(process.env.KBPS || 40);
const size = S.encodeMp3(wav, mp3, KBPS);
// preview: the loop twice in a row (to listen for the seam), at full quality
const twice = new Float32Array(out.length * 2); twice.set(out); twice.set(out, out.length);
const pw = path.join(__dirname, 'build', 'bgm_main_x2.wav'); S.writeWav(pw, twice, S.OUT_SR);
S.encodeMp3(pw, path.join(__dirname, 'preview', 'bgm_main_x2.mp3'), 96);
console.log(`bgm_main: ${LOOP.toFixed(2)} s, ${out.length} samples @ ${S.OUT_SR} Hz, removed DC ${dc.toExponential(2)}, mp3 ${KBPS} kbps = ${(size / 1024).toFixed(1)} KB`);
require('./analyze').report(mp3, wav);
