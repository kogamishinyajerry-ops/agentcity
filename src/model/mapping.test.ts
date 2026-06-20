// Pure semantic-mapping tests. These pin the event→city vocabulary so a refactor
// can't silently re-route a tool to the wrong district or collapse two distinct
// district colors (the customs/square/tower fix).
import { describe, it, expect } from 'vitest';
import {
  toolToDistrict,
  eventToDistrict,
  isFlowEvent,
  districtColor,
  districtActivityUpToSeq,
  districtCallTotals,
  isUsageEvent,
  DISTRICT_LABEL,
  PALETTE,
} from './mapping.ts';
import type { DistrictKind, WorldEvent, WorldEventKind } from './types.ts';

describe('toolToDistrict', () => {
  it('routes the core tools to their buildings', () => {
    expect(toolToDistrict('Read')).toBe('archive');
    expect(toolToDistrict('Grep')).toBe('archive');
    expect(toolToDistrict('Write')).toBe('workshop');
    expect(toolToDistrict('Bash')).toBe('bash_yard');
    expect(toolToDistrict('WebFetch')).toBe('port');
    expect(toolToDistrict('Agent')).toBe('crew_camp');
    expect(toolToDistrict('mcp__github__list')).toBe('consulate');
    expect(toolToDistrict('SomethingUnknown')).toBe('square');
  });
});

describe('eventToDistrict', () => {
  it('routes representative event kinds', () => {
    const cases: [WorldEventKind, DistrictKind][] = [
      ['FILE_READ', 'archive'],
      ['CODE_SEARCH', 'archive'],
      ['FILE_WRITE', 'workshop'],
      ['FILE_EDIT', 'workshop'],
      ['SHELL_RUN', 'bash_yard'],
      ['WEB_FETCH', 'port'],
      ['MCP_CALL', 'consulate'],
      ['SKILL_INVOKE', 'skill_firm'],
      ['SUBAGENT_SPAWN', 'crew_camp'],
      ['MODE_CHANGE', 'customs'],
      ['USER_PROMPT', 'square'],
    ];
    for (const [kind, district] of cases) {
      expect(eventToDistrict(kind), kind).toBe(district);
    }
  });
});

describe('isFlowEvent', () => {
  it('flags the events that send a road packet, and not the rest', () => {
    expect(isFlowEvent('FILE_READ')).toBe(true);
    expect(isFlowEvent('SUBAGENT_SPAWN')).toBe(true);
    expect(isFlowEvent('SHELL_RUN')).toBe(true);
    expect(isFlowEvent('AGENT_THINK')).toBe(false);
    expect(isFlowEvent('TOOL_FAIL')).toBe(false); // fire, not a packet
    expect(isFlowEvent('COMPACTION')).toBe(false);
  });
});

describe('districtColor — the customs/square/tower fix (no two share a color)', () => {
  it('gives every district a distinct body color', () => {
    const districts: DistrictKind[] = [
      'command_tower', 'archive', 'workshop', 'bash_yard', 'port',
      'consulate', 'skill_firm', 'crew_camp', 'square', 'customs', 'kanban',
    ];
    const colors = districts.map(districtColor);
    expect(new Set(colors).size).toBe(colors.length); // all unique
    // the specific collision that was fixed: tower vs square vs customs
    expect(districtColor('command_tower')).not.toBe(districtColor('square'));
    expect(districtColor('command_tower')).not.toBe(districtColor('customs'));
    expect(districtColor('square')).not.toBe(districtColor('customs'));
  });

  it('reserves fire red for nothing in the district palette', () => {
    const districts: DistrictKind[] = [
      'command_tower', 'archive', 'workshop', 'bash_yard', 'port',
      'consulate', 'skill_firm', 'crew_camp', 'square', 'customs',
    ];
    for (const d of districts) expect(districtColor(d)).not.toBe(PALETTE.fire);
  });
});

describe('districtActivityUpToSeq — the P1 inspector fix (seq-relative, no double-count)', () => {
  const ev = (seq: number, kind: string, isError = false): WorldEvent =>
    ({ seq, kind, isError, actorId: 'main' } as unknown as WorldEvent);
  // bash_yard: a failed npm test (seq 12, isError) + its TOOL_FAIL overlay (seq 13),
  // then a passing run (seq 16). archive: a grep (5) and a read (6).
  const events = [
    ev(5, 'CODE_SEARCH'),
    ev(6, 'FILE_READ'),
    ev(12, 'SHELL_RUN', true),
    ev(13, 'TOOL_FAIL', true),
    ev(16, 'SHELL_RUN'),
  ];

  it('grows seq-relative instead of showing lifetime totals', () => {
    expect(districtActivityUpToSeq(events, 'archive', 5)).toEqual({ calls: 1, fails: 0 });
    expect(districtActivityUpToSeq(events, 'archive', 20)).toEqual({ calls: 2, fails: 0 });
  });

  it('counts a failure once (skips the TOOL_FAIL overlay) and reconciles at the end', () => {
    expect(districtActivityUpToSeq(events, 'bash_yard', 11)).toEqual({ calls: 0, fails: 0 });
    expect(districtActivityUpToSeq(events, 'bash_yard', 12)).toEqual({ calls: 1, fails: 1 });
    expect(districtActivityUpToSeq(events, 'bash_yard', 16)).toEqual({ calls: 2, fails: 1 });
  });
});

describe('DISTRICT_LABEL', () => {
  it('labels every district referenced by districtColor', () => {
    for (const d of Object.keys(DISTRICT_LABEL) as DistrictKind[]) {
      expect(typeof DISTRICT_LABEL[d]).toBe('string');
      expect(DISTRICT_LABEL[d].length).toBeGreaterThan(0);
    }
  });
});

describe('isUsageEvent — building SIZE counts tool calls, not chatter (data-driven layout)', () => {
  it('counts tool / action / dispatch events as calls', () => {
    const calls: WorldEventKind[] = [
      'FILE_READ', 'FILE_EDIT', 'FILE_WRITE', 'SHELL_RUN', 'CODE_SEARCH',
      'WEB_SEARCH', 'MCP_CALL', 'SKILL_INVOKE', 'GENERIC_TOOL', 'ASK_USER',
      'TASK_MOVE', 'SUBAGENT_SPAWN', 'WORKFLOW_LAUNCH', 'MODE_CHANGE',
    ];
    for (const k of calls) expect(isUsageEvent(k), k).toBe(true);
  });

  it('does NOT count conversation or session lifecycle (they would inflate the square)', () => {
    const notCalls: WorldEventKind[] = [
      'USER_PROMPT', 'AGENT_SAY', 'AGENT_THINK', 'AGENT_TURN_END',
      'INJECTED_CONTEXT', 'PROMPT_QUEUED', 'SESSION_START', 'COMPACTION',
      'API_RETRY', 'MODEL_SWITCH', 'TURN_TIMING',
    ];
    for (const k of notCalls) expect(isUsageEvent(k), k).toBe(false);
  });

  it('excludes the TOOL_FAIL overlay (the originating call already counts)', () => {
    expect(isUsageEvent('TOOL_FAIL')).toBe(false);
  });
});

describe('districtCallTotals — honest per-district tool-call volume (drives building size)', () => {
  const ev = (kind: string): WorldEvent =>
    ({ seq: 0, kind, actorId: 'main' } as unknown as WorldEvent);

  it('counts tool calls per district', () => {
    const totals = districtCallTotals([
      ev('SHELL_RUN'), ev('SHELL_RUN'), ev('SHELL_RUN'), // bash_yard x3
      ev('FILE_READ'), ev('CODE_SEARCH'), // archive x2
      ev('FILE_EDIT'), // workshop x1
    ]);
    expect(totals.get('bash_yard')).toBe(3);
    expect(totals.get('archive')).toBe(2);
    expect(totals.get('workshop')).toBe(1);
  });

  it('does NOT let conversation inflate the misc square (THE honesty fix)', () => {
    const totals = districtCallTotals([
      ev('USER_PROMPT'), ev('AGENT_SAY'), ev('AGENT_THINK'),
      ev('AGENT_TURN_END'), ev('PROMPT_QUEUED'), // 5 chatter -> square, but NOT calls
      ev('GENERIC_TOOL'), // 1 real misc tool -> square
    ]);
    // the square reflects only the one real misc-tool call, not the 5 chatter events
    expect(totals.get('square')).toBe(1);
  });

  it('excludes the TOOL_FAIL overlay so a failure is not double-counted', () => {
    const totals = districtCallTotals([ev('SHELL_RUN'), ev('TOOL_FAIL')]);
    expect(totals.get('bash_yard')).toBe(1);
  });

  it('returns an empty map for an empty session (no NaN/throw downstream)', () => {
    expect(districtCallTotals([]).size).toBe(0);
  });
});
