// Regression for the TUI view-model — asserts the panel is derived from a session
// and stays honest (workload = Σ bars, RED tracks real errors, finale agrees with
// the panel). Driven by the SYNTHETIC session so it runs on a fresh clone / in CI
// (the real parsed-sample fixture is gitignored).
import { describe, expect, it } from 'vitest';
import { buildPanelModel } from './viewModel.ts';
import { synthSession, SYNTH_WISH, SYNTH_LABOR_STEPS } from '../test/synthSession.ts';

const session = synthSession();
const m = buildPanelModel(session);

describe('tui panel model (end state)', () => {
  it('workload is self-consistent: laborSteps === Σ bars', () => {
    const sum = m.bars.reduce((n, b) => n + b.calls, 0);
    expect(m.laborSteps).toBe(sum);
    expect(m.laborSteps).toBe(SYNTH_LABOR_STEPS);
  });

  it('bars are sorted by real call count (descending)', () => {
    for (let i = 1; i < m.bars.length; i++) {
      expect(m.bars[i - 1].calls).toBeGreaterThanOrEqual(m.bars[i].calls);
    }
    expect(m.maxCalls).toBe(m.bars[0].calls);
  });

  it('surfaces the real (redacted) wish', () => {
    expect(m.intent).toBe(SYNTH_WISH);
  });

  it('completed cards match the kanban', () => {
    expect(m.footer.cardsDone).toBe(session.kanban.filter((c) => c.lane === 'completed').length);
  });
});

describe('tui narration (the story beat at the playhead)', () => {
  it('surfaces a turning-point beat (honest gloss, never fabricated)', () => {
    expect(m.narration).toBeTruthy();
  });
  it('flags the compaction as a drama beat (the 记忆清洗 cutscene)', () => {
    const comp = session.events.find((e) => e.kind === 'COMPACTION');
    expect(comp).toBeTruthy();
    expect(buildPanelModel(session, comp!.seq).narration?.drama).toBe(true);
  });
});

describe('tui panel model — seq-relative', () => {
  it('shows less work early than at the end', () => {
    const early = buildPanelModel(session, 8); // before the bulk of the tool calls
    const end = buildPanelModel(session);
    expect(early.laborSteps).toBeLessThan(end.laborSteps);
    expect(early.seqPos.seq).toBe(8);
    expect(end.atEnd).toBe(true);
  });
});

describe('tui inline finale (end only, panel-consistent number)', () => {
  it('appears only at the end', () => {
    expect(buildPanelModel(session, 8).finale).toBeNull();
    expect(buildPanelModel(session).finale).not.toBeNull();
  });

  it('hero number + punchline match the panel laborSteps (no two-number disagreement)', () => {
    expect(m.finale!.laborSteps).toBe(m.laborSteps);
    expect(m.finale!.punchline).toContain(String(m.laborSteps));
  });

  it('carries real "包括" sub-stats anchored to the aggregates', () => {
    expect(m.finale!.stats.length).toBeGreaterThan(0);
    const edits = m.finale!.stats.find((s) => s.key === 'edits');
    expect(edits?.value).toBe(session.files.reduce((n, f) => n + f.edits, 0));
  });

  it('carries the "一路走来" journey: ordered real beats, anchored + honestly capped', () => {
    const fin = m.finale!;
    expect(fin.journey.length).toBeGreaterThan(0);
    expect(fin.journeyTotal).toBeGreaterThanOrEqual(fin.journey.length);
    // anchors: the journey opens on 开工 and ends on the closing beat
    expect(fin.journey[0].text).toContain('开工');
    expect(fin.journey[fin.journey.length - 1].text).toContain('结束');
    // the compaction is flagged as a drama beat (the 记忆清洗 cue)
    expect(fin.journey.some((b) => b.drama && b.text.includes('记忆'))).toBe(true);
  });
});
