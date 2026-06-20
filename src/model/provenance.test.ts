// Pure tests for provenance hashing — deterministic, no fs, no fixture, no flake.
import { describe, expect, it } from 'vitest';
import {
  canonicalMetrics,
  claimHash,
  decodeReceipt,
  encodeReceipt,
  makeProvenance,
  receiptFingerprint,
  sha256Hex,
  toReceipt,
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
  wish: '通关杀戮尖塔',
  durationText: '1 小时',
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
  it('changes when any claimed value changes (incl. wish + duration text)', () => {
    expect(claimHash({ ...M, laborSteps: 612 })).not.toBe(claimHash(M));
    expect(claimHash({ ...M, stats: [{ key: 'edits', value: 95 }, { key: 'reads', value: 16 }] })).not.toBe(claimHash(M));
    expect(claimHash({ ...M, wish: '别的愿望' })).not.toBe(claimHash(M));
    expect(claimHash({ ...M, durationText: '2 小时' })).not.toBe(claimHash(M));
  });
  it('NFC-normalises strings (visually identical → identical hash)', () => {
    // "é" composed (NFC, é) vs decomposed (NFD, e + combining acute)
    expect(claimHash({ ...M, wish: 'café' })).toBe(claimHash({ ...M, wish: 'café' }));
  });
  it('is fail-closed on out-of-domain counts (negative / fractional / NaN / Infinity)', () => {
    expect(() => claimHash({ ...M, laborSteps: -1 })).toThrow();
    expect(() => claimHash({ ...M, laborSteps: 1.5 })).toThrow();
    expect(() => claimHash({ ...M, laborSteps: NaN })).toThrow();
    expect(() => claimHash({ ...M, laborSteps: Infinity })).toThrow();
    expect(() => claimHash({ ...M, stats: [{ key: 'edits', value: -3 }] })).toThrow();
  });
  it('coerces non-array stats / schemaVersions instead of crashing', () => {
    expect(() => canonicalMetrics({ ...M, stats: undefined as never, schemaVersions: undefined as never })).not.toThrow();
  });
});

describe('makeProvenance', () => {
  it('short is the first 12 hex of the fingerprint', () => {
    const p = makeProvenance('bytes', 'deadbeef', 1, M);
    expect(p.short).toBe(p.fingerprint.slice(0, 12));
    expect(p.short).toHaveLength(12);
  });
  it('fingerprint binds mode AND inputCount AND transcript hash AND metrics', () => {
    const base = makeProvenance('bytes', 'hash-1', 3, M);
    expect(makeProvenance('bytes', 'hash-2', 3, M).fingerprint).not.toBe(base.fingerprint);
    expect(makeProvenance('metrics', 'hash-1', 3, M).fingerprint).not.toBe(base.fingerprint);
    expect(makeProvenance('bytes', 'hash-1', 4, M).fingerprint).not.toBe(base.fingerprint);
    expect(makeProvenance('bytes', 'hash-1', 3, { ...M, laborSteps: 1 }).fingerprint).not.toBe(base.fingerprint);
  });
  it('receiptFingerprint re-derives the same fingerprint from a receipt', () => {
    const p = makeProvenance('bytes', 'hash-1', 3, M);
    expect(receiptFingerprint(p)).toBe(p.fingerprint);
    expect(receiptFingerprint(toReceipt(p))).toBe(p.fingerprint);
  });
});

describe('receipt encode/decode (opaque, type-guarded)', () => {
  it('round-trips a receipt — and carries NO plaintext metrics', () => {
    const p = makeProvenance('bytes', 'hash-1', 3, M);
    const b64 = encodeReceipt(toReceipt(p));
    expect(decodeReceipt(b64)).toEqual(toReceipt(p));
    // privacy: the embedded blob must not contain the sessionId / timestamps / wish
    const json = Buffer.from(b64, 'base64').toString('utf8');
    expect(json).not.toContain('sess-abc');
    expect(json).not.toContain('2026-01-01');
    expect(json).not.toContain('杀戮尖塔');
  });
  it('is fail-closed: returns null for garbage / non-receipt JSON / wrong shape', () => {
    expect(decodeReceipt('not base64 @@@')).toBeNull();
    expect(decodeReceipt(Buffer.from('{"foo":1}', 'utf8').toString('base64'))).toBeNull();
    expect(decodeReceipt(Buffer.from('[1,2,3]', 'utf8').toString('base64'))).toBeNull();
    expect(decodeReceipt(Buffer.from('{"v":2,"mode":"bytes"}', 'utf8').toString('base64'))).toBeNull();
    expect(decodeReceipt(Buffer.from('{"v":1,"mode":"nope","inputCount":1,"transcriptHash":"a","claimHash":"b","fingerprint":"c"}', 'utf8').toString('base64'))).toBeNull();
    expect(decodeReceipt(Buffer.from('{"v":1,"mode":"bytes","inputCount":-1,"transcriptHash":"a","claimHash":"b","fingerprint":"c"}', 'utf8').toString('base64'))).toBeNull();
  });
});
