// ============================================================================
// health — context-pressure + tally calc for the panel. PURE, node-safe.
// ----------------------------------------------------------------------------
// The context meter shows how full the model's context was on the latest turn
// at a given seq — input-side tokens (input + cacheRead + cacheCreate) ≈ prompt
// size — against a per-session cap. It rises as context fills and drops after a
// COMPACTION, so the red zone honestly foreshadows the compaction stat. This is
// instantaneous (this turn's prompt), NOT a cumulative spend total. Every number
// traces to a real turn. (An old web HUD DOM mounter lived here too; it was
// removed with the web renderer — these pure functions are the live spine the
// terminal panel consumes via viewModel.)
// ============================================================================
import type { WorldEvent } from '../model/types.ts';
import { isUsageEvent } from '../model/mapping.ts';

// A session whose peak prompt never reaches this reads as low-pressure — the
// standard Claude context floor, so short runs honestly show plenty of headroom
// instead of being dramatized to 100%. The cap scales UP past this for big runs
// (e.g. 1M-context models), so it never falsely pegs.
const CONTEXT_FLOOR = 200_000;

export interface CtxPoint {
  seq: number;
  size: number;
}

/** Per-turn context size (input-side tokens) at each seq that carries usage.
 *  Deduped by detail.messageId so a turn's tokens count once (DATA-CONTRACT §7). */
export function buildContextSeries(events: WorldEvent[]): CtxPoint[] {
  const out: CtxPoint[] = [];
  const seenMsg = new Set<string>();
  for (const e of events) {
    // Main run's context window only. Subagents have their own context; a
    // SUBAGENT_RESULT carries the subagent's token rollup (sometimes parked into
    // `input` via tokensFromTotal), which is NOT main-context pressure.
    if (e.actorId !== 'main') continue;
    if (!e.tokens) continue;
    const mid =
      typeof e.detail?.messageId === 'string' ? (e.detail.messageId as string) : undefined;
    if (mid) {
      if (seenMsg.has(mid)) continue;
      seenMsg.add(mid);
    }
    const t = e.tokens;
    // input-side tokens fed to the model that turn ≈ how full the context was.
    const size = (t.input || 0) + (t.cacheRead || 0) + (t.cacheCreate || 0);
    if (size > 0) out.push({ seq: e.seq, size });
  }
  return out;
}

/** The fullest the main context got across the run (0 if no token data). Shared
 *  with the run overview so the digest and the live gauge agree on the peak. */
export function peakContextSize(events: WorldEvent[]): number {
  let peak = 0;
  for (const p of buildContextSeries(events)) if (p.size > peak) peak = p.size;
  return peak;
}

/** Context size on the latest turn at or before a seq (series is seq-ordered). */
export function contextAtSeq(series: CtxPoint[], seq: number): number {
  let lo = 0;
  let hi = series.length - 1;
  let size = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].seq <= seq) {
      size = series[mid].size;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return size;
}

/** Per-session cap: an explicit override, else max(floor, observed peak) so the
 *  gauge never falsely pegs on big-context models nor dramatizes small runs. */
export function capFor(series: CtxPoint[], override?: number): number {
  if (override && override > 0) return override;
  let peak = 0;
  for (const p of series) if (p.size > peak) peak = p.size;
  return Math.max(CONTEXT_FLOOR, peak);
}

/** Tool fails that have occurred up to a seq.
 *  Count TOOL_FAIL overlays ONLY. The parser emits one TOOL_FAIL per failure AND
 *  flags the originating tool event isError=true (parse.ts handleToolResult), so
 *  counting `isError || TOOL_FAIL` double-counts every failure. One TOOL_FAIL ==
 *  one ignited fire in the city == one fail here, matching signals.toolFails. */
export function failsUpTo(events: WorldEvent[], seq: number): number {
  let n = 0;
  for (const e of events) {
    if (e.seq > seq) break;
    if (e.kind === 'TOOL_FAIL') n++;
  }
  return n;
}

/** Compactions that have occurred up to a seq. */
export function compactionsUpTo(events: WorldEvent[], seq: number): number {
  let n = 0;
  for (const e of events) {
    if (e.seq > seq) break;
    if (e.kind === 'COMPACTION') n++;
  }
  return n;
}

/** Events processed (seq <= current). */
export function processedUpTo(events: WorldEvent[], seq: number): number {
  let n = 0;
  for (const e of events) {
    if (e.seq > seq) break;
    n++;
  }
  return n;
}

/** Real TOOL CALLS up to a seq — actual tool invocations (isUsageEvent), not
 *  conversation or lifecycle. Same predicate that scales the skyline, so the
 *  strip total agrees with the city's size encoding. */
export function callsUpTo(events: WorldEvent[], seq: number): number {
  let n = 0;
  for (const e of events) {
    if (e.seq > seq) break;
    if (isUsageEvent(e.kind)) n++;
  }
  return n;
}

/** File EDITS + WRITES up to a seq (the workshop's output). */
export function editsUpTo(events: WorldEvent[], seq: number): number {
  let n = 0;
  for (const e of events) {
    if (e.seq > seq) break;
    if (e.kind === 'FILE_EDIT' || e.kind === 'FILE_WRITE') n++;
  }
  return n;
}
