// Fake GameHost for fast logic tests of feature modules (no Cocos, no browser, no build).
// Mirrors the real host's rules in TowerWizardGame.ts: gains go through onGain and commit at the end of the frame,
// costs compare current resources, mult() multiplies every module's multipliers(), modules run once unlocked.
// Usage (see tools/tests/example.test.ts):
//   import { createGame } from '../testkit/fakehost';
//   const g = await createGame({ level: 7 });     // loads every module from assets/scripts/modules/index.ts
//   g.give('magic', 1e9); g.buy('summon_gorgon', 5); g.run(30);   // 30 simulated seconds
import { getModules } from '../../assets/scripts/GameModule';
import type { GameHost, GameModule, SkillDef } from '../../assets/scripts/GameModule';
import { textWidth } from '../../assets/scripts/FontMetrics';

export const TOWER_COSTS: Record<string, number>[] = [{ magic: 30 }, { magic: 1300 }, { magic: 13000 }, { magic: 350000, wood: 20000 },
  { magic: 4e6, wood: 1.5e5 }, { magic: 5e8, wood: 1.5e7 }, { magic: 1e12, magic_gold: 500 }, {}, {}, { cosmic_dust: 50 }];

/** Records every draw call; images always "exist" with a fixed size so layout code runs. */
export function fakeDraw() {
  const calls: any[] = [];
  const rec = (op: string) => (...a: any[]) => { calls.push([op, ...a]); };
  const D: any = {
    calls, has: () => true, size: () => [16, 16], textW: (s: string, size = 10) => textWidth(String(s), size),   // same advance table as the real fonts
    img: rec('img'), part: rec('part'), nine: rec('nine'), rect: rec('rect'), text: rec('text'),
    setTransform: rec('setTransform'), resetTransform: rec('resetTransform'), setTint: rec('setTint'),
    begin() { calls.length = 0; }, end() {},
  };
  return D;
}

export interface Game {
  host: GameHost; S: any; mods: GameModule[]; skills: Record<string, SkillDef>; D: any;
  log: { gains: [string, number][]; sounds: string[]; toasts: string[]; stories: string[]; errors: string[] };
  give(id: string, v: number): void;            // add resource directly (no onGain), like a dev grant
  buy(id: string, n?: number): number;          // paid purchase, same rules as the real host
  setLevel(level: number): void;                // jump without animation (+ onTowerBuilt)
  run(seconds: number, dt?: number): void;      // simulate: update every unlocked module, commit gains
  draw(): any[];                                // run every draw pass of unlocked modules, return draw calls
  panel(id: string): any;                       // drawPanel of one module (returns its rect)
  mod<T = any>(id: string): T;
}

export async function createGame(opts: { level?: number; modules?: string[]; W?: number; H?: number } = {}): Promise<Game> {
  await import('../../assets/scripts/modules/index');
  const all = getModules();
  const mods = opts.modules ? all.filter(m => opts.modules!.includes(m.id)) : all.slice();
  const W = opts.W ?? 270, H = opts.H ?? 480;
  const D = fakeDraw();
  const log = { gains: [] as [string, number][], sounds: [] as string[], toasts: [] as string[], stories: [] as string[], errors: [] as string[] };
  // same shape as the real host's S (TowerWizardGame.ts); add fields here when modules start reading new ones
  const S: any = { res: {}, pending: {}, earned: {}, seen: {}, skills: {}, level: 0, time: 0, orb: { x: 318, y: 306 }, activeArea: '', navigated: '',
    started: true, building: null, resourcesVisible: true, speedMult: 1, studySpeedMult: 1, newArea: '' };
  const skills: Record<string, SkillDef> = {};
  const totems: Record<string, number> = {};
  const byId: Record<string, GameModule> = {};
  let multCache: Record<string, number> = {};
  const res = (id: string) => (S.res[id] ??= 0, S.earned[id] ??= 0, S.pending[id] ??= 0, S.seen[id] ??= false, S.res[id]);
  const on = (m: GameModule) => S.level >= (m.unlockTower ?? 0);
  const guard = (m: GameModule, what: string, f: () => any) => { try { return f(); } catch (e: any) { log.errors.push(`${m.id}.${what}: ${e?.stack || e}`); } };

  const host: GameHost = {
    S, D, W, H, mobile: true, portrait: true, fervor: 0, modules: byId,
    towerLevel: () => S.level,
    towerAnchor: (_n: string) => [300, 200],
    orbPos: () => [S.orb.x, S.orb.y],
    res: (id) => res(id),
    lifetime: (id) => (res(id), S.earned[id]),
    addResource(id, v) {
      if (!(v > 0)) return; res(id);
      for (const m of mods) if (m.onGain) guard(m, 'onGain', () => m.onGain!(id, v));
      S.pending[id] += v; log.gains.push([id, v]);
    },
    spend(id, v) { if (!(v >= 0) || res(id) + 1e-9 < v) return false; S.res[id] -= v; return true; },
    mult(kind) {
      if (multCache[kind] !== undefined) return multCache[kind];
      multCache[kind] = 1; let v = 1;
      for (const m of mods) if (m.multipliers) { const x = guard(m, 'multipliers', () => m.multipliers!()[kind]); if (typeof x === 'number' && isFinite(x)) v *= x; }
      return multCache[kind] = v;
    },
    skillLevel: (id) => S.skills[id] ?? 0,
    play: (s) => { log.sounds.push(s); },
    addEffect() {}, toast: (m) => { log.toasts.push(m); },
    showStory: (_p, text) => { log.stories.push(text); },
    toScreen: (x, y) => [x, y], toWorld: (x, y) => [x, y], camFocus() {},
    button: () => false, progressBar() {},
    drawSkillList: (_l, _t, _x, _y, _w) => 40, skillListHeight: () => 40,
    panelRect: (w, h) => ({ x: Math.round((W - Math.min(w, W - 4)) / 2), y: Math.max(2, H - 40 - h), w: Math.min(w, W - 4), h }),
    cloudlingMagic: () => 20 * host.mult('magic'), cloudlingBurst() {},
    knowledgeReward: () => 5 * host.mult('knowledge'),
    isUnlocked: (id) => !!byId[id] && on(byId[id]),
    save() {}, totemCounts: () => ({ ...totems }),
    setTowerLevel(level) { S.level = level; for (const m of mods) if (m.onTowerBuilt) guard(m, 'onTowerBuilt', () => m.onTowerBuilt!(level)); },
    setSkillLevel(id, level) { const d = skills[id]; S.skills[id] = d ? Math.max(0, Math.min(d.max, Math.floor(level))) : level; },
    resetRun() {
      for (const k of ['res', 'pending', 'earned']) for (const id in S[k]) S[k][id] = 0;
      for (const id in S.skills) S.skills[id] = 0; S.level = 0;
      for (const m of mods) if (m.reset) guard(m, 'reset', () => m.reset!(true));
      for (const m of mods) if (m.onRunStart) guard(m, 'onRunStart', () => m.onRunStart!());
    },
    pointer: () => ({ x: 0, y: 0, down: false, casting: false }),
    shake() {}, debugSetLevel: (l) => host.setTowerLevel(l), hideTower() {},
    buySkill: (id, n) => g.buy(id, n),
    nextTowerCost: () => (S.level >= 10 ? null : { ...TOWER_COSTS[S.level] }),
  };

  for (const m of mods) {
    byId[m.id] = m;
    for (const r of m.resources ?? []) res(r.id);
    for (const [id, d] of Object.entries(m.skills ?? {})) { skills[id] = d; S.skills[id] ??= 0; }
  }
  for (const m of mods) if (m.init) guard(m, 'init', () => m.init!(host));

  const g: Game = {
    host, S, mods, skills, D, log,
    give(id, v) { res(id); S.res[id] += v; S.earned[id] += v; },
    buy(id, n = 1) {
      const d = skills[id]; if (!d) { log.errors.push(`buy: unknown skill ${id}`); return 0; }
      let bought = 0;
      while (bought < n && (S.skills[id] ?? 0) < d.max) {
        const c = d.cost(S.skills[id] ?? 0); if (res(d.res) + 1e-9 < c) break;
        S.res[d.res] -= c; S.skills[id] = (S.skills[id] ?? 0) + 1; bought++;
        if (d.onBuy) { const lv = S.skills[id]; guard(byId[d.list] ?? mods[0], 'onBuy', () => d.onBuy!(host, lv)); }
      }
      if (bought && d.creates) host.addResource(d.creates, bought);
      commit(); return bought;
    },
    setLevel: (l) => host.setTowerLevel(l),
    run(seconds, dt = 1 / 30) {
      for (let t = 0; t < seconds - 1e-9; t += dt) {
        S.time += dt; multCache = {};
        for (const m of mods) if (m.update && on(m)) guard(m, 'update', () => m.update!(dt));
        commit();
      }
    },
    draw() {
      D.begin();
      for (const pass of ['drawWorldBack', 'drawWorld', 'drawHud', 'overlay'] as const)
        for (const m of mods) { const f = (m as any)[pass]; if (f && on(m)) guard(m, pass, () => f.call(m, D)); }
      return D.calls;
    },
    panel(id) { const m = byId[id]; S.activeArea = id; return m?.drawPanel ? guard(m, 'drawPanel', () => m.drawPanel!(D)) : null; },
    mod: (id) => byId[id] as any,
  };
  function commit() { for (const id in S.pending) if (S.pending[id] > 0) { S.res[id] += S.pending[id]; S.earned[id] += S.pending[id]; S.pending[id] = 0; } multCache = {}; }
  if (opts.level) g.setLevel(opts.level);
  return g;
}
