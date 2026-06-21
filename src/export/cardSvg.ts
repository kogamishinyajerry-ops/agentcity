// ============================================================================
// cardSvg — render the 作品 card as a shareable SVG poster (pure, zero-dep).
// ----------------------------------------------------------------------------
// The TUI card (WorkCard) is block-art because a terminal has no font-size; an
// SVG has real type, so here the hero count is a clean large numeral. Same
// honest PanelModel feeds both — this is a RESTYLE of derived data across a
// second render seam, never a new computation. Honesty rules are preserved:
//   • hero = panel laborSteps (Σ bars)            • 「包括」is a labelled subset
//   • 你亲手 0 is structurally true                • errors are NOT alarm-red
//   • label = "步" (laborSteps = Σ isUsageEvent ops, not pure tool-calls)
//
// Verifiability: the headline claims come from cardFace() and each carries a
// stable id (ac-wish/ac-hero/ac-include/ac-dur/ac-seal) for friendly per-field
// diagnostics. The "一路走来" journey beats come from the model (storyArc →
// transcript-derived) and are NOT individually id'd — they (and every other pixel)
// are bound by verifyCard's WHOLE-CARD re-render equality gate: renderCardSvg is
// pure, so a genuine card is byte-identical to a re-render, and any edited number,
// invented beat, or injected element makes it differ → ✗. The embedded <metadata>
// carries ONLY an opaque receipt (hashes + counts) — no sessionId, no timestamps,
// no plaintext metrics — so the card re-leaks nothing the ingest redactor stripped.
// Palette = Catppuccin Mocha, matching the VHS demo so the brand is consistent.
// Output is a self-contained <svg> string — no network, no external assets.
// ============================================================================
import type { PanelModel } from '../tui/viewModel.ts';
import { encodeReceipt, toReceipt, type Provenance } from '../model/provenance.ts';
import { cardFace } from './cardFace.ts';

const C = {
  bg: '#1e1e2e',
  border: '#313244',
  dim: '#6c7086',
  text: '#cdd6f4',
  hero: '#f9e2af', // yellow — the labor count
  human: '#89dceb', // sky — "you" (the 0)
  seal: '#a6e3a1', // green — provenance seal
  drama: '#cba6f7', // mauve — the ceremonial compaction beat (calm, never alarm)
  line: '#45475a', // hairline divider above the journey
};

const FONT =
  "'SF Mono','JetBrains Mono',ui-monospace,Menlo,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',monospace";

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Bound a journey beat to one card row (already-glossed text; just a display cap). */
function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** Wrap an (already-clipped) wish into at most `maxLines` lines of ~`per` chars —
 *  the card's 认领 anchor reads as a full sentence, not a one-line fragment. The
 *  break never splits a latin word (so a token like "TUI" / "OAuth2" can't land
 *  half on each line); it nudges left to the run's edge, but not past ~60% of
 *  `per` so one long token can't shrink a line to a stub. CJK wraps at any char. */
export function wrapWish(s: string, per: number, maxLines = 2): string[] {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const isWord = (c: string) => /[0-9A-Za-z]/.test(c);
  const lines: string[] = [];
  let rest = t;
  while (rest.length && lines.length < maxLines) {
    if (rest.length <= per || lines.length === maxLines - 1) {
      lines.push(rest);
      break;
    }
    let cut = per;
    const floor = Math.max(1, Math.ceil(per * 0.6));
    while (cut > floor && isWord(rest[cut - 1]) && isWord(rest[cut])) cut--;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return lines;
}

/** Render a finished run's PanelModel as a standalone SVG poster string. When a
 *  `provenance` is supplied the card is independently verifiable (verifyCard.ts). */
export function renderCardSvg(model: PanelModel, provenance?: Provenance): string {
  const W = 820;
  const X = 60;
  const face = cardFace(model);
  const short = provenance?.short ?? '';
  // The journey ("一路走来") is the run's real turning points in order, straight
  // from the model (storyArc → transcript-derived). It's bound by the whole-card
  // re-render gate, so no beat here can be edited or invented without verify ✗.
  // When the card already shows the wish at top, drop ask-beats from the journey —
  // re-printing 「你说:…」 would just repeat the 愿望 line. `journeyTotal` is the real
  // count and is unchanged, so the honest 「共 N 个转折」 still discloses everything.
  const allJourney = model.finale?.journey ?? [];
  const journeyTotal = model.finale?.journeyTotal ?? allJourney.length;
  const journey = face.wish ? allJourney.filter((b) => b.act !== 'ask') : allJourney;

  // The wish wraps to ≤2 lines (the 认领 anchor, shown in full). Extra lines push
  // everything below down by `base`; the layout stays deterministic so the whole-card
  // gate still binds. Line 1 carries the 「愿望 · 」 label + the ac-wish id; line 2 is
  // indented to align under the wish text.
  const WISH_LH = 28;
  const wishLines = face.wish ? wrapWish(face.wish, 32) : [];
  const base = wishLines.length > 1 ? (wishLines.length - 1) * WISH_LH : 0;
  const wishBlock = wishLines
    .map((ln, i) =>
      i === 0
        ? `<text x="${X}" y="96" font-size="19" fill="${C.dim}">愿望 · <tspan id="ac-wish" fill="${C.text}">${esc(ln)}</tspan></text>`
        : `<text x="${X + 56}" y="${96 + i * WISH_LH}" font-size="19" fill="${C.text}">${esc(ln)}</text>`
    )
    .join('\n  ');

  // The seal: when verifiable, the short fingerprint is its own tagged tspan so
  // verifyCard reads back EXACTLY the fp (not the surrounding slogan). The fp alone
  // is an opaque hex string to a layperson, so it's paired with a plain-language
  // promise — phrased onto what verify actually proves (the card is consistent with
  // its record, independently checkable), NOT the record's own authenticity (which
  // we explicitly do not vouch), so the line stays honest even read off a screenshot.
  const sealInner = provenance
    ? `✓ <tspan id="ac-seal">${esc(short)}</tspan> · 与记录一致·可独立核验`
    : '✓ 数据来自真实记录';

  // Embedded receipt: a minimal comment (no `--`, no `<>`, no plaintext metrics)
  // + a base64 OPAQUE receipt (hashes + counts only). Changing any input byte or
  // any claimed number changes the fingerprint, so a tampered card fails verify.
  const provMeta = provenance
    ? `\n  <!-- agentcity verifiable card · fp ${short} · verify: tsx src/export/verifyCard.ts (card.svg) (transcript.jsonl) -->\n  <metadata id="ac-prov">${encodeReceipt(toReceipt(provenance))}</metadata>`
    : '';

  // The dur·✓seal "stamp" sits at a FIXED y ABOVE any journey, so a casual
  // screenshot that crops the bottom can never lose the verifiable seal (the
  // variable-length journey is what lives at the croppable bottom edge instead).
  // `base` shifts everything below the wish down when the wish wrapped to 2 lines.
  const STAMP_Y = 392 + base;
  const upper = `
  <text x="${X}" y="48" font-size="15" letter-spacing="3" fill="${C.dim}">agentcity</text>
  ${wishBlock}
  <text x="${X}" y="${156 + base}" font-size="17" fill="${C.dim}">它替你跑了</text>
  <text id="ac-hero" x="${X}" y="${252 + base}" font-size="104" font-weight="700" fill="${C.hero}">${esc(face.hero)}</text>
  <text x="${X}" y="${294 + base}" font-size="18" fill="${C.dim}">步　·　你亲手 <tspan fill="${C.human}" font-weight="700">0</tspan> 步</text>
  <text id="ac-include" x="${X}" y="${352 + base}" font-size="16" fill="${C.dim}">${esc(face.include)}</text>
  <text x="${X}" y="${STAMP_Y}" font-size="16" fill="${C.dim}"><tspan id="ac-dur">${esc(face.dur)}</tspan>　·　<tspan fill="${C.seal}">${sealInner}</tspan></text>`;

  // Optional journey block — a compact "一路走来" timeline below the stamp. The
  // height grows with the (bounded, ≤5) beat count; with no journey the card is
  // exactly the classic 450-tall poster (plus any wish-wrap `base`).
  let journeyBlock = '';
  let H = 450 + base;
  if (journey.length > 0) {
    const DIV_Y = STAMP_Y + 28;
    const HEAD_Y = DIV_Y + 24;
    const ROW0 = HEAD_Y + 30;
    const ROW_H = 30;
    const rows = journey
      .map((b, i) => {
        const connector = i === journey.length - 1 ? '└' : '├';
        const col = b.drama ? C.drama : C.text;
        // a standalone card has no city to decode the metaphor → use the plain,
        // artifact-named gloss (falls back to the city text only if plain is absent).
        return `<text x="${X}" y="${ROW0 + i * ROW_H}" font-size="15" fill="${C.dim}">${connector} <tspan fill="${col}">${esc(clip(b.plain ?? b.text, 40))}</tspan></text>`;
      })
      .join('\n  ');
    // "共 N 个转折" only when the journey is a capped highlights pick — never silent.
    const totalLabel = journeyTotal > journey.length ? `　·　共 ${journeyTotal} 个转折` : '';
    journeyBlock = `
  <line x1="${X}" y1="${DIV_Y}" x2="${W - X}" y2="${DIV_Y}" stroke="${C.line}" stroke-width="1"/>
  <text x="${X}" y="${HEAD_Y}" font-size="13" letter-spacing="2" fill="${C.dim}">一路走来${totalLabel}</text>
  ${rows}`;
    H = ROW0 + (journey.length - 1) * ROW_H + 36;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${provMeta}
  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="22" fill="${C.bg}" stroke="${C.border}" stroke-width="1.5"/>${upper}${journeyBlock}
</svg>`;
}
