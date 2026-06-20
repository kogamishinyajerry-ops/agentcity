// Verify-logic tests: mostly pure (hand-built provenance/SVG, no fixture) so the
// tamper-detection oracle is covered everywhere; a real round-trip runs behind
// the fixture gate where the private sample is present.
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { encodeProvenance, makeProvenance, type CardMetrics } from '../model/provenance.ts';
import {
  compareProvenance,
  computeCardProvenance,
  extractVisibleHero,
  parseProvenanceFromSvg,
} from './cardProvenance.ts';
import { renderCardSvg } from './cardSvg.ts';

const M: CardMetrics = {
  sessionId: 'sess-xyz',
  schemaVersions: ['1.0'],
  startedAt: '2026-01-01T00:00:00Z',
  endedAt: '2026-01-01T02:00:00Z',
  laborSteps: 611,
  stats: [{ key: 'edits', value: 94 }, { key: 'reads', value: 16 }],
};
const real = makeProvenance('bytes', 'transcript-hash-1', M);

describe('compareProvenance (the tamper oracle)', () => {
  it('passes an untampered card', () => {
    expect(compareProvenance(real, real, real.laborSteps).ok).toBe(true);
  });
  it('fails when the SVG carries no provenance', () => {
    expect(compareProvenance(null, real, real.laborSteps).ok).toBe(false);
  });
  it('fails when embedded metadata numbers were edited (claimHash stale)', () => {
    const tampered = { ...real, laborSteps: 9999 }; // claimHash not recomputed
    const r = compareProvenance(tampered, real, 9999);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === '元数据自洽')!.ok).toBe(false);
  });
  it('fails when the printed number was edited but metadata left intact', () => {
    const r = compareProvenance(real, real, 6110);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === '显示数字')!.ok).toBe(false);
  });
  it('fails when verified against a different transcript', () => {
    const other = makeProvenance('bytes', 'transcript-hash-2', M);
    const r = compareProvenance(real, other, real.laborSteps);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === '原始字节指纹')!.ok).toBe(false);
  });
  it('flags a mode mismatch (verified .json vs a bytes card)', () => {
    const metricsMode = makeProvenance('metrics', 'transcript-hash-1', M);
    const r = compareProvenance(real, metricsMode, real.laborSteps);
    expect(r.checks.find((c) => c.name === '模式一致')!.ok).toBe(false);
  });
});

describe('SVG parse + extract', () => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="ac-prov">${encodeProvenance(real)}</metadata>` +
    `<text id="ac-hero" x="60" y="252">${real.laborSteps}</text></svg>`;
  it('round-trips the embedded provenance', () => {
    expect(parseProvenanceFromSvg(svg)).toEqual(real);
  });
  it('reads the visible hero numeral', () => {
    expect(extractVisibleHero(svg)).toBe(real.laborSteps);
  });
  it('returns null when there is no metadata / hero', () => {
    expect(parseProvenanceFromSvg('<svg></svg>')).toBeNull();
    expect(extractVisibleHero('<svg></svg>')).toBeNull();
  });
});

// Real end-to-end: export a card from the fixture, then verify it round-trips and
// that tampering the printed number is caught. Skips on a fresh clone (no sample).
const SAMPLE = 'sample/parsed-sample.json';
describe.skipIf(!existsSync(SAMPLE))('round-trip on the real sample', () => {
  it('a freshly-rendered card verifies, and a tampered number is caught', () => {
    const { model, provenance } = computeCardProvenance(SAMPLE);
    const svg = renderCardSvg(model, provenance);

    expect(compareProvenance(parseProvenanceFromSvg(svg), provenance, extractVisibleHero(svg)).ok).toBe(true);

    const tampered = svg.replace(
      `id="ac-hero" x="60" y="252" font-size="104" font-weight="700"`,
      `id="ac-hero" x="60" y="252" font-size="104" font-weight="700"`
    ).replace(/(id="ac-hero"[^>]*>)\s*\d+/, `$1${provenance.laborSteps + 1}`);
    expect(compareProvenance(parseProvenanceFromSvg(tampered), provenance, extractVisibleHero(tampered)).ok).toBe(false);
  });
});
