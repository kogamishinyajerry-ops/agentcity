// ============================================================================
// provenance — turn the 作品 card's "✓ 可溯源" seal from a SLOGAN into a
// machine-checkable RECEIPT. Pure primitives (node:crypto only — 100% local, no
// network), no fs / no rendering, so they unit-test deterministically.
//
// The moat: a credential nobody can fake. A card embeds a fingerprint derived
// from (a) the transcript's bytes and (b) the exact numbers it claims. A third
// party with the original transcript can re-derive both and prove the card is
// faithful — or catch any tamper. Scope (kept honest): this proves a card
// truthfully represents THIS transcript; it does not vouch that the transcript
// is an authentic Anthropic session (transcripts are not provider-signed).
// ============================================================================
import { createHash } from 'node:crypto';

export type ProvMode = 'bytes' | 'metrics';

/** The claimed numbers on a card — exactly what a verifier re-derives. */
export interface CardMetrics {
  sessionId: string;
  schemaVersions: string[];
  startedAt?: string;
  endedAt?: string;
  laborSteps: number;
  stats: { key: string; value: number }[];
}

export interface Provenance extends CardMetrics {
  v: 1;
  /** 'bytes' = sha256 of the raw .jsonl bytes (byte-reproducible, strongest).
   *  'metrics' = sha256 of a pre-parsed .json (weaker: parsed-session, not bytes). */
  mode: ProvMode;
  transcriptHash: string;
  claimHash: string; // sha256 of the canonical metrics
  fingerprint: string; // sha256 binding mode|transcriptHash|claimHash
  short: string; // first 12 hex of fingerprint — the human-visible stamp
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Deterministic canonical string of the claimed metrics (stable key + stat order). */
export function canonicalMetrics(m: CardMetrics): string {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const stats = [...m.stats].sort((a, b) => cmp(a.key, b.key)).map((s) => [s.key, s.value]);
  return JSON.stringify({
    v: 1,
    sessionId: m.sessionId,
    schemaVersions: [...m.schemaVersions].sort(cmp),
    startedAt: m.startedAt ?? null,
    endedAt: m.endedAt ?? null,
    laborSteps: m.laborSteps,
    stats,
  });
}

export function claimHash(m: CardMetrics): string {
  return sha256Hex(canonicalMetrics(m));
}

/** Build the full provenance record from a transcript hash + the claimed metrics. */
export function makeProvenance(mode: ProvMode, transcriptHash: string, metrics: CardMetrics): Provenance {
  const ch = claimHash(metrics);
  const fingerprint = sha256Hex(`agentcity/v1|${mode}|${transcriptHash}|${ch}`);
  return {
    v: 1,
    mode,
    transcriptHash,
    claimHash: ch,
    fingerprint,
    short: fingerprint.slice(0, 12),
    sessionId: metrics.sessionId,
    schemaVersions: metrics.schemaVersions,
    startedAt: metrics.startedAt,
    endedAt: metrics.endedAt,
    laborSteps: metrics.laborSteps,
    stats: metrics.stats,
  };
}

/** The metrics subset of a provenance record (for re-hashing / comparison). */
export function metricsOf(p: Provenance): CardMetrics {
  return {
    sessionId: p.sessionId,
    schemaVersions: p.schemaVersions,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    laborSteps: p.laborSteps,
    stats: p.stats,
  };
}

/** base64 of the provenance JSON — embedded in the SVG <metadata> (no XML escaping needed). */
export function encodeProvenance(p: Provenance): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64');
}

export function decodeProvenance(b64: string): Provenance | null {
  try {
    return JSON.parse(Buffer.from(b64.trim(), 'base64').toString('utf8')) as Provenance;
  } catch {
    return null;
  }
}
