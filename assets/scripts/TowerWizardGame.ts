// Tower Wizard early-game rebuild (towers 0 -> 3) for Cocos Creator 3.8 / TikTok Mini Games.
// Ported from tower-wizard-demo/game.js; numbers and timings mirror the decompiled Godot project.
import {
  _decorator, AudioClip, director, AudioSource, BitmapFont, Component, dynamicAtlasManager, EventKeyboard, EventMouse, EventTouch,
  game, Game, ImageAsset, input, Input, KeyCode, Node, resources, ResolutionPolicy, sys, UITransform, view,
} from 'cc';
import { PixelDraw } from './PixelDraw';
import { IncomeMeter } from './IncomeMeter';
import { Sky } from './Sky';
import { getModules } from './GameModule';
import type { GameHost, GameModule } from './GameModule';
import { TikTok } from './TikTokSDK';
import './modules/index';   // every feature module registers itself on import
const { ccclass } = _decorator;

// ---------------------------------------------------------------- constants
let H = 360;                              // logical height; 240 on phones so text and buttons are 1.5x bigger
let W = 640;                              // tracks the device aspect every frame (fixed height)
let Z0 = 1;                               // base camera zoom (original base_zoom): world looks the same size on every device
let MOBILE = false;
let PORTRAIT = false;                     // tall phone screen: panels dock at the bottom
let HUD_H = 28;                           // bottom button row height incl. padding (36 on phones)
const GROUND = 322, TOWER_X = 320;
const FLOOR_Y = 330;                       // bottom of the ground strip: the camera never shows anything below it
// screen px between the screen centre and where FLOOR_Y may sit: the ground line stops at the top of the bottom
// button row, whose solid ground-coloured backing hides everything under it
const floorHalf = () => H / 2 - HUD_H;
const GRAVITY = 980;
const SPAWN_DURATION = 2.5, TOWER_DELAY = 1.5;
const COL = { dark: '#2a1f3d', sky: '#e4f4fc', ink: '#2a1f3d', rowHover: '#3d2f5a', blue: '#6545b5', pink: '#ff8fb1', light: '#fff1d6', white: '#ffffff', grey: '#a8a3b8' };

const TOWERS: any[] = [
  { img: 'tower_0', orb: [20.5, -23] },
  { img: 'tower_1', orb: [20.5, -25], study: [55, 77], wizard: [50, 83] },
  { img: 'tower_2', orb: [48.5, -25], study: [83, 76], wizard: [78, 82], node: [-1, 34], forestWizard: [-11, 151] },
  { img: 'tower_3', orb: [48.5, -25], study: [83, 76], wizard: [77.5, 82], node: [-1, 33], forestWizard: [-11, 151] },
  // towers 5-10: original art (art_orig) as placeholders. Anchors from tower_4..9.tscn, relative to the image top-left
  // (those roots sit at 0,0; tower_0-3 roots carry (41,123), already removed above). `node` is the scene's Node2D,
  // forestWizard is relative to it; every other anchor is absolute within the image (see towerAnchor()).
  { img: 'tower_4', orb: [89, -25], study: [123.5, 76], wizard: [118, 82], node: [-2, 34], forestWizard: [30, 148],
    anchors: { forestry: [47.5, 197], portal: [47.5, 186], prestige: [136.5, 235], prestigeWizard: [143.5, 233], window: [139.5, 231], beacon: [139.5, -93],
      building: [24, 362], buildingWizard: [20, 378] } },
  { img: 'tower_5', orb: [89, -25], study: [123.5, 76], wizard: [118, 82], node: [-2, 34], forestWizard: [30, 148],
    anchors: { forestry: [47.5, 197], portal: [47.5, 186], prestige: [136.5, 235], prestigeWizard: [143.5, 233], window: [139.5, 231], beacon: [139.5, -93],
      building: [24, 362], buildingWizard: [20, 378], alchemy: [144, 487], alchemyWizard: [119, 486] } },
  { img: 'tower_6', orb: [103, -25], study: [137.5, 76], wizard: [132, 82], node: [12, 34], forestWizard: [13, 291],
    anchors: { forestry: [44.5, 324], portal: [44.5, 313], prestige: [150.5, 235], prestigeWizard: [157.5, 233], window: [153.5, 231], beacon: [153.5, -93],
      building: [38, 410], buildingWizard: [34, 426], alchemy: [158, 487], alchemyWizard: [132, 486],
      sorcery: [40, 71], sorceryPortal: [41, 51], sorceryWizard: [20, 48], crystal: [66, 789.5] } },
  { img: 'tower_7', orb: [103, -25], study: [137.5, 76], wizard: [132, 82], node: [12, 34], forestWizard: [13, 290],
    anchors: { forestry: [44.5, 324], portal: [44.5, 313], prestige: [154.5, 326], prestigeWizard: [157.5, 324], window: [157.5, 322], beacon: [157.5, -2],
      building: [38, 410], buildingWizard: [34, 426], alchemy: [158, 487], alchemyWizard: [132, 486],
      sorcery: [40, 71], sorceryPortal: [41, 51], sorceryWizard: [20, 48], crystal: [66, 789.5],
      obelisk: [175, 192], obeliskPos: [181.5, 238.5], obeliskWizard: [163, 163] } },
  { img: 'tower_8', orb: [103, -25], study: [137.5, 76], wizard: [132, 82], node: [12, 34], forestWizard: [13, 290],
    anchors: { forestry: [44.5, 324], portal: [44.5, 313], prestige: [154.5, 326], prestigeWizard: [157.5, 324], window: [157.5, 322], beacon: [157.5, -2],
      building: [38, 410], buildingWizard: [34, 426], alchemy: [158, 487], alchemyWizard: [133, 486],
      sorcery: [40, 71], sorceryPortal: [41, 51], sorceryWizard: [20, 48], crystal: [66, 789.5],
      obelisk: [175, 192], obeliskPos: [181.5, 238.5], obeliskWizard: [163, 163], temple: [51, 186], lighthouse: [157.5, 300] } },
  { img: 'tower_9', orb: [103, -220], study: [137.5, 76], wizard: [128, 81], node: [12, 34], forestWizard: [13, 290],
    anchors: { forestry: [44.5, 324], portal: [44.5, 313], prestige: [154.5, 326], prestigeWizard: [157.5, 324], window: [157.5, 322], beacon: [157.5, -2],
      building: [38, 410], buildingWizard: [34, 426], alchemy: [158, 487], alchemyWizard: [132, 484],
      sorcery: [40, 71], sorceryPortal: [41, 51], sorceryWizard: [20, 48], crystal: [66, 789.5],
      obelisk: [175, 192], obeliskPos: [181.5, 238.5], obeliskWizard: [163, 163], temple: [51, 186], lighthouse: [157.5, 300] } },
];
const ORB_START = [318, 306];
// TOWER_COSTS[L] = what ascending from L to L + 1 needs (BuildTowerUI.get_tower_cost(L)), lifetime totals.
// 7 -> 8 and 8 -> 9 cost nothing but are gated by the walls; 9 -> 10 is the cosmic-dust Final Ascension. Modules add
// their gates / costs per level through GameModule.towers (merged in addModule).
const TOWER_COSTS: Record<string, number>[] = [{ magic: 30 }, { magic: 1300 }, { magic: 13000 }, { magic: 350000, wood: 20000 },
  { magic: 4e6, wood: 1.5e5 }, { magic: 5e8, wood: 1.5e7 }, { magic: 1e12, magic_gold: 500 }, {}, {}, { cosmic_dust: 50 }];
const TOWER_GATES: (((h: GameHost) => string | null) | null)[] = [];   // index = level being ascended to
const TOWER_LABELS: (((h: GameHost) => string | null) | null)[] = [];
const RES_IDS = ['magic', 'spirits', 'knowledge', 'wood', 'totems'];   // resources panel order; modules append theirs
const RES_HIDDEN: Record<string, boolean> = {};                          // module resources kept out of the panel (relics)
const RES_DESC: Record<string, string> = { magic: 'Magic\n\nCreated by Cloudlings', spirits: 'Spirits\n\nPurchased at The Orb', knowledge: 'Knowledge\n\nCreated by Spirit Tomes',
  wood: 'Wood\n\nHarvested by Druids', totems: 'Totems\n\nBought at the Forestry Portal' };
const ICON: Record<string, string> = { magic: 'magic_icon', spirits: 'spirit_icon', knowledge: 'knowledge_icon', wood: 'wood_icon', totems: 'totem_icon' };
// Audio (all original, generated by audio-src/gen-music.js + gen-sfx.js). BGM is in F major, the swipe chimes
// walk up the F-major pentatonic so a fast sustained swipe "plays" a rising melody over the music.
const BGM_PATH = 'music/bgm_main', BGM_VOL = 0.4, AUDIO_KEY = 'tw_audio_v1', SAVE_KEY = 'tw_save_v1';
const CAST_NOTES = ['cast_n0', 'cast_n1', 'cast_n2', 'cast_n3', 'cast_n4', 'cast_n5', 'cast_n6', 'cast_n7'];
const CAST_TOP = [5, 7, 6, 7, 4, 6, 5, 7];  // once the scale is climbed, keep noodling around the top
// Fervor: sustained fast swiping (logical px/s; the portrait screen is 270 px wide) fills a meter that
// multiplies orb-click magic up to x2. Clicks keep their 0.25 s cooldown, so the gain is bounded per second.
const FERVOR_LO = 650, FERVOR_HI = 1000, FERVOR_FILL = 2.0, FERVOR_MAX_MULT = 2, SPEED_CAP = 2400;
const FERVOR_COLS = ['#7ef0c8', '#ff8fb1', '#ffd166'];   // mint -> pink -> gold
const ART_NOTE = ['...##..', '...#.#.', '...#..#', '...#...', '...#...', '.###...', '####...', '.##....'];
const ART_SPEAKER = ['...#.....', '..##...#.', '####.#..#', '####.#..#', '####.#..#', '..##...#.', '...#.....'];
function lerpCol(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map(sh => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * k));
  return '#' + c.map(v => ('0' + v.toString(16)).slice(-2)).join('');
}
function fervorCol(f: number) { return f < 0.5 ? lerpCol(FERVOR_COLS[0], FERVOR_COLS[1], f * 2) : lerpCol(FERVOR_COLS[1], FERVOR_COLS[2], (f - 0.5) * 2); }

function spiritCost(L: number) { // SkillDefSpirit.gd
  if (L === 1) return 201;
  return Math.floor(200 + 0.7 * Math.pow(L, 2.1 + 0.23 * Math.pow(L, 0.4)) * 0.9);
}
const SKILLS: Record<string, any> = {
  wizard_magic: { list: 'orb', name: 'Wizard Magic', res: 'magic', cost: (L: number) => 25 * 2 ** L, max: 4, icon: null,
    tip: () => 'Each tap on The Orb gives twice the {magic_icon}' },
  summon_spirit: { list: 'orb', name: 'Summon Spirit', res: 'magic', cost: spiritCost, max: Infinity, icon: 'spirit_icon',
    unlock: 'wizard_magic', creates: 'spirits', summon: true, showCost: true,
    tip: () => 'Call {spirit_icon}, the helpers every other creature is made from\n\n- Hold the button to buy several' },
  summon_cloudling: { list: 'orb', name: 'Summon Cloudling', res: 'spirits', cost: () => 1, max: 10000, icon: 'cloudling_icon',
    unlock: 'summon_spirit', summon: true, showLevel: true,
    tip: () => 'Call a Cloudling that makes {magic_icon}\n\n- Hold the orb to make them work 35% faster' },
  cloudling_potency: { list: 'orb', name: 'Cloudling Boost', res: 'knowledge', cost: (L: number) => 20 * 2 ** L, max: 13, icon: null,
    unlock: 'summon_cloudling', showLevel: true, tip: () => 'Increase Cloudling {magic_icon} creation by 70%' },
  summon_spirit_tome: { list: 'study', name: 'Summon Spirit Tome', res: 'spirits', cost: () => 1, max: 10000, icon: 'bookshelf_icon',
    summon: true, showLevel: true,
    tip: () => 'Call a Spirit Tome that writes {knowledge_icon}\n\n- Hold the Study to make them work 35% faster' },
  text_enchantment: { list: 'study', name: 'Text Enchantment', res: 'knowledge', cost: (L: number) => 100 * 2 ** L, max: 13, icon: null,
    unlock: 'summon_spirit_tome', showLevel: true, tip: () => 'Increase {knowledge_icon} gain by 50%' },
  library_spirits: { list: 'study', name: 'Library Spirits', res: 'knowledge', cost: (L: number) => 1000 * 10 ** L, max: 8, icon: null,
    unlock: 'text_enchantment', showLevel: true, tip: () => 'Creates 5 {spirit_icon} from the study' },
  // Forestry (tower 3): data/skills/*.tres
  summon_druid: { list: 'forestry', name: 'Summon Druid', res: 'spirits', cost: () => 1, max: 10000, icon: 'druid_icon',
    summon: true, showLevel: true,
    tip: () => 'Druids tend the forest and gather {wood_icon}.\n\n- Hold the forest to make them work 35% faster' },
  bigger_forest: { list: 'forestry', name: 'Bigger Forest', res: 'knowledge', cost: (L: number) => 250 * 2 ** L, max: 10, icon: null,
    unlock: 'summon_druid', showLevel: true,
    tip: () => 'Grows the forest.\n\n- Each log gives 50% more {wood_icon}' },
  craft_totem: { list: 'forestry', name: 'Craft Totem', res: 'wood', cost: (L: number) => 150 * 2 ** L, max: 1e6, icon: 'totem_icon',
    unlock: 'summon_druid', creates: 'totems', showCost: true,
    tip: () => 'Carve {totem_icon}. Each Totem can take a different shape on the totem pole and gives its own bonus.' },
  carve_magic_totem: { list: 'totems', name: 'Magic Totem', res: 'totems', cost: () => 1, max: 50, icon: null, unlock: 'craft_totem', showLevel: true,
    totem: 'magic_totem', tip: () => 'Every Totem of this kind adds 100% to {magic_icon} income' },
  carve_knowledge_totem: { list: 'totems', name: 'Knowledge Totem', res: 'totems', cost: () => 1, max: 50, icon: null, unlock: 'craft_totem', showLevel: true,
    totem: 'knowledge_totem', tip: () => 'Every Totem of this kind adds 100% to {knowledge_icon} income' },
  carve_forest_totem: { list: 'totems', name: 'Forest Totem', res: 'totems', cost: () => 1, max: 50, icon: null, unlock: 'craft_totem', showLevel: true,
    totem: 'wood_totem', tip: () => 'Every Totem of this kind adds 100% to {wood_icon} income\n\n- Also brings 4 {spirit_icon}' },
  // revealed by blessings / nation relations in the original; the demo falls back to the tower level that shows them off
  carve_crafting_totem: { list: 'totems', name: 'Crafting Totem', res: 'totems', cost: () => 1, max: 50, icon: null, unlock: 'craft_totem', showLevel: true,
    totem: 'crafting_totem', visible: (h: GameHost) => blessing(h, 'crafting_totem_blessing') > 0 || h.towerLevel() >= 6,
    tip: () => 'Every Totem of this kind makes {blank_rune_icon} and {magic_gold_icon} twice as fast' },
  carve_sage_totem: { list: 'totems', name: 'Sage Totem', res: 'totems', cost: () => 1, max: 50, icon: null, unlock: 'craft_totem', showLevel: true,
    totem: 'sage_totem', visible: (h: GameHost) => blessing(h, 'sage_totem_blessing') > 0 || h.towerLevel() >= 5,
    tip: () => 'Every Totem of this kind multiplies Academy EXP by another 50%' },
  bigger_forest_2: { list: 'forestry', name: 'Druid Power', res: 'knowledge', cost: (L: number) => 1e8 * 2 ** L, max: 10, icon: null,
    unlock: 'bigger_forest', showLevel: true,
    visible: (h: GameHost) => { const b: any = h.modules.embassy || h.modules.buildings; return b && b.hasRelations ? !!b.hasRelations('netus') : h.skillLevel('bigger_forest') >= 10; },
    tip: () => 'Grows the forest.\n\n- Each log gives 50% more {wood_icon}' },
};
function blessing(h: GameHost, id: string): number { const p: any = h.modules.prestige; try { return p && p.blessingLevel ? p.blessingLevel(id) || 0 : 0; } catch (e) { return 0; } }

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeOutSine = (k: number) => Math.sin(k * Math.PI / 2);
const easeInOutSine = (k: number) => -(Math.cos(Math.PI * k) - 1) / 2;
const easeOutExpo = (k: number) => k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);

function fmt(n: number, round = false): string { // Utils.format_num
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
function pointInPoly(px: number, py: number, pts: number[][]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const ORB_POLY = [[-14, -20], [16, -20], [16, 27], [-15, 13]];      // OrbArea polygon (offset -2, 0)
const STUDY_POLY = [[22, -56], [22, 42], [-14, 42], [-14, -40]];   // StudyArea polygon
const FX: Record<string, any> = {
  click: { img: 'click_particles', fw: 9, frames: 3, fps: 10 },
  spirit_spawn: { img: 'spirit_spawn', fw: 7, frames: 2, fps: 12 },
  poof: { img: 'magic_material_particle', fw: 7, frames: 3, life: 0.2 },
  sparkle0: { img: 'sparkles_0', fw: 11, frames: 4, life: 0.35 }, sparkle1: { img: 'sparkles_1', fw: 13, frames: 4, life: 0.35 },
  sparkle2: { img: 'sparkles_2', fw: 11, frames: 4, life: 0.35 }, sparkle3: { img: 'sparkles_3', fw: 11, frames: 4, life: 0.35 },
  new_area: { img: 'new_area_sparkles', fw: 11, frames: 5, fps: 12 },
};

@ccclass('TowerWizardGame')
export class TowerWizardGame extends Component {
  private D!: PixelDraw;
  private ready = false;
  private clips: Record<string, AudioClip> = {};
  private audio!: AudioSource;
  bgm!: AudioSource; swish!: AudioSource; shimmer!: AudioSource;
  musicOn = true; sfxOn = true; private gestured = false; private hidden = false;
  private lastPlay: Record<string, number> = {};
  private now = 0;

  // ---------------------------------------------------------------- state
  S: any = {
    started: false, level: 0,
    res: { magic: 0, spirits: 0, knowledge: 0, wood: 0, totems: 0 }, pending: { magic: 0, spirits: 0, knowledge: 0, wood: 0, totems: 0 },
    earned: { magic: 0, spirits: 0, knowledge: 0, wood: 0, totems: 0 }, seen: { magic: true, spirits: false, knowledge: false, wood: false, totems: false },
    resourcesVisible: false, skills: Object.fromEntries(Object.keys(SKILLS).map(k => [k, 0])),
    building: null, orb: { x: ORB_START[0], y: ORB_START[1], phase: 0 },
    speedTimer: 0, speedMult: 1, studySpeedTimer: 0, studySpeedMult: 1,
    showcaseCamera: true, activeArea: '', wizardArea: 'initial', time: 0, navigated: '', newArea: '',
  };
  spirits: any[] = []; cloudlings: any[] = []; balls: any[] = []; effects: any[] = []; indicators: any[] = []; uiIndicators: any[] = [];
  books: any[] = []; flyingSpirits: any[] = [];
  shownTowerLevel = 0;
  sky = new Sky();   // day/night cycle + boss sky (Sky.ts); Siege: sky.setBossMode(on) / sky.setVortex(wx, wy)
  cam: any = { x: ORB_START[0], y: ORB_START[1], zoom: 2, vx: 0, vy: 0, tween: null, zoomTween: null, inputEnabled: true };
  mouse: any = { x: -100, y: -100, down: false, dragging: false, lastX: 0, lastY: 0, uiHit: null, tap: false, cast: false, capture: '' };
  touches: Record<number, [number, number]> = {}; lastPinch = 0; pinchStart: { d: number, z: number } | null = null;
  orbCooldown = 0; studyCooldown = 0; orbPickable = true; castTimer = 0; cloudSpawnTimer = 0;
  tutorial: any = { step: 'none', visible: false, text: '', button: '', showT: 0 };
  toastMsg = ''; toastT = 0;
  hitRegions: any[] = []; btnState: Record<string, any> = {}; tooltip: any = null;
  orbUiRect: any = null; studyUiRect: any = null; wobbleT = -1; frameDt = 0;

  // ================================================================ lifecycle
  onLoad() {
    MOBILE = sys.isMobile;
    HUD_H = MOBILE ? 36 : 28;
    H = MOBILE ? 240 : 360; Z0 = H / 360;
    this.cam.zoom = 2 * Z0;
    view.setDesignResolutionSize(Math.round(H * 16 / 9), H, ResolutionPolicy.FIXED_HEIGHT);
    dynamicAtlasManager.enabled = false;
    // everything is drawn under a "stage" node that we rotate 90 degrees when the screen is portrait
    this.stage = new Node('Stage'); this.stage.layer = this.node.layer; this.stage.addComponent(UITransform);
    this.node.addChild(this.stage);
    this.D = new PixelDraw(this.stage);
    this.initModules();
    this.updateLayout();
    this.audio = this.node.addComponent(AudioSource);
    const src = (name: string) => { const n = new Node(name); this.node.addChild(n); return n.addComponent(AudioSource); };
    this.bgm = src('BGM'); this.bgm.loop = true; this.bgm.playOnAwake = false; this.bgm.volume = BGM_VOL;
    this.swish = src('Swish'); this.swish.loop = true; this.swish.playOnAwake = false; this.swish.volume = 0;
    this.shimmer = src('Shimmer'); this.shimmer.loop = true; this.shimmer.playOnAwake = false; this.shimmer.volume = 0;
    this.loadAudioPrefs();
    game.on(Game.EVENT_HIDE, this.onHide, this);
    game.on(Game.EVENT_SHOW, this.onShow, this);
    this.loadAssets();
    input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
    input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
    input.on(Input.EventType.MOUSE_WHEEL, this.onWheel, this);
    input.on(Input.EventType.KEY_DOWN, this.onKey, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
  }
  keyZ = false; // original "area_press": holding Z clicks whatever area the pointer is over
  private onKeyUp(e: EventKeyboard) { if (e.keyCode === KeyCode.KEY_Z) this.keyZ = false; }
  onDestroy() {
    input.off(Input.EventType.TOUCH_START, this.onTouchStart, this); input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this); input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this); input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
    input.off(Input.EventType.MOUSE_WHEEL, this.onWheel, this); input.off(Input.EventType.KEY_DOWN, this.onKey, this); input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
    game.off(Game.EVENT_HIDE, this.onHide, this); game.off(Game.EVENT_SHOW, this.onShow, this);
  }

  // Start-up loads only what the first screens need (fonts, UI, sky, orb, wizard, the ten towers), then the game is
  // ready; the rest of art-v2 and the sfx stream in behind it. Original art (resources/art_orig) is never preloaded:
  // PixelDraw.onMissing fetches an image the first time something draws / measures it (art-v2 first, else the
  // original), so only originals that art-v2 does not override are ever downloaded. 'orig:<name>' always means the
  // original. Asset names are not kept in release builds, so everything is keyed by its bundle path.
  private artV2: Record<string, string> = {}; private artOrig: Record<string, string> = {}; private artReq: Record<string, boolean> = {};
  loadDone = 0; loadTotal = 1;
  private loadAssets() {
    const base = (p: string) => p.split('/').pop()!;
    for (const info of resources.getDirWithPath('art', ImageAsset)) if (info.path.startsWith('art/')) this.artV2[base(info.path)] = info.path;
    for (const info of resources.getDirWithPath('art_orig', ImageAsset)) if (info.path.startsWith('art_orig/')) this.artOrig[base(info.path)] = info.path;
    this.D.onMissing = name => this.requestArt(name);
    const critical = /^(panel|button.*|progress_bar_background|orb|portal_outline|sky.*|clouds.*|hills.*|ground.*|sun|moon|stars|boss_vortex|wizard.*|cloudling.*|spirit.*|bright_spirit|magic_icon|spirit_icon|click_particles|sparkles_\d|magic_material_particle|spirit_spawn|new_area_sparkles|tower_\d|block.*)$/;
    const jobs: [string, any, (name: string, asset: any) => void][] = [];
    for (const n in this.artV2) if (critical.test(n)) { this.artReq[n] = true; jobs.push([this.artV2[n], ImageAsset, (k, a) => this.D.addImage(k, a)]); }
    for (let L = 1; L <= TOWERS.length; L++) { const n = TOWERS[L - 1].img; if (!this.artV2[n] && this.artOrig[n] && !this.artReq[n]) { this.artReq[n] = true; jobs.push([this.artOrig[n], ImageAsset, (k, a) => this.addOrig(k, a)]); } }
    for (const f of ['fpf10', 'fpf12']) jobs.push(['fonts/' + f, BitmapFont, (n, a) => this.D.addFont(n, a)]);
    let pending = jobs.length; this.loadTotal = jobs.length;
    for (const [path, type, add] of jobs) resources.load(path, type, (err: Error | null, asset: any) => {
      if (err) console.error(err); else add(base(path), asset);
      this.loadDone++;
      if (--pending === 0) { this.ready = true; this.loadMusic(); this.loadRest(); }
    });
  }
  // behind the first frame: the rest of art-v2, then the sound effects
  private loadRest() {
    for (const n in this.artV2) this.requestArt(n, false);
    for (const info of resources.getDirWithPath('sfx', AudioClip)) resources.load(info.path, AudioClip, (err: Error | null, a: AudioClip) => { if (!err) this.clips[info.path.split('/').pop()!] = a; });
  }
  private addOrig(n: string, a: ImageAsset) {
    if (a.width > 8192 || a.height > 8192) return;   // too wide for one texture on WebGL / phones (contellation_animation)
    this.D.addImage('orig:' + n, a);
    if (!this.artV2[n]) this.D.alias(n, 'orig:' + n);
  }
  /** lazy image fetch (PixelDraw.onMissing): art-v2 if it has the name, else the original; each name once */
  // on-demand requests (something is drawing it now) jump the queue; the background stream trickles 6 at a time
  requestArt(name: string, urgent = true) {
    const q = this.artQ;
    if (this.artReq[name]) { // already queued in the background: move it to the front
      if (urgent) { const i = q.findIndex(j => j.name === name); if (i > 0) q.unshift(q.splice(i, 1)[0]); }
      return;
    }
    this.artReq[name] = true;
    const orig = name.startsWith('orig:'), n = orig ? name.slice(5) : name;
    let job: { name: string, path: string, add: (a: ImageAsset) => void } | null = null;
    if (!orig && this.artV2[n]) job = { name, path: this.artV2[n], add: a => this.D.addImage(n, a) };
    else if (this.artOrig[n]) {   // unknown art keys are ignored (callers fall back, D.has stays false)
      if (orig) this.artReq[n] = this.artReq[n] || !this.artV2[n]; else this.artReq['orig:' + n] = true;
      job = { name, path: this.artOrig[n], add: a => this.addOrig(n, a) };
    }
    if (!job) return;
    if (urgent) q.unshift(job); else q.push(job);
    this.pumpArt();
  }
  private artQ: { name: string, path: string, add: (a: ImageAsset) => void }[] = []; private artActive = 0;
  private pumpArt() {
    while (this.artActive < 6 && this.artQ.length) {
      const j = this.artQ.shift()!; this.artActive++;
      resources.load(j.path, ImageAsset, (err: Error | null, a: ImageAsset) => { this.artActive--; if (!err) j.add(a); this.pumpArt(); });
    }
  }
  // black-screen guard: a progress bar (plain rects, no fonts needed) until the start-up set is in
  private drawLoading() {
    const D = this.D; this.updateLayout();
    D.begin();
    D.rect('#e4f4fc', 0, 0, W, H);
    const bw = Math.min(160, W - 40), x = Math.round((W - bw) / 2), y = Math.round(H / 2);
    D.rect(COL.dark, x - 2, y - 2, bw + 4, 10);
    D.rect(COL.pink, x, y, Math.max(2, Math.round(bw * this.loadDone / Math.max(1, this.loadTotal))), 6);
    D.end();
  }
  // the BGM loads after everything else so it never delays the first frame
  private loadMusic() {
    resources.load(BGM_PATH, AudioClip, (err: Error | null, clip: AudioClip) => {
      if (err) { console.error(err); return; }
      this.bgm.clip = clip; this.updateMusic();
    });
  }

  update(dtRaw: number) {
    if (!this.ready) { this.drawLoading(); return; }
    // track the live screen width (phones rotate after load; fixed height = 360)
    this.updateLayout();
    const dt = Math.min(dtRaw, 1 / 20);
    this.frameDt = dt; this.now += dt;
    this.tick(dt);
    this.sky.update(dt);
    this.render();
  }

  // ================================================================ audio
  play(name: string, db = 0, minGap = 0) {
    if (!this.sfxOn || this.hidden) return;
    const c = this.clips[name]; if (!c) return;
    if (minGap && this.lastPlay[name] && this.now - this.lastPlay[name] < minGap) return;
    this.lastPlay[name] = this.now;
    this.audio.playOneShot(c, Math.min(1, Math.pow(10, db / 20) * 0.5));
  }
  // orb / area taps: three pentatonic variants picked at random so repeated taps don't machine-gun
  private playClick(db = -6) { const v = ['area_click', 'area_click_1', 'area_click_2'][Math.floor(Math.random() * 3)]; this.play(v, db); }
  // mobile autoplay rules: music may only start from a user gesture
  private userGesture() { if (this.gestured) return; this.gestured = true; this.updateMusic(); }
  private updateMusic() {
    const want = this.musicOn && this.gestured && !this.hidden && !!this.bgm.clip;
    if (want && !this.bgm.playing) this.bgm.play();
    else if (!want && this.bgm.playing) this.bgm.pause();
  }
  private onHide() { this.hidden = true; this.updateMusic(); this.stopSwipeLoops(); this.writeSave(); }
  private onShow() { this.hidden = false; this.updateMusic(); }
  private loadAudioPrefs() {
    try {
      const v = sys.localStorage.getItem(AUDIO_KEY);
      if (v) { const o = JSON.parse(v); this.musicOn = o.music !== false; this.sfxOn = o.sfx !== false; }
    } catch (e) { /* storage unavailable: defaults */ }
  }
  private saveAudioPrefs() {
    try { sys.localStorage.setItem(AUDIO_KEY, JSON.stringify({ music: this.musicOn, sfx: this.sfxOn })); } catch (e) { /* ignore */ }
  }
  toggleMusic() { this.musicOn = !this.musicOn; this.saveAudioPrefs(); this.updateMusic(); this.play('tooltip_hover', -8); this.toast(this.musicOn ? 'Music on' : 'Music off'); }
  toggleSfx() { this.sfxOn = !this.sfxOn; this.saveAudioPrefs(); if (!this.sfxOn) this.stopSwipeLoops(); this.play('tooltip_hover', -8); this.toast(this.sfxOn ? 'Sound on' : 'Sound off'); }
  private stopSwipeLoops() {
    for (const a of [this.swish, this.shimmer]) { a.volume = 0; if (a.playing) a.stop(); }
    this.swishV = 0; this.shimmerV = 0;
  }
  // the swipe sound follows the finger: an airy swish whose loudness tracks finger speed, plus a bright
  // shimmer layer that only opens up when swiping fast / with fervor. Fades out quickly when the finger stops.
  swishV = 0; shimmerV = 0;
  private updateSwipeAudio(dt: number) {
    const sp = this.fingerSpeed, f = this.fervor, on = this.sfxOn && !this.hidden;
    const tSwish = on ? 0.32 * Math.pow(Math.min(1, sp / 1300), 0.8) : 0;
    const tShim = on ? 0.3 * Math.min(1, Math.max(0, (sp - 450) / 900)) * (0.35 + 0.65 * f) : 0;
    const k = (cur: number, tgt: number) => cur + (tgt - cur) * Math.min(1, dt / (tgt > cur ? 0.05 : 0.12));
    this.swishV = k(this.swishV, tSwish); this.shimmerV = k(this.shimmerV, tShim);
    for (const [a, v] of [[this.swish, this.swishV], [this.shimmer, this.shimmerV]] as [AudioSource, number][]) {
      if (!a.clip) { const c = this.clips[a === this.swish ? 'cast_swish' : 'cast_shimmer']; if (c) a.clip = c; else continue; }
      if (v > 0.004) { if (Math.abs(a.volume - v) > 0.005) a.volume = v; if (!a.playing) a.play(); }
      else if (a.playing) { a.volume = 0; a.stop(); }
    }
  }

  // ================================================================ input
  // Portrait is the main (phone / TikTok) layout: logical width fixed at 270 px, height follows the screen.
  // Landscape keeps the original layout: logical height 240 on phones, 360 on desktop.
  stage!: Node; stageS = 1;
  private updateLayout() {
    const vs = view.getVisibleSize(), vw = vs.width, vh = vs.height;
    PORTRAIT = vw < vh;
    if (PORTRAIT) { W = 270; this.stageS = vw / W; H = Math.round(vh / this.stageS); }
    else { H = MOBILE ? 240 : 360; this.stageS = vh / H; W = Math.round(vw / this.stageS); }
    this.stage.angle = 0;
    this.stage.setScale(this.stageS, this.stageS, 1);
    const z0 = Math.min(W, H) / 360;          // keep sprites the same size relative to the short side
    if (z0 !== Z0) { this.cam.zoom *= z0 / Z0; Z0 = z0; }
    this.D.W = W; this.D.H = H;
  }
  // design-space touch location (origin bottom-left, y up) -> logical game pixels (origin top-left, y down)
  private uiPos(loc: { x: number, y: number }): [number, number] {
    const vh = view.getVisibleSize().height, s = this.stageS;
    return [loc.x / s, (vh - loc.y) / s];
  }
  // where the camera should sit to show the orb: 30% from the top in portrait (panels dock below), original offset otherwise
  private orbFocus(): [number, number] {
    const S = this.S;
    return PORTRAIT ? [S.orb.x, S.orb.y + 0.2 * H / this.cam.zoom] : [S.orb.x, S.orb.y + 30];
  }
  // Swipe to cast: one finger anywhere outside the UI casts at the orb (same 0.25 s cadence as holding it).
  // Presses that start on the orb / study / forest still capture those areas; two fingers pinch-zoom and pan;
  // with a mouse, right- or middle-drag pans.
  private onTouchStart(e: EventTouch) {
    const [x, y] = this.uiPos(e.getUILocation());
    this.userGesture();
    this.touches[e.getID()] = [x, y];
    this.strokeDist = 0; this.segX = 0; this.segY = 0; this.dirX = 0; this.dirY = 0;
    if (Object.keys(this.touches).length >= 2) { // second finger: stop casting, start pinch + two-finger pan
      this.lastPinch = this.pinchDist(); [this.mouse.lastX, this.mouse.lastY] = this.touchCentroid(); this.pinchStart = { d: this.lastPinch, z: this.cam.zoomTarget ?? this.cam.zoom };
      this.mouse.dragging = true; this.mouse.capture = ''; this.mouse.cast = false; this.mouse.tap = false;
      return;
    }
    this.mouse.x = x; this.mouse.y = y; this.mouse.lastX = x; this.mouse.lastY = y; this.mouse.down = true;
    this.mouse.cast = false; this.mouse.dragging = false;
    const hit = this.uiHitTest(x, y);
    if (this.navDrawer && !(hit && hit.id && String(hit.id).startsWith('nav'))) this.navDrawer = false;   // tap outside closes the drawer
    if (hit) { this.mouse.uiHit = hit; hit.onDown && hit.onDown(); return; }
    this.mouse.uiHit = null;
    if (this.mouseBtn !== 0) { this.mouse.dragging = true; return; } // desktop right / middle button: pan
    // Pointer capture: a press that starts on an area belongs to it until the finger lifts.
    const S = this.S, [wx, wy] = this.toWorld(x, y);
    let target = '', mh: GameModule | null = null;
    if (this.overOrbTouch(wx, wy)) target = 'orb';
    else if (this.overStudy(wx, wy)) target = 'study';
    else if (this.overForest(wx, wy)) target = 'forest';
    else if (this.overForestryArea(wx, wy)) { if (MOBILE) S.navigated = 'forestry'; return; }   // the portal frame just opens its panel
    else if (S.started && !S.building && this.modTap(x, y)) return;   // a module took the tap (onTap without hitUi)
    else if (S.started && !S.building && (mh = this.modAt(wx, wy))) target = 'mod:' + mh.id;
    else if (S.started && !S.building) {                          // empty world / sky: cast at the orb
      target = 'orb'; this.mouse.cast = true;
      if (S.activeArea && !S.navigated) S.navigated = S.activeArea; // keep the open panel while casting
    }
    if (S.started) this.castBurst(x, y);
    this.trailX = x; this.trailY = y;
    if (target) { this.mouse.capture = target; this.mouse.tap = true; this.mouse.tapTarget = target; this.mouse.tapAt = this.now; }
    // touch screens have no hover: a tap on an area keeps its panel open after the finger lifts (decideActiveArea
    // only hit-tests the world while a finger is down there, so a stale touch point can't swap panels later)
    if (MOBILE && target && !this.mouse.cast) S.navigated = target === 'forest' ? 'forestry' : target.startsWith('mod:') ? target.slice(4) : target;
  }
  private onTouchMove(e: EventTouch) {
    const [x, y] = this.uiPos(e.getUILocation());
    this.touches[e.getID()] = [x, y];
    if (Object.keys(this.touches).length >= 2) { // pinch zoom: one full base step per 10 px change (CameraMovement.gd)
      const d = this.pinchDist();
      const [cx, cy] = this.touchCentroid();
      // pinch zoom: continuous, proportional to finger spread, anchored between the fingers (eased in updateCamera)
      if (this.pinchStart && this.pinchStart.d > 4 && this.cam.inputEnabled && !this.S.building) { this.zoomToward(this.pinchStart.z * d / this.pinchStart.d, cx, cy); this.lastPinch = d; }
      this.panBy(cx - this.mouse.lastX, cy - this.mouse.lastY);
      this.mouse.lastX = cx; this.mouse.lastY = cy;
      return;
    }
    this.mouse.x = x; this.mouse.y = y;
    if (this.mouse.dragging) this.panBy(x - this.mouse.lastX, y - this.mouse.lastY);
    else if (this.mouse.down && this.mouse.capture === 'orb' && this.S.started) this.strokeMove(x - this.mouse.lastX, y - this.mouse.lastY);
    this.mouse.lastX = x; this.mouse.lastY = y;
  }
  // ---- fervor: how fast the casting finger really moves (distance per frame, not events per second)
  fervor = 0; fingerSpeed = 0; fervorMaxed = false; fervorFlashT = 0; castCombo = -1; comboIdle = 0;
  strokeDist = 0; segX = 0; segY = 0; dirX = 0; dirY = 0; gaugeX = 0; gaugeY = 0;
  private strokeMove(dx: number, dy: number) {
    this.strokeDist += Math.hypot(dx, dy);
    this.segX += dx; this.segY += dy;
    const sl = Math.hypot(this.segX, this.segY);
    if (sl < 10) return;
    const nx = this.segX / sl, ny = this.segY / sl;
    // a sharp turn while swiping fast re-triggers a tiny sparkle tick
    if (this.dirX * nx + this.dirY * ny < -0.3 && this.fingerSpeed > 450) {
      this.play('cast_tick', -14 + 4 * this.fervor, 0.14);
      this.spawn(this.mouse.x, this.mouse.y, 'sparkles_3', 11, 4, 0.3, { sc: 1 + this.fervor });
    }
    this.dirX = nx; this.dirY = ny; this.segX = 0; this.segY = 0;
  }
  private isCasting() {
    const m = this.mouse, S = this.S;
    return m.down && m.capture === 'orb' && !m.dragging && S.started && !S.building && Object.keys(this.touches).length < 2;
  }
  private updateFervor(dt: number) {
    const casting = this.isCasting();
    const inst = casting && dt > 0 ? Math.min(SPEED_CAP, this.strokeDist / dt) : 0;
    this.strokeDist = 0;
    this.fingerSpeed += (inst - this.fingerSpeed) * (1 - Math.exp(-dt / 0.12));
    const sp = this.fingerSpeed; let f = this.fervor;
    if (casting && sp > FERVOR_LO) f += dt * Math.min(1, Math.max(0.25, (sp - FERVOR_LO) / (FERVOR_HI - FERVOR_LO))) / FERVOR_FILL;
    else if (casting && sp > 350) f -= dt * 0.25;     // easing off: drains slowly
    else f -= dt * (casting ? 0.6 : 1.2);              // stopped / lifted: drains fast
    this.fervor = f = Math.min(1, Math.max(0, f));
    if (casting) { this.gaugeX = this.mouse.x; this.gaugeY = this.mouse.y; }
    if (f >= 1 && !this.fervorMaxed) {               // max reached: sparkle burst at the finger and the orb
      this.fervorMaxed = true; this.fervorFlashT = 1.2;
      this.play('fervor_max', -3);
      this.castBurst(this.mouse.x, this.mouse.y);
      const [ox, oy] = this.orbScreen();
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2, spd = rand(60, 110);
        this.spawn(ox, oy, '', 0, 1, rand(0.4, 0.7), { vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, drag: 4, col: FERVOR_COLS[i % 3], size: 4 });
      }
      for (let i = 0; i < 4; i++) this.spawn(ox + rand(-14, 14), oy + rand(-14, 14), 'sparkles_1', 13, 4, 0.45, { sc: 1.5 });
    }
    if (f < 0.7) this.fervorMaxed = false;
    this.fervorFlashT = Math.max(0, this.fervorFlashT - dt);
    // the rising chime melody restarts after a short pause in the swipe
    this.comboIdle = casting && sp > 150 ? 0 : this.comboIdle + dt;
    if (this.comboIdle > 0.4) this.castCombo = -1;
  }
  fervorMult() { return 1 + (FERVOR_MAX_MULT - 1) * this.fervor; }
  private panBy(dx: number, dy: number) {
    if (!this.cam.inputEnabled || this.S.building) return;
    this.cam.tween = null;
    this.cam.vx -= dx / this.cam.zoom * 10;
    this.cam.vy -= dy / this.cam.zoom * 10;
    if (Math.abs(dx) + Math.abs(dy) > 0) this.tutorialEvent('panned');
  }
  private onTouchEnd(e: EventTouch) {
    delete this.touches[e.getID()];
    if (Object.keys(this.touches).length > 0) return;
    const [x, y] = this.uiPos(e.getUILocation());
    this.mouse.x = x; this.mouse.y = y;
    if (this.mouse.uiHit && this.mouse.uiHit.onUp) {
      // touch slop: a release up to 10 px outside the pressed button still counts as a tap on it
      const r = this.mouse.uiHit, n = this.uiHitTest(x, y), slop = 10;
      const near = x >= r.x - slop && x < r.x + r.w + slop && y >= r.y - slop && y < r.y + r.h + slop;
      r.onUp((!!n && n.id === r.id) || near);
    }
    this.mouse.down = false; this.mouse.dragging = false; this.mouse.uiHit = null; this.mouse.capture = ''; this.mouse.cast = false;
    this.mouseBtn = 0;
  }
  orbSquish = 0; mouseBtn = 0;
  private pinchDist() { const p = Object.values(this.touches); return Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]); }
  private touchCentroid(): [number, number] { const p = Object.values(this.touches); return [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2]; }
  // desktop: Cocos turns every mouse button into a simulated touch; remember which one so right / middle pans
  private onMouseDown(e: EventMouse) {
    this.mouseBtn = e.getButton();
    if (this.mouseBtn !== 0 && this.mouse.down && !this.mouse.uiHit) { // touch was handled first: turn it into a pan
      this.mouse.capture = ''; this.mouse.cast = false; this.mouse.tap = false; this.mouse.dragging = true;
    }
  }
  private onMouseMove(e: EventMouse) { if (this.mouse.down) return; const [x, y] = this.uiPos(e.getUILocation()); this.mouse.x = x; this.mouse.y = y; }
  private onWheel(e: EventMouse) { if (!this.cam.inputEnabled || this.S.building || !this.S.started) return; this.zoomBy(e.getScrollY() > 0 ? 0.5 : -0.5, true); }
  private onKey(e: EventKeyboard) {
    if (!this.S.started) return;
    const S = this.S;
    if (e.keyCode === KeyCode.KEY_Z) this.keyZ = true;
    if (e.keyCode === KeyCode.EQUAL && this.cam.inputEnabled && !S.building) this.zoomBy(0.5, false);
    if (e.keyCode === KeyCode.DASH && this.cam.inputEnabled && !S.building) this.zoomBy(-0.5, false);
    if (e.keyCode === KeyCode.DIGIT_1 && S.level >= 1 && !S.building) { this.camMoveTo(S.orb.x, S.orb.y); S.navigated = 'orb'; }
    if (e.keyCode === KeyCode.DIGIT_2 && S.level >= 2 && !S.building) { const p = this.studyPos(S.level)!; this.camMoveTo(p[0], p[1]); S.navigated = 'study'; }
    if (e.keyCode === KeyCode.KEY_C) { S.showcaseCamera = !S.showcaseCamera; this.toast(S.showcaseCamera ? 'Showcase camera ON' : 'Original camera'); }
    if (e.keyCode === KeyCode.KEY_M) { this.addResource('magic', 1000); this.toast('+1000 magic (debug)'); }
  }
  private zoomBy(d: number, atMouse: boolean) {   // wheel / keys: multiplicative steps toward a target
    const base = this.cam.zoomTarget ?? this.cam.zoom;
    this.zoomToward(base * Math.pow(1.25, d * 2), atMouse ? this.mouse.x : W / 2, atMouse ? this.mouse.y : H / 2);
  }
  // smooth zoom: set a clamped target and a screen anchor that stays fixed; updateCamera eases toward it
  private zoomToward(z: number, ax: number, ay: number) {
    const lo = Math.min(Z0, this.homeZoom(this.S.level)), hi = 4 * Z0;
    this.cam.zoomTarget = Math.min(Math.max(z, lo), hi); this.cam.zoomAnchor = [ax, ay];
    this.cam.zoomTween = null;
    this.tutorialEvent('zoomed');
  }

  // ================================================================ resources
  addResource(id: string, v: number) {
    if (!(v > 0)) return 0;
    if (typeof this.S.pending[id] !== 'number') this.registerResource(id, '', '');   // undeclared module resource
    for (const m of this.mods) if (m.onGain) { try { m.onGain(id, v); } catch (e) { this.modError(m.id, 'onGain', e); } }
    this.S.pending[id] += v; this.S.resourcesVisible = true; this.S.seen[id] = true;
    return v;
  }
  private flushResources() { // Resources._process: one commit per frame
    const S = this.S;
    for (const id in S.pending) if (S.pending[id] > 0) { S.res[id] += S.pending[id]; S.earned[id] += S.pending[id]; S.pending[id] = 0; }
  }

  // ================================================================ geometry
  private towerRect(level: number) {
    if (level <= 0) return null;
    const t = TOWERS[level - 1], img = t.alt && !this.D.has(t.img) ? t.alt : t.img, grow = img === t.img ? 0 : t.grow;
    const [w, h0] = this.D.size(img), h = h0 + grow;
    return { x: TOWER_X - w / 2, y: GROUND - h, w, h, img, def: t, grow };
  }
  private orbPosFor(level: number) {
    if (level <= 0) return ORB_START.slice();
    const r = this.towerRect(level)!;
    return [r.x + r.def.orb[0], r.y + r.def.orb[1]];
  }
  private studyPos(level: number) {
    const r = this.towerRect(level);
    if (!r || !r.def.study) return null;
    return [r.x + r.def.study[0], r.y + r.def.study[1]];
  }

  // ================================================================ camera (CameraMovement.gd)
  private camBounds() {
    const cam = this.cam, hw = W / 2 / cam.zoom, hh = H / 2 / cam.zoom;
    let towerTop = this.shownTowerLevel > 0 ? this.towerRect(this.shownTowerLevel)!.y : GROUND;
    if (this.S.building && this.S.showcaseCamera) towerTop = Math.min(towerTop, this.towerRect(this.S.building.to)!.y + TOWERS[this.S.building.to - 1].orb[1] - 20);
    let left = this.trees.length ? -180 : 0, right = 900, top = towerTop - 200;   // modules reach higher through worldBounds
    for (const m of this.mods) { // modules widen the world (Dragon Nest island, Embassy...)
      if (!m.worldBounds || !this.modOn(m)) continue;
      let b: any = null; try { b = m.worldBounds(); } catch (e) { this.modError(m.id, 'worldBounds', e); }
      if (!b) continue;
      if (b.minX !== undefined) left = Math.min(left, b.minX); if (b.maxX !== undefined) right = Math.max(right, b.maxX); if (b.minY !== undefined) top = Math.min(top, b.minY);
      // worldBounds().maxY is ignored: the ground is a hard floor (panels for ground-level areas dock at the top instead)
    }
    const minX = left + hw, minY = top + hh;
    // HARD FLOOR: never show what is below the ground line (nothing is built underground). Bounds depend on the
    // tower and module world state only, never on UI rects, so they cannot jump while panels open / close.
    let maxX = right - hw; const maxY = FLOOR_Y - floorHalf() / cam.zoom;
    if (maxX < minX) maxX = minX;
    return { minX, maxX: Math.max(maxX, hw), minY: Math.min(minY, maxY), maxY };
  }
  private clampCam() {
    const b = this.camBounds();
    this.cam.x = Math.min(Math.max(this.cam.x, b.minX), b.maxX);
    this.cam.y = Math.min(Math.max(this.cam.y, b.minY), b.maxY);
  }
  private camMoveTo(x: number, y: number, dur = 0.4) {
    const b = this.camBounds();
    // rx / ry: the wanted spot, re-clamped every frame (a panel docking a frame later widens the bounds)
    this.cam.tween = { fx: this.cam.x, fy: this.cam.y, rx: x, ry: y, tx: Math.min(Math.max(x, b.minX), b.maxX), ty: Math.min(Math.max(y, b.minY), b.maxY), t: 0, dur };
  }
  private camZoomTo(z: number, dur: number) { this.cam.zoomTween = { from: this.cam.zoom, to: z, t: 0, dur }; }
  private updateCamera(dt: number) {
    const cam = this.cam;
    if (cam.zoomTarget !== undefined && cam.zoomTarget !== null) {
      if (cam.zoomTween || cam.tween) cam.zoomTarget = null;   // scripted camera moves win
      else {
        const [ax, ay] = cam.zoomAnchor || [W / 2, H / 2], before = this.toWorld(ax, ay);
        const k = 1 - Math.exp(-16 * dt);   // ~0.15 s to settle, frame-rate independent
        cam.zoom = Math.exp(Math.log(cam.zoom) + (Math.log(cam.zoomTarget) - Math.log(cam.zoom)) * k);
        if (Math.abs(cam.zoom - cam.zoomTarget) < 0.002) { cam.zoom = cam.zoomTarget; cam.zoomTarget = null; }
        const after = this.toWorld(ax, ay); cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
      }
    }
    if (cam.zoomTween) {
      const z = cam.zoomTween; z.t += dt; const k = Math.min(z.t / z.dur, 1);
      cam.zoom = z.from + (z.to - z.from) * easeInOutSine(k);
      if (k >= 1) cam.zoomTween = null;
    }
    if (cam.tween) {
      const tw = cam.tween; tw.t += dt; const k = Math.min(tw.t / tw.dur, 1), e = easeOutSine(k);
      if (tw.rx !== undefined) { const b = this.camBounds(); tw.tx = Math.min(Math.max(tw.rx, b.minX), b.maxX); tw.ty = Math.min(Math.max(tw.ry, b.minY), b.maxY); }
      cam.x = tw.fx + (tw.tx - tw.fx) * e; cam.y = tw.fy + (tw.ty - tw.fy) * e;
      if (k >= 1) cam.tween = null;
    } else {
      const w = Math.min(8 * dt, 1);
      const nvx = cam.vx * (1 - w), nvy = cam.vy * (1 - w);
      cam.x += (cam.vx + nvx) / 2 * dt; cam.y += (cam.vy + nvy) / 2 * dt;
      cam.vx = nvx; cam.vy = nvy;
      this.clampCam();
    }
    // the floor holds on every path (build / zoom tweens included): screen bottom never goes below the ground line
    cam.y = Math.min(cam.y, FLOOR_Y - floorHalf() / cam.zoom);
  }
  private toScreen(wx: number, wy: number): [number, number] { return [(wx - this.cam.x) * this.cam.zoom + W / 2, (wy - this.cam.y) * this.cam.zoom + H / 2]; }
  private toWorld(sx: number, sy: number): [number, number] { return [(sx - W / 2) / this.cam.zoom + this.cam.x, (sy - H / 2) / this.cam.zoom + this.cam.y]; }

  private overOrb(wx: number, wy: number) { return pointInPoly(wx - this.S.orb.x, wy - this.S.orb.y, ORB_POLY); }
  // fingers are ~10 mm wide: touch hit area is the orb polygon plus a 24 px (world) circle around the orb
  private overOrbTouch(wx: number, wy: number) { return this.overOrb(wx, wy) || Math.hypot(wx - this.S.orb.x, wy - this.S.orb.y) <= 24; }
  // screen-space bounding box of an area's hit polygon
  private areaScreenRect(cx: number, cy: number, poly: number[][]) {
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const [x0, y0] = this.toScreen(cx + Math.min(...xs), cy + Math.min(...ys));
    const [x1, y1] = this.toScreen(cx + Math.max(...xs), cy + Math.max(...ys));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // Like the original HUD anchors: the panel sits next to its area and never on top of it.
  // Try the preferred side first, then the others; keep the first one fully on screen.
  private placePanel(area: any, w: number, h: number, order: string[]) {
    const gap = 4, fits = (r: any) => r.x >= 2 && r.y >= 2 && r.x + w <= W - 2 && r.y + h <= H - 2;
    const cand: Record<string, any> = {
      right: { x: area.x + area.w + gap, y: area.y + area.h / 2 - h / 2 },
      left: { x: area.x - w - gap, y: area.y + area.h / 2 - h / 2 },
      above: { x: area.x + area.w / 2 - w / 2, y: area.y - h - gap },
      below: { x: area.x + area.w / 2 - w / 2, y: area.y + area.h + gap },
    };
    const clamp = (r: any) => ({ x: Math.round(Math.min(Math.max(r.x, 2), W - w - 2)), y: Math.round(Math.min(Math.max(r.y, 2), H - h - 2)) });
    if (PORTRAIT) { // portrait: dock above the bottom buttons, unless that would cover the area itself
      this.panelH[this.S.activeArea] = h;
      if (this.topDock()) return clamp({ x: (W - w) / 2, y: this.topDockY() });   // ground-level area: panel at the top
      const dock = clamp({ x: (W - w) / 2, y: H - HUD_H - h - 2 });
      const overlaps = dock.y < area.y + area.h && dock.y + h > area.y && dock.x < area.x + area.w && dock.x + w > area.x;
      if (!overlaps) return dock;
      order = ['above', 'below', 'right', 'left'];
    }
    for (const k of order) {
      const c = cand[k];
      if (k === 'right' || k === 'left') { if (c.x >= 2 && c.x + w <= W - 2) return clamp(c); }
      else if (fits(c) || (c.y >= 2 && c.y + h <= H - 2)) return clamp(c);
    }
    return clamp(cand[order[0]]);
  }
  private overStudy(wx: number, wy: number) {
    if (this.S.level < 2 || this.S.building) return false;
    const p = this.studyPos(this.shownTowerLevel); if (!p) return false;
    return pointInPoly(wx - p[0], wy - p[1], STUDY_POLY);
  }

  // ================================================================ clickable areas (0.25 s cooldown while held)
  private clickSpeedFlat() { const L = this.S.level; return L <= 1 ? 0.25 : L <= 2 ? 0.20 : L <= 3 ? 0.15 : 0.10; }
  private updateClickables(dt: number) {
    const S = this.S, mouse = this.mouse;
    this.orbCooldown = Math.max(0, this.orbCooldown - dt); this.studyCooldown = Math.max(0, this.studyCooldown - dt);
    // a quick tap stays queued (up to 0.5 s) until the 0.25 s click cooldown lets it through
    if (mouse.tap && this.now - mouse.tapAt > 0.5) mouse.tap = false;
    if (S.building || !S.started) return;
    // what is being pressed: the captured target while the finger is down, a queued quick tap,
    // or (desktop, original "area_press") holding Z over an area
    let [wx, wy] = this.toWorld(mouse.x, mouse.y);
    let target = mouse.down && mouse.capture ? mouse.capture : (mouse.tap ? mouse.tapTarget : '');
    if (!target && this.keyZ && !mouse.uiHit) target = this.overOrb(wx, wy) ? 'orb' : this.overStudy(wx, wy) ? 'study' : '';
    if (!target) return;
    if (target.startsWith('mod:')) { // a module's world area (GameModule.hitWorld): onHold every frame, click fx at the orb cadence
      const m = this.host.modules[target.slice(4)] as GameModule;
      if (m && m.onHold) { try { m.onHold(dt, wx, wy); } catch (e) { this.modError(m.id, 'onHold', e); } }
      this.modCooldown = Math.max(0, this.modCooldown - dt);
      if (this.modCooldown === 0) { this.modCooldown = 0.25; mouse.tap = false; this.addEffect(wx, wy, 'click'); this.castTimer = 0.3; this.playClick(-7); }
      return;
    }
    // effects follow the finger while it is on the orb; from anywhere else magic motes fly to the orb
    const remote = target === 'orb' && !this.overOrbTouch(wx, wy);
    if (remote) { wx = S.orb.x + rand(-8, 8); wy = S.orb.y + rand(-8, 8); }
    if (target === 'study' && !this.overStudy(wx, wy)) { const p = this.studyPos(this.shownTowerLevel); if (p) { wx = p[0] + rand(-6, 6); wy = p[1] + rand(-10, 10); } }
    if (target === 'orb' && this.orbPickable && this.orbCooldown === 0) {
      if (MOBILE && mouse.down) this.haptic();
      this.orbCooldown = 0.25; mouse.tap = false;
      this.castTimer = 0.3;
      if (mouse.down && mouse.capture === 'orb' && this.fingerSpeed > 150) {
        this.castCombo++;
        const i = this.castCombo < CAST_NOTES.length ? this.castCombo : CAST_TOP[(this.castCombo - CAST_NOTES.length) % CAST_TOP.length];
        this.play(CAST_NOTES[i], -11 + 3 * this.fervor);
      } else this.playClick(-6);
      const v = this.addResource('magic', 1 * (1 + S.skills.wizard_magic * 100 / 100) * this.fervorMult() * this.mult('magic'));
      if (remote) this.launchMotes(mouse.x, mouse.y, fmt(v, true)); // credited now, shown when the motes land
      else {
        this.addEffect(wx, wy, 'click');
        this.indicators.push({ x: wx, y: wy, text: fmt(v, true), icon: 'magic_icon', t: 0, time: 0.7, dy: -16 });
      }
      for (const m of this.mods) if (m.onOrbClick) { try { m.onOrbClick(mouse.x, mouse.y, this.fervor); } catch (e) { this.modError(m.id, 'onOrbClick', e); } }
      S.speedMult = 1 + 35 / 100 + this.clickSpeedFlat(); S.speedTimer = 0.4;
      this.tutorialEvent('orbClicked');
    } else if (target === 'forest' && this.forestCooldown === 0) {
      this.forestCooldown = 0.25; mouse.tap = false;
      this.addEffect(wx, wy, 'click'); this.castTimer = 0.3; this.playClick(-7);
      this.forestSpeedMult = 1 + 35 / 100 + this.clickSpeedFlat(); this.forestSpeedTimer = 0.4;
    } else if (target === 'study' && S.level >= 2 && this.studyCooldown === 0) {
      this.studyCooldown = 0.25; mouse.tap = false;
      this.addEffect(wx, wy, 'click'); this.castTimer = 0.3; this.playClick(-7);
      S.studySpeedMult = 1 + 35 / 100 + this.clickSpeedFlat() + 0.15; S.studySpeedTimer = 0.4;
    }
  }
  // light haptic tick per orb click: tt.vibrateShort in the TikTok/Douyin runtime, navigator.vibrate on Android web (iOS Safari has none)
  private haptic() {
    try {
      const g: any = globalThis as any;
      if (g.tt && g.tt.vibrateShort) g.tt.vibrateShort({ type: 'light' });
      else if (typeof navigator !== 'undefined' && (navigator as any).vibrate) (navigator as any).vibrate(8);
    } catch (e) { /* haptics are optional */ }
  }
  private addEffect(x: number, y: number, type: string) {
    const f = FX[type]; if (!f) return;
    this.effects.push({ x, y, type, t: 0, life: f.life !== undefined ? f.life : f.frames / f.fps });
  }

  // ================================================================ cast particles (screen space, on top of the world)
  // A wand-tip glow and sparkle trail follow the finger; each orb click from afar launches magic motes that
  // curve into the orb and pop the usual click effect + number when they land.
  parts: any[] = []; motes: any[] = []; trailX = 0; trailY = 0; twinkleT = 0;
  private get PS() { return 3; }   // sprite pixel size in logical px (chunkier than the world so it reads on a phone)
  private spawn(x: number, y: number, img: string, fw: number, frames: number, life: number, o: any = {}) {
    if (this.parts.length >= 150) this.parts.shift();
    this.parts.push({ x, y, img, fw, frames, life, t: 0, vx: o.vx || 0, vy: o.vy || 0, grav: o.grav || 0, drag: o.drag || 0,
      frame: o.frame !== undefined ? o.frame : -1, a: o.a !== undefined ? o.a : 1, sc: o.sc || 1, col: o.col || '', size: o.size || 2 });
  }
  private trailDot(x: number, y: number, life: number, spread = 1) {
    const f = this.fervor;
    if (f > 0.05 && Math.random() < 0.15 + 0.7 * f) { // fervor: chunky mint -> pink -> gold pixels
      this.spawn(x, y, '', 0, 1, life * (1 + 0.6 * f), { vx: rand(-18, 18) * spread, vy: rand(-26, 8) * spread, drag: 3,
        col: fervorCol(Math.min(1, f * rand(0.75, 1.2))), size: Math.round(rand(2, 3 + 3 * f)) });
      return;
    }
    const r = Math.random();
    if (r < 0.62) this.spawn(x, y, 'cloudling_ball', 3, 1, life, { vx: rand(-14, 14) * spread, vy: rand(-22, 6) * spread, drag: 3 });
    else if (r < 0.8) this.spawn(x, y, 'bright_spirit', 3, 1, life, { vx: rand(-14, 14) * spread, vy: rand(-22, 6) * spread, drag: 3 });
    else this.spawn(x, y, Math.random() < 0.5 ? 'sparkles_0' : 'sparkles_2', 11, 4, life, { frame: Math.random() < 0.5 ? 0 : 3, vx: rand(-8, 8), vy: rand(-14, 0), drag: 3 });
  }
  private castBurst(x: number, y: number) {
    this.spawn(x, y, 'click_particles', 9, 3, 0.3, { sc: 2 });
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + rand(-0.2, 0.2), sp = rand(70, 110);
      this.spawn(x, y, i % 2 ? 'cloudling_ball' : 'bright_spirit', 3, 1, rand(0.25, 0.35), { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 6 });
    }
  }
  private launchMotes(x: number, y: number, text: string) {
    if (this.motes.length > 40) this.motes.splice(0, this.motes.length - 40);
    const f = this.fervor, count = 3 + Math.round(3 * f);   // fervor: more and bigger motes
    for (let i = 0; i < count; i++) this.motes.push({ sx: x, sy: y, t: 0, dur: i === 0 ? rand(0.38, 0.45) : rand(0.3, 0.5),
      bend: (i === 0 ? rand(0.25, 0.4) : rand(-0.6, 0.6)) * (Math.random() < 0.5 ? -1 : 1), main: i === 0, text,
      img: i === 0 ? '' : i % 2 ? 'cloudling_ball' : 'bright_spirit', sc: 1 + 0.7 * f, col: i >= 3 ? FERVOR_COLS[i % 3] : '' });
    this.spawn(x, y, 'sparkles_2', 11, 4, 0.3);
  }
  private orbScreen(): [number, number] { const S = this.S; return this.toScreen(S.orb.x, S.orb.y + 2 * Math.sin(S.orb.phase)); }
  private motePos(m: any): [number, number] {
    const [tx, ty] = this.orbScreen(), k = Math.min(m.t / m.dur, 1), e = k * k * (3 - 2 * k) * 0.35 + k * k * 0.65;
    const dx = tx - m.sx, dy = ty - m.sy, cx = m.sx + dx / 2 - dy * m.bend, cy = m.sy + dy / 2 + dx * m.bend;   // bent quadratic
    const u = 1 - e;
    return [u * u * m.sx + 2 * u * e * cx + e * e * tx, u * u * m.sy + 2 * u * e * cy + e * e * ty];
  }
  private updateCastFx(dt: number) {
    const S = this.S, m = this.mouse;
    if (m.down && m.capture && !m.dragging && S.started) {
      const dx = m.x - this.trailX, dy = m.y - this.trailY, d = Math.hypot(dx, dy);
      const f = this.fervor, n = Math.min(8 + Math.round(8 * f), Math.floor(d / (4 - 2 * f)));
      for (let i = 1; i <= n; i++) this.trailDot(this.trailX + dx * i / n + rand(-2, 2), this.trailY + dy * i / n + rand(-2, 2), rand(0.25, 0.5));
      if (n > 0) { this.trailX = m.x; this.trailY = m.y; }
      this.twinkleT += dt;
      if (this.twinkleT >= (d < 2 ? 0.08 : 0.16)) { // idle twinkle around a resting fingertip
        this.twinkleT = 0;
        const imgs = ['sparkles_0', 'sparkles_2', 'sparkles_3'];
        this.spawn(m.x + rand(-9, 9), m.y + rand(-9, 9), imgs[Math.floor(Math.random() * 3)], 11, 4, 0.35, { vy: -10 });
      }
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.t += dt;
      if (p.t >= p.life) { this.parts.splice(i, 1); continue; }
      const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy = p.vy * k + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const mo = this.motes[i]; mo.t += dt;
      const [x, y] = this.motePos(mo);
      if (mo.main && Math.random() < 0.7) this.spawn(x + rand(-1, 1), y + rand(-1, 1), Math.random() < 0.7 ? 'cloudling_ball' : 'bright_spirit', 3, 1, rand(0.15, 0.25));
      if (mo.t < mo.dur) continue;
      this.motes.splice(i, 1);
      if (!mo.main) continue;
      this.play('mote_arrive', -15, 0.3);
      const wx = S.orb.x + rand(-6, 6), wy = S.orb.y + rand(-6, 6);
      this.addEffect(wx, wy, 'click');
      this.indicators.push({ x: wx, y: wy, text: mo.text, icon: 'magic_icon', t: 0, time: 0.7, dy: -16 });
      for (let j = 0; j < 4; j++) { const a = rand(0, Math.PI * 2); this.spawn(x, y, 'cloudling_ball', 3, 1, 0.25, { vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, drag: 6 }); }
    }
  }
  private drawCastFx() {
    const D = this.D, m = this.mouse, ps = this.PS;
    const sprite = (img: string, fw: number, fr: number, x: number, y: number, a: number, s = 1) => {
      const [, ih] = D.size(img), w = fw * ps * s, h = ih * ps * s;
      D.part(img, fr * fw, 0, fw, ih, Math.round(x - w / 2), Math.round(y - h / 2), w, h, { alpha: a });
    };
    this.drawOrbGlow();
    for (const p of this.parts) {
      const k = p.t / p.life;
      if (p.col) { const s = Math.max(1, Math.round(p.size * (1 - 0.5 * k))); D.rect(p.col, Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s, p.a * (1 - k * k)); continue; }
      const fr = p.frame >= 0 ? p.frame : Math.min(p.frames - 1, Math.floor(k * p.frames));
      sprite(p.img, p.fw, fr, p.x, p.y, p.a * (1 - k * k), p.sc);
    }
    for (const mo of this.motes) {
      const [x, y] = this.motePos(mo);
      if (mo.main) sprite('sparkles_2', 11, 1 + (Math.floor(mo.t * 20) % 2), x, y, 1, mo.sc || 1);
      else if (mo.col) { const s = Math.round(3 * (mo.sc || 1)); D.rect(mo.col, Math.round(x - s / 2), Math.round(y - s / 2), s, s); }
      else sprite(mo.img, 3, 0, x, y, 1, mo.sc || 1);
    }
    const f = this.fervor;
    if (m.down && m.capture && !m.dragging && this.S.started) { // wand tip: a mint halo and a pulsing white star under the finger
      sprite('click_particles', 9, 1, m.x, m.y, 0.65 + 0.2 * Math.sin(this.now * 12), 1.4 + 0.8 * f);
      sprite('sparkles_0', 11, 1 + (Math.floor(this.now * 10) % 2), m.x, m.y, 1, 1.2 + 0.6 * f);
    }
    this.drawFervorGauge();
  }
  // small gauge + "x1.6" multiplier floating above the finger while fervor is up
  private drawFervorGauge() {
    const D = this.D, f = this.fervor;
    if (f < 0.02 || !this.S.started) return;
    const gx = Math.round(Math.min(Math.max(this.gaugeX, 24), W - 24)), gy = Math.round(Math.max(this.gaugeY - 34, 30));
    const col = fervorCol(f), full = f >= 0.999, pulse = full ? 0.5 + 0.5 * Math.sin(this.now * 14) : 0;
    D.rect(COL.dark, gx - 18, gy, 36, 7, 0.85);
    D.rect(full ? lerpCol(col, '#ffffff', 0.4 * pulse) : col, gx - 17, gy + 1, Math.max(1, Math.round(34 * f)), 5);
    const label = 'x' + this.fervorMult().toFixed(1);
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) D.text(label, gx + ox, gy - 14 + oy, COL.dark, 12, 'center');   // outlined
    D.text(label, gx, gy - 14, full ? lerpCol('#ffd166', '#ffffff', pulse) : col, 12, 'center');
    if (this.fervorFlashT > 0) { // "FERVOR!" pops up once when the meter maxes out
      const k = 1 - this.fervorFlashT / 1.2, y = gy - 30 - 10 * easeOutExpo(k), a = Math.min(1, this.fervorFlashT * 3);
      if (a > 0.1) { D.text('FERVOR!', gx + 1, y + 1, COL.dark, 12, 'center'); D.text('FERVOR!', gx, y, lerpCol('#ff8fb1', '#ffd166', 0.5 + 0.5 * Math.sin(this.now * 20)), 12, 'center'); }
    }
  }
  // the orb glows, pulses and gets a ring of orbiting coloured pixels as fervor builds
  private drawOrbGlow() {
    const f = this.fervor; if (f < 0.4 || !this.S.started) return;
    const D = this.D, k = (f - 0.4) / 0.6, [ox, oy] = this.orbScreen(), z = this.cam.zoom, full = f >= 0.999;
    const pulse = 0.5 + 0.5 * Math.sin(this.now * (full ? 12 : 6));
    const s = 28 * z * (1.25 + 0.2 * pulse) / (9 * this.PS);
    const [, ih] = D.size('click_particles'), w = 9 * this.PS * s, h = ih * this.PS * s;
    D.part('click_particles', 9, 0, 9, ih, Math.round(ox - w / 2), Math.round(oy - h / 2), w, h, { alpha: k * (0.25 + 0.3 * pulse) });
    const n = full ? 14 : 8, r = 20 * z + 3 * pulse;
    for (let i = 0; i < n; i++) {
      const a = this.now * 2.2 + i / n * Math.PI * 2, px = Math.round(ox + Math.cos(a) * r), py = Math.round(oy + Math.sin(a) * r * 0.9), sz = full ? 3 : 2;
      D.rect(FERVOR_COLS[i % 3], px - 1, py - 1, sz, sz, k);
    }
    if (full && Math.random() < 0.25) this.spawn(ox + rand(-16, 16) * z, oy + rand(-16, 16) * z, 'sparkles_2', 11, 4, 0.35, { vy: -12 });
  }

  // ================================================================ spirits & cloudlings (SpiritAnimation.gd)
  private ringPos(i: number, perRing: number, base: number) {
    const ring = Math.floor(i / (perRing + 0.1 * i)), pos = i % perRing;
    return { r: (ring + 1) * 12 + base, a: 2 * Math.PI * pos / perRing };
  }
  private updateOrbitals(dt: number) {
    const S = this.S;
    S.speedTimer = Math.max(0, S.speedTimer - dt); if (S.speedTimer <= 0) S.speedMult = 1;
    const targetSpirits = Math.max(0, Math.floor(S.res.spirits)), targetClouds = S.skills.summon_cloudling;
    while (this.spirits.length < targetSpirits) { const p = this.ringPos(this.spirits.length, 16, 12); this.spirits.push({ ...p, speed: rand(10, 20) * p.r * 0.05, dir: Math.random() > 0.5 ? 1 : -1 }); }
    this.spirits.length = Math.min(this.spirits.length, targetSpirits);
    while (this.cloudlings.length < targetClouds) {
      const p = this.ringPos(this.cloudlings.length, 8, 12 * 1.33);
      this.cloudlings.push({ ...p, speed: rand(10, 20) * p.r * 0.05, dir: Math.random() > 0.5 ? 1 : -1 });
      this.addEffect(S.orb.x + p.r * Math.cos(p.a), S.orb.y + p.r * Math.sin(p.a), 'spirit_spawn');
    }
    this.cloudlings.length = Math.min(this.cloudlings.length, targetClouds);
    const bd = dt * S.speedMult;
    for (const s of this.spirits) s.a += s.speed * bd / s.r * s.dir;
    for (const c of this.cloudlings) c.a += c.speed * bd / c.r * c.dir;
    if (this.cloudlings.length) { // each cloudling throws one ball every 4 s, spread evenly
      const prev = this.cloudSpawnTimer; this.cloudSpawnTimer = (this.cloudSpawnTimer + bd / 4) % 1;
      const size = this.cloudlings.length + 1;
      const a = Math.floor(prev * size); let b = Math.floor(this.cloudSpawnTimer * size);
      if (this.cloudSpawnTimer < prev) b += size;
      for (let i = a; i < b; i++) { const c = this.cloudlings[i % size]; if (c) this.balls.push({ x: c.r * Math.cos(c.a), y: c.r * Math.sin(c.a), vx: -Math.sin(c.a) * c.speed * c.dir, vy: Math.cos(c.a) * c.speed * c.dir }); }
    }
    const decay = Math.pow(0.2, dt); let shown = 0;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i], len = Math.hypot(b.x, b.y) || 1;
      b.vx += -b.x / len * 150 * dt; b.vy += -b.y / len * 150 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (Math.hypot(b.x, b.y) <= 10) {
        this.balls.splice(i, 1);
        this.play('spirit_ball', -9, 0.06);
        const v = this.addResource('magic', this.cloudlingMagic());
        if (shown++ === 0) this.indicators.push({ x: S.orb.x + b.x, y: S.orb.y + b.y, text: fmt(v, true), icon: 'magic_icon', t: 0, time: 0.4, dy: -16 });
      } else { b.vx *= decay; b.vy *= decay; }
    }
  }

  // ================================================================ study (Study.gd)
  private updateStudy(dt: number) {
    const S = this.S;
    S.studySpeedTimer = Math.max(0, S.studySpeedTimer - dt); if (S.studySpeedTimer <= 0) S.studySpeedMult = 1;
    while (this.books.length < S.skills.summon_spirit_tome) this.books.push({ k: Math.floor(Math.random() * 6), p: 0 });
    if (S.level <= 1 || S.building) return;
    this.books.forEach((b, i) => {
      b.p += dt * S.studySpeedMult;
      if (b.p >= 10) {
        b.p = 0;
        const v = this.addResource('knowledge', this.knowledgeReward());
        if (S.activeArea === 'study') this.play('book', -10, 0.15);
        if (this.studyUiRect && S.activeArea === 'study') {
          const bx = this.studyUiRect.x + 4 + (i % 30) * 9, by = this.studyUiRect.y + 4 + Math.floor(i / 30) * 21;
          this.uiIndicators.push({ x: bx, y: by + rand(-16, 0), text: fmt(v, true), icon: 'knowledge_icon', t: 0, time: 0.4, dy: -16 });
        }
      }
    });
    const decay = Math.pow(0.2, dt); // Library Spirits fly from the study to the orb
    for (let i = this.flyingSpirits.length - 1; i >= 0; i--) {
      const f = this.flyingSpirits[i], dx = S.orb.x - f.x, dy = S.orb.y - f.y, d = Math.hypot(dx, dy) || 1;
      f.vx += dx / d * 200 * dt; f.vy += dy / d * 200 * dt;
      const sp = Math.hypot(f.vx, f.vy); if (sp > 100) { f.vx *= 100 / sp; f.vy *= 100 / sp; }
      f.vx *= decay; f.vy *= decay; f.x += f.vx * dt; f.y += f.vy * dt;
      if (Math.hypot(S.orb.x - f.x, S.orb.y - f.y) <= 12) { this.flyingSpirits.splice(i, 1); this.addResource('spirits', 1); }
    }
  }

  // ================================================================ forestry (Forest.gd, Totems.gd)
  // The forest island floats left of the tower, 177 px below the forestry portal; trees stand in a row
  // from TreesStart (island + 69, -26) leftwards every 15 px; druids drift above them and every 4 s
  // (spread over all druids) one log is launched in a ballistic arc into the portal.
  trees: { x: number, tier: number }[] = []; druids: any[] = []; logs: any[] = [];
  forestCastTimer = 0; forestSpeedMult = 1; forestSpeedTimer = 0; forestCooldown = 0; druidFloat = 0;
  totemPole: string[] = [];
  private portalPos(level = this.shownTowerLevel): number[] | null {
    const r = this.towerRect(level); if (!r || !r.def.node) return null;
    if (r.def.anchors && r.def.anchors.portal) return [r.x + r.def.anchors.portal[0], r.y + r.def.anchors.portal[1]];
    return [r.x + r.def.node[0] + 8, r.y + r.def.node[1] + 152 + (level === 4 ? 1 : 0)];   // forestry_portal.tscn root (8,152)/(8,153)
  }
  private forestryAreaPos(level = this.shownTowerLevel): number[] | null {
    const r = this.towerRect(level); if (!r || !r.def.node) return null;
    if (r.def.anchors && r.def.anchors.forestry) return [r.x + r.def.anchors.forestry[0], r.y + r.def.anchors.forestry[1]];
    return [r.x + r.def.node[0] + 8, r.y + r.def.node[1] + 163 + (level === 4 ? 1 : 0)];
  }
  private islandPos(): number[] {
    const p = this.portalPos(); return [142, p ? p[1] + 177 : 348];
  }
  private treeBase() { const [ix, iy] = this.islandPos(); return [ix + 69, iy - 26]; }
  private woodPerLog() { // Forest.get_wood_gain_multiplier (early-game terms)
    const S = this.S;
    return 4 * (1 + S.skills.bigger_forest * 50 / 100) * (1 + S.skills.bigger_forest_2 * 50 / 100) * (1 + this.totemCount('wood_totem') * 1.0) * this.mult('wood') * this.mult('summon_druid');
  }
  totemCount(kind: string) { return this.totemPole.filter(t => t === kind).length; }
  // the pole stands on the ground at x 229, left of the tower once the tower grows over that spot
  totemX() { const r = this.towerRect(this.shownTowerLevel); return r ? Math.min(229, Math.round(r.x) - 8) : 229; }
  private overForest(wx: number, wy: number) { // TreeFarmArea: 144x99 rect centred at island + (1, -42.5)
    if (this.S.level < 3 || this.S.building || !this.trees.length) return false;
    const [ix, iy] = this.islandPos();
    return Math.abs(wx - (ix + 1)) <= 72 && Math.abs(wy - (iy - 42.5)) <= 49.5;
  }
  private overForestryArea(wx: number, wy: number) {
    if (this.S.level < 3 || this.S.building) return false;
    const p = this.forestryAreaPos(); if (!p) return false;
    return pointInPoly(wx - p[0], wy - p[1], [[16, -35], [16, 19], [-18, 19], [-18, -23]]);
  }
  private updateForest(dt: number) {
    const S = this.S;
    this.forestSpeedTimer = Math.max(0, this.forestSpeedTimer - dt); if (this.forestSpeedTimer <= 0) this.forestSpeedMult = 1;
    this.forestCooldown = Math.max(0, this.forestCooldown - dt);
    const druidsWanted = S.skills.summon_druid;
    if (!druidsWanted) return;
    // trees: one per druid (max 10) + one per Bigger Forest level; 10 / 20 trees upgrade to taller tiers
    const target = Math.min(30, S.skills.bigger_forest + S.skills.bigger_forest_2 + Math.min(10, druidsWanted));
    const [tx0, ty0] = this.treeBase();
    while (this.trees.length < Math.min(10, target)) { this.trees.push({ x: tx0 - this.trees.length * 15, tier: 1 }); this.addEffect(tx0 - (this.trees.length - 1) * 15, ty0 - 10, 'poof'); }
    for (let i = 0; i < this.trees.length; i++) this.trees[i].tier = target > 20 + i ? 3 : target > 10 + i ? 2 : 1;
    while (this.druids.length < druidsWanted) {
      const t = this.trees[Math.floor(Math.random() * this.trees.length)];
      this.druids.push({ x: t.x, y: ty0 - 10, dir: Math.random() < 0.5 ? -1 : 1, speed: rand(15, 25), cast: 0 });
    }
    const m = this.forestSpeedMult;
    this.druidFloat += dt * m;
    const treeStart = this.trees[0].x, treeEnd = this.trees[this.trees.length - 1].x, [, iy] = this.islandPos();
    this.druids.forEach((d, i) => {
      d.cast = Math.max(0, d.cast - dt * m);
      if (d.cast <= 0) {
        d.x += d.dir * d.speed * m * dt;
        if (d.x > treeStart + 10) d.dir = -1; else if (d.x < treeEnd - 10) d.dir = 1;
      }
      const targetY = iy - 20 - 35 - 15 * (1 + Math.floor(i / 15));
      d.y = d.y > targetY ? Math.max(targetY, d.y - 50 * dt) : targetY;
    });
    if (S.building) return; // no logs while the tower is rebuilt (disable_wood)
    const portal = this.portalPos(); if (!portal) return;
    const prev = this.forestCastTimer; this.forestCastTimer = (this.forestCastTimer + dt * m / 4) % 1;
    const size = this.druids.length + 1;
    const a = Math.floor(prev * size); let b = Math.floor(this.forestCastTimer * size); if (this.forestCastTimer < prev) b += size;
    for (let k = a; k < b; k++) {
      const d = this.druids[k % size]; if (!d) continue;
      d.cast = 0.25;
      const t = this.trees[Math.floor(Math.random() * this.trees.length)];
      const th = this.D.size('tree_' + t.tier)[1];
      const start = [t.x + rand(-3, 3), ty0 - th / 2];
      let sp = 0, ang: number | null = null;
      while (ang === null) { ang = this.calcAngle(start, portal, sp); if (ang === null) sp += 35; }
      this.logs.push({ x: start[0], y: start[1], vx: Math.cos(ang) * sp, vy: -Math.sin(ang) * sp });
    }
    let shown = 0;
    for (let i = this.logs.length - 1; i >= 0; i--) {
      const l = this.logs[i];
      if (l.x >= portal[0]) {
        this.logs.splice(i, 1);
        this.play('wood', -10, 0.06);
        const v = this.addResource('wood', this.woodPerLog());
        if (shown++ === 0) this.indicators.push({ x: portal[0] + rand(-5, 5), y: portal[1] + rand(-5, 5), text: fmt(v, true), icon: 'wood_icon', t: 0, time: 0.4, dy: -16 });
        continue;
      }
      const ny = l.vy + GRAVITY * dt;
      l.x = Math.min(l.x + l.vx * dt, portal[0]); l.y += (l.vy + ny) * dt / 2; l.vy = ny;
    }
  }
  private drawForest() {
    const D = this.D, S = this.S;
    if (S.level < 3 && !(S.building && S.building.to >= 3 && S.building.t >= S.building.swapAt)) return;
    const [ix, iy] = this.islandPos(), [, ty0] = this.treeBase();
    if (this.shownTowerLevel >= 3) {
      const [iw, ih] = D.size('forest_island');
      D.img('forest_island', Math.round(ix - iw / 2), Math.round(iy - ih / 2));
      for (let i = 0; i < this.trees.length - 1; i++) { // softer trees in the gaps
        const t = this.trees[i], [bw, bh] = D.size('tree_' + t.tier + '_background');
        D.img('tree_' + t.tier + '_background', Math.round(t.x - 7.5 - bw / 2), Math.round(ty0 - bh));
      }
      for (const t of this.trees) { const [tw, th] = D.size('tree_' + t.tier); D.img('tree_' + t.tier, Math.round(t.x - tw / 2), Math.round(ty0 - th)); }
      for (const l of this.logs) D.img('wood', Math.round(l.x - 1.5), Math.round(l.y - 3));
      this.druids.forEach((d, i) => {
        const fy = 4 * Math.sin(this.druidFloat + i);
        D.img(d.cast > 0 ? 'druid_cast' : 'druid', Math.round(d.x - 4), Math.round(d.y - 4.5 - fy), { flipX: d.dir < 0 });
      });
      // portal + its frame on the tower
      const p = this.portalPos(), fa = this.forestryAreaPos();
      if (p) {
        const fr = Math.floor(S.time * 12) % 8;   // swirl first, the frame is drawn over it
        D.part('portal', fr * 9, 0, 9, 27, Math.round(p[0] - 4.5), Math.round(p[1] - 13.5), 9, 27);
        D.img('forestry_area', Math.round(p[0] + 1 - 17), Math.round(p[1] + 7 - 21));
        if (fa && S.activeArea === 'forestry') D.img('forestry_area_outline', Math.round(fa[0] + 2 - 18.5), Math.round(fa[1] - 4 - 22));
      }
      // totem pole on the ground at (229, 322), stacked upwards
      let y = 322;
      for (const kind of this.totemPole) { const [w, h] = D.size(kind); y -= h; D.img(kind, Math.round(this.totemX() - w / 2), y); }
    }
  }
  private drawForestryUI() {
    const D = this.D, S = this.S, fa = this.forestryAreaPos(); if (!fa) return;
    const listW = 200, showTotems = S.skills.craft_totem > 0;
    const h1 = this.skillListHeight('forestry'), h2 = showTotems ? this.skillListHeight('totems') : 0;
    const totalH = h1 + (showTotems ? h2 + 2 : 0);
    const area = this.areaScreenRect(fa[0], fa[1], [[16, -35], [16, 19], [-18, 19], [-18, -23]]);
    const { x, y } = this.placePanel(area, listW, totalH, ['right', 'left', 'above', 'below']);
    this.forestryUiRect = { x, y, w: listW, h: totalH };
    this.drawSkillList('forestry', 'Forestry', x, y, listW);
    if (showTotems) this.drawSkillList('totems', 'Totems', x, y + h1 + 2, listW);
  }
  forestryUiRect: any = null;

  // ================================================================ wizards (Wizard.gd / OrbWizard.gd)
  private wizardPositions() {
    const S = this.S, list: any[] = [];
    if (S.level === 0 || (S.building && S.building.from === 0 && S.building.t < S.building.swapAt)) list.push({ id: 'initial', x: 280, y: 317, float: false });
    else list.push({ id: 'orb', x: S.orb.x - 23, y: S.orb.y, float: true });
    const r = this.towerRect(this.shownTowerLevel);
    if (r && r.def.wizard) list.push({ id: 'study', x: r.x + r.def.wizard[0], y: r.y + r.def.wizard[1], float: false });
    if (r && r.def.forestWizard) list.push({ id: 'forestry', x: r.x + r.def.node[0] + r.def.forestWizard[0], y: r.y + r.def.node[1] + r.def.forestWizard[1], float: false });
    // module areas with a wizard spot on the tower (anchors prestigeWizard, alchemyWizard, sorceryWizard, ...)
    if (r && r.def.anchors) for (const k in r.def.anchors) if (k.endsWith('Wizard')) { const a = r.def.anchors[k]; list.push({ id: k.slice(0, -6), x: r.x + a[0], y: r.y + a[1], float: false }); }
    return list;
  }
  private switchWizard(id: string) {
    const S = this.S;
    if (id === S.wizardArea || S.wizardArea === 'initial') return;
    const list = this.wizardPositions(), from = list.find(w => w.id === S.wizardArea), to = list.find(w => w.id === id);
    if (!to) return;
    if (from) this.addEffect(from.x, from.y, 'poof');
    this.addEffect(to.x, to.y, 'poof'); this.play('wizard_teleport', -6);
    S.wizardArea = id;
  }

  // ================================================================ tower build (BuildTowerUI._build_tower + TowerAnimation.upgrade_tower)
  private canAffordTower() {
    const c = TOWER_COSTS[this.S.level]; if (!c || this.towerBlock(this.S.level + 1)) return false;
    return Object.keys(c).every(k => (this.S.earned[k] || 0) >= c[k]);
  }
  // first module whose towerButton(currentLevel) returns an override for the build button
  private towerButtonOverride(): { label: string, cost?: Record<string, number>, disabled?: boolean, onPress?: () => void, reason?: string } | null {
    for (const m of this.mods) {
      if (!m.towerButton || !this.modOn(m)) continue;
      try { const o = m.towerButton(this.S.level); if (o) return o; } catch (e) { this.modError(m.id, 'towerButton', e); }
    }
    return null;
  }
  // why ascending to `level` is blocked right now (module TowerDef.gate), or null
  towerBlock(level: number): string | null {
    // module gates: GameModule.towers[].gate, or a towerGate(level) method (siege: walls before 8 / 9 / 10)
    for (const m of this.mods) {
      const tg = (m as any).towerGate; if (typeof tg !== 'function' || !this.modOn(m)) continue;
      try { const r = tg.call(m, level); if (r) return r; } catch (e) { this.modError(m.id, 'towerGate', e); }
    }
    const g = TOWER_GATES[level]; if (!g) return null;
    try { return g(this.host); } catch (e) { this.modError('tower' + level, 'gate', e); return null; }
  }
  private calcAngle(o: number[], t: number[], v: number): number | null { // Utils.calculate_angle, angles[0]
    const oy = -o[1], ty = -t[1];
    let dx = t[0] - o[0]; const dy = ty - oy;
    if (Math.abs(dx) < 1e-5) { if (v < Math.sqrt(2 * GRAVITY * Math.abs(dy))) return null; return dy > 0 ? Math.PI / 2 : 3 * Math.PI / 2; }
    const left = dx < 0; dx = Math.abs(dx);
    const v2 = v * v, gd = GRAVITY * dx, disc = v2 * v2 - GRAVITY * (gd * dx + 2 * dy * v2);
    if (disc < 0) return null;
    let a = Math.atan((v2 + Math.sqrt(disc)) / gd); if (a < 0) a += 2 * Math.PI;
    return left ? Math.PI - a : a;
  }
  // camera zoom to rest at after reaching a tower level: 15% further out per level, but never so far
  // that the tower stops filling the view (it must still fit with the orb and some headroom)
  private homeZoom(level: number) {
    const top = this.orbPosFor(level)[1] - 34, span = GROUND + 8 - top;
    const usable = H - HUD_H - (PORTRAIT ? 56 : 16);
    const r = this.towerRect(level), left = level >= 3 ? 63 : (r ? r.x : 300), right = r ? r.x + r.w : 340;
    const fit = Math.min(usable / span, W / (right - left + 50));
    return Math.max(0.2, Math.min(2 * Z0 * Math.pow(0.85, level), fit));   // towers 7+ are ~1000 px tall
  }
  private buildTower() {
    const S = this.S, cam = this.cam;
    if (S.building || !this.canAffordTower() || S.level >= TOWERS.length) return;
    const from = S.level, to = S.level + 1;
    S.level = to;
    const r = this.towerRect(to)!;
    const rw = r.w + 16, rh = r.h, area = rw * rh;
    const bi = area <= 10000 ? 1 : area <= 30000 ? 2 : 3;
    // the tall towers (5+) would need thousands of blocks: scale the blocks up so the fountain stays ~500 sprites
    const [bw0, bh0] = this.D.size('block_' + bi), k0 = Math.ceil(rw / bw0) * Math.ceil(rh / (bh0 - 2));
    const bs = Math.max(1, Math.ceil(Math.sqrt(k0 / 500))), bw = bw0 * bs, bh = bh0 * bs, sy = bh - 2 * bs;
    const xc = Math.ceil(rw / bw), yc = Math.ceil(rh / sy), N = xc * yc;
    const blocks: any[] = [];
    for (let y = 0; y < yc; y++) for (let x = 0; x < xc; x++) {
      const idx = blocks.length;
      blocks.push({ tx: r.x - 16 + x * bw, ty: r.y - sy - 2 + rh - y * sy, spawnAt: (idx + 1) * SPAWN_DURATION / N,
        life: SPAWN_DURATION + TOWER_DELAY + 0.7 * idx / N, spawned: false, done: false, x: 0, y: 0, vx: 0, vy: 0 });
    }
    const orbTo = this.orbPosFor(to);
    const nPart = Math.floor(r.h / 8), parts: any[] = [];
    for (let i = 0; i < nPart; i++) parts.push({ at: 4.0 + (i + 1) * 0.7 / nPart, x: r.x + Math.random() * r.w, y: r.y - i * r.h / nPart + r.h, fired: false });
    S.building = { from, to, t: 0, blocks, block: 'block_' + bi, blockWhite: 'block_white_' + bi, bw, bh, bs, orbFrom: [S.orb.x, S.orb.y], orbTo, parts,
      swapAt: SPAWN_DURATION + 0.7, done: false, zoomBefore: cam.zoom };
    S.activeArea = ''; S.navigated = '';
    cam.inputEnabled = false;
    this.play('build_whoosh', -3);
    if (S.showcaseCamera) { // keep the new tower and the orb in frame
      const topY = Math.min(orbTo[1] - 20, r.y) - 10, span = GROUND + 8 - topY;
      const q = (v: number) => v >= 0.5 ? Math.floor(v * 4) / 4 : Math.floor(v * 20) / 20;   // tall towers need zooms below 0.5
      const z = Math.max(0.2, Math.min(cam.zoom, q(H / span), q(W / (r.w + 60))));
      this.camZoomTo(z, 0.6);
      const centre = (topY + GROUND + 8) / 2;
      cam.tween = { fx: cam.x, fy: cam.y, tx: TOWER_X, ty: Math.min(centre, FLOOR_Y - floorHalf() / z), t: 0, dur: 0.6 };
    } else this.camMoveTo(S.orb.x, S.orb.y, 0.4);
  }
  private updateBuild(dt: number) {
    const S = this.S, B = S.building; if (!B) return;
    B.t += dt;
    const e = easeOutSine(Math.min(B.t / 2.5, 1));
    S.orb.x = B.orbFrom[0] + (B.orbTo[0] - B.orbFrom[0]) * e;
    S.orb.y = B.orbFrom[1] + (B.orbTo[1] - B.orbFrom[1]) * e;
    for (const b of B.blocks) {
      if (!b.spawned && B.t >= b.spawnAt) {
        b.spawned = true; b.x = S.orb.x - B.bw / 2; b.y = S.orb.y - B.bh / 2;
        let sp = 0, a: number | null = null;
        while (a === null) { a = this.calcAngle([b.x, b.y], [b.tx, b.ty], sp); if (a === null) sp += 35; }
        b.vx = Math.cos(a) * sp; b.vy = -Math.sin(a) * sp;
      }
      if (!b.spawned || b.done) continue;
      if (Math.hypot(b.tx - b.x, b.ty - b.y) < Math.hypot(b.vx, b.vy) * dt) { b.x = b.tx; b.y = b.ty; b.done = true; this.play('magic_material', -3, 0.05); continue; }
      const ny = b.vy + GRAVITY * dt;
      b.x += b.vx * dt; b.y += (b.vy + ny) * dt / 2; b.vy = ny;
    }
    if (B.t >= B.swapAt && this.shownTowerLevel !== B.to) this.shownTowerLevel = B.to;
    for (const p of B.parts) if (!p.fired && B.t >= p.at) { p.fired = true; this.addEffect(p.x, p.y, 'sparkle' + Math.floor(Math.random() * 4)); this.play('tower_particles', -3, 0.06); }
    if (B.t >= SPAWN_DURATION + TOWER_DELAY + 0.7 && !B.done) {
      B.done = true; S.building = null; this.cam.inputEnabled = true;
      this.play('tower_done', -3);
      // every upgrade settles the camera a step further out than before, framing the whole (bigger) tower:
      // it tells the player there is more room to build
      const home = this.homeZoom(S.level), top = S.orb.y - 34, bottom = GROUND + 8;
      this.camZoomTo(home, 0.9);
      const ty = Math.min((top + bottom) / 2 + (PORTRAIT ? HUD_H / 2 / home : 0), FLOOR_Y - floorHalf() / home);
      const rr = this.towerRect(S.level)!, cx = S.level >= 3 ? (63 + rr.x + rr.w) / 2 : TOWER_X;
      this.cam.tween = { fx: this.cam.x, fy: this.cam.y, tx: cx, ty, t: 0, dur: 0.9 };
      if (S.level === 2) S.newArea = 'study';
      if (S.wizardArea === 'initial') { this.addEffect(280, 317, 'poof'); S.wizardArea = 'orb'; const o = this.wizardPositions()[0]; this.addEffect(o.x, o.y, 'poof'); }
      this.tutorialEvent('towerUpgraded');
      this.notifyTowerBuilt(S.level);
    }
  }

  // ================================================================ skills
  private skillVisible(id: string) {
    const d = SKILLS[id];
    if (d.list === 'orb' && this.S.level < 1) return false;
    if (d.unlock && !(this.S.skills[d.unlock] > 0)) return false;
    if (d.unlockTower !== undefined && this.S.level < d.unlockTower) return false;
    if (d.visible) { try { if (!d.visible(this.host)) return false; } catch (e) { this.modError(d.list, 'visible', e); return false; } }
    return true;
  }
  private canAffordSkill(id: string) { const d = SKILLS[id]; return (this.S.res[d.res] || 0) + 1e-9 >= d.cost(this.S.skills[id]); }
  private buySkill(id: string, attempts = 1) {
    const S = this.S, d = SKILLS[id]; let bought = 0;
    while (bought < attempts && S.skills[id] < d.max) {
      const c = d.cost(S.skills[id]);
      if ((S.res[d.res] || 0) + 1e-9 < c) break;
      S.res[d.res] -= c; S.skills[id]++; bought++;
      if (d.onBuy) { try { d.onBuy(this.host, S.skills[id]); } catch (e) { this.modError(d.list, 'onBuy', e); } }
      if (d.totem) { this.totemPole.push(d.totem); this.addEffect(this.totemX(), 322 - this.totemPole.length * 10, 'poof'); if (id === 'carve_forest_totem') this.addResource('spirits', 4); }
      if (id === 'library_spirits') { const p = this.studyPos(this.shownTowerLevel)!; for (let i = 0; i < 5; i++) this.flyingSpirits.push({ x: p[0], y: p[1], vx: rand(-100, 100), vy: rand(-100, 100) }); }
    }
    if (bought) { if (d.summon) this.play('summon', -5, 0.08); else this.play('button_click', -4, 0.05); if (d.creates) this.addResource(d.creates, bought); }
    return bought;
  }

  // ================================================================ tutorial (Tutorial.gd)
  private showTut(text: string, button: string) { Object.assign(this.tutorial, { text, button, visible: true, showT: 0 }); this.play('tooltip_hover', -6, 0.1); }
  private tutorialButton() {
    const t = this.tutorial, s = t.step;
    if (s === 't0') { t.step = 't1'; this.orbPickable = true; this.showTut('Swipe anywhere to cast magic into me. In return, I can make something useful.', 'OK'); }
    else if (s === 't1') { t.step = 't2'; t.visible = false; }
    else if (s === 't3') { t.step = 't4'; this.showTut("Keep the magic coming and I will keep making the tower taller!", 'Got it'); }
    else if (s === 't4') { t.step = 't5'; this.cam.inputEnabled = true; this.showTut('Two more things. To look around, drag with two fingers (right-drag with a mouse) or use the buttons below.', 'OK'); }
    else if (s === 't5') { t.step = 't6'; this.showTut("Last tip: pinch or scroll to zoom. Now go build!", 'Got it'); }
    else if (s === 't6') { t.step = 't7'; t.visible = false; }
    else if (s === 't8') { t.step = 't9'; t.visible = false; }
    else if (s === 'forest') { t.step = 'f2'; t.visible = false; }
    else if (s === 'prestige') { t.step = 'end'; t.visible = false; }
    else if (s === 'story') { // module stories (host.showStory): show the next queued one, then resume the tutorial
      const next = this.storyQueue.shift();
      if (next) { t.portrait = next.portrait; this.showTut(next.text, next.button); } else { t.step = t.prevStep || 'end'; t.visible = false; t.portrait = null; }
    }
    else t.visible = false;
  }
  private tutorialEvent(ev: string) {
    const t = this.tutorial, s = t.step, S = this.S;
    if (ev === 'orbClicked' && s === 't1') { t.step = 't2'; t.visible = false; }
    if (ev === 'towerUpgraded' && S.level === 1 && s === 't2') { t.step = 't3'; this.cam.inputEnabled = false; this.showTut('Look at that, a real tower!', 'Nice'); }
    if (ev === 'panned' && s === 't5') this.tutorialButton();
    if (ev === 'zoomed' && s === 't6') this.tutorialButton();
    if (ev === 'towerUpgraded' && S.level === 2) { t.step = 't8'; this.addResource('spirits', 1); this.showTut("A Study just appeared! Spend some {spirit_icon} to get it working.", 'Got it'); }
    if (ev === 'towerUpgraded' && S.level === 3) { t.step = 'forest'; this.addResource('spirits', 1); this.showTut("Forestry is open! Gather {wood_icon} and carve {totem_icon} there.", 'Got it'); }
    if (ev === 'towerUpgraded' && S.level === 4 && s !== 'end') { t.step = 'prestige'; this.showTut("Prestige is open! When progress slows down, try a fresh run.", 'OK'); }
  }
  private toast(m: string) { this.toastMsg = m; this.toastT = 1.6; }

  // ================================================================ tick
  private tick(dt: number) {
    const S = this.S;
    S.time += dt; S.orb.phase += dt;
    this.multCache = {};   // module multipliers are recomputed once per frame
    this.castTimer = Math.max(0, this.castTimer - dt);
    this.flushResources();
    this.updateCamera(dt);
    this.updateFervor(dt);
    this.updateClickables(dt);
    this.updateOrbitals(dt);
    this.updateStudy(dt);
    this.updateForest(dt);
    this.updateBuild(dt);
    if (S.started) this.updateModules(dt);
    this.updateAutosave(dt);
    this.shakeT = Math.max(0, this.shakeT - dt); if (this.shakeT <= 0) this.shakeAmp = 0;
    for (let i = this.effects.length - 1; i >= 0; i--) { this.effects[i].t += dt; if (this.effects[i].t >= this.effects[i].life) this.effects.splice(i, 1); }
    for (const arr of [this.indicators, this.uiIndicators]) for (let i = arr.length - 1; i >= 0; i--) { arr[i].t += dt; if (arr[i].t >= arr[i].time) arr.splice(i, 1); }
    if (S.newArea === 'study' && Math.random() < 0.1) { const p = this.studyPos(S.level); if (p) this.addEffect(p[0] + rand(-20, 20), p[1] + rand(-20, 20), 'new_area'); }
    if (this.toastT > 0) this.toastT -= dt;
    this.updateCastFx(dt);
    this.updateSwipeAudio(dt);
    const pressed = this.mouse.down && this.mouse.capture === 'orb' ? 1 : 0;
    this.orbSquish += (pressed - this.orbSquish) * Math.min(1, dt * 25);
  }

  // ================================================================ UI helpers
  private uiHitTest(x: number, y: number) {
    const ov = this.overlayHit(x, y); if (ov) return ov;
    for (let i = this.hitRegions.length - 1; i >= 0; i--) { const r = this.hitRegions[i]; if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r; }
    // module screen UI drawn by hand: hitUi swallows the touch, onTap fires on release (still over it)
    for (let i = this.mods.length - 1; i >= 0; i--) {
      const m = this.mods[i]; if (!m.hitUi || !this.modOn(m)) continue;
      let hit = false; try { hit = !!m.hitUi(x, y); } catch (e) { this.modError(m.id, 'hitUi', e); }
      if (hit) return { id: 'modui_' + m.id, x: x - 1, y: y - 1, w: 2, h: 2, onUp: (inside: boolean) => { if (inside && m.onTap) { try { m.onTap(this.mouse.x, this.mouse.y); } catch (e) { this.modError(m.id, 'onTap', e); } } } };
    }
    return null;
  }
  // {blank_rune_icon} -> blank_rune_icon, else the resource's registered icon, else the bare art name (blank_rune)
  private iconImg(key: string) {
    if (this.D.has(key)) return key;
    const id = key.replace(/_icon$/, '');
    return ICON[id] && this.D.has(ICON[id]) ? ICON[id] : id;
  }
  private inRect(r: any) { const m = this.mouse; return r && !(m.down && m.cast) && m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h; }
  private richLayout(str: string, maxW: number) {
    const lines: any[][] = [];
    for (const para of str.split('\n')) {
      let line: any[] = [], lw = 0;
      for (const tok of para.split(/(\{\w+_icon\}|\s+)/).filter(t => t !== '')) {
        const isIcon = /^\{\w+_icon\}$/.test(tok), w = isIcon ? 11 : this.D.textW(tok);
        if (lw + w > maxW && line.length && !/^\s+$/.test(tok)) { lines.push(line); line = []; lw = 0; }
        if (!line.length && /^\s+$/.test(tok)) continue;
        line.push({ tok, isIcon, w }); lw += w;
      }
      lines.push(line);
    }
    return lines;
  }
  private drawRich(lines: any[][], x: number, y: number, lh = 12) {
    lines.forEach((line, i) => {
      let cx = x;
      for (const p of line) {
        if (p.isIcon) this.D.img(this.iconImg(p.tok.slice(1, -1)), Math.round(cx), Math.round(y + i * lh) + 1);
        else this.D.text(p.tok, cx, y + i * lh + 1);
        cx += p.w;
      }
    });
  }
  // button with hold-to-repeat (HoldableButton.gd: 0.5 s delay, then interval 0.05 * max(3 / t, 1))
  private button(id: string, label: string, x: number, y: number, w: number, h: number, disabled: boolean, onPress: () => void, opts: any = {}) {
    const st = this.btnState[id] || (this.btnState[id] = { pressed: false, holdT: 0, repeatT: 0, long: false, longT: 0 });
    const hover = !disabled && this.inRect({ x, y, w, h });
    const pressedNow = st.pressed && this.mouse.down && hover;
    const img = disabled ? 'button_disabled' : (pressedNow || opts.active) ? 'button_pressed' : hover ? 'button_hover' : 'button';
    const o = opts.rot ? { rot: opts.rot, pivot: [x + w / 2, y + h / 2] as [number, number] } : undefined;
    this.D.nine(img, x, y, w, h, o);
    this.D.text(label, x + w / 2, y + Math.floor((h - 10) / 2), disabled ? '#808080' : opts.active ? COL.dark : COL.white, 10, 'center', o);
    this.hitRegions.push({ id, x, y, w, h,
      onDown: () => { if (disabled) return; st.pressed = true; st.holdT = 0; st.long = false; st.repeatT = 0; },
      onUp: (inside: boolean) => { if (st.pressed && inside && !st.long && !disabled) onPress(); st.pressed = false; } });
    if (st.pressed && opts.holdable && !disabled) {
      st.holdT += this.frameDt;
      if (!st.long && st.holdT >= 0.5) { st.long = true; st.longT = 0; st.repeatT = 0; }
      if (st.long) {
        st.longT += this.frameDt; st.repeatT += this.frameDt;
        if (st.repeatT >= 0.05 * Math.max(3 / Math.max(st.longT, 1e-3), 1)) { st.repeatT = 0; onPress(); }
      }
    }
    if (st.pressed && (!this.mouse.down || disabled)) st.pressed = false;
  }
  private progressBar(x: number, y: number, w: number, h: number, ratio: number) {
    this.D.nine('progress_bar_background', x - 1, y - 1, w + 2, h + 2);
    const fw = Math.round((w - 2) * Math.min(Math.max(ratio, 0), 1));
    if (fw > 0) this.D.rect(COL.pink, Math.round(x) + 1, Math.round(y) + 1, fw, h - 2);
  }
  // on touch screens there is no hover: show tooltips only while the finger is down
  private setTooltip(str: string, anchor: any) { if (MOBILE && !this.mouse.down) return; this.tooltip = { lines: this.richLayout(str, 150), anchor }; }

  // ---- phone HUD: navigation buttons (bottom-left)
  private drawHudButtons() {
    const S = this.S;
    // ground backing under the button row: the camera floor lets the world end at its top edge
    this.D.part('ground', 0, 7, 1, 1, 0, H - HUD_H, W, HUD_H, { tint: this.sky ? this.sky.tint() : undefined } as any);
    if (!this.orbPickable || S.building) { this.navDrawer = false; return; }
    const bh = MOBILE ? 28 : 20, pad = 4, y = H - bh - pad;
    const navs = this.navItems(), bw = (n: { label: string }) => this.D.textW(n.label) + 16;
    // bottom row: as many areas as fit left of the audio buttons, plus "More" opening a drawer with all of them;
    // the open area always keeps a slot in the row
    const avail = W - pad - 2 * (bh + pad) - pad;
    let shown = navs, more = false;
    if (navs.reduce((a, n) => a + bw(n) + pad, pad) > avail) {
      more = true; shown = [];
      let x = pad + this.D.textW('More') + 16 + pad;
      for (const n of navs) { if (x + bw(n) + pad > avail) break; shown.push(n); x += bw(n) + pad; }
      const cur = navs.find(n => n.id === S.navigated);
      if (cur && shown.indexOf(cur) < 0 && shown.length) {
        shown.pop(); let w = pad + this.D.textW('More') + 16 + pad; for (const n of shown) w += bw(n) + pad;
        while (shown.length && w + bw(cur) > avail) { w -= bw(shown.pop()!) + pad; }
        shown.push(cur);
      }
    } else this.navDrawer = false;
    let x = pad;
    for (const n of shown) {
      const w = bw(n);
      this.button('nav_' + n.id, n.label, x, y, w, bh, false, () => this.navTo(n), { active: S.navigated === n.id });
      x += w + pad;
    }
    if (!more) return;
    const mw = this.D.textW('More') + 16;
    this.button('nav_more', 'More', x, y, mw, bh, false, () => { this.play('tooltip_hover', -8, 0.1); this.navDrawer = !this.navDrawer; }, { active: this.navDrawer });
    if (!this.navDrawer) return;
    // drawer: every area in a grid above the bottom row
    const cols = 3, gw = Math.floor((W - 2 * pad - 8 - (cols - 1) * pad) / cols), rows = Math.ceil(navs.length / cols);
    const dh = 20 + rows * (bh + pad) + 2, dx = pad, dy = y - dh - pad;
    this.D.nine('panel', dx, dy, W - 2 * pad, dh); this.hitRegions.push({ id: 'nav_drawer', x: dx, y: dy, w: W - 2 * pad, h: dh });
    this.D.text('Areas', dx + 4, dy + 3, COL.white, 12);
    navs.forEach((n, i) => {
      const cx = dx + 4 + (i % cols) * (gw + pad), cy = dy + 18 + Math.floor(i / cols) * (bh + pad);
      this.button('navd_' + n.id, n.label, cx, cy, gw, bh, false, () => { this.navDrawer = false; this.navTo(n, true); }, { active: S.navigated === n.id });
    });
  }
  navDrawer = false; resRect: any = null; goalRect: any = null;
  // ---- where a portrait panel docks: bottom (default) or top, decided ONCE when its area opens (never per frame).
  // Top when even with the camera on the floor the area's focus point would sit under a bottom-docked panel.
  private dockFor = ''; private dockTopNow = false; panelH: Record<string, number> = {};
  private areaFocus(id: string): number[] | null {
    const S = this.S;
    if (id === 'orb') return [S.orb.x, S.orb.y];
    if (id === 'study') return this.studyPos(S.level);
    if (id === 'forestry') return this.forestryAreaPos(S.level);
    const m: any = this.host.modules[id];
    if (m && m.worldFocus) { try { return m.worldFocus(); } catch (e) { this.modError(id, 'worldFocus', e); } }
    return null;
  }
  private decideDock(id: string) {
    this.dockFor = id; this.dockTopNow = false;
    if (!PORTRAIT || !id) return;
    const p = this.areaFocus(id); if (!p) return;
    const ph = this.panelH[id] || Math.round(H * 0.4), panelTop = H - HUD_H - ph - 2;
    const best = H - HUD_H - (FLOOR_Y - p[1]) * this.cam.zoom;   // its screen y with the camera all the way down
    // the focus point is the area's base; leave room for the building itself (~80 px on screen) above it
    this.dockTopNow = best > panelTop - 80;
  }
  private topDock() { if (this.dockFor !== this.S.activeArea) this.decideDock(this.S.activeArea); return this.dockTopNow; }
  private topDockY() { return this.resRect && this.S.resourcesVisible ? Math.round(this.resRect.y + this.resRect.h + 4) : 4; }
  // areas for the nav bar: core ones, then every unlocked + available module with a nav entry (registration order)
  navItems(): { id: string, label: string, focus: () => number[] | null }[] {
    const S = this.S, list: { id: string, label: string, focus: () => number[] | null }[] = [{ id: 'orb', label: 'Orb', focus: () => [S.orb.x, S.orb.y] }];
    if (S.level >= 2) list.push({ id: 'study', label: 'Study', focus: () => this.studyPos(S.level) });
    if (S.level >= 3) list.push({ id: 'forestry', label: 'Forest', focus: () => this.forestryAreaPos(S.level) });
    for (const m of this.mods) {
      if (!m.nav || !this.modOn(m) || list.find(n => n.id === m.id)) continue;
      const av: any = (m as any).navAvailable || (m.available && m.available.length === 0 ? m.available : null);
      if (av) { let ok = false; try { ok = !!av.call(m); } catch (e) { this.modError(m.id, 'available', e); } if (!ok) continue; }
      list.push({ id: m.id, label: m.nav.label, focus: () => { try { return m.worldFocus ? m.worldFocus() : null; } catch (e) { this.modError(m.id, 'worldFocus', e); return null; } } });
    }
    return list;
  }
  private navTo(n: { id: string, focus: () => number[] | null }, open = false) {   // open: drawer picks never toggle off
    const S = this.S;
    this.play('tooltip_hover', -8, 0.1);
    if (S.navigated === n.id && !open) { S.navigated = ''; return; }
    S.navigated = n.id;
    const p = n.focus();
    this.decideDock(n.id);
    if (p) this.frameArea(p[0], p[1], n.id);
  }
  // camera to an area's focus point, clear of its panel: free band under a top-docked panel, else 30% from the top
  private frameArea(x: number, y: number, id: string, zoom = this.cam.zoom) {
    if (id !== this.dockFor) this.decideDock(id);
    if (PORTRAIT && this.dockTopNow) {
      const ph = this.panelH[id] || Math.round(H * 0.4), want = (this.topDockY() + ph + H - HUD_H) / 2;
      this.camMoveTo(x, y - (want - H / 2) / zoom);
    } else this.camMoveTo(x, y + (PORTRAIT ? 0.2 * H / zoom : 0)); // portrait: keep it above the docked panel
  }

  // ---- music / sound toggles (bottom-right, same row as the nav buttons)
  private drawAudioButtons() {
    const D = this.D, bh = MOBILE ? 28 : 20, pad = 4, y = H - bh - pad, px = MOBILE ? 2 : 1;
    const items: [string, boolean, string[], () => void][] = [['sfx', this.sfxOn, ART_SPEAKER, () => this.toggleSfx()], ['music', this.musicOn, ART_NOTE, () => this.toggleMusic()]];
    let x = W - pad - bh;
    for (const [id, on, art, fn] of items) {
      this.button('audio_' + id, ' ', x, y, bh, bh, false, fn);
      const aw = art[0].length * px, ah = art.length * px, ix = x + Math.round((bh - aw) / 2), iy = y + Math.round((bh - ah) / 2) - 1;
      art.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === '#') D.rect(on ? COL.white : COL.grey, ix + c * px, iy + r * px, px, px); });
      if (!on) for (let i = 0; i <= bh - 10; i++) D.rect(COL.pink, x + 5 + i, y + 4 + i, px + 1, px + 1);   // strike-through
      x -= bh + pad;
    }
  }

  // phones: rows and buttons sized for a ~10 mm fingertip (44 pt / 48 dp guidance)
  private get rowH() { return MOBILE ? 22 : 14; }
  private skillListHeight(listId: string) {
    const rows = Object.keys(SKILLS).filter(k => SKILLS[k].list === listId && this.skillVisible(k)).length;
    return Math.max(MOBILE ? 0 : 76, 6 + 14 + rows * (this.rowH + 2));
  }
  private drawSkillList(listId: string, title: string, x: number, y: number, w: number) {
    const D = this.D, S = this.S, h = this.skillListHeight(listId), RH = this.rowH, ty = Math.floor((RH - 10) / 2);
    D.nine('panel', x, y, w, h); this.hitRegions.push({ x, y, w, h });
    D.text(title, x + 4, y + 3, COL.white, 12);
    let ry = y + 18;
    for (const id of Object.keys(SKILLS)) {
      const d = SKILLS[id]; if (d.list !== listId || !this.skillVisible(id)) continue;
      const row = { x: x + 3, y: ry, w: w - 6, h: RH }, hovered = this.inRect(row);
      if (hovered) D.rect(COL.rowHover, row.x, row.y, row.w, row.h);
      if (d.icon) D.img(d.icon, row.x + 1, ry + ty);
      const lv = S.skills[id];
      D.text(d.name + (d.showLevel && lv > 0 ? ' ' + lv : ''), row.x + 13, ry + ty, d.summon ? COL.light : COL.white);
      const maxed = lv >= d.max, btnW = maxed ? 34 : (MOBILE ? 30 : 19), bx = row.x + row.w - 30 - 11 - btnW - 2;
      this.button('skill_' + id, maxed ? 'Maxed' : 'Buy', bx, ry, btnW, RH, maxed || !this.canAffordSkill(id), () => {
        const n = this.buySkill(id, 1);
        if (n && d.creates) this.uiIndicators.push({ x: bx - 16, y: ry, text: fmt(n, true), icon: ICON[d.creates], t: 0, time: 0.4, dy: -10 });
      }, { holdable: true });
      if (!maxed) { D.img(this.iconImg(ICON[d.res] || d.res + '_icon'), bx + btnW + 2, ry + ty); D.text(fmt(d.cost(lv)), bx + btnW + 14, ry + ty); }
      if (hovered) {
        let tip = d.name + (d.showLevel ? `  Lv. ${lv}` : '') + '\n\n' + d.tip();
        if (d.showCost) tip += `\n\nCost: ${fmt(d.cost(lv))} {${ICON[d.res]}}`;
        this.setTooltip(tip, { x, y: ry, w, h: RH });
      }
      ry += RH + 2;
    }
  }
  private wobbleRotation(t: number) { // 0.06 -> -0.04 -> 0.02 -> 0 rad over 0.1/0.1/0.1/0.05 s
    if (t < 0) return 0;
    const keys = [[0, 0], [0.1, 0.06], [0.2, -0.04], [0.3, 0.02], [0.35, 0]];
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, a] = keys[i - 1], [t1, b] = keys[i]; return a + (b - a) * easeInOutSine((t - t0) / (t1 - t0)); }
    this.wobbleT = -1; return 0;
  }
  private drawOrbUI() {
    const D = this.D, S = this.S, showList = S.level >= 1, listW = 200, panelW = 150;
    const ovr = S.level < TOWERS.length ? this.towerButtonOverride() : null;
    const cost = (ovr && ovr.cost) || TOWER_COSTS[S.level] || {}, rows = Object.keys(cost);
    const btnH = MOBILE ? 24 : 16;
    const panelH = 4 + 14 + rows.length * 13 + btnH + 4, listH = showList ? this.skillListHeight('orb') : 0;
    const totalW = showList ? listW : panelW, totalH = panelH + (showList ? listH + 2 : 0);
    // original: above the orb at tower 0, to its right afterwards
    const area = this.areaScreenRect(S.orb.x, S.orb.y, ORB_POLY);
    const { x, y } = this.placePanel(area, totalW, totalH, S.level === 0 ? ['above', 'right', 'left', 'below'] : ['right', 'left', 'above', 'below']);
    this.orbUiRect = { x, y, w: totalW, h: totalH };
    let cy = y;
    if (showList) { this.drawSkillList('orb', 'The Orb', x, cy, listW); cy += listH + 2; }
    D.nine('panel', x, cy, panelW, panelH); this.hitRegions.push({ x, y: cy, w: panelW, h: panelH });
    D.text('Tower Requirements', x + 4, cy + 3, COL.white, 12);
    let ry = cy + 18;
    for (const id of rows) {
      D.img(this.iconImg(ICON[id] || id + '_icon'), x + 4, ry + 1);
      D.text(fmt(cost[id]), x + 16, ry + 1);
      this.progressBar(x + 52, ry + 2, panelW - 58, 8, (S.earned[id] || 0) / cost[id]);
      if (this.inRect({ x: x + 3, y: ry, w: panelW - 6, h: 12 })) this.setTooltip(`Earn ${fmt(cost[id])} {${ICON[id]}} in total over this run.\n(${fmt(S.earned[id] || 0)} so far)`, { x, y: ry, w: panelW, h: 12 });
      ry += 13;
    }
    const can = this.canAffordTower() && S.level < TOWERS.length;
    if (this.wobbleT >= 0) this.wobbleT += this.frameDt;
    const block = S.level < TOWERS.length ? this.towerBlock(S.level + 1) : null;
    let custom: string | null = null;
    const lf = TOWER_LABELS[S.level + 1]; if (lf && !block) { try { custom = lf(this.host); } catch (e) { this.modError('tower' + (S.level + 1), 'label', e); } }
    let label = S.level === 0 ? 'Build Tower' : S.level >= TOWERS.length ? 'Cannot Upgrade' : block ? block : custom || 'Ascend Tower';
    let disabled = !can || !!S.building, press = () => this.buildTower();
    if (ovr) { // a module owns this button (siege: Fire Magic Beam / The Final Ascension)
      label = ovr.label;
      if (ovr.onPress) { disabled = !!ovr.disabled || !!S.building; const f = ovr.onPress; press = () => { try { f(); } catch (e) { this.modError('towerButton', 'onPress', e); } }; }
      else disabled = disabled || !!ovr.disabled;
    }
    const b = { x: x + 2, y: ry + 1, w: 146, h: btnH };
    this.button('build', label, b.x, b.y, b.w, b.h, disabled, press, { rot: this.wobbleRotation(this.wobbleT) });
    if (this.inRect(b)) this.setTooltip(ovr && ovr.reason ? ovr.reason : can ? 'Building the next level is free' : block ? block : 'Meet the requirements to build the next tower level.', { x, y: b.y, w: panelW, h: 16 });
  }
  private drawStudyUI() {
    const D = this.D, p = this.studyPos(this.shownTowerLevel); if (!p) return;
    const listW = 200, listH = this.skillListHeight('study'), books = this.books;
    const shelfRows = Math.max(1, Math.ceil(books.length / 30));
    const shelfW = Math.max(125, Math.min(books.length, 30) * 9 + 8), shelfH = books.length ? 8 + shelfRows * 21 : 0;
    const totalH = (shelfH ? shelfH + 2 : 0) + listH;
    const { x, y } = this.placePanel(this.areaScreenRect(p[0], p[1], STUDY_POLY), Math.max(listW, shelfW), totalH, ['right', 'left', 'below', 'above']);
    this.studyUiRect = { x, y, w: Math.max(listW, shelfW), h: totalH };
    let cy = y;
    if (shelfH) {
      D.nine('panel', x, cy, shelfW, shelfH); this.hitRegions.push({ x, y: cy, w: shelfW, h: shelfH });
      books.forEach((b, i) => { // TextureProgressBar, fill bottom-to-top
        const bx = x + 4 + (i % 30) * 9, by = cy + 4 + Math.floor(i / 30) * 21;
        D.img('book_' + b.k, bx, by);
        const fh = Math.round(21 * Math.min(b.p / 10, 1));
        if (fh > 0) D.part('book_' + b.k + '_fill', 0, 21 - fh, 9, fh, bx, by + 21 - fh, 9, fh);
      });
      cy += shelfH + 2;
    }
    this.drawSkillList('study', 'Study', x, cy, listW);
  }
  private drawResources() {
    const D = this.D, S = this.S;
    if (!S.resourcesVisible) return;
    const ids = RES_IDS.filter(id => S.seen[id] && !RES_HIDDEN[id]);
    let aw = 0; for (const id of ids) aw = Math.max(aw, D.textW(fmt(S.res[id])));
    const rw = IncomeMeter.colW(D, this, ids, fmt);
    let w = Math.max(60, 16 + aw + (rw ? 5 + rw : 0) + 8);
    w = Math.max(w, D.textW('Resources', 12) + 10);
    const h = 6 + 14 + ids.length * 13, x = PORTRAIT ? 4 : 2, y = PORTRAIT ? 4 : Math.round(H / 2 - h / 2);
    this.resRect = { x, y, w: 0, h };
    D.nine('panel', x, y, w, h); this.hitRegions.push({ x, y, w, h });
    D.text('Resources', x + 4, y + 3, COL.white, 12);
    const desc = RES_DESC;
    ids.forEach((id, i) => {
      const ry = y + 18 + i * 13;
      D.img(this.iconImg(ICON[id] || id + '_icon'), x + 4, ry + 1); D.text(fmt(S.res[id]), x + 16, ry + 1); IncomeMeter.draw(D, x + 16 + aw + 5, ry + 1, id);
      if (this.inRect({ x, y: ry, w, h: 12 })) this.setTooltip(desc[id], { x, y: ry, w, h: 12 });
    });
  }
  // Always-visible goal card under the Resources panel: what the next ascension needs, with progress bars
  // (lifetime totals, the original rule), a module override (siege: Fire Magic Beam / Final Ascension) or the gate
  // that blocks it (walls). Tapping it opens the Orb panel with the build button. Hidden while an area panel is open.
  private drawGoal() {
    const D = this.D, S = this.S; this.goalRect = null;
    if (!S.resourcesVisible || S.level >= TOWERS.length || S.building || S.activeArea || !this.resRect) return;
    const ovr = this.towerButtonOverride(), block = ovr ? null : this.towerBlock(S.level + 1);
    const cost: Record<string, number> = (ovr && ovr.cost) || TOWER_COSTS[S.level] || {};
    const have = (id: string) => ovr && ovr.cost ? (S.res[id] || 0) : (S.earned[id] || 0);   // overrides spend, ascensions compare lifetime
    const rows = block ? [] : Object.keys(cost);
    const ready = ovr ? !ovr.disabled && rows.every(id => have(id) >= cost[id]) : this.canAffordTower();
    const title = ovr ? ovr.label : S.level === 0 ? 'Goal: Build Tower' : 'Goal: Tower ' + (S.level + 1);
    const w = Math.max(this.resRect.w || 0, 96, D.textW(title) + 10), x = this.resRect.x, y = this.resRect.y + this.resRect.h + 3;
    const lines = block ? this.richLayout(block, w - 8) : [];
    const h = 18 + rows.length * 12 + lines.length * 11 + (ready ? 12 : 0) + 3;
    this.goalRect = { x, y, w, h };
    D.nine('panel', x, y, w, h);
    D.text(title, x + 4, y + 3, ready ? COL.pink : COL.white, 10);
    let ry = y + 16;
    for (const id of rows) {
      const r = Math.min(1, have(id) / cost[id]);
      D.img(this.iconImg(ICON[id] || id + '_icon'), x + 4, ry);
      this.progressBar(x + 16, ry + 1, w - 20, 8, r);
      D.text(fmt(Math.min(have(id), cost[id])) + '/' + fmt(cost[id]), x + 16 + (w - 20) / 2, ry, COL.white, 10, 'center');
      ry += 12;
    }
    if (lines.length) { this.drawRich(lines, x + 4, ry, 11); ry += lines.length * 11; }
    if (ready && Math.sin(S.time * 6) > -0.3) D.text('Tap to ascend!', x + w / 2, ry, COL.pink, 10, 'center');
    this.hitRegions.push({ id: 'goal', x, y, w, h, onUp: (inside: boolean) => {
      if (!inside) return; const nav = this.navItems().find(v => v.id === 'orb'); if (nav) this.navTo(nav, true);
    } });
  }
  private drawTutorial() {
    const t = this.tutorial; if (!t.visible) return;
    t.showT += this.frameDt;
    const tbh = MOBILE ? 22 : 15;
    const lines = this.richLayout(t.text, 150), w = 160, h = Math.max(60, 8 + lines.length * 12 + tbh + 7);
    const rise = Math.max(0, 3 * (1 - t.showT / 0.07)); // Utils.animate_show
    const x = Math.round(W / 2 - w / 2), y = Math.round(H / 2 - h / 2 + rise);
    this.D.nine('panel', x, y, w, h); this.hitRegions.push({ x, y, w, h });
    if (t.portrait && this.D.has(t.portrait)) { // story speaker: framed portrait on the panel's top edge
      const [pw, ph] = this.D.size(t.portrait), s = pw <= 32 ? 2 : 1;
      this.D.nine('panel', x + 4, y - ph * s - 4, pw * s + 6, ph * s + 6); this.D.part(t.portrait, 0, 0, pw, ph, x + 7, y - ph * s - 1, pw * s, ph * s);
    }
    this.drawRich(lines, x + 5, y + 4);
    const bw = Math.max(40, this.D.textW(t.button) + 12);
    this.button('tut', t.button, x + w / 2 - bw / 2, y + h - tbh - 4, bw, tbh, false, () => { this.play('tooltip_hover', -8, 0.1); this.tutorialButton(); });
  }
  private drawTooltip() {
    if (!this.tooltip) return;
    const lines = this.tooltip.lines, w = 160, h = lines.length * 12 + 8, a = this.tooltip.anchor;
    let x = a.x + a.w + 4; if (x + w > W - 2) x = a.x - w - 4;
    let y = Math.min(Math.max(a.y, 2), H - h - 2);
    if (PORTRAIT) { // no room at the side: centre it above the docked panel (or below the anchor near the top)
      const panel = this.S.activeArea === 'study' ? this.studyUiRect : this.orbUiRect;
      const top = panel && this.inRect(panel) ? panel.y : a.y;
      x = Math.round((W - w) / 2);
      y = top - h - 4 >= 2 ? top - h - 4 : Math.min(a.y + a.h + 4, H - h - 2);
    }
    this.D.rect('#000000', x, y, w, h, 0.78);
    this.D.rect('#000000', x, y, w, 2); this.D.rect('#000000', x, y + h - 2, w, 2); this.D.rect('#000000', x, y, 2, h); this.D.rect('#000000', x + w - 2, y, 2, h);
    this.drawRich(lines, x + 5, y + 4);
  }

  // ================================================================ module host (GameModule.ts)
  // Feature modules register themselves (modules/index.ts imports them); addModule merges their skills,
  // resources and tower overrides, then init(host). Every module call is guarded: a throwing module logs once
  // per method and the game keeps running. Built-ins without a module file are exposed through host.modules too.
  mods: GameModule[] = []; host!: GameHost; modUi: Record<string, any> = {}; modCooldown = 0;
  private multCache: Record<string, number> = {}; private modErrs: Record<string, boolean> = {};
  private clicked: Record<string, number> = {}; private frameNo = 0; storyQueue: any[] = [];
  private makeHost() {
    const g = this, modules: Record<string, any> = {};
    this.host = {
      get S() { return g.S; }, get D() { return g.D; }, get W() { return W; }, get H() { return H; },
      get mobile() { return MOBILE; }, get portrait() { return PORTRAIT; }, get fervor() { return g.fervor; },
      modules,
      towerLevel: () => g.S.level,
      towerAnchor: (name: string) => g.towerAnchor(name),
      orbPos: () => [g.S.orb.x, g.S.orb.y],
      res: (id: string) => g.S.res[id] || 0,
      lifetime: (id: string) => g.S.earned[id] || 0,
      addResource: (id: string, v: number) => { g.addResource(id, v); },
      spend: (id: string, v: number) => g.spend(id, v),
      mult: (kind: string) => g.mult(kind),
      skillLevel: (id: string) => g.S.skills[id] || 0,
      play: (sound: string, db = 0, minGap = 0) => g.play(sound, db, minGap),
      addEffect: (wx: number, wy: number, type: string) => g.addEffect(wx, wy, type),
      toast: (msg: string) => g.toast(msg),
      showStory: (portrait: string | null, text: string, button = 'OK') => g.showStory(portrait, text, button),
      toScreen: (wx: number, wy: number) => g.toScreen(wx, wy),
      toWorld: (sx: number, sy: number) => g.toWorld(sx, sy),
      camFocus: (wx: number, wy: number, zoom?: number) => {
        if (zoom) g.camZoomTo(zoom, 0.5);
        g.frameArea(wx, wy, g.S.navigated || g.S.activeArea, zoom || g.cam.zoom);
      },
      button: (id: string, label: string, x: number, y: number, w: number, h: number, disabled = false) => g.modButton(id, label, x, y, w, h, disabled),
      progressBar: (x: number, y: number, w: number, h: number, ratio: number) => g.progressBar(x, y, w, h, ratio),
      drawSkillList: (listId: string, title: string, x: number, y: number, w: number) => { g.drawSkillList(listId, title, x, y, w); return g.skillListHeight(listId); },
      skillListHeight: (listId: string) => g.skillListHeight(listId),
      panelRect: (w: number, h: number) => g.panelRect(w, h),
      cloudlingMagic: () => g.cloudlingMagic(),
      cloudlingBurst: () => g.cloudlingBurst(),
      knowledgeReward: () => g.knowledgeReward(),
      isUnlocked: (id: string) => { const m = g.mods.find(x => x.id === id); return !!m && g.modOn(m); },
      save: () => g.writeSave(),
      totemCounts: () => { const c: Record<string, number> = {}; for (const t of g.totemPole) c[t] = (c[t] || 0) + 1; return c; },
      setTowerLevel: (level: number) => g.debugTower(level),
      setSkillLevel: (id: string, level: number) => g.setSkillLevel(id, level),
      resetRun: () => g.resetRun(),
      pointer: () => ({ x: g.mouse.x, y: g.mouse.y, down: !!g.mouse.down, casting: g.isCasting() }),
      shake: (px: number, dur: number) => { g.shakeAmp = Math.max(g.shakeAmp, px); g.shakeT = Math.max(g.shakeT, dur); },
      debugSetLevel: (level: number) => g.debugTower(level),
      hideTower: (on: boolean) => { g.towerHidden = on; },
      buySkill: (id: string, n: number) => SKILLS[id] ? g.buySkill(id, n) : 0,
      nextTowerCost: () => g.S.level < TOWERS.length ? Object.assign({}, TOWER_COSTS[g.S.level]) : null,
    };
    // built-ins that are not module files: reachable as host.modules.sky (a registered module of the
    // same id replaces them)
    modules.sky = this.sky;
    (globalThis as any).__twHost = this.host;   // tests / console
  }
  private initModules() {
    this.makeHost();
    for (const m of getModules()) this.addModule(m);
  }
  /** registers a module now (also works after start: tests, late imports) */
  addModule(m: GameModule) {
    if (this.mods.indexOf(m) >= 0) return;
    this.mods.push(m); this.host.modules[m.id] = m;
    for (const r of m.resources || []) this.registerResource(r.id, r.icon, r.name, !!r.hidden);
    if (m.skills) for (const id in m.skills) { SKILLS[id] = m.skills[id]; if (this.S.skills[id] === undefined) this.S.skills[id] = 0; }
    this.mergeTowers(m.towers);
    if (m.init) { try { m.init(this.host); } catch (e) { this.modError(m.id, 'init', e); } }
  }
  private mergeTowers(list: any[] | undefined) {
    for (const t of list || []) {
      const L = t.level; if (!(L >= 1 && L <= TOWERS.length)) continue;
      const def = TOWERS[L - 1];
      if (t.img) def.img = t.img;
      if (t.orb) def.orb = t.orb;
      if (t.anchors) def.anchors = Object.assign({}, def.anchors, t.anchors);
      if (t.cost) TOWER_COSTS[L - 1] = t.cost;
      if (t.gate) { const prev = TOWER_GATES[L], gate = t.gate; TOWER_GATES[L] = prev ? (h: GameHost) => prev(h) || gate(h) : gate; }
      if (t.label) TOWER_LABELS[L] = t.label;
    }
  }
  registerResource(id: string, icon: string, name: string, hidden = false) {
    const S = this.S;
    if (hidden) RES_HIDDEN[id] = true;
    if (RES_IDS.indexOf(id) < 0) RES_IDS.push(id);
    if (icon) ICON[id] = icon;
    if (name && !RES_DESC[id]) RES_DESC[id] = name;
    for (const k of ['res', 'pending', 'earned']) if (typeof S[k][id] !== 'number') S[k][id] = 0;
    if (S.seen[id] === undefined) S.seen[id] = false;
  }
  modOn(m: GameModule) { return this.S.level >= (m.unlockTower || 0); }
  modError(id: string, where: string, e: any) {
    const k = id + '.' + where; if (this.modErrs[k]) return; this.modErrs[k] = true;
    console.error(`[module ${id}] ${where} failed:`, e && e.stack ? e.stack : e);
  }
  private modAt(wx: number, wy: number): GameModule | null {
    for (let i = this.mods.length - 1; i >= 0; i--) {
      const m = this.mods[i]; if (!m.hitWorld || !this.modOn(m)) continue;
      try { if (m.hitWorld(wx, wy)) return m; } catch (e) { this.modError(m.id, 'hitWorld', e); }
    }
    return null;
  }
  // modules with onTap but no hitUi get first look at every world press (screen coords)
  private modTap(x: number, y: number) {
    for (let i = this.mods.length - 1; i >= 0; i--) {
      const m = this.mods[i]; if (!m.onTap || m.hitUi || !this.modOn(m)) continue;
      try { if (m.onTap(x, y)) return true; } catch (e) { this.modError(m.id, 'onTap', e); }
    }
    return false;
  }
  // overlay modules (drawn last) get first pick of touches: their own buttons, then their hitUi
  private overlayFrom = 1e9; towerHidden = false;
  private overlayHit(x: number, y: number) {
    for (let i = this.hitRegions.length - 1; i >= this.overlayFrom; i--) { const r = this.hitRegions[i]; if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r; }
    for (let i = this.mods.length - 1; i >= 0; i--) {
      const m = this.mods[i]; if (!m.overlay || !m.hitUi || !this.modOn(m)) continue;
      let hit = false; try { hit = !!m.hitUi(x, y); } catch (e) { this.modError(m.id, 'hitUi', e); }
      if (hit) return { id: 'modui_' + m.id, x: x - 1, y: y - 1, w: 2, h: 2, onUp: (inside: boolean) => { if (inside && m.onTap) { try { m.onTap(this.mouse.x, this.mouse.y); } catch (e) { this.modError(m.id, 'onTap', e); } } } };
    }
    return null;
  }
  setSkillLevel(id: string, level: number) {
    const S = this.S, d = SKILLS[id]; if (!d) return;
    level = Math.max(0, Math.min(d.max, Math.floor(level)));
    if (d.totem) { // the pole holds one piece per level
      let have = this.totemCount(d.totem);
      while (have < level) { this.totemPole.push(d.totem); have++; }
      while (have > level) { this.totemPole.splice(this.totemPole.lastIndexOf(d.totem), 1); have--; }
    }
    S.skills[id] = level;
  }
  /** prestige "Next Run": a fresh run in place. Core state back to a new game (tutorial skipped), every module
   *  reset(true) (permanent data stays), then onRunStart for run-start blessings (setTowerLevel / setSkillLevel). */
  resetRun() {
    const S = this.S;
    for (const k of ['res', 'pending', 'earned']) for (const id in S[k]) S[k][id] = 0;
    for (const id in S.seen) S.seen[id] = id === 'magic';
    for (const id in S.skills) S.skills[id] = 0;
    Object.assign(S, { level: 0, building: null, resourcesVisible: false, speedTimer: 0, speedMult: 1, studySpeedTimer: 0, studySpeedMult: 1,
      activeArea: '', navigated: '', newArea: '', wizardArea: 'initial' });
    S.orb.x = ORB_START[0]; S.orb.y = ORB_START[1];
    this.shownTowerLevel = 0;
    for (const a of [this.spirits, this.cloudlings, this.balls, this.effects, this.indicators, this.uiIndicators, this.books, this.flyingSpirits,
      this.trees, this.druids, this.logs, this.totemPole, this.parts, this.motes]) a.length = 0;
    this.fervor = 0; this.navDrawer = false; this.storyQueue.length = 0;
    this.tutorial.step = 'end'; this.tutorial.visible = false; this.orbPickable = true; this.cam.inputEnabled = true;
    const seen = new Set<any>();
    for (const id in this.host.modules) {
      const m: any = this.host.modules[id]; if (!m || seen.has(m) || typeof m.reset !== 'function') continue; seen.add(m);
      try { m.reset(true); } catch (e) { this.modError(id, 'reset', e); }
    }
    this.camHome();
    this.runStarted();
    this.writeSave();
  }
  private runStarted() { for (const m of this.mods) if (m.onRunStart) { try { m.onRunStart(); } catch (e) { this.modError(m.id, 'onRunStart', e); } } }
  private modDraw(fn: 'drawWorldBack' | 'drawWorld' | 'drawHud' | 'overlay') {
    for (const m of this.mods) {
      const f = m[fn]; if (!f || !this.modOn(m)) continue;
      try { f.call(m, this.D); } catch (e) { this.modError(m.id, fn, e); }
    }
  }
  private drawModulePanels() {
    for (const m of this.mods) {
      if (this.S.activeArea !== m.id || !m.drawPanel || !this.modOn(m)) { this.modUi[m.id] = null; continue; }
      const at = this.hitRegions.length;
      let r: any = null; try { r = m.drawPanel(this.D); } catch (e) { this.modError(m.id, 'drawPanel', e); }
      this.modUi[m.id] = r;
      // under its own buttons; a tap on the panel itself (not a button) goes to onTap (hand-drawn UI like the nation map)
      if (r) this.hitRegions.splice(at, 0, { id: 'modpanel_' + m.id, x: r.x, y: r.y, w: r.w, h: r.h,
        onUp: (inside: boolean) => { if (inside && m.onTap) { try { m.onTap(this.mouse.x, this.mouse.y); } catch (e) { this.modError(m.id, 'onTap', e); } } } });
    }
  }
  private drawModuleHud() { this.modDraw('drawHud'); }
  private updateModules(dt: number) {
    for (const m of this.mods) {
      if (!m.update || !this.modOn(m)) continue;
      try { m.update(dt); } catch (e) { this.modError(m.id, 'update', e); }
    }
  }
  private notifyTowerBuilt(level: number) {
    for (const m of this.mods) if (m.onTowerBuilt) { try { m.onTowerBuilt(level); } catch (e) { this.modError(m.id, 'onTowerBuilt', e); } }
  }
  // immediate-mode button for modules: true on the frame after a completed tap
  private modButton(id: string, label: string, x: number, y: number, w: number, h: number, disabled: boolean) {
    const key = 'm_' + id, at = this.clicked[key];
    this.button(key, label, x, y, w, h, disabled, () => { this.clicked[key] = this.frameNo; });
    if (at !== undefined) { delete this.clicked[key]; return this.frameNo - at <= 2; }
    return false;
  }
  // docked panel placement for modules: above the bottom buttons in portrait, right side in landscape
  panelRect(w: number, h: number) {
    w = Math.min(w, W - 4); h = Math.min(h, H - HUD_H - 6);
    if (PORTRAIT) {
      this.panelH[this.S.activeArea] = h;
      if (this.topDock()) return { x: Math.round((W - w) / 2), y: Math.max(2, Math.min(this.topDockY(), H - HUD_H - h - 2)), w, h };
      return { x: Math.round((W - w) / 2), y: Math.max(2, H - HUD_H - h - 2), w, h };
    }
    return { x: W - w - 4, y: Math.max(2, Math.round((H - HUD_H - h) / 2)), w, h };
  }
  mult(kind: string) {
    const c = this.multCache[kind]; if (c !== undefined) return c;
    this.multCache[kind] = 1;   // a module asking for its own kind inside multipliers() gets 1, not a loop
    let v = this.coreMult(kind);
    for (const m of this.mods) {
      if (!m.multipliers) continue;
      try { const x = m.multipliers()[kind]; if (typeof x === 'number' && isFinite(x)) v *= x; } catch (e) { this.modError(m.id, 'multipliers', e); }
    }
    return this.multCache[kind] = v;
  }
  // base-game multipliers other modules read: Crafting Totems (blank runes + magic gold), Sage Totems (Academy EXP)
  private coreMult(kind: string) {
    if (kind === 'crafting' || kind === 'alchemy_exp') return 1 + this.totemCount('crafting_totem') * Math.max(1, blessing(this.host, 'crafting_totem_blessing'));
    if (kind === 'academy_exp') { const n = this.totemCount('sage_totem'); return n ? Math.pow(1 + 0.5 * Math.max(1, blessing(this.host, 'sage_totem_blessing')), n) : 1; }
    return 1;
  }
  spend(id: string, v: number) {
    const S = this.S; if (!(v >= 0) || (S.res[id] || 0) + 1e-9 < v) return false;
    S.res[id] -= v; return true;
  }
  cloudlingMagic() { const S = this.S; return 20 * (1 + S.skills.cloudling_potency * 70 / 100) * (1 + this.totemCount('magic_totem')) * this.mult('magic') * this.mult('cloudling_magic') * this.mult('summon_cloudling'); }
  knowledgeReward() { const S = this.S; return 10 * 0.5 * (1 + S.skills.text_enchantment * 50 / 100) * (1 + this.totemCount('knowledge_totem')) * this.mult('knowledge') * this.mult('tome_knowledge') * this.mult('summon_spirit_tome'); }
  cloudlingBurst() {
    for (const c of this.cloudlings) this.balls.push({ x: c.r * Math.cos(c.a), y: c.r * Math.sin(c.a), vx: -Math.sin(c.a) * c.speed * c.dir, vy: Math.cos(c.a) * c.speed * c.dir });
  }
  // story popup (module dialogue): queued behind whatever popup is open, the tutorial resumes afterwards
  showStory(portrait: string | null, text: string, button = 'OK') {
    const t = this.tutorial;
    if (t.visible) { this.storyQueue.push({ portrait, text, button }); return; }
    if (t.step !== 'story') t.prevStep = t.step;
    t.step = 'story'; t.portrait = portrait; this.showTut(text, button);
  }
  // world position of a named anchor on the shown tower: TowerDef.anchors (tower-local, see TOWERS) or the
  // built-ins orb, base, study, wizard, node, portal, forestry, island, totems, top, left, right
  towerAnchor(name: string): [number, number] | null {
    const L = this.shownTowerLevel, r = this.towerRect(L), S = this.S;
    if (name === 'orb') return [S.orb.x, S.orb.y];
    if (name === 'base') return [TOWER_X, GROUND];
    if (!r) return null;
    const d = r.def, at = (p: number[] | undefined): [number, number] | null => p ? [r.x + p[0], r.y + p[1]] : null;
    const camel = name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());   // alchemy_wizard == alchemyWizard
    if (d.anchors && d.anchors[name]) return at(d.anchors[name]);
    if (d.anchors && d.anchors[camel]) return at(d.anchors[camel]);
    switch (name) {
      case 'study': return at(d.study);
      case 'wizard': return at(d.wizard);
      case 'node': return at(d.node);
      case 'portal': { const p = this.portalPos(L); return p ? [p[0], p[1]] : null; }
      case 'forestry': { const p = this.forestryAreaPos(L); return p ? [p[0], p[1]] : null; }
      case 'island': case 'forest_island': { const p = this.islandPos(); return [p[0], p[1]]; }
      case 'totems': return [this.totemX(), GROUND];
      case 'top': return [r.x + r.w / 2, r.y];
      case 'left': return [r.x, GROUND];
      case 'right': return [r.x + r.w, GROUND];
    }
    return null;
  }
  // camera at the resting framing for the current tower (same as after an ascension)
  camHome() {
    const S = this.S, home = this.homeZoom(S.level);
    this.cam.tween = null; this.cam.zoomTween = null; this.cam.vx = 0; this.cam.vy = 0;
    if (S.level === 0) { const f = this.orbFocus(); this.cam.x = f[0]; this.cam.y = f[1]; this.clampCam(); return; }
    this.cam.zoom = home;
    const top = S.orb.y - 34, bottom = GROUND + 8, rr = this.towerRect(S.level)!;
    this.cam.x = S.level >= 3 ? (63 + rr.x + rr.w) / 2 : TOWER_X;
    this.cam.y = Math.min((top + bottom) / 2 + (PORTRAIT ? HUD_H / 2 / home : 0), FLOOR_Y - floorHalf() / home);
    this.clampCam();
  }
  /** dev / test: jump straight to a tower level (no animation), camera home, modules told */
  debugTower(level: number) {
    level = Math.max(0, Math.min(TOWERS.length, Math.round(level)));
    this.debugSetLevel(level); this.camHome(); this.notifyTowerBuilt(level);
  }

  // ================================================================ save / load (localStorage, autosave every 10 s + on hide)
  private saveT = 0; private noSave = false;
  private saveData() {
    const S = this.S, mods: Record<string, any> = {}, seen = new Set<any>();
    for (const id in this.host.modules) {
      const m: any = this.host.modules[id]; if (!m || seen.has(m) || typeof m.save !== 'function') continue; seen.add(m);
      try { mods[id] = m.save(); } catch (e) { this.modError(id, 'save', e); }
    }
    return { v: 1, at: Date.now(), level: S.level, res: S.res, earned: S.earned, seen: S.seen, skills: S.skills, resourcesVisible: S.resourcesVisible,
      time: S.time, totemPole: this.totemPole, tut: this.tutorial.step === 'story' ? this.tutorial.prevStep : this.tutorial.step, mods };
  }
  writeSave() {
    if (this.noSave || !this.S.started) return;
    try { sys.localStorage.setItem(SAVE_KEY, JSON.stringify(this.saveData())); this.saveCache = undefined; } catch (e) { /* storage full / unavailable */ }
  }
  private readSave(): any {
    try { const v = sys.localStorage.getItem(SAVE_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  private saveCache: any = undefined;
  hasSave() { if (this.saveCache === undefined) this.saveCache = this.readSave(); return !!(this.saveCache && this.saveCache.v === 1); }
  /** title screen "Continue": restore the saved run (core state + every module's load()) */
  continueGame() {
    const d = this.readSave(); if (!d || d.v !== 1) { this.beginGame(); return; }
    const S = this.S;
    for (const k of ['res', 'earned', 'skills']) for (const id in d[k] || {}) if (typeof d[k][id] === 'number') S[k][id] = d[k][id];
    for (const id in d.seen || {}) S.seen[id] = !!d.seen[id];
    for (const id in S.res) { if (typeof S.pending[id] !== 'number') S.pending[id] = 0; if (typeof S.earned[id] !== 'number') S.earned[id] = 0; }
    S.resourcesVisible = !!d.resourcesVisible; S.time = d.time || 0;
    this.totemPole = Array.isArray(d.totemPole) ? d.totemPole.slice() : [];
    this.debugSetLevel(Math.max(0, Math.min(TOWERS.length, d.level | 0)));
    if (S.level === 0) S.wizardArea = 'initial';
    if (d.tut && d.tut !== 'none' && d.tut !== 'story') this.tutorial.step = d.tut;
    this.camHome();   // first, so a module's load() / onTowerBuilt camFocus wins
    for (const id in d.mods || {}) {
      const m: any = this.host.modules[id]; if (!m || typeof m.load !== 'function') continue;
      try { m.load(d.mods[id]); } catch (e) { this.modError(id, 'load', e); }
    }
    this.notifyTowerBuilt(S.level);
    this.toast('Welcome back');
  }
  /** dev panel: delete every tw_ save (not the audio prefs) and restart the scene on a fresh run */
  wipeSave() {
    this.noSave = true;
    try {
      const ls: any = sys.localStorage, keys: string[] = [];
      for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith('tw_') && k !== AUDIO_KEY) keys.push(k); }
      for (const k of keys) ls.removeItem(k);
    } catch (e) { /* ignore */ }
    const sc = director.getScene(); director.loadScene(sc ? sc.name : 'main');
  }
  private updateAutosave(dt: number) {
    if (!this.S.started) return;
    this.saveT += dt;
    if (this.saveT >= 10) { this.saveT = 0; this.writeSave(); }
  }

  // ================================================================ tower helpers (screen shake, placeholder growth, dev jumps)
  shakeT = 0; shakeAmp = 0;
  // DevPanel compatibility: g.siege / g.prestige are the modules now
  get siege(): any { return this.host ? this.host.modules.siege : null; }
  get prestige(): any { return this.host ? this.host.modules.prestige : null; }
  // towers 5 / 6 without their own art: tower_3 with extra storeys copied from its trunk
  private drawTowerImg(tr: any) {
    const D = this.D, x = Math.round(tr.x + 0.5);
    if (!tr.grow) { D.img(tr.img, x, tr.y); return; }
    const [w, h0] = D.size(tr.img), cut = 400, rep = 40;   // rows 360-400 are plain trunk
    D.part(tr.img, 0, 0, w, cut, x, tr.y, w, cut);
    for (let k = 0; k < tr.grow; k += rep) { const hh = Math.min(rep, tr.grow - k); D.part(tr.img, 0, cut - rep, w, hh, x, tr.y + cut + k, w, hh); }
    D.part(tr.img, 0, cut, w, h0 - cut, x, tr.y + cut + tr.grow, w, h0 - cut);
  }
  // DevPanel / siege jumps: put the tower at `level` instantly (no build animation), tutorial finished
  debugSetLevel(level: number) {
    const S = this.S;
    S.started = true; S.building = null; this.cam.inputEnabled = true; this.orbPickable = true;
    S.level = level; this.shownTowerLevel = level;
    const o = this.orbPosFor(level); S.orb.x = o[0]; S.orb.y = o[1];
    if (S.wizardArea === 'initial') S.wizardArea = 'orb';
    this.tutorial.step = 'end'; this.tutorial.visible = false;
  }

  // ================================================================ world rendering
  private drawWorld() {
    const D = this.D, S = this.S, cam = this.cam;
    D.resetTransform();
    // sky: a vertical gradient strip (sky.png) stretched over the screen when the art provides one
    this.sky.drawBack(D, cam);   // sky, stars, sun/moon, clouds, boss vortex, hills (Sky.ts)
    D.setTransform(cam.zoom, W / 2 - cam.x * cam.zoom, H / 2 - cam.y * cam.zoom);
    D.setTint(this.sky.tint());
    this.modDraw('drawWorldBack');   // module walls / islands / buildings behind the tower
    D.setTint(null);
    const bob = 2 * Math.sin(S.orb.phase);
    // press feedback: the orb squishes in ~10% while a finger holds it
    const sz = Math.round(28 * (1 - 0.1 * this.orbSquish));
    const ox = Math.round(S.orb.x - sz / 2 + 0.5), oy = Math.round(S.orb.y - sz / 2 + 0.5 + bob);
    D.part('orb', 0, 0, 28, 28, ox, oy, sz, sz);
    if (S.activeArea === 'orb') D.part('portal_outline', 0, 0, 28, 28, ox, oy, sz, sz);
    D.setTint(this.sky.tint());   // the world follows the time of day (orb stays untinted)
    for (const s of this.spirits) D.img('spirit', Math.round(S.orb.x + s.r * Math.cos(s.a) - 1.5), Math.round(S.orb.y + s.r * Math.sin(s.a) - 1.5));
    for (const c of this.cloudlings) D.img('cloudling', Math.round(S.orb.x + c.r * Math.cos(c.a) - 3), Math.round(S.orb.y + c.r * Math.sin(c.a) - 3.5), { flipX: Math.cos(c.a) > 0 });
    for (const b of this.balls) D.img('cloudling_ball', Math.round(S.orb.x + b.x - 1.5), Math.round(S.orb.y + b.y - 1.5));
    const tr = this.towerHidden ? null : this.towerRect(this.shownTowerLevel);
    if (tr) {
      this.drawTowerImg(tr);
      if (S.activeArea === 'study' && tr.def.study) D.img('study_area_outline', Math.round(tr.x + tr.def.study[0] - 14.5), Math.round(tr.y + tr.def.study[1] - 43.5 + 0.5));
    }
    this.drawForest();
    this.sky.drawGround(D, cam, GROUND);
    const casting = this.castTimer > 0;
    for (const wz of this.wizardPositions()) {
      if (wz.id !== S.wizardArea) continue;
      if (wz.float) D.img(casting ? 'wizard_floating_cast' : 'wizard_floating', Math.round(wz.x - 4.5), Math.round(wz.y - 5.5 + Math.sin(S.time * 2)));
      else D.img(casting ? 'wizard_cast' : 'wizard', Math.round(wz.x - 4.5), Math.round(wz.y - 4.5 + 0.5));
    }
    for (const f of this.flyingSpirits) D.img('bright_spirit', Math.round(f.x - 1.5), Math.round(f.y - 1.5));
    for (const e of this.effects) {
      const f = FX[e.type], [, ih] = D.size(f.img), fr = Math.min(f.frames - 1, Math.floor(e.t / e.life * f.frames));
      D.part(f.img, fr * f.fw, 0, f.fw, ih, Math.round(e.x - f.fw / 2), Math.round(e.y - ih / 2), f.fw, ih);
    }
    this.modDraw('drawWorld');   // module characters / projectiles in front of the tower
    const B = S.building; // tower-build blocks on top of the world (scaled up for the tall towers, see buildTower)
    if (B) for (const b of B.blocks) {
      if (!b.spawned || B.t > b.life) continue;
      const img = B.t > b.life - 0.7 ? B.blockWhite : B.block, [iw, ih] = D.size(img), k = B.bs || 1;
      D.part(img, 0, 0, iw, ih, Math.round(b.x), Math.round(b.y), iw * k, ih * k);
    }
    D.setTint(null);
    D.resetTransform();
    for (const ind of this.indicators) { // WorldIndicatorLabel: scale 0.5, exponential ease-out, then hide
      const k = easeOutExpo(ind.t / ind.time), [sx, sy] = this.toScreen(ind.x, ind.y + ind.dy * k), s = 0.5 * cam.zoom;
      D.part(ind.icon, 0, 0, 10, 10, Math.round(sx), Math.round(sy), 10 * s, 10 * s);
      D.text(ind.text, Math.round(sx + 11 * s), Math.round(sy), COL.white, 10, 'left', { scale: s });
    }
  }
  private decideActiveArea() {
    const S = this.S;
    if (S.building || !S.started) { S.activeArea = ''; return; }
    const [wx, wy] = this.toWorld(this.mouse.x, this.mouse.y), prev = S.activeArea;
    const overUi = (S.activeArea === 'orb' && this.inRect(this.orbUiRect)) || (S.activeArea === 'study' && this.inRect(this.studyUiRect)) || (S.activeArea === 'forestry' && this.inRect(this.forestryUiRect))
      || (!!this.modUi[S.activeArea] && this.inRect(this.modUi[S.activeArea]));
    let mh: GameModule | null = null;
    const hover = !MOBILE || (this.mouse.down && !this.mouse.uiHit);   // touch: no hover once the finger is up
    if (overUi) { /* keep */ }
    else if (this.mouse.down && this.mouse.cast) { /* swipe-casting: keep whatever panel is open */ }
    else if (hover && !this.mouse.dragging && this.overOrb(wx, wy) && this.orbPickable) S.activeArea = 'orb';
    else if (hover && !this.mouse.dragging && this.overStudy(wx, wy)) S.activeArea = 'study';
    else if (hover && !this.mouse.dragging && (this.overForestryArea(wx, wy) || this.overForest(wx, wy))) S.activeArea = 'forestry';
    else if (hover && !this.mouse.dragging && (mh = this.modAt(wx, wy))) S.activeArea = mh.id;
    else if (S.navigated) S.activeArea = S.navigated;
    else S.activeArea = '';
    if (this.mouse.dragging) S.navigated = '';
    if (S.activeArea !== prev) {
      if (S.activeArea === 'orb') { this.wobbleT = this.canAffordTower() ? 0 : -1; this.switchWizard('orb'); }
      if (S.activeArea === 'study') { this.switchWizard('study'); if (S.newArea === 'study') S.newArea = ''; }
      else if (S.activeArea === 'forestry' || this.host.modules[S.activeArea]) this.switchWizard(S.activeArea);
    }
  }
  private render() {
    const D = this.D, S = this.S;
    this.hitRegions = []; this.tooltip = null; this.frameNo++;
    D.begin();
    // screen shake (wall breaks, curse hits): nudge the camera for the world pass only
    const shk = this.shakeAmp * Math.min(1, this.shakeT * 4), shx = rand(-shk, shk) / this.cam.zoom, shy = Math.min(rand(-shk, shk) / this.cam.zoom, FLOOR_Y - floorHalf() / this.cam.zoom - this.cam.y);   // shake never dips below the floor
    this.cam.x += shx; this.cam.y += shy;
    this.drawWorld();
    this.cam.x -= shx; this.cam.y -= shy;
    this.drawCastFx();
    if (S.started) {
      this.decideActiveArea();
      this.drawResources();
      this.drawGoal();
      if (S.activeArea === 'orb') this.drawOrbUI(); else this.orbUiRect = null;
      if (S.activeArea === 'study') this.drawStudyUI(); else this.studyUiRect = null;
      if (S.activeArea === 'forestry') this.drawForestryUI(); else this.forestryUiRect = null;
      this.drawModulePanels();
      this.drawModuleHud();
      this.drawHudButtons();
      this.drawAudioButtons();
      for (const ind of this.uiIndicators) {
        const k = easeOutExpo(ind.t / ind.time);
        D.img(ind.icon, Math.round(ind.x), Math.round(ind.y + ind.dy * k));
        D.text(ind.text, ind.x + 11, ind.y + ind.dy * k);
      }
      this.drawTutorial();
      this.drawTooltip();
      this.overlayFrom = this.hitRegions.length; this.modDraw('overlay');   // full-screen module UI (prestige) above everything
      if (S.level === 0 && !this.tutorial.visible && S.activeArea !== 'orb' && S.res.magic === 0) {
        const [sx, sy] = this.toScreen(S.orb.x, S.orb.y - 22);
        D.text('swipe anywhere to cast', sx, sy - 4 + Math.sin(S.time * 3), this.sky.textColor(), 10, 'center');
      }
      if (this.toastT > 0) {
        const below = this.goalRect || (this.resRect && S.resourcesVisible ? this.resRect : null);
        const ty = PORTRAIT ? Math.max(52, below ? below.y + below.h + 6 : 0) : 8;   // below the Resources panel
        const dark = this.sky.darkness() > 0.5 || !!(this.host.modules.siege && (this.host.modules.siege as any).active);   // walls / boss sky
        if (dark) { const tw = D.textW(this.toastMsg) + 10; D.nine('panel', Math.round(W / 2 - tw / 2), ty - 3, tw, 16); }
        D.text(this.toastMsg, W / 2, ty, dark ? COL.light : this.sky.textColor(), 10, 'center');
      }
    } else {
      // bright title: the day sky stays visible, the title sits on a panel
      const pw = 150, ph = 74, px = Math.round(W / 2 - pw / 2), py = Math.round(H / 2 - 50);
      D.nine('panel', px, py, pw, ph);
      D.text('Tower Wizard', W / 2, H / 2 - 40, COL.light, 12, 'center');
      if (!this.hasSave()) D.text('a Cocos rebuild', W / 2, H / 2 - 24, COL.grey, 10, 'center');
      // a saved run: Continue above; Begin keeps its place (and meaning: a new run) so taps and tests stay valid
      if (this.hasSave()) this.button('continue', 'Continue', W / 2 - 30, H / 2 - 22, 60, 16, false, () => this.continueGame());
      this.button('begin', this.hasSave() ? 'New Game' : 'Begin', W / 2 - 30, H / 2, 60, 16, false, () => this.beginGame());
      this.drawAudioButtons();
    }
    D.end();
  }
  private beginGame() {
    this.S.started = true;
    TikTok.login();   // silent login (code only; open_id needs a game server)
    if (PORTRAIT) { const f = this.orbFocus(); this.cam.x = f[0]; this.cam.y = f[1]; this.clampCam(); }
    let skip = false;
    for (const m of this.mods) if (m.skipIntro) { try { skip = skip || !!m.skipIntro(); } catch (e) { this.modError(m.id, 'skipIntro', e); } }
    if (skip) { this.tutorial.step = 'end'; this.orbPickable = true; this.cam.inputEnabled = true; }
    else {
      this.tutorial.step = 't0'; this.orbPickable = false; this.cam.inputEnabled = false;
      this.showTut('Hi there, wizard! I am The Orb. Got any magic for me?', 'Perhaps');
    }
    this.runStarted();
  }
}
