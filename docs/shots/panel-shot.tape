# Still capture of the polished instrument panel (end state, real colours).
# Runs the REAL Ink app in a PTY → jump to end → screenshot. Re-shoot:
#   vhs docs/shots/panel-shot.tape
Output docs/shots/.panel-after.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 920
Set Height 700
Set Padding 24

Hide
Type "cd /Users/Zhuanz/Desktop/Claude-Inner-Map && clear"
Enter
Sleep 400ms
Show

Type "npx tsx src/tui/cli.tsx public/sample.jsonl"
Enter
Sleep 4s
Type "end"
Enter
Sleep 1500ms
Screenshot docs/shots/panel-after.png
Type "q"
Enter
Sleep 400ms
