# AgentCity

Turn a real Claude Code session transcript into a **living, replayable instrument panel in
your terminal** — so you can *understand* (and keep) an agent run by watching it, not by
reading raw logs.

Point it at a `.jsonl` transcript and the run becomes a single Ink TUI panel:

- the model's labor as a **WORKLOAD bar chart** — Workshop = `Write`/`Edit`, Bash Yard = `Bash`,
  Archive = `Read`/`Grep`, Work Orders = the run's real TodoWrite kanban, Town Square = your
  messages, Crew Camp = subagents, Consulate = MCP, Customs = permission gates;
- a **`此刻` / `旁白`** pair — what's literally happening now, plus a one-line narration of the
  story beat (on a **compaction** the 旁白 turns violet: the city's memory being wiped and
  rebuilt, marked honestly as it happens);
- a live error count that **catches fire** (🔥) when a tool fails;
- a one-key **作品 card** + SVG / GIF export, so a run becomes a shareable artifact.

A single **input bar** drives everything — type a `seq` to jump, or `card` / `export` / `play`
/ `error` / `?` / `q`; `← →` step. No menus, no shortcut clutter.

Every number traces to a real event in the JSONL — counts are seq-accurate to the playhead and
nothing is faked or inferred. **Red is reserved strictly for fire/error.**

## Run it

```bash
npm install
npm run verify          # typecheck + the full test suite (the quality gate)

# replay your own run interactively (or append a seq to open parked at that moment):
npx tsx src/tui/cli.tsx ~/.claude/projects/<project>/<sessionId>.jsonl
npx tsx src/tui/cli.tsx ~/.claude/projects/<project>/<sessionId>.jsonl 798

# turn a run into a shareable artifact:
npm run export:card   <transcript> [out.svg]    # a static SVG poster
npm run export:replay <transcript> [out.gif]    # an animated gif + mp4 trailer
```

Inside the replay the input bar takes a **seq number** (jump there), `card` (the 作品 card),
`export` (write the SVG), `play` (autoplay), `error` (next failure), `start` / `end`, `?`
(commands), `q` (quit); `← →` step. See `docs/shots/` for recordings.

Transcripts live at `~/.claude/projects/<project>/<sessionId>.jsonl`. `public/sample.jsonl` is a
real local transcript used as the dev fixture — it is **gitignored and never shipped**.

## Privacy (non-negotiable)

- **100% local, zero network egress.** It reads a local file and renders to your terminal —
  nothing is sent anywhere.
- **Default-summary only.** File contents, Bash output, prompts, and base64 images never
  surface — only basenames, counts, and first-lines.
- **Redaction at ingest.** OS usernames (both `/Users/<u>` and the dash-encoded project-slug
  form), emails, and secret-shaped tokens are masked in the parser before anything is rendered.
- The dev-harness transcript (`public/sample.jsonl`) is **gitignored** and must never be committed.

## How it's built

```
src/
  ingest/   parse.ts · redact.ts · cli.ts        raw JSONL → normalized WorldEvent[] + ParsedSession
  model/    types.ts (frozen contract) · mapping.ts (event→district) · narrative.ts · tally.ts
  tui/      cli.tsx (entry) · ReplayApp · App (panel) · InputBar · WorkCard · viewModel · replay
  export/   cardSvg.ts (SVG poster) · exportCard.ts · replayTape.ts · exportReplay.ts (gif/mp4)
docs/       EVENT-DICTIONARY.md · DATA-CONTRACT.md (the parser spec) · shots/
```

The pipeline: **raw JSONL → normalized `WorldEvent[]` + entity model (`ParsedSession`) → an
honest view-model → the Ink panel**. The ingester is implementable from `docs/DATA-CONTRACT.md`
alone; the renderable vocabulary is catalogued in `docs/EVENT-DICTIONARY.md`. The
honesty-critical layers (parser, redaction, event→model mapping, the seq-replay derivations) are
covered by a [vitest](https://vitest.dev) suite — including a golden-master over the real local
transcript that asserts the privacy + fail-count invariants hold over real data. Cost is deduped
by `message.id`; subagents are attributed by `agentId`. Run `npm test`.

> **History:** an earlier milestone rendered the same data as a 3D/web "SimCity" city
> (PixiJS + Three). That renderer was **removed** once the terminal panel proved out — the repo
> now carries only the TUI. The honest data spine (`ingest/`, `model/`, and the context-health
> + seek-state calc) is the part that crossed over unchanged.

## Status

Observe + replay works on real transcripts, end-to-end. The data spine is honest and tested; the
panel, the 作品 card, and static/animated export are complete. Control (approve / pause /
reroute) is intentionally out of scope until observation is trusted.
