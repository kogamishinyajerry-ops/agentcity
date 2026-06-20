// ============================================================================
// exportReplay — record a run's replay to a shareable gif + mp4 (needs VHS).
//   npx tsx src/export/exportReplay.ts <transcript> [out.gif]
// Generates a VHS tape (buildReplayTape) that drives the REAL interactive TUI,
// then runs VHS. 100% local: reads the transcript, writes media files, no net.
// ============================================================================
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { buildReplayTape } from './replayTape.ts';

const transcript = process.argv[2];
const out = process.argv[3] ?? 'agentcity-replay.gif';
if (!transcript) {
  console.error('usage: tsx src/export/exportReplay.ts <transcript> [out.gif]');
  process.exit(2);
}

// VHS resolves `Output` relative to where it runs (the project root) and rejects
// absolute paths — so keep the output relative. The tape `cd`s into cwd, so a
// relative transcript works in the recorded shell too.
const cwd = process.cwd();
const tape = buildReplayTape({
  transcript,
  out: relative(cwd, resolve(out)) || out,
  cwd,
});
const tapePath = resolve('docs/shots/.replay.tape');
writeFileSync(tapePath, tape);

const vhs = spawnSync('vhs', [tapePath], { stdio: 'inherit' });
if (vhs.error) {
  console.error(`\ntape written to ${tapePath}, but VHS is not on PATH.`);
  console.error('install VHS (https://github.com/charmbracelet/vhs), then run:');
  console.error(`  vhs ${tapePath}`);
  process.exit(1);
}
console.error(`✓ recorded ${out} (+ .mp4)`);
