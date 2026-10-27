// Dragon Nest (DragonNestIsland / DragonNestUI / DragonSimulation / DragonKeeperSimulation / DragonQueen /
// DragonAbility / Fireball / FireballShrapnel / MagicBreathAnimation).
// Dragon Keepers circle the nest and throw EXP into it; every level gives an ability point. The egg hatches at
// Lv 10 and grows into young (20), adult (36) and elder (50) forms; abilities unlock at the same levels:
// Pulse of Knowledge (0), Telepathy (10), Magic Breath (20), Treasure Keeper (36), Fireballs (50).
// World coordinates match the original scene (current_run.tscn), which the host shares 1:1.
import { registerModule, GameHost, GameModule, SkillDef, Multipliers } from '../GameModule';
import type { PixelDraw } from '../PixelDraw';

const ISLAND = [500, 355];            // DragonNestIsland (moves up 100/200/300 at towers 8/9/10)
const NEST = [3, -74];                // DragonNest, relative to the island
const KEEPER_ORIGIN = [0, 26];        // DragonKeeperSimulation, relative to the nest
const EXP_TARGET = [0, 25];           // DragonExpPosition (keeper origin + (0,-1))
const EGG = [0, 31];
const QUEEN = [12, -83];
const QUEEN_EXP_SPAWN = [-4, -9];
const WIZARD = [83, -25];
const AREA = { x: -1, y: 6, w: 174, h: 74 };   // DragonNestArea outline, centred

const SORCERY_TOWER = 7;
const KNOWLEDGE_PULSE_WAIT = 8, MAGIC_BREATH_WAIT = 12, FIREBALL_WAIT = 15;
const KEEPER_CAST_TIME = 4, KEEPER_GRAVITY = 150, KEEPER_SPEEDUP = 35;
const QUEEN_SPAWN_TIME = 3, QUEEN_GRAVITY = 200, QUEEN_PERCENT = 200, QUEEN_UPGRADE_PCT = 45;
const BREATHS = 75, BREATH_GRAVITY = 150;
const ABILITY_PCT = 10;

// Pulse: every 8 s, knowledge worth N study books. Telepathy: +N% academy training EXP. Magic Breath: every 12 s,
// magic worth N cloudling balls. Treasure Keeper: +N% alchemy EXP. Fireballs: every 15 s, N damage to the wall.
interface AbilityDef { id: string; name: string; base: number; req: number; short: (v: string) => string }
const ABILITIES: AbilityDef[] = [
  { id: 'pulse_of_knowledge', name: 'Pulse of Knowledge', base: 30, req: 0, short: v => `${v}x books` },
  { id: 'telepathy', name: 'Telepathy', base: 400, req: 10, short: v => `+${v}% EXP` },
  { id: 'magic_breath', name: 'Magic Breath', base: 55, req: 20, short: v => `${v} clouds` },
  { id: 'treasure_keeper', name: 'Treasure Keeper', base: 200, req: 36, short: v => `+${v}% gold` },
  { id: 'fireballs', name: 'Fireballs', base: 150, req: 50, short: v => `${v} dmg` },
];
const ABILITY: Record<string, AbilityDef> = {}; ABILITIES.forEach(a => ABILITY[a.id] = a);

// stage visuals: AnimatedSprite2D frames (centred), head marker for breath/fireballs
interface Stage { img: string; fw: number; fh: number; pos: number[]; head: number[]; idle: number[]; breath: number; fps: number }
const STAGES: Stage[] = [
  { img: 'dragon_egg', fw: 15, fh: 15, pos: [0, 31], head: [0, 0], idle: [0], breath: -1, fps: 1 },
  { img: 'baby_dragon', fw: 23, fh: 16, pos: [0, 31], head: [0, 0], idle: [0, 1], breath: -1, fps: 1.5 },
  { img: 'dragon', fw: 73, fh: 37, pos: [8, 20], head: [-31, -5], idle: [1, 0], breath: 2, fps: 1 },
  { img: 'adult_dragon', fw: 90, fh: 53, pos: [10, 14], head: [-30, -8], idle: [0, 1], breath: 2, fps: 1 },
  { img: 'elder_dragon', fw: 110, fh: 60, pos: [10, 12], head: [-45, -13], idle: [0, 1], breath: 2, fps: 1 },
];
const STAGE_LEVELS = [0, 10, 20, 36, 50];   // telepathy / magic_breath / treasure_keeper / fireballs requirements

// meta values from data/*.tres
const META = {
  dragonBond: 20, dragonWisdom: 100, dragonite: 300, holyGrail: 3000, ouroboros: 8000,
  dragonRune: 400, enchantMolten: 1, fireExp: 100, firePct: 3, dragonWisdomBlessing: 30, dragonBlessingPoints: 1,
  specEvery: 80, specPoints: 10, specAmount: 50, infinity: 30, fusion: 2, soundPulse: 1,
  shrapnelDamage: 250, shrapnelAmount: 10, shrapnelCount: 10, shrapnelWeakness: 50, shrapnelMolten: 8, hotRunes: 5,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
function fmt(n: number): string {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a < 1000) return (Math.round(n * 10) / 10).toString();
  const u = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  let i = -1, v = n;
  while (Math.abs(v) >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + u[i];
}

class DragonsModule implements GameModule {
  id = 'dragons';
  unlockTower = 5;
  nav = { label: 'Dragon' };
  resources = [{ id: 'dragon_ability_points', icon: 'ability_point', name: 'Dragon Ability Points' }];
  skills: Record<string, SkillDef> = {
    summon_dragon_keeper: {
      list: 'dragon_nest', name: 'Dragon Keeper', res: 'spirits', cost: () => 1, max: 10000, icon: 'dragon_keeper',
      summon: true, showLevel: true,
      tip: () => `Call a Dragon Keeper to train the Dragon\n\n- Hold the Dragon nest to make them work ${KEEPER_SPEEDUP}% faster`,
      onBuy: () => this.syncKeepers(true),
    },
    dragon_wisdom: {
      list: 'dragon_nest', name: 'Dragon Knowledge', res: 'knowledge', cost: (L: number) => 4e8 * Math.pow(2, L), max: 10,
      icon: null, showLevel: true,
      tip: () => `Dragon Keepers give ${META.dragonWisdom}% more EXP`,
      visible: (h: GameHost) => this.hasRelations('axel_nation') || h.skillLevel('dragon_wisdom') > 0,
    },
    cloud_resonance: {
      list: 'dragon_nest', name: 'Cloud Resonance', res: 'knowledge', cost: () => 900000, max: 1, icon: 'cloud_resonance',
      unlock: 'unlock_dragon_bond',
      tip: () => 'Whenever the Dragon breathes Magic, every Cloudling drops one bit of Magic',
    },
  };

  private host!: GameHost;
  // DragonNestUI
  level = 0; xp = 0; builtUpExp = 0;
  abil: Record<string, number> = {};
  // DragonSimulation
  pulseT = 0; breathT = 0; fireballT = 0;
  breathQueue = 0; animT = 0; breathAnim = 0;
  // keepers
  keepers: { x: number, y: number, dir: number, speed: number }[] = [];
  casting: Record<number, number> = {};
  castTimer = 0; speedMult = 1; speedTimer = 0;
  exps: { x: number, y: number, vx: number, vy: number }[] = [];
  // queen
  queen = 0; queenT = 0; queenFloat = 0;
  queenExp: { x: number, y: number, vx: number, vy: number, amount: number } | null = null;
  queenFireball: any = null;
  // projectiles & fx
  breaths: { x: number, y: number, vx: number, vy: number }[] = [];
  resBalls: { x: number, y: number, vx: number, vy: number, v: number }[] = [];
  fireballs: { x: number, y: number, vx: number, vy: number, t: number, smoke: { x: number, y: number, t: number, s: number }[] }[] = [];
  shrapnel: { x: number, y: number, vx: number, vy: number }[] = [];
  kBalls: { x: number, y: number, vx: number, vy: number, v: number }[] = [];
  fx: { x: number, y: number, img: string, fw: number, fh: number, frames: number, fps: number, t: number, oy: number }[] = [];
  labels: { x: number, y: number, text: string, icon: string, t: number }[] = [];
  // island / building
  islandY = ISLAND[1]; wasBuilt = false; buildAnim = 1; forceBuilt = false; lastStage = -1;

  init(host: GameHost) { this.host = host; ABILITIES.forEach(a => this.abil[a.id] = this.abil[a.id] || 0); }

  // ------------------------------------------------------------------ cross-module helpers
  private get M(): any { return this.host.modules as any; }
  private hasRelations(id: string) {
    for (const k of ['embassy', 'buildings']) { const m = this.M[k]; if (m && m.hasRelations) return !!m.hasRelations(id); }
    return false;
  }
  private blessing(id: string): number { const p = this.M.prestige; return p && p.blessingLevel ? (p.blessingLevel(id) || 0) : 0; }
  private relic(id: string): number { const a = this.M.alchemy; return a && a.relicLevel ? (a.relicLevel(id) || 0) : 0; }
  private rune(id: string): number { const r = this.M.runes; return r && r.runeLevel ? (r.runeLevel(id) || 0) : 0; }
  private training(id: string): number {
    for (const k of ['buildings', 'academy']) { const m = this.M[k]; if (m && m.trainingLevel) return m.trainingLevel(id) || 0; }
    return 0;
  }
  private siege(): any { return this.M.siege; }
  private wallTargetable(): boolean { const s = this.siege(); return !!s && (s.targetable ? !!s.targetable() : true); }
  private wallY(): number | null {
    const s = this.siege(); if (!s) return null;
    if (s.wallY) return s.wallY();
    if (typeof s.wallCY === 'number' && s.wallCY) return s.wallCY;
    return null;
  }
  private stacks(id: string): number { const s = this.siege(); return s && s.statusStacks ? (s.statusStacks(id) || 0) : 0; }

  built(): boolean {
    if (this.forceBuilt) return true;
    const b = this.M.buildings;
    if (b && b.hasBuilding) return !!b.hasBuilding('dragon_nest');
    return this.host.skillLevel('build_dragon_nest') > 0;
  }
  available() { return this.host.towerLevel() >= this.unlockTower && this.built(); }

  // ------------------------------------------------------------------ positions
  private islandTargetY() {
    const t = this.host.towerLevel();
    return ISLAND[1] - (t >= 10 ? 300 : t >= 9 ? 200 : t >= 8 ? 100 : 0);
  }
  // tw-buildings draws the island + nest building (with its build animation) and owns their position;
  // the local copy below is only a fallback for when the buildings module is absent.
  private buildingsNest(): number[] | null { const b = this.M.buildings; return b && b.nestPos ? b.nestPos() : null; }
  private nest(): number[] { return this.buildingsNest() || [ISLAND[0] + NEST[0], this.islandY + NEST[1]]; }
  // tw-temple draws the queen and her EXP orb; dragons only splits fireballs that rise past her
  private templeQueen() { const t = this.M.temple; return !!t && this.host.towerLevel() >= (t.unlockTower || 0); }
  private at(o: number[]): number[] { const [nx, ny] = this.nest(); return [nx + o[0], ny + o[1]]; }
  private keeperOrigin() { return this.at(KEEPER_ORIGIN); }
  private stageIdx(L = this.level) { let s = 0; STAGE_LEVELS.forEach((r, i) => { if (L >= r) s = i; }); return s; }
  private head(): number[] { const st = STAGES[Math.max(2, this.stageIdx())]; const p = this.at(st.pos); return [p[0] + st.head[0], p[1] + st.head[1]]; }
  private queenPos(): number[] { const p = this.at(QUEEN); return [p[0], p[1] + Math.sin(this.queenFloat) * 2]; }

  // ------------------------------------------------------------------ public API
  dragonLevel() { return this.level; }
  abilityLevel(id: string) { const a = ABILITY[id]; return a && this.level >= a.req ? (this.abil[id] || 0) : 0; }
  abilityValue(id: string) { const a = ABILITY[id]; return a && this.level >= a.req ? this.valueAt(a, this.abil[id] || 0) : 0; }
  private valueAt(a: AbilityDef, L: number) {
    const bless = Math.pow(1 + this.blessing('dragon_wisdom_blessing') * META.dragonWisdomBlessing / 100, Math.floor(L / 10));
    return a.base * (1 + ABILITY_PCT * L / 100) * bless;
  }
  addAbilityPoints(n: number) { this.host.addResource('dragon_ability_points', n); return n; }
  addExp(raw: number) { this.builtUpExp += raw; }
  setQueen(level: number | boolean) { this.queen = level === true ? Math.max(1, this.queen) : Math.max(0, Math.floor(+level || 0)); }
  nestPos(): [number, number] { const n = this.nest(); return [n[0], n[1]]; }
  keeperCount() { return this.host.skillLevel('summon_dragon_keeper'); }
  queenLevel(): number {
    const sk = this.host.skillLevel('summon_dragon_queen') > 0 ? 1 + this.host.skillLevel('upgrade_dragon_queen') : 0;
    return Math.max(this.queen, sk);
  }
  points() { return Math.floor(this.host.res('dragon_ability_points') + 1e-9); }

  // DragonNestUI.cap
  cap(L = this.level) { return 4 * Math.pow(1.33, Math.pow(L, 1 + L * 0.0007)); }

  expBonus(): number {
    const h = this.host;
    const bond = 1 + this.training('dragon_bond') * META.dragonBond / 100;
    const relics = 1 + (this.relic('dragonite') * META.dragonite + this.relic('holy_grail') * META.holyGrail + this.relic('ouroboros') * META.ouroboros) / 100;
    const wisdom = 1 + h.skillLevel('dragon_wisdom') * META.dragonWisdom / 100;   // Ceha (x4) arrives via mult('dragon_exp') from embassy
    const rl = this.rune('dragon_rune'), rune = rl > 0 ? 1 + META.dragonRune * rl / 100 : 1;
    const molten = h.skillLevel('enchant_molten') > 0 ? 1 + META.enchantMolten * this.stacks('molten') / 100 : 1;
    const fl = this.blessing('blessing_of_fire'), fire = fl > 0 ? 1 + META.fireExp * fl / 100 : 1;
    const p = this.M.prestige, destruction = p && p.destructionBonus ? p.destructionBonus() : 1;
    return bond * relics * wisdom * rune * molten * fire * destruction * h.mult('dragon_exp');
  }

  private addExpInstantly(raw: number) {
    let gain = this.expBonus() * raw, guard = 0;
    while (gain > 0 && guard++ < 10000) {
      const c = this.cap(), take = Math.min(gain, c - this.xp);
      this.xp += take; gain -= take;
      if (this.xp >= c * (1 - 1e-9)) {
        this.xp = 0; this.level++;
        this.host.addResource('dragon_ability_points', 1 + this.blessing('dragon_blessing') * META.dragonBlessingPoints);
      }
    }
  }

  private upgradeAbility(id: string, times = 1) {
    let n = 0;
    while (n < times && this.points() > 0 && this.host.spend('dragon_ability_points', 1)) { this.increase(id, 1); n++; }
    if (n) this.host.play('button_click', -6);
    return n;
  }
  private increase(id: string, amount: number) {
    const L = this.abil[id] || 0;
    if (this.blessing('specialization_blessing') > 0) {
      const next = META.specEvery * Math.ceil((L + 1) / META.specEvery);
      this.abil[id] = L + amount;
      if (L + amount >= next) for (const a of ABILITIES) if (a.id !== id) this.abil[a.id] = (this.abil[a.id] || 0) + META.specPoints;
    } else this.abil[id] = L + amount;
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    const h = this.host;
    const ty = this.islandTargetY(); this.islandY += (ty - this.islandY) * Math.min(1, dt * 3); if (Math.abs(ty - this.islandY) < 0.2) this.islandY = ty;
    const built = this.built();
    if (built && !this.wasBuilt && h.S && h.S.time > 1) { this.buildAnim = 0; h.play('tower_particles', -4); this.sparkleRect(this.at([0, 0]), 180, 84); }
    this.wasBuilt = built;
    this.buildAnim = Math.min(1, this.buildAnim + dt);
    this.updateFx(dt);
    if (!built) return;

    this.syncKeepers(false);
    const st = this.stageIdx();
    if (this.lastStage >= 0 && st > this.lastStage) {
      const s = STAGES[st], p = this.at(s.pos);
      this.sparkleRect(p, s.fw, s.fh); h.play('tower_particles', -2);
    }
    this.lastStage = st;
    this.animT += dt; this.queenFloat += dt * 2;
    if (this.breathAnim > 0) this.breathAnim -= dt;

    // DragonNestUI.update_exp: built-up EXP drains smoothly into the bar
    if (this.builtUpExp > 1e-12) {
      const remaining = Math.max(0, Math.min(this.builtUpExp, this.builtUpExp * (1 - dt * 2)));
      this.addExpInstantly(this.builtUpExp - remaining); this.builtUpExp = remaining;
    } else this.builtUpExp = 0;

    this.updateKeepers(dt);
    this.updateQueen(dt);

    // DragonSimulation timers
    this.pulseT += dt; if (this.pulseT >= KNOWLEDGE_PULSE_WAIT) { this.pulseT = 0; this.pulse(); }
    this.breathT += dt; if (this.breathT >= MAGIC_BREATH_WAIT) { this.breathT = 0; this.breathe(); }
    this.fireballT += dt; if (this.fireballT >= FIREBALL_WAIT) { this.fireballT = 0; this.fireball(); }

    const head = this.head();
    for (let i = 0; i < Math.min(10, this.breathQueue); i++) this.breaths.push({ x: head[0], y: head[1], vx: -rand(100, 200), vy: -rand(0, 100) });
    this.breathQueue = Math.max(0, this.breathQueue - 10);
    this.updateBreaths(dt);
    this.updateFireballs(dt);
    this.updateShrapnel(dt);
    this.updateKnowledge(dt);
  }

  // ---- keepers (DragonKeeperSimulation)
  private syncKeepers(fx: boolean) {
    const target = Math.min(400, this.host.skillLevel('summon_dragon_keeper'));
    while (this.keepers.length < target) {
      const i = this.keepers.length, ring = Math.floor(i / (10 + 0.1 * i));
      const r = (ring + 1) * 10 + rand(0, 10) + 50, a = -rand(0, Math.PI);
      this.keepers.push({ x: r * Math.cos(a), y: r * Math.sin(a), dir: 1, speed: rand(30, 50) });
      if (fx) { const o = this.keeperOrigin(); this.host.addEffect(o[0] + r * Math.cos(a), o[1] + r * Math.sin(a), 'spirit_spawn'); }
    }
    if (this.keepers.length > target) this.keepers.length = target;
  }
  private updateKeepers(dt: number) {
    this.speedTimer = Math.max(0, this.speedTimer - dt); if (this.speedTimer <= 0) this.speedMult = 1;
    const sp = this.speedMult, n = this.keepers.length;
    if (n) {
      const prev = this.castTimer; this.castTimer = (this.castTimer + dt * sp / KEEPER_CAST_TIME) % 1;
      const size = n + 1, a = Math.floor(prev * size); let b = Math.floor(this.castTimer * size);
      if (this.castTimer < prev) b += size;
      for (let i = a; i < b; i++) {
        const k = i % size; if (k >= n) continue;
        if (this.exps.length < n * 2) this.exps.push({ x: this.keepers[k].x, y: this.keepers[k].y, vx: 0, vy: 0 });
        this.casting[k] = 0.3;
      }
    }
    for (const k in this.casting) { this.casting[k] -= dt * sp; if (this.casting[k] <= 0) delete this.casting[k]; }
    this.keepers.forEach((k, i) => {
      if (this.casting[i] !== undefined) return;
      const r = Math.hypot(k.x, k.y) || 1; let a = Math.atan2(k.y, k.x);
      const oy = k.y, ox = k.x;
      a += k.speed * dt * sp / r * k.dir;
      k.x = r * Math.cos(a); k.y = r * Math.sin(a);
      if (oy > 0) k.dir = ox > 0 ? -1 : 1;
    });
    const tx = EXP_TARGET[0] - KEEPER_ORIGIN[0], ty = EXP_TARGET[1] - KEEPER_ORIGIN[1];
    for (let i = this.exps.length - 1; i >= 0; i--) {
      const e = this.exps[i], d = Math.hypot(tx - e.x, ty - e.y), v = Math.hypot(e.vx, e.vy);
      if (d < v * dt || d < 1) {
        this.exps.splice(i, 1);
        this.host.play('dragon_exp', -14, 0.05);
        this.addExp(1);
        continue;
      }
      e.vx += (tx - e.x) / d * KEEPER_GRAVITY * dt; e.vy += (ty - e.y) / d * KEEPER_GRAVITY * dt;
      e.x += e.vx * dt; e.y += e.vy * dt;
    }
  }

  // ---- Dragon Queen (Temple master)
  private updateQueen(dt: number) {
    if (this.queenLevel() <= 0) { this.queenExp = null; return; }
    if (this.templeQueen()) { this.queenExp = null; this.queenT = 0; }
    else {
      const r = this.M.runes, speed = r && r.templeSpeed ? r.templeSpeed() : 1;
      this.queenT += dt * speed;
      if (this.queenT > QUEEN_SPAWN_TIME) {
        this.queenT = 0;
        const q = this.queenPos(), keepers = this.host.skillLevel('summon_dragon_keeper');
        const amount = QUEEN_PERCENT / 100 * keepers * Math.pow(1 + QUEEN_UPGRADE_PCT / 100, this.queenLevel() - 1);
        if (amount > 0) this.queenExp = { x: q[0] + QUEEN_EXP_SPAWN[0], y: q[1] + QUEEN_EXP_SPAWN[1], vx: 0, vy: 0, amount };
      }
      const e = this.queenExp;
      if (e) {
        const t = this.at(EXP_TARGET), d = Math.hypot(t[0] - e.x, t[1] - e.y) || 1;
        e.vx += (t[0] - e.x) / d * QUEEN_GRAVITY * dt; e.vy += (t[1] - e.y) / d * QUEEN_GRAVITY * dt;
        e.x += e.vx * dt; e.y += e.vy * dt;
        if (Math.hypot(t[0] - e.x, t[1] - e.y) < 10) { this.host.play('dragon_exp', -10); this.addExp(e.amount); this.queenExp = null; }
      }
    }
    const f = this.queenFireball;
    if (f && this.fireballs.indexOf(f) >= 0 && f.y < this.queenPos()[1]) { this.splitFireball(f); this.queenFireball = null; }
    else if (f && this.fireballs.indexOf(f) < 0) this.queenFireball = null;
  }

  // ---- abilities in the world
  private knowledgeReward(): number {
    const h: any = this.host;
    if (h.knowledgeReward) return h.knowledgeReward();
    const S = h.S || {}, sk = S.skills || {};
    const totems = h.totemCount ? h.totemCount('knowledge_totem') : 0;
    return 10 * 0.5 * (1 + (sk.text_enchantment || 0) * 0.5) * (1 + totems) * this.host.mult('knowledge');
  }
  private cloudlingMagic(): number {
    const h: any = this.host;
    if (h.cloudlingMagic) return h.cloudlingMagic();
    const S = h.S || {}, sk = S.skills || {};
    const totems = h.totemCount ? h.totemCount('magic_totem') : 0;
    return 20 * (1 + (sk.cloudling_potency || 0) * 0.7) * (1 + totems) * this.host.mult('magic');
  }
  pulse() {
    const value = this.abilityValue('pulse_of_knowledge') * this.knowledgeReward();
    const [ex, ey] = this.at(EGG);
    this.addFx(ex, ey, 'knowledge_pulse', 39, 39, 4, 9);
    const study = this.host.towerAnchor('study') || this.host.orbPos();
    const dx = study[0] - ex, dy = study[1] - ey, d = Math.hypot(dx, dy) || 1;
    this.kBalls.push({ x: ex, y: ey, vx: dx / d * 100, vy: dy / d * 100, v: value });
  }
  private updateKnowledge(dt: number) {
    const study = this.host.towerAnchor('study') || this.host.orbPos();
    for (let i = this.kBalls.length - 1; i >= 0; i--) {
      const k = this.kBalls[i], dx = study[0] - k.x, dy = study[1] - k.y, d = Math.hypot(dx, dy) || 1;
      k.vx += dx / d * 100 * dt; k.vy += dy / d * 100 * dt; k.x += k.vx * dt; k.y += k.vy * dt;
      if (k.y < study[1] || d < 4) {
        this.kBalls.splice(i, 1);
        this.host.addResource('knowledge', k.v);
        this.labels.push({ x: k.x, y: k.y, text: '+' + fmt(k.v), icon: 'knowledge_icon', t: 0 });
      }
    }
  }
  breathe() {
    if (this.abilityValue('magic_breath') <= 0) return;
    this.breathQueue += BREATHS; this.breathAnim = 1;
    this.host.play('dragon_breath', -4);
    if (this.host.skillLevel('cloud_resonance') > 0) setTimeout(() => this.resonate(), 1000);
  }
  private resonate() {
    const h: any = this.host;
    if (h.cloudlingBurst) { h.cloudlingBurst(); return; }
    const n = Math.min(200, h.skillLevel('summon_cloudling')); if (!n) return;
    const [ox, oy] = this.host.orbPos(), v = this.cloudlingMagic();
    for (let i = 0; i < n; i++) {
      const r = 20 + (i % 8) * 4 + rand(0, 6), a = rand(0, Math.PI * 2);
      this.resBalls.push({ x: ox + r * Math.cos(a), y: oy + r * Math.sin(a), vx: -Math.sin(a) * 20, vy: Math.cos(a) * 20, v });
    }
  }
  private updateBreaths(dt: number) {
    const [ox, oy] = this.host.orbPos(), decay = Math.pow(0.2, dt);
    const per = this.cloudlingMagic() * this.abilityValue('magic_breath') / BREATHS;
    let gained = 0;
    for (const list of [this.breaths, this.resBalls] as any[][]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i], dx = ox - b.x, dy = oy - b.y, d = Math.hypot(dx, dy) || 1;
        b.vx += dx / d * BREATH_GRAVITY * dt; b.vy += dy / d * BREATH_GRAVITY * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if ((ox - b.x) ** 2 + (oy - b.y) ** 2 <= 100) {
          list.splice(i, 1);
          const v = b.v !== undefined ? b.v : per;
          this.host.addResource('magic', v); gained += v;
        } else { b.vx *= decay; b.vy *= decay; }
      }
    }
    if (gained > 0) { this.host.play('spirit_ball', -12, 0.08); if (Math.random() < 0.15) this.labels.push({ x: ox + rand(-6, 6), y: oy - 6, text: '+' + fmt(gained), icon: 'magic_icon', t: 0 }); }
  }

  // ---- fireballs (Fireball.gd / FireballShrapnel.gd)
  fireball(force = false) {
    if (!force && (this.abilityValue('fireballs') <= 0 || this.host.towerLevel() < SORCERY_TOWER || !this.wallTargetable())) return;
    const [hx, hy] = this.head();
    const f = { x: hx, y: hy, vx: -100, vy: -175, t: 0, smoke: [] };
    this.fireballs.push(f);
    if (this.queenLevel() > 0) this.queenFireball = f;
    this.breathAnim = 1;
    this.host.play('dragon_breath', -4);
  }
  private splitFireball(f: any) {
    const i = this.fireballs.indexOf(f); if (i < 0) return;
    this.fireballs.splice(i, 1);
    this.fireballs.push({ x: f.x, y: f.y, vx: -200, vy: -175, t: 0, smoke: [] }, { x: f.x, y: f.y, vx: 0, vy: -175, t: 0, smoke: [] });
    this.addFx(f.x, f.y, 'fireball_double_effect', 31, 31, 3, 9);
  }
  baseFireballDamage(): number {
    const infinity = 1 + this.host.skillLevel('infinity_rune_upgrade') * META.infinity / 100;
    let fusion = 1; const fl = this.rune('fusion');
    if (fl > 0) { const a = this.M.alchemy, ifrit = a && a.ifritBaseDamage ? a.ifritBaseDamage() : 0; fusion += ifrit * fl * META.fusion / 100; }
    return this.abilityValue('fireballs') * infinity * fusion;
  }
  fireballDamage(): number {
    const fire = Math.max(1, this.blessing('blessing_of_fire'));
    const molten = 1 + this.stacks('molten') * META.firePct * fire / 100;
    const resonance = 1 + this.stacks('resonance') * META.soundPulse * this.rune('sound_pulse') / 100;
    return this.baseFireballDamage() * molten * resonance;
  }
  private updateFireballs(dt: number) {
    const wy = this.wallY(), targetable = this.wallTargetable();
    const hitY = wy !== null ? wy : this.host.orbPos()[1] - 260;
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.x += f.vx * dt; f.y += f.vy * dt; f.t += dt;
      f.vx *= Math.pow(0.5, dt); f.vy *= Math.pow(1.2, dt);
      for (let k = 0; k < 2; k++) if (Math.random() < dt * 66) f.smoke.push({ x: f.x + rand(-3, 3), y: f.y + rand(-3, 3), t: 0, s: rand(1.5, 2) });
      for (let k = f.smoke.length - 1; k >= 0; k--) { const s = f.smoke[k]; s.t += dt; s.y -= rand(10, 20) * dt; if (s.t > 0.3) f.smoke.splice(k, 1); }
      if (f.y < hitY && targetable) {
        this.fireballs.splice(i, 1);
        const s = this.siege(); if (s && s.damage) s.damage(this.fireballDamage(), 'dragon', f.x, f.y);
        this.addFx(f.x, f.y, 'fireball_explosion', 61, 45, 5, 12, 12);
        this.host.play('fireball', -2);
        const fl = this.rune('fireball_shrapnel');
        if (fl > 0) {
          const n = META.shrapnelAmount + META.shrapnelCount * this.rune('shrapnel_count');
          for (let k = 0; k < Math.min(n, 120); k++) {
            const a = Math.PI / 2 + rand(-0.25, 0.25) * Math.PI, sp = rand(200, 350);
            this.shrapnel.push({ x: f.x, y: f.y + 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
          }
        }
      } else if ((!targetable && f.y < hitY) || f.t > 12) this.fireballs.splice(i, 1);
    }
  }
  private shrapnelDamage(): number {
    let curse = 1;
    if (this.rune('cursed_shards') > 0) { const s = this.siege(); curse = s && s.curseBaseDamage ? s.curseBaseDamage() : 1; }
    let hot = 1; const hl = this.rune('hot_runes');
    if (hl > 0) { const r = this.M.runes, n = r && r.numRunesUnlocked ? r.numRunesUnlocked() : 0; hot = 1 + META.hotRunes * hl / 100 * n; }
    const infinity = 1 + this.host.skillLevel('infinity_rune_upgrade') * META.infinity / 100;
    return (META.shrapnelDamage * infinity + curse) * hot;
  }
  private updateShrapnel(dt: number) {
    const wy = this.wallY(), targetable = this.wallTargetable(), hitY = wy !== null ? wy : this.host.orbPos()[1] - 260;
    for (let i = this.shrapnel.length - 1; i >= 0; i--) {
      const p = this.shrapnel[i];
      p.vy -= 490 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y < hitY && targetable) {
        this.shrapnel.splice(i, 1);
        const s = this.siege();
        if (s && s.damage) s.damage(this.shrapnelDamage(), 'fireball_shrapnel', p.x, p.y);
        this.host.play('shrapnel', -9, 0.04);
        if (s && s.addStatus) {
          const wl = this.rune('shrapnel_weakness'), ml = this.rune('shrapnel_molten');
          // Observatory analyze_weakened / analyze_molten arrive as multipliers from tw-temple
          if (wl > 0) s.addStatus('weakened', META.shrapnelWeakness * wl * this.host.mult('weakened_apply'));
          if (ml > 0) s.addStatus('molten', META.shrapnelMolten * ml * this.host.mult('molten_apply'));
        }
      } else if (p.y < hitY - 200 || p.y > hitY + 2000) this.shrapnel.splice(i, 1);
    }
  }

  // ---- fx
  private addFx(x: number, y: number, img: string, fw: number, fh: number, frames: number, fps: number, oy = 0) {
    this.fx.push({ x, y, img, fw, fh, frames, fps, t: 0, oy });
  }
  private sparkleRect(c: number[], w: number, h: number) {
    const n = Math.max(3, Math.floor(h / 5));
    for (let i = 0; i < n; i++) this.host.addEffect(c[0] - w / 2 + Math.random() * w, c[1] + h / 2 - i * h / n, 'sparkle' + (i % 4));
  }
  private updateFx(dt: number) {
    for (let i = this.fx.length - 1; i >= 0; i--) { const f = this.fx[i]; f.t += dt; if (f.t * f.fps >= f.frames) this.fx.splice(i, 1); }
    for (let i = this.labels.length - 1; i >= 0; i--) { const l = this.labels[i]; l.t += dt; if (l.t > 1) this.labels.splice(i, 1); }
  }

  // ------------------------------------------------------------------ input
  hitWorld(wx: number, wy: number) {
    if (!this.available()) return false;
    const [nx, ny] = this.nest();
    return Math.abs(wx - (nx + AREA.x)) <= AREA.w / 2 && Math.abs(wy - (ny + AREA.y)) <= AREA.h / 2;
  }
  onHold() {
    let m = 1 + KEEPER_SPEEDUP / 100;
    const h: any = this.host; if (h.clickSpeedBonus) m = h.clickSpeedBonus(m);
    this.speedMult = m; this.speedTimer = 0.5;
  }
  worldFocus(): [number, number] { const [nx, ny] = this.nest(); return [nx, ny - 10]; }
  worldBounds() { return this.available() ? { maxX: 1100 } : null; }   // CameraMovement: x limit 1100 once the nest exists

  // ------------------------------------------------------------------ drawing
  private centred(D: PixelDraw, img: string, cx: number, cy: number, fw: number, fh: number, frame = 0, o?: any) {
    D.part(img, frame * fw, 0, fw, fh, Math.round(cx - fw / 2), Math.round(cy - fh / 2), fw, fh, o);
  }
  drawWorldBack(D: PixelDraw) {
    if (this.host.towerLevel() < this.unlockTower) return;
    const b = this.M.buildings, theirs = !!(b && b.hasBuilding && b.hasBuilding('dragon_nest'));   // tw-buildings draws island + nest
    if (!b) {
      const [iw, ih] = D.size('dragon_nest_island');
      D.img('dragon_nest_island', Math.round(ISLAND[0] - iw / 2), Math.round(this.islandY - ih / 2 + 0.5));
    }
    if (!this.built()) return;
    const [nx, ny] = this.nest();
    if (!theirs) {   // fallback (no buildings module, or a debug build without it): BuildingAnimation rises out of the island
      const k = this.buildAnim, [bw, bh] = D.size('dragon_nest');
      if (k < 1) {
        const vis = Math.max(1, Math.round(bh * k));
        D.part('dragon_nest', 0, bh - vis, bw, vis, Math.round(nx - bw / 2), Math.round(ny + bh / 2 - vis), bw, vis, { alpha: 0.4 + 0.6 * k });
      } else D.img('dragon_nest', Math.round(nx - bw / 2), Math.round(ny - bh / 2));
    }
    if (this.host.S && this.host.S.activeArea === this.id) {
      const [ow, oh] = D.size('dragon_nest_outline');
      D.img('dragon_nest_outline', Math.round(nx + AREA.x - ow / 2), Math.round(ny + AREA.y - oh / 2), { alpha: 0.6 });
    }
  }

  drawWorld(D: PixelDraw) {
    if (this.host.towerLevel() < this.unlockTower) return;
    if (this.built() && this.buildAnim >= 1) {
      // dragon
      const st = STAGES[this.stageIdx()], p = this.at(st.pos);
      const frame = this.breathAnim > 0 && st.breath >= 0 ? st.breath : st.idle[Math.floor(this.animT * st.fps) % st.idle.length];
      this.centred(D, st.img, p[0], p[1], st.fw, st.fh, frame);
      // keepers + exp
      const [kx, ky] = this.keeperOrigin();
      this.keepers.forEach((k, i) => this.centred(D, this.casting[i] !== undefined ? 'dragon_keeper_cast' : 'dragon_keeper', kx + k.x, ky + k.y, 6, 10, 0, k.dir < 0 ? { flipX: true } : undefined));
      for (const e of this.exps) this.centred(D, 'exp', kx + e.x, ky + e.y, 10, 10);
      // queen
      if (this.queenLevel() > 0 && !this.templeQueen()) {
        const q = this.queenPos(), cast = this.queenT > QUEEN_SPAWN_TIME * 0.7 || !!this.queenFireball;
        this.centred(D, cast ? 'dragon_queen_cast' : 'dragon_queen', q[0], q[1], 26, 18);
        if (this.queenExp) D.img('dragon_queen_exp', Math.round(this.queenExp.x), Math.round(this.queenExp.y));
      }
      // floating wizard while the nest UI is open
      if (this.host.S && this.host.S.activeArea === this.id) {
        const w = this.at(WIZARD), img = D.has('wizard_floating') ? 'wizard_floating' : 'wizard', [ww, wh] = D.size(img);
        D.img(img, Math.round(w[0] - ww / 2), Math.round(w[1] - wh / 2 + Math.sin(this.queenFloat)), { flipX: true });
      }
    }
    for (const b of this.breaths) D.img('magic_breath', Math.round(b.x - 2), Math.round(b.y - 2));
    for (const b of this.resBalls) this.centred(D, 'cloudling_ball', b.x, b.y, 3, 3);
    for (const k of this.kBalls) D.img('big_knowledge', Math.round(k.x - 2.5), Math.round(k.y - 2.5));
    for (const f of this.fireballs) {
      for (const s of f.smoke) { const sc = s.s * (1 - 0.74 * s.t / 0.3), w = 4 * sc; D.part('fireball_smoke', 0, 0, 4, 4, s.x - w / 2, s.y - w / 2, w, w); }
      const rot = Math.atan2(f.vy, f.vx);
      D.img('dragon_fireball', Math.round(f.x - 10.5), Math.round(f.y - 5.5), { rot, pivot: [Math.round(f.x - 10.5) + 10.5, Math.round(f.y - 5.5) + 5.5] });
    }
    const cursed = this.rune('cursed_shards') > 0;
    for (const p of this.shrapnel) cursed ? this.centred(D, 'cursed_shrapnel', p.x, p.y, 7, 7) : this.centred(D, 'shrapnel', p.x, p.y, 4, 4);
    for (const f of this.fx) this.centred(D, f.img, f.x, f.y + f.oy, f.fw, f.fh, Math.min(f.frames - 1, Math.floor(f.t * f.fps)));
    for (const l of this.labels) {
      const y = Math.round(l.y - 16 * Math.min(1, l.t / 0.6));
      D.img(l.icon, Math.round(l.x - 12), y, { alpha: 1 - Math.max(0, l.t - 0.6) / 0.4 });
      D.text(l.text, Math.round(l.x), y, '#ffffff', 10);
    }
  }

  // ---- panel (DragonNestUI): skill list, level panel, abilities panel
  private get RH() { return this.host.mobile ? 22 : 14; }
  private abilityRows(): AbilityDef[] { return ABILITIES.filter(a => this.level >= a.req); }
  private nextAbility(): AbilityDef | null { let n: AbilityDef | null = null; for (const a of ABILITIES) if (this.level < a.req && (!n || a.req < n.req)) n = a; return n; }
  drawPanel(D: PixelDraw) {
    if (!this.available()) return null;
    const h = this.host, W = h.mobile ? Math.min(h.W - 8, 250) : 220, RH = this.RH;
    const listH = h.skillListHeight('dragon_nest'), lvlH = RH + 8;
    const rows = this.abilityRows(), next = this.nextAbility();
    const abH = 18 + rows.length * (RH + 2) + (next ? 14 : 0) + 2;
    const r = h.panelRect(W, listH + 2 + lvlH + 2 + abH);
    let y = r.y;
    h.drawSkillList('dragon_nest', 'Dragon Nest', r.x, y, W); y += listH + 2;
    // level panel: "Dragon Lv. N", EXP bar, ability points
    D.nine('panel', r.x, y, W, lvlH);
    const ty = y + Math.floor((lvlH - 10) / 2);
    D.text(`Dragon Lv. ${this.level}`, r.x + 4, ty, '#ffffff', 10);
    h.progressBar(r.x + 74, y + Math.floor(lvlH / 2) - 4, W - 74 - 40, 8, this.xp / this.cap());
    D.img('ability_point', r.x + W - 34, ty);
    D.text(String(this.points()), r.x + W - 22, ty, '#fff1d6', 10);
    y += lvlH + 2;
    // abilities: "Name L   value  [Upgrade]"
    D.nine('panel', r.x, y, W, abH);
    D.text('Abilities', r.x + 4, y + 3, '#ffffff', 12);
    let ry = y + 18;
    const pts = this.points(), bw = 44, ty2 = Math.floor((RH - 10) / 2);
    for (const a of rows) {
      const L = this.abil[a.id] || 0, v = a.short(fmt(this.valueAt(a, L))), bx = r.x + W - bw - 4;
      D.text(`${a.name} ${L}`, r.x + 6, ry + ty2, '#fff1d6', 10);
      D.text(v, bx - 4 - D.textW(v, 10), ry + ty2, '#a8a3b8', 10);
      if (h.button('dragon_ab_' + a.id, 'Upgrade', bx, ry, bw, RH, pts <= 0)) this.upgradeAbility(a.id, 1);
      ry += RH + 2;
    }
    if (next) D.text(`Level ${next.req} unlocks ${next.name}`, r.x + 4, ry, '#a8a3b8', 10);
    return r;
  }
  multipliers(): Multipliers {
    return {
      academy_exp: 1 + this.abilityValue('telepathy') / 100,
      magic_gold_speed: 1 + this.abilityValue('treasure_keeper') / 100,
    };
  }

  // ------------------------------------------------------------------ save / reset
  save() {
    return {
      level: this.level, xp: this.xp, builtUpExp: this.builtUpExp, abilities: { ...this.abil },
      pulseT: this.pulseT, breathT: this.breathT, fireballT: this.fireballT, queen: this.queen, forceBuilt: this.forceBuilt,
    };
  }
  load(d: any) {
    if (!d) return;
    this.level = d.level || 0; this.xp = d.xp || 0; this.builtUpExp = d.builtUpExp || 0;
    ABILITIES.forEach(a => this.abil[a.id] = (d.abilities && d.abilities[a.id]) || 0);
    this.pulseT = d.pulseT || 0; this.breathT = d.breathT || 0; this.fireballT = d.fireballT || 0;
    this.queen = d.queen || 0; this.forceBuilt = !!d.forceBuilt;
    this.keepers = []; this.exps = []; this.casting = {};
    this.lastStage = -1; this.wasBuilt = this.built(); this.buildAnim = 1;
  }
  reset(_keepPermanent: boolean) {
    this.level = 0; this.xp = 0; this.builtUpExp = 0;
    ABILITIES.forEach(a => this.abil[a.id] = 0);
    const p = this.host.res('dragon_ability_points'); if (p > 0) this.host.spend('dragon_ability_points', p);
    this.pulseT = this.breathT = this.fireballT = 0; this.queen = 0; this.queenT = 0; this.queenExp = null; this.queenFireball = null;
    this.keepers = []; this.exps = []; this.casting = {}; this.breaths = []; this.resBalls = []; this.fireballs = []; this.shrapnel = []; this.kBalls = [];
    this.breathQueue = 0; this.lastStage = -1; this.forceBuilt = false; this.wasBuilt = false;
    const sb = this.blessing('specialization_blessing'); if (sb > 0) this.host.addResource('dragon_ability_points', META.specAmount);
  }

  // ------------------------------------------------------------------ dev panel
  private setLevel(L: number) {
    this.level = L; this.xp = 0; this.builtUpExp = 0;
    const gained = Math.max(0, L - this.points() - ABILITIES.reduce((s, a) => s + (this.abil[a.id] || 0), 0));
    if (gained > 0) this.host.addResource('dragon_ability_points', gained);
  }
  debug: Record<string, (...args: any[]) => void> = {
    buildNest: () => {
      const b = this.M.buildings, f = b && b.debug && (b.debug['Building: build Dragon Nest'] || b.debug.buildDragonNest);
      if (f) f(); else this.forceBuilt = true;   // tw-buildings plays its build animation, then hasBuilding() turns true
      if (this.host.skillLevel('summon_dragon_keeper') < 10 && this.host.S && this.host.S.skills) { this.host.S.skills.summon_dragon_keeper = 10; this.syncKeepers(true); }
    },
    level10: () => this.setLevel(10),
    level20: () => this.setLevel(20),
    level36: () => this.setLevel(36),
    level50: () => this.setLevel(50),
    level63: () => this.setLevel(63),
    levelUp: () => this.addExpInstantly((this.cap() - this.xp) / Math.max(1e-9, this.expBonus())),
    addKeepers10: () => { const S = this.host.S; if (S && S.skills) { S.skills.summon_dragon_keeper = (S.skills.summon_dragon_keeper || 0) + 10; this.syncKeepers(true); } },
    abilityPoints50: () => this.host.addResource('dragon_ability_points', 50),
    maxAbilities: () => { this.setLevel(Math.max(this.level, 63)); ABILITIES.forEach(a => this.abil[a.id] = Math.max(this.abil[a.id] || 0, 100)); },
    pulseNow: () => this.pulse(),
    breathNow: () => { if (this.abilityValue('magic_breath') <= 0) this.setLevel(Math.max(this.level, 20)); this.breathe(); },
    fireballNow: () => { if (this.abilityValue('fireballs') <= 0) this.setLevel(Math.max(this.level, 50)); this.fireball(true); },
    toggleQueen: () => {   // tw-temple draws the queen from its summon_dragon_queen skill
      const on = this.queenLevel() <= 0, S = this.host.S;
      this.queen = on ? 1 : 0;
      if (S && S.skills && 'summon_dragon_queen' in S.skills) S.skills.summon_dragon_queen = on ? 1 : 0;
    },
    resetDragon: () => this.reset(false),
  };
}

registerModule(new DragonsModule());
