// ============================================================================
// verifyCard — prove a 作品 card faithfully represents a transcript (CLI, 100%
// local, machine-checkable).
//   npx tsx src/export/verifyCard.ts <card.svg> <transcript.jsonl|parsed.json>
// Re-derives the card's provenance straight from the transcript and binds BOTH
// the embedded receipt AND the entire visible face to it. Exit 0 = ✓ faithful ·
// exit 1 = ✗ tampered/mismatched · exit 2 = usage/unverifiable. Fail-closed:
// any error (unreadable file, malformed SVG, broken transcript) → ✗, never ✓.
//
// Scope (stated, not overclaimed): this proves the card is a faithful rendering
// of THIS transcript. It does NOT prove the transcript is an authentic Anthropic
// session — transcripts are not provider-signed.
// ============================================================================
import { readFileSync } from 'node:fs';
import { computeCardProvenance, verifyAgainstTranscript } from './cardProvenance.ts';

const svgPath = process.argv[2];
const transcriptPath = process.argv[3];
if (!svgPath || !transcriptPath) {
  console.error('usage: tsx src/export/verifyCard.ts <card.svg> <transcript.jsonl|parsed.json>');
  process.exit(2);
}

try {
  const svg = readFileSync(svgPath, 'utf8');
  const { provenance, model } = computeCardProvenance(transcriptPath);
  const result = verifyAgainstTranscript(svg, { provenance, model });

  for (const c of result.checks) {
    console.error(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  }
  console.error('');
  if (result.ok) {
    console.error(`✓ 一致:这张卡如实呈现 ${transcriptPath}(fp ${provenance.short})`);
    console.error('  (仅证明卡面与该 transcript 自洽,不证明该 transcript 是真实 Anthropic 会话)');
    process.exit(0);
  }
  console.error(`✗ 不符:这张卡与 ${transcriptPath} 对不上(被篡改,或并非同一次 run)`);
  process.exit(1);
} catch (err) {
  console.error(`✗ 无法验证:${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
