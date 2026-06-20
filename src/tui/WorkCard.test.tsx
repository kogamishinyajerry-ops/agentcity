// Ink render smoke for the 作品 card — the finished-run artifact must stay
// honest: the real (redacted) wish shows, the labor asymmetry + provenance seal
// are present, and the «包括» subset carries real sub-stats. Rendered to string
// via ink-testing-library (the dev loop the web renderer couldn't close).
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { ParsedSession } from '../model/types.ts';
import { buildPanelModel } from './viewModel.ts';
import { WorkCard } from './WorkCard.tsx';

// Fixture is gitignored (real transcript) → skip cleanly when absent (fresh clone).
const SAMPLE = 'sample/parsed-sample.json';
const present = existsSync(SAMPLE);
const session = present
  ? (JSON.parse(readFileSync(SAMPLE, 'utf8')) as ParsedSession)
  : (null as unknown as ParsedSession);
// Derived at module level behind `present` — `describe.skipIf` still runs the
// suite body to collect tests, so the render can't live there (would throw on null).
const model = present ? buildPanelModel(session) : (null as unknown as ReturnType<typeof buildPanelModel>);
const f = present ? (render(<WorkCard model={model} />).lastFrame() ?? '') : '';

describe.skipIf(!present)('WorkCard (作品 end-card)', () => {
  it('surfaces the real (redacted) wish', () => {
    expect(f).toContain('愿望');
    expect(f).toContain('杀戮尖塔');
  });

  it('shows the labor asymmetry + the honest provenance seal', () => {
    expect(f).toContain('它替你跑了');
    expect(f).toContain('你亲手');
    expect(f).toContain('数据来自真实记录');
  });

  it('carries the «包括» subset with real sub-stats', () => {
    expect(f).toContain('包括');
    const edits = model.finale!.stats.find((s) => s.key === 'edits')!;
    expect(f).toContain(String(edits.value));
  });
});
