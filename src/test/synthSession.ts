// ============================================================================
// synthSession — a deterministic, contract-faithful ParsedSession built BY HAND
// (no private transcript) so the honesty-bearing tests run on a fresh clone / in
// CI. The real fixture is gitignored; without this, every honesty assertion would
// `describe.skipIf` away and CI would be green-but-empty — fatal for a credential
// whose whole value is that its honesty is checkable.
//
// Internally consistent on purpose: the event stream and the tools/files/signals
// aggregates agree, so it exercises BOTH derivation paths the same way a real
// session does — laborSteps = Σ usage events (buildPanelModel) AND the finale's
// 「包括」sub-stats = endTally(tools/files/signals). Tune ONE place (the COUNTS
// table) and both stay in sync.
// ============================================================================
import type {
  Actor,
  FileArtifact,
  KanbanCard,
  ParsedSession,
  TokenUsage,
  WorldEvent,
  WorldEventKind,
} from '../model/types.ts';

/** The synthetic opening wish — exported so tests assert the real plumbed value
 *  rather than a fixture-specific string. Deliberately ASCII-free of secrets. */
export const SYNTH_WISH = '把这个项目从 3D 网页迁移到极简 TUI';

const ZERO: TokenUsage = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };

// The single source of truth for the synthetic run's scale. Both the event stream
// and the aggregates below are generated to match these, so the panel hero
// (Σ usage events) and the finale sub-stats (endTally aggregates) never disagree.
const COUNTS = {
  reads: 8, // FILE_READ  → archive
  edits: 6, // FILE_EDIT  → workshop
  writes: 3, // FILE_WRITE → workshop
  commands: 4, // SHELL_RUN  → bash_yard (1 of them errors)
  helpers: 1, // a dispatched subagent (SUBAGENT_SPAWN → crew_camp) + 1 actor
  errors: 1, // toolFails (the one failing SHELL_RUN)
  wipes: 1, // COMPACTION events / signals.compactions
} as const;

// laborSteps = Σ usage events = reads + edits + writes + commands + helpers(spawn)
export const SYNTH_LABOR_STEPS =
  COUNTS.reads + COUNTS.edits + COUNTS.writes + COUNTS.commands + COUNTS.helpers; // 22

let seq = 0;
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
function ev(kind: WorldEventKind, label: string, over: Partial<WorldEvent> = {}): WorldEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    kind,
    ts: new Date(T0 + seq * 1000).toISOString(),
    seq,
    actorId: 'main',
    truth: 'observed',
    label,
    ...over,
  };
}
function repeat(n: number, make: (i: number) => WorldEvent): WorldEvent[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

/** Build the deterministic synthetic session. Fresh each call (seq reset). */
export function synthSession(): ParsedSession {
  seq = 0;
  const events: WorldEvent[] = [
    ev('SESSION_START', 'session start'),
    ev('USER_PROMPT', SYNTH_WISH, { actorId: 'human', truth: 'observed' }),
    // chatter — NOT usage events; here to prove they never inflate laborSteps.
    ev('AGENT_THINK', '(thinking)'),
    ev('AGENT_SAY', '我先读一遍相关文件'),
    ...repeat(COUNTS.reads, (i) => ev('FILE_READ', `读 src/file${i}.ts`, { targetRef: `file${i}.ts` })),
    ...repeat(COUNTS.edits, (i) => ev('FILE_EDIT', `改 src/file${i}.ts`, { targetRef: `file${i}.ts` })),
    ...repeat(COUNTS.writes, (i) => ev('FILE_WRITE', `写 src/new${i}.ts`, { targetRef: `new${i}.ts` })),
    // commands — the LAST one errors (resilience: the run continues after it).
    ...repeat(COUNTS.commands, (i) =>
      ev('SHELL_RUN', `npm test`, i === COUNTS.commands - 1 ? { isError: true } : {})
    ),
    ev('SUBAGENT_SPAWN', '外派 Explore 帮手', { targetRef: 'agent-explore-1' }),
    ev('COMPACTION', '记忆压缩'),
    ev('AGENT_TURN_END', '(turn end)'),
  ];
  const lastSeq = events[events.length - 1].seq;

  const files: FileArtifact[] = [
    { path: 'src/file0.ts', basename: 'file0.ts', reads: 5, edits: 4, writes: 1, hunks: 4 },
    { path: 'src/file1.ts', basename: 'file1.ts', reads: 3, edits: 2, writes: 2, hunks: 2 },
  ]; // Σ reads=8, edits=6, writes=3 — matches COUNTS

  const actors: Actor[] = [
    { id: 'human', kind: 'human', firstSeq: 0, lastSeq, tokens: ZERO, toolUseCount: 0 },
    { id: 'main', kind: 'main', firstSeq: 1, lastSeq, tokens: { ...ZERO, output: 12000 }, toolUseCount: SYNTH_LABOR_STEPS - COUNTS.helpers },
    {
      id: 'agent-explore-1',
      kind: 'subagent',
      agentType: 'Explore',
      firstSeq: lastSeq - 2,
      lastSeq,
      tokens: ZERO,
      toolUseCount: 1,
      status: 'completed',
    },
  ]; // helpers = actors not main/human = 1 — matches COUNTS

  return {
    meta: {
      sessionId: 'synth-0001',
      schemaVersions: ['1.0'],
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:42:00.000Z', // → "42 分"
      taskSource: 'todowrite',
      warnings: [],
    },
    events,
    actors,
    tools: [
      { tool: 'Read', district: 'archive', callCount: COUNTS.reads, failCount: 0 },
      { tool: 'Edit', district: 'workshop', callCount: COUNTS.edits, failCount: 0 },
      { tool: 'Write', district: 'workshop', callCount: COUNTS.writes, failCount: 0 },
      { tool: 'Bash', district: 'bash_yard', callCount: COUNTS.commands, failCount: COUNTS.errors },
      { tool: 'Agent', district: 'crew_camp', callCount: COUNTS.helpers, failCount: 0 },
    ],
    files,
    kanban: [
      makeCard('k1', '迁移到 TUI', 'completed'),
      makeCard('k2', '硬化 provenance', 'in_progress'),
    ],
    signals: {
      totals: { ...ZERO, output: 12000, model: 'claude-opus-4-8' },
      byActor: {},
      permissionModeTimeline: [],
      gitBranchTimeline: [],
      compactions: COUNTS.wipes,
      apiRetries: 0,
      toolFails: COUNTS.errors,
    },
  };
}

function makeCard(id: string, subject: string, lane: KanbanCard['lane']): KanbanCard {
  return { id, subject, lane, history: [{ lane, seq: 1, ts: '2026-01-01T00:00:01.000Z' }], truth: 'observed' };
}
