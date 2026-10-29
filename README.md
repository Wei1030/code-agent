# Code Agent

A personal agent workbench: a local Node.js server that drives the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) (TypeScript) and a browser UI
that exposes everything the SDK can do — streaming sessions, tool approvals, clarifying questions,
plan review, subagents and background tasks, file checkpoints, MCP servers, custom tools, hooks,
skills, plugins, structured output, cost and context tracking.

Phase 1 integrates the Claude Agent SDK only.

> Code Agent is an independent tool built on the Claude Agent SDK. It is not Claude Code and is not
> an Anthropic product.

## Status

Working app. `apps/server` runs one Claude Code process per session through the Agent SDK and
serves the web app; `apps/web` is the browser UI. Besides what the SDK offers, Code Agent adds
peer sessions (sessions of a workspace read, message and create each other), a code review loop
(checks run by Code Agent, a read-only reviewer subagent, up to 5 rounds) and a workspace board
(features, issues and notes, recorded in the background after each turn).

### Running

Node.js 22.13 or later (it brings the built-in SQLite the server stores its data in; nothing else to install). Log in to Claude Code yourself first (`claude`, then `/login`), and/or add
compatible endpoints (with their models) in Settings → 模型服务与账号; every session, review, background run
and job picks its model from both.

```
npm install
npm run dev        # server + Vite dev middleware: http://127.0.0.1:5180
npm start          # builds the web app, then serves it: http://127.0.0.1:5180
```

- Data lives in `~/.code-agent/code-agent.db` (set `CODE_AGENT_HOME` to move it); the port is `CODE_AGENT_PORT`.
- If the port is taken, the next ones are tried (up to 5 more). If Code Agent with the same data dir
  already runs on one of them, that one is opened instead of starting a second server.
- Once up, the address opens in the default browser (`CODE_AGENT_NO_OPEN=1` turns that off).
- The server listens on 127.0.0.1 only and accepts WebSocket connections only from its own origin.
- Workspaces, permission rules, MCP servers, skills, commands and hooks are Claude Code's own
  files; changes made here show up in the `claude` CLI and the other way round.

`npm run typecheck` checks all three packages, `npm test` runs the tests, `npm run build` builds the web app.

| Document | Contents |
| --- | --- |
| [docs/requirements.md](docs/requirements.md) | Requirements specification, including a coverage matrix of every SDK function, option, method, message type, hook event and built-in tool |
| [docs/requirements.zh-CN.md](docs/requirements.zh-CN.md) | The same specification in Simplified Chinese (kept in sync) |
| [docs/prototype/index.html](docs/prototype/index.html) | Interaction prototype (Chinese UI): 25 screens drawn in SVG, each with numbered interaction notes |

The SVG prototype predates the last rounds of design changes; the web app is the reference.

## Layout

```
code-agent/
├── docs/                    # requirements (English, Simplified Chinese) and the SVG prototype
├── apps/
│   ├── server/              # Node.js: WebSocket RPC, session engine on the Agent SDK, Code Agent features
│   └── web/                 # browser single-page app
└── packages/
    └── shared/              # protocol types, catalogs and helpers used by both
```

## Stack

- Node.js 22.13 or later, TypeScript (run with tsx), npm workspaces
- Server: Node `http` + `ws`, `@anthropic-ai/claude-agent-sdk`; SQLite (`node:sqlite`, WAL, full-text index for transcripts) in `~/.code-agent/`
- Web: React 19, Vite, Zustand, React Router; plain CSS
- UI languages: Simplified Chinese (English prepared, not enabled yet)

## Authentication

Sessions authenticate in one of two ways:

- **Your own Claude subscription**, through a login you made yourself in the official Claude Code
  (`claude`, then `/login`). Code Agent only points the unmodified Claude Code binary at your Claude
  config directory; it never shows a sign-in page and never reads or stores those credentials.
  Intended for personal use on your own machine.
- **An Anthropic API key or a cloud provider** (Amazon Bedrock, Google Cloud, Microsoft Foundry).
  These credentials stay on the local server and are never sent to the browser.

See §1.4 and FR-AUTH in the requirements for the rules behind this.
