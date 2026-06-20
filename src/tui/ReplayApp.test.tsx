// Ink mount smoke — proves the interactive shell compiles + renders against the
// real sample (the panel + the single input bar). The command parser is covered
// in command.test.ts and the playhead reducer in replay.test.ts; only the thin
// useInput/exit glue is untested, by design — ink-testing-library's no-TTY stdin
// can't reliably drive raw-mode input (the logic it routes to is pure + covered).
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { ParsedSession } from '../model/types.ts';
import { ReplayApp } from './ReplayApp.tsx';

// Fixture is gitignored (real transcript) → skip cleanly when absent (fresh clone).
const SAMPLE = 'sample/parsed-sample.json';
const present = existsSync(SAMPLE);
const session = present
  ? (JSON.parse(readFileSync(SAMPLE, 'utf8')) as ParsedSession)
  : (null as unknown as ParsedSession);

describe.skipIf(!present)('ReplayApp (ink mount)', () => {
  it('mounts with the panel + the single input bar', () => {
    const { lastFrame, unmount } = render(<ReplayApp session={session} startIdx={50} />);
    const f = lastFrame() ?? '';
    expect(f).toContain('WORKLOAD');
    expect(f).toContain('›'); // the input-bar prompt
    unmount();
  });
});
