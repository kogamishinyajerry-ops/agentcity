// ============================================================================
// bars — pure horizontal-bar rendering for the TUI instrument panel.
// ----------------------------------------------------------------------------
// A value→block-string scaler using Unicode eighth-blocks for sub-cell
// precision. Pure + node-safe so it unit-tests without a terminal. NO color
// here — color is the App's job (and the RED-only-for-error contract lives in
// the view-model, never in a bar's length).
// ============================================================================

const EIGHTHS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const;

/**
 * Render `value` as a bar of at most `width` cells, scaled against `max`.
 * Any positive value renders at least a sliver (▏) so a real-but-small count is
 * never invisible — honesty: if it happened, it shows.
 */
export function barString(value: number, max: number, width: number): string {
  if (max <= 0 || width <= 0 || value <= 0) return '';
  const units = Math.min((value / max) * width, width);
  const fulls = Math.floor(units);
  let s = '█'.repeat(fulls);
  if (fulls < width) {
    const idx = Math.round((units - fulls) * 8);
    if (idx > 0) s += EIGHTHS[Math.min(idx, 7)];
    else if (fulls === 0) s += EIGHTHS[1]; // tiny-but-real → minimum sliver
  }
  return s;
}
