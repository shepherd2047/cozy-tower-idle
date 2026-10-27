// Minimal stand-in for Cocos' 'cc' module so module files run under Bun/Node (no engine, no browser).
const store = new Map<string, string>();
export const sys = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  },
  isMobile: true, platform: 'TEST',
};
export class ImageAsset { width = 16; height = 16; }
export const resources = {
  load: (_p: any, _t: any, cb?: any) => { const f = typeof _t === 'function' ? _t : cb; f && f(null, new ImageAsset()); },
  loadDir: (_p: any, _t: any, cb?: any) => { const f = typeof _t === 'function' ? _t : cb; f && f(null, []); },
  get: () => null, getDirWithPath: () => [],
};
export const director = { loadScene: (_n: string, cb?: () => void) => { cb && cb(); }, getScene: () => null, on() {}, off() {} };
export const game = { on() {}, off() {} };
export const Game = { EVENT_HIDE: 'hide', EVENT_SHOW: 'show' };
export const js = { getClassName: (o: any) => o?.constructor?.name ?? '' };
const anyProxy: any = new Proxy(function () {}, { get: () => anyProxy, apply: () => anyProxy, construct: () => anyProxy });
export const _decorator = { ccclass: () => (c: any) => c, property: () => () => {} };
export const Node = anyProxy, Sprite = anyProxy, Label = anyProxy, SpriteFrame = anyProxy, Texture2D = anyProxy,
  UITransform = anyProxy, Color = anyProxy, Vec3 = anyProxy, Component = class {}, AudioSource = anyProxy, AudioClip = anyProxy,
  input = anyProxy, Input = anyProxy, view = anyProxy, Asset = anyProxy, BitmapFont = anyProxy, Graphics = anyProxy, profiler = anyProxy;
