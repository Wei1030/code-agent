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
| [docs/prototype/index.html](docs/prototype/index.html) | Interaction prototype: 24 screens drawn in SVG, each with numbered interaction notes |

Open the prototype by loading `docs/prototype/index.html` in a browser; it needs no build step or
server.

## Planned layout

```
code-agent/
├── docs/
│   ├── requirements.md      # requirements specification
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

## Authentication

Sessions authenticate with an Anthropic API key or a cloud provider (Amazon Bedrock, Google Cloud,
Microsoft Foundry). Credentials stay on the local server and are never sent to the browser.
