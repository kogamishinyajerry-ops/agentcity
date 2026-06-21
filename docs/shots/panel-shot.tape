# Still capture of the polished instrument panel (end state, real colours).
# Runs the REAL Ink app on the committed SECRET-FREE synthetic session → jump to
# end → screenshot. Run from the repo root: vhs docs/shots/panel-shot.tape
# (No vhs? `npm run --silent snapshot:panel > docs/shots/panel-sample.txt` for a text frame.)
Output docs/shots/.panel-after.gif

Set Shell "zsh"
Set Theme "Catppuccin Mocha"
Set FontSize 15
Set Width 920
Set Height 700
Set Padding 24

Hide
Type "clear"
Enter
Sleep 400ms
Show

Type "npx tsx src/tui/cli.tsx docs/shots/card-sample.session.json"
Enter
Sleep 4s
Type "end"
Enter
Sleep 1500ms
Screenshot docs/shots/panel-after.png
Type "q"
Enter
Sleep 400ms
