// ============================================================================
// AgentCity — SEMANTIC MAPPING (shared SSOT)
// ----------------------------------------------------------------------------
// The faithful translation layer: real WorldEvent -> city meaning. Used by the
// renderer so the ingester stays presentation-free. Keep this the ONLY place
// that decides "which building / which color / does this send a packet".
// ============================================================================
import type { DistrictKind, WorldEvent, WorldEventKind } from './types.ts';

/** Map a tool name to its district/building. Unknown mcp__* -> consulate. */
export function toolToDistrict(tool: string): DistrictKind {
  if (tool.startsWith('mcp__')) return 'consulate';
  switch (tool) {
    case 'Read':
    case 'Grep':
    case 'Glob':
      return 'archive';
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return 'workshop';
    case 'Bash':
      return 'bash_yard';
    case 'WebFetch':
    case 'WebSearch':
      return 'port';
    case 'Skill':
      return 'skill_firm';
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
    case 'TodoWrite':
      return 'kanban';
    case 'Agent':
    case 'Workflow':
      return 'crew_camp';
    default:
      return 'square';
  }
}

/** Map an event kind to the district it primarily animates at. */
export function eventToDistrict(kind: WorldEventKind): DistrictKind {
  switch (kind) {
    case 'USER_PROMPT':
    case 'AGENT_SAY':
    case 'AGENT_THINK':
    case 'AGENT_TURN_END':
    case 'INJECTED_CONTEXT':
    case 'PROMPT_QUEUED':
      return 'square';
    case 'FILE_READ':
    case 'CODE_SEARCH':
      return 'archive';
    case 'FILE_EDIT':
    case 'FILE_WRITE':
      return 'workshop';
    case 'SHELL_RUN':
      return 'bash_yard';
    case 'WEB_SEARCH':
    case 'WEB_FETCH':
      return 'port';
    case 'MCP_CALL':
    case 'TOOL_DISCOVER':
    case 'SCREENSHOT': // screenshots in this corpus originate from preview/computer-use MCPs
      return 'consulate';
    case 'SKILL_INVOKE':
      return 'skill_firm';
    case 'TASK_CREATE':
    case 'TASK_MOVE':
    case 'TASK_DELETE':
    case 'TODO_SNAPSHOT':
    case 'TODO_TRANSITION':
      return 'kanban';
    case 'SUBAGENT_SPAWN':
    case 'SUBAGENT_RESULT':
    case 'WORKFLOW_LAUNCH':
    case 'WORKFLOW_WORKER':
    case 'WORKFLOW_WORKER_DONE':
    case 'SUBAGENT_ACTION':
    case 'PARALLEL_WAVE':
      return 'crew_camp';
    case 'ASK_USER':
    case 'FILE_SEND':
    case 'GENERIC_TOOL': // unknown tools = unclassified citizen activity, not the tower
    case 'BG_TASK_CTRL':
    case 'SCHEDULE_WAKE':
      return 'square';
    case 'MODE_CHANGE':
      return 'customs';
    // TOOL_FAIL is an OVERLAY on its originating tool event (the originating
    // event already carries isError) — the renderer excludes it from fire/lit so
    // it never lights a building of its own; the default here is never used for it.
    default:
      return 'command_tower';
  }
}

/** Does this event send a visible packet along a road (actor -> target)? */
export function isFlowEvent(kind: WorldEventKind): boolean {
  switch (kind) {
    case 'FILE_READ':
    case 'FILE_EDIT':
    case 'FILE_WRITE':
    case 'SHELL_RUN':
    case 'CODE_SEARCH':
    case 'WEB_SEARCH':
    case 'WEB_FETCH':
    case 'MCP_CALL':
    case 'SKILL_INVOKE':
    case 'SUBAGENT_SPAWN':
    case 'SUBAGENT_RESULT':
    case 'WORKFLOW_LAUNCH':
    case 'USER_PROMPT':
    case 'FILE_SEND':
    case 'ASK_USER':
      return true;
    default:
      return false;
  }
}

/**
 * Calls + failures at a district UP TO a replay seq (seq-relative, matching the
 * packets flown and the inspector's "recent" rows — never lifetime totals).
 * Counts originating events only (skips the TOOL_FAIL overlay) so a failure is
 * not double-counted; failures are read off the originating event's isError flag.
 */
export function districtActivityUpToSeq(
  events: WorldEvent[],
  district: DistrictKind,
  seq: number
): { calls: number; fails: number } {
  let calls = 0;
  let fails = 0;
  for (const e of events) {
    if (e.seq > seq) break;
    if (e.kind === 'TOOL_FAIL' || eventToDistrict(e.kind) !== district) continue;
    calls++;
    if (e.isError === true) fails++;
  }
  return { calls, fails };
}

/**
 * Is this event a TOOL CALL / agent ACTION — versus conversation or session
 * lifecycle? Drives the data-driven building SIZE so the silhouette reads as
 * "how much each tool was USED". Chatter (USER_PROMPT/AGENT_SAY/AGENT_THINK…) and
 * epochs (SESSION_START/COMPACTION/API_RETRY…) are NOT calls and must not inflate
 * a building — otherwise the misc/citizen "square" balloons from talk, not work.
 * TOOL_FAIL is an overlay on its originating call (already counted), so it's out.
 * A new/unknown kind defaults to NOT-a-call (conservative: never over-inflates).
 */
export function isUsageEvent(kind: WorldEventKind): boolean {
  switch (kind) {
    // tool invocations
    case 'FILE_READ':
    case 'FILE_EDIT':
    case 'FILE_WRITE':
    case 'SHELL_RUN':
    case 'CODE_SEARCH':
    case 'WEB_SEARCH':
    case 'WEB_FETCH':
    case 'TOOL_DISCOVER':
    case 'SKILL_INVOKE':
    case 'ASK_USER':
    case 'FILE_SEND':
    case 'SCHEDULE_WAKE':
    case 'MCP_CALL':
    case 'SCREENSHOT':
    case 'BG_TASK_CTRL':
    case 'GENERIC_TOOL':
    // task / kanban actions
    case 'TASK_CREATE':
    case 'TASK_MOVE':
    case 'TASK_DELETE':
    case 'TODO_SNAPSHOT':
    case 'TODO_TRANSITION':
    // subagent / dispatch actions
    case 'SUBAGENT_SPAWN':
    case 'SUBAGENT_RESULT':
    case 'WORKFLOW_LAUNCH':
    case 'WORKFLOW_WORKER':
    case 'WORKFLOW_WORKER_DONE':
    case 'SUBAGENT_ACTION':
    case 'PARALLEL_WAVE':
    // a deliberate permission-gate action (the one lifecycle kind that's a "call")
    case 'MODE_CHANGE':
      return true;
    default:
      return false;
  }
}

/**
 * Lifetime TOOL-CALL count per district across the WHOLE session (isUsageEvent
 * only — conversation + lifecycle excluded, so "size = 调用量" is literal). Routes
 * by eventToDistrict. Drives the data-driven layout (building size + road width):
 * every brick of the skyline traces to a real tool-call count. command_tower is
 * included but the renderer treats it as a fixed landmark, not a data-scaled tool.
 */
export function districtCallTotals(events: WorldEvent[]): Map<DistrictKind, number> {
  const totals = new Map<DistrictKind, number>();
  for (const e of events) {
    if (!isUsageEvent(e.kind)) continue;
    const d = eventToDistrict(e.kind);
    totals.set(d, (totals.get(d) ?? 0) + 1);
  }
  return totals;
}

export function isErrorEvent(e: WorldEvent): boolean {
  return e.isError === true || e.kind === 'TOOL_FAIL';
}

// ---------------------------------------------------------------------------
// Agentville palette — warm isometric. Per the chosen direction:
// RED IS RESERVED STRICTLY FOR FIRE / ERROR (readability fix). Nothing else red.
// ---------------------------------------------------------------------------
// PREMIUM v4 — "狠压基底": every BODY color desaturated ~30% (S reduced, HUE and
// relative relationships PRESERVED → the data encoding "who is who" is unchanged;
// this is pure presentation). The saturation budget is reserved for the SEMANTIC
// accents only (fire / spotTool / spotHuman / ok / warn), so they read as true
// spotlights against a calm, cinematic, low-saturation city instead of competing
// in a candy palette. Originals kept in comments for provenance.
export const PALETTE = {
  skyTop: 0xf6e7c6, // was 0xfce9c0
  skyBottom: 0xebd6a9, // was 0xf4d9a0
  ground: 0x84a376, // was 0x7fb069 (the SimCity candy-green tell)
  groundHi: 0x92af7f, // was 0x8fbf6f
  road: 0xd4c29f, // was 0xd9c49a
  ink: 0x2e4057, // labels / dark accents
  parchment: 0xfffdf5,
  // building bodies (all muted)
  tower: 0xb5845e, // was 0xc8814b
  archive: 0x41645b, // was 0x3a6b5e
  workshop: 0xd5b486, // was 0xe9b872
  bash: 0x9aa0a8, // already neutral grey — left as-is
  port: 0x2e4057,
  skill: 0x9591be, // was 0x8b86c9
  consulate: 0x899ce2, // was 0x6c8bff
  crew: 0x9e875d, // was 0xa98a52 — subagent crew tents, muted khaki
  square: 0xc4b28f, // was 0xcbb488 — misc / civic wheat
  customs: 0x808c9d, // was 0x7d8ba0 — permission "border" muted steel (never fire red)
  // status — the ONLY red in the city is fire/error. SEMANTIC accents stay SATURATED:
  fire: 0xd94f3d,
  ok: 0x7fb069,
  warn: 0xf6c453,
  // spotlight accents (the color-role contract) — deliberately NOT red:
  spotTool: 0xffc061, // amber — a tool is being called at this building RIGHT NOW
  spotHuman: 0x6db3ff, // cold — a human command just landed (the person spoke)
  // budget meter zones
  budgetOk: 0x7fb069,
  budgetWarn: 0xf6c453,
  budgetCrit: 0xd94f3d,
} as const;

/** District -> building body color. */
export function districtColor(d: DistrictKind): number {
  switch (d) {
    case 'command_tower':
      return PALETTE.tower;
    case 'archive':
      return PALETTE.archive;
    case 'workshop':
      return PALETTE.workshop;
    case 'bash_yard':
      return PALETTE.bash;
    case 'port':
      return PALETTE.port;
    case 'skill_firm':
      return PALETTE.skill;
    case 'consulate':
      return PALETTE.consulate;
    case 'crew_camp':
      return PALETTE.crew;
    case 'square':
      return PALETTE.square;
    case 'customs':
      return PALETTE.customs;
    case 'kanban':
      return PALETTE.parchment;
    case 'powerplant':
      return PALETTE.ink;
    default:
      return PALETTE.tower;
  }
}

/** Human-readable building name (English alias + Chinese), for labels. */
export const DISTRICT_LABEL: Record<DistrictKind, string> = {
  command_tower: 'Command Tower',
  crew_camp: 'Crew Camp',
  archive: 'Archive',
  workshop: 'Workshop',
  bash_yard: 'Bash Yard',
  port: 'Port',
  consulate: 'Consulate',
  skill_firm: 'Skill Firm',
  kanban: 'Work Orders',
  powerplant: 'Power Plant',
  customs: 'Customs',
  square: 'Town Square',
};
