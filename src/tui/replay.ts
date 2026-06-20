// ============================================================================
// replay — PURE playhead state machine for the interactive panel.
// ----------------------------------------------------------------------------
// All scrub/play/jump logic lives here as a pure reducer over an event-INDEX
// playhead, so it unit-tests with zero async and zero Ink. The Ink shell
// (ReplayApp) is then a thin key→action mapper. Honesty is untouched: the
// playhead only ever selects WHICH real seq the panel renders — it never
// fabricates, reorders, or skips real events.
// ============================================================================
import type { WorldEvent } from '../model/types.ts';

export const AUTOPLAY_TICK_MS = 70;
const AUTOPLAY_SECONDS = 42; // any run plays start→end in ~this long

export function clampIdx(i: number, len: number): number {
  if (len <= 0) return 0;
  return Math.max(0, Math.min(i, len - 1));
}

export function stepIdx(i: number, len: number, delta: number): number {
  return clampIdx(i + delta, len);
}

/** Index of the next/prev event carrying a real error; current idx if none. */
export function nextErrorIdx(
  events: readonly WorldEvent[],
  fromIdx: number,
  dir: 1 | -1
): number {
  for (let j = fromIdx + dir; j >= 0 && j < events.length; j += dir) {
    if (events[j].isError === true) return j;
  }
  return clampIdx(fromIdx, events.length);
}

/** Autoplay stride so a run of `len` events finishes in ~AUTOPLAY_SECONDS. */
export function autoplayStride(len: number): number {
  const ticks = (AUTOPLAY_SECONDS * 1000) / AUTOPLAY_TICK_MS;
  return Math.max(1, Math.round(len / ticks));
}

export interface ReplayState {
  idx: number;
  playing: boolean;
}

export type ReplayAction =
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'errNext' }
  | { type: 'errPrev' }
  | { type: 'togglePlay' }
  | { type: 'tick' }
  | { type: 'jump'; idx: number };

export interface ReplayCtx {
  len: number;
  events: readonly WorldEvent[];
  stride: number;
}

/** Pure transition. Manual steps pause autoplay; tick auto-pauses at the end. */
export function replayReducer(s: ReplayState, a: ReplayAction, ctx: ReplayCtx): ReplayState {
  const { len, events, stride } = ctx;
  switch (a.type) {
    case 'left':
      return { idx: stepIdx(s.idx, len, -1), playing: false };
    case 'right':
      return { idx: stepIdx(s.idx, len, +1), playing: false };
    case 'home':
      return { idx: 0, playing: false };
    case 'end':
      return { idx: clampIdx(len - 1, len), playing: false };
    case 'errNext':
      return { idx: nextErrorIdx(events, s.idx, +1), playing: false };
    case 'errPrev':
      return { idx: nextErrorIdx(events, s.idx, -1), playing: false };
    case 'togglePlay':
      return { ...s, playing: !s.playing };
    case 'tick': {
      const next = stepIdx(s.idx, len, stride);
      return { idx: next, playing: s.playing && next < len - 1 };
    }
    case 'jump':
      return { idx: clampIdx(a.idx, len), playing: false };
  }
}
