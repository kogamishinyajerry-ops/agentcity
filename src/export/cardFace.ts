// ============================================================================
// cardFace — the SINGLE source of every VISIBLE string on a 作品 card, feeding
// the renderer (cardSvg) and the verifier's per-field DIAGNOSTICS (cardProvenance).
// NOTE: the airtight forgery guarantee is NOT here — it is cardProvenance's
// whole-card re-render equality (the per-field id checks only see tagged elements
// and so cannot catch an EXTRA/un-id'd visible element). cardFace just keeps the
// human-friendly "卡面步数 卡面=X 应为=Y" diagnostics honest by deriving them from
// the same PanelModel the renderer uses.
//
// Pure + presentation-free of colour/layout: just the canonical text content.
// ============================================================================
import type { PanelModel } from '../tui/viewModel.ts';
import { STAT_SHORT } from '../model/tally.ts';

export { STAT_SHORT }; // re-exported for callers that already source it from cardFace

/** Collapse whitespace + clip to n chars with an ellipsis (visible-string form). */
export function clipFace(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

// The wish is the card's 「认领」 anchor — what the human actually asked for — so it
// gets up to two wrapped lines on the card (≈2×32 chars) instead of one clipped
// fragment. Bound by the whole-card re-render gate like everything else.
export const WISH_CLIP = 64;

/** The canonical visible strings of a card. Whatever appears on the SVG face for
 *  these fields MUST equal these exactly (verifyCard re-derives + compares). */
export interface CardFace {
  /** Clipped wish as displayed; '' when the run has no opening wish (no line). */
  wish: string;
  /** The hero numeral, as a plain string (no thousands separators). */
  hero: string;
  /** The 「包括 …」 subset line. */
  include: string;
  /** The duration text. */
  dur: string;
}

export function cardFace(model: PanelModel): CardFace {
  const fin = model.finale;
  return {
    wish: model.intent ? clipFace(model.intent, WISH_CLIP) : '',
    hero: String(model.laborSteps),
    include: '包括 ' + (fin?.stats ?? []).map((s) => `${s.value}${STAT_SHORT[s.key] ?? s.key}`).join('·'),
    dur: fin?.duration ?? model.duration ?? '',
  };
}
