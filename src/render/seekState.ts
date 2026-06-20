// ============================================================================
// REPLAY STATE — pure, Pixi-free (the honesty core of seekTo).
// ----------------------------------------------------------------------------
// The whole premise of AgentCity is "watch the run replay": at any playhead seq,
// every lit window and every fire must reflect what was TRUE at that moment —
// not the whole-run total, not a future event leaking backward. That logic used
// to live inside CityRenderer.applySeekState, fused to Pixi view objects and so
// untestable. It's extracted here so the two claims the pixels make can be
// locked by tests:
//   • lit   — a building glows in proportion to its activity in the last
//             LIT_WINDOW seq-steps BEFORE the playhead (recent, not lifetime).
//   • fire  — a building burns iff its most recent event at/under the playhead
//             was an UNRESOLVED error: an error newer than the last success
//             there. A later same-district success puts the fire out. Scrub back
//             before the error and it must not be burning yet.
// TOOL_FAIL is an overlay on its originating (already-isError) event, so it is
// skipped here — counting it would burn a second building per failure (a lie).
// CityRenderer copies these targets onto its views; the ticker tweens visuals.
// ============================================================================
import type { WorldEvent, DistrictKind } from '../model/types.ts';
import { eventToDistrict, isErrorEvent, isUsageEvent } from '../model/mapping.ts';

/** How many seq-steps before `seq` a district counts as "recently active". */
export const LIT_WINDOW = 6;

export interface DistrictSeekState {
  /** 0..1 glow, proportional to recent activity at/before the playhead. */
  lit: number;
  /** true iff an unresolved error (error newer than last success) sits here. */
  fireOn: boolean;
}

/**
 * Compute each district's lit + fire AS OF playhead `seq`, from the full ordered
 * event list. Only districts with at least one event at/under `seq` appear in
 * the result; the caller defaults the rest to { lit: 0, fireOn: false } (a
 * district whose only events are in the future is dark and unlit — correct).
 *
 * Events are assumed ordered by seq (the parser guarantees strict monotonic
 * seq), so the walk stops at the first event past the playhead.
 */
export function computeDistrictStates(
  events: readonly WorldEvent[],
  seq: number,
  litWindow: number = LIT_WINDOW
): Map<DistrictKind, DistrictSeekState> {
  const recentCount = new Map<DistrictKind, number>();
  const lastErr = new Map<DistrictKind, number>();
  const lastOk = new Map<DistrictKind, number>();
  const seen = new Set<DistrictKind>();

  for (const e of events) {
    if (e.seq > seq) break;
    // TOOL_FAIL overlays its originating event (which already lit/errored the
    // right district) — never let it light a building of its own.
    if (e.kind === 'TOOL_FAIL') continue;
    const d = eventToDistrict(e.kind);
    seen.add(d);
    if (seq - e.seq <= litWindow) {
      recentCount.set(d, (recentCount.get(d) ?? 0) + 1);
    }
    if (isErrorEvent(e)) {
      lastErr.set(d, e.seq);
    } else {
      // any non-error event at the district is a "success" beat that, if newer
      // than the last error, puts that district's fire out.
      lastOk.set(d, e.seq);
    }
  }

  const out = new Map<DistrictKind, DistrictSeekState>();
  for (const d of seen) {
    const rc = recentCount.get(d) ?? 0;
    const err = lastErr.get(d);
    const ok = lastOk.get(d);
    out.set(d, {
      lit: Math.min(1, rc / 3),
      fireOn: err !== undefined && (ok === undefined || err > ok),
    });
  }
  return out;
}

/**
 * A crew's tent is visible only while the crew is live: between its spawn
 * (firstSeq) and its result (lastSeq), inclusive. Outside that window the camp
 * is empty, so the tent must not show.
 */
export function crewVisibleAtSeq(firstSeq: number, lastSeq: number, seq: number): boolean {
  return seq >= firstSeq && seq <= lastSeq;
}

// ============================================================================
// SPOTLIGHT — the "color-role contract" focus core (also pure & tested).
// ----------------------------------------------------------------------------
// The color contract the user chose: 🔴 red = error (owned by fire, computed
// above) · 🔵 cold = the instant a HUMAN command lands · 🟡 amber = the building
// a TOOL is being called at RIGHT NOW · everything else recedes (the "serve"
// spotlight law). This function answers the only honesty-bearing question behind
// that law: AS OF the playhead, which single building is the latest real action
// touching, and is that action a human command or a tool call?
//
// It looks at the most recent MEANINGFUL beat at/under the playhead — a tool
// call (isUsageEvent) or a user prompt — ignoring pure chatter (AGENT_SAY/THINK)
// and lifecycle epochs, which leave the city un-spotlit (honest: nothing is
// "being called" during reflection). If that beat is older than `hold` seq the
// spotlight fades to none. Errors are excluded here: fire already owns red, so
// the spotlight never paints a competing glow over a burning building.
// TOOL_FAIL is an overlay on its originating event and is skipped (same as lit).
// ============================================================================

/** Which accent the latest action warrants. Red is NOT here — fire owns it. */
export type SpotlightAccent = 'human' | 'tool' | 'none';

export interface SpotlightState {
  /** the single building the latest real action is touching (null = none lit). */
  activeDistrict: DistrictKind | null;
  /** 'human' = a person just gave a command · 'tool' = a tool is being called. */
  accent: SpotlightAccent;
}

/** How many seq-steps the spotlight lingers after the last meaningful beat. */
export const SPOT_HOLD = 4;

export function computeSpotlight(
  events: readonly WorldEvent[],
  seq: number,
  hold: number = SPOT_HOLD
): SpotlightState {
  let last: WorldEvent | undefined;
  for (const e of events) {
    if (e.seq > seq) break;
    if (e.kind === 'TOOL_FAIL') continue; // overlay, never its own beat
    // a "meaningful" beat = a real tool call or a human prompt; chatter + epochs
    // (AGENT_SAY/THINK, SESSION_START, COMPACTION…) leave the spotlight resting.
    if (e.kind === 'USER_PROMPT' || isUsageEvent(e.kind)) last = e;
  }
  if (!last || seq - last.seq > hold) return { activeDistrict: null, accent: 'none' };
  // a failed action burns (red) — fire owns it; don't add a competing glow.
  if (isErrorEvent(last)) return { activeDistrict: null, accent: 'none' };
  const human = last.kind === 'USER_PROMPT' || last.actorId === 'human';
  return { activeDistrict: eventToDistrict(last.kind), accent: human ? 'human' : 'tool' };
}
