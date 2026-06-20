// ============================================================================
// cli — the real interactive entry. Renders the live replay panel.
//   npx tsx src/tui/cli.tsx <parsed.json|session.jsonl>
//   A single input bar drives it: type a seq to jump, or card / export / play /
//   error / start / end / ? / q; ← → step. Optional [startSeq] opens the replay
//   parked at the first event ≥ that seq.
// ============================================================================
import { render } from 'ink';
import { loadSession } from './loadSession.ts';
import { ReplayApp } from './ReplayApp.tsx';

const path = process.argv[2];
const startSeq = process.argv[3] != null ? Number(process.argv[3]) : undefined;
if (!path) {
  console.error('usage: tsx src/tui/cli.tsx <parsed.json|session.jsonl> [startSeq]');
  process.exit(2);
}

const session = loadSession(path);
const startIdx =
  startSeq == null ? 0 : Math.max(0, session.events.findIndex((e) => e.seq >= startSeq));
render(<ReplayApp session={session} startIdx={startIdx} />);
