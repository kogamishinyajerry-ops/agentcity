// ============================================================================
// seekState.ts — the replay honesty core. These tests lock the two claims the
// pixels make at any playhead: a building's GLOW reflects recent (not lifetime)
// activity, and its FIRE reflects an unresolved error AS OF that seq — so
// scrubbing the timeline backward past an error must put the fire out, and a
// later success must too. Plus: a TOOL_FAIL overlay never burns a second
// building, and future events never leak backward into the present.
// ============================================================================
import { describe, it, expect } from 'vitest';
import {
  computeDistrictStates,
  crewVisibleAtSeq,
  computeSpotlight,
  LIT_WINDOW,
  SPOT_HOLD,
} from './seekState.ts';
import type { WorldEvent, WorldEventKind, ActorId } from '../model/types.ts';

// Minimal event factory. seq + kind + isError are all the function reads;
// the rest satisfy the WorldEvent contract. FILE_WRITE->workshop,
// FILE_READ->archive, SHELL_RUN->bash_yard (see mapping.eventToDistrict).
const ev = (seq: number, kind: WorldEventKind, isError = false): WorldEvent => ({
  id: `e${seq}`,
  kind,
  ts: '',
  seq,
  actorId: 'main',
  truth: 'observed',
  label: kind,
  isError,
});
const write = (seq: number, isError = false) => ev(seq, 'FILE_WRITE', isError);
const read = (seq: number) => ev(seq, 'FILE_READ');

describe('computeDistrictStates — lit reflects RECENT activity at the playhead', () => {
  it('scales lit with recent event count, clamped to 1 at 3+', () => {
    expect(computeDistrictStates([write(10)], 10).get('workshop')!.lit).toBeCloseTo(1 / 3);
    expect(computeDistrictStates([write(9), write(10)], 10).get('workshop')!.lit).toBeCloseTo(2 / 3);
    expect(computeDistrictStates([write(8), write(9), write(10)], 10).get('workshop')!.lit).toBe(1);
    // a 4th recent event can't push glow past full
    expect(computeDistrictStates([write(7), write(8), write(9), write(10)], 10).get('workshop')!.lit).toBe(1);
  });

  it('only counts events within LIT_WINDOW seq-steps before the playhead', () => {
    // gap exactly == LIT_WINDOW is still "recent" (inclusive)
    const atEdge = computeDistrictStates([write(10 - LIT_WINDOW)], 10).get('workshop')!;
    expect(atEdge.lit).toBeCloseTo(1 / 3);
    // one step older than the window: seen (so present in the map) but dark
    const tooOld = computeDistrictStates([write(10 - LIT_WINDOW - 1)], 10).get('workshop')!;
    expect(tooOld.lit).toBe(0);
  });

  it('respects a custom litWindow (0 => only the event exactly at the playhead glows)', () => {
    const s = computeDistrictStates([write(9), write(10)], 10, 0).get('workshop')!;
    expect(s.lit).toBeCloseTo(1 / 3); // only seq 10 is within a 0-step window
  });

  it('tracks districts independently', () => {
    const states = computeDistrictStates([write(10), read(10)], 10);
    expect(states.get('workshop')!.lit).toBeCloseTo(1 / 3);
    expect(states.get('archive')!.lit).toBeCloseTo(1 / 3);
  });
});

describe('computeDistrictStates — fire is an UNRESOLVED error as of the playhead', () => {
  it('burns when the latest event at a district is an error', () => {
    expect(computeDistrictStates([write(5, true)], 10).get('workshop')!.fireOn).toBe(true);
  });

  it('a later success at the same district puts the fire out', () => {
    // error at 5, clean write at 8 -> resolved
    expect(computeDistrictStates([write(5, true), write(8)], 10).get('workshop')!.fireOn).toBe(false);
  });

  it('a newer error re-ignites after a success', () => {
    expect(computeDistrictStates([write(5), write(8, true)], 10).get('workshop')!.fireOn).toBe(true);
  });

  it('SCRUBBING BACK before the error un-burns the building (replay honesty)', () => {
    const evs = [write(5), write(8, true)]; // success then error
    // playhead 6: the error at seq 8 has not happened yet -> not burning
    expect(computeDistrictStates(evs, 6).get('workshop')!.fireOn).toBe(false);
    // playhead 8: the error is now in the past -> burning
    expect(computeDistrictStates(evs, 8).get('workshop')!.fireOn).toBe(true);
  });
});

describe('computeDistrictStates — overlays and time boundaries do not lie', () => {
  it('a TOOL_FAIL overlay never lights or burns a building of its own', () => {
    // a lone TOOL_FAIL contributes nothing — no district is "seen"
    expect(computeDistrictStates([ev(5, 'TOOL_FAIL', true)], 10).size).toBe(0);
  });

  it('a failure burns its originating building ONCE, not twice (dual-emit)', () => {
    // real shape: originating event carries isError AND a TOOL_FAIL overlay follows
    const states = computeDistrictStates([write(5, true), ev(6, 'TOOL_FAIL', true)], 10);
    expect(states.size).toBe(1); // only the workshop, from the originating write
    expect(states.get('workshop')!.fireOn).toBe(true);
  });

  it('future events never leak backward into the present', () => {
    // an event past the playhead is excluded entirely (district not even seen)
    expect(computeDistrictStates([write(20)], 10).size).toBe(0);
    // mixed: only the past event shapes state
    const states = computeDistrictStates([write(5), write(20, true)], 10);
    expect(states.get('workshop')!.fireOn).toBe(false); // the future error is invisible
  });

  it('returns an empty map for an empty event list', () => {
    expect(computeDistrictStates([], 10).size).toBe(0);
  });
});

describe('crewVisibleAtSeq — tent shows only while the crew is live', () => {
  it('is visible within [firstSeq, lastSeq] inclusive, hidden outside', () => {
    expect(crewVisibleAtSeq(5, 10, 4)).toBe(false);
    expect(crewVisibleAtSeq(5, 10, 5)).toBe(true);
    expect(crewVisibleAtSeq(5, 10, 7)).toBe(true);
    expect(crewVisibleAtSeq(5, 10, 10)).toBe(true);
    expect(crewVisibleAtSeq(5, 10, 11)).toBe(false);
  });

  it('an instantaneous crew (firstSeq == lastSeq) is visible at exactly that seq', () => {
    expect(crewVisibleAtSeq(5, 5, 5)).toBe(true);
    expect(crewVisibleAtSeq(5, 5, 4)).toBe(false);
    expect(crewVisibleAtSeq(5, 5, 6)).toBe(false);
  });
});

describe('computeSpotlight — the color-role contract focus core', () => {
  const prompt = (seq: number) => ev(seq, 'USER_PROMPT'); // -> square
  const say = (seq: number) => ev(seq, 'AGENT_SAY'); // chatter -> not a beat

  it('an empty list (or all-future) leaves nothing spotlit', () => {
    expect(computeSpotlight([], 10)).toEqual({ activeDistrict: null, accent: 'none' });
    expect(computeSpotlight([write(20)], 10)).toEqual({ activeDistrict: null, accent: 'none' });
  });

  it('a tool call lights ITS building with the amber (tool) accent', () => {
    expect(computeSpotlight([write(10)], 10)).toEqual({ activeDistrict: 'workshop', accent: 'tool' });
    expect(computeSpotlight([read(10)], 10)).toEqual({ activeDistrict: 'archive', accent: 'tool' });
  });

  it('a human prompt lights the square with the cold (human) accent', () => {
    expect(computeSpotlight([prompt(10)], 10)).toEqual({ activeDistrict: 'square', accent: 'human' });
  });

  it('the human accent also keys off a human actor, not just the prompt kind', () => {
    const humanEdit: WorldEvent = { ...write(10), actorId: 'human' as ActorId };
    expect(computeSpotlight([humanEdit], 10)).toEqual({ activeDistrict: 'workshop', accent: 'human' });
  });

  it('the LATEST meaningful beat wins (the spotlight follows the action)', () => {
    expect(computeSpotlight([write(8), read(10)], 10)).toEqual({ activeDistrict: 'archive', accent: 'tool' });
    expect(computeSpotlight([read(8), prompt(10)], 10)).toEqual({ activeDistrict: 'square', accent: 'human' });
  });

  it('pure chatter / lifecycle is not a beat — the spotlight rests', () => {
    // a lone AGENT_SAY never lights anything
    expect(computeSpotlight([say(10)], 10)).toEqual({ activeDistrict: null, accent: 'none' });
    // chatter AFTER a tool call does not steal or extend the spotlight; the
    // tool beat still owns it until it ages out (next test)
    expect(computeSpotlight([write(10), say(11)], 11)).toEqual({ activeDistrict: 'workshop', accent: 'tool' });
  });

  it('the spotlight fades to none once the last beat is older than SPOT_HOLD', () => {
    const onEdge = SPOT_HOLD; // gap exactly == hold is still lit (inclusive)
    expect(computeSpotlight([write(10)], 10 + onEdge).activeDistrict).toBe('workshop');
    expect(computeSpotlight([write(10)], 10 + onEdge + 1)).toEqual({ activeDistrict: null, accent: 'none' });
  });

  it('a FAILED action burns (red) instead of glowing — fire owns red', () => {
    // the originating tool event carries isError -> no competing spotlight glow
    expect(computeSpotlight([write(10, true)], 10)).toEqual({ activeDistrict: null, accent: 'none' });
  });

  it('a TOOL_FAIL overlay is never its own beat', () => {
    // clean write at 9, TOOL_FAIL overlay at 10 (skipped) -> the write still owns it
    const evs = [write(9), ev(10, 'TOOL_FAIL', true)];
    expect(computeSpotlight(evs, 10)).toEqual({ activeDistrict: 'workshop', accent: 'tool' });
  });

  it('future beats never leak backward', () => {
    // read(8) is within hold of playhead 10; the future write(20) must not steal it
    expect(computeSpotlight([read(8), write(20)], 10)).toEqual({ activeDistrict: 'archive', accent: 'tool' });
  });
});
