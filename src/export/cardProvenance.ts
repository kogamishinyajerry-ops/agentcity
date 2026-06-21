// ============================================================================
// cardProvenance — the node side of verifiable cards: compute provenance from a
// transcript (the SINGLE source of truth shared by exportCard + verifyCard, so
// they can never drift), parse the opaque receipt back out of an SVG, and
// compare (pure) for the verify CLI. 100% local: reads the transcript, no network.
//
// Two soundness pillars the adversarial review forced:
//  (1) INPUT-SET hash — the metrics derive from the WHOLE pipeline input (main
//      .jsonl + every file under the sibling subagents/ tree), so the hash must
//      cover that whole set, not just the single main file. Otherwise a verifier
//      with the full tree false-mismatches a multi-agent card.
//  (2) WHOLE-CARD binding — renderCardSvg is pure, so a genuine card is byte-
//      identical to a re-render from this transcript. verify asserts that equality
//      (modulo line endings), which binds the ENTIRE visible surface — not just the
//      id-tagged fields. This is the airtight gate: an EXTRA or un-id'd visible
//      element (a forged 愿望 line, an overlay headline, <foreignObject> text)
//      makes the card differ from the canonical re-render → ✗. The per-field
//      cardFace checks remain only as friendly diagnostics for single-field edits.
// ============================================================================
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { loadSession } from '../tui/loadSession.ts';
import { buildPanelModel, type PanelModel } from '../tui/viewModel.ts';
import type { ParsedSession } from '../model/types.ts';
import {
  decodeReceipt,
  makeProvenance,
  receiptFingerprint,
  sha256Hex,
  type CardMetrics,
  type Provenance,
  type ProvMode,
  type Receipt,
} from '../model/provenance.ts';
import { cardFace } from './cardFace.ts';
import { renderCardSvg } from './cardSvg.ts';
import { isPng, readText, SVG_KEYWORD } from './pngChunks.ts';

const MARK_OPEN = '<metadata id="ac-prov">';
const MARK_CLOSE = '</metadata>';

function metricsFrom(session: ParsedSession, model: PanelModel): CardMetrics {
  return {
    sessionId: session.meta.sessionId,
    schemaVersions: session.meta.schemaVersions ?? [],
    startedAt: session.meta.startedAt,
    endedAt: session.meta.endedAt,
    laborSteps: model.laborSteps,
    stats: (model.finale?.stats ?? []).map((s) => ({ key: s.key, value: s.value })),
    // Visible-but-bound fields: claimHash commits to the FULL intent (the face
    // clips it for display); durationText is the exact string the card shows.
    wish: model.intent ?? null,
    durationText: model.finale?.duration ?? model.duration ?? null,
  };
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Recursively collect every regular file under `dir`, sorted (deterministic).
 *  Follows symlinks (to match the ingest pipeline, so the hashed set == the read
 *  set) but guards against cycles with a realpath visited-set — a self-referential
 *  symlink in a hostile/pathological tree can't loop or blow the stack. */
function walkFiles(dir: string, acc: string[], seen: Set<string>): void {
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    return;
  }
  if (seen.has(real)) return; // already walked this real dir (cycle or alias)
  seen.add(real);
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = join(dir, entry);
    if (isDir(p)) walkFiles(p, acc, seen);
    else acc.push(p);
  }
}

/** The exact set of files the ingest pipeline reads for a transcript: the main
 *  file plus, for a .jsonl, every file under the sibling `<base>/subagents/` tree.
 *  Returned as {rel, abs} sorted by rel (location-independent). */
export function enumerateInputs(transcriptPath: string): { mode: ProvMode; files: { rel: string; abs: string }[] } {
  const mode: ProvMode = /\.jsonl$/i.test(transcriptPath) ? 'bytes' : 'metrics';
  const mainAbs = resolve(transcriptPath);
  const root = dirname(mainAbs);
  const abs: string[] = [mainAbs];
  if (mode === 'bytes') {
    const sessionBase = basename(transcriptPath).replace(/\.jsonl$/i, '');
    walkFiles(join(dirname(transcriptPath), sessionBase, 'subagents'), abs, new Set());
  }
  const files = abs
    .map((a) => ({ rel: relative(root, resolve(a)), abs: a }))
    .sort((x, y) => (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0));
  return { mode, files };
}

/** Hash the canonical input-file set: each entry contributes `relpath\0filehash`,
 *  joined by newline. Location-independent (relative paths), order-stable (sorted). */
export function hashInputSet(files: { rel: string; abs: string }[]): string {
  const combined = files.map((f) => `${f.rel}\0${sha256Hex(readFileSync(f.abs))}`).join('\n');
  return sha256Hex(combined);
}

/** Compute model + provenance for a transcript — the canonical derivation both
 *  exportCard and verifyCard call, so a card and its verification always agree. */
export function computeCardProvenance(transcriptPath: string): {
  session: ParsedSession;
  model: PanelModel;
  provenance: Provenance;
} {
  const session = loadSession(transcriptPath);
  const model = buildPanelModel(session);
  const { mode, files } = enumerateInputs(transcriptPath);
  const transcriptHash = hashInputSet(files);
  const provenance = makeProvenance(mode, transcriptHash, files.length, metricsFrom(session, model));
  return { session, model, provenance };
}

/** Load a card's SVG source from a path that is EITHER a raw `.svg` file OR a
 *  `.png` carrier with the SVG embedded in an iTXt chunk (the shareable raster for
 *  platforms that won't render SVG). The verifier treats both identically — it only
 *  ever trusts the embedded SVG, never the raster pixels. Fail-closed: a PNG with no
 *  embedded card SVG throws (it's not an agentcity verifiable PNG), never silently
 *  falling back to verifying pixels we can't check. */
export function loadCardSvg(path: string): string {
  const buf = readFileSync(path);
  if (isPng(buf)) {
    const svg = readText(buf, SVG_KEYWORD);
    if (!svg) throw new Error('这个 PNG 内没有嵌入可验证的卡片 SVG(不是 agentcity 可验证 PNG)');
    return svg;
  }
  return buf.toString('utf8');
}

/** Pull the embedded opaque receipt out of an SVG card (null if absent/corrupt/
 *  not a well-formed Receipt — fail-closed via the runtime type guard). */
export function parseReceiptFromSvg(svg: string): Receipt | null {
  const i = svg.indexOf(MARK_OPEN);
  if (i < 0) return null;
  const j = svg.indexOf(MARK_CLOSE, i);
  if (j < 0) return null;
  return decodeReceipt(svg.slice(i + MARK_OPEN.length, j));
}

function unesc(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Normalise only line endings + trailing whitespace (CRLF, a stray final newline
 *  from an editor) — NOT structure/attributes. Lets a benignly re-saved card still
 *  verify, while leaving zero room to hide a visible element. */
function normSvg(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
}

/** Read the text content of the element carrying `id="<id>"`. Fail-closed: returns
 *  null unless EXACTLY ONE such element exists (0 = missing, >1 = overlay attack). */
export function extractById(svg: string, id: string): string | null {
  const re = new RegExp(`<(?:text|tspan)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</(?:text|tspan)>`, 'g');
  const matches = [...svg.matchAll(re)];
  if (matches.length !== 1) return null;
  return unesc(matches[0][1]);
}

export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail?: string;
}
export interface VerifyResult {
  ok: boolean;
  checks: VerifyCheck[];
}

const check = (name: string, ok: boolean, detail?: string): VerifyCheck => ({ name, ok, detail: ok ? undefined : detail });

/** Verify an SVG card against a fresh recomputation from the transcript. Binds
 *  BOTH the opaque receipt (hashes) AND the entire visible face to the transcript,
 *  so neither a metadata transplant nor a visible-field edit survives. Pure. */
export function verifyAgainstTranscript(
  svg: string,
  recomputed: { provenance: Provenance; model: PanelModel }
): VerifyResult {
  const receipt = parseReceiptFromSvg(svg);
  if (!receipt) {
    return { ok: false, checks: [{ name: '凭证元数据', ok: false, detail: 'SVG 内无有效 ac-prov 收据(不是 agentcity 可验证卡)' }] };
  }
  const rp = recomputed.provenance;
  const checks: VerifyCheck[] = [];

  // (a) the receipt is internally consistent — its fingerprint binds its own hashes
  checks.push(
    check('收据自洽', receiptFingerprint(receipt) === receipt.fingerprint, '收据被改过(fingerprint 与内部哈希不符)')
  );
  // (b) mode + input-set + claims + fingerprint all match the transcript
  checks.push(
    check('模式一致', receipt.mode === rp.mode, `卡=${receipt.mode} / 你给的=${rp.mode}(用原始 .jsonl 验证最强)`)
  );
  checks.push(
    check('输入文件数', receipt.inputCount === rp.inputCount, `卡=${receipt.inputCount} / 你给的=${rp.inputCount}(可能缺 subagents 目录)`)
  );
  checks.push(
    check(receipt.mode === 'bytes' ? '原始字节指纹' : '解析会话指纹', receipt.transcriptHash === rp.transcriptHash, '与生成此卡的 transcript 不是同一份(或已被改动)')
  );
  checks.push(check('声明指纹', receipt.claimHash === rp.claimHash, '卡声明的数字与 transcript 重算不符'));
  checks.push(check('完整指纹', receipt.fingerprint === rp.fingerprint, '指纹整体不符(被篡改,或并非同一次 run)'));

  // (c) per-field diagnostics — friendly messages for the common single-field edit.
  // These are NOT the completeness guarantee (they only see the id-tagged elements);
  // (d) below is the airtight gate. Kept because "卡面步数 卡面=X 应为=Y" beats a
  // whole-card diff for the 90% case.
  const face = cardFace(recomputed.model);
  const vHero = extractById(svg, 'ac-hero');
  const heroNorm = vHero?.replace(/,/g, '') ?? null;
  checks.push(check('卡面步数', heroNorm === face.hero, `卡面=${vHero ?? '(读不到)'} / 应为=${face.hero}`));
  checks.push(check('卡面明细', extractById(svg, 'ac-include') === face.include, `应为=${face.include}`));
  checks.push(check('卡面时长', extractById(svg, 'ac-dur') === face.dur, `应为=${face.dur}`));
  checks.push(check('卡面指纹', extractById(svg, 'ac-seal') === rp.short, `卡面=${extractById(svg, 'ac-seal') ?? '(读不到)'} / 应为=${rp.short}`));

  // (d) WHOLE-CARD completeness — the airtight gate. renderCardSvg is pure, so a
  // genuine card is byte-identical to a re-render from this transcript. Any EXTRA
  // or un-id'd visible element (a forged 愿望 line on a no-wish card, an overlay
  // headline, <foreignObject>/<textPath>/<style> text) — the whole class the
  // per-field id checks can't see — makes the card differ from the canonical
  // re-render → ✗. This closes the "visible surface ⊄ bound set" gap.
  const canonical = renderCardSvg(recomputed.model, rp);
  checks.push(
    check('卡面完整性', normSvg(svg) === normSvg(canonical), '卡面与依据 transcript 重新渲染的标准卡不一致(含未授权的额外元素或改动)')
  );

  return { ok: checks.every((c) => c.ok), checks };
}
