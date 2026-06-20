# The Claude-Code-style input bar in action: type a seq to jump, ? for help,
# a typed command. Real PTY, real colours. Re-shoot: vhs docs/shots/inputbar-shot.tape
Output docs/shots/inputbar.gif
Output docs/shots/inputbar.mp4

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 980
Set Height 720
Set Padding 22

Hide
Type "cd /Users/Zhuanz/Desktop/Claude-Inner-Map && clear"
Enter
Sleep 400ms
Show

Type "npx tsx src/tui/cli.tsx public/sample.jsonl"
Enter
Sleep 2.6s
Type "798"
Sleep 1.3s
Screenshot docs/shots/inputbar-typing.png
Enter
Sleep 2.6s
Screenshot docs/shots/inputbar-cutscene.png
Type "?"
Enter
Sleep 2.2s
Screenshot docs/shots/inputbar-help.png
Type "?"
Enter
Sleep 400ms
Type "card"
Enter
Sleep 2.4s
Type "q"
Enter
Sleep 400ms
