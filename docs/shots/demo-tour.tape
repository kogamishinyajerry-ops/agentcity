# AgentCity — feature tour (real PTY, real colours). Re-shoot:
#   vhs docs/shots/demo-tour.tape
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
Type "cd /Users/Zhuanz/Desktop/Claude-Inner-Map && clear"
Enter
Sleep 400ms
Show

# ── Scene A: the story ──────────────────────────────────────────
Type "npx tsx src/tui/cli.tsx public/sample.jsonl"
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
Type "npx tsx src/tui/cli.tsx public/sample.jsonl 798"
Enter
Sleep 4s
Type "q"
Enter
Sleep 400ms
