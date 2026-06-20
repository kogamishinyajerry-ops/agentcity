# Still capture of the 记忆清洗 narration beat (real colours, the ④ cutscene).
# Opens the replay parked at the compaction seq → screenshot. Re-shoot:
#   vhs docs/shots/cutscene-shot.tape
Output docs/shots/.cutscene.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 920
Set Height 660
Set Padding 24

Hide
Type "cd /Users/Zhuanz/Desktop/Claude-Inner-Map && clear"
Enter
Sleep 400ms
Show

Type "npx tsx src/tui/cli.tsx public/sample.jsonl 798"
Enter
Sleep 4s
Screenshot docs/shots/cutscene.png
Type "q"
Enter
Sleep 400ms
