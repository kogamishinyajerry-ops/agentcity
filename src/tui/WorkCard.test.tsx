// Ink render smoke for the 作品 card — the finished-run artifact must stay
// honest: the real (redacted) wish shows, the labor asymmetry + provenance seal
// are present, and the «包括» subset carries real sub-stats. Rendered to string
// via ink-testing-library (the dev loop the web renderer couldn't close).
//
// Driven by the SYNTHETIC session so it runs on a fresh clone / in CI (the real
// transcript fixture is gitignored).
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { synthSession } from '../test/synthSession.ts';
import { buildPanelModel } from './viewModel.ts';
import { WorkCard } from './WorkCard.tsx';

const model = buildPanelModel(synthSession());
const f = render(<WorkCard model={model} />).lastFrame() ?? '';

describe('WorkCard (作品 end-card)', () => {
  it('surfaces the real (redacted) wish', () => {
    expect(f).toContain('愿望');
    expect(f).toContain('把这个项目从'); // prefix of SYNTH_WISH (card clips to 20)
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
