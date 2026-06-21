// ============================================================================
// AgentCity — NARRATIVE BEATS (the plain-Chinese story skeleton).
// ----------------------------------------------------------------------------
// The city already SHOWS the moment-to-moment action (buildings light, carts run,
// fires burn). This layer narrates only the real TURNING POINTS in plain language:
// the session opening, a dispatch, an error, a permission/branch/model switch, a
// memory compaction, the end. Every beat traces to a REAL WorldEvent at a real seq
// — the wording is a plain-language GLOSS of the event kind, never an invented fact.
// Restraint is the rule: tool calls and chatter are NOT captioned (the city is the
// content; captions are the story). Pure + tested so the honesty can't silently rot.
// ============================================================================
import type { ParsedSession, WorldEvent, DistrictKind } from './types.ts';
import { eventToDistrict } from './mapping.ts';

/** A single caption shown while the playhead sits at/after `seq`. */
export interface NarrativeBeat {
  seq: number;
  text: string;
  /** 'drama' beats (a compaction) also cue the ceremonial cutscene. */
  tone: 'normal' | 'drama';
  /** Significance for the finale story-arc highlights pick (higher = kept first).
   *  Not editorial about WHAT happened — only which real turning points headline a
   *  capped recap. Absent on hand-built test beats (treated as 0). */
  weight?: number;
}

/** Plain-Chinese gloss of each district, for error beats ("X 那边失败"). */
const DISTRICT_CN: Record<DistrictKind, string> = {
  command_tower: '指挥塔',
  crew_camp: '小队营地',
  archive: '档案馆',
  workshop: '工坊',
  bash_yard: '命令场',
  port: '港口',
  consulate: '领事馆',
  skill_firm: '技能行',
  kanban: '看板',
  powerplant: '电厂',
  customs: '边检站',
  square: '广场',
};

/** Trim already-redacted text (title / prompt) for a caption — honest, just bounded. */
function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/**
 * A plain-language caption for ONE real turning-point event, or null if this kind
 * is moment-to-moment noise the city already shows (so it earns no caption).
 */
function beatFor(e: WorldEvent, firstSeq: number): NarrativeBeat | null {
  // TOOL_FAIL is the overlay twin of an originating tool event that already carries
  // isError — skip it so a failure is ONE beat, not a stutter.
  if (e.kind === 'TOOL_FAIL') return null;
  // an error on any real tool event is a turning point regardless of kind
  if (e.isError) {
    return { seq: e.seq, text: `出岔子了 —— ${DISTRICT_CN[eventToDistrict(e.kind)]}那边失败了`, tone: 'normal', weight: 4 };
  }
  switch (e.kind) {
    case 'SESSION_RESUME':
      return { seq: e.seq, text: '接着上一次，继续干', tone: 'normal', weight: 2 };
    case 'USER_PROMPT': {
      // the real (already-redacted) prompt text IS the story — show it verbatim
      // (bounded), not a generic line. Falls back only if the label is empty.
      const said = e.label ? clip(e.label, 30) : '';
      return { seq: e.seq, text: said ? `你说:「${said}」` : '你交代了一件事', tone: 'normal', weight: 3 };
    }
    case 'SUBAGENT_SPAWN':
      return { seq: e.seq, text: '派出一支小队去帮忙', tone: 'normal', weight: 3 };
    case 'SUBAGENT_RESULT':
      return { seq: e.seq, text: '小队回来交活了', tone: 'normal', weight: 2 };
    case 'WORKFLOW_LAUNCH':
      return { seq: e.seq, text: '开了一套多智能体编排', tone: 'normal', weight: 3 };
    case 'COMPACTION':
      return { seq: e.seq, text: '🧠 记忆被压缩 —— 这座城的记忆要抹掉、重写一遍', tone: 'drama', weight: 5 };
    case 'MODE_CHANGE':
      // the permission mode at the very FIRST event is a starting state, not a
      // switch — captioning it would mislead (and would mask the opening beat).
      if (e.seq === firstSeq) return null;
      return { seq: e.seq, text: '权限边检 —— 切换了模式', tone: 'normal', weight: 1 };
    case 'BRANCH_SWITCH':
      return { seq: e.seq, text: '切到了另一条 git 分支', tone: 'normal', weight: 1 };
    case 'MODEL_SWITCH':
      return { seq: e.seq, text: '换了个「大脑」(切换模型)', tone: 'normal', weight: 1 };
    default:
      return null;
  }
}

/**
 * The full ordered story track for a session: an opening beat, one beat per real
 * turning-point event, and a closing beat — with near-duplicate consecutive beats
 * collapsed (an error cluster or repeated prompts read as ONE moment, not a stutter).
 */
export function narrativeBeats(session: ParsedSession): NarrativeBeat[] {
  const events = session.events;
  if (events.length === 0) return [];
  const firstSeq = events[0].seq;
  const lastSeq = events[events.length - 1].seq;

  const raw: NarrativeBeat[] = [];
  // opening beat — use the real session title when we have one
  const title = session.meta.title ? clip(session.meta.title, 22) : '';
  raw.push({ seq: firstSeq, text: title ? `开工 ·「${title}」` : '这座城开工了', tone: 'normal', weight: 5 });

  for (const e of events) {
    const b = beatFor(e, firstSeq);
    if (b) raw.push(b);
  }

  // closing beat — the transcript itself ends here (always true, never fabricated)
  raw.push({ seq: lastSeq, text: '这段记录到此结束', tone: 'normal', weight: 5 });

  // sort by seq (events are ordered, but the synthesized open/close need placing)
  raw.sort((a, b) => a.seq - b.seq);

  // collapse near-duplicate consecutive beats (same text within a short window)
  const out: NarrativeBeat[] = [];
  for (const b of raw) {
    const prev = out[out.length - 1];
    if (prev && prev.text === b.text && b.seq - prev.seq <= 12) continue;
    out.push(b);
  }
  return out;
}

/**
 * The finale "journey" recap — the run's story told as its real turning points in
 * order, so an outsider can "认领" (claim/own) the path the agent walked while they
 * weren't watching. Every line is a real beat from `narrativeBeats` (never invented).
 *
 * Honesty: when there are more beats than `max`, this is a HIGHLIGHTS pick, not a
 * rewrite — the opening and closing anchors are always kept, the middle is filled by
 * the beats' significance `weight` (a compaction/error outranks a branch switch),
 * and the kept beats are shown in true seq order. `total` reports the real count of
 * distinct turning-point EVENTS (not the post-display-dedupe line count) so a
 * truncation can be labelled honestly ("共 N 个转折"), never under-reported.
 */
export interface StoryArc {
  beats: NarrativeBeat[];
  total: number;
  truncated: boolean;
}

export function storyArc(session: ParsedSession, max = 5): StoryArc {
  // `total` is the run's TRUE distinct turning-point count. narrativeBeats has
  // already merged genuine rapid-fire stutter (its 12-seq window), so its length is
  // the honest number of real turning-point EVENTS. 「共 N 个转折」 reports this — it
  // must stay faithful to the run, never to a smaller post-display count.
  const all = narrativeBeats(session);
  const total = all.length;
  // For DISPLAY ONLY, collapse identical glosses so the few highlight slots aren't
  // spent reprinting one line: several beat kinds emit a fixed gloss regardless of
  // event identity (two dispatches both read 「派出一支小队去帮忙」; two same-district
  // failures read alike). This never touches `total` — two distinct events that
  // gloss the same are shown ONCE but still COUNTED twice, so the disclosed total
  // can't under-report the run (the honesty bug a text-keyed total would cause).
  const seen = new Set<string>();
  const beats = all.filter((b) => (seen.has(b.text) ? false : (seen.add(b.text), true)));
  if (beats.length <= max) {
    // showing every distinct line, but `total` may exceed them (dedup collapsed
    // repeats) → still label the real total so nothing is silently dropped.
    return { beats, total, truncated: total > beats.length };
  }
  const open = beats[0];
  const close = beats[beats.length - 1];
  const middle = beats.slice(1, -1);
  const kept = [...middle]
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.seq - b.seq)
    .slice(0, Math.max(0, max - 2));
  const picked = [open, ...kept, close].sort((a, b) => a.seq - b.seq);
  return { beats: picked, total, truncated: true };
}

/**
 * The beat to show at `seq`: the most recent beat at or before the playhead, or
 * null before the first. O(n) scan — beats are few (a session has a handful), and
 * this is called only when the caption might change.
 */
export function beatAtSeq(beats: NarrativeBeat[], seq: number): NarrativeBeat | null {
  let found: NarrativeBeat | null = null;
  for (const b of beats) {
    if (b.seq > seq) break;
    found = b;
  }
  return found;
}

/** The persistent "current intent": the most recent user-turn text at/before the
 *  playhead, VERBATIM (already redacted) and bounded — the human ask currently
 *  driving the city. The intent bar surfaces this as a standing header while the
 *  agent works, so every action on screen traces back to a real request.
 *
 *  Honesty stance: we show what arrived on the user channel as-is and never
 *  editorialize which prompts "count" — so a system-injected user turn (e.g. a
 *  task-notification) shows verbatim too. null before the first non-empty prompt. */
export interface Intent {
  seq: number;
  text: string;
}

export function currentIntent(
  events: readonly WorldEvent[],
  seq: number,
  max = 90
): Intent | null {
  let found: Intent | null = null;
  for (const e of events) {
    if (e.seq > seq) break;
    if (e.kind === 'USER_PROMPT' && e.label && e.label.trim()) {
      found = { seq: e.seq, text: clip(e.label, max) };
    }
  }
  return found;
}
