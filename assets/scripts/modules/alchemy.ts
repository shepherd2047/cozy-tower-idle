// Alchemy Lab + Relics (tower 6). Port of Alchemists.gd, AlchemyArea.gd, AlchemyUI.gd, Relics.gd / Relic.gd /
// MagicGoldRelic.gd and data/relics/*.tres.
// Alchemists orbit the alchemy area; each one fires a pink line every 4 s which adds 1 exp. Exp fills the Magic Gold
// bar (cap 20 * 1.175^(level^0.7)); every full bar creates 1 Magic Gold. Magic Gold is crafted into relics.
// Relics are host resources (like the original Resources), so Embassy nations can grant them with host.addResource.
// Cross-module: alchemy.relicLevel(id), alchemy.anchor() (world pos of the lab), alchemy.progress().
// Magic Gold production speed (exp gain) multiplies host.mult() of 'alchemy_speed' (academy, embassy), 'magic_gold_speed'
// (dragons), 'magic_gold' (temple smith master), 'alchemy_exp' (core crafting totems) and runes.runeValue('alchemy_rune'). Blessing of Alchemy
// (prestige.blessingLevel('alchemy_blessing')) adds +1 Magic Gold per creation.
import { GameHost, GameModule, Multipliers, SkillDef, registerModule } from '../GameModule';
import type { PixelDraw } from '../PixelDraw';
import { textWidth } from '../FontMetrics';

const SPAWN_INTERVAL = 4.0, BASE_RING = 12.0 * 1.33, RING_DISTANCE = 16, PER_RING = 8, MIN_SPEED = 10, MAX_SPEED = 20, LINE_LIFE = 0.1;
const ALCHEMIST_COL = '#fe6cee';
const COL = { white: '#ffffff', light: '#fff1d6', grey: '#a8a3b8', dark: '#2a1f3d', rowHover: '#3d2f5a', pink: '#ff8fb1' };
// fallback anchor offsets from the orb when the host has no 'alchemy' anchor (original tower_5..9.tscn)
const AREA_FROM_ORB: [number, number] = [55, 512];
const AREA_W = 50, AREA_H = 45;

interface RelicDef { id: string; name: string; icon: string; cost: [string, number][]; tip: string; }
// Registries.resources order
const RELICS: RelicDef[] = [
  { id: 'magic_gold', name: 'Magic Gold', icon: 'magic_gold_icon', cost: [], tip: 'Every Magic Gold you hold adds 5% to {magic_icon} income' },
  { id: 'mana_stone', name: 'Mana Stone', icon: 'mana_stone', cost: [['magic_gold', 10]], tip: 'Every Mana Stone you hold adds 100% to {magic_icon} income' },
  { id: 'cognite', name: 'Cognite', icon: 'cognite', cost: [['magic_gold', 10]], tip: 'Every Cognite you hold adds 100% to {knowledge_icon} income' },
  { id: 'dragonite', name: 'Dragonite', icon: 'dragonite', cost: [['magic_gold', 10]], tip: 'Every Dragonite you hold adds 300% to Dragon EXP' },
  { id: 'philosopher_stone', name: "Philosopher's Stone", icon: 'philosopher_stone', cost: [['cognite', 10], ['mana_stone', 10]], tip: "Each Philosopher's Stone increases {knowledge_icon} gain by 4000% and {magic_icon} gain by 1500%" },
  { id: 'holy_grail', name: 'Holy Grail', icon: 'holy_grail', cost: [['mana_stone', 10], ['dragonite', 10]], tip: 'Every Holy Grail you hold adds 3000% to {magic_icon} income and 3000% to Dragon EXP' },
  { id: 'ouroboros', name: 'Ouroboros', icon: 'ouroboros', cost: [['cognite', 10], ['dragonite', 10]], tip: 'Every Ouroboros you hold adds 1000% to {knowledge_icon} income and 8000% to Dragon EXP' },
];
const RELIC_PCT = { magic_gold: 5, mana_stone: 100, cognite: 100, dragonite: 300, grail_magic: 3000, grail_dragon: 3000, phil_knowledge: 4000, phil_magic: 1500, ouro_knowledge: 1000, ouro_dragon: 8000 };
const ORBITING = ['holy_grail', 'philosopher_stone', 'ouroboros'];   // Alchemists.update_relics: these circle with the alchemists
const MAX_DRAWN = 160;

function fmt(n: number, round = false): string { // Utils.format_num (same as the host)
  if (n >= 1) n = round ? Math.round(n) : Math.floor(n);
  if (n === 0) return '0';
  if (n < 1) return n.toFixed(1);
  if (n < 10000) return String(n);
  const suf = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
  const e = Math.floor(Math.log10(n) + 0.00001), se = 3 * Math.floor(e / 3);
  const d = n / 10 ** se, digits = String(Math.floor(d)).length, s = suf[se / 3] || '';
  if (digits >= 3) return Math.floor(d) + s;
  if (digits === 2) return (Math.floor(d * 10) / 10).toFixed(1) + s;
  return (Math.floor(d * 100) / 100).toFixed(2) + s;
}
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// world-space 1 px line (PixelDraw.rect ignores the world transform, part() does not)
export function drawLine(D: PixelDraw, x0: number, y0: number, x1: number, y1: number, tint: string, alpha = 1) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) D.part('__white', 0, 0, 2, 2, Math.floor(x0 + (x1 - x0) * i / n), Math.floor(y0 + (y1 - y0) * i / n), 1, 1, { tint, alpha });
}
// tiny rich-text wrapper: words and {icon} tokens, icons are 10 px wide
export function richLines(str: string, maxW: number): string[][] {
  const out: string[][] = [];
  for (const para of str.split('\n')) {
    const line: string[] = []; let w = 0;
    for (const tok of para.split(/(\{[a-z0-9_]+\}|\s+)/).filter(t => t !== '')) {
      const tw = /^\{/.test(tok) ? 11 : textWidth(tok);
      if (w + tw > maxW && line.length && !/^\s+$/.test(tok)) { out.push(line.splice(0)); w = 0; }
      if (!line.length && /^\s+$/.test(tok)) continue;
      line.push(tok); w += tw;
    }
    out.push(line);
  }
  return out;
}
export function drawRich(D: PixelDraw, lines: string[][], x: number, y: number, color = '#ffffff', lh = 11) {
  lines.forEach((line, i) => {
    let cx = x;
    for (const tok of line) {
      const m = /^\{([a-z0-9_]+)\}$/.exec(tok);
      if (m) { D.img(m[1], cx, y + i * lh); cx += 11; } else { D.text(tok, cx, y + i * lh + 1, color); cx += D.textW(tok); }
    }
  });
}

interface Orbiter { x: number; y: number; speed: number; dir: number; }

class AlchemyModule implements GameModule {
  id = 'alchemy';
  unlockTower = 6;
  nav = { label: 'Relics' };
  // relics stay out of the resource bar (Resources.gd skips show_in_relics except Magic Gold): hidden flag for the host
  resources = RELICS.map(r => ({ id: r.id, icon: r.icon, name: r.name, hidden: r.id !== 'magic_gold' }));
  skills: Record<string, SkillDef> = {
    summon_alchemist: {
      list: 'alchemists', name: 'Summon Alchemist', res: 'spirits', cost: () => 1, max: 10000, icon: 'alchemist', summon: true, showLevel: true,
      tip: () => 'Brews {magic_gold_icon}.\n\n- Opens new upgrades at the Academy',
    },
  };

  private host!: GameHost;
  // AlchemyUI state (per run)
  level = 0; xp = 0; builtUp = 0;
  researchGiven = false;
  // Alchemists.gd simulation
  private alchemists: Orbiter[] = [];
  private orbiting: Record<string, Orbiter[]> = { holy_grail: [], philosopher_stone: [], ouroboros: [] };
  private lines: { x: number; y: number; t: number }[] = [];
  private spawnTimer = 0; private speedMult = 1; private speedTimer = 0;
  // UI
  private selected: string | null = null;
  private rowRects: { id: string; x: number; y: number; w: number; h: number }[] = [];
  private panel: { x: number; y: number; w: number; h: number } | null = null;
  private indicators: { x: number; y: number; t: number; text: string }[] = [];

  init(host: GameHost) { this.host = host; }

  // ---------------------------------------------------------------- cross-module API
  // owned now, including gains the host commits at the end of this frame (Resources._process)
  relicLevel(id: string): number { if (!this.host) return 0; const p = this.host.S.pending; return (this.host.res(id) || 0) + ((p && p[id]) || 0); }
  addRelic(id: string, n: number) { this.host.addResource(id, n); }
  anchor(): [number, number] { return this.center(); }
  get alchemistCount() { return this.host ? this.host.skillLevel('summon_alchemist') : 0; }
  /** current Magic Gold progress (for HUD / dev panel) */
  progress() { return { level: this.level, xp: this.xp, cap: this.cap() }; }

  multipliers(): Multipliers {
    if (!this.host) return {};
    const r = (id: string) => this.relicLevel(id);
    return {
      magic: 1 + (r('magic_gold') * RELIC_PCT.magic_gold + r('mana_stone') * RELIC_PCT.mana_stone + r('holy_grail') * RELIC_PCT.grail_magic + r('philosopher_stone') * RELIC_PCT.phil_magic) / 100,
      knowledge: 1 + (r('cognite') * RELIC_PCT.cognite + r('philosopher_stone') * RELIC_PCT.phil_knowledge + r('ouroboros') * RELIC_PCT.ouro_knowledge) / 100,
      dragon_exp: 1 + (r('dragonite') * RELIC_PCT.dragonite + r('holy_grail') * RELIC_PCT.grail_dragon + r('ouroboros') * RELIC_PCT.ouro_dragon) / 100,
    };
  }

  // ---------------------------------------------------------------- AlchemyUI exp -> Magic Gold
  cap() { return 20 * Math.pow(1.175, Math.pow(this.level, 0.7)); }
  expMult() {   // AlchemyUI.get_exp_bonus ('alchemy_exp' already holds the Crafting Totems; 'crafting' would count them twice)
    const m = (k: string) => this.host.mult(k), r: any = this.host.modules.runes;
    const rune = r && r.runeValue ? 1 + (r.runeValue('alchemy_rune') || 0) / 100 : 1;   // Alchemy Boost rune
    return m('alchemy_speed') * m('magic_gold_speed') * m('magic_gold') * m('alchemy_exp') * rune;
  }
  private addExp(v: number) { this.builtUp += v * this.expMult(); }
  private addExpInstantly(gain: number) {
    let guard = 0;
    while (gain > 0 && guard++ < 10000) {
      const toCap = Math.min(gain, this.cap() - this.xp);
      this.xp += toCap; gain -= toCap;
      if (this.xp >= this.cap() - 1e-9) {
        this.xp = 0; this.level++;
        const pr: any = this.host.modules.prestige;   // Resources.get_magic_gold_bonuses: Blessing of Alchemy adds 1 per level
        const v = 1 + (pr && pr.blessingLevel ? pr.blessingLevel('alchemy_blessing') || 0 : 0);
        this.host.addResource('magic_gold', v);
        if (this.panel) this.indicators.push({ x: 0, y: 0, t: 0, text: '+' + fmt(v, true) });
      }
    }
  }

  // ---------------------------------------------------------------- positions
  center(): [number, number] {
    const a = this.host.towerAnchor('alchemy');
    if (a) return a;
    const o = this.host.orbPos(); return [o[0] + AREA_FROM_ORB[0], o[1] + AREA_FROM_ORB[1]];
  }
  // portrait: the docked panel is tall, so aim a little below the lab to keep it (and the alchemist ring) above the panel
  worldFocus(): [number, number] { const [x, y] = this.center(); return this.host.portrait ? [x, y + 45] : [x, y]; }
  hitWorld(wx: number, wy: number) { const [cx, cy] = this.center(); return Math.abs(wx - cx) <= AREA_W / 2 && Math.abs(wy - cy) <= AREA_H / 2; }
  onHold() { this.speedUp(); }
  private speedUp() { this.speedMult = 1 + 35 / 100; this.speedTimer = 0.4; }   // summon_alchemist speed_up_increase

  private ringPos(index: number): [number, number] {
    const ring = Math.floor(index / (PER_RING + 0.1 * index)), pos = index % PER_RING;
    const r = (ring + 1) * RING_DISTANCE + BASE_RING, a = 2 * Math.PI * pos / PER_RING;
    return [r * Math.cos(a), r * Math.sin(a)];
  }
  private makeOrbiter(index: number): Orbiter {
    const [x, y] = this.ringPos(index), len = Math.hypot(x, y);
    return { x, y, speed: rand(MIN_SPEED, MAX_SPEED) * len * 0.05, dir: Math.random() > 0.5 ? 1 : -1 };
  }
  private orbit(o: Orbiter, dt: number) {
    const r = Math.hypot(o.x, o.y); let a = Math.atan2(o.y, o.x);
    a += o.speed * dt / r * o.dir;
    o.x = r * Math.cos(a); o.y = r * Math.sin(a);
  }

  // ---------------------------------------------------------------- update
  private prefetched = false;
  update(dt: number) {
    const H = this.host;
    if (!this.prefetched) {   // host art is lazy (first draw); ask for everything the lab and panel use up front
      this.prefetched = true;
      for (const k of ['alchemist', 'alchemy_outline', ...RELICS.map(r => r.icon)]) H.D.has(k);
    }
    if (!this.researchGiven && H.towerLevel() >= 6) {     // Blessing of Research: gain 50 Magic Gold when Alchemy is built
      this.researchGiven = true;
      const pr: any = H.modules.prestige;
      if (pr && pr.blessingLevel && pr.blessingLevel('research_blessing') > 0) H.addResource('magic_gold', 50);
    }
    this.speedTimer = Math.max(0, this.speedTimer - dt);
    if (this.speedTimer <= 0) this.speedMult = 1;
    const target = Math.min(H.skillLevel('summon_alchemist'), 100000);
    const [cx, cy] = this.center();
    while (this.alchemists.length < target) {
      const o = this.makeOrbiter(this.alchemists.length); this.alchemists.push(o);
      if (this.alchemists.length <= MAX_DRAWN) H.addEffect(cx + o.x, cy + o.y, 'spirit_spawn');
    }
    if (this.alchemists.length > target) this.alchemists.length = target;
    let orbitIdx = 0;
    for (const id of ORBITING) {
      const list = this.orbiting[id], want = Math.min(Math.floor(this.relicLevel(id)), MAX_DRAWN);
      while (list.length < want) list.push(this.makeOrbiter(orbitIdx + list.length));
      if (list.length > want) list.length = want;
      orbitIdx += list.length;
    }
    const bdt = dt * this.speedMult;
    for (const o of this.alchemists.length > MAX_DRAWN ? this.alchemists.slice(0, MAX_DRAWN) : this.alchemists) this.orbit(o, bdt);
    for (const id of ORBITING) for (const o of this.orbiting[id]) this.orbit(o, bdt);
    // spawn_alchemist_lines: the timer sweeps over (n + 1) slots, each alchemist fires once per cycle
    const prev = this.spawnTimer, n = this.alchemists.length;
    this.spawnTimer = (this.spawnTimer + bdt / SPAWN_INTERVAL) % 1;
    if (n > 0) {
      const size = n + 1, a = Math.floor(prev * size), b = Math.floor(this.spawnTimer * size);
      const fires = b >= a ? b - a : (size - a) + b;
      for (let k = 0; k < fires; k++) {
        const i = (a + k) % size; if (i >= n) continue;
        const o = this.alchemists[Math.min(i, MAX_DRAWN - 1)] || this.alchemists[0];
        if (this.lines.length < 60) this.lines.push({ x: o.x, y: o.y, t: 0 });
        H.play('alchemist', -8, 0.06);
        this.addExp(1);
      }
    }
    for (let i = this.lines.length - 1; i >= 0; i--) if ((this.lines[i].t += dt) >= LINE_LIFE) this.lines.splice(i, 1);
    // update_exp: built-up exp drains into the bar at lerp(…, dt * 2)
    if (this.builtUp > 1e-9) {
      const remaining = Math.min(Math.max(this.builtUp + (0 - this.builtUp) * Math.min(dt * 2, 1), 0), this.builtUp);
      this.addExpInstantly(this.builtUp - remaining);
      this.builtUp = remaining;
    }
    for (let i = this.indicators.length - 1; i >= 0; i--) if ((this.indicators[i].t += dt) >= 0.6) this.indicators.splice(i, 1);
  }

  // ---------------------------------------------------------------- world
  drawWorld(D: PixelDraw) {
    const [cx, cy] = this.center();
    for (const l of this.lines) drawLine(D, cx + 0.5, cy - 0.5, cx + l.x, cy + l.y, ALCHEMIST_COL);
    const [aw, ah] = D.size('alchemist');
    const list = this.alchemists.length > MAX_DRAWN ? this.alchemists.slice(0, MAX_DRAWN) : this.alchemists;
    for (const o of list) D.img('alchemist', Math.round(cx + o.x - aw / 2), Math.round(cy + o.y - ah / 2), { flipX: o.x > 0 });
    // relics: draw_set_transform(pos, 0, 0.5) + draw_texture(tex, pos) => drawn at 1.5 * pos, half size
    for (const id of ORBITING) {
      const [w, h] = D.size(id);
      for (const o of this.orbiting[id]) D.part(id, 0, 0, w, h, Math.round(cx + o.x * 1.5), Math.round(cy + o.y * 1.5), w / 2, h / 2);
    }
    if (this.host.S.activeArea === 'alchemy' && D.has('alchemy_outline')) {
      const [w, h] = D.size('alchemy_outline'); D.img('alchemy_outline', Math.round(cx + 0.5 - w / 2), Math.round(cy + 0.5 - h / 2));
    }
  }

  // ---------------------------------------------------------------- panel
  private get mobile() { return this.host.mobile; }
  private canCraft(d: RelicDef) { return d.cost.length > 0 && d.cost.every(([id, c]) => this.host.res(id) + 1e-9 >= c); }   // spend() only sees committed amounts
  craft(id: string, times = 1): number {
    const d = RELICS.find(r => r.id === id); if (!d || !d.cost.length) return 0;
    let n = 0;
    while (n < times && this.canCraft(d)) {
      for (const [rid, c] of d.cost) this.host.spend(rid, c);
      this.grant(id, 1); n++;
    }
    if (n) this.host.play('button_click', -6, 0.05);
    return n;
  }
  // crafted relics are committed at once so the next craft (and the Craft buttons) see them this frame
  private grant(id: string, v: number) { const S = this.host.S; S.res[id] = (S.res[id] || 0) + v; S.earned[id] = (S.earned[id] || 0) + v; S.seen[id] = true; }
  private tipFor(d: RelicDef) {
    let s = d.name + '\n\n' + d.tip + '\n\n- You own ' + fmt(this.relicLevel(d.id));
    if (d.cost.length) {
      s += '\n\nCrafting Cost:';
      for (const [rid, c] of d.cost) {
        const have = this.relicLevel(rid), icon = RELICS.find(r => r.id === rid)!.icon;
        s += `\n${fmt(c)} {${icon}}` + (have < c ? ` (need ${fmt(c - have)} more)` : '');
      }
    }
    return s;
  }

  drawPanel(D: PixelDraw) {
    const H = this.host, w = 200, RH = this.mobile ? 22 : 14, showRelics = H.skillLevel('summon_alchemist') > 0;
    const listH = H.skillListHeight('alchemists');
    const sel = showRelics && this.selected ? RELICS.find(r => r.id === this.selected) : null;
    const tipLines = sel ? richLines(this.tipFor(sel), w - 12) : [];
    const relicH = showRelics ? 6 + 14 + RELICS.length * (RH + 2) + (sel ? tipLines.length * 11 + 6 : 0) : 0;
    const total = listH + (showRelics ? relicH + 2 : 0);
    const r = H.panelRect(w, total); this.panel = r;
    H.drawSkillList('alchemists', 'Alchemy Lab', r.x, r.y, w);
    this.rowRects = [];
    if (!showRelics) return r;
    const x = r.x, y = r.y + listH + 2, ty = Math.floor((RH - 10) / 2);
    D.nine('panel', x, y, w, relicH);
    D.text('Relics', x + 4, y + 3, COL.white, 12);
    const ingredients = sel ? sel.cost.map(c => c[0]) : [];
    let ry = y + 18;
    for (const d of RELICS) {
      const row = { id: d.id, x: x + 3, y: ry, w: w - 6, h: RH };
      this.rowRects.push(row);
      if (this.selected === d.id) D.rect(COL.rowHover, row.x, row.y, row.w, row.h);
      D.img(d.icon, row.x + 1, ry + ty);
      if (ingredients.indexOf(d.id) >= 0) {   // Relics._update_description: outline the ingredients white
        D.rect(COL.white, row.x, ry + ty - 1, 12, 1); D.rect(COL.white, row.x, ry + ty + 10, 12, 1);
        D.rect(COL.white, row.x, ry + ty - 1, 1, 12); D.rect(COL.white, row.x + 11, ry + ty - 1, 1, 12);
      }
      D.text(d.name, row.x + 13, ry + ty, COL.light);
      const owned = fmt(this.relicLevel(d.id));
      if (d.id === 'magic_gold') {
        const bx = row.x + 72, bw = row.w - 72 - 4 - D.textW(owned) - 4, bh = Math.min(RH - 4, 10);
        H.progressBar(bx, ry + Math.floor((RH - bh) / 2), bw, bh, this.xp / this.cap());
        D.text(`${fmt(this.xp)}/${fmt(this.cap())}`, bx + bw / 2, ry + ty, COL.white, 10, 'center');
        D.text(owned, row.x + row.w - 2 - D.textW(owned), ry + ty, COL.white);
        for (const ind of this.indicators) {     // AlchemyUI.add_indicator: +1 rising from the bar end
          const k = Math.min(ind.t / 0.4, 1);
          D.img('magic_gold_icon', bx + bw - 20, ry - 16 * k - 2, { alpha: 1 - Math.max(0, ind.t - 0.4) / 0.2 });
          D.text(ind.text, bx + bw - 8, ry - 16 * k - 1, COL.white, 10, 'left', { alpha: 1 - Math.max(0, ind.t - 0.4) / 0.2 });
        }
      } else {
        const bw = this.mobile ? 38 : 30, bx = row.x + row.w - bw - 2;
        if (H.button('craft_' + d.id, 'Craft', bx, ry, bw, RH, !this.canCraft(d))) { this.craft(d.id, 1); this.selected = d.id; }
        D.text(owned, bx - 4 - D.textW(owned), ry + ty, COL.white);
      }
      ry += RH + 2;
    }
    if (sel) drawRich(D, tipLines, x + 6, ry + 2, COL.white);
    return r;
  }
  hitUi(x: number, y: number) { const p = this.panel; return !!p && this.host.S.activeArea === 'alchemy' && x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h; }
  onTap(x: number, y: number) {
    for (const r of this.rowRects) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
      if (x < r.x + r.w - 40 || r.id === 'magic_gold') { this.selected = this.selected === r.id ? null : r.id; this.host.play('tooltip_hover', -8, 0.1); }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- save / reset / debug
  save() { return { level: this.level, xp: this.xp, builtUp: this.builtUp, researchGiven: this.researchGiven }; }   // relic counts are host resources
  load(d: any) {
    if (!d) return;
    this.level = d.level || 0; this.xp = d.xp || 0; this.researchGiven = !!d.researchGiven;
    this.alchemists = []; this.lines = []; this.builtUp = d.builtUp || 0;
  }
  reset() {
    this.level = 0; this.xp = 0; this.builtUp = 0; this.researchGiven = false;
    this.alchemists = []; this.lines = []; this.selected = null;
  }
  debug = {
    'Alchemists +10': () => this.host.S.skills.summon_alchemist = (this.host.S.skills.summon_alchemist || 0) + 10,
    'Magic Gold +500': () => this.host.addResource('magic_gold', 500),
    'Fill MG bar': () => { this.builtUp += this.cap() - this.xp; },
    'Relics x10 each': () => { for (const r of RELICS) if (r.id !== 'magic_gold') this.host.addResource(r.id, 10); },
    // dev only: commit straight into S.res so the chained crafts below see it this frame
    'Craft one of each': () => { this.grant('magic_gold', 600); for (const id of ['mana_stone', 'cognite', 'dragonite']) this.craft(id, 20); for (const id of ['philosopher_stone', 'holy_grail', 'ouroboros']) this.craft(id, 1); },
  };
}

registerModule(new AlchemyModule());
