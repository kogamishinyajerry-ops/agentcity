// @vitest-environment node
// ============================================================================
// subagents.ts — the node-fs subagent attribution pass (DATA-CONTRACT §8).
// ----------------------------------------------------------------------------
// This is the LAST honesty-bearing complex path that wasn't unit-tested. It
// turns a single-file "Workflow launched (running)" ack into ground truth by
// walking sibling files. Every claim it derives must trace to those files:
//   • "parallel wave ×N"  — only when N worker FIRST-lines fall within 50ms
//   • a crew finished      — only when its journal recorded results
//   • a worker committed   — only from a journal `result` line
//   • files_changed shown  — absolute paths REDACTED before they reach the model
// We build a real temp fixture dir and assert every one of those, plus that the
// username in a synthetic /Users/alice path never survives into any event/actor.
// ============================================================================
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attributeSubagents, applyMetaLinks } from './subagents.ts';
import { newIngestState, ensureSubagentActor } from './parse.ts';
import { Redactor } from './redact.ts';

// A minimal-but-real subagent transcript line: line 1 carries the timestamp
// firstTimestampMs() reads for wave clustering. Content beyond that is inert.
const transcriptLine = (id: string, ts: string): string =>
  JSON.stringify({
    timestamp: ts,
    type: 'assistant',
    message: { id: `msg_${id}`, role: 'assistant', model: 'claude-x', content: [{ type: 'text', text: 'work' }] },
  }) + '\n';

// detail is a loose record on WorldEvent — cast once so property access is clean.
const det = (e: { detail?: unknown }): Record<string, unknown> => (e.detail ?? {}) as Record<string, unknown>;

const roots: string[] = [];
function freshRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'agentcity-sub-'));
  roots.push(r);
  return r;
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// One rich fixture exercising every branch, asserted across many `it`s.
// ---------------------------------------------------------------------------
describe('attributeSubagents — fs walk produces honest ground truth', () => {
  let subDir: string;
  let state: ReturnType<typeof newIngestState>;
  let report: ReturnType<typeof attributeSubagents>;

  beforeAll(() => {
    const root = freshRoot();
    subDir = join(root, 'subagents');
    mkdirSync(subDir, { recursive: true });

    // (1) a top-level typed Agent subagent + its meta.json (carries a username path)
    writeFileSync(join(subDir, 'agent-aaa111.jsonl'), transcriptLine('aaa111', '2026-01-01T00:00:00.000Z'));
    writeFileSync(
      join(subDir, 'agent-aaa111.meta.json'),
      JSON.stringify({ agentType: 'Explore', description: 'Search /Users/alice/secret-notes for the bug', toolUseId: 'toolu_1' })
    );

    // (2) a workflow crew with 3 workers: w0 & w1 start within 50ms (one wave),
    //     w2 starts 5s later (separate, singleton — NOT a wave).
    const wfDir = join(subDir, 'workflows', 'wf_test01');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'agent-w0.jsonl'), transcriptLine('w0', '2026-01-01T00:00:00.000Z'));
    writeFileSync(join(wfDir, 'agent-w1.jsonl'), transcriptLine('w1', '2026-01-01T00:00:00.020Z'));
    writeFileSync(join(wfDir, 'agent-w2.jsonl'), transcriptLine('w2', '2026-01-01T00:00:05.000Z'));

    // journal: w0 committed clean; w1 failed with a blocker. Plus a non-result
    // line and a malformed line that must both be skipped without crashing.
    const journal = [
      JSON.stringify({ type: 'result', agentId: 'w0', result: { committed: true, head_sha: 'abc123', test_pass_count: 12, files_changed: ['/Users/alice/proj/x.ts', '/Users/alice/proj/y.ts'], blockers: [] } }),
      JSON.stringify({ type: 'progress', agentId: 'w0', note: 'halfway' }),
      'this is not json at all',
      JSON.stringify({ type: 'result', agentId: 'w1', result: { committed: false, head_sha: 'def456', test_pass_count: 0, files_changed: ['/Users/alice/proj/z.ts'], blockers: ['compile error'] } }),
    ].join('\n') + '\n';
    writeFileSync(join(wfDir, 'journal.jsonl'), journal);

    // (3) noise that MUST be ignored: a non-wf_ dir and a stray file under workflows/
    mkdirSync(join(subDir, 'workflows', 'not_a_wf'), { recursive: true });
    writeFileSync(join(subDir, 'workflows', 'not_a_wf', 'agent-z.jsonl'), transcriptLine('z', '2026-01-01T00:00:00.000Z'));
    writeFileSync(join(subDir, 'workflows', 'stray.txt'), 'ignore me');

    state = newIngestState();
    report = attributeSubagents(state, subDir, new Redactor(state.redaction));
    applyMetaLinks(state, report.metaByAgentId);
  });

  it('counts typed agents, crews, workers, journal results, waves, files', () => {
    expect(report.typedAgents).toBe(1);
    expect(report.workflowDirs).toBe(1); // wf_test01 only — not_a_wf ignored
    expect(report.workflowWorkers).toBe(3);
    expect(report.journalResults).toBe(2); // non-result + malformed skipped
    expect(report.parallelWaves).toBe(1); // w0+w1 only
    expect(report.filesStreamed).toBe(4); // aaa111 + w0 + w1 + w2 (agent-z NOT streamed)
  });

  it('creates the typed agent and links its meta (agentType, spawn tool, redacted description)', () => {
    const a = state.actors.get('aaa111');
    expect(a).toBeDefined();
    expect(a!.kind).toBe('subagent');
    expect(a!.status).toBe('completed');
    expect(a!.agentType).toBe('Explore');
    expect(a!.spawnedByToolId).toBe('toolu_1');
    // description redacted: /Users/alice/secret-notes -> ~/secret-notes
    expect(a!.description).toBe('Search ~/secret-notes for the bug');
    expect(a!.description).not.toContain('alice');
  });

  it('reconstructs the crew and its workers with crewId + completed status', () => {
    const crew = state.actors.get('wf_test01');
    expect(crew).toBeDefined();
    expect(crew!.kind).toBe('workflow-crew');
    expect(crew!.crewId).toBe('wf_test01');
    expect(crew!.status).toBe('completed'); // journal had results -> authoritatively finished

    for (const id of ['w0', 'w1', 'w2']) {
      const w = state.actors.get(id);
      expect(w, id).toBeDefined();
      expect(w!.kind).toBe('workflow-worker');
      expect(w!.crewId).toBe('wf_test01');
      expect(w!.agentType).toBe('workflow-subagent');
    }
    // workers named in a journal result are upgraded to completed
    expect(state.actors.get('w0')!.status).toBe('completed');
    expect(state.actors.get('w1')!.status).toBe('completed');
  });

  it('emits exactly one PARALLEL_WAVE (×2), derived, on the crew', () => {
    const waves = state.events.filter((e) => e.kind === 'PARALLEL_WAVE');
    expect(waves).toHaveLength(1);
    expect(waves[0].truth).toBe('derived'); // a clustering inference, labeled as such
    expect(waves[0].actorId).toBe('wf_test01');
    expect(waves[0].label).toBe('parallel wave ×2');
    expect(det(waves[0])).toMatchObject({ workers: 2 });
  });

  it('emits WORKFLOW_WORKER_DONE per journal result with redacted files_changed', () => {
    const done = state.events.filter((e) => e.kind === 'WORKFLOW_WORKER_DONE');
    expect(done).toHaveLength(2);

    const w0 = done.find((e) => e.actorId === 'w0')!;
    expect(w0.truth).toBe('observed'); // straight from the journal, not inferred
    expect(det(w0)).toMatchObject({ committed: true, headSha: 'abc123', testPass: 12, hasBlockers: false });
    expect(det(w0).filesChanged).toEqual(['~/proj/x.ts', '~/proj/y.ts']);

    const w1 = done.find((e) => e.actorId === 'w1')!;
    expect(det(w1)).toMatchObject({ committed: false, hasBlockers: true });
    expect(det(w1).filesChanged).toEqual(['~/proj/z.ts']);
  });

  it('NEVER leaks the OS username through any actor or event', () => {
    const dump = JSON.stringify([...state.actors.values()]) + JSON.stringify(state.events);
    expect(dump).not.toContain('alice');
    expect(dump).not.toMatch(/\/Users\/[A-Za-z]/);
  });
});

// ---------------------------------------------------------------------------
// Boundary + helper behavior.
// ---------------------------------------------------------------------------
describe('attributeSubagents — boundaries', () => {
  it('records a single-file warning and zero counts when there is no subagents/ dir', () => {
    const state = newIngestState();
    const report = attributeSubagents(state, join(freshRoot(), 'does-not-exist'), new Redactor(state.redaction));
    expect(report.typedAgents).toBe(0);
    expect(report.workflowDirs).toBe(0);
    expect(report.filesStreamed).toBe(0);
    expect(state.warnings.some((w) => /no sibling subagents/.test(w))).toBe(true);
  });
});

describe('applyMetaLinks — fill-only, never overwrite or invent', () => {
  it('sets empty fields, preserves already-set ones, and skips unknown agents', () => {
    const state = newIngestState();
    const existing = ensureSubagentActor(state, 'x1', 'subagent');
    existing.agentType = 'PreSet'; // already known — meta must NOT clobber
    existing.spawnedByToolId = 'preset_tool';

    applyMetaLinks(
      state,
      new Map([
        ['x1', { agentType: 'Explore', description: 'edit /Users/bob/p', toolUseId: 'toolu_new' }],
        ['ghost', { agentType: 'Plan' }], // no such actor -> skipped, NOT created
      ])
    );

    const a = state.actors.get('x1')!;
    expect(a.agentType).toBe('PreSet'); // not overwritten
    expect(a.spawnedByToolId).toBe('preset_tool'); // not overwritten
    expect(a.description).toBe('edit ~/p'); // was empty -> filled + redacted
    expect(state.actors.has('ghost')).toBe(false); // never fabricated
  });
});
