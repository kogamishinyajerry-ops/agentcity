// ============================================================================
// viewModel — PURE derivation of the TUI instrument panel from a ParsedSession.
// ----------------------------------------------------------------------------
// This is the whole point of the TUI pivot working cheaply: the honest data
// spine (ingest/parse/redact/model + the pure replay cores) crosses the
// renderer seam untouched. This file reuses those cores and emits a plain,
// presentation-free model the Ink <App> renders. No DOM, no ink, no canvas —
// node-safe and unit-testable against a real parsed sample.
//
// Honesty rules encoded here:
//   • WORKLOAD bar = isUsageEvent-filtered tool calls per district up to `seq`
//     (chatter + lifecycle excluded, so a bar = "how much this tool was USED").
//   • laborSteps = Σ bars  → the panel is self-consistent (no fabricated sum).
//   • RED travels only with a real error (now.isError / bar.fails / footer.fails).
// ============================================================================
import type { DistrictKind, ParsedSession, WorldEvent } from '../model/types.ts';
import { DISTRICT_LABEL, eventToDistrict, isUsageEvent } from '../model/mapping.ts';
import { computeSpotlight, type SpotlightAccent } from '../render/seekState.ts';
import { compactionsUpTo, editsUpTo, failsUpTo } from '../hud/health.ts';
import { endTally } from '../model/tally.ts';
import { narrativeBeats, beatAtSeq, storyArc } from '../model/narrative.ts';

/** Short Chinese gloss per district — what the building actually does. */
const DISTRICT_DESC: Record<DistrictKind, string> = {
  command_tower: '主控',
  crew_camp: '外派小队',
  archive: '读代码 / 检索',
  workshop: '改 / 写文件',
  bash_yard: '跑命令',
  port: '联网',
  consulate: 'MCP / 截图',
  skill_firm: '技能',
  kanban: '任务板',
  powerplant: '算力',
  customs: '权限闸',
  square: '对话 / 问你',
};

export interface BarRow {
  district: DistrictKind;
  label: string;
  calls: number;
  fails: number;
  active: boolean;
  accent: SpotlightAccent;
  desc: string;
}

export interface PanelModel {
  model: string | null;
  duration: string | null;
  intent: string | null;
  laborSteps: number;
  bars: BarRow[];
  maxCalls: number;
  now: { districtLabel: string; label: string; isError: boolean; isHuman: boolean } | null;
  /** The plain-Chinese story beat at the playhead (a real turning point), with
   *  `drama` set for the ceremonial compaction beat. null before the first. */
  narration: { text: string; drama: boolean } | null;
  seqPos: { seq: number; total: number };
  atEnd: boolean;
  finale: FinaleModel | null;
  footer: {
    calls: number;
    edits: number;
    fails: number;
    wipes: number;
    files: number;
    cardsDone: number;
  };
}

/** isUsageEvent-filtered tool calls + fails per district, up to and incl. `seq`. */
function usageByDistrictUpTo(
  events: readonly WorldEvent[],
  seq: number
): Map<DistrictKind, { calls: number; fails: number }> {
  const m = new Map<DistrictKind, { calls: number; fails: number }>();
  for (const e of events) {
    if (e.seq > seq) break;
    if (!isUsageEvent(e.kind)) continue;
    const d = eventToDistrict(e.kind);
    const cur = m.get(d) ?? { calls: 0, fails: 0 };
    cur.calls++;
    if (e.isError === true) cur.fails++;
    m.set(d, cur);
  }
  return m;
}

/** Plain wall-clock duration from two ISO stamps (null if unusable). */
function formatDuration(startISO?: string, endISO?: string): string | null {
  if (!startISO || !endISO) return null;
  const a = new Date(startISO).getTime();
  const b = new Date(endISO).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  let sec = Math.round((b - a) / 1000);
  const h = Math.floor(sec / 3600);
  sec -= h * 3600;
  const m = Math.floor(sec / 60);
  sec -= m * 60;
  if (h) return `${h} 小时 ${m} 分`;
  if (m) return `${m} 分`;
  return `${sec} 秒`;
}

/**
 * The opening WISH — the first non-empty user prompt, the request that drove the
 * whole run. Seq-invariant (the anchor the panel is "about"), distinct from the
 * evolving currentIntent (the latest steer at a cursor) which is a later feature.
 */
function openingWish(events: readonly WorldEvent[]): string | null {
  for (const e of events) {
    if (e.kind === 'USER_PROMPT' && e.label && e.label.trim()) return e.label.trim();
  }
  return null;
}

export interface FinaleStat {
  key: string;
  value: number;
}

/** One line of the finale "一路走来" journey — a real turning-point beat. `text`
 *  is the city-metaphor gloss (TUI, where the city anchors it); `plain` is the
 *  standalone-card gloss (plain-language, names the real artifact touched). */
export interface JourneyBeat {
  text: string;
  plain?: string;
  drama: boolean;
}

export interface FinaleModel {
  duration: string | null;
  /** Anchored to the panel's laborSteps (Σ bars) so panel + finale agree. */
  laborSteps: number;
  /** "包括 ——" sub-counts (a highlighted SUBSET, never claimed to sum to hero). */
  stats: FinaleStat[];
  punchline: string;
  /** The run's real turning points in order — the journey to "认领" (own). */
  journey: JourneyBeat[];
  /** Real total turning-point count (≥ journey.length) so a highlights cap is honest. */
  journeyTotal: number;
}

/** Inline finale — reuses endTally for the real sub-stats, but overrides the hero
 *  number + punchline with the panel's laborSteps so the two views never disagree. */
function buildFinale(session: ParsedSession, laborSteps: number): FinaleModel {
  const t = endTally(session);
  const arc = storyArc(session, 5);
  return {
    duration: t.duration,
    laborSteps,
    stats: t.stats.map((s) => ({ key: s.key, value: s.value })),
    punchline: `人只说了要做什么 —— 剩下 ${laborSteps} 步,它自己干完了。`,
    journey: arc.beats.map((b) => ({ text: b.text, plain: b.plain, drama: b.tone === 'drama' })),
    journeyTotal: arc.total,
  };
}

export function buildPanelModel(session: ParsedSession, seqArg?: number): PanelModel {
  const events = session.events;
  const lastSeq = events.length ? events[events.length - 1].seq : 0;
  const seq = seqArg == null ? lastSeq : Math.max(0, Math.min(seqArg, lastSeq));

  const usage = usageByDistrictUpTo(events, seq);
  const spot = computeSpotlight(events, seq);
  const bars: BarRow[] = [...usage.entries()]
    .map(([district, v]) => ({
      district,
      label: DISTRICT_LABEL[district],
      calls: v.calls,
      fails: v.fails,
      active: spot.activeDistrict === district,
      accent: spot.activeDistrict === district ? spot.accent : ('none' as SpotlightAccent),
      desc: DISTRICT_DESC[district],
    }))
    .sort((a, b) => b.calls - a.calls);

  const laborSteps = bars.reduce((n, b) => n + b.calls, 0);
  const maxCalls = bars.reduce((m, b) => Math.max(m, b.calls), 0);

  // NOW line: the latest meaningful beat (a human prompt or a real tool call) at
  // or before the cursor — shown even if it errored (fire owns the red there).
  let now: PanelModel['now'] = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.seq > seq) continue;
    if (e.kind === 'USER_PROMPT' || isUsageEvent(e.kind)) {
      now = {
        districtLabel: DISTRICT_LABEL[eventToDistrict(e.kind)],
        label: e.label,
        isError: e.isError === true,
        isHuman: e.kind === 'USER_PROMPT',
      };
      break;
    }
  }

  // Story track: the most recent turning-point beat at/before the playhead.
  const beat = beatAtSeq(narrativeBeats(session), seq);
  const narration = beat ? { text: beat.text, drama: beat.tone === 'drama' } : null;

  const atEnd = seq >= lastSeq;

  return {
    model: session.signals.totals.model ?? null,
    duration: formatDuration(session.meta.startedAt, session.meta.endedAt),
    intent: openingWish(events),
    laborSteps,
    bars,
    maxCalls,
    now,
    narration,
    seqPos: { seq, total: lastSeq },
    atEnd,
    finale: atEnd ? buildFinale(session, laborSteps) : null,
    footer: {
      calls: laborSteps,
      edits: editsUpTo(events, seq),
      fails: failsUpTo(events, seq),
      wipes: compactionsUpTo(events, seq),
      files: session.files.length,
      cardsDone: session.kanban.filter((c) => c.lane === 'completed').length,
    },
  };
}
