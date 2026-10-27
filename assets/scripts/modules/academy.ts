// Academy (after build_academy): AcademySimulation.gd (spirit sages fly out, cast EXP orbs at their research
// subject's location), Trainings.gd / Training.gd / TrainingDef.gd (4 research subjects with levels),
// AcademyUI.gd, data/skills (summon_spirit_sage, textbooks, improved facilities, unlock_*), data/trainings/*.tres.
import { registerModule } from '../GameModule';
import type { GameHost, GameModule, Multipliers, SkillDef } from '../GameModule';
import type { PixelDraw } from '../PixelDraw';
import { fmtNum, imgCentered } from './buildings';

const SPEED_UP = 35;                      // summon_spirit_sage speed_up_increase
const GRAVITY_PULL = 200;
const MAX_SIM_SAGES = 150;                // beyond this each simulated sage stands for several (keeps the frame cheap)
const TOWER_X = 320;

interface TrainingDef { id: string, name: string, base: number, pct: number, booster: string, unlockSkill: string | null, tip: string }
export const TRAININGS: TrainingDef[] = [
  { id: 'magic_101', name: 'Magic Research', base: 4, pct: 5, booster: 'magic_textbooks', unlockSkill: null, tip: 'Increase Cloudling {magic_icon} gain by {p}%' },
  { id: 'herbology', name: 'Forestry Research', base: 4, pct: 5, booster: 'herbology_textbooks', unlockSkill: 'unlock_herbology', tip: 'Boosts {wood_icon} income by {p}%' },
  { id: 'alchemy_101', name: 'Alchemy Research', base: 1500, pct: 5, booster: 'alchemy_lab', unlockSkill: 'unlock_alchemy_101', tip: '{magic_gold_icon} is made {p}% faster' },
  { id: 'dragon_bond', name: 'Dragon Research', base: 400, pct: 20, booster: 'dragon_alphabet', unlockSkill: 'unlock_dragon_bond', tip: 'Dragon gains {p}% more EXP' },
];
const TNAME: Record<string, string> = {}; for (const t of TRAININGS) TNAME[t.id] = t.name;

interface TState { level: number, xp: number, built: number, unlocked: boolean, selected: boolean }
interface Sage { x: number, y: number, st: 'inside' | 'moving_up' | 'casting' | 'moving_down', t: number, tx: number, ty: number, flip: boolean }
interface Orb { x: number, y: number, vx: number, vy: number, ox: number, oy: number, tx: number, ty: number, dx: number, dy: number, kind: string, age: number }

const scaling = (base: number) => (L: number) => base * Math.pow(2, L);

export class AcademyModule implements GameModule {
  id = 'academy';
  unlockTower = 5;
  available() { const b: any = this.host && this.host.modules.buildings; return !!(b && b.isBuilt && b.isBuilt('academy')); }
  nav = { label: 'Academy' };
  host!: GameHost;
  T: Record<string, TState> = {};
  private sages: Sage[] = [];
  private orbs: Orb[] = [];
  private speed = 1; private speedTimer = 0;
  private rows: { id: string, x: number, y: number, w: number, h: number }[] = [];
  private panel: { x: number, y: number, w: number, h: number } | null = null;
  private infoId = 'magic_101';

  skills: Record<string, SkillDef> = {
    summon_spirit_sage: { list: 'academy', name: 'Summon Spirit Sage', res: 'spirits', cost: () => 1, max: 10000, icon: 'spirit_sage', summon: true, showLevel: true,
      tip: () => `Call a Spirit Sage to study at the Academy\n\n- Hold the Academy to make them work ${SPEED_UP}% faster`,
      onBuy: (_h, L) => { if (L === 1) this.select('magic_101'); } },
    magic_textbooks: { list: 'academy', name: 'Improved Wands', res: 'knowledge', cost: scaling(20000), max: 8, icon: 'wand', unlock: 'summon_spirit_sage', showLevel: true,
      tip: () => 'Magic Research levels up twice as fast' },
    unlock_herbology: { list: 'academy', name: 'Unlock Forest Research', res: 'knowledge', cost: () => 40000, max: 1, icon: 'herbology', unlock: 'summon_spirit_sage',
      tip: () => 'Forestry Research teaches Druids to gather more {wood_icon}', onBuy: () => this.unlockTraining('herbology') },
    herbology_textbooks: { list: 'academy', name: 'Forestry Notebooks', res: 'knowledge', cost: scaling(50000), max: 8, icon: 'book_icon', unlock: 'unlock_herbology', showLevel: true,
      tip: () => 'Forestry Research levels up twice as fast' },
    improved_facilities: { list: 'academy', name: 'Improved Academy', res: 'knowledge', cost: scaling(65000), max: 8, icon: 'improved_academy_facilities', unlock: 'unlock_herbology', showLevel: true,
      tip: () => 'Every Academy subject levels up twice as fast' },
    unlock_dragon_bond: { list: 'academy', name: 'Unlock Dragon Research', res: 'knowledge', cost: () => 300000, max: 1, icon: 'dragon_bond', unlock: 'build_dragon_nest',
      tip: () => 'Dragon Research makes each Dragon Keeper feed the Dragon more EXP', onBuy: () => this.unlockTraining('dragon_bond') },
    dragon_alphabet: { list: 'academy', name: 'Dragon Alphabet', res: 'knowledge', cost: scaling(400000), max: 8, icon: 'dragon_alphabet', unlock: 'unlock_dragon_bond', showLevel: true,
      tip: () => 'Dragon Research levels up twice as fast' },
    unlock_alchemy_101: { list: 'academy', name: 'Alchemy Research', res: 'knowledge', cost: () => 8000000, max: 1, icon: 'alchemy_lab', unlock: 'summon_alchemist',
      tip: () => 'Alchemy Research speeds up how fast Alchemists make {magic_gold_icon}', onBuy: () => this.unlockTraining('alchemy_101') },
    alchemy_lab: { list: 'academy', name: 'Alchemy Lab', res: 'knowledge', cost: scaling(10000000), max: 8, icon: 'alchemy_lab', unlock: 'unlock_alchemy_101', showLevel: true,
      tip: () => 'Alchemy Research levels up twice as fast' },
    // hide_until_unlocked = netus_nation: the skill appears once relations with Netus are established
    improved_facilities_2: { list: 'academy', name: 'Great University', res: 'knowledge', cost: scaling(100000000), max: 8, icon: 'improved_academy_facilities', showLevel: true,
      unlock: 'summon_spirit_sage', visible: () => academy.netus(),
      tip: () => 'The Academy earns twice as much EXP' },
  };

  constructor() { for (const t of TRAININGS) this.T[t.id] = { level: 0, xp: 0, built: 0, unlocked: t.unlockSkill === null, selected: false }; }
  init(host: GameHost) { this.host = host; for (const k of ['spirit_sage', 'spirit_sage_cast', 'sage_exp', 'radio_checked', 'radio_unchecked', 'academy_progress_bar_background']) host.D.has(k); }
  netus() { const e: any = this.host && this.host.modules.embassy; return !!(e && e.hasRelations && e.hasRelations('netus_nation')); }
  private blessing(id: string) { const p: any = this.host.modules.prestige; return p && p.blessingLevel ? p.blessingLevel(id) : 0; }
  private multitasking() { return this.blessing('blessing_of_multitasking') > 0; }

  // ---------------------------------------------------------------- trainings (Training.gd)
  /** displayed level: the Academy blessing multiplies levels gained */
  trainingLevel(id: string) { const s = this.T[id]; return s ? Math.floor(s.level * (1 + this.blessing('academy_blessing') * 1)) : 0; }
  private cap(id: string) { const d = TRAININGS.find(t => t.id === id)!; return d.base * Math.pow(1.1, Math.pow(this.T[id].level, 0.85)); }
  private unlockTraining(id: string) { this.T[id].unlocked = true; this.select(id); }
  select(id: string) { if (!this.T[id].unlocked) return; for (const k in this.T) this.T[k].selected = k === id; this.infoId = id; }
  private selected(): string[] { return TRAININGS.filter(t => this.T[t.id].unlocked && (this.multitasking() || this.T[t.id].selected)).map(t => t.id); }
  addExp(id: string, v: number) { if (this.T[id]) this.T[id].built += v; }
  private expBonus(id: string) { const d = TRAININGS.find(t => t.id === id)!; return 1 + this.host.skillLevel(d.booster) * 100 / 100; }
  // Trainings.get_general_bonus: facilities here, everything else through host.mult('academy_exp')
  generalBonus() {
    const h = this.host;
    let b = (1 + h.skillLevel('improved_facilities')) * (1 + h.skillLevel('improved_facilities_2'));
    // academy_exp: Sage Totems (core), Telepathy (dragons)
    b *= h.mult('academy_exp') * h.mult('summon_spirit_sage');   // + Population / 60 / Few / Destruction blessings (prestige)
    const e: any = h.modules.embassy;
    if (e && e.hasRelations) { if (e.hasRelations('arcanis_nation')) b *= 1.5; if (e.hasRelations('fel_nation')) b *= 2.0; }
    const r: any = h.modules.runes;                    // Academy Boost rune: runeValue = 400% per level
    if (r && r.runeValue) b *= 1 + (r.runeValue('academy_exp_rune') || 0) / 100;
    return b;
  }
  private addExpInstantly(id: string, raw: number, general: number) {
    const s = this.T[id]; let g = this.expBonus(id) * raw * general, guard = 0;
    while (g > 0 && guard++ < 10000) {
      const room = this.cap(id) - s.xp, take = Math.min(g, room);
      s.xp += take; g -= take;
      if (s.xp >= this.cap(id) - 1e-9) { s.xp = 0; s.level++; }
    }
  }

  // ---------------------------------------------------------------- simulation (AcademySimulation.gd)
  private building() { const b: any = this.host.modules.buildings; return b && b.hasBuilding ? b.hasBuilding('academy') : false; }
  private academyPos(): [number, number] { const b: any = this.host.modules.buildings; return b && b.academyPos ? b.academyPos() : [142, 272]; }
  private door(): [number, number] { const [x, y] = this.academyPos(); return [x - 1, y + 44]; }
  private sageCount() { return this.host.skillLevel('summon_spirit_sage'); }
  private target(id: string): [number, number] | null {
    const h = this.host;
    if (id === 'magic_101') { const [x, y] = h.orbPos(); return [x, y - 31]; }
    if (id === 'herbology') { const a = h.towerAnchor('forest_island') || h.towerAnchor('island'); const [x, y] = a || [142, 348]; return [x - 3, y - 68]; }
    if (id === 'alchemy_101') {
      const al: any = h.modules.alchemy;
      return (al && al.anchor && al.anchor()) || h.towerAnchor('alchemy') || h.orbPos();
    }
    if (id === 'dragon_bond') { const b: any = h.modules.buildings; const [x, y] = b && b.nestPos ? b.nestPos() : [503, 281]; return [x, y - 32]; }
    return null;
  }
  private destruction() { const r: any = this.host.modules.runes; return !!(r && r.runeLevel && r.runeLevel('class_of_destruction') > 0); }

  update(dt: number) {
    const h = this.host;
    // built-up EXP drains into the trainings smoothly (Training.update)
    const gb = this.generalBonus();
    for (const t of TRAININGS) {
      const s = this.T[t.id]; if (s.built <= 1e-9) { s.built = 0; continue; }
      const remain = Math.max(0, Math.min(s.built, s.built * (1 - Math.min(1, dt * 2))));
      this.addExpInstantly(t.id, s.built - remain, gb); s.built = remain;
    }
    if (!this.building()) return;
    this.speedTimer = Math.max(0, this.speedTimer - dt); if (this.speedTimer <= 0) this.speed = 1;
    const want = Math.min(MAX_SIM_SAGES, this.sageCount());
    while (this.sages.length < want) { const [dx, dy] = this.door(); this.sages.push({ x: dx, y: dy, st: 'inside', t: Math.random() * 4, tx: 0, ty: 0, flip: false }); }
    if (this.sages.length > want) this.sages.length = want;
    const [ax, ay] = this.academyPos(), [dx, dy] = this.door(), mv = 100 * this.speed;
    for (const s of this.sages) {
      if (s.st === 'inside') {
        s.t -= dt;
        if (s.t <= 0) { s.st = 'moving_up'; s.x = dx; s.y = dy; s.tx = ax - 77 + Math.random() * 158; s.ty = ay - 42; s.flip = s.tx > dx; }
      } else if (s.st === 'moving_up') {
        this.step(s, mv * dt);
        if (s.y < s.ty + 4) { s.st = 'casting'; s.t = 0.5 / this.speed * (0.9 + Math.random() * 0.2); }
      } else if (s.st === 'casting') {
        s.t -= dt * this.speed;
        if (s.t <= 0) { this.cast(s); s.st = 'moving_down'; s.tx = dx; s.ty = dy; s.flip = dx > s.x; }
      } else {
        this.step(s, mv * dt);
        if (Math.hypot(s.tx - s.x, s.ty - s.y) < 5) { s.st = 'inside'; s.t = 3 / this.speed; }
      }
    }
    // EXP orbs accelerate toward their subject
    const per = Math.max(1, this.sageCount() / Math.max(1, this.sages.length));
    const odt = dt * this.speed;
    for (const o of this.orbs) {
      o.age += odt;
      const arrived = (o.tx > o.ox && o.x > o.tx) || (o.ty < o.oy && o.y < o.ty) || (o.tx <= o.ox && o.ty >= o.oy && Math.hypot(o.tx - o.x, o.ty - o.y) < 6) || o.age > 6;
      if (arrived) {
        o.age = -1;
        h.addEffect(o.tx + (Math.random() * 16 - 8), o.ty + (Math.random() * 16 - 8), 'sparkle' + Math.floor(Math.random() * 4));
        h.play('academy_exp', -5, 0.05);
        if (o.kind === 'wall') {
          const sg: any = h.modules.siege;
          if (sg && sg.damage && (!sg.targetable || sg.targetable())) sg.damage(50 * per, 'spirit_sage', o.x, o.y);
        } else this.addExp(o.kind, 1 * per);
        continue;
      }
      o.vx += o.dx * GRAVITY_PULL * odt; o.vy += o.dy * GRAVITY_PULL * odt;
      o.x += o.vx * odt; o.y += o.vy * odt;
    }
    this.orbs = this.orbs.filter(o => o.age >= 0);
  }
  private step(s: Sage, d: number) {
    const vx = s.tx - s.x, vy = s.ty - s.y, l = Math.hypot(vx, vy) || 1;
    s.x += vx / l * Math.min(d, l); s.y += vy / l * Math.min(d, l);
  }
  private cast(s: Sage) {
    const sel = this.selected();
    if (!sel.length) return;
    for (const id of sel) { const t = this.target(id); if (t) this.spawnOrb(s, t, id); }
    const sg: any = this.host.modules.siege;
    if (this.destruction() && sg && (!sg.targetable || sg.targetable())) {
      const wy = sg.wallY ? sg.wallY() : 150;
      this.spawnOrb(s, [TOWER_X, wy - 100], 'wall');
    }
  }
  private spawnOrb(s: Sage, t: [number, number], kind: string) {
    if (this.orbs.length > 600) return;
    const vx = t[0] - s.x, vy = t[1] - s.y, l = Math.hypot(vx, vy) || 1, dx = vx / l, dy = vy / l;
    this.orbs.push({ x: s.x, y: s.y, ox: s.x, oy: s.y, tx: t[0], ty: t[1], dx, dy, vx: dx * 150, vy: dy * 150, kind, age: 0 });
  }

  // press and hold the Academy: sages move 35% faster for 0.4 s
  hitWorld(wx: number, wy: number) {
    if (!this.building()) return false;
    const b: any = this.host.modules.buildings, r = b.bigRect('academy');
    return wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h;
  }
  onHold() { this.speed = 1 + SPEED_UP / 100; this.speedTimer = 0.4; }

  drawWorld(D: PixelDraw) {
    if (!this.building()) return;
    for (const o of this.orbs) imgCentered(D, 'sage_exp', o.x, o.y);
    for (const s of this.sages) if (s.st !== 'inside') imgCentered(D, s.st === 'casting' ? 'spirit_sage_cast' : 'spirit_sage', s.x, s.y, { flipX: s.flip });
    const S = this.host.S;
    if (S.activeArea === 'academy' || S.navigated === 'academy') {     // the floating wizard teleports to the open area
      const [ax, ay] = this.academyPos(), bob = Math.sin((S.time || 0) * 2);
      imgCentered(D, 'wizard_floating', ax - 67, ay + bob);
    }
  }
  worldFocus(): [number, number] { const [x, y] = this.academyPos(); return [x, y]; }

  // ---------------------------------------------------------------- panel (AcademyUI: skill list | trainings)
  drawPanel(D: PixelDraw) {
    const h = this.host, w = h.portrait ? Math.min(h.W - 8, 230) : 200;
    const showT = this.sageCount() > 0 || TRAININGS.some(t => this.T[t.id].level > 0);
    const list = TRAININGS.filter(t => this.T[t.id].unlocked);
    const rowH = 18, tH = showT ? 14 + list.length * rowH + 34 : 0;
    const r = h.panelRect(w, h.skillListHeight('academy') + tH + 4);
    let y = r.y + h.drawSkillList('academy', 'Academy', r.x, r.y, r.w) + 4;
    this.rows = [];
    if (showT) {
      D.rect('#2a1f3d', r.x, y, r.w, tH);
      D.text('Research', r.x + 4, y + 2, '#fe6cee');
      y += 14;
      for (const t of list) {
        const s = this.T[t.id], on = this.multitasking() || s.selected;
        const rk = on ? 'radio_checked' : 'radio_unchecked';
        if (D.has(rk) && !this.multitasking()) D.part(rk, 0, 0, 16, 16, r.x + 3, y + 1, 10, 10);
        else if (!this.multitasking()) D.rect(on ? '#fe6cee' : '#662887', r.x + 4, y + 2, 8, 8);
        D.text(t.name, r.x + 16, y + 1, on ? '#ffffff' : '#a8a3b8');
        const lv = `Lv. ${fmtNum(this.trainingLevel(t.id))}`;
        D.text(lv, r.x + r.w - 4 - D.textW(lv), y + 1, '#fe6cee');
        // progress bar: academy_progress_bar_background + pink fill (training.tscn)
        const bx = r.x + 16, bw = r.w - 20, by = y + 12;
        if (D.has('academy_progress_bar_background')) D.nine('academy_progress_bar_background', bx, by, bw, 3); else D.rect('#0b0b2e', bx, by, bw, 3);
        D.rect('#fe6cee', bx + 1, by + 1, Math.max(0, (bw - 2) * Math.min(1, s.xp / this.cap(t.id))), 1);
        this.rows.push({ id: t.id, x: r.x, y, w: r.w, h: rowH });
        y += rowH;
      }
      // description of the last tapped subject (the original shows it on hover)
      const d = TRAININGS.find(t => t.id === this.infoId) || TRAININGS[0];
      const tip = d.tip.replace('{p}', String(d.pct));
      this.richText(D, tip, r.x + 4, y + 2, r.w - 8);
      const tot = this.trainingLevel(d.id) * d.pct;
      D.text(`- Current bonus: +${fmtNum(tot)}%`, r.x + 4, y + 18, '#a8a3b8');
    }
    this.panel = { x: r.x, y: r.y, w: r.w, h: y + 34 - r.y };
    return this.panel;
  }
  private richText(D: PixelDraw, s: string, x: number, y: number, maxW: number) {
    let cx = x;
    for (const tok of s.split(/(\{\w+_icon\}|\s+)/).filter(t => t !== '')) {
      const m = /^\{(\w+_icon)\}$/.exec(tok);
      const w = m ? 11 : D.textW(tok);
      if (cx + w > x + maxW && /\S/.test(tok)) { cx = x; y += 12; }
      if (m) { const k = D.has(m[1]) ? m[1] : m[1].replace(/_icon$/, ''); if (D.has(k)) D.img(k, cx, y + 1); cx += w; }
      else { D.text(tok, cx, y, '#ffffff'); cx += w; }
    }
  }
  hitUi(x: number, y: number) { const p = this.panel; return !!p && this.host.S.activeArea === 'academy' && x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h; }
  onTap(x: number, y: number) {
    for (const r of this.rows) if (x >= r.x && x <= r.x + r.w && y >= r.y && y < r.y + r.h) { this.infoId = r.id; this.select(r.id); this.host.play('button_click', -6); return true; }
    return false;
  }

  multipliers(): Multipliers {
    if (!this.host) return {};
    const m = (id: string) => 1 + this.trainingLevel(id) * TRAININGS.find(t => t.id === id)!.pct / 100;
    // dragon_bond is read by tw-dragons through buildings.trainingLevel('dragon_bond')
    return { cloudling_magic: m('magic_101'), wood: m('herbology'), alchemy_speed: m('alchemy_101') };
  }

  save() { return { T: this.T }; }
  load(d: any) {
    if (!d || !d.T) return;
    for (const k in d.T) if (this.T[k]) Object.assign(this.T[k], d.T[k]);
    if (!this.T.magic_101.unlocked) this.T.magic_101.unlocked = true;
  }
  reset(_keep: boolean) {
    for (const t of TRAININGS) this.T[t.id] = { level: 0, xp: 0, built: 0, unlocked: t.unlockSkill === null, selected: false };
    this.sages = []; this.orbs = [];
  }

  private grant(id: string, n = 1) {
    const h = this.host, def = this.skills[id] || (h.modules.buildings as any).skills[id];
    for (let i = 0; i < n; i++) { const L = h.skillLevel(id); if (L >= def.max) break; h.S.skills[id] = L + 1; def.onBuy && def.onBuy(h, L + 1); }
  }
  debug: Record<string, (...a: any[]) => void> = {
    'Academy: build': () => { const b: any = this.host.modules.buildings; if (b && b.debug) b.debug['Building: build Academy'](); },
    'Academy: +10 sages': () => this.grant('summon_spirit_sage', 10),
    'Academy: +50 sages': () => this.grant('summon_spirit_sage', 50),
    'Academy: unlock all research': () => { for (const t of TRAININGS) this.T[t.id].unlocked = true; for (const s of ['unlock_herbology', 'unlock_dragon_bond', 'unlock_alchemy_101']) if (this.host.skillLevel(s) < 1) this.host.S.skills[s] = 1; },
    'Academy: max upgrades': () => { for (const s of ['magic_textbooks', 'herbology_textbooks', 'improved_facilities', 'dragon_alphabet', 'alchemy_lab', 'improved_facilities_2']) this.host.S.skills[s] = 8; },
    'Academy: +10 research levels': () => { for (const t of TRAININGS) if (this.T[t.id].unlocked) this.T[t.id].level += 10; },
    'Academy: next research': () => { const u = TRAININGS.filter(t => this.T[t.id].unlocked); const i = u.findIndex(t => this.T[t.id].selected); this.select(u[(i + 1) % u.length].id); },
  };
}

const academy = new AcademyModule();
registerModule(academy);
