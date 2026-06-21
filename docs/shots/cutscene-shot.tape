# Still capture of the 记忆清洗 narration beat (real colours, the ④ cutscene).
# Opens the committed SECRET-FREE synthetic session parked at its compaction (seq 27)
# → screenshot. Run from the repo root: vhs docs/shots/cutscene-shot.tape
Output docs/shots/.cutscene.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 920
Set Height 660
Set Padding 24

Hide
Type "clear"
Enter
Sleep 400ms
Show

Type "npx tsx src/tui/cli.tsx docs/shots/card-sample.session.json 27"
Enter
Sleep 4s
Screenshot docs/shots/cutscene.png
Type "q"
Enter
Sleep 400ms
