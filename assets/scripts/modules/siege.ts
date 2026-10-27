// Siege (towers 7-10): the three sky walls, the Wall Wizard (Warden), Wall Repair, status effects, the Fire Magic Beam,
// the Final Ascension and the ending. Port of Wall.gd, WallBreakAnimation.gd / SolarWallBreakAnimation.gd /
// CosmicWallBreakAnimation.gd, WallRepair.gd, StoryTracker.gd + StoryDialog.gd, Warden.gd + WardenUI.gd,
// EndingAnimation.gd + EndScreen.gd. Story beats follow label.story_1..5, written in our own words.
// Demo addition: after the Fire Magic Beam breaks the Cosmic Wall the Warden fights back (3 phases) before he
// concedes (story_5) and offers his enchantments. Swipe-casting fires bolts at the wall / Warden.
//
// API for other modules (host.modules.siege, always guard for a missing module):
//   damage(amount, sourceId, wx, wy, opts?: { skipMult?, effect? }) -> final damage (0 when not targetable)
//   addStatus(id, stacks) / statusStacks(id) / clearStatus(id)   ids: frost, molten, weakened, cursed, resonance ('shatter' alias)
//   targetable(), wallLevel() (Wall.get_wall_level), brokenWalls(), wallPos() -> [x, bottomY], wallY()
//   onDamage(fn(final, sourceId, wallLevel)), dpm() (damage per minute, last 60 s), curseBaseDamage() (sorcery's WallCurse)
//   towerGate(level) -> reason | null, towerButton(level) -> null | { label, cost, disabled, onPress? }
//   onOrbClick(sx, sy, fervor01): swipe bolt from the finger. debugJump(stage), debugDamage(fraction).
import { director } from 'cc';
import { registerModule, GameHost, GameModule, SkillDef } from '../GameModule';
import type { PixelDraw } from '../PixelDraw';

// ---------------------------------------------------------------- original numbers
const WALL_HP = [2e7, 5e9, Infinity];              // Wall.max_healths (the Cosmic Wall cannot be worn down)
const REPAIR_PER_MIN = 500e6;                       // WallRepair.repair_rate_per_minute (Solar Wall only), ticks every 1 s
const REPAIR_RAYS = 7;
const FIRE_MAGIC_DUST = 42, FINAL_ASCENSION_DUST = 50;
const ENCHANT_DUST = 2;
const EFFECTS_DECAY = 75;                           // Blessing of Effects: decay only above 75 stacks per level
const MIDWAY_PCT = 50, COMBAT_MAGIC_PCT = 50, WEAKENED_PCT = 1;
// ---------------------------------------------------------------- demo tuning (bolts + boss)
export const SIEGE_TUNING = {
  wallGap: [200, 210, 220],         // world px from the orb up to the wall centre (towers 7 / 8 / 9)
  boltFloor: 0.0004,                // a swipe bolt deals at least this share of the target's max HP ...
  boltDpmShare: 0.02 / 60,          // ... or 2% of a second of the current damage output
  fervorK: 4, fervorExp: 2,         // swipe bolt x (1 + 4 f^2), f = fervor fill 0..1
  bossMinHp: 1e9, bossSeconds: 150, // Warden HP = max(min, current damage per second x 150 s)
  bossPhases: [0.37, 0.33, 0.30],   // share of the Warden's HP per phase
  curse: [{ interval: 2.6, speed: 40, count: 1 }, { interval: 3.4, speed: 38, count: 1 }, { interval: 1.3, speed: 62, count: 2 }],
  curseSteal: [0.05, 0.05, 0.08],   // share of banked magic an unpopped curse orb steals
  shieldFervor: 0.5,                // P2: only swipe bolts at fervor fill >= 0.5 (x1.5) pierce the shield
  popRadius: 9, fingerSlop: 14, boltSpeed: 340,
};
const T = SIEGE_TUNING;
const PHASE2_AT = 1 - T.bossPhases[0], PHASE3_AT = T.bossPhases[2];

const COL = { ink: '#2a1f3d', light: '#fff1d6', white: '#ffffff', pink: '#ff8fb1', mint: '#8ff5e4', gold: '#ffd456', lilac: '#a882f5', violet: '#6545b5', grey: '#a8a3b8', red: '#ff5a6e' };
const WALLS = [
  { id: 'cloud', name: 'Cloud Wall', img: 'cloud_wall', orig: 'cloud_wall_1', shard: ['#ffffff', '#e4f0ff', '#c7d9f7'], base: '#f4f8ff', shade: '#c7d9f7' },
  { id: 'solar', name: 'Solar Wall', img: 'solar_wall', orig: 'solar_wall', shard: ['#ffd456', '#fff1a8', '#f2a541'], base: '#ffd456', shade: '#f2a541' },
  { id: 'cosmic', name: 'Cosmic Wall', img: 'cosmic_wall', orig: 'cosmic_wall', shard: ['#3b2a6e', '#a882f5', '#8ff5e4'], base: '#3b2a6e', shade: '#2a1f3d' },
];
const STATUS = [   // StatusEffectDef ids + names (resonance is shown as "Shatter")
  { id: 'weakened', name: 'Weakened', col: '#ff8fb1' }, { id: 'molten', name: 'Molten', col: '#f2a541' }, { id: 'cursed', name: 'Cursed', col: '#a882f5' },
  { id: 'frost', name: 'Frost', col: '#8ff5e4' }, { id: 'resonance', name: 'Shatter', col: '#ffd456' },
];
const SOURCE_NAMES: Record<string, string> = { gorgon: 'Gorgons', shaman: 'Shamans', ifrit: 'Ifrits', zephyr: 'Zephyrs', curse: 'Curse', dragon: 'Dragon Fireballs',
  fireball_shrapnel: 'Shrapnel', spirit_sage: 'Spirit Sages', fire_arrows: 'Fire Arrows', ice_arrows: 'Ice Arrows', orb_bolt: 'Orb Bolts', wall_repair: 'Wall Repair' };

type Who = 'warden' | 'orb';
interface Line { who: Who, text: string, button?: string }
// StoryDialog beats (label.story_1..5) in our own words, plus the demo's boss fight
const STORY: Record<string, Line[]> = {
  wall1: [
    { who: 'warden', text: "Well, well. Quite the little civilization you've raised down there. But this tower climbs no higher." },
    { who: 'warden', text: 'Behold my great wall. Nothing ascends past it.', button: "Just Watch Me" },
  ],
  wall2: [{ who: 'warden', text: 'Hmm. It seems I misjudged you. But this wall, you will NOT pass.', button: "Just Watch Me" }],
  wall3: [{ who: 'warden', text: "Very well, let's strike a bargain. Bring this wall down and I'll stand aside for good.", button: 'OK' }],
  bossIntro: [
    { who: 'warden', text: 'I said I would stand aside...' },
    { who: 'warden', text: "...I never said I'd make it easy! Have some curses!" },
    { who: 'orb', text: 'Swipe through his curse orbs to pop them, or they will steal our magic!', button: "Let's Go" },
  ],
  defeat: [
    { who: 'warden', text: 'Enough, enough! I yield.' },
    { who: 'warden', text: "Your determination impresses me. Perhaps I'll stay a while and lend a hand, just to see how this ends.", button: 'OK' },
  ],
};
const BARKS = { p2: 'Try piercing THIS shield!', p3: 'No more holding back!', block: ['Ha! Tickles!', 'Too slow!', 'Is that all?'] };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (k: number) => Math.min(Math.max(k, 0), 1);
const easeOutExpo = (k: number) => k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);
const easeOutBack = (k: number) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const easeInOutSine = (k: number) => -(Math.cos(Math.PI * clamp01(k)) - 1) / 2;
function fmt(n: number): string {
  if (!isFinite(n)) return 'INF';
  n = Math.floor(n);
  if (n < 10000) return String(Math.max(0, n));
  const suf = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  const e = Math.floor(Math.log10(n) + 0.00001), se = 3 * Math.floor(e / 3), d = n / 10 ** se, digits = String(Math.floor(d)).length, s = suf[se / 3];
  if (s === undefined) return n.toExponential(2);
  if (digits >= 3) return Math.floor(d) + s;
  if (digits === 2) return (Math.floor(d * 10) / 10).toFixed(1) + s;
  return (Math.floor(d * 100) / 100).toFixed(2) + s;
}
const hms = (s: number) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s) % 60].map(v => String(v).padStart(2, '0')).join(':');
function lerpCol(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map(sh => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * k));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
function fervorCol(f: number) { return f < 0.5 ? lerpCol('#7ef0c8', '#ff8fb1', f * 2) : lerpCol('#ff8fb1', '#ffd166', (f - 0.5) * 2); }
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, k = l2 ? clamp01(((px - ax) * dx + (py - ay) * dy) / l2) : 0;
  return Math.hypot(px - (ax + dx * k), py - (ay + dy * k));
}

type Stage = 'idle' | 'intro' | 'wall' | 'broken' | 'await' | 'beam' | 'bossIntro' | 'boss' | 'defeat' | 'free' | 'ending' | 'complete';
interface Bolt { x0: number, y0: number, ox: number, oy: number, t: number, dur: number, bend: number, dmg: number, f: number }
interface Rect { x: number, y: number, w: number, h: number }

const ENCHANT = (id: string, name: string, tip: string): SkillDef => ({ list: 'warden', name, res: 'cosmic_dust', cost: () => ENCHANT_DUST, max: 1, icon: null,
  tip: () => tip + '\n\n- Also increases {cosmic_dust_icon} creation speed by 50%' });

class SiegeModule implements GameModule {
  id = 'siege';
  unlockTower = 7;
  nav = { label: 'Wall' };
  drawsImpacts = false;
  // BuildTowerUI.can_build: Cloud Wall gates 7->8, Solar Wall 8->9; 9->10 is the Final Ascension once the Warden is beaten
  towers: any[] = [
    { level: 8, gate: () => this.towerGate(8) },
    { level: 9, gate: () => this.towerGate(9) },
    { level: 10, gate: () => this.towerGate(10), label: () => this.broken >= 3 ? 'The Final Ascension' : 'Fire Magic Beam' },
  ];
  skills: Record<string, SkillDef> = {
    enchant_frost: ENCHANT('enchant_frost', 'Frost Enchantment', 'Every Frost stack adds 1% to {wood_icon} income'),
    enchant_molten: ENCHANT('enchant_molten', 'Molten Enchantment', 'Every Molten stack adds 1% to Dragon EXP'),
    enchant_shatter: ENCHANT('enchant_shatter', 'Shatter Enchantment', 'Every Shatter stack makes {blank_rune_icon} 1% faster'),
  };
  private h!: GameHost;
  // saved state (Wall.save_data, StoryTracker, WardenUI)
  broken = 0; dmgTaken = 0; status: Record<string, number> = {};
  story = { w1: false, w2: false, w3: false, ww: false };
  wardenFree = false; restore = false; bossDone = false; endingDone = false;
  // runtime
  stage: Stage = 'idle'; t = 0; wallIdx = 0; wallCY = 0;
  private listeners: ((final: number, src: string, level: number) => void)[] = [];
  private dmgLog: { t: number, v: number }[] = []; private now = 0;
  private statusT = 0; private repairT = 0; private repairRays = 0; private repairShown = 0;
  private bolts: Bolt[] = []; private nums: any[] = []; private fx: any[] = []; private shards: any[] = []; private trail: any[] = []; private curses: any[] = [];
  private dlg: { lines: Line[], i: number, t: number, then: (() => void) | null } | null = null;
  private bark: { text: string, t: number } | null = null;
  private flash = 0; private flashCol = '#ffffff'; private wallFlash = 0; private wallKick = 0;
  private warden = { x: 0, y: 0, vis: false, a: 0 };
  // boss
  bossHp = 0; bossMax = 1; phase = 1; bossT = 0; bossTime = 0; popped = 0; maxFervor = 0;
  private invuln = 0; private curseT = 0; private hurtT = 0; private castT = 0; private shieldPop = 0; private blockBarkT = 0;
  private endT = 0; private endStats: any = null; private gateK = 0;
  private lastFinger: [number, number] | null = null;
  private dlgRect: Rect | null = null; private againRect: Rect | null = null; private restoreRect: Rect | null = null; private panelRect: Rect | null = null;
  private pressed = '';

  init(host: GameHost) { this.h = host; }

  // ================================================================ API: damage, status, wall state
  /** Wall.damage */
  damage(amount: number, src: string, wx?: number, wy?: number, opts?: { skipMult?: boolean, effect?: string }): number {
    if (!this.targetable() || !(amount > 0)) return 0;
    const fin = opts && opts.skipMult ? amount : amount * this.damageMult();
    const [px, py] = wx !== undefined && wy !== undefined ? [wx, wy] : this.wallPos();
    if (this.stage === 'boss') return this.damageBoss(fin, src, px, py);
    if (isFinite(WALL_HP[this.broken])) this.dmgTaken = Math.min(this.dmgTaken + fin, WALL_HP[this.broken]);
    else this.dmgTaken += fin;
    this.record(fin, src, px, py);
    this.wallFlash = 0.06; this.wallKick = Math.min(3, this.wallKick + 0.6);
    if (this.dmgTaken >= WALL_HP[this.broken]) this.breakWall();
    return fin;
  }
  /** Wall.get_damage_multiplier: Midway Blessing x Weakened x Combat Magic (x every module's 'damage' multiplier, e.g. Janand) */
  damageMult() {
    const h = this.h, p: any = h.modules['prestige'];
    const midway = 1 + (p && p.blessingLevel ? p.blessingLevel('midway_blessing') || 0 : 0) * MIDWAY_PCT / 100;
    return midway * (1 + this.statusStacks('weakened') * WEAKENED_PCT / 100) * (1 + h.skillLevel('combat_magic') * COMBAT_MAGIC_PCT / 100) * (h.mult('damage') || 1);
  }
  addStatus(id: string, stacks: number) {
    if (id === 'shatter') id = 'resonance';
    this.status[id] = Math.max(0, (this.status[id] || 0) + stacks);
  }
  statusStacks(id: string): number { if (id === 'shatter') id = 'resonance'; return Math.floor(this.status[id] || 0); }
  clearStatus(id: string) { if (id === 'shatter') id = 'resonance'; delete this.status[id]; }
  targetable(): boolean {
    if (this.dlg) return false;
    return this.stage === 'wall' || this.stage === 'boss' || (this.stage === 'free' && this.restore);
  }
  /** Wall.get_wall_level: which wall graphics are current (0 cloud, 1 solar, 2 cosmic) */
  wallLevel(): number { const b = this.broken; return b === 0 ? 0 : b === 1 ? (this.targetable() ? 1 : 0) : b === 2 ? (this.targetable() ? 2 : 1) : 2; }
  brokenWalls() { return this.broken; }
  /** world y where projectiles count as hitting (bottom edge of the wall, or the Warden during the fight) */
  wallY() { return this.wallPos()[1]; }
  wallPos(): [number, number] {
    if (this.stage === 'boss') return [this.warden.x, this.warden.y + 18];
    return [this.towerX(), this.wallCY + this.wallSize()[1] / 2];
  }
  onDamage(fn: (final: number, src: string, level: number) => void) { this.listeners.push(fn); }
  /** damage per minute over the last 60 s (DamageChart) */
  dpm() { let s = 0; for (const d of this.dmgLog) s += d.v; return s * 60 / Math.max(10, Math.min(60, this.now)); }
  curseBaseDamage() { const s: any = this.h.modules['sorcery']; return s && s.curseBase ? s.curseBase() : 0; }
  /** BuildTowerUI.can_build: towers 8 / 9 need the wall below them broken */
  towerGate(level: number): string | null {
    if (level === 8 && this.broken < 1) return 'Break the wall overhead to keep building.';
    if (level === 9 && this.broken < 2) return 'Break the wall overhead to keep building.';
    if (level === 10 && this.broken < 3) return 'Break the Cosmic Wall first.';
    if (level === 10 && !this.wardenFree) return 'The Wall Wizard still stands in your way.';
    return null;
  }
  /** tower 9's build button: "Fire Magic Beam" until the Cosmic Wall breaks, then "The Final Ascension" (BuildTowerUI.update_ui) */
  towerButton(level: number): { label: string, cost: Record<string, number>, disabled: boolean, reason?: string, onPress?: () => void } | null {
    if (level !== 9) return null;
    const h = this.h, dust = h.res('cosmic_dust');
    if (this.broken < 3) {
      const analyzed = h.skillLevel('analyze_wall') > 0;
      return { label: 'Fire Magic Beam', cost: { cosmic_dust: FIRE_MAGIC_DUST }, disabled: !analyzed || dust < FIRE_MAGIC_DUST || this.stage !== 'wall',
        reason: analyzed ? 'The Astrologer found a way: with the right resources, The Orb can blast the wall apart.' : 'Analyze the Cosmic Wall at the Observatory',
        onPress: () => { if (h.spend('cosmic_dust', FIRE_MAGIC_DUST)) this.fireBeam(); } };
    }
    return { label: 'The Final Ascension', cost: { cosmic_dust: FINAL_ASCENSION_DUST }, disabled: !this.wardenFree || dust < FINAL_ASCENSION_DUST,
      reason: 'One last climb. Are you ready?' };
  }
  /** host: every orb click (swipe-cast or tap), screen position of the finger */
  onOrbClick(sx: number, sy: number, fervor01: number) {
    if (!this.targetable()) return;
    const f = clamp01(fervor01), [wx, wy] = this.h.toWorld(sx, sy);
    this.maxFervor = Math.max(this.maxFervor, f);
    const max = this.stage === 'boss' ? this.bossMax : isFinite(WALL_HP[this.broken]) ? WALL_HP[this.broken] : this.bossEstimate();
    const base = Math.max(max * T.boltFloor, this.dpm() * T.boltDpmShare);
    this.launch(wx, wy, base * (1 + T.fervorK * Math.pow(f, T.fervorExp)), f);
  }

  // ================================================================ flow
  private towerX() { return this.h.orbPos()[0]; }
  private setStage(s: Stage) { this.stage = s; this.t = 0; }
  private say(key: string, then: (() => void) | null = null) { this.dlg = { lines: STORY[key], i: 0, t: 0, then }; this.h.play('dialog_open', -6); }
  private wallSize(): [number, number] { const w = WALLS[Math.min(this.wallIdx, 2)]; return this.D.has(w.img) ? this.D.size(w.img) : this.D.has(w.orig) ? this.D.size(w.orig) : [150, 40]; }
  private get D() { return this.h.D; }
  private zoom() { return this.h.toScreen(1, 0)[0] - this.h.toScreen(0, 0)[0]; }
  private frame(top: number, bottom: number) { this.h.camFocus(this.towerX(), (top + bottom) / 2, Math.max(0.4, Math.min(1.2, (this.h.H * 0.62) / Math.max(60, bottom - top)))); }
  private frameWall() { const [, oy] = this.h.orbPos(); this.frame(this.wallCY - this.wallSize()[1] / 2 - 95, oy + 60); }   // room for the Warden under the HP bar
  private placeWall(idx: number) { this.wallIdx = idx; this.wallCY = this.h.orbPos()[1] - T.wallGap[idx]; }
  /** tower reached 7 / 8 / 9: the Warden appears through his portal and raises the next wall (StoryDialog._on_tower_animation_finished) */
  private introduceWall(idx: number) {
    this.placeWall(idx); this.dmgTaken = 0;
    for (const k in this.status) this.status[k] = 0;   // Wall._on_tower_animation_finished: effects reset per wall
    this.setStage('intro');
    this.warden.vis = true; this.warden.a = 0; [this.warden.x, this.warden.y] = this.wardenSpot();
    this.frameWall(); this.h.play('warden_appear');
    const key = idx === 0 ? 'wall1' : idx === 1 ? 'wall2' : 'wall3', seen = idx === 0 ? this.story.w1 : idx === 1 ? this.story.w2 : this.story.w3;
    const start = () => { this.setStage('wall'); if (idx === 0) this.story.w1 = true; else if (idx === 1) this.story.w2 = true; else this.story.w3 = true; };
    if (seen) start(); else this.say(key, start);
  }
  private breakWall() {
    const i = this.broken;
    this.broken = i + 1; this.dmgTaken = 0;
    this.setStage('broken');
    this.flash = 1; this.flashCol = i === 2 ? '#ffffff' : '#fff1d6';
    this.h.play('wall_break', 3); this.shake(6, 0.6);
    const [ww, wh] = this.wallSize(), w = WALLS[i], cx = this.towerX(), x0 = cx - ww / 2, y0 = this.wallCY - wh / 2;
    for (let k = 0; k < 50; k++) {
      const x = x0 + Math.random() * ww, y = y0 + Math.random() * wh, a = Math.atan2(y - this.wallCY, x - cx), sp = rand(40, 140);
      this.shards.push({ x, y, vx: Math.cos(a) * sp + rand(-30, 30), vy: Math.sin(a) * sp - rand(40, 120), r: rand(0, 6.28), vr: rand(-8, 8),
        s: rand(3, 7), col: w.shard[k % 3], img: 'wall_shard_' + (k % 3), t: 0, life: rand(1.4, 2.4) });
    }
    for (let k = 0; k < 12; k++) this.addFx(x0 + Math.random() * ww, y0 + Math.random() * wh, 'sparkles_' + (k % 4), 11, 4, rand(0.4, 0.7), 2);
    this.bolts = [];
  }
  /** BuildTowerUI.fire_beam -> EndingAnimation._on_fire_beam: the Orb charges and a beam of light breaks the Cosmic Wall */
  private fireBeam() { this.setStage('beam'); this.h.play('beam_charge', -5); this.frameWall(); }
  private startBoss() {
    this.setStage('boss');
    this.bossMax = this.bossHp = this.bossEstimate(); this.phase = 1; this.invuln = 0.8; this.bossT = 0; this.curseT = 1.2;
    this.warden.vis = true; this.warden.a = 1;
    const [, oy] = this.h.orbPos(); this.frame(this.wallCY - 70, oy + 60);
    this.h.play('boss_start');
  }
  private bossEstimate() { return Math.max(T.bossMinHp, this.dpm() / 60 * T.bossSeconds); }
  private defeat() {
    this.setStage('defeat');
    this.bossTime = this.bossT; this.bossDone = true;
    for (const cu of this.curses) this.addFx(cu.x, cu.y, 'curse_pop', 16, 4, 0.3, 1);
    this.curses = []; this.bolts = [];
    this.flash = 1; this.flashCol = '#ffffff'; this.shake(5, 0.5);
    this.h.play('boss_defeat', 3);
    this.say('defeat', () => this.freeWarden());
  }
  /** story_5 done: Warden.unlock_feature (enchantments + restore wall toggle in the Wall panel) */
  private freeWarden() {
    this.wardenFree = true; this.story.ww = true; this.setStage('free');
    this.h.toast('The Wall Wizard joins you!');
    this.h.play('unlock');
  }
  private startEnding() {
    this.setStage('ending'); this.endingDone = true;
    this.shake(3, 2.5); this.h.play('tower_launch', -4);
  }
  private finish() {
    this.setStage('complete');
    this.endStats = { time: this.h.S.time || 0, magic: this.h.lifetime('magic'), fervor: 1 + this.maxFervor, boss: this.bossTime, popped: this.popped };
    this.h.play('victory', 2);
  }
  private shake(px: number, dur: number) { const h: any = this.h; if (h.shake) h.shake(px, dur); }
  private record(fin: number, src: string, x: number, y: number) {
    this.dmgLog.push({ t: this.now, v: fin });
    this.num(x, y, fmt(fin), src === 'orb_bolt' ? COL.gold : COL.white, src === 'orb_bolt' && fin > 0);
    const lv = this.wallLevel();
    for (const fn of this.listeners) fn(fin, src, lv);
    const s: any = this.h.modules['sorcery']; if (s && s.onWallDamaged) s.onWallDamaged(src, fin);
    const p: any = this.h.modules['prestige']; if (p && p.onDamage) p.onDamage(fin);
  }

  // ================================================================ boss
  private damageBoss(fin: number, src: string, x: number, y: number): number {
    if (this.invuln > 0) return 0;
    const swipe = src === 'orb_bolt' && this.boltFervor >= T.shieldFervor;
    if (this.phase === 2 && !swipe) {
      this.shieldPop = 0.15; this.h.play('shield_block', -8, 0.08);
      if (src === 'orb_bolt') { this.num(x, y, 'BLOCK', COL.grey, false); if (this.blockBarkT <= 0) { this.blockBarkT = 4; this.bark = { text: BARKS.block[Math.floor(Math.random() * 3)], t: 0 }; } }
      return 0;
    }
    this.bossHp -= fin; this.hurtT = 0.12; this.h.play('warden_hurt', -8, 0.1);
    this.record(fin, src, x, y);
    const k = this.bossHp / this.bossMax;
    if (this.phase === 1 && k <= PHASE2_AT) {
      this.phase = 2; this.invuln = 1.2; this.bossHp = this.bossMax * PHASE2_AT; this.bark = { text: BARKS.p2, t: 0 }; this.shieldPop = 0.6;
      this.h.play('boss_phase'); this.shake(3, 0.4);
    } else if (this.phase === 2 && k <= PHASE3_AT) {
      this.phase = 3; this.invuln = 1.2; this.bossHp = this.bossMax * PHASE3_AT; this.bark = { text: BARKS.p3, t: 0 };
      this.h.play('boss_phase'); this.shake(4, 0.5); this.flash = 0.6; this.flashCol = COL.pink;
    }
    if (this.bossHp <= 0) { this.bossHp = 0; this.defeat(); }
    return fin;
  }
  private boltFervor = 0;   // fervor of the swipe bolt being applied (P2 shield check)
  private spawnCurses() {
    const p = T.curse[this.phase - 1], [ox, oy] = this.h.orbPos();
    for (let k = 0; k < p.count; k++) {
      const sx = this.warden.x + (k - (p.count - 1) / 2) * 14, sy = this.warden.y + 6;
      const a = Math.atan2(oy - sy, ox - sx) + (p.count > 1 ? (k - 0.5) * 0.5 : rand(-0.2, 0.2));
      this.curses.push({ x: sx, y: sy, vx: Math.cos(a) * p.speed, vy: Math.sin(a) * p.speed, speed: p.speed, t: 0, wob: rand(0, 6.28) });
    }
    this.castT = 0.45; this.h.play('curse_throw', -6);
  }
  private popAlong(a: [number, number], b: [number, number]) {
    const r = T.popRadius + T.fingerSlop / this.zoom();
    for (let i = this.curses.length - 1; i >= 0; i--) {
      const cu = this.curses[i];
      if (segDist(cu.x, cu.y, a[0], a[1], b[0], b[1]) > r) continue;
      this.curses.splice(i, 1); this.popped++;
      this.addFx(cu.x, cu.y, 'curse_pop', 16, 4, 0.3, 1.2);
      for (let k = 0; k < 5; k++) this.trail.push({ x: cu.x, y: cu.y, vx: rand(-60, 60), vy: rand(-60, 60), t: 0, life: 0.3, img: 'bright_spirit' });
      this.h.play('curse_pop', -4, 0.03);
    }
  }

  // ================================================================ bolts / fx
  private launch(x: number, y: number, dmg: number, f: number) {
    const [ww, wh] = this.stage === 'boss' ? [14, 18] : this.wallSize();
    const ox = rand(-0.35, 0.35) * Math.min(ww, 200), oy = rand(-0.25, 0.3) * wh, [tx, ty] = this.boltTarget(), d = Math.hypot(tx + ox - x, ty + oy - y);
    this.bolts.push({ x0: x, y0: y, ox, oy, t: 0, dur: Math.max(0.18, d / T.boltSpeed), bend: rand(-0.25, 0.25), dmg, f });
    if (this.bolts.length > 60) this.bolts.shift();
    this.h.play('bolt_swipe', -10, 0.05);
  }
  private boltTarget(): [number, number] { return this.stage === 'boss' ? [this.warden.x, this.warden.y] : [this.towerX(), this.wallCY]; }
  private boltPos(b: Bolt): [number, number] {
    const [tx0, ty0] = this.boltTarget(), tx = tx0 + b.ox, ty = ty0 + b.oy, k = clamp01(b.t / b.dur);
    const dx = tx - b.x0, dy = ty - b.y0, cx = b.x0 + dx / 2 - dy * b.bend, cy = b.y0 + dy / 2 + dx * b.bend, u = 1 - k;
    return [u * u * b.x0 + 2 * u * k * cx + k * k * tx, u * u * b.y0 + 2 * u * k * cy + k * k * ty];
  }
  private num(x: number, y: number, text: string, col: string, big: boolean) {
    if (this.nums.length > 40) this.nums.shift();
    this.nums.push({ x, y, text, col, big, t: 0, life: big ? 0.9 : 0.7, dx: rand(-8, 8) });
  }
  private addFx(x: number, y: number, img: string, fw: number, frames: number, life: number, sc: number) {
    if (this.fx.length > 80) this.fx.shift();
    this.fx.push({ x, y, img, fw, frames, life, sc, t: 0 });
  }

  // ================================================================ update
  update(dt: number) {
    const h = this.h, lvl = h.towerLevel();
    this.now += dt; this.t += dt;
    while (this.dmgLog.length && this.dmgLog[0].t < this.now - 60) this.dmgLog.shift();
    // Wall._process_status_effects: every 0.1 s, stacks above the decay start lose ((stacks - start) / 100)^1.15
    this.statusT += dt;
    while (this.statusT >= 0.1) {
      this.statusT -= 0.1;
      const p: any = h.modules['prestige'], start0 = (p && p.blessingLevel ? p.blessingLevel('blessing_of_effects') || 0 : 0) * EFFECTS_DECAY;
      for (const id in this.status) {
        const start = start0 + (id === 'frost' ? 0 : this.statusStacks('frost'));
        this.status[id] = Math.max(0, this.status[id] - Math.pow(Math.max(0, this.status[id] - start) / 100, 1.15));
        if (this.status[id] <= 0) delete this.status[id];
      }
    }
    // tower progress drives the walls
    if (this.stage === 'idle' && lvl >= 7 && this.broken === 0) this.introduceWall(0);
    if (this.stage === 'await' && !h.S.building && lvl >= 7 + this.broken && this.broken < 3) this.introduceWall(this.broken);
    if ((this.stage === 'free' || this.stage === 'await') && lvl >= 10 && !this.endingDone && !h.S.building) this.startEnding();
    if (this.dlg) this.dlg.t += dt;
    if (this.bark) { this.bark.t += dt; if (this.bark.t > 2.6) this.bark = null; }
    this.flash = Math.max(0, this.flash - dt * 3); this.wallFlash = Math.max(0, this.wallFlash - dt); this.wallKick = Math.max(0, this.wallKick - dt * 12);
    this.hurtT = Math.max(0, this.hurtT - dt); this.castT = Math.max(0, this.castT - dt); this.shieldPop = Math.max(0, this.shieldPop - dt);
    this.invuln = Math.max(0, this.invuln - dt); this.blockBarkT = Math.max(0, this.blockBarkT - dt);
    const s = this.stage;
    if (s === 'broken' && this.t >= 1.6) {
      if (this.broken === 3) { this.setStage('bossIntro'); this.say('bossIntro', () => this.startBoss()); }
      else { this.setStage('await'); h.toast(`Tower ${7 + this.broken} can now be built!`); h.play('unlock'); }
    }
    if (s === 'beam' && this.t >= 2.4) { this.wallIdx = 2; this.breakWall(); }
    if (s === 'ending' && this.t >= 9) this.finish();
    if (s === 'complete') this.endT += dt;
    // WallRepair.calc_damage: the Solar Wall heals 500M per minute, once a second, shown as up to 7 rays
    if (this.broken === 1 && this.stage === 'wall') {
      this.repairT += dt;
      if (this.repairT >= 1) {
        this.repairT -= 1;
        const amount = Math.min(REPAIR_PER_MIN / 60, this.dmgTaken);
        this.dmgTaken -= amount; this.repairShown = amount;
        this.repairRays = Math.min(REPAIR_RAYS, Math.ceil(amount / (REPAIR_PER_MIN / 60 / REPAIR_RAYS)));
        if (amount > 0) {
          const sc: any = h.modules['sorcery']; if (sc && sc.onWallRepaired) sc.onWallRepaired(amount);
          this.num(this.towerX() + rand(-60, 60), this.wallCY + 10, '+' + fmt(amount), COL.mint, false);
        }
      }
    } else this.repairRays = 0;
    // the Warden
    const w = this.warden;
    if (w.vis) {
      w.a = Math.min(1, w.a + dt / 0.6);
      const [tx, ty] = this.wardenSpot(), k = Math.min(1, dt * (s === 'boss' ? 6 : 3));
      w.x += (tx - w.x) * k; w.y += (ty - w.y) * k;
    }
    if (s === 'boss') {
      this.bossT += dt; this.curseT -= dt;
      if (this.curseT <= 0 && this.invuln <= 0) { this.spawnCurses(); this.curseT = T.curse[this.phase - 1].interval * rand(0.85, 1.15); }
    }
    const sky: any = (h as any).sky || (h.modules as any)['sky'];
    if (sky && sky.setBossMode) { sky.setBossMode(s === 'boss'); if (sky.setVortex) sky.setVortex(s === 'boss' ? w.x : null, w.y); }
    // bolts
    const bolts = this.bolts;
    for (let i = bolts.length - 1; i >= 0 && this.bolts === bolts; i--) {
      const b = bolts[i]; b.t += dt;
      const [x, y] = this.boltPos(b);
      if (Math.random() < 0.8) this.trail.push({ x: x + rand(-1, 1), y: y + rand(-1, 1), vx: rand(-8, 8), vy: rand(-8, 8), t: 0, life: rand(0.15, 0.3), img: b.f >= 0.5 ? 'bright_spirit' : 'cloudling_ball' });
      if (b.t < b.dur) continue;
      bolts.splice(i, 1);
      this.boltFervor = b.f;
      const fin = this.damage(b.dmg, 'orb_bolt', x, y);
      this.boltFervor = 0;
      if (fin > 0) this.addFx(x, y, this.D.has('wall_hit') ? 'wall_hit' : 'click_particles', this.D.has('wall_hit') ? 16 : 9, 4, 0.25, 1.2);
    }
    // curse orbs home in on the orb; the casting finger pops them
    const [ox, oy] = h.orbPos();
    for (let i = this.curses.length - 1; i >= 0; i--) {
      const cu = this.curses[i]; cu.t += dt;
      const dx = ox - cu.x, dy = oy - cu.y, d = Math.hypot(dx, dy) || 1, turn = Math.min(1, dt * 1.5);
      cu.vx += (dx / d * cu.speed - cu.vx) * turn; cu.vy += (dy / d * cu.speed - cu.vy) * turn;
      const wob = Math.sin(cu.t * 5 + cu.wob) * 14;
      cu.x += (cu.vx - dy / d * wob) * dt; cu.y += (cu.vy + dx / d * wob) * dt;
      if (d < 10) {
        this.curses.splice(i, 1);
        const want = h.res('magic') * T.curseSteal[this.phase - 1];
        if (want > 0) h.spend('magic', want);
        this.num(ox, oy - 10, '-' + fmt(want), COL.red, true);
        this.addFx(ox, oy, 'curse_pop', 16, 4, 0.35, 1.6);
        this.shake(3, 0.25); h.play('curse_hit');
      }
    }
    const ptr = (h as any).pointer ? (h as any).pointer() : null;
    if (ptr && ptr.down && (ptr.casting === undefined || ptr.casting)) {
      const wp = h.toWorld(ptr.x, ptr.y);
      this.popAlong(this.lastFinger || wp, wp); this.lastFinger = wp;
    } else this.lastFinger = null;
    for (const arr of [this.fx, this.nums, this.trail]) for (let i = arr.length - 1; i >= 0; i--) { arr[i].t += dt; if (arr[i].t >= arr[i].life) arr.splice(i, 1); }
    for (const p of this.trail) { p.x += p.vx * dt; p.y += p.vy * dt; }
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const p = this.shards[i]; p.t += dt;
      if (p.t >= p.life) { this.shards.splice(i, 1); continue; }
      p.vy += 300 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
    }
    if (s === 'ending' || s === 'complete') this.gateK = clamp01(this.t / 2.5);
  }
  private wardenSpot(): [number, number] {
    const s = this.stage, cx = this.towerX(), [ww, wh] = this.wallSize();
    if (s === 'boss') return [cx + Math.sin(this.bossT * (this.phase === 3 ? 1.1 : 0.6)) * 55, this.wallCY + Math.sin(this.bossT * 1.7) * 5];
    if (s === 'defeat' || s === 'free' || s === 'ending' || s === 'complete' || (this.broken >= 3 && s !== 'broken')) return [cx + 70, this.wallCY + 14];
    return [cx + Math.min(ww * 0.28, 64), this.wallCY - wh / 2 - 18 + Math.sin(this.now * 2) * 2];
  }

  // ================================================================ drawing: world
  private wr(D: PixelDraw, col: string, x: number, y: number, w: number, h: number, a = 1) {
    const [sx, sy] = this.h.toScreen(x, y), z = this.zoom();
    D.rect(col, sx, sy, Math.max(1, w * z), Math.max(1, h * z), a);
  }
  private disc(D: PixelDraw, col: string, cx: number, cy: number, r: number, a = 1) {
    for (let dy = -r; dy < r; dy += 1) { const hw = Math.sqrt(Math.max(0, r * r - (dy + 0.5) * (dy + 0.5))); this.wr(D, col, cx - hw, cy + dy, hw * 2, 1, a); }
  }
  private sprite(D: PixelDraw, img: string, fw: number, frame: number, cx: number, cy: number, sc = 1, o: any = {}) {
    const [iw, ih] = D.size(img), frames = Math.max(1, Math.floor(iw / fw)), w = fw * sc, h = ih * sc;
    D.part(img, (frame % frames) * fw, 0, fw, ih, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h, o);
  }
  /** wall, beam, star gate, Warden: behind the tower */
  drawWorldBack(D: PixelDraw) {
    const s = this.stage; if (s === 'idle') return;
    if (s === 'ending' || s === 'complete') this.drawGate(D);
    const showWall = (s === 'intro' || s === 'wall' || s === 'beam' || (s === 'broken' && this.t < 0.2) || (s === 'free' && this.restore)) && this.broken <= 2 + (s === 'free' ? 1 : 0);
    if (showWall) {
      const k = s === 'intro' ? clamp01(this.t / 1.0) : 1;
      this.drawWall(D, s === 'free' ? 2 : this.wallIdx, this.wallCY - (1 - easeOutBack(k)) * 30, k);
    } else if (this.broken >= 3 && (s === 'free' || s === 'ending' || s === 'complete') && D.has('cosmic_wall_broken')) {
      const [bw, bh] = D.size('cosmic_wall_broken'); D.img('cosmic_wall_broken', Math.round(this.towerX() - bw / 2), Math.round(this.wallCY - bh / 2), { alpha: 0.6 });
    }
    if (this.repairRays > 0) {   // Solar Wall repair rays
      const [ww, wh] = this.wallSize();
      for (let i = 0; i < this.repairRays; i++) {
        const x = this.towerX() + (i - 3) * ww / 8, a = 0.35 + 0.15 * Math.sin(this.now * 5 + i);
        this.wr(D, '#fff1a8', x - 1.5, this.wallCY + wh / 2, 3, 26, a);
      }
    }
    if (s === 'beam') this.drawBeam(D);
    if (this.warden.vis) this.drawWarden(D);
  }
  private drawWall(D: PixelDraw, idx: number, cy: number, alpha: number) {
    const w = WALLS[idx], [ww, wh] = this.wallSize(), kick = this.wallKick > 0 ? Math.round(Math.sin(this.now * 80) * this.wallKick * 0.5) : 0;
    const cx = this.towerX(), x = Math.round(cx - ww / 2 + kick), y = Math.round(cy - wh / 2);
    // Wall._maybe_set_cracks: > 50% damage -> cracks 0, > 75% -> cracks 1 (finite walls only)
    const max = WALL_HP[this.broken], r = isFinite(max) ? this.dmgTaken / max : 0, crack = r > 0.75 ? 1 : r > 0.5 ? 0 : -1;
    const img = D.has(w.img) ? w.img : D.has(w.orig) ? w.orig : '';
    if (img) {
      // walls tile left / right: repeat the strip across the whole view
      // bounded: a degenerate camera (zoom 0 -> infinite view) must never spin here
      let [vx0] = this.h.toWorld(0, 0), [vx1] = this.h.toWorld(this.h.W, 0);
      if (!isFinite(vx0) || !isFinite(vx1) || ww < 8) { vx0 = x; vx1 = x + ww; }
      const n0 = Math.min(6, Math.max(0, Math.ceil((x - vx0) / ww))), n1 = Math.min(6, Math.max(1, Math.ceil((vx1 - x) / ww)));
      for (let i = -n0; i < n1; i++) {
        const xx = x + i * ww;
        D.img(img, xx, y, { alpha });
        if (crack >= 0 && D.has(w.img + '_cracks_' + crack)) D.img(w.img + '_cracks_' + crack, xx, y, { alpha });
      }
      if (this.wallFlash > 0) this.wr(D, COL.white, vx0, y, vx1 - vx0, wh, 0.25);
    } else {
      this.wr(D, w.shade, x, y + 8, ww, wh - 8, alpha); this.wr(D, w.base, x, y + 8, ww, wh - 16, alpha);
    }
  }
  private drawBeam(D: PixelDraw) {
    const [ox, oy] = this.h.orbPos(), k = this.t, charge = clamp01(k / 1.2);
    this.disc(D, COL.white, ox, oy, 6 + 10 * charge, 0.3 + 0.4 * charge);
    if (k > 1.2) {
      const pw = 4 + 6 * Math.sin(this.now * 30) ** 2, top = this.wallCY;
      this.wr(D, COL.light, ox - pw, top, pw * 2, oy - top, 0.7);
      this.wr(D, COL.white, ox - pw / 3, top, pw * 2 / 3, oy - top, 0.9);
      for (let i = -3; i <= 3; i++) if (k > 1.4 + Math.abs(i) * 0.12) this.sprite(D, D.has('big_spell') ? 'big_spell' : 'sparkles_0', D.has('big_spell') ? 24 : 11, 1, ox + i * 60, top - 6, i === 0 ? 2 : 1);
    }
  }
  private drawWarden(D: PixelDraw) {
    const w = this.warden, s = this.stage, defeated = s === 'defeat' || (this.wardenFree && s !== 'boss');
    if (s === 'boss' && this.phase === 2) this.drawShield(D, w.x, w.y, true);
    let img = defeated && s === 'defeat' ? 'warden_defeated' : this.hurtT > 0 ? 'warden_hurt' : this.castT > 0 || s === 'beam' ? 'warden_cast' : 'warden_idle';
    if (!D.has(img)) img = D.has('warden_idle') ? 'warden_idle' : D.has('warden') ? 'warden' : '';
    const a = w.a * (this.invuln > 0 && Math.floor(this.now * 20) % 2 ? 0.5 : 1);
    if (img) this.sprite(D, img, img === 'warden' ? D.size('warden')[1] : 32, Math.floor(this.now * 4) % 2, w.x, w.y, 1, { alpha: a });
    else { this.wr(D, COL.violet, w.x - 10, w.y - 16, 20, 32, a); this.wr(D, COL.gold, w.x - 4, w.y - 9, 8, 2, a); }
    if (s === 'boss' && this.phase === 2) this.drawShield(D, w.x, w.y, false);
    // Warden.on_skill_unlocked: enchantment orbs float around him
    const ench = [['enchant_frost', COL.mint], ['enchant_molten', '#f2a541'], ['enchant_shatter', COL.gold]];
    ench.forEach(([id, col], i) => {
      if (this.h.skillLevel(id) <= 0) return;
      const ang = this.now * 1.5 + i * 2.09;
      this.disc(D, col, w.x + Math.cos(ang) * 22, w.y + Math.sin(ang) * 10, 2.5, 0.9);
    });
  }
  private drawShield(D: PixelDraw, x: number, y: number, back: boolean) {
    const r = 26 + (this.shieldPop > 0 ? 3 * Math.sin(this.shieldPop * 40) : 0);
    if (D.has('warden_shield')) { if (!back) this.sprite(D, 'warden_shield', 56, 0, x, y, r / 26, { alpha: 0.85 }); return; }
    if (back) this.disc(D, COL.mint, x, y, r, 0.18);
  }
  private drawGate(D: PixelDraw) {
    const k = easeOutBack(this.gateK), x = this.towerX(), y = this.wallCY - 60;
    if (k <= 0.01) return;
    const [, oy] = this.h.orbPos(), pw = 10 * k + 2 * Math.sin(this.now * 6);
    this.wr(D, COL.light, x - pw, y, pw * 2, oy - y, 0.35 * this.gateK);
    this.wr(D, COL.white, x - pw / 3, y, pw * 2 / 3, oy - y, 0.5 * this.gateK);
    if (D.has('star_gate')) this.sprite(D, 'star_gate', D.size('star_gate')[0], 0, x, y, k * 1.5);
    else { this.disc(D, COL.gold, x, y, 37 * k); this.disc(D, COL.ink, x, y, 34 * k); }
  }
  /** bolts, curse orbs, shards, effects: in front of the tower */
  drawWorld(D: PixelDraw) {
    if (this.stage === 'idle') return;
    for (const p of this.trail) { const k = p.t / p.life; this.sprite(D, p.img, 3, 0, p.x, p.y, 1, { alpha: 1 - k * k }); }
    for (const b of this.bolts) {
      const [x, y] = this.boltPos(b), sc = 1 + b.f * 0.8;
      if (D.has('magic_bolt')) {
        const [nx, ny] = this.boltPos({ ...b, t: b.t + 0.02 }), [sx, sy] = this.h.toScreen(x, y);
        this.sprite(D, 'magic_bolt', 10, Math.floor(b.t * 12), x, y, sc, { rot: Math.atan2(nx - x, -(ny - y)), pivot: [sx, sy] });
      } else { const sz = 3 + b.f * 3; this.wr(D, fervorCol(b.f), x - sz / 2, y - sz / 2, sz, sz); }
    }
    for (const cu of this.curses) {
      const fr = Math.floor(cu.t * 6) % 2;
      if (D.has('curse_orb')) this.sprite(D, 'curse_orb', 12, fr, cu.x, cu.y);
      else { this.disc(D, COL.ink, cu.x, cu.y, 6); this.disc(D, COL.violet, cu.x, cu.y, 5); }
    }
    for (const p of this.shards) {
      const a = p.t > p.life - 0.4 ? (p.life - p.t) / 0.4 : 1;
      if (D.has(p.img)) {
        const [iw, ih] = D.size(p.img), [sx, sy] = this.h.toScreen(p.x, p.y);
        D.img(p.img, Math.round(p.x - iw / 2), Math.round(p.y - ih / 2), { alpha: a, rot: p.r, pivot: [sx, sy], tint: p.col });
      } else this.wr(D, p.col, p.x - p.s / 2, p.y - p.s / 2, p.s, p.s, a);
    }
    for (const e of this.fx) { if (!D.has(e.img)) continue; this.sprite(D, e.img, e.fw, Math.min(e.frames - 1, Math.floor(e.t / e.life * e.frames)), e.x, e.y, e.sc); }
    if (this.stage === 'broken' && this.t < 0.3) {   // WallBreakAnimation: three big stars, 50 ms apart
      const i = Math.floor(this.t / 0.06), img = D.has('big_spell') ? 'big_spell' : 'sparkles_0', [ww] = this.wallSize(), cx = this.towerX();
      const xs = [cx - Math.min(ww, 200) * 0.25, cx + Math.min(ww, 200) * 0.2, cx];
      if (i < 3) this.sprite(D, img, img === 'big_spell' ? 24 : 11, img === 'big_spell' ? 0 : 1, xs[i], this.wallCY - 4, img === 'big_spell' ? 2 : 5);
    }
  }

  // ================================================================ drawing: HUD (screen space, on top)
  drawHud(D: PixelDraw) {
    if (this.stage === 'idle') return;
    const h = this.h, W = h.W, H = h.H;
    if (this.flash > 0) D.rect(this.flashCol, 0, 0, W, H, Math.min(0.8, this.flash));
    for (const n of this.nums) {
      const k = easeOutExpo(n.t / n.life), [sx, sy] = h.toScreen(n.x, n.y), sc = n.big ? 1.4 - 0.4 * k : 1, x = sx + n.dx * k, y = sy - 18 * k;
      D.text(n.text, x + 1, y + 1, COL.ink, 10, 'center', { scale: sc }); D.text(n.text, x, y, n.col, 10, 'center', { scale: sc });
    }
    const s = this.stage;
    if (s === 'wall' || s === 'intro' || (s === 'free' && this.restore)) {
      const idx = s === 'free' ? 2 : this.broken, max = WALL_HP[idx];
      this.drawBar(D, WALLS[idx].name, isFinite(max) ? max - this.dmgTaken : Infinity, max, COL.pink, 0);
    }
    if (s === 'boss') this.drawBar(D, 'The Warden', this.bossHp, this.bossMax, this.phase === 3 ? COL.red : COL.lilac, this.phase);
    if (s === 'boss' && this.phase === 2) this.drawShieldHint(D, W);
    if (this.bark && this.warden.vis) {
      const [sx, sy] = h.toScreen(this.warden.x, this.warden.y - 24), w = D.textW(this.bark.text) + 10;
      const x = Math.round(Math.min(Math.max(sx - w / 2, 4), W - w - 4)), y = Math.round(Math.max(sy - 20, 100));
      D.nine('panel', x, y, w, 16); D.text(this.bark.text, x + 5, y + 3, COL.light);
    }
  }
  /** dialogue, white-out and the end screen: above the nav bar, tutorial and tooltips */
  overlay(D: PixelDraw) {
    this.dlgRect = null; this.againRect = null;
    const W = this.h.W, H = this.h.H, s = this.stage;
    if (this.dlg) this.drawDialog(D, W, H);
    if (s === 'ending' && this.t > 6) D.rect(COL.white, 0, 0, W, H, clamp01((this.t - 6) / 3) * 0.9);
    if (s === 'complete') this.drawEnding(D, W, H);
  }
  private drawBar(D: PixelDraw, name: string, hp: number, max: number, col: string, phase: number) {
    const W = this.h.W, w = 150, x = W - w - 4, y = 4, bh = 10;
    D.nine('panel', x, y, w, 34);
    D.text(name, x + 4, y + 3, COL.white, 10);
    if (phase) for (let i = 0; i < 3; i++) D.rect(i < phase ? (phase === 3 ? COL.red : COL.gold) : '#4a3d66', x + w - 26 + i * 7, y + 5, 5, 5);
    const bx = x + 4, by = y + 19, bw = w - 8, k = isFinite(max) ? clamp01(hp / max) : 1;
    D.nine('progress_bar_background', bx - 1, by - 1, bw + 2, bh + 2);
    const fw = Math.round((bw - 2) * k);
    if (fw > 0) D.rect(col, bx + 1, by + 1, fw, bh - 2);
    if (phase) for (const m of [PHASE2_AT, PHASE3_AT]) D.rect(COL.ink, Math.round(bx + 1 + (bw - 2) * m), by + 1, 1, bh - 2);
    const label = isFinite(max) ? fmt(hp) + ' / ' + fmt(max) : 'Indestructible';
    D.text(label, x + w / 2 + 1, by, COL.ink, 10, 'center'); D.text(label, x + w / 2, by - 1, COL.white, 10, 'center');
    // status effect stacks under the bar (StatusEffectUI)
    let sx = x;
    for (const st of STATUS) {
      const n = this.statusStacks(st.id); if (n <= 0) continue;
      const t = st.name[0] + fmt(n), tw = D.textW(t) + 6;
      D.rect(COL.ink, sx, y + 36, tw, 11, 0.85); D.text(t, sx + 3, y + 36, st.col);
      sx += tw + 2;
    }
  }
  private drawShieldHint(D: PixelDraw, W: number) {
    const f = this.h.fervor, ok = f >= T.shieldFervor, w = 190, x = Math.round(W - w - 4), y = 50;
    D.nine('panel', x, y, w, 30);
    D.text('SHIELD! Swipe fast to pierce it', x + 5, y + 3, ok ? COL.mint : COL.light);
    const bx = x + 5, bw = w - 60, by = y + 17;
    D.rect('#4a3d66', bx, by, bw, 7); D.rect(fervorCol(f), bx, by, Math.round(bw * clamp01(f)), 7);
    D.rect(COL.white, bx + Math.round(bw * T.shieldFervor), by - 2, 1, 11);
    D.text('x' + (1 + f).toFixed(2), x + w - 50, y + 15, ok ? COL.gold : COL.grey);
  }
  private wrap(D: PixelDraw, str: string, maxW: number) {
    const out: string[] = []; let line = '';
    for (const word of str.split(' ')) { const t = line ? line + ' ' + word : word; if (D.textW(t) > maxW && line) { out.push(line); line = word; } else line = t; }
    if (line) out.push(line);
    return out;
  }
  private drawDialog(D: PixelDraw, W: number, H: number) {
    const dl = this.dlg!, line = dl.lines[dl.i], portrait = 44, hud = this.h.mobile ? 36 : 28;
    const w = Math.min(W - 12, 300), tx = portrait + 12, lines = this.wrap(D, line.text, w - tx - 6), btnH = 18;
    const h = Math.max(portrait + 10, 22 + lines.length * 12 + btnH + 10);
    const x = Math.round(W / 2 - w / 2), y = Math.round(H - hud - h - 10);
    D.nine('panel', x, y, w, h);
    const px = x + 5, py = y + 5;
    D.rect(line.who === 'warden' ? '#3b2a6e' : '#2f6f7a', px, py, portrait, portrait);
    if (line.who === 'warden' && D.has('warden_portrait')) D.part('warden_portrait', 0, 0, 24, 24, px + 4, py + 4, 36, 36);
    else if (line.who === 'orb' && D.has('orb')) D.part('orb', 0, 0, 28, 28, px + 1, py + 1, 42, 42);
    D.text(line.who === 'warden' ? 'The Wall Wizard' : 'The Orb', x + tx, y + 5, line.who === 'warden' ? COL.pink : COL.mint, 10);
    let left = Math.floor(dl.t * 45);
    lines.forEach((l, i) => { if (left <= 0) return; D.text(l.slice(0, left), x + tx, y + 20 + i * 12, COL.white); left -= l.length + 1; });
    const label = line.button || 'Next', bw = Math.max(50, D.textW(label) + 14), bx = x + w - bw - 6, by = y + h - btnH - 5;
    D.nine(this.pressed === 'dialog' ? 'button_pressed' : 'button', bx, by, bw, btnH);
    D.text(label, bx + bw / 2, by + 4, COL.white, 10, 'center');
    this.dlgRect = { x, y, w, h };
  }
  advanceDialog() {
    const dl = this.dlg; if (!dl) return;
    const line = dl.lines[dl.i];
    if (Math.floor(dl.t * 45) < line.text.length) { dl.t = line.text.length / 45 + 0.01; return; }
    this.h.play('button_click', -6);
    if (dl.i + 1 < dl.lines.length) { dl.i++; dl.t = 0; return; }
    this.dlg = null;
    if (dl.then) dl.then();
  }
  private drawEnding(D: PixelDraw, W: number, H: number) {
    const k = clamp01(this.endT / 0.6), st = this.endStats;
    D.rect(COL.ink, 0, 0, W, H, 0.8 * k);
    if (k < 1) return;
    const w = Math.min(W - 20, 240), h = 172, x = Math.round(W / 2 - w / 2), y = Math.round(H / 2 - h / 2);
    D.nine('panel', x, y, w, h);
    D.text('Thanks for playing!', W / 2, y + 8, COL.gold, 10, 'center', { scale: 1.2 + 0.05 * Math.sin(this.endT * 3) });
    D.text('Your tower is the tallest in the land', W / 2, y + 26, COL.light, 10, 'center');
    D.text('in ' + hms(st.time), W / 2, y + 38, COL.light, 10, 'center');   // label.ending_time
    const rows: [string, string][] = [['Total magic', fmt(st.magic)], ['Highest fervor', 'x' + st.fervor.toFixed(2)], ['Warden fight', hms(st.boss).slice(3)], ['Curses popped', String(st.popped)]];
    rows.forEach(([a, b], i) => { const ry = y + 56 + i * 15; D.rect('#3d2f5a', x + 8, ry - 2, w - 16, 13); D.text(a, x + 12, ry, COL.white); D.text(b, x + w - 12 - D.textW(b), ry, COL.gold); });
    const bw = 100, bh = 24, bx = Math.round(W / 2 - bw / 2), by = y + h - bh - 10;
    D.nine(this.pressed === 'again' ? 'button_pressed' : 'button', bx, by, bw, bh);
    D.text('Play Again', W / 2, by + 7, COL.white, 10, 'center');
    this.againRect = { x: bx, y: by, w: bw, h: bh };
  }

  // ================================================================ panel ("Wall": WallUI + WardenUI)
  drawPanel(D: PixelDraw) {
    const h = this.h, listH = this.wardenFree ? h.skillListHeight('warden') : 0;
    const infoH = 20 + 12 * 2 + 4, toggleH = this.wardenFree ? 26 : 0, w = 200, H = infoH + (listH ? listH + 2 : 0) + toggleH;
    const r = h.panelRect(w, H); this.panelRect = r;
    D.nine('panel', r.x, r.y, w, infoH);
    D.text(this.broken >= 3 ? 'The Walls are broken' : WALLS[Math.min(this.broken, 2)].name, r.x + 4, r.y + 3, COL.white, 12);
    const max = WALL_HP[Math.min(this.broken, 2)];
    D.text(this.broken >= 3 ? 'Damage / min: ' + fmt(this.dpm()) : isFinite(max) ? `HP ${fmt(max - this.dmgTaken)} / ${fmt(max)}` : 'HP: indestructible', r.x + 4, r.y + 20, COL.light);
    D.text(this.broken >= 3 ? '' : 'Damage / min: ' + fmt(this.dpm()), r.x + 4, r.y + 32, COL.grey);
    let y = r.y + infoH + 2;
    if (this.wardenFree) {
      y += h.drawSkillList('warden', 'Wall Wizard', r.x, y, w) + 2;
      const label = 'Restore Cosmic Wall: ' + (this.restore ? 'ON' : 'OFF');
      if (h.button('siege_restore', label, r.x, y, w, 22)) this.toggleRestore();
    }
    return r;
  }
  /** WardenUI.on_restore_wall_toggled: the Wall Wizard restores / disables the Cosmic Wall (keep farming cosmic dust) */
  private toggleRestore() { this.restore = !this.restore; this.castT = 0.45; this.h.play('warden_cast', -4); if (this.restore) this.placeWall(2); }
  worldFocus(): [number, number] { return [this.towerX(), this.wallCY + 60]; }
  /** let the camera climb to the wall (and the star gate above it) */
  worldBounds() { return this.stage === 'idle' ? {} : { minY: this.wallCY - (this.stage === 'ending' || this.stage === 'complete' ? 260 : 150) }; }

  // ================================================================ input
  hitUi(x: number, y: number): boolean {
    const r = this.stage === 'complete' ? { x: 0, y: 0, w: this.h.W, h: this.h.H } : this.dlgRect;
    return !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }
  onTap(x: number, y: number): boolean {
    const inR = (r: Rect | null) => !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    if (this.stage === 'complete') {
      if (inR(this.againRect)) { this.h.play('button_click'); const sc = director.getScene(); director.loadScene(sc ? sc.name : 'main'); }
      return true;
    }
    if (inR(this.dlgRect)) { this.advanceDialog(); return true; }
    return false;
  }

  // ================================================================ save / load / reset
  save() {
    return { broken: this.broken, dmgTaken: this.dmgTaken, status: this.status, story: this.story, wardenFree: this.wardenFree, restore: this.restore,
      bossDone: this.bossDone, endingDone: this.endingDone, popped: this.popped, bossTime: this.bossTime, maxFervor: this.maxFervor };
  }
  load(d: any) {
    if (!d) return;
    Object.assign(this, { broken: d.broken || 0, dmgTaken: d.dmgTaken || 0, status: d.status || {}, wardenFree: !!d.wardenFree, restore: !!d.restore,
      bossDone: !!d.bossDone, endingDone: !!d.endingDone, popped: d.popped || 0, bossTime: d.bossTime || 0, maxFervor: d.maxFervor || 0 });
    Object.assign(this.story, d.story || {});
    this.resume();
  }
  /** rebuild the runtime stage from saved progress (Wall._on_loaded) */
  private resume() {
    this.dlg = null; this.bolts = []; this.curses = [];
    const lvl = this.h ? this.h.towerLevel() : 0;
    if (lvl < 7) { this.stage = 'idle'; this.warden.vis = false; return; }
    if (this.broken < 3) {
      if (lvl >= 7 + this.broken) { this.placeWall(this.broken); this.setStage('wall'); this.story.w1 = true; if (this.broken >= 1) this.story.w2 = true; if (this.broken >= 2) this.story.w3 = true; }
      else { this.placeWall(Math.min(this.broken, 2)); this.setStage('await'); }
    } else { this.placeWall(2); this.setStage(this.wardenFree ? 'free' : 'bossIntro'); if (!this.wardenFree) this.startBoss(); }
    this.warden.vis = true; this.warden.a = 1; [this.warden.x, this.warden.y] = this.wardenSpot();
  }
  reset(keepPermanent: boolean) {   // prestige: the walls come back (Wall state is per run); story flags stay
    this.broken = 0; this.dmgTaken = 0; this.status = {}; this.wardenFree = false; this.restore = false; this.bossDone = false; this.endingDone = false;
    this.stage = 'idle'; this.warden.vis = false; this.dlg = null; this.bolts = []; this.curses = []; this.shards = [];
  }

  // ================================================================ dev panel
  /** deal `frac` of the current wall's / Warden's max HP (1 = break; the Warden stops at each phase boundary) */
  debugDamage(frac: number) {
    if (this.stage === 'boss') {   // counts as a full-fervor swipe bolt, so it also gets through the P2 shield
      this.invuln = 0; this.boltFervor = 1;
      this.damageBoss(this.bossMax * frac, 'orb_bolt', this.warden.x, this.warden.y);
      this.boltFervor = 0; return;
    }
    if (this.stage !== 'wall') return;
    const max = WALL_HP[this.broken];
    if (isFinite(max)) this.damage(max * frac, 'gorgon', undefined, undefined, { skipMult: true });
    else if (frac >= 1) this.fireBeam();
  }
  /** jump straight to a stage: sets the tower level (host.debugSetLevel), wall progress and story flags */
  debugJump(stage: 'wall1' | 'wall2' | 'wall3' | 'boss1' | 'boss2' | 'boss3' | 'free' | 'ending') {
    const h: any = this.h, m = /^(wall|boss)(\d)$/.exec(stage), isWall = !!m && m[1] === 'wall';
    const idx = isWall ? +m![2] - 1 : 2, level = stage === 'ending' ? 10 : 7 + idx;
    this.bolts = []; this.curses = []; this.nums = []; this.shards = []; this.trail = []; this.fx = [];
    this.dlg = null; this.bark = null; this.flash = 0; this.invuln = 0; this.restore = false;
    this.broken = isWall ? idx : 3; this.dmgTaken = 0; this.wardenFree = stage === 'free' || stage === 'ending'; this.endingDone = false;
    this.story = { w1: true, w2: this.broken >= 1 || idx >= 1, w3: idx >= 2, ww: this.wardenFree };
    if (h.debugSetLevel) h.debugSetLevel(stage === 'ending' ? 9 : level);
    this.placeWall(idx);
    this.warden.vis = true; this.warden.a = 1;
    if (isWall) { this.setStage('wall'); this.frameWall(); }
    else if (m) {
      this.startBoss(); this.invuln = 0;
      const ph = +m[2];
      if (ph >= 2) { this.phase = ph; this.bossHp = this.bossMax * (ph === 2 ? PHASE2_AT : PHASE3_AT); }
    } else if (stage === 'free') this.freeWarden();
    else { this.setStage('free'); this.bossDone = true; if (h.debugSetLevel) h.debugSetLevel(10); this.startEnding(); }
    [this.warden.x, this.warden.y] = this.wardenSpot();
  }
  debug: Record<string, (...args: any[]) => void> = {
    'Siege: Cloud Wall (T7)': () => this.debugJump('wall1'), 'Siege: Solar Wall (T8)': () => this.debugJump('wall2'),
    'Siege: Cosmic Wall (T9)': () => this.debugJump('wall3'), 'Siege: Warden P1': () => this.debugJump('boss1'),
    'Siege: Warden P2 (shield)': () => this.debugJump('boss2'), 'Siege: Warden P3': () => this.debugJump('boss3'),
    'Siege: Warden freed': () => this.debugJump('free'), 'Siege: Ending': () => this.debugJump('ending'),
    'Siege: wall/boss to 5%': () => this.debugDamage(this.stage === 'boss' ? 0.3 : 0.95), 'Siege: break / next phase': () => this.debugDamage(1),
    'Siege: +100 cosmic dust': () => this.h.addResource('cosmic_dust', 100),
  };
}

registerModule(new SiegeModule());
