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
- a one-key **作品 card** + SVG / GIF export, so a run becomes a shareable artifact — the card
  carries the run's **「一路走来」journey** (its real turning points in order, so an outsider can
  *认领* the path the agent walked) beneath the headline, and is **independently verifiable**: it
  embeds a fingerprint anyone can re-derive from the original transcript to prove the card didn't
  lie (see [Verifiable provenance](#verifiable-provenance)).

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
npm run export:card   <transcript> [out.svg]    # SVG poster + (if a rasterizer is present) a verifiable PNG
npm run export:replay <transcript> [out.gif]    # an animated gif + mp4 trailer

# prove a card is faithful to its transcript (exit 0 = ✓, exit 1 = ✗ tampered/mismatched):
npm run verify:card   <card.svg|card.png> <transcript.jsonl|parsed.json>
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

## Verifiable provenance

A shareable card is only worth something if nobody can fake it. So the SVG card's "✓ 可溯源"
seal is not a slogan — it's a **machine-checkable receipt**. `export:card` embeds a small
opaque receipt (hashes + counts only — never your sessionId, timestamps, or any plaintext
metric) in the SVG's `<metadata>`. Anyone holding the original transcript runs `verify:card` and
it re-derives everything from scratch:

```bash
npm run verify:card agentcity-card.svg ~/.claude/projects/<project>/<sessionId>.jsonl
# ✓ 收据自洽 / 模式一致 / 原始字节指纹 / 声明指纹 / 完整指纹 / 卡面完整性 …
# ✓ 一致：这张卡如实呈现 <transcript>   → exit 0

# Try it on the bundled sample (a secret-free synthetic session — no setup, no private data):
npm run verify:card docs/shots/card-sample.svg docs/shots/card-sample.session.json   # → exit 0
# edit any number in card-sample.svg and re-run → exit 1 (the whole-card gate catches it)
```

The guarantee (`verifyCard.ts`): **exit 0 ⟺ the embedded receipt matches the transcript *and*
the card's *entire visible surface* is exactly what the renderer produces for that transcript.**
The whole-card check (`卡面完整性`) is the airtight part — because the renderer is a pure
function, a genuine card is byte-identical to a re-render, so *any* edited number, forged wish,
doctored journey beat, overlay headline, or injected element makes it differ and fail. The hash covers the full input
set (the main `.jsonl` **plus** every file under the sibling `subagents/` tree), so multi-agent
work is bound too. Everything runs locally with `node:crypto` — no network, no third party.

**Shareable PNG (for platforms that won't render SVG).** When a system SVG rasterizer is present
(`rsvg-convert` / `resvg` / `inkscape` / `magick` / macOS `qlmanage` — tried in turn until one
works), `export:card` also writes a `.png` that **carries the exact SVG source inside a PNG text
chunk**. `verify:card` accepts that PNG, extracts the embedded SVG, and runs the identical oracle —
so a raster you post stays independently checkable. The verifier trusts **only the embedded SVG**,
never the raster pixels: a verified PNG proves the *card's claims* are faithful; to confirm the
pixels themselves, re-rasterize that SVG and compare. No native dependency is bundled — without a
rasterizer you simply get the (already fully verifiable) SVG.

**Honest scope:** this proves a card faithfully represents *that transcript*. It does **not**
prove the transcript is an authentic Anthropic session — transcripts aren't provider-signed —
and `verify:card` says so. Errors on the card are shown calmly (resilience, "didn't stop"), never
in alarm-red; red stays reserved for live fire.

## How it's built

```
src/
  ingest/   parse.ts · redact.ts · cli.ts        raw JSONL → normalized WorldEvent[] + ParsedSession
  model/    types.ts (frozen contract) · mapping.ts (event→district) · narrative.ts · tally.ts
            provenance.ts (the receipt primitives — node:crypto, pure)
  tui/      cli.tsx (entry) · ReplayApp · App (panel) · InputBar · WorkCard · viewModel · replay
  export/   cardSvg.ts (SVG poster) · cardFace.ts · exportCard.ts · replayTape.ts · exportReplay.ts (gif/mp4)
            cardProvenance.ts (compute + verify, shared by export & verify) · verifyCard.ts (the CLI)
  test/     synthSession.ts (a contract-faithful synthetic session so the honesty suites run in CI)
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
panel, the 作品 card, static/animated export, and **verifiable provenance** are complete. The
honesty suites run on every push (CI, Node 20 + 22) against a synthetic session, so the guarantees
are checked without needing the private fixture. Control (approve / pause / reroute) is
intentionally out of scope until observation is trusted.
