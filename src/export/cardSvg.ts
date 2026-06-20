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
// Verifiability: EVERY visible claim comes from cardFace() and is tagged with a
// stable id (ac-wish/ac-hero/ac-include/ac-dur/ac-seal) so verifyCard can read it
// back and re-derive it from the transcript. The embedded <metadata> carries ONLY
// an opaque receipt (hashes + counts) — no sessionId, no timestamps, no plaintext
// metrics — so the card re-leaks nothing the ingest redactor stripped.
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
};

const FONT =
  "'SF Mono','JetBrains Mono',ui-monospace,Menlo,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',monospace";

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render a finished run's PanelModel as a standalone SVG poster string. When a
 *  `provenance` is supplied the card is independently verifiable (verifyCard.ts). */
export function renderCardSvg(model: PanelModel, provenance?: Provenance): string {
  const W = 820;
  const H = 450;
  const X = 60;
  const face = cardFace(model);
  const short = provenance?.short ?? '';

  const wishLine = face.wish
    ? `<text x="${X}" y="96" font-size="19" fill="${C.dim}">愿望 · <tspan id="ac-wish" fill="${C.text}">${esc(face.wish)}</tspan></text>`
    : '';

  // The seal: when verifiable, the short fingerprint is its own tagged tspan so
  // verifyCard reads back EXACTLY the fp (not the surrounding slogan).
  const sealInner = provenance
    ? `✓ <tspan id="ac-seal">${esc(short)}</tspan> · 可溯源`
    : '✓ 数据来自真实记录';

  // Embedded receipt: a minimal comment (no `--`, no `<>`, no plaintext metrics)
  // + a base64 OPAQUE receipt (hashes + counts only). Changing any input byte or
  // any claimed number changes the fingerprint, so a tampered card fails verify.
  const provMeta = provenance
    ? `\n  <!-- agentcity verifiable card · fp ${short} · verify: tsx src/export/verifyCard.ts (card.svg) (transcript.jsonl) -->\n  <metadata id="ac-prov">${encodeReceipt(toReceipt(provenance))}</metadata>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${provMeta}
  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="22" fill="${C.bg}" stroke="${C.border}" stroke-width="1.5"/>
  <text x="${X}" y="48" font-size="15" letter-spacing="3" fill="${C.dim}">agentcity</text>
  ${wishLine}
  <text x="${X}" y="156" font-size="17" fill="${C.dim}">它替你跑了</text>
  <text id="ac-hero" x="${X}" y="252" font-size="104" font-weight="700" fill="${C.hero}">${esc(face.hero)}</text>
  <text x="${X}" y="294" font-size="18" fill="${C.dim}">步　·　你亲手 <tspan fill="${C.human}" font-weight="700">0</tspan> 步</text>
  <text id="ac-include" x="${X}" y="352" font-size="16" fill="${C.dim}">${esc(face.include)}</text>
  <text x="${X}" y="392" font-size="16" fill="${C.dim}"><tspan id="ac-dur">${esc(face.dur)}</tspan>　·　<tspan fill="${C.seal}">${sealInner}</tspan></text>
</svg>`;
}
