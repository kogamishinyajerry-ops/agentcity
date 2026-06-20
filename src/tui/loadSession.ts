// ============================================================================
// loadSession — node loader for the TUI. Accepts either a pre-parsed
// ParsedSession (.json) or a raw transcript (.jsonl), the latter run through the
// SAME ingest pipeline as src/ingest/cli.ts (parse → redact → subagent fs pass →
// finalize). Reusing that pipeline is the load-bearing claim of the pivot: the
// TUI eats the existing honest data layer, it does not re-implement it.
// ============================================================================
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { finalize, ingestLines, newIngestState } from '../ingest/parse.ts';
import { Redactor } from '../ingest/redact.ts';
import { iterLines } from '../ingest/cliutil.ts';
import { applyMetaLinks, attributeSubagents } from '../ingest/subagents.ts';
import type { ParsedSession } from '../model/types.ts';

export function loadSession(inputPath: string): ParsedSession {
  if (/\.json$/i.test(inputPath)) {
    return JSON.parse(readFileSync(inputPath, 'utf8')) as ParsedSession;
  }

  const sessionBase = basename(inputPath).replace(/\.jsonl$/i, '');
  const text = readFileSync(inputPath, 'utf8');
  const projectRoots = sniffProjectRoots(text);

  const state = newIngestState();
  state.sessionId = sessionBase;
  const redactor = new Redactor(state.redaction, projectRoots);

  ingestLines(state, text, basename(inputPath), 'main', redactor);

  const subDir = join(dirname(inputPath), sessionBase, 'subagents');
  const attribution = attributeSubagents(state, subDir, redactor);
  applyMetaLinks(state, attribution.metaByAgentId);

  return finalize(state);
}

/** First absolute `cwd` seen in the head of the transcript → redaction roots. */
function sniffProjectRoots(text: string): string[] {
  const roots = new Set<string>();
  for (const raw of iterLines(text.slice(0, 1 << 20))) {
    try {
      const o = JSON.parse(raw) as { cwd?: string };
      if (typeof o.cwd === 'string' && o.cwd.startsWith('/')) {
        roots.add(o.cwd);
        break;
      }
    } catch {
      /* skip malformed head lines */
    }
  }
  return [...roots];
}
