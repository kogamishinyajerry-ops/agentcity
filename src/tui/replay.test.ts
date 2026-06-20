// Pure tests for the playhead state machine — no Ink, no async, no flake.
import { describe, expect, it } from 'vitest';
import type { WorldEvent } from '../model/types.ts';
import {
  autoplayStride,
  clampIdx,
  nextErrorIdx,
  replayReducer,
  type ReplayCtx,
  stepIdx,
} from './replay.ts';

function ev(seq: number, isError = false): WorldEvent {
  return {
    id: `e${seq}`,
    kind: 'SHELL_RUN',
    ts: '2026-01-01T00:00:00Z',
    seq,
    actorId: 'main',
    truth: 'observed',
    label: `step ${seq}`,
    ...(isError ? { isError: true } : {}),
  };
}

const events: WorldEvent[] = [ev(0), ev(1), ev(2, true), ev(3), ev(4, true), ev(5)];
const ctx: ReplayCtx = { len: events.length, events, stride: 2 };

describe('clamp / step', () => {
  it('clamps to [0, len-1]', () => {
    expect(clampIdx(-5, 6)).toBe(0);
    expect(clampIdx(99, 6)).toBe(5);
    expect(clampIdx(3, 0)).toBe(0);
  });
  it('steps and clamps', () => {
    expect(stepIdx(0, 6, -1)).toBe(0);
    expect(stepIdx(5, 6, +1)).toBe(5);
    expect(stepIdx(2, 6, +2)).toBe(4);
  });
});

describe('nextErrorIdx', () => {
  it('jumps forward to the next real error', () => {
    expect(nextErrorIdx(events, 0, +1)).toBe(2);
    expect(nextErrorIdx(events, 2, +1)).toBe(4);
  });
  it('jumps backward', () => {
    expect(nextErrorIdx(events, 5, -1)).toBe(4);
    expect(nextErrorIdx(events, 4, -1)).toBe(2);
  });
  it('stays put when no error in that direction', () => {
    expect(nextErrorIdx(events, 4, +1)).toBe(4);
    expect(nextErrorIdx(events, 1, -1)).toBe(1);
  });
});

describe('autoplayStride', () => {
  it('is >= 1 and grows with length', () => {
    expect(autoplayStride(10)).toBe(1);
    expect(autoplayStride(6000)).toBeGreaterThan(1);
  });
});

describe('replayReducer', () => {
  it('manual steps pause autoplay', () => {
    expect(replayReducer({ idx: 2, playing: true }, { type: 'right' }, ctx)).toEqual({
      idx: 3,
      playing: false,
    });
    expect(replayReducer({ idx: 2, playing: true }, { type: 'left' }, ctx)).toEqual({
      idx: 1,
      playing: false,
    });
  });
  it('home/end jump to bounds', () => {
    expect(replayReducer({ idx: 3, playing: false }, { type: 'home' }, ctx).idx).toBe(0);
    expect(replayReducer({ idx: 3, playing: false }, { type: 'end' }, ctx).idx).toBe(5);
  });
  it('error jumps use the real error positions', () => {
    expect(replayReducer({ idx: 0, playing: false }, { type: 'errNext' }, ctx).idx).toBe(2);
  });
  it('toggles play', () => {
    expect(replayReducer({ idx: 0, playing: false }, { type: 'togglePlay' }, ctx).playing).toBe(
      true
    );
  });
  it('tick advances by stride and auto-pauses at the end', () => {
    expect(replayReducer({ idx: 0, playing: true }, { type: 'tick' }, ctx)).toEqual({
      idx: 2,
      playing: true,
    });
    // from idx 4 (+2 -> 5 = last) it stops
    expect(replayReducer({ idx: 4, playing: true }, { type: 'tick' }, ctx)).toEqual({
      idx: 5,
      playing: false,
    });
  });
  it('jumps to a clamped index and pauses', () => {
    expect(replayReducer({ idx: 0, playing: true }, { type: 'jump', idx: 3 }, ctx)).toEqual({
      idx: 3,
      playing: false,
    });
    expect(replayReducer({ idx: 0, playing: false }, { type: 'jump', idx: 99 }, ctx).idx).toBe(5);
  });
});
