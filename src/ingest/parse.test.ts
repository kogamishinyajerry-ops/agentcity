// End-to-end parser tests over synthetic JSONL. These pin the honesty-critical
// contract (DATA-CONTRACT §4/§7/§9) AND regression-guard the three bugs fixed by
// hand this milestone: cost double-counting, tool-fail double-counting, and the
// per-turn token attribution the context meter reads.
import { describe, it, expect } from 'vitest';
import { parseTranscript } from './parse.ts';
import type { WorldEvent } from '../model/types.ts';

// --- tiny transcript builders ------------------------------------------------
let clock = 0;
function ts(): string {
  clock += 1000;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + clock).toISOString();
}
function jsonl(...lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n');
}
function userPrompt(text: string, parentUuid: string | null = null): object {
  return { type: 'user', uuid: `u${clock}`, parentUuid, timestamp: ts(), message: { role: 'user', content: text } };
}
function assistant(content: object[], opts: { id?: string; usage?: object } = {}): object {
  return {
    type: 'assistant',
    uuid: `a${clock}`,
    parentUuid: 'u0',
    timestamp: ts(),
    message: {
      id: opts.id ?? `m${clock}`,
      role: 'assistant',
      model: 'claude-opus-4-8',
      ...(opts.usage ? { usage: opts.usage } : {}),
      content,
    },
  };
}
function toolUse(name: string, input: object, id: string): object {
  return { type: 'tool_use', id, name, input };
}
function toolResult(toolUseId: string, opts: { isError?: boolean; content?: string } = {}): object {
  return {
    type: 'user',
    uuid: `r${clock}`,
    parentUuid: 'a0',
    timestamp: ts(),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, ...(opts.isError ? { is_error: true } : {}), content: opts.content ?? 'ok' }] },
  };
}
const kinds = (evs: WorldEvent[], k: string) => evs.filter((e) => e.kind === k);

describe('parse — cost dedupe by message.id (§7)', () => {
  it('counts identical message.id usage exactly once (no 2.4x inflation)', () => {
    const text = jsonl(
      userPrompt('hi'),
      assistant([{ type: 'text', text: 'first' }], { id: 'mDUP', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 500, cache_creation_input_tokens: 20 } }),
      assistant([{ type: 'text', text: 'dup line, same id' }], { id: 'mDUP', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 500, cache_creation_input_tokens: 20 } })
    );
    const s = parseTranscript(text, 'main');
    expect(s.signals.totals.input).toBe(100);
    expect(s.signals.totals.output).toBe(10);
    expect(s.signals.totals.cacheRead).toBe(500);
    // exactly one event carries that messageId (the non-deduped turn)
    const stamped = s.events.filter((e) => e.detail?.messageId === 'mDUP');
    expect(stamped.length).toBe(1);
  });
});

describe('parse — tool failure accounting (§4.1, regression: no double-count)', () => {
  it('one failed tool = one TOOL_FAIL + originating isError + toolFails===1', () => {
    const text = jsonl(
      userPrompt('run tests'),
      assistant([toolUse('Bash', { command: 'npm test' }, 'tu1')], { id: 'm1', usage: { output_tokens: 5 } }),
      toolResult('tu1', { isError: true, content: 'exit 1' })
    );
    const s = parseTranscript(text, 'main');
    expect(s.signals.toolFails).toBe(1);
    expect(kinds(s.events, 'TOOL_FAIL').length).toBe(1);
    const shell = kinds(s.events, 'SHELL_RUN');
    expect(shell.length).toBe(1);
    expect(shell[0].isError).toBe(true);
    // the canonical count and the visible TOOL_FAIL overlays agree (the fix)
    expect(kinds(s.events, 'TOOL_FAIL').length).toBe(s.signals.toolFails);
  });

  it('a successful tool produces no fail signal', () => {
    const text = jsonl(
      userPrompt('read a file'),
      assistant([toolUse('Read', { file_path: '/tmp/x.ts' }, 'tu2')], { id: 'm2' }),
      toolResult('tu2', { content: 'file body' })
    );
    const s = parseTranscript(text, 'main');
    expect(s.signals.toolFails).toBe(0);
    expect(kinds(s.events, 'TOOL_FAIL').length).toBe(0);
    expect(kinds(s.events, 'FILE_READ')[0].isError).toBeFalsy();
  });
});

describe('parse — per-turn token attribution (regression: meter plumbing)', () => {
  it('stamps the turn usage + messageId onto the first event of the turn', () => {
    const text = jsonl(
      userPrompt('go'),
      assistant([toolUse('Read', { file_path: '/tmp/a.ts' }, 'tu3')], { id: 'mTOK', usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 } })
    );
    const s = parseTranscript(text, 'main');
    const read = kinds(s.events, 'FILE_READ')[0];
    expect(read.tokens).toBeDefined();
    expect(read.tokens?.cacheRead).toBe(4000);
    expect(read.detail?.messageId).toBe('mTOK');
    expect(read.actorId).toBe('main'); // context-pressure series filters to main
  });
});

describe('parse — tool districts + file artifacts', () => {
  it('aggregates tool calls into districts', () => {
    const text = jsonl(
      userPrompt('work'),
      assistant([toolUse('Read', { file_path: '/tmp/a.ts' }, 't1')], { id: 'm1' }),
      toolResult('t1'),
      assistant([toolUse('Write', { file_path: '/tmp/b.ts' }, 't2')], { id: 'm2' }),
      toolResult('t2')
    );
    const s = parseTranscript(text, 'main');
    const read = s.tools.find((t) => t.tool === 'Read');
    const write = s.tools.find((t) => t.tool === 'Write');
    expect(read?.district).toBe('archive');
    expect(write?.district).toBe('workshop');
    expect(read?.callCount).toBe(1);
  });

  it('tracks file artifacts with read/edit/write counts and safe basenames', () => {
    const text = jsonl(
      userPrompt('edit'),
      assistant([toolUse('Read', { file_path: '/Users/alice/proj/auth.ts' }, 't1')], { id: 'm1' }),
      toolResult('t1'),
      assistant([toolUse('Edit', { file_path: '/Users/alice/proj/auth.ts' }, 't2')], { id: 'm2' }),
      toolResult('t2')
    );
    const s = parseTranscript(text, 'main');
    const f = s.files.find((x) => x.basename === 'auth.ts');
    expect(f).toBeDefined();
    expect(f?.reads).toBe(1);
    expect(f?.edits).toBe(1);
    expect(JSON.stringify(s.files)).not.toContain('alice'); // redacted at ingest
  });
});

describe('parse — redaction integration (§9)', () => {
  it('redacts usernames before anything reaches the event model', () => {
    const text = jsonl(
      userPrompt('look at /Users/alice/secret/path.ts'),
      assistant([toolUse('Bash', { command: 'cat /Users/alice/.ssh/id_rsa' }, 't1')], { id: 'm1' }),
      toolResult('t1')
    );
    const s = parseTranscript(text, 'main');
    expect(JSON.stringify(s.events)).not.toContain('alice');
    expect(s.signals).toBeDefined();
  });
});

describe('parse — compaction (§3)', () => {
  it('counts compact_boundary and emits a COMPACTION event', () => {
    const text = jsonl(
      userPrompt('long session'),
      assistant([{ type: 'text', text: 'working' }], { id: 'm1', usage: { input_tokens: 5 } }),
      { type: 'system', subtype: 'compact_boundary', uuid: 's1', timestamp: ts(), compactMetadata: { trigger: 'auto', preTokens: 150000 } }
    );
    const s = parseTranscript(text, 'main');
    expect(s.signals.compactions).toBe(1);
    expect(kinds(s.events, 'COMPACTION').length).toBe(1);
  });
});

describe('parse — crash resistance', () => {
  it('skips a malformed line, collects a warning, and parses the rest', () => {
    const text = [
      JSON.stringify(userPrompt('ok line')),
      '{ this is not valid json',
      JSON.stringify(assistant([{ type: 'text', text: 'still parsed' }], { id: 'm1' })),
    ].join('\n');
    const s = parseTranscript(text, 'main');
    expect(s.meta.warnings.some((w) => /malformed/i.test(w))).toBe(true);
    expect(kinds(s.events, 'AGENT_SAY').length).toBe(1); // the line after the bad one survived
  });

  it('never throws on an empty transcript', () => {
    const s = parseTranscript('', 'main');
    expect(s.events).toEqual([]);
    expect(s.actors).toEqual([]);
  });
});

describe('parse — meta', () => {
  it('derives start/end timestamps and is seq-ordered', () => {
    const text = jsonl(
      userPrompt('a'),
      assistant([{ type: 'text', text: 'b' }], { id: 'm1' })
    );
    const s = parseTranscript(text, 'main');
    expect(s.meta.startedAt).toBeTruthy();
    expect(s.meta.endedAt).toBeTruthy();
    const seqs = s.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});
