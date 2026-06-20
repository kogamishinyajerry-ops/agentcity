// ============================================================================
// exportCard — write a run's 作品 card to a shareable, VERIFIABLE SVG (node).
//   npx tsx src/export/exportCard.ts <parsed.json|session.jsonl> [out.svg]
// Reuses the SAME honest pipeline as the TUI (loadSession → buildPanelModel) and
// embeds a provenance fingerprint so the card can be independently proven with
// `verify:card`. 100% local: reads the transcript, writes one .svg, no network.
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { computeCardProvenance, verifyAgainstTranscript } from './cardProvenance.ts';
import { renderCardSvg } from './cardSvg.ts';

const path = process.argv[2];
const out = process.argv[3] ?? 'agentcity-card.svg';
if (!path) {
  console.error('usage: tsx src/export/exportCard.ts <parsed.json|session.jsonl> [out.svg]');
  process.exit(2);
}

const { model, provenance } = computeCardProvenance(path);
const svg = renderCardSvg(model, provenance);
writeFileSync(out, svg, 'utf8');

// Self-verify: re-read from disk and run the SAME oracle a third party would, so every
// exported card is proven verifiable the instant it's made — and any export↔verify drift
// fails loudly here, not silently on someone else's machine.
const result = verifyAgainstTranscript(readFileSync(out, 'utf8'), { provenance, model });
if (!result.ok) {
  console.error('✗ 自检失败:导出的卡未通过验证(export↔verify 漂移?)');
  for (const c of result.checks) if (!c.ok) console.error(`  ✗ ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  process.exit(1);
}
console.error(`✓ wrote ${out} (${svg.length} bytes) · fp ${provenance.short} · 自检通过`);
console.error(`  任何人都可独立验证: tsx src/export/verifyCard.ts ${out} ${path}`);
