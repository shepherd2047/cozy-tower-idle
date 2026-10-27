// Temple (tower 9): Cosmic Dust from Cosmic Wall damage and the four masters (+ their cosmic-dust upgrades).
// Port of TempleArea.gd, TempleExp.gd, TempleAnimation.gd, TempleSpeedUpManager.gd, TomeMaster.gd, SmithMaster.gd,
// ForestKeeper.gd / ForestKeeperVisuals.gd (forest_keeper_portal.tscn) and DragonQueen.gd; numbers from data/skills/*.tres.
// The Astrologer is bought here (list 'temple') but lives in observatory.ts.
import { registerModule } from '../GameModule';
import type { GameHost, GameModule, SkillDef, Multipliers } from '../GameModule';
import type { PixelDraw } from '../PixelDraw';

export const TEMPLE_TUNING = {
  // TempleExp._on_damaged: final_damage / 1e9 exp. This port's walls have ~1e5 HP (Siege SIEGE_TUNING.wallHp),
  // so damage is scaled down to keep dust flowing at the same pace relative to wall HP.
  dmgPerExp: 300,
  speedUp: 1.15, speedUpTime: 0.4,          // TempleSpeedUpManager: +15% for 0.4 s while pressed
  masterPeriod: 3.0,                         // BUILT_UP_KNOWLEDGE_TIME / HAMMER_TIME / DRAGON_QUEEN_SPAWN_TIME
};

// tower-local fallbacks (tower_8.png / tower_9.png top-left) when the host has no named anchor
const FALLBACK: Record<string, [number, number]> = { temple: [51, 186], study: [137.5, 76], portal: [44.5, 313], obeliskPos: [181.5, 238.5] };

/** World position of a tower anchor: host first, then the original scene coordinates on the current tower image. */
export function anchorOf(host: GameHost, name: string): [number, number] | null {
  const a = host.towerAnchor(name);
  if (a) return a;
  const f = FALLBACK[name]; if (!f) return null;
  const L = host.towerLevel(); if (L <= 0) return null;
  const img = 'tower_' + Math.min(L - 1, 9), [w, h] = host.D.size(img);
  if (!w) return null;
  return [320 - w / 2 + f[0], 322 - h + f[1]];
}
export function lvl(host: GameHost, id: string) { return host.skillLevel(id) || 0; }
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// SkillDefSingle (primary 30 spirits + secondary 2 cosmic dust): the host prices one currency, so the
// summon costs 2 Cosmic Dust and takes the 30 Spirits on purchase.
function summon(name: string, tip: () => string, extra: Partial<SkillDef> = {}): SkillDef {
  return { list: 'temple', name, res: 'cosmic_dust', cost: () => 2, max: 1, icon: null, showCost: true,
    tip: () => tip() + '\n\n- Also costs 30 {spirit_icon}',
    ...extra, onBuy: (h, L) => { h.spend('spirits', Math.min(30, h.res('spirits'))); if (extra.onBuy) extra.onBuy(h, L); } };
}
function upgrade(name: string, unlock: string, tip: () => string): SkillDef {   // SkillDefScaling 1 * 1^L, max 100
  return { list: 'temple', name, res: 'cosmic_dust', cost: () => 1, max: 100, icon: null, unlock, showLevel: true, tip };
}

interface Spirit { x: number; y: number; vx: number; vy: number; wave: boolean; speed: number; dest: string; cyc: number; amp: number; delay: number; t: number; }
interface Fx { x: number; y: number; t: number; img: string; frames: number; fw: number; fh: number; dur: number; }

class TempleModule implements GameModule {
  id = 'temple';
  unlockTower = 9;
  nav = { label: 'Temple' };
  resources = [{ id: 'cosmic_dust', icon: 'cosmic_dust', name: 'Cosmic Dust' }];
  host!: GameHost;

  // TempleExp
  level = 0; xp = 0; builtUp = 0;
  // TempleSpeedUpManager
  speedMult = 1; speedTimer = 0;
  // TempleAnimation: per-master alpha (spirits fade a master in), spirits in flight
  alpha: Record<string, number> = { tome_master: 0, forest_keeper: 0, dragon_queen: 0, smith_master: 0 };
  spirits: Spirit[] = []; fx: Fx[] = [];
  t = 0;
  // Tome Master
  knowledge: { x: number; y: number; amp: number; age: number; time: number }[] = []; kTimer = 0; kSpawn = 0; kRing = 0; pulse = 0;
  // Smith Master
  hammerTimer = 2.5; swing = -1;
  // Forest Keeper
  logs: { x: number; y: number; vx: number; vy: number }[] = []; logTimer = 0;
  // Dragon Queen
  qTimer = 0; qOrb: { x: number; y: number; vx: number; vy: number; amount: number } | null = null;
  indicators: { x: number; y: number; t: number; text: string; icon: string }[] = [];

  skills: Record<string, SkillDef> = {
    summon_tome_master: summon('Summon Tome Master',
      () => 'The Tome Master soaks up all new {knowledge_icon} and doubles it\n\n- With no new prestige points waiting, each pulse also fills the damage prestige bar by 0.5%.',
      { onBuy: () => this.summonAnim('tome_master') }),
    summon_forest_keeper: summon('Summon Forest Keeper',
      () => 'The Forest Keeper blesses each log for 300% more {wood_icon}\n\n- {cosmic_dust_icon} also gathers 50% faster',
      { onBuy: () => this.summonAnim('forest_keeper') }),
    summon_dragon_queen: summon('Summon Dragon Queen',
      () => 'The Dragon Queen trains the Dragon at 200% of all Dragon Keepers together.\n\n- Every Dragon Fireball also splits in two.',
      { onBuy: () => { this.summonAnim('dragon_queen'); this.syncQueen(); } }),
    summon_astrologer: summon('Summon Astrologer',
      () => 'Builds the Observatory\n\n- The Astrologer watches the Cosmic Wall for weak spots and a way to break it.',
      { onBuy: () => { const o: any = this.host.modules['observatory']; if (o && o.build) o.build(); } }),
    summon_smith_master: summon('Summon Smith Master',
      () => 'The Smith Master hammers {blank_rune_icon} as hard as every Rune Smith together.\n\n- {magic_gold_icon} is also made twice as fast',
      { onBuy: () => this.summonAnim('smith_master') }),
    upgrade_tome_master: upgrade('Upgrade Tome Master', 'summon_tome_master',
      () => 'The Tome Master multiplies {knowledge_icon} by another 40% each'),
    upgrade_forest_keeper: upgrade('Upgrade Forest Keeper', 'summon_forest_keeper',
      () => 'Multiplies {wood_icon} income by another 50% each\n\n- {cosmic_dust_icon} also gathers another 15% faster each'),
    upgrade_dragon_queen: upgrade('Upgrade Dragon Queen', 'summon_dragon_queen',
      () => 'The Dragon Queen gives another 45% more EXP each'),
    upgrade_smith_master: upgrade('Upgrade Smith Master', 'summon_smith_master',
      () => "The Smith hits another 40% harder each\n\n- {magic_gold_icon} is also made another 30% faster each"),
  };

  init(host: GameHost) {
    this.host = host;
    for (const a of ['temple_outline', 'temple_spirits', 'temple_spirit_sparkes', 'tome_master', 'tomes', 'tomes_2', 'tomes_3', 'knowledge',
      'knowledge_pulse', 'forest_keeper', 'forest_keeper_portal', 'portal', 'enhanced_wood', 'dragon_queen', 'dragon_queen_cast',
      'dragon_queen_exp', 'hammer', 'rune_master', 'smith_master_spark', 'cosmic_dust']) host.D.has(a);   // art is lazy: prefetch
    // TempleExp._on_damaged: only counts once the Temple tower stands
    const siege: any = host.modules['siege'];
    if (siege && siege.onDamage) siege.onDamage((dmg: number) => this.onWallDamage(dmg));
  }

  /** Wall damage hook (siege calls this, or other modules can forward damage here). */
  onWallDamage(finalDamage: number) {
    if (!this.host || this.host.towerLevel() < 9 || !(finalDamage > 0)) return;
    this.builtUp += finalDamage / TEMPLE_TUNING.dmgPerExp;
  }

  // ---------------------------------------------------------------- TempleExp
  cap(level = this.level) { return 3.5 * Math.pow(1.23, Math.pow(level, 1.03)); }
  expBonus() {
    const h = this.host;
    let fk = 1;
    if (lvl(h, 'summon_forest_keeper') > 0) fk = 1.5 * Math.pow(1.15, lvl(h, 'upgrade_forest_keeper'));
    let cd = 1;   // Warden enchantments (siege's skills): +50% each
    for (const e of ['enchant_molten', 'enchant_frost', 'enchant_shatter']) if (lvl(h, e) > 0) cd *= 1.5;
    return fk * cd;
  }
  addExpInstantly(raw: number) {
    let gain = this.expBonus() * raw, guard = 0;
    while (gain > 0 && guard++ < 1000) {
      const toCap = Math.min(gain, this.cap() - this.xp);
      this.xp += toCap; gain -= toCap;
      if (this.xp >= this.cap() - 1e-9) { this.xp = 0; this.level++; this.host.addResource('cosmic_dust', 1); this.dustGained(); }
    }
  }
  private dustGained() {
    const p = anchorOf(this.host, 'temple');
    if (p) this.indicators.push({ x: p[0], y: p[1] - 30, t: 0, text: '+1', icon: 'cosmic_dust' });
  }
  speed() { return this.speedMult; }

  // ---------------------------------------------------------------- positions
  templePos() { const p = anchorOf(this.host, 'temple'); return p ? [p[0], p[1] - 29] : null; }   // TemplePosition (0,-29)
  tomeMasterPos(): [number, number] | null { const s = anchorOf(this.host, 'study'); return s ? [s[0] + 100, s[1]] : null; }
  islandPos(): [number, number] | null {   // Forest.get_island_position: forestry portal + 177
    const i = this.host.towerAnchor('island'); if (i) return i;
    const p = anchorOf(this.host, 'portal'); return p ? [142, p[1] + 177] : null;
  }
  keeperPos(): [number, number] | null { const i = this.islandPos(); return i ? [i[0] - 104 - 1, i[1] - 131 + 33] : null; }   // ForestKeeperVisuals/Float
  keeperPortalPos(): [number, number] | null { const k = this.keeperPos(); return k ? [k[0], k[1] - 40] : null; }
  queenPos(): [number, number] | null {
    const d: any = this.host.modules['dragons'];
    const n: [number, number] | null = d && d.nestPos ? d.nestPos() : null;
    return n ? [n[0] + 12, n[1] - 83] : null;
  }
  queenTarget(): [number, number] | null {   // DragonKeeperSimulation/DragonExpPosition
    const d: any = this.host.modules['dragons'];
    if (d && d.queenTarget) return d.queenTarget();
    const n: [number, number] | null = d && d.nestPos ? d.nestPos() : null;
    return n ? [n[0], n[1] + 25] : null;   // keeper origin (0, 26) + DragonExpPosition (0, -1)
  }
  anvilPos(): [number, number] | null { const o = anchorOf(this.host, 'obeliskPos'); return o ? [o[0] + 1, o[1] - 65] : null; }
  smithPos(): [number, number] | null { const a = this.anvilPos(); return a ? [a[0] + 26, a[1] - 17] : null; }
  destPos(dest: string) {
    if (dest === 'tome_master') return this.tomeMasterPos();
    if (dest === 'forest_keeper') return this.keeperPos();
    if (dest === 'dragon_queen') return this.queenPos();
    return this.smithPos();
  }
  owned(dest: string) { return lvl(this.host, 'summon_' + dest) > 0; }
  shown(dest: string) { return this.owned(dest) && this.destPos(dest) !== null; }

  // ---------------------------------------------------------------- summon animation (TempleAnimation.do_animation)
  summonAnim(dest: string) {
    const o = this.templePos();
    if (!o || !this.destPos(dest)) { this.alpha[dest] = 1; return; }
    this.alpha[dest] = 0;
    for (let i = 0; i < 30; i++) {
      this.spirits.push({ x: o[0], y: o[1], vx: 0, vy: 0, wave: true, speed: rand(150, 200), dest, cyc: Math.random() < 0.5 ? 0 : Math.PI,
        amp: rand(22.5, 45), delay: rand(0, 0.5), t: 0 });
    }
    this.host.play('summon', -5);
    const d = this.destPos(dest)!; this.host.camFocus((o[0] + d[0]) / 2, (o[1] + d[1]) / 2);
  }
  private updateSpirits(dt: number) {
    const start = this.templePos(); if (!start) return;
    const decay = Math.pow(0.2, dt);
    for (let i = this.spirits.length - 1; i >= 0; i--) {
      const s = this.spirits[i]; s.t += dt;
      const dtm = s.t - s.delay; if (dtm <= 0) continue;
      const d = this.destPos(s.dest); if (!d) { this.spirits.splice(i, 1); continue; }
      if (s.wave) {
        const dx = d[0] - start[0], dy = d[1] - start[1], dist = Math.hypot(dx, dy) || 1, nx = dx / dist, ny = dy / dist;
        const k = Math.min(dtm * s.speed / dist, 1), w = Math.sin(dtm * 0.5 * Math.PI * 2 + s.cyc) * s.amp;
        s.x = start[0] + dx * k - ny * w; s.y = start[1] + dy * k + nx * w;
        if (Math.hypot(d[0] - s.x, d[1] - s.y) <= 50) {
          s.wave = false; const l = Math.hypot(d[0] - s.x, d[1] - s.y) || 1;
          s.vx = (d[0] - s.x) / l * s.speed; s.vy = (d[1] - s.y) / l * s.speed;
        }
      } else {
        const l = Math.hypot(d[0] - s.x, d[1] - s.y) || 1;
        s.vx += (d[0] - s.x) / l * 200 * dt; s.vy += (d[1] - s.y) / l * 200 * dt;
        const sp = Math.hypot(s.vx, s.vy); if (sp > 200) { s.vx *= 200 / sp; s.vy *= 200 / sp; }
        s.vx *= decay; s.vy *= decay;
        s.x += s.vx * dt; s.y += s.vy * dt;
        if (Math.hypot(d[0] - s.x, d[1] - s.y) <= 10) {
          this.spirits.splice(i, 1);
          this.alpha[s.dest] = Math.min(1, this.alpha[s.dest] + 0.05);
          this.fx.push({ x: s.x, y: s.y, t: 0, img: 'temple_spirit_sparkes', frames: 2, fw: 5, fh: 5, dur: 0.3 });
        }
      }
    }
  }

  // ---------------------------------------------------------------- update
  update(dt: number) {
    const h = this.host; this.t += dt;
    if (this.speedTimer > 0) { this.speedTimer -= dt; if (this.speedTimer <= 0) this.speedMult = 1; }
    // TempleExp.update_exp: built-up exp drains in at lerp(delta * 2)
    if (this.builtUp > 1e-12) {
      const remaining = Math.min(Math.max(this.builtUp + (0 - this.builtUp) * Math.min(dt * 2, 1), 0), this.builtUp);
      this.addExpInstantly(this.builtUp - remaining); this.builtUp = remaining;
    } else this.builtUp = 0;

    this.updateSpirits(dt);
    // a master owned without a summon in flight (load, dev grants) is simply there; 30 arrivals x 0.05 also end at 1
    for (const k in this.alpha) if (this.owned(k) && this.alpha[k] < 1 && !this.spirits.some(s => s.dest === k)) this.alpha[k] = 1;
    const sp = this.speed();
    if (this.owned('tome_master')) this.updateTome(dt, sp);
    if (this.owned('smith_master')) this.updateSmith(dt, sp);
    if (this.owned('forest_keeper')) this.updateKeeper(dt);
    if (this.owned('dragon_queen')) this.updateQueen(dt, sp);
    for (let i = this.fx.length - 1; i >= 0; i--) if ((this.fx[i].t += dt) >= this.fx[i].dur) this.fx.splice(i, 1);
    for (let i = this.indicators.length - 1; i >= 0; i--) if ((this.indicators[i].t += dt) >= 0.8) this.indicators.splice(i, 1);
    void h;
  }

  // TomeMaster: study knowledge flies to the master in a sine arc; every 3 s (temple speed) it pulses it out amplified.
  // The economic effect (x2 x 1.4^upgrades on knowledge) is in multipliers(); this is the visible absorb/pulse loop.
  private updateTome(dt: number, sp: number) {
    const from = anchorOf(this.host, 'study'), to = this.tomeMasterPos(); if (!from || !to) return;
    this.kSpawn -= dt;
    if (this.kSpawn <= 0) {
      this.kSpawn = rand(0.15, 0.45);
      const amp = rand(-25, 25);
      this.knowledge.push({ x: from[0], y: from[1], amp, age: 0, time: (Math.abs(amp) + 50) / 50 * 0.5 });
    }
    const wl = to[0] - from[0];
    for (let i = this.knowledge.length - 1; i >= 0; i--) {
      const k = this.knowledge[i];
      if (k.age >= k.time) { this.knowledge.splice(i, 1); this.kRing++; continue; }
      k.age += dt;
      k.x = from[0] + Math.min(k.age * wl / k.time, wl); k.y = from[1] + k.amp * Math.sin(k.age * Math.PI / k.time);
    }
    this.kTimer += dt * sp;
    if (this.kTimer >= TEMPLE_TUNING.masterPeriod) {
      this.kTimer = 0;
      if (this.kRing > 0) {
        this.fx.push({ x: to[0], y: to[1], t: 0, img: 'knowledge_pulse', frames: 4, fw: 39, fh: 39, dur: 0.4 });
        this.indicators.push({ x: to[0], y: to[1] - 8, t: 0, text: 'x' + fmtMult(2 * Math.pow(1.4, lvl(this.host, 'upgrade_tome_master'))), icon: 'knowledge_icon' });
        this.host.play('zephyr', -8, 0.5);
      }
      this.kRing = 0; this.pulse = 0.4;
      // TomeMaster.increase_damage_prestige: with no prestige points yet, +0.5% of the damage-prestige bar per pulse
      const pr: any = this.host.modules['prestige'];
      if (pr && pr.addDamageExpPercent && !(pr.points && pr.points() > 0)) pr.addDamageExpPercent(0.5);
    }
    if (this.pulse > 0) this.pulse -= dt;
  }

  // SmithMaster: every 3 s / speed the spirit hammer swings down onto the anvil (1 s ease-in-back), then back (2 s)
  private updateSmith(dt: number, sp: number) {
    this.hammerTimer += dt * sp;
    if (this.swing >= 0) {
      const prev = this.swing; this.swing += dt * sp;
      if (prev < 1 && this.swing >= 1) this.strike();
      if (this.swing >= 3) this.swing = -1;
    }
    if (this.hammerTimer >= TEMPLE_TUNING.masterPeriod) { this.hammerTimer = 0; this.swing = 0; }
  }
  private strike() {
    const a = this.anvilPos(); if (a) this.fx.push({ x: a[0] - 1, y: a[1] - 10, t: 0, img: 'smith_master_spark', frames: 3, fw: 17, fh: 7, dur: 0.3 });
    const runes: any = this.host.modules['runes'];
    const bonus = Math.pow(1.4, lvl(this.host, 'upgrade_smith_master'));
    const amount = lvl(this.host, 'summon_rune_smith') * bonus;
    if (runes && runes.addExp && amount > 0) runes.addExp(amount);
    this.host.play('runesmith', -10, 0.2);
  }

  // ForestKeeper: enhanced logs leave the keeper's portal in a ballistic arc into the forestry portal
  private updateKeeper(dt: number) {
    const from = this.keeperPortalPos(), to = anchorOf(this.host, 'portal'); if (!from || !to) return;
    this.logTimer -= dt;
    if (this.logTimer <= 0) {
      this.logTimer = rand(0.6, 1.2);
      // Utils.calculate_angle: lowest speed (35 px/s steps) whose 45-ish arc reaches the target under gravity 980
      const dx = to[0] - from[0], dy = to[1] - from[1], g = 980;
      let v = 0, ang = 0;
      for (let s = 35; s < 5000; s += 35) {
        const s2 = s * s, disc = s2 * s2 - g * (g * dx * dx - 2 * dy * s2);   // y down
        if (disc >= 0) { v = s; ang = Math.atan((s2 - Math.sqrt(disc)) / (g * Math.abs(dx))); break; }
      }
      if (v > 0) this.logs.push({ x: from[0], y: from[1], vx: Math.sign(dx || 1) * v * Math.cos(ang), vy: -v * Math.sin(ang) });
    }
    for (let i = this.logs.length - 1; i >= 0; i--) {
      const l = this.logs[i], ny = l.vy + 980 * dt;
      l.x += l.vx * dt; l.y += (l.vy + ny) * dt / 2; l.vy = ny;
      if ((l.vx >= 0 && l.x >= to[0]) || (l.vx < 0 && l.x <= to[0]) || l.y > to[1] + 400) {
        this.logs.splice(i, 1);
        this.indicators.push({ x: to[0] + rand(-8, 8), y: to[1] + rand(-16, 0), t: 0, text: 'x' + fmtMult(4 * Math.pow(1.5, lvl(this.host, 'upgrade_forest_keeper'))), icon: 'wood_icon' });
        this.host.play('wood', -13, 0.3);
      }
    }
    if (this.indicators.length > 12) this.indicators.splice(0, this.indicators.length - 12);
  }

  // DragonQueen: every 3 s (temple speed) she sends 200% of the keepers' exp to the dragon
  private updateQueen(dt: number, sp: number) {
    this.qTimer += dt * sp;
    if (this.qTimer > TEMPLE_TUNING.masterPeriod) {
      this.qTimer = 0;
      const q = this.queenPos(), d: any = this.host.modules['dragons'];
      const keepers = d && d.keeperCount ? d.keeperCount() : lvl(this.host, 'summon_dragon_keeper');
      if (q) this.qOrb = { x: q[0] - 4, y: q[1] - 9, vx: 0, vy: 0, amount: 2 * keepers * Math.pow(1.45, lvl(this.host, 'upgrade_dragon_queen')) };
    }
    const o = this.qOrb, tgt = this.queenTarget();
    if (!o || !tgt) return;
    const l = Math.hypot(tgt[0] - o.x, tgt[1] - o.y) || 1;
    o.vx += (tgt[0] - o.x) / l * 200 * dt; o.vy += (tgt[1] - o.y) / l * 200 * dt;
    o.x += o.vx * dt; o.y += o.vy * dt;
    if (Math.hypot(tgt[0] - o.x, tgt[1] - o.y) < 10) {
      const d: any = this.host.modules['dragons'];
      if (d && d.addExp && o.amount > 0) d.addExp(o.amount);
      this.host.play('dragon_exp', -6, 0.2);
      this.qOrb = null;
    }
  }
  onTowerBuilt() { this.syncQueen(); }
  syncQueen() { const d: any = this.host && this.host.modules['dragons']; if (d && d.setQueen) d.setQueen(lvl(this.host, 'summon_dragon_queen') > 0); }

  // ---------------------------------------------------------------- input (TempleArea: 50x63 rect)
  hitWorld(wx: number, wy: number) {
    const p = anchorOf(this.host, 'temple');
    return !!p && Math.abs(wx - p[0]) <= 25 && Math.abs(wy - (p[1] + 0.5)) <= 31.5;
  }
  onHold() { this.speedMult = TEMPLE_TUNING.speedUp; this.speedTimer = TEMPLE_TUNING.speedUpTime; }
  worldFocus(): [number, number] { return anchorOf(this.host, 'temple') || this.host.orbPos(); }

  multipliers(): Multipliers {
    const h = this.host; if (!h) return {};
    const m: Multipliers = {};
    if (lvl(h, 'summon_tome_master') > 0) m.knowledge = 2 * Math.pow(1.4, lvl(h, 'upgrade_tome_master'));
    if (lvl(h, 'summon_forest_keeper') > 0) m.wood = 4 * Math.pow(1.5, lvl(h, 'upgrade_forest_keeper'));
    // AlchemyUI: smith master multiplier = 1 + 100% * 1.3^upgrades on Magic Gold production speed
    if (lvl(h, 'summon_smith_master') > 0) m.magic_gold = 1 + 1.0 * Math.pow(1.3, lvl(h, 'upgrade_smith_master'));
    return m;
  }

  // ---------------------------------------------------------------- drawing
  drawWorld(D: PixelDraw) {
    const h = this.host;
    if (h.towerLevel() >= 9 && h.S.activeArea === 'temple') {   // TempleArea outline while open
      const p = anchorOf(h, 'temple');
      if (p) { const [w, hh] = D.size('temple_outline'); D.img('temple_outline', Math.round(p[0] - w / 2 + 0.5), Math.round(p[1] - hh / 2 + 0.5)); }
    }
    const bob = (speed: number, amp: number, ph = 0) => amp * Math.sin(this.t * speed + ph);
    // Tome Master + three floating tome stacks + absorbed knowledge
    const tm = this.tomeMasterPos();
    if (tm && this.owned('tome_master')) {
      const a = this.alpha.tome_master;
      D.img('tomes', Math.round(tm[0] + 8 - 3.5), Math.round(tm[1] - 18 - 3 + bob(1.2, 3)), { alpha: a });
      D.img('tomes_2', Math.round(tm[0] + 17 - 3.5), Math.round(tm[1] - 4 + bob(1.3, 4, 1)), { alpha: a });
      D.img('tomes_3', Math.round(tm[0] + 11 - 3.5), Math.round(tm[1] + 17 - 2.5 + bob(1.5, 4, 2)), { alpha: a });
      const my = tm[1] + bob(1, 1);
      D.img('tome_master', Math.round(tm[0] - 4.5), Math.round(my - 7.5), { alpha: a });
      for (let i = 0; i < Math.min(this.kRing, 48); i++) {   // Knowledges: rings of 16 around the master
        const ring = Math.floor(i / (16 + 0.1 * i)), r = (ring + 1) * 4 + 8, an = 2 * Math.PI * (i % 16) / 16 + this.t * (0.8 + ring * 0.2) * (i % 2 ? 1 : -1);
        D.img('knowledge', Math.round(tm[0] + r * Math.cos(an) - 1.5), Math.round(my + r * Math.sin(an) - 1.5), { alpha: a });
      }
      for (const k of this.knowledge) D.img('knowledge', Math.round(k.x - 1.5), Math.round(k.y - 1.5));
    }
    // Forest Keeper (ForestKeeperVisuals): its portal pillar, the keeper floating below a swirling portal
    const fk = this.keeperPos();
    if (fk && this.owned('forest_keeper')) {
      const a = this.alpha.forest_keeper, ky = fk[1] + bob(1, 2);
      const [pw, ph] = D.size('forest_keeper_portal');
      D.img('forest_keeper_portal', Math.round(fk[0] - pw / 2), Math.round(fk[1] - 47 + bob(1, 1) - ph / 2), { alpha: a });
      D.img('forest_keeper', Math.round(fk[0] - 7.5), Math.round(ky - 10), { alpha: a });
      const fr = Math.floor(this.t * 12) % 8;
      D.part('portal', fr * 9, 0, 9, 27, Math.round(fk[0] - 4.5), Math.round(ky - 40 - 13.5), 9, 27, { alpha: a, flipX: true });
      if (a >= 1) for (const l of this.logs) D.img('enhanced_wood', Math.round(l.x - 3.5), Math.round(l.y - 1.5));
    }
    // Dragon Queen (casts while sending exp)
    const q = this.queenPos();
    if (q && this.owned('dragon_queen')) {
      const cast = this.qTimer > TEMPLE_TUNING.masterPeriod * 0.7 || this.qOrb !== null;
      D.img(cast ? 'dragon_queen_cast' : 'dragon_queen', Math.round(q[0] - 13), Math.round(q[1] - 9 + bob(1, 1)), { alpha: this.alpha.dragon_queen });
      if (this.qOrb) D.img('dragon_queen_exp', Math.round(this.qOrb.x), Math.round(this.qOrb.y));
    }
    // Smith Master beside the anvil: body rocks PI/8 -> -PI/4, hammer swings PI -> -PI/2 (ease-in-back) and back
    const sm = this.smithPos();
    if (sm && this.owned('smith_master') && h.towerLevel() >= 8) {
      const a = this.alpha.smith_master;
      let hr = Math.PI, br = Math.PI / 8;
      if (this.swing >= 0) {
        if (this.swing < 1) { const k = easeInBack(this.swing); hr = Math.PI + (-Math.PI / 2 - Math.PI) * k; br = Math.PI / 8 + (-Math.PI / 4 - Math.PI / 8) * easeInOutCubic(this.swing); }
        else { const k = easeOutBack((this.swing - 1) / 2); hr = -Math.PI / 2 + (Math.PI + Math.PI / 2) * k; br = -Math.PI / 4 + (Math.PI / 8 + Math.PI / 4) * easeInOutCubic((this.swing - 1) / 2); }
      }
      const piv = h.toScreen(sm[0], sm[1]);
      const [hw, hh] = D.size('hammer');
      D.img('hammer', Math.round(sm[0] - hw / 2), Math.round(sm[1] - 15 - hh / 2), { alpha: a * 0.85, rot: hr, pivot: piv });
      const [rw, rh] = D.size('rune_master');
      D.img('rune_master', Math.round(sm[0] - rw / 2), Math.round(sm[1] - rh / 2), { alpha: a, rot: br, pivot: piv });
    }
    // summon spirits + sparkles
    for (const s of this.spirits) if (s.t > s.delay) D.img('temple_spirits', Math.round(s.x - 1.5), Math.round(s.y - 1.5));
    for (const f of this.fx) {
      const fr = Math.min(f.frames - 1, Math.floor(f.t / f.dur * f.frames));
      D.part(f.img, fr * f.fw, 0, f.fw, f.fh, Math.round(f.x - f.fw / 2), Math.round(f.y - f.fh / 2), f.fw, f.fh);
    }
    for (const ind of this.indicators) {
      const k = 1 - Math.pow(1 - Math.min(ind.t / 0.4, 1), 3), y = ind.y - 16 * k;
      D.img(ind.icon, Math.round(ind.x - 12), Math.round(y - 5), { alpha: 1 - Math.max(0, ind.t - 0.5) / 0.3, scale: 0.5 });
      D.text(ind.text, Math.round(ind.x), Math.round(y - 5), '#ffffff', 10, 'left', { scale: 0.5 });
    }
  }

  drawPanel(D: PixelDraw) {
    const h = this.host, listW = 200, barH = 34;
    const listH = h.skillListHeight('temple'), total = barH + 2 + listH;
    const r = h.panelRect(listW, total);
    // TempleExp: "Cosmic Dust EXP" bar
    D.nine('panel', r.x, r.y, listW, barH);
    D.img('cosmic_dust', r.x + 5, r.y + 5);
    D.text('Cosmic Dust EXP', r.x + 18, r.y + 5, '#ffffff');
    D.text(fmtNum(h.res('cosmic_dust')), r.x + listW - 6 - D.textW(fmtNum(h.res('cosmic_dust'))), r.y + 5, '#fe6cee');
    h.progressBar(r.x + 6, r.y + 20, listW - 12, 8, this.xp / this.cap());
    h.drawSkillList('temple', 'Temple', r.x, r.y + barH + 2, listW);
    return { x: r.x, y: r.y, w: listW, h: total };
  }

  save() {
    return { level: this.level, xp: this.xp, builtUp: this.builtUp };
  }
  load(d: any) {
    if (!d) return;
    this.level = d.level || 0; this.xp = d.xp || 0; this.builtUp = d.builtUp || 0;
    for (const k in this.alpha) this.alpha[k] = this.owned(k) ? 1 : 0;
    this.spirits = []; this.syncQueen();
  }
  reset(keepPermanent: boolean) {
    this.level = 0; this.xp = 0; this.builtUp = 0; this.spirits = []; this.knowledge = []; this.logs = []; this.qOrb = null;
    for (const k in this.alpha) this.alpha[k] = 0;
    const d: any = this.host && this.host.modules['dragons']; if (d && d.setQueen) d.setQueen(0);
    void keepPermanent;
  }

  debug = {
    'Temple: +50 Cosmic Dust': () => this.host.addResource('cosmic_dust', 50),
    'Temple: wall damage burst': () => this.onWallDamage(TEMPLE_TUNING.dmgPerExp * 200),
    'Temple: summon all masters': () => this.debugSummonAll(),
    'Temple: max master upgrades': () => { for (const k of ['upgrade_tome_master', 'upgrade_forest_keeper', 'upgrade_dragon_queen', 'upgrade_smith_master']) this.setSkill(k, 10); },
  };
  private setSkill(id: string, v: number) { const s = this.host.S; if (s && s.skills) s.skills[id] = v; }
  private debugSummonAll() {
    for (const k of ['tome_master', 'forest_keeper', 'dragon_queen', 'smith_master']) {
      if (this.owned(k)) continue;
      this.setSkill('summon_' + k, 1); this.summonAnim(k);
    }
    this.syncQueen();
  }
}

function easeInBack(x: number) { const c1 = 1.70158, c3 = c1 + 1; return c3 * x * x * x - c1 * x * x; }
function easeOutBack(x: number) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
function easeInOutCubic(x: number) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
function fmtMult(v: number) { return v >= 100 ? fmtNum(v) : (Math.round(v * 10) / 10).toString(); }
export function fmtNum(v: number) {
  if (v < 1000) return Math.floor(v).toString();
  const u = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  let i = -1; while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return (v >= 100 ? Math.floor(v) : Math.floor(v * 10) / 10) + u[i];
}

registerModule(new TempleModule());
