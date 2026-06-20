# AgentCity — DATA CONTRACT (parser / ingester spec)

> Implementable from this doc alone. Defines: **input** (raw JSONL line types) →
> **normalized event stream** (WorldEvents, see `EVENT-DICTIONARY.md`) → **entity
> model** (actors / artifacts / signals). Plus the three load-bearing algorithms:
> task-source resolution, subagent subtree attribution, redaction. Pipeline runs
> **100% in-process, local, zero network egress.**
>
> Schema basis: Claude Code **2.1.x** (2.1.128–2.1.177). Treat every non-core field
> as optional and version-dependent; never crash on a missing/unknown field.

---

## 1. Input layer — discovery & streaming

### 1.1 On-disk layout
```
~/.claude/projects/<projDir>/
  <sessionId>.jsonl                  ← MAIN session transcript (filename basename === sessionId)
  <sessionId>/                       ← sibling dir (present only if subagents/snapshots exist)
    subagents/
      agent-<agentId>.jsonl          ← Agent-tool subagent transcript
      agent-<agentId>.meta.json      ← { agentType, description, toolUseId? }
      workflows/wf_<id>/
        agent-*.jsonl                ← workflow worker transcripts
        journal.jsonl                ← started/result lifecycle events (content-hash keyed)
    tool-results/<hash>.txt          ← externalized large tool outputs (NOT transcripts)
    workflows/                       ← separate from subagents/workflows (NOT transcripts)
```
**Invariants:** `filename basename === sessionId`; one file = exactly one sessionId;
subagent files **reuse the parent sessionId**. Only `subagents/**/agent-*.jsonl` are
subagent transcripts — ignore `tool-results/` and the top-level `workflows/` dir for threading.

### 1.2 Streaming rule (hard)
Parse **line-by-line**; each line is independently valid JSON. Lines can exceed 1 MB
(embedded file bodies, base64 images, snapshots). **Never `JSON.parse` the whole
file.** Wrap each line in try/catch; skip + log malformed lines, never abort the file.

### 1.3 Two-pass ingest
- **Pass A (index):** stream every main + subagent file in the project dir, build the
  global `uuid → {file, line}` index and the `agentId → file` / `wf_id → dir` maps.
  Needed before threading because `parentUuid` can point into another file.
- **Pass B (normalize):** re-stream, emit WorldEvents, attach entities & signals.

---

## 2. Line-type routing table

| record `type` | has `uuid`? | route |
|---|---|---|
| `user` | yes | thread it; read `message.content` (STRING = prompt, ARRAY = blocks → tool_result/text/image) + sibling `toolUseResult` |
| `assistant` | yes | thread it; read content blocks (text/thinking/tool_use); dedupe usage by `message.id` |
| `attachment` | yes | thread it; emit `INJECTED_CONTEXT` (plumbing) |
| `system` | yes | thread it; branch on `subtype` (compact_boundary/api_error/model_refusal_fallback/turn_duration/away_summary/stop_hook_summary/local_command/scheduled_task_fire) |
| `last-prompt` | **no** | metadata: `lastPrompt`, `leafUuid` (live-tip pointer). Do NOT thread. |
| `mode` / `permission-mode` | **no** | metadata: permission posture |
| `ai-title` / `agent-name` / `agent-setting` | **no** | metadata: display labels |
| `pr-link` | **no** | metadata: PR association |
| `queue-operation` | **no** | metadata: typed-ahead queue (`enqueue`/`dequeue`/`remove`/`popAll`) |
| `file-history-snapshot` | **no** | metadata: undo checkpoint keyed to `messageId` |
| `started` / `result` | **no** | ONLY in `wf_*/journal.jsonl`; result cache, exclude from tree |
| `summary` | **no** | documented resume-index line (not seen locally); `{summary, leafUuid}` |

**Filter rule:** metadata kinds (no `uuid`) are NEVER threaded into the causal tree
and have NO `message`/`usage` — skip them in tree-building and cost accounting; emit
them only as their own lifecycle WorldEvents.

---

## 3. Threading — the causal tree

1. Index every message-bearing line by `uuid`.
2. Link `parentUuid → uuid`. `parentUuid === null` ⇒ a **root**.
3. A file has **MULTIPLE roots**: 1 original session start + 1 per compaction
   (`system/subtype:compact_boundary`). One observed file had 10 roots. Do NOT assume one root.
4. **Compaction bridge:** a `compact_boundary` line has `parentUuid:null` but
   `logicalParentUuid` = the pre-compaction leaf uuid. That is the ONLY link across
   the gap. The post-compaction recap arrives as a `user` line with `isCompactSummary:true`.
5. **Leaf** = a uuid that is never anyone's `parentUuid` (the live tip; cross-check
   with `last-prompt.leafUuid`).
6. **Cross-file resume/fork:** a root `user` line with non-null `parentUuid` that
   resolves to nothing in this file points into an OLDER file → resolve via the
   global uuid index (§1.3). Unresolvable = "dangling" (older/deleted session) — render
   as a faded inbound edge, do not error.
7. **Benign multi-child:** an assistant `tool_use` line and the following `user`
   `tool_result` line may share a `parentUuid`; a single model turn split across lines
   reuses one `requestId`. Do NOT treat every >1-child parent as a real branch.

Replay order = **file line-order is authoritative**; use `timestamp` only for
intra-turn ordering and cross-file overlay. Metadata lines interleave and may be
timestamp-out-of-order relative to the tree.

---

## 4. Normalized event stream

Each WorldEvent (vocabulary in `EVENT-DICTIONARY.md`) is emitted as:
```jsonc
{
  "id":        "<uuid or synthetic stable id>",
  "kind":      "FILE_EDIT",            // WorldEvent name
  "ts":        "2026-06-11T13:40:07.701Z",
  "seq":       1234,                    // global monotonic line counter (replay order)
  "actorId":   "main" | "<agentId>",    // who acted
  "targetRef": "<basename or host or taskId>",
  "taskId":    "3" | null,              // link to kanban card if applicable
  "truth":     "observed" | "derived",  // copy from dictionary; never emit "inferred"
  "label":     "Edit auth.ts",          // short already-redacted one-liner (feed/inspector)
  "isError":   false,                   // true if this turn / its tool_result carried is_error → fire overlay
  "detail":    { /* per-tool safe-summary (§4.2), redacted — render this, never raw bodies */ },
  "tokens":    { /* TokenUsage; assistant turns only, deduped by message.id (§7) */ },
  "rawRef":    { "file":"…", "line":42 } // pointer to raw body (lazy, behind reveal toggle)
}
```
`rawRef` is a POINTER, not the body — raw content is loaded on demand only when the
user flips the per-session "Reveal raw content" toggle (§8).

### 4.1 Tool-call pairing
Build `toolUseId → tool_use line`. When a `user` line carries a `tool_result` block,
join on `tool_use_id`. **Pair by id, never adjacency** (results can be far away, esp.
background Bash). Use the sibling `toolUseResult` (host-side, structured) for reliable
per-tool detail; use `message.content[].content` for the displayed text. `toolUseResult`
may be a bare string/list, not a dict — `guard isinstance(x, dict)` before `.get()`.
A trailing unpaired `tool_use` (interrupted run) → still emit the call event (no `tool_result` exists to pair); there is no `result` field — `detail` carries the `tool_use`-input summary.

### 4.2 Per-tool safe-summary map (render these, not raw bodies)
| tool | safe summary from |
|---|---|
| `Bash` | `toolUseResult{interrupted, stdout/stderr line+byte counts}`, `input.command` line 1, `run_in_background` |
| `Read` | `toolUseResult.file{filePath→basename, numLines}` |
| `Edit` | `toolUseResult{filePath→basename, len(structuredPatch) hunks, replaceAll, userModified}` |
| `Write` | `toolUseResult{filePath→basename, len(content) bytes}` |
| `Grep`/`Glob` | `input.pattern`, result match/file count |
| `WebFetch` | `input.url` host + result byte count |
| `WebSearch` | `input.query` |
| `ToolSearch` | `toolUseResult{query, matches count, total_deferred_tools}` |
| `Agent` | `toolUseResult{agentType, description, status, totalTokens, totalDurationMs, totalToolUseCount}` |
| `Workflow` | `toolUseResult{taskId, transcriptDir→wf_id, status}` |
| `TaskCreate/Update` | see §6 |
| `image`/screenshot | thumbnail via `data:` URI; never remote |
| unknown | tool name + generic byte/line count |

---

## 5. Entity model

### 5.1 Actors
- **Main agent** — `actorId:"main"`. The root session thread.
- **Typed subagents** — one per `agentId`; carries `agentType` (`Explore`,
  `general-purpose`, `gsd-*`, `workflow-subagent`, …), parent toolUseId, and its own
  event sub-timeline. Lives in a `subagents/agent-*.jsonl` file.
- **Workflow crews** — one per `wf_<id>`; a set of `workflow-subagent` workers.
- **Tools** — value objects keyed by `name`; not threaded, but aggregated (counts,
  failure rate) per actor into the renderer's districts (the WORKLOAD bars; see §5.4).
- **Human** — the user (source of `USER_PROMPT`, target of `ASK_USER`/`FILE_SEND`).

### 5.2 Artifacts
- **Files** — keyed by tokenized path (§9); track read/edit/write events + hunk counts.
  Join `Edit.structuredPatch` and `file-history-snapshot` (by `messageId`) for diffs.
- **Outputs** — Bash stdout/stderr, WebFetch results, screenshots (base64 `data:`).
- **Kanban cards** — see §6.

### 5.3 Signals
- **Tokens/cost** — `message.usage` deduped by `message.id` (§7); subagent rollup
  separate. Filter `model:"<synthetic>"`.
- **Git** — `gitBranch` (literal `"HEAD"` = detached), `pr-link`, workflow journal
  `committed`/`head_sha`/`diff_stat`.
- **Permission posture** — `permissionMode` timeline.
- **Time** — derive turn/task durations from `timestamp` deltas (no real per-turn ms).

### 5.4 Magnitude encoding (render-side, honesty-bearing)
The renderer's primary magnitude — in the TUI, a district's WORKLOAD **bar length** — is
itself honest, not decorative: it scales with that district's **tool-call count** via
`districtCallTotals(events)` (or the seq-relative `usageByDistrictUpTo` at a playhead), which
counts only `isUsageEvent` kinds (tool / action / dispatch invocations + `MODE_CHANGE`).
Conversation (`USER_PROMPT`/`AGENT_SAY`/`AGENT_THINK`/…) and session lifecycle
(`SESSION_START`/`COMPACTION`/`API_RETRY`/…) are NOT calls and are excluded, or the
misc/citizen `square` balloons from talk, not work. The `TOOL_FAIL` overlay is excluded (its
originating call already counts). Magnitude is RELATIVE to the busiest district (honest
"more = bigger", not an absolute scale; exact counts are shown alongside). `command_tower` is a
fixed landmark (its events are lifecycle, not tool work) and is never data-scaled. The panel's
hero `laborSteps` is the **sum of the bars**, so the headline and the chart can never disagree.

---

## 6. Task-source resolution algorithm (authoritative kanban)

```
detect_task_source(events):
  taskStar = [e for e in events if e.tool in {TaskCreate, TaskUpdate}]
  if taskStar non-empty:
     source = "task-star"   # PRIMARY — current Claude Code
  elif any TodoWrite present:
     source = "todowrite"   # LEGACY fallback
  else:
     source = "none"        # no explicit board; render a flat activity log
```

### 6a. Task\* path (primary — explicit, no inference)
- `TaskCreate` → card `{ id = toolUseResult.task.id, subject, description, activeForm }`
  (description/activeForm live on the **input**, not the result — join them on the create event).
- `TaskUpdate` → ordered lane move `{ taskId, from = toolUseResult.statusChange.from,
  to = toolUseResult.statusChange.to, ts }`. **statusChange is logged explicitly — never diff, never guess.**
- Initial lane `pending` is implicit at create; `to` may be `in_progress`/`completed`/`deleted`.
- Order moves by line timestamp/seq. `TaskList` result is `null` — ignore for state.

### 6b. TodoWrite path (legacy — deterministic diff)
- Each `TodoWrite` is a FULL snapshot (`input.todos[]` replays the whole list);
  result carries `oldTodos` + `newTodos`.
- Derive transitions by diffing `newTodos` vs `oldTodos`. **No stable per-item id** —
  match by `content` string (fallback: list index). Mark `truth:"derived"`; on
  duplicate-content collision, flag and fall back to positional match.

> Background-intent override: TodoWrite is authoritative ONLY for legacy transcripts;
> for current CC the board MUST come from Task\*. The ingester tries Task\* first.

---

## 7. Cost accounting (dedupe-mandatory)

```
seen = set()
for line in assistant_lines:
   mid = line.message.id
   if mid in seen: continue            # N lines share one message.id with identical usage
   seen.add(mid)
   if line.message.model == "<synthetic>": continue
   accumulate(line.message.usage)      # input/output/cache_creation/cache_read
add_separately(every Agent toolUseResult{totalTokens})  # subagent rollup not in parent usage
```
Up to 10 lines share one `message.id`; summing raw lines inflates 2–10×. Same for
`stop_reason` — take once per `message.id`.

**Per-turn attribution (drives the seq-accurate context meter):** beyond the running
totals, stamp each turn's deduped `usage` onto the FIRST emitted WorldEvent that carries
that `message.id` (`event.tokens`, once per id). The context-pressure gauge reads
`input + cacheRead + cacheCreate` of the turn active at the playhead seq; without this
per-event stamp only the 2-of-N events that happen to carry a token rollup would be
visible and the meter would under-report by ~500×.

---

## 8. Subagent subtree attribution algorithm

```
LAYOUT DETECTION (per session):
  if sibling dir <sessionId>/subagents/ exists
     OR main file has zero isSidechain:true lines:
        → NEW file-based layout (all 2.1.x here)
  else:
        → OLD inline layout (Task tool_use + isSidechain:true lines in SAME file;
          walk parentUuid chains to carve the sidechain subtree). Fallback only.

NEW LAYOUT attribution (no guessing):
  Agent subagent:
     link = toolUseResult.agentId (on the Agent result line) → subagents/agent-<agentId>.jsonl
     (equivalently meta.json.toolUseId == Agent tool_use.id). Both confirmed fileExists.
     Subagent's final answer == toolUseResult.content == subagent file's LAST assistant
     text (byte-identical). Use the PARENT toolUseResult (richer: has stats) to avoid double-count.
  Workflow crew:
     link = toolUseResult.transcriptDir → subagents/workflows/wf_<id>/
     ALL agent-*.jsonl inside = its children (workflow-subagent; meta has NO toolUseId).
     Workflows are ASYNC: the Workflow result is just a launch ack ("launched in
     background") emitted BEFORE children finish → attribute by DIRECTORY not timing;
     read wf_<id>/journal.jsonl 'result' events for real per-worker outcomes.
  Generic / enumeration:
     Walk the subagents dir; each file self-identifies via agentId (== filename).
     Count mismatch is normal (2 Agent results vs 29 files — extras are workflow children).
     First line of every subagent file has parentUuid:null — do NOT stitch via parentUuid;
     cross-file linkage is ONLY toolUseId / agentId / transcriptDir.

NESTING: recurse on agentId (a subagent file could contain its own Agent tool_use →
  grandchild). Not observed (depth==1) but guard for it.

PARALLELISM: cluster first-line timestamps within one wf_ dir to detect waves
  (workers share start ts to the millisecond; one workflow had 48 children). Reconstruct
  each agent's timeline independently, overlay by timestamp. File mtime != logical order.
```

---

## 9. Redaction & privacy policy (enforced at ingest)

**Posture:** the JSONL is **untrusted-but-private local data**. No real cloud secret
(`sk-ant`/`ghp_`/`AKIA`/JWT/`Bearer`) was found in the corpus — every secret-regex hit
was a FALSE POSITIVE (base64 noise, the identifiers `token`/`authorization`, a dir
named `token-cost`). So do NOT advertise "we removed your AWS keys" — run masking as
**defense-in-depth** and report *categories*, never scary false alarms.

### 9.1 Default-summary rule (privacy AND performance)
By DEFAULT render only short derived summaries (tool name, exit status, path
**basename**, line/byte counts, durations). Full bodies — `Read` file content, `Write`
content, `Edit` old/new/originalFile/structuredPatch lines, `Bash` stdout/stderr,
user prompts, WebFetch results, base64 images, `Agent` prompts, `isCompactSummary`
recaps (~13 KB) — stay behind an explicit opt-in **"reveal raw content"** path,
**OFF by default**. (Volume is dominated by Edit up to 4865× and Bash up to 7187× per
transcript — default-summary is also what keeps the rendered view legible.)

### 9.2 Path tokenization (global, all string fields)
At ingest, rewrite in EVERY string (not just `file.filePath`): `/Users/<user>` (and
`/home/<user>`) → `~`, project root → `<project>`. **Two further username-leaking forms
MUST also be collapsed** or the OS username escapes: the dash-encoded projDir **slug**
`-Users-<user>` (and `-home-<user>`) → `-~` — Claude Code flattens the project path into
the on-disk `projects/<projDir>` name (§1.1) and into `/tmp/claude-*` task paths, which
the slash rule never sees — and the Windows form `C:\Users\<user>` → `~`. Paths leak the
OS username on virtually every line via top-level `cwd`, and inside `command`,
`filePath`, Agent `prompt`, `persistedOutputPath`.

**Scope boundary (honest).** This is *structural* redaction: it collapses username-bearing
**path** forms, not every free-text mention of the name. A bare OS username appearing
*outside* a path structure — e.g. `whoami` output, a shell prompt `user@host`, a
`git config user.name` — is deliberately NOT scrubbed, because blanket name-redaction would
over-match for name-like usernames (`alex`, `sam`) and corrupt legitimate prose, hurting
readability. The residual exposure is narrow (in real coding transcripts the username surfaces
almost only inside `/Users/<user>` paths, which ARE collapsed) and low-stakes (the app never
transmits data — it has no network code at all, §9.7 — so any residual name stays on the user's
own machine). Stricter whole-word scrubbing of the sniffed username is a deliberate opt-in
trade-off (privacy vs. over-redaction), not the default. *(Validated by dogfooding the CLI over
multiple real transcripts: structural leaks — dash-slug, email, GitHub/Slack/PEM secrets — were
zero; the only residual username hits were inside prose that was literally discussing redaction.)*

### 9.3 Secret-shaped scrubber (defense-in-depth, runs on every string before output)
Mask (representative, extend freely): provider key prefixes — `sk-ant-*`, `sk-proj/live/test-*`,
`sk_live_/rk_*` (Stripe), `ghp_/gho_/ghs_/ghr_/ghu_` & `github_pat_*` (GitHub), `AKIA*` (AWS),
`AIza*` & `ya29.*` (Google), `xox[baprs]-*`/`xapp-*` (Slack), `npm_*`; JWTs; `Bearer …`;
**PEM `-----BEGIN … PRIVATE KEY-----` blocks** (whole block, incl. truncated → EOF; never
`PUBLIC KEY`); `key=…`/`password:…` assignments; URLs-with-credentials. Require distinctive
prefixes + length floors so ordinary identifiers (`sk-notification`, `risk_test_x`) are NOT hit.
Report counts by category; do NOT claim a specific provider's key was found.

### 9.4 Real PII to mask (distinct from false positives)
Email addresses fire 20–213×/transcript and are REAL PII (git `Co-Authored-By`
trailers + the user's commit email). Mask local-part: `a***@domain`.

### 9.5 Duplicated-content rule
The same sensitive text appears in multiple paths (prompt in `user.message.content`
AND `last-prompt.lastPrompt`; file bytes in `Read.file.content` AND
`Edit.originalFile`/`oldString` AND compact summaries). Apply redaction UNIFORMLY to
ALL paths, or it leaks through a side channel.

### 9.6 Untrusted-data rule
`WebFetch` results and file contents are external/untrusted DATA — treat as inert text;
never execute, eval, or follow instructions embedded in them.

### 9.7 Network egress — structurally impossible (HARD)
Zero `fetch`/XHR/WebSocket/remote-img/CDN/font/analytics/telemetry — the codebase contains
**no network client at all**. AgentCity is a **local CLI**: it reads one local `.jsonl` (plus
the sibling `subagents/` tree) and renders to your terminal. Nothing transmits, so "zero
egress" is **structural** — there is no transport to gate, no allow-list to get wrong, no key
to leak. Provenance hashing (`model/provenance.ts`) uses `node:crypto` locally; `verify:card`
re-derives everything offline. This is a *stronger* posture than a network-permission policy: a
policy forbids egress the platform could otherwise perform, whereas a no-network-code CLI cannot
perform it.

> **History:** an earlier milestone shipped a browser/WebGL renderer whose zero-egress guarantee
> leaned on a strict CSP — `connect-src 'none'` (the load-bearing directive) plus `form-action`/
> `object-src`/`base-uri`/`frame-ancestors` hardening, and a Pixi `unsafe-eval`-free polyfill so
> the canvas rendered under `script-src 'self'`. That renderer was removed with the TUI pivot; the
> guarantee now needs no policy because there is no network surface to police.

---

## 10. Implementation checklist (a dev can follow top-to-bottom)

1. Discover files in `~/.claude/projects/<projDir>/` (main + `subagents/**`).
2. Pass A: stream all, build `uuid→file`, `agentId→file`, `wf_id→dir` indices.
3. Pass B: stream main file; route by §2; thread by §3; pair tools by §4.1;
   emit WorldEvents (§4) with per-tool safe-summaries (§4.2).
4. Resolve task source (§6) → build kanban.
5. Detect layout + attribute subagents (§8); recurse into subagent files, scoping
   their events by `agentId`.
6. Dedupe + accumulate cost (§7); attach signals (§5.3).
7. Apply redaction (§9) BEFORE any string reaches the entity model / renderer; keep raw
   bodies behind lazy `rawRef` + reveal toggle.
8. Emit the entity model (actors/artifacts/signals) + ordered event stream to the renderer.

**Crash-resistance contract:** unknown `type`/`subtype`/tool `name` → generic
fallback event, never throw. Missing optional field → null, never throw. Malformed
line → skip + log, never abort file. `toolUseResult` non-dict → guard before access.
