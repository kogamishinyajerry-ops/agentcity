// The finale tally is the story's flex — so it is honesty-bearing: every number
// must be a real aggregate, only things that actually happened may appear, and the
// punchline's autonomy claim must hold for any session. These pin that contract.
import { describe, it, expect } from 'vitest';
import { endTally } from './tally.ts';
import type {
  ParsedSession,
  WorldEvent,
  WorldEventKind,
  SessionMeta,
  Actor,
  ToolDistrict,
  FileArtifact,
} from './types.ts';

function ev(seq: number, kind: WorldEventKind, extra: Partial<WorldEvent> = {}): WorldEvent {
  return { id: `e${seq}`, kind, ts: '', seq, actorId: 'main', truth: 'observed', label: '', ...extra };
}

function sess(
  parts: Omit<Partial<ParsedSession>, 'meta'> & { meta?: Partial<SessionMeta> } = {}
): ParsedSession {
  const { meta, ...rest } = parts;
  return {
    meta: { sessionId: 's', schemaVersions: [], taskSource: 'none', warnings: [], ...meta },
    events: [],
    actors: [],
    tools: [],
    files: [],
    kanban: [],
    signals: {
      totals: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      byActor: {},
      permissionModeTimeline: [],
      gitBranchTimeline: [],
      compactions: 0,
      apiRetries: 0,
      toolFails: 0,
    },
    ...rest,
  };
}

const tool = (tool: string, district: ToolDistrict['district'], callCount: number): ToolDistrict => ({
  tool,
  district,
  callCount,
  failCount: 0,
});

const file = (basename: string, reads: number, edits: number, writes: number): FileArtifact => ({
  path: basename,
  basename,
  reads,
  edits,
  writes,
  hunks: 0,
});

const actor = (id: string, kind: Actor['kind']): Actor => ({
  id,
  kind,
  firstSeq: 1,
  lastSeq: 1,
  tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  toolUseCount: 0,
});

describe('endTally — the honest finale numbers', () => {
  it('hero = the sum of every tool call (the headline autonomy number)', () => {
    const t = endTally(
      sess({ tools: [tool('Read', 'archive', 40), tool('Bash', 'bash_yard', 12), tool('Edit', 'workshop', 23)] })
    );
    expect(t.hero.value).toBe(75);
  });

  it('counts commands as Bash-district calls only', () => {
    const t = endTally(
      sess({ tools: [tool('Bash', 'bash_yard', 12), tool('Read', 'archive', 5)] })
    );
    expect(t.stats.find((s) => s.key === 'commands')?.value).toBe(12);
  });

  it('aggregates reads / edits / writes across file artifacts', () => {
    const t = endTally(
      sess({ files: [file('a.ts', 3, 2, 0), file('b.ts', 1, 0, 1), file('c.ts', 2, 4, 0)] })
    );
    expect(t.stats.find((s) => s.key === 'reads')?.value).toBe(6); // 3+1+2
    expect(t.stats.find((s) => s.key === 'edits')?.value).toBe(6); // 2+0+4
    expect(t.stats.find((s) => s.key === 'writes')?.value).toBe(1); // 0+1+0
  });

  it('helpers = dispatched actors only (never the main agent or the human)', () => {
    const t = endTally(
      sess({
        actors: [actor('main', 'main'), actor('u', 'human'), actor('a', 'subagent'), actor('w', 'workflow-worker')],
      })
    );
    expect(t.stats.find((s) => s.key === 'helpers')?.value).toBe(2);
  });

  it('surfaces errors and memory wipes from real signals', () => {
    const t = endTally(
      sess({ signals: { ...sess().signals, toolFails: 5, compactions: 1 } })
    );
    expect(t.stats.find((s) => s.key === 'errors')?.value).toBe(5);
    expect(t.stats.find((s) => s.key === 'wipes')?.value).toBe(1);
  });

  it('OMITS stats that did not happen (no zero-noise tiles)', () => {
    // a run that only read files: every other tile must be absent
    const t = endTally(sess({ files: [file('a.ts', 3, 0, 0)] }));
    const keys = t.stats.map((s) => s.key);
    expect(keys).toEqual(['reads']);
    expect(keys).not.toContain('edits');
    expect(keys).not.toContain('errors');
  });

  it('uses the FIRST real user prompt as the ask, bounded', () => {
    const t = endTally(
      sess({
        events: [
          ev(1, 'SESSION_START'),
          ev(2, 'USER_PROMPT', { label: '帮我做一个自走棋小游戏' }),
          ev(3, 'USER_PROMPT', { label: '再加一个商店' }),
        ],
      })
    );
    expect(t.ask).toBe('帮我做一个自走棋小游戏');
  });

  it('ask is null when there is no user prompt', () => {
    expect(endTally(sess({ events: [ev(1, 'SESSION_START')] })).ask).toBeNull();
  });

  it('formats duration from real timestamps, null when unusable', () => {
    expect(
      endTally(sess({ meta: { startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:06:12Z' } })).duration
    ).toBe('6 分 12 秒');
    expect(endTally(sess()).duration).toBeNull();
  });

  it('the punchline references the real total-call count (the flex is data-bound)', () => {
    const t = endTally(sess({ tools: [tool('Read', 'archive', 99)] }));
    expect(t.punchline).toContain('99');
  });

  it('totalEvents = the real event count (the seal provenance is data-bound)', () => {
    const t = endTally(
      sess({ events: [ev(1, 'SESSION_START'), ev(2, 'USER_PROMPT', { label: 'hi' }), ev(3, 'USER_PROMPT', { label: 'yo' })] })
    );
    expect(t.totalEvents).toBe(3);
  });
});
