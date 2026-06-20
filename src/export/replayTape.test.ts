import { describe, expect, it } from 'vitest';
import { buildReplayTape } from './replayTape.ts';

describe('buildReplayTape', () => {
  const tape = buildReplayTape({
    transcript: '/x/run.jsonl',
    out: '/x/out.gif',
    cwd: '/proj',
  });

  it('targets the given transcript + emits gif and mp4', () => {
    expect(tape).toContain('Output /x/out.gif');
    expect(tape).toContain('Output /x/out.mp4');
    expect(tape).toContain('src/tui/cli.tsx /x/run.jsonl');
  });

  it('drives the showcase: autoplay → error beats → finale → 作品 card → quit', () => {
    expect(tape).toContain('Enter'); // bare Enter = play/pause
    expect(tape).toContain('Type "error"');
    expect(tape).toContain('Type "end"');
    expect(tape).toContain('Type "card"');
    expect(tape).toContain('Type "q"');
  });

  it('honours a custom autoplay window', () => {
    const t = buildReplayTape({ transcript: '/a', out: '/b.gif', cwd: '/c', autoplayMs: 4000 });
    expect(t).toContain('Sleep 4000ms');
  });
});
