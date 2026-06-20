// ============================================================================
// preview — render the panel to a PLAIN STRING and print it (dev-only).
// ----------------------------------------------------------------------------
// Uses ink-testing-library so the frame is captured deterministically with no
// TTY and no ANSI — this is what closes the dev loop the 3D renderer broke:
// the agent can read the exact panel from stdout, no screenshot needed.
//   npx tsx src/tui/preview.tsx sample/parsed-sample.json [seq]
// ============================================================================
import { render } from 'ink-testing-library';
import { loadSession } from './loadSession.ts';
import { buildPanelModel } from './viewModel.ts';
import { App } from './App.tsx';

const path = process.argv[2];
const seqArg = process.argv[3] != null ? Number(process.argv[3]) : undefined;
if (!path) {
  console.error('usage: tsx src/tui/preview.tsx <parsed.json|session.jsonl> [seq]');
  process.exit(2);
}

const session = loadSession(path);
const model = buildPanelModel(session, seqArg);
const { lastFrame } = render(<App model={model} />);
console.log(lastFrame());
process.exit(0);
