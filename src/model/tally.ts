// ============================================================================
// AgentCity — THE HONEST TALLY (the finale's numbers, in plain Chinese).
// ----------------------------------------------------------------------------
// The guided story ends on a "curtain-call" card that lets an outsider feel the
// SCALE of what one agent did alone: read N files, made N edits, ran N commands,
// summoned N helpers, hit N errors and kept going — and a human only said what
// they wanted. Every number here traces 1:1 to the real parsed transcript (the
// same totals the run-overview shows); this module just frames them as the story's
// punchline. Pure + tested so the flex can never quietly become a lie.
//
// Layering: model-only (no hud import). A small local duration formatter keeps
// this pure and dependency-free; it mirrors hud/summary.fmtDur intentionally.
// ============================================================================
import type { ParsedSession } from './types.ts';

export interface TallyStat {
  /** stable key (for tests / styling), e.g. 'reads'. */
  key: string;
  /** the real count (shown as the tile's big number). */
  value: number;
  /** number-FREE label with an honest unit, e.g. "次读文件". The unit (次/处/条/个)
   *  disambiguates operation-counts from distinct-file-counts — these are operation
   *  counts (Σ over the tool/file aggregates), NEVER a distinct-file claim. */
  label: string;
}

export interface EndTally {
  /** wall-clock span of the run, e.g. "6 分 12 秒", or null if timestamps are unusable. */
  duration: string | null;
  /** total real WorldEvents in the run — provenance for the seal ("this is a big, real run"). */
  totalEvents: number;
  /** the human's real (already-redacted) ask that drove the run, bounded — or null. */
  ask: string | null;
  /** the single hero number: total tool calls the agent made on its own. */
  hero: { value: number; label: string };
  /** the breakdown — only stats that actually happened (value > 0). */
  stats: TallyStat[];
  /** the honest flex: tiny human input → large autonomous output. */
  punchline: string;
  /** provenance line. */
  footnote: string;
}

/** Plain duration from two ISO stamps — pure, no hud dependency. */
function durationText(startISO?: string, endISO?: string): string | null {
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
  if (m) return `${m} 分 ${sec} 秒`;
  return `${sec} 秒`;
}

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/**
 * Compute the finale tally for a session. All counts are real aggregates:
 *   - hero  = Σ tool callCount (every tool the agent invoked)
 *   - reads/edits/writes = Σ file artifacts
 *   - commands = Σ bash_yard (Bash) calls
 *   - helpers  = dispatched actors (anything not the main agent or the human)
 *   - errors   = signals.toolFails  ·  wipes = signals.compactions
 * The ask is the FIRST real user prompt (the request that opened the work).
 */
export function endTally(session: ParsedSession): EndTally {
  const calls = session.tools.reduce((n, t) => n + t.callCount, 0);
  const reads = session.files.reduce((n, f) => n + f.reads, 0);
  const edits = session.files.reduce((n, f) => n + f.edits, 0);
  const writes = session.files.reduce((n, f) => n + f.writes, 0);
  const commands = session.tools
    .filter((t) => t.district === 'bash_yard')
    .reduce((n, t) => n + t.callCount, 0);
  // dispatched helpers = anything that isn't the main agent or the human, so
  // workflow crews/workers count too (matches the run-overview's definition).
  const helpers = session.actors.filter((a) => a.kind !== 'main' && a.kind !== 'human').length;
  const errors = session.signals.toolFails;
  const wipes = session.signals.compactions;

  // Labels carry an honest unit (次/处/条/个) and NO distinct-file claim: reads/
  // edits/writes/commands are OPERATION counts (Σ over the aggregates) — e.g. 85
  // writes means 85 write-operations, which is more than the distinct files touched.
  const stats: TallyStat[] = [];
  if (reads > 0) stats.push({ key: 'reads', value: reads, label: '次读文件' });
  if (edits > 0) stats.push({ key: 'edits', value: edits, label: '处改代码' });
  if (writes > 0) stats.push({ key: 'writes', value: writes, label: '次写文件' });
  if (commands > 0) stats.push({ key: 'commands', value: commands, label: '条命令' });
  if (helpers > 0) stats.push({ key: 'helpers', value: helpers, label: '个帮手' });
  if (errors > 0) stats.push({ key: 'errors', value: errors, label: '次报错，没停下' });
  if (wipes > 0) stats.push({ key: 'wipes', value: wipes, label: '次清空记忆，没乱' });

  // the opening ask — the first non-empty real user prompt
  let ask: string | null = null;
  for (const e of session.events) {
    if (e.kind === 'USER_PROMPT' && e.label && e.label.trim()) {
      ask = clip(e.label, 64);
      break;
    }
  }

  // Honest flex: the human stated intent; the agent did every step itself. Every
  // file read/written and command run in this transcript is an agent action — the
  // human channel only carries requests, never edits. So this asymmetry is literal.
  const punchline =
    calls > 0
      ? `人只说了要做什么 —— 剩下的 ${calls} 步，它自己干完了。`
      : '人只说了要做什么，剩下的它自己干。';

  return {
    duration: durationText(session.meta.startedAt, session.meta.endedAt),
    totalEvents: session.events.length,
    ask,
    hero: { value: calls, label: '次操作 · 全程它自己完成' },
    stats,
    punchline,
    footnote: '每个数字都来自这段真实记录。',
  };
}
