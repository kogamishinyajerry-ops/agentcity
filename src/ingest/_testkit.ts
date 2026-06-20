// Shared synthetic-transcript builders for the ingest tests. NOT a *.test.ts so
// vitest won't run it as a suite, and it's never imported by the app so it never
// reaches the bundle. Mirrors the real Claude Code JSONL line shapes (DATA-CONTRACT §2).
let clock = 0;
export function ts(): string {
  clock += 1000;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + clock).toISOString();
}
export function jsonl(...lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n');
}
export function userPrompt(text: string, parentUuid: string | null = null): object {
  return { type: 'user', uuid: `u${clock}`, parentUuid, timestamp: ts(), message: { role: 'user', content: text } };
}
export function assistant(content: object[], opts: { id?: string; usage?: object } = {}): object {
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
export function toolUse(name: string, input: object, id: string): object {
  return { type: 'tool_use', id, name, input };
}
/** A user line carrying a tool_result, with an optional line-level toolUseResult
 *  (where subagent/task metadata actually lives in real transcripts). */
export function toolResult(
  toolUseId: string,
  opts: { isError?: boolean; content?: string; toolUseResult?: unknown } = {}
): object {
  return {
    type: 'user',
    uuid: `r${clock}`,
    parentUuid: 'a0',
    timestamp: ts(),
    ...(opts.toolUseResult !== undefined ? { toolUseResult: opts.toolUseResult } : {}),
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, ...(opts.isError ? { is_error: true } : {}), content: opts.content ?? 'ok' }],
    },
  };
}
