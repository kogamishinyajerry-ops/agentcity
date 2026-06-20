# AgentCity TUI — scripted demo (charmbracelet/vhs)
# Runs the REAL Ink app in a real PTY: load a transcript → scrub → jump to an
# error → autoplay → land on the inline finale. Re-record: `vhs docs/shots/tui-demo.tape`
Output docs/shots/tui-demo.gif
Output docs/shots/tui-demo.mp4

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 1100
Set Height 720
Set Padding 22
Set TypingSpeed 55ms

# quietly enter the project + clear the scrollback
Hide
Type "cd /Users/Zhuanz/Desktop/Claude-Inner-Map && clear"
Enter
Sleep 500ms
Show

# launch the TUI on a real run
Type "npx tsx src/tui/cli.tsx public/sample.jsonl"
Sleep 600ms
Enter
Sleep 3s

# scrub forward through the run (watch the bars + '此刻' grow)
Right@450ms 6
Sleep 1200ms

# the 'e' superpower — jump straight to the next real error
Type "e"
Sleep 1900ms
Type "e"
Sleep 1900ms

# hand it the wheel: autoplay
Space
Sleep 6500ms

# jump to the end → the inline 收工 finale unfurls
Type "G"
Sleep 4500ms

# quit
Type "q"
Sleep 700ms
