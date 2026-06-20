// ============================================================================
// cardProvenance — the node side of verifiable cards: compute provenance from a
// transcript (the SINGLE source of truth shared by exportCard + verifyCard, so
// they can never drift), parse it back out of an SVG, and compare (pure) for the
// verify CLI. 100% local: reads the transcript, no network.
// ============================================================================
import { readFileSync } from 'node:fs';
import { loadSession } from '../tui/loadSession.ts';
import { buildPanelModel, type PanelModel } from '../tui/viewModel.ts';
import type { ParsedSession } from '../model/types.ts';
import {
  claimHash,
  decodeProvenance,
  makeProvenance,
  metricsOf,
  sha256Hex,
  type CardMetrics,
  type Provenance,
} from '../model/provenance.ts';

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
  };
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
  const isJsonl = /\.jsonl$/i.test(transcriptPath);
  const transcriptHash = sha256Hex(readFileSync(transcriptPath));
  const provenance = makeProvenance(isJsonl ? 'bytes' : 'metrics', transcriptHash, metricsFrom(session, model));
  return { session, model, provenance };
}

/** Pull the embedded provenance record out of an SVG card (null if absent/corrupt). */
export function parseProvenanceFromSvg(svg: string): Provenance | null {
  const i = svg.indexOf(MARK_OPEN);
  if (i < 0) return null;
  const j = svg.indexOf(MARK_CLOSE, i);
  if (j < 0) return null;
  return decodeProvenance(svg.slice(i + MARK_OPEN.length, j));
}

/** Read the big visible hero numeral the card actually displays (catches a tamper
 *  that edits the printed number but leaves the metadata). */
export function extractVisibleHero(svg: string): number | null {
  const m = svg.match(/id="ac-hero"[^>]*>\s*([0-9][0-9,]*)\s*<\/text>/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
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

const sortStats = (s: { key: string; value: number }[]) =>
  JSON.stringify([...s].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)));

/** Pure comparison of an SVG's embedded provenance against a fresh recomputation. */
export function compareProvenance(
  embedded: Provenance | null,
  recomputed: Provenance,
  visibleHero: number | null
): VerifyResult {
  if (!embedded) {
    return { ok: false, checks: [{ name: '凭证元数据', ok: false, detail: 'SVG 内无 ac-prov 指纹(不是 agentcity 可验证卡)' }] };
  }
  const checks: VerifyCheck[] = [];

  const selfClaim = claimHash(metricsOf(embedded));
  checks.push({
    name: '元数据自洽',
    ok: selfClaim === embedded.claimHash,
    detail: selfClaim === embedded.claimHash ? undefined : '卡内嵌数字被改过(claimHash 不符)',
  });

  checks.push({
    name: '模式一致',
    ok: embedded.mode === recomputed.mode,
    detail: embedded.mode === recomputed.mode ? undefined : `卡=${embedded.mode} / 你给的=${recomputed.mode}(用原始 .jsonl 验证最强)`,
  });

  const hashOk = embedded.transcriptHash === recomputed.transcriptHash;
  checks.push({
    name: embedded.mode === 'bytes' ? '原始字节指纹' : '解析会话指纹',
    ok: hashOk,
    detail: hashOk ? undefined : '与生成此卡的 transcript 不是同一份(或已被改动)',
  });

  checks.push({
    name: '步数',
    ok: embedded.laborSteps === recomputed.laborSteps,
    detail: embedded.laborSteps === recomputed.laborSteps ? undefined : `卡=${embedded.laborSteps} / 重算=${recomputed.laborSteps}`,
  });

  checks.push({ name: '明细', ok: sortStats(embedded.stats) === sortStats(recomputed.stats) });

  checks.push({ name: '完整指纹', ok: embedded.fingerprint === recomputed.fingerprint });

  const heroOk = visibleHero != null && visibleHero === embedded.laborSteps;
  checks.push({
    name: '显示数字',
    ok: heroOk,
    detail: visibleHero == null ? '读不到卡面数字' : heroOk ? undefined : `卡面=${visibleHero} / 声明=${embedded.laborSteps}`,
  });

  return { ok: checks.every((c) => c.ok), checks };
}
