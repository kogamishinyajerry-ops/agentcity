// Dev-only: render the INTERACTIVE shell's frame (paused at startIdx) to a plain
// string, so the agent can read the panel + control line without a TTY.
//   npx tsx src/tui/previewReplay.tsx sample/parsed-sample.json [startIdx]
import { render } from 'ink-testing-library';
import { loadSession } from './loadSession.ts';
import { ReplayApp } from './ReplayApp.tsx';

const path = process.argv[2];
const startIdx = process.argv[3] != null ? Number(process.argv[3]) : 0;
if (!path) {
  console.error('usage: tsx src/tui/previewReplay.tsx <file> [startIdx]');
  process.exit(2);
}
const session = loadSession(path);
const { lastFrame } = render(<ReplayApp session={session} startIdx={startIdx} />);
console.log(lastFrame());
process.exit(0);
