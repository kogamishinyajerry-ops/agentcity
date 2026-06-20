// ============================================================================
// bignum — render a number as a 3-row block "big number" for the 作品 card.
// ----------------------------------------------------------------------------
// Pure + node-safe (no Ink, no color — color is the card's job). The card's one
// focal element is the labor count; a terminal has no font-size, so we draw the
// digits as 3-row half-block glyphs. Honesty note: this only RESTYLES a number
// the view-model already derived — it never computes or fakes a value.
// ============================================================================

/** 3-row half-block glyphs, width 3 each, joined by a single column of space. */
const GLYPH: Record<string, readonly [string, string, string]> = {
  '0': ['█▀█', '█ █', '█▄█'],
  '1': [' █ ', ' █ ', ' █ '],
  '2': ['▀▀█', '▄▀▀', '█▄▄'],
  '3': ['▀▀█', ' ▀█', '▀▀█'],
  '4': ['█ █', '█▄█', '  █'],
  '5': ['█▀▀', '▀▀█', '▀▀▀'],
  '6': ['█▀▀', '█▀█', '█▄█'],
  '7': ['▀▀█', '  █', '  █'],
  '8': ['█▀█', '█▀█', '█▄█'],
  '9': ['█▀█', '▀▀█', '▄▄█'],
};

const BLANK: readonly [string, string, string] = ['   ', '   ', '   '];

/** Render `s` (a count, e.g. "611") as three equal-length rows of block art. */
export function bigNumber(s: string): [string, string, string] {
  const rows: [string, string, string] = ['', '', ''];
  [...s].forEach((ch, i) => {
    const g = GLYPH[ch] ?? BLANK;
    const gap = i === 0 ? '' : ' ';
    rows[0] += gap + g[0];
    rows[1] += gap + g[1];
    rows[2] += gap + g[2];
  });
  return rows;
}
