// Contract between the host (TowerWizardGame.ts) and feature modules (one file per area/system).
// Feature sessions write modules against this file only; the host side is implemented by the core session.
// A module self-registers at import time:  registerModule(new AlchemyModule());
// The host also imports every module file via `assets/scripts/modules/index.ts` (one line per module).
import type { PixelDraw } from './PixelDraw';

export type ResId = string;                     // 'magic' | 'knowledge' | 'spirits' | 'wood' | 'totems' | module-defined ids

export interface SkillDef {
  list: string;                                 // panel list id (a module may own several lists)
  name: string;
  res: ResId;                                   // currency
  cost: (level: number) => number;
  max: number;
  icon?: string | null;                         // art key
  unlock?: string;                              // skill id that must be >= 1 first
  unlockTower?: number;                         // tower level gate
  creates?: ResId;                              // buying adds 1 of this resource
  summon?: boolean; showLevel?: boolean; showCost?: boolean;
  tip: () => string;                            // rich text: {magic_icon} etc.
  onBuy?: (host: GameHost, newLevel: number) => void;
  visible?: (host: GameHost) => boolean;        // extra visibility rule (e.g. a blessing that reveals it)
}

export interface TowerDef {
  level: number;                                // 1..10 (10 = final tower); cost/gate are for ascending TO this level
  img: string;                                  // art key (art-v2 if present, else original placeholder)
  cost: Record<ResId, number>;                  // compared against lifetime earned (original rule)
  orb: [number, number];                        // orb anchor relative to tower origin
  anchors?: Record<string, [number, number]>;   // named anchor points modules can ask for (study, node, ...)
  gate?: (host: GameHost) => string | null;     // extra condition: return a reason string to block building
  label?: (host: GameHost) => string | null;    // build button text instead of 'Ascend Tower' (e.g. 'Final Ascension')
}
// A module's TowerDef is merged over the host's built-in one for the same level: only the fields it sets win
// (so a module can add just { level: 8, gate } without repeating art or anchors).

export interface Multipliers { magic?: number; knowledge?: number; wood?: number; spirits?: number; damage?: number; [k: string]: number | undefined }

export interface GameHost {
  readonly S: any;                              // game state: res, level, time, navigated, activeArea, ...
  readonly D: PixelDraw;
  readonly W: number; readonly H: number;       // logical screen size (portrait W=270)
  readonly mobile: boolean; readonly portrait: boolean;
  towerLevel(): number;
  towerAnchor(name: string): [number, number] | null;   // world position of a named anchor on the current tower
  orbPos(): [number, number];
  res(id: ResId): number;
  lifetime(id: ResId): number;
  addResource(id: ResId, v: number): void;      // gains (multipliers are the caller's job, use mult())
  spend(id: ResId, v: number): boolean;
  mult(kind: string): number;                   // product of every module's multipliers() for this kind
  skillLevel(id: string): number;
  play(sound: string, db?: number, minGap?: number): void;
  addEffect(wx: number, wy: number, type: string): void;
  toast(msg: string): void;
  showStory(portrait: string | null, text: string, button?: string): void;
  toScreen(wx: number, wy: number): [number, number];
  toWorld(sx: number, sy: number): [number, number];
  camFocus(wx: number, wy: number, zoom?: number): void;
  // UI helpers (screen space): same look as the built-in panels
  button(id: string, label: string, x: number, y: number, w: number, h: number, disabled?: boolean): boolean;
  progressBar(x: number, y: number, w: number, h: number, ratio: number): void;
  drawSkillList(listId: string, title: string, x: number, y: number, w: number): number;  // returns height
  skillListHeight(listId: string): number;
  panelRect(w: number, h: number): { x: number, y: number, w: number, h: number };       // docked panel placement
  readonly fervor: number;                      // 0..1 swipe fervor
  readonly modules: Record<string, GameModule>; // other modules by id (siege, prestige, sky...)
  // core economy numbers (current, incl. totems and every multiplier) for modules that boost the base game
  cloudlingMagic(): number;                     // magic per cloudling ball
  cloudlingBurst(): void;                       // every cloudling throws one ball right now
  knowledgeReward(): number;                    // knowledge per finished spirit-tome book
  isUnlocked(id: string): boolean;              // module `id` registered and its unlockTower reached
  save(): void;                                 // write the autosave now (e.g. right before a prestige reload)
  totemCounts(): Record<string, number>;        // totems on the pole by type ('magic_totem', 'wood_totem', ...)
  setTowerLevel(level: number): void;           // jump without animation (orb, camera, modules' onTowerBuilt)
  setSkillLevel(id: string, level: number): void;   // set directly (no cost, no onBuy); totems still use the pole
  resetRun(): void;                             // prestige: wipe the run in place: core state + every module.reset(true), then onRunStart
  pointer(): { x: number, y: number, down: boolean, casting: boolean };   // screen (logical px); casting = swipe-cast in progress
  shake(px: number, dur: number): void;         // screen shake (world pass only)
  debugSetLevel(level: number): void;           // = setTowerLevel
  hideTower(on: boolean): void;                 // draw no tower while on (prestige reset animation)
  buySkill(id: string, n: number): number;      // normal paid purchase; returns how many were bought
  nextTowerCost(): Record<ResId, number> | null;    // requirements for the next ascension (lifetime totals)
}

export interface GameModule {
  id: string;
  unlockTower: number;                          // tower level that reveals it (nav button, world drawing)
  nav?: { label: string };                      // bottom nav entry; tapping it opens drawPanel + focuses worldFocus()
  available?(): boolean;                        // nav entry only while this is true (e.g. after the building exists); alias navAvailable()
  worldBounds?(): { minX?: number, maxX?: number, minY?: number, maxY?: number } | null;   // widen the camera limits (world px)
  resources?: { id: ResId, icon: string, name: string, hidden?: boolean }[];   // hidden: not listed in the Resources panel
  skills?: Record<string, SkillDef>;
  towers?: (Partial<TowerDef> & { level: number })[];   // per-level overrides merged over the host towers (gate, cost, label...)
  init?(host: GameHost): void;
  update?(dt: number): void;                    // only called once unlocked
  drawWorldBack?(D: PixelDraw): void;           // world space, before the tower (islands, buildings)
  drawWorld?(D: PixelDraw): void;               // world space, after the tower (characters, projectiles)
  drawPanel?(D: PixelDraw): { x: number, y: number, w: number, h: number } | null;  // screen space, when active
  drawHud?(D: PixelDraw): void;                 // screen space, always (small overlays)
  worldFocus?(): [number, number];              // where the camera goes when its nav button is tapped
  hitWorld?(wx: number, wy: number): boolean;   // pressing here activates this area (and holds speed it up)
  onHold?(dt: number, wx: number, wy: number): void;
  hitUi?(x: number, y: number): boolean;        // screen-space UI that must swallow touches
  onTap?(x: number, y: number): boolean;        // screen-space taps on its own UI; return true if handled
  multipliers?(): Multipliers;
  save?(): any; load?(data: any): void;
  reset?(keepPermanent: boolean): void;         // prestige: wipe run state (permanent data stays when true)
  debug?: Record<string, (...args: any[]) => void>;   // dev panel buttons
  onTowerBuilt?(level: number): void;           // after an ascension animation finishes (also on dev jumps)
  onGain?(id: ResId, v: number): void;          // every resource gain as it is credited (after the producer's multipliers)
  onRunStart?(): void;                          // a run began: new game, after host.resetRun() (prestige), not on Continue
  skipIntro?(): boolean;                        // true -> beginGame skips the intro tutorial (later prestige runs)
  overlay?(D: PixelDraw): void;                 // screen space, drawn LAST (above tutorial + tooltips); its hitUi is tested first
  onOrbClick?(sx: number, sy: number, fervor01: number): void;   // every orb click (tap or swipe-cast); screen pos of the finger
  // override the build button while the tower is at `level` (siege: 9 -> 'Fire Magic Beam' / 'The Final Ascension'):
  // label, shown cost rows, disabled, reason (tooltip); onPress replaces the ascension when given, otherwise the
  // normal build runs (TOWER_COSTS lifetime check + gates still apply)
  towerButton?(level: number): { label: string, cost?: Record<ResId, number>, disabled?: boolean, reason?: string, onPress?: () => void } | null;
}

const registry: GameModule[] = [];
export function registerModule(m: GameModule) { if (!registry.find(r => r.id === m.id)) registry.push(m); }
export function getModules(): GameModule[] { return registry; }
