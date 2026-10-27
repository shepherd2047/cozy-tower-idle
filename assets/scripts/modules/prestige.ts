// Prestige + Blessings + Early Prestige + Damage Prestige (Prestige.gd, PrestigeLevels.gd, DamagePrestige.gd, PrestigePanel.gd,
// EarlyPrestigePanel.gd, Blessings.gd, data/blessings/*.tres).
// Every magic gain fills the prestige bar and every point of wall damage fills the damage bar; each full bar is a level and
// one point. Prestiging spends the run: the tower dissolves back into the orb, the points go to blessings, every module is
// reset(true) and the run-start blessings apply. Other modules read their own blessings via prestige.blessingLevel(id);
// the core-economy ones are applied here through multipliers() and run-start grants.
// Permanent state lives in save()/load() and, as a backup, localStorage['tw_prestige_v1'].
import { sys } from 'cc';
import type { PixelDraw } from '../PixelDraw';
import { registerModule } from '../GameModule';
import type { GameHost, GameModule, Multipliers } from '../GameModule';

// ---------------------------------------------------------------- tuning
// Original cap: 7000 * 4.05^(L^(1 + 0.0062 L)). Demo base 700 (/10): with 7000 an engaged player holds only 3 points at
// tower 4 (~363K lifetime magic, tools/pacing/sim.js); with 700 it is 5. Point requirements 1/5/9/13/18/24 -> 1/3/6/9/12/16,
// so the 16 magic levels alone reach every row.
export const PRESTIGE_TUNING = { base: 700, maxLevel: 16, unlockTower: 4, reqMap: { 1: 1, 5: 3, 9: 6, 13: 9, 18: 12, 24: 16 } as Record<number, number> };
const SAVE_KEY = 'tw_prestige_v1';
const CAP_MULT: Record<number, number> = { 8: 0.85, 9: 0.9, 10: 0.9, 11: 0.9, 12: 0.7, 13: 0.65, 14: 0.6, 15: 0.5 };
export function prestigeCap(L: number) { return PRESTIGE_TUNING.base * (CAP_MULT[L] || 1) * Math.pow(4.05, Math.pow(L, 1 + L * 0.0062)); }
export function damageCap(L: number) { // DamagePrestige.cap
  if (L === 0) return 4e4; if (L === 1) return 9e5; if (L === 2) return 1.5e7;
  return 1.5e6 * Math.pow(4.5, 20.9 - (20.9 / (42 * 42)) * Math.pow(L - 42, 2));
}

// ---------------------------------------------------------------- blessings (data/blessings/*.tres, Registries.blessings order)
// req: original point requirement (mapped through reqMap). auto: milestone blessing, free once enough points are owned.
// by: who applies the effect ('prestige' = this module; otherwise the module that reads blessingLevel(id)).
export interface BlessingDef { id: string, name: string, icon: string[], max: number, req: number, auto?: boolean, sorcery?: boolean, by: string, desc: string }
const B = (id: string, name: string, icon: string[], max: number, req: number, by: string, desc: string, o: Partial<BlessingDef> = {}): BlessingDef =>
  ({ id, name, icon, max, req: PRESTIGE_TUNING.reqMap[req] ?? req, by, desc, ...o });
export const BLESSINGS: BlessingDef[] = [
  B('magic_gain_blessing', 'Blessing of Magic', ['bless_magic', 'magic_gain_blessing'], 2, 1, 'prestige', '+150% {magic_icon} income'),
  B('knowledge_blessing', 'Blessing of Knowledge', ['bless_knowledge', 'blessing_of_knowledge_icon'], 2, 1, 'prestige', '+150% {knowledge_icon} income'),
  B('prestige_blessing', 'Blessing of the Beacon', ['bless_prestige', 'beacon_blessing_icon'], 1, 1, 'prestige', 'While the Prestige building stands, {magic_icon} and {wood_icon} income rise by 50%', { auto: true }),
  B('blessing_of_supervision', 'Blessing of Supervision', ['blessing_of_supervision_icon'], 1, 1, 'core', 'The last place you tapped works 80% faster until you tap somewhere else\n- Sorcery units get half of this boost'),
  B('academy_blessing', 'Blessing of Research', ['knowledge_gain_blessing_icon', 'academy_blessing_icon'], 2, 5, 'buildings', 'Academy subjects gain 1 extra level each time they level up'),
  B('build_academy', 'Blessing of Tomes', ['blessing_of_tomes'], 1, 5, 'prestige', 'When there are at least 10 Spirit Tomes, {knowledge_icon} and {magic_icon} gain is increased by 50%', { auto: true }),
  B('forestry_blessing', 'Blessing of the Forest', ['bless_forestry', 'resource_blessing_icon'], 2, 5, 'prestige', '+150% {wood_icon} income'),
  B('blessing_of_totems', 'Blessing of Totems', ['bless_totems', 'blessing_of_totems_icon'], 1, 5, 'prestige', 'For every 2 totems of a certain type carved, increase the passive effect of that totem type by a compounding 35%'),
  B('blessing_of_population', 'Blessing of Population', ['population_icon'], 1, 5, 'prestige', "The Spirit Type that has the largest population will become 100% more productive.\n-'Productive' means the primary function of the spirit type is boosted."),
  B('balance_blessing', 'Blessing of Balance', ['blessing_of_balance_icon'], 1, 9, 'prestige', 'The tower resource you are furthest behind on is earned 150% faster\n- Once every requirement is met, all of them are earned 50% faster instead.'),
  B('blessing_of_the_tower', 'Blessing of the Tower', ['bless_tower', 'blessing_of_the_tower'], 1, 9, 'prestige', 'New runs start with the Study already built, plus 10 Cloudlings and 5 Spirit Tomes', { auto: true }),
  B('alchemy_blessing', 'Blessing of Alchemy', ['blessing_of_alchemy'], 2, 9, 'alchemy', 'Each {magic_gold_icon} brewed brings a free extra {magic_gold_icon}'),
  B('sage_totem_blessing', 'Blessing of the Sage Totem', ['sage_totem_blessing'], 2, 9, 'core', 'Unlocks a Totem that multiplies Academy EXP by another 50% each'),
  B('dragon_blessing', 'Blessing of the Dragon', ['dragon_blessing_icon'], 2, 9, 'dragons', 'Each Dragon level-up grants 1 bonus ability point'),
  B('dragon_wisdom_blessing', 'Blessing of the Dragon Wisdom', ['dragon_wisdom_blessing'], 1, 9, 'dragons', 'Dragon gains 30% more EXP'),
  B('blessing_of_hovering', 'Blessing of Hovering', ['blessing_of_hovering'], 1, 9, 'core', 'Hovering over a place speeds up its spirits, no tapping needed.', { auto: true }),
  B('blessing_of_summoning', 'Blessing of Summoning', ['bless_summoning', 'blessing_of_summoning'], 1, 9, 'prestige', 'Summon Spirit is bought automatically whenever you can afford it', { auto: true }),
  B('blessing_of_fire', 'Blessing of Fire', ['blessing_of_fire_icon'], 2, 13, 'sorcery', 'Ifrits will apply Molten to the wall. For every stack of Molten, the Wall takes 3% more damage from Dragon Fireballs.\n- Also Dragon EXP gain increases by 100%', { sorcery: true }),
  B('blessing_of_curses', 'Blessing of Curses', ['blessing_of_curses_icon'], 2, 13, 'sorcery', 'Shamans put Cursed on the wall. At 100 stacks it bursts for 4x the combined damage of every Shaman.', { sorcery: true }),
  B('gorgon_blessing', 'Blessing of the Gorgon', ['gorgon_blessing_icon'], 2, 13, 'sorcery', 'Gorgons deal 100% more damage for every 200 stacks of Weakened on the wall', { sorcery: true }),
  B('blessing_of_diplomacy', 'Blessing of Diplomacy', ['blessing_of_diplomacy'], 2, 13, 'embassy', 'Each new nation you befriend gives 30 {magic_gold_icon}.\n- Resource bonuses do not apply.'),
  B('blessing_of_the_tower_2', 'Greater Blessing of the Tower', ['bless_tower', 'blessing_of_the_tower'], 1, 13, 'prestige', 'New runs start with Forestry and Prestige already built, plus 10 Druids and 5 more Spirit Tomes.', { auto: true }),
  B('blessing_of_exploration', 'Blessing of Exploration', ['blessing_of_exploration_icon'], 1, 13, 'embassy', 'Hidden nations appear in the Embassy', { auto: true }),
  B('midway_blessing', 'Blessing of the Damage', ['blessing_of_damage'], 1, 13, 'prestige+sorcery', '+50% {knowledge_icon} income and +50% damage to the wall', { auto: true }),
  B('blessing_of_n', 'Blessing of 60', ['blessing_of_60'], 2, 13, 'prestige', "Spirits with a population of 60 or more will become 100% more productive.\n-'Productive' means the primary function of the spirit type is boosted."),
  B('doubling_blessing', 'Blessing of Doubling', ['bless_doubling', 'doubling_blessing'], 1, 13, 'prestige', 'Every Cloudling, Spirit Tome or Druid you call arrives with a twin.'),
  B('research_blessing', 'Blessing of Alchemy Research', ['research_blessing'], 1, 13, 'alchemy', 'Building Alchemy gives 50 {magic_gold_icon} right away.\n- Resource bonuses do not apply.', { auto: true }),
  B('blessing_of_effects', 'Blessing of Effects', ['blessing_of_effects'], 2, 18, 'siege', 'Status effects on the wall stop fading until they pass 75 stacks'),
  B('blessing_of_multitasking', 'Blessing of Multitasking', ['blessing_of_multitasking'], 1, 18, 'buildings', 'The Academy can train 4 research subjects at the same time instead of 2'),
  B('runecraft_blessing', 'Blessing of Runecraft', ['blessing_of_runecraft'], 2, 18, 'runes', 'Runecraft makes 1 extra rune each time'),
  B('blessing_of_the_tower_3', 'Final Blessing of the Tower', ['bless_tower', 'blessing_of_the_tower'], 1, 18, 'prestige', 'New runs start with the tower built up to Sorcery, the Academy, Dragon Nest and Embassy in place, and early upgrades maxed.', { auto: true }),
  B('blessing_of_destruction', 'Blessing of Destruction', ['destruction_blessing'], 1, 18, 'prestige', 'Spirits outside Sorcery work 20% faster for every tenfold of your damage per minute.', { auto: true }),
  B('blessing_of_few', 'Blessing of Few', ['blessing_of_few'], 2, 18, 'prestige', 'Every spirit type not covered by the Blessing of 60 or the Blessing of Population works 40% faster.'),
  B('crafting_totem_blessing', 'Blessing of the Crafting Totem', ['crafting_totem_blessing'], 2, 18, 'core', 'Unlocks a Totem that makes {blank_rune_icon} and {magic_gold_icon} twice as fast'),
  B('blessing_of_carving', 'Blessing of Carving', ['bless_totems', 'blessing_of_totems_icon'], 1, 18, 'prestige', 'Craft Totem is bought automatically whenever you can afford it', { auto: true }),
  B('specialization_blessing', 'Blessing of Specialization', ['specialization_blessing'], 1, 18, 'dragons', 'Gain 50 Dragon Ability Points initially\n\nEvery 80 levels a Dragon ability gains, increase all other Dragon abilities by 10 levels'),
  B('refining_blessing', 'Blessing of Refining', ['refining_blessing'], 1, 24, 'runes', 'Runes can be refined from the start: rune skills begin unlocked for refining', { auto: true }),
  B('blessing_of_compounding', 'Blessing of Compounding', ['blessing_of_compounding'], 1, 24, 'prestige', 'Blessing of Destruction bonuses grow by another 8% each'),
  B('spirit_debt', 'Blessing of Debt', ['spirit_debt_blessing'], 1, 24, 'prestige', 'Start with negative 100 {spirit_icon}. Every non-sorcery Spirit type will start with 20 {spirit_icon} summoned.'),
  B('forest_keeper_blessing', 'Blessing of the Forest Keeper', ['forest_keeper_blessing'], 2, 24, 'temple', 'The Forest Keeper arrives with 5 upgrades already bought'),
];
const ALIAS: Record<string, string> = { spirit_debt_blessing: 'spirit_debt', build_academy_blessing: 'build_academy' };   // file names vs .tres ids
const BY_ID: Record<string, BlessingDef> = Object.fromEntries(BLESSINGS.map(b => [b.id, b]));
// total points every non-automatic blessing can absorb (Blessings.total_blessing_points): Damage Prestige stops beyond it
const TOTAL_BLESSING_POINTS = BLESSINGS.filter(b => !b.auto).reduce((a, b) => a + b.max, 0);
// summon skills (Registries.skills_that_are_probably_summoning); sorcery ones are excluded from Destruction / Debt
const SUMMONS = ['summon_cloudling', 'summon_spirit_tome', 'summon_druid', 'summon_spirit_sage', 'summon_dragon_keeper', 'summon_diplomat', 'summon_alchemist', 'summon_rune_smith', 'summon_astrologer'];
const SORCERY_SUMMONS = ['summon_gorgon', 'summon_shaman', 'summon_ifrit', 'summon_zephyr'];
const DOUBLED = ['summon_cloudling', 'summon_spirit_tome', 'summon_druid'];
const SKILL_MAX: Record<string, number> = { wizard_magic: 4, cloudling_potency: 13, text_enchantment: 13, bigger_forest: 10 };
const T_STUDY = 2, T_PRESTIGE = 4, T_SORCERY = 7;

interface SaveData {
  level: number, xp: number, dlevel: number, dxp: number, run: number, banked: number, bl: Record<string, number>, count: number,
  auto: boolean, autoTotems: boolean, seen: boolean, t4: number[], total: number, dtotal: number,
}
const fresh = (): SaveData => ({ level: 0, xp: 0, dlevel: 0, dxp: 0, run: 0, banked: 0, bl: {}, count: 0, auto: true, autoTotems: true, seen: false, t4: [], total: 0, dtotal: 0 });
const COL = { ink: '#2a1f3d', plum: '#3d2f5a', tile: '#4a3d66', light: '#fff1d6', white: '#ffffff', grey: '#a8a3b8', dim: '#808080',
  pink: '#ff8fb1', mint: '#8ff5e4', gold: '#ffd456', lilac: '#a882f5', red: '#ff5a6e' };
const clamp01 = (k: number) => Math.min(Math.max(k, 0), 1);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function fmt(n: number): string {
  n = Math.floor(n);
  if (n < 10000) return String(Math.max(0, n));
  const suf = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
  const e = Math.floor(Math.log10(n) + 0.00001), se = 3 * Math.floor(e / 3), d = n / 10 ** se, digits = String(Math.floor(d)).length, s = suf[se / 3] || '';
  if (digits >= 3) return Math.floor(d) + s;
  if (digits === 2) return (Math.floor(d * 10) / 10).toFixed(1) + s;
  return (Math.floor(d * 100) / 100).toFixed(2) + s;
}
const ICON_W = 11;   // {x_icon} tokens in text
type Mode = 'closed' | 'info' | 'confirm' | 'anim' | 'assign';
interface Region { id: string, x: number, y: number, w: number, h: number, tap?: () => void }

export class PrestigeModule implements GameModule {
  id = 'prestige';
  unlockTower = 0;                       // the HUD shows from tower 4 (or once you have blessings); see `unlocked`
  nav = { label: 'Prestige' };
  s: SaveData = fresh();
  mode: Mode = 'closed';
  sel = 'magic_gain_blessing';
  runTime = 0; t4Logged = false;
  private host!: GameHost;
  private regions: Region[] = [];
  private flashId = ''; private flashT = 0;   // tap feedback on buttons
  private dirty = false; private saveT = 0;
  private lastSkill: Record<string, number> = {};
  private autoT = 0;
  private gainFx: { t: number, text: string }[] = [];
  private showT = 0; private now = 0;
  private anim: any = null;
  private started = false;

  // ================================================================ GameModule
  init(host: GameHost) {
    this.host = host;
    this.loadLocal();
  }
  get H(): any { return this.host as any; }
  /** prestige is offered from tower 4 on, early prestige before that once you own blessings */
  get unlocked() { return this.host.towerLevel() >= PRESTIGE_TUNING.unlockTower || this.allPoints() > 0 || this.s.count > 0; }
  get early() { return this.host.towerLevel() < PRESTIGE_TUNING.unlockTower; }
  get canPrestige() {
    if (this.H.S?.building) return false;
    return this.early ? this.allPoints() > 0 : true;      // EarlyPrestigePanel: only to reconfigure blessings
  }
  get open() { return this.mode !== 'closed'; }
  get count() { return this.s.count; }

  update(dt: number) {
    this.now += dt; this.runTime += dt;
    if (!this.started) { this.started = true; this.resyncSummons(); }
    if (!this.t4Logged && this.host.towerLevel() >= T_PRESTIGE) {
      this.t4Logged = true; this.s.t4.push(Math.round(this.runTime)); if (this.s.t4.length > 8) this.s.t4.shift(); this.dirty = true;
    }
    for (const f of this.gainFx) f.t += dt;
    this.gainFx = this.gainFx.filter(f => f.t < 1.2);
    if (this.flashT > 0) this.flashT -= dt;
    if (this.mode !== 'closed') this.showT += dt;
    if (this.mode !== 'anim' && this.mode !== 'assign') this.runBlessings(dt);
    if (this.anim) this.updateAnim(dt);
    this.saveT -= dt;
    if (this.dirty && this.saveT <= 0) { this.saveT = 2; this.saveLocal(); }
  }

  /** host gain listener (all resources): prestige XP from magic */
  onGain(id: string, v: number) { if (id === 'magic') this.onMagicGained(v); }
  /** damage dealt to the wall (siege): Damage Prestige XP */
  onDamage(v: number) { this.onDamageDealt(v); }

  multipliers(): Multipliers {
    const L = (id: string) => this.blessingLevel(id), lvl = this.host.towerLevel();
    const beacon = L('prestige_blessing') && lvl >= T_PRESTIGE ? 1.5 : 1;
    const tomes = L('build_academy') && this.host.skillLevel('summon_spirit_tome') >= 10 ? 1.5 : 1;
    const totem = (kind: string) => {   // the core totem effect is (1 + n); the blessing compounds it
      if (!L('blessing_of_totems')) return 1;
      const n = this.totemCount(kind); return n ? (1 + n * Math.pow(1.35, Math.floor(n / 2))) / (1 + n) : 1;
    };
    const bal = this.balance();
    const m: Multipliers = {
      magic: (1 + 1.5 * L('magic_gain_blessing')) * beacon * tomes * totem('magic_totem') * (bal.magic ?? 1),
      knowledge: (1 + 1.5 * L('knowledge_blessing')) * tomes * (1 + 0.5 * L('midway_blessing')) * totem('knowledge_totem') * (bal.knowledge ?? 1),
      wood: (1 + 1.5 * L('forestry_blessing')) * beacon * totem('wood_totem') * (bal.wood ?? 1),
      magic_gold: bal.magic_gold ?? 1,   // Blessing of Alchemy / Research: applied by alchemy.ts; Midway damage: by sorcery.ts
    };
    // per spirit type productivity (Population, 60, Few, Destruction): host.mult('summon_cloudling') etc.
    for (const id of SUMMONS.concat(SORCERY_SUMMONS)) { const k = this.spiritBonus(id); if (k !== 1) m[id] = k; }
    return m;
  }

  drawHud(D: PixelDraw) {
    this.regions = [];
    if (this.mode === 'closed' && this.unlocked && !this.host.S?.building) { this.prefetchArt(); this.drawStar(D); }
  }
  /** drawn last (above tutorials / tooltips): the modal panel and the reset animation; first pick of touches */
  overlay(D: PixelDraw) { if (this.mode !== 'closed') this.drawPanel2(D); }
  available() { return this.unlocked; }
  navAvailable() { return this.unlocked; }
  /** later runs skip the intro tutorial */
  skipIntro() { return this.s.count > 0; }
  /** nav button: opens the modal panel (drawn in drawHud, above everything) */
  drawPanel(_D: PixelDraw) {
    if (this.mode === 'closed') this.openPanel();
    return null;
  }
  worldFocus(): [number, number] { return this.host.orbPos(); }
  hitUi(x: number, y: number) { return this.mode !== 'closed' || !!this.regionAt(x, y); }
  onTap(x: number, y: number) {
    const r = this.regionAt(x, y); if (!r) return this.mode !== 'closed';
    if (r.tap) { this.flashId = r.id; this.flashT = 0.12; r.tap(); }
    return true;
  }
  save() { return { ...this.s, bl: { ...this.s.bl } }; }
  load(d: any) { if (d && typeof d === 'object') this.apply(d); }
  /** prestige wipes run state only; everything in `s` except the run points is permanent */
  reset(keepPermanent: boolean) {
    if (!keepPermanent) { this.s = fresh(); this.saveLocal(); }
    if (this.anim || this.mode !== 'closed') this.unhideTower();
    this.mode = 'closed'; this.anim = null; this.runTime = 0; this.t4Logged = false; this.started = false; this.lastSkill = {};
  }
  debug = {
    'Prestige +1 point': () => this.debugGrant(1),
    'Prestige +5 points': () => this.debugGrant(5),
    'Unlock all blessings': () => this.debugUnlockAll(),
    'Reset prestige': () => this.debugReset(),
    'Open blessings screen': () => { this.s.banked += this.s.run; this.s.run = 0; this.mode = 'assign'; this.showT = 0; this.saveLocal(); },
  };

  // ================================================================ public API (other modules)
  /** 0..max; automatic (milestone) blessings are 1 once enough points are owned */
  blessingLevel(id: string) {
    const b = BY_ID[ALIAS[id] || id]; if (!b) return 0;
    return b.auto ? (this.allPoints() >= b.req ? 1 : 0) : Math.min(b.max, this.s.bl[id] || 0);
  }
  /** points owned outside this run: assigned + unassigned (Blessings.get_all_points) */
  allPoints() { return this.s.banked + this.assigned(); }
  assigned() { let n = 0; for (const b of BLESSINGS) if (!b.auto) n += this.s.bl[b.id] || 0; return n; }
  cap() { return prestigeCap(this.s.level); }
  dcap() { return damageCap(this.s.dlevel); }
  /** Blessing of Destruction (+ Compounding): non-sorcery spirit productivity multiplier */
  destructionBonus() {
    if (!this.blessingLevel('blessing_of_destruction')) return 1;
    const M = this.H.modules || {}, dpm = Number(M.siege?.dpm?.() ?? M.sorcery?.damagePerMinute?.() ?? 0); if (!(dpm > 0)) return 1;
    const lv = Math.floor(Math.log10(dpm));
    const pct = this.blessingLevel('blessing_of_compounding') ? lv * 20 * Math.pow(1.08, lv) : lv * 20;
    return 1 + Math.max(0, pct) / 100;
  }
  /** productivity of a spirit type (summon skill id): Population, 60, Few and Destruction (Utils.gd, PopulationIcon.gd) */
  spiritBonus(skillId: string) {
    const lv = this.host.skillLevel(skillId); if (!(lv > 0)) return 1;
    let pop = 1;
    if (this.blessingLevel('blessing_of_population') && this.biggestPopulation() === skillId) pop = 2;
    const n = this.blessingLevel('blessing_of_n') && lv >= 60 ? 1 + this.blessingLevel('blessing_of_n') : 1;
    const few = this.blessingLevel('blessing_of_few') && pop === 1 && n === 1 ? 1 + 0.4 * this.blessingLevel('blessing_of_few') : 1;
    const destr = SORCERY_SUMMONS.includes(skillId) ? 1 : this.destructionBonus();
    return pop * n * few * destr;
  }
  /** prestige points gained this run (not yet spent) */
  points() { return this.s.run; }
  /** Tome Master pulse: +pct% of the current damage-prestige bar */
  addDamageExpPercent(pct: number) { this.onDamageDealt(this.dcap() * pct / 100); }
  /** Blessing of Supervision speed for the last clicked area (core reads it) */
  supervisionBonus(sorcery = false) { return this.blessingLevel('blessing_of_supervision') ? (sorcery ? 1.4 : 1.8) : 1; }

  // ================================================================ XP
  onMagicGained(v: number) {
    if (!(v > 0)) return;
    const s = this.s;
    if (s.level >= PRESTIGE_TUNING.maxLevel) { s.xp = 0; return; }
    s.total += v;
    let gain = v;
    while (gain > 0 && s.level < PRESTIGE_TUNING.maxLevel) {
      const step = Math.min(gain, this.cap() - s.xp);
      s.xp += step; gain -= step;
      if (s.xp >= this.cap() * (1 - 1e-9)) { s.xp = 0; s.level++; this.gainPoint(); }
    }
    this.dirty = true;
  }
  onDamageDealt(v: number) {
    if (!(v > 0)) return;
    const s = this.s;
    if (TOTAL_BLESSING_POINTS <= s.dlevel + s.level) { s.dxp = 0; return; }
    s.dtotal += v;
    let gain = v;
    while (gain > 0 && TOTAL_BLESSING_POINTS > s.dlevel + s.level) {
      const step = Math.min(gain, this.dcap() - s.dxp);
      s.dxp += step; gain -= step;
      if (s.dxp >= this.dcap() * (1 - 1e-9)) { s.dxp = 0; s.dlevel++; this.gainPoint(); }
    }
    this.dirty = true;
  }
  private gainPoint() {
    this.s.run++;
    this.gainFx.push({ t: 0, text: '+1' });
    if (this.unlocked) this.host.play('fervor_max', -6, 0.3);
    this.saveLocal();
  }

  // ================================================================ run blessings
  private runBlessings(dt: number) {
    // Blessing of Doubling (Skill.increase_skill_level): every summon of a doubled kind is matched by a free one
    for (const id of DOUBLED) {
      const v = this.host.skillLevel(id), was = this.lastSkill[id] ?? v;
      if (v > was && this.blessingLevel('doubling_blessing')) this.setSkill(id, v + (v - was));
      this.lastSkill[id] = this.host.skillLevel(id);
    }
    // Blessing of Summoning / Carving (AutobuySpirits.gd, AutobuyTotems.gd)
    this.autoT -= dt;
    if (this.autoT <= 0) {
      this.autoT = 0.5;
      if (this.s.auto && this.blessingLevel('blessing_of_summoning') && this.host.skillLevel('wizard_magic') > 0) this.buySkill('summon_spirit', 3);
      if (this.s.autoTotems && this.blessingLevel('blessing_of_carving') && this.host.skillLevel('summon_druid') > 0) this.buySkill('craft_totem', 1);
    }
  }
  private resyncSummons() { for (const id of DOUBLED) this.lastSkill[id] = this.host.skillLevel(id); }
  /** run start (after every module's reset): Blessing of the Tower I / II / III, Debt, Research (BuildTowerUI._new_run) */
  onRunStart() {
    const L = (id: string) => this.blessingLevel(id), H = this.H;
    const max = (id: string) => H.skillMax?.(id) ?? SKILL_MAX[id] ?? 1;
    let tower = 0;
    if (L('blessing_of_the_tower_3')) {
      tower = T_SORCERY;
      this.setSkills({ wizard_magic: max('wizard_magic'), summon_cloudling: 10, cloudling_potency: max('cloudling_potency'), summon_spirit_tome: 10,
        text_enchantment: max('text_enchantment'), summon_druid: 10, bigger_forest: max('bigger_forest'), build_academy: 1, build_dragon_nest: 1, build_embassy: 1 });
    } else if (L('blessing_of_the_tower_2')) {
      tower = T_PRESTIGE;
      this.setSkills({ wizard_magic: max('wizard_magic'), summon_cloudling: 10, cloudling_potency: 10, summon_spirit_tome: 10, text_enchantment: 7, summon_druid: 10, bigger_forest: 6 });
    } else if (L('blessing_of_the_tower')) {
      tower = T_STUDY;
      this.setSkills({ wizard_magic: max('wizard_magic'), summon_cloudling: 10, cloudling_potency: 3, summon_spirit_tome: 5, text_enchantment: 2 });
    }
    if (tower) { if (typeof H.setTowerLevel === 'function') H.setTowerLevel(tower); else if (H.S) H.S.level = tower; }
    if (L('spirit_debt')) {
      this.setSkills({ summon_cloudling: 20, summon_druid: 20, summon_spirit_tome: 20, summon_alchemist: 20 });
      if (H.S?.res) H.S.res.spirits = -100;
    }
    this.resyncSummons();
    this.runTime = 0; this.t4Logged = this.host.towerLevel() >= T_PRESTIGE;
  }

  // ================================================================ prestige action
  openPanel() {
    this.prefetchArt();
    this.mode = 'info'; this.showT = 0; this.s.seen = true; this.saveLocal();
    this.host.play('tooltip_hover', -6, 0.1);
  }
  close() { this.mode = 'closed'; if (this.H.S && this.H.S.navigated === 'prestige') this.H.S.navigated = ''; this.host.play('tooltip_hover', -8, 0.1); }
  /** Confirm: the tower dissolves into blocks that fly back into the orb, then the blessings screen */
  doPrestige() {
    if (!this.canPrestige) return;
    if (this.H.S) { this.H.S.navigated = ''; this.H.S.activeArea = ''; }
    this.mode = 'anim'; this.showT = 0;
    const r = this.towerRect(), blocks: any[] = [], D = this.host.D, bi = r && r.w * r.h > 30000 ? 3 : 2;
    const [bw, bh] = D.has('block_' + bi) ? D.size('block_' + bi) : [12, 12];
    if (r) {
      const xc = Math.ceil(r.w / bw), yc = Math.min(60, Math.ceil(r.h / (bh - 2)));
      const sy = r.h / yc;
      for (let yy = 0; yy < yc; yy++) for (let xx = 0; xx < xc; xx++) blocks.push({ x0: r.x + xx * bw, y0: r.y + yy * sy, x: 0, y: 0, k: 0, at: 0, arc: rand(30, 80), arrived: false });
      const N = blocks.length;
      blocks.forEach((b, i) => { b.at = 0.45 + 1.5 * (i / N) + rand(0, 0.12); b.x = b.x0; b.y = b.y0; });   // top rows leave first
    }
    this.anim = { t: 0, blocks, img: 'block_white_' + bi, img2: 'block_' + bi, bw, bh, hidden: false, burst: false, sparks: [] as any[] };
    this.host.play('build_whoosh', -2);
  }
  private updateAnim(dt: number) {
    const A = this.anim; A.t += dt;
    const [ox, oy] = this.host.orbPos();
    if (!A.hidden && A.t >= 0.35) { A.hidden = true; this.hideTower(); this.host.play('tower_particles', -3); }
    for (const b of A.blocks) {
      if (A.t < b.at || b.arrived) continue;
      b.k = clamp01((A.t - b.at) / 0.55);
      const e = b.k * b.k;   // ease-in: lift off, then whoosh into the orb
      b.x = b.x0 + (ox - b.x0) * e; b.y = b.y0 + (oy - b.y0) * e - Math.sin(Math.PI * b.k) * b.arc;
      if (b.k >= 1) { b.arrived = true; this.host.play('magic_material', -6, 0.05); }
    }
    if (!A.burst && A.t >= 2.7) {
      A.burst = true; this.host.play('tower_done', -2); this.host.play('fervor_max', -4);
      for (let i = 0; i < 24; i++) { const a = rand(0, Math.PI * 2), sp = rand(40, 120); A.sparks.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0 }); }
    }
    for (const p of A.sparks) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.1, dt); p.vy *= Math.pow(0.1, dt); }
    if (A.t >= 3.6) {
      const s = this.s;
      s.banked += s.run; s.run = 0; s.count++;
      this.anim = null; this.mode = 'assign'; this.showT = 0;
      this.saveLocal();
    }
  }
  /** Next Run: every module resets (permanent data kept), run-start blessings apply */
  nextRun() {
    this.saveLocal();
    this.host.play('button_click');
    const H = this.H;
    this.mode = 'closed';
    this.unhideTower();
    if (typeof H.resetRun === 'function') {           // host: core state + every module's reset(true) + onRunStart
      H.resetRun();
    } else {
      for (const m of Object.values(this.host.modules || {})) if (m && m !== this && m.reset) m.reset(true);
      this.reset(true);
      this.onRunStart();
    }
  }
  buyBlessing(id: string) {
    const b = BY_ID[id];
    if (!b || b.auto || this.mode !== 'assign') return false;
    const lv = this.s.bl[id] || 0;
    if (lv >= b.max || this.s.banked < 1 || this.allPoints() < b.req) return false;
    this.s.bl[id] = lv + 1; this.s.banked--; this.saveLocal();
    this.host.play('summon', -4);
    return true;
  }
  /** right-click refund in the original; here a Refund button on the selected blessing */
  refundBlessing(id: string) {
    const lv = this.s.bl[id] || 0; if (!lv || this.mode !== 'assign') return false;
    this.s.bl[id] = lv - 1; this.s.banked++; this.prune(); this.saveLocal(); this.host.play('button_click', -4);
    return true;
  }
  resetBlessings() {
    if (this.mode !== 'assign') return;
    this.s.banked = this.allPoints(); this.s.bl = {}; this.saveLocal();
    this.host.play('button_click', -4);
  }
  /** after a refund, blessings whose row is no longer unlocked give their points back */
  private prune() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const b of BLESSINGS) if (!b.auto && (this.s.bl[b.id] || 0) > 0 && this.allPoints() < b.req) { this.s.banked += this.s.bl[b.id]; this.s.bl[b.id] = 0; changed = true; }
    }
  }

  // ================================================================ debug (DevPanel)
  /** +n prestige levels as points gained this run (spent on the Blessings screen after Prestige) */
  debugGrant(n = 1) {
    n = Math.max(0, Math.min(Math.floor(n), PRESTIGE_TUNING.maxLevel - this.s.level));
    this.s.level += n; this.s.run += n; this.s.xp = 0;
    if (n) this.gainFx.push({ t: 0, text: '+' + n });
    this.saveLocal();
  }
  /** every blessing at max level (added as already-assigned points) */
  debugUnlockAll() {
    for (const b of BLESSINGS) if (!b.auto) this.s.bl[b.id] = b.max;
    const need = Math.max(...BLESSINGS.map(b => b.req)) - this.allPoints();
    if (need > 0) this.s.banked += need;
    this.s.level = Math.max(this.s.level, Math.min(PRESTIGE_TUNING.maxLevel, this.allPoints()));
    this.s.dlevel = Math.max(this.s.dlevel, this.allPoints() - this.s.level);
    this.saveLocal();
  }
  /** wipe all prestige progress and close the panel (the current run keeps going) */
  debugReset() { this.s = fresh(); this.saveLocal(); this.mode = 'closed'; this.anim = null; }

  // ================================================================ host shims (guarded: the host may not have them yet)
  private setSkill(id: string, v: number) { const H = this.H; if (typeof H.setSkillLevel === 'function') H.setSkillLevel(id, v); else if (H.S?.skills) H.S.skills[id] = v; }
  private setSkills(o: Record<string, number>) { for (const k in o) this.setSkill(k, Math.max(this.host.skillLevel(k), o[k])); }
  private buySkill(id: string, n: number) { const H = this.H; return typeof H.buySkill === 'function' ? H.buySkill(id, n) : 0; }
  private totemCount(kind: string) { const H = this.H; return typeof H.totemCounts === 'function' ? (H.totemCounts()[kind] || 0) : 0; }
  /** the shown tower's world rect from its anchors (top / base / left / right) */
  private towerRect(): { x: number, y: number, w: number, h: number } | null {
    const t = this.host.towerAnchor('top'), b = this.host.towerAnchor('base'), l = this.host.towerAnchor('left'), rr = this.host.towerAnchor('right');
    if (!t || !b || !l || !rr) return null;
    return { x: l[0], y: t[1], w: Math.max(8, rr[0] - l[0]), h: Math.max(8, b[1] - t[1]) };
  }
  private hideTower() { const H = this.H; if (typeof H.hideTower === 'function') H.hideTower(true); }
  private unhideTower() { const H = this.H; if (typeof H.hideTower === 'function') H.hideTower(false); }
  private biggestPopulation() {
    let best = '', bl = 0;
    for (const id of SUMMONS.concat(SORCERY_SUMMONS)) { const v = this.host.skillLevel(id); if (v > bl) { bl = v; best = id; } }
    return best;
  }
  /** Blessing of Balance (Resources.get_resource_bonuses): needs host.nextTowerCost() */
  private balance(): Record<string, number> {
    if (!this.blessingLevel('balance_blessing')) return {};
    const cost = this.H.nextTowerCost?.() as Record<string, number> | null; if (!cost) return {};
    let worst = '', ratio = 1;
    for (const k in cost) { if (k === 'cosmic_dust') continue; const r = this.host.lifetime(k) / cost[k]; if (r < ratio && r < 1) { ratio = r; worst = k; } }
    if (worst) return { [worst]: 2.5 };
    return { magic: 1.5, wood: 1.5, magic_gold: 1.5 };
  }
  /** art is loaded lazily by the host: touching the names starts their fetch before the grid / animation needs them */
  private prefetched = false;
  private prefetchArt() {
    if (this.prefetched) return; this.prefetched = true;
    const D = this.host.D;
    for (const b of BLESSINGS) for (const n of b.icon) D.has(n);
    for (const n of ['prestige_star', 'prestige_star_big', 'blessing_tile', 'blessing_tile_locked', 'blessing_tile_selected', 'block_1', 'block_2', 'block_3', 'block_white_1', 'block_white_2', 'block_white_3']) D.has(n);
  }
  private regionAt(x: number, y: number) {
    for (let i = this.regions.length - 1; i >= 0; i--) { const r = this.regions[i]; if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r; }
    return null;
  }

  // ================================================================ HUD star
  private drawStar(D: PixelDraw) {
    const { W, H, mobile } = this.host, bh = mobile ? 28 : 20, pad = 4;
    const x = W - pad - bh, y = H - bh - pad - bh - pad - 3;
    D.nine(this.flashId === 'hud' && this.flashT > 0 ? 'button_pressed' : 'button', x, y, bh, bh);
    const bob = Math.round(Math.sin(this.now * 2.5));
    this.star(D, x + bh / 2, y + bh / 2 - 3 + bob, mobile ? 12 : 10);
    D.text(String(this.s.run), x + bh / 2, y + bh - 11, this.s.run ? COL.gold : COL.white, 10, 'center');
    const k = this.s.level >= PRESTIGE_TUNING.maxLevel ? 1 : clamp01(this.s.xp / this.cap());
    D.rect(COL.ink, x, y - 4, bh, 3); D.rect(COL.gold, x, y - 4, Math.round(bh * k), 3);
    if (this.s.dxp > 0 || this.s.dlevel > 0) { const dk = clamp01(this.s.dxp / this.dcap()); D.rect(COL.ink, x, y - 8, bh, 3); D.rect(COL.red, x, y - 8, Math.round(bh * dk), 3); }
    if (!this.s.seen && Math.floor(this.now * 3) % 2) D.img(D.has('attention_icon') ? 'attention_icon' : 'magic_icon', x - 3, y - 4);
    for (const f of this.gainFx) {
      const kk = clamp01(f.t / 1.2), yy = y - 10 - 18 * kk;
      D.text(f.text, x + bh / 2 + 1, yy + 1, COL.ink, 10, 'center'); D.text(f.text, x + bh / 2, yy, COL.gold, 10, 'center');
    }
    this.regions.push({ id: 'hud', x, y: y - 8, w: bh, h: bh + 8, tap: () => this.openPanel() });
  }

  // ================================================================ panel
  private drawPanel2(D: PixelDraw) {
    const { W, H } = this.host, m = this.mode;
    if (m === 'anim') { this.drawAnim(D, W, H); return; }
    D.rect(COL.ink, 0, 0, W, H, m === 'assign' ? 0.9 : 0.6);
    this.regions.push({ id: 'block', x: 0, y: 0, w: W, h: H });
    const w = Math.min(W - 8, 262), x = Math.round(W / 2 - w / 2);
    const rise = Math.max(0, 3 * (1 - this.showT / 0.07));
    const body = this.layoutBody(D, w), h = body.h;
    const y = Math.round(Math.max(4, (H - h) / 2) + rise);
    D.nine('panel', x, y, w, h);
    this.regions.push({ id: 'panel', x, y, w, h });
    body.draw(x, y);
  }
  private layoutBody(D: PixelDraw, w: number) {
    const m = this.mode, s = this.s, ops: ((x: number, y: number) => void)[] = [];
    let cy = 0;
    const add = (h: number, f: (x: number, y: number) => void) => { const at = cy; ops.push((x, y) => f(x, y + at)); cy += h; };
    const IN = 5, iw = w - 2 * IN, early = this.early;
    add(24, (x, y) => {
      this.star(D, x + IN + 8, y + 12, 16, true);
      D.text(m === 'assign' ? 'Blessings' : early ? 'Early Prestige' : 'Prestige', x + IN + 20, y + 6, COL.white, 12);
      const lv = `Level ${s.level + s.dlevel}`; D.text(lv, x + w - IN - D.textW(lv), y + 8, COL.gold);
    });
    if (m === 'info' || m === 'confirm') {
      const exp = m === 'confirm'
        ? `Are you sure? The tower, resources, skills and walls reset. You keep your prestige level, blessings and ${s.run} new point${s.run === 1 ? '' : 's'} to spend.`
        : early ? 'You can prestige now to restart or change your blessings, but you will gain little.'
        : 'Prestige wipes this run and gives you blessings that make the next one stronger.';
      const ex = this.wrap(D, exp, iw);
      add(ex.length * 12 + 3, (x, y) => this.drawLines(D, ex, x + IN, y, m === 'confirm' ? COL.light : COL.grey));
      const bar = (label: string, icon: string, v: number, cap: number, maxed: boolean, col: string) => add(24, (x, y) => {
        D.text(label, x + IN, y + 1, COL.white);
        const lab = maxed ? 'Maxed' : `${fmt(v)} / ${fmt(cap)}`;
        if (D.has(icon)) D.img(icon, x + w - IN - D.textW(lab) - 12, y + 1);
        D.text(lab, x + w - IN - D.textW(lab), y + 1, COL.grey);
        const bx = x + IN, by = y + 12, bw = iw, bh = 8, k = maxed ? 1 : clamp01(v / cap);
        D.nine('progress_bar_background', bx - 1, by - 1, bw + 2, bh + 2);
        const fw = Math.round((bw - 2) * k); if (fw > 0) { D.rect(col, bx + 1, by + 1, fw, bh - 2); D.rect(COL.white, bx + 1, by + 1, fw, 1, 0.5); }
      });
      bar('Magic prestige', 'magic_icon', s.xp, this.cap(), s.level >= PRESTIGE_TUNING.maxLevel, COL.gold);
      if (s.dxp > 0 || s.dlevel > 0) bar('Damage prestige', 'damage_icon', s.dxp, this.dcap(), TOTAL_BLESSING_POINTS <= s.dlevel + s.level, COL.red);
      add(28, (x, y) => {
        D.rect(COL.plum, x + IN, y, iw, 25);
        D.text('Points gained this run', x + IN + 4, y + 2, COL.white);
        this.star(D, x + w - IN - 26, y + 7, 10);
        D.text(String(s.run), x + w - IN - 17, y + 2, s.run ? COL.gold : COL.grey);
        const t4 = s.t4, last = `Run ${s.count + 1}` + (t4.length ? ` - last tower 4 in ${mmss(t4[t4.length - 1])}` : '');
        D.text(last, x + IN + 4, y + 13, COL.grey);
      });
    } else {
      add(13, (x, y) => D.text('Spend points on blessings for the next run.', x + IN, y + 1, COL.grey));
      add(14, (x, y) => {
        this.star(D, x + IN + 5, y + 5, 10);
        D.text(`Points: ${s.banked}`, x + IN + 13, y + 1, s.banked ? COL.gold : COL.white);
        const asg = `Assigned: ${this.assigned()}`; D.text(asg, x + w - IN - D.textW(asg), y + 1, COL.grey);
      });
    }
    if (m !== 'confirm') {
      // blessings grid: one block per point requirement (Blessings._setup_blessing_rows), up to 9 tiles a line
      const reqs = BLESSINGS.map(b => b.req).filter((r, i, a) => a.indexOf(r) === i).sort((a, b) => a - b), T = 22, gap = 5, per = Math.max(1, Math.floor((iw - 34 + gap) / (T + gap)));   // leave room for the "N pts" label
      for (const req of reqs) {
        const row = BLESSINGS.filter(b => b.req === req), locked = this.allPoints() < req, lines = Math.ceil(row.length / per);
        add(lines * (T + 5) + 5, (x, y) => {
          D.rect(locked ? '#2f2645' : COL.plum, x + IN, y, iw, lines * (T + 5) + 2);
          row.forEach((b, i) => {
            const tx = x + IN + 3 + (i % per) * (T + gap), ty = y + 2 + Math.floor(i / per) * (T + 5);
            this.tile(D, b, tx, ty, T, locked);
            this.regions.push({ id: 'bless_' + b.id, x: tx - 2, y: ty - 2, w: T + 4, h: T + 4, tap: () => { this.sel = b.id; this.host.play('tooltip_hover', -8, 0.05); } });
          });
          if (locked) { const lab = `${req} pts`; const lx = x + w - IN - 4 - D.textW(lab), ly = y + lines * (T + 5) - 11; D.rect(COL.ink, lx - 2, ly - 1, D.textW(lab) + 4, 11, 0.8); D.text(lab, lx, ly, COL.grey); }
        });
      }
      // selected blessing (BlessingDescriptionPanel)
      const b = BY_ID[this.sel], locked = this.allPoints() < b.req, lv = this.blessingLevel(b.id);
      const desc = this.richWrap(D, b.desc + (b.auto ? `\n- Milestone: free once you own ${b.req} points` : ''), iw - 8);
      const toggle = (b.id === 'blessing_of_summoning' || b.id === 'blessing_of_carving') && lv > 0;
      const buyRow = m === 'assign' && !b.auto && !locked;
      const extra = toggle || buyRow ? 24 : 0, hh = 16 + desc.length * 12 + extra + 2;
      add(hh + 4, (x, y) => {
        D.rect('#000000', x + IN, y, iw, hh, 0.35);
        const title = b.name + (b.auto ? (lv ? '  (active)' : '') : `  ${lv}/${b.max}`);
        D.text(title, x + IN + 4, y + 3, locked ? COL.grey : lv ? COL.gold : COL.white);
        if (locked) D.text('Locked', x + w - IN - 4 - D.textW('Locked'), y + 3, COL.pink);
        this.drawRich(D, desc, x + IN + 4, y + 15, locked ? COL.dim : COL.light);
        const by = y + 16 + desc.length * 12;
        if (toggle) {
          const on = b.id === 'blessing_of_summoning' ? s.auto : s.autoTotems;
          this.btn(D, 'auto', on ? 'Auto: On' : 'Auto: Off', x + IN + 4, by, 70, 20, false, () => {
            if (b.id === 'blessing_of_summoning') s.auto = !s.auto; else s.autoTotems = !s.autoTotems; this.saveLocal(); this.host.play('button_click', -4);
          });
        } else if (buyRow) {
          this.btn(D, 'buy', lv >= b.max ? 'Maxed' : 'Bless (1 pt)', x + IN + 4, by, 84, 20, lv >= b.max || s.banked < 1, () => this.buyBlessing(b.id), true);
          this.btn(D, 'refund', 'Refund', x + IN + 92, by, 54, 20, lv === 0, () => this.refundBlessing(b.id));
        }
      });
    }
    add(32, (x, y) => {
      const bw = Math.floor((iw - 6) / 2), by = y + 4, bh = 24;
      if (m === 'info') {
        const label = this.H.S?.building ? 'Building...' : early ? (this.allPoints() ? 'Early Prestige' : 'Reach tower 4') : 'Prestige';
        this.btn(D, 'close', 'Close', x + IN, by, bw, bh, false, () => this.close());
        this.btn(D, 'prestige', label, x + IN + bw + 6, by, bw, bh, !this.canPrestige, () => { this.mode = 'confirm'; this.host.play('tooltip_hover', -6); }, true);
      } else if (m === 'confirm') {
        this.btn(D, 'cancel', 'Cancel', x + IN, by, bw, bh, false, () => { this.mode = 'info'; this.host.play('tooltip_hover', -8); });
        this.btn(D, 'confirm', 'Confirm', x + IN + bw + 6, by, bw, bh, !this.canPrestige, () => this.doPrestige(), true);
      } else {
        this.btn(D, 'reset', 'Reset', x + IN, by, bw, bh, this.assigned() === 0, () => this.resetBlessings());
        this.btn(D, 'next', 'Next Run', x + IN + bw + 6, by, bw, bh, false, () => this.nextRun(), true);
      }
    });
    cy += 2;
    return { h: cy, draw: (x: number, y: number) => { for (const f of ops) f(x, y); } };
  }
  private drawAnim(D: PixelDraw, W: number, H: number) {
    const A = this.anim, z = this.host.toScreen(1, 0)[0] - this.host.toScreen(0, 0)[0];
    this.regions.push({ id: 'block', x: 0, y: 0, w: W, h: H });
    for (const b of A.blocks) {
      if (b.arrived) continue;
      const [sx, sy] = this.host.toScreen(b.x, b.y), white = A.t < b.at + 0.12 || A.t < 0.5;
      const sc = 1 - 0.5 * b.k, name = white ? A.img : A.img2;
      if (!D.has(name)) { D.rect(white ? COL.white : COL.lilac, Math.round(sx), Math.round(sy), Math.ceil(A.bw * z * sc), Math.ceil(A.bh * z * sc)); continue; }
      D.part(name, 0, 0, A.bw, A.bh, Math.round(sx), Math.round(sy), Math.ceil(A.bw * z * sc), Math.ceil(A.bh * z * sc));
    }
    const [ox, oy] = this.host.toScreen(...this.host.orbPos());
    const got = A.blocks.filter((b: any) => b.arrived).length / Math.max(1, A.blocks.length);
    const glow = 10 + 26 * got + (A.burst ? 40 * clamp01((A.t - 2.7) / 0.5) : 0);
    D.rect(COL.gold, Math.round(ox - glow / 2), Math.round(oy - glow / 2), Math.round(glow), Math.round(glow), 0.12 + 0.2 * got);
    this.star(D, ox, oy, 12 + 20 * got, true);
    for (const p of A.sparks) { const [px, py] = this.host.toScreen(p.x, p.y), a = clamp01(1 - p.t / 0.9); if (a > 0) D.rect(p.t < 0.3 ? COL.white : COL.gold, Math.round(px), Math.round(py), 2, 2, a); }
    const f1 = A.t < 0.35 ? A.t / 0.35 : clamp01(1 - (A.t - 0.35) / 0.5);
    if (f1 > 0) D.rect(COL.white, 0, 0, W, H, 0.85 * f1);
    const f2 = clamp01((A.t - 2.75) / 0.85);
    if (f2 > 0) { D.rect(COL.light, 0, 0, W, H, Math.min(1, f2 * 1.4) * (1 - 0.1 * f2)); D.rect(COL.ink, 0, 0, W, H, 0.9 * clamp01((f2 - 0.6) / 0.4)); }
    if (A.t > 0.6 && A.t < 2.8) D.text('Prestige!', W / 2, 60, COL.gold, 12, 'center', { scale: 1 + 0.06 * Math.sin(A.t * 8) });
  }

  // ================================================================ drawing helpers
  private tile(D: PixelDraw, b: BlessingDef, x: number, y: number, T: number, locked: boolean) {
    const lv = this.blessingLevel(b.id), sel = this.sel === b.id;
    const frame = locked ? 'blessing_tile_locked' : 'blessing_tile';
    if (D.has(frame)) D.img(frame, x, y);
    else { D.rect(lv ? COL.lilac : COL.grey, x, y, T, T); D.rect(locked ? '#2f2645' : COL.tile, x + 1, y + 1, T - 2, T - 2); }
    if (b.auto) D.rect(COL.mint, x + 2, y + 2, 2, 2);   // milestone marker
    const icon = b.icon.find(n => D.has(n)) || '';
    const tint = locked ? '#5a5070' : undefined;   // icons are full colour (art-v2); only locked rows are dimmed
    if (icon) {
      const [iw, ih] = D.size(icon), k = Math.min(1, 16 / Math.max(iw, ih)), dw = Math.round(iw * k), dh = Math.round(ih * k);
      D.part(icon, 0, 0, iw, ih, Math.round(x + (T - dw) / 2), Math.round(y + (T - dh) / 2), dw, dh, { tint });
    } else D.text(b.name.split(' ').pop()!.slice(0, 2), x + T / 2, y + 6, locked ? COL.dim : COL.light, 10, 'center');
    if (locked && !D.has('blessing_tile_locked')) this.lock(D, x + T - 8, y + T - 9);
    if (!b.auto) for (let i = 0; i < b.max; i++) D.rect(i < lv ? COL.gold : '#5a5070', x + T / 2 - b.max * 2 + i * 4 + 1, y + T + 1, 3, 2);
    if (sel && D.has('blessing_tile_selected')) D.img('blessing_tile_selected', x, y);
    else if (sel) { D.rect(COL.gold, x - 1, y - 1, T + 2, 1); D.rect(COL.gold, x - 1, y + T, T + 2, 1); D.rect(COL.gold, x - 1, y, 1, T); D.rect(COL.gold, x + T, y, 1, T); }
  }
  private lock(D: PixelDraw, x: number, y: number) {
    D.rect(COL.grey, x + 1, y, 4, 1); D.rect(COL.grey, x + 1, y, 1, 3); D.rect(COL.grey, x + 4, y, 1, 3); D.rect(COL.grey, x, y + 3, 6, 4); D.rect(COL.ink, x + 2, y + 4, 2, 2);
  }
  /** a gold star: prestige_star(_big) art when present, else a pixel star */
  star(D: PixelDraw, cx: number, cy: number, size: number, big = false) {
    const name = big && D.has('prestige_star_big') ? 'prestige_star_big' : D.has('prestige_star') ? 'prestige_star' : '';
    if (name) { const [w, h] = D.size(name), k = size / w; D.part(name, 0, 0, w, h, Math.round(cx - w * k / 2), Math.round(cy - h * k / 2), Math.round(w * k), Math.round(h * k)); return; }
    const u = Math.max(1, Math.round(size / 8)), art = ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '#.....#'];
    const ox = Math.round(cx - 3.5 * u), oy = Math.round(cy - 3.5 * u);
    art.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === '#') D.rect(r < 2 ? COL.light : COL.gold, ox + c * u, oy + r * u, u, u); });
  }
  private btn(D: PixelDraw, id: string, label: string, x: number, y: number, w: number, h: number, disabled: boolean, fn: () => void, primary = false) {
    const down = this.flashId === id && this.flashT > 0;
    D.nine(disabled ? 'button_disabled' : down ? 'button_pressed' : 'button', x, y, w, h);
    D.text(label, x + w / 2, y + Math.floor((h - 10) / 2), disabled ? COL.dim : primary ? COL.gold : COL.white, 10, 'center');
    this.regions.push({ id, x, y, w, h, tap: disabled ? undefined : fn });
  }
  private wrap(D: PixelDraw, str: string, maxW: number) {
    const out: string[] = [];
    for (const para of str.split('\n')) {
      let line = '';
      for (const word of para.split(' ')) { const t = line ? line + ' ' + word : word; if (D.textW(t) > maxW && line) { out.push(line); line = word; } else line = t; }
      out.push(line);
    }
    return out;
  }
  private drawLines(D: PixelDraw, lines: string[], x: number, y: number, col: string) { lines.forEach((l, i) => D.text(l, x, y + i * 12, col)); }
  private richWrap(D: PixelDraw, str: string, maxW: number) {
    const lines: { tok: string, icon: boolean, w: number }[][] = [];
    for (const para of str.split('\n')) {
      let line: any[] = [], lw = 0;
      for (const tok of para.split(/(\{\w+_icon\}|\s+)/).filter(t => t !== '')) {
        const icon = /^\{\w+_icon\}$/.test(tok), w = icon ? ICON_W : D.textW(tok);
        if (lw + w > maxW && line.length && !/^\s+$/.test(tok)) { lines.push(line); line = []; lw = 0; }
        if (!line.length && /^\s+$/.test(tok)) continue;
        line.push({ tok, icon, w }); lw += w;
      }
      lines.push(line);
    }
    return lines;
  }
  private drawRich(D: PixelDraw, lines: { tok: string, icon: boolean, w: number }[][], x: number, y: number, col: string) {
    lines.forEach((line, i) => {
      let cx = x;
      for (const p of line) { if (p.icon) { const n = p.tok.slice(1, -1); if (D.has(n)) D.img(n, Math.round(cx), y + i * 12); } else D.text(p.tok, cx, y + i * 12, col); cx += p.w; }
    });
  }

  // ================================================================ persistence
  private apply(o: any) { this.s = { ...fresh(), ...this.s, ...o, bl: { ...(o.bl || this.s.bl || {}) }, t4: Array.isArray(o.t4) ? o.t4 : this.s.t4 }; }
  private loadLocal() {
    try { const v = sys.localStorage.getItem(SAVE_KEY); if (v) { const o = JSON.parse(v); if (o && typeof o === 'object') this.apply(o); } } catch (e) { /* private mode / corrupt */ }
  }
  saveLocal() {
    this.dirty = false;
    try { sys.localStorage.setItem(SAVE_KEY, JSON.stringify(this.s)); } catch (e) { /* ignore */ }
  }
}

export const prestige = new PrestigeModule();
registerModule(prestige);
