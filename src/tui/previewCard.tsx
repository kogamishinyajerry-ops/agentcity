// ============================================================================
// previewCard — render the 作品 card to a PLAIN STRING and print it (dev-only).
// Same render-to-string loop as preview.tsx, so the agent can read the exact
// card from stdout — no screenshot needed.
//   npx tsx src/tui/previewCard.tsx public/sample.jsonl
// ============================================================================
import { render } from 'ink-testing-library';
import { loadSession } from './loadSession.ts';
import { buildPanelModel } from './viewModel.ts';
import { WorkCard } from './WorkCard.tsx';

const path = process.argv[2];
if (!path) {
  console.error('usage: tsx src/tui/previewCard.tsx <parsed.json|session.jsonl>');
  process.exit(2);
}

const session = loadSession(path);
const model = buildPanelModel(session);
const { lastFrame } = render(<WorkCard model={model} />);
console.log(lastFrame());
process.exit(0);
