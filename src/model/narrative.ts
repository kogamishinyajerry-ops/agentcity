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
    return { seq: e.seq, text: `出岔子了 —— ${DISTRICT_CN[eventToDistrict(e.kind)]}那边失败了`, tone: 'normal' };
  }
  switch (e.kind) {
    case 'SESSION_RESUME':
      return { seq: e.seq, text: '接着上一次，继续干', tone: 'normal' };
    case 'USER_PROMPT': {
      // the real (already-redacted) prompt text IS the story — show it verbatim
      // (bounded), not a generic line. Falls back only if the label is empty.
      const said = e.label ? clip(e.label, 30) : '';
      return { seq: e.seq, text: said ? `你说:「${said}」` : '你交代了一件事', tone: 'normal' };
    }
    case 'SUBAGENT_SPAWN':
      return { seq: e.seq, text: '派出一支小队去帮忙', tone: 'normal' };
    case 'SUBAGENT_RESULT':
      return { seq: e.seq, text: '小队回来交活了', tone: 'normal' };
    case 'WORKFLOW_LAUNCH':
      return { seq: e.seq, text: '开了一套多智能体编排', tone: 'normal' };
    case 'COMPACTION':
      return { seq: e.seq, text: '🧠 记忆被压缩 —— 这座城的记忆要抹掉、重写一遍', tone: 'drama' };
    case 'MODE_CHANGE':
      // the permission mode at the very FIRST event is a starting state, not a
      // switch — captioning it would mislead (and would mask the opening beat).
      if (e.seq === firstSeq) return null;
      return { seq: e.seq, text: '权限边检 —— 切换了模式', tone: 'normal' };
    case 'BRANCH_SWITCH':
      return { seq: e.seq, text: '切到了另一条 git 分支', tone: 'normal' };
    case 'MODEL_SWITCH':
      return { seq: e.seq, text: '换了个「大脑」(切换模型)', tone: 'normal' };
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
  raw.push({ seq: firstSeq, text: title ? `开工 ·「${title}」` : '这座城开工了', tone: 'normal' });

  for (const e of events) {
    const b = beatFor(e, firstSeq);
    if (b) raw.push(b);
  }

  // closing beat — the transcript itself ends here (always true, never fabricated)
  raw.push({ seq: lastSeq, text: '这段记录到此结束', tone: 'normal' });

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
