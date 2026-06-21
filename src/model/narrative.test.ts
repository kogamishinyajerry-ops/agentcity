// The narrative layer is honesty-bearing: a caption may only describe a REAL
// turning-point event, tool/chatter noise must stay UN-captioned (the city shows
// it), and an error cluster must read as one moment. These pin that contract.
import { describe, it, expect } from 'vitest';
import {
  narrativeBeats,
  beatAtSeq,
  currentIntent,
  storyArc,
  type NarrativeBeat,
} from './narrative.ts';
import type {
  ParsedSession,
  WorldEvent,
  WorldEventKind,
  SessionMeta,
} from './types.ts';

function ev(seq: number, kind: WorldEventKind, extra: Partial<WorldEvent> = {}): WorldEvent {
  return { id: `e${seq}`, kind, ts: '', seq, actorId: 'main', truth: 'observed', label: '', ...extra };
}

function sess(events: WorldEvent[], meta: Partial<SessionMeta> = {}): ParsedSession {
  return {
    meta: { sessionId: 's', schemaVersions: [], taskSource: 'none', warnings: [], ...meta },
    events,
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
  };
}

describe('narrativeBeats — the plain-language story skeleton', () => {
  it('is empty for an empty session', () => {
    expect(narrativeBeats(sess([]))).toEqual([]);
  });

  it('always brackets the run with an opening and a closing beat', () => {
    const beats = narrativeBeats(sess([ev(1, 'SESSION_START'), ev(9, 'AGENT_TURN_END')]));
    expect(beats[0].seq).toBe(1);
    expect(beats[0].text).toContain('开工');
    expect(beats[beats.length - 1].seq).toBe(9);
    expect(beats[beats.length - 1].text).toContain('结束');
  });

  it('uses the REAL session title in the opening beat when present', () => {
    const beats = narrativeBeats(sess([ev(1, 'SESSION_START'), ev(2, 'AGENT_SAY')], { title: '修复登录 bug' }));
    expect(beats[0].text).toContain('修复登录 bug');
  });

  it('does NOT caption tool calls or chatter (restraint — the city shows those)', () => {
    // a run of pure moment-to-moment noise => only the synthesized open + close
    const beats = narrativeBeats(
      sess([ev(1, 'FILE_READ'), ev(2, 'AGENT_SAY'), ev(3, 'FILE_EDIT'), ev(4, 'AGENT_THINK'), ev(5, 'SHELL_RUN')])
    );
    expect(beats).toHaveLength(2);
    expect(beats.map((b) => b.text)).toEqual([expect.stringContaining('开工'), expect.stringContaining('结束')]);
  });

  it('captions real turning points: prompt, dispatch, compaction, mode switch', () => {
    const beats = narrativeBeats(
      sess([
        ev(1, 'SESSION_START'),
        ev(3, 'USER_PROMPT'),
        ev(5, 'SUBAGENT_SPAWN'),
        ev(7, 'COMPACTION'),
        ev(9, 'MODE_CHANGE'),
        ev(11, 'SUBAGENT_RESULT'),
        ev(20, 'AGENT_TURN_END'),
      ])
    );
    const texts = beats.map((b) => b.text);
    expect(texts.some((t) => t.includes('交代'))).toBe(true);
    expect(texts.some((t) => t.includes('小队'))).toBe(true);
    expect(texts.some((t) => t.includes('记忆'))).toBe(true);
    expect(texts.some((t) => t.includes('权限'))).toBe(true);
  });

  it('marks a compaction as a DRAMA beat (cues the cutscene), others normal', () => {
    const beats = narrativeBeats(sess([ev(1, 'SESSION_START'), ev(5, 'COMPACTION'), ev(9, 'AGENT_TURN_END')]));
    const comp = beats.find((b) => b.text.includes('记忆'))!;
    expect(comp.tone).toBe('drama');
    expect(beats.find((b) => b.text.includes('开工'))!.tone).toBe('normal');
  });

  it('captions an error with its district and stays plain-language', () => {
    const beats = narrativeBeats(sess([ev(1, 'SESSION_START'), ev(5, 'FILE_EDIT', { isError: true }), ev(9, 'AGENT_TURN_END')]));
    const err = beats.find((b) => b.text.includes('失败'))!;
    expect(err).toBeTruthy();
    expect(err.text).toContain('工坊'); // FILE_EDIT -> workshop, glossed to Chinese
  });

  it('collapses a cluster of same-district errors into ONE moment, not a stutter', () => {
    const beats = narrativeBeats(
      sess([
        ev(1, 'SESSION_START'),
        ev(5, 'FILE_EDIT', { isError: true }),
        ev(7, 'FILE_EDIT', { isError: true }),
        ev(8, 'FILE_EDIT', { isError: true }),
        ev(20, 'AGENT_TURN_END'),
      ])
    );
    expect(beats.filter((b) => b.text.includes('失败'))).toHaveLength(1);
  });

  it('shows the REAL (already-redacted) prompt text, not a generic line', () => {
    const beats = narrativeBeats(
      sess([ev(1, 'SESSION_START'), ev(3, 'USER_PROMPT', { label: '做一个登录页面' }), ev(9, 'AGENT_TURN_END')])
    );
    const said = beats.find((b) => b.text.includes('你说'))!;
    expect(said.text).toContain('做一个登录页面');
  });

  it('falls back to a generic prompt line only when the label is empty', () => {
    const beats = narrativeBeats(sess([ev(1, 'SESSION_START'), ev(3, 'USER_PROMPT', { label: '' }), ev(9, 'AGENT_TURN_END')]));
    expect(beats.some((b) => b.text === '你交代了一件事')).toBe(true);
  });

  it('captions a failure ONCE — the TOOL_FAIL overlay twin earns no extra beat', () => {
    const beats = narrativeBeats(
      sess([
        ev(1, 'SESSION_START'),
        ev(5, 'FILE_WRITE', { isError: true }), // originating error
        ev(6, 'TOOL_FAIL', { isError: true }), // its overlay twin
        ev(20, 'AGENT_TURN_END'),
      ])
    );
    expect(beats.filter((b) => b.text.includes('失败'))).toHaveLength(1);
  });

  it('does NOT caption the initial permission mode (a starting state, not a switch)', () => {
    const beats = narrativeBeats(
      sess([ev(1, 'MODE_CHANGE', { targetRef: 'bypassPermissions' }), ev(5, 'USER_PROMPT', { label: 'go' }), ev(9, 'AGENT_TURN_END')])
    );
    expect(beats.some((b) => b.text.includes('权限'))).toBe(false);
    expect(beats[0].text).toContain('开工'); // the opening beat is no longer masked
  });

  it('DOES caption a later mode switch (a real transition)', () => {
    const beats = narrativeBeats(
      sess([ev(1, 'SESSION_START'), ev(9, 'MODE_CHANGE'), ev(20, 'AGENT_TURN_END')])
    );
    expect(beats.some((b) => b.text.includes('权限'))).toBe(true);
  });

  it('keeps beats ordered by seq', () => {
    const beats = narrativeBeats(
      sess([ev(1, 'SESSION_START'), ev(8, 'COMPACTION'), ev(4, 'USER_PROMPT'), ev(20, 'AGENT_TURN_END')])
    );
    const seqs = beats.map((b) => b.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});

describe('beat.plain — the standalone-card gloss (plain language + named artifacts, verbatim)', () => {
  it('names the real file a FILE_EDIT error touched, VERBATIM (city metaphor stays in text)', () => {
    const beats = narrativeBeats(sess([ev(1, 'SESSION_START'), ev(5, 'FILE_EDIT', { isError: true, targetRef: 'cardSvg.ts' }), ev(9, 'AGENT_TURN_END')]));
    const err = beats.find((b) => b.weight === 4)!;
    expect(err.plain).toBe('改「cardSvg.ts」时出错了'); // named, verbatim from targetRef; no per-beat outcome claim
    expect(err.text).toContain('工坊'); // TUI keeps the city metaphor
  });
  it('names the real command a SHELL_RUN error ran, stripped from the label', () => {
    const beats = narrativeBeats(sess([ev(1, 'SESSION_START'), ev(5, 'SHELL_RUN', { isError: true, label: '$ npm test' }), ev(9, 'AGENT_TURN_END')]));
    expect(beats.find((b) => b.weight === 4)!.plain).toBe('跑「npm test」时出错了');
  });
  it('falls back to a GENERIC plain gloss when the event has no named target (never invents one)', () => {
    const beats = narrativeBeats(sess([ev(1, 'SESSION_START'), ev(5, 'FILE_EDIT', { isError: true }), ev(9, 'AGENT_TURN_END')]));
    expect(beats.find((b) => b.weight === 4)!.plain).toBe('有一步出错了');
  });
  it('states only observed facts — no per-beat resilience ("没停下") or completion ("干完") claim', () => {
    const beats = narrativeBeats(sess([ev(1, 'SESSION_START'), ev(5, 'FILE_EDIT', { isError: true, targetRef: 'x.ts' }), ev(9, 'AGENT_TURN_END')]));
    for (const b of beats) {
      expect(b.plain).not.toContain('没停下'); // resilience is the aggregate stat's job
      expect(b.plain).not.toContain('干完'); // the record ending ≠ the work succeeded
    }
  });
  it('names the subagent a dispatch went to, from targetRef', () => {
    const beats = narrativeBeats(sess([ev(1, 'SESSION_START'), ev(5, 'SUBAGENT_SPAWN', { targetRef: 'loop-auditor' }), ev(9, 'AGENT_TURN_END')]));
    expect(beats.find((b) => b.text.includes('小队'))!.plain).toBe('分了个子任务给「loop-auditor」');
  });
  it('states a compaction cause only when observed (auto→满了, manual→主动, unknown→neutral)', () => {
    const plainOf = (extra: Partial<WorldEvent>) =>
      narrativeBeats(sess([ev(1, 'SESSION_START'), ev(5, 'COMPACTION', extra), ev(9, 'AGENT_TURN_END')])).find((b) => b.tone === 'drama')!.plain;
    expect(plainOf({ detail: { trigger: 'auto' } })).toContain('满了'); // context pressure — the real cause
    expect(plainOf({ detail: { trigger: 'manual' } })).toBe('🧠 主动整理压缩了一次记忆');
    expect(plainOf({ detail: { trigger: 'manual' } })).not.toContain('满了'); // a manual /compact wasn't "full"
    expect(plainOf({})).not.toContain('满了'); // unknown trigger → assert no unverified cause
  });
  it('every card gloss is plain — free of the city metaphor (which only the visible TUI city decodes)', () => {
    const beats = narrativeBeats(sess([ev(1, 'SESSION_START'), ev(5, 'COMPACTION'), ev(7, 'SUBAGENT_SPAWN'), ev(9, 'AGENT_TURN_END')]));
    for (const b of beats) {
      expect(b.plain).toBeTruthy();
      expect(b.plain).not.toContain('这座城');
      expect(b.plain).not.toContain('小队');
    }
  });
});

describe('storyArc — the finale journey (honest highlights, never invented)', () => {
  // open(w5) + prompt(w3) + branch(w1) + spawn(w3) + error(w4) + compaction(w5) + mode(w1) + close(w5)
  const rich = () =>
    sess([
      ev(1, 'SESSION_START'),
      ev(3, 'USER_PROMPT', { label: '做个登录页' }),
      ev(5, 'BRANCH_SWITCH'),
      ev(7, 'SUBAGENT_SPAWN'),
      ev(9, 'FILE_EDIT', { isError: true }),
      ev(11, 'COMPACTION'),
      ev(13, 'MODE_CHANGE'),
      ev(20, 'AGENT_TURN_END'),
    ]);

  it('returns every beat (untruncated) when the count fits', () => {
    const arc = storyArc(sess([ev(1, 'SESSION_START'), ev(3, 'USER_PROMPT', { label: 'go' }), ev(9, 'AGENT_TURN_END')]), 5);
    expect(arc.truncated).toBe(false);
    expect(arc.beats).toHaveLength(3);
    expect(arc.total).toBe(3);
  });

  it('caps to a highlights pick but reports the real total', () => {
    const arc = storyArc(rich(), 5);
    expect(arc.beats).toHaveLength(5);
    expect(arc.total).toBe(8);
    expect(arc.truncated).toBe(true);
  });

  it('always keeps the opening + closing anchors', () => {
    const arc = storyArc(rich(), 5);
    expect(arc.beats[0].text).toContain('开工');
    expect(arc.beats[arc.beats.length - 1].text).toContain('结束');
  });

  it('keeps the highest-significance beats (compaction, error) and drops low-weight switches', () => {
    const texts = storyArc(rich(), 5).beats.map((b) => b.text);
    expect(texts.some((t) => t.includes('记忆'))).toBe(true); // compaction (w5, drama)
    expect(texts.some((t) => t.includes('失败'))).toBe(true); // error (w4)
    expect(texts.some((t) => t.includes('登录页'))).toBe(true); // prompt (w3)
    expect(texts.some((t) => t.includes('分支'))).toBe(false); // branch switch (w1) dropped
    expect(texts.some((t) => t.includes('权限'))).toBe(false); // mode switch (w1) dropped
  });

  it('shows the kept beats in true chronological (seq) order', () => {
    const seqs = storyArc(rich(), 5).beats.map((b) => b.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('collapses a repeated gloss to ONE display line but still COUNTS every distinct event', () => {
    // two same-district failures hours apart: shown once (no stutter), but they are
    // two real turning-point events, so `total` must count BOTH (共 4, not 共 3).
    const arc = storyArc(
      sess([
        ev(1, 'SESSION_START'),
        ev(5, 'FILE_EDIT', { isError: true }), // 工坊那边失败了
        ev(80, 'FILE_EDIT', { isError: true }), // same gloss, far apart (narrativeBeats' 12-seq window doesn't merge)
        ev(120, 'AGENT_TURN_END'),
      ]),
      5
    );
    expect(arc.beats.filter((b) => b.text.includes('失败'))).toHaveLength(1); // display: one line
    expect(arc.total).toBe(4); // open + 2 distinct failures + close — total stays faithful
    expect(arc.truncated).toBe(true); // fewer lines shown than the real total → label it
  });

  it('counts two far-apart SUBAGENT_SPAWN as TWO turning points despite the shared gloss (M1)', () => {
    // both dispatches gloss to 「派出一支小队去帮忙」; a text-keyed total would under-report
    // them as one. The disclosed total must reflect both real events.
    const arc = storyArc(
      sess([
        ev(1, 'SESSION_START'),
        ev(3, 'SUBAGENT_SPAWN'),
        ev(50, 'SUBAGENT_SPAWN'), // distinct event, identical gloss, far apart
        ev(90, 'AGENT_TURN_END'),
      ]),
      5
    );
    expect(arc.beats.filter((b) => b.text.includes('小队'))).toHaveLength(1); // display: one line
    expect(arc.total).toBe(4); // open + 2 distinct dispatches + close
    expect(arc.truncated).toBe(true);
  });
});

describe('beatAtSeq — the caption showing at the playhead', () => {
  const beats: NarrativeBeat[] = [
    { seq: 1, text: 'a', tone: 'normal' },
    { seq: 5, text: 'b', tone: 'normal' },
    { seq: 20, text: 'c', tone: 'normal' },
  ];
  it('is null before the first beat', () => {
    expect(beatAtSeq(beats, 0)).toBeNull();
  });
  it('returns the most recent beat at or before the playhead', () => {
    expect(beatAtSeq(beats, 1)?.text).toBe('a');
    expect(beatAtSeq(beats, 4)?.text).toBe('a');
    expect(beatAtSeq(beats, 5)?.text).toBe('b');
    expect(beatAtSeq(beats, 999)?.text).toBe('c');
  });
});

describe('currentIntent — the persistent verbatim user ask at the playhead', () => {
  const events = [
    ev(1, 'USER_PROMPT', { label: '把战斗做成自走棋' }),
    ev(2, 'FILE_EDIT', { label: 'Edit Battle.gd' }),
    ev(5, 'AGENT_SAY', { label: '好的' }),
    ev(8, 'USER_PROMPT', { label: '<task-notification>' }),
    ev(12, 'SHELL_RUN', { label: '$ godot' }),
  ];
  it('is null before the first prompt', () => {
    expect(currentIntent(events, 0)).toBeNull();
  });
  it('persists the latest user ask while the agent works (across tool/chatter beats)', () => {
    expect(currentIntent(events, 1)?.text).toBe('把战斗做成自走棋');
    expect(currentIntent(events, 2)?.text).toBe('把战斗做成自走棋'); // still driving during the edit
    expect(currentIntent(events, 7)?.text).toBe('把战斗做成自走棋');
  });
  it('shows verbatim what arrived on the user channel (no editorializing — even a system turn)', () => {
    expect(currentIntent(events, 8)?.text).toBe('<task-notification>');
    expect(currentIntent(events, 12)?.text).toBe('<task-notification>'); // persists past the next tool
  });
  it('skips empty-label prompts (nothing to surface)', () => {
    const evs = [ev(1, 'USER_PROMPT', { label: '   ' }), ev(2, 'USER_PROMPT', { label: '真的指令' })];
    expect(currentIntent(evs, 1)).toBeNull();
    expect(currentIntent(evs, 2)?.text).toBe('真的指令');
  });
  it('bounds long prompts (honest, just clipped)', () => {
    const long = 'x'.repeat(200);
    const evs = [ev(1, 'USER_PROMPT', { label: long })];
    const out = currentIntent(evs, 1, 90)!;
    expect(out.text.length).toBeLessThanOrEqual(91); // 90 + ellipsis
    expect(out.text.endsWith('…')).toBe(true);
  });
});
