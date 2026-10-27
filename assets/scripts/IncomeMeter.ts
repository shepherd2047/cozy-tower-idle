// Live "income per second" readout for the HUD Resources panel.
//
// Rate shown = passive income (computed analytically from what the game is actually running: cloudlings,
// spirit tomes, druids, at the current speed multipliers) + active income (resources the player earns
// directly by clicking/swiping, measured by wrapping addResource while updateClickables runs).
// Only gains are counted, so spending never makes it negative. Discrete passive sources (a book every
// 10 s, a log every 4 s) therefore never make the number flicker: the idle baseline is exact and steady.
// Orb/study/forest clicks raise the speed multipliers immediately, so the number jumps on the first click,
// and the measured click gains (triangular 1.5 s window) fade out ~1.5 s after the finger stops.
import { PixelDraw } from './PixelDraw';

const WINDOW = 1.5;          // s, active-gain window (triangular kernel, no ripple at the click cadence)
const UP_TAU = 0.05;         // s, display smoothing when the rate rises (snappy)
const DOWN_TAU = 0.3;        // s, display smoothing when it falls (eases back to passive)
const BOOST = 1.12;          // live rate above passive * this reads as "boosted"
const C_IDLE = '#c9c3dc', C_BOOST = '#ffd36e', C_FLASH = '#ffffff', C_TRI = '#ff8fb1';

const MOD_TAU = 8;           // s, EMA for module/siege income (unknown cadence, so slow and steady)
type Ev = { t: number; v: number };
type Ctx = '' | 'click' | 'buy' | 'core' | 'mod';
type Fmt = (n: number, round?: boolean) => string;

const M = {
  g: null as any, fmt: null as Fmt | null,
  ctx: '' as Ctx,
  modAcc: {} as Record<string, number>, modT: {} as Record<string, number>,
  clicks: {} as Record<string, Ev[]>,
  shown: {} as Record<string, number>,      // smoothed displayed rate
  boosted: {} as Record<string, boolean>,
  pop: {} as Record<string, number>,        // seconds left of the jump "hop"
  lastT: {} as Record<string, number>,
  gained: { click: {}, buy: {}, core: {}, mod: {}, other: {} } as Record<string, Record<string, number>>, // lifetime stats (debug/tests)
  colW: 0, colWT: 0,
};

function modAccAt(id: string, t: number) { const a = M.modAcc[id] || 0; return a ? a * Math.exp(-(t - (M.modT[id] || t)) / MOD_TAU) : 0; }
function now() { const S = M.g && M.g.S; return S && typeof S.time === 'number' ? S.time : performance.now() / 1000; }

function wrap(g: any, name: string, ctx: Ctx) {
  const orig = g[name]; if (typeof orig !== 'function') return;
  g[name] = function (...a: any[]) {
    const prev = M.ctx; M.ctx = ctx;
    try { return orig.apply(this, a); } finally { M.ctx = prev; }
  };
}

export const IncomeMeter = {
  /** idempotent; called lazily from draw() */
  install(g: any, fmt?: Fmt) {
    if (fmt) M.fmt = fmt;
    if (M.g === g) return;
    M.g = g;
    const add = g.addResource;
    g.addResource = function (id: string, v: number) {
      const r = add.call(this, id, v);
      if (r > 0) {
        const k = M.ctx || 'other'; M.gained[k][id] = (M.gained[k][id] || 0) + r;
        if (M.ctx === 'click') (M.clicks[id] || (M.clicks[id] = [])).push({ t: now(), v: r });
        else if (M.ctx === 'mod') { const t = now(); M.modAcc[id] = modAccAt(id, t) + r; M.modT[id] = t; }
      }
      return r;
    };
    wrap(g, 'updateClickables', 'click');
    wrap(g, 'buySkill', 'buy');
    // cloudlings / tomes / druids are computed analytically (passive()), so their gains are not measured again
    wrap(g, 'updateOrbitals', 'core'); wrap(g, 'updateStudy', 'core'); wrap(g, 'updateForest', 'core');
    // module / siege / sky ticks: unknown producers, measured with a slow EMA and added to the passive baseline
    wrap(g, 'updateModules', 'mod');
    for (const k of ['siege', 'sky']) if (g[k] && typeof g[k].update === 'function') wrap(g[k], 'update', 'mod');
    (globalThis as any).__income = IncomeMeter;   // test/debug handle
  },

  /** passive income per second; live = at the current click speed boosts, else the idle baseline */
  passive(id: string, live = false): number {
    return this.corePassive(id, live) + modAccAt(id, now()) / MOD_TAU;
  },
  /** cloudlings (N balls / 4 s), spirit tomes (1 book / 10 s each), druids (N logs / 4 s), each valued by the
   *  game's own reward function (cloudlingMagic / knowledgeReward / woodPerLog, which include module multipliers) */
  corePassive(id: string, live = false): number {
    const g = M.g; if (!g || !g.S) return 0;
    const S = g.S, sk = S.skills || {};
    const tot = (k: string) => (typeof g.totemCount === 'function' ? g.totemCount(k) : 0);
    const gm = (k: string) => (typeof g.mult === 'function' ? g.mult(k) : 1);
    const fn = (k: string, fb: () => number) => (typeof g[k] === 'function' ? g[k]() : fb());
    try {
      if (id === 'magic') {
        const n = g.cloudlings ? g.cloudlings.length : sk.summon_cloudling || 0; if (!n) return 0;
        return n / 4 * fn('cloudlingMagic', () => 20 * (1 + (sk.cloudling_potency || 0) * 0.7) * (1 + tot('magic_totem')) * gm('magic') * gm('cloudling_magic') * gm('summon_cloudling')) * (live ? S.speedMult || 1 : 1);
      }
      if (id === 'knowledge') {
        if (S.level <= 1 || S.building) return 0;
        const n = g.books ? g.books.length : sk.summon_spirit_tome || 0; if (!n) return 0;
        return n / 10 * fn('knowledgeReward', () => 5 * (1 + (sk.text_enchantment || 0) * 0.5) * (1 + tot('knowledge_totem')) * gm('knowledge') * gm('tome_knowledge') * gm('summon_spirit_tome')) * (live ? S.studySpeedMult || 1 : 1);
      }
      if (id === 'wood') {
        if (S.level < 3 || S.building || !sk.summon_druid) return 0;
        const n = g.druids ? g.druids.length : sk.summon_druid;
        return n / 4 * fn('woodPerLog', () => 4) * (live ? g.forestSpeedMult || 1 : 1);
      }
    } catch (e) { /* game internals changed: show nothing rather than crash the HUD */ }
    return 0;
  },

  /** directly clicked income per second (triangular window) */
  active(id: string): number {
    const evs = M.clicks[id]; if (!evs || !evs.length) return 0;
    const t = now(); let r = 0;
    while (evs.length && t - evs[0].t >= WINDOW) evs.shift();
    for (const e of evs) { const a = Math.max(0, t - e.t); r += e.v * 2 * (1 - a / WINDOW) / WINDOW; }
    return r;
  },

  /** unsmoothed target rate */
  target(id: string) { return this.passive(id, true) + this.active(id); },
  /** smoothed rate as displayed */
  rate(id: string) { return M.shown[id] || 0; },
  isBoosted(id: string) { return !!M.boosted[id]; },
  stats() { return M.gained; },

  label(r: number): string {
    if (r < 0.05) return '';
    if (r < 100) return '+' + (Math.round(r * 10) / 10).toFixed(1).replace(/\.0$/, '') + '/s';
    return '+' + (M.fmt ? M.fmt(r, true) : String(Math.round(r))) + '/s';
  },

  /** advances smoothing for id; call once per frame per resource (draw does it) */
  update(id: string) {
    const t = now(), last = M.lastT[id], dt = last === undefined ? 1 : Math.min(0.5, Math.max(0, t - last));
    M.lastT[id] = t;
    const tgt = this.target(id), cur = M.shown[id] === undefined ? this.passive(id) : M.shown[id];
    const k = 1 - Math.exp(-dt / (tgt > cur ? UP_TAU : DOWN_TAU));
    let v = cur + (tgt - cur) * k; if (Math.abs(v - tgt) < 0.01) v = tgt;
    M.shown[id] = v;
    const base = this.passive(id), was = !!M.boosted[id];
    const b = v > base * BOOST + 0.05;
    if (b && !was) M.pop[id] = 0.22; else M.pop[id] = Math.max(0, (M.pop[id] || 0) - dt);
    M.boosted[id] = b;
    return v;
  },

  /** width of the rate column for the given ids (sticky for 2 s so the panel does not breathe) */
  colW(D: PixelDraw, g: any, ids: string[], fmt?: Fmt): number {
    this.install(g, fmt);
    let w = 0;
    for (const id of ids) w = Math.max(w, D.textW(this.label(Math.max(this.update(id), this.passive(id)))));
    const t = now();
    if (w >= M.colW || t - M.colWT > 2) { if (w >= M.colW) M.colWT = t; M.colW = w; }
    return M.colW;
  },

  /** draws "+12.3/s" (or a pink ▲ + gold number while boosted) with its top-left at (x, y) */
  draw(D: PixelDraw, x: number, y: number, id: string) {
    const r = M.shown[id] || 0, s = this.label(r);
    if (!s) return;
    const boosted = !!M.boosted[id], pop = M.pop[id] || 0;
    const hop = pop > 0 ? Math.round(2 * Math.sin(Math.PI * (1 - pop / 0.22))) : 0;
    y -= hop;
    if (boosted) { // 5x3 triangle in place of the '+'
      D.rect(C_TRI, x + 2, y + 3, 1, 1); D.rect(C_TRI, x + 1, y + 4, 3, 1); D.rect(C_TRI, x, y + 5, 5, 1);
      D.text(s.slice(1), x + 5, y, pop > 0.1 ? C_FLASH : C_BOOST);
    } else D.text(s, x, y, C_IDLE);
  },
};
