// Immediate-mode pixel renderer on top of pooled Cocos nodes.
// Each draw call claims the next pooled slot, so draw order == sibling order, matching the canvas version.
// All coordinates are logical screen pixels: origin top-left, y down, W x H (H = 360).
import { BitmapFont, Color, ImageAsset, Label, Node, Rect, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import { textWidth } from './FontMetrics';

// tint: per-call multiply colour ('#rrggbb'); overrides the global tint set with setTint() (img/part only)
export interface DrawOpts { flipX?: boolean; alpha?: number; rot?: number; pivot?: [number, number]; scale?: number; tint?: string; }

interface Slot { node: Node; spr: Node; lab: Node; sprite: Sprite; label: Label; mode: 0 | 1 | 2; str: string; font: string; }

const WHITE_KEY = '__white';

export class PixelDraw {
  W = 640; H = 360;
  private root: Node;
  private slots: Slot[] = [];
  private used = 0;
  private textures: Record<string, Texture2D> = {};
  private sizes: Record<string, [number, number]> = {};
  private frames: Record<string, SpriteFrame> = {};
  private fonts: Record<string, BitmapFont> = {};
  private adv: Record<string, number[]> = {};   // per-font xadvance by char code, read from the loaded .fnt
  private s = 1; private tx = 0; private ty = 0;   // current transform (uniform scale + translate)
  private tmpColor = new Color();
  private tintC = new Color(255, 255, 255, 255); private tintOn = false;   // global multiply tint for img()/part()

  /** multiply colour for subsequent img()/part() calls (not rect/nine/text); null or '#ffffff' = off */
  setTint(hex: string | null) {
    this.tintOn = !!hex && hex.toLowerCase() !== '#ffffff';
    if (this.tintOn) Color.fromHEX(this.tintC, hex!);
  }

  constructor(root: Node) { this.root = root; this.makeWhite(); }

  addImage(name: string, img: ImageAsset) {
    const t = new Texture2D();
    t.image = img;
    t.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
    t.setMipFilter(Texture2D.Filter.NONE);
    t.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
    this.textures[name] = t;
    this.sizes[name] = [img.width, img.height];
  }
  addFont(name: string, f: BitmapFont) {
    const tex = f.spriteFrame && f.spriteFrame.texture as Texture2D;
    if (tex && tex.setFilters) tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
    this.fonts[name] = f;
    const defs: any = (f as any).fntConfig && (f as any).fntConfig.fontDefDictionary;
    if (defs) { const a: number[] = []; for (const k in defs) a[+k] = defs[k].xAdvance; this.adv[name] = a; }
  }
  /** registers `name` as another key for an already added image (same texture, no extra GPU memory) */
  alias(name: string, src: string) { if (this.textures[src]) { this.textures[name] = this.textures[src]; this.sizes[name] = this.sizes[src]; } }
  /** asked for an image that is not loaded yet (lazy original art): the game loads it and calls addImage later */
  onMissing: ((name: string) => void) | null = null;
  private miss(name: string) { if (this.onMissing && name) this.onMissing(name); }
  has(name: string) { if (this.textures[name]) return true; this.miss(name); return false; }
  size(name: string): [number, number] { const s = this.sizes[name]; if (s) return s; this.miss(name); return [0, 0]; }

  private makeWhite() {
    const t = new Texture2D();
    t.reset({ width: 2, height: 2, format: Texture2D.PixelFormat.RGBA8888 });
    t.uploadData(new Uint8Array(16).fill(255));
    t.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
    this.textures[WHITE_KEY] = t; this.sizes[WHITE_KEY] = [2, 2];
  }

  private frame(name: string, sx: number, sy: number, sw: number, sh: number, sliced = false): SpriteFrame {
    const key = `${name}|${sx}|${sy}|${sw}|${sh}|${sliced ? 1 : 0}`;
    let f = this.frames[key];
    if (!f) {
      f = new SpriteFrame();
      f.packable = false;
      f.texture = this.textures[name];
      f.rect = new Rect(sx, sy, sw, sh);
      if (sliced) { f.insetLeft = 1; f.insetTop = 1; f.insetRight = 1; f.insetBottom = 1; }
      this.frames[key] = f;
    }
    return f;
  }

  setTransform(s: number, tx: number, ty: number) { this.s = s; this.tx = tx; this.ty = ty; }
  resetTransform() { this.s = 1; this.tx = 0; this.ty = 0; }

  begin() { this.used = 0; }
  end() {
    for (let i = this.used; i < this.slots.length; i++) if (this.slots[i].mode !== 0) { this.slots[i].node.active = false; this.slots[i].mode = 0; }
  }

  private slot(): Slot {
    let s = this.slots[this.used];
    if (!s) {
      const node = new Node('s' + this.used); node.layer = this.root.layer; node.addComponent(UITransform).setAnchorPoint(0, 1);
      const spr = new Node('spr'); spr.layer = this.root.layer; spr.addComponent(UITransform).setAnchorPoint(0, 1);
      const sprite = spr.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.trim = false;
      const lab = new Node('lab'); lab.layer = this.root.layer; lab.addComponent(UITransform).setAnchorPoint(0, 1);
      const label = lab.addComponent(Label);
      label.overflow = Label.Overflow.NONE; label.horizontalAlign = Label.HorizontalAlign.LEFT; label.verticalAlign = Label.VerticalAlign.TOP;
      label.cacheMode = Label.CacheMode.NONE;
      node.addChild(spr); node.addChild(lab); this.root.addChild(node);
      s = { node, spr, lab, sprite, label, mode: 0, str: '', font: '' };
      this.slots.push(s);
    }
    this.used++;
    return s;
  }

  // place slot so its top-left is at logical (x, y), optionally rotated around a pivot
  private place(s: Slot, x: number, y: number, o?: DrawOpts) {
    let ang = 0;
    if (o && o.rot) {
      const [px, py] = o.pivot!, c = Math.cos(o.rot), sn = Math.sin(o.rot), dx = x - px, dy = y - py;
      x = px + dx * c - dy * sn; y = py + dx * sn + dy * c; ang = -o.rot * 180 / Math.PI;
    }
    s.node.active = true;
    s.node.setPosition(x - this.W / 2, this.H / 2 - y, 0);
    s.node.angle = ang;
  }

  private useSprite(s: Slot) {
    if (s.mode !== 1) { s.spr.active = true; s.lab.active = false; s.mode = 1; }
  }

  // drawImage(name, dx, dy) or with a source rect and destination size
  img(name: string, dx: number, dy: number, o?: DrawOpts) {
    const [w, h] = this.sizes[name] || [0, 0];
    this.part(name, 0, 0, w, h, dx, dy, w, h, o);
  }
  part(name: string, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, o?: DrawOpts) {
    if (!this.textures[name]) { this.miss(name); return; }
    const s = this.slot(); this.useSprite(s);
    const X = this.tx + dx * this.s, Y = this.ty + dy * this.s, Wd = dw * this.s, Hd = dh * this.s;
    this.place(s, X, Y, o);
    s.sprite.type = Sprite.Type.SIMPLE;
    const f = this.frame(name, sx, sy, sw, sh);
    if (s.sprite.spriteFrame !== f) s.sprite.spriteFrame = f;
    s.spr.getComponent(UITransform)!.setContentSize(Wd, Hd);
    if (o && o.flipX) { s.spr.setScale(-1, 1, 1); s.spr.setPosition(Wd, 0, 0); } else { s.spr.setScale(1, 1, 1); s.spr.setPosition(0, 0, 0); }
    const a = Math.round(255 * (o && o.alpha !== undefined ? o.alpha : 1));
    if (o && o.tint) { Color.fromHEX(this.tmpColor, o.tint); this.tmpColor.a = a; }
    else if (this.tintOn) this.tmpColor.set(this.tintC.r, this.tintC.g, this.tintC.b, a);
    else this.tmpColor.set(255, 255, 255, a);
    s.sprite.color = this.tmpColor;
  }
  nine(name: string, x: number, y: number, w: number, h: number, o?: DrawOpts) {
    if (!this.textures[name]) { this.miss(name); return; }
    const s = this.slot(); this.useSprite(s);
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    this.place(s, x, y, o);
    s.sprite.type = Sprite.Type.SLICED;
    const [iw, ih] = this.sizes[name];
    const f = this.frame(name, 0, 0, iw, ih, true);
    if (s.sprite.spriteFrame !== f) s.sprite.spriteFrame = f;
    s.spr.getComponent(UITransform)!.setContentSize(w, h);
    s.spr.setScale(1, 1, 1); s.spr.setPosition(0, 0, 0);
    this.tmpColor.set(255, 255, 255, 255); s.sprite.color = this.tmpColor;
  }
  rect(color: string, x: number, y: number, w: number, h: number, alpha = 1) {
    const s = this.slot(); this.useSprite(s);
    this.place(s, x, y);
    s.sprite.type = Sprite.Type.SIMPLE;
    const f = this.frame(WHITE_KEY, 0, 0, 2, 2);
    if (s.sprite.spriteFrame !== f) s.sprite.spriteFrame = f;
    s.spr.getComponent(UITransform)!.setContentSize(w, h);
    s.spr.setScale(1, 1, 1); s.spr.setPosition(0, 0, 0);
    Color.fromHEX(this.tmpColor, color); this.tmpColor.a = Math.round(255 * alpha);
    s.sprite.color = this.tmpColor;
  }
  // proportional pixel fonts (Ark Pixel 10px / 12px baked into fpf10 / fpf12): width = sum of the .fnt xadvances;
  // before the fonts are loaded, FontMetrics' copy of the same table is used
  textW(str: string, size = 10) {
    const a = this.adv[size === 12 ? 'fpf12' : 'fpf10'];
    if (!a) return textWidth(str, size);
    const q = a[63] || 5; let w = 0;
    for (let i = 0; i < str.length; i++) { const v = a[str.charCodeAt(i)]; w += v === undefined ? q : v; }
    return w;
  }
  text(str: string, x: number, y: number, color = '#ffffff', size = 10, align: 'left' | 'center' = 'left', o?: DrawOpts) {
    const scale = o && o.scale ? o.scale : 1;
    if (align === 'center') x -= this.textW(str, size) * scale / 2;
    const s = this.slot();
    if (s.mode !== 2) { s.spr.active = false; s.lab.active = true; s.mode = 2; }
    this.place(s, Math.round(x), Math.round(y), o);
    const fontName = size === 12 ? 'fpf12' : 'fpf10';
    if (s.font !== fontName) { s.label.font = this.fonts[fontName]; s.label.fontSize = size; s.label.lineHeight = size === 12 ? 14 : 12; s.font = fontName; }
    if (s.str !== str) { s.label.string = str; s.str = str; }
    s.lab.setScale(scale, scale, 1);
    Color.fromHEX(this.tmpColor, color); s.label.color = this.tmpColor;
  }
}
