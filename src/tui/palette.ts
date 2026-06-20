// ============================================================================
// palette — the TUI's semantic colour language, in one place (the design-token
// backbone, mirroring the web era's CSS tokens). Ink NAMED colours so the live
// panel ADAPTS to the user's terminal theme — the SVG poster controls its own
// dark canvas, a terminal does not, so the live instrument must not assume one.
// The one rule that never bends: FIRE is the only red.
// ============================================================================
export const INK = {
  human: 'cyan', // a human command landed (the 0 — "you")
  tool: 'yellow', // tool activity / the labor count (the hero)
  fire: 'red', // LIVE error ONLY — never anything else
  ok: 'green', // provenance / completion
  drama: 'magenta', // a ceremonial beat (memory compaction) — the only mauve
  dim: 'gray', // labels, scaffolding, recede
} as const;

// Hex twins (Catppuccin Mocha) the SVG poster paints on its own dark canvas —
// kept beside the named tokens so the two render seams document ONE intent.
export const HEX = {
  human: '#89dceb',
  tool: '#f9e2af',
  fire: '#f38ba8',
  ok: '#a6e3a1',
  drama: '#cba6f7',
  dim: '#6c7086',
  text: '#cdd6f4',
  bg: '#1e1e2e',
} as const;
