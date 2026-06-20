// ============================================================================
// exportCard — write a run's 作品 card to a shareable, VERIFIABLE SVG (node).
//   npx tsx src/export/exportCard.ts <parsed.json|session.jsonl> [out.svg]
// Reuses the SAME honest pipeline as the TUI (loadSession → buildPanelModel) and
// embeds a provenance fingerprint so the card can be independently proven with
// `verify:card`. 100% local: reads the transcript, writes one .svg, no network.
// ============================================================================
import { writeFileSync } from 'node:fs';
import { computeCardProvenance } from './cardProvenance.ts';
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
console.error(`✓ wrote ${out} (${svg.length} bytes) · fp ${provenance.short}`);
console.error(`  verify: tsx src/export/verifyCard.ts ${out} ${path}`);
