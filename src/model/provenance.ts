// ============================================================================
// provenance — turn the 作品 card's "✓ 可溯源" seal from a SLOGAN into a
// machine-checkable RECEIPT. Pure primitives (node:crypto only — 100% local, no
// network), no fs / no rendering, so they unit-test deterministically.
//
// The moat: a credential nobody can fake. A card embeds a tiny OPAQUE receipt —
// just hashes + counts — derived from (a) every input file the pipeline reads
// and (b) the exact numbers the card claims. A third party holding the original
// transcript re-derives both from scratch and proves the card is faithful (or
// catches any tamper). Two design choices make this sound AND private:
//
//   • The receipt is hashes ONLY — no sessionId, no timestamps, no metrics in
//     plaintext. The verifier RE-DERIVES everything from the transcript, so the
//     card re-leaks nothing the ingest redactor already stripped.
//   • claimHash commits to the WHOLE claimed surface (wish + duration text +
//     labor + stats), so editing any visible field the verifier re-renders is
//     caught — see cardFace.ts / cardProvenance.ts.
//
// Scope (kept honest): this proves a card truthfully represents THIS transcript;
// it does NOT vouch that the transcript is an authentic Anthropic session
// (transcripts are not provider-signed).
// ============================================================================
import { createHash } from 'node:crypto';

export type ProvMode = 'bytes' | 'metrics';

/** The claimed surface of a card — exactly what a verifier re-derives + commits
 *  to via claimHash. `wish`/`durationText` are the visible-but-bound fields. */
export interface CardMetrics {
  sessionId: string;
  schemaVersions: string[];
  startedAt?: string;
  endedAt?: string;
  laborSteps: number;
  stats: { key: string; value: number }[];
  wish: string | null;
  durationText: string | null;
}

/** The opaque receipt embedded in a card. Hashes + counts ONLY — never plaintext
 *  metrics. This is what `encodeReceipt` serialises into the SVG <metadata>. */
export interface Receipt {
  v: 1;
  /** 'bytes' = sha256 over the raw input file bytes (byte-reproducible, strongest).
   *  'metrics' = sha256 of a pre-parsed .json (weaker: parsed-session, not bytes). */
  mode: ProvMode;
  /** How many input files fed the hash (main + subagents/**). Diagnostic: a
   *  single-file verify of a multi-agent card mismatches here, not silently. */
  inputCount: number;
  transcriptHash: string; // sha256 over the canonical input-file set
  claimHash: string; // sha256 of the canonical metrics
  fingerprint: string; // sha256 binding mode|inputCount|transcriptHash|claimHash
}

/** Full provenance (compute side): the receipt + the metrics it commits to + the
 *  human-visible short stamp. Only the Receipt projection is ever embedded. */
export interface Provenance extends Receipt {
  metrics: CardMetrics;
  short: string; // first 12 hex of fingerprint — the printed stamp
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

const nfc = (s: string): string => s.normalize('NFC');

/** Fail-closed number-domain guard: counts must be non-negative safe integers.
 *  A NaN/Infinity/fractional/huge value means the producer is broken or the input
 *  is hostile — throw rather than bake a meaningless hash. */
function assertCount(n: number, what: string): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new Error(`provenance: ${what} must be a non-negative safe integer, got ${String(n)}`);
  }
  return n;
}

/** Deterministic canonical string of the claimed metrics. Stable key/stat order,
 *  NFC-normalised strings (so a visually-identical card hashes identically across
 *  Unicode encodings), integer-domain-checked counts, defensive against non-arrays. */
export function canonicalMetrics(m: CardMetrics): string {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const stats = (Array.isArray(m.stats) ? m.stats : [])
    .map((s) => ({ key: nfc(String(s.key)), value: assertCount(s.value, `stat ${s.key}`) }))
    .sort((a, b) => cmp(a.key, b.key))
    .map((s) => [s.key, s.value]);
  return JSON.stringify({
    v: 1,
    sessionId: nfc(String(m.sessionId ?? '')),
    schemaVersions: (Array.isArray(m.schemaVersions) ? m.schemaVersions : [])
      .map((x) => nfc(String(x)))
      .sort(cmp),
    startedAt: m.startedAt ? nfc(m.startedAt) : null,
    endedAt: m.endedAt ? nfc(m.endedAt) : null,
    laborSteps: assertCount(m.laborSteps, 'laborSteps'),
    stats,
    wish: m.wish != null ? nfc(m.wish) : null,
    durationText: m.durationText != null ? nfc(m.durationText) : null,
  });
}

export function claimHash(m: CardMetrics): string {
  return sha256Hex(canonicalMetrics(m));
}

/** The string a fingerprint binds — its own (mode, inputCount, hashes). Recomputing
 *  this from a receipt's fields catches an embedded receipt whose fingerprint was
 *  not re-derived after editing transcriptHash/claimHash (internal consistency). */
export function fingerprintInput(r: Pick<Receipt, 'mode' | 'inputCount' | 'transcriptHash' | 'claimHash'>): string {
  return `agentcity/v1|${r.mode}|${r.inputCount}|${r.transcriptHash}|${r.claimHash}`;
}

export function receiptFingerprint(r: Pick<Receipt, 'mode' | 'inputCount' | 'transcriptHash' | 'claimHash'>): string {
  return sha256Hex(fingerprintInput(r));
}

/** Build the full provenance record from the input-set hash + the claimed metrics. */
export function makeProvenance(
  mode: ProvMode,
  transcriptHash: string,
  inputCount: number,
  metrics: CardMetrics
): Provenance {
  const ch = claimHash(metrics);
  const base = { mode, inputCount, transcriptHash, claimHash: ch };
  const fingerprint = receiptFingerprint(base);
  return { v: 1, ...base, fingerprint, short: fingerprint.slice(0, 12), metrics };
}

/** The embeddable receipt projection of a full provenance record. */
export function toReceipt(p: Provenance): Receipt {
  return {
    v: 1,
    mode: p.mode,
    inputCount: p.inputCount,
    transcriptHash: p.transcriptHash,
    claimHash: p.claimHash,
    fingerprint: p.fingerprint,
  };
}

/** base64 of the receipt JSON — embedded in the SVG <metadata> (no XML escaping). */
export function encodeReceipt(r: Receipt): string {
  return Buffer.from(JSON.stringify(r), 'utf8').toString('base64');
}

/** Decode + RUNTIME TYPE-GUARD: returns null unless the bytes decode to a
 *  well-formed Receipt. Fail-closed against truncation, type confusion (a JSON
 *  object that isn't a receipt), and hostile shapes. */
export function decodeReceipt(b64: string): Receipt | null {
  let o: unknown;
  try {
    o = JSON.parse(Buffer.from(b64.trim(), 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (r.v !== 1) return null;
  if (r.mode !== 'bytes' && r.mode !== 'metrics') return null;
  if (
    typeof r.transcriptHash !== 'string' ||
    typeof r.claimHash !== 'string' ||
    typeof r.fingerprint !== 'string'
  ) {
    return null;
  }
  if (typeof r.inputCount !== 'number' || !Number.isInteger(r.inputCount) || r.inputCount < 0) return null;
  return {
    v: 1,
    mode: r.mode,
    inputCount: r.inputCount,
    transcriptHash: r.transcriptHash,
    claimHash: r.claimHash,
    fingerprint: r.fingerprint,
  };
}
