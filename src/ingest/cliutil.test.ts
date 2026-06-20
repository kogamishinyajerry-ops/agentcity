// Pure CLI helpers. The contract that matters for honesty: clusterWaves must
// only group subagents that genuinely started close together (it drives the
// "parallel wave ×N" claim the city renders), and firstTimestampMs must read
// ONLY the genuine first line (a worker's start), never peek ahead.
import { describe, it, expect } from 'vitest';
import { iterLines, firstTimestampMs, clusterWaves } from './cliutil.ts';

describe('iterLines — the line discipline', () => {
  it('splits on newline and trims', () => {
    expect([...iterLines('a\n  b  \nc')]).toEqual(['a', 'b', 'c']);
  });
  it('skips blank and whitespace-only lines', () => {
    expect([...iterLines('a\n\n   \nb')]).toEqual(['a', 'b']);
  });
  it('a trailing newline does not yield a phantom empty line', () => {
    expect([...iterLines('a\nb\n')]).toEqual(['a', 'b']);
  });
  it('empty / whitespace-only input yields nothing', () => {
    expect([...iterLines('')]).toEqual([]);
    expect([...iterLines('   \n  \n')]).toEqual([]);
  });
  it('handles a single line with no newline', () => {
    expect([...iterLines('{"a":1}')]).toEqual(['{"a":1}']);
  });
});

describe('firstTimestampMs — only the genuine first line', () => {
  const line = (ts: string | null, extra = '') =>
    JSON.stringify(ts === null ? { type: 'x' } : { timestamp: ts, ...(extra ? { e: extra } : {}) });

  it('reads the first line timestamp as epoch ms', () => {
    const text = `${line('2026-01-01T00:00:00.000Z')}\n${line('2026-01-02T00:00:00.000Z')}`;
    expect(firstTimestampMs(text)).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });
  it('returns undefined if the FIRST line lacks a timestamp, even if later lines have one', () => {
    const text = `${line(null)}\n${line('2026-01-02T00:00:00.000Z')}`;
    expect(firstTimestampMs(text)).toBeUndefined();
  });
  it('returns undefined on empty input', () => {
    expect(firstTimestampMs('')).toBeUndefined();
  });
  it('returns undefined when the first line is not JSON', () => {
    expect(firstTimestampMs('not json\n{"timestamp":"2026-01-01T00:00:00Z"}')).toBeUndefined();
  });
  it('returns undefined for an unparseable timestamp string', () => {
    expect(firstTimestampMs(line('not-a-date'))).toBeUndefined();
  });
  it('skips a leading blank line and reads the first real line', () => {
    const text = `\n${line('2026-03-03T03:03:03.000Z')}`;
    expect(firstTimestampMs(text)).toBe(Date.parse('2026-03-03T03:03:03.000Z'));
  });
});

describe('clusterWaves — concurrency must be real, not chained drift', () => {
  const s = (agentId: string, ts: number) => ({ agentId, ts });

  it('groups starts within the window into one wave', () => {
    const waves = clusterWaves([s('a', 0), s('b', 30), s('c', 49)], 50);
    expect(waves.length).toBe(1);
    expect(waves[0].map((w) => w.agentId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('splits starts beyond the window into separate waves', () => {
    const waves = clusterWaves([s('a', 0), s('b', 30), s('c', 100)], 50);
    expect(waves.length).toBe(2);
    expect(waves[0].map((w) => w.agentId)).toEqual(['a', 'b']);
    expect(waves[1].map((w) => w.agentId)).toEqual(['c']);
  });

  it('is anchor-based, not single-linkage: slow drift does NOT chain into one wave', () => {
    // 0,40,80 each within 50 of the PREVIOUS, but 80 is 80 from the anchor(0).
    // Single-linkage would make one wave of 3; anchor-based makes [0,40] then [80].
    const waves = clusterWaves([s('a', 0), s('b', 40), s('c', 80)], 50);
    expect(waves.map((w) => w.map((x) => x.agentId))).toEqual([['a', 'b'], ['c']]);
  });

  it('sorts unsorted input before clustering', () => {
    const waves = clusterWaves([s('c', 100), s('a', 0), s('b', 30)], 50);
    expect(waves[0].map((w) => w.agentId)).toEqual(['a', 'b']);
    expect(waves[1].map((w) => w.agentId)).toEqual(['c']);
  });

  it('empty input yields no waves', () => {
    expect(clusterWaves([], 50)).toEqual([]);
  });

  it('a lone start is a singleton wave (a sequential launch, not concurrency)', () => {
    const waves = clusterWaves([s('solo', 12345)], 50);
    expect(waves.length).toBe(1);
    expect(waves[0].length).toBe(1);
  });

  it('exact-window boundary is inclusive (ts - anchor === window groups)', () => {
    const waves = clusterWaves([s('a', 0), s('b', 50)], 50);
    expect(waves.length).toBe(1);
  });
});
