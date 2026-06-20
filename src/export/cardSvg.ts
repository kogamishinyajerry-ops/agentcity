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
//   • when a Provenance is supplied, the seal becomes a VERIFIABLE fingerprint
//     (embedded in <metadata> + printed short) — see verifyCard.ts.
// Palette = Catppuccin Mocha, matching the VHS demo so the brand is consistent.
// Output is a self-contained <svg> string — no network, no external assets.
// ============================================================================
import type { PanelModel } from '../tui/viewModel.ts';
import { encodeProvenance, type Provenance } from '../model/provenance.ts';

const STAT_SHORT: Record<string, string> = {
  reads: '读',
  edits: '改',
  writes: '写',
  commands: '命令',
  helpers: '帮手',
  errors: '报错没停',
  wipes: '清洗',
};

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

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** Render a finished run's PanelModel as a standalone SVG poster string. When a
 *  `provenance` is supplied the card is independently verifiable (verifyCard.ts). */
export function renderCardSvg(model: PanelModel, provenance?: Provenance): string {
  const W = 820;
  const H = 450;
  const X = 60;
  const fin = model.finale;
  const hero = String(model.laborSteps);
  const wish = model.intent ? clip(model.intent, 28) : '';
  const include = '包括 ' + (fin?.stats ?? []).map((s) => `${s.value}${STAT_SHORT[s.key] ?? s.key}`).join('·');
  const dur = fin?.duration ?? model.duration ?? '';
  const seal = provenance ? `✓ ${provenance.short} · 可溯源` : '✓ 数据来自真实记录';

  const wishLine = wish
    ? `<text x="${X}" y="96" font-size="19" fill="${C.dim}">愿望 · <tspan fill="${C.text}">${esc(wish)}</tspan></text>`
    : '';

  // Embedded receipt: a human-readable comment (no `--`, no `<>`) + a base64
  // metadata blob the verifier parses. Changing either the bytes or the numbers
  // changes the fingerprint, so a tampered card fails `verifyCard`.
  const sid = esc(provenance?.sessionId ?? '').replace(/--+/g, '-');
  const provMeta = provenance
    ? `\n  <!-- agentcity verifiable card · fp ${provenance.short} · session ${sid} · ${provenance.laborSteps} steps · verify: tsx src/export/verifyCard.ts (card.svg) (transcript.jsonl) -->\n  <metadata id="ac-prov">${encodeProvenance(provenance)}</metadata>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${provMeta}
  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="22" fill="${C.bg}" stroke="${C.border}" stroke-width="1.5"/>
  <text x="${X}" y="48" font-size="15" letter-spacing="3" fill="${C.dim}">agentcity</text>
  ${wishLine}
  <text x="${X}" y="156" font-size="17" fill="${C.dim}">它替你跑了</text>
  <text id="ac-hero" x="${X}" y="252" font-size="104" font-weight="700" fill="${C.hero}">${esc(hero)}</text>
  <text x="${X}" y="294" font-size="18" fill="${C.dim}">步　·　你亲手 <tspan fill="${C.human}" font-weight="700">0</tspan> 步</text>
  <text x="${X}" y="352" font-size="16" fill="${C.dim}">${esc(include)}</text>
  <text x="${X}" y="392" font-size="16" fill="${C.dim}">${esc(dur)}　·　<tspan fill="${C.seal}">${esc(seal)}</tspan></text>
</svg>`;
}
