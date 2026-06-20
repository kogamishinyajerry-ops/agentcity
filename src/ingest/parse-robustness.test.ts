// Real-world transcript resilience. A user drops THEIR file — which may come from
// a session that's still running or was killed (truncated final line), exported on
// Windows (CRLF), saved with a BOM, resumed mid-conversation, or that only ever
// emitted system lines. The parser must degrade gracefully: never throw, collect a
// warning, and keep every well-formed line. These pin that contract.
import { describe, it, expect } from 'vitest';
import { parseTranscript } from './parse.ts';
import { jsonl, userPrompt, assistant, toolUse, toolResult, ts } from './_testkit.ts';
import type { WorldEvent } from '../model/types.ts';

const kinds = (evs: WorldEvent[], k: string) => evs.filter((e) => e.kind === k);

describe('parse robustness — truncated final line (live / killed session)', () => {
  it('parses every complete line, warns on the partial tail, never throws', () => {
    const good = jsonl(
      userPrompt('start the work'),
      assistant([{ type: 'text', text: 'on it' }], { id: 'm1', usage: { output_tokens: 5 } })
    );
    // a session killed mid-write: the last line is cut off (no closing brace, no \n)
    const text = good + '\n' + '{"type":"assistant","message":{"id":"m2","content":[{"type":"text","text":"cut o';
    const s = parseTranscript(text, 'main');
    expect(kinds(s.events, 'AGENT_SAY').length).toBe(1); // the complete turn survived
    expect(s.meta.warnings.some((w) => /malformed/i.test(w))).toBe(true);
  });
});

describe('parse robustness — Windows CRLF line endings', () => {
  it('handles \\r\\n exactly like \\n (trim strips the carriage return)', () => {
    const text = [
      JSON.stringify(userPrompt('windows export')),
      JSON.stringify(assistant([toolUse('Read', { file_path: '/tmp/a.ts' }, 't1')], { id: 'm1' })),
      JSON.stringify(toolResult('t1', { content: 'ok' })),
    ].join('\r\n');
    const s = parseTranscript(text, 'main');
    expect(kinds(s.events, 'FILE_READ').length).toBe(1);
    expect(s.meta.warnings.filter((w) => /malformed/i.test(w))).toEqual([]); // CRLF is NOT malformed
  });
});

describe('parse robustness — UTF-8 BOM prefix', () => {
  it('a leading BOM on the first line does not corrupt parsing', () => {
    const text = '﻿' + jsonl(
      userPrompt('bom prefixed'),
      assistant([{ type: 'text', text: 'fine' }], { id: 'm1' })
    );
    const s = parseTranscript(text, 'main');
    expect(kinds(s.events, 'USER_PROMPT').length).toBe(1);
    expect(kinds(s.events, 'AGENT_SAY').length).toBe(1);
  });
});

describe('parse robustness — system-only transcript (no conversation)', () => {
  it('produces the system events with no phantom conversation and coherent signals', () => {
    const text = jsonl(
      { type: 'permission-mode', permissionMode: 'plan', timestamp: ts() },
      { type: 'system', subtype: 'api_error', timestamp: ts(), retryAttempt: 1 },
      { type: 'system', subtype: 'compact_boundary', uuid: 'c1', timestamp: ts(), compactMetadata: {} }
    );
    const s = parseTranscript(text, 'main');
    expect(kinds(s.events, 'USER_PROMPT').length).toBe(0); // no invented conversation
    expect(kinds(s.events, 'AGENT_SAY').length).toBe(0);
    expect(s.signals.apiRetries).toBe(1);
    expect(s.signals.compactions).toBe(1);
    expect(s.kanban).toEqual([]); // no board, not a crash
  });
});

describe('parse robustness — non-object JSON lines (null / number / array / string)', () => {
  it('skips them without throwing and keeps the surrounding real lines', () => {
    const text = [
      JSON.stringify(userPrompt('before junk')),
      'null',
      '42',
      '[1,2,3]',
      '"a bare string"',
      JSON.stringify(assistant([{ type: 'text', text: 'after junk' }], { id: 'm1' })),
    ].join('\n');
    const s = parseTranscript(text, 'main');
    // both real lines survived the junk between them
    expect(kinds(s.events, 'USER_PROMPT').length).toBe(1);
    expect(kinds(s.events, 'AGENT_SAY').length).toBe(1);
  });
});

describe('parse robustness — blank lines and trailing newlines', () => {
  it('skips blank/whitespace lines and emits no phantom events', () => {
    const text =
      '\n\n   \n' +
      JSON.stringify(userPrompt('real')) +
      '\n\n  \n' +
      JSON.stringify(assistant([{ type: 'text', text: 'real too' }], { id: 'm1' })) +
      '\n\n';
    const s = parseTranscript(text, 'main');
    expect(s.events.length).toBeGreaterThan(0);
    // exactly the two real lines drove events; no blank line produced one
    expect(kinds(s.events, 'USER_PROMPT').length).toBe(1);
    expect(kinds(s.events, 'AGENT_SAY').length).toBe(1);
    const seqs = s.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});
