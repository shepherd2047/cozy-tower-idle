// Glyph advances of the bitmap fonts in assets/resources/fonts (Ark Pixel 10px / 12px, OFL; see LICENSE-ark-pixel.txt),
// for ASCII 32..126, copied from the xadvance values in fpf10.fnt / fpf12.fnt. No 'cc' import, so the Bun test kit can
// use it too. PixelDraw.textW prefers the advances of the loaded .fnt and only falls back to these tables before the
// fonts are loaded; if the fonts are regenerated, update these rows to keep the fallback (and the tests) exact.
const ADV10 = [5, 4, 6, 6, 6, 8, 7, 4, 6, 6, 6, 6, 4, 6, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 6, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 4, 5, 6, 5, 8, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 8, 6, 6, 6, 6, 5, 6, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 5, 4, 6, 5, 5, 5, 5, 4, 5, 5, 5, 6, 6, 6, 6, 5, 7, 4, 7, 6];
const ADV12 = [6, 4, 6, 7, 6, 8, 7, 4, 6, 6, 6, 6, 4, 6, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 4, 4, 5, 6, 5, 6, 8, 8, 7, 7, 7, 7, 7, 7, 7, 4, 6, 7, 6, 8, 7, 8,
  7, 8, 7, 7, 8, 7, 8, 10, 8, 8, 7, 6, 6, 6, 6, 6, 5, 6, 6, 6, 6, 6, 5, 6, 6, 4, 4, 6, 4, 8, 6, 6, 6, 6, 5, 6, 5, 6, 6, 8, 6, 6, 6, 7, 4, 7, 6];

/** width in logical px of `str` drawn at `size` (10 or 12) with the built-in advance tables */
export function textWidth(str: string, size = 10): number {
  const t = size === 12 ? ADV12 : ADV10, q = t[63 - 32];
  let w = 0;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i) - 32; w += c >= 0 && c < t.length ? t[c] : q; }
  return w;
}
