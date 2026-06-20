// ============================================================================
// AgentCity ingester — SUBAGENT FS ATTRIBUTION (node-only, DATA-CONTRACT §8).
// ----------------------------------------------------------------------------
// Split out of cli.ts (which runs main() on import) so this honesty-bearing
// logic is unit-testable against real fixture dirs. The two-pass fs walk over
// sibling subagent files is what turns a single-file "Workflow launched (running)"
// ack into the GROUND TRUTH — typed subagents, workflow crews/workers, journal
// outcomes, and PARALLEL_WAVE clustering. Every claim it emits (a crew finished,
// N workers ran in parallel, a worker committed) must trace to the files.
//
// Browser code never imports this (node:fs); it only runs in the CLI.
// ============================================================================
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ingestLines, ensureSubagentActor, type IngestState } from './parse.ts';
import { Redactor, type RedactionStats } from './redact.ts';
import { clusterWaves, firstTimestampMs, iterLines } from './cliutil.ts';
import type { Actor, ActorId } from '../model/types.ts';

export interface AttributionReport {
  typedAgents: number; // top-level subagents/agent-*.jsonl
  workflowDirs: number;
  workflowWorkers: number;
  journalResults: number;
  parallelWaves: number;
  filesStreamed: number;
  metaByAgentId: Map<string, { agentType?: string; description?: string; toolUseId?: string }>;
}

export function attributeSubagents(
  state: IngestState,
  subDir: string,
  redactor: Redactor
): AttributionReport {
  const report: AttributionReport = {
    typedAgents: 0,
    workflowDirs: 0,
    workflowWorkers: 0,
    journalResults: 0,
    parallelWaves: 0,
    filesStreamed: 0,
    metaByAgentId: new Map(),
  };
  if (!existsSync(subDir)) {
    state.warnings.push('no sibling subagents/ dir — single-file view only');
    return report;
  }

  // (1) top-level Agent subagents: subagents/agent-*.jsonl
  for (const entry of safeReaddir(subDir)) {
    const m = entry.match(/^agent-([a-z0-9]+)\.jsonl$/i);
    if (!m) continue;
    const agentId = m[1];
    const filePath = join(subDir, entry);
    report.typedAgents += 1;
    streamSubagentFile(state, filePath, agentId, 'subagent', redactor, report);
    // read sibling meta.json
    const meta = readMeta(join(subDir, `agent-${agentId}.meta.json`));
    if (meta) report.metaByAgentId.set(agentId, meta);
  }

  // (2) workflow crews: subagents/workflows/wf_<id>/
  const wfRoot = join(subDir, 'workflows');
  if (existsSync(wfRoot)) {
    for (const wfEntry of safeReaddir(wfRoot)) {
      const wfPath = join(wfRoot, wfEntry);
      if (!isDir(wfPath) || !/^wf_/.test(wfEntry)) continue;
      report.workflowDirs += 1;
      const crew = ensureSubagentActor(state, wfEntry, 'workflow-crew');
      crew.crewId = wfEntry;

      // worker first-line timestamps for PARALLEL_WAVE detection
      const workerStarts: { agentId: string; ts: number }[] = [];
      let crewJournalResults = 0;

      for (const fEntry of safeReaddir(wfPath)) {
        const wm = fEntry.match(/^agent-([a-z0-9]+)\.jsonl$/i);
        if (wm) {
          const agentId = wm[1];
          report.workflowWorkers += 1;
          const firstTs = streamSubagentFile(
            state,
            join(wfPath, fEntry),
            agentId,
            'workflow-worker',
            redactor,
            report,
            wfEntry
          );
          const worker = state.actors.get(agentId);
          if (worker) {
            worker.crewId = wfEntry;
            worker.agentType = worker.agentType ?? 'workflow-subagent';
          }
          if (firstTs) workerStarts.push({ agentId, ts: firstTs });
          const meta = readMeta(join(wfPath, `agent-${agentId}.meta.json`));
          if (meta) report.metaByAgentId.set(agentId, meta);
        } else if (fEntry === 'journal.jsonl') {
          const n = ingestJournal(state, join(wfPath, fEntry), wfEntry, redactor);
          report.journalResults += n;
          crewJournalResults += n;
        }
      }

      // The single-file Workflow result is just an async launch ack (status
      // "running"); the fs pass has the ground truth — if the journal recorded
      // results, the crew finished. Upgrade authoritatively here.
      crew.status = crewJournalResults > 0 ? 'completed' : (crew.status ?? 'completed');

      // PARALLEL_WAVE: cluster worker first-line timestamps within ~50ms
      const waves = clusterWaves(workerStarts, 50);
      for (const wave of waves) {
        if (wave.length >= 2) {
          report.parallelWaves += 1;
          // emit a derived PARALLEL_WAVE on the crew
          state.seq += 1;
          state.events.push({
            id: `wave:${wfEntry}:${report.parallelWaves}`,
            kind: 'PARALLEL_WAVE',
            ts: new Date(wave[0].ts).toISOString(),
            seq: state.seq,
            actorId: wfEntry,
            truth: 'derived',
            label: `parallel wave ×${wave.length}`,
            targetRef: wfEntry,
            detail: { workers: wave.length },
          });
        }
      }
    }
  }
  return report;
}

// Stream one subagent file through the core pipeline scoped to its agentId.
// Returns the first-line timestamp (ms) for wave clustering, if any.
function streamSubagentFile(
  state: IngestState,
  filePath: string,
  agentId: ActorId,
  kind: Actor['kind'],
  redactor: Redactor,
  report: AttributionReport,
  crewId?: string
): number | undefined {
  report.filesStreamed += 1;
  const actor = ensureSubagentActor(state, agentId, kind);
  if (crewId) actor.crewId = crewId;
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    state.warnings.push(`could not read subagent file ${basename(filePath)}`);
    return undefined;
  }
  const firstTs = firstTimestampMs(text);
  ingestLines(state, text, `subagents/${basename(filePath)}`, agentId, redactor);
  // promote actor status if still unknown
  const a = state.actors.get(agentId);
  if (a && !a.status) a.status = 'completed';
  return firstTs;
}

// Read a wf journal: emit WORKFLOW_WORKER_DONE per result event.
function ingestJournal(
  state: IngestState,
  journalPath: string,
  wfId: string,
  redactor: Redactor
): number {
  let count = 0;
  let text: string;
  try {
    text = readFileSync(journalPath, 'utf8');
  } catch {
    return 0;
  }
  for (const raw of iterLines(text)) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (o.type === 'result') {
      count += 1;
      const agentId = typeof o.agentId === 'string' ? o.agentId : undefined;
      const result = (o.result && typeof o.result === 'object' ? o.result : {}) as Record<
        string,
        unknown
      >;
      state.seq += 1;
      state.events.push({
        id: `wfdone:${wfId}:${agentId ?? count}`,
        kind: 'WORKFLOW_WORKER_DONE',
        ts: '',
        seq: state.seq,
        actorId: agentId ?? wfId,
        truth: 'observed',
        label: `worker ${agentId ?? '?'} done`,
        targetRef: wfId,
        detail: {
          committed: result.committed,
          headSha: typeof result.head_sha === 'string' ? result.head_sha : undefined,
          testPass: result.test_pass_count,
          // files_changed carries absolute paths — redact every string.
          filesChanged: redactor.deep(result.files_changed),
          hasBlockers: Array.isArray(result.blockers) ? result.blockers.length > 0 : undefined,
        },
      });
      if (agentId) {
        const worker = state.actors.get(agentId);
        if (worker) worker.status = 'completed';
      }
    }
  }
  return count;
}

// Apply meta.json links: agentId -> toolUseId (spawnedByToolId) + agentType.
export function applyMetaLinks(
  state: IngestState,
  metaByAgentId: Map<string, { agentType?: string; description?: string; toolUseId?: string }>
): void {
  for (const [agentId, meta] of metaByAgentId) {
    const actor = state.actors.get(agentId);
    if (!actor) continue;
    if (meta.toolUseId) actor.spawnedByToolId = actor.spawnedByToolId ?? meta.toolUseId;
    if (meta.agentType) actor.agentType = actor.agentType ?? meta.agentType;
    if (meta.description && !actor.description) {
      actor.description = redactDescription(state.redaction, meta.description);
    }
  }
}

function readMeta(
  path: string
): { agentType?: string; description?: string; toolUseId?: string } | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const o = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return {
      agentType: typeof o.agentType === 'string' ? o.agentType : undefined,
      description: typeof o.description === 'string' ? o.description : undefined,
      toolUseId: typeof o.toolUseId === 'string' ? o.toolUseId : undefined,
    };
  } catch {
    return undefined;
  }
}

function redactDescription(stats: RedactionStats, desc: string): string {
  const r = new Redactor(stats);
  return r.text(desc);
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
