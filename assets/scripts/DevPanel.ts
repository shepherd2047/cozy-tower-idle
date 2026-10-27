// In-game developer panel for the Tower Wizard rebuild (demo / QA helper).
// Self-installing: nothing in the scene or in TowerWizardGame.ts refers to this file. At module load it waits for a
// scene launch, finds the TowerWizardGame component on the Canvas and adds a "DevPanel" node on top of everything.
// The game is accessed through `any` and every call is guarded, so a renamed field only disables a button.
//
// Open it:  3 quick taps (or a 2 s hold) in the top-right corner  |  ` (backquote) or F1  |  ?dev=1 -> floating DEV button
// Set DEV_ENABLED = false to strip every entry point from a release build.
import {
  _decorator, Asset, Component, director, Director, EventKeyboard, EventTouch, input, Input, js, KeyCode, Node,
  BitmapFont, profiler, resources, sys, UITransform, view, AudioSource,
} from 'cc';
import { PixelDraw } from './PixelDraw';
import { TikTok, TT_CONFIG, ttLog } from './TikTokSDK';
const { ccclass } = _decorator;

const DEV_ENABLED = true;

// copies of TowerWizardGame constants (module-private there); used only as fallbacks / for drawing hit boxes
const TOWER_COSTS: Record<string, number>[] = [{ magic: 30 }, { magic: 1300 }, { magic: 13000 }, { magic: 350000, wood: 20000 }, { magic: 820000 }, { magic: 1300000 }];
const ORB_POLY = [[-14, -20], [16, -20], [16, 27], [-15, 13]];
const STUDY_POLY = [[22, -56], [22, 42], [-14, 42], [-14, -40]];
const FORESTRY_POLY = [[16, -35], [16, 19], [-18, 19], [-18, -23]];
const GROUND = 322, TOWER_X = 320;
const RES = ['magic', 'knowledge', 'wood', 'spirits', 'totems'];
const RES_LABEL: Record<string, string> = { magic: 'Magic', knowledge: 'Know', wood: 'Wood', spirits: 'Spirit', totems: 'Totem' };
// spirits are drawn one sprite each around the orb: keep the grants small enough to stay smooth
const RES_STEPS: Record<string, [string, number][]> = {
  magic: [['+10', 10], ['+1K', 1e3], ['+100K', 1e5]], knowledge: [['+10', 10], ['+1K', 1e3], ['+100K', 1e5]],
  wood: [['+10', 10], ['+1K', 1e3], ['+100K', 1e5]], spirits: [['+1', 1], ['+10', 10], ['+100', 100]], totems: [['+1', 1], ['+10', 10], ['+100', 100]],
};
const RES_MAX: Record<string, number> = { magic: 1e15, knowledge: 1e12, wood: 1e12, spirits: 500, totems: 300 };

const C = {
  bg: '#140f22', edge: '#ff8fb1', btn: '#3d2f5a', btnHi: '#6545b5', btnOn: '#ff8fb1', btnOff: '#241c34',
  text: '#ffffff', dim: '#a8a3b8', dark: '#2a1f3d', warn: '#ffd166', ok: '#8ef0c0', bad: '#ff6b6b',
};

function fmt(n: number): string {
  if (!isFinite(n)) return String(n);
  if (n < 0) return '-' + fmt(-n);
  if (n < 10000) return String(Math.floor(n * 10) / 10).replace(/\.0$/, '');
  const suf = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx'];
  const e = Math.floor(Math.log10(n) + 1e-6), se = 3 * Math.floor(e / 3), d = n / 10 ** se;
  return (d >= 100 ? Math.floor(d) : (Math.floor(d * 10) / 10)) + (suf[se / 3] || 'e' + se);
}
const has = (o: any, k: string) => !!o && typeof o[k] === 'function';
const own = (o: any, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// ---------------------------------------------------------------- event log (console errors + game events)
const LOG: string[] = [];
function devLog(s: string) { LOG.push(s.replace(/\s+/g, ' ').slice(0, 120)); if (LOG.length > 12) LOG.shift(); }
let consoleHooked = false;
function hookConsole() {
  if (consoleHooked || typeof console === 'undefined') return; consoleHooked = true;
  for (const lvl of ['error', 'warn'] as const) {
    const orig = (console as any)[lvl];
    if (typeof orig !== 'function') continue;
    (console as any)[lvl] = function (...a: any[]) {
      try { devLog((lvl === 'error' ? 'ERR ' : 'WARN ') + a.map(x => x && x.message ? x.message : String(x)).join(' ')); } catch (e) { /* ignore */ }
      return orig.apply(console, a);
    };
  }
  try { if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('error', (e: any) => devLog('EXC ' + (e && e.message))); } catch (e) { /* ignore */ }
}

interface Btn { id: string; x: number; y: number; w: number; h: number; on: () => void; }
type Cell = { label: string, on: () => void, disabled?: boolean, active?: boolean, id?: string, color?: string };

@ccclass('DevPanel')
export class DevPanel extends Component {
  g: any = null;
  private D!: PixelDraw;
  private drawRoot!: Node; private blocker!: Node; private corner!: Node; private devBtn!: Node;
  private fonts = 0;
  open = false; tab = 'demo';
  private W = 270; private H = 584; private s = 1;
  private btns: Btn[] = []; private pressId = ''; private panel = { x: 0, y: 0, w: 0, h: 0 };
  private cornerRect = { x: 0, y: 0, w: 40, h: 40 };
  private devBtnRect = { x: 0, y: 0, w: 26, h: 16 };   // floating DEV tab on the right edge (see layoutDevBtn)
  private taps: number[] = []; private cornerDownAt = -1; private t = 0;
  private devUrl = false;
  // time control
  speed = 1; paused = false; private stepN = 0; private patched = false; private prevUpdate: any = undefined;
  // debug view
  overlay = false; stats = false; private fps = 60;
  // misc
  private confirmUntil = 0; private flash = ''; private flashT = 0;
  private last: any = {};

  onLoad() {
    hookConsole();
    this.node.layer = this.node.parent ? this.node.parent.layer : this.node.layer;
    if (!this.node.getComponent(UITransform)) this.node.addComponent(UITransform);
    this.drawRoot = this.mk('DevDraw', this.node);
    this.D = new PixelDraw(this.drawRoot);
    for (const f of ['fpf10', 'fpf12']) resources.load('fonts/' + f, BitmapFont, (err: any, a: BitmapFont) => { if (!err && a) { this.D.addFont(f, a); this.fonts++; } });
    this.blocker = this.mk('DevBlocker', this.node); this.blocker.active = false;
    this.corner = this.mk('DevCorner', this.node);
    this.listen(this.blocker, p => this.onPanelDown(p), (p, i) => this.onPanelUp(p, i));
    this.listen(this.corner, p => this.onCornerDown(p), (p, i) => this.onCornerUp(p, i));
    this.devBtn = this.mk('DevButton', this.node);
    this.listen(this.devBtn, () => {}, (p, inside) => { if (inside) this.toggle(true); });
    // the floating DEV button is always shown (the user's request); add ?dev=0 to the URL for a clean screen
    try { this.devUrl = !(typeof location !== 'undefined' && /[?&]dev=0\b/.test(location.search || '')); } catch (e) { this.devUrl = true; }
    input.on(Input.EventType.KEY_DOWN, this.onKey, this);
  }
  onDestroy() { input.off(Input.EventType.KEY_DOWN, this.onKey, this); this.speed = 1; this.paused = false; this.syncTimePatch(); }

  private mk(name: string, parent: Node) {
    const n = new Node(name); n.layer = this.node.layer;
    n.addComponent(UITransform).setAnchorPoint(0, 1);
    parent.addChild(n); return n;
  }
  // node-level listeners: the UI pointer dispatcher runs before the game's global `input` listeners and
  // swallows every touch that lands on these nodes, so the panel never casts or pans
  private listen(n: Node, down: (p: number[]) => void, up: (p: number[], inside: boolean) => void) {
    const pos = (e: EventTouch) => { const l = e.getUILocation(), vh = view.getVisibleSize().height; return [l.x / this.s, (vh - l.y) / this.s]; };
    n.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; this.touchId = e.getID(); down(pos(e)); }, this);
    n.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => { e.propagationStopped = true; }, this);
    n.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; if (e.getID() !== this.touchId) return; this.touchId = -1; up(pos(e), true); }, this);
    n.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => { e.propagationStopped = true; if (e.getID() !== this.touchId) return; this.touchId = -1; up(pos(e), false); }, this);
    // desktop: also swallow raw mouse events (wheel zoom / right-drag pan) over the panel
    for (const t of [Node.EventType.MOUSE_DOWN, Node.EventType.MOUSE_UP, Node.EventType.MOUSE_MOVE, Node.EventType.MOUSE_WHEEL]) n.on(t, (e: any) => { e.propagationStopped = true; }, this);
  }
  private touchId = -1;

  // ---------------------------------------------------------------- opening
  private onKey(e: EventKeyboard) {
    if (e.keyCode === KeyCode.BACK_QUOTE || e.keyCode === KeyCode.F1) this.toggle();
  }
  toggle(v = !this.open) { this.open = v; this.pressId = ''; this.touchId = -1; this.cornerDownAt = -1; this.confirmUntil = 0; devLog(v ? 'dev panel opened' : 'dev panel closed'); }
  private onCornerDown(p: number[]) { this.cornerDownAt = this.t; }
  private onCornerUp(p: number[], inside: boolean) {
    const held = this.cornerDownAt >= 0;
    this.cornerDownAt = -1;
    if (!inside || !held) return;
    this.taps = this.taps.filter(t => this.t - t < 1.2); this.taps.push(this.t);
    if (this.taps.length >= 3) { this.taps = []; this.toggle(true); }
  }
  private hit(p: number[]) { for (let i = this.btns.length - 1; i >= 0; i--) { const b = this.btns[i]; if (p[0] >= b.x && p[0] < b.x + b.w && p[1] >= b.y && p[1] < b.y + b.h) return b; } return null; }
  private onPanelDown(p: number[]) { const b = this.hit(p); this.pressId = b ? b.id : ''; }
  private onPanelUp(p: number[], inside: boolean) {
    const b = this.hit(p), id = this.pressId; this.pressId = '';
    if (!inside || !b || b.id !== id) return;
    try { b.on(); } catch (e: any) { devLog('ERR dev ' + b.id + ': ' + (e && e.message)); console.warn('[DevPanel]', b.id, e); }
  }

  // ---------------------------------------------------------------- game helpers
  private get S(): any { return this.g && this.g.S; }
  private say(m: string) { this.flash = m; this.flashT = 2.5; devLog('> ' + m); }
  private grant(id: string, v: number) {  // commit straight into res + lifetime earned (works while paused)
    const S = this.S; if (!S || !S.res || !(id in S.res)) return;
    S.res[id] += v; if (S.earned) S.earned[id] = (S.earned[id] || 0) + v;
    if (S.seen) S.seen[id] = true; S.resourcesVisible = true;
  }
  private setRes(id: string, v: number) { const S = this.S; if (!S || !S.res) return; const d = v - S.res[id]; if (d > 0) this.grant(id, d); else S.res[id] = v; }
  private costs(): Record<string, number>[] { return TOWER_COSTS; }
  // module host (GameModule.ts): g.host or globalThis.__twHost; feature modules live in host.modules[id]
  host(): any { const g = this.g; return (g && g.host) || (globalThis as any).__twHost || null; }
  mod(id: string): any { const h = this.host(); return (h && h.modules && h.modules[id]) || (this.g && this.g[id]) || null; }
  modIds(): string[] {
    const h = this.host(); if (!h || !h.modules) return [];
    const seen = new Set<any>(), out: string[] = [];
    for (const id of Object.keys(h.modules)) { const m = h.modules[id]; if (!m || seen.has(m)) continue; seen.add(m); out.push(id); }
    return out;
  }
  maxLevel() { return this.host() ? 10 : this.g && this.g.siege ? 6 : 4; }   // module host: towers 1..10 (siege walls gate 7..9)
  private gameH() { const g = this.g; return g && g.D && g.D.H ? g.D.H : this.H; }
  private gameW() { const g = this.g; return g && g.D && g.D.W ? g.D.W : this.W; }
  private portrait() { const v = view.getVisibleSize(); return v.width < v.height; }
  private stepFor(L: number) { return L <= 1 ? 't7' : L === 2 ? 't9' : L === 3 ? 'f2' : 'end'; }

  skipTutorial() {
    const g = this.g, S = this.S; if (!S) return;
    if (!S.started) { if (has(g, 'beginGame')) g.beginGame(); else S.started = true; }
    if (g.tutorial) { g.tutorial.step = this.stepFor(S.level); g.tutorial.visible = false; }
    g.orbPickable = true; if (g.cam) g.cam.inputEnabled = true;
  }
  buildNext() {
    const g = this.g, S = this.S; if (!S || S.building || S.level >= this.maxLevel() || !has(g, 'buildTower')) return;
    if (!S.started || (g.tutorial && g.tutorial.visible)) this.skipTutorial();
    const h = this.host();
    let c: Record<string, number> = this.costs()[S.level] || {};
    if (h && has(h, 'nextTowerCost')) { try { c = h.nextTowerCost() || c; } catch (e) { /* keep fallback */ } }
    for (const k in c) { const need = c[k] - (S.earned[k] || 0); if (need > 0) this.grant(k, need); }
    g.buildTower();
    let why = '';
    if (!S.building && has(g, 'towerBlock')) { try { why = g.towerBlock(S.level + 1) || ''; } catch (e) { /* ignore */ } }
    this.say(S.building ? 'building tower ' + S.level : 'build refused' + (why ? ': ' + why : ''));
  }
  jumpTo(L: number) {
    const g = this.g, S = this.S; if (!S) return;
    this.skipTutorial();
    S.building = null; S.level = L; g.shownTowerLevel = L;
    if (has(g, 'orbPosFor')) { const o = g.orbPosFor(L); S.orb.x = o[0]; S.orb.y = o[1]; }
    for (let i = 0; i < L; i++) { const c = this.costs()[i]; for (const k in c) if ((S.earned[k] || 0) < c[k]) { S.earned[k] = c[k]; S.seen[k] = true; } }
    S.resourcesVisible = true;
    S.wizardArea = L === 0 ? 'initial' : 'orb';
    S.activeArea = ''; S.navigated = ''; S.newArea = '';
    if (L < 3) { for (const k of ['trees', 'druids', 'logs']) if (Array.isArray(g[k])) g[k].length = 0; }
    if (g.tutorial) { g.tutorial.step = this.stepFor(L); g.tutorial.visible = false; }
    if (g.cam) { g.cam.inputEnabled = true; g.cam.tween = null; g.cam.zoomTween = null; }
    g.orbPickable = true;
    const h = this.host();
    if (h && has(h, 'setTowerLevel')) h.setTowerLevel(L);   // game-side jump: orb, camera, every module's onTowerBuilt
    else this.camHome();
    if (g.tutorial) g.tutorial.visible = false;
    this.say('jumped to tower ' + L);
  }
  replayBuild() { const S = this.S; if (!S || S.level < 1 || S.building) return; this.jumpTo(S.level - 1); this.buildNext(); }
  // buy skills for free: resources are topped up for the purchase and put back afterwards
  freeBuy(id: string, n: number) {
    const g = this.g, S = this.S; if (!S || !S.skills || !(id in S.skills) || !has(g, 'buySkill')) return 0;
    if (id === 'library_spirits' && (S.level < 2 || (g.shownTowerLevel || 0) < 2)) return 0; // needs the study on screen
    const snap = { ...S.res };
    for (const k in S.res) S.res[k] = 1e30;
    let got = 0;
    try { got = g.buySkill(id, n) || 0; } finally { for (const k in snap) S.res[k] = snap[k]; }
    return got;
  }
  allSkills(n: number) {
    const S = this.S; if (!S || !S.skills) return;
    let total = 0;
    for (const id of Object.keys(S.skills)) total += this.freeBuy(id, n);
    this.say('skills +' + n + ' (' + total + ' levels)');
  }
  camHome() {
    const g = this.g, S = this.S, cam = g && g.cam; if (!cam || !S) return;
    const H = this.gameH(), HUD_H = sys.isMobile ? 36 : 28;
    const z = has(g, 'homeZoom') ? g.homeZoom(S.level) : cam.zoom;
    cam.zoom = z; cam.tween = null; cam.zoomTween = null; cam.vx = 0; cam.vy = 0;
    const rr = S.level > 0 && has(g, 'towerRect') ? g.towerRect(S.level) : null;
    if (S.level === 0 || !rr) {
      if (has(g, 'orbFocus')) { const f = g.orbFocus(); cam.x = f[0]; cam.y = f[1]; } else { cam.x = S.orb.x; cam.y = S.orb.y; }
    } else {
      const top = S.orb.y - 34, bottom = GROUND + 8;
      cam.y = Math.min((top + bottom) / 2 + (this.portrait() ? HUD_H / 2 / z : 0), 330 - H / 2 / z);
      cam.x = S.level >= 3 ? (63 + rr.x + rr.w) / 2 : TOWER_X;
    }
    if (has(g, 'clampCam')) g.clampCam();
  }
  focus(area: string) {
    const g = this.g, S = this.S; if (!S || !g.cam) return;
    let p: number[] | null = null;
    if (area === 'orb') p = [S.orb.x, S.orb.y];
    else if (area === 'study' && has(g, 'studyPos')) p = g.studyPos(S.level);
    else if (area === 'forest' && has(g, 'islandPos')) { const i = g.islandPos(); p = [i[0], i[1] - 40]; }
    if (!p) return;
    const k = this.portrait() ? 0.2 * this.gameH() / g.cam.zoom : 0;
    if (has(g, 'camMoveTo')) g.camMoveTo(p[0], p[1] + (area === 'forest' ? 0 : k)); else { g.cam.x = p[0]; g.cam.y = p[1]; }
  }
  zoom(d: number) {
    const g = this.g; if (!g || !g.cam) return;
    const z0 = Math.min(this.gameW(), this.gameH()) / 360;
    g.cam.zoom = Math.min(Math.max(g.cam.zoom + d * z0, z0 * 0.5), 4 * z0); g.cam.zoomTween = null;
    if (has(g, 'clampCam')) g.clampCam();
  }

  // run game ticks without sound (fast-forward and extra ticks at x2..x10)
  private silent(fn: () => void) {
    const g = this.g, hadOwn = own(g, 'play'), prev = g.play;
    g.play = () => { /* muted */ };
    try { fn(); } finally { if (hadOwn) g.play = prev; else delete g.play; }
  }
  fastForward(sec: number) {
    const g = this.g, S = this.S; if (!g || !g.ready || !has(g, 'tick')) return;
    const before = { ...S.earned }, t0 = Date.now();
    this.silent(() => { for (let t = 0; t < sec - 1e-6; t += 0.05) { g.now = (g.now || 0) + 0.05; g.frameDt = 0.05; g.tick(0.05); } });
    const gains = RES.filter(k => S.earned[k] > before[k]).map(k => RES_LABEL[k] + ' +' + fmt(S.earned[k] - before[k]));
    this.say('FF ' + (sec >= 60 ? sec / 60 + ' min' : sec + ' s') + ' (' + (Date.now() - t0) + ' ms) ' + (gains.join(', ') || 'no income'));
  }
  // There is no global time scale in Cocos: wrap the game component's update while speed != 1 or paused.
  private syncTimePatch() {
    const g = this.g; if (!g) return;
    const need = this.speed !== 1 || this.paused || this.stepN > 0;
    if (need && !this.patched) {
      this.prevUpdate = own(g, 'update') ? g.update : undefined;
      const orig = g.update, self = this;
      g.update = function (dt: number) { self.patchedUpdate(orig, dt); };
      this.patched = true;
    } else if (!need && this.patched) {
      if (this.prevUpdate !== undefined) g.update = this.prevUpdate; else delete g.update;
      this.patched = false; this.prevUpdate = undefined;
    }
  }
  private patchedUpdate(orig: (dt: number) => void, dt: number) {
    const g = this.g;
    if (this.paused) {
      if (this.stepN > 0) { this.stepN--; orig.call(g, 1 / 60); return; }
      if (g.ready && has(g, 'updateLayout') && has(g, 'render')) { g.updateLayout(); g.render(); } else orig.call(g, 0);
      return;
    }
    if (this.speed > 1 && g.ready && has(g, 'tick')) {
      const d = Math.min(dt, 1 / 20);
      this.silent(() => { for (let i = 1; i < this.speed; i++) { g.now = (g.now || 0) + d; g.frameDt = d; g.tick(d); } });
    }
    orig.call(g, dt);
  }

  // ---------------------------------------------------------------- audio (use the audio agent's API when present)
  private audioState(kind: 'music' | 'sfx'): boolean {
    const g = this.g; if (!g) return false;
    const onProp = kind === 'music' ? 'musicOn' : 'sfxOn';         // audio agent's API: musicOn / sfxOn + toggleMusic() / toggleSfx()
    if (typeof g[onProp] === 'boolean') return !g[onProp];
    const props = kind === 'music' ? ['musicMuted', 'muteMusic'] : ['sfxMuted', 'muteSfx'];
    for (const p of props) if (typeof g[p] === 'boolean') return g[p];
    if (typeof g.muted === 'boolean') return g.muted;
    return kind === 'music' ? !!this.last.musicMutedFallback : !!this.last.sfxMutedFallback;
  }
  private setAudio(kind: 'music' | 'sfx', mute: boolean) {
    const g = this.g; if (!g) return;
    const onProp = kind === 'music' ? 'musicOn' : 'sfxOn', tog = kind === 'music' ? 'toggleMusic' : 'toggleSfx';
    if (typeof g[onProp] === 'boolean' && has(g, tog)) { if (g[onProp] === mute) g[tog](); this.say(kind + (mute ? ' muted' : ' on') + ' (' + tog + ')'); return; }
    const fns = kind === 'music' ? ['setMusicMuted', 'setMuteMusic', 'muteMusic'] : ['setSfxMuted', 'setMuteSfx', 'muteSfx'];
    for (const f of fns) if (has(g, f)) { g[f](mute); this.say(kind + (mute ? ' muted' : ' on') + ' (' + f + ')'); return; }
    const props = kind === 'music' ? ['musicMuted', 'muteMusic'] : ['sfxMuted', 'muteSfx'];
    for (const p of props) if (typeof g[p] === 'boolean') { g[p] = mute; this.say(kind + (mute ? ' muted' : ' on') + ' (' + p + ')'); return; }
    if (has(g, 'setMuted') && typeof g.muted === 'boolean') { g.setMuted(mute); this.say('all audio ' + (mute ? 'muted' : 'on')); return; }
    // fallback: the sfx source is g.audio; any other AudioSource on the Canvas counts as music
    const srcs: AudioSource[] = g.node ? g.node.getComponentsInChildren(AudioSource) : [];
    for (const a of srcs) {
      const isSfx = a === g.audio;
      if ((kind === 'sfx') !== isSfx) continue;
      if (mute) { if (a.volume > 0) (a as any).__devVol = a.volume; a.volume = 0; } else a.volume = (a as any).__devVol || 1;
    }
    if (kind === 'music') this.last.musicMutedFallback = mute; else this.last.sfxMutedFallback = mute;
    this.say(kind + (mute ? ' muted' : ' on') + ' (fallback)');
  }

  // ---------------------------------------------------------------- save / presets
  exportState() {
    const g = this.g, S = this.S; if (!S) return;
    const snap = { S: { ...S, building: S.building ? { from: S.building.from, to: S.building.to, t: S.building.t } : null },
      shownTowerLevel: g.shownTowerLevel, totemPole: g.totemPole, trees: g.trees && g.trees.length, tutorial: g.tutorial && g.tutorial.step,
      cam: g.cam && { x: g.cam.x, y: g.cam.y, zoom: g.cam.zoom } };
    const json = JSON.stringify(snap);
    console.log('[DevPanel] state ' + json);
    (globalThis as any).__devState = snap;
    try {
      const tt = (globalThis as any).tt;
      if (tt && tt.setClipboardData) tt.setClipboardData({ data: json });
      else if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(json).catch(() => { /* needs a user gesture */ });
    } catch (e) { /* optional */ }
    this.say('state JSON -> console (' + json.length + ' chars)');
  }
  resetGame() {
    const g = this.g; if (!g) return;
    this.speed = 1; this.paused = false; this.stepN = 0; this.syncTimePatch();
    if (has(g, 'resetRun') && this.host()) { this.resetViaHost(); return; }
    let fresh: any = null;
    try { fresh = new (g.constructor as any)(); } catch (e) { fresh = null; }
    if (!fresh || !fresh.S) { const sc = director.getScene(); if (sc) director.loadScene(sc.name); return; }
    const skip = /^(D|ready|clips|audio|lastPlay|now|stage|stageS|node|update|play|enabled|gestured|hidden)$|^_|mute|music|sfx|sound|volume|clip|audio/i;
    const isCC = (v: any) => v instanceof Node || v instanceof Component || v instanceof Asset;
    for (const k of Object.keys(fresh)) {
      const v = fresh[k], cur = g[k];
      if (skip.test(k) || typeof v === 'function' || isCC(v) || isCC(cur)) continue;
      if ((v === null || v === undefined) && cur && typeof cur === 'object') continue;
      // only plain data: class instances (siege / prestige / sky controllers...) are bound to the live component
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) continue;
      if (cur && typeof cur === 'object' && !Array.isArray(cur) && Object.getPrototypeOf(cur) !== Object.prototype) continue;
      g[k] = v;
    }
    if (g.cam) g.cam.zoom = 2 * Math.min(this.gameW(), this.gameH()) / 360;
    this.resetModules();
    this.say('game reset');
  }
  // Module-host game: the game's own resetRun() wipes core state + every module's run data; then every module's
  // permanent data too (reset(false): prestige points, blessings...), the autosave, and back to the title screen.
  private resetViaHost() {
    const g = this.g, S = g.S;
    // permanent data first (prestige blessings can move the run start), then the game's own in-place run reset
    for (const id of this.modIds()) { const m = this.mod(id); if (has(m, 'reset')) { try { m.reset(false); } catch (e) { devLog('WARN reset ' + id + ' failed'); } } }
    g.resetRun();
    if (S.level !== 0 && has(g, 'debugSetLevel')) { try { g.debugSetLevel(0); g.shownTowerLevel = 0; } catch (e) { /* ignore */ } }
    S.started = false; S.time = 0;
    if (g.tutorial) { g.tutorial.step = 'none'; g.tutorial.visible = false; }
    if (Array.isArray(g.storyQueue)) g.storyQueue.length = 0;
    try { sys.localStorage.removeItem('tw_save_v1'); } catch (e) { /* storage unavailable */ }
    g.saveCache = undefined;
    if (has(g, 'clearSave')) { try { g.clearSave(); } catch (e) { /* optional */ } }
    this.resetModules();
    if (g.cam) { g.cam.zoom = 2 * Math.min(this.gameW(), this.gameH()) / 360; if (has(g, 'orbFocus')) { const f = g.orbFocus(); g.cam.x = f[0]; g.cam.y = f[1]; } }
    this.say('game reset (save wiped)');
  }
  // Demo jumps: every step is isolated so one renamed game field cannot leave the demo half-applied.
  // feature modules (siege, sky, prestige...) live outside S: put them back to their initial state too
  private freshSiege() {
    const g = this.g, sg = g && g.siege;
    if (!sg || !has(g, 'siegeCtx') || this.host()) return;   // pre-host builds only (Siege.ts without reset)
    try { g.siege = new (sg.constructor as any)(g.siegeCtx(), g.D); } catch (e) { console.warn('[DevPanel] siege reset failed', e); }
  }
  private resetModules() {
    const g = this.g;
    if (!this.host()) for (const k of Object.keys(g)) {
      const v = g[k];
      if (!v || typeof v !== 'object' || k === 'siege' || v instanceof Node || v instanceof Component || v instanceof Asset) continue;
      if (Object.getPrototypeOf(v) === Object.prototype || Array.isArray(v)) continue;
      if (has(v, 'reset')) { try { v.reset(false); } catch (e) { /* optional */ } }
    }
    this.freshSiege();
    const sky = this.mod('sky');
    if (sky) { try { if (has(sky, 'setBossMode')) sky.setBossMode(false); if (has(sky, 'setVortex')) sky.setVortex(null); if (has(sky, 'setSpeed')) sky.setSpeed(1); } catch (e) { /* optional */ } }
    this.skyBoss = false; this.fervorMax = false;
  }
  preset(name: string) {
    const g = this.g; if (!g || !g.S) return;
    const errs: string[] = [];
    const step = (label: string, fn: () => void) => { try { fn(); } catch (e: any) { errs.push(label); console.warn('[DevPanel] preset ' + name + ' / ' + label, e); } };
    step('speed', () => { this.speed = 1; this.paused = false; this.stepN = 0; this.syncTimePatch(); });
    step('reset', () => this.resetGame());
    step('fervor', () => { this.fervorMax = false; });
    if (name === 'demo') { this.say('preset: title screen' + (errs.length ? ' (skipped: ' + errs.join(',') + ')' : '')); return; }
    step('tutorial', () => this.skipTutorial());
    step('body', () => this.presetBody(name));
    step('settle', () => {   // whatever happened above: a clean, playable screen
      const S = this.S;
      if (S.building && S.building.to === undefined) S.building = null;
      if (g.tutorial) g.tutorial.visible = false;
      g.orbPickable = true; if (g.cam) g.cam.inputEnabled = true;
    });
    this.say('preset: ' + name + (errs.length ? ' (skipped: ' + errs.join(',') + ')' : ''));
  }
  private presetBody(name: string) {
    const S = this.S;
    if (name === 't1') {
      this.jumpTo(1);
      this.freeBuy('wizard_magic', 1); this.grant('magic', 60);
      S.navigated = 'orb';
    } else if (name === 't2') {
      this.jumpTo(2);
      this.freeBuy('wizard_magic', 2); this.freeBuy('summon_spirit', 12); this.freeBuy('summon_cloudling', 5);
      this.freeBuy('summon_spirit_tome', 4); this.freeBuy('text_enchantment', 1);
      this.grant('magic', 400); this.grant('knowledge', 60);
      S.navigated = 'study'; this.focus('study');
    } else if (name === 'forest' || name === 'prestige') {
      this.jumpTo(3);
      this.freeBuy('wizard_magic', 4); this.freeBuy('summon_spirit', 30); this.freeBuy('summon_cloudling', 8);
      this.freeBuy('cloudling_potency', 3); this.freeBuy('summon_spirit_tome', 6); this.freeBuy('text_enchantment', 3);
      this.freeBuy('summon_druid', 6); this.freeBuy('bigger_forest', 2);
      this.grant('knowledge', 800); this.grant('magic', 5000);
      if (name === 'forest') { S.navigated = 'forestry'; this.focus('forest'); }
      else {
        this.freeBuy('craft_totem', 3); this.freeBuy('carve_magic_totem', 1); this.freeBuy('carve_knowledge_totem', 1); this.freeBuy('carve_forest_totem', 1);
        const c = this.costs()[3]; for (const k in c) { const need = c[k] - (S.earned[k] || 0); if (need > 0) this.grant(k, need); }
        S.navigated = 'orb';
      }
    }
  }

  // ---------------------------------------------------------------- optional features (detected at runtime)
  fervorMax = false; private skyBoss = false; autoClose = true; modSel = ''; modPage = 0;
  runDebug(id: string, key: string) {
    const m = this.mod(id), fn = m && m.debug && m.debug[key];
    if (typeof fn !== 'function') { this.say(id + ': ' + key + ' is gone'); return; }
    const S = this.S;
    if (S && (!S.started || (this.g.tutorial && this.g.tutorial.visible))) this.skipTutorial();
    try { fn.call(m); this.say(id + ': ' + key); } catch (e: any) { this.say('ERR ' + key + ': ' + (e && e.message)); console.warn('[DevPanel]', id, key, e); }
  }
  private feat(name: string, ...fns: string[]) { const o = this.mod(name); return !!o && fns.every(f => has(o, f)); }
  private callFeat(name: string, fn: string, ...args: any[]) {
    const o = this.mod(name);
    if (!o || !has(o, fn)) { this.say(name + '.' + fn + ' not in this build'); return; }
    try { const r = o[fn](...args); this.say(name + '.' + fn + '(' + args.map(a => JSON.stringify(a)).join(',') + ')' + (r !== undefined ? ' -> ' + String(r).slice(0, 20) : '')); }
    catch (e: any) { this.say('ERR ' + name + '.' + fn + ': ' + (e && e.message)); console.warn('[DevPanel]', e); }
  }
  siegeJump(where: string) {
    const S = this.S;
    if (S && (!S.started || (this.g.tutorial && this.g.tutorial.visible))) this.skipTutorial();
    if (this.paused) this.paused = false;
    this.callFeat('siege', 'debugJump', where);
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number) {
    this.t += dt;
    this.fps += ((dt > 0 ? 1 / dt : 60) - this.fps) * 0.05;
    if (this.flashT > 0) this.flashT -= dt;
    if (!this.g || !this.g.isValid) { this.g = findGame(); if (!this.g) return; }
    this.syncTimePatch();
    this.pollEvents();
    if (this.fervorMax && typeof this.g.fervor === 'number') this.g.fervor = 1;
    // layout: mirror the game's Stage (fixed 270 logical px wide in portrait)
    const vs = view.getVisibleSize(), port = vs.width < vs.height;
    this.s = this.g.stageS || (port ? vs.width / 270 : vs.height / (sys.isMobile ? 240 : 360));
    this.W = Math.round(vs.width / this.s); this.H = Math.round(vs.height / this.s);
    this.node.setScale(this.s, this.s, 1); this.node.setPosition(0, 0, 0);
    const p = this.node.parent;
    if (p && this.node.getSiblingIndex() !== p.children.length - 1) this.node.setSiblingIndex(p.children.length - 1);
    if (this.cornerDownAt >= 0 && this.t - this.cornerDownAt >= 2 && !this.open) { this.cornerDownAt = -1; this.toggle(true); }
    if (this.fonts < 2) return;
    const D = this.D; D.W = this.W; D.H = this.H;
    D.begin();
    if (this.overlay) this.drawOverlay();
    this.btns = [];
    if (this.open) this.drawPanel();
    else if (this.devUrl) this.drawDevButton();
    D.end();
    // touch catchers
    const cr = this.cornerRect; cr.w = 44; cr.h = 44; cr.x = this.W - cr.w; cr.y = 0;
    this.place(this.corner, cr, DEV_ENABLED && !this.open);
    this.place(this.devBtn, this.layoutDevBtn(), DEV_ENABLED && this.devUrl && !this.open);
    this.place(this.blocker, this.panel, this.open);
  }
  private place(n: Node, r: any, on: boolean) {
    if (n.active !== on) n.active = on;
    if (!on) return;
    n.setPosition(r.x - this.W / 2, this.H / 2 - r.y, 0);
    n.getComponent(UITransform)!.setContentSize(r.w, r.h);
  }
  private pollEvents() {
    const g = this.g, S = this.S, L = this.last; if (!S) return;
    if (L.level !== undefined && S.level !== L.level) devLog(`tower level ${L.level} -> ${S.level}`);
    const b = !!S.building; if (L.building !== undefined && b !== L.building) devLog(b ? `build started -> ${S.building.to}` : 'build finished');
    const step = g.tutorial && g.tutorial.step; if (L.step !== undefined && step !== L.step) devLog(`tutorial ${L.step} -> ${step}`);
    if (g.toastT > (L.toastT || 0) + 0.5 && g.toastMsg) devLog('toast: ' + g.toastMsg);
    if (S.skills) { const sk = JSON.stringify(S.skills); if (L.skills && sk !== L.skills) { const a = JSON.parse(L.skills); for (const k in S.skills) if (S.skills[k] > (a[k] || 0)) devLog(`skill ${k} -> ${S.skills[k]}`); } L.skills = sk; }
    L.level = S.level; L.building = b; L.step = step; L.toastT = g.toastT || 0;
  }

  // ---------------------------------------------------------------- drawing
  private frame(x: number, y: number, w: number, h: number, c: string, t = 1) {
    const D = this.D; D.rect(c, x, y, w, t); D.rect(c, x, y + h - t, w, t); D.rect(c, x, y, t, h); D.rect(c, x + w - t, y, t, h);
  }
  private button(id: string, label: string, x: number, y: number, w: number, h: number, on: () => void, o: { disabled?: boolean, active?: boolean, color?: string } = {}) {
    const D = this.D, pressed = this.pressId === id && !o.disabled;
    x = Math.round(x); w = Math.round(w);
    D.rect(o.disabled ? C.btnOff : pressed ? C.btnHi : o.active ? C.btnOn : (o.color || C.btn), x, y, w, h);
    if (!o.disabled) D.rect('#ffffff', x, y, w, 1, 0.18);
    let s = label; while (s.length > 1 && D.textW(s) > w - 4) s = s.slice(0, -1);   // textW measures the proportional glyphs
    D.text(s, x + w / 2, y + Math.floor((h - 10) / 2), o.disabled ? '#6f6a80' : o.active ? C.dark : C.text, 10, 'center');
    if (!o.disabled) this.btns.push({ id, x, y, w, h, on });
  }
  // floating DEV tab: flush with the right edge at ~40% of the screen height, clear of the HUD in the top corners
  // (resources panel, Cloud Wall HP bar) and of the nav / audio buttons at the bottom; the corner gestures stay put
  private layoutDevBtn() { const r = this.devBtnRect; r.w = 26; r.h = 16; r.x = this.W - r.w; r.y = Math.round(this.H * 0.4); return r; }
  private drawDevButton() {
    const r = this.layoutDevBtn(), D = this.D;
    D.rect(C.bg, r.x, r.y, r.w, r.h, 0.75);
    D.rect(C.edge, r.x, r.y, r.w, 1); D.rect(C.edge, r.x, r.y + r.h - 1, r.w, 1); D.rect(C.edge, r.x, r.y, 1, r.h);   // open on the screen-edge side
    D.text('DEV', r.x + r.w / 2 + 1, r.y + 2, C.edge, 10, 'center');
  }
  /** `s` cut to fit `w` px in the 10 px font (proportional: measured with textW), `tail` appended when cut */
  private fit(s: string, w: number, tail = '') {
    const D = this.D; if (D.textW(s) <= w) return s;
    let n = s.length; while (n > 1 && D.textW(s.slice(0, n) + tail) > w) n--;
    return s.slice(0, n) + tail;
  }
  private drawPanel() {
    const D = this.D, g = this.g, S = this.S || {};
    const pw = Math.min(this.W - 8, 300), px = this.W - pw - 4, py = 4, pad = 4, iw = pw - pad * 2, BH = 24, GAP = 3;
    const ops: (() => void)[] = [];
    let y = py + pad;
    const text = (s: string, color = C.text, size = 10) => { const yy = y; ops.push(() => D.text(s, px + pad + 2, yy, color, size)); y += size === 12 ? 14 : 12; };
    const row = (cells: Cell[], lead = '', leadW = 0, h = BH) => {
      const yy = y, n = cells.length, w = (iw - leadW - GAP * (n - 1 + (leadW ? 1 : 0))) / n;
      if (lead) ops.push(() => D.text(lead, px + pad + 2, yy + Math.floor((h - 10) / 2), C.text, 10));
      cells.forEach((c, i) => {
        const x = px + pad + (leadW ? leadW + GAP : 0) + i * (w + GAP);
        ops.push(() => this.button(c.id || this.tab + ':' + (lead || '') + ':' + c.label, c.label, x, yy, w, h, c.on, c));
      });
      y += h + GAP;
    };
    const gap = (h = 3) => { y += h; };
    // header: title, live status, close
    const status = `L${S.level ?? '?'}${S.building ? ' build' : ''}  ${this.paused ? 'PAUSED' : 'x' + this.speed}  ${Math.round(this.fps)}fps`;
    { const yy = y; ops.push(() => {
      D.text('DEV', px + pad + 2, yy + 6, C.edge, 12);
      D.text(status, px + pad + 2 + D.textW('DEV', 12) + 6, yy + 7, C.dim, 10);
    }); }
    ops.push(() => this.button('close', 'X', px + pw - pad - 28, py + pad, 28, BH, () => this.toggle(false), { color: '#7a2f4a' }));
    y += BH + GAP;
    // live resources
    if (S.res) text(RES.map(k => k[0].toUpperCase() + ' ' + fmt(S.res[k] + (S.pending ? S.pending[k] || 0 : 0))).join('  '), C.warn);
    gap(2);
    // tabs
    const tabs: [string, string][] = [['demo', 'DEMO'], ['res', 'Res'], ['tower', 'Tower'], ['time', 'Time'], ['feat', 'Feat'],
      ['mods', 'Mods'], ['view', 'View'], ['cam', 'Cam'], ['sound', 'Sound'], ['save', 'Save'], ['log', 'Log'], ['tt', 'TikTok']];
    const half = Math.ceil(tabs.length / 2);
    for (const part of [tabs.slice(0, half), tabs.slice(half)]) row(part.map(([id, l]) => ({ id: 'tab_' + id, label: l, on: () => { this.tab = id; }, active: this.tab === id, color: id === 'demo' ? '#5a3a7a' : '#2e2444' })));
    gap(2);
    const sepY = y - 3; ops.push(() => D.rect(C.edge, px + pad, sepY, iw, 1, 0.5));
    gap(2);
    const noGame = !this.S;
    const L = S.level || 0, building = !!S.building;
    const BIG = 32;
    const section = (title: string, avail: boolean, why = '') => { text(title + (avail ? '' : '  -- ' + (why || 'not in this build')), avail ? C.edge : C.dim); };
    const siegeOk = this.feat('siege', 'debugJump'), prestigeOk = !!this.mod('prestige');
    switch (this.tab) {
      case 'demo': {
        // demo jumps close the panel by default so the boss sees the result straight away
        const ac = (fn: () => void) => () => { fn(); if (this.autoClose) this.toggle(false); };
        text(`Now: tower ${L}${building ? ' (building)' : ''}${S.started ? '' : '  (title screen)'}`, C.dim);
        row([{ id: 'p_demo', label: 'Title screen', on: ac(() => this.preset('demo')), disabled: noGame },
          { id: 'p_t1', label: 'Tower 1', on: ac(() => this.preset('t1')), disabled: noGame }], '', 0, BIG);
        row([{ id: 'p_t2', label: 'Tower 2 + study', on: ac(() => this.preset('t2')), disabled: noGame },
          { id: 'p_forest', label: 'Forestry T3', on: ac(() => this.preset('forest')), disabled: noGame }], '', 0, BIG);
        row([{ id: 'p_prestige', label: 'Pre-prestige', on: ac(() => this.preset('prestige')), disabled: noGame },
          { id: 'd_build', label: L >= this.maxLevel() ? 'Tower maxed' : 'Build T' + (L + 1) + ' (anim)', on: ac(() => this.buildNext()), disabled: noGame || building || L >= this.maxLevel() || !has(g, 'buildTower') }], '', 0, BIG);
        if (this.maxLevel() > 4) {   // module host: every tower, instantly (game-side setTowerLevel)
          text('Jump to tower (instant)', C.edge);
          const lv: number[] = []; for (let i = 0; i <= this.maxLevel(); i++) lv.push(i);
          for (let r = 0; r < lv.length; r += 6) row(lv.slice(r, r + 6).map(n => ({ id: 'd_T' + n, label: 'T' + n, active: L === n && !building,
            on: ac(() => this.jumpTo(n)), disabled: noGame || building })), '', 0, 28);
        }
        section('Siege', siegeOk);
        if (siegeOk) {
          row(['wall1', 'wall2', 'wall3'].map(w => ({ id: 'd_' + w, label: 'Wall ' + w.slice(-1), on: ac(() => this.siegeJump(w)) })), '', 0, BIG);
          row([...['boss1', 'boss2', 'boss3'].map(w => ({ id: 'd_' + w, label: 'Boss ' + w.slice(-1), on: ac(() => this.siegeJump(w)) })),
            { id: 'd_ending', label: 'Ending', on: ac(() => this.siegeJump('ending')) }], '', 0, BIG);
          row([{ id: 'd_dmg25', label: 'Damage 25%', on: () => this.callFeat('siege', 'debugDamage', 0.25), disabled: !this.feat('siege', 'debugDamage') },
            { id: 'd_dmg100', label: 'Break / next phase', on: () => this.callFeat('siege', 'debugDamage', 1), disabled: !this.feat('siege', 'debugDamage') }], '', 0, 28);
        }
        section('Prestige', prestigeOk);
        if (prestigeOk) row([{ id: 'd_pgrant', label: '+5 pts', on: () => this.callFeat('prestige', 'debugGrant', 5), disabled: !this.feat('prestige', 'debugGrant') },
          { id: 'd_punlock', label: 'Unlock all', on: () => this.callFeat('prestige', 'debugUnlockAll'), disabled: !this.feat('prestige', 'debugUnlockAll') },
          { id: 'd_popen', label: 'Blessings', on: ac(() => this.callFeat('prestige', 'openPanel')), disabled: !this.feat('prestige', 'openPanel') },
          { id: 'd_nextrun', label: 'Next run', on: ac(() => { const h = this.host(); if (h && has(h, 'resetRun')) { h.resetRun(); this.say('next run (resetRun)'); } }), disabled: !(this.host() && has(this.host(), 'resetRun')) }], '', 0, BIG);
        if (this.modIds().some(id => { const m = this.mod(id); return m && m.debug && Object.keys(m.debug).length; })) text('more: "Mods" tab = every module debug action', C.dim);
        row([{ id: 'd_autoclose', label: 'Auto-close ' + (this.autoClose ? 'ON' : 'off'), on: () => { this.autoClose = !this.autoClose; }, active: this.autoClose },
          { id: 'd_close', label: 'Close panel', on: () => this.toggle(false), color: '#7a2f4a' }], '', 0, BIG);
        break;
      }
      case 'mods': {
        // one sub-tab per feature module; one button per entry of its `debug` map (label -> function)
        const ids = this.modIds();
        if (!ids.length) { text('no module host in this build', C.dim); break; }
        if (ids.indexOf(this.modSel) < 0) this.modSel = ids.find(id => { const m = this.mod(id); return m && m.debug; }) || ids[0];
        for (let r = 0; r < ids.length; r += 4) row(ids.slice(r, r + 4).map(id => {
          const m = this.mod(id), n = m && m.debug ? Object.keys(m.debug).length : 0;
          return { id: 'mod_' + id, label: id, active: this.modSel === id, color: n ? '#2e2444' : '#221b30', on: () => { this.modSel = id; this.modPage = 0; } };
        }), '', 0, 22);
        const m = this.mod(this.modSel), h = this.host();
        const on = m && h && has(h, 'isUnlocked') ? (() => { try { return h.isUnlocked(this.modSel); } catch (e) { return true; } })() : true;
        text(this.modSel + (m && m.unlockTower ? '  (unlocks at T' + m.unlockTower + (on ? ', active' : ', locked') + ')' : ''), C.edge);
        const dbg = m && m.debug ? m.debug : null, all = dbg ? Object.keys(dbg) : [], PER = 12;
        if (!all.length) { text('no debug actions', C.dim); break; }
        const pages = Math.ceil(all.length / PER); if (this.modPage >= pages) this.modPage = 0;
        const keys = all.slice(this.modPage * PER, this.modPage * PER + PER);
        if (pages > 1) row([{ id: 'mod_prev', label: '< prev', on: () => { this.modPage = (this.modPage + pages - 1) % pages; } },
          { id: 'mod_page', label: (this.modPage + 1) + ' / ' + pages, on: () => { /* page indicator */ }, color: '#221b30' },
          { id: 'mod_next', label: 'next >', on: () => { this.modPage = (this.modPage + 1) % pages; } }], '', 0, 22);
        const pre = new RegExp('^' + this.modSel + '\\s*:\\s*', 'i');
        const lab = (k: string) => k.replace(pre, '');
        const half = (iw - GAP) / 2 - 4, fits = (k: string) => D.textW(lab(k)) <= half;   // proportional font: measure
        for (let i = 0; i < keys.length;) {
          const a = keys[i], b = keys[i + 1];
          const cell = (k: string) => ({ id: 'dbg_' + this.modSel + '_' + k, label: lab(k), on: () => this.runDebug(this.modSel, k) });
          if (fits(a) && b !== undefined && fits(b)) { row([cell(a), cell(b)], '', 0, 28); i += 2; }
          else { row([cell(a)], '', 0, 28); i += 1; }
        }
        break;
      }
      case 'feat': {
        const sg = this.mod('siege'), pr = this.mod('prestige'), sky = this.mod('sky');
        section('Siege', siegeOk);
        if (sg) {
          row(['wall1', 'wall2', 'wall3', 'ending'].map(w => ({ id: 'f_' + w, label: w === 'ending' ? 'End' : 'W' + w.slice(-1), on: () => this.siegeJump(w), disabled: !siegeOk })), 'Jump', 30);
          row(['boss1', 'boss2', 'boss3'].map(w => ({ id: 'f_' + w, label: 'Boss' + w.slice(-1), on: () => this.siegeJump(w), disabled: !siegeOk })), '', 0);
          row([0.1, 0.25, 0.5, 1].map(f => ({ id: 'f_dmg' + f, label: 'Dmg ' + Math.round(f * 100) + '%', on: () => this.callFeat('siege', 'debugDamage', f), disabled: !has(sg, 'debugDamage') })));
        }
        section('Prestige', !!pr);
        if (pr) row([{ id: 'f_pg10', label: '+10 pts', on: () => this.callFeat('prestige', 'debugGrant', 10), disabled: !has(pr, 'debugGrant') },
          { id: 'f_pg1k', label: '+1K pts', on: () => this.callFeat('prestige', 'debugGrant', 1000), disabled: !has(pr, 'debugGrant') },
          { id: 'f_pall', label: 'Unlock all', on: () => this.callFeat('prestige', 'debugUnlockAll'), disabled: !has(pr, 'debugUnlockAll') },
          { id: 'f_preset', label: 'Reset', on: () => this.callFeat('prestige', 'debugReset'), disabled: !has(pr, 'debugReset'), color: '#5a2a3a' }]);
        if (pr) row([{ id: 'f_popen', label: 'Open blessings panel', on: () => { this.callFeat('prestige', 'openPanel'); if (this.autoClose) this.toggle(false); }, disabled: !has(pr, 'openPanel') }]);
        section('Sky', !!sky);
        if (sky) {
          row(['dawn', 'day', 'dusk', 'night'].map(p => ({ id: 'f_sky_' + p, label: p, on: () => this.callFeat('sky', 'setPhase', p), disabled: !has(sky, 'setPhase') })));
          row([{ id: 'f_skyboss', label: 'Boss ' + (this.skyBoss ? 'ON' : 'off'), active: this.skyBoss, disabled: !has(sky, 'setBossMode'),
            on: () => { this.skyBoss = !this.skyBoss; this.callFeat('sky', 'setBossMode', this.skyBoss); } },
            ...[1, 10, 60].map(m => ({ id: 'f_skysp' + m, label: 'x' + m, on: () => this.callFeat('sky', 'setSpeed', m), disabled: !has(sky, 'setSpeed') }))]);
        }
        const fv = g && typeof g.fervor === 'number';
        section('Fervor' + (fv ? ' ' + Math.round(g.fervor * 100) + '%' : ''), fv);
        if (fv) row([{ id: 'f_fervor', label: 'Max fervor ' + (this.fervorMax ? 'ON' : 'off'), active: this.fervorMax, on: () => { this.fervorMax = !this.fervorMax; if (!this.fervorMax) g.fervor = 0; } }]);
        break;
      }
      case 'res':
        for (const k of RES) {
          const steps = RES_STEPS[k];
          row([...steps.map(([l, v]) => ({ label: l, on: () => this.grant(k, v), disabled: noGame })),
            { label: 'Max', on: () => this.setRes(k, Math.max(RES_MAX[k], S.res[k])), disabled: noGame }], RES_LABEL[k], 36);
        }
        row([{ label: 'Max all', on: () => { for (const k of RES) this.setRes(k, Math.max(RES_MAX[k], S.res[k])); this.say('all resources maxed'); }, disabled: noGame },
          { label: 'Zero all', on: () => { for (const k of RES) S.res[k] = 0; this.say('resources zeroed'); }, disabled: noGame }]);
        text('grants also count as earned (tower reqs)', C.dim);
        break;
      case 'tower': {
        text(`Tower ${L}${building ? ' (building -> ' + S.building.to + ')' : ''}   tutorial: ${g.tutorial ? g.tutorial.step : '?'}`, C.dim);
        row([{ label: L >= this.maxLevel() ? 'Max tower' : 'Build next ' + (L + 1), on: () => this.buildNext(), disabled: noGame || building || L >= this.maxLevel() || !has(g, 'buildTower') },
          { label: 'Replay build', on: () => this.replayBuild(), disabled: noGame || building || L < 1 || !has(g, 'buildTower') }]);
        row([0, 1, 2, 3, 4].map(n => ({ label: 'T' + n, on: () => this.jumpTo(n), active: L === n && !building, disabled: noGame || building })), 'Jump', 30);
        row([{ label: 'Skills +1', on: () => this.allSkills(1), disabled: noGame || !has(g, 'buySkill') },
          { label: 'Skills +10', on: () => this.allSkills(10), disabled: noGame || !has(g, 'buySkill') }]);
        row([{ label: '+5 cloud', on: () => this.say('cloudlings +' + this.freeBuy('summon_cloudling', 5)), disabled: noGame },
          { label: '+5 tomes', on: () => this.say('tomes +' + this.freeBuy('summon_spirit_tome', 5)), disabled: noGame },
          { label: '+6 druids', on: () => this.say('druids +' + this.freeBuy('summon_druid', 6)), disabled: noGame }]);
        row([{ label: S.started ? 'Skip tutorial' : 'Start + skip', on: () => { this.skipTutorial(); this.say('tutorial skipped'); }, disabled: noGame },
          { label: 'Tutorial next', on: () => g.tutorialButton(), disabled: noGame || !has(g, 'tutorialButton') || !(g.tutorial && g.tutorial.visible) }]);
        text('free buys: costs are refunded', C.dim);
        break;
      }
      case 'time':
        text(`Speed ${this.paused ? 'PAUSED' : 'x' + this.speed}   game time ${fmt(S.time || 0)} s`, C.dim);
        row([1, 2, 5, 10].map(n => ({ label: 'x' + n, on: () => { this.speed = n; this.paused = false; this.say('speed x' + n); }, active: !this.paused && this.speed === n, disabled: noGame })), 'Speed', 30);
        row([{ label: this.paused ? 'Resume' : 'Pause', on: () => { this.paused = !this.paused; }, active: this.paused, disabled: noGame },
          { label: 'Step 1 frame', on: () => { this.paused = true; this.stepN++; }, disabled: noGame }]);
        row([{ label: 'FF 10 s', on: () => this.fastForward(10), disabled: noGame || !has(g, 'tick') },
          { label: 'FF 1 min', on: () => this.fastForward(60), disabled: noGame || !has(g, 'tick') },
          { label: 'FF 10 min', on: () => this.fastForward(600), disabled: noGame || !has(g, 'tick') }]);
        text('FF runs 0.05 s ticks, silent', C.dim);
        break;
      case 'view': {
        const pd = g && g.D, slots = pd && pd.slots ? pd.slots.length : '?', used = pd && pd.used !== undefined ? pd.used : '?';
        const n = (a: any) => Array.isArray(a) ? a.length : 0;
        row([{ label: 'Stats ' + (this.stats ? 'ON' : 'off'), on: () => { this.stats = !this.stats; try { this.stats ? profiler.showStats() : profiler.hideStats(); } catch (e) { /* no profiler */ } }, active: this.stats },
          { label: 'Hitboxes ' + (this.overlay ? 'ON' : 'off'), on: () => { this.overlay = !this.overlay; }, active: this.overlay }]);
        text(`fps ${Math.round(this.fps)}   draw slots ${used}/${slots}`);
        text(`particles ${n(g && g.parts)}  motes ${n(g && g.motes)}  fx ${n(g && g.effects)}`);
        text(`spirits ${n(g && g.spirits)}  clouds ${n(g && g.cloudlings)}  balls ${n(g && g.balls)}`);
        text(`trees ${n(g && g.trees)}  druids ${n(g && g.druids)}  logs ${n(g && g.logs)}`);
        if (g && g.cam) text(`cam ${g.cam.x.toFixed(1)}, ${g.cam.y.toFixed(1)}  zoom ${g.cam.zoom.toFixed(2)}`, C.ok);
        if (g && g.mouse) text(`touch ${g.mouse.down ? 'down' : 'up'} cap '${g.mouse.capture || ''}' area '${S.activeArea || ''}'`, C.dim);
        text(`screen ${this.W}x${this.H} logical, x${this.s.toFixed(2)}`, C.dim);
        break;
      }
      case 'cam': {
        const cam = g && g.cam;
        if (cam) text(`cam ${cam.x.toFixed(1)}, ${cam.y.toFixed(1)}  zoom ${cam.zoom.toFixed(2)}  input ${cam.inputEnabled ? 'on' : 'off'}`, C.ok);
        row([{ label: 'Home', on: () => this.camHome(), disabled: !cam }, { label: 'Zoom +', on: () => this.zoom(0.5), disabled: !cam },
          { label: 'Zoom -', on: () => this.zoom(-0.5), disabled: !cam }]);
        row([{ label: 'Orb', on: () => this.focus('orb'), disabled: !cam },
          { label: 'Study', on: () => this.focus('study'), disabled: !cam || L < 2 },
          { label: 'Forest', on: () => this.focus('forest'), disabled: !cam || L < 3 }]);
        row([{ label: 'Showcase cam ' + (S.showcaseCamera ? 'ON' : 'off'), on: () => { S.showcaseCamera = !S.showcaseCamera; }, active: !!S.showcaseCamera, disabled: noGame },
          { label: 'Cam input ' + (cam && cam.inputEnabled ? 'on' : 'OFF'), on: () => { cam.inputEnabled = !cam.inputEnabled; }, disabled: !cam }]);
        break;
      }
      case 'sound': {
        const mm = this.audioState('music'), sm = this.audioState('sfx');
        row([{ id: 'music', label: mm ? 'Music: MUTED' : 'Music: on', on: () => this.setAudio('music', !mm), active: mm, disabled: noGame },
          { id: 'sfx', label: sm ? 'SFX: MUTED' : 'SFX: on', on: () => this.setAudio('sfx', !sm), active: sm, disabled: noGame }]);
        const api = ['toggleMusic', 'toggleSfx', 'setMusicMuted', 'setSfxMuted', 'setMuted', 'toggleMute'].filter(f => has(g, f));
        text(api.length ? 'game API: ' + api.join(', ') : 'no game mute API yet: volume fallback', C.dim);
        break;
      }
      case 'save': {
        text('Presets (reset first)', C.dim);
        row([{ label: 'Demo start', on: () => this.preset('demo'), disabled: noGame }, { label: 'T2 + study', on: () => this.preset('t2'), disabled: noGame }]);
        row([{ label: 'Forestry rdy', on: () => this.preset('forest'), disabled: noGame }, { label: 'Pre-prestige', on: () => this.preset('prestige'), disabled: noGame }]);
        gap(3);
        const confirming = this.t < this.confirmUntil;
        row([{ id: 'reset', label: confirming ? 'Tap to confirm' : 'Reset game', color: confirming ? '#b0303f' : '#5a2a3a', disabled: noGame,
          on: () => { if (this.t < this.confirmUntil) { this.confirmUntil = 0; this.resetGame(); } else this.confirmUntil = this.t + 3; } },
          { label: 'Export JSON', on: () => this.exportState(), disabled: noGame }]);
        text('no save system in the game yet: state is in memory', C.dim);
        break;
      }
      case 'tt': {
        // TikTok Minis APIs (TikTokSDK.ts): real inside the TikTok app, simulated everywhere else
        text(TikTok.real ? 'TikTok runtime: REAL calls' : 'not in TikTok: calls are simulated', TikTok.real ? C.ok : C.dim);
        text('rewarded unit: ' + (TT_CONFIG.rewardedAdUnitId || '(none - simulated)'), C.dim);
        const run = (label: string, p: () => Promise<any>) => () => { this.say(label + '...'); p().then(r => this.say(label + ' -> ' + JSON.stringify(r))); };
        row([{ id: 'tt_ad', label: 'Rewarded ad (+magic)', on: () => { this.say('ad...'); TikTok.showRewarded('dev').then(ok => { this.say('ad ' + (ok ? 'watched: reward' : 'skipped')); if (ok && this.S) this.grant('magic', Math.max(100, (this.S.res.magic || 0))); }); } },
          { id: 'tt_int', label: 'Interstitial', on: run('interstitial', () => TikTok.showInterstitial()) }], '', 0, 28);
        row([{ id: 'tt_login', label: 'Login', on: run('login', () => TikTok.login()) },
          { id: 'tt_sc', label: 'Add shortcut', on: run('addShortcut', () => TikTok.addShortcut()) },
          { id: 'tt_scr', label: 'Shortcut reward?', on: run('shortcutReward', () => TikTok.shortcutReward()) }], '', 0, 28);
        row([{ id: 'tt_em', label: 'Profile sidebar', on: run('entrance', () => TikTok.startEntranceMission()) },
          { id: 'tt_emr', label: 'Sidebar reward?', on: run('entranceReward', () => TikTok.entranceReward()) }], '', 0, 28);
        for (const l of ttLog.slice(-6)) text(this.fit(l, iw - 4, '~'), C.dim);
        break;
      }
      case 'log':
        if (!LOG.length) text('(empty)', C.dim);
        for (const l of LOG.slice(-10)) text(this.fit(l, iw - 4, '~'), /^(ERR|EXC)/.test(l) ? C.bad : /^WARN/.test(l) ? C.warn : C.text);
        row([{ label: 'Clear', on: () => { LOG.length = 0; } }]);
        break;
    }
    if (this.flashT > 0 && this.flash) text(this.fit(this.flash, iw - 4), C.ok);
    const ph = y - py + pad - GAP + 2;
    this.panel = { x: px, y: py, w: pw, h: ph };
    D.rect(C.bg, px, py, pw, ph, 0.97);
    this.frame(px, py, pw, ph, C.edge);
    for (const op of ops) op();
  }
  private drawOverlay() {
    const g = this.g, S = this.S, D = this.D; if (!S || !has(g, 'toScreen')) return;
    const box = (r: any, c: string) => { if (r && r.w > 0) this.frame(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h), c); };
    const polyBox = (cx: number, cy: number, poly: number[][]) => {
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
      const a = g.toScreen(cx + Math.min(...xs), cy + Math.min(...ys)), b = g.toScreen(cx + Math.max(...xs), cy + Math.max(...ys));
      return { x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1] };
    };
    // orb: polygon box + 24 px touch circle
    box(polyBox(S.orb.x, S.orb.y, ORB_POLY), '#ff4fa0');
    const [ox, oy] = g.toScreen(S.orb.x, S.orb.y), r = 24 * g.cam.zoom;
    for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2; D.rect('#ff4fa0', Math.round(ox + Math.cos(a) * r) - 1, Math.round(oy + Math.sin(a) * r) - 1, 2, 2); }
    if (S.level >= 2 && has(g, 'studyPos')) { const p = g.studyPos(g.shownTowerLevel); if (p) box(polyBox(p[0], p[1], STUDY_POLY), '#4fc3ff'); }
    if (S.level >= 3) {
      if (has(g, 'forestryAreaPos')) { const p = g.forestryAreaPos(); if (p) box(polyBox(p[0], p[1], FORESTRY_POLY), '#7dff6a'); }
      if (has(g, 'islandPos') && g.trees && g.trees.length) { const [ix, iy] = g.islandPos(); box(polyBox(ix + 1, iy - 42.5, [[-72, -49.5], [72, 49.5]]), '#3fbf3f'); }
    }
    if (Array.isArray(g.hitRegions)) for (const h of g.hitRegions) box(h, '#ffd166');
    box(this.cornerRect, '#ffffff');
  }
}

// ---------------------------------------------------------------- self-install
function findGame(): any {
  const sc = director.getScene(); if (!sc) return null;
  const stack: Node[] = [...sc.children];
  while (stack.length) {
    const n = stack.pop()!;
    for (const c of (n as any).components || []) if (js.getClassName(c) === 'TowerWizardGame') return c;
    stack.push(...n.children);
  }
  return null;
}
function install() {
  if (!DEV_ENABLED) return;
  try {
    const g = findGame(); if (!g || !g.node) return;
    if (g.node.getChildByName('DevPanel')) return;
    const n = new Node('DevPanel'); n.layer = g.node.layer;
    g.node.addChild(n);
    const p = n.addComponent(DevPanel); p.g = g;
  } catch (e) { console.warn('[DevPanel] install failed', e); }
}
if (DEV_ENABLED) {
  director.on(Director.EVENT_AFTER_SCENE_LAUNCH, install);
  if (director.getScene()) install();
}
