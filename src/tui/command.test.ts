import { describe, expect, it } from 'vitest';
import { parseCommand } from './command.ts';

describe('parseCommand', () => {
  it('maps a number to a seq jump', () => {
    expect(parseCommand('798')).toEqual({ type: 'jump', seq: 798 });
    expect(parseCommand('  012 ')).toEqual({ type: 'jump', seq: 12 });
  });

  it('maps words + single-letter aliases to actions', () => {
    expect(parseCommand('card')).toEqual({ type: 'card' });
    expect(parseCommand('c')).toEqual({ type: 'card' });
    expect(parseCommand('export')).toEqual({ type: 'export' });
    expect(parseCommand('play')).toEqual({ type: 'play' });
    expect(parseCommand('error')).toEqual({ type: 'error' });
    expect(parseCommand('end')).toEqual({ type: 'end' });
    expect(parseCommand('quit')).toEqual({ type: 'quit' });
    expect(parseCommand('?')).toEqual({ type: 'help' });
  });

  it('is case-insensitive and tolerates a leading slash', () => {
    expect(parseCommand('CARD')).toEqual({ type: 'card' });
    expect(parseCommand('/export')).toEqual({ type: 'export' });
  });

  it('treats empty input as play/pause, unknown as null', () => {
    expect(parseCommand('')).toEqual({ type: 'play' });
    expect(parseCommand('   ')).toEqual({ type: 'play' });
    expect(parseCommand('frobnicate')).toBeNull();
  });
});
