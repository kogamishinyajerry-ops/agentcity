// ============================================================================
// AgentCity ingester — CORE PARSER (DATA-CONTRACT.md + EVENT-DICTIONARY.md)
// ----------------------------------------------------------------------------
// parseTranscript(mainText, fileName?) : ParsedSession
//
// Pure & browser-safe (no node fs). Handles ONE main transcript's text:
//   - stream line-by-line, JSON.parse each in try/catch, skip+collect malformed
//   - line-type routing (§2), causal threading w/ multi-root + compaction bridge (§3)
//   - tool_use<->tool_result pairing by id (§4.1) + per-tool safe summaries (§4.2)
//   - full WorldEvent vocabulary (EVENT-DICTIONARY §1-5) with correct truth levels
//   - task-source resolution Task* first, TodoWrite fallback (§6) -> kanban
//   - cost dedupe by message.id (§7) -> signals.totals + byActor
//   - subagent SPAWN/RESULT/WORKFLOW_LAUNCH from THIS file (single-file view)
//   - redaction (§9) on every string before it reaches the entity model
//
// The CLI (cli.ts) reuses this and layers the node-fs subagent pass on top via
// the exported `ingestSubagentFile` + `IngestState` seam.
// ============================================================================
import type {
  Actor,
  ActorId,
  FileArtifact,
  KanbanCard,
  KanbanLane,
  ParsedSession,
  SessionSignals,
  TaskSource,
  TokenUsage,
  ToolDistrict,
  TruthLevel,
  WorldEvent,
  WorldEventKind,
} from '../model/types.ts';
import { toolToDistrict } from '../model/mapping.ts';
import { Redactor, newRedactionStats, type RedactionStats } from './redact.ts';

// ---------------------------------------------------------------------------
// Loose JSONL line shape (everything optional — never crash on a missing field)
// ---------------------------------------------------------------------------
interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  signature?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  source?: { type?: string; media_type?: string; data?: string };
  [k: string]: unknown;
}
interface Message {
  id?: string;
  role?: string;
  model?: string;
  content?: string | ContentBlock[];
  usage?: Record<string, unknown>;
  stop_reason?: string | null;
  [k: string]: unknown;
}
interface Line {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  logicalParentUuid?: string | null;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  agentId?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  permissionMode?: string;
  subtype?: string;
  message?: Message;
  toolUseResult?: unknown;
  compactMetadata?: Record<string, unknown>;
  version?: string;
  // metadata-kind specific
  operation?: string;
  content?: unknown;
  slug?: string;
  mode?: string;
  messageId?: string;
  leafUuid?: string;
  lastPrompt?: unknown;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Shared parse state — lets cli.ts feed subagent files into the same pipeline.
// ---------------------------------------------------------------------------
export interface IngestState {
  events: WorldEvent[];
  actors: Map<ActorId, Actor>;
  tools: Map<string, ToolDistrict>;
  files: Map<string, FileArtifact>;
  // kanban
  taskCards: Map<string, KanbanCard>; // Task* family (primary)
  taskSeen: boolean;
  todoSeen: boolean;
  todoLast: TodoItem[] | null;
  todoCards: Map<string, KanbanCard>; // TodoWrite (legacy, content-keyed)
  // cost dedupe by message.id, scoped per actor
  costSeen: Set<string>;
  // signals
  permissionTimeline: { mode: string; seq: number; ts: string }[];
  branchTimeline: { branch: string; seq: number; ts: string }[];
  compactions: number;
  apiRetries: number;
  toolFails: number;
  // pairing — tool_use id -> { name, eventIndex } so a later result can backfill
  pendingTools: Map<string, { name: string; eventIdx: number; actorId: ActorId }>;
  // meta
  schemaVersions: Set<string>;
  warnings: string[];
  redaction: RedactionStats;
  // running seq counter (global, monotonic across files)
  seq: number;
  // tracking last seen cwd/branch for change detection (per file scope)
  sessionId?: string;
  projectDir?: string;
  title?: string;
  startedAt?: string;
  endedAt?: string;
  prLinked?: boolean;
  // links the CLI fills: agentId -> spawning toolUseId / agentType / description
  // (so subagent actors can be promoted from stubs to real)
}

interface TodoItem {
  content?: string;
  activeForm?: string;
  status?: string;
}

export function newIngestState(): IngestState {
  return {
    events: [],
    actors: new Map(),
    tools: new Map(),
    files: new Map(),
    taskCards: new Map(),
    taskSeen: false,
    todoSeen: false,
    todoLast: null,
    todoCards: new Map(),
    costSeen: new Set(),
    permissionTimeline: [],
    branchTimeline: [],
    compactions: 0,
    apiRetries: 0,
    toolFails: 0,
    pendingTools: new Map(),
    schemaVersions: new Set(),
    warnings: [],
    redaction: newRedactionStats(),
    seq: 0,
  };
}

// ---------------------------------------------------------------------------
// Public entry — single main transcript text -> ParsedSession
// ---------------------------------------------------------------------------
export function parseTranscript(mainText: string, fileName?: string): ParsedSession {
  const state = newIngestState();
  const sessionId = deriveSessionId(fileName);
  if (sessionId) state.sessionId = sessionId;

  const redactor = new Redactor(state.redaction, deriveProjectRoots(mainText, fileName));
  const fileLabel = fileName ?? 'main';

  ingestLines(state, mainText, fileLabel, 'main', redactor);

  return finalize(state);
}

// ---------------------------------------------------------------------------
// Stream one file's text into state. actorId = 'main' for the main file,
// or a subagent's agentId for a subagent file (called by the CLI).
// ---------------------------------------------------------------------------
export function ingestLines(
  state: IngestState,
  text: string,
  fileLabel: string,
  defaultActorId: ActorId,
  redactor: Redactor
): void {
  let lineNo = 0;
  let lastCwd: string | undefined;
  let lastBranch: string | undefined;
  let start = 0;
  const len = text.length;

  // Stream by '\n' boundaries WITHOUT building the whole array (keeps the 64MB
  // transcript from materializing a giant string[]). We slice line by line.
  while (start <= len) {
    let nl = text.indexOf('\n', start);
    if (nl === -1) nl = len;
    const raw = text.slice(start, nl);
    start = nl + 1;
    lineNo += 1;
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      if (nl >= len) break;
      continue;
    }
    let line: Line;
    try {
      line = JSON.parse(trimmed) as Line;
    } catch {
      state.warnings.push(`malformed JSON at ${fileLabel}:${lineNo}`);
      if (nl >= len) break;
      continue;
    }

    try {
      const ctx: LineCtx = {
        state,
        line,
        fileLabel,
        lineNo,
        defaultActorId,
        redactor,
      };
      // cwd / branch change detection (only meaningful within one file's stream)
      const cwd = typeof line.cwd === 'string' ? redactor.text(line.cwd) : undefined;
      const branch =
        typeof line.gitBranch === 'string' ? redactor.text(line.gitBranch) : undefined;
      routeLine(ctx);
      if (cwd !== undefined) {
        if (lastCwd !== undefined && cwd !== lastCwd) {
          emit(ctx, 'CWD_CHANGE', defaultActorId, `cwd → ${cwd}`, 'observed', {
            targetRef: cwd,
          });
        }
        lastCwd = cwd;
      }
      if (branch !== undefined) {
        if (lastBranch !== undefined && branch !== lastBranch) {
          emit(ctx, 'BRANCH_SWITCH', defaultActorId, `branch → ${branch}`, 'observed', {
            targetRef: branch,
          });
          state.branchTimeline.push({ branch, seq: state.seq, ts: ts(line) });
        } else if (lastBranch === undefined) {
          state.branchTimeline.push({ branch, seq: state.seq, ts: ts(line) });
        }
        lastBranch = branch;
      }
      if (typeof line.version === 'string') state.schemaVersions.add(line.version);
    } catch (err) {
      // Crash-resistance contract: never abort the file on one bad line.
      state.warnings.push(
        `route error at ${fileLabel}:${lineNo}: ${(err as Error).message ?? 'unknown'}`
      );
    }
    if (nl >= len) break;
  }
}

// ---------------------------------------------------------------------------
interface LineCtx {
  state: IngestState;
  line: Line;
  fileLabel: string;
  lineNo: number;
  defaultActorId: ActorId;
  redactor: Redactor;
}

function routeLine(ctx: LineCtx): void {
  const { line, state } = ctx;
  const t = line.type;
  // first-seen / last-seen timestamps for meta
  const stamp = ts(line);
  if (stamp) {
    if (!state.startedAt) state.startedAt = stamp;
    state.endedAt = stamp;
  }
  if (!state.sessionId && typeof line.sessionId === 'string') {
    state.sessionId = line.sessionId;
  }

  switch (t) {
    case 'user':
      routeUser(ctx);
      break;
    case 'assistant':
      routeAssistant(ctx);
      break;
    case 'attachment':
      emit(ctx, 'INJECTED_CONTEXT', ctx.defaultActorId, attachmentLabel(line), 'observed', {
        truth: 'observed',
      });
      break;
    case 'system':
      routeSystem(ctx);
      break;
    // ---- metadata kinds (NO uuid, NOT threaded) ----
    case 'last-prompt':
      // live-tip pointer only; no event.
      break;
    case 'mode':
    case 'permission-mode': {
      const mode =
        (typeof line.permissionMode === 'string' && line.permissionMode) ||
        (typeof line.mode === 'string' && line.mode) ||
        'default';
      const last = state.permissionTimeline[state.permissionTimeline.length - 1];
      if (!last || last.mode !== mode) {
        state.permissionTimeline.push({ mode, seq: state.seq + 1, ts: stamp });
        emit(ctx, 'MODE_CHANGE', ctx.defaultActorId, `permission → ${mode}`, 'observed', {
          targetRef: mode,
        });
      }
      break;
    }
    case 'ai-title': {
      // Redact ONCE at the source: a title slug can embed a project/path fragment,
      // so the event label + targetRef must use the safe form too (not just
      // state.title). "Redaction at ingest on every string reaching the model."
      const raw = typeof line.slug === 'string' ? line.slug : undefined;
      const slug = raw ? ctx.redactor.text(raw) : undefined;
      if (slug && !state.title) state.title = slug;
      emit(ctx, 'AI_TITLE', ctx.defaultActorId, `title: ${slug ?? '?'}`, 'observed', {
        targetRef: slug,
      });
      break;
    }
    case 'agent-name':
    case 'agent-setting':
      // display labels only; no city event.
      break;
    case 'pr-link':
      state.prLinked = true;
      emit(ctx, 'PR_LINKED', ctx.defaultActorId, 'PR linked', 'observed');
      break;
    case 'queue-operation': {
      if (line.operation === 'enqueue') {
        emit(ctx, 'PROMPT_QUEUED', 'human', 'prompt queued', 'observed', {
          targetRef: ctx.defaultActorId,
        });
      }
      break;
    }
    case 'file-history-snapshot':
      emit(ctx, 'FILE_SNAPSHOT', ctx.defaultActorId, 'file snapshot', 'observed', {
        targetRef: typeof line.messageId === 'string' ? line.messageId : undefined,
      });
      break;
    case 'summary':
      // documented resume-index line; not threaded, not seen locally — ignore.
      break;
    default:
      // unknown type -> generic, never throw.
      if (t) {
        emit(ctx, 'GENERIC_TOOL', ctx.defaultActorId, `unknown line type: ${t}`, 'derived');
      }
      break;
  }
}

// ---- user lines ------------------------------------------------------------
function routeUser(ctx: LineCtx): void {
  const { line } = ctx;
  const content = line.message?.content;

  // compaction recap
  if (line.isCompactSummary === true) {
    emit(ctx, 'COMPACTION_SUMMARY', ctx.defaultActorId, 'compaction recap', 'observed');
    return;
  }

  // SESSION_START / SESSION_RESUME for roots (parentUuid null = start;
  // non-null but we can't resolve in single-file view = resume/fork).
  if (line.parentUuid === null && ctx.defaultActorId === 'main') {
    emit(ctx, 'SESSION_START', 'main', 'session begins', 'observed');
  }

  if (typeof content === 'string') {
    // STRING content = a user prompt (unless meta).
    if (line.isMeta === true) {
      emit(ctx, 'INJECTED_CONTEXT', ctx.defaultActorId, 'injected context', 'observed');
    } else {
      const label = firstLine(ctx.redactor.text(content), 80) || 'user prompt';
      emit(ctx, 'USER_PROMPT', 'human', label, 'observed', {
        targetRef: ctx.defaultActorId,
      });
    }
    return;
  }

  if (Array.isArray(content)) {
    let sawToolResult = false;
    let sawText = false;
    for (const block of content) {
      if (!isBlock(block)) continue;
      if (block.type === 'tool_result') {
        sawToolResult = true;
        handleToolResult(ctx, block);
      } else if (block.type === 'text' && typeof block.text === 'string') {
        sawText = true;
      } else if (block.type === 'image') {
        // a screenshot returned as user content (rare on user side)
        emit(ctx, 'SCREENSHOT', ctx.defaultActorId, 'screenshot', 'observed');
      }
    }
    // A text-only user array w/o tool_result and not meta = a prompt.
    if (!sawToolResult && sawText && line.isMeta !== true) {
      const txt = firstTextBlock(content);
      const label = firstLine(ctx.redactor.text(txt), 80) || 'user prompt';
      emit(ctx, 'USER_PROMPT', 'human', label, 'observed', {
        targetRef: ctx.defaultActorId,
      });
    }
  }
}

// ---- assistant lines -------------------------------------------------------
function routeAssistant(ctx: LineCtx): void {
  const { line, state } = ctx;
  const msg = line.message;
  if (!msg) return;

  // cost dedupe by message.id (§7) — accumulate once per id, skip <synthetic>.
  const cost = accumulateCost(ctx);
  const evStart = state.events.length; // first event index this turn will emit

  // stop_reason end_turn, deduped per message.id (re-use costSeen-ish marker).
  if (msg.stop_reason === 'end_turn') {
    const key = `endturn:${msg.id ?? ctx.lineNo}`;
    if (!state.costSeen.has(key)) {
      state.costSeen.add(key);
      emit(ctx, 'AGENT_TURN_END', ctx.defaultActorId, 'turn end', 'observed');
    }
  }

  const content = msg.content;
  if (typeof content === 'string') {
    if (content.trim().length > 0) {
      emit(ctx, 'AGENT_SAY', ctx.defaultActorId, firstLine(ctx.redactor.text(content), 80), 'observed', {
        targetRef: 'human',
      });
    }
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!isBlock(block)) continue;
      switch (block.type) {
        case 'text':
          if (typeof block.text === 'string' && block.text.trim().length > 0) {
            emit(
              ctx,
              'AGENT_SAY',
              ctx.defaultActorId,
              firstLine(ctx.redactor.text(block.text), 80),
              'observed',
              { targetRef: 'human' }
            );
          }
          break;
        case 'thinking':
          emit(ctx, 'AGENT_THINK', ctx.defaultActorId, 'thinking', 'observed');
          break;
        case 'tool_use':
          handleToolUse(ctx, block);
          break;
        default:
          break;
      }
    }
  }

  // Stamp this turn's token usage onto its first emitted event so the
  // seq-accurate context-pressure meter (health.ts) can read per-turn prompt
  // size. Deduped by messageId here (accumulateCost returns once/id) and again
  // defensively in the meter. tk.cacheRead ≈ how full the context was this turn.
  if (cost && state.events.length > evStart) {
    const first = state.events[evStart];
    first.tokens = cost.tk;
    first.detail = { ...(first.detail ?? {}), messageId: cost.mid };
  }
}

// ---- system lines ----------------------------------------------------------
function routeSystem(ctx: LineCtx): void {
  const { line, state } = ctx;
  const sub = line.subtype;
  switch (sub) {
    case 'compact_boundary': {
      state.compactions += 1;
      const meta = line.compactMetadata ?? {};
      emit(ctx, 'COMPACTION', ctx.defaultActorId, 'memory compacted', 'observed', {
        detail: ctx.redactor.deep({
          trigger: meta.trigger,
          preTokens: meta.preTokens,
          postTokens: meta.postTokens,
          durationMs: meta.durationMs,
        }),
      });
      break;
    }
    case 'api_error':
      state.apiRetries += 1;
      emit(ctx, 'API_RETRY', ctx.defaultActorId, 'api retry', 'observed', {
        detail: {
          retryAttempt: line.retryAttempt,
          maxRetries: line.maxRetries,
          retryInMs: line.retryInMs,
        },
      });
      break;
    case 'model_refusal_fallback':
      emit(ctx, 'MODEL_SWITCH', ctx.defaultActorId, 'model fallback', 'observed', {
        detail: ctx.redactor.deep({
          originalModel: line.originalModel,
          fallbackModel: line.fallbackModel,
        }),
      });
      break;
    case 'turn_duration':
      emit(ctx, 'TURN_TIMING', ctx.defaultActorId, 'turn timing', 'observed', {
        detail: { durationMs: line.durationMs ?? line.duration },
      });
      break;
    case 'away_summary':
      emit(ctx, 'AWAY_RECAP', ctx.defaultActorId, 'away recap', 'observed');
      break;
    case 'stop_hook_summary':
      emit(ctx, 'HOOK_STOP', ctx.defaultActorId, 'stop hook', 'observed');
      break;
    case 'local_command':
      emit(ctx, 'LOCAL_CMD', ctx.defaultActorId, 'local command', 'observed');
      break;
    case 'scheduled_task_fire':
      emit(ctx, 'SCHED_FIRE', ctx.defaultActorId, 'scheduled fire', 'observed');
      break;
    default:
      emit(ctx, 'GENERIC_TOOL', ctx.defaultActorId, `system: ${sub ?? '?'}`, 'derived');
      break;
  }
}

// ---------------------------------------------------------------------------
// Tool call (§4.1 pairing) and safe-summary (§4.2)
// ---------------------------------------------------------------------------
function handleToolUse(ctx: LineCtx, block: ContentBlock): void {
  const { state } = ctx;
  const name = typeof block.name === 'string' ? block.name : 'unknown';
  const id = typeof block.id === 'string' ? block.id : undefined;
  const input = (block.input && typeof block.input === 'object' ? block.input : {}) as Record<
    string,
    unknown
  >;

  const kind = toolEventKind(name);
  const district = toolToDistrict(name);

  // tool district aggregate
  const agg =
    state.tools.get(name) ?? { tool: name, district, callCount: 0, failCount: 0 };
  agg.callCount += 1;
  state.tools.set(name, agg);

  // bump actor tool-use count
  const actor = ensureActor(ctx, ctx.defaultActorId);
  actor.toolUseCount += 1;

  const { label, targetRef, detail, taskId } = summarizeToolUse(ctx, name, input, id);

  const ev = emit(ctx, kind, ctx.defaultActorId, label, toolTruth(kind), {
    targetRef,
    detail,
    taskId,
  });
  if (id) {
    state.pendingTools.set(id, {
      name,
      eventIdx: state.events.length - 1,
      actorId: ctx.defaultActorId,
    });
  }
  void ev;

  // task-source / kanban side effects on the INPUT (create needs input fields)
  if (name === 'TaskCreate') {
    state.taskSeen = true;
    // card built when result arrives (id lives on result); stash input via pending
    pendingTaskCreate.set(id ?? `tc:${state.seq}`, {
      subject: pick(input, 'subject'),
      description: pick(input, 'description'),
      activeForm: pick(input, 'activeForm'),
      seq: state.seq,
      ts: ts(ctx.line),
    });
  } else if (name === 'TaskUpdate') {
    state.taskSeen = true;
    // lane move resolved from result.statusChange
  } else if (name === 'TodoWrite') {
    state.todoSeen = true;
    handleTodoWrite(ctx, input);
  }

  // file artifacts for read/edit/write (path from input; result refines basename)
  trackFileFromInput(ctx, name, input);
}

interface PendingTaskCreate {
  subject?: string;
  description?: string;
  activeForm?: string;
  seq: number;
  ts: string;
}
const pendingTaskCreate = new Map<string, PendingTaskCreate>();

function handleToolResult(ctx: LineCtx, block: ContentBlock): void {
  const { state } = ctx;
  const tid = typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined;
  const pending = tid ? state.pendingTools.get(tid) : undefined;
  const tur = ctx.line.toolUseResult;
  const isError = block.is_error === true;

  // result content may carry an image (screenshot)
  if (Array.isArray(block.content)) {
    for (const c of block.content) {
      if (isBlock(c) && c.type === 'image') {
        emit(ctx, 'SCREENSHOT', pending?.actorId ?? ctx.defaultActorId, 'screenshot', 'observed');
      }
    }
  }

  if (pending) {
    const originating = state.events[pending.eventIdx];
    if (originating) {
      // refine the originating event with result detail + error overlay
      refineFromResult(originating, pending.name, tur);
      if (isError || resultIsError(tur)) {
        originating.isError = true;
        state.toolFails += 1;
        const fagg = state.tools.get(pending.name);
        if (fagg) fagg.failCount += 1;
        // overlay TOOL_FAIL event so the renderer can ignite a fire at the site
        emit(ctx, 'TOOL_FAIL', pending.actorId, `${pending.name} failed`, 'observed', {
          targetRef: originating.targetRef,
          isError: true,
          taskId: originating.taskId ?? null,
        });
      }
    }
    // resolve kanban / subagent links that depend on the RESULT
    resolveResultSideEffects(ctx, pending, tur);
    state.pendingTools.delete(tid as string);
  } else if (resultIsError(tur) || isError) {
    // unpaired error result — still record a fail signal honestly
    state.toolFails += 1;
  }
}

// ---------------------------------------------------------------------------
// Per-tool safe summary on the tool_use (input-side)
// ---------------------------------------------------------------------------
function summarizeToolUse(
  ctx: LineCtx,
  name: string,
  input: Record<string, unknown>,
  toolUseId?: string
): { label: string; targetRef?: string; detail?: Record<string, unknown>; taskId?: string | null } {
  const r = ctx.redactor;
  switch (name) {
    case 'Read': {
      const fp = strOf(input.file_path ?? input.filePath);
      const base = basename(fp);
      return { label: `Read ${base}`, targetRef: base, detail: { path: r.text(fp) } };
    }
    case 'Edit': {
      const fp = strOf(input.file_path ?? input.filePath);
      const base = basename(fp);
      return {
        label: `Edit ${base}`,
        targetRef: base,
        detail: { path: r.text(fp), replaceAll: input.replace_all === true },
      };
    }
    case 'Write': {
      const fp = strOf(input.file_path ?? input.filePath);
      const base = basename(fp);
      const bytes = typeof input.content === 'string' ? input.content.length : undefined;
      return { label: `Write ${base}`, targetRef: base, detail: { path: r.text(fp), bytes } };
    }
    case 'Bash': {
      const cmd = strOf(input.command);
      const first = firstLine(r.text(cmd), 70);
      return {
        label: `$ ${first}`,
        targetRef: 'OS',
        detail: { command: first, runInBackground: input.run_in_background === true },
      };
    }
    case 'Grep':
    case 'Glob': {
      const pat = r.text(strOf(input.pattern ?? input.query));
      return { label: `${name} ${firstLine(pat, 50)}`, targetRef: 'repo', detail: { pattern: pat } };
    }
    case 'WebSearch': {
      const q = r.text(strOf(input.query));
      return { label: `WebSearch ${firstLine(q, 50)}`, targetRef: 'web', detail: { query: q } };
    }
    case 'WebFetch': {
      const url = strOf(input.url);
      const host = hostOf(url);
      return { label: `WebFetch ${host}`, targetRef: host, detail: { host } };
    }
    case 'ToolSearch': {
      const q = r.text(strOf(input.query));
      return { label: `ToolSearch ${firstLine(q, 50)}`, targetRef: 'registry', detail: { query: q } };
    }
    case 'Skill': {
      const sk = strOf(input.skill ?? input.command);
      return { label: `Skill ${sk}`, targetRef: sk, detail: { skill: sk } };
    }
    case 'AskUserQuestion':
      return { label: 'ask user', targetRef: 'human' };
    case 'SendUserFile':
      return { label: 'send file', targetRef: 'human' };
    case 'ScheduleWakeup':
      return { label: 'schedule wakeup', targetRef: 'clock' };
    case 'Agent': {
      const sub = strOf(input.subagent_type);
      const desc = r.text(firstLine(strOf(input.description), 60));
      return {
        label: `dispatch ${sub || 'subagent'}`,
        targetRef: sub || undefined,
        detail: { subagentType: sub, description: desc },
      };
    }
    case 'Workflow': {
      const title = r.text(firstLine(strOf(input.title ?? input.summary), 60));
      return { label: `launch workflow${title ? `: ${title}` : ''}`, targetRef: 'crew', detail: { title } };
    }
    case 'TaskCreate': {
      const subj = r.text(firstLine(strOf(input.subject), 60));
      return { label: `task: ${subj}`, targetRef: 'kanban', detail: { subject: subj } };
    }
    case 'TaskUpdate': {
      const taskId = strOf(input.taskId ?? input.task_id);
      const status = strOf(input.status);
      return {
        label: `task ${taskId} → ${status}`,
        targetRef: 'kanban',
        taskId: taskId || null,
        detail: { status },
      };
    }
    case 'TodoWrite':
      return { label: 'todo snapshot', targetRef: 'kanban' };
    case 'TaskGet':
    case 'TaskList':
    case 'TaskOutput':
    case 'TaskStop':
      return { label: `${name}`, targetRef: 'bg-job', detail: { action: name } };
    default:
      if (name.startsWith('mcp__')) {
        const parts = name.split('__');
        const server = parts[1] ?? 'mcp';
        const tool = parts.slice(2).join('__') || 'call';
        void toolUseId;
        return { label: `${server}: ${tool}`, targetRef: server, detail: { server, tool } };
      }
      return { label: name, targetRef: name, detail: {} };
  }
}

// refine the originating event using the RESULT (§4.2 result-side fields)
function refineFromResult(ev: WorldEvent, name: string, tur: unknown): void {
  if (!isObj(tur)) {
    // non-dict toolUseResult (string/list) — guard, just note a byte/len count.
    if (typeof tur === 'string') {
      ev.detail = { ...(ev.detail ?? {}), resultBytes: tur.length };
    } else if (Array.isArray(tur)) {
      ev.detail = { ...(ev.detail ?? {}), resultItems: tur.length };
    }
    return;
  }
  const d = ev.detail ?? {};
  switch (name) {
    case 'Read': {
      const file = isObj(tur.file) ? tur.file : undefined;
      const fp = strOf(file?.filePath);
      if (fp) {
        ev.targetRef = basename(fp);
        d.numLines = file?.numLines ?? file?.totalLines;
      }
      break;
    }
    case 'Edit': {
      const fp = strOf(tur.filePath);
      if (fp) ev.targetRef = basename(fp);
      d.hunks = Array.isArray(tur.structuredPatch) ? tur.structuredPatch.length : undefined;
      d.replaceAll = tur.replaceAll === true || d.replaceAll;
      d.userModified = tur.userModified === true;
      break;
    }
    case 'Write': {
      const fp = strOf(tur.filePath);
      if (fp) ev.targetRef = basename(fp);
      if (typeof tur.content === 'string') d.bytes = tur.content.length;
      break;
    }
    case 'Bash': {
      d.interrupted = tur.interrupted === true;
      d.stdoutBytes = typeof tur.stdout === 'string' ? tur.stdout.length : undefined;
      d.stderrBytes = typeof tur.stderr === 'string' ? tur.stderr.length : undefined;
      d.stdoutLines = typeof tur.stdout === 'string' ? countLines(tur.stdout) : undefined;
      break;
    }
    case 'Grep':
    case 'Glob': {
      d.matches = numOf(tur.matches ?? tur.count ?? tur.numFiles);
      break;
    }
    case 'WebSearch':
      d.results = numOf(tur.searchCount ?? tur.resultCount);
      break;
    case 'WebFetch':
      d.bytes = typeof tur.content === 'string' ? tur.content.length : undefined;
      break;
    case 'ToolSearch':
      d.matches = Array.isArray(tur.matches) ? tur.matches.length : numOf(tur.matches);
      d.totalDeferred = numOf(tur.total_deferred_tools);
      break;
    default:
      break;
  }
  ev.detail = d;
}

// result-side: resolve kanban moves, task creation ids, subagent/workflow links
function resolveResultSideEffects(
  ctx: LineCtx,
  pending: { name: string; eventIdx: number; actorId: ActorId },
  tur: unknown
): void {
  const { state } = ctx;
  const name = pending.name;

  if (name === 'TaskCreate' && isObj(tur)) {
    const task = isObj(tur.task) ? tur.task : undefined;
    const id = strOf(task?.id) || strOf(tur.id);
    // recover input from the most recent pending create stash by event order
    let stash: PendingTaskCreate | undefined;
    // pendingTaskCreate is keyed by toolUseId; find via originating event detail
    const originating = state.events[pending.eventIdx];
    for (const [, v] of pendingTaskCreate) {
      if (v.seq === seqOfEvent(originating)) {
        stash = v;
        break;
      }
    }
    const subject =
      ctx.redactor.text(strOf(task?.subject)) || stash?.subject || originating?.label || 'task';
    if (id) {
      const card: KanbanCard = {
        id,
        subject: ctx.redactor.text(subject),
        description: stash?.description ? ctx.redactor.text(stash.description) : undefined,
        activeForm: stash?.activeForm ? ctx.redactor.text(stash.activeForm) : undefined,
        lane: 'pending',
        history: [{ lane: 'pending', seq: seqOfEvent(originating), ts: originating?.ts ?? ts(ctx.line) }],
        truth: 'observed',
      };
      state.taskCards.set(id, card);
      if (originating) originating.taskId = id;
    }
  }

  if (name === 'TaskUpdate' && isObj(tur)) {
    const sc = isObj(tur.statusChange) ? tur.statusChange : undefined;
    const id = strOf(tur.taskId) || strOf(sc?.taskId);
    const to = laneOf(strOf(sc?.to));
    if (id && to) {
      const card = state.taskCards.get(id);
      const move = { lane: to, seq: state.seq, ts: ts(ctx.line) };
      if (card) {
        card.history.push(move);
        card.lane = to;
      } else {
        // update for a card we never saw created (cross-compaction) — synthesize
        state.taskCards.set(id, {
          id,
          subject: `task ${id}`,
          lane: to,
          history: [move],
          truth: 'observed',
        });
      }
      // mark the TASK_MOVE / TASK_DELETE event kind precisely
      const originating = state.events[pending.eventIdx];
      if (originating) {
        originating.kind = to === 'deleted' ? 'TASK_DELETE' : 'TASK_MOVE';
        originating.taskId = id;
      }
    }
  }

  if (name === 'Agent' && isObj(tur)) {
    const agentId = strOf(tur.agentId);
    const agentType = strOf(tur.agentType);
    const status = strOf(tur.status);
    const totalTokens = numOf(tur.totalTokens);
    const toolCount = numOf(tur.totalToolUseCount);
    const usage = isObj(tur.usage) ? tur.usage : undefined;
    const originating = state.events[pending.eventIdx];
    const spawnToolId = originatingToolId(state, pending.eventIdx);
    // SUBAGENT_SPAWN already emitted as the Agent tool_use; create the actor stub
    if (agentId) {
      const actor = ensureSubagentActor(state, agentId, 'subagent');
      actor.agentType = agentType || actor.agentType;
      actor.spawnedByToolId = spawnToolId ?? actor.spawnedByToolId;
      actor.description =
        actor.description ?? (originating ? strOf(originating.detail?.description) : undefined);
      actor.status = subagentStatus(status);
      actor.toolUseCount = Math.max(actor.toolUseCount, toolCount ?? 0);
      // subagent rollup cost (separate from parent usage, §7)
      const tk = usage ? usageToTokens(usage) : tokensFromTotal(totalTokens);
      actor.tokens = tk;
      // emit SUBAGENT_RESULT
      emit(ctx, 'SUBAGENT_RESULT', agentId, `${agentType || 'subagent'} returned`, 'observed', {
        targetRef: 'main',
        tokens: tk,
        detail: { status, totalTokens, toolCount: toolCount },
      });
      // promote the spawn event's targetRef to the agentId
      if (originating) {
        originating.kind = 'SUBAGENT_SPAWN';
        originating.targetRef = agentId;
      }
    }
  }

  if (name === 'Workflow' && isObj(tur)) {
    const transcriptDir = strOf(tur.transcriptDir);
    const runId = strOf(tur.runId);
    const status = strOf(tur.status);
    const wfId = runId || wfIdFromDir(transcriptDir);
    const originating = state.events[pending.eventIdx];
    if (originating) {
      originating.kind = 'WORKFLOW_LAUNCH';
      originating.targetRef = wfId || originating.targetRef;
      originating.detail = {
        ...(originating.detail ?? {}),
        wfId,
        status,
        transcriptDir: transcriptDir ? ctx.redactor.text(transcriptDir) : undefined,
      };
    }
    if (wfId) {
      // crew actor stub (workers attached by the CLI's fs pass)
      const crew = ensureSubagentActor(state, wfId, 'workflow-crew');
      crew.crewId = wfId;
      crew.status = crew.status ?? 'running';
    }
  }
}

// ---------------------------------------------------------------------------
// TodoWrite legacy path (§6b) — deterministic diff, content-keyed
// ---------------------------------------------------------------------------
function handleTodoWrite(ctx: LineCtx, input: Record<string, unknown>): void {
  const { state } = ctx;
  const todos = Array.isArray(input.todos) ? (input.todos as TodoItem[]) : [];
  emit(ctx, 'TODO_SNAPSHOT', ctx.defaultActorId, `todo snapshot (${todos.length})`, 'observed', {
    targetRef: 'kanban',
  });
  const prev = state.todoLast ?? [];
  // build content->status maps (flag collisions)
  const prevMap = new Map<string, string>();
  const dupKeys = new Set<string>();
  for (const t of prev) {
    const key = (t.content ?? '').trim();
    if (prevMap.has(key)) dupKeys.add(key);
    prevMap.set(key, t.status ?? 'pending');
  }
  for (const t of todos) {
    const key = (t.content ?? '').trim();
    if (!key) continue;
    const newLane = laneOf(t.status) ?? 'pending';
    const oldStatus = prevMap.get(key);
    const cardId = `todo:${hashKey(key)}`;
    let card = state.todoCards.get(cardId);
    if (!card) {
      card = {
        id: cardId,
        subject: ctx.redactor.text(firstLine(key, 80)),
        activeForm: t.activeForm ? ctx.redactor.text(t.activeForm) : undefined,
        lane: newLane,
        history: [{ lane: newLane, seq: state.seq, ts: ts(ctx.line) }],
        truth: 'derived',
      };
      state.todoCards.set(cardId, card);
    } else if (laneOf(oldStatus) !== newLane) {
      card.history.push({ lane: newLane, seq: state.seq, ts: ts(ctx.line) });
      card.lane = newLane;
      emit(ctx, 'TODO_TRANSITION', ctx.defaultActorId, `${card.subject} → ${newLane}`, 'derived', {
        targetRef: 'kanban',
        taskId: cardId,
      });
    }
    if (dupKeys.has(key)) {
      state.warnings.push(`TodoWrite duplicate-content collision: "${firstLine(key, 30)}"`);
    }
  }
  state.todoLast = todos;
}

// ---------------------------------------------------------------------------
// File artifacts (§5.2)
// ---------------------------------------------------------------------------
function trackFileFromInput(ctx: LineCtx, name: string, input: Record<string, unknown>): void {
  if (name !== 'Read' && name !== 'Edit' && name !== 'Write') return;
  const fp = strOf(input.file_path ?? input.filePath);
  if (!fp) return;
  const safe = ctx.redactor.text(fp);
  const base = basename(fp);
  const art =
    ctx.state.files.get(safe) ?? {
      path: safe,
      basename: base,
      reads: 0,
      edits: 0,
      writes: 0,
      hunks: 0,
    };
  if (name === 'Read') art.reads += 1;
  else if (name === 'Edit') art.edits += 1;
  else if (name === 'Write') art.writes += 1;
  ctx.state.files.set(safe, art);
}

// ---------------------------------------------------------------------------
// Cost accounting (§7) — dedupe by message.id, filter <synthetic>
// ---------------------------------------------------------------------------
function accumulateCost(ctx: LineCtx): { tk: TokenUsage; mid: string } | null {
  const { state, line } = ctx;
  const msg = line.message;
  if (!msg) return null;
  const mid = msg.id;
  const model = msg.model;
  if (model === '<synthetic>') return null;
  if (!mid) return null;
  const key = `cost:${ctx.defaultActorId}:${mid}`;
  if (state.costSeen.has(key)) return null;
  state.costSeen.add(key);
  const usage = msg.usage;
  if (!isObj(usage)) return null;
  const tk = usageToTokens(usage, typeof model === 'string' ? model : undefined);
  const actor = ensureActor(ctx, ctx.defaultActorId);
  actor.tokens = addTokens(actor.tokens, tk);
  if (typeof model === 'string') actor.tokens.model = model;
  // Hand the per-turn usage back so the caller can stamp it onto this turn's
  // event — the seq-accurate HUD meter reads event.tokens, not the actor rollup.
  return { tk, mid };
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------
function ensureActor(ctx: LineCtx, id: ActorId): Actor {
  const { state } = ctx;
  let actor = state.actors.get(id);
  if (!actor) {
    actor = {
      id,
      kind: id === 'main' ? 'main' : id === 'human' ? 'human' : 'subagent',
      firstSeq: state.seq + 1,
      lastSeq: state.seq + 1,
      tokens: zeroTokens(),
      toolUseCount: 0,
    };
    state.actors.set(id, actor);
  }
  actor.lastSeq = state.seq + 1;
  return actor;
}

export function ensureSubagentActor(
  state: IngestState,
  id: ActorId,
  kind: Actor['kind']
): Actor {
  let actor = state.actors.get(id);
  if (!actor) {
    actor = {
      id,
      kind,
      firstSeq: state.seq + 1,
      lastSeq: state.seq + 1,
      tokens: zeroTokens(),
      toolUseCount: 0,
    };
    state.actors.set(id, actor);
  } else if (actor.kind === 'subagent' && kind !== 'subagent') {
    actor.kind = kind;
  }
  return actor;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------
function emit(
  ctx: LineCtx,
  kind: WorldEventKind,
  actorId: ActorId,
  label: string,
  truth: TruthLevel,
  extra: Partial<WorldEvent> = {}
): WorldEvent {
  const { state, line } = ctx;
  state.seq += 1;
  // keep human actor lightweight but tracked
  if (actorId === 'human' && !state.actors.has('human')) {
    state.actors.set('human', {
      id: 'human',
      kind: 'human',
      firstSeq: state.seq,
      lastSeq: state.seq,
      tokens: zeroTokens(),
      toolUseCount: 0,
    });
  }
  const ev: WorldEvent = {
    id: typeof line.uuid === 'string' ? `${line.uuid}#${state.seq}` : `e${state.seq}`,
    kind,
    ts: ts(line),
    seq: state.seq,
    actorId,
    truth,
    label: label || kind,
    rawRef: { file: ctx.fileLabel, line: ctx.lineNo },
    ...extra,
  };
  // ensure truth from extra doesn't get dropped
  if (extra.truth) ev.truth = extra.truth;
  state.events.push(ev);
  // extend actor window
  const a = state.actors.get(actorId);
  if (a) a.lastSeq = state.seq;
  return ev;
}

// ---------------------------------------------------------------------------
// Finalize -> ParsedSession
// ---------------------------------------------------------------------------
export function finalize(state: IngestState): ParsedSession {
  // sort events by seq (already monotonic, but be safe)
  state.events.sort((a, b) => a.seq - b.seq);

  // task source
  let taskSource: TaskSource = 'none';
  let kanban: KanbanCard[] = [];
  if (state.taskSeen && state.taskCards.size > 0) {
    taskSource = 'task-star';
    kanban = [...state.taskCards.values()];
  } else if (state.todoSeen && state.todoCards.size > 0) {
    taskSource = 'todowrite';
    kanban = [...state.todoCards.values()];
  } else if (state.taskSeen) {
    taskSource = 'task-star';
  } else if (state.todoSeen) {
    taskSource = 'todowrite';
  }

  // tokens: totals = sum of main + subagent rollups (byActor)
  const byActor: Record<ActorId, TokenUsage> = {};
  let totals = zeroTokens();
  let totalsModel: string | undefined;
  for (const actor of state.actors.values()) {
    if (actor.kind === 'human') continue;
    byActor[actor.id] = actor.tokens;
    totals = addTokens(totals, actor.tokens);
    if (actor.kind === 'main' && actor.tokens.model) totalsModel = actor.tokens.model;
  }
  if (totalsModel) totals.model = totalsModel;

  // honest warnings about unresolved spawns
  const unpaired = state.pendingTools.size;
  if (unpaired > 0) {
    state.warnings.push(`${unpaired} tool_use without a matching tool_result (interrupted runs)`);
  }
  const red = state.redaction;
  if (red.paths || red.emails || red.secrets) {
    state.warnings.push(
      `redaction: ${red.paths} paths tokenized, ${red.emails} emails masked, ${red.secrets} secret-shaped tokens scrubbed` +
        (Object.keys(red.byCategory).length
          ? ` (${Object.entries(red.byCategory)
              .map(([k, v]) => `${k}:${v}`)
              .join(', ')})`
          : '')
    );
  }

  const signals: SessionSignals = {
    totals,
    byActor,
    permissionModeTimeline: state.permissionTimeline,
    gitBranchTimeline: dedupeTimeline(state.branchTimeline),
    compactions: state.compactions,
    apiRetries: state.apiRetries,
    toolFails: state.toolFails,
  };

  // clear module-level scratch so repeated calls don't leak
  pendingTaskCreate.clear();

  return {
    meta: {
      sessionId: state.sessionId ?? 'unknown',
      projectDir: state.projectDir ?? '<project>',
      title: state.title,
      schemaVersions: [...state.schemaVersions].sort(),
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      taskSource,
      warnings: state.warnings,
    },
    events: state.events,
    actors: [...state.actors.values()].filter((a) => a.kind !== 'human'),
    tools: [...state.tools.values()].sort((a, b) => b.callCount - a.callCount),
    files: [...state.files.values()].sort(
      (a, b) => b.reads + b.edits + b.writes - (a.reads + a.edits + a.writes)
    ),
    kanban,
    signals,
  };
}

// ===========================================================================
// helpers
// ===========================================================================
function toolEventKind(name: string): WorldEventKind {
  if (name.startsWith('mcp__')) return 'MCP_CALL';
  switch (name) {
    case 'Read':
      return 'FILE_READ';
    case 'Edit':
      return 'FILE_EDIT';
    case 'Write':
      return 'FILE_WRITE';
    case 'Bash':
      return 'SHELL_RUN';
    case 'Grep':
    case 'Glob':
      return 'CODE_SEARCH';
    case 'WebSearch':
      return 'WEB_SEARCH';
    case 'WebFetch':
      return 'WEB_FETCH';
    case 'ToolSearch':
      return 'TOOL_DISCOVER';
    case 'Skill':
      return 'SKILL_INVOKE';
    case 'AskUserQuestion':
      return 'ASK_USER';
    case 'SendUserFile':
      return 'FILE_SEND';
    case 'ScheduleWakeup':
      return 'SCHEDULE_WAKE';
    case 'Agent':
      return 'SUBAGENT_SPAWN';
    case 'Workflow':
      return 'WORKFLOW_LAUNCH';
    case 'TaskCreate':
      return 'TASK_CREATE';
    case 'TaskUpdate':
      return 'TASK_MOVE'; // refined to TASK_DELETE on result if needed
    case 'TodoWrite':
      return 'TODO_SNAPSHOT';
    case 'TaskGet':
    case 'TaskList':
    case 'TaskOutput':
    case 'TaskStop':
      return 'BG_TASK_CTRL';
    default:
      return 'GENERIC_TOOL';
  }
}

function toolTruth(_kind: WorldEventKind): TruthLevel {
  // All §2 tool events are observed; TODO_TRANSITION (derived) is emitted elsewhere.
  return 'observed';
}

function subagentStatus(status: string): Actor['status'] {
  if (status === 'completed' || status === 'success') return 'completed';
  if (status === 'failed' || status === 'error') return 'failed';
  // 'async_launched' / 'running' / anything else non-terminal = still running.
  // (An async Agent that never returned a sync result in this transcript is
  //  honestly "running", not "completed" — do not fabricate completion.)
  return 'running';
}

function laneOf(s: string | undefined): KanbanLane | undefined {
  switch (s) {
    case 'pending':
      return 'pending';
    case 'in_progress':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'deleted':
      return 'deleted';
    default:
      return undefined;
  }
}

function usageToTokens(usage: Record<string, unknown>, model?: string): TokenUsage {
  return {
    input: numOf(usage.input_tokens) ?? 0,
    output: numOf(usage.output_tokens) ?? 0,
    cacheCreate: numOf(usage.cache_creation_input_tokens) ?? 0,
    cacheRead: numOf(usage.cache_read_input_tokens) ?? 0,
    model,
  };
}

function tokensFromTotal(total: number | undefined): TokenUsage {
  // Agent result gives a single totalTokens — park it in input as a best-effort
  // rollup when no breakdown usage object is present.
  return { input: total ?? 0, output: 0, cacheCreate: 0, cacheRead: 0 };
}

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreate: a.cacheCreate + b.cacheCreate,
    cacheRead: a.cacheRead + b.cacheRead,
    model: a.model ?? b.model,
  };
}

function zeroTokens(): TokenUsage {
  return { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
}

function dedupeTimeline<T extends { seq: number }>(arr: T[]): T[] {
  return arr.sort((a, b) => a.seq - b.seq);
}

function originatingToolId(state: IngestState, eventIdx: number): string | undefined {
  const ev = state.events[eventIdx];
  if (!ev) return undefined;
  // event id is `${uuid}#${seq}` — but the spawning toolUseId is on the block,
  // which we didn't store on the event; the actor.spawnedByToolId is set by CLI
  // from meta.json. Return undefined here (single-file view can't always know).
  return undefined;
}

function seqOfEvent(ev: WorldEvent | undefined): number {
  return ev?.seq ?? -1;
}

function wfIdFromDir(dir: string): string {
  const m = dir.match(/wf_[^/\\]+/);
  return m ? m[0] : '';
}

// ---- tiny value helpers ----------------------------------------------------
function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function isBlock(v: unknown): v is ContentBlock {
  return isObj(v) && typeof (v as ContentBlock).type === 'string';
}
function strOf(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function numOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function pick(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === 'string' ? v : undefined;
}
function basename(p: string): string {
  if (!p) return '';
  const cleaned = p.replace(/[\\/]+$/, '');
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}
function hostOf(url: string): string {
  const m = url.match(/^[a-z]+:\/\/([^/\s:]+)/i);
  return m ? m[1] : url.slice(0, 40);
}
function firstLine(s: string, max: number): string {
  if (!s) return '';
  const nl = s.indexOf('\n');
  let line = nl >= 0 ? s.slice(0, nl) : s;
  line = line.trim();
  if (line.length > max) line = line.slice(0, max - 1) + '…';
  return line;
}
function firstTextBlock(content: ContentBlock[]): string {
  for (const b of content) {
    if (isBlock(b) && b.type === 'text' && typeof b.text === 'string') return b.text;
  }
  return '';
}
function countLines(s: string): number {
  if (!s) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}
function resultIsError(tur: unknown): boolean {
  if (typeof tur === 'string') return tur.includes('<tool_use_error>');
  return false;
}
function ts(line: Line): string {
  return typeof line.timestamp === 'string' ? line.timestamp : '';
}
function attachmentLabel(line: Line): string {
  const c = line.content;
  if (isObj(c) && typeof c.type === 'string') return `injected: ${c.type}`;
  return 'injected context';
}
function hashKey(s: string): string {
  // small deterministic hash for content-keyed todo card ids
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function deriveSessionId(fileName?: string): string | undefined {
  if (!fileName) return undefined;
  const base = basename(fileName);
  return base.replace(/\.jsonl$/i, '') || undefined;
}

function deriveProjectRoots(text: string, fileName?: string): string[] {
  const roots = new Set<string>();
  // Look at the first non-empty line's cwd to learn the concrete project root.
  let start = 0;
  let scanned = 0;
  while (start < text.length && scanned < 50) {
    let nl = text.indexOf('\n', start);
    if (nl === -1) nl = text.length;
    const raw = text.slice(start, nl).trim();
    start = nl + 1;
    if (raw) {
      scanned++;
      try {
        const o = JSON.parse(raw) as Line;
        if (typeof o.cwd === 'string' && o.cwd.startsWith('/')) {
          roots.add(o.cwd);
          break;
        }
      } catch {
        /* skip */
      }
    }
    if (nl >= text.length) break;
  }
  void fileName;
  return [...roots];
}
