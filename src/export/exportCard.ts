// ============================================================================
// exportCard — write a run's 作品 card to a shareable, VERIFIABLE SVG (node), and
// — when a system SVG rasterizer is available — also a verifiable PNG carrier.
//   npx tsx src/export/exportCard.ts <parsed.json|session.jsonl> [out.svg]
// Reuses the SAME honest pipeline as the TUI (loadSession → buildPanelModel) and
// embeds a provenance fingerprint so the card can be independently proven with
// `verify:card`. The PNG (for platforms that won't render SVG) carries the exact
// SVG source in an iTXt chunk, so `verify:card` works on it too — the verifier
// trusts only that embedded SVG, never the raster pixels. 100% local, no network.
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { computeCardProvenance, loadCardSvg, verifyAgainstTranscript } from './cardProvenance.ts';
import { renderCardSvg } from './cardSvg.ts';
import { embedText, SVG_KEYWORD } from './pngChunks.ts';
import { rasterize } from './rasterize.ts';

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

// Best-effort verifiable PNG carrier: rasterize the SVG with whatever tool the host
// has, embed the exact SVG source into the PNG, then self-verify by re-extracting it.
// No rasterizer → SVG-only (which is already fully verifiable + shareable).
const pngOut = out.replace(/\.svg$/i, '') + '.png';
const tool = rasterize(out, pngOut);
if (tool) {
  const carrier = embedText(readFileSync(pngOut), SVG_KEYWORD, svg);
  writeFileSync(pngOut, carrier);
  // self-verify via the SAME extract→oracle path a third party uses on the PNG
  const pres = verifyAgainstTranscript(loadCardSvg(pngOut), { provenance, model });
  if (!pres.ok) {
    console.error(`✗ PNG 自检失败:嵌入的 SVG 未通过验证`);
    for (const c of pres.checks) if (!c.ok) console.error(`  ✗ ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
    process.exit(1);
  }
  console.error(`✓ also wrote ${pngOut} (PNG 内嵌可验证 SVG · 经 ${tool} 光栅化 · 自检通过)`);
  console.error(`  PNG 同样可验证: tsx src/export/verifyCard.ts ${pngOut} ${path}`);
  console.error(`  注:验证只信 PNG 内嵌的 SVG;像素是其渲染,如需逐像素确认请重新光栅化该 SVG 比对。`);
} else {
  console.error('ℹ 未找到可用的 SVG 光栅化工具(rsvg-convert/resvg/inkscape/magick/qlmanage)— 仅产出 SVG。');
  console.error('  SVG 本身即可验证、可分享;如需 PNG 版,装其一后重跑即可。');
}
console.error(`  任何人都可独立验证: tsx src/export/verifyCard.ts ${out} ${path}`);
