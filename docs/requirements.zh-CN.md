# Code Agent — 需求规格说明

| 项目 | 内容 |
| --- | --- |
| 文档 | 产品需求，v0.2（草案） |
| 日期 | 2026-10-28 |
| 语言 | 简体中文（本文件）· 英文版：[`requirements.md`](requirements.md) —— 两份保持同步 |
| 范围 | 第一阶段：基于 Claude Agent SDK（TypeScript）的本地单用户 Web 工作台 |
| 技术栈 | Node.js 后端 + 浏览器前端 |
| SDK 基线 | `@anthropic-ai/claude-agent-sdk` 0.3.x（按 0.3.301 / Claude Code 2.1.302 的文档整理） |
| 配套 | 交互稿：[`docs/prototype/index.html`](prototype/index.html) |

> 资料来源：<https://code.claude.com/docs/en/agent-sdk/overview> 及 `/docs/en/agent-sdk/` 下的全部页面
> （32 页，含完整的 TypeScript 参考），以及 Claude Code 的工具参考、认证、设置参考和法律合规页面。
> 第 13 节把 SDK 的每个函数、选项、方法、消息类型、钩子事件和内置工具对应到覆盖它的需求条目。
> 代码标识符、SDK 字段名、命令保持英文原文。

---

## 1. 背景与目标

Claude Agent SDK 把 Claude Code 的 Agent 循环作为库提供：内置工具、权限、会话、钩子、子代理、MCP、
技能、插件、检查点、费用统计等。它本身没有界面：审批提示、澄清提问、计划审阅、任务清单、上下文
用量等所有交互界面都要由宿主应用来做。

**Code Agent** 就是这个宿主应用：一个运行在用户本机的个人 Agent 工作台，由 Node.js 服务驱动
SDK，在浏览器中呈现全部功能。

### 1.1 目标

- **G1 —— 完整覆盖 SDK。** TypeScript Agent SDK 提供的每项能力都能在界面中使用：要么是一等功能，
  要么（对少用的参数）放在高级设置里。第 13 节是核对清单。
- **G2 —— 以交互为先。** 会话一律使用流式输入模式（SDK 推荐的模式），用户可以排队发消息、中断、
  审批工具、回答问题、在会话中途切换模型或权限模式。
- **G3 —— 透明。** 用户随时能看到 Agent 在做什么：流式文本与思考、每次工具调用及其结果、子代理、
  后台任务、钩子、上下文用量和费用。
- **G4 —— 默认安全。** Agent 不会获得超出用户授予的权限；有风险的操作需要审批；文件改动可以预览
  和回退。
- **G5 —— 便于以后扩展。** 服务端用 `AgentRuntime` 边界隔离 SDK，以后可以接入其他 Agent 后端，
  但现在不为此做额外设计。

### 1.2 非目标（第一阶段）

- 多用户 / 多租户托管、账号体系、远程 SaaS 部署。
- 提供 claude.ai 登录流程，或读取、保存、转发 claude.ai 凭据。Code Agent 仍可以使用用户自己在
  官方 Claude Code 里登录的订阅来运行会话（FR-AUTH-04、§1.4）。
- Python SDK、移动端、IDE 插件。
- 重新实现 SDK 未提供的 CLI 专属功能（agent teams、Remote Control、终端界面）。

### 1.3 品牌约束

按 SDK 的品牌规范，产品必须使用自己的名称，**不得**叫「Claude Code」或「Claude Code Agent」，
也不得使用 Claude Code 的 ASCII 字符画或视觉标识。允许：「Code Agent」、「Code Agent — Powered by
Claude」（中文界面可写「由 Claude 驱动」），或在模型/代理菜单中使用「Claude Agent」。

### 1.4 认证约束

依据 Claude Code 法律与合规页面「Authentication and credential use」一节和 Agent SDK 概览
（截至 2026-10-28）：

- 基于 Agent SDK 构建的产品应使用 API Key（Claude Console）或受支持的云厂商认证。第三方开发者
  不得在自己的应用中提供 claude.ai 登录，不得代表其用户经 Free / Pro / Max 凭据转发请求，也不得
  收集、存储或中转 claude.ai 凭据或会话令牌；登录必须通过 Anthropic 自己的流程完成。
- 上述条款不妨碍最终用户用自己的 Claude 订阅登录**未经修改**的 Claude Code 二进制。Pro 和 Max
  的用量上限按普通的个人使用（Claude Code 和 Agent SDK）设计。
- 运行 Claude Code 的产品不得修改其二进制或移除其认证方式，也不得替最终用户付费、转售或中转
  Claude 用量：每个最终用户都用自己的凭据认证。

因此 Code Agent 支持两类凭据：(1) API Key 和云厂商凭据，由 Code Agent 保存在本机服务端；
(2) 用户自己的 Claude 订阅，只通过官方未修改的 Claude Code 二进制使用，Code Agent 完全接触不到
凭据（FR-AUTH-04）。方式 (2) 面向用户在自己电脑上的个人使用。若将来把 Code Agent 分发给他人并
提供方式 (2)，应先向 Anthropic 确认（待定决策 D7）。

---

## 2. 用户与主要场景

**主要用户：** 在本地仓库上工作的个人开发者（以 Windows 为主，同时支持 macOS 和 Linux），熟悉
Claude Code 的概念。

| # | 场景 | 主要能力 |
| --- | --- | --- |
| SC1 | 与 Agent 讨论代码仓库，让它改代码，有风险的步骤由我审批 | 会话、流式输出、工具卡片、审批 |
| SC2 | 先让它出计划，审过之后再执行 | 规划模式、AskUserQuestion、切换模式 |
| SC3 | 撤销一批不理想的改动，或分叉对话尝试另一种做法 | 文件检查点、分叉、从某条消息恢复 |
| SC4 | 长任务（测试、调研子代理）放到后台跑，同时继续对话 | 后台任务、子代理、任务通知 |
| SC5 | 接入外部系统（GitHub、数据库、内部 API） | MCP 服务器、自定义工具、信息征询 |
| SC6 | 定制 Agent：自定义子代理、技能、钩子、系统提示词、输出风格 | 代理、技能、插件、钩子、提示词 |
| SC7 | 运行一次性的提取 / 分析作业，返回有类型的 JSON | 结构化输出、单消息模式 |
| SC8 | 关注费用和上下文，需要时压缩或清空 | 费用统计、上下文用量、/compact、/clear |
| SC9 | 接着昨天的会话继续，或按标签找到以前的会话 | 会话列表、恢复、重命名、标签 |
| SC10 | 排查 Agent 的异常行为 | 原始事件检查器、钩子事件、stderr、OpenTelemetry |
| SC11 | 用中文界面工作，Claude 用中文回复，输入法正常可用 | 多语言、回复语言、输入法处理 |

---

## 3. 术语

| 术语 | 本文含义 |
| --- | --- |
| 工作区 | Agent 工作的目录：SDK 的 `cwd`，可加上 `additionalDirectories` |
| 会话 | 一次 SDK 对话（UUID），以 JSONL 记录保存在 `~/.claude/projects/` 下 |
| 运行中的会话 | 服务端上有 `Query` 对象和 Claude Code 子进程在运行的会话 |
| 轮（Turn） | 一条用户消息及其触发的 Agent 工作，以一条 `SDKResultMessage` 结束 |
| 工具调用 | 模型发出的 `tool_use` 块及对应的 `tool_result` |
| 审批 | 交给 `canUseTool` 回调、需要用户回答的权限请求 |
| 子代理 | 由 `Agent` 工具启动、拥有独立上下文窗口的代理 |
| 后台任务 | 脱离当前轮运行的 Bash 命令、子代理或工作流，通过 `task_*` 消息汇报 |
| 检查点 | 可以用 `rewindFiles()` 把文件还原到的那条用户消息的 UUID |
| 配置方案 | Code Agent 的概念：一组命名并保存的 SDK `Options`，用于启动会话 |
| 钩子规则 | Code Agent 的概念：在界面中定义、编译成 SDK `HookCallback` 的钩子 |
| 设置来源 | SDK 加载哪些文件系统设置：`user`、`project`、`local` |
| 回复语言 | Claude 回复和生成会话标题所用的语言（设置项 `language`） |

---

## 4. 系统概览

### 4.1 架构

```
 浏览器（单页应用）           Node.js 服务（Code Agent）                       Claude Code 进程
┌──────────────┐  HTTP/REST  ┌───────────────────────────────────────┐  stdio  ┌──────────────────┐
│ 视图、状态、 │────────────▶│ API 层（REST + WebSocket）              │        │ Agent 循环、工具  │
│ SVG/DOM 渲染 │◀───────────▶│ SessionManager ── LiveSession × N ────┼───────▶│（官方未修改的     │
└──────────────┘  WebSocket  │   ├ Query（SDK）  ├ 输入队列            │◀───────│  二进制，每会话一个）│
                             │   ├ 待处理的审批 / 提问                 │        └──────────────────┘
                             │   └ 事件环形缓冲（重放）                │
                             │ 注册表：配置方案、MCP、代理、钩子、      │──▶ ~/.claude/**（SDK 数据、登录凭据）
                             │ 作业、费用账本、设置                     │──▶ 应用数据目录（Code Agent）
                             └───────────────────────────────────────┘
```

- **每个运行中的会话一个 `LiveSession`。** 它持有 `query()`（或 `WarmQuery.query()` /
  `SpareProcess.claim()`）返回的 `Query`、由浏览器供数的异步可迭代输入队列、按 `requestId`
  索引的待处理审批 / 提问 / 征询，以及一个有界的标准化事件环形缓冲，供重连的浏览器重放错过的事件。
- **浏览器从不直接接触 SDK，也不持有任何凭据。** 所有 SDK 调用都在服务端进行。
- **多个浏览器标签页可以同时查看同一个会话。** 审批只需回答一次（先到先得），其他标签页同步看到结果。
- **SDK 自有的数据留在 SDK 存放的位置**（会话记录、CLAUDE.md、`.claude/` 目录、设置文件、登录
  凭据）。Code Agent 只在应用数据目录（默认 `~/.code-agent/`）保存自己的数据（配置方案、钩子规则、
  注册表、费用账本、界面偏好），从不读取 Claude 的登录凭据。

### 4.2 建议的仓库结构

```
code-agent/
├── README.md
├── docs/
│   ├── requirements.md          # 需求文档（英文）
│   ├── requirements.zh-CN.md    # 需求文档（中文，本文件）
│   └── prototype/               # SVG 交互稿（静态网页）
├── apps/
│   ├── server/                  # Node.js：REST + WebSocket API、SessionManager、SDK 适配层
│   └── web/                     # 浏览器单页应用（含 locales/ 翻译资源）
├── packages/
│   └── protocol/                # REST / WS 协议的共享 TypeScript 类型
└── （工具链：package.json、pnpm-workspace.yaml、tsconfig.base.json 等）
```

本轮只有 `docs/`；`apps/` 和 `packages/` 在写第一行代码时创建。

### 4.3 技术方案建议（待确认，见 §12）

| 层 | 建议 | 理由 |
| --- | --- | --- |
| 运行时 | Node.js 22 LTS、TypeScript、pnpm workspaces | SDK 以 TypeScript 为主；Node 是指定的技术栈 |
| 服务端 | Fastify + `@fastify/websocket` | 小巧、类型完善、性能好；WS 承载事件流 |
| SDK | `@anthropic-ai/claude-agent-sdk`（根入口） | 根入口包含 `prewarm()` 和会话辅助函数 |
| 前端 | React + Vite + TypeScript，状态用 Zustand | 常用、开发反馈快 |
| 多语言 | 基于 ICU MessageFormat 的 i18n 库（如 FormatJS / i18next）+ `Intl` | 复数、变量、日期数字格式化 |
| 编辑器 | Monaco（JSON Schema、SKILL.md、CLAUDE.md、设置 JSON） | 支持 schema 校验和 Markdown |
| 渲染 | Markdown + 语法高亮、并排 / 统一 diff | 工具结果和编辑展示 |
| 应用存储 | SQLite（`better-sqlite3`），放在应用数据目录 | 费用账本、注册表、配置方案 |

---

## 5. 功能需求

优先级：**P0** = 里程碑 M1（可用的核心），**P1** = M2，**P2** = M3 及以后。每条需求都注明所依赖的
SDK 接口。「运行中」表示该调用需要一个处于流式模式的运行中会话。

### 5.1 工作区（FR-WS）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-WS-01 | 选择工作区目录（服务端文件系统的文件夹选择器、手动输入路径或最近列表），作为 `cwd`。 | `Options.cwd` | P0 |
| FR-WS-02 | 添加 Agent 可访问的额外目录；说明开启 `project` 来源时会加载其中 `.claude/` 的技能、命令和代理。 | `Options.additionalDirectories` | P1 |
| FR-WS-03 | 对 git worktree，可把项目配置指向主检出目录。 | `Options.projectConfigRoot` | P2 |
| FR-WS-04 | 显示工作区的 git 分支，以及最终生效的设置和每个键的来源（「这个值是谁设的？」）。 | `resolveSettings()` → `effective`、`provenance`、`sources` | P1 |
| FR-WS-05 | 首页列出最近的工作区，附会话数和最近活动时间。 | `listSessions({ dir })` | P0 |

### 5.2 会话生命周期（FR-SES）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-SES-01 | 从配置方案和 / 或「新建会话」对话框启动会话。会话一律使用流式输入模式（prompt 为异步可迭代）。 | `query({ prompt: AsyncIterable<SDKUserMessage>, options })` | P0 |
| FR-SES-02 | 创建时可指定标题和固定的会话 UUID。 | `Options.title`、`Options.sessionId` | P1 |
| FR-SES-03 | 「临时」会话，从不写入磁盘（界面标注，之后无法恢复）。 | `Options.persistSession: false` | P1 |
| FR-SES-04 | 预热：为常用配置方案保留一个已初始化的进程，让首条消息即时响应；显示预热池状态。已知工作区时用 `startup()`，未知时用 `prewarm()` + `claim()`。注意预热进程固定了 `mcpServers`、`hooks`、`systemPrompt`、`plugins` 等。 | `startup()`、`WarmQuery`、`prewarm()`、`SpareProcess.claim/claimed/exited/close` | P2 |
| FR-SES-05 | 会话列表：全部或按工作区，按最后修改时间排序，显示标题（自定义 / AI 生成 / 首条提问）、git 分支、标签、大小、创建时间；支持文本搜索、按标签和工作区筛选；包含 worktree 中的会话。 | `listSessions({ dir, limit, includeWorktrees })` → `SDKSessionInfo` | P0 |
| FR-SES-06 | 以只读方式打开历史会话：渲染对话记录，子代理消息嵌套在其父工具调用下，支持分页。 | `getSessionMessages(id, { limit, offset, includeSystemMessages })`、`parent_tool_use_id`、`parent_agent_id` | P0 |
| FR-SES-07 | 恢复会话（使其重新运行），或在工作区中「继续最近的会话」。 | `Options.resume`、`Options.continue` | P0 |
| FR-SES-08 | 重命名会话、打标签（就地编辑）；清除标签。 | `renameSession()`、`tagSession(id, null)` | P0 |
| FR-SES-09 | 删除会话（需确认）。 | `deleteSession()` | P1 |
| FR-SES-10 | 分叉整个会话，或从选中的消息分叉（「从这里分叉」），可指定标题。在列表中显示分叉关系。 | `forkSession(id, { upToMessageId, title })`；与 `resume` 一起使用的 `Options.forkSession` | P1 |
| FR-SES-11 | 从某条消息处恢复（截断之后的轮），用于「编辑后重发」。 | `Options.resumeSessionAt`、`Options.resumeDropsTurn` | P2 |
| FR-SES-12 | 在所有出现会话的地方（列表、标签页、网站图标角标）显示运行状态：空闲 / 运行中 / 需要处理。 | `SDKSessionStateChangedMessage.state` | P0 |
| FR-SES-13 | 同时运行多个会话（标签页）；关闭标签页不会停止会话；明确的「停止会话」才结束进程。 | `Query.close()`、`AbortController` | P0 |
| FR-SES-14 | 浏览器刷新 / 重连后重新接入运行中的会话并重放缓冲的事件；待处理的审批重新出现。 | 服务端环形缓冲；`Query.reinitialize()`；`pending_permission_requests` | P0 |
| FR-SES-15 | 将对话记录导出为 Markdown 或 JSON（UTF-8）。 | `getSessionMessages()` | P1 |
| FR-SES-16 | 可选的外部会话存储（如 SQLite 镜像），清理 `~/.claude` 后记录仍可保留；可配置刷写模式和加载超时。 | `Options.sessionStore`、`sessionStoreFlush`、`loadTimeoutMs`、`SessionStore` 接口 | P2 |
| FR-SES-17 | 会话信息面板：会话 ID、cwd、模型、权限模式、Claude Code 版本、工具、MCP 服务器、技能、插件、斜杠命令、输出风格、能力标志、API Key 来源。 | `SDKSystemMessage`（`subtype: "init"`）、`initializationResult()` | P0 |

### 5.3 输入框与输入（FR-IN）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-IN-01 | 多行输入框；Enter 发送、Shift+Enter 换行（输入法组字时见 FR-I18N-07）；每个会话保留草稿。 | `SDKUserMessage` | P0 |
| FR-IN-02 | 附加图片（粘贴、拖放、选择文件），以 base64 图片块发送并显示缩略图。 | `MessageParam` 内容块 | P0 |
| FR-IN-03 | `@` 引用：工作区文件路径自动补全，以及 MCP 资源（`@server:resource`）。 | Claude Code 的引用展开 | P1 |
| FR-IN-04 | 超过阈值的粘贴文本变成可折叠的「粘贴内容」标签，并以粘贴内容发送，让 Claude 能区分粘贴和手打。 | `SDKUserMessage.pasted_content`、`inline_pastes` | P1 |
| FR-IN-05 | 斜杠命令面板：输入 `/` 列出命令及说明、参数提示、别名和来源（内置 / 技能 / 插件 / MCP 提示），列表实时更新。 | `supportedCommands()`、`SlashCommand`、`SDKCommandsChangedMessage`、init 的 `slash_commands` | P0 |
| FR-IN-06 | 消息队列：一轮进行中仍可继续发送，每条排队消息显示为标签，附投递方式——**立即插入**（`now` + human 来源）、**工具后**（当前工具调用结束后读取）、**下一轮**（作为新一轮）。投递前可编辑或移出。 | `SDKUserMessage.priority`、`origin: { kind: "human" }` | P0 |
| FR-IN-07 | 中断按钮（及 Esc）停止当前轮；界面报告哪些排队消息仍待执行，并可一键取消。 | `Query.interrupt()` → `SDKControlInterruptResponse.still_queued` | P0 |
| FR-IN-08 | 「仅作为上下文」：发送一条只追加、不触发新一轮的消息（如贴一段日志）。 | `SDKUserMessage.shouldQuery: false` | P1 |
| FR-IN-09 | 每条消息可选「原样发送」（不展开 `@`、不执行 `/`）；配置方案可设默认值。 | `client_composed`、`Options.verbatimPrompts` | P2 |
| FR-IN-10 | 下一步提示建议：一轮结束后以灰字显示预测的下一条输入，Tab 接受。 | `Options.promptSuggestions`、`SDKPromptSuggestionMessage` | P1 |

### 5.4 输出流渲染（FR-OUT）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-OUT-01 | 助手文本按 token 流式显示，支持 Markdown 和代码高亮。 | `Options.includePartialMessages`、`SDKPartialAssistantMessage`（`content_block_delta` / `text_delta`） | P0 |
| FR-OUT-02 | 思考块：可折叠、流式、显示耗时；配置方案可选显示摘要或不显示。 | `Options.thinking`（`display`）、`thinking` 块、`SDKThinkingTokensMessage` | P0 |
| FR-OUT-03 | 工具调用以卡片流入（先出工具名，再随生成显示输入），并随进度、耗时和结果更新。 | `content_block_start` / `input_json_delta`、`SDKToolProgressMessage`、`tool_result`、`tool_use_result` | P0 |
| FR-OUT-04 | 连续工具调用折叠成一行摘要（「读取 6 个文件，搜索 2 个模式」）。 | `SDKToolUseSummaryMessage` | P1 |
| FR-OUT-05 | 被中断的消息标记为已截断。 | `SDKAssistantMessage.aborted` | P0 |
| FR-OUT-06 | 每轮底部：总耗时、API 耗时、首 token 时间、轮数、费用、停止原因；拒答单独标示。 | `SDKResultMessage`（`duration_ms`、`duration_api_ms`、`ttft_ms`、`num_turns`、`total_cost_usd`、`stop_reason`） | P0 |
| FR-OUT-07 | 错误横幅，每种都有对应操作：最大轮数 / 最大预算（「提高上限后继续」= 用新上限恢复）、执行错误、结构化输出重试失败、启动失败原因；助手 API 错误（认证、计费、速率限制、过载、模型不存在、输出 token 超限、云凭据）。 | `SDKResultMessage.subtype` / `errors` / `startup_failure_reason`、`SDKAssistantMessageError` | P0 |
| FR-OUT-08 | 临时状态：API 重试中、压缩中、模型拒答 → 回退模型、速率限制预警（含重置时间和使用率）。 | `SDKAPIRetryMessage`、`SDKStatusMessage`（`compacting`）、`SDKModelRefusalFallbackMessage` / `NoFallback`、`SDKRateLimitEvent` | P0 |
| FR-OUT-09 | 提示信息（info / notice / suggestion / warning）和本地命令输出（如 `/context`、`/usage`）。 | `SDKInformationalMessage`、`SDKLocalCommandOutputMessage`、`SDKUsageReport` | P1 |
| FR-OUT-10 | 来自会话外部注入的消息（定时触发、其他会话、频道）标注来源。 | `SDKUserMessageReplay`、`SDKMessageOrigin` | P2 |
| FR-OUT-11 | Agent 发送或持久化的文件显示为可下载附件。 | `SDKFilesPersistedEvent` | P2 |
| FR-OUT-12 | 通过钩子做「仅显示层」改写（如在屏幕上遮盖密钥而不改对话记录）。 | `MessageDisplay` 钩子（`displayContent`） | P2 |

### 5.5 工具调用卡片（FR-TOOL）

每个内置工具有专门的卡片；未知工具回退为 JSON 卡片。工具名保持英文原名。

| 编号 | 工具 | 卡片行为 | 优先级 |
| --- | --- | --- | --- |
| FR-TOOL-01 | `Bash`、`PowerShell` | 命令、说明、实时输出末尾、退出状态、超时；「后台运行」标记；运行中提供「转入后台」按钮。 | P0 |
| FR-TOOL-02 | `Read` | 路径、行范围；可展开预览；图片直接渲染。 | P0 |
| FR-TOOL-03 | `Edit`、`Write`、`NotebookEdit` | 统一 / 并排 diff 及增删行数；打开完整文件。 | P0 |
| FR-TOOL-04 | `Glob`、`Grep`、`LSP` | 模式和结果列表，路径 / 位置可点击。 | P0 |
| FR-TOOL-05 | `WebFetch`、`WebSearch` | URL / 查询词，结果标题和链接。 | P0 |
| FR-TOOL-06 | `Agent` | 子代理卡片：类型、描述、模型、实时状态和进度摘要、嵌套记录（展开）、最终报告、用量。 | P0 |
| FR-TOOL-07 | `Skill` | 技能名和参数；在分叉上下文中运行的技能按子代理方式展示。 | P1 |
| FR-TOOL-08 | `AskUserQuestion` | 交互式提问面板（FR-ASK）。 | P0 |
| FR-TOOL-09 | `TaskCreate/Update/Get/List`、`TodoWrite` | 驱动任务清单面板（FR-TODO）；对话中显示紧凑卡片。 | P0 |
| FR-TOOL-10 | `EnterPlanMode`、`ExitPlanMode` | 计划审阅（FR-PLAN）。 | P0 |
| FR-TOOL-11 | `Monitor`、`TaskStop` | 监视器流及最近事件；停止。 | P1 |
| FR-TOOL-12 | `CronCreate/Delete/List`、`ScheduleWakeup` | 会话内定时任务面板：提示词、cron、下次运行、取消。 | P2 |
| FR-TOOL-13 | `EnterWorktree`、`ExitWorktree` | worktree 路径和分支；工作目录变化提示。 | P2 |
| FR-TOOL-14 | `ListMcpResources`、`ReadMcpResource`、`ToolSearch`、`WaitForMcpServers` | 紧凑的信息卡片。 | P1 |
| FR-TOOL-15 | MCP 工具（`mcp__server__tool`） | 服务器和工具名、来源、输入、text / image / resource / resource_link 输出、`structuredContent` 查看器；MCP Apps 的 `ui://` 组件在沙箱 iframe 中渲染。 | P0（组件为 P2） |
| FR-TOOL-16 | `Workflow`、`SendMessage`、`ListAgents`、`PushNotification`、`SendUserFile`、`RemoteTrigger`、`Artifact`、`ReportFindings` 及其他工具 | 通用 JSON 卡片显示有类型的输入输出；需要时再做专门卡片。 | P2 |

所有卡片：复制输入、复制输出、原始 JSON 切换、耗时，以及让这次调用得以执行的权限决定（被规则 X 自动
批准 / 由用户批准 / 由模式放行）。

### 5.6 权限与审批（FR-PERM）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-PERM-01 | 会话标题栏的权限模式选择器，六种模式附通俗说明：编辑前询问（default）、自动接受编辑、规划模式、自动（分类模型）、不询问（未授权即拒绝）、跳过权限检查。立即生效。模型不支持 `supportsAutoMode` 时隐藏「自动」。 | `Options.permissionMode`、`Query.setPermissionMode()`、`ModelInfo.supportsAutoMode` | P0 |
| FR-PERM-02 | 跳过权限检查需要配置方案中单独开启「允许跳过」并二次确认；启用期间标题栏显示红色标记。 | `Options.allowDangerouslySkipPermissions` | P0 |
| FR-PERM-03 | 每个 `canUseTool` 请求一张审批卡片：工具、输入预览（编辑显示 diff，Bash 显示命令）、原因、被拦截的路径、MCP 服务器及其来源、发起请求的子代理。 | `CanUseTool` 选项：`decisionReason`、`blockedPath`、`mcpServer`、`agentID`、`toolUseID`、`requestId` | P0 |
| FR-PERM-04 | 回答方式：**仅允许这一次**；**允许并记住**（选择一条建议的规则及保存位置：本会话 / 本地 / 项目 / 用户设置）；**修改后允许**（编辑输入 JSON 或命令）；**拒绝**并可附给 Claude 的说明；**拒绝并停止**（中断）。 | `PermissionResult`（`updatedInput`、`updatedPermissions`、`message`、`interrupt`）、`suggestions: PermissionUpdate[]` | P0 |
| FR-PERM-05 | 遵守安全提示：`defaultToNo` 时焦点在「拒绝」且不提供一键批准；`suppressAlwaysAllowRule` 时隐藏「记住」。 | `defaultToNo`、`suppressAlwaysAllowRule` | P0 |
| FR-PERM-06 | 全局审批收件箱（顶栏角标），列出所有运行中会话的待处理请求；会话需要处理时发送浏览器通知。 | `session_state_changed: requires_action`、`PermissionRequest` / `Notification` 钩子 | P0 |
| FR-PERM-07 | 按 `requestId` 幂等处理（重连后重新投递的请求不会提示两次）。 | `requestId`、`reinitialize()` | P0 |
| FR-PERM-08 | 规则编辑器：允许 / 询问 / 拒绝规则及其语法（`Bash(npm run *)`、`Edit(/src/**)`、`WebFetch(domain:…)`、`mcp__server__*`、`Agent(Explore)`、`Skill(name)`）；可按配置方案（`allowedTools` / `disallowedTools`）或按设置文件（项目 / 本地 / 用户）保存。说明判定顺序：钩子 → 拒绝 → 询问 → 模式 → 允许 → 回调。 | `Options.allowedTools`、`disallowedTools`、`settings.permissions`、`PermissionUpdate` | P0 |
| FR-PERM-09 | 按轮和按会话列出被拒绝的调用及原因和输入；可把某次拒绝转为允许规则。 | `SDKResultMessage.permission_denials`、`SDKPermissionDeniedMessage` | P1 |
| FR-PERM-10 | 无人值守配置方案：「不提示」（凡需询问的一律拒绝）。 | `Options.permissionPrompts: 'none'`、`dontAsk` 模式 | P1 |
| FR-PERM-11 | 会话处于跳过权限或自动模式时，为某个 MCP 服务器设置更严格的模式。 | `Query.setMcpPermissionModeOverride()` | P2 |
| FR-PERM-12 | 长时间未处理的审批：可选「延后」，让会话先结束、稍后再决定。 | `PreToolUse` 钩子 `permissionDecision: "defer"` | P2 |
| FR-PERM-13 | 通过 MCP 工具担任审批方（高级）。 | `Options.permissionPromptToolName` | P2 |
| FR-PERM-14 | 当某个配置会悄悄绕过审批回调（`allowedTools` 中只写了工具名、跳过权限模式）时，在配置方案编辑器中提醒。 | `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` 进程警告 | P1 |

### 5.7 澄清提问（FR-ASK）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-ASK-01 | Claude 调用 `AskUserQuestion` 时，在输入框上方显示提问面板：1–4 个问题，每个有标题标签（≤12 字符）、问题文字和 2–4 个带说明的选项；单选或多选。 | `AskUserQuestionInput.questions[]` | P0 |
| FR-ASK-02 | 每个问题都可以填写「其他」；也可以用一段自由文字回答全部问题。 | `updatedInput.answers`、`response` | P0 |
| FR-ASK-03 | 选项带预览（HTML 或 Markdown）时并排显示；HTML 在沙箱 iframe 中渲染。 | `toolConfig.askUserQuestion.previewFormat`、`options[].preview` | P1 |
| FR-ASK-04 | 用户为选项添加的补充说明一并返回。 | `annotations[question].notes` | P2 |
| FR-ASK-05 | 限制了 `tools` 的配置方案必须包含 `AskUserQuestion`，缺少时编辑器提醒。 | `Options.tools` | P1 |

### 5.8 规划模式（FR-PLAN）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-PLAN-01 | Agent 退出规划模式时，把计划显示为文档，提供操作：**批准并自动接受编辑**、**批准（每步询问）**、**批准并使用自动模式**（可用时）、**继续规划**（附意见）。批准时相应切换模式。 | 经 `canUseTool` 的 `ExitPlanMode`、`setPermissionMode()` | P0 |
| FR-PLAN-02 | 规划模式的工作流说明可按配置方案自定义。 | `Options.planModeInstructions` | P2 |
| FR-PLAN-03 | 计划保存在会话侧栏，便于之后查阅和对比版本。 | 对话记录 | P1 |

### 5.9 模型与推理（FR-MOD）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-MOD-01 | 模型选择器的数据来自运行中的会话：显示名、描述、解析后的 ID、能力标记（推理强度档位、自适应思考、快速模式、自动模式）。切换在本轮内从下一次请求起生效。 | `supportedModels()` → `ModelInfo`、`setModel()` | P0 |
| FR-MOD-02 | 按配置方案设置回退模型链。 | `Options.fallbackModel` | P1 |
| FR-MOD-03 | 推理强度选择器只提供模型支持的档位；可在会话中切换；可选保存为该模型的默认值。档位名称本地化，传给 SDK 的值不变。 | `Options.effort`、`applyFlagSettings({ effortLevel })`、`updateSettings('userSettings', { effortLevel })` | P0 |
| FR-MOD-04 | 思考：自适应 / 固定预算 / 关闭；显示摘要 / 不显示。 | `Options.thinking`（`ThinkingConfig`） | P1 |
| FR-MOD-05 | 快速模式开关，显示状态（关 / 冷却中 / 开）及不可用原因。 | `applyFlagSettings({ fastMode })`、`fast_mode_state`、`fast_mode_disabled_reason` | P2 |
| FR-MOD-06 | Ultracode 开关（xhigh 推理强度 + 动态工作流）。 | `applyFlagSettings({ ultracode })` | P2 |
| FR-MOD-07 | 按配置方案设置 token 任务预算（alpha）。 | `Options.taskBudget` | P2 |
| FR-MOD-08 | 按配置方案开启 beta 标志。 | `Options.betas` | P2 |

### 5.10 限制、费用与用量（FR-COST）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-COST-01 | 每个会话的上限：最大轮数和最大预算（美元），附「留出余量」的说明；恢复会话时可修改。 | `Options.maxTurns`、`maxBudgetUsd` | P0 |
| FR-COST-02 | 会话标题栏显示实时费用；每轮底部显示本轮费用；按模型细分（输入、输出、缓存读取、缓存写入、网页搜索、费用）。 | `total_cost_usd`、`usage`、`modelUsage`（`ModelUsage`） | P0 |
| FR-COST-03 | 费用账本：记录每条结果，重启后总计不丢失；面板可按天、工作区、模型、配置方案查看；失败和崩溃的会话也计入。 | `SDKResultMessage`（所有 subtype） | P1 |
| FR-COST-04 | 速率限制 / 套餐使用率仪表和重置时间。 | `SDKRateLimitEvent` | P1 |
| FR-COST-05 | 后台任务和子代理的用量显示在各自卡片上。 | `task_progress.usage`、`task_notification.usage` | P1 |

### 5.11 上下文管理（FR-CTX）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-CTX-01 | 标题栏的上下文用量条（窗口占用百分比，按阈值变色），每轮结束后刷新。 | 助手消息的 `context_usage`、`getContextUsage({ detail: 'summary' })` | P0 |
| FR-CTX-02 | 上下文检查器：按类别（系统提示词、工具、MCP 工具、延迟加载的工具、代理、记忆文件、技能、消息、压缩预留、空闲）分解，并列出每个文件 / 工具 / 服务器的 token 数。「精确统计」使用完整 token 计数。 | `getContextUsage({ detail: 'full' })` → `categories`、`gridRows`、`memoryFiles`、`mcpTools`、`systemTools`… | P1 |
| FR-CTX-03 | 立即压缩（可附说明）和清空对话；在对话中显示压缩分界线，附压缩前 token 数和触发方式（手动 / 自动）。 | `/compact`、`/clear`、`SDKCompactBoundaryMessage`、`SDKConversationResetMessage` | P0 |
| FR-CTX-04 | 按配置方案设置工具搜索（on / auto / auto:N / off）。 | 环境变量 `ENABLE_TOOL_SEARCH` | P2 |

### 5.12 子代理（FR-AGT）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-AGT-01 | 代理库：列出应用注册表（编程定义）、`.claude/agents/`（项目、用户）和插件中的代理，并标注来源。 | `Options.agents`、`supportedAgents()` → `AgentInfo` | P1 |
| FR-AGT-02 | 代理编辑器，覆盖 `AgentDefinition` 的全部字段：描述、提示词、工具、禁用工具、模型（别名 / 继承 / ID）、MCP 服务器（按名称或内联）、预加载技能、初始提示、最大轮数、自动压缩窗口、后台运行、不加载 CLAUDE.md、记忆范围、推理强度、权限模式。 | `AgentDefinition` | P1 |
| FR-AGT-03 | 以某个代理作为主线程运行会话；在会话中切换主线程代理。 | `Options.agent`、`applyFlagSettings({ agent })` | P1 |
| FR-AGT-04 | 子代理活动可见：嵌套记录（文字和思考）、进度摘要、每个子代理的模型和用量；嵌套的子代理以树状显示。 | `forwardSubagentText`、`agentProgressSummaries`、`parent_tool_use_id`、`agent_id`、`SubagentStart/Stop` 钩子 | P0 |
| FR-AGT-05 | 按配置方案设置上限：子代理层数、并发数、卡住超时。 | 环境变量 `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`、`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`、`CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` | P2 |

### 5.13 后台任务（FR-BG）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-BG-01 | 任务面板：运行中和已结束的后台任务（Bash、子代理、工作流），显示描述、类型、父任务、状态（pending / running / completed / failed / killed / stopped，均本地化）、进度摘要、最近的工具、用量。 | `task_started`、`task_progress`、`task_updated`、`task_notification`、`background_tasks_changed` | P0 |
| FR-BG-02 | 停止任务。 | `Query.stopTask(taskId)` | P0 |
| FR-BG-03 | 把前台工作（某次工具调用或全部）转入后台，本轮继续——相当于 Ctrl+B。 | `Query.backgroundTasks(toolUseId?)` | P1 |
| FR-BG-04 | 打开任务的输出文件。 | `task_notification.output_file`、`Query.readFile()` | P1 |
| FR-BG-05 | 后台任务完成或失败时通知。 | `task_notification` | P1 |

### 5.14 任务清单（FR-TODO）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-TODO-01 | 侧栏实时显示由 Agent 任务工具调用生成的清单：标题、进行中时的进行时描述、状态（待办 / 进行中 / 已完成）、依赖关系（阻塞 / 被阻塞）、负责人。 | `TaskCreate`、`TaskUpdate`、`TaskList`、`TaskGet`、`TodoWrite` | P0 |
| FR-TODO-02 | 配置方案开关：在默认不提供任务工具的模型上开启。 | `allowedTools` / `tools` 条目，或 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` | P1 |

### 5.15 文件检查点与回退（FR-CKPT）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-CKPT-01 | 配置方案默认开启检查点；每条用户消息都是还原点。 | `Options.enableFileCheckpointing`、`extraArgs: { 'replay-user-messages': null }`、用户消息的 `uuid` | P0 |
| FR-CKPT-02 | 侧栏检查点时间线（每条用户消息一行，显示其后改动的文件数）。 | 用户消息流 + Edit/Write 工具调用 | P1 |
| FR-CKPT-03 | 回退：先演练（改动的文件、增删行数、跳过的链接、「无法回退」原因），再执行。 | `rewindFiles(uuid, { dryRun: true })` → `RewindFilesResult`，然后 `rewindFiles(uuid)` | P0 |
| FR-CKPT-04 | 「回退文件并从这里分叉对话」：先回退文件，再在同一条消息处分叉会话。 | `rewindFiles()` + `forkSession({ upToMessageId })` | P1 |
| FR-CKPT-05 | 回退对话框写明限制：Bash 造成的改动、子代理的编辑、目录和远程文件不会还原；分叉不带检查点。 | — | P0 |

### 5.16 变更与文件（FR-FILE）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-FILE-01 | 「变更」面板：本会话创建 / 修改的文件及每个文件的 diff（来自工具输入），另提供工作树的「git diff」视图，覆盖 Bash 造成的改动。 | Edit/Write 工具输入；服务端 git | P1 |
| FR-FILE-02 | 通过会话预览工作区文件（文本或图片）。 | `Query.readFile(path, { maxBytes, encoding })` | P1 |
| FR-FILE-03 | 当应用自己的上下文管理丢弃或总结了之前的 Read 时，把文件标记为已读，使后续 Edit 能正常进行。 | `Query.seedReadState()` | P2 |

### 5.17 MCP 服务器（FR-MCP）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-MCP-01 | MCP 注册表：添加 / 编辑 / 删除 stdio（命令、参数、环境变量）、HTTP 和 SSE（URL、请求头）以及进程内 SDK 服务器（来自 FR-CTOOL）。 | `McpServerConfig` 各变体 | P0 |
| FR-MCP-02 | 每个会话中的服务器状态：已连接 / 连接中 / 失败（错误）/ 需要登录 / 已停用，服务器信息、范围和来源，工具列表及注解（只读、破坏性、访问外部）。 | `mcpServerStatus()` → `McpServerStatus`、init 的 `mcp_servers` | P0 |
| FR-MCP-03 | 运行中操作：启用 / 停用、重新连接、在不重启的情况下添加或替换会话中的服务器。 | `toggleMcpServer()`、`reconnectMcpServer()`、`setMcpServers()` → `McpSetServersResult` | P1 |
| FR-MCP-04 | 严格模式：只使用本应用传入的服务器（忽略 `.mcp.json`、用户设置、插件、连接器）。 | `Options.strictMcpConfig` | P1 |
| FR-MCP-05 | 认证：远程服务器的令牌 / 请求头字段；`needs-auth` 状态说明如何提供凭据（SDK 本身不执行 OAuth）。 | `headers`、`needs-auth` | P1 |
| FR-MCP-06 | 信息征询：服务器向用户索取输入时显示对话框（表单模式渲染请求的字段；链接模式打开链接并等待）；接受 / 拒绝 / 取消。服务器发来的文字按原文显示。 | `Options.onElicitation`、`Elicitation` / `ElicitationResult` 钩子 | P1 |
| FR-MCP-07 | 浏览 MCP 资源；把 `@server:resource` 插入输入框。 | `ListMcpResources`、`ReadMcpResource` 工具 | P2 |
| FR-MCP-08 | MCP Apps 组件：在工具结果旁的沙箱 iframe 中渲染工具的 `ui://` 资源。 | `readMcpResource()`、工具的 `_meta.ui`、`mcp_tool_ui_meta_v1` 能力 | P2 |
| FR-MCP-09 | 每个服务器的工具调用超时、首轮前等待服务器连接的时长。 | `createSdkMcpServer({ timeout })`、环境变量 `MCP_TIMEOUT`、`MCP_TOOL_TIMEOUT` | P2 |

### 5.18 自定义工具（FR-CTOOL）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-CTOOL-01 | Code Agent 自带一个进程内 MCP 服务器（「应用工具」），如 `notify_user`（浏览器通知）、`open_url`（在用户浏览器中打开）、`show_file`（在界面中打开文件）。 | `tool()`、`createSdkMcpServer()` | P1 |
| FR-CTOOL-02 | 在界面中定义 Webhook 工具：名称、描述、输入 JSON Schema、HTTP 地址和方法；处理函数把参数 POST 出去，并返回响应（文本、图片、资源或 `structuredContent`）。注解可编辑。 | `tool()` + `ToolAnnotations`、`CallToolResult`、`isError` | P2 |
| FR-CTOOL-03 | 进程内工具的单个审批策略：总是询问 / 总是拒绝；可在运行中修改。 | `McpServerToolPolicy.permission_policy`、`setMcpServers()` | P2 |
| FR-CTOOL-04 | 工具搜索提示：每个工具 / 服务器的「始终加载」标志和搜索提示。 | `tool(..., { searchHint, alwaysLoad })`、`createSdkMcpServer({ alwaysLoad })` | P2 |
| FR-CTOOL-05 | 用 MCP 实现替换内置工具（如把 `Bash` 路由到沙箱执行器）。 | `Options.toolAliases` | P2 |

### 5.19 钩子（FR-HOOK）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-HOOK-01 | 钩子规则编辑器：选择事件（全部 33 个事件，分组：工具、提示与显示、会话、代理与任务、压缩、模型、权限、MCP、配置与文件）、匹配器（工具名模式，如 `Bash`、`Edit\|Write`、`mcp__.*`）、超时和动作。 | `Options.hooks`、`HookCallbackMatcher` | P1 |
| FR-HOOK-02 | 内置动作类型，编译成回调：PreToolUse 的**拒绝**（附原因）/ **允许** / **询问** / **延后**；**改写输入**（JSON patch 模板）；**补充上下文**（注入给 Claude 的文字）；**设置会话标题**；**改写工具输出**；**通知**（浏览器通知）；**记录**（审计日志）；**Webhook**（POST 输入，以 JSON 回复作为钩子输出）；**异步**（不等待）。 | `SyncHookJSONOutput`（`decision`、`hookSpecificOutput.*`、`continue`、`stopReason`、`systemMessage`、`suppressOutput`）、`AsyncHookJSONOutput` | P1 |
| FR-HOOK-03 | 默认启用的内置钩子：工具调用审计日志（PostToolUse）、Notification / PermissionRequest / Stop / StopFailure 时通知、用首条提问设置会话标题（UserPromptSubmit）。 | 钩子 | P1 |
| FR-HOOK-04 | 钩子活动：在事件检查器中显示钩子的开始 / 进度 / 返回，并在工具卡片上做轻量标记。 | `Options.includeHookEvents`、`SDKHookStarted/Progress/ResponseMessage` | P1 |
| FR-HOOK-05 | 只读查看设置文件中的钩子（command / http / mcp_tool / prompt / agent 类型）。 | `resolveSettings()` | P2 |
| FR-HOOK-06 | 可在运行中修改钩子，从下一轮起生效。 | `applyFlagSettings({ hooks })`（设置中的 hooks） | P2 |

### 5.20 技能与命令（FR-SKILL）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-SKILL-01 | 工作区的技能列表（项目、用户、插件、内置包），附描述以及用户和 / 或 Claude 是否可调用。 | init 的 `skills`、`supportedCommands()` | P1 |
| FR-SKILL-02 | 配置方案选择启用哪些技能：全部，或指定列表。 | `Options.skills`（`'all'` 或名称列表） | P1 |
| FR-SKILL-03 | 在编辑器中新建 / 编辑技能（`.claude/skills/<name>/SKILL.md` + frontmatter），再在运行中的会话里重新加载。 | `reloadSkills()` | P2 |
| FR-SKILL-04 | 从命令面板执行命令；`/compact`、`/clear`、`/context`、`/usage` 另有专门按钮。 | 提示词 `/name args` | P0 |

### 5.21 插件（FR-PLUG）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-PLUG-01 | 注册本地插件文件夹；按配置方案选择；可选跳过其 MCP 服务器。 | `Options.plugins`（`SdkPluginConfig`、`skipMcpDiscovery`） | P1 |
| FR-PLUG-02 | 显示会话初始化时加载的插件和插件错误；安装进度消息。 | init 的 `plugins`、`plugin_errors`、`SDKPluginInstallMessage` | P1 |
| FR-PLUG-03 | 在运行中的会话里重新加载插件（及添加文件夹）；若重新加载会使提示词缓存失效则先提醒。 | `reloadPlugins({ addPlugins, holdOnCacheImpact })` | P2 |

### 5.22 系统提示词、记忆与输出风格（FR-PROMPT）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-PROMPT-01 | 配置方案的系统提示词：Claude Code 预设（默认）、预设 + 追加文字、自定义提示词（静态 / 动态分段以利缓存）或最简。可排除动态段。说明它在会话生命周期内固定。 | `Options.systemPrompt`（`preset`、`append`、`excludeDynamicSections`、`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`） | P0 |
| FR-PROMPT-02 | 按配置方案选择设置来源（用户 / 项目 / 本地），并说明每个来源会加载什么（设置、CLAUDE.md、规则、技能、命令、代理、钩子）。 | `Options.settingSources` | P0 |
| FR-PROMPT-03 | 查看 / 编辑项目、本地和用户级的 CLAUDE.md 与规则文件；列出会话中加载了哪些说明文件。 | 文件；`InstructionsLoaded` 钩子；`getContextUsage().memoryFiles` | P1 |
| FR-PROMPT-04 | 输出风格：按会话选择、保存到本地设置、编辑后重新加载。 | `settings.outputStyle`、`updateSettings('localSettings', { outputStyle })`、`reloadOutputStyles()`、init 的 `output_style` | P2 |
| FR-PROMPT-05 | 查看自动记忆文件夹。 | `~/.claude/projects/<project>/memory/` | P2 |

### 5.23 配置方案与设置（FR-CFG）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-CFG-01 | 配置方案：SDK 选项的命名预设（模型、推理强度、思考、模式、工具预设或列表、允许 / 禁用工具、提示词、设置来源、MCP 服务器、代理、技能、插件、钩子、限制、检查点、沙箱、环境变量、认证方式、回复语言）。可复制、导入 / 导出 JSON。有一个默认方案。 | `Options` | P0 |
| FR-CFG-02 | 工具可用性：Claude Code 预设或明确列出的内置工具。 | `Options.tools` | P1 |
| FR-CFG-03 | 每个配置方案的内联设置层（JSON，带校验），以及对运行中会话的实时修改（权限、钩子、推理强度、模型、代理、快速模式、技能覆盖）。 | `Options.settings`、`applyFlagSettings()` | P1 |
| FR-CFG-04 | 每个配置方案的环境变量，合并到服务端环境之上（超时、重试、流看门狗、客户端应用 ID）。 | `Options.env`（`API_TIMEOUT_MS`、`CLAUDE_CODE_MAX_RETRIES`、`CLAUDE_CODE_RETRY_WATCHDOG`、`CLAUDE_ENABLE_STREAM_WATCHDOG`、`CLAUDE_AGENT_SDK_CLIENT_APP`…） | P1 |
| FR-CFG-05 | 命令沙箱：启用、无法启动时停止、沙箱内 Bash 自动批准、排除的命令、允许沙箱外回退、网络（允许 / 禁止域名、严格白名单、本地端口绑定、Unix 套接字、代理端口）、文件系统（允许 / 禁止写、禁止读）、忽略的违规。 | `Options.sandbox`（`SandboxSettings`） | P1 |
| FR-CFG-06 | 运行时：覆盖 Claude Code 可执行文件路径、JS 运行时及其参数、额外 CLI 参数。 | `pathToClaudeCodeExecutable`、`executable`、`executableArgs`、`extraArgs` | P2 |
| FR-CFG-07 | 由应用提供的策略级设置（如配置方案无法放宽的强制拒绝规则）。 | `Options.managedSettings` | P2 |
| FR-CFG-08 | 通过自定义进程启动器在容器或虚拟机中运行会话（高级）。 | `Options.spawnClaudeCodeProcess`（`SpawnOptions`、`SpawnedProcess`） | P2 |
| FR-CFG-09 | 内置工具行为选项。 | `Options.toolConfig` | P1 |

### 5.24 结构化输出作业（FR-JOB）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-JOB-01 | 作业模板：提示词（带变量）、工作区、配置方案、JSON Schema（带校验和示例的编辑器）、限制。 | `Options.outputFormat: { type: 'json_schema', schema }` | P1 |
| FR-JOB-02 | 运行作业（单消息模式），实时查看，得到校验后的 JSON 结果、费用和轮数；失败时显示 `error_max_structured_output_retries`。 | `structured_output`、result subtype | P1 |
| FR-JOB-03 | 每个模板的运行历史；可把作业的会话作为普通会话打开继续追问。 | `session_id`、`resume` | P2 |

### 5.25 可观测性与调试（FR-OBS）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-OBS-01 | 每个会话的事件检查器：按顺序列出所有原始 `SDKMessage`，可按 type / subtype 筛选、搜索、以 JSON 树查看、复制；可暂停 / 继续实时跟随。 | 所有消息类型 | P1 |
| FR-OBS-02 | 查看 Claude Code 的 stderr 和调试日志；调试模式开关和日志文件。 | `Options.stderr`、`debug`、`debugFile` | P1 |
| FR-OBS-03 | OpenTelemetry 导出设置（指标、日志、追踪；地址；包含哪些敏感数据）。 | 环境变量 `OTEL_*`、`CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`、`OTEL_LOG_*` | P2 |
| FR-OBS-04 | 慢操作显示控制请求进度（如「正在重新加载插件…」）。 | `SDKControlRequestProgressMessage` | P2 |

### 5.26 认证与模型服务（FR-AUTH）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-AUTH-01 | 按配置方案选择模型服务：通过用户的 Claude Code 登录使用 Claude 订阅（FR-AUTH-04）、Anthropic API Key、Amazon Bedrock、Google Cloud Agent Platform（Vertex）、Microsoft Foundry，或 LLM 网关 Base URL。API Key 和云凭据只保存在服务端，以环境变量注入。 | 环境变量 `ANTHROPIC_API_KEY`、`CLAUDE_CODE_USE_BEDROCK`、`CLAUDE_CODE_USE_VERTEX`、`CLAUDE_CODE_USE_FOUNDRY`、`ANTHROPIC_BASE_URL` | P0 |
| FR-AUTH-02 | 账号卡片：邮箱（部分隐藏）/ 组织 / 订阅类型 / 令牌和 Key 来源；认证状态消息。 | `accountInfo()` → `AccountInfo`、init 的 `apiKeySource`、`SDKAuthStatusMessage` | P0 |
| FR-AUTH-03 | 保存时测试连接（启动一个最小会话，报告结果或启动失败原因）。 | `startup()`、`startup_failure_reason` | P1 |
| FR-AUTH-04 | **使用用户自己的 Claude Code 登录（Claude 订阅）。** 用户在自己的终端运行官方 `claude` 并执行 `/login` 完成登录。Code Agent 用未修改的 Claude Code 二进制启动会话——默认是 SDK 内置的二进制，也可以是用户已安装的 `claude`——并使用按配置方案选择的 Claude 配置目录：默认 `~/.claude`、服务端环境中的 `CLAUDE_CONFIG_DIR`，或自定义目录（如工作和个人账号分开）。凭据由 Claude Code 自行读取。规则：Code Agent 不提供登录界面、不代理 OAuth，从不读取、复制、保存、传输或显示凭据文件或令牌（`.credentials.json`、`CLAUDE_CODE_OAUTH_TOKEN`）；对这类会话，从子进程环境中移除 `ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN` 和 `CLAUDE_CODE_OAUTH_TOKEN`（它们的优先级高于订阅登录），并在界面上说明；显示当前生效的凭据类型和套餐；Claude Code 未登录时显示指引（`claude` → `/login`）和「重新检测」；会话历史从同一配置目录读取。仅限个人单用户使用，见 §1.4。 | `env.CLAUDE_CONFIG_DIR`、`pathToClaudeCodeExecutable`、`accountInfo()`、`auth_status`、助手错误 `authentication_failed` | P0 |

### 5.27 通知（FR-NTF）

| 编号 | 需求 | 来源 | 优先级 |
| --- | --- | --- | --- |
| FR-NTF-01 | 浏览器通知（需用户开启）和标签页标题角标：有待处理的审批 / 提问、标签页不在前台时一轮结束、后台任务完成、出错。 | `session_state_changed`、`task_notification`、结果消息 | P0 |
| FR-NTF-02 | 由 Agent 发起的通知：通过 `notify_user` 应用工具和 `Notification` 钩子。 | FR-CTOOL-01、钩子 | P1 |

### 5.28 worktree、定时任务与其他会话事件（FR-MISC）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-MISC-01 | 在对话和会话标题栏中显示工作目录变化、新增目录、worktree 的创建 / 移除。 | `CwdChanged`、`DirectoryAdded`、`WorktreeCreate`、`WorktreeRemove` 钩子；`EnterWorktree` | P2 |
| FR-MISC-02 | 会话内定时提示词面板（列表、取消）。 | `CronCreate/List/Delete` | P2 |
| FR-MISC-03 | 通过钩子监视文件并做出反应（如重新加载配置）。 | `FileChanged`、`ConfigChange` 钩子、`watchPaths` | P2 |
| FR-MISC-04 | 收到 `worker_shutting_down` 时显示原因并提供恢复入口。 | `SDKWorkerShuttingDownMessage` | P1 |

### 5.29 国际化与本地化（FR-I18N）

| 编号 | 需求 | SDK 接口 | 优先级 |
| --- | --- | --- | --- |
| FR-I18N-01 | 首发界面语言：简体中文（`zh-CN`）和英文（`en`）。新增语言只需添加资源文件，不改代码。 | — | P0 |
| FR-I18N-02 | 语言选择：默认跟随浏览器（`navigator.languages`），无法匹配时用英文；可在顶栏或「设置 → 语言与地区」切换；立即生效、无需刷新；保存在服务端的用户偏好中。 | — | P0 |
| FR-I18N-03 | 资源管理：所有界面文字都是消息目录中的键（ICU MessageFormat，支持复数和变量）；缺失的译文回退到英文；CI 检查缺失和未使用的键；在设置中显示翻译覆盖率。 | — | P0 |
| FR-I18N-04 | 用 `Intl` 做本地化格式：日期时间、相对时间、数字和 token 数、时长、时区（跟随系统）。金额始终以美元显示（SDK 以美元估算），按语言格式化，不做汇率换算。 | `total_cost_usd`、时间戳 | P0 |
| FR-I18N-05 | Claude 的回复语言可按配置方案和按会话设置：跟随界面语言（默认）、由对话决定，或指定某种语言。通过设置项 `language` 实现，它同时决定自动生成的会话标题的语言；在会话启动时确定。 | `Options.settings.language` | P1 |
| FR-I18N-06 | 来自 SDK 和第三方的内容：SDK 的代码（结果 subtype、`SDKAssistantMessageError`、`startup_failure_reason`、权限模式、MCP 状态、结构化的决策原因）映射为本地化文案，原始代码 / 文本可在「详情」中查看（可设为默认展开）。技能、插件、MCP、代理作者写的描述，工具名，命令输出和文件内容按原文显示，绝不机器翻译。Claude 生成的内容遵循 FR-I18N-05。 | 所有消息类型 | P0 |
| FR-I18N-07 | 输入法：输入法组字期间（`isComposing` / keyCode 229）按 Enter 绝不发送或提交——适用于输入框、审批说明、提问的「其他」、搜索及所有「回车提交」的输入框。不可关闭。 | — | P0 |
| FR-I18N-08 | 中日韩文字与路径：字体栈包含中文字体回退；按实际宽度截断；会话、事件、命令的搜索不依赖空格分词；非 ASCII 路径和文件名（如 Windows 上的中文文件夹）全程 UTF-8 可用；导出的 CSV 带 BOM，便于表格软件打开。 | `cwd`、文件类工具 | P0 |
| FR-I18N-09 | 快捷键避开常见的输入法切换组合（Ctrl/Shift + 空格），快捷键标签本地化。 | — | P1 |
| FR-I18N-10 | 文档双语：需求文档和用户文档同时提供简体中文和英文，一起更新；代码、标识符和提交信息保持英文。 | — | P1 |

---

## 6. 非功能需求

| 编号 | 方面 | 需求 |
| --- | --- | --- |
| NFR-01 | 延迟 | 服务端收到流增量后 50 ms 内在浏览器渲染。每轮显示首 token 时间。预热启动（FR-SES-04）的目标是 1 秒内发出首个请求。 |
| NFR-02 | 可靠性 | 浏览器断开永远不会停止运行中的会话。服务端为每个会话保留最近 N 条（默认 5000）事件用于重放。审批回调一直挂起，直到被回答、会话被停止，或可配置的超时把它拒绝。 |
| NFR-03 | 资源限制 | 可配置同时运行的会话上限（默认 6；每个进程约 250 MB）；空闲的运行中会话可在超时后挂起（关闭），需要时再恢复。 |
| NFR-04 | 安全 | 服务端默认只监听 `127.0.0.1`；每个请求都需要随机访问令牌（首次启动时显示）。API Key 永不发送到浏览器；Claude 订阅凭据 Code Agent 根本不读取。预览和 MCP 应用中的 HTML 在严格 CSP 的沙箱 iframe 中渲染。破坏性操作（删除会话、跳过权限、回退）需要确认。 |
| NFR-05 | 兼容性 | Windows 10+（主要）、macOS、Linux；Node.js 22 LTS；主流 Chromium / Firefox / Safari 新版本。支持 Windows 路径和 PowerShell 工具。 |
| NFR-06 | 版本感知 | 从会话初始化消息读取 `claude_code_version` 和 `capabilities`；运行中的 Claude Code 版本不支持的功能隐藏或禁用。 |
| NFR-07 | 无障碍 | 全键盘可操作（见交互稿「全局交互规则」）、可见焦点、流式文本使用 ARIA live 区域、颜色从不是唯一信号。 |
| NFR-08 | 国际化 | 见 FR-I18N：首发简体中文和英文，更多语言通过添加资源文件支持。 |
| NFR-09 | 品牌 | 符合 §1.3。 |
| NFR-10 | 数据 | 应用数据集中在一个目录，导出为人类可读格式；除非用户配置 OpenTelemetry，否则不向本机外发送任何遥测。 |

---

## 7. 信息架构

```
应用框架
├── 顶栏：产品名 · 工作区切换 · 审批收件箱 · 预热池 · 界面语言切换 · 账号
├── 导航栏
│   ├── 会话      → 首页（工作区）· 会话历史 · 运行中会话的标签页
│   ├── 代理      → 子代理库和编辑器
│   ├── MCP       → 服务器注册表、状态、工具、自定义 / Webhook 工具
│   ├── 技能      → 技能、命令、插件
│   ├── 钩子      → 钩子规则和执行记录
│   ├── 作业      → 结构化输出作业模板和运行记录
│   ├── 用量      → 费用和用量面板
│   └── 设置      → 配置方案、模型服务与账号、权限规则、沙箱、环境变量、提示词与记忆、语言与地区、高级
└── 运行中的会话视图
    ├── 标题栏：标题 · 状态 · 模型 · 推理强度 · 权限模式 · 上下文用量 · 费用 · 停止
    ├── 对话记录：消息、思考、工具卡片、子代理卡片、横幅
    ├── 交互区：审批卡片 / 提问面板 / 计划审阅 / 带队列的输入框
    └── 检查器（标签页）：任务 · 后台 · 变更 · 检查点 · 上下文 · 会话信息 · 事件
```

各页面的布局和交互细节见交互稿（§11）。

---

## 8. 应用数据模型（Code Agent 自己的数据）

| 实体 | 主要字段 |
| --- | --- |
| `Workspace` | id、路径、显示名、是否置顶、最近打开时间、默认配置方案 |
| `Profile` | id、名称、描述、认证方式（订阅 / API Key / 云厂商 / 网关）、Claude 配置目录、Claude Code 可执行文件、回复语言、`options`（SDK `Options` 的可序列化子集）、环境变量（引用密钥）、创建 / 更新时间 |
| `Secret` | id、服务类型、加密后的值（可用时存入系统凭据库）；从不包含 Claude 订阅凭据 |
| `McpServerEntry` | id、名称、类型（stdio / http / sse / sdk / webhook 工具）、配置、是否默认启用 |
| `AgentEntry` | id、名称、`AgentDefinition`、来源（应用） |
| `HookRule` | id、事件、匹配器、超时、动作类型、动作配置、是否启用、范围（全局 / 配置方案） |
| `WebhookTool` | id、服务器名、工具名、描述、输入 schema、地址、方法、注解 |
| `JobTemplate` / `JobRun` | 模板：提示词、schema、配置方案、工作区；运行：会话 id、状态、结果 JSON、费用 |
| `CostEntry` | 会话 id、工作区、配置方案、结果 subtype、`total_cost_usd`、`modelUsage`、时间戳 |
| `SessionMeta` | 会话 id、工作区、所用配置方案、分叉来源、是否置顶（标题和标签由 SDK 保存） |
| `CheckpointRef` | 会话 id、用户消息 uuid、标签、改动的文件（缓存） |
| `UiPrefs` | 主题、界面语言（或「跟随浏览器」）、数字格式、默认是否展开 SDK 原文、通知开关、布局尺寸 |

---

## 9. 服务端接口（草案）

### 9.1 REST（节选）

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/workspaces`、`POST /api/workspaces` | 最近 / 置顶的工作区 |
| `GET /api/fs/browse?path=` | 文件夹选择器（服务端文件系统） |
| `GET /api/settings/resolve?cwd=` | `resolveSettings()` |
| `GET /api/sessions?dir=&tag=&q=` | `listSessions()`（+ 应用元数据） |
| `GET /api/sessions/:id/messages?offset=&limit=` | `getSessionMessages()` |
| `POST /api/sessions` | 启动运行中的会话（配置方案、工作区、覆盖项、首条提问） |
| `POST /api/sessions/:id/resume` | 恢复（可选分叉、从某条消息恢复、新的上限） |
| `POST /api/sessions/:id/fork` | `forkSession()` |
| `PATCH /api/sessions/:id` | 重命名 / 打标签 |
| `DELETE /api/sessions/:id` | `deleteSession()` |
| `GET /api/auth/status?profile=` | 当前凭据类型、套餐和登录状态（来自 `accountInfo()`，不含凭据） |
| `GET/PUT /api/prefs` | 用户偏好（含界面语言） |
| `GET /api/i18n/:locale` | 翻译资源 |
| `GET/PUT /api/profiles…`、`/api/mcp…`、`/api/agents…`、`/api/hooks…`、`/api/jobs…`、`/api/secrets…` | 各类注册表 |
| `GET /api/usage?from=&to=&groupBy=` | 费用账本 |

### 9.2 WebSocket 消息

客户端 → 服务端（都带 `sessionId`）：

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

服务端 → 客户端：

`sdk.message {seq, message}`（标准化后的 `SDKMessage`，带单调递增的 `seq` 用于重放）·
`approval.request {requestId, toolName, input, options}` ·
`question.request {requestId, questions}` · `elicitation.request {requestId, …}` ·
`approval.resolved {requestId, by}` · `session.state {state}` · `session.closed {reason}` ·
`control.result {requestRef, result | error}` · `replay.begin/end {fromSeq}`

协议里的错误都以「代码 + 原文」传给浏览器，由浏览器按当前语言本地化（FR-I18N-06）。

---

## 10. 里程碑

| 里程碑 | 内容 |
| --- | --- |
| **M0**（本轮） | 需求文档（中英文）、交互稿、仓库骨架文档 |
| **M1 —— 核心** | 服务端 + 前端骨架；中英文 i18n 框架、对输入法安全的输入；模型服务设置（含用户自己的 Claude Code 登录）；配置方案（基础）；启动 / 恢复 / 列表 / 重命名 / 打标签；带思考和工具卡片的流式对话；带图片、命令面板、队列和中断的输入框；审批；澄清提问；计划审阅；权限模式和模型切换；费用和上下文用量；任务面板；后台任务；检查点回退；通知；重连 |
| **M2 —— 配置** | MCP 注册表和运行中控制；代理库；技能和插件；钩子编辑器；系统提示词 / 设置来源 / CLAUDE.md 编辑器；回复语言；沙箱；环境变量；分叉和从此分叉；变更面板；上下文检查器；费用账本面板；作业；事件检查器 |
| **M3 —— 进阶** | 预热池；会话存储镜像；Webhook 工具和工具策略；MCP 应用组件和链接模式征询；输出风格；快速模式 / ultracode / 任务预算；OpenTelemetry；自定义进程启动器；worktree 和定时任务面板 |

---

## 11. 交互稿

交互稿是一个静态网页（`docs/prototype/index.html`，直接用浏览器打开），界面文字为简体中文。每个页面的
界面和布局都用 SVG 绘制；页面上的编号标注对应下方表格，说明交互方式、产生的行为和涉及的 SDK 调用。
每个页面都列出它覆盖的需求编号。

| 页面 | 主题 | 页面 | 主题 |
| --- | --- | --- | --- |
| P01 | 架构与导航地图 | P13 | MCP 服务器 |
| P02 | 首页 —— 工作区 | P14 | MCP 信息征询 |
| P03 | 新建会话对话框 | P15 | 代理库与编辑器 |
| P04 | 运行中的会话 —— 流式对话 | P16 | 技能、命令与插件 |
| P05 | 输入框 —— 命令、引用、附件与排队 | P17 | 钩子 |
| P06 | 工具审批 | P18 | 结构化输出作业 |
| P07 | 澄清提问 | P19 | 用量与费用 |
| P08 | 计划审阅 | P20 | 设置 —— 配置方案 |
| P09 | 子代理与后台任务 | P21 | 设置 —— 权限规则与沙箱 |
| P10 | 检查点与回退 | P22 | 设置 —— 模型服务（含 Claude 订阅）、账号与环境 |
| P11 | 上下文与费用 | P23 | 事件检查器 |
| P12 | 会话历史 —— 恢复、分叉与管理 | P24 | 会话状态与提示 |
| | | P25 | 设置 —— 语言与地区 |

---

## 12. 待定决策

| # | 问题 | 建议 |
| --- | --- | --- |
| D1 | 产品名 | 沿用「Code Agent」（仓库名）；符合品牌规范 |
| D2 | 前端框架 | React + Vite + TypeScript |
| D3 | 应用存储 | SQLite（`better-sqlite3`），放在 `~/.code-agent/` |
| D4 | 默认认证方式 | 检测到用户自己的 Claude Code 登录时默认使用它（FR-AUTH-04），否则用 API Key；云厂商和网关按配置方案选择 |
| D5 | 远程访问（从其他设备打开界面） | 第一阶段不做；只监听本机，带访问令牌 |
| D6 | 默认界面语言 | 跟随浏览器语言（zh-CN 或 en），无法匹配时用英文 |
| D7 | 是否把 Code Agent 分发给他人 | 暂不计划。若要分发，先向 Anthropic 确认能否提供订阅登录方式（FR-AUTH-04），否则只提供 API Key / 云厂商方式 |

---

## 13. SDK 覆盖对照表

TypeScript Agent SDK 的每个公开接口及本文中覆盖它的需求。「内部」表示实现中会用到，但没有专门的界面。

### 13.1 函数

| 函数 | 覆盖需求 |
| --- | --- |
| `query()` | FR-SES-01 |
| `startup()` → `WarmQuery` | FR-SES-04、FR-AUTH-03 |
| `prewarm()` → `SpareProcess` | FR-SES-04 |
| `tool()`、`createSdkMcpServer()` | FR-CTOOL-01..04、FR-MCP-01 |
| `listSessions()` | FR-SES-05、FR-WS-05 |
| `getSessionMessages()` | FR-SES-06、FR-SES-15 |
| `getSessionInfo()` | FR-SES-06（历史会话的标题栏） |
| `renameSession()`、`tagSession()` | FR-SES-08 |
| `forkSession()` | FR-SES-10、FR-CKPT-04 |
| `deleteSession()` | FR-SES-09 |
| `resolveSettings()` | FR-WS-04、FR-HOOK-05 |
| `extractFromBunfs()`、`/core` 入口、`InMemorySessionStore` | 内部 / 打包相关（Node 服务不需要） |

### 13.2 `Options`

| 选项 | 覆盖需求 | 选项 | 覆盖需求 |
| --- | --- | --- | --- |
| `abortController` | FR-SES-13 | `mcpServers` | FR-MCP-01 |
| `additionalDirectories` | FR-WS-02 | `model` | FR-MOD-01 |
| `agent` | FR-AGT-03 | `onElicitation` | FR-MCP-06 |
| `agents` | FR-AGT-01/02 | `outputFormat` | FR-JOB-01 |
| `agentProgressSummaries` | FR-AGT-04 | `pathToClaudeCodeExecutable` | FR-CFG-06、FR-AUTH-04 |
| `allowDangerouslySkipPermissions` | FR-PERM-02 | `permissionMode` | FR-PERM-01 |
| `allowedTools` | FR-PERM-08 | `permissionPromptToolName` | FR-PERM-13 |
| `betas` | FR-MOD-08 | `permissionPrompts` | FR-PERM-10 |
| `canUseTool` | FR-PERM-03/04、FR-ASK、FR-PLAN | `persistSession` | FR-SES-03 |
| `continue` | FR-SES-07 | `planModeInstructions` | FR-PLAN-02 |
| `cwd` | FR-WS-01 | `plugins` | FR-PLUG-01 |
| `debug`、`debugFile` | FR-OBS-02 | `projectConfigRoot` | FR-WS-03 |
| `disallowedTools` | FR-PERM-08 | `promptSuggestions` | FR-IN-10 |
| `effort` | FR-MOD-03 | `resume` | FR-SES-07 |
| `enableFileCheckpointing` | FR-CKPT-01 | `resumeSessionAt`、`resumeDropsTurn` | FR-SES-11 |
| `env` | FR-CFG-04、FR-AUTH-01/04 | `sandbox` | FR-CFG-05 |
| `executable`、`executableArgs`、`extraArgs` | FR-CFG-06、FR-CKPT-01 | `sessionId` | FR-SES-02 |
| `fallbackModel` | FR-MOD-02 | `sessionStore`、`sessionStoreFlush`、`loadTimeoutMs` | FR-SES-16 |
| `forkSession` | FR-SES-10 | `settings` | FR-CFG-03、FR-I18N-05 |
| `forwardSubagentText` | FR-AGT-04 | `settingSources` | FR-PROMPT-02 |
| `hooks` | FR-HOOK-01..03 | `skills` | FR-SKILL-02 |
| `includeHookEvents` | FR-HOOK-04 | `spawnClaudeCodeProcess` | FR-CFG-08 |
| `includePartialMessages` | FR-OUT-01 | `stderr` | FR-OBS-02 |
| `managedSettings` | FR-CFG-07 | `strictMcpConfig` | FR-MCP-04 |
| `maxBudgetUsd` | FR-COST-01 | `systemPrompt` | FR-PROMPT-01 |
| `maxThinkingTokens`（已弃用） | 由 `thinking` 取代，FR-MOD-04 | `taskBudget` | FR-MOD-07 |
| `maxTurns` | FR-COST-01 | `thinking` | FR-MOD-04、FR-OUT-02 |
| `title` | FR-SES-02 | `toolAliases` | FR-CTOOL-05 |
| `toolConfig` | FR-CFG-09、FR-ASK-03 | `tools` | FR-CFG-02 |
| `verbatimPrompts` | FR-IN-09 | | |

### 13.3 `Query` 方法

| 方法 | 覆盖需求 | 方法 | 覆盖需求 |
| --- | --- | --- | --- |
| 异步迭代 | FR-OUT-* | `readFile()` | FR-FILE-02、FR-BG-04 |
| `interrupt()` | FR-IN-07 | `reloadPlugins()` | FR-PLUG-03 |
| `rewindFiles()` | FR-CKPT-03 | `reloadSkills()` | FR-SKILL-03 |
| `setPermissionMode()` | FR-PERM-01、FR-PLAN-01 | `reloadOutputStyles()` | FR-PROMPT-04 |
| `setModel()` | FR-MOD-01 | `seedReadState()` | FR-FILE-03 |
| `setMaxThinkingTokens()`（已弃用） | 由 FR-MOD-04 取代 | `accountInfo()` | FR-AUTH-02/04 |
| `applyFlagSettings()` | FR-CFG-03、FR-MOD-03/05/06、FR-AGT-03、FR-HOOK-06 | `reconnectMcpServer()` | FR-MCP-03 |
| `updateSettings()` | FR-MOD-03、FR-PROMPT-04 | `toggleMcpServer()` | FR-MCP-03 |
| `initializationResult()` | FR-SES-17 | `setMcpServers()` | FR-MCP-03、FR-CTOOL-03 |
| `reinitialize()` | FR-SES-14、FR-PERM-07 | `setMcpPermissionModeOverride()` | FR-PERM-11 |
| `supportedCommands()` | FR-IN-05 | `readMcpResource()` | FR-MCP-08 |
| `supportedModels()` | FR-MOD-01 | `streamInput()` | FR-SES-01（输入队列） |
| `supportedAgents()` | FR-AGT-01 | `stopTask()` | FR-BG-02 |
| `mcpServerStatus()` | FR-MCP-02 | `backgroundTasks()` | FR-BG-03 |
| `getContextUsage()` | FR-CTX-01/02 | `close()` | FR-SES-13 |

### 13.4 消息类型

| 消息（`type` / `subtype`） | 覆盖需求 |
| --- | --- |
| `assistant`（`SDKAssistantMessage`，含 `error`、`aborted`、`context_usage`、`usage_report`） | FR-OUT-01..07、FR-CTX-01 |
| `user`（`SDKUserMessage`）、`SDKUserMessageReplay` | FR-IN-*、FR-OUT-10、FR-CKPT-01 |
| `result`（success / error 各 subtype） | FR-OUT-06/07、FR-COST-*、FR-JOB-02、FR-PERM-09 |
| `system/init` | FR-SES-17 |
| `stream_event` | FR-OUT-01/03 |
| `system/compact_boundary`、`system/status` | FR-CTX-03、FR-OUT-08 |
| `system/informational`、`system/local_command_output` | FR-OUT-09 |
| `system/hook_started`、`hook_progress`、`hook_response` | FR-HOOK-04 |
| `system/plugin_install` | FR-PLUG-02 |
| `tool_progress`、`tool_use_summary` | FR-OUT-03/04 |
| `auth_status` | FR-AUTH-02/04 |
| `system/task_started`、`task_progress`、`task_updated`、`task_notification`、`background_tasks_changed` | FR-BG-01..05、FR-AGT-04 |
| `system/thinking_tokens` | FR-OUT-02 |
| `system/session_state_changed` | FR-SES-12、FR-PERM-06 |
| `system/worker_shutting_down` | FR-MISC-04 |
| `system/commands_changed` | FR-IN-05 |
| `system/files_persisted` | FR-OUT-11 |
| `rate_limit_event` | FR-OUT-08、FR-COST-04 |
| `system/permission_denied` | FR-PERM-09 |
| `prompt_suggestion` | FR-IN-10 |
| API 重试、模型拒答回退 / 无回退 | FR-OUT-08 |
| `system/control_request_progress` | FR-OBS-04 |
| `conversation_reset` | FR-CTX-03 |
| notification、memory recall、elicitation complete、mirror error | FR-OBS-01（检查器）、FR-NTF-01、FR-MCP-06、FR-SES-16 |

所有消息中的代码类字段按 FR-I18N-06 本地化显示。

### 13.5 钩子事件（33 个）

| 分组 | 事件 | 覆盖需求 |
| --- | --- | --- |
| 工具 | `PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`PostToolBatch` | FR-HOOK-01..03、FR-PERM-12 |
| 提示与显示 | `UserPromptSubmit`、`UserPromptExpansion`、`MessageDisplay` | FR-HOOK-02、FR-OUT-12 |
| 会话 | `SessionStart`、`SessionEnd`、`Setup`、`Stop`、`StopFailure`、`Notification` | FR-HOOK-03、FR-NTF-02 |
| 代理与任务 | `SubagentStart`、`SubagentStop`、`TeammateIdle`、`TaskCreated`、`TaskCompleted` | FR-AGT-04、FR-TODO |
| 压缩 | `PreCompact`、`PostCompact` | FR-CTX-03 |
| 模型 | `PreModelSwitch`、`PostModelSwitch` | FR-MOD-01 |
| 权限 | `PermissionRequest`、`PermissionDenied` | FR-PERM-06/09 |
| MCP | `Elicitation`、`ElicitationResult` | FR-MCP-06 |
| 配置与文件 | `ConfigChange`、`InstructionsLoaded`、`DirectoryAdded`、`WorktreeCreate`、`WorktreeRemove`、`CwdChanged`、`FileChanged` | FR-PROMPT-03、FR-MISC-01/03 |

### 13.6 内置工具

| 工具 | 覆盖需求 |
| --- | --- |
| `Bash`、`PowerShell`、`Monitor`、`TaskStop`、`TaskOutput`（已移除） | FR-TOOL-01/11、FR-BG |
| `Read`、`Edit`、`Write`、`NotebookEdit`、`Glob`、`Grep`、`LSP` | FR-TOOL-02..04、FR-CKPT |
| `WebFetch`、`WebSearch` | FR-TOOL-05 |
| `Agent`、`Skill`、`Workflow`、`SendMessage`、`ListAgents`、`SubagentHandback` | FR-TOOL-06/07/16、FR-AGT |
| `AskUserQuestion` | FR-ASK |
| `EnterPlanMode`、`ExitPlanMode` | FR-PLAN |
| `TaskCreate`、`TaskUpdate`、`TaskGet`、`TaskList`、`TodoWrite` | FR-TODO |
| `CronCreate`、`CronDelete`、`CronList`、`ScheduleWakeup`、`RemoteTrigger` | FR-TOOL-12、FR-MISC-02 |
| `EnterWorktree`、`ExitWorktree` | FR-TOOL-13、FR-MISC-01 |
| `ListMcpResources`、`ReadMcpResource`、`ReadMcpResourceDir`、`RefreshMcpTools`、`ToolSearch`、`WaitForMcpServers` | FR-TOOL-14、FR-MCP-07 |
| `PushNotification`、`SendUserFile`、`Artifact`、`ReportFindings`、`SendFeedback`、`EndConversation` 等 | FR-TOOL-16（通用卡片） |

### 13.7 直接使用的其他类型

`AgentDefinition`（FR-AGT-02）· `AgentMcpServerSpec`（FR-AGT-02）· `SettingSource`（FR-PROMPT-02）·
`PermissionMode`（FR-PERM-01）· `CanUseTool` / `PermissionResult` / `PermissionUpdate` /
`PermissionUpdateDestination` / `PermissionRuleValue`（FR-PERM）· `ToolConfig`（FR-CFG-09）·
`McpServerConfig` 和 `McpServerToolPolicy`（FR-MCP、FR-CTOOL）· `SdkPluginConfig`（FR-PLUG）·
`SlashCommand`（FR-IN-05）· `ModelInfo`（FR-MOD-01）· `AgentInfo`（FR-AGT-01）· `McpServerStatus`
（FR-MCP-02）· `AccountInfo`（FR-AUTH-02/04）· `ModelUsage` / `Usage`（FR-COST）· `ThinkingConfig`
（FR-MOD-04）· `SandboxSettings`（FR-CFG-05）· `RewindFilesResult`（FR-CKPT-03）·
`SDKControlGetContextUsageResponse`（FR-CTX-02）· `SDKControlInterruptResponse`（FR-IN-07）·
`SDKControlInitializeResponse`（FR-SES-17）· `SpawnOptions` / `SpawnedProcess`（FR-CFG-08）·
`AbortError`（内部）· `BUILTIN_TOOL_NAMES`（FR-CFG-02）。
