// Layered background with a day/night cycle and a boss-fight sky (art v2.4).
// Owns everything behind the world: sky gradient, stars, sun / moon, drifting clouds, two hill layers, the ground
// strip and the boss vortex. Phases share shapes and differ only in colour, so a crossfade is "draw A, then B on top
// with alpha k" (and the boss set on top of that with its own alpha).
//
// Usage from the game (camera: { x, y, zoom }, world transform = zoom, W/2 - x*zoom, H/2 - y*zoom):
//   sky.update(dt)                       every frame
//   sky.drawBack(D, cam)                 first thing in drawWorld (leaves D in screen space / untinted)
//   D.setTint(sky.tint())                for world sprites; D.setTint(null) afterwards
//   sky.drawGround(D, cam, GROUND)       instead of the old ground strip (ignores the tint)
//   sky.textColor()                      for text drawn straight on the sky
//   sky.setBossMode(true / false)        Siege: boss fight starts / ends
//   sky.setVortex(wx, wy) / setVortex(null)   world position of the galaxy swirl behind the Warden
import { PixelDraw } from './PixelDraw';

export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night' | 'boss';
export interface SkyCam { x: number; y: number; zoom: number; }

type RGB = [number, number, number];
const hex = (h: string): RGB => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const toHex = (c: RGB) => '#' + c.map(v => ('0' + Math.round(v).toString(16)).slice(-2)).join('');
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const clamp01 = (k: number) => Math.min(Math.max(k, 0), 1);
const smooth = (k: number) => k * k * (3 - 2 * k);

// Cycle: day -> dusk -> night -> dawn -> day. hold = seconds fully in the phase, then FADE seconds into the next.
// 150 + 35 + 50 + 30 holds + 4 x 15 fades = 325 s (5:25). Day is the longest so the demo opens bright.
const FADE = 15;
const CYCLE: { p: SkyPhase, hold: number }[] = [{ p: 'day', hold: 150 }, { p: 'dusk', hold: 35 }, { p: 'night', hold: 50 }, { p: 'dawn', hold: 30 }];
const BOSS_FADE = 3;            // seconds to crossfade into / out of the boss sky
const AFTER_BOSS_DAWN = 8;      // after the boss: this many seconds of dawn left, then the usual 15 s fade to day

const TINT: Record<SkyPhase, RGB> = { day: hex('#ffffff'), dawn: hex('#fff0f0'), dusk: hex('#f4dcec'), night: hex('#b8c0e8'), boss: hex('#d8c8f0') };
const FLAT: Record<SkyPhase, string> = { dawn: '#ffe4c8', day: '#e4f4fc', dusk: '#ffb59e', night: '#3f4a80', boss: '#a24b9a' };
const STARS: Record<SkyPhase, number> = { day: 0, dawn: 0, dusk: 0.2, night: 1, boss: 1 };
const DARK: Record<SkyPhase, number> = { day: 0, dawn: 0, dusk: 1, night: 1, boss: 1 };   // 1 = sky text must be light
const INK = '#2a1f3d', CREAM = '#fff1d6';

// parallax: a layer's origin moves with the camera by factor f (1 = fixed on screen, 0 = fixed in the world).
// hills keep their original placement (centre y 247 / 248, x origin cam.x * f - 540).
const HILLS: [string, number, number][] = [['hills_0', 247, 0.98], ['hills_1', 248, 0.96]];
const CLOUDS = { y: -110, fx: 0.99, fy: 0.5, drift: 2.5 };   // top y (world) at cam.y 0; drift in world px/s
const STAR_F = 0.97;

export class Sky {
  private ct = 0;               // cycle clock, seconds in [0, length)
  private speed = 1;
  private bossK = 0;            // 0..1 boss crossfade
  private boss = false;
  private devBoss = false;     // setPhase('boss'): stays on until another setPhase, whatever Siege says each frame
  private clock = 0;            // free-running time for drift / rotation
  private vortex: [number, number] | null = null;
  private stack: [SkyPhase, number][] = [];   // layers to draw bottom -> top with their alpha (rebuilt in update)
  private tintHex = '#ffffff';
  readonly length = CYCLE.reduce((s, c) => s + c.hold + FADE, 0);

  constructor() { this.rebuild(); }

  // ---------------------------------------------------------------- state
  get t() { return this.ct; }
  /** the dominant phase right now (boss while the boss sky is more than half faded in) */
  get phase(): SkyPhase {
    if (this.bossK > 0.5) return 'boss';
    const [a, b, k] = this.cyclePair();
    return k > 0.5 ? b : a;
  }
  get bossMode() { return this.boss; }
  /** 0..1, how far the boss sky has faded in */
  get bossBlend() { return this.bossK; }

  update(dt: number) {
    this.clock += dt;
    if (!this.boss || this.bossK < 1) this.ct = (this.ct + dt * this.speed) % this.length;   // frozen under the boss sky
    const target = this.boss ? 1 : 0;
    if (this.bossK !== target) this.bossK = target > this.bossK ? Math.min(1, this.bossK + dt / BOSS_FADE) : Math.max(0, this.bossK - dt / BOSS_FADE);
    this.rebuild();
  }

  /** Siege: true when the Warden fight starts, false when it ends (the sky then fades to dawn and on to day) */
  setBossMode(on: boolean) {
    if (this.devBoss) on = true;
    if (on === this.boss) return;
    this.boss = on;
    if (!on) this.ct = this.phaseStart('dawn') + CYCLE.find(c => c.p === 'dawn')!.hold - AFTER_BOSS_DAWN;
  }
  /** world position of the boss vortex (centre), or null to hide it; it is drawn by drawBack, faded with the boss sky */
  setVortex(wx: number | null, wy = 0) { this.vortex = wx === null ? null : [wx, wy]; }
  /** dev panel: cycle speed multiplier (0 freezes) */
  setSpeed(mult: number) { this.speed = Math.max(0, mult); }
  getSpeed() { return this.speed; }
  /** dev panel: jump to a phase. 'boss' forces the boss sky on (ignoring setBossMode(false)) until another phase is set */
  setPhase(name: SkyPhase) {
    this.devBoss = name === 'boss';
    if (name === 'boss') { this.boss = true; this.bossK = 1; }
    else { this.boss = false; this.bossK = 0; this.ct = this.phaseStart(name) + 0.01; }
    this.rebuild();
  }
  /** dev / tests: set the cycle clock directly (seconds, wraps) */
  setTime(t: number) { this.ct = ((t % this.length) + this.length) % this.length; this.rebuild(); }

  /** multiply colour for the tower, characters, trees and blocks */
  tint() { return this.tintHex; }
  /** colour for text drawn directly on the sky: ink in dawn / day, cream in dusk / night / boss */
  textColor() { return this.darkness() > 0.5 ? CREAM : INK; }
  /** 0 = bright sky, 1 = dark sky (blended), for callers that want their own light / dark choice */
  darkness() { return this.weigh(DARK); }

  // ---------------------------------------------------------------- drawing
  /** sky, stars, sun / moon, clouds, boss vortex and hills. Ends untinted in screen space (resetTransform). */
  drawBack(D: PixelDraw, cam: SkyCam) {
    const W = D.W, H = D.H, z = cam.zoom;
    D.setTint(null);
    D.resetTransform();
    // sky gradient strips, stretched over the screen
    for (const [p, a] of this.stack) {
      const n = 'sky_' + p;
      if (D.has(n)) { const [sw, sh] = D.size(n); D.part(n, 0, 0, sw, sh, 0, 0, W, H, { alpha: a }); }
      else D.rect(FLAT[p], 0, 0, W, H, a);
    }
    // sun and moon on screen-space arcs (drawn in world pixel size at the base zoom)
    this.drawBodies(D, W, H);
    D.setTransform(z, W / 2 - cam.x * z, H / 2 - cam.y * z);
    const left = cam.x - W / 2 / z, right = cam.x + W / 2 / z, top = cam.y - H / 2 / z, bottom = cam.y + H / 2 / z;
    // stars: 2D tiled, nearly fixed to the screen
    const sa = this.weigh(STARS);
    if (sa > 0.01 && D.has('stars')) {
      const [iw, ih] = D.size('stars'), ox = Math.round(cam.x * STAR_F), oy = Math.round(cam.y * STAR_F);
      for (let ty = Math.floor((top - oy) / ih); oy + ty * ih < bottom; ty++)
        for (let tx = Math.floor((left - ox) / iw); ox + tx * iw < right; tx++) D.img('stars', ox + tx * iw, oy + ty * ih, { alpha: sa });
    }
    // clouds: far parallax plus a slow drift
    const cy = Math.round(CLOUDS.y + cam.y * CLOUDS.fy), cox = cam.x * CLOUDS.fx - 540 + (this.clock * CLOUDS.drift) % 1080;
    for (const [p, a] of this.stack) this.rowTiles(D, D.has('clouds_' + p) ? 'clouds_' + p : 'clouds', cox, cy, left, right, a);
    if (this.vortex && this.bossK > 0.01) this.drawVortex(D, cam, this.vortex[0], this.vortex[1], this.bossK);
    // hills (same placement as the original drawWorld)
    for (const [img, y, f] of HILLS) {
      const [, ih] = D.size(img), hy = Math.round(y - ih / 2);
      for (const [p, a] of this.stack) this.rowTiles(D, D.has(img + '_' + p) ? img + '_' + p : img, cam.x * f - 540, hy, left, right, a);
    }
    D.resetTransform();
  }

  /** the ground strip at world y = ground (expects the world transform to be set; not tinted) */
  drawGround(D: PixelDraw, cam: SkyCam, ground: number) {
    const W = D.W, gx = Math.floor(cam.x - W / cam.zoom), gw = Math.ceil(2 * W / cam.zoom) + 2;
    for (const [p, a] of this.stack) {
      const n = D.has('ground_' + p) ? 'ground_' + p : 'ground';
      D.part(n, 0, 0, 1, 8, gx, ground, gw, 8, { alpha: a, tint: '#ffffff' });
    }
  }

  /** the galaxy swirl centred on world (wx, wy): slow rotation and bob. Callable directly if Siege wants it elsewhere
   *  in its draw order (expects the world transform to be set). */
  drawVortex(D: PixelDraw, cam: SkyCam, wx: number, wy: number, alpha = 1) {
    if (!D.has('boss_vortex')) return;
    const [iw, ih] = D.size('boss_vortex'), z = cam.zoom;
    const y = wy + 3 * Math.sin(this.clock * 1.1);
    const sx = (wx - cam.x) * z + D.W / 2, sy = (y - cam.y) * z + D.H / 2;
    const a = alpha * (0.9 + 0.1 * Math.sin(this.clock * 2.3));
    D.img('boss_vortex', Math.round(wx - iw / 2), Math.round(y - ih / 2), { alpha: a, rot: -this.clock * 0.35, pivot: [sx, sy], tint: '#ffffff' });
  }

  // ---------------------------------------------------------------- internals
  private rowTiles(D: PixelDraw, name: string, ox: number, y: number, left: number, right: number, alpha: number) {
    if (!D.has(name)) return;
    const iw = D.size(name)[0], o = Math.round(ox);
    for (let x = o + Math.floor((left - o) / iw) * iw; x < right; x += iw) D.img(name, x, y, { alpha });
  }

  private drawBodies(D: PixelDraw, W: number, H: number) {
    const fade = 1 - this.bossK; if (fade <= 0.01) return;
    const s = 2 * Math.min(W, H) / 360;            // = the game's base zoom, so sun pixels match world pixels
    const L = this.length, dawn = this.phaseStart('dawn') - FADE, dusk = this.phaseStart('night'), night = this.phaseStart('night') - FADE;
    // sun: rises at the start of the night->dawn fade, sets at the end of the dusk->night fade
    const sunLen = (dusk - dawn + L) % L, sunP = ((this.ct - dawn + L) % L) / sunLen;
    const moonLen = (this.phaseStart('dawn') - night + L) % L, moonP = ((this.ct - night + L) % L) / moonLen;
    const arc = (name: string, p: number, size: number) => {
      if (p < 0 || p >= 1 || !D.has(name)) return;
      const a = fade * smooth(clamp01(p / 0.08)) * smooth(clamp01((1 - p) / 0.08));
      if (a <= 0.01) return;
      const x = W * (0.1 + 0.8 * p), y = H * 0.14 + H * 0.18 * (1 - Math.sin(Math.PI * p));
      const d = Math.round(size * s);
      D.part(name, 0, 0, size, size, Math.round(x - d / 2), Math.round(y - d / 2), d, d, { alpha: a });
    };
    arc('sun', sunP, 22);
    arc('moon', moonP, 18);
  }

  private phaseStart(p: SkyPhase) {
    let t = 0;
    for (const c of CYCLE) { if (c.p === p) return t; t += c.hold + FADE; }
    return 0;
  }
  /** [current, next, crossfade 0..1] from the cycle clock */
  private cyclePair(): [SkyPhase, SkyPhase, number] {
    let t = this.ct;
    for (let i = 0; i < CYCLE.length; i++) {
      const c = CYCLE[i], next = CYCLE[(i + 1) % CYCLE.length].p;
      if (t < c.hold) return [c.p, next, 0];
      if (t < c.hold + FADE) return [c.p, next, smooth((t - c.hold) / FADE)];
      t -= c.hold + FADE;
    }
    return ['day', 'dusk', 0];
  }
  private weigh(table: Record<SkyPhase, number>) {
    const [a, b, k] = this.cyclePair();
    const base = table[a] + (table[b] - table[a]) * k;
    return base + (table.boss - base) * smooth(this.bossK);
  }
  private rebuild() {
    const [a, b, k] = this.cyclePair(), bk = smooth(this.bossK);
    const st: [SkyPhase, number][] = [[a, 1]];
    if (k > 0.002) st.push([b, k]);
    if (bk > 0.002) st.push(['boss', bk]);
    // anything under a fully opaque layer is invisible: skip it
    let from = 0; for (let i = st.length - 1; i > 0; i--) if (st[i][1] >= 0.998) { from = i; break; }
    this.stack = st.slice(from);
    if (this.stack[0][1] < 1) this.stack[0][1] = 1;
    this.tintHex = toHex(mix(mix(TINT[a], TINT[b], k), TINT.boss, bk));
  }
}
