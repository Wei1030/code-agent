# Prototype screenshots

The prototype (`../index.html`) shows the real app. These scripts rebuild its screenshots after the
UI changes, so the prototype never drifts from the implementation.

```
node docs/prototype/tools/shoot.mjs            # everything (about 10 minutes)
node docs/prototype/tools/shoot.mjs P04 P22b   # only these screens
```

What it does:

1. `setup.mjs` builds a demo world in `C:/tmp/code-agent-demo` (`DEMO_DIR`): three git repositories
   and a Claude Code config dir of their own (settings, skills, a subagent, two MCP servers — one is
   `issue-tracker-mcp.mjs`, which asks for input through an elicitation). The real `~/.claude` and
   `~/.code-agent` are never touched.
2. `demo-llm.mjs` stands in for an Anthropic-compatible endpoint and plays the scripts in
   `scenarios.mjs`: which tools to call and what to answer for each demo prompt, plus the reviewer's
   verdicts, board records and job output. Models named `expired…` answer 401.
3. A Code Agent server starts on port 5190 with its own data dir; `drive.mjs` configures it and
   drives sessions into every state the screens need (finished work, a review loop, peer sessions,
   a subagent and a background task, waiting approval / question / plan / elicitation, a running
   command, an endpoint error), then adds board items, jobs and hook rules.
4. Headless Chrome opens each screen of `screens.mjs`, records where each numbered mark goes, and
   writes `../shots/<id>.webp` and `../screens.js`. A proposal is drawn into the real page with
   `ctx.inject` (HTML using the app's own classes, outlined with `.proto-new`), its marks get
   `isNew` and the screen a `snippet` with that HTML.

`SHOOT_KEEP=1` leaves the demo running afterwards; `SHOOT_REUSE=1` shoots again from that running
demo without rebuilding it, which is the quick loop when editing `screens.mjs`. Chrome is expected at
the default Windows path (`CHROME` to change it).

A screen is `{ id, group, title, status, summary, frs, prepare(ctx), marks, snippet? }`. `prepare`
navigates and clicks (`ctx.go`, `ctx.click(sel, text)`, `ctx.type`, `ctx.eval`, `ctx.call` for the
server's RPC); a mark is `{ sel, text?, nth?, isNew?, note: [element, interaction, behaviour] }` and
points at the innermost visible element matching the selector and containing the text.
