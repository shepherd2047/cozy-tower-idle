// Embassy (tower 5, after build_embassy): diplomats walk door -> portal -> door and create Trade Agreements,
// which establish relations with the 21 nations on the map for permanent bonuses.
// Port of Embassy.gd, EmbassyPortal.gd, EmbassyUI.gd, Nation.gd, NationDef.gd, DiplomatGold.gd, DiplomatSpirits.gd
// and data/nations/*.tres. World coordinates are the original ones (EmbassyBuilding at (675, 275) in current_run.tscn).
// Owner: tw-embassy. buildings.ts owns build_embassy, its block animation and the building + portal drawing; this module
// draws them only when no Building module is registered.
import { ImageAsset, resources } from 'cc';
import { registerModule } from '../GameModule';
import type { GameHost, GameModule, Multipliers, SkillDef } from '../GameModule';
import type { PixelDraw } from '../PixelDraw';

// ---------------------------------------------------------------- data
type Effect =
  | { kind: 'mult', mult: string, value: number }          // multipliers(): kind -> factor
  | { kind: 'applied' }                                    // applied by another module through hasRelations()
  | { kind: 'instant', res: string, amount: number }       // Nation._on_nation_selected
  | { kind: 'unlock' } | { kind: 'chronara' } | { kind: 'none' };
interface NationDef {
  id: string; name: string; desc: string; threshold: number; adj: string[];
  flag: [number, number]; start?: boolean; hideUntilBlessing?: boolean; effect: Effect;
}
// Percent bonuses keep the original formulas: Forest/Study/SpiritAnimation/Wall/DragonNest use (1 + p/100),
// AlchemyUI uses p/100 (Prismara x1.5, Tenebris x2). Arcanis x1.5 / Fel x2 Academy EXP is applied by academy.ts.
const NATIONS: NationDef[] = [
  { id: 'starting_nation', name: 'Your Domain', threshold: 0, adj: [], flag: [25, 67], start: true, effect: { kind: 'none' },
    desc: 'This is your home. When you have enough {trade_agreements_icon}, tap a nation next to you to befriend it.' },
  { id: 'prismara_nation', name: 'Prismara', threshold: 500, adj: ['starting_nation'], flag: [18, 41], effect: { kind: 'mult', mult: 'magic_gold_speed', value: 1.5 },
    desc: 'A land of crystal shores\n\n- Relations bonus: {magic_gold_icon} is made 150% faster' },
  { id: 'tempestus_nation', name: 'Tempestus', threshold: 500, adj: ['starting_nation'], flag: [40, 78], effect: { kind: 'mult', mult: 'cloudling_magic', value: 2.5 },
    desc: 'A land of thunder peaks\n\n- Relations bonus: Cloudlings make 150% more {magic_icon}' },
  { id: 'verdania_nation', name: 'Verdania', threshold: 750, adj: ['starting_nation'], flag: [35, 47], effect: { kind: 'mult', mult: 'wood', value: 2.5 },
    desc: 'Nation of vast forests\n\n- Relations bonus: Increases {wood_icon} gain by 150%' },
  { id: 'maristella_nation', name: 'Maristella', threshold: 1000, adj: ['tempestus_nation'], flag: [49, 94], effect: { kind: 'mult', mult: 'knowledge', value: 2.5 },
    desc: 'A land of merchant ships\n\n- Relations bonus: 150% more {knowledge_icon}' },
  { id: 'xara_nation', name: 'Xara', threshold: 1000, adj: ['prismara_nation', 'verdania_nation'], flag: [32, 26], effect: { kind: 'instant', res: 'dragonite', amount: 5 },
    desc: 'A land of red sand\n\n- Relations bonus: Receive 5 Dragonite right away.' },
  { id: 'arcanis_nation', name: 'Arcanis', threshold: 1250, adj: ['verdania_nation', 'xara_nation'], flag: [50, 35], effect: { kind: 'applied' },
    desc: 'A land of old spellbooks\n\n- Relations bonus: The Academy earns 150% more EXP' },
  { id: 'chronara_nation', name: 'Chronara', threshold: 1250, adj: ['maristella_nation'], flag: [99, 102], hideUntilBlessing: true, effect: { kind: 'chronara' },
    desc: 'An island that sometimes sinks out of sight\n\n- Relations bonus: Every 2 seconds, get one Trade Agreement per diplomat.' },
  { id: 'lilon_nation', name: 'Lilon', threshold: 1500, adj: ['arcanis_nation'], flag: [77, 15], effect: { kind: 'mult', mult: 'cloudling_magic', value: 2.5 },
    desc: 'Nation of wind and coasts\n\n- Relations bonus: Increases Cloudling {magic_icon} gain by 150%' },
  { id: 'netus_nation', name: 'Netus', threshold: 1500, adj: ['arcanis_nation', 'lilon_nation'], flag: [71, 34], effect: { kind: 'unlock' },
    desc: 'A land of workshops\n\n- Relations bonus: New Knowledge upgrades for the forest and the Academy' },
  { id: 'istesha_nation', name: 'Istesha', threshold: 1750, adj: ['lilon_nation', 'netus_nation'], flag: [96, 32], effect: { kind: 'instant', res: 'dragon_ability_points', amount: 12 },
    desc: 'Nation of dragons\n\n- Relations bonus: Instantly gain 12 dragon ability points' },
  { id: 'odantis_nation', name: 'Odantis', threshold: 1750, adj: ['tedora_nation', 'lilon_nation'], flag: [100, 10], effect: { kind: 'mult', mult: 'knowledge', value: 2.5 },
    desc: 'Nation of long winters\n\n- Relations bonus: Increases {knowledge_icon} gain by 150%' },
  { id: 'tedora_nation', name: 'Tedora', threshold: 2000, adj: ['istesha_nation', 'lilon_nation'], flag: [110, 27], effect: { kind: 'mult', mult: 'wood', value: 2.5 },
    desc: 'Nation of Ancient Forests\n\n- Relations bonus: Increases {wood_icon} gain by 150%' },
  { id: 'luscana_nation', name: 'Luscana', threshold: 2500, adj: ['tedora_nation', 'odantis_nation'], flag: [126, 24], effect: { kind: 'instant', res: 'mana_stone', amount: 5 },
    desc: 'Nation of the jewelry\n\n- Relations bonus: Instantly gain 5 Mana Stones.' },
  { id: 'peace_land_nation', name: 'Peace Land', threshold: 3000, adj: ['luscana_nation'], flag: [141, 47], effect: { kind: 'instant', res: 'spirits', amount: 25 },
    desc: 'A land of tiny folk and friendly spirits\n\n- Relations bonus: Receive 25 {spirit_icon} right away.' },
  { id: 'axel_nation', name: 'Axel', threshold: 4000, adj: ['peace_land_nation'], flag: [129, 57], effect: { kind: 'unlock' },
    desc: 'A kingdom of wide plains and wandering heroes\n\n- Relations bonus: New Knowledge upgrades for Sorcery and the Dragon Nest.' },
  { id: 'lapis_nation', name: 'Lapis', threshold: 4000, adj: ['axel_nation', 'peace_land_nation'], flag: [142, 70], effect: { kind: 'instant', res: 'cognite', amount: 5 },
    desc: 'A land of tall rock towers\n\n- Relations bonus: Receive 5 Cognite right away.' },
  { id: 'janand_nation', name: 'Janand', threshold: 4000, adj: ['lapis_nation', 'chronara_nation', 'axel_nation'], flag: [125, 82], effect: { kind: 'mult', mult: 'damage', value: 2 },
    desc: 'A land built by outcasts\n\n- Relations bonus: Every unit deals double damage' },
  { id: 'tenebris_nation', name: 'Tenebris', threshold: 4000, adj: ['peace_land_nation', 'lapis_nation'], flag: [157, 58], effect: { kind: 'mult', mult: 'magic_gold_speed', value: 2 },
    desc: 'Nation of vast caves\n\n- Relations bonus: Increases {magic_gold_icon} production speed by 200%' },
  { id: 'ceha_nation', name: 'Ceha', threshold: 4500, adj: ['tenebris_nation', 'wedol_nation', 'lapis_nation'], flag: [156, 80], effect: { kind: 'mult', mult: 'dragon_exp', value: 4 },
    desc: 'Land of volcanoes \n\n- Relations bonus: Dragon Keepers provide 300% more Dragon EXP' },
  { id: 'fel_nation', name: 'Fel', threshold: 4500, adj: ['tenebris_nation'], flag: [179, 51], effect: { kind: 'applied' },
    desc: 'A land with a famous school\n\n- Relations bonus: The Academy earns 200% more EXP' },
  { id: 'wedol_nation', name: 'Wedol', threshold: 4500, adj: ['tenebris_nation', 'fel_nation'], flag: [170, 70], effect: { kind: 'instant', res: 'totems', amount: 3 },
    desc: 'Empire of the rainforest\n\n- Relations bonus: Instantly gain 3 totems.' },
];
const BY_ID: Record<string, NationDef> = {};
// Nation._ready: adjacency is symmetric
const ADJ: Record<string, string[]> = {};
for (const n of NATIONS) { BY_ID[n.id] = n; ADJ[n.id] = n.adj.slice(); }
for (const n of NATIONS) for (const a of n.adj) if (ADJ[a].indexOf(n.id) < 0) ADJ[a].push(n.id);
const tex = (n: NationDef) => 'nation_' + n.id.replace(/_nation$/, '');

// Nation.update_ui tints. Colors.gd used dark tints (#292459 / #662887 / #ac37d0) over white masks; the art-v2
// nations are coloured provinces, so the same three states use light tints (Hello 2's recommendation).
const DISABLED = '#8f8aa8', UNSELECTED = '#d8d0ee', HOVERED = '#ffffff', FOCUSED = '#fe6cee';
// current_run.tscn / embassy_area.tscn (world space)
const EMB: [number, number] = [675, 275];
const PORTAL: [number, number] = [EMB[0] + 83, EMB[1] + 21];
const DOORS: [number, number][] = [-31, -16, -1, 14, 29].map(dx => [EMB[0] + dx, EMB[1] + 31] as [number, number]);
const SHORTCUT: [number, number] = [EMB[0] + 30, EMB[1] - 44];
const AREA: [number, number] = [EMB[0] - 2.5, EMB[1] + 5];
const AREA_POLY = [[-59, 43], [-59, -7], [-59, -19], [-50.395, -19], [3, -45], [54, -19], [142, -19], [102, 43]];
const SPEED = 50, SPEED_UP = 35;                     // Embassy.gd speed, summon_diplomat speed_up_increase
const NATION_TIMER_MAX = 2.0;
const DIPLOMACY_GOLD = 30;                           // blessing_of_diplomacy amount per level
const SPIRIT_DEBT_START = 20;                        // spirit_debt start_amount
const GOLD_SPEED = 100, GOLD_GRAVITY = 200;          // DiplomatGold.gd
const SPIRIT_SPEED = 200, SPIRIT_GRAVITY = 200, OSC_AMP = 30, OSC_FREQ = 0.5, GRAVITY_SWITCH = 50, RING = 12;  // DiplomatSpirits.gd
const RELICS = ['dragonite', 'mana_stone', 'cognite'];   // alchemy.addRelic, not plain resources
const MAP_W = 200, MAP_H = 120, LIST_W = 208;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
function pointInPoly(px: number, py: number, pts: number[][]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function fmt(n: number): string {
  n = Math.floor(n);
  if (n < 10000) return String(n);
  const suf = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'], e = Math.floor(Math.log10(n) / 3);
  return (Math.floor(n / 10 ** (3 * e) * 100) / 100) + (suf[e] || 'e' + 3 * e);
}

interface Diplomat { x: number; y: number; state: 'inside' | 'moving_to_portal' | 'at_portal' | 'returning'; t: number; tx: number; ty: number; hidden: boolean; flip: boolean; }
interface Mote { x: number; y: number; vx: number; vy: number; wave?: boolean; sx?: number; sy?: number; base?: number; phase?: number; amp?: number; }
interface Indicator { x: number; y: number; text: string; icon: string; t: number; time: number; dy: number; screen?: boolean; }

class EmbassyModule implements GameModule {
  id = 'embassy';
  unlockTower = 5;
  nav = { label: 'Embassy' };
  resources = [{ id: 'trade_agreements', icon: 'trade_agreements', name: 'Trade Agreements' }];
  skills: Record<string, SkillDef> = {
    summon_diplomat: {
      list: 'embassy', name: 'Summon Diplomat', res: 'spirits', cost: () => 1, max: 10000, icon: 'diplomat',
      summon: true, showLevel: true,
      tip: () => `Call a diplomat who writes Trade Agreements.\n\n- Hold the Embassy to make them work ${SPEED_UP}% faster\n\n- Once every nation is your friend, diplomats can be traded back for {spirit_icon}.`,
    },
  };

  private host!: GameHost;
  relations: Record<string, boolean> = { starting_nation: true };
  private diplomats: Diplomat[] = [];
  private golds: Mote[] = [];
  private spirits: Mote[] = []; private spiritTime = 0;
  private indicators: Indicator[] = [];
  private speedMult = 1; private speedTimer = 0;
  private nationTimer = 0;
  private time = 0;
  private wasBuilt = false; introduced = false; private debtGiven = false;
  private selected = '';                                          // tapped nation (tooltip + outline)
  private showAll = false;                                        // debug: reveal Chronara without the blessing
  private forceBuilt = false;                                     // debug: show the embassy without the Building module
  private prefetched = false;                                     // map art requested from the lazy loader
  private lastPanelH = 0;                                         // portrait: re-focus the camera when the panel grows
  private panel: { x: number, y: number, w: number, h: number } | null = null;
  private mapRect: { x: number, y: number } | null = null;
  private masks: Record<string, Uint8Array> = {};                  // alpha masks for pixel-exact map picking

  init(host: GameHost) { this.host = host; this.loadMasks(); }

  // ================================================================ queries (cross-module API)
  built(): boolean {
    if (this.forceBuilt) return true;
    const b: any = this.host && this.host.modules.buildings; return !!(b && b.hasBuilding && b.hasBuilding('embassy'));
  }
  available() { return this.built(); }
  hasRelations(id: string): boolean { if (!/_nation$/.test(id)) id += '_nation'; return !!this.relations[id]; }
  numDiplomats() { return this.host ? this.host.skillLevel('summon_diplomat') : 0; }
  private blessing(id: string): number { const p: any = this.host.modules.prestige; return p && p.blessingLevel ? p.blessingLevel(id) || 0 : 0; }
  private nationVisible(n: NationDef) { return !n.hideUntilBlessing || this.showAll || this.blessing('blessing_of_exploration') > 0; }
  private canAfford(n: NationDef) { return n.threshold <= this.host.res('trade_agreements'); }
  // Nation.is_nation_available: adjacent to a nation with relations, and affordable
  isAvailable(n: NationDef) {
    if (n.start || !this.nationVisible(n)) return false;
    return ADJ[n.id].some(a => this.relations[a]) && this.canAfford(n);
  }
  private allVisibleHaveRelations() { return NATIONS.every(n => this.relations[n.id] || !this.nationVisible(n)); }
  allHaveRelations() { return NATIONS.every(n => this.relations[n.id]); }
  relationsCount() { return NATIONS.filter(n => !n.start && this.relations[n.id]).length; }

  multipliers(): Multipliers {
    const m: Multipliers = {};
    for (const n of NATIONS) if (this.relations[n.id] && n.effect.kind === 'mult') m[n.effect.mult] = (m[n.effect.mult] || 1) * n.effect.value;
    return m;
  }

  // ================================================================ actions
  // Nation._on_nation_selected
  establish(id: string, free = false): boolean {
    const n = BY_ID[id]; if (!n || this.relations[id]) return false;
    if (!free) { if (!this.isAvailable(n) || !this.host.spend('trade_agreements', n.threshold)) return false; }   // adjacent + affordable
    this.relations[id] = true;
    const fx = this.mapRect ? [this.mapRect.x + n.flag[0], this.mapRect.y + n.flag[1] - 6] : null;
    if (n.effect.kind === 'instant') {
      // tw-dragons: the Istesha points are added here (DragonNestUI listened to relations_established in the original)
      const alch: any = this.host.modules.alchemy;
      if (RELICS.indexOf(n.effect.res) >= 0 && alch && alch.addRelic) alch.addRelic(n.effect.res, n.effect.amount);
      else this.host.addResource(n.effect.res, n.effect.amount);
      if (fx) this.indicators.push({ x: fx[0], y: fx[1], text: fmt(n.effect.amount), icon: this.resIcon(n.effect.res), t: 0, time: 0.8, dy: -16, screen: true });
    }
    // DiplomatGold.summon_golds (Blessing of Diplomacy)
    const golds = DIPLOMACY_GOLD * this.blessing('blessing_of_diplomacy');
    for (let i = 0; i < golds; i++) this.golds.push({ x: PORTAL[0], y: PORTAL[1], vx: rand(-GOLD_SPEED, GOLD_SPEED), vy: rand(-GOLD_SPEED, GOLD_SPEED) });
    this.host.play('summon', -6);
    if (this.allHaveRelations()) this.host.toast('Achievement: Diplomacy - relations with every nation!');
    return true;
  }
  private resIcon(res: string) {
    return ({ spirits: 'spirit_icon', totems: 'totem_icon', magic_gold: 'magic_gold_icon', dragon_ability_points: 'ability_point' } as any)[res] || res;
  }
  // EmbassyUI._refund_diplomats: spirits fly back to the orb, diplomats leave, Trade Agreements are cleared
  refundDiplomats() {
    const n = this.numDiplomats(); if (n <= 0) return;
    this.spiritTime = 0;
    for (let i = 0; i < n; i++) {
      const d = DOORS[Math.floor(Math.random() * DOORS.length)];
      this.spirits.push({ x: d[0], y: d[1], vx: 0, vy: 0, wave: true, sx: d[0], sy: d[1], base: rand(SPIRIT_SPEED * 0.75, SPIRIT_SPEED), phase: rand(0, Math.PI * 2), amp: rand(OSC_AMP * 0.5, OSC_AMP) });
    }
    this.host.S.skills.summon_diplomat = 0;
    this.diplomats = [];
    const ta = this.host.res('trade_agreements'); if (ta > 0) this.host.spend('trade_agreements', ta);
    this.host.play('summon', -4);
  }

  // ================================================================ simulation
  update(dt: number) {
    const host = this.host; this.time += dt;
    const built = this.built();
    if (built && !this.wasBuilt) this.onBuilt();
    this.wasBuilt = built;
    this.updateIndicators(dt);
    this.updateGolds(dt); this.updateSpirits(dt);
    if (!built) return;
    if (!this.prefetched) {   // host loads art lazily: request the map art before the panel first opens
      this.prefetched = true;
      for (const k of NATIONS.map(tex).concat(['map_features', 'flag_icon', 'diplomat', 'embassy_area_outline', 'trade_agreements', 'magic_gold', 'bright_spirit'])) host.D.has(k);
    }
    // Spirit Debt blessing: start with 20 diplomats (EmbassyUI.load_data / BuildingPanel._on_building_shown)
    if (!this.debtGiven && (this.blessing('spirit_debt') > 0 || this.blessing('spirit_debt_blessing') > 0) && this.numDiplomats() === 0 && !this.allHaveRelations()) {
      host.S.skills.summon_diplomat = SPIRIT_DEBT_START; this.debtGiven = true;
    }
    this.manageDiplomats();
    this.speedTimer = Math.max(0, this.speedTimer - dt);
    if (this.speedTimer <= 0) this.speedMult = 1;
    this.nationTimer += dt;
    if (this.nationTimer >= NATION_TIMER_MAX && this.relations.chronara_nation) {
      this.nationTimer = 0;
      const v = this.numDiplomats();
      if (v > 0) {
        host.addResource('trade_agreements', v);
        if (this.mapRect) this.indicators.push({ x: this.mapRect.x + 99, y: this.mapRect.y + 96, text: fmt(v), icon: 'trade_agreements', t: 0, time: 0.4, dy: -10, screen: true });
      }
    }
    this.updateDiplomats(dt);
  }
  private onBuilt() {
    if (this.introduced) return;
    this.introduced = true;   // BuildingPanel.building_animation_finished -> navigate_to_embassy (buildings flies the camera via worldFocus())
    if (!this.host.modules.buildings) this.host.camFocus(SHORTCUT[0], SHORTCUT[1]);
    this.host.S.navigated = 'embassy';
  }
  private manageDiplomats() {
    const n = this.numDiplomats();
    if (this.diplomats.length > n) this.diplomats.length = n;
    while (this.diplomats.length < n) {
      const d = this.door();
      this.diplomats.push({ x: d[0], y: d[1], state: 'inside', t: rand(0, 6.9), tx: 0, ty: 0, hidden: true, flip: false });
    }
  }
  private door() { return DOORS[Math.floor(Math.random() * DOORS.length)]; }
  private speed() { return this.speedMult; }
  // Utils.add_click_speed_bonuses: +5% flat while the tower is at most TOWER_WITH_ALCHEMY
  speedUp() {
    this.speedMult = 1 + SPEED_UP / 100 + (this.host.towerLevel() <= 6 ? 0.05 : 0);
    this.speedTimer = 0.4;
  }
  private updateDiplomats(dt: number) {
    const sp = this.speed();
    for (const d of this.diplomats) {
      switch (d.state) {
        case 'inside':
          d.t -= dt;
          if (d.t <= 0) {
            const door = this.door();
            d.state = 'moving_to_portal'; d.hidden = false; d.x = door[0]; d.y = door[1];
            d.tx = PORTAL[0]; d.ty = PORTAL[1] - rand(-16, 16);
          }
          break;
        case 'moving_to_portal': case 'returning': {
          const dx = d.tx - d.x, dy = d.ty - d.y, len = Math.hypot(dx, dy) || 1;
          d.x += dx / len * SPEED * dt * sp; d.y += dy / len * SPEED * dt * sp; d.flip = dx < 0;
          if (Math.hypot(d.tx - d.x, d.ty - d.y) < 5) {
            d.hidden = true; d.t = 3.0 / sp;
            this.host.play('diplomat', -12, 0.05);
            if (d.state === 'moving_to_portal') d.state = 'at_portal';
            else { d.state = 'inside'; this.progress(1, d.x - 6, d.y); }
          }
          break;
        }
        case 'at_portal':
          d.t -= dt;
          if (d.t <= 0) { const door = this.door(); d.state = 'returning'; d.hidden = false; d.tx = door[0]; d.ty = door[1]; }
          break;
      }
    }
  }
  // Embassy.progress: blessing bonuses (population / n / few / destruction) come in through host.mult('diplomat')
  private progress(amount: number, x: number, y: number) {
    const v = amount * this.host.mult('diplomat');
    if (v <= 0) return;
    this.host.addResource('trade_agreements', v);
    if (this.indicators.length < 40) this.indicators.push({ x, y, text: fmt(v), icon: 'trade_agreements', t: 0, time: 0.4, dy: -16 });
  }
  private alchemyPos(): [number, number] {
    const a: any = this.host.modules.alchemy;
    const p = a && (a.areaPos ? a.areaPos() : a.worldFocus ? a.worldFocus() : null);
    return p || this.host.orbPos();
  }
  private updateGolds(dt: number) {
    if (!this.golds.length) return;
    const [px, py] = this.alchemyPos(), decay = Math.pow(0.2, dt);
    for (let i = this.golds.length - 1; i >= 0; i--) {
      const g = this.golds[i], dx = px - g.x, dy = py - g.y, l = Math.hypot(dx, dy) || 1;
      g.vx += dx / l * GOLD_GRAVITY * dt; g.vy += dy / l * GOLD_GRAVITY * dt;
      const v = Math.hypot(g.vx, g.vy), k = v > GOLD_SPEED ? GOLD_SPEED / v : 1;
      g.vx *= k * decay; g.vy *= k * decay;
      g.x += g.vx * dt; g.y += g.vy * dt;
      if (Math.hypot(px - g.x, py - g.y) <= 12) { this.golds.splice(i, 1); this.host.addResource('magic_gold', 1); }
    }
  }
  private updateSpirits(dt: number) {
    if (!this.spirits.length) return;
    const [ox, oy] = this.host.orbPos(), decay = Math.pow(0.2, dt);
    this.spiritTime += dt;
    const t = this.spiritTime;
    for (let i = this.spirits.length - 1; i >= 0; i--) {
      const s = this.spirits[i];
      if (s.wave) {
        const dx = ox - s.sx!, dy = oy - s.sy!, dist = Math.hypot(dx, dy) || 1, nx = dx / dist, ny = dy / dist;
        const k = Math.min(t * s.base! / dist, 1), off = Math.sin(t * OSC_FREQ * Math.PI * 2 + s.phase!) * s.amp!;
        s.x = s.sx! + dx * k - ny * off; s.y = s.sy! + dy * k + nx * off;
        if (Math.hypot(ox - s.x, oy - s.y) <= GRAVITY_SWITCH) {
          s.wave = false; const l = Math.hypot(ox - s.x, oy - s.y) || 1;
          s.vx = (ox - s.x) / l * s.base!; s.vy = (oy - s.y) / l * s.base!;
        }
      } else {
        const dx = ox - s.x, dy = oy - s.y, l = Math.hypot(dx, dy) || 1;
        s.vx += dx / l * SPIRIT_GRAVITY * dt; s.vy += dy / l * SPIRIT_GRAVITY * dt;
        const v = Math.hypot(s.vx, s.vy), k = v > SPIRIT_SPEED ? SPIRIT_SPEED / v : 1;
        s.vx *= k * decay; s.vy *= k * decay; s.x += s.vx * dt; s.y += s.vy * dt;
      }
      if (Math.hypot(ox - s.x, oy - s.y) <= RING) { this.spirits.splice(i, 1); this.host.addResource('spirits', 1); }
    }
  }
  private updateIndicators(dt: number) {
    for (let i = this.indicators.length - 1; i >= 0; i--) { const d = this.indicators[i]; d.t += dt; if (d.t >= d.time + 0.3) this.indicators.splice(i, 1); }
  }

  // ================================================================ input
  hitWorld(wx: number, wy: number) { return this.built() && pointInPoly(wx - AREA[0], wy - AREA[1], AREA_POLY); }
  onHold(_dt: number, wx: number, wy: number) { if (this.hitWorld(wx, wy)) this.speedUp(); }
  hitUi(x: number, y: number) { const p = this.panel; return !!p && x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h; }
  onTap(x: number, y: number) {
    if (!this.hitUi(x, y)) return false;
    const m = this.mapRect;
    if (m && x >= m.x && x < m.x + MAP_W && y >= m.y && y < m.y + MAP_H) {
      const n = this.pick(x - m.x, y - m.y);
      if (n) {
        this.selected = n.id;
        this.host.play('tooltip_hover', -8, 0.05);
        // EmbassyUI._gui_input: clicking an available nation establishes relations
        if (!this.relations[n.id] && this.isAvailable(n)) this.establish(n.id);
      } else this.selected = '';
      return true;
    }
    return false;
  }
  // EmbassyUI.get_selected_nation: first nation (registry order) whose texture is opaque under the pointer
  private pick(mx: number, my: number): NationDef | null {
    const ix = Math.floor(mx), iy = Math.floor(my);
    const order = NATIONS.slice().sort((a, b) => a.id < b.id ? -1 : 1);
    let haveMasks = false;
    for (const n of order) {
      if (!this.nationVisible(n)) continue;
      const mk = this.masks[n.id]; if (!mk) continue; haveMasks = true;
      if (mk[iy * MAP_W + ix]) return n;
    }
    if (haveMasks) return null;
    // fallback without pixel data: nearest flag
    let best: NationDef | null = null, bd = 1e9;
    for (const n of NATIONS) { if (!this.nationVisible(n)) continue; const d = Math.hypot(n.flag[0] - mx, n.flag[1] + 6 - my); if (d < bd) { bd = d; best = n; } }
    return bd < 30 ? best : null;
  }
  private loadMasks() {
    const doc: any = (globalThis as any).document; if (!doc || !doc.createElement) return;
    for (const n of NATIONS) {
      const got = (err: Error | null, a: ImageAsset, dir: string) => {
        if (err || !a) { if (dir === 'art/') resources.load('art_orig/' + tex(n), ImageAsset, (e2: Error | null, a2: ImageAsset) => got(e2, a2, 'art_orig/')); return; }
        try {
          const src: any = a.data, c = doc.createElement('canvas'); c.width = MAP_W; c.height = MAP_H;
          const g = c.getContext('2d'); g.drawImage(src, 0, 0);
          const px = g.getImageData(0, 0, MAP_W, MAP_H).data, mk = new Uint8Array(MAP_W * MAP_H);
          for (let i = 0; i < mk.length; i++) mk[i] = px[i * 4 + 3] > 0 ? 1 : 0;
          this.masks[n.id] = mk;
        } catch (e) { /* no pixel access: nearest-flag picking */ }
      };
      resources.load('art/' + tex(n), ImageAsset, (err: Error | null, a: ImageAsset) => got(err, a, 'art/'));   // art-v2 first
    }
  }

  // ================================================================ drawing
  worldFocus(): [number, number] { return SHORTCUT; }
  drawWorldBack(D: PixelDraw) {
    if (!this.built()) return;
    const active = this.host.S.activeArea === 'embassy' || this.host.S.navigated === 'embassy';
    // buildings.ts draws the embassy + portal once its build animation finishes; the area outline is a hollow ring
    if (this.host.modules.buildings) {
      if (active) D.img('embassy_area_outline', Math.round(AREA[0] + 2 - 60.5 + 0.5), Math.round(AREA[1] - 5 - 47 + 0.5));
      return;
    }
    // portal (behind the building): dark area, cloud swirl (7 frames @ 6 fps), frame
    D.img('embassy_portal_dark_area', Math.round(PORTAL[0] - 7.5), Math.round(PORTAL[1] + 2 - 24));
    const fr = Math.floor(this.time * 6) % 7;
    D.part('embassy_portal_clouds', fr * 18, 0, 18, 33, Math.round(PORTAL[0] - 1 - 9 + 0.5), Math.round(PORTAL[1] + 1 - 16.5 + 0.5), 18, 33);
    D.img('embassy_portal', Math.round(PORTAL[0] - 15.5), Math.round(PORTAL[1] - 26));
    if (active) D.img('embassy_area_outline', Math.round(AREA[0] + 2 - 60.5 + 0.5), Math.round(AREA[1] - 5 - 47 + 0.5));
    D.img('embassy', Math.round(EMB[0] - 59.5), Math.round(EMB[1] - 46.5));
  }
  drawWorld(D: PixelDraw) {
    if (this.built()) for (const d of this.diplomats) if (!d.hidden) D.img('diplomat', Math.round(d.x - 4.5), Math.round(d.y - 4.5), { flipX: d.flip });
    for (const g of this.golds) D.img('magic_gold', Math.round(g.x - 2.5), Math.round(g.y - 2.5));
    for (const s of this.spirits) D.img('bright_spirit', Math.round(s.x - 1.5), Math.round(s.y - 1.5));
    for (const d of this.indicators) if (!d.screen) this.drawIndicator(D, d);
  }
  private drawIndicator(D: PixelDraw, d: Indicator) {
    const k = Math.min(d.t / d.time, 1), a = d.t > d.time ? 1 - (d.t - d.time) / 0.3 : 1;
    const y = d.y + d.dy * (1 - Math.pow(1 - k, 3)), w = D.textW(d.text) + 11, x = d.x - w / 2;
    D.img(d.icon, Math.round(x), Math.round(y - 5), { alpha: a });
    D.text(d.text, Math.round(x + 11), Math.round(y - 5));
  }

  // panel sections (screen px)
  private layoutPanel() {
    const complete = this.allVisibleHaveRelations();
    const mapShown = complete || this.numDiplomats() > 0 || this.relationsCount() > 0;
    const sel = this.selected ? BY_ID[this.selected] : null;
    const tipLines = sel && mapShown ? this.layout(this.tooltip(sel), LIST_W - 10) : [];
    const listH = complete ? 0 : this.host.skillListHeight('embassy');
    const refundH = complete ? 32 : 0;
    const mapH = mapShown ? MAP_H + 8 : 0;
    const tipH = tipLines.length ? 20 + tipLines.length * 12 : 0;
    const h = listH + (refundH ? refundH + 2 : 0) + (mapH ? mapH + 2 : 0) + (tipH ? tipH + 2 : 0);
    return { sel, tipLines, listH, refundH, mapH, tipH, h };
  }
  drawPanel(D: PixelDraw) {
    if (!this.built()) { this.panel = null; this.mapRect = null; return null; }
    const host = this.host, diplomats = this.numDiplomats();
    const { sel, tipLines, listH, refundH, mapH, tipH, h } = this.layoutPanel();
    const r = host.panelRect(LIST_W, h);
    // portrait: the panel grows (map, tooltip); keep the building in view above it
    if (host.portrait && this.lastPanelH && Math.abs(h - this.lastPanelH) > 8) host.camFocus(SHORTCUT[0], SHORTCUT[1]);
    this.lastPanelH = h;
    let y = r.y;
    if (listH) { host.drawSkillList('embassy', 'Embassy', r.x, y, LIST_W); y += listH + 2; }
    if (refundH) {
      D.nine('panel', r.x, y, LIST_W, refundH);
      const bw = D.textW('Refund Diplomats') + 16;
      if (host.button('embassy_refund', 'Refund Diplomats', Math.round(r.x + (LIST_W - bw) / 2), y + 8, bw, 16, diplomats === 0)) this.refundDiplomats();
      y += refundH + 2;
    }
    this.mapRect = null;
    if (mapH) {
      D.nine('panel', r.x, y, LIST_W, mapH);
      const mx = r.x + 4, my = y + 4; this.mapRect = { x: mx, y: my };
      for (const n of NATIONS) {
        if (!this.nationVisible(n)) continue;
        const col = this.relations[n.id] ? HOVERED : this.isAvailable(n) ? UNSELECTED : DISABLED;
        D.img(tex(n), mx, my, { tint: col });
      }
      if (sel && this.nationVisible(sel)) {   // Nation outline (generated/*_outline.png): white 1 px ring
        for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) D.img(tex(sel), mx + ox, my + oy, { tint: '#ffffff' });
        D.img(tex(sel), mx, my, { tint: this.relations[sel.id] ? HOVERED : this.isAvailable(sel) ? FOCUSED : DISABLED });
      }
      D.img('map_features', mx, my);
      for (const n of NATIONS) if (this.relations[n.id] && this.nationVisible(n)) D.img('flag_icon', mx + n.flag[0], my + n.flag[1] - 6);
      // pulse available nations so a tap target is obvious on phones (no hover)
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
      for (const n of NATIONS) if (this.isAvailable(n) && n.id !== this.selected) D.img(tex(n), mx, my, { tint: FOCUSED, alpha: 0.35 * pulse });
      y += mapH + 2;
    }
    if (tipH) {
      D.nine('panel', r.x, y, LIST_W, tipH);
      D.text(sel!.name, r.x + 5, y + 4, '#ffffff', 12);
      this.drawRich(D, tipLines, r.x + 5, y + 18);
      y += tipH + 2;
    }
    for (const d of this.indicators) if (d.screen) this.drawIndicator(D, d);
    this.panel = { x: r.x, y: r.y, w: LIST_W, h: y - r.y };
    return this.panel;
  }
  // Nation._build_tooltip
  private tooltip(n: NationDef) {
    let status = '';
    if (n.start) status = '';
    else if (this.relations[n.id]) status = '- Relations Established';
    else status = `- Need ${fmt(n.threshold)} {trade_agreements_icon}` + (ADJ[n.id].some(a => this.relations[a]) ? '' : '\n- Not adjacent to a nation with relations');
    return n.desc + (status ? '\n\n' + status : '');
  }
  private static ICONS: Record<string, string> = { trade_agreements_icon: 'trade_agreements', magic_gold_icon: 'magic_gold_icon' };
  private layout(str: string, maxW: number) {
    const lines: { tok: string, icon: string | null, w: number }[][] = [];
    for (const para of str.split('\n')) {
      let line: any[] = [], lw = 0;
      for (const tok of para.split(/(\{\w+_icon\}|\s+)/).filter(t => t !== '')) {
        const m = /^\{(\w+_icon)\}$/.exec(tok), icon = m ? (EmbassyModule.ICONS[m[1]] || m[1]) : null, w = icon ? 11 : this.host.D.textW(tok);
        if (lw + w > maxW && line.length && !/^\s+$/.test(tok)) { lines.push(line); line = []; lw = 0; }
        if (!line.length && /^\s+$/.test(tok)) continue;
        line.push({ tok, icon, w }); lw += w;
      }
      lines.push(line);
    }
    return lines;
  }
  private drawRich(D: PixelDraw, lines: { tok: string, icon: string | null, w: number }[][], x: number, y: number) {
    lines.forEach((line, i) => {
      let cx = x;
      for (const p of line) { if (p.icon) D.img(p.icon, Math.round(cx), y + i * 12 + 1); else D.text(p.tok, cx, y + i * 12 + 1); cx += p.w; }
    });
  }

  // ================================================================ persistence
  save() {
    return {
      relations: Object.keys(this.relations).filter(k => this.relations[k]),
      golds: this.golds.map(g => [g.x, g.y, g.vx, g.vy]),
      spirits: this.spirits.map(s => [s.x, s.y, s.vx, s.vy, s.wave ? 1 : 0, s.sx, s.sy]), spiritTime: this.spiritTime,
      introduced: this.introduced, debtGiven: this.debtGiven, showAll: this.showAll, forceBuilt: this.forceBuilt,
    };
  }
  load(d: any) {
    if (!d) return;
    this.relations = { starting_nation: true };
    for (const id of d.relations || []) if (BY_ID[id]) this.relations[id] = true;
    this.golds = (d.golds || []).map((g: number[]) => ({ x: g[0], y: g[1], vx: g[2], vy: g[3] }));
    this.spirits = (d.spirits || []).map((s: number[]) => ({ x: s[0], y: s[1], vx: s[2], vy: s[3], wave: !!s[4], sx: s[5], sy: s[6],
      base: rand(SPIRIT_SPEED * 0.75, SPIRIT_SPEED), phase: rand(0, Math.PI * 2), amp: rand(OSC_AMP * 0.5, OSC_AMP) }));
    this.spiritTime = d.spiritTime || 0;
    this.introduced = !!d.introduced; this.debtGiven = !!d.debtGiven; this.showAll = !!d.showAll; this.forceBuilt = !!d.forceBuilt;
    this.wasBuilt = this.introduced; this.diplomats = []; this.selected = '';
  }
  // prestige: relations, diplomats in flight and the introduction are per run
  reset(_keepPermanent: boolean) {
    this.relations = { starting_nation: true };
    this.diplomats = []; this.golds = []; this.spirits = []; this.indicators = [];
    this.introduced = false; this.wasBuilt = false; this.forceBuilt = false; this.debtGiven = false; this.selected = ''; this.nationTimer = 0;
  }

  // ================================================================ dev panel
  debug: Record<string, (...args: any[]) => void> = {
    'Embassy: build': () => { if (this.host.modules.buildings) this.host.S.skills.build_embassy = 1; else this.forceBuilt = true; },
    'Embassy: +5K Trade Agreements': () => this.host.addResource('trade_agreements', 5000),
    'Embassy: +25 diplomats': () => { this.host.S.skills.summon_diplomat = this.numDiplomats() + 25; },
    'Embassy: establish next nation': () => {
      const next = NATIONS.filter(n => !n.start && !this.relations[n.id] && this.nationVisible(n) && ADJ[n.id].some(a => this.relations[a]))
        .sort((a, b) => a.threshold - b.threshold)[0];
      if (next) { this.establish(next.id, true); this.selected = next.id; }
    },
    'Embassy: all relations': () => { this.showAll = true; for (const n of NATIONS) if (!this.relations[n.id]) this.establish(n.id, true); },
    'Embassy: reveal Chronara': () => { this.showAll = !this.showAll; },
    'Embassy: refund diplomats': () => this.refundDiplomats(),
    'Embassy: diplomacy gold x30': () => { for (let i = 0; i < DIPLOMACY_GOLD; i++) this.golds.push({ x: PORTAL[0], y: PORTAL[1], vx: rand(-GOLD_SPEED, GOLD_SPEED), vy: rand(-GOLD_SPEED, GOLD_SPEED) }); },
    'Embassy: reset relations': () => { this.relations = { starting_nation: true }; this.selected = ''; },
  };
}

export const embassy = new EmbassyModule();
registerModule(embassy);
