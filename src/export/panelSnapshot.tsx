// ============================================================================
// panelSnapshot — render a session's TUI panel to a PLAIN-TEXT frame (ANSI
// stripped) so docs/ can show the instrument leak-free and WITHOUT a headless
// terminal recorder. vhs needs a browser to screenshot a real PTY (and won't run
// in every environment); this needs only Node + Ink. It drives the SAME
// ReplayApp the live CLI does (via ink-testing-library), so the snapshot can
// never drift from the real panel, and it defaults to the committed secret-free
// synthetic session — so the captured frame leaks nothing.
//   npm run --silent snapshot:panel [session.json|jsonl] [startSeq] > docs/shots/panel-sample.txt
// (--silent keeps npm's run banner out of the captured frame.)
// startSeq defaults to the LAST event (the finale, with the 一路走来 journey).
// ============================================================================
import { render } from 'ink-testing-library';
import { loadSession } from '../tui/loadSession.ts';
import { ReplayApp } from '../tui/ReplayApp.tsx';

const path = process.argv[2] ?? 'docs/shots/card-sample.session.json';
const session = loadSession(path);
const startSeq = process.argv[3] != null ? Number(process.argv[3]) : undefined;
const startIdx =
  startSeq == null
    ? session.events.length - 1
    : Math.max(0, session.events.findIndex((e) => e.seq >= startSeq));

const { lastFrame, unmount } = render(<ReplayApp session={session} startIdx={startIdx} />);
await new Promise((r) => setTimeout(r, 150)); // let mount effects settle
const frame = (lastFrame() ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); // strip ANSI
unmount();
process.stdout.write(frame.replace(/[ \t]+$/gm, '').trimEnd() + '\n');
process.exit(0);
