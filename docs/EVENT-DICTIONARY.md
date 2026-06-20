# AgentCity — EVENT DICTIONARY (canonical WorldEvent vocabulary)

> The single source of truth for the city's renderable vocabulary. Every WorldEvent
> below is DERIVED from a real field in the Claude Code JSONL schema. The
> `truth_level` column is load-bearing: **observed** = the city renders a fact the
> JSONL literally contains; **derived** = a deterministic transform of observed
> fields (no guessing); **inferred** = requires a heuristic. Keep `inferred`
> near-zero. Any inferred event below is flagged with the exact assumption it rests on.
>
> Schema basis: Claude Code 2.1.x (versions 2.1.128–2.1.177 observed). All field
> paths are relative to one parsed JSONL line unless noted. See `DATA-CONTRACT.md`
> for the ingester algorithm; this file is the *what-renders-when* catalog.

---

## 0. Reading model (how a line becomes an event)

A transcript is **JSONL**: one independently-valid JSON object per line, streamed
(lines can exceed 1 MB). Every line has a top-level `type`. Events come from two axes:

1. **Record `type`** (top-level discriminator): `user`, `assistant`, `attachment`,
   `system`, plus non-message metadata kinds (`last-prompt`, `mode`,
   `permission-mode`, `ai-title`, `agent-name`, `agent-setting`, `pr-link`,
   `queue-operation`, `file-history-snapshot`) and subagent-journal kinds
   (`started`, `result`), plus documented-but-unseen `summary`.
2. **Content-block `type`** (inside `message.content[]` for `user`/`assistant`):
   `thinking`, `text`, `tool_use`, `tool_result`, `image`.

> ⚠️ Two different `type` axes. Record `type:"user"` can contain a content block of
> `type:"tool_result"`. Never conflate them.

Only `user` / `assistant` / `attachment` / `system` carry `uuid` + `parentUuid`
(the causal tree). All metadata kinds have NO `uuid` and are NOT threaded.

---

## 1. Conversational / "citizen" events

| WorldEvent | JSONL trigger (exact) | actor → target | task link | truth_level |
|---|---|---|---|---|
| `USER_PROMPT` | record `type:"user"` AND `message.content` is a STRING (or array containing a `text` block that is not a `tool_result`) AND `isMeta` not true | Human → Main Agent | — | observed |
| `AGENT_SAY` | record `type:"assistant"`, content block `type:"text"` | Main Agent → Human | — | observed |
| `AGENT_THINK` | record `type:"assistant"`, content block `type:"thinking"` (render `.thinking`; never render `.signature`) | Main Agent (internal) | — | observed |
| `AGENT_TURN_END` | `message.stop_reason:"end_turn"` (dedupe per `message.id`) | Main Agent | — | observed |
| `INJECTED_CONTEXT` | record `type:"attachment"` (e.g. `attachment.type` ∈ `deferred_tools_delta`, `skill_listing`, file content) OR any line with `isMeta:true` | System → Main Agent | — | observed (plumbing — render as ambient, not a human turn) |
| `PROMPT_QUEUED` | record `type:"queue-operation"`, `operation:"enqueue"`, `content`=queued prompt | Human (typed-ahead) | — | observed (NOT in causal tree) |

---

## 2. Tool events (the city's primary action vocabulary)

Trigger for ALL: `assistant` line, content block `type:"tool_use"` with `.name`,
`.id`, `.input`. The paired result is a later `user` line whose content block
`type:"tool_result"` has `tool_use_id == .id`, PLUS a sibling top-level
`toolUseResult` object (richer host-side metadata). **Pair by id, never by adjacency**
(a call and its result can be many lines apart, esp. background Bash). Pairing is
1:1 and was 100% in the corpus; a trailing unpaired `tool_use` = interrupted/truncated run.

`is_error` is tri-state: `true` (failed/blocked — content wraps as
`<tool_use_error>…`), `false`, or ABSENT (treat missing as success).

| WorldEvent | tool `name` | actor → target | safe-summary fields (render by default) | truth_level |
|---|---|---|---|---|
| `FILE_READ` | `Read` | Agent → file | `toolUseResult.file.filePath` basename, `numLines` | observed |
| `FILE_EDIT` | `Edit` | Agent → file | `toolUseResult.filePath` basename, `len(structuredPatch)` hunks, `replaceAll` | observed |
| `FILE_WRITE` | `Write` | Agent → file | `toolUseResult.filePath` basename, byte count of `content` | observed |
| `SHELL_RUN` | `Bash` | Agent → OS | `input.command` first line, exit/`interrupted`, stdout line count; `run_in_background` flag | observed |
| `CODE_SEARCH` | `Grep` / `Glob` | Agent → repo | `input.pattern`, match/file count | observed |
| `WEB_SEARCH` | `WebSearch` | Agent → web | `input.query` | observed |
| `WEB_FETCH` | `WebFetch` | Agent → web | `input.url` host, byte count | observed (body is untrusted data) |
| `TOOL_DISCOVER` | `ToolSearch` | Agent → tool registry | `input.query`, `toolUseResult.matches` count | observed |
| `SKILL_INVOKE` | `Skill` | Agent → skill | `input.skill`, `input.args` | observed |
| `ASK_USER` | `AskUserQuestion` | Agent → Human | `input.questions[]`, chosen answers (summarize) | observed |
| `FILE_SEND` | `SendUserFile` | Agent → Human | file basename(s) | observed |
| `SCHEDULE_WAKE` | `ScheduleWakeup` | Agent → clock | `toolUseResult.scheduledFor`, `wasClamped` | observed |
| `MCP_CALL` | `mcp__*` (e.g. `mcp__codegraph__*`, `mcp__Claude_Preview__*`) | Agent → MCP server | server + tool name, server-specific summary | observed |
| `SCREENSHOT` | result content block `type:"image"`, `source.media_type:"image/jpeg"|"png"` (from preview/computer-use MCPs) | Agent ← screen | thumbnail via `data:` URI ONLY | observed |
| `TOOL_FAIL` | any tool_result with `is_error:true` | overlays the originating tool event | error string (first line) | observed |
| `BG_TASK_CTRL` | `TaskGet`/`TaskList`/`TaskOutput`/`TaskStop` | Agent → background job | which job, action | observed (NOT subagent spawning — see §4 note) |

> The full distinct tool set observed: `Bash, Read, Edit, Write, WebSearch,
> WebFetch, Agent, AskUserQuestion, Workflow, Grep, ToolSearch, ScheduleWakeup,
> Skill, TodoWrite, Glob, SendUserFile, mcp__*`, plus the Task* families
> (`TaskCreate/TaskUpdate/TaskList/TaskOutput/TaskStop`) and background controls.
> Any unrecognized `name` → `MCP_CALL`/`GENERIC_TOOL` fallback (render name + a
> generic byte/line summary). Never crash on an unknown tool.

---

## 3. Task / kanban events (the authoritative task-state timeline)

> **The board is driven by the Task\* family in current Claude Code, with TodoWrite
> as a legacy fallback.** Across 527 transcripts `TaskUpdate` (4683) + `TaskCreate`
> (2463) dominate; `TodoWrite` appears in only 2 old files. Both are real,
> tool-logged state — **zero inference** is needed for either path.

### 3a. Task\* family (primary — current CC)

| WorldEvent | trigger | carries | truth_level |
|---|---|---|---|
| `TASK_CREATE` | `tool_use name:"TaskCreate"`, `input{subject, description, activeForm}`; result `toolUseResult.task.id` (stable id `"1"`,`"2"`…) | card id + title + body + present-continuous label | observed |
| `TASK_MOVE` | `tool_use name:"TaskUpdate"`, `input{taskId, status}`; result `toolUseResult.statusChange{from, to}` | EXPLICIT lane move `from→to` for `taskId` | observed (statusChange is logged — no diffing) |
| `TASK_DELETE` | `TaskUpdate` with `statusChange.to:"deleted"` | card retired | observed |

Status enum: `pending` (implicit at create) → `in_progress` → `completed` /
`deleted`. The board = each `TASK_CREATE` is a card; each `TASK_MOVE` is an ordered,
timestamped lane move. Order by line timestamp. `activeForm` is the label to show
while `in_progress`. `TaskList` result was observed `null` — do NOT rely on it for state.

### 3b. TodoWrite (legacy fallback — old transcripts only)

| WorldEvent | trigger | carries | truth_level |
|---|---|---|---|
| `TODO_SNAPSHOT` | `tool_use name:"TodoWrite"`, `input.todos[]{content, activeForm, status}`; result `toolUseResult{oldTodos, newTodos}` | FULL list snapshot (replays whole list each call) | observed |
| `TODO_TRANSITION` | derived by diffing `newTodos` vs `oldTodos` (match by `content` string / index — NO stable id) | per-item lane move | **derived** (deterministic diff; not a heuristic, but the *item identity* match by content string is the one soft spot — flag collisions) |

> The background-intent note that "TodoWrite IS the authoritative task timeline" is
> only true for *legacy* transcripts. For current CC, Task\* is authoritative. The
> ingester MUST try Task\* first and fall back to TodoWrite only when no Task\* events exist.

---

## 4. Subagent / dispatch events (separate-file layout)

> **Critical version finding.** All transcripts on this machine are 2.1.x and use the
> NEW separate-file subagent layout. The spawn tool is named **`Agent`** (single) or
> **`Workflow`** (multi-agent), NOT `Task`. `name:"Task"` appears 0 times. A generic
> parser MUST support BOTH layouts (see DATA-CONTRACT §subagents) but key on
> `name ∈ {Agent, Task, Workflow}`.

| WorldEvent | trigger | actor → target | attribution rule (authoritative, no guessing) | truth_level |
|---|---|---|---|---|
| `SUBAGENT_SPAWN` | `tool_use name:"Agent"`, `input{subagent_type, description, prompt}` | Main Agent → typed subagent | the spawned file is `…/<sessionId>/subagents/agent-<agentId>.jsonl` where `agentId == toolUseResult.agentId` on the result line; equivalently `meta.json.toolUseId == tool_use.id` | observed |
| `SUBAGENT_RESULT` | synthetic `user` line, `tool_result.tool_use_id == Agent tool_use.id`, with sibling `toolUseResult{status, agentId, agentType, content, totalDurationMs, totalTokens, totalToolUseCount, usage}` | typed subagent → Main Agent | same; `sourceToolAssistantUUID` back-links to the issuing assistant turn | observed |
| `WORKFLOW_LAUNCH` | `tool_use name:"Workflow"`, `input{script, title?}`; result `toolUseResult{transcriptDir, taskId, runId}` | Main Agent → workflow crew | `transcriptDir` = absolute path to `…/subagents/workflows/wf_<id>/`; ALL `agent-*.jsonl` inside are its children | observed |
| `WORKFLOW_WORKER` | each `agent-*.jsonl` under a `wf_<id>/` dir (`agentType:"workflow-subagent"`) | one worker (LEAF) | attributed by DIRECTORY, not timing (workflows are async/background) | observed |
| `WORKFLOW_WORKER_DONE` | `wf_<id>/journal.jsonl` `type:"result"`, keyed by content hash + `agentId`, `.result{committed, head_sha, test_pass_count, files_changed, diff_stat, notes, blockers}` | worker → journal | join `journal.agentId` → `agent-<agentId>.jsonl` in same dir | observed |
| `SUBAGENT_ACTION` | any line inside a subagent file (`isSidechain:true`, `agentId` set) — re-run §2/§3 vocabulary scoped to that `agentId` | subagent → its targets | group by `agentId`; each subagent has its own timeline | observed |
| `PARALLEL_WAVE` | ≥2 worker files in one `wf_<id>/` whose first-line timestamps cluster (e.g. within ~50 ms) | the crew (concurrency) | cluster first-line timestamps within a wf dir | **derived** (clustering threshold is a tunable; the concurrency itself is observed, the *wave grouping* is the soft choice) |

Key facts: subagent lines **reuse the parent `sessionId`** (the fresh id is
`agentId`, or `wf_<id>` per workflow). A subagent file's first line has
`parentUuid:null` — do NOT stitch it to the parent via `parentUuid`; cross-file
linkage is ONLY via `toolUseId` / `toolUseResult.agentId` / `transcriptDir`.
Subagent count mismatch is normal (2 Agent results vs 29 subagent files — the extra
are workflow children reached via `transcriptDir`); enumerate by walking the dir.
Nesting (subagent spawning a sub-subagent) was NOT observed but is structurally
possible — recurse on `agentId`, treat depth>1 as rare.

> Do NOT confuse `TaskGet/TaskList/TaskOutput/TaskStop` (background-job controls,
> §2 `BG_TASK_CTRL`) with subagent spawning. Different mechanism.

---

## 5. Session-lifecycle / "city epoch" events

| WorldEvent | JSONL trigger | meaning | truth_level |
|---|---|---|---|
| `SESSION_START` | a root line: `parentUuid:null` AND not a `compact_boundary` (the very first `user` line of a file) | city day begins | observed |
| `COMPACTION` (memory wipe) | `type:"system"`, `subtype:"compact_boundary"`, `parentUuid:null`, `logicalParentUuid`=pre-compaction leaf, `compactMetadata{trigger, preTokens, postTokens, durationMs}` | the agent's memory is summarized & reset; bridge the tree via `logicalParentUuid` ONLY | observed |
| `COMPACTION_SUMMARY` | `user` line with `isCompactSummary:true` (the synthetic post-compaction recap) | start of compacted segment | observed |
| `SESSION_RESUME/FORK` | a root `user` line whose `parentUuid` is non-null but resolves to NO uuid in this file (points into an older file) | continued from an earlier session | observed (cross-file via global uuid index) |
| `BRANCH_SWITCH` | `gitBranch` changes between consecutive lines (literal `"HEAD"` = detached) | repo branch changed mid-run | observed |
| `CWD_CHANGE` | `cwd` changes between consecutive lines | working dir changed | observed |
| `MODE_CHANGE` | `type:"permission-mode"` / `permissionMode` ∈ `default`/`auto`/`dontAsk`/`bypassPermissions` | permission posture shifted (e.g. YOLO) | observed |
| `AI_TITLE` | `type:"ai-title"` / `slug` assigned | session display name | observed |
| `PR_LINKED` | `type:"pr-link"` | a PR was associated | observed |
| `FILE_SNAPSHOT` | `type:"file-history-snapshot"`, keyed to `messageId` (assistant uuid) | undo/diff checkpoint (skip body when only threading) | observed |

### system subtypes (overlay events on `type:"system"`)

| subtype | WorldEvent | extra fields | truth_level |
|---|---|---|---|
| `api_error` | `API_RETRY` | `retryAttempt`, `maxRetries`, `retryInMs` (transient) | observed |
| `model_refusal_fallback` | `MODEL_SWITCH` | `retractedMessageUuids[]` (strike/retract those nodes), `originalModel`, `fallbackModel` | observed |
| `turn_duration` | `TURN_TIMING` | duration ms | observed |
| `away_summary` | `AWAY_RECAP` | recap text | observed |
| `stop_hook_summary` | `HOOK_STOP` | hook output | observed |
| `local_command` | `LOCAL_CMD` | (may carry `logicalParentUuid`) | observed |
| `scheduled_task_fire` | `SCHED_FIRE` | scheduled trigger | observed |

---

## 6. Cost / signal overlays (not standalone events — annotate other events)

On each `assistant` turn: `message.usage{input_tokens, output_tokens,
cache_creation_input_tokens, cache_read_input_tokens, cache_creation{ephemeral_1h…,
ephemeral_5m…}, server_tool_use{web_search_requests, web_fetch_requests},
service_tier, speed}`; `message.model` (`claude-opus-4-7`/`-4-8`/`claude-fable-5`/
`<synthetic>`); `message.stop_reason`.

| Signal | source | truth_level |
|---|---|---|
| `TOKENS_SPENT` | `message.usage`, **deduped by `message.id`** | observed (see gotcha) |
| `MODEL_TAG` | `message.model` (filter `<synthetic>` from cost) | observed |
| `SUBAGENT_COST` | `toolUseResult{totalTokens, totalDurationMs, usage}` on Agent result (separate rollup — NOT in parent usage) | observed |

> ⚠️ **Cost double-count gotcha.** One model turn = N JSONL assistant lines (one per
> content block) that ALL share the SAME `message.id`, SAME `requestId`, and a
> BYTE-IDENTICAL `usage` object (up to 10 lines seen). **DEDUPE by `message.id`
> before summing** or you inflate cost 2–10×. No real per-assistant-turn
> `durationMs` exists (top-level `durationMs` is null on assistant lines, populated
> only on `system` hook lines); derive turn durations from timestamp deltas.

---

## 7. Truth-level audit (the inference budget)

**Everything above is `observed` except these — the entire inferred/derived budget:**

1. `TODO_TRANSITION` (§3b) — **derived**: deterministic diff of `oldTodos`/`newTodos`;
   the only soft spot is matching items across snapshots by `content` string when no
   stable id exists. Flag duplicate-content collisions. (Legacy path only; Task\* has
   explicit `statusChange` and needs none.)
2. `PARALLEL_WAVE` (§4) — **derived**: concurrency is observed (timestamps), but the
   *grouping into waves* uses a clustering threshold (tunable, default ~50 ms).
3. `USER_PROMPT` vs `INJECTED_CONTEXT` (§1) — **observed boundary** via `isMeta` /
   record `type:"attachment"`, but a string-content user line that is actually
   injected plumbing without `isMeta` is the one edge to watch.

No city element should require inference beyond these three. If a renderer needs a
fact not traceable to a field here, that is a contract violation — escalate, don't guess.
