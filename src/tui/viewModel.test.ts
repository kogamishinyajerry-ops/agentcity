// Regression for the TUI view-model — asserts the panel is derived from the REAL
// parsed sample and stays honest (workload = Σ bars, RED tracks real errors).
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ParsedSession } from '../model/types.ts';
import { buildPanelModel } from './viewModel.ts';

// The parsed-sample fixture is gitignored (it's a real transcript). On a fresh
// clone it's absent, so these suites skip rather than error — full coverage runs
// wherever the fixture is present.
const SAMPLE = 'sample/parsed-sample.json';
const present = existsSync(SAMPLE);
const session = present
  ? (JSON.parse(readFileSync(SAMPLE, 'utf8')) as ParsedSession)
  : (null as unknown as ParsedSession);
// Derived once at module level behind `present` — describe.skipIf still RUNS the
// suite body to collect tests, so throwing setup can't live there.
const m = present ? buildPanelModel(session) : (null as unknown as ReturnType<typeof buildPanelModel>);

describe.skipIf(!present)('tui panel model — real sample (end state)', () => {

  it('workload is self-consistent: laborSteps === Σ bars', () => {
    const sum = m.bars.reduce((n, b) => n + b.calls, 0);
    expect(m.laborSteps).toBe(sum);
  });

  it('bars are sorted by real call count, kanban dominant', () => {
    expect(m.bars[0].district).toBe('kanban');
    for (let i = 1; i < m.bars.length; i++) {
      expect(m.bars[i - 1].calls).toBeGreaterThanOrEqual(m.bars[i].calls);
    }
  });

  it('surfaces the real (redacted) wish', () => {
    expect(m.intent).toBeTruthy();
    expect(m.intent).toContain('杀戮尖塔');
  });

  it('completed cards match the real kanban', () => {
    expect(m.footer.cardsDone).toBe(
      session.kanban.filter((c) => c.lane === 'completed').length
    );
  });
});

describe.skipIf(!present)('tui narration (the story beat at the playhead)', () => {
  it('surfaces a turning-point beat (honest gloss, never fabricated)', () => {
    expect(buildPanelModel(session).narration).toBeTruthy();
  });
  it('flags the real compaction as a drama beat (the 记忆清洗 cutscene)', () => {
    const comp = session.events.find((e) => e.kind === 'COMPACTION');
    expect(comp).toBeTruthy();
    expect(buildPanelModel(session, comp!.seq).narration?.drama).toBe(true);
  });
});

describe.skipIf(!present)('tui panel model — seq-relative', () => {
  it('shows less work early than at the end', () => {
    const early = buildPanelModel(session, 100);
    const end = buildPanelModel(session);
    expect(early.laborSteps).toBeLessThan(end.laborSteps);
    expect(early.seqPos.seq).toBe(100);
    expect(end.atEnd).toBe(true);
  });
});

describe.skipIf(!present)('tui inline finale (end only, panel-consistent number)', () => {
  it('appears only at the end', () => {
    expect(buildPanelModel(session, 100).finale).toBeNull();
    expect(buildPanelModel(session).finale).not.toBeNull();
  });

  it('hero number + punchline match the panel laborSteps (no 597/611 disagreement)', () => {
    const end = buildPanelModel(session);
    expect(end.finale!.laborSteps).toBe(end.laborSteps);
    expect(end.finale!.punchline).toContain(String(end.laborSteps));
  });

  it('carries real "包括" sub-stats', () => {
    const fin = buildPanelModel(session).finale!;
    expect(fin.stats.length).toBeGreaterThan(0);
    const edits = fin.stats.find((s) => s.key === 'edits');
    expect(edits?.value).toBe(session.files.reduce((n, f) => n + f.edits, 0));
  });
});
