// Honesty-critical HUD derivations. These regression-guard the two bugs fixed
// by hand: the tool-fail double-count and the context meter reading subagent /
// duplicate token rollups as main-context pressure.
import { describe, it, expect } from 'vitest';
import {
  failsUpTo,
  compactionsUpTo,
  processedUpTo,
  callsUpTo,
  editsUpTo,
  buildContextSeries,
  contextAtSeq,
  capFor,
  peakContextSize,
} from './health.ts';
import type { WorldEvent } from '../model/types.ts';

type EvIn = Partial<WorldEvent> & { kind: string; seq: number; actorId?: string };
const ev = (e: EvIn): WorldEvent => ({ actorId: 'main', truth: 'observed', id: `e${e.seq}`, label: '', ts: '', ...e } as unknown as WorldEvent);

describe('failsUpTo — counts TOOL_FAIL overlays only (regression: no double-count)', () => {
  // The parser pairs each failure: originating event isError=true PLUS a TOOL_FAIL
  // overlay. Counting both would double every failure.
  const events = [
    ev({ kind: 'SHELL_RUN', seq: 1, isError: true }),
    ev({ kind: 'TOOL_FAIL', seq: 2, isError: true }),
    ev({ kind: 'FILE_READ', seq: 3 }),
  ];
  it('counts one fail for the isError+TOOL_FAIL pair, not two', () => {
    expect(failsUpTo(events, 3)).toBe(1);
  });
  it('is seq-accurate during replay', () => {
    expect(failsUpTo(events, 1)).toBe(0); // TOOL_FAIL at seq 2 hasn't happened
    expect(failsUpTo(events, 2)).toBe(1);
  });
});

describe('compactionsUpTo / processedUpTo', () => {
  const events = [
    ev({ kind: 'USER_PROMPT', seq: 1 }),
    ev({ kind: 'COMPACTION', seq: 5 }),
    ev({ kind: 'FILE_READ', seq: 8 }),
  ];
  it('counts compactions up to the playhead', () => {
    expect(compactionsUpTo(events, 4)).toBe(0);
    expect(compactionsUpTo(events, 5)).toBe(1);
    expect(compactionsUpTo(events, 100)).toBe(1);
  });
  it('counts events processed up to the playhead', () => {
    expect(processedUpTo(events, 0)).toBe(0);
    expect(processedUpTo(events, 5)).toBe(2);
    expect(processedUpTo(events, 100)).toBe(3);
  });
});

describe('callsUpTo / editsUpTo — real seq-relative tool counts (strip honesty)', () => {
  const events = [
    ev({ kind: 'USER_PROMPT', seq: 1 }), // chatter — NOT a call
    ev({ kind: 'FILE_READ', seq: 2 }), // call
    ev({ kind: 'FILE_EDIT', seq: 3 }), // call + edit
    ev({ kind: 'AGENT_SAY', seq: 4 }), // chatter — NOT a call
    ev({ kind: 'FILE_WRITE', seq: 5 }), // call + edit
    ev({ kind: 'COMPACTION', seq: 6 }), // lifecycle — NOT a call
    ev({ kind: 'SHELL_RUN', seq: 7 }), // call
  ];
  it('callsUpTo counts only real tool invocations (no chatter / lifecycle)', () => {
    expect(callsUpTo(events, 100)).toBe(4); // READ, EDIT, WRITE, SHELL
  });
  it('callsUpTo is seq-accurate during replay', () => {
    expect(callsUpTo(events, 1)).toBe(0); // only the prompt so far
    expect(callsUpTo(events, 3)).toBe(2); // READ + EDIT
  });
  it('editsUpTo counts FILE_EDIT + FILE_WRITE only', () => {
    expect(editsUpTo(events, 100)).toBe(2);
    expect(editsUpTo(events, 3)).toBe(1); // only the EDIT so far
    expect(editsUpTo(events, 2)).toBe(0); // the READ is not an edit
  });
});

describe('buildContextSeries — main-only + dedupe + drop empties (the fixes)', () => {
  const events = [
    ev({ kind: 'AGENT_TURN_END', seq: 1, actorId: 'main', tokens: { input: 1000, output: 0, cacheCreate: 0, cacheRead: 50000 }, detail: { messageId: 'm1' } }),
    ev({ kind: 'SUBAGENT_RESULT', seq: 2, actorId: 'sub-a', tokens: { input: 113000, output: 0, cacheCreate: 0, cacheRead: 0 } }),
    ev({ kind: 'FILE_READ', seq: 3, actorId: 'main', tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 50000 }, detail: { messageId: 'm1' } }),
    ev({ kind: 'AGENT_SAY', seq: 4, actorId: 'main', tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, detail: { messageId: 'm4' } }),
    ev({ kind: 'AGENT_TURN_END', seq: 5, actorId: 'main', tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 80000 }, detail: { messageId: 'm5' } }),
  ];
  const series = buildContextSeries(events);

  it('excludes subagent token rollups (a SUBAGENT_RESULT is not main pressure)', () => {
    expect(series.find((p) => p.seq === 2)).toBeUndefined();
  });
  it('dedupes by messageId (a turn counts once)', () => {
    expect(series.filter((p) => p.seq === 3).length).toBe(0); // m1 already seen at seq 1
  });
  it('drops zero-size points', () => {
    expect(series.find((p) => p.seq === 4)).toBeUndefined();
  });
  it('keeps the real main turns with input+cacheRead+cacheCreate as size', () => {
    expect(series).toEqual([
      { seq: 1, size: 51000 },
      { seq: 5, size: 80000 },
    ]);
  });
  it('peakContextSize is the fullest main turn', () => {
    expect(peakContextSize(events)).toBe(80000);
  });
});

describe('contextAtSeq — latest turn at or before a playhead', () => {
  const series = [
    { seq: 1, size: 51000 },
    { seq: 5, size: 80000 },
  ];
  it('binary-searches the right point', () => {
    expect(contextAtSeq(series, 0)).toBe(0);
    expect(contextAtSeq(series, 1)).toBe(51000);
    expect(contextAtSeq(series, 4)).toBe(51000);
    expect(contextAtSeq(series, 5)).toBe(80000);
    expect(contextAtSeq(series, 999)).toBe(80000);
  });
});

describe('capFor — self-calibrating cap', () => {
  it('floors small runs at 200k so they read as low-pressure', () => {
    expect(capFor([{ seq: 1, size: 30000 }])).toBe(200_000);
    expect(capFor([])).toBe(200_000);
  });
  it('scales up past the floor for big-context runs (no false peg)', () => {
    expect(capFor([{ seq: 1, size: 466000 }])).toBe(466000);
  });
  it('honors an explicit override', () => {
    expect(capFor([{ seq: 1, size: 30000 }], 1_000_000)).toBe(1_000_000);
  });
});
