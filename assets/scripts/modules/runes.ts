// Runecraft (tower 8): Rune Smiths, Blank Runes and the rune tree.
// Port of RuneSmiths.gd (smiths rise from the obelisk and slam the anvil), RuneExp.gd (each strike is 1 EXP, a full bar
// forges a Blank Rune), RuneUI.gd / RuneSkillButton.gd / TreeStructure.gd (35 runes, cost = tree depth, toggle once or
// upgrade to max_level with the Blessing of Refining), Obelisk.gd / ObeliskArea.gd / ObeliskSprite.gd (the obelisk, the
// anvil and the unlocked rune glyphs carved into it). Numbers come from data/rune_skills/*.tres and data/skills/*.tres.
// Most rune effects are applied by the module that owns the unit (sorcery, dragons, alchemy, academy): they read
// runeLevel(id) / runeUnlocked(id) / runeValue(id) here. Runes keep the .tres file names as ids (dragon_rune, wood_rune...).
import { registerModule } from '../GameModule';
import type { GameHost, GameModule, SkillDef, Multipliers } from '../GameModule';
import type { PixelDraw } from '../PixelDraw';

const RUNES_TOWER = 8;
const SMITH = { upSpeed: 80, downSpeed: 240, floatHeight: 150, speedUp: 35, speedUpTime: 0.4, maxDrawn: 200 };
const ANVIL = [1, -65], ANVIL_POS = [0, -75];       // Anvil / AnvilPosition, relative to the obelisk position
const RUNE_START = [-13.5, -37.5];                  // ObeliskRuneStart, relative to the obelisk sprite centre
const FALLBACK_OBELISK: [number, number] = [181.5, 238.5];   // tower_7.tscn ObeliskArea + ObeliskPosition (tower image space)

// ---- rune definitions (data/rune_skills/*.tres); desc(v) gets the meta value already multiplied by the level ("op": "*")
interface RuneDef { id: string; name: string; icon: string; max: number; meta: number; mult: boolean; desc: (v: string) => string }
const R = (id: string, name: string, icon: string, max: number, meta: number, mult: boolean, desc: (v: string) => string): RuneDef => ({ id, name, icon, max, meta, mult, desc });
const RUNE_DEFS: RuneDef[] = [
  R('instructions', 'Instructions', 'question_mark', 1, 0, false, () => 'Spend {blank_rune_icon} Blank Runes to unlock upgrades.'),
  R('create_shamans', 'Summon Shamans', 'shaman_rune', 2, 10, false, v => `Summon ${v} Shamans`),
  R('create_gorgons', 'Summon Gorgons', 'gorgon_rune', 2, 10, false, v => `Summon ${v} Gorgons`),
  R('create_ifrits', 'Summon Ifrits', 'ifrit_rune', 2, 10, false, v => `Summon ${v} Ifrits`),
  R('zephyr_damage', 'Lightning', 'zephyr_rune', 1, 100, false, v => `Zephyrs sometimes call down Lightning for ${v} damage to the wall.`),
  R('class_of_destruction', 'Sages of Destruction', 'class_of_destruction_rune', 1, 50, false, v => `Spirit Sages deal ${v} damage to the wall.`),
  R('fire_arrows', 'Fire Arrows', 'fire_arrows_rune', 3, 5, true, v => `Shamans now loose fire arrows that hit for ${v}x a normal Shaman arrow.`),
  R('wood_rune', 'Druid Boost', 'wood_rune', 3, 200, true, v => `+${v}% {wood_icon} income`),
  R('alchemy_rune', 'Alchemy Boost', 'alchemy_rune', 3, 200, true, v => `{magic_gold_icon} is made ${v}% faster`),
  R('wisps', 'Wisps', 'wisps_rune', 1, 0, false, () => 'Gorgons can now emit Wisps, which will apply Cursed to the wall.'),
  R('infinity', 'Infinity', 'infinity_rune', 1, 0, false, () => 'Unlocks an upgrade to increase all types of damage in exchange for {blank_rune_icon}.'),
  R('fireball_shrapnel', 'Fireball Shrapnel', 'fireball_shrapnel_rune', 1, 250, false, v => `Fireballs burst into 10 Shrapnel, each hitting the wall for ${v}.\n\n- Counts separately from Fireball damage.`),
  R('alloy', 'Alloy', 'alloy_rune', 1, 1, true, v => `Ifrit base damage rises ${v}% for every Gorgon, Shaman and Zephyr you have.`),
  R('charge', 'Charge', 'charge_rune', 3, 1, true, v => `Each Lightning hit adds ${v} to Lightning base damage for good.`),
  R('diversity', 'Diversity', 'whirlwind_rune', 3, 1, true, v => `Spirit Sage base damage rises ${v}% for each stack of any status effect except Weakened.`),
  R('fire_damage', 'Molten Arrows', 'fire_arrow_damage_rune', 3, 100, true, v => `Fire arrows also benefit from Molten on the wall, at ${v}% strength.`),
  R('ice_arrows', 'Ice Arrows', 'ice_arrow_rune', 3, 1, true, v => `Shamans now loose ice arrows that put ${v} Frost on the wall, slowing how fast its status effects fade.`),
  R('relics', 'Relics', 'relics_rune', 2, 3, true, v => `Gorgon base damage also rises ${v} for every Holy Grail or Philosopher's Stone you hold.`),
  R('curse_resonance', 'Curse Aura', 'curse_resonance_rune', 3, 100, true, v => `Whenever a curse lands on the wall, every Gorgon glows and its next hit deals ${v}% more\n\n- Stacks.`),
  R('sound_pulse', 'Sound Pulse', 'sound_pulse_rune', 3, 1, true, v => `Gorgons now send out Sound Pulses that put Shatter on the wall. Each Shatter stack makes Dragon Fireballs and Curses hit ${v}% harder`),
  R('infinity_resonance', 'Infinity Resonance', 'infinity_resonance', 2, 30, true, v => `Gorgons gain ${v}% damage for each Infinity Rune you have.`),
  R('dragon_rune', 'Dragon Keeper Boost', 'dragon_rune', 2, 400, true, v => `Dragon gains ${v}% more EXP`),
  R('shrapnel_count', 'Shrapnel Count', 'shrapnel_count_rune', 3, 10, false, v => `Fireballs throw ${v} more Shrapnel.`),
  R('shrapnel_weakness', 'Shrapnel Weakness', 'shrapnel_weakness_rune', 3, 50, true, v => `Every Shrapnel also puts ${v} Weakness on the wall.`),
  R('hot_blooded', 'Hot Blooded', 'hot_blooded_rune', 1, 0, false, () => 'The Molten effects on the wall will apply to Ifrit fireballs.'),
  R('cloud_rune', 'Magic Boost', 'cloud_rune', 3, 300, true, v => `Cloudlings make ${v}% more {magic_icon}`),
  R('academy_exp_rune', 'Academy Boost', 'academy_exp_rune', 2, 400, true, v => `The Academy earns ${v}% more EXP`),
  R('cursed_fire', 'Cursed Fire', 'cursed_fire_rune', 1, 60, true, v => `Curses also benefit from Molten on the wall, at ${v}% strength.`),
  R('ice_arrow_damage', 'Ice Arrow Damage', 'ice_arrow_damage_rune', 3, 3, true, v => `Ice arrows hit as hard as ${v} Gorgons.`),
  R('cursed_shards', 'Cursed Shards', 'cursed_shards_rune', 1, 0, false, () => 'The base damage of Curses is added to Shrapnel base damage'),
  R('hot_runes', 'Hot Runes', 'blazing_runes', 3, 5, true, v => `Shrapnel base damage rises ${v}% for every rune you have unlocked.`),
  R('shrapnel_molten', 'Molten Shrapnel', 'molten_shrapnel', 1, 8, true, v => `Every Shrapnel also puts ${v} Molten on the wall.`),
  R('fusion', 'Fusion', 'armor_melt', 3, 2, true, v => `Fireball base damage rises ${v}% for each point of Ifrit base damage.`),
  R('strike_twice', 'Strike Twice', 'strike_twice_rune', 2, 50, true, v => `Lightning has a ${v}% chance to strike the wall twice.`),
  R('dragon_wands', 'Dragon Wands', 'dragon_breath_rune', 3, 1, true, v => `${v}% of dragon fireball base damage is added to Spirit Sage base damage.`),
  // arc.tres exists in the data but is not placed in TreeStructure.rune_skill_tree; kept for runeLevel lookups
  R('arc', 'Arc', 'gorgon_damage_rune', 3, 1, true, v => `Gorgons hit ${v}% harder for every Zephyr or Cloudling.`),
];
const RUNE: Record<string, RuneDef> = {}; RUNE_DEFS.forEach(d => RUNE[d.id] = d);
// registry ids (RuneSkillDef.id) differ from the file names for a few runes; accept both
const ALIAS: Record<string, string> = { dragon: 'dragon_rune', wood: 'wood_rune', alchemy: 'alchemy_rune', cloud: 'cloud_rune', wisp: 'wisps' };

// TreeStructure.rune_skill_tree (children order kept)
const TREE: Record<string, string[]> = {
  instructions: ['create_shamans', 'create_gorgons', 'create_ifrits', 'zephyr_damage', 'class_of_destruction'],
  create_shamans: ['fire_arrows', 'wood_rune'], create_gorgons: ['alchemy_rune', 'wisps', 'infinity'],
  create_ifrits: ['fireball_shrapnel', 'alloy'], zephyr_damage: ['charge'], class_of_destruction: ['diversity'],
  fire_arrows: ['fire_damage'], fireball_shrapnel: ['dragon_rune', 'shrapnel_count', 'shrapnel_weakness'], alloy: ['hot_blooded'],
  wisps: ['curse_resonance', 'sound_pulse'], diversity: ['academy_exp_rune'], charge: ['cloud_rune'], wood_rune: ['ice_arrows'],
  alchemy_rune: ['relics'], infinity: ['infinity_resonance'],
  shrapnel_count: ['hot_runes'], shrapnel_weakness: ['shrapnel_molten'], fire_damage: ['cursed_fire'], academy_exp_rune: ['dragon_wands'],
  hot_blooded: ['fusion'], ice_arrows: ['ice_arrow_damage'], dragon_rune: ['cursed_shards'], cloud_rune: ['strike_twice'],
};
interface Node { id: string; parent: string | null; depth: number; cx: number; children: string[] }
const NODES: Record<string, Node> = {};
const ORDER: string[] = [];
(function layout() {   // depth = cost; leaves get consecutive slots, parents sit over the middle of their children
  let slot = 0;
  const walk = (id: string, parent: string | null, depth: number): number => {
    const children = TREE[id] || [];
    const n: Node = { id, parent, depth, cx: 0, children }; NODES[id] = n; ORDER.push(id);
    if (!children.length) n.cx = slot++;
    else { const xs = children.map(c => walk(c, id, depth + 1)); n.cx = (xs[0] + xs[xs.length - 1]) / 2; }
    return n.cx;
  };
  walk('instructions', null, 0);
})();
const LEAVES = Math.max(...ORDER.map(id => NODES[id].cx)) + 1;
const DEPTHS = Math.max(...ORDER.map(id => NODES[id].depth)) + 1;

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

interface Smith { x: number; y: number; vx: number; vy: number; st: 0 | 1 | 2 }   // 0 rising, 1 falling, 2 bouncing
interface Fx { x: number; y: number; t: number; img: string; fw: number; frames: number; fps: number }
interface Label { x: number; y: number; t: number; text: string; icon: string }

class RunesModule implements GameModule {
  id = 'runes';
  unlockTower = RUNES_TOWER;
  nav = { label: 'Runecraft' };
  resources = [{ id: 'blank_rune', icon: 'blank_rune', name: 'Blank Rune' }];
  host!: GameHost;

  levels: Record<string, number> = { instructions: 1 };
  carved: string[] = [];            // ObeliskSprite.runes: purchase order, one glyph per rune
  level = 0; xp = 0;                // RuneExp
  smiths: Smith[] = [];
  speedMult = 1; speedTimer = 0;
  refiningDebug = false;
  selected = 'instructions';
  fx: Fx[] = []; labels: Label[] = [];
  bob = 0; soundT = 0;
  private treeRect: { x: number, y: number, w: number, h: number } | null = null;
  private nodeRects: { id: string, x: number, y: number, w: number, h: number }[] = [];
  private panel: { x: number, y: number, w: number, h: number } | null = null;

  skills: Record<string, SkillDef> = {
    summon_rune_smith: {
      list: 'rune', name: 'Rune Smith', res: 'spirits', cost: () => 2, max: 10000, icon: 'rune_smith', summon: true, showLevel: true,
      tip: () => `Call a Rune Smith to forge {blank_rune_icon}\n\n- Hold the Obelisk/Anvil to make them work ${SMITH.speedUp}% faster`,
    },
    rune_mastery: {
      list: 'rune', name: 'Rune Mastery', res: 'knowledge', cost: L => 1e10 * Math.pow(2, L), max: 10, icon: null, unlock: 'summon_rune_smith', showLevel: true,
      tip: () => '{blank_rune_icon} is forged twice as fast',
    },
    infinity_rune_upgrade: {
      list: 'rune', name: 'Infinity Rune', res: 'blank_rune', cost: L => 1 + L, max: 1000, icon: 'infinity', showLevel: true,
      visible: () => this.runeUnlocked('infinity'),
      tip: () => 'All base damage +30%',
    },
  };

  init(host: GameHost) { this.host = host; }
  private get M(): Record<string, any> { return (this.host && this.host.modules) as any || {}; }
  private blessing(id: string): number { const p = this.M.prestige; try { return p && p.blessingLevel ? p.blessingLevel(id) || 0 : 0; } catch (e) { return 0; } }
  private lvl(id: string) { return this.host.skillLevel(id) || 0; }

  // ------------------------------------------------------------------ public API (host.modules.runes)
  runeLevel(id: string): number { return this.levels[ALIAS[id] || id] || 0; }
  runeUnlocked(id: string): boolean { return this.runeLevel(id) >= 1; }
  /** the rune's meta value times its level (e.g. wood_rune at L2 -> 400 (%)); 0 while locked */
  runeValue(id: string): number { const d = RUNE[ALIAS[id] || id]; return d ? d.meta * (d.mult ? this.runeLevel(id) : Math.min(1, this.runeLevel(id))) : 0; }
  /** purchase order of the unlocked runes (ObeliskSprite.runes), for obelisk.ts */
  ownedRunes(): string[] { return this.carved.slice(); }
  runeIcon(id: string): string | null { const d = RUNE[ALIAS[id] || id]; return d ? d.icon : null; }
  numRunesUnlocked(): number { return ORDER.filter(id => (this.levels[id] || 0) >= 1).length; }
  smithCount(): number { return this.lvl('summon_rune_smith'); }
  infinityBonus(): number { return 1 + this.lvl('infinity_rune_upgrade') * 0.3; }
  obeliskPos(): [number, number] | null {
    const a = this.host.towerAnchor('obeliskPos'); if (a) return a;
    const L = this.host.towerLevel(); if (L < RUNES_TOWER) return null;
    const img = 'tower_' + Math.min(L - 1, 9), [w, h] = this.host.D.size(img); if (!w) return null;
    return [320 - w / 2 + FALLBACK_OBELISK[0], 322 - h + FALLBACK_OBELISK[1]];
  }
  anvilPos(): [number, number] | null { const o = this.obeliskPos(); return o ? [o[0] + ANVIL_POS[0], o[1] + ANVIL_POS[1]] : null; }
  /** RuneExp.add_exp: smith strikes (1 each), the Smith Master's hammer (smiths x upgrade bonus) */
  addExp(raw: number) {
    let gain = raw * this.expBonus();
    while (gain > 0) {
      const room = Math.min(gain, this.cap() - this.xp);
      this.xp += room; gain -= room;
      if (this.xp >= this.cap() - 1e-9) {
        this.xp = 0; this.level++;
        const n = 1 + this.blessing('runecraft_blessing');
        this.host.addResource('blank_rune', n);
        const a = this.anvilPos(); if (a) this.labels.push({ x: a[0], y: a[1] - 14, t: 0, text: '+' + fmt(n), icon: 'blank_rune' });
      }
    }
  }
  cap() { return 450 * Math.pow(1.51, Math.pow(this.level, 0.74)); }
  expBonus() {
    const mastery = 1 + this.lvl('rune_mastery') * 100 / 100;
    let other = 1; try { other = (this.host.mult('crafting') || 1) * (this.host.mult('rune_exp') || 1); } catch (e) { }   // Crafting Totems + others
    return mastery * other;
  }
  refining() { return this.refiningDebug || this.blessing('refining_blessing') > 0; }
  maxLevel(id: string) { return id === 'instructions' ? 1 : this.refining() ? RUNE[id].max : 1; }
  cost(id: string) { return NODES[id].depth; }
  parentOk(id: string) { const p = NODES[id].parent; return !p || (this.levels[p] || 0) >= 1; }
  canBuy(id: string) { return this.parentOk(id) && (this.levels[id] || 0) < this.maxLevel(id) && this.host.res('blank_rune') + 1e-9 >= this.cost(id); }
  buy(id: string, free = false) {
    if (!free && !this.canBuy(id)) return false;
    if ((this.levels[id] || 0) >= this.maxLevel(id) && !free) return false;
    if (!free) this.host.spend('blank_rune', this.cost(id));
    this.levels[id] = (this.levels[id] || 0) + 1;
    if (id !== 'instructions' && this.carved.indexOf(id) < 0) this.carved.push(id);
    this.onPurchased(id);
    this.host.play('summon', -6, 0.05);
    return true;
  }
  private onPurchased(id: string) {   // RuneSkillButton._on_skill_purchased
    const give: Record<string, string> = { create_shamans: 'summon_shaman', create_gorgons: 'summon_gorgon', create_ifrits: 'summon_ifrit' };
    const sk = give[id]; if (!sk) return;
    const S = this.host.S; if (!S || !S.skills) return;
    S.skills[sk] = (S.skills[sk] || 0) + RUNE[id].meta;
    const s = this.M.sorcery || this.M.alchemy;
    if (s && typeof s.syncUnits === 'function') { try { s.syncUnits(); } catch (e) { } }
  }

  // ------------------------------------------------------------------ simulation
  update(dt: number) {
    if (this.host.towerLevel() < RUNES_TOWER) return;
    this.bob += dt;
    this.speedTimer = Math.max(0, this.speedTimer - dt); if (this.speedTimer <= 0) this.speedMult = 1;
    this.soundT = Math.max(0, this.soundT - dt);
    this.syncSmiths();
    this.animateSmiths(dt);
    for (let i = this.fx.length - 1; i >= 0; i--) { const f = this.fx[i]; f.t += dt; if (f.t * f.fps >= f.frames) this.fx.splice(i, 1); }
    for (let i = this.labels.length - 1; i >= 0; i--) { const l = this.labels[i]; l.t += dt; if (l.t > 1) this.labels.splice(i, 1); }
  }
  private syncSmiths() {
    const o = this.obeliskPos(); if (!o) return;
    const target = Math.min(this.smithCount(), SMITH.maxDrawn);
    while (this.smiths.length < target) this.smiths.push({ x: o[0], y: o[1], vx: 0, vy: 0, st: 0 });
    if (this.smiths.length > target) this.smiths.length = target;
  }
  private animateSmiths(dt: number) {
    const a = this.anvilPos(); if (!a || !this.smiths.length) return;
    let supervision = 1; try { const h: any = this.host; if (h.supervisionMultiplier) supervision = h.supervisionMultiplier('runes') || 1; } catch (e) { }
    const bd = dt * this.speedMult * supervision, decay = Math.pow(0.2, bd);
    // more smiths than drawn: every drawn strike counts for the hidden ones too
    const per = Math.max(1, this.smithCount() / Math.max(1, this.smiths.length));
    const topX = a[0], topY = a[1] - SMITH.floatHeight;
    for (const s of this.smiths) {
      if (s.st === 0) {
        const dx = topX - s.x, dy = topY - s.y, d = Math.hypot(dx, dy) || 1;
        s.vx += dx / d * SMITH.upSpeed * bd; s.vy += dy / d * SMITH.upSpeed * bd;
        if (d < 5) { s.st = 1; s.vx = 0; }
      } else if (s.st === 1) {
        const dx = a[0] - s.x, dy = a[1] - s.y, d = Math.hypot(dx, dy) || 1;
        s.vx += dx / d * SMITH.downSpeed * bd; s.vy += dy / d * SMITH.downSpeed * bd;
        if (s.y + 6 > a[1]) {
          s.st = 2;
          s.vx = 60 * rand(0.5, 1.2) * (Math.random() < 0.5 ? -1 : 1); s.vy = -40 * rand(0.5, 1.2);
          this.addExp(per);
          this.fx.push({ x: s.x, y: s.y + 5, t: 0, img: 'damage_impact', fw: 5, frames: 2, fps: 12 });
          if (this.soundT <= 0 && this.host.S && this.host.S.navigated === this.id) { this.host.play('runesmith', -12, 0.08); this.soundT = 0.08; }
        }
      } else if (Math.abs(s.vx) <= 10) s.st = 0;
      s.x += s.vx * bd; s.y += s.vy * bd;
      s.vx *= decay; s.vy *= decay;
    }
  }

  // ------------------------------------------------------------------ input (ObeliskArea: press / hold speeds smiths up)
  private obeliskBox() {
    const o = this.obeliskPos(); if (!o) return null;
    return { x: o[0] - 16, y: o[1] - 88, w: 32, h: 88 + 52 };   // anvil top .. obelisk bottom
  }
  hitWorld(wx: number, wy: number) {
    if (this.host.towerLevel() < RUNES_TOWER || this.M.obelisk) return false;   // obelisk.ts owns the press area then
    const b = this.obeliskBox();
    return !!b && wx >= b.x && wx < b.x + b.w && wy >= b.y && wy < b.y + b.h;
  }
  speedUp() { this.onHold(); }   // ObeliskArea -> RuneSmiths.speed_up_runesmiths (called by obelisk.ts)
  onHold() {
    let m = 1 + SMITH.speedUp / 100;
    const h: any = this.host; if (h.clickSpeedBonus) m = h.clickSpeedBonus(m);
    this.speedMult = m; this.speedTimer = SMITH.speedUpTime;
  }
  worldFocus(): [number, number] { const o = this.obeliskPos(); return o ? [o[0], o[1] - 50] : this.host.orbPos(); }

  // ------------------------------------------------------------------ world drawing
  private centred(D: PixelDraw, img: string, cx: number, cy: number, fw: number, fh: number, frame = 0, o?: any) {
    D.part(img, frame * fw, 0, fw, fh, Math.round(cx - fw / 2), Math.round(cy - fh / 2), fw, fh, o);
  }
  drawWorld(D: PixelDraw) {
    if (this.host.towerLevel() < RUNES_TOWER) return;
    const o = this.obeliskPos(); if (!o) return;
    if (!this.M.obelisk) this.drawObelisk(D, o);   // obelisk.ts (tw-temple) draws it, the anvil and the glyphs when present
    for (const s of this.smiths) {
      const [w, h] = D.size('rune_smith');
      D.img('rune_smith', Math.round(s.x - w / 2), Math.round(s.y - h / 2), s.vx < 0 ? { flipX: true } : undefined);
    }
    for (const f of this.fx) this.centred(D, f.img, f.x, f.y, f.fw, D.size(f.img)[1], Math.min(f.frames - 1, Math.floor(f.t * f.fps)));
    for (const l of this.labels) {
      const y = Math.round(l.y - 16 * Math.min(1, l.t / 0.6)), al = 1 - Math.max(0, l.t - 0.6) / 0.4;
      D.img(l.icon, Math.round(l.x - 12), y, { alpha: al });
      D.text(l.text, Math.round(l.x), y, '#ffffff', 10, 'left', { alpha: al });
    }
  }
  /** Obelisk.gd: the obelisk (a Float, 1 px bob) with the carved runes, the anvil on top; outlines while active */
  drawObelisk(D: PixelDraw, o: [number, number]) {
    const by = Math.sin(this.bob), [ow, oh] = D.size('obelisk');
    const sx = Math.round(o[0] - ow / 2), sy = Math.round(o[1] - oh / 2 + by);
    const active = this.host.S && this.host.S.activeArea === this.id;
    if (active && D.has('obelisk_outline')) { const [w, h] = D.size('obelisk_outline'); D.img('obelisk_outline', Math.round(o[0] - w / 2), Math.round(o[1] - h / 2 + by)); }
    D.img('obelisk', sx, sy);
    // ObeliskSprite._draw: two staggered columns of 5x5 glyphs, the 20th onwards in a second pair of columns
    const x0 = o[0] + RUNE_START[0] + 1, y0 = o[1] + RUNE_START[1] + 1 + by;
    let x = x0, y = y0;
    this.carved.forEach((id, i) => {
      const d = RUNE[id]; if (d && D.has(d.icon)) D.img(d.icon, Math.round(x), Math.round(y));
      x = i > 18 ? 14 + x0 : x0;
      if (i % 2 === 0) x += 6;
      if (i % 2 === 1) y += 7;
      if (i === 19) y = y0;
    });
    const ax = o[0] + ANVIL[0], ay = o[1] + ANVIL[1], [aw, ah] = D.size('anvil');
    if (active && D.has('anvil_outline')) { const [w, h] = D.size('anvil_outline'); D.img('anvil_outline', Math.round(ax - w / 2), Math.round(ay - h / 2)); }
    D.img('anvil', Math.round(ax - aw / 2), Math.round(ay - ah / 2));
  }

  // ------------------------------------------------------------------ panel (RuneUI: skill list, Rune Progress, rune tree, description)
  private get nodeW() { return this.host.mobile ? 17 : 14; }
  private get nodeH() { return this.host.mobile ? 19 : 16; }
  drawPanel(D: PixelDraw) {
    const h = this.host;
    if (h.towerLevel() < RUNES_TOWER) return null;
    const W = Math.min(250, h.W - 8), gap = 2;
    const listH = h.skillListHeight('rune');
    const showExp = this.smithCount() > 0, expH = showExp ? (h.mobile ? 20 : 16) : 0;
    const NW = this.nodeW, NH = this.nodeH, colW = NW + 3, rowGap = h.mobile ? 6 : 5;
    const treeH = 16 + DEPTHS * (NH + rowGap) + 2;
    const descH = h.mobile ? 82 : 70;
    const r = h.panelRect(W, listH + gap + (showExp ? expH + gap : 0) + treeH + gap + descH);
    this.panel = r;
    let y = r.y;
    h.drawSkillList('rune', 'Runecraft', r.x, y, W); y += listH + gap;

    // RuneExp: blank rune icon, count, progress bar
    if (showExp) {
      D.nine('panel', r.x, y, W, expH);
      const ty = y + Math.floor((expH - 10) / 2);
      D.img('blank_rune', r.x + 4, ty);
      D.text(fmt(h.res('blank_rune')), r.x + 16, ty, '#fff1d6', 10);
      D.text('Rune Progress', r.x + 46, ty, '#ffffff', 10);
      h.progressBar(r.x + 46 + 70, y + Math.floor(expH / 2) - 4, W - 46 - 70 - 6, 8, this.xp / this.cap());
      y += expH + gap;
    }

    // tree
    D.nine('panel', r.x, y, W, treeH);
    D.text('Runes', r.x + 4, y + 3, '#ffffff', 12);
    D.text(`${this.numRunesUnlocked() - 1}/${ORDER.length - 1}`, r.x + W - 4 - D.textW('00/00'), y + 4, '#a8a3b8', 10);
    const tx = r.x + Math.floor((W - LEAVES * colW) / 2) + 1, ty0 = y + 16;
    this.treeRect = { x: r.x, y, w: W, h: treeH };
    this.nodeRects = [];
    const pos = (id: string) => { const n = NODES[id]; return [Math.round(tx + n.cx * colW), ty0 + n.depth * (NH + rowGap)]; };
    for (const id of ORDER) {   // connectors first, under the buttons
      const n = NODES[id]; if (!n.children.length) continue;
      const [px, py] = pos(id), cxs = n.children.map(c => pos(c)[0] + NW / 2), midY = py + NH + Math.floor(rowGap / 2);
      const lit = (this.levels[id] || 0) >= 1, col = lit ? '#fff1d6' : '#6b5d84';
      D.rect(col, px + NW / 2, py + NH, 1, midY - py - NH);
      D.rect(col, Math.min(...cxs), midY, Math.max(...cxs) - Math.min(...cxs) + 1, 1);
      for (const cx of cxs) D.rect(col, cx, midY, 1, py + NH + rowGap - midY);
    }
    for (const id of ORDER) {
      const [x, ny] = pos(id), L = this.levels[id] || 0, d = RUNE[id];
      const owned = L >= 1, maxed = L >= this.maxLevel(id), buyable = this.canBuy(id);
      const img = owned && (maxed || !this.refining()) ? 'button_pressed' : buyable ? 'button' : 'button_disabled';
      D.nine(img, x, ny, NW, NH);
      if (id === this.selected) D.nine('button_hover', x - 1, ny - 1, NW + 2, NH + 2, { alpha: 0.9 });
      // 5x5 glyph drawn 2x (icon_max_width = 10); the root's question mark is already 10x10
      const [iw, ih] = D.size(d.icon), sc = iw <= 5 ? 2 : 1;
      if (iw) D.part(d.icon, 0, 0, iw, ih, x + Math.floor((NW - iw * sc) / 2), ny + Math.floor((NH - ih * sc) / 2), iw * sc, ih * sc,
        owned || buyable ? undefined : { alpha: 0.45 });
      if (this.refining() && id !== 'instructions') {   // Level1..3 pips on the right edge
        for (let i = 0; i < d.max; i++) D.img(i < L ? 'rune_skill_point_full' : 'rune_skill_point_empty', x + NW - 3, ny + 1 + i * 5);
      }
      this.nodeRects.push({ id, x, y: ny, w: NW, h: NH });
    }
    y += treeH + gap;

    // description (RuneUI.get_rune_skill_tooltip)
    D.nine('panel', r.x, y, W, descH);
    const id = this.selected, d = RUNE[id], L = this.levels[id] || 0, maxL = this.maxLevel(id);
    D.text(d.name, r.x + 4, y + 3, '#ffffff', 12);
    const shownL = d.mult ? Math.max(1, Math.min(L + (L < maxL ? 1 : 0), d.max)) : 1;
    const v = d.mult ? d.meta * (this.refining() ? shownL : 1) : d.meta;
    let text = d.desc(fmt(v));
    if (L >= 1 && !this.refining() && id !== 'instructions') text += '\n- Already unlocked';
    const lines = this.wrap(D, text, W - 8);
    lines.slice(0, h.mobile ? 4 : 3).forEach((ln, i) => this.drawLine(D, ln, r.x + 4, y + 18 + i * 11));
    const bh = h.mobile ? 20 : 14, bw = h.mobile ? 70 : 58, by = y + descH - bh - 3;
    if (id !== 'instructions' && L < maxL) {
      D.text('Cost:', r.x + 4, by + Math.floor((bh - 10) / 2), '#a8a3b8', 10);
      D.img('blank_rune', r.x + 32, by + Math.floor((bh - 10) / 2));
      D.text(String(this.cost(id)), r.x + 44, by + Math.floor((bh - 10) / 2), this.host.res('blank_rune') >= this.cost(id) ? '#fff1d6' : '#ff8fb1', 10);
      if (!this.parentOk(id)) D.text('Unlock the rune above first', r.x + 58, by + Math.floor((bh - 10) / 2), '#a8a3b8', 10);
      else if (h.button('rune_buy', L >= 1 ? 'Upgrade' : 'Unlock', r.x + W - bw - 4, by, bw, bh, !this.canBuy(id))) this.buy(id);
    } else if (id !== 'instructions') D.text(L >= 1 ? 'Unlocked' : '', r.x + 4, by + Math.floor((bh - 10) / 2), '#fff1d6', 10);
    return r;
  }
  // rich text: words and {x_icon} tokens, wrapped to maxW
  private wrap(D: PixelDraw, str: string, maxW: number): string[][] {
    const out: string[][] = [];
    for (const para of str.split('\n')) {
      if (!para) continue;
      let line: string[] = [], lw = 0;
      for (const tok of para.split(/(\{\w+\}|\s+)/).filter(t => t !== '')) {
        const w = /^\{\w+\}$/.test(tok) ? 11 : D.textW(tok, 10);
        if (lw + w > maxW && line.length && !/^\s+$/.test(tok)) { out.push(line); line = []; lw = 0; }
        if (!line.length && /^\s+$/.test(tok)) continue;
        line.push(tok); lw += w;
      }
      out.push(line);
    }
    return out;
  }
  private iconImg(D: PixelDraw, key: string) {
    if (D.has(key)) return key;
    const base = key.replace(/_icon$/, '');
    return D.has(base) ? base : D.has(base + '_icon') ? base + '_icon' : null;
  }
  private drawLine(D: PixelDraw, toks: string[], x: number, y: number) {
    let cx = x;
    for (const t of toks) {
      const m = t.match(/^\{(\w+)\}$/);
      if (m) { const img = this.iconImg(D, m[1]); if (img) D.img(img, cx, y); cx += 11; continue; }
      D.text(t, cx, y, '#fff1d6', 10); cx += D.textW(t, 10);
    }
  }
  hitUi(x: number, y: number) {
    const r = this.treeRect;
    const S = this.host.S || {}, on = (a: string) => a === this.id || a === 'obelisk';
    return !!r && (on(S.activeArea) || on(S.navigated)) && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }
  onTap(x: number, y: number) {
    for (const n of this.nodeRects) {
      if (x >= n.x - 1 && x < n.x + n.w + 2 && y >= n.y - 2 && y < n.y + n.h + 3) {
        // a second tap on the selected rune buys it (desktop players expect the original click-to-buy)
        if (this.selected === n.id && this.canBuy(n.id)) this.buy(n.id);
        else { this.selected = n.id; this.host.play('tooltip_hover', -8, 0.05); }
        return true;
      }
    }
    return true;
  }

  multipliers(): Multipliers {
    return {
      wood: 1 + this.runeValue('wood_rune') / 100,               // Forest.gd runecraft_bonus
      cloudling_magic: 1 + this.runeValue('cloud_rune') / 100,   // SpiritAnimation.gd rune_bonus (cloudling balls only)
    };
  }

  // ------------------------------------------------------------------ save / reset
  save() { return { levels: { ...this.levels }, carved: this.carved.slice(), level: this.level, xp: this.xp, refiningDebug: this.refiningDebug }; }
  load(d: any) {
    if (!d) return;
    this.levels = { instructions: 1 };
    if (d.levels) for (const k of Object.keys(d.levels)) if (RUNE[k] && k !== 'instructions') this.levels[k] = d.levels[k] | 0;
    this.carved = (d.carved || []).filter((id: string) => RUNE[id] && (this.levels[id] || 0) >= 1);
    this.level = d.level || 0; this.xp = d.xp || 0; this.refiningDebug = !!d.refiningDebug;
    this.smiths = [];
  }
  reset(_keepPermanent: boolean) {   // the rune tree, the bar and the smiths belong to the run (current_run.tscn)
    this.levels = { instructions: 1 }; this.carved = []; this.level = 0; this.xp = 0; this.smiths = []; this.fx = []; this.labels = [];
    const b = this.host.res('blank_rune'); if (b > 0) this.host.spend('blank_rune', b);
    this.selected = 'instructions';
  }
  onTowerBuilt(level: number) {   // RuneSmiths.on_tower_upgraded: Blessing of Debt starts the run with smiths
    if (level < RUNES_TOWER) return;
    const debt = this.blessing('spirit_debt_blessing'), S = this.host.S;
    if (debt > 0 && this.smithCount() === 0 && S && S.skills) S.skills.summon_rune_smith = 10;
  }

  // ------------------------------------------------------------------ dev panel
  private setSkill(id: string, v: number) { const h: any = this.host; if (h.setSkillLevel) h.setSkillLevel(id, v); else if (h.S && h.S.skills) h.S.skills[id] = v; }
  debug: Record<string, (...args: any[]) => void> = {
    summonSmiths10: () => this.setSkill('summon_rune_smith', this.smithCount() + 10),
    summonSmiths100: () => this.setSkill('summon_rune_smith', this.smithCount() + 100),
    blankRunes50: () => this.host.addResource('blank_rune', 50),
    forgeRune: () => this.addExp((this.cap() - this.xp) / Math.max(1e-9, this.expBonus())),
    unlockAllRunes: () => { for (const id of ORDER) if ((this.levels[id] || 0) < 1) this.buy(id, true); },
    maxAllRunes: () => { this.refiningDebug = true; for (const id of ORDER) while ((this.levels[id] || 0) < this.maxLevel(id)) this.buy(id, true); },
    toggleRefining: () => { this.refiningDebug = !this.refiningDebug; },
    runeMastery10: () => this.setSkill('rune_mastery', 10),
    infinityUpgrade10: () => { if (!this.runeUnlocked('infinity')) { for (const id of ['create_gorgons', 'infinity']) if (!this.runeUnlocked(id)) this.buy(id, true); } this.setSkill('infinity_rune_upgrade', this.lvl('infinity_rune_upgrade') + 10); },
    resetTree: () => { this.levels = { instructions: 1 }; this.carved = []; },
  };
}

registerModule(new RunesModule());
