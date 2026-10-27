# Code Agent — Requirements Specification

| Item | Value |
| --- | --- |
| Document | Product requirements, v0.2 (draft) |
| Date | 2026-10-28 |
| Languages | English (this file) · Simplified Chinese: [`requirements.zh-CN.md`](requirements.zh-CN.md) — keep both in sync |
| Scope | Phase 1: a local, single-user web workbench over the Claude Agent SDK (TypeScript) |
| Stack | Node.js backend + browser frontend |
| SDK baseline | `@anthropic-ai/claude-agent-sdk` 0.3.x (docs read at the 0.3.301 / Claude Code 2.1.302 level) |
| Companion | Interaction prototype: [`docs/prototype/index.html`](prototype/index.html) |

> Source material: <https://code.claude.com/docs/en/agent-sdk/overview> and every page under
> `/docs/en/agent-sdk/` (32 pages, including the full TypeScript reference), plus the Claude Code
> tools reference. Section 13 maps every SDK function, option, method, message type, hook event
> and built-in tool to the requirement that covers it.

---

## 1. Background and goals

The Claude Agent SDK runs the Claude Code agent loop as a library: built-in tools, permissions,
sessions, hooks, subagents, MCP, skills, plugins, checkpoints, cost tracking and more. It is
headless: every interactive surface (approval prompts, clarifying questions, plan review, task
lists, context meters) has to be built by the host application.

**Code Agent** is that host application: a personal agent workbench that runs on the user's
machine, drives the SDK from a Node.js server and presents everything in a browser UI.

### 1.1 Goals

- **G1 — Full SDK coverage.** Every capability the TypeScript Agent SDK exposes is reachable from
  the UI, either as a first-class feature or, for rarely used knobs, through an advanced settings
  surface. Section 13 is the checklist.
- **G2 — Interactive first.** Sessions run in streaming input mode (the SDK's recommended mode), so
  the user can queue messages, interrupt, approve tools, answer questions, switch model or
  permission mode mid-session.
- **G3 — Transparent.** The user can always see what the agent is doing: streaming text and
  thinking, every tool call and result, subagents, background tasks, hooks, context usage and cost.
- **G4 — Safe by default.** The agent never gets more authority than the user granted; risky
  actions are surfaced for approval; file changes can be previewed and rewound.
- **G5 — Extensible later.** The server isolates the SDK behind an `AgentRuntime` boundary so that
  other agent backends could be added in a later phase, without designing for them now.

### 1.2 Non-goals (phase 1)

- Multi-user / multi-tenant hosting, accounts, or remote SaaS deployment.
- Providing a claude.ai sign-in flow, or reading, storing or relaying claude.ai credentials.
  Code Agent can still run sessions on a subscription the user signed in to themselves in the
  official Claude Code (FR-AUTH-04, §1.4).
- The Python SDK, mobile clients, IDE plugins.
- Re-implementing CLI-only features that the SDK does not expose (agent teams, Remote Control,
  the terminal UI).

### 1.3 Branding constraints

Per the SDK branding guidelines, the product must keep its own name. It must **not** be called
"Claude Code" or "Claude Code Agent" and must not reuse Claude Code ASCII art or visual identity.
Allowed: "Code Agent", "Code Agent — Powered by Claude", or "Claude Agent" in a model/agent menu.

### 1.4 Authentication constraints

From the Claude Code legal and compliance page (section "Authentication and credential use") and
the Agent SDK overview, as of 2026-10-28:

- Products built on the Agent SDK should authenticate with API keys (Claude Console) or a
  supported cloud provider. Third-party developers may not offer claude.ai login in their
  applications, route requests through Free / Pro / Max credentials on behalf of their users, or
  collect, store or intermediate claude.ai credentials or session tokens; sign-in must complete
  through Anthropic's own flow.
- These terms do not prevent an end user from signing in to the **unmodified** Claude Code binary
  with their own Claude subscription. Advertised Pro and Max usage limits assume ordinary,
  individual use of Claude Code and the Agent SDK.
- Products that run Claude Code must not modify the binary or remove its authentication methods,
  and must not pay for, resell or intermediate Claude usage: each end user authenticates with
  their own credentials.

Code Agent therefore supports two kinds of credentials: (1) API keys and cloud providers, stored
by Code Agent on the local server; (2) the user's own Claude subscription, used only through the
official, unmodified Claude Code binary, where Code Agent never sees the credentials (FR-AUTH-04).
Option (2) targets personal use on the user's own machine. Distributing Code Agent to other
people with option (2) should be confirmed with Anthropic first (open decision D7).

---

## 2. Users and key scenarios

**Primary user:** one developer working on local repositories (Windows first, macOS and Linux
supported), comfortable with Claude Code concepts.

| # | Scenario | Main capabilities |
| --- | --- | --- |
| SC1 | Chat with an agent about a repository and let it edit code, approving risky steps | Sessions, streaming, tool cards, approvals |
| SC2 | Ask for a plan first, review it, then let the agent execute | Plan mode, AskUserQuestion, mode switch |
| SC3 | Undo a bad set of edits, or branch the conversation to try another approach | File checkpointing, fork, resume-at |
| SC4 | Run long tasks (test suites, research subagents) in the background while continuing to chat | Background tasks, subagents, task notifications |
| SC5 | Wire in external systems (GitHub, databases, internal APIs) | MCP servers, custom tools, elicitation |
| SC6 | Shape the agent: custom subagents, skills, hooks, system prompt, output styles | Agents, skills, plugins, hooks, prompts |
| SC7 | Run one-shot extraction / analysis jobs that return typed JSON | Structured outputs, single-message mode |
| SC8 | Watch spend and context, compact or clear when needed | Cost tracking, context usage, /compact, /clear |
| SC9 | Pick up yesterday's session, or find a past one by tag | Session list, resume, rename, tag |
| SC10 | Debug odd agent behaviour | Raw event inspector, hook events, stderr, OpenTelemetry |
| SC11 | Work in a Chinese UI, with Claude replying in Chinese and the input method working normally | Internationalization, response language, IME handling |

---

## 3. Glossary

| Term | Meaning in this document |
| --- | --- |
| Workspace | A directory the agent works in: the SDK `cwd`, plus optional `additionalDirectories` |
| Session | One SDK conversation (UUID), persisted as a JSONL transcript under `~/.claude/projects/` |
| Live session | A session with a running `Query` object and Claude Code subprocess on the server |
| Turn | One user message and the agent work it triggers, ending in an `SDKResultMessage` |
| Tool call | A `tool_use` block from the model and its matching `tool_result` |
| Approval | A permission request routed to the `canUseTool` callback that the user must answer |
| Subagent | An agent spawned by the `Agent` tool with its own context window |
| Background task | A Bash command, subagent or workflow running detached, reported via `task_*` messages |
| Checkpoint | A user message UUID that `rewindFiles()` can restore files to |
| Profile | A Code Agent concept: a named, saved set of SDK `Options` used to start sessions |
| Hook rule | A Code Agent concept: a UI-defined hook compiled into an SDK `HookCallback` |
| Setting sources | Which filesystem settings the SDK loads: `user`, `project`, `local` |
| Response language | The language Claude replies and titles sessions in (the `language` setting) |

---

## 4. System overview

### 4.1 Architecture

```
 Browser (SPA)                Node.js server (Code Agent)                    Claude Code process
┌──────────────┐  HTTP/REST  ┌───────────────────────────────────────┐  stdio  ┌──────────────────┐
│ Views, state │────────────▶│ API layer (REST + WebSocket)           │        │ agent loop, tools │
│ stores, SVG/ │◀───────────▶│ SessionManager ── LiveSession × N ────┼───────▶│ (bundled binary,  │
│ DOM renderer │  WebSocket  │   ├ Query (SDK)  ├ input queue         │◀───────│  one per session) │
└──────────────┘             │   ├ pending approvals / questions     │        └──────────────────┘
                             │   └ event ring buffer (replay)         │
                             │ Registries: profiles, MCP, agents,     │──▶ ~/.claude/** (SDK data)
                             │ hooks, jobs, cost ledger, settings     │──▶ app data dir (Code Agent)
                             └───────────────────────────────────────┘
```

- **One `LiveSession` per running session.** It owns the `Query` returned by `query()` (or by
  `WarmQuery.query()` / `SpareProcess.claim()`), an async-iterable input queue fed by the browser,
  maps of pending approvals / questions / elicitations keyed by `requestId`, and a bounded ring
  buffer of normalized events so a reconnecting browser can replay what it missed.
- **The browser never talks to the SDK or holds credentials.** All SDK calls happen on the server.
- **Many browser tabs may watch one live session.** Approvals are answered once (first answer
  wins); other tabs see the resolution.
- **SDK-owned data stays where the SDK puts it** (transcripts, CLAUDE.md, `.claude/` folders,
  settings files). Code Agent stores only its own data (profiles, hook rules, registries, cost
  ledger, UI preferences) in an app data directory (default `~/.code-agent/`).

### 4.2 Proposed repository layout

```
code-agent/
├── README.md
├── docs/
│   ├── requirements.md          # this document
│   ├── requirements.zh-CN.md    # Simplified Chinese version
│   └── prototype/               # SVG interaction prototype (static web page)
├── apps/
│   ├── server/                  # Node.js: REST + WebSocket API, SessionManager, SDK adapter
│   └── web/                     # Browser SPA (incl. locales/ message catalogs)
├── packages/
│   └── protocol/                # Shared TypeScript types for the REST/WS protocol
└── (tooling: package.json, pnpm-workspace.yaml, tsconfig.base.json, …)
```

Only `docs/` exists in this round; `apps/` and `packages/` are created with the first code.

### 4.3 Technology proposal (to confirm, see §12)

| Layer | Proposal | Why |
| --- | --- | --- |
| Runtime | Node.js 22 LTS, TypeScript, pnpm workspaces | SDK is TypeScript-first; Node is the requested stack |
| Server | Fastify + `@fastify/websocket` | Small, typed, fast; WS for the event stream |
| SDK | `@anthropic-ai/claude-agent-sdk` (root entry) | Root entry includes `prewarm()`, session helpers |
| Web | React + Vite + TypeScript, Zustand for state | Common, fast dev loop |
| i18n | ICU MessageFormat library (e.g. FormatJS / i18next) + `Intl` | Plurals, variables, date and number formatting |
| Editors | Monaco (JSON schema, SKILL.md, CLAUDE.md, settings JSON) | Schema validation, markdown |
| Rendering | Markdown + syntax highlighting, side-by-side / unified diff | Tool results and edits |
| App storage | SQLite (`better-sqlite3`) in the app data dir | Cost ledger, registries, profiles |

---

## 5. Functional requirements

Priorities: **P0** = milestone M1 (usable core), **P1** = M2, **P2** = M3+. Each requirement names
the SDK surface it is built on. "Live" means the call needs a running streaming-mode session.

### 5.1 Workspaces (FR-WS)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-WS-01 | Pick a workspace directory (folder picker on the server's filesystem, typed path, or recent list). It becomes `cwd`. | `Options.cwd` | P0 |
| FR-WS-02 | Add extra directories the agent may access; show that their `.claude/` skills, commands and agents load when the `project` source is on. | `Options.additionalDirectories` | P1 |
| FR-WS-03 | For a git worktree, optionally point project configuration at the main checkout. | `Options.projectConfigRoot` | P2 |
| FR-WS-04 | Show the workspace's git branch and the effective settings with the source of every key ("why is this value set?"). | `resolveSettings()` → `effective`, `provenance`, `sources` | P1 |
| FR-WS-05 | Home page lists recent workspaces with session counts and last activity. | `listSessions({ dir })` | P0 |

### 5.2 Session lifecycle (FR-SES)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-SES-01 | Start a new session from a profile and/or the New Session dialog. Sessions always use streaming input mode (prompt = async iterable). | `query({ prompt: AsyncIterable<SDKUserMessage>, options })` | P0 |
| FR-SES-02 | Optional custom title and fixed session UUID at creation. | `Options.title`, `Options.sessionId` | P1 |
| FR-SES-03 | "Ephemeral" sessions that are never written to disk (badge in UI, cannot be resumed). | `Options.persistSession: false` | P1 |
| FR-SES-04 | Warm start: keep a pre-initialized process per active profile so the first prompt is instant; show warm-pool status. Use `startup()` when the workspace is known and `prewarm()` + `claim()` when it is not. Respect that a spare fixes `mcpServers`, `hooks`, `systemPrompt`, `plugins`, etc. | `startup()`, `WarmQuery`, `prewarm()`, `SpareProcess.claim/claimed/exited/close` | P2 |
| FR-SES-05 | Session list: all sessions or per workspace, sorted by last modified, with title (custom / AI / first prompt), git branch, tag, size, created time; search by text; filter by tag and workspace; include worktree sessions. | `listSessions({ dir, limit, includeWorktrees })` → `SDKSessionInfo` | P0 |
| FR-SES-06 | Open a past session read-only: render its transcript, including subagent messages nested under their parent tool call, with paging. | `getSessionMessages(id, { limit, offset, includeSystemMessages })`, `parent_tool_use_id`, `parent_agent_id` | P0 |
| FR-SES-07 | Resume a session (makes it live again), or "Continue most recent" in a workspace. | `Options.resume`, `Options.continue` | P0 |
| FR-SES-08 | Rename and tag sessions (inline edit); clear tag. | `renameSession()`, `tagSession(id, null)` | P0 |
| FR-SES-09 | Delete a session (with confirmation). | `deleteSession()` | P1 |
| FR-SES-10 | Fork a whole session, or fork from a chosen message ("branch from here"), with an optional title. Show fork lineage in the list. | `forkSession(id, { upToMessageId, title })`; `Options.forkSession` with `resume` | P1 |
| FR-SES-11 | Resume at a specific message (truncate later turns) for "edit and resend". | `Options.resumeSessionAt`, `Options.resumeDropsTurn` | P2 |
| FR-SES-12 | Show live session state: idle / running / requires action, everywhere the session appears (list, tabs, favicon badge). | `SDKSessionStateChangedMessage.state` | P0 |
| FR-SES-13 | Several live sessions at once (tabs); closing a tab does not stop the session; an explicit "Stop session" ends the process. | `Query.close()`, `AbortController` | P0 |
| FR-SES-14 | Browser reload / reconnect re-attaches to live sessions and replays buffered events; pending approvals re-appear. | Server ring buffer; `Query.reinitialize()`; `pending_permission_requests` | P0 |
| FR-SES-15 | Export a transcript as Markdown or JSON. | `getSessionMessages()` | P1 |
| FR-SES-16 | Optional external session store (e.g. SQLite mirror) so transcripts survive cleanup of `~/.claude`; flush mode and load timeout configurable. | `Options.sessionStore`, `sessionStoreFlush`, `loadTimeoutMs`, `SessionStore` interface | P2 |
| FR-SES-17 | Session info panel: session ID, cwd, model, permission mode, Claude Code version, tools, MCP servers, skills, plugins, slash commands, output style, capabilities, API key source. | `SDKSystemMessage` (`subtype: "init"`), `initializationResult()` | P0 |

### 5.3 Composer and input (FR-IN)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-IN-01 | Multi-line composer; Enter sends, Shift+Enter newline; draft kept per session. | `SDKUserMessage` | P0 |
| FR-IN-02 | Attach images (paste, drag-drop, picker); sent as base64 image blocks; show thumbnails. | `MessageParam` content blocks | P0 |
| FR-IN-03 | `@` mentions: file path autocomplete from the workspace and MCP resources (`@server:resource`). | Claude Code mention expansion | P1 |
| FR-IN-04 | Pasted text larger than a threshold becomes a collapsible "pasted" chip and is sent as pasted content, so Claude can tell pasted from typed text. | `SDKUserMessage.pasted_content`, `inline_pastes` | P1 |
| FR-IN-05 | Slash command palette: typing `/` lists commands with description, argument hint, aliases and origin (built-in / skill / plugin / MCP prompt); list updates live. | `supportedCommands()`, `SlashCommand`, `SDKCommandsChangedMessage`, init `slash_commands` | P0 |
| FR-IN-06 | Message queue: while a turn runs the user can keep sending; each queued message shows as a chip with a delivery choice — **Steer now** (`now` + human origin), **Next** (read after current tool calls), **Later** (new turn). Queued chips can be edited or removed before delivery. | `SDKUserMessage.priority`, `origin: { kind: "human" }` | P0 |
| FR-IN-07 | Interrupt button (and Esc) stops the current turn; the UI reports which queued messages are still queued and offers to cancel them. | `Query.interrupt()` → `SDKControlInterruptResponse.still_queued` | P0 |
| FR-IN-08 | "Add context without asking": send a message that is appended but does not trigger a turn (e.g. paste a log). | `SDKUserMessage.shouldQuery: false` | P1 |
| FR-IN-09 | "Send verbatim" toggle per message (no `@` expansion, no `/` dispatch); profile-level default. | `client_composed`, `Options.verbatimPrompts` | P2 |
| FR-IN-10 | Prompt suggestions: after a turn, show the predicted next prompt as ghost text; Tab accepts. | `Options.promptSuggestions`, `SDKPromptSuggestionMessage` | P1 |

### 5.4 Output stream rendering (FR-OUT)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-OUT-01 | Token-level streaming of assistant text with Markdown and code highlighting. | `Options.includePartialMessages`, `SDKPartialAssistantMessage` (`content_block_delta` / `text_delta`) | P0 |
| FR-OUT-02 | Thinking blocks: collapsible, streamed, labelled with duration; profile choice of summarized / omitted. | `Options.thinking` (`display`), `thinking` blocks, `SDKThinkingTokensMessage` | P0 |
| FR-OUT-03 | Tool calls stream in as cards (name first, input as it is generated) and update with progress, elapsed time, and result. | `content_block_start` / `input_json_delta`, `SDKToolProgressMessage`, `tool_result`, `tool_use_result` | P0 |
| FR-OUT-04 | Collapsed one-line summaries for runs of tool calls ("Read 6 files, searched 2 patterns"). | `SDKToolUseSummaryMessage` | P1 |
| FR-OUT-05 | Interrupted messages are marked as cut off. | `SDKAssistantMessage.aborted` | P0 |
| FR-OUT-06 | Turn footer: duration, API time, time to first token, turns, cost, stop reason; refusal is shown distinctly. | `SDKResultMessage` (`duration_ms`, `duration_api_ms`, `ttft_ms`, `num_turns`, `total_cost_usd`, `stop_reason`) | P0 |
| FR-OUT-07 | Error banners with an action per kind: max turns / max budget ("Continue with higher limit" = resume with new limit), execution error, structured output retries, startup failure reason; assistant API errors (auth, billing, rate limit, overloaded, model not found, max output tokens, cloud credentials). | `SDKResultMessage.subtype` / `errors` / `startup_failure_reason`, `SDKAssistantMessageError` | P0 |
| FR-OUT-08 | Transient status: API retry in progress, compacting, model refusal → fallback model, rate-limit warnings with reset time and utilization. | `SDKAPIRetryMessage`, `SDKStatusMessage` (`compacting`), `SDKModelRefusalFallbackMessage` / `NoFallback`, `SDKRateLimitEvent` | P0 |
| FR-OUT-09 | Informational notices (info / notice / suggestion / warning) and local command output (e.g. `/context`, `/usage`). | `SDKInformationalMessage`, `SDKLocalCommandOutputMessage`, `SDKUsageReport` | P1 |
| FR-OUT-10 | Messages injected from outside the session (scheduled triggers, peers, channels) are shown with their origin. | `SDKUserMessageReplay`, `SDKMessageOrigin` | P2 |
| FR-OUT-11 | Files the agent sends or persists appear as downloadable attachments. | `SDKFilesPersistedEvent` | P2 |
| FR-OUT-12 | Display-only rewriting via a hook (e.g. redact secrets on screen without changing the transcript). | `MessageDisplay` hook (`displayContent`) | P2 |

### 5.5 Tool call cards (FR-TOOL)

Each built-in tool gets a purpose-built card; unknown tools fall back to a JSON card.

| ID | Tool(s) | Card behaviour | Pri |
| --- | --- | --- | --- |
| FR-TOOL-01 | `Bash`, `PowerShell` | Command, description, live output tail, exit status, timeout; "Run in background" badge; "Send to background" button while running. | P0 |
| FR-TOOL-02 | `Read` | Path, line range; expandable preview; images rendered. | P0 |
| FR-TOOL-03 | `Edit`, `Write`, `NotebookEdit` | Unified / split diff with +/− counts; open full file. | P0 |
| FR-TOOL-04 | `Glob`, `Grep`, `LSP` | Pattern and result list with clickable paths / locations. | P0 |
| FR-TOOL-05 | `WebFetch`, `WebSearch` | URL / query, result titles and links. | P0 |
| FR-TOOL-06 | `Agent` | Subagent card: type, description, model, live status and progress summary, nested transcript (expand), final report, usage. | P0 |
| FR-TOOL-07 | `Skill` | Skill name and arguments; forked-context skills render like subagents. | P1 |
| FR-TOOL-08 | `AskUserQuestion` | Interactive question panel (FR-ASK). | P0 |
| FR-TOOL-09 | `TaskCreate/Update/Get/List`, `TodoWrite` | Feed the task list panel (FR-TODO); compact inline card. | P0 |
| FR-TOOL-10 | `EnterPlanMode`, `ExitPlanMode` | Plan review (FR-PLAN). | P0 |
| FR-TOOL-11 | `Monitor`, `TaskStop` | Monitor stream with recent events; stop. | P1 |
| FR-TOOL-12 | `CronCreate/Delete/List`, `ScheduleWakeup` | Session-scoped schedules panel: prompt, cron, next run, cancel. | P2 |
| FR-TOOL-13 | `EnterWorktree`, `ExitWorktree` | Worktree path and branch; cwd change notice. | P2 |
| FR-TOOL-14 | `ListMcpResources`, `ReadMcpResource`, `ToolSearch`, `WaitForMcpServers` | Compact informational cards. | P1 |
| FR-TOOL-15 | MCP tools (`mcp__server__tool`) | Server and tool name, provenance, input, text / image / resource / resource_link output, `structuredContent` viewer; MCP Apps `ui://` widgets rendered in a sandboxed iframe. | P0 (P2 for widgets) |
| FR-TOOL-16 | `Workflow`, `SendMessage`, `ListAgents`, `PushNotification`, `SendUserFile`, `RemoteTrigger`, `Artifact`, `ReportFindings` and other tools | Generic JSON card with the typed input/output; specific cards later if useful. | P2 |

All cards: copy input, copy output, raw JSON toggle, duration, and the permission decision that let
the call run (auto-approved by rule X / approved by user / mode).

### 5.6 Permissions and approvals (FR-PERM)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-PERM-01 | Permission mode selector in the session header with the six modes and plain-language descriptions: Default (ask), Accept edits, Plan, Auto (classifier), Don't ask (deny unless pre-approved), Bypass. Change takes effect immediately. Auto is hidden when the model lacks `supportsAutoMode`. | `Options.permissionMode`, `Query.setPermissionMode()`, `ModelInfo.supportsAutoMode` | P0 |
| FR-PERM-02 | Bypass mode requires an explicit, per-profile "allow dangerous skip" switch and a confirmation; the header shows a red badge while active. | `Options.allowDangerouslySkipPermissions` | P0 |
| FR-PERM-03 | Approval card for each `canUseTool` request: tool, input preview (diff for edits, command for Bash), reason, blocked path, MCP server and its source, subagent that asked. | `CanUseTool` options: `decisionReason`, `blockedPath`, `mcpServer`, `agentID`, `toolUseID`, `requestId` | P0 |
| FR-PERM-04 | Answers: **Allow once**; **Allow and remember** (pick one suggested rule and its destination: session / local / project / user settings); **Edit then allow** (edit the input JSON or command); **Deny** with an optional message to Claude; **Deny and stop** (interrupt). | `PermissionResult` (`updatedInput`, `updatedPermissions`, `message`, `interrupt`), `suggestions: PermissionUpdate[]` | P0 |
| FR-PERM-05 | Honour safety hints: when `defaultToNo`, focus Deny and offer no one-key approve; when `suppressAlwaysAllowRule`, hide "remember". | `defaultToNo`, `suppressAlwaysAllowRule` | P0 |
| FR-PERM-06 | Global approvals inbox (header badge) listing pending requests across all live sessions; browser notification when a session needs action. | `session_state_changed: requires_action`, `PermissionRequest` / `Notification` hooks | P0 |
| FR-PERM-07 | Idempotent handling by `requestId` (a request re-delivered after reconnect must not prompt twice). | `requestId`, `reinitialize()` | P0 |
| FR-PERM-08 | Rules editor: allow / ask / deny rules with the rule syntax (`Bash(npm run *)`, `Edit(/src/**)`, `WebFetch(domain:…)`, `mcp__server__*`, `Agent(Explore)`, `Skill(name)`); per profile (`allowedTools` / `disallowedTools`) and per settings file (project / local / user). Explains evaluation order: hooks → deny → ask → mode → allow → callback. | `Options.allowedTools`, `disallowedTools`, `settings.permissions`, `PermissionUpdate` | P0 |
| FR-PERM-09 | Denied calls are listed per turn and per session with reason and input; a denial can be turned into an allow rule. | `SDKResultMessage.permission_denials`, `SDKPermissionDeniedMessage` | P1 |
| FR-PERM-10 | Headless profiles: "No prompts" (deny anything that would ask). | `Options.permissionPrompts: 'none'`, `dontAsk` mode | P1 |
| FR-PERM-11 | Per-MCP-server stricter mode while the session runs in bypass or auto. | `Query.setMcpPermissionModeOverride()` | P2 |
| FR-PERM-12 | Long-pending approvals: optional "defer" so a session can end and the decision be made later. | `PreToolUse` hook `permissionDecision: "defer"` | P2 |
| FR-PERM-13 | Alternative approver via an MCP tool (advanced). | `Options.permissionPromptToolName` | P2 |
| FR-PERM-14 | Warn in the profile editor when a configuration silently bypasses the approval callback (bare `allowedTools` names, bypass mode). | `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` process warning | P1 |

### 5.7 Clarifying questions (FR-ASK)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-ASK-01 | When Claude calls `AskUserQuestion`, show a question panel above the composer: 1–4 questions, each with a header chip (≤12 chars), question text and 2–4 options with descriptions; single or multi select. | `AskUserQuestionInput.questions[]` | P0 |
| FR-ASK-02 | Each question also accepts "Other" free text; the user may instead type a freeform reply to all questions. | `updatedInput.answers`, `response` | P0 |
| FR-ASK-03 | Option previews (HTML or Markdown) shown side by side when options carry them; HTML is rendered in a sandboxed iframe. | `toolConfig.askUserQuestion.previewFormat`, `options[].preview` | P1 |
| FR-ASK-04 | Per-option notes the user adds are passed back. | `annotations[question].notes` | P2 |
| FR-ASK-05 | Profiles that restrict `tools` must include `AskUserQuestion`; the editor warns when it is missing. | `Options.tools` | P1 |

### 5.8 Plan mode (FR-PLAN)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-PLAN-01 | When the agent exits plan mode, show the plan as a document with actions: **Approve and accept edits**, **Approve (ask each step)**, **Approve with auto mode** (if available), **Keep planning** with feedback. Approval switches mode accordingly. | `ExitPlanMode` via `canUseTool`, `setPermissionMode()` | P0 |
| FR-PLAN-02 | Plan mode workflow text customizable per profile. | `Options.planModeInstructions` | P2 |
| FR-PLAN-03 | Plans are kept in the session's side panel for later reference. | Transcript | P1 |

### 5.9 Model and reasoning (FR-MOD)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-MOD-01 | Model picker populated from the live session: display name, description, resolved ID, capability badges (effort levels, adaptive thinking, fast mode, auto mode). Switching applies mid-turn from the next request. | `supportedModels()` → `ModelInfo`, `setModel()` | P0 |
| FR-MOD-02 | Fallback model chain per profile. | `Options.fallbackModel` | P1 |
| FR-MOD-03 | Effort selector limited to the model's supported levels; can be changed live; optionally saved as the user's default for that model. | `Options.effort`, `applyFlagSettings({ effortLevel })`, `updateSettings('userSettings', { effortLevel })` | P0 |
| FR-MOD-04 | Thinking: adaptive / fixed budget / off; display summarized / omitted. | `Options.thinking` (`ThinkingConfig`) | P1 |
| FR-MOD-05 | Fast mode toggle with state (off / cooldown / on) and the reason when unavailable. | `applyFlagSettings({ fastMode })`, `fast_mode_state`, `fast_mode_disabled_reason` | P2 |
| FR-MOD-06 | Ultracode toggle (xhigh effort + dynamic workflows). | `applyFlagSettings({ ultracode })` | P2 |
| FR-MOD-07 | Token task budget (alpha) per profile. | `Options.taskBudget` | P2 |
| FR-MOD-08 | Beta flags per profile. | `Options.betas` | P2 |

### 5.10 Limits, cost and usage (FR-COST)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-COST-01 | Per-session limits: max turns and max budget (USD) with headroom guidance; editable when resuming. | `Options.maxTurns`, `maxBudgetUsd` | P0 |
| FR-COST-02 | Live cost in the session header; per-turn cost in the turn footer; per-model breakdown (input, output, cache read, cache creation, web searches, cost). | `total_cost_usd`, `usage`, `modelUsage` (`ModelUsage`) | P0 |
| FR-COST-03 | Cost ledger: every result is recorded so totals survive restarts; dashboard by day, workspace, model, profile; failed and crashed sessions included. | `SDKResultMessage` (all subtypes) | P1 |
| FR-COST-04 | Rate-limit / plan utilization gauge and reset time. | `SDKRateLimitEvent` | P1 |
| FR-COST-05 | Background task and subagent usage shown on their cards. | `task_progress.usage`, `task_notification.usage` | P1 |

### 5.11 Context management (FR-CTX)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-CTX-01 | Context meter in the header (percentage of window, colour thresholds), refreshed after each turn. | Assistant `context_usage`, `getContextUsage({ detail: 'summary' })` | P0 |
| FR-CTX-02 | Context inspector: category breakdown (system prompt, tools, MCP tools, deferred tools, agents, memory files, skills, messages, compaction buffer, free) as a grid, plus per-file / per-tool / per-server token lists. "Precise" refresh uses full token counting. | `getContextUsage({ detail: 'full' })` → `categories`, `gridRows`, `memoryFiles`, `mcpTools`, `systemTools`, … | P1 |
| FR-CTX-03 | Compact now (with optional instructions) and Clear conversation; show compaction boundaries in the transcript with pre-compaction token count and trigger (manual / auto). | `/compact`, `/clear`, `SDKCompactBoundaryMessage`, `SDKConversationResetMessage` | P0 |
| FR-CTX-04 | Tool search setting (on / auto / auto:N / off) per profile. | `ENABLE_TOOL_SEARCH` env | P2 |

### 5.12 Subagents (FR-AGT)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-AGT-01 | Agents library: list agents from the app registry (programmatic), `.claude/agents/` (project, user) and plugins, with source badges. | `Options.agents`, `supportedAgents()` → `AgentInfo` | P1 |
| FR-AGT-02 | Agent editor with every `AgentDefinition` field: description, prompt, tools, disallowed tools, model (alias / inherit / ID), MCP servers (by name or inline), preloaded skills, initial prompt, max turns, auto-compact window, background, omit CLAUDE.md, memory scope, effort, permission mode. | `AgentDefinition` | P1 |
| FR-AGT-03 | Run a session with an agent as the main thread; switch the main-thread agent live. | `Options.agent`, `applyFlagSettings({ agent })` | P1 |
| FR-AGT-04 | Subagent activity is visible: nested transcript (text and thinking), progress summaries, per-subagent model and usage; nested subagents shown as a tree. | `forwardSubagentText`, `agentProgressSummaries`, `parent_tool_use_id`, `agent_id`, `SubagentStart/Stop` hooks | P0 |
| FR-AGT-05 | Limits per profile: subagent depth, concurrency, stall timeout. | env `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` | P2 |

### 5.13 Background tasks (FR-BG)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-BG-01 | Tasks panel: running and finished background tasks (Bash, subagents, workflows) with description, type, parent, status (pending / running / completed / failed / killed / stopped), progress summary, last tool, usage. | `task_started`, `task_progress`, `task_updated`, `task_notification`, `background_tasks_changed` | P0 |
| FR-BG-02 | Stop a task. | `Query.stopTask(taskId)` | P0 |
| FR-BG-03 | Move the foreground work (one tool call or all) to the background so the turn continues — the equivalent of Ctrl+B. | `Query.backgroundTasks(toolUseId?)` | P1 |
| FR-BG-04 | Open a task's output file. | `task_notification.output_file`, `Query.readFile()` | P1 |
| FR-BG-05 | Notification when a background task completes or fails. | `task_notification` | P1 |

### 5.14 Task list / todos (FR-TODO)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-TODO-01 | Live checklist in the side panel built from the agent's task tool calls: subject, active form while in progress, status (pending / in progress / completed), dependencies (blocks / blocked by), owner. | `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `TodoWrite` | P0 |
| FR-TODO-02 | Profile switch to opt in to task tools on models that do not enable them by default. | `allowedTools` / `tools` entry or `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` | P1 |

### 5.15 File checkpoints and rewind (FR-CKPT)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-CKPT-01 | Checkpointing on by default in profiles; every user message becomes a restore point. | `Options.enableFileCheckpointing`, `extraArgs: { 'replay-user-messages': null }`, user message `uuid` | P0 |
| FR-CKPT-02 | Checkpoint timeline in the side panel (one row per user message with files changed since). | Stream of user messages + Edit/Write tool calls | P1 |
| FR-CKPT-03 | Rewind: dry-run preview first (files changed, insertions, deletions, skipped links, "cannot rewind" reason), then apply. | `rewindFiles(uuid, { dryRun: true })` → `RewindFilesResult`, then `rewindFiles(uuid)` | P0 |
| FR-CKPT-04 | "Rewind files and branch conversation here": rewind files, then fork the session at the same message. | `rewindFiles()` + `forkSession({ upToMessageId })` | P1 |
| FR-CKPT-05 | The rewind dialog states the limits: Bash-made changes, subagent edits, directories and remote files are not restored; a fork does not carry checkpoints. | — | P0 |

### 5.16 Changes and files (FR-FILE)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-FILE-01 | "Changes" panel: files the session created / modified with per-file diff (from tool inputs), plus a "git diff" view of the working tree for changes made by Bash. | Edit/Write tool inputs; server-side git | P1 |
| FR-FILE-02 | Preview a workspace file (text or image) through the session. | `Query.readFile(path, { maxBytes, encoding })` | P1 |
| FR-FILE-03 | When the app drops or summarizes an earlier Read from its own context management, mark the file as read so a later Edit works. | `Query.seedReadState()` | P2 |

### 5.17 MCP servers (FR-MCP)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-MCP-01 | MCP registry: add / edit / remove servers of type stdio (command, args, env), HTTP and SSE (URL, headers) and in-process SDK servers (from FR-CTOOL). | `McpServerConfig` variants | P0 |
| FR-MCP-02 | Server status in each session: connected / pending / failed (error) / needs-auth / disabled, server info, scope and source, tool list with annotations (read-only, destructive, open-world). | `mcpServerStatus()` → `McpServerStatus`, init `mcp_servers` | P0 |
| FR-MCP-03 | Live actions: enable / disable, reconnect, add or replace session servers without restarting. | `toggleMcpServer()`, `reconnectMcpServer()`, `setMcpServers()` → `McpSetServersResult` | P1 |
| FR-MCP-04 | Strict mode: use only the servers this app passes (ignore `.mcp.json`, user settings, plugins, connectors). | `Options.strictMcpConfig` | P1 |
| FR-MCP-05 | Authentication: token / header fields for remote servers; the `needs-auth` state explains how to provide credentials (the SDK does not run OAuth itself). | `headers`, `needs-auth` | P1 |
| FR-MCP-06 | Elicitation: when a server asks the user for input, show a dialog (form mode renders the requested fields; URL mode opens the link and waits); accept / decline / cancel. | `Options.onElicitation`, `Elicitation` / `ElicitationResult` hooks | P1 |
| FR-MCP-07 | Browse MCP resources; insert `@server:resource` into the composer. | `ListMcpResources`, `ReadMcpResource` tools | P2 |
| FR-MCP-08 | MCP Apps widgets: render a tool's `ui://` resource in a sandboxed iframe next to its result. | `readMcpResource()`, tool `_meta.ui`, `mcp_tool_ui_meta_v1` capability | P2 |
| FR-MCP-09 | Per-server tool-call timeout, first-turn wait for servers. | `createSdkMcpServer({ timeout })`, `MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT` env | P2 |

### 5.18 Custom tools (FR-CTOOL)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-CTOOL-01 | Code Agent ships its own in-process MCP server ("app tools"), e.g. `notify_user` (browser notification), `open_url` (open in the user's browser), `show_file` (open a file in the UI). | `tool()`, `createSdkMcpServer()` | P1 |
| FR-CTOOL-02 | Webhook tools defined in the UI: name, description, input JSON schema, HTTP endpoint and method; the handler posts the arguments and returns the response (text, image, resource or `structuredContent`). Annotations editable. | `tool()` + `ToolAnnotations`, `CallToolResult`, `isError` | P2 |
| FR-CTOOL-03 | Per-tool approval policy for in-process tools: always ask / always deny; changeable live. | `McpServerToolPolicy.permission_policy`, `setMcpServers()` | P2 |
| FR-CTOOL-04 | Tool search hints: always-load flag and search hint per tool / server. | `tool(..., { searchHint, alwaysLoad })`, `createSdkMcpServer({ alwaysLoad })` | P2 |
| FR-CTOOL-05 | Replace a built-in tool with an MCP implementation (e.g. route `Bash` to a sandboxed executor). | `Options.toolAliases` | P2 |

### 5.19 Hooks (FR-HOOK)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-HOOK-01 | Hook rules editor: choose an event (all 33 events, grouped: Tools, Prompt, Session, Agents & tasks, Compaction, Model, Permissions, MCP, Config & files, Display), a matcher (tool name pattern, e.g. `Bash`, `Edit\|Write`, `mcp__.*`), a timeout, and an action. | `Options.hooks`, `HookCallbackMatcher` | P1 |
| FR-HOOK-02 | Built-in action types compiled to callbacks: **Block** (with reason) / **Allow** / **Ask** / **Defer** for PreToolUse; **Rewrite input** (JSON patch template); **Add context** (text injected for Claude); **Set session title**; **Rewrite tool output**; **Notify** (browser notification); **Log** (audit log); **Webhook** (POST input, use JSON reply as the hook output); **Async** (fire and forget). | `SyncHookJSONOutput` (`decision`, `hookSpecificOutput.*`, `continue`, `stopReason`, `systemMessage`, `suppressOutput`), `AsyncHookJSONOutput` | P1 |
| FR-HOOK-03 | Built-in hooks that ship enabled: audit log of tool calls (PostToolUse), notifications on Notification / PermissionRequest / Stop / StopFailure, session title from first prompt (UserPromptSubmit). | Hooks | P1 |
| FR-HOOK-04 | Hook activity: show hook start / progress / response in the event inspector and as subtle markers on tool cards. | `Options.includeHookEvents`, `SDKHookStarted/Progress/ResponseMessage` | P1 |
| FR-HOOK-05 | Read-only view of filesystem hooks from settings files (command / http / mcp_tool / prompt / agent types). | `resolveSettings()` | P2 |
| FR-HOOK-06 | Hooks can be changed for a live session from the next turn. | `applyFlagSettings({ hooks })` (settings hooks) | P2 |

### 5.20 Skills and commands (FR-SKILL)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-SKILL-01 | Skills list for the workspace (project, user, plugin, bundled), with description and whether the user and/or Claude may invoke it. | init `skills`, `supportedCommands()` | P1 |
| FR-SKILL-02 | Choose which skills a profile enables: all, or a named list. | `Options.skills` (`'all'` or names) | P1 |
| FR-SKILL-03 | Create / edit a skill (`.claude/skills/<name>/SKILL.md` + frontmatter) in an editor, then reload it into live sessions. | `reloadSkills()` | P2 |
| FR-SKILL-04 | Dispatch commands from the palette; `/compact`, `/clear`, `/context`, `/usage` have dedicated buttons. | Prompt `/name args` | P0 |

### 5.21 Plugins (FR-PLUG)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-PLUG-01 | Register local plugin folders; choose per profile; optionally skip their MCP servers. | `Options.plugins` (`SdkPluginConfig`, `skipMcpDiscovery`) | P1 |
| FR-PLUG-02 | Show loaded plugins and plugin errors from session init; install progress messages. | init `plugins`, `plugin_errors`, `SDKPluginInstallMessage` | P1 |
| FR-PLUG-03 | Reload plugins (and add folders) in a live session; warn when a reload invalidates the prompt cache. | `reloadPlugins({ addPlugins, holdOnCacheImpact })` | P2 |

### 5.22 System prompt, memory and output style (FR-PROMPT)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-PROMPT-01 | Profile system prompt: Claude Code preset (default), preset + appended text, custom prompt (with static/dynamic split for caching), or minimal. Option to exclude dynamic sections. Note that it is fixed for the session's life. | `Options.systemPrompt` (`preset`, `append`, `excludeDynamicSections`, `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`) | P0 |
| FR-PROMPT-02 | Setting sources per profile (user / project / local) with the explanation of what each loads (settings, CLAUDE.md, rules, skills, commands, agents, hooks). | `Options.settingSources` | P0 |
| FR-PROMPT-03 | CLAUDE.md and rules viewer / editor for project, local and user levels; list which instruction files loaded in a session. | Files; `InstructionsLoaded` hook; `getContextUsage().memoryFiles` | P1 |
| FR-PROMPT-04 | Output styles: pick per session, save to local settings, reload after editing. | `settings.outputStyle`, `updateSettings('localSettings', { outputStyle })`, `reloadOutputStyles()`, init `output_style` | P2 |
| FR-PROMPT-05 | Auto memory folder viewer. | `~/.claude/projects/<project>/memory/` | P2 |

### 5.23 Profiles and settings (FR-CFG)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-CFG-01 | Profiles: named presets of SDK options (model, effort, thinking, mode, tools preset or list, allowed / disallowed tools, prompt, setting sources, MCP servers, agents, skills, plugins, hooks, limits, checkpointing, sandbox, env). Duplicate, import / export JSON. One default profile. | `Options` | P0 |
| FR-CFG-02 | Tools availability: Claude Code preset or an explicit list of built-in tools. | `Options.tools` | P1 |
| FR-CFG-03 | Inline settings layer per profile (JSON, validated), and live changes to a running session (permissions, hooks, effort, model, agent, fast mode, skill overrides). | `Options.settings`, `applyFlagSettings()` | P1 |
| FR-CFG-04 | Environment variables per profile, merged over the server's environment (timeouts, retries, stream watchdog, client app ID). | `Options.env` (`API_TIMEOUT_MS`, `CLAUDE_CODE_MAX_RETRIES`, `CLAUDE_CODE_RETRY_WATCHDOG`, `CLAUDE_ENABLE_STREAM_WATCHDOG`, `CLAUDE_AGENT_SDK_CLIENT_APP`, …) | P1 |
| FR-CFG-05 | Command sandbox: enable, fail if unavailable, auto-allow Bash when sandboxed, excluded commands, allow unsandboxed fallback, network (allowed / denied domains, strict allowlist, local binding, Unix sockets, proxy ports), filesystem (allow / deny write, deny read), ignored violations. | `Options.sandbox` (`SandboxSettings`) | P1 |
| FR-CFG-06 | Runtime: Claude Code executable path override, JS runtime and its args, extra CLI args. | `pathToClaudeCodeExecutable`, `executable`, `executableArgs`, `extraArgs` | P2 |
| FR-CFG-07 | Policy-tier settings supplied by the app (e.g. hard deny rules that profiles cannot loosen). | `Options.managedSettings` | P2 |
| FR-CFG-08 | Run sessions in a container or VM via a custom spawner (advanced). | `Options.spawnClaudeCodeProcess` (`SpawnOptions`, `SpawnedProcess`) | P2 |
| FR-CFG-09 | Built-in tool behaviour options. | `Options.toolConfig` | P1 |

### 5.24 Structured output jobs (FR-JOB)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-JOB-01 | Job templates: prompt (with variables), workspace, profile, JSON Schema (editor with validation and example), limits. | `Options.outputFormat: { type: 'json_schema', schema }` | P1 |
| FR-JOB-02 | Run a job (single-message mode), watch it stream, see the validated JSON result, cost and turns; failure shows `error_max_structured_output_retries`. | `structured_output`, result subtypes | P1 |
| FR-JOB-03 | Run history per template; open a job's session as a normal session to follow up. | `session_id`, `resume` | P2 |

### 5.25 Observability and debugging (FR-OBS)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-OBS-01 | Event inspector per session: every raw `SDKMessage` in order with type / subtype filters, search, JSON tree, copy; pause / resume live tail. | All message types | P1 |
| FR-OBS-02 | Claude Code stderr and debug logs viewer; debug mode toggle and log file. | `Options.stderr`, `debug`, `debugFile` | P1 |
| FR-OBS-03 | OpenTelemetry export settings (metrics, logs, traces; endpoint; what sensitive data to include). | env `OTEL_*`, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`, `OTEL_LOG_*` | P2 |
| FR-OBS-04 | Control-request progress shown for slow operations (e.g. "reloading plugins…"). | `SDKControlRequestProgressMessage` | P2 |

### 5.26 Authentication and provider (FR-AUTH)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-AUTH-01 | Provider setup per profile: Claude subscription via the user's Claude Code login (FR-AUTH-04), Anthropic API key, Amazon Bedrock, Google Cloud Agent Platform (Vertex), Microsoft Foundry, or an LLM gateway base URL. API keys and cloud secrets are stored server-side only and injected as env vars. | env `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `ANTHROPIC_BASE_URL` | P0 |
| FR-AUTH-02 | Account card: email / organization / subscription / token and key source; auth status messages. | `accountInfo()` → `AccountInfo`, init `apiKeySource`, `SDKAuthStatusMessage` | P0 |
| FR-AUTH-03 | Connection test on save (start a minimal session, report the result or startup failure reason). | `startup()`, `startup_failure_reason` | P1 |
| FR-AUTH-04 | **Use the user's own Claude Code login (Claude subscription).** The user signs in themselves by running the official `claude` CLI and `/login` in their own terminal. Code Agent starts sessions with the unmodified Claude Code binary — the SDK's bundled binary by default, or the user's installed `claude` — and a Claude config directory chosen per profile: default `~/.claude`, the server's `CLAUDE_CONFIG_DIR`, or a custom directory (e.g. separate work and personal accounts). Claude Code reads its own credentials. Rules: Code Agent never offers a sign-in UI, never proxies OAuth, and never reads, copies, stores, transmits or displays credential files or tokens (`.credentials.json`, `CLAUDE_CODE_OAUTH_TOKEN`); for these sessions it removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` from the child environment (they outrank the subscription login) and says so in the UI; it shows which credential is active and the plan; when Claude Code is not signed in, it shows instructions (`claude` → `/login`) and a "check again" action; session history is read from the same config directory. Personal, single-user use; see §1.4. | `env.CLAUDE_CONFIG_DIR`, `pathToClaudeCodeExecutable`, `accountInfo()`, `auth_status`, assistant error `authentication_failed` | P0 |

### 5.27 Notifications (FR-NTF)

| ID | Requirement | Source | Pri |
| --- | --- | --- | --- |
| FR-NTF-01 | Browser notifications (opt-in) and tab title badge for: approval / question pending, turn finished while tab hidden, background task finished, error. | `session_state_changed`, `task_notification`, results | P0 |
| FR-NTF-02 | Agent-initiated notifications via the `notify_user` app tool and the `Notification` hook. | FR-CTOOL-01, hooks | P1 |

### 5.28 Worktrees, schedules and other session events (FR-MISC)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-MISC-01 | Show working-directory changes, added directories and worktree creation / removal in the transcript and session header. | `CwdChanged`, `DirectoryAdded`, `WorktreeCreate`, `WorktreeRemove` hooks; `EnterWorktree` | P2 |
| FR-MISC-02 | Session-scoped scheduled prompts panel (list, cancel). | `CronCreate/List/Delete` | P2 |
| FR-MISC-03 | Watch files and react (reload config) via hooks. | `FileChanged`, `ConfigChange` hooks, `watchPaths` | P2 |
| FR-MISC-04 | Handle `worker_shutting_down` by showing the reason and offering to resume. | `SDKWorkerShuttingDownMessage` | P1 |

### 5.29 Internationalization and localization (FR-I18N)

| ID | Requirement | SDK surface | Pri |
| --- | --- | --- | --- |
| FR-I18N-01 | UI languages at launch: Simplified Chinese (`zh-CN`) and English (`en`). Adding a locale needs only a resource file, no code change. | — | P0 |
| FR-I18N-02 | Language selection: default follows the browser (`navigator.languages`), falling back to English; switch from the top bar or Settings → Language & region; applies immediately without reload; saved server-side in the user's preferences. | — | P0 |
| FR-I18N-03 | Resources: every UI string is a key in a message catalog (ICU MessageFormat for plurals and variables); missing translations fall back to English; CI fails on missing or unused keys; translation coverage shown in settings. | — | P0 |
| FR-I18N-04 | Locale formatting via `Intl`: dates and times, relative times, numbers and token counts, durations, time zone (system). Money is always shown in USD (the SDK estimates in USD), formatted for the locale, never currency-converted. | `total_cost_usd`, timestamps | P0 |
| FR-I18N-05 | Claude's response language per profile and per session: follow the UI language (default), leave it to the conversation, or a named language. Implemented with the `language` setting, which also sets the language of auto-generated session titles; fixed at session start. | `Options.settings.language` | P1 |
| FR-I18N-06 | Content from the SDK and third parties: SDK codes (result subtypes, `SDKAssistantMessageError`, `startup_failure_reason`, permission modes, MCP status, structured decision reasons) map to localized messages, with the original code / text available under "details" (optionally expanded by default). Descriptions written by skill, plugin, MCP or agent authors, tool names, command output and file content are shown as-is, never machine-translated. Claude-generated content follows FR-I18N-05. | All message types | P0 |
| FR-I18N-07 | Input method editors: Enter never sends or submits while an IME composition is active (`isComposing` / keyCode 229) — composer, approval feedback, question "Other", search and every other Enter-to-submit field. Not configurable. | — | P0 |
| FR-I18N-08 | CJK text and paths: font stacks with CJK fallbacks; truncation by measured width; search over sessions, events and commands works without word boundaries; non-ASCII paths and file names (e.g. Chinese folder names on Windows) work end to end in UTF-8; CSV exports include a BOM for spreadsheet apps. | `cwd`, file tools | P0 |
| FR-I18N-09 | Keyboard shortcuts avoid common IME toggles (Ctrl/Shift + Space) and their labels are localized. | — | P1 |
| FR-I18N-10 | Documentation in both languages: requirements and user docs exist in Simplified Chinese and English and are updated together; code, identifiers and commit messages stay in English. | — | P1 |

---

## 6. Non-functional requirements

| ID | Area | Requirement |
| --- | --- | --- |
| NFR-01 | Latency | Browser renders a stream delta within 50 ms of the server receiving it. First-token time is shown per turn. Warm start (FR-SES-04) targets < 1 s to first request. |
| NFR-02 | Reliability | A browser disconnect never stops a live session. The server keeps the last N (default 5 000) events per session for replay. Approval callbacks stay pending until answered, the session is stopped, or a configurable timeout denies them. |
| NFR-03 | Resource limits | Configurable maximum of live sessions (default 6; each process uses roughly 250 MB); idle live sessions can be suspended (closed) after a timeout and resumed on demand. |
| NFR-04 | Security | Server binds to `127.0.0.1` by default; a random access token is required for every request (shown on first start). API keys never reach the browser; Claude subscription credentials are never read at all. HTML from previews and MCP apps renders in sandboxed iframes with a strict CSP. Destructive actions (delete session, bypass mode, rewind) require confirmation. |
| NFR-05 | Compatibility | Windows 10+ (primary), macOS, Linux; Node.js 22 LTS; evergreen Chromium / Firefox / Safari. Windows paths and PowerShell tool supported. |
| NFR-06 | Version awareness | Read `claude_code_version` and `capabilities` from session init; hide or disable features the running Claude Code version does not support. |
| NFR-07 | Accessibility | Full keyboard operation (see prototype "Global interactions"), visible focus, ARIA live region for streaming text, colour is never the only signal. |
| NFR-08 | Internationalization | See FR-I18N: Simplified Chinese and English at launch, more locales by adding resource files. |
| NFR-09 | Branding | Complies with §1.3. |
| NFR-10 | Data | App data in one directory, human-readable exports; no telemetry leaves the machine unless the user configures OpenTelemetry. |

---

## 7. Information architecture

```
App shell
├── Top bar: product name · workspace switcher · approvals inbox · warm pool · language switch · account
├── Nav rail
│   ├── Sessions        → Home (workspaces) · Session history · Live session tabs
│   ├── Agents          → Subagent library and editor
│   ├── MCP             → Server registry, status, tools, custom/webhook tools
│   ├── Skills          → Skills, commands, plugins
│   ├── Hooks           → Hook rules and activity
│   ├── Jobs            → Structured output job templates and runs
│   ├── Usage           → Cost and usage dashboard
│   └── Settings        → Profiles, provider/auth, permissions rules, sandbox, env, prompt & memory, language & region, advanced
└── Live session view
    ├── Header: title · state · model · effort · permission mode · context meter · cost · stop
    ├── Transcript: messages, thinking, tool cards, subagent cards, banners
    ├── Interaction area: approval card / question panel / plan review / composer with queue
    └── Inspector (tabs): Tasks · Background · Changes · Checkpoints · Context · Session info · Events
```

Screen-by-screen layouts and interaction details are in the prototype (§11).

---

## 8. App data model (Code Agent's own data)

| Entity | Key fields |
| --- | --- |
| `Workspace` | id, path, display name, pinned, last opened, default profile |
| `Profile` | id, name, description, auth mode (subscription / API key / cloud provider / gateway), Claude config directory, Claude Code executable, response language, `options` (serializable subset of SDK `Options`), env (secret refs), created / updated |
| `Secret` | id, provider kind, encrypted value (OS keychain when available); never holds Claude subscription credentials |
| `McpServerEntry` | id, name, type (stdio / http / sse / sdk / webhook-tools), config, enabled by default |
| `AgentEntry` | id, name, `AgentDefinition`, source (app) |
| `HookRule` | id, event, matcher, timeout, action type, action config, enabled, scope (global / profile) |
| `WebhookTool` | id, server name, tool name, description, input schema, endpoint, method, annotations |
| `JobTemplate` / `JobRun` | template: prompt, schema, profile, workspace; run: session id, status, result JSON, cost |
| `CostEntry` | session id, workspace, profile, result subtype, `total_cost_usd`, `modelUsage`, timestamps |
| `SessionMeta` | session id, workspace, profile used, fork parent, pinned (SDK keeps title and tag) |
| `CheckpointRef` | session id, user message uuid, label, files changed (cached) |
| `UiPrefs` | theme, UI language (or "follow browser"), number style, show-raw-SDK-text default, notification opt-ins, layout sizes |

---

## 9. Server interface (draft)

### 9.1 REST (selected)

| Method & path | Purpose |
| --- | --- |
| `GET /api/workspaces`, `POST /api/workspaces` | Recent / pinned workspaces |
| `GET /api/fs/browse?path=` | Folder picker (server filesystem) |
| `GET /api/settings/resolve?cwd=` | `resolveSettings()` |
| `GET /api/sessions?dir=&tag=&q=` | `listSessions()` (+ app meta) |
| `GET /api/sessions/:id/messages?offset=&limit=` | `getSessionMessages()` |
| `POST /api/sessions` | Start live session (profile, workspace, overrides, first prompt) |
| `POST /api/sessions/:id/resume` | Resume (optional fork, resume-at, new limits) |
| `POST /api/sessions/:id/fork` | `forkSession()` |
| `PATCH /api/sessions/:id` | Rename / tag |
| `DELETE /api/sessions/:id` | `deleteSession()` |
| `GET/PUT /api/profiles…`, `/api/mcp…`, `/api/agents…`, `/api/hooks…`, `/api/jobs…`, `/api/secrets…` | Registries |
| `GET /api/auth/status?profile=` | Active credential kind, plan and sign-in state (from `accountInfo()`, never credentials) |
| `GET/PUT /api/prefs` | User preferences incl. UI language |
| `GET /api/i18n/:locale` | Message catalog |
| `GET /api/usage?from=&to=&groupBy=` | Cost ledger |

### 9.2 WebSocket messages

Client → server (all carry `sessionId`):

`input.send {content, images, pastes, priority, shouldQuery, verbatim}` ·
`input.cancelQueued {uuid}` · `turn.interrupt` · `session.stop` ·
`approval.respond {requestId, behavior, updatedInput?, updatedPermissions?, message?, interrupt?}` ·
`question.respond {requestId, answers, response?, annotations?}` ·
`elicitation.respond {requestId, action, content?}` ·
`mode.set {mode}` · `model.set {model}` · `settings.apply {partial}` ·
`task.stop {taskId}` · `task.background {toolUseId?}` ·
`rewind.preview {uuid}` · `rewind.apply {uuid}` ·
`mcp.toggle {name, enabled}` · `mcp.reconnect {name}` · `mcp.set {servers}` · `mcp.override {name, mode}` ·
`context.get {detail}` · `reload {what: skills|plugins|outputStyles}` · `file.read {path}`

Server → client:

`sdk.message {seq, message}` (normalized `SDKMessage`, with a monotonically increasing `seq` for
replay) · `approval.request {requestId, toolName, input, options}` ·
`question.request {requestId, questions}` · `elicitation.request {requestId, …}` ·
`approval.resolved {requestId, by}` · `session.state {state}` · `session.closed {reason}` ·
`control.result {requestRef, result | error}` · `replay.begin/end {fromSeq}`

Errors cross the protocol as code + original text; the browser localizes them (FR-I18N-06).

---

## 10. Milestones

| Milestone | Content |
| --- | --- |
| **M0** (this round) | Requirements (English and Chinese), interaction prototype, repository skeleton docs |
| **M1 — core** | Server + web skeleton; i18n framework with zh-CN and en, IME-safe inputs; provider setup incl. the user's own Claude Code login; profiles (basic); start / resume / list / rename / tag sessions; streaming transcript with thinking and tool cards; composer with images, slash palette, queue and interrupt; approvals; AskUserQuestion; plan review; permission mode and model switch; cost and context meter; tasks panel; background tasks; checkpoint rewind; notifications; reconnect |
| **M2 — configuration** | MCP registry and live control; agents library; skills and plugins; hooks editor; system prompt / setting sources / CLAUDE.md editor; sandbox; env; fork and branch-from-here; changes panel; context inspector; cost ledger dashboard; jobs; event inspector |
| **M3 — advanced** | Warm pool; session store mirror; webhook tools and tool policies; MCP apps widgets and elicitation URL mode; output styles; fast mode / ultracode / task budget; OpenTelemetry; custom spawner; worktree and schedule panels |

---

## 11. Interaction prototype

The prototype is a static web page (`docs/prototype/index.html`, open directly in a browser); its
UI text is Simplified Chinese. Every
screen's UI and layout is drawn as SVG; numbered markers on each screen link to a table describing
the interaction, the resulting behaviour and the SDK call involved. Each screen lists the
requirement IDs it covers.

| Screen | Topic | Screen | Topic |
| --- | --- | --- | --- |
| P01 | Architecture and navigation map | P13 | MCP servers |
| P02 | Home — workspaces | P14 | MCP elicitation |
| P03 | New session dialog | P15 | Agents library and editor |
| P04 | Live session — streaming transcript | P16 | Skills, commands and plugins |
| P05 | Composer — commands, mentions, attachments, queue | P17 | Hooks |
| P06 | Tool approval | P18 | Structured output jobs |
| P07 | Clarifying questions | P19 | Usage and cost |
| P08 | Plan review | P20 | Settings — profiles |
| P09 | Subagents and background work | P21 | Settings — permission rules and sandbox |
| P10 | Checkpoints and rewind | P22 | Settings — provider (incl. Claude subscription), account, environment |
| P11 | Context and cost | P23 | Event inspector |
| P12 | Session history — resume, fork, manage | P24 | Session states and messages |
| | | P25 | Settings — language and region |

---

## 12. Open decisions

| # | Question | Proposal |
| --- | --- | --- |
| D1 | Product name | Keep "Code Agent" (repository name); allowed by the branding rules |
| D2 | Frontend framework | React + Vite + TypeScript |
| D3 | App storage | SQLite (`better-sqlite3`) in `~/.code-agent/` |
| D4 | Default authentication | The user's own Claude Code login (FR-AUTH-04) when one is detected, otherwise an API key; cloud providers and gateways per profile |
| D5 | Remote access (open the UI from another device) | Not in phase 1; localhost only, token-protected |
| D6 | Default UI language | Follow the browser language (zh-CN or en), falling back to English |
| D7 | Distributing Code Agent to other people | Not planned. If it happens, confirm with Anthropic whether subscription-login mode (FR-AUTH-04) may be offered, or ship API-key / cloud-provider modes only |

---

## 13. SDK coverage matrix

Every public surface of the TypeScript Agent SDK and where this document covers it.
"Internal" means used by the implementation without a dedicated UI.

### 13.1 Functions

| Function | Covered by |
| --- | --- |
| `query()` | FR-SES-01 |
| `startup()` → `WarmQuery` | FR-SES-04, FR-AUTH-03 |
| `prewarm()` → `SpareProcess` | FR-SES-04 |
| `tool()`, `createSdkMcpServer()` | FR-CTOOL-01..04, FR-MCP-01 |
| `listSessions()` | FR-SES-05, FR-WS-05 |
| `getSessionMessages()` | FR-SES-06, FR-SES-15 |
| `getSessionInfo()` | FR-SES-06 (header of a past session) |
| `renameSession()`, `tagSession()` | FR-SES-08 |
| `forkSession()` | FR-SES-10, FR-CKPT-04 |
| `deleteSession()` | FR-SES-09 |
| `resolveSettings()` | FR-WS-04, FR-HOOK-05 |
| `extractFromBunfs()`, `/core` entry, `InMemorySessionStore` | Internal / packaging (not needed for a Node server) |

### 13.2 `Options`

| Option | Covered by | Option | Covered by |
| --- | --- | --- | --- |
| `abortController` | FR-SES-13 | `mcpServers` | FR-MCP-01 |
| `additionalDirectories` | FR-WS-02 | `model` | FR-MOD-01 |
| `agent` | FR-AGT-03 | `onElicitation` | FR-MCP-06 |
| `agents` | FR-AGT-01/02 | `outputFormat` | FR-JOB-01 |
| `agentProgressSummaries` | FR-AGT-04 | `pathToClaudeCodeExecutable` | FR-CFG-06, FR-AUTH-04 |
| `allowDangerouslySkipPermissions` | FR-PERM-02 | `permissionMode` | FR-PERM-01 |
| `allowedTools` | FR-PERM-08 | `permissionPromptToolName` | FR-PERM-13 |
| `betas` | FR-MOD-08 | `permissionPrompts` | FR-PERM-10 |
| `canUseTool` | FR-PERM-03/04, FR-ASK, FR-PLAN | `persistSession` | FR-SES-03 |
| `continue` | FR-SES-07 | `planModeInstructions` | FR-PLAN-02 |
| `cwd` | FR-WS-01 | `plugins` | FR-PLUG-01 |
| `debug`, `debugFile` | FR-OBS-02 | `projectConfigRoot` | FR-WS-03 |
| `disallowedTools` | FR-PERM-08 | `promptSuggestions` | FR-IN-10 |
| `effort` | FR-MOD-03 | `resume` | FR-SES-07 |
| `enableFileCheckpointing` | FR-CKPT-01 | `resumeSessionAt`, `resumeDropsTurn` | FR-SES-11 |
| `env` | FR-CFG-04, FR-AUTH-01/04 | `sandbox` | FR-CFG-05 |
| `executable`, `executableArgs`, `extraArgs` | FR-CFG-06, FR-CKPT-01 | `sessionId` | FR-SES-02 |
| `fallbackModel` | FR-MOD-02 | `sessionStore`, `sessionStoreFlush`, `loadTimeoutMs` | FR-SES-16 |
| `forkSession` | FR-SES-10 | `settings` | FR-CFG-03, FR-I18N-05 |
| `forwardSubagentText` | FR-AGT-04 | `settingSources` | FR-PROMPT-02 |
| `hooks` | FR-HOOK-01..03 | `skills` | FR-SKILL-02 |
| `includeHookEvents` | FR-HOOK-04 | `spawnClaudeCodeProcess` | FR-CFG-08 |
| `includePartialMessages` | FR-OUT-01 | `stderr` | FR-OBS-02 |
| `managedSettings` | FR-CFG-07 | `strictMcpConfig` | FR-MCP-04 |
| `maxBudgetUsd` | FR-COST-01 | `systemPrompt` | FR-PROMPT-01 |
| `maxThinkingTokens` (deprecated) | Superseded by `thinking`, FR-MOD-04 | `taskBudget` | FR-MOD-07 |
| `maxTurns` | FR-COST-01 | `thinking` | FR-MOD-04, FR-OUT-02 |
| `title` | FR-SES-02 | `toolAliases` | FR-CTOOL-05 |
| `toolConfig` | FR-CFG-09, FR-ASK-03 | `tools` | FR-CFG-02 |
| `verbatimPrompts` | FR-IN-09 | | |

### 13.3 `Query` methods

| Method | Covered by | Method | Covered by |
| --- | --- | --- | --- |
| async iteration | FR-OUT-* | `readFile()` | FR-FILE-02, FR-BG-04 |
| `interrupt()` | FR-IN-07 | `reloadPlugins()` | FR-PLUG-03 |
| `rewindFiles()` | FR-CKPT-03 | `reloadSkills()` | FR-SKILL-03 |
| `setPermissionMode()` | FR-PERM-01, FR-PLAN-01 | `reloadOutputStyles()` | FR-PROMPT-04 |
| `setModel()` | FR-MOD-01 | `seedReadState()` | FR-FILE-03 |
| `setMaxThinkingTokens()` (deprecated) | Superseded by FR-MOD-04 | `accountInfo()` | FR-AUTH-02/04 |
| `applyFlagSettings()` | FR-CFG-03, FR-MOD-03/05/06, FR-AGT-03, FR-HOOK-06 | `reconnectMcpServer()` | FR-MCP-03 |
| `updateSettings()` | FR-MOD-03, FR-PROMPT-04 | `toggleMcpServer()` | FR-MCP-03 |
| `initializationResult()` | FR-SES-17 | `setMcpServers()` | FR-MCP-03, FR-CTOOL-03 |
| `reinitialize()` | FR-SES-14, FR-PERM-07 | `setMcpPermissionModeOverride()` | FR-PERM-11 |
| `supportedCommands()` | FR-IN-05 | `readMcpResource()` | FR-MCP-08 |
| `supportedModels()` | FR-MOD-01 | `streamInput()` | FR-SES-01 (input queue) |
| `supportedAgents()` | FR-AGT-01 | `stopTask()` | FR-BG-02 |
| `mcpServerStatus()` | FR-MCP-02 | `backgroundTasks()` | FR-BG-03 |
| `getContextUsage()` | FR-CTX-01/02 | `close()` | FR-SES-13 |

### 13.4 Message types

| Message (`type` / `subtype`) | Covered by |
| --- | --- |
| `assistant` (`SDKAssistantMessage`, incl. `error`, `aborted`, `context_usage`, `usage_report`) | FR-OUT-01..07, FR-CTX-01 |
| `user` (`SDKUserMessage`), `SDKUserMessageReplay` | FR-IN-*, FR-OUT-10, FR-CKPT-01 |
| `result` (success / error subtypes) | FR-OUT-06/07, FR-COST-*, FR-JOB-02, FR-PERM-09 |
| `system/init` | FR-SES-17 |
| `stream_event` | FR-OUT-01/03 |
| `system/compact_boundary`, `system/status` | FR-CTX-03, FR-OUT-08 |
| `system/informational`, `system/local_command_output` | FR-OUT-09 |
| `system/hook_started`, `hook_progress`, `hook_response` | FR-HOOK-04 |
| `system/plugin_install` | FR-PLUG-02 |
| `tool_progress`, `tool_use_summary` | FR-OUT-03/04 |
| `auth_status` | FR-AUTH-02 |
| `system/task_started`, `task_progress`, `task_updated`, `task_notification`, `background_tasks_changed` | FR-BG-01..05, FR-AGT-04 |
| `system/thinking_tokens` | FR-OUT-02 |
| `system/session_state_changed` | FR-SES-12, FR-PERM-06 |
| `system/worker_shutting_down` | FR-MISC-04 |
| `system/commands_changed` | FR-IN-05 |
| `system/files_persisted` | FR-OUT-11 |
| `rate_limit_event` | FR-OUT-08, FR-COST-04 |
| `system/permission_denied` | FR-PERM-09 |
| `prompt_suggestion` | FR-IN-10 |
| API retry, model refusal fallback / no fallback | FR-OUT-08 |
| `system/control_request_progress` | FR-OBS-04 |
| `conversation_reset` | FR-CTX-03 |
| notification, memory recall, elicitation complete, mirror error | FR-OBS-01 (inspector), FR-NTF-01, FR-MCP-06, FR-SES-16 |

### 13.5 Hook events (33)

| Group | Events | Covered by |
| --- | --- | --- |
| Tools | `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch` | FR-HOOK-01..03, FR-PERM-12 |
| Prompt and display | `UserPromptSubmit`, `UserPromptExpansion`, `MessageDisplay` | FR-HOOK-02, FR-OUT-12 |
| Session | `SessionStart`, `SessionEnd`, `Setup`, `Stop`, `StopFailure`, `Notification` | FR-HOOK-03, FR-NTF-02 |
| Agents and tasks | `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted` | FR-AGT-04, FR-TODO |
| Compaction | `PreCompact`, `PostCompact` | FR-CTX-03 |
| Model | `PreModelSwitch`, `PostModelSwitch` | FR-MOD-01 |
| Permissions | `PermissionRequest`, `PermissionDenied` | FR-PERM-06/09 |
| MCP | `Elicitation`, `ElicitationResult` | FR-MCP-06 |
| Config and files | `ConfigChange`, `InstructionsLoaded`, `DirectoryAdded`, `WorktreeCreate`, `WorktreeRemove`, `CwdChanged`, `FileChanged` | FR-PROMPT-03, FR-MISC-01/03 |

### 13.6 Built-in tools

| Tools | Covered by |
| --- | --- |
| `Bash`, `PowerShell`, `Monitor`, `TaskStop`, `TaskOutput` (removed) | FR-TOOL-01/11, FR-BG |
| `Read`, `Edit`, `Write`, `NotebookEdit`, `Glob`, `Grep`, `LSP` | FR-TOOL-02..04, FR-CKPT |
| `WebFetch`, `WebSearch` | FR-TOOL-05 |
| `Agent`, `Skill`, `Workflow`, `SendMessage`, `ListAgents`, `SubagentHandback` | FR-TOOL-06/07/16, FR-AGT |
| `AskUserQuestion` | FR-ASK |
| `EnterPlanMode`, `ExitPlanMode` | FR-PLAN |
| `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`, `TodoWrite` | FR-TODO |
| `CronCreate`, `CronDelete`, `CronList`, `ScheduleWakeup`, `RemoteTrigger` | FR-TOOL-12, FR-MISC-02 |
| `EnterWorktree`, `ExitWorktree` | FR-TOOL-13, FR-MISC-01 |
| `ListMcpResources`, `ReadMcpResource`, `ReadMcpResourceDir`, `RefreshMcpTools`, `ToolSearch`, `WaitForMcpServers` | FR-TOOL-14, FR-MCP-07 |
| `PushNotification`, `SendUserFile`, `Artifact`, `ReportFindings`, `SendFeedback`, `EndConversation`, others | FR-TOOL-16 (generic card) |

### 13.7 Other types used directly

`AgentDefinition` (FR-AGT-02) · `AgentMcpServerSpec` (FR-AGT-02) · `SettingSource` (FR-PROMPT-02) ·
`PermissionMode` (FR-PERM-01) · `CanUseTool` / `PermissionResult` / `PermissionUpdate` /
`PermissionUpdateDestination` / `PermissionRuleValue` (FR-PERM) · `ToolConfig` (FR-CFG-09) ·
`McpServerConfig` and `McpServerToolPolicy` (FR-MCP, FR-CTOOL) · `SdkPluginConfig` (FR-PLUG) ·
`SlashCommand` (FR-IN-05) · `ModelInfo` (FR-MOD-01) · `AgentInfo` (FR-AGT-01) · `McpServerStatus`
(FR-MCP-02) · `AccountInfo` (FR-AUTH-02) · `ModelUsage` / `Usage` (FR-COST) · `ThinkingConfig`
(FR-MOD-04) · `SandboxSettings` (FR-CFG-05) · `RewindFilesResult` (FR-CKPT-03) ·
`SDKControlGetContextUsageResponse` (FR-CTX-02) · `SDKControlInterruptResponse` (FR-IN-07) ·
`SDKControlInitializeResponse` (FR-SES-17) · `SpawnOptions` / `SpawnedProcess` (FR-CFG-08) ·
`AbortError` (internal) · `BUILTIN_TOOL_NAMES` (FR-CFG-02).
