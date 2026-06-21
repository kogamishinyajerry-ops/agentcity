# Refined input bar: 78-col content column, justified status, width-aware wish
# clip (CJK fits the bar). Drives the committed SECRET-FREE synthetic session.
# Run from the repo root: vhs docs/shots/inputbar-v2-shot.tape
Output docs/shots/inputbar-v2.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 900
Set Height 760
Set Padding 22

Hide
Type "clear"
Enter
Sleep 400ms
Show

Type "npx tsx src/tui/cli.tsx docs/shots/card-sample.session.json 13"
Enter
Sleep 2.6s
Screenshot docs/shots/inputbar-v2-panel.png
Type "27"
Sleep 1s
Screenshot docs/shots/inputbar-v2-typing.png
Enter
Sleep 1.5s
Type "?"
Enter
Sleep 1.6s
Screenshot docs/shots/inputbar-v2-help.png
Type "?"
Enter
Sleep 300ms
Type "q"
Enter
Sleep 400ms
