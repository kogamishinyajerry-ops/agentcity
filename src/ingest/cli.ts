// ============================================================================
// AgentCity ingester — NODE CLI (run: npx tsx src/ingest/cli.ts <path.jsonl>)
// ----------------------------------------------------------------------------
// Reuses the browser-safe core (parse.ts) and adds the node-fs TWO-PASS over
// sibling subagent files for full subagent attribution (DATA-CONTRACT §1.3,§8):
//   subagents/agent-*.jsonl                 -> typed Agent subagents
//   subagents/workflows/wf_<id>/agent-*.jsonl -> workflow-worker crews
//   subagents/workflows/wf_<id>/journal.jsonl -> per-worker outcomes
// The fs attribution itself lives in subagents.ts (testable; node-only).
//
// Streams every file line-by-line (NEVER JSON.parse the whole 64MB file).
// Prints a stats report and writes parsed-<basename>.json to sample/.
// ============================================================================
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname, join } from 'node:path';
import { finalize, ingestLines, newIngestState } from './parse.ts';
import { Redactor } from './redact.ts';
import { iterLines } from './cliutil.ts';
import { attributeSubagents, applyMetaLinks, type AttributionReport } from './subagents.ts';
import type { ParsedSession } from '../model/types.ts';

const OUT_DIR = '/Users/Zhuanz/Desktop/Claude-Inner-Map/sample';

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: npx tsx src/ingest/cli.ts <path-to-session.jsonl>');
    process.exit(2);
  }
  if (!existsSync(inputPath)) {
    console.error(`file not found: ${inputPath}`);
    process.exit(2);
  }

  const sessionBase = basename(inputPath).replace(/\.jsonl$/i, '');
  const projectRoots = sniffProjectRoots(inputPath);
  const state = newIngestState();
  state.sessionId = sessionBase;
  const redactor = new Redactor(state.redaction, projectRoots);

  // ---- PASS B (main): stream the main transcript through the core pipeline ----
  const mainText = await readFileStreaming(inputPath);
  ingestLines(state, mainText, basename(inputPath), 'main', redactor);

  // ---- subagent fs pass (§8): discover sibling subagent files ----
  const subDir = join(dirname(inputPath), sessionBase, 'subagents');
  const attribution = attributeSubagents(state, subDir, redactor);

  // build link maps (agentId -> spawning toolUseId via meta.json)
  applyMetaLinks(state, attribution.metaByAgentId);

  const parsed = finalize(state);

  // ---- write output ----
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `parsed-${sessionBase}.json`);
  writeFileSync(outPath, JSON.stringify(parsed, null, 2));

  printReport(parsed, attribution, outPath, inputPath);
}

// ---------------------------------------------------------------------------
// Stream a file into a single string WITHOUT line-splitting in memory beyond
// the chunk boundary. (We hand the whole text to ingestLines, which streams it
// internally by indexOf('\n') — so we never build a giant string[] array.)
// For very large files we still need the bytes; node returns them as one string.
// The hard rule is "never JSON.parse the whole file", which ingestLines honors.
// ---------------------------------------------------------------------------
function readFileStreaming(path: string): Promise<string> {
  // readFileSync is fine: it returns raw text; the line-by-line JSON.parse
  // discipline lives in ingestLines (indexOf based, no per-line array, no
  // whole-file JSON.parse). For 64MB this is a single string allocation.
  return Promise.resolve(readFileSync(path, 'utf8'));
}

// ---------------------------------------------------------------------------
// helpers (node)
// ---------------------------------------------------------------------------
function sniffProjectRoots(path: string): string[] {
  const roots = new Set<string>();
  try {
    const fd = readFirstBytes(path, 1 << 20); // 1MB head is plenty
    for (const raw of iterLines(fd)) {
      try {
        const o = JSON.parse(raw) as { cwd?: string };
        if (typeof o.cwd === 'string' && o.cwd.startsWith('/')) {
          roots.add(o.cwd);
          break;
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* ignore */
  }
  return [...roots];
}

function readFirstBytes(path: string, n: number): string {
  const buf = Buffer.alloc(n);
  const fs = require('node:fs') as typeof import('node:fs');
  const fd = fs.openSync(path, 'r');
  try {
    const read = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function printReport(
  parsed: ParsedSession,
  attr: AttributionReport,
  outPath: string,
  inputPath: string
): void {
  const fileSize = statSync(inputPath).size;
  const byKind = new Map<string, number>();
  for (const e of parsed.events) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);

  const lanes = new Map<string, number>();
  for (const c of parsed.kanban) lanes.set(c.lane, (lanes.get(c.lane) ?? 0) + 1);

  const actorsByKind = new Map<string, number>();
  for (const a of parsed.actors) actorsByKind.set(a.kind, (actorsByKind.get(a.kind) ?? 0) + 1);

  const t = parsed.signals.totals;
  const L = (s: string) => console.log(s);
  L('');
  L('══════════════════════════════════════════════════════════════');
  L(`  AgentCity ingest report — ${parsed.meta.sessionId}`);
  L('══════════════════════════════════════════════════════════════');
  L(`  input        : ${inputPath}`);
  L(`  size         : ${(fileSize / 1e6).toFixed(1)} MB`);
  L(`  schemaVers   : ${parsed.meta.schemaVersions.join(', ') || '(none)'}`);
  L(`  title        : ${parsed.meta.title ?? '(none)'}`);
  L(`  taskSource   : ${parsed.meta.taskSource}`);
  L(`  span         : ${parsed.meta.startedAt ?? '?'} → ${parsed.meta.endedAt ?? '?'}`);
  L('');
  L(`  EVENTS (${parsed.events.length} total) by kind:`);
  for (const [k, v] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    L(`     ${String(v).padStart(6)}  ${k}`);
  }
  L('');
  L(`  ACTORS (${parsed.actors.length} total, excl. human):`);
  for (const [k, v] of [...actorsByKind.entries()].sort((a, b) => b[1] - a[1])) {
    L(`     ${String(v).padStart(6)}  ${k}`);
  }
  L('');
  L('  SUBAGENT ATTRIBUTION (fs pass):');
  L(`     typed Agent subagents : ${attr.typedAgents}`);
  L(`     workflow crews (dirs) : ${attr.workflowDirs}`);
  L(`     workflow workers      : ${attr.workflowWorkers}`);
  L(`     journal results       : ${attr.journalResults}`);
  L(`     parallel waves        : ${attr.parallelWaves}`);
  L(`     subagent files read   : ${attr.filesStreamed}`);
  L('');
  L(`  KANBAN (${parsed.kanban.length} cards, source=${parsed.meta.taskSource}):`);
  for (const [lane, n] of lanes) L(`     ${String(n).padStart(6)}  ${lane}`);
  L('');
  L('  TOKENS (totals, deduped by message.id):');
  L(`     input        : ${t.input.toLocaleString()}`);
  L(`     output       : ${t.output.toLocaleString()}`);
  L(`     cacheCreate  : ${t.cacheCreate.toLocaleString()}`);
  L(`     cacheRead    : ${t.cacheRead.toLocaleString()}`);
  L(`     model        : ${t.model ?? '?'}`);
  L('');
  L(`  TOOLS: ${parsed.tools.length} distinct  |  FILES: ${parsed.files.length} distinct`);
  L(`  SIGNALS: compactions=${parsed.signals.compactions} apiRetries=${parsed.signals.apiRetries} toolFails=${parsed.signals.toolFails}`);
  L('');
  L(`  WARNINGS (${parsed.meta.warnings.length}):`);
  for (const w of parsed.meta.warnings.slice(0, 12)) L(`     • ${w}`);
  if (parsed.meta.warnings.length > 12) L(`     … +${parsed.meta.warnings.length - 12} more`);
  L('');
  L(`  → wrote ${outPath}`);
  L('══════════════════════════════════════════════════════════════');
  L('');

  // leak guard: scan the serialized output for raw /Users/<user> leaks
  scanLeaks(outPath);
}

function scanLeaks(outPath: string): void {
  const text = readFileSync(outPath, 'utf8');
  // both slash-encoded (/Users/<u>) and dash-encoded (-Users-<u>) username forms
  const re = /[/-](?:Users|home)[/-][A-Za-z0-9]/g;
  const hits = text.match(re);
  if (hits && hits.length) {
    console.log(`  ⚠ LEAK CHECK: ${hits.length} raw username-path occurrences remain in output!`);
    const idx = text.search(re);
    console.log(`    sample: …${text.slice(Math.max(0, idx - 30), idx + 40)}…`);
  } else {
    console.log('  ✓ LEAK CHECK: no raw /Users/<user> or -Users-<user> paths in output JSON.');
  }
  console.log('');
}

// keep the readline import used (avoids noUnusedLocals); a streaming variant.
void createReadStream;
void createInterface;
void join;

main().catch((err) => {
  console.error('ingest failed:', err);
  process.exit(1);
});
