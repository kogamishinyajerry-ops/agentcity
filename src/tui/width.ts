// ============================================================================
// width — terminal display width (East-Asian / fullwidth glyphs occupy 2 cols)
// + a width-aware clip, so CJK content respects a fixed column instead of
// silently overflowing it (char-count clipping can't, since 愿 is 1 char but
// 2 columns). Pure + node-safe.
// ============================================================================
export function colWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const wide =
      c >= 0x1100 &&
      (c <= 0x115f || // Hangul Jamo
        c === 0x2329 ||
        c === 0x232a ||
        (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) || // CJK radicals … Yi
        (c >= 0xac00 && c <= 0xd7a3) || // Hangul syllables
        (c >= 0xf900 && c <= 0xfaff) || // CJK compat ideographs
        (c >= 0xfe30 && c <= 0xfe4f) || // CJK compat forms
        (c >= 0xff00 && c <= 0xff60) || // fullwidth forms
        (c >= 0xffe0 && c <= 0xffe6)); // fullwidth signs
    w += wide ? 2 : 1;
  }
  return w;
}

export function clipCols(s: string, maxCols: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (colWidth(t) <= maxCols) return t;
  let w = 0;
  let out = '';
  for (const ch of t) {
    const cw = colWidth(ch);
    if (w + cw > maxCols - 1) break; // reserve 1 col for the ellipsis
    w += cw;
    out += ch;
  }
  return out + '…';
}
