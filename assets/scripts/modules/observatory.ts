// Observatory: built by the Temple's Summon Astrologer. Analyze Wall gates tower 9's Fire Magic; Cosmic Analysis buys the
// four analyze_* status bonuses. Port of Observatory.gd, ObservatoryUI.gd, BuildingAnimation.gd (block arcs from the orb)
// and the World/Observatory node of current_run.tscn (sprite at world (141, 285), Astrologer at (-13, 12)).
import { registerModule } from '../GameModule';
import type { GameHost, GameModule, SkillDef, Multipliers } from '../GameModule';
import type { PixelDraw } from '../PixelDraw';

const POS: [number, number] = [141, 285];                                   // World/Observatory (offset 0, 0.5)
const POLY: [number, number][] = [[56, -28], [-22, -28], [-22, 37], [23, 37]];   // Area2D CollisionPolygon2D
const BUILD_SPAWN = 1.0, BUILD_DELAY = 1.5, GRAVITY = 980;

function analyze(name: string, icon: string, pct: number, what: string): SkillDef {   // SkillDefScaling 1 * 1^L, max 50
  return { list: 'observatory', name, res: 'cosmic_analysis', cost: () => 1, max: 50, icon, unlock: 'analyze_wall', showLevel: true,
    tip: () => `Increase ${what} by ${pct}%` };
}

class ObservatoryModule implements GameModule {
  id = 'observatory';
  unlockTower = 9;
  resources = [{ id: 'cosmic_analysis', icon: 'cosmic_analysis', name: 'Cosmic Analysis' }];
  host!: GameHost;
  t = 0;
  introduced = false;
  // BuildingAnimation
  anim: { age: number; blocks: { x: number; y: number; vx: number; vy: number; tx: number; ty: number; at: number; life: number; on: boolean }[] } | null = null;
  sparks: { x: number; y: number; vx: number; vy: number; t: number }[] = [];

  nav = { label: 'Observatory' };
  /** The nav button only exists once the Astrologer is summoned (NavigationButtons: go_to_observatory). */
  available() { return this.built(); }

  skills: Record<string, SkillDef> = {
    analyze_wall: { list: 'observatory', name: 'Analyze Wall', res: 'knowledge', cost: () => 1e11, max: 1, icon: null,
      tip: () => 'Study the Cosmic Wall to learn what it takes to break it.\n\n- The Orb will show what you need.',
      onBuy: (h) => { h.play('unlock', -4); h.toast('The Astrologer found how to break the Cosmic Wall'); } },
    create_cosmic_analysis: { list: 'observatory', name: 'Cosmic Analysis', res: 'knowledge', cost: (L) => 2e11 * Math.pow(1.5, L), max: 100,
      icon: 'cosmic_analysis', unlock: 'analyze_wall', creates: 'cosmic_analysis', showLevel: true,
      tip: () => 'Makes 1 Cosmic Analysis to spend on the research below.' },
    analyze_cursed: { ...analyze('Cursed Wall Analysis', 'cursed_icon', 50, ''), tip: () => 'Curses hit 50% harder' },
    analyze_weakened: analyze('Weakened Wall Analysis', 'weakend_icon', 20, 'the amount of Weakened applied'),
    analyze_resonance: analyze('Shattering Wall Analysis', 'resonance', 40, 'the amount of Shatter applied'),
    analyze_molten: analyze('Molten Wall Analysis', 'molten_icon', 40, 'the amount of Molten applied'),
  };

  // BuildTowerUI.can_build: tower 9 -> 10 (Fire Magic, then the Final Ascension) waits for Analyze Wall.
  // Only the gate is contributed; the host keeps its own image, orb and cosmic-dust cost for level 10.
  towers = [{ level: 10, gate: (h: GameHost) => (h.skillLevel('analyze_wall') > 0 ? null : 'Analyze the Wall') }];   // siege labels it (Fire Magic Beam / Final Ascension)

  init(host: GameHost) {
    this.host = host;
    for (const a of ['observatory', 'observatory_outline', 'astrologer', 'block_1', 'block_white_1', 'temple_spirits', 'cosmic_analysis',
      'cursed_icon', 'weakend_icon', 'resonance', 'molten_icon']) host.D.has(a);   // art is lazy: prefetch
  }
  built() { return !!this.host && this.host.skillLevel('summon_astrologer') > 0; }
  /** BuildTowerUI.can_build: tower 9 -> 10 (Fire Magic) waits for this; tw-core's TowerDef gate reads it. */
  wallAnalyzed() { return !!this.host && this.host.skillLevel('analyze_wall') > 0; }
  /** Per-level analyze bonus as a multiplier (1 + pct * level), for modules that prefer asking directly. */
  analyzeBonus(kind: 'cursed' | 'molten' | 'resonance' | 'weakened') {
    const pct = { cursed: 50, molten: 40, resonance: 40, weakened: 20 }[kind];
    return 1 + (this.host ? this.host.skillLevel('analyze_' + kind) : 0) * pct / 100;
  }

  // Observatory._on_skill_purchased(SUMMON_ASTROLOGER): BuildingAnimation from the orb, then the camera visits it once
  build() {
    const h = this.host, sz = h.D.size('observatory'), [w, hh] = sz[0] ? sz : [43, 73];
    const bw = 7, bh = 8 - 2;                                   // block_1.png 7x8, rows overlap by 2
    const left = POS[0] - w / 2, bottom = POS[1] + hh / 2;
    const xc = Math.ceil(w / bw), yc = Math.ceil(hh / bh), n = xc * yc;
    const [ox, oy] = h.orbPos();
    const blocks: any[] = [];
    let i = 0;
    for (let y = 0; y < yc; y++) for (let x = 0; x < xc; x++, i++) {
      blocks.push({ x: ox, y: oy, vx: 0, vy: 0, tx: left + x * bw, ty: bottom - bh - 2 - y * bh, at: BUILD_SPAWN * (i + 1) / n,
        life: BUILD_SPAWN + BUILD_DELAY + 0.7 * i / n, on: false });
    }
    this.anim = { age: 0, blocks };
    h.camFocus((ox + POS[0]) / 2, (oy + POS[1]) / 2);
    h.play('build_start', -4);
  }
  private launch(b: any) {   // Utils.calculate_angle: slowest speed (35 px/s steps) that reaches the target
    const dx = b.tx - b.x, dy = b.ty - b.y;
    for (let s = 35; s < 6000; s += 35) {
      const s2 = s * s, disc = s2 * s2 - GRAVITY * (GRAVITY * dx * dx - 2 * dy * s2);
      if (disc >= 0) {
        const ang = Math.atan((s2 + Math.sqrt(disc)) / (GRAVITY * Math.max(Math.abs(dx), 1)));
        b.vx = Math.sign(dx || 1) * s * Math.cos(ang); b.vy = -s * Math.sin(ang); return;
      }
    }
  }

  update(dt: number) {
    this.t += dt;
    const a = this.anim;
    if (a) {
      a.age += dt;
      for (const b of a.blocks) {
        if (!b.on && a.age >= b.at) { b.on = true; b.x = this.host.orbPos()[0]; b.y = this.host.orbPos()[1]; this.launch(b); }
        if (!b.on) continue;
        const ny = b.vy + GRAVITY * dt;
        b.x += b.vx * dt; b.y += (b.vy + ny) * dt / 2; b.vy = ny;
        if ((b.vx >= 0 && b.x >= b.tx) || (b.vx < 0 && b.x <= b.tx)) { b.x = b.tx; b.y = b.ty; b.vx = 0; b.vy = 0; }
      }
      if (a.age >= BUILD_SPAWN + BUILD_DELAY && a.age - dt < BUILD_SPAWN + BUILD_DELAY) {
        this.host.play('build_end', -4);
        for (let i = 0; i < 30; i++) this.sparks.push({ x: POS[0] + (Math.random() - 0.5) * 40, y: POS[1] + 36, vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 80, t: 0 });
        if (!this.introduced) { this.introduced = true; this.host.camFocus(POS[0], POS[1]); this.host.S.navigated = 'observatory'; }
      }
      if (a.age > BUILD_SPAWN + BUILD_DELAY + 0.7) this.anim = null;
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]; s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 60 * dt;
      if (s.t > 0.8) this.sparks.splice(i, 1);
    }
  }

  private visible() { return this.built() && !(this.anim && this.anim.age < BUILD_SPAWN + BUILD_DELAY); }

  drawWorldBack(D: PixelDraw) {
    if (!this.built()) return;
    const [w, h] = D.size('observatory'), x = Math.round(POS[0] - w / 2), y = Math.round(POS[1] - h / 2 + 0.5);
    if (this.visible()) {
      D.img('observatory', x, y);
      if (this.host.S.activeArea === 'observatory') { const [ow, oh] = D.size('observatory_outline'); D.img('observatory_outline', Math.round(POS[0] - ow / 2), Math.round(POS[1] - oh / 2 + 0.5)); }
      // Astrologer: 10-frame loop at 1 fps, eye at the telescope for frames 6..9
      const fr = Math.floor(this.t) % 10 >= 6 ? 1 : 0;
      D.part('astrologer', fr * 5, 0, 5, 8, Math.round(POS[0] - 13 - 2.5), Math.round(POS[1] + 12 - 4), 5, 8);
    }
    const a = this.anim;
    if (a) for (const b of a.blocks) if (b.on && a.age < b.life) {
      const white = a.age > BUILD_SPAWN + BUILD_DELAY;
      D.img(white ? 'block_white_1' : 'block_1', Math.round(b.x), Math.round(b.y));
    }
    for (const s of this.sparks) D.img('temple_spirits', Math.round(s.x - 1.5), Math.round(s.y - 1.5), { alpha: 1 - s.t / 0.8 });
  }

  hitWorld(wx: number, wy: number) {
    if (!this.visible()) return false;
    const px = wx - POS[0], py = wy - POS[1];
    let inside = false;
    for (let i = 0, j = POLY.length - 1; i < POLY.length; j = i++) {
      const [xi, yi] = POLY[i], [xj, yj] = POLY[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  worldFocus(): [number, number] { return [POS[0], POS[1] - 10]; }

  // ObservatoryUI: skill list + "Jump to Requirements" (ViewRequirementsPanel, shown once the wall is analyzed)
  private jumpRect: { x: number; y: number; w: number; h: number } | null = null;
  drawPanel(D: PixelDraw) {
    const h = this.host, listW = 200, listH = h.skillListHeight('observatory');
    const reqH = this.wallAnalyzed() ? 22 : 0, total = listH + (reqH ? reqH + 2 : 0);
    const r = h.panelRect(listW, total);
    h.drawSkillList('observatory', 'Observatory', r.x, r.y, listW);
    if (reqH) {
      const y = r.y + listH + 2;
      D.nine('panel', r.x, y, listW, reqH);
      if (h.button('obs_jump_req', 'Jump to Requirements', r.x + 4, y + 3, listW - 8, 16)) this.jumpToRequirements();
      this.jumpRect = { x: r.x + 4, y: y + 3, w: listW - 8, h: 16 };
    } else this.jumpRect = null;
    return { x: r.x, y: r.y, w: listW, h: total };
  }
  private jumpToRequirements() {   // camera_shortcuts.navigate_to_orb
    const h = this.host, [ox, oy] = h.orbPos();
    h.S.navigated = 'orb'; h.camFocus(ox, oy);
  }

  multipliers(): Multipliers {
    const h = this.host; if (!h) return {};
    // WallCurse / Ifrits / Gorgons / Zephyrs / FireballShrapnel: 1 + level * pct (additive per level)
    // keys read by sorcery.ts (curse base damage, ifrit molten, gorgon shatter, zephyr weakened) and dragons' shrapnel
    return {
      curse_damage: this.analyzeBonus('cursed'),
      molten_apply: this.analyzeBonus('molten'),
      shatter_apply: this.analyzeBonus('resonance'),
      weakened_apply: this.analyzeBonus('weakened'),
    };
  }

  save() { return { introduced: this.introduced }; }
  load(d: any) { this.introduced = !!(d && d.introduced) || this.built(); this.anim = null; }
  reset() { this.anim = null; this.introduced = false; }

  debug = {
    'Observatory: build (summon Astrologer)': () => { const S = this.host.S; if (S.skills) S.skills.summon_astrologer = 1; this.build(); },
    'Observatory: analyze wall': () => { const S = this.host.S; if (S.skills) { S.skills.summon_astrologer = 1; S.skills.analyze_wall = 1; } },
    'Observatory: +10 Cosmic Analysis': () => this.host.addResource('cosmic_analysis', 10),
  };
}

registerModule(new ObservatoryModule());
