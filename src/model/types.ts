// ============================================================================
// AgentCity — FROZEN DATA CONTRACT (types)
// ----------------------------------------------------------------------------
// The single shared interface between the ingester (src/ingest) and the
// renderer/HUD (src/render, src/hud). Derived 1:1 from docs/EVENT-DICTIONARY.md
// and docs/DATA-CONTRACT.md. Do NOT add fields that cannot be traced to a real
// JSONL field — every renderable fact must be `observed` or `derived`, never
// `inferred`. Treat this file as frozen; coordinate before changing shapes.
// ============================================================================

/** observed = literal JSONL fact; derived = deterministic transform (no guessing). */
export type TruthLevel = 'observed' | 'derived';

/** "main" = the root session; otherwise a subagent's agentId or a wf worker id. */
export type ActorId = string;

export type ActorKind =
  | 'human'
  | 'main'
  | 'subagent' // single Agent-tool spawn (typed)
  | 'workflow-crew' // a wf_<id> group
  | 'workflow-worker'; // one agent-*.jsonl inside a wf dir

// ---------------------------------------------------------------------------
// WorldEvent vocabulary (EVENT-DICTIONARY §1–5). Keep in sync with that doc.
// ---------------------------------------------------------------------------
export type WorldEventKind =
  // §1 conversational / citizen
  | 'USER_PROMPT'
  | 'AGENT_SAY'
  | 'AGENT_THINK'
  | 'AGENT_TURN_END'
  | 'INJECTED_CONTEXT'
  | 'PROMPT_QUEUED'
  // §2 tools (primary action vocabulary)
  | 'FILE_READ'
  | 'FILE_EDIT'
  | 'FILE_WRITE'
  | 'SHELL_RUN'
  | 'CODE_SEARCH'
  | 'WEB_SEARCH'
  | 'WEB_FETCH'
  | 'TOOL_DISCOVER'
  | 'SKILL_INVOKE'
  | 'ASK_USER'
  | 'FILE_SEND'
  | 'SCHEDULE_WAKE'
  | 'MCP_CALL'
  | 'SCREENSHOT'
  | 'TOOL_FAIL' // overlay on the originating tool event (is_error:true)
  | 'BG_TASK_CTRL'
  | 'GENERIC_TOOL'
  // §3 task / kanban
  | 'TASK_CREATE'
  | 'TASK_MOVE'
  | 'TASK_DELETE'
  | 'TODO_SNAPSHOT'
  | 'TODO_TRANSITION'
  // §4 subagent / dispatch
  | 'SUBAGENT_SPAWN'
  | 'SUBAGENT_RESULT'
  | 'WORKFLOW_LAUNCH'
  | 'WORKFLOW_WORKER'
  | 'WORKFLOW_WORKER_DONE'
  | 'SUBAGENT_ACTION'
  | 'PARALLEL_WAVE'
  // §5 session lifecycle / city epoch
  | 'SESSION_START'
  | 'COMPACTION'
  | 'COMPACTION_SUMMARY'
  | 'SESSION_RESUME'
  | 'BRANCH_SWITCH'
  | 'CWD_CHANGE'
  | 'MODE_CHANGE'
  | 'AI_TITLE'
  | 'PR_LINKED'
  | 'FILE_SNAPSHOT'
  // §5 system subtypes
  | 'API_RETRY'
  | 'MODEL_SWITCH'
  | 'TURN_TIMING'
  | 'AWAY_RECAP'
  | 'HOOK_STOP'
  | 'LOCAL_CMD'
  | 'SCHED_FIRE';

/** Pointer to the raw JSONL body — loaded lazily ONLY behind the reveal toggle. */
export interface RawRef {
  file: string;
  line: number;
}

/**
 * A normalized, redacted, renderable event. The summary is already
 * privacy-safe (basenames, counts, first lines) per DATA-CONTRACT §9.
 */
export interface WorldEvent {
  id: string;
  kind: WorldEventKind;
  /** ISO timestamp from the JSONL line. */
  ts: string;
  /** Global monotonic line counter — authoritative replay order. */
  seq: number;
  actorId: ActorId;
  /** basename / host / taskId / agentId the action targets, if any. */
  targetRef?: string;
  /** Link to a kanban card id, when applicable. */
  taskId?: string | null;
  truth: TruthLevel;
  /** true when this event (or its paired tool_result) carried is_error:true. */
  isError?: boolean;
  /** Short human-readable one-liner (already redacted). */
  label: string;
  /** Structured, redacted detail for the inspector (already safe to render). */
  detail?: Record<string, unknown>;
  rawRef?: RawRef;
  /** Cost overlay attached to this turn (assistant lines), deduped by message.id. */
  tokens?: TokenUsage;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  model?: string;
}

// ---------------------------------------------------------------------------
// Entity model (DATA-CONTRACT §5)
// ---------------------------------------------------------------------------
export interface Actor {
  id: ActorId;
  kind: ActorKind;
  /** Agent type for subagents: Explore / general-purpose / gsd-* / workflow-subagent. */
  agentType?: string;
  /** The Agent/Workflow tool_use id that spawned this actor (subagents only). */
  spawnedByToolId?: string;
  /** wf_<id> this worker belongs to (workflow workers only). */
  crewId?: string;
  /** Short description from the spawn input. */
  description?: string;
  /** Lifecycle window in seq space. */
  firstSeq: number;
  lastSeq: number;
  /** Rolled-up cost (subagents reported separately from parent usage). */
  tokens: TokenUsage;
  toolUseCount: number;
  status?: 'running' | 'completed' | 'failed';
}

/** A tool aggregate = one "district/building" in the city, keyed by tool name. */
export interface ToolDistrict {
  tool: string; // e.g. "Read", "Bash", "mcp__codegraph__flow"
  district: DistrictKind;
  callCount: number;
  failCount: number;
}

export interface FileArtifact {
  /** Tokenized path (DATA-CONTRACT §9.2) — never a raw absolute path. */
  path: string;
  basename: string;
  reads: number;
  edits: number;
  writes: number;
  hunks: number;
}

export type KanbanLane = 'pending' | 'in_progress' | 'completed' | 'deleted';

export interface KanbanCard {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  lane: KanbanLane;
  /** Ordered lane moves (TASK_MOVE / TODO_TRANSITION), each with the seq it happened at. */
  history: { lane: KanbanLane; seq: number; ts: string }[];
  truth: TruthLevel;
}

export type TaskSource = 'task-star' | 'todowrite' | 'none';

export interface SessionSignals {
  totals: TokenUsage;
  /** Per-actor token rollup keyed by actorId. */
  byActor: Record<ActorId, TokenUsage>;
  permissionModeTimeline: { mode: string; seq: number; ts: string }[];
  gitBranchTimeline: { branch: string; seq: number; ts: string }[];
  compactions: number;
  apiRetries: number;
  toolFails: number;
}

export interface SessionMeta {
  sessionId: string;
  projectDir?: string;
  title?: string;
  schemaVersions: string[];
  startedAt?: string;
  endedAt?: string;
  taskSource: TaskSource;
  /** Counts that surfaced during parse — for honest "what we couldn't resolve" labels. */
  warnings: string[];
}

/**
 * The ingester's complete output = the frozen contract handed to the renderer.
 */
export interface ParsedSession {
  meta: SessionMeta;
  events: WorldEvent[]; // ordered by seq (replay order)
  actors: Actor[];
  tools: ToolDistrict[];
  files: FileArtifact[];
  kanban: KanbanCard[];
  signals: SessionSignals;
}

// ---------------------------------------------------------------------------
// City semantics (the SEMANTIC mapping — shared SSOT, used by the renderer).
// Every district below corresponds to a real Claude Code primitive.
// ---------------------------------------------------------------------------
export type DistrictKind =
  | 'command_tower' // main agent
  | 'crew_camp' // subagents / workflow crews (dispatched)
  | 'archive' // Read / Grep / Glob (knowledge retrieval)
  | 'workshop' // Write / Edit / NotebookEdit (artifacts)
  | 'bash_yard' // Bash (heavy machinery, risk varies)
  | 'port' // WebFetch / WebSearch (external)
  | 'consulate' // mcp__* (external connectors)
  | 'skill_firm' // Skill (packaged procedures)
  | 'kanban' // Task* / TodoWrite board
  | 'powerplant' // tokens / cost
  | 'customs' // permission gates
  | 'square'; // conversational citizen events (prompts / says)
