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

Design stage. No application code yet.

| Document | Contents |
| --- | --- |
| [docs/requirements.md](docs/requirements.md) | Requirements specification, including a coverage matrix of every SDK function, option, method, message type, hook event and built-in tool |
| [docs/requirements.zh-CN.md](docs/requirements.zh-CN.md) | The same specification in Simplified Chinese (kept in sync) |
| [docs/prototype/index.html](docs/prototype/index.html) | Interaction prototype (Chinese UI): 25 screens drawn in SVG, each with numbered interaction notes |

Open the prototype by loading `docs/prototype/index.html` in a browser; it needs no build step or
server.

## Planned layout

```
code-agent/
├── docs/
│   ├── requirements.md      # requirements specification (English)
│   ├── requirements.zh-CN.md # requirements specification (Simplified Chinese)
│   └── prototype/           # SVG interaction prototype (static page)
├── apps/
│   ├── server/              # Node.js: REST + WebSocket API, session manager, SDK adapter
│   └── web/                 # browser single-page app
└── packages/
    └── protocol/            # shared types for the REST / WebSocket protocol
```

`apps/` and `packages/` are created with the first code.

## Planned stack

- Node.js 22 LTS, TypeScript, pnpm workspaces
- Server: Fastify with WebSocket support, `@anthropic-ai/claude-agent-sdk`
- Web: React + Vite (to be confirmed, see the open decisions in the requirements)
- Local storage: SQLite in `~/.code-agent/`
- UI languages: Simplified Chinese and English

## Authentication

Sessions authenticate in one of two ways:

- **Your own Claude subscription**, through a login you made yourself in the official Claude Code
  (`claude`, then `/login`). Code Agent only points the unmodified Claude Code binary at your Claude
  config directory; it never shows a sign-in page and never reads or stores those credentials.
  Intended for personal use on your own machine.
- **An Anthropic API key or a cloud provider** (Amazon Bedrock, Google Cloud, Microsoft Foundry).
  These credentials stay on the local server and are never sent to the browser.

See §1.4 and FR-AUTH in the requirements for the rules behind this.
