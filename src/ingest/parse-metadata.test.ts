// Metadata + system-line routing (§2/§5). These exercise the non-threaded lines
// real transcripts carry — permission modes, api retries, model fallback, titles,
// PR links, file snapshots — and the never-throw contract on unknown types.
import { describe, it, expect } from 'vitest';
import { parseTranscript } from './parse.ts';
import { jsonl, userPrompt, ts } from './_testkit.ts';
import type { WorldEvent } from '../model/types.ts';

const kinds = (evs: WorldEvent[], k: string) => evs.filter((e) => e.kind === k);

describe('parse — permission mode changes (§5)', () => {
  it('emits MODE_CHANGE only on an actual change and records the timeline', () => {
    const text = jsonl(
      userPrompt('start'),
      { type: 'permission-mode', permissionMode: 'plan', timestamp: ts() },
      { type: 'permission-mode', permissionMode: 'plan', timestamp: ts() }, // no change
      { type: 'permission-mode', permissionMode: 'default', timestamp: ts() }
    );
    const s = parseTranscript(text, 'main');
    expect(kinds(s.events, 'MODE_CHANGE').length).toBe(2);
    expect(s.signals.permissionModeTimeline.map((m) => m.mode)).toEqual(['plan', 'default']);
  });
});

describe('parse — ai-title sets the session title (redacted)', () => {
  it('captures the first title and emits AI_TITLE', () => {
    const text = jsonl(
      userPrompt('go'),
      { type: 'ai-title', slug: 'wire-up-auth', timestamp: ts() }
    );
    const s = parseTranscript(text, 'main');
    expect(kinds(s.events, 'AI_TITLE').length).toBe(1);
    expect(s.meta.title).toBe('wire-up-auth');
  });

  it('redacts a path-bearing slug in the EVENT label + targetRef, not just meta.title', () => {
    // a title slug can embed a path fragment — it must be redacted at the source,
    // in the event the inspector could render, not only in meta.title.
    const text = jsonl(
      userPrompt('go'),
      { type: 'ai-title', slug: 'work in /Users/alice/secret', timestamp: ts() }
    );
    const s = parseTranscript(text, 'main');
    expect(JSON.stringify(s)).not.toContain('alice');
    const title = kinds(s.events, 'AI_TITLE')[0];
    expect(title.label).not.toContain('alice');
    expect((title.targetRef ?? '')).not.toContain('alice');
    expect(s.meta.title ?? '').not.toContain('alice');
  });
});

describe('parse — system subtypes (§5)', () => {
  it('api_error → API_RETRY + apiRetries signal', () => {
    const text = jsonl(
      userPrompt('go'),
      { type: 'system', subtype: 'api_error', timestamp: ts(), retryAttempt: 1, maxRetries: 3, retryInMs: 2000 }
    );
    const s = parseTranscript(text, 'main');
    expect(kinds(s.events, 'API_RETRY').length).toBe(1);
    expect(s.signals.apiRetries).toBe(1);
  });

  it('model_refusal_fallback → MODEL_SWITCH', () => {
    const text = jsonl(
      userPrompt('go'),
      { type: 'system', subtype: 'model_refusal_fallback', timestamp: ts(), originalModel: 'claude-fable-5', fallbackModel: 'claude-opus-4-8' }
    );
    const s = parseTranscript(text, 'main');
    expect(kinds(s.events, 'MODEL_SWITCH').length).toBe(1);
  });
});

describe('parse — pr-link + file-history-snapshot', () => {
  it('emits PR_LINKED and FILE_SNAPSHOT', () => {
    const text = jsonl(
      userPrompt('go'),
      { type: 'pr-link', timestamp: ts() },
      { type: 'file-history-snapshot', messageId: 'snap1', timestamp: ts() }
    );
    const s = parseTranscript(text, 'main');
    expect(kinds(s.events, 'PR_LINKED').length).toBe(1);
    expect(kinds(s.events, 'FILE_SNAPSHOT').length).toBe(1);
  });
});

describe('parse — unknown line type never throws (crash-resistance)', () => {
  it('emits a derived GENERIC_TOOL and keeps going', () => {
    const text = jsonl(
      userPrompt('go'),
      { type: 'totally-unknown-xyz', timestamp: ts() },
      userPrompt('after')
    );
    const s = parseTranscript(text, 'main');
    const generic = kinds(s.events, 'GENERIC_TOOL');
    expect(generic.length).toBe(1);
    expect(generic[0].truth).toBe('derived');
    expect(kinds(s.events, 'USER_PROMPT').length).toBe(2); // survived the unknown line
  });
});
