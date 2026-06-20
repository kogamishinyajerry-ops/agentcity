// Ink mount smoke — proves the interactive shell compiles + renders against the
// real sample (panel + control line). Key→action LOGIC is covered purely in
// replay.test.ts (keyToAction); only the 3-line useInput/exit glue is untested,
// by design — ink-testing-library's no-TTY stdin can't reliably drive raw-mode
// input, the same headless limit the web renderer hit (but here the logic is pure).
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ParsedSession } from '../model/types.ts';
import { ReplayApp } from './ReplayApp.tsx';

const session = JSON.parse(
  readFileSync('sample/parsed-sample.json', 'utf8')
) as ParsedSession;

describe('ReplayApp (ink mount)', () => {
  it('mounts with the panel + the single input bar', () => {
    const { lastFrame, unmount } = render(<ReplayApp session={session} startIdx={50} />);
    const f = lastFrame() ?? '';
    expect(f).toContain('WORKLOAD');
    expect(f).toContain('›'); // the input-bar prompt
    unmount();
  });
});
