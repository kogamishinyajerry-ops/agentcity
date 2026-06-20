// ============================================================================
// AgentCity CLI — PURE helpers (no node-fs, no side effects).
// ----------------------------------------------------------------------------
// Split out of cli.ts so the honesty-bearing logic is unit-testable. cli.ts runs
// main() on import (it's an executable), so a test can't import from it without
// kicking off the whole ingester. These functions have no I/O and no module-load
// side effects, so they're safe to import from both cli.ts and a test.
//
// The load-bearing one is clusterWaves: it turns subagent first-line timestamps
// into "parallel wave ×N" claims the city renders. If it clustered wrongly, the
// city would assert concurrency that didn't happen — a visual lie. So it's tested.
// ============================================================================

/**
 * Split text into non-blank, trimmed lines WITHOUT building a giant string[]
 * (indexOf-based, one slice per line). Trailing newline yields no empty line;
 * blank/whitespace-only lines are skipped. This is the line discipline the
 * whole ingester relies on (never JSON.parse the whole file).
 */
export function* iterLines(text: string): Generator<string> {
  let start = 0;
  while (start <= text.length) {
    let nl = text.indexOf('\n', start);
    if (nl === -1) nl = text.length;
    const raw = text.slice(start, nl).trim();
    start = nl + 1;
    if (raw) yield raw;
    if (nl >= text.length) break;
  }
}

/**
 * The timestamp (ms since epoch) of the GENUINE first line only. Returns
 * undefined if the first line has no parseable `timestamp`. Used to seed
 * PARALLEL_WAVE clustering — so it deliberately inspects ONLY line 1 (a
 * subagent's first emitted event is when it "started").
 */
export function firstTimestampMs(text: string): number | undefined {
  for (const raw of iterLines(text)) {
    try {
      const o = JSON.parse(raw) as { timestamp?: string };
      if (typeof o.timestamp === 'string') {
        const ms = Date.parse(o.timestamp);
        return Number.isNaN(ms) ? undefined : ms;
      }
    } catch {
      /* skip */
    }
    return undefined; // only inspect the genuine first line
  }
  return undefined;
}

export interface WorkerStart {
  agentId: string;
  ts: number;
}

/**
 * Anchor-based clustering of worker start times. Workers whose first-line
 * timestamps fall within `windowMs` of the cluster's FIRST member land in the
 * same wave. (Anchor-based, not single-linkage: the window is measured from the
 * wave's opener, not the previous member, so a slow drift doesn't chain into one
 * giant wave.) Input order doesn't matter — it sorts by ts first.
 *
 * A wave of length >= 2 is what the CLI reports as a "parallel wave"; singletons
 * are sequential launches, not concurrency.
 */
export function clusterWaves(starts: WorkerStart[], windowMs: number): WorkerStart[][] {
  const sorted = [...starts].sort((a, b) => a.ts - b.ts);
  const waves: WorkerStart[][] = [];
  let cur: WorkerStart[] = [];
  let anchor = -1;
  for (const s of sorted) {
    if (anchor < 0 || s.ts - anchor <= windowMs) {
      cur.push(s);
      if (anchor < 0) anchor = s.ts;
    } else {
      waves.push(cur);
      cur = [s];
      anchor = s.ts;
    }
  }
  if (cur.length) waves.push(cur);
  return waves;
}
