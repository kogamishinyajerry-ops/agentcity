// Parser edge cases — MCP routing, multi-tool turns (token stamped once),
// unpaired tools (crash-resistance), and multi-message cost accumulation.
import { describe, it, expect } from 'vitest';
import { parseTranscript } from './parse.ts';
import { jsonl, userPrompt, assistant, toolUse, toolResult } from './_testkit.ts';
import type { WorldEvent } from '../model/types.ts';

const kinds = (evs: WorldEvent[], k: string) => evs.filter((e) => e.kind === k);

describe('parse — MCP + web routing', () => {
  it('routes mcp__* tools to MCP_CALL/consulate and WebFetch to port', () => {
    const text = jsonl(
      userPrompt('use tools'),
      assistant([toolUse('mcp__github__list_repos', { owner: 'x' }, 't1')], { id: 'm1' }),
      toolResult('t1'),
      assistant([toolUse('WebFetch', { url: 'https://example.com' }, 't2')], { id: 'm2' }),
      toolResult('t2')
    );
    const s = parseTranscript(text, 'main');
    expect(kinds(s.events, 'MCP_CALL').length).toBe(1);
    const mcp = s.tools.find((t) => t.tool === 'mcp__github__list_repos');
    expect(mcp?.district).toBe('consulate');
    const web = s.tools.find((t) => t.tool === 'WebFetch');
    expect(web?.district).toBe('port');
  });
});

describe('parse — multi-tool turn stamps tokens on the first event only', () => {
  it('the first tool event carries the turn tokens; siblings do not (dedupe by msgid)', () => {
    const text = jsonl(
      userPrompt('do two things'),
      assistant(
        [toolUse('Read', { file_path: '/tmp/a.ts' }, 't1'), toolUse('Grep', { pattern: 'x' }, 't2')],
        { id: 'mMULTI', usage: { input_tokens: 9, cache_read_input_tokens: 5000 } }
      ),
      toolResult('t1'),
      toolResult('t2')
    );
    const s = parseTranscript(text, 'main');
    const read = kinds(s.events, 'FILE_READ')[0];
    const grep = kinds(s.events, 'CODE_SEARCH')[0];
    expect(read.tokens?.cacheRead).toBe(5000);
    expect(read.detail?.messageId).toBe('mMULTI');
    expect(grep.tokens).toBeUndefined(); // only the first event of the turn is stamped
    // exactly one event bears the messageId, so the context meter counts it once
    expect(s.events.filter((e) => e.detail?.messageId === 'mMULTI').length).toBe(1);
  });
});

describe('parse — unpaired tool_use (no result) is crash-resistant', () => {
  it('still emits the originating event and does not throw or fail', () => {
    const text = jsonl(
      userPrompt('run'),
      assistant([toolUse('Bash', { command: 'sleep 1' }, 'tNEVER')], { id: 'm1' })
      // no tool_result line
    );
    const s = parseTranscript(text, 'main');
    expect(kinds(s.events, 'SHELL_RUN').length).toBe(1);
    expect(kinds(s.events, 'SHELL_RUN')[0].isError).toBeFalsy();
    expect(s.signals.toolFails).toBe(0);
  });
});

describe('parse — cost accumulates across distinct message ids', () => {
  it('different message.id usages sum (only identical ids dedupe)', () => {
    const text = jsonl(
      userPrompt('long'),
      assistant([{ type: 'text', text: 'a' }], { id: 'mA', usage: { input_tokens: 100, output_tokens: 10 } }),
      assistant([{ type: 'text', text: 'b' }], { id: 'mB', usage: { input_tokens: 50, output_tokens: 5 } })
    );
    const s = parseTranscript(text, 'main');
    expect(s.signals.totals.input).toBe(150);
    expect(s.signals.totals.output).toBe(15);
  });
});

describe('parse — <synthetic> model usage is excluded from cost', () => {
  it('does not count usage from a <synthetic> assistant line', () => {
    const text = jsonl(
      userPrompt('go'),
      {
        type: 'assistant', uuid: 'a1', parentUuid: 'u0', timestamp: '2026-01-01T00:00:09Z',
        message: { id: 'mSYN', role: 'assistant', model: '<synthetic>', usage: { input_tokens: 999 }, content: [{ type: 'text', text: 'synthetic' }] },
      }
    );
    const s = parseTranscript(text, 'main');
    expect(s.signals.totals.input).toBe(0);
  });
});
