// ============================================================================
// verifyCard — prove a 作品 card is real (CLI, 100% local, machine-checkable).
//   npx tsx src/export/verifyCard.ts <card.svg> <transcript.jsonl|parsed.json>
// Re-derives the card's provenance straight from the transcript and compares it
// to what the SVG embeds + displays. Exit 0 = ✓ faithful · exit 1 = ✗ tampered
// or mismatched — a deterministic oracle a third party can run themselves.
// ============================================================================
import { readFileSync } from 'node:fs';
import {
  compareProvenance,
  computeCardProvenance,
  extractVisibleHero,
  parseProvenanceFromSvg,
} from './cardProvenance.ts';

const svgPath = process.argv[2];
const transcriptPath = process.argv[3];
if (!svgPath || !transcriptPath) {
  console.error('usage: tsx src/export/verifyCard.ts <card.svg> <transcript.jsonl|parsed.json>');
  process.exit(2);
}

const svg = readFileSync(svgPath, 'utf8');
const embedded = parseProvenanceFromSvg(svg);
const visibleHero = extractVisibleHero(svg);
const { provenance: recomputed } = computeCardProvenance(transcriptPath);
const result = compareProvenance(embedded, recomputed, visibleHero);

for (const c of result.checks) {
  console.error(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
}
console.error('');
if (result.ok) {
  console.error(`✓ 真实:这张卡如实代表 ${transcriptPath}(fp ${recomputed.short})`);
  process.exit(0);
}
console.error(`✗ 不符:这张卡与 ${transcriptPath} 对不上(被篡改,或并非同一次 run)`);
process.exit(1);
