// Obelisk (tower 8+, the Runecraft world area) and the Beacon (tower 3+, the light above the prestige lighthouse).
// Port of Obelisk.gd, ObeliskSprite.gd (one glyph per purchased rune, two columns of 19), ObeliskArea.gd (press = speed
// up the rune smiths), obelisk_area.tscn, and Beacon.gd / beacon.tscn. Rune state and the Runecraft panel belong to the
// runes module; this file only draws the world objects and forwards presses.
import { registerModule } from '../GameModule';
import type { GameHost, GameModule } from '../GameModule';
import type { PixelDraw } from '../PixelDraw';
import { anchorOf } from './temple';

// RuneSkillDef.id -> icon (data/rune_skills/*.tres); 'instructions' never shows on the obelisk
export const RUNE_ICONS: Record<string, string> = {
  academy_exp_rune: 'academy_exp_rune', alchemy: 'alchemy_rune', alloy: 'alloy_rune', arc: 'gorgon_damage_rune', charge: 'charge_rune',
  class_of_destruction: 'class_of_destruction_rune', cloud: 'cloud_rune', create_gorgons: 'gorgon_rune', create_ifrits: 'ifrit_rune',
  create_shamans: 'shaman_rune', curse_resonance: 'curse_resonance_rune', cursed_fire: 'cursed_fire_rune', cursed_shards: 'cursed_shards_rune',
  diversity: 'whirlwind_rune', dragon: 'dragon_rune', dragon_wands: 'dragon_breath_rune', fire_arrows: 'fire_arrows_rune',
  fire_damage: 'fire_arrow_damage_rune', fireball_shrapnel: 'fireball_shrapnel_rune', fusion: 'armor_melt', hot_blooded: 'hot_blooded_rune',
  hot_runes: 'blazing_runes', ice_arrow_damage: 'ice_arrow_damage_rune', ice_arrows: 'ice_arrow_rune', infinity: 'infinity_rune',
  infinity_resonance: 'infinity_resonance', relics: 'relics_rune', shrapnel_count: 'shrapnel_count_rune', shrapnel_molten: 'molten_shrapnel',
  shrapnel_weakness: 'shrapnel_weakness_rune', sound_pulse: 'sound_pulse_rune', strike_twice: 'strike_twice_rune', wisps: 'wisps_rune',
  wood: 'wood_rune', zephyr_damage: 'zephyr_rune',
};
// Beacon node position per tower image (tower-local, prestige_area + beacon offsets in tower_3..9.tscn)
const BEACON_FALLBACK: Record<number, [number, number]> = { 5: [139.5, -93], 6: [139.5, -93], 7: [153.5, -93], 8: [157.5, -2], 9: [157.5, -2], 10: [157.5, -2] };
const LIGHT = '#fe6cee', MID = '#ac37d0', BLUE = '#662887', DARKISH = '#292459';   // Colors.gd

class ObeliskModule implements GameModule {
  id = 'obelisk';
  unlockTower = 4;          // the Beacon shows from the prestige tower; the obelisk itself from tower 8
  host!: GameHost;
  t = 0;
  runes: string[] = [];     // ObeliskSprite.runes: purchase order, saved
  particles: { x: number; y: number; t: number; life: number }[] = [];
  partTimer = 0;

  init(host: GameHost) {
    this.host = host;
    for (const a of ['obelisk', 'obelisk_outline', 'anvil', 'anvil_outline', 'beacon_flare']) host.D.has(a);   // art is lazy: prefetch
  }

  /** Runes module calls this when a rune skill is bought (ObeliskSprite._on_skill_purchased). */
  addRune(id: string) {
    if (id === 'instructions' || this.runes.indexOf(id) >= 0) return;
    this.runes.push(id);
  }
  private syncRunes() {   // pick up runes the runes module already owns (load order, debug grants)
    const r: any = this.host.modules['runes'];
    const owned: string[] | null = r && r.ownedRunes ? r.ownedRunes() : null;
    if (owned) for (const id of owned) this.addRune(id);
  }
  private runeIcon(id: string) {
    const r: any = this.host.modules['runes'];
    return (r && r.runeIcon && r.runeIcon(id)) || RUNE_ICONS[id] || id;
  }
  obeliskOn() { return this.host.towerLevel() >= 8; }
  obeliskPos(): [number, number] | null { return anchorOf(this.host, 'obeliskPos'); }
  beaconPos(): [number, number] | null {
    const a = this.host.towerAnchor('beacon'); if (a) return a;
    const L = this.host.towerLevel(), f = BEACON_FALLBACK[L]; if (!f) return null;
    const [w, h] = this.host.D.size('tower_' + Math.min(L - 1, 9)); if (!w) return null;
    return [320 - w / 2 + f[0], 322 - h + f[1]];
  }

  update(dt: number) {
    this.t += dt;
    if (this.obeliskOn() && Math.floor(this.t * 2) !== Math.floor((this.t - dt) * 2)) this.syncRunes();
    // beacon.tscn CPUParticles2D: rect (2 x 150) centred 161 px below the beacon, moving up 100 px/s, 0.3 s life
    const b = this.beaconPos();
    if (b) {
      this.partTimer += dt;
      while (this.partTimer > 0.04) {
        this.partTimer -= 0.04;
        this.particles.push({ x: b[0] + (Math.random() * 4 - 2), y: b[1] + 161 + (Math.random() * 300 - 150), t: 0, life: 0.3 * (0.5 + Math.random() * 0.5) });
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.t += dt; p.y -= 100 * dt;
      if (p.t >= p.life) this.particles.splice(i, 1);
    }
  }

  drawWorldBack(D: PixelDraw) { this.drawBeacon(D); }

  drawWorld(D: PixelDraw) {
    if (!this.obeliskOn()) return;
    const o = this.obeliskPos(); if (!o) return;
    const h = this.host, active = h.S.activeArea === 'obelisk' || h.S.activeArea === 'runes';
    // Anvil sits 65 px above the obelisk (Obelisk/Anvil (1, -65)); the Smith Master is drawn by temple.ts
    const [aw, ah] = D.size('anvil');
    const ax = o[0] + 1, ay = o[1] - 65;
    if (active && D.has('anvil_outline')) { const [qw, qh] = D.size('anvil_outline'); D.img('anvil_outline', Math.round(ax - qw / 2), Math.round(ay - qh / 2)); }
    D.img('anvil', Math.round(ax - aw / 2), Math.round(ay - ah / 2));
    // ObeliskSprite extends Float (speed 1, amplitude 1)
    const fy = o[1] + Math.sin(this.t);
    const [ow, oh] = D.size('obelisk');
    const left = Math.round(o[0] - ow / 2), top = Math.round(fy - oh / 2);
    if (active && D.has('obelisk_outline')) { const [qw, qh] = D.size('obelisk_outline'); D.img('obelisk_outline', Math.round(o[0] - qw / 2), Math.round(fy - qh / 2)); }
    D.img('obelisk', left, top);
    // ObeliskSprite._draw: glyphs from ObeliskRuneStart (-13.5, -37.5) + 1, zig-zag 6 px, 7 px rows, 2nd column after 19
    const sx = o[0] - 13.5 + 1, sy0 = fy - 37.5 + 1;
    let x = sx, y = sy0;
    this.runes.forEach((id, i) => {
      D.img(this.runeIcon(id), Math.round(x), Math.round(y));
      x = i > 18 ? 14 + sx : sx;
      if (i % 2 === 0) x += 6;
      if (i % 2 === 1) y += 7;
      if (i === 19) y = sy0;
    });
  }

  // Beacon._draw: flare at +302, a light line up to the beacon node, then either up to the wall (while it can be hit)
  // or a 350 px beam fading through the palette
  private drawBeacon(D: PixelDraw) {
    const b = this.beaconPos(); if (!b) return;
    const h = this.host, bx = Math.round(b[0]), by = Math.round(b[1]), fy = by + 302;
    // Beacon.gd's 1 px line, softened for the demo: a glow from the lantern up to the wall's bottom edge (or a 350 px
    // fade with no wall), brightest at the lantern and fading upwards, pulsing slowly. Drawn in the back pass, so the
    // wall, the tower and every panel cover it. PixelDraw.rect is screen-space: map through the camera and clip.
    const fr = Math.floor(this.t * 6) % 8;   // beacon_flare.png: 8 frames of 23x5 at 6 fps, on the lantern roof
    D.part('beacon_flare', fr * 23, 0, 23, 5, bx - 11.5, fy - 2.5 + 0.5, 23, 5);
    const [ox] = h.toScreen(0, 0), z = h.toScreen(1, 0)[0] - ox;
    const [sx] = h.toScreen(bx, 0); if (sx < -4 || sx > h.W + 4) return;
    const siege: any = h.modules['siege'];
    const wallY: number | null = siege && siege.targetable && siege.targetable() && siege.wallY ? siege.wallY() : null;
    const top = wallY !== null && wallY < fy ? Math.round(wallY) + 4 : by - 350, len = fy - top;
    if (len <= 0) return;
    const pulse = 0.75 + 0.25 * Math.sin(this.t * 2.2), seg = 6;
    for (let y = fy; y > top; y -= seg) {
      const y0 = Math.max(top, y - seg), k = (fy - y) / len;            // 0 at the lantern, 1 at the wall
      const [, s0] = h.toScreen(bx, y0), [, s1] = h.toScreen(bx, y);
      if (s1 < 0 || s0 > h.H) continue;
      const a = pulse * (1 - k) * (1 - k);
      if (a < 0.02) continue;
      const col = k < 0.55 ? LIGHT : k < 0.75 ? MID : k < 0.9 ? BLUE : DARKISH;
      D.rect(col, sx - z, s0, 3 * Math.max(1, z), s1 - s0, a * 0.25);   // soft halo
      D.rect(col, sx, s0, Math.max(1, z), s1 - s0, a * 0.8);            // core
    }
    for (const p of this.particles) {
      if (p.y < top || p.y > fy) continue;
      const [px, py] = h.toScreen(p.x, p.y); D.rect(LIGHT, px, py, Math.max(1, z), Math.max(1, z), (1 - p.t / p.life) * 0.8);
    }
  }

  // ObeliskArea: pressing speeds the rune smiths up and opens the Runecraft panel
  hitWorld(wx: number, wy: number) {
    if (!this.obeliskOn()) return false;
    const o = this.obeliskPos(); if (!o) return false;
    return (Math.abs(wx - o[0]) <= 16 && Math.abs(wy - o[1]) <= 54) || (Math.abs(wx - (o[0] + 1)) <= 14 && Math.abs(wy - (o[1] - 65)) <= 12);
  }
  onHold() {
    const r: any = this.host.modules['runes'];
    if (r && r.speedUp) r.speedUp();
  }
  worldFocus(): [number, number] { return this.obeliskPos() || this.host.orbPos(); }
  drawPanel(D: PixelDraw) {   // the Runecraft panel is the runes module's
    const r: any = this.host.modules['runes'];
    return r && r.drawPanel ? r.drawPanel(D) : null;
  }

  save() { return { runes: this.runes.slice() }; }
  load(d: any) { this.runes = d && Array.isArray(d.runes) ? d.runes.filter((id: string) => typeof id === 'string') : []; }
  reset(keepPermanent: boolean) { if (!keepPermanent) this.runes = []; }

  debug = {
    'Obelisk: carve all rune glyphs': () => { for (const id in RUNE_ICONS) this.addRune(id); },
    'Obelisk: clear glyphs': () => { this.runes = []; },
  };
}

registerModule(new ObeliskModule());
