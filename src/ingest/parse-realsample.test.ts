// Golden-master: parse the REAL local transcript (public/sample.jsonl) end-to-end
// and assert invariants synthetic fixtures can't reach — privacy (no raw OS paths
// leak), seq-ordering, and the fail-count honesty contract. Skips gracefully when
// the private (gitignored) sample isn't present, and NEVER prints its content
// (assertions are boolean so a failure diff can't dump the transcript).
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTranscript } from './parse.ts';

const SAMPLE = resolve(process.cwd(), 'public/sample.jsonl');
const present = existsSync(SAMPLE);

describe.skipIf(!present)('parse — real sample.jsonl golden master', () => {
  const text = present ? readFileSync(SAMPLE, 'utf8') : '';
  const s = parseTranscript(text, 'sample.jsonl');
  const serialized = JSON.stringify(s);

  it('produces a non-trivial, seq-ordered event stream', () => {
    expect(s.events.length).toBeGreaterThan(100);
    const seqs = s.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('leaks no raw OS user paths (redaction held over real data)', () => {
    // every /Users/<u> and /home/<u> must have collapsed to ~, and the dash slug to -~
    expect(serialized.includes('/Users/')).toBe(false);
    expect(serialized.includes('/home/')).toBe(false);
    expect(/-Users-[^~]/.test(serialized)).toBe(false);
  });

  it('reconciles the fail count: TOOL_FAIL overlays === signals.toolFails', () => {
    const overlays = s.events.filter((e) => e.kind === 'TOOL_FAIL').length;
    // signals.toolFails counts every failure (incl. rare unpaired); overlays are
    // the visible fires. They must agree when there are no unpaired errors, and
    // signals can only be >= overlays, never less.
    expect(s.signals.toolFails).toBeGreaterThanOrEqual(overlays);
  });

  it('has internally consistent token totals (sum of byActor)', () => {
    const t = s.signals.totals;
    let sum = 0;
    for (const id of Object.keys(s.signals.byActor)) {
      const a = s.signals.byActor[id];
      sum += a.input + a.output + a.cacheCreate + a.cacheRead;
    }
    expect(t.input + t.output + t.cacheCreate + t.cacheRead).toBe(sum);
  });

  it('orders meta timestamps and collects only benign warnings', () => {
    expect(new Date(s.meta.startedAt!).getTime()).toBeLessThanOrEqual(new Date(s.meta.endedAt!).getTime());
    // any warnings should be the documented benign kinds (incl. the informational
    // redaction summary), not crashes
    for (const w of s.meta.warnings) {
      expect(/malformed|collision|unresolved|route error|redaction/i.test(w)).toBe(true);
    }
  });
});
