// Building (tower 5): BuildingManager.gd (small houses + their spirits), BuildingPanel.gd (Academy / Dragon Nest /
// Embassy), BuildingAnimation.gd (blocks fly from the orb and assemble the building), data/skills/build_*.tres.
// World positions are the original scene's (current_run.tscn); the host uses the same world frame (ground y 322).
// Also owns the building_points resource: every tower ascension at tower 5+ grants 4 (BuildTowerUI.gd).
import { registerModule } from '../GameModule';
import type { GameHost, GameModule, Multipliers, SkillDef } from '../GameModule';
import type { PixelDraw } from '../PixelDraw';

export const GROUND = 322;
const GRAVITY = 980;
const BP_PER_ASCENSION = 4;
const HOUSE_PCT = 15;                                   // build_house / build_book_house / build_tree_house percent_increase
const MAX_LEFT = 12;                                    // BuildingManager.MAX_BUILDINGS
const LEFT_START = 50, RIGHT_START = 804;               // SmallBuildingLeftStart / SmallBuildingRightStart x
const SPIRIT_INTERVAL = 7;

const HOUSE_ART: Record<string, string[]> = {
  build_house: ['small_house_0', 'small_house_1', 'small_house_2'],
  build_book_house: ['book_house_0', 'book_house_1', 'book_house_2'],
  build_tree_house: ['tree_house_0', 'tree_house_1', 'tree_house_2'],
};
// art sizes (identical in art-v2 and art_orig); used for layout because art loads lazily (D.size is [0,0] until it arrives)
const ART_SIZE: Record<string, [number, number]> = {
  small_house_0: [17, 36], small_house_1: [17, 34], small_house_2: [17, 40], book_house_0: [15, 35], book_house_1: [21, 47], book_house_2: [13, 57],
  tree_house_0: [13, 33], tree_house_1: [15, 53], tree_house_2: [17, 35], academy: [101, 100], embassy: [119, 93], dragon_nest: [180, 84], embassy_portal: [31, 52],
};
const PREFETCH = Object.keys(ART_SIZE).concat(['academy_island', 'dragon_nest_island', 'embassy_portal_dark_area', 'embassy_portal_clouds', 'block_1', 'block_white_1', 'cloudling', 'druid', 'building_point_icon']);
// spirits that pop out of houses: cloudlings from spirit houses, druids from tree houses (book houses stay quiet)
const HOUSE_SPIRIT: Record<string, string> = { small_house: 'cloudling', tree_house: 'druid' };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

// Utils.calculate_angle (angles[0]): launch angle hitting `t` from `o` at speed v, y down, or null
export function calcAngle(o: number[], t: number[], v: number): number | null {
  const oy = -o[1], ty = -t[1];
  let dx = t[0] - o[0]; const dy = ty - oy;
  if (Math.abs(dx) < 1e-5) { if (v < Math.sqrt(2 * GRAVITY * Math.abs(dy))) return null; return dy > 0 ? Math.PI / 2 : 3 * Math.PI / 2; }
  const left = dx < 0; dx = Math.abs(dx);
  const v2 = v * v, gd = GRAVITY * dx, disc = v2 * v2 - GRAVITY * (gd * dx + 2 * dy * v2);
  if (disc < 0) return null;
  let a = Math.atan((v2 + Math.sqrt(disc)) / gd); if (a < 0) a += 2 * Math.PI;
  return left ? Math.PI - a : a;
}

// BuildingAnimation.gd: blocks spawn from the orb over `spawn` s, fly ballistic arcs onto a grid covering the
// building, turn white, and the building appears after spawn + 1.5 s with a column of sparkles.
const TOWER_DELAY = 1.5;
export class BuildAnim {
  t = 0; shown = false; done = false;
  private blocks: { tx: number, ty: number, at: number, life: number, on: boolean, fin: boolean, x: number, y: number, vx: number, vy: number }[] = [];
  private parts: { at: number, x: number, y: number, fired: boolean }[] = [];
  constructor(private host: GameHost, private rect: { x: number, y: number, w: number, h: number }, private spawn: number, private onShown: () => void) {
    const [bw, bh] = [7, 8], sy = bh - 2;           // block_1.png
    const xc = Math.ceil(rect.w / bw), yc = Math.ceil(rect.h / sy), N = xc * yc, step = spawn / N;
    for (let y = 0; y < yc; y++) for (let x = 0; x < xc; x++) {
      const i = this.blocks.length;
      this.blocks.push({ tx: rect.x + x * bw, ty: rect.y + rect.h - sy - 2 - y * sy, at: (i + 1) * step, life: spawn + TOWER_DELAY + 0.7 * i / N,
        on: false, fin: false, x: 0, y: 0, vx: 0, vy: 0 });
    }
    const np = Math.floor(rect.h / 8);
    for (let i = 0; i < np; i++) this.parts.push({ at: spawn + TOWER_DELAY + (i + 1) * 0.7 / np, x: rect.x + Math.random() * rect.w, y: rect.y - i * rect.h / np + rect.h, fired: false });
  }
  update(dt: number) {
    const h = this.host; this.t += dt;
    const [ox, oy] = h.orbPos();
    for (const b of this.blocks) {
      if (!b.on && this.t >= b.at) {
        b.on = true; b.x = ox; b.y = oy;
        let sp = 0, a: number | null = null;
        while (a === null) { a = calcAngle([b.x, b.y], [b.tx, b.ty], sp); if (a === null) sp += 35; }
        b.vx = Math.cos(a) * sp; b.vy = -Math.sin(a) * sp;
      }
      if (!b.on || b.fin) continue;
      if (Math.hypot(b.tx - b.x, b.ty - b.y) < Math.hypot(b.vx, b.vy) * dt) {
        b.x = b.tx; b.y = b.ty; b.fin = true;
        if (Math.random() < 0.3) h.play('magic_material', -3, 0.05);
        continue;
      }
      const ny = b.vy + GRAVITY * dt;
      b.x += b.vx * dt; b.y += (b.vy + ny) * dt / 2; b.vy = ny;
    }
    if (!this.shown && this.t >= this.spawn + TOWER_DELAY) { this.shown = true; this.onShown(); }
    for (const p of this.parts) if (!p.fired && this.t >= p.at) { p.fired = true; h.addEffect(p.x, p.y, 'sparkle' + Math.floor(Math.random() * 4)); h.play('tower_particles', -3, 0.06); }
    if (this.t >= this.spawn + TOWER_DELAY + 0.7) this.done = true;
  }
  draw(D: PixelDraw) {
    const blk = D.has('block_1') ? 'block_1' : '', wht = D.has('block_white_1') ? 'block_white_1' : blk;
    for (const b of this.blocks) {
      if (!b.on || this.t > b.life) continue;
      const white = this.t > b.life - 0.7;
      if (blk) D.img(white ? wht : blk, Math.round(b.x), Math.round(b.y));
      else D.rect(white ? '#ffffff' : '#ac37d0', Math.round(b.x), Math.round(b.y), 7, 8);
    }
  }
}

// draw an image centred at (cx, cy), only the rows above the ground line (islands rise out of the ground)
export function imgAboveGround(D: PixelDraw, key: string, cx: number, cy: number, o?: { alpha?: number }) {
  if (!D.has(key)) return;
  const [w, h] = D.size(key), x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
  const vis = Math.min(h, GROUND - y);
  if (vis <= 0) return;
  D.part(key, 0, 0, w, vis, x, y, w, vis, o);
}
export function imgCentered(D: PixelDraw, key: string, cx: number, cy: number, o?: any) {
  if (!D.has(key)) return;
  const [w, h] = D.size(key);
  D.img(key, Math.round(cx - w / 2), Math.round(cy - h / 2), o);
}

type BigId = 'academy' | 'dragon_nest' | 'embassy';
const BIG_SKILL: Record<BigId, string> = { academy: 'build_academy', dragon_nest: 'build_dragon_nest', embassy: 'build_embassy' };

interface House { key: string, x: number, w: number, h: number }

export class BuildingsModule implements GameModule {
  id = 'buildings';
  unlockTower = 5;
  nav = { label: 'Building' };
  resources = [{ id: 'building_points', icon: 'building_point_icon', name: 'Building Points' }];
  host!: GameHost;
  houses: House[] = [];
  private bpLevel = 4;                                  // highest tower level whose building points were granted
  private shown: Record<BigId, boolean> = { academy: false, dragon_nest: false, embassy: false };
  private building: Record<string, BuildAnim | null> = {};
  private anims: BuildAnim[] = [];
  private introduced: Record<string, boolean> = {};
  private spirits: { key: string, x: number, y: number, dx: number, dy: number, t: number, wait: number, flipped: boolean }[] = [];
  private spiritTimer = SPIRIT_INTERVAL;
  private islandUp = { academy: -1, dragon: -1 };       // smoothed island lift (px), -1 = snap
  private panel: { x: number, y: number, w: number, h: number } | null = null;

  skills: Record<string, SkillDef> = {
    build_house: { list: 'small_buildings', name: 'Build Spirit House', res: 'building_points', cost: () => 1, max: 50, icon: null, showLevel: true,
      tip: () => `Each Spirit House multiplies {magic_icon} income by another ${HOUSE_PCT}%\n\n- Each new tower level hands out a set amount of {building_points_icon}`,
      onBuy: () => this.addHouse('build_house', true) },
    build_book_house: { list: 'small_buildings', name: 'Build Book House', res: 'building_points', cost: () => 1, max: 50, icon: null, showLevel: true,
      tip: () => `Each Book House multiplies {knowledge_icon} income by another ${HOUSE_PCT}%`,
      onBuy: () => this.addHouse('build_book_house', true) },
    build_tree_house: { list: 'small_buildings', name: 'Build Tree House', res: 'building_points', cost: () => 1, max: 50, icon: null, showLevel: true,
      tip: () => `Each Tree House multiplies {wood_icon} income by another ${HOUSE_PCT}%`,
      onBuy: () => this.addHouse('build_tree_house', true) },
    build_academy: { list: 'building', name: 'Build Academy', res: 'knowledge', cost: () => 10000, max: 1, icon: null,
      tip: () => 'Open an Academy where spirits study magic', onBuy: () => this.startBig('academy') },
    build_dragon_nest: { list: 'building', name: 'Build Dragon Nest', res: 'knowledge', cost: () => 100000, max: 1, icon: null,
      tip: () => 'Raise a nest and hatch your own dragon', onBuy: () => this.startBig('dragon_nest') },
    build_embassy: { list: 'building', name: 'Build Embassy', res: 'knowledge', cost: () => 15000000, max: 1, icon: null,
      tip: () => 'Open an embassy and make friends with other nations', onBuy: () => this.startBig('embassy') },
  };

  init(host: GameHost) { this.host = host; for (const k of PREFETCH) host.D.has(k); }

  // ---------------------------------------------------------------- public API (host.modules.buildings)
  hasBuilding(id: string) { const k = id.replace(/^build_/, '') as BigId; return !!this.shown[k]; }
  /** building is bought (it may still be assembling) */
  isBuilt(id: string) { const k = id.replace(/^build_/, '') as BigId; return this.host && this.host.skillLevel(BIG_SKILL[k]) > 0; }
  trainingLevel(id: string): number { const a: any = this.host && this.host.modules.academy; return a && a.trainingLevel ? a.trainingLevel(id) : 0; }
  hasRelations(id: string): boolean { const e: any = this.host && this.host.modules.embassy; return !!(e && e.hasRelations && e.hasRelations(id)); }
  houseCount(skill: string) { return this.host ? this.host.skillLevel(skill) : 0; }

  // world positions (original scene; islands rise 100 px per level once the tower outgrows them: FloatingIsland.gd)
  academyIsland(): [number, number] { return [141, 353 - this.lift('academy')]; }
  academyPos(): [number, number] { const [x, y] = this.academyIsland(); return [x + 1, y - 81]; }
  dragonIsland(): [number, number] { return [500, 355 - this.lift('dragon')]; }
  nestPos(): [number, number] { const [x, y] = this.dragonIsland(); return [x + 3, y - 74]; }
  embassyPos(): [number, number] { return [675, 275]; }
  private liftTarget(which: 'academy' | 'dragon') {
    const L = this.host ? this.host.towerLevel() : 5;
    return which === 'academy' ? Math.max(0, Math.min(L, 10) - 6) * 100 : Math.max(0, Math.min(L, 10) - 7) * 100;
  }
  private lift(which: 'academy' | 'dragon') { const v = this.islandUp[which]; return v < 0 ? this.liftTarget(which) : v; }

  // ---------------------------------------------------------------- small buildings
  private nextX(w: number): number {
    const n = this.houses.length;
    if (n < MAX_LEFT) { if (n === 0) return LEFT_START; const p = this.houses[n - 1]; return p.x - p.w / 2 - w / 2 - 2; }
    if (n === MAX_LEFT) return RIGHT_START;
    const p = this.houses[n - 1]; return p.x + p.w / 2 + w / 2 + 2;
  }
  private placeHouse(key: string): House {
    const [w, h] = ART_SIZE[key] || [17, 36];
    const hs = { key, x: this.nextX(w), w, h };
    this.houses.push(hs);
    return hs;
  }
  private addHouse(skill: string, animate: boolean) {
    const hs = this.placeHouse(pick(HOUSE_ART[skill]));
    if (!animate) return;
    const anim = new BuildAnim(this.host, { x: hs.x - hs.w / 2, y: GROUND - hs.h, w: hs.w, h: hs.h }, 1.0, () => { this.building[this.houseKey(hs)] = null; });
    this.building[this.houseKey(hs)] = anim; this.anims.push(anim);
  }
  private houseKey(h: House) { return 'house' + this.houses.indexOf(h); }

  // ---------------------------------------------------------------- big buildings
  bigRect(id: BigId) {
    const D = this.host.D;
    const [key, [cx, cy]] = id === 'academy' ? ['academy', this.academyPos()] : id === 'embassy' ? ['embassy', this.embassyPos()] : ['dragon_nest', this.nestPos()];
    const [w, h] = ART_SIZE[key];
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  private startBig(id: BigId) {
    if (this.shown[id] || this.building[id]) return;
    const anims: BuildAnim[] = [];
    const fin = () => {
      if (anims.some(a => !a.shown)) return;
      this.shown[id] = true; this.building[id] = null;
      if (!this.introduced[id]) {             // BuildingPanel.building_animation_finished: first build flies the camera there
        this.introduced[id] = true;
        const m: any = id === 'dragon_nest' ? this.host.modules.dragons : this.host.modules[id];
        const f = m && m.worldFocus ? m.worldFocus() : [this.bigRect(id).x + this.bigRect(id).w / 2, this.bigRect(id).y + this.bigRect(id).h / 2];
        this.host.camFocus(f[0], f[1]);
      }
    };
    anims.push(new BuildAnim(this.host, this.bigRect(id), 1.0, fin));
    if (id === 'embassy') {                    // the portal assembles separately (BuildingPanel: embassy_portal_sprite)
      const [ex, ey] = this.embassyPos(), [pw, ph] = ART_SIZE.embassy_portal;
      anims.push(new BuildAnim(this.host, { x: ex + 83 - pw / 2, y: ey + 21 - ph / 2, w: pw, h: ph }, 1.0, fin));
    }
    this.building[id] = anims[0];
    this.anims.push(...anims);
  }
  // ---------------------------------------------------------------- frame
  update(dt: number) {
    const h = this.host, L = h.towerLevel();
    if (L >= 5 && L > this.bpLevel) {           // BuildTowerUI._on_tower_built: +4 building points per ascension
      h.addResource('building_points', BP_PER_ASCENSION * (L - Math.max(this.bpLevel, 4)));
      this.bpLevel = L;
    }
    // bought before a load: show without the animation
    for (const id of Object.keys(BIG_SKILL) as BigId[]) if (!this.shown[id] && !this.building[id] && h.skillLevel(BIG_SKILL[id]) > 0) { this.shown[id] = true; this.introduced[id] = true; }
    // house count fell behind the skill level (save from before this module / debug): place the rest
    for (const sk of Object.keys(HOUSE_ART)) {
      const prefix = HOUSE_ART[sk][0].replace(/_0$/, '');
      const have = this.houses.filter(x => x.key.startsWith(prefix)).length;
      for (let i = have; i < h.skillLevel(sk); i++) this.addHouse(sk, false);
    }
    for (const a of this.anims) a.update(dt);
    this.anims = this.anims.filter(a => !a.done);
    for (const w of ['academy', 'dragon'] as const) {        // islands glide to their new height (1 s ease after a tower upgrade)
      const tgt = this.liftTarget(w), cur = this.islandUp[w];
      this.islandUp[w] = cur < 0 ? tgt : Math.abs(tgt - cur) < 0.5 ? tgt : cur + (tgt - cur) * Math.min(1, dt * 3);
    }
    this.updateSpirits(dt);
  }

  // BuildingManager._on_spirit_timer_timeout: a cloudling / druid pops out of a random house and hops back in
  private updateSpirits(dt: number) {
    const eligible = this.houses.filter(x => this.isVisible(x) && (x.key.startsWith('small_house') || x.key.startsWith('tree_house')));
    if (eligible.length) {
      this.spiritTimer -= dt;
      if (this.spiritTimer <= 0) {
        this.spiritTimer = SPIRIT_INTERVAL / Math.pow(eligible.length, 0.2) * rand(0.5, 1.5);
        const b = pick(eligible);
        const key = HOUSE_SPIRIT[b.key.startsWith('small_house') ? 'small_house' : 'tree_house'];
        const dx = rand(-30, 30);
        this.spirits.push({ key, x: b.x, y: GROUND - b.h / 2, dx, dy: -rand(30, 50), t: 0, wait: rand(0.5, 1.0), flipped: dx < 0 });
      }
    }
    for (const s of this.spirits) s.t += dt;
    this.spirits = this.spirits.filter(s => s.t < 1.6 + s.wait);
  }
  private isVisible(hs: House) { return !this.building[this.houseKey(hs)]; }

  drawWorldBack(D: PixelDraw) {
    const L = this.host.towerLevel();
    if (L < 5) return;
    // academy island + building
    const [aix, aiy] = this.academyIsland();
    imgAboveGround(D, 'academy_island', aix, aiy);
    if (this.shown.academy) { const [ax, ay] = this.academyPos(); imgCentered(D, 'academy', ax, ay); }
    // dragon nest island + nest (dragons, keepers and the queen are drawn by tw-dragons)
    const [dix, diy] = this.dragonIsland();
    imgAboveGround(D, 'dragon_nest_island', dix, diy);
    if (this.shown.dragon_nest) { const [nx, ny] = this.nestPos(); imgCentered(D, 'dragon_nest', nx, ny); }
    // embassy: portal (dark area, clouds, frame) behind the building (tw-embassy draws the diplomats)
    if (this.shown.embassy) {
      const [ex, ey] = this.embassyPos(), px = ex + 83, py = ey + 21;
      imgCentered(D, 'embassy_portal_dark_area', px, py + 2);
      if (D.has('embassy_portal_clouds')) {   // 7 frames of 18 x 33 at 5 fps
        const f = Math.floor((this.host.S.time || 0) * 5) % 7;
        D.part('embassy_portal_clouds', f * 18, 0, 18, 33, Math.round(px - 1 - 9 + 0.5), Math.round(py + 1 - 16.5 + 0.5), 18, 33);
      }
      imgCentered(D, 'embassy_portal', px, py);
      imgCentered(D, 'embassy', ex, ey);
    }
    for (const hs of this.houses) if (this.isVisible(hs)) D.img(hs.key, Math.round(hs.x - hs.w / 2), GROUND - hs.h);
  }
  drawWorld(D: PixelDraw) {
    for (const s of this.spirits) {
      let k: number, flip = s.flipped;
      if (s.t < 0.8) k = easeInOutSine(s.t / 0.8);
      else if (s.t < 0.8 + s.wait) k = 1;
      else { k = 1 - easeInOutSine(Math.min(1, (s.t - 0.8 - s.wait) / 0.8)); }
      if (s.t >= 0.8 + s.wait) flip = s.dx > 0;
      if (D.has(s.key)) imgCentered(D, s.key, s.x + s.dx * k, s.y + s.dy * k, { flipX: flip });
    }
    for (const a of this.anims) a.draw(D);
  }

  // the house rows run left from x=50 and right from x=804 (past the embassy)
  worldBounds() {
    let minX = 30, maxX = 780;
    for (const hs of this.houses) { minX = Math.min(minX, hs.x - hs.w / 2 - 20); maxX = Math.max(maxX, hs.x + hs.w / 2 + 20); }
    return { minX, maxX };
  }
  worldFocus(): [number, number] {   // CameraShortcuts.navigate_to_building: the row of houses left of the tower
    return this.houses.length ? [Math.min(LEFT_START, this.houses[Math.min(this.houses.length, MAX_LEFT) - 1].x) + 20, 280] : [140, 280];
  }

  // ---------------------------------------------------------------- panel
  drawPanel(D: PixelDraw) {
    const h = this.host, w = h.portrait ? Math.min(h.W - 8, 230) : 200;
    const head = 16, h1 = h.skillListHeight('small_buildings'), h2 = h.skillListHeight('building');
    const r = h.panelRect(w, head + h1 + 4 + h2);
    D.rect('#2a1f3d', r.x, r.y, r.w, head);
    if (D.has('building_point_icon')) D.img('building_point_icon', r.x + 4, r.y + 3);
    D.text(`${fmtNum(h.res('building_points'))} Building Points`, r.x + 17, r.y + 3, '#ffffff');
    let y = r.y + head;
    y += h.drawSkillList('small_buildings', 'Spirit Housing', r.x, y, r.w) + 4;
    h.drawSkillList('building', 'Building', r.x, y, r.w);
    this.panel = r;
    return r;
  }

  multipliers(): Multipliers {
    const h = this.host; if (!h) return {};
    const f = (sk: string) => Math.pow(1 + HOUSE_PCT / 100, h.skillLevel(sk));
    return { magic: f('build_house'), knowledge: f('build_book_house'), wood: f('build_tree_house') };
  }

  save() { return { bp: this.bpLevel, houses: this.houses.map(x => x.key), intro: this.introduced }; }
  load(d: any) {
    if (!d) return;
    this.bpLevel = d.bp || 4; this.introduced = d.intro || {};
    this.houses = []; this.anims = []; this.building = {};
    for (const k of d.houses || []) this.placeHouse(k);
  }
  reset(_keepPermanent: boolean) {
    this.houses = []; this.anims = []; this.building = {}; this.spirits = []; this.bpLevel = 4;
    this.shown = { academy: false, dragon_nest: false, embassy: false };
  }

  // ---------------------------------------------------------------- dev panel
  private grant(id: string, n = 1) {
    const h = this.host, S = h.S, def = this.skills[id];
    for (let i = 0; i < n; i++) {
      const L = h.skillLevel(id); if (L >= def.max) break;
      S.skills[id] = L + 1;
      def.onBuy && def.onBuy(h, L + 1);
    }
  }
  debug: Record<string, (...a: any[]) => void> = {
    'Building: +50 points': () => this.host.addResource('building_points', 50),
    'Building: 1 of each house': () => { this.grant('build_house'); this.grant('build_book_house'); this.grant('build_tree_house'); },
    'Building: 12 of each house': () => { this.grant('build_house', 12); this.grant('build_book_house', 12); this.grant('build_tree_house', 12); },
    'Building: build Academy': () => this.grant('build_academy'),
    'Building: build Dragon Nest': () => this.grant('build_dragon_nest'),
    'Building: build Embassy': () => this.grant('build_embassy'),
    'Building: build all 3': () => { this.grant('build_academy'); this.grant('build_dragon_nest'); this.grant('build_embassy'); },
    'Building: look at Academy': () => { const [x, y] = this.academyPos(); this.host.camFocus(x, y); },
    'Building: look at Embassy': () => { const [x, y] = this.embassyPos(); this.host.camFocus(x + 30, y); },
  };
}

export function fmtNum(v: number): string {
  if (v < 1000) return String(Math.floor(v));
  const u = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  let i = -1; while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, '') + u[i];
}

registerModule(new BuildingsModule());
