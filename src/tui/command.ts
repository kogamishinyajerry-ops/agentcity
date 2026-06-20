// ============================================================================
// command — pure parser for the input bar. Maps a typed line to a replay
// action (a number jumps to that seq; words/aliases map to discrete actions; a
// leading slash is optional, Claude-Code style). Empty Enter = play/pause.
// Pure + node-safe so the whole command surface unit-tests without Ink.
// ============================================================================
export type Command =
  | { type: 'jump'; seq: number }
  | { type: 'card' }
  | { type: 'export' }
  | { type: 'play' }
  | { type: 'error' }
  | { type: 'start' }
  | { type: 'end' }
  | { type: 'help' }
  | { type: 'quit' };

export function parseCommand(raw: string): Command | null {
  let s = raw.trim().toLowerCase();
  if (s.startsWith('/')) s = s.slice(1).trim();
  if (s === '') return { type: 'play' }; // bare Enter = play/pause
  if (/^\d+$/.test(s)) return { type: 'jump', seq: Number(s) };
  switch (s) {
    case 'card':
    case 'c':
      return { type: 'card' };
    case 'export':
    case 'svg':
    case 's':
      return { type: 'export' };
    case 'play':
    case 'pause':
    case 'p':
      return { type: 'play' };
    case 'error':
    case 'err':
    case 'e':
      return { type: 'error' };
    case 'start':
    case 'g':
      return { type: 'start' };
    case 'end':
      return { type: 'end' };
    case 'help':
    case '?':
    case 'h':
      return { type: 'help' };
    case 'quit':
    case 'exit':
    case 'q':
      return { type: 'quit' };
    default:
      return null;
  }
}
