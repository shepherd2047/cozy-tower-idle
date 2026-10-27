// Sorcery (tower 7): Gorgons, Shamans, Ifrits, Zephyrs and Combat Magic attacking the wall above the tower.
// Port of Units.gd, Gorgons.gd, Shamans.gd, Ifrits.gd, Zephyrs.gd, WallCurse.gd, DamageChart.gd / DamageBar.gd.
// The wall itself (HP, multipliers, status storage + decay, damage numbers, cracks) belongs to the siege module:
//   siege.damage(amount, sourceId, wx, wy, opts?) -> final damage, siege.addStatus(id, stacks), siege.statusStacks(id),
//   siege.targetable(), siege.wallPos() -> [x, bottomY]. Without a siege module a local stand-in wall is used so the
//   units can still be shown off (same rules as Wall.gd, numbers drawn here).
// Cross-module reads (all optional): runes.runeLevel(id), prestige.blessingLevel(id), alchemy.relicLevel(id),
// dragons.abilityLevel('fireballs'), host.totemCounts(). Every damage hit is fed to the chart via onWallDamaged().
import { registerModule, GameHost, GameModule, SkillDef, Multipliers } from '../GameModule';
import type { PixelDraw, DrawOpts } from '../PixelDraw';

type UnitType = 'gorgon' | 'shaman' | 'ifrit' | 'zephyr';
interface Unit { x: number; y: number; dir: number; spd: number; vy: number; aura: number; cast: number }
// petrification / wisp (gorgon), arrow / fire / ice (shaman), fireball (ifrit), wind (zephyr)
interface Shot { k: 'petri' | 'wisp' | 'arrow' | 'fire' | 'ice' | 'fireball' | 'wind'; x: number; y: number; vx: number; vy: number; g: number }
interface Bolt { x: number; y: number; t: number; second: boolean }
interface Fx { x: number; y: number; type: string; t: number; life: number }
interface Num { x: number; y: number; text: string; t: number; time: number; dy: number }

const UNITS: Record<UnitType, { skill: string; img: string; dist: number }> = {   // ideal_distance_from_wall
  gorgon: { skill: 'summon_gorgon', img: 'gorgon', dist: 30 },
  shaman: { skill: 'summon_shaman', img: 'shaman', dist: 50 },
  ifrit: { skill: 'summon_ifrit', img: 'ifrit', dist: 70 },
  zephyr: { skill: 'summon_zephyr', img: 'zephyr', dist: 90 },
};
const TYPES: UnitType[] = ['zephyr', 'ifrit', 'shaman', 'gorgon'];   // scene order in current_run.tscn (Units node)
const MAX_SIM = 60;
// Lightning.gd children of tower_6..9.tscn (relative to the tower image) and the portal's frame sequence (12 fps)
const LIGHTNING_DECOR: [number, number][] = [[51, 700], [32, 544], [16, 376], [16, 244], [31, 129]];
const PREFETCH = ['gorgon', 'gorgon_aura', 'petrification', 'wisp', 'shaman', 'shaman_cast', 'shaman_arrow', 'fire_arrow', 'ice_arrow', 'ifrit', 'fireball',
  'zephyr', 'wind', 'lightning_0', 'lightning_1', 'lightning_2', 'lightning_3', 'lightning_4', 'lightning_5', 'sorcery_portal', 'sorcery_outline',
  'damage_impact', 'arc_effect', 'sound_pulse', 'magic_material_particle', 'curse', 'curse_animation', 'curse_animation_fire',
  'weakend_icon', 'cursed_icon', 'molten_icon', 'frost', 'resonance', 'spirit_sage', 'shrapnel', 'dragon_bond', 'wall_health_icon'];
const PORTAL_FRAMES = [0, -1, -1, -1, 1, -1, -1, -1, -1, -1, 2, ...new Array(34).fill(-1)];          // simulated/drawn units per type; extra summons scale each hit instead (same throughput)
const LINE_LIFE = 0.1;       // Units.SORCERY_LINE_LIFETIME
const META = {
  gorgonBase: 3, gorgonPerOuroboros: 3, shamanBase: 1, ifritBase: 2, ifritPer10Fireballs: 2,
  zephyrBaseStacks: 2, zephyrExtraStacks: 1, zephyrThreshold: 60, combatPct: 50,
  infinityPct: 30, curseMult: 4, fireMoltenPct: 3, gorgonBlessPct: 100, gorgonBlessEvery: 200, effectsDecay: 75, midwayPct: 50,
};
// visual_effects.tres animations used by sorcery
const FX: Record<string, { img: string; fw: number; frames: number; fps: number }> = {
  damage_impact: { img: 'damage_impact', fw: 5, frames: 2, fps: 9 },
  arc: { img: 'arc_effect', fw: 5, frames: 2, fps: 9 },
  pulse: { img: 'sound_pulse', fw: 39, frames: 4, fps: 9 },
  spawn: { img: 'magic_material_particle', fw: 7, frames: 3, fps: 12 },
};
// data/damage_sources/*.tres (chart rows) and data/status_effects/*.tres
export const DAMAGE_SOURCES: { id: string; name: string; icon: string; desc: string }[] = [
  { id: 'gorgon', name: 'Gorgon', icon: 'gorgon', desc: 'Gorgons petrify the wall.' },
  { id: 'shaman', name: 'Shaman', icon: 'shaman', desc: 'Shamans shoot arrows at the wall.' },
  { id: 'curse', name: 'Curse', icon: 'curse', desc: 'At 100 Cursed stacks, deals damage equal to 4x all Shamans combined.' },
  { id: 'ifrit', name: 'Ifrit', icon: 'ifrit', desc: 'Ifrits hurl fireballs at the wall.' },
  { id: 'zephyr', name: 'Lightning', icon: 'zephyr', desc: 'Zephyrs sometimes call down Lightning.' },
  { id: 'fire_arrows', name: 'Fire Arrows', icon: 'fire_arrow', desc: 'Shamans shoot fire arrows.' },
  { id: 'ice_arrows', name: 'Ice Arrows', icon: 'ice_arrow', desc: 'Ice arrows hit as hard as 3 Gorgons.' },
  { id: 'spirit_sage', name: 'Spirit Sage', icon: 'spirit_sage', desc: 'Spirit Sages deal damage to the wall.' },
  { id: 'fireball_shrapnel', name: 'Fireball Shrapnel', icon: 'shrapnel', desc: 'Dragon fireballs explode into Shrapnel.' },
  { id: 'dragon', name: 'Dragon', icon: 'dragon_bond', desc: 'Dragon fireballs.' },
  { id: 'wall_repair', name: 'Wall Repair', icon: 'wall_health_icon', desc: 'The wall repairs itself.' },
];
export const STATUS_EFFECTS: { id: string; name: string; icon: string; desc: string }[] = [
  { id: 'weakened', name: 'Weakened', icon: 'weakend_icon', desc: 'Each stack makes the wall take 1% more damage' },
  { id: 'cursed', name: 'Cursed', icon: 'cursed_icon', desc: 'At 100 stacks it bursts for 4x the combined damage of every Shaman.' },
  { id: 'molten', name: 'Molten', icon: 'molten_icon', desc: 'Each stack makes Dragon Fireballs hit the wall 3% harder' },
  { id: 'frost', name: 'Frost', icon: 'frost', desc: 'Each stack delays the decay of the other status effects by 1 stack' },
  { id: 'resonance', name: 'Shatter', icon: 'resonance', desc: 'Each stack makes Dragon Fireballs and Curses hit the wall harder' },
];
const WALL_FALLBACK_HP = 2e7;      // Wall.max_healths[0], used only by the stand-in wall
const CHART_WINDOW = 60;           // DamageChart.damage_time

const rand = (a: number, b: number) => a + Math.random() * (b - a);
function fmt(n: number) {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a < 1000) return a < 10 && a % 1 ? n.toFixed(1) : String(Math.round(n));
  const u = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  let i = -1, v = a; while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return (n < 0 ? '-' : '') + (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0)) + u[i];
}

class SorceryModule implements GameModule {
  id = 'sorcery';
  unlockTower = 7;
  nav = { label: 'Sorcery' };
  private host!: GameHost;

  skills: Record<string, SkillDef> = {
    summon_gorgon: { list: 'sorcery', name: 'Summon Gorgon', res: 'spirits', cost: () => 2, max: 10000, icon: 'gorgon', summon: true, showLevel: true, unlockTower: 7,
      tip: () => `Deals ${fmt(this.gorgonBase())} base damage to the wall.\n\n- Base damage increases by ${META.gorgonPerOuroboros} for each Ouroboros you have.`,
      onBuy: () => this.sync() },
    summon_shaman: { list: 'sorcery', name: 'Summon Shaman', res: 'spirits', cost: () => 2, max: 10000, icon: 'shaman', summon: true, showLevel: true, unlockTower: 7,
      tip: () => `Deals ${META.shamanBase} base damage to the wall multiplied by the count of the Totem Type with most Totems (${this.topTotemCount()}).`,
      onBuy: () => this.sync() },
    summon_ifrit: { list: 'sorcery', name: 'Summon Ifrit', res: 'spirits', cost: () => 2, max: 10000, icon: 'ifrit', summon: true, showLevel: true, unlockTower: 7,
      tip: () => `Deals ${fmt(this.ifritBase())} base damage to the wall.\n\n- Base damage increases by ${META.ifritPer10Fireballs} every 10 Dragon's Fireball ability levels.`,
      onBuy: () => this.sync() },
    summon_zephyr: { list: 'sorcery', name: 'Summon Zephyr', res: 'spirits', cost: () => 2, max: 10000, icon: 'zephyr', summon: true, showLevel: true, unlockTower: 7,
      tip: () => `Softens the wall so everything hits it harder.\n\n- Adds ${META.zephyrBaseStacks} Weakness stacks, plus ${META.zephyrExtraStacks} more for each spirit type with at least ${META.zephyrThreshold} members.`,
      onBuy: () => this.sync() },
    combat_magic: { list: 'sorcery', name: 'Combat Magic', res: 'knowledge', cost: L => 4e8 * 2 ** L, max: 10, icon: null, showLevel: true, unlockTower: 7,
      tip: () => `All damage +${META.combatPct}%` },
  };

  // ---- simulation state
  private units: Record<UnitType, Unit[]> = { gorgon: [], shaman: [], ifrit: [], zephyr: [] };
  private shots: Shot[] = [];
  private bolts: Bolt[] = [];
  private fx: Fx[] = [];
  private nums: Num[] = [];
  private lines: { x: number; y: number; t: number }[] = [];
  private curse: { x: number; y: number; t: number; fire: boolean } | null = null;
  private float: Record<UnitType, number> = { gorgon: 0, shaman: 0, ifrit: 0, zephyr: 0 };
  private tm: Record<string, number> = { gCast: 0, gPulse: 0, gWisp: 0, sArrow: 0, sFire: 0, sIce: 0, iCast: 0, zCast: 0, zLight: 0 };
  private prev: Record<string, number> = { ...this.tm };
  private speedMult = 1; private speedT = 0; private prefetched = false;
  private decor = { t: 0, idx: 0, wait: 0.3, flash: null as { i: number; t: number } | null };
  private chargeBase = 0;                                            // Zephyrs.charge_base_damage (saved)
  private wall0 = { x: 327, y: -728 };                               // cached wall position (Wall.current_position)
  baseDamages: Record<string, number> = {};                          // BaseDamageTracker
  // stand-in wall, only when no siege module provides one
  private local = { dmg: 0, status: {} as Record<string, number>, tick: 0 };
  // DamageChart
  private age = 0;
  private buckets: Record<string, Record<number, number>> = {};
  private chartCalcT = 0;
  private chart: { total: number; rows: { id: string; v: number }[] } = { total: 0, rows: [] };
  private extFeed = false;                                           // siege calls onWallDamaged() for every hit
  private chartOpen = true; private manualOpen = false; private infoId = '';
  private panel: { x: number; y: number; w: number; h: number } | null = null;
  private tapRects: { x: number; y: number; w: number; h: number; fn: () => void }[] = [];

  init(host: GameHost) { this.host = host; }

  // ================================================================ cross-module helpers
  private get siege(): any { return this.host.modules['siege']; }
  private rune(id: string): number { const r: any = this.host.modules['runes']; return (r && r.runeLevel && r.runeLevel(id)) || 0; }
  private bless(id: string): number { const p: any = this.host.modules['prestige']; return (p && p.blessingLevel && p.blessingLevel(id)) || 0; }
  private relic(id: string): number { const a: any = this.host.modules['alchemy']; return a && a.relicLevel ? a.relicLevel(id) || 0 : this.host.res(id) || 0; }
  private lv(id: string) { return this.host.skillLevel(id) || 0; }
  /** Observatory analyze_* bonuses (observatory multipliers(): curse_damage, molten_apply, shatter_apply, weakened_apply) */
  private amult(key: string) { const m = this.host.mult ? this.host.mult(key) : 1; return m > 0 ? m : 1; }
  private targetable(): boolean {
    const s = this.siege;
    if (s && s.targetable) return !!s.targetable();
    return this.host.towerLevel() >= 7 && this.local.dmg < WALL_FALLBACK_HP;
  }
  private wallPos(): [number, number] {
    const s = this.siege;
    const p = s && s.wallPos ? s.wallPos() : null;
    if (p) return p;
    const [ox, oy] = this.host.orbPos();
    return [ox + 9, oy - 230];
  }
  private stacks(id: string): number {
    const s = this.siege;
    if (s && s.statusStacks) return s.statusStacks(id) || 0;
    return this.local.status[id] || 0;
  }
  private addStatus(id: string, n: number) {
    const s = this.siege;
    if (s && s.addStatus) s.addStatus(id, n);
    else this.local.status[id] = (this.local.status[id] || 0) + n;
    if (id === 'cursed') this.checkCurse();   // WallCurse listens to status_effect_changed: pops the moment it reaches 100
  }
  private clearStatus(id: string) {
    const s = this.siege;
    if (s && s.clearStatus) s.clearStatus(id);
    else if (s && s.addStatus) s.addStatus(id, -this.stacks(id));
    else delete this.local.status[id];
  }
  /** Wall.damage(): returns the final damage */
  private hit(amount: number, src: string, x: number, y: number, effect = 'damage_impact', skipMult = false): number {
    if (!this.targetable() || !(amount > 0)) return 0;
    const s = this.siege;
    let fin: number;
    if (s && s.damage) {
      fin = s.damage(amount, src, x, y, { skipMult, effect }) || 0;
      // siege shows the number; impact effects are ours unless siege says it draws them
      if (!s.drawsImpacts && effect) this.addFx(x, y, effect);
    } else {
      fin = skipMult ? amount : amount * this.localMult();
      this.local.dmg = Math.min(WALL_FALLBACK_HP, this.local.dmg + fin);
      this.nums.push({ x, y, text: fmt(fin), t: 0, time: this.indicatorTime(src), dy: rand(10, 20) });
      if (effect) this.addFx(x, y, effect);
    }
    if (!this.extFeed) this.record(src, fin);
    return fin;
  }
  private indicatorTime(src: string) { return src === 'gorgon' || src === 'shaman' || src === 'ifrit' || src === 'spirit_sage' ? 0.5 : src === 'curse' ? 1 : 0.8; }
  /** Wall.get_damage_multiplier (stand-in wall only; siege applies its own) */
  private localMult() {
    return (this.host.mult ? this.host.mult('damage') : 1) * (1 + this.stacks('weakened') / 100) * (1 + this.lv('combat_magic') * META.combatPct / 100) * (1 + this.bless('midway_blessing') * META.midwayPct / 100);
  }
  /** called by siege for every hit on the wall (any source); feeds the damage chart */
  onWallDamaged(src: string, final: number) { this.extFeed = true; this.record(src, final); }
  /** called by siege when the wall repairs itself (wall 1 only, shown as a chart row) */
  onWallRepaired(amount: number) { this.extFeed = true; this.record('wall_repair', amount); }
  private record(src: string, v: number) {
    if (!(v > 0)) return;
    const b = this.buckets[src] || (this.buckets[src] = {}), k = Math.floor(this.age);
    b[k] = (b[k] || 0) + v;
  }
  /** damage per minute for the last 60 s (DamageChart.last_calculated_damage), e.g. for prestige's damage bar */
  damagePerMinute() { return this.chart.total; }

  // ================================================================ formulas (ported 1:1, missing systems count as 0 / x1)
  private infinity() { return 1 + this.lv('infinity_rune_upgrade') * META.infinityPct / 100; }
  topTotemCount(): number {
    const h: any = this.host;
    const counts: Record<string, number> | null = h.totemCounts ? h.totemCounts() : h.totemCount && typeof h.totemCount === 'object' ? h.totemCount : null;
    // the pole (host.totemCounts) and the carve_*_totem levels describe the same totems; take whichever knows more
    const pole = counts ? Math.max(0, ...Object.keys(counts).map(k => +counts[k] || 0)) : 0;
    return Math.max(pole, ...['magic', 'knowledge', 'forest', 'crafting', 'sage'].map(t => this.lv(`carve_${t}_totem`)));
  }
  gorgonBase(): number {
    let d = META.gorgonBase + META.gorgonPerOuroboros * this.relic('ouroboros');
    if (this.rune('relics') > 0) d += 3 * this.rune('relics') * (this.relic('holy_grail') + this.relic('philosopher_stone'));
    const arc = this.rune('arc') > 0 ? 1 + (this.lv('summon_zephyr') + this.lv('summon_cloudling')) * this.rune('arc') / 100 : 1;
    if (this.bless('gorgon_blessing') > 0) d *= 1 + META.gorgonBlessPct * this.bless('gorgon_blessing') / 100 * Math.floor(this.stacks('weakened') / META.gorgonBlessEvery);
    const infRes = this.rune('infinity_resonance') > 0 ? 1 + 30 * this.rune('infinity_resonance') * this.lv('infinity_rune_upgrade') / 100 : 1;
    return d * this.infinity() * arc * infRes;
  }
  shamanBase(): number { return META.shamanBase * this.topTotemCount() * this.infinity(); }
  private fireArrowDamage(): number {
    const base = this.shamanBase() * 5 * this.rune('fire_arrows');
    this.baseDamages['fire_arrows'] = base;
    if (this.rune('fire_damage') > 0) return base * (1 + this.stacks('molten') * META.fireMoltenPct * Math.max(1, this.bless('blessing_of_fire')) * this.rune('fire_damage') / 100);
    return base;
  }
  private iceArrowDamage(): number { const d = this.gorgonBase() * 3 * this.rune('ice_arrow_damage'); this.baseDamages['ice_arrows'] = d; return d; }
  ifritBase(): number {
    const dr: any = this.host.modules['dragons'];
    const fireballs = dr && dr.abilityLevel ? dr.abilityLevel('fireballs') || 0 : 0;
    const alloy = this.rune('alloy') > 0 ? 1 + (this.lv('summon_gorgon') + this.lv('summon_shaman') + this.lv('summon_zephyr')) / 100 : 1;
    return (META.ifritBase + Math.floor(fireballs / 10) * META.ifritPer10Fireballs) * this.infinity() * alloy;
  }
  private moltenBonus() { return 1 + this.stacks('molten') * META.fireMoltenPct * Math.max(1, this.bless('blessing_of_fire')) / 100; }
  private zephyrDamage() { return (100 + this.chargeBase) * this.infinity(); }
  zephyrStacks(): number {
    let n = META.zephyrBaseStacks;
    const summons = ['summon_cloudling', 'summon_spirit_tome', 'summon_druid', 'summon_gorgon', 'summon_shaman', 'summon_ifrit', 'summon_zephyr',
      'summon_spirit_sage', 'summon_alchemist', 'summon_dragon_keeper', 'summon_diplomat', 'summon_rune_smith', 'summon_astrologer'];
    for (const s of summons) if (this.lv(s) >= META.zephyrThreshold) n += META.zephyrExtraStacks;
    return n * this.amult('weakened_apply');
  }
  /** WallCurse.get_base_damage */
  curseBase(): number {
    const mult = Math.max(1, this.bless('blessing_of_curses') * META.curseMult);
    return this.shamanBase() * this.lv('summon_shaman') * mult * this.amult('curse_damage');
  }
  private curseDamage(): number {
    const res = 1 + this.stacks('resonance') * this.rune('sound_pulse') / 100;
    let d = this.curseBase();
    this.baseDamages['curse'] = d;
    if (this.rune('cursed_fire') > 0) d *= this.moltenBonus() * 60 / 100;
    return d * res;
  }

  // ================================================================ units
  private count(t: UnitType) { return this.lv(UNITS[t].skill); }
  /** summon_X(): add units until the simulated count matches the skill level */
  private sync(silent = false) {
    const [wx, wy] = this.wallPos(), xr = this.xRange();
    for (const t of TYPES) {
      const arr = this.units[t], want = Math.min(MAX_SIM, this.count(t));
      while (arr.length < want) {
        const u: Unit = { x: wx + rand(-xr, xr), y: wy + UNITS[t].dist, dir: Math.random() < 0.5 ? -1 : 1, spd: rand(20, 35), vy: 0, aura: 0, cast: 0 };
        arr.push(u);
        if (!silent) {
          this.addFx(u.x, u.y, 'spawn');
          this.lines.push({ x: u.x, y: u.y, t: 0 });
        }
      }
      if (arr.length > want) arr.length = want;
    }
    if (!silent) this.host.play('summon', -6, 0.05);
  }
  /** each simulated unit stands in for this many summoned ones */
  private weight(t: UnitType) { const n = this.count(t), s = this.units[t].length; return s > 0 ? n / s : 0; }
  private xRange() { return this.host.portrait ? 110 : 350; }
  /** position inside the tower image (tower_6..9.tscn), falling back to the tower's top-left when the host has no anchor */
  private towerPoint(name: string, rel: [number, number]): [number, number] {
    const a = name ? this.host.towerAnchor(name) : null;
    if (a) return a;
    const top = this.host.towerAnchor('top'), L = Math.max(7, this.host.towerLevel()), [w, h] = this.host.D.size('tower_' + (L - 1));
    const x0 = top ? top[0] - (w || 200) / 2 : 320 - (w || 200) / 2, y0 = top ? top[1] : 322 - (h || 847);
    return [x0 + rel[0], y0 + rel[1]];
  }
  private portalPos(): [number, number] { return this.towerPoint('sorcery_portal', [41, 51]); }   // Node2D (12,34) + SorceryPortal (29,17)
  private areaPos(): [number, number] { return this.towerPoint('sorcery', [40, 71]); }           // Node2D (12,34) + SorceryArea (28,37)
  /** runes.ts calls this after Create Gorgons / Shamans / Ifrits */
  syncUnits() { this.sync(); }

  // ================================================================ update
  update(dt: number) {
    if (this.host.towerLevel() < 7) return;
    if (!this.prefetched) {   // art_orig loads lazily: ask for every sorcery sprite before it is first needed
      this.prefetched = true;
      for (const k of PREFETCH) this.host.D.has(k);
    }
    this.age += dt;
    const [wx, wy] = this.wallPos(); this.wall0.x = wx; this.wall0.y = wy;
    if (this.units.gorgon.length + this.units.shaman.length + this.units.ifrit.length + this.units.zephyr.length < TYPES.reduce((a, t) => a + Math.min(MAX_SIM, this.count(t)), 0)) this.sync(this.age < 0.5);
    this.speedT = Math.max(0, this.speedT - dt);
    if (this.speedT <= 0) this.speedMult = 1;
    const sp = this.speedMult, d = dt * sp, tgt = this.targetable();
    // cast timers (fmod(timer + delta / cast_time, 1))
    const per: Record<string, number> = { gCast: 5, gPulse: 8, gWisp: 11, sArrow: 5, sFire: 12, sIce: 15, iCast: 5, zCast: 5, zLight: 18 };
    for (const k in per) { this.prev[k] = this.tm[k]; this.tm[k] = (this.tm[k] + d / per[k]) % 1; }
    for (const t of TYPES) this.float[t] += d;

    if (tgt) {
      this.spawnRange('gCast', this.units.gorgon.length, i => this.spawnShot('gorgon', i, 'petri'));
      if (this.rune('sound_pulse') > 0) this.spawnRange('gPulse', this.units.gorgon.length, i => this.pulse(i));
      if (this.rune('wisps') > 0) this.spawnRange('gWisp', this.units.gorgon.length, i => this.spawnShot('gorgon', i, 'wisp'));
      this.spawnRange('sArrow', this.units.shaman.length, i => { this.spawnShot('shaman', i, 'arrow'); this.units.shaman[i].cast = 0.3; });
      if (this.rune('fire_arrows') > 0) this.spawnRange('sFire', this.units.shaman.length, i => this.spawnShot('shaman', i, 'fire'));
      if (this.rune('ice_arrows') > 0) this.spawnRange('sIce', this.units.shaman.length, i => this.spawnShot('shaman', i, 'ice'));
      this.spawnRange('iCast', this.units.ifrit.length, i => { this.spawnShot('ifrit', i, 'fireball'); this.units.ifrit[i].vy += 200; });
      this.spawnRange('zCast', this.units.zephyr.length, i => { this.spawnShot('zephyr', i, 'wind'); this.units.zephyr[i].vy += 250; });
      if (this.rune('zephyr_damage') > 0) this.spawnRange('zLight', this.units.zephyr.length, i => this.spawnBolt(i));
    }
    this.moveUnits(dt, sp, wx, wy, tgt);
    this.moveShots(dt, wy, tgt);
    this.updateBolts(dt);
    this.checkCurse();
    if (!this.siege || !this.siege.addStatus) this.decayLocal(dt);

    for (let i = this.fx.length - 1; i >= 0; i--) if ((this.fx[i].t += dt) >= this.fx[i].life) this.fx.splice(i, 1);
    for (let i = this.nums.length - 1; i >= 0; i--) if ((this.nums[i].t += dt) >= this.nums[i].time) this.nums.splice(i, 1);
    for (let i = this.lines.length - 1; i >= 0; i--) if ((this.lines[i].t += dt) >= LINE_LIFE) this.lines.splice(i, 1);
    if (this.curse && (this.curse.t += dt) > 0.75) this.curse = null;
    const dc = this.decor;
    if (dc.flash && (dc.flash.t += dt) >= 1 / 12) dc.flash = null;
    if ((dc.t += dt) >= dc.wait) {
      dc.t = 0; dc.flash = { i: dc.idx, t: 0 }; dc.idx = (dc.idx + 1) % LIGHTNING_DECOR.length;
      dc.wait = dc.idx === LIGHTNING_DECOR.length - 1 ? rand(4, 7) : rand(0.25, 0.5);
    }
    if ((this.chartCalcT -= dt) <= 0) { this.chartCalcT = 1; this.calcChart(); }   // DamageChart timer: every 1 s
  }
  /** units whose turn fell between the previous and the current timer value (n + 1 slots per cycle) */
  private spawnRange(key: string, n: number, fn: (i: number) => void) {
    if (!n) return;
    const size = n + 1, a = Math.floor(this.prev[key] * size), b = Math.floor(this.tm[key] * size);
    for (let i = a; i < b; i++) if (i < n) fn(i);
  }
  private spawnShot(t: UnitType, i: number, k: Shot['k']) {
    const u = this.units[t][i];
    let vx = 0, vy = -150;
    if (k === 'petri') { vy = -150 * rand(0.8, 1.2); }
    else if (k === 'wisp') { vx = rand(-100, 100); vy = 0; }
    else if (k === 'fire') { vx = -150 * Math.SQRT1_2; vy = -150 * Math.SQRT1_2; }     // Vector2.UP.rotated(-PI/4)
    else if (k === 'ice') { vx = 150 * Math.SQRT1_2; vy = -150 * Math.SQRT1_2; }
    this.shots.push({ k, x: u.x + rand(-3, 3), y: u.y + (k === 'petri' ? rand(-3, 3) : 0), vx, vy, g: i });
  }
  private pulse(i: number) {
    const u = this.units.gorgon[i];
    this.addFx(u.x + rand(-3, 3), u.y - 20, 'pulse');
    this.addStatus('resonance', this.amult('shatter_apply') * this.weight('gorgon'));
    this.host.play('gorgon', -5, 0.05);
  }
  private spawnBolt(i: number) {
    const u = this.units.zephyr[i];
    this.bolts.push({ x: u.x + rand(-3, 3), y: u.y, t: 0.05, second: false });
    this.host.play('lightning', -5, 0.05);
  }
  private moveUnits(dt: number, sp: number, wx: number, wy: number, tgt: boolean) {
    const decay = Math.pow(0.001, dt), xr = this.xRange();
    for (const t of TYPES) {
      const dist = UNITS[t].dist;
      for (const u of this.units[t]) {
        if (u.cast > 0) { u.cast -= dt * sp; if (t === 'shaman') continue; }   // shamans stand still while casting
        u.x += u.dir * u.spd * sp * dt;
        if (u.x > wx + xr) u.dir = -1; else if (u.x < wx - xr) u.dir = 1;
        const inRange = u.y < wy + dist;
        if (!inRange && tgt) u.vy -= 100 * dt * (t === 'ifrit' || t === 'zephyr' ? sp : 1);
        u.vy *= decay;
        u.y += u.vy * dt;
      }
    }
  }
  private moveShots(dt: number, wy: number, tgt: boolean) {
    const wispDecay = Math.pow(0.2, dt);
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      if (s.k === 'wisp') { s.vy -= 1200 * dt; s.vx *= wispDecay; }
      if (s.y < wy && (tgt || s.k === 'wind')) {
        this.impact(s);
        this.shots.splice(i, 1);
        continue;
      } else if (!tgt && s.y < wy - 480) { this.shots.splice(i, 1); continue; }   // wall.cleanup_position
      s.x += s.vx * dt; s.y += s.vy * dt;
    }
  }
  private impact(s: Shot) {
    switch (s.k) {
      case 'petri': {
        const u = this.units.gorgon[s.g], aura = 1 + (u ? u.aura : 0) * 100 * this.rune('curse_resonance') / 100;
        if (u) u.aura = 0;
        const base = this.gorgonBase(); this.baseDamages['gorgon'] = base;
        this.hit(base * aura * this.weight('gorgon'), 'gorgon', s.x, s.y, this.rune('arc') > 0 ? 'arc' : 'damage_impact');
        this.host.play('gorgon', -5, 0.04);
        break;
      }
      case 'wisp': this.addStatus('cursed', 2 * this.weight('gorgon')); this.host.play('gorgon', -5, 0.04); break;
      case 'arrow': case 'fire': case 'ice': {
        const w = this.weight('shaman');
        if (s.k === 'arrow') { const b = this.shamanBase(); this.baseDamages['shaman'] = b; this.hit(b * w, 'shaman', s.x, s.y); }
        else if (s.k === 'fire') this.hit(this.fireArrowDamage() * w, 'fire_arrows', s.x, s.y);
        else {
          this.addStatus('frost', this.rune('ice_arrows') * w);
          if (this.rune('ice_arrow_damage') > 0) this.hit(this.iceArrowDamage() * w, 'ice_arrows', s.x, s.y);
        }
        if (this.bless('blessing_of_curses') > 0) this.addStatus('cursed', 1.5 * w);
        this.host.play('shaman', 0, 0.04);
        break;
      }
      case 'fireball': {
        const base = this.ifritBase(); this.baseDamages['ifrit'] = base;
        const w = this.weight('ifrit');
        this.hit(base * (this.rune('hot_blooded') > 0 ? this.moltenBonus() : 1) * w, 'ifrit', s.x, s.y);
        if (this.bless('blessing_of_fire') > 0) this.addStatus('molten', 1.5 * this.amult('molten_apply') * w);
        this.host.play('ifrit', 0, 0.04);
        break;
      }
      case 'wind': this.addStatus('weakened', this.zephyrStacks() * this.weight('zephyr')); this.host.play('zephyr', 0, 0.04); break;
    }
  }
  private updateBolts(dt: number) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      if ((b.t -= dt) > 0) continue;
      const dmg = this.zephyrDamage(); this.baseDamages['zephyr'] = dmg;
      this.hit(dmg * this.weight('zephyr'), 'zephyr', b.x, b.y - 115);
      if (this.rune('charge') > 0) this.chargeBase += this.rune('charge');
      if (this.rune('strike_twice') > 0 && !b.second && Math.random() < 0.5 * this.rune('strike_twice')) { b.second = true; b.t = 0.05; continue; }
      this.bolts.splice(i, 1);
    }
  }
  /** WallCurse._on_status_effect_changed: at 100 Cursed stacks the curse pops */
  private checkCurse() {
    if (this.stacks('cursed') < 100 || !this.targetable()) return;
    const [wx, wy] = this.wallPos(), x = wx, y = wy - 25;
    this.hit(this.curseDamage(), 'curse', x, y, '');
    this.clearStatus('cursed');
    this.curse = { x, y, t: 0, fire: this.rune('cursed_fire') > 0 };
    for (const u of this.units.gorgon) if (this.rune('curse_resonance') > 0) u.aura++;
    this.host.play('curse_pop', -3, 0.1);
  }
  /** Wall._process_status_effects, every 0.1 s (stand-in wall only) */
  private decayLocal(dt: number) {
    if ((this.local.tick += dt) < 0.1) return;
    this.local.tick = 0;
    const st = this.local.status, base = this.bless('blessing_of_effects') * META.effectsDecay;
    for (const id in st) {
      const start = base + (id === 'frost' ? 0 : st['frost'] || 0);
      st[id] = Math.max(0, st[id] - Math.pow(Math.max(0, st[id] - start) / 100, 1.15));
      if (st[id] <= 0) delete st[id];
    }
  }
  private addFx(x: number, y: number, type: string) {
    const f = FX[type]; if (!f) return;
    this.fx.push({ x, y, type, t: 0, life: f.frames / f.fps });
  }
  private calcChart() {
    let total = 0; const rows: { id: string; v: number }[] = [];
    for (const src in this.buckets) {
      let v = 0; const b = this.buckets[src];
      for (const k in b) { if (+k + CHART_WINDOW <= this.age) delete b[k]; else v += b[k]; }
      if (v > 0) { rows.push({ id: src, v }); if (src !== 'wall_repair') total += v; }
    }
    rows.sort((a, b) => b.v - a.v);
    this.chart = { total, rows };
  }

  // ================================================================ input (SorceryArea: hover/click speeds units up by 15%)
  hitWorld(wx: number, wy: number): boolean {
    if (this.host.towerLevel() < 7) return false;
    const [ax, ay] = this.areaPos();
    return wx >= ax - 15 && wx <= ax + 22 && wy >= ay - 41 && wy <= ay + 20;   // SorceryArea collision polygon
  }
  onHold(_dt: number) { this.speedMult = 1.15 * (1 + 0.5 * (this.host.fervor || 0)); this.speedT = 0.4; }
  hitUi(x: number, y: number) { const p = this.panel; return !!p && this.host.S.activeArea === 'sorcery' && x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h; }
  onTap(x: number, y: number) {
    if (this.host.S.activeArea !== 'sorcery') return false;
    for (const r of this.tapRects) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) { r.fn(); return true; }
    return false;
  }
  worldFocus(): [number, number] { const [wx, wy] = this.wallPos(); return [wx, wy + 70]; }

  // ================================================================ drawing (world)
  drawWorld(D: PixelDraw) {
    if (this.host.towerLevel() < 7) return;
    // Lightning.gd: five tower lightnings flash in turn, 0.25-0.5 s apart, then a 4-7 s pause
    if (this.decor.flash) {
      const i = this.decor.flash.i, key = 'lightning_' + i, [lw, lh] = D.size(key), p = this.towerPoint('lightning' + i, LIGHTNING_DECOR[i]);
      D.img(key, Math.round(p[0] - lw / 2), Math.round(p[1] - lh / 2));
    }
    // SorceryPortal (3 frames of 11x19, mostly idle) + the area outline while it is active
    const [px, py] = this.portalPos(), pf = PORTAL_FRAMES[Math.floor((this.host.S.time || this.age) * 12) % PORTAL_FRAMES.length];
    if (pf >= 0 && D.has('sorcery_portal')) D.part('sorcery_portal', pf * 11, 0, 11, 19, Math.round(px - 5.5), Math.round(py - 9.5), 11, 19);
    if (this.host.S.activeArea === 'sorcery' && D.has('sorcery_outline')) {
      const [ax, ay] = this.areaPos(), [ow, oh] = D.size('sorcery_outline');
      D.img('sorcery_outline', Math.round(ax + 2.5 - ow / 2), Math.round(ay - 5 - oh / 2));
    }
    // units: textures centred, flipped by direction, bobbing 4 * sin(timer + i)
    for (const t of TYPES) {
      const arr = this.units[t]; if (!arr.length) continue;
      const img = UNITS[t].img, [w, h] = D.size(img);
      arr.forEach((u, i) => {
        const bob = 4 * Math.sin(this.float[t] + i), o: DrawOpts = { flipX: u.dir < 0 };
        const tex = t === 'shaman' && u.cast > 0 && D.has('shaman_cast') ? 'shaman_cast' : img;
        D.img(tex, Math.round(u.x - w / 2), Math.round(u.y - bob - h / 2), o);
        if (t === 'gorgon' && u.aura > 0) {
          const tint = u.aura > 4 ? '#ff5a8a' : u.aura > 2 ? '#c879ff' : '#8fd3ff';   // Colors.GorgonAuraColor1..3
          D.img('gorgon_aura', Math.round(u.x - 6), Math.round(u.y - bob - 5.5), { flipX: u.dir < 0, tint });
        }
      });
    }
    const SHOT_IMG: Record<string, string> = { petri: 'petrification', wisp: 'wisp', arrow: 'shaman_arrow', fire: 'fire_arrow', ice: 'ice_arrow', fireball: 'fireball', wind: 'wind' };
    for (const s of this.shots) { const img = SHOT_IMG[s.k], [w, h] = D.size(img); D.img(img, Math.round(s.x - w / 2), Math.round(s.y - h / 2)); }
    for (const b of this.bolts) { const img = b.second ? 'lightning_5' : 'lightning_0', [w, h] = D.size(img); D.img(img, Math.round(b.x - w / 2), Math.round(b.y - h)); }
    for (const f of this.fx) {
      const d = FX[f.type], fr = Math.min(d.frames - 1, Math.floor(f.t * d.fps)), [, h] = D.size(d.img);
      D.part(d.img, fr * d.fw, 0, d.fw, h, Math.round(f.x - d.fw / 2), Math.round(f.y - h / 2), d.fw, h);
    }
    if (this.curse) {   // curse sprite fades over 0.7 s, curse_animation (6 x 201x49 @ 9 fps) plays over it
      const c = this.curse, a = Math.max(0, 1 - c.t / 0.7), img = c.fire ? 'curse_animation_fire' : 'curse_animation', fr = Math.min(5, Math.floor(c.t * 9));
      D.img('curse', Math.round(c.x - 24.5), Math.round(c.y - 24.5), { alpha: a });
      D.part(img, fr * 201, 0, 201, 49, Math.round(c.x - 100.5), Math.round(c.y - 24.5), 201, 49);
    }
  }

  // ================================================================ drawing (screen): lightning lines, stand-in numbers
  drawHud(D: PixelDraw) {
    if (this.host.towerLevel() < 7) return;
    const H = this.host, z = H.toScreen(1, 0)[0] - H.toScreen(0, 0)[0];
    // Units._draw: jagged lightning from the portal to each new unit, fading over 0.1 s
    if (this.lines.length) {
      const [ax, ay] = this.areaPos(), [sx0, sy0] = H.toScreen(ax + 2, ay - 20);   // Units._draw: sorcery area + (2, -20)
      for (const l of this.lines) {
        const [sx1, sy1] = H.toScreen(l.x, l.y), k = 1 - l.t / LINE_LIFE;
        this.lightning(D, sx0, sy0, sx1, sy1, k, Math.max(1, Math.round(z)));
      }
    }
    for (const n of this.nums) {   // IndicatorLabel: exponential ease-out drift, then hide
      const k = n.t >= n.time ? 1 : 1 - Math.pow(2, -10 * n.t / n.time), [sx, sy] = H.toScreen(n.x, n.y + n.dy * k);
      const sc = Math.max(1, Math.round(z * 0.5));
      D.text(n.text, sx + 1, sy + 1, '#2a1f3d', 10, 'center', { scale: sc });
      D.text(n.text, sx, sy, '#ffffff', 10, 'center', { scale: sc });
    }
  }
  private lightning(D: PixelDraw, x0: number, y0: number, x1: number, y1: number, k: number, px: number) {
    const dx = x1 - x0, dy = y1 - y0, dist = Math.hypot(dx, dy); if (dist < 1) return;
    const n = Math.round(Math.max(4, Math.min(12, dist / 40))), nx = -dy / dist, ny = dx / dist;
    const pts: [number, number][] = [[x0, y0]];
    for (let i = 1; i < n; i++) { const f = i / n, dev = Math.sin(f * Math.PI) * dist * 0.15 * rand(-1, 1); pts.push([x0 + dx * f + nx * dev, y0 + dy * f + ny * dev]); }
    pts.push([x1, y1]);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / px)), a = k * (1 - i / pts.length * 0.5);
      for (let s = 0; s <= steps; s++) D.rect('#fff1d6', Math.round(ax + (bx - ax) * s / steps), Math.round(ay + (by - ay) * s / steps), px, px, a);
    }
  }

  // ================================================================ panel: skill list + Sorcery Manual + status effects + damage chart
  drawPanel(D: PixelDraw) {
    const H = this.host, pw = Math.min(H.W - 8, 220);
    this.tapRects = [];
    const listH = H.skillListHeight('sorcery');
    const statusIds = STATUS_EFFECTS.filter(s => this.stacks(s.id) >= 0.5).map(s => s.id);
    const chartRows = this.chartOpen ? Math.max(1, this.chart.rows.length) : 0;
    const manualH = this.manualOpen ? 4 * 13 + 18 : 0;
    const infoH = this.infoId ? 34 : 0;
    const extraH = 18 + (statusIds.length ? 14 : 0) + (this.chartOpen ? 14 + chartRows * 10 + 4 : 0) + manualH + infoH;
    const r = H.panelRect(pw, listH + 2 + extraH);
    this.panel = r;
    let y = r.y;
    H.drawSkillList('sorcery', 'Sorcery', r.x, y, r.w);
    y += listH + 2;
    D.nine('panel', r.x, y, r.w, extraH);
    let cy = y + 3;
    // buttons: Sorcery Manual / Damage chart toggle (SorceryManual button + DamageChartButton)
    const bw = Math.floor((r.w - 12) / 2);
    if (H.button('sorc_manual', 'Manual', r.x + 4, cy, bw, 13)) { this.manualOpen = !this.manualOpen; this.infoId = ''; }
    if (H.button('sorc_chart', 'Damage', r.x + 8 + bw, cy, bw, 13)) { this.chartOpen = !this.chartOpen; this.calcChart(); }
    cy += 16;
    if (statusIds.length) {   // WallUI status effect row: icon + stacks
      let sx = r.x + 4;
      for (const id of statusIds) {
        const s = STATUS_EFFECTS.find(e => e.id === id)!, label = fmt(this.stacks(id));
        D.img(s.icon, sx, cy);
        D.text(label, sx + 12, cy + 1, '#ffffff');
        const w = 14 + D.textW(label) + 4;
        this.tapRects.push({ x: sx, y: cy, w, h: 12, fn: () => { this.infoId = this.infoId === 's:' + id ? '' : 's:' + id; } });
        sx += w;
      }
      cy += 14;
    }
    if (this.chartOpen) {
      D.text(`Damage ${fmt(this.chart.total)}/min.`, r.x + 4, cy, '#fff1d6');
      cy += 14;
      if (!this.chart.rows.length) { D.text('No damage yet', r.x + 16, cy, '#a8a3b8'); cy += 10; }
      for (const row of this.chart.rows) {   // DamageBar: icon + progress (share of total)
        const src = DAMAGE_SOURCES.find(s => s.id === row.id), icon = src ? src.icon : 'wall_health_icon';
        if (D.has(icon)) { const [iw, ih] = D.size(icon), sc = Math.min(1, 9 / Math.max(iw, ih)); D.part(icon, 0, 0, iw, ih, r.x + 4, cy, iw * sc, ih * sc); }
        const bx = r.x + 16, bwid = r.w - 20 - 40;
        H.progressBar(bx, cy + 1, bwid, 7, this.chart.total > 0 ? row.v / this.chart.total : 0);
        D.text(fmt(row.v), bx + bwid + 3, cy, '#ffffff');
        this.tapRects.push({ x: r.x + 2, y: cy, w: r.w - 4, h: 10, fn: () => { this.infoId = this.infoId === 'd:' + row.id ? '' : 'd:' + row.id; } });
        cy += 10;
      }
      cy += 4;
    }
    if (this.manualOpen) {   // SorceryManual: every sorcery unit with its description (Combat Magic excluded)
      D.text('Sorcery Manual', r.x + 4, cy, '#fff1d6', 10); cy += 14;
      for (const t of ['gorgon', 'shaman', 'ifrit', 'zephyr'] as UnitType[]) {
        const sk = this.skills[UNITS[t].skill];
        D.img(UNITS[t].img, r.x + 4, cy);
        D.text(sk.name.replace('Summon ', ''), r.x + 16, cy + 1, '#ffffff');
        this.tapRects.push({ x: r.x + 2, y: cy, w: r.w - 4, h: 12, fn: () => { this.infoId = this.infoId === 'm:' + t ? '' : 'm:' + t; } });
        cy += 13;
      }
      cy += 4;
    }
    if (this.infoId) {
      const [kind, id] = this.infoId.split(':');
      let text = '';
      if (kind === 's') { const s = STATUS_EFFECTS.find(e => e.id === id)!; text = `${s.name}: ${s.desc}`; }
      else if (kind === 'd') {
        const s = DAMAGE_SOURCES.find(e => e.id === id), row = this.chart.rows.find(rw => rw.id === id);
        text = `${s ? s.desc : id}` + (this.baseDamages[id] !== undefined ? ` Base damage: ${fmt(this.baseDamages[id])}.` : '') + ` Total damage: ${fmt(row ? row.v : 0)}`;
      } else { const sk = this.skills[UNITS[id as UnitType].skill]; text = sk.tip().replace(/\n+/g, ' '); }
      this.wrap(D, text, r.x + 4, cy, r.w - 8, 3);
    }
    return r;
  }
  private wrap(D: PixelDraw, text: string, x: number, y: number, w: number, maxLines: number) {
    const words = text.split(' '), lines: string[] = [];
    let cur = '';
    for (const wd of words) { const nx = (cur + ' ' + wd).trim(); if (cur && D.textW(nx) > w) { lines.push(cur); cur = wd; } else cur = nx; }   // measured: proportional font
    if (cur) lines.push(cur);
    lines.slice(0, maxLines).forEach((l, i) => D.text(l, x, y + i * 10, '#a8a3b8'));
  }

    // Combat Magic and Midway are applied by siege.damage() itself (Wall.get_damage_multiplier), not via host.mult('damage')
  multipliers(): Multipliers { return {}; }

  // ================================================================ save / load / prestige
  save() {
    return { chargeBase: this.chargeBase, age: this.age, buckets: this.buckets, chartOpen: this.chartOpen, local: { dmg: this.local.dmg, status: this.local.status } };
  }
  load(d: any) {
    if (!d) return;
    this.chargeBase = d.chargeBase || 0;
    this.age = d.age || 0;
    this.buckets = d.buckets || {};
    this.chartOpen = d.chartOpen !== false;
    if (d.local) { this.local.dmg = d.local.dmg || 0; this.local.status = d.local.status || {}; }
    for (const t of TYPES) this.units[t] = [];
    this.shots = []; this.bolts = []; this.lines = [];
    this.calcChart();
  }
  reset(_keepPermanent: boolean) {
    for (const t of TYPES) this.units[t] = [];
    this.shots = []; this.bolts = []; this.fx = []; this.nums = []; this.lines = []; this.curse = null;
    this.chargeBase = 0; this.buckets = {}; this.chart = { total: 0, rows: [] }; this.baseDamages = {};
    this.local = { dmg: 0, status: {}, tick: 0 };
  }

  // ================================================================ dev panel
  debug: Record<string, (...args: any[]) => void> = {
    'Summon 10 of each': () => this.debugSummon(10),
    'Summon 50 of each': () => this.debugSummon(50),
    'Combat Magic max': () => this.setLevel('combat_magic', 10),
    'Weaken +200': () => this.addStatus('weakened', 200),
    'Curse pop (100 Cursed)': () => this.addStatus('cursed', Math.max(0, 100 - this.stacks('cursed'))),
    'All status +50': () => { for (const s of STATUS_EFFECTS) this.addStatus(s.id, 50); },
    'Totems: 10 magic': () => this.setLevel('carve_magic_totem', Math.max(10, this.lv('carve_magic_totem'))),
    'Spirits +1000': () => this.host.addResource('spirits', 1000),
    'Big hit (10% wall)': () => { const [wx, wy] = this.wallPos(); this.hit(WALL_FALLBACK_HP * 0.1, 'gorgon', wx, wy, 'damage_impact', true); },
  };
  private setLevel(id: string, L: number) {
    const S = this.host.S;
    if (S && S.skills) S.skills[id] = L;
    this.sync();
  }
  private debugSummon(n: number) {
    for (const t of TYPES) this.setLevel(UNITS[t].skill, this.lv(UNITS[t].skill) + n);
    if (this.topTotemCount() < 1) this.setLevel('carve_magic_totem', 5);
  }
}

registerModule(new SorceryModule());
