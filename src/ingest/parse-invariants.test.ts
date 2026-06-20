// Cross-cutting HONESTY INVARIANTS on a rich, realistic multi-agent session.
// The parser audit verified these by hand against the real golden sample; this
// codifies them as permanent regression tests AND exercises shapes that single
// sample lacks: MCP calls, TWO subagents with DISTINCT token budgets, a Task*
// board with a completed AND a deleted card, a tool failure, a permission-mode
// change, an api retry, a model switch, and a compaction. If a future parser
// change breaks any invariant (e.g. token bleed between actors, fail double-count,
// kanban miscount), one of these fails.
import { describe, it, expect } from 'vitest';
import { parseTranscript } from './parse.ts';
import { jsonl, userPrompt, assistant, toolUse, toolResult, ts } from './_testkit.ts';
import type { ParsedSession, TokenUsage } from '../model/types.ts';

function buildRichSession(): string {
  return jsonl(
    userPrompt('do a bunch of work'), // SESSION_START + USER_PROMPT
    // main tool work — each turn a DISTINCT message.id carrying usage
    assistant([toolUse('Read', { file_path: '/Users/alice/p/a.ts' }, 't1')], { id: 'm1', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } }),
    toolResult('t1', { content: 'ok' }),
    assistant([toolUse('Write', { file_path: '/Users/alice/p/b.ts' }, 't2')], { id: 'm2', usage: { input_tokens: 80, output_tokens: 40, cache_read_input_tokens: 2000 } }),
    toolResult('t2', { content: 'ok' }),
    assistant([toolUse('Bash', { command: 'npm test' }, 't3')], { id: 'm3', usage: { input_tokens: 60, output_tokens: 30, cache_read_input_tokens: 3000 } }),
    toolResult('t3', { isError: true, content: 'exit 1' }), // the ONLY failure
    assistant([toolUse('mcp__preview__screenshot', { url: 'x' }, 't4')], { id: 'm4', usage: { input_tokens: 40, output_tokens: 20, cache_read_input_tokens: 4000 } }),
    toolResult('t4', { content: 'ok' }),
    // two subagents with DISTINCT budgets (usage lives on the Agent tool_result)
    assistant([toolUse('Agent', { description: 'map routes', subagent_type: 'Explore' }, 'ag1')], { id: 'm5', usage: { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 5000 } }),
    toolResult('ag1', { toolUseResult: { agentId: 'sub-a', agentType: 'Explore', status: 'completed', usage: { output_tokens: 1400, cache_read_input_tokens: 41000 } } }),
    assistant([toolUse('Agent', { description: 'audit', subagent_type: 'general-purpose' }, 'ag2')], { id: 'm6', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 6000 } }),
    toolResult('ag2', { toolUseResult: { agentId: 'sub-b', agentType: 'general-purpose', status: 'completed', usage: { input_tokens: 500, output_tokens: 700, cache_read_input_tokens: 12000, cache_creation_input_tokens: 530 } } }),
    // Task* board: T1 pending->in_progress->completed, T2 pending->deleted (kanban turns carry NO usage)
    assistant([toolUse('TaskCreate', { subject: 'ship feature' }, 'tc1')], { id: 'k1' }),
    toolResult('tc1', { toolUseResult: { task: { id: 'T1', subject: 'ship feature' } } }),
    assistant([toolUse('TaskUpdate', { taskId: 'T1' }, 'tu1')], { id: 'k2' }),
    toolResult('tu1', { toolUseResult: { statusChange: { taskId: 'T1', to: 'in_progress' } } }),
    assistant([toolUse('TaskUpdate', { taskId: 'T1' }, 'tu2')], { id: 'k3' }),
    toolResult('tu2', { toolUseResult: { statusChange: { taskId: 'T1', to: 'completed' } } }),
    assistant([toolUse('TaskCreate', { subject: 'scrap idea' }, 'tc2')], { id: 'k4' }),
    toolResult('tc2', { toolUseResult: { task: { id: 'T2', subject: 'scrap idea' } } }),
    assistant([toolUse('TaskUpdate', { taskId: 'T2' }, 'tu3')], { id: 'k5' }),
    toolResult('tu3', { toolUseResult: { statusChange: { taskId: 'T2', to: 'deleted' } } }),
    // system lines
    { type: 'permission-mode', permissionMode: 'plan', timestamp: ts() },
    { type: 'permission-mode', permissionMode: 'default', timestamp: ts() },
    { type: 'system', subtype: 'api_error', timestamp: ts(), retryAttempt: 1, maxRetries: 3, retryInMs: 2000 },
    { type: 'system', subtype: 'model_refusal_fallback', timestamp: ts(), originalModel: 'claude-fable-5', fallbackModel: 'claude-opus-4-8' },
    { type: 'system', subtype: 'compact_boundary', uuid: 'cb1', timestamp: ts(), compactMetadata: { trigger: 'auto' } }
  );
}

const sumByActor = (s: ParsedSession): TokenUsage => {
  const acc = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  for (const a of Object.values(s.signals.byActor)) {
    acc.input += a.input;
    acc.output += a.output;
    acc.cacheCreate += a.cacheCreate;
    acc.cacheRead += a.cacheRead;
  }
  return acc;
};

describe('parser honesty invariants — rich multi-agent session', () => {
  const s = parseTranscript(buildRichSession(), 'main');

  it('totals == Σ byActor on every token field (no number invented or lost)', () => {
    const sum = sumByActor(s);
    expect(s.signals.totals.input).toBe(sum.input);
    expect(s.signals.totals.output).toBe(sum.output);
    expect(s.signals.totals.cacheCreate).toBe(sum.cacheCreate);
    expect(s.signals.totals.cacheRead).toBe(sum.cacheRead);
  });

  it('per-actor tokens DO NOT bleed: main excludes subagent usage', () => {
    // main's six usage-bearing turns: cacheRead 1000+2000+3000+4000+5000+6000
    expect(s.signals.byActor['main'].cacheRead).toBe(21000);
    expect(s.signals.byActor['main'].input).toBe(310); // 100+80+60+40+20+10
    // each subagent reports its OWN declared budget, attributed to itself
    expect(s.signals.byActor['sub-a'].cacheRead).toBe(41000);
    expect(s.signals.byActor['sub-a'].output).toBe(1400);
    expect(s.signals.byActor['sub-b'].cacheRead).toBe(12000);
    expect(s.signals.byActor['sub-b'].input).toBe(500);
    expect(s.signals.byActor['sub-b'].cacheCreate).toBe(530);
    // main must NOT have absorbed the subagents' cacheRead
    expect(s.signals.byActor['main'].cacheRead).not.toBe(21000 + 41000 + 12000);
  });

  it('tool failures are counted exactly once across all three surfaces', () => {
    const toolFailEvents = s.events.filter((e) => e.kind === 'TOOL_FAIL').length;
    const sumFailCount = s.tools.reduce((n, t) => n + t.failCount, 0);
    expect(s.signals.toolFails).toBe(1);
    expect(toolFailEvents).toBe(1);
    expect(sumFailCount).toBe(1);
  });

  it('each turn usage is stamped on exactly ONE event, only on main, once per message.id', () => {
    const stamped = s.events.filter((e) => e.detail?.messageId);
    const ids = stamped.map((e) => e.detail!.messageId as string);
    expect(new Set(ids).size).toBe(ids.length); // no message.id stamped twice
    expect(new Set(ids)).toEqual(new Set(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']));
    expect(stamped.every((e) => e.actorId === 'main')).toBe(true);
  });

  it('kanban reconstructs the board honestly: T1 completed, T2 deleted, history seq-monotonic', () => {
    expect(s.meta.taskSource).toBe('task-star');
    const t1 = s.kanban.find((c) => c.id === 'T1');
    const t2 = s.kanban.find((c) => c.id === 'T2');
    expect(t1?.lane).toBe('completed');
    expect(t1?.history.map((h) => h.lane)).toEqual(['pending', 'in_progress', 'completed']);
    expect(t2?.lane).toBe('deleted');
    for (const c of s.kanban) {
      const seqs = c.history.map((h) => h.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b)); // monotonic
      expect(c.lane).toBe(c.history[c.history.length - 1].lane); // final lane == last move
    }
    const lanes = s.kanban.reduce<Record<string, number>>((m, c) => ((m[c.lane] = (m[c.lane] ?? 0) + 1), m), {});
    expect(lanes).toEqual({ completed: 1, deleted: 1 });
  });

  it('an MCP tool routes to the consulate and emits an MCP_CALL event', () => {
    const mcp = s.tools.find((t) => t.tool.startsWith('mcp__'));
    expect(mcp?.district).toBe('consulate');
    expect(s.events.some((e) => e.kind === 'MCP_CALL')).toBe(true);
  });

  it('system signals match the lines exactly', () => {
    expect(s.signals.compactions).toBe(1);
    expect(s.signals.apiRetries).toBe(1);
    expect(s.events.filter((e) => e.kind === 'MODEL_SWITCH').length).toBe(1);
    expect(s.events.filter((e) => e.kind === 'MODE_CHANGE').length).toBe(2);
    expect(s.signals.permissionModeTimeline.map((m) => m.mode)).toEqual(['plan', 'default']);
  });

  it('event seq is strictly increasing with no duplicates', () => {
    const seqs = s.events.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
  });

  it('redaction reached the rich session — no raw username survived', () => {
    expect(JSON.stringify(s)).not.toContain('alice');
  });
});
