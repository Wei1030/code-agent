# Prototype screenshots

The prototype (`../index.html`) shows the real app. These scripts rebuild its screenshots after the
UI changes, so the prototype never drifts from the implementation. They run on the test harness
(`test/harness`), the same one the end-to-end tests use.

```
node --import tsx docs/prototype/tools/shoot.ts            # everything (about 15 minutes)
node --import tsx docs/prototype/tools/shoot.ts P04 P22b   # only these screens
```

What it does:

1. `world.ts` builds a demo world in `C:/tmp/code-agent-demo` (`DEMO_DIR`): three git repositories,
   notes outside them, and the Claude Code config of the world's own home (settings, skills, a
   subagent, two MCP servers — one is `issue-tracker-mcp.mjs`, which asks for input through
   elicitations). The real `~/.claude` and `~/.code-agent` are never touched.
2. The harness's scripted endpoint plays `scenarios.mjs`: which tools to call and what to answer
   for each demo prompt, plus the reviewer's verdicts, board records and job output. Models named
   `expired…` answer 401.
3. The web app is built and Code Agent starts on its own data dir; `drive.ts` configures it and
   drives sessions into every state the screens need (finished work, a review loop and one waiting
   for a decision, peer sessions and a held message, a subagent and a background task, waiting
   approvals — two at once — and a question / plan / elicitation, a running command, an endpoint
   error, a crash, a session started and one continued in the claude CLI, a long compacted
   conversation), then adds board items, jobs and hook rules.
4. Headless Chrome opens each screen of `screens.mjs`, records where each numbered mark goes, and
   writes `../shots/<id>.webp` and `../screens.js`. A proposal is drawn into the real page with
   `ctx.inject` (HTML using the app's own classes, outlined with `.proto-new`), its marks get
   `isNew` and the screen a `snippet` with that HTML.

The run is strict: a screen whose preparation fails or a mark that is not found is listed at the
end and the run exits with code 1. `SHOOT_KEEP=1` keeps the demo running afterwards and shoots
again whenever `screens.mjs` changes (the screens given on the command line, or all) — the quick
loop when editing screens. `SHOOT_NO_BUILD=1` skips building the web app. Chrome is expected at
the default Windows path (`CHROME` to change it).

A screen is `{ id, group, title, status, summary, frs, prepare(ctx), after?(ctx), marks, snippet? }`.
`prepare` navigates and clicks (`ctx.go`, `ctx.click(sel, text)`, `ctx.type`, `ctx.eval`, `ctx.hover`,
`ctx.offline`, `ctx.call` for the server's RPC); a mark is `{ sel, text?, nth?, isNew?, note:
[element, interaction, behaviour] }` and points at the innermost visible element matching the
selector and containing the text.
