// ============================================================================
// cardFace — the SINGLE source of every VISIBLE string on a 作品 card. Both the
// renderer (cardSvg) and the verifier (cardProvenance) derive the face from the
// SAME PanelModel here, so the verifier can re-render the face from the transcript
// and assert the SVG displays EXACTLY those strings. That binding is what makes
// the whole visible surface — not just the hero numeral — unforgeable: editing
// the wish / duration / 「包括」 line / seal fingerprint in a card without
// re-deriving from the real transcript makes verifyCard fail.
//
// Pure + presentation-free of colour/layout: just the canonical text content.
// ============================================================================
import type { PanelModel } from '../tui/viewModel.ts';

export const STAT_SHORT: Record<string, string> = {
  reads: '读',
  edits: '改',
  writes: '写',
  commands: '命令',
  helpers: '帮手',
  errors: '报错没停',
  wipes: '清洗',
};

/** Collapse whitespace + clip to n chars with an ellipsis (visible-string form). */
export function clipFace(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

export const WISH_CLIP = 28;

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
