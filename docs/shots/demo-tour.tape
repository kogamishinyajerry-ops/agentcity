# AgentCity — feature tour (real PTY, real colours). Run from the repo root:
#   vhs docs/shots/demo-tour.tape
# Drives the committed SECRET-FREE synthetic session (docs/shots/card-sample.session.json),
# so the recording leaks no private prompt or filename. (vhs needs a headless browser; if
# it can't run, `npm run --silent snapshot:panel` captures the panel as text instead.)
# A single input bar drives it: type a seq to jump, or card / export / play / ? / q.
# Scene A — the story: open → play → 'error' fire beat → 'end' 收工 finale →
#           'card' 作品 card → 'export' SVG (✓ 已导出).
# Scene B — close-up of the 记忆清洗 cutscene (mauve 旁白) at the real compaction.
Output docs/shots/demo-tour.gif
Output docs/shots/demo-tour.mp4

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 920
Set Height 760
Set Padding 24

Hide
Type "clear"
Enter
Sleep 400ms
Show

# ── Scene A: the story ──────────────────────────────────────────
Type "npx tsx src/tui/cli.tsx docs/shots/card-sample.session.json"
Enter
Sleep 2.8s
Enter
Sleep 6s
Type "error"
Enter
Sleep 2.5s
Type "end"
Enter
Sleep 3s
Type "card"
Enter
Sleep 3s
Type "export"
Enter
Sleep 2.5s
Type "q"
Enter
Sleep 900ms

# ── Scene B: the 记忆清洗 cutscene, up close ─────────────────────
Type "npx tsx src/tui/cli.tsx docs/shots/card-sample.session.json 27"
Enter
Sleep 4s
Type "q"
Enter
Sleep 400ms
