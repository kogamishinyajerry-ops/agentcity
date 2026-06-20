// Pure tests for provenance hashing — deterministic, no fs, no fixture, no flake.
import { describe, expect, it } from 'vitest';
import {
  canonicalMetrics,
  claimHash,
  decodeProvenance,
  encodeProvenance,
  makeProvenance,
  metricsOf,
  sha256Hex,
  type CardMetrics,
} from './provenance.ts';

const M: CardMetrics = {
  sessionId: 'sess-abc',
  schemaVersions: ['1.0', '1.1'],
  startedAt: '2026-01-01T00:00:00Z',
  endedAt: '2026-01-01T01:00:00Z',
  laborSteps: 611,
  stats: [
    { key: 'edits', value: 94 },
    { key: 'reads', value: 16 },
  ],
};

describe('sha256Hex', () => {
  it('is deterministic and input-sensitive', () => {
    expect(sha256Hex('a')).toBe(sha256Hex('a'));
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
    expect(sha256Hex('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('canonicalMetrics', () => {
  it('is stable regardless of stat / schemaVersion ordering', () => {
    const reordered: CardMetrics = {
      ...M,
      schemaVersions: ['1.1', '1.0'],
      stats: [
        { key: 'reads', value: 16 },
        { key: 'edits', value: 94 },
      ],
    };
    expect(canonicalMetrics(reordered)).toBe(canonicalMetrics(M));
  });
  it('changes when a real number changes', () => {
    expect(claimHash({ ...M, laborSteps: 612 })).not.toBe(claimHash(M));
    expect(claimHash({ ...M, stats: [{ key: 'edits', value: 95 }, { key: 'reads', value: 16 }] })).not.toBe(claimHash(M));
  });
});

describe('makeProvenance', () => {
  it('short is the first 12 hex of the fingerprint', () => {
    const p = makeProvenance('bytes', 'deadbeef', M);
    expect(p.short).toBe(p.fingerprint.slice(0, 12));
    expect(p.short).toHaveLength(12);
  });
  it('fingerprint binds transcript hash AND metrics AND mode', () => {
    const base = makeProvenance('bytes', 'hash-1', M);
    expect(makeProvenance('bytes', 'hash-2', M).fingerprint).not.toBe(base.fingerprint);
    expect(makeProvenance('metrics', 'hash-1', M).fingerprint).not.toBe(base.fingerprint);
    expect(makeProvenance('bytes', 'hash-1', { ...M, laborSteps: 1 }).fingerprint).not.toBe(base.fingerprint);
  });
  it('round-trips through encode/decode', () => {
    const p = makeProvenance('bytes', 'hash-1', M);
    expect(decodeProvenance(encodeProvenance(p))).toEqual(p);
    expect(decodeProvenance('not base64 @@@')).toBeNull();
  });
  it('metricsOf recovers the claimed metrics (re-hashes equal)', () => {
    const p = makeProvenance('bytes', 'hash-1', M);
    expect(claimHash(metricsOf(p))).toBe(p.claimHash);
  });
});
