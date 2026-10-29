# Code Agent

English | [简体中文](README.zh-CN.md)

Code Agent is a personal workbench for Claude Code that runs in your browser. A small local
Node.js server drives Claude Code through the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), and the web UI shows
everything a session does: streaming replies, tool approvals, questions, plans, subagents,
background tasks, file changes, context and cost.

On top of that it adds:

- **Several sessions at once**, each in its own workspace or git worktree; sessions can read,
  message and start each other.
- **Models from more than one place**: your own Claude subscription and any number of
  Anthropic-compatible endpoints, each with its own models.
- **Code review loop**: checks you define run first, then a read-only reviewer in its own Claude
  Code process sends findings back until the work passes.
- **Workspace board** of features, issues and notes, kept up to date in the background after each turn.
- **Settings in one place**: permission rules, MCP servers, skills, commands, subagents, hooks,
  CLAUDE.md and memory files. They are Claude Code's own files, so changes show up in the `claude`
  CLI as well, and the other way round.
- Sessions you started in the `claude` CLI are listed too, and you can carry on with them here; when
  you go on with a session in the CLI, the new turns show up the next time you open it here.

The UI is in Simplified Chinese and English.

> Code Agent is an independent tool built on the Claude Agent SDK. It is not Claude Code and not an
> Anthropic product.

## Deploying

Code Agent runs on your own machine (Windows, macOS or Linux) and is meant for one person.

### Requirements

- **Node.js 22.13 or later.** Its built-in SQLite holds Code Agent's data; there is no database to set up.
- **A model to talk to**, at least one of:
  - your Claude subscription: install [Claude Code](https://code.claude.com/docs/en/setup), run
    `claude` and sign in with `/login`. Code Agent uses that login as it is; it never shows a
    sign-in page and never reads your credentials;
  - an Anthropic-compatible endpoint: its URL, a token and model names, added later in the app.
- **git** for worktrees and code review; the **GitHub CLI** (`gh`) only to import GitHub issues to the board.

### Install and start

```bash
git clone <this repository> code-agent
cd code-agent
npm install
npm start
```

`npm start` builds the web app and starts the server at <http://127.0.0.1:5180>, then opens it
in your default browser. In the app, add a workspace (a project folder); add compatible endpoints
under Settings → Model services & account if you use them.

To update, pull the new version and run `npm install` and `npm start` again. Stop the server with
Ctrl+C.

### Configuration

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `CODE_AGENT_PORT` | `5180` | Port. When it is taken, the next five are tried. |
| `CODE_AGENT_HOME` | `~/.code-agent` | Data folder: the database, logs and worktrees. |
| `CODE_AGENT_NO_OPEN` | not set | Set to `1` to not open the browser on start. |

Starting a second time with the same data folder opens the running instance instead of starting
another one.

### Security

- The server listens on 127.0.0.1 only and accepts connections only from its own page. To use it
  from another computer, forward the port over SSH rather than exposing it.
- Endpoint tokens stay in the local database and are never sent to the browser. A session on an
  endpoint never gets your Claude login.
- Code Agent writes to Claude Code's session files only when you rename, tag or delete a session;
  deleting a session in Code Agent deletes its Claude Code transcript as well.

## Development

```bash
npm run dev         # server with the Vite dev middleware, same address
npm run typecheck   # all three packages
npm test
npm run i18n:missing -w @code-agent/web   # UI text without an English entry
```

`apps/server` is the Node.js server, `apps/web` the React app, `packages/shared` the protocol
types both use. The requirements are in [docs/requirements.md](docs/requirements.md), and the
interaction prototype is [docs/prototype/index.html](docs/prototype/index.html).
