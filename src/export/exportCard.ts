// ============================================================================
// exportCard — write a run's 作品 card to a shareable SVG file (node, zero-dep).
//   npx tsx src/export/exportCard.ts <parsed.json|session.jsonl> [out.svg]
// Reuses the SAME honest pipeline as the TUI (loadSession → buildPanelModel),
// so the poster can never disagree with the panel. 100% local: it only reads
// the transcript and writes one local .svg — no network.
// ============================================================================
import { writeFileSync } from 'node:fs';
import { loadSession } from '../tui/loadSession.ts';
import { buildPanelModel } from '../tui/viewModel.ts';
import { renderCardSvg } from './cardSvg.ts';

const path = process.argv[2];
const out = process.argv[3] ?? 'agentcity-card.svg';
if (!path) {
  console.error('usage: tsx src/export/exportCard.ts <parsed.json|session.jsonl> [out.svg]');
  process.exit(2);
}

const svg = renderCardSvg(buildPanelModel(loadSession(path)));
writeFileSync(out, svg, 'utf8');
console.error(`✓ wrote ${out} (${svg.length} bytes)`);
