/**
 * Types shared by the UI and the server. The server translates SDK messages into these UI events.
 */

export type SessionState = 'idle' | 'running' | 'requires_action';

/** Permission modes offered in the UI. `auto` is left out: it only works with Claude models. */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelInfo {
  /** Claude: an alias (opus, sonnet…). Endpoint models: `ep:<endpoint id>:<model name>`. */
  id: string;
  label: string;
  desc: string;
  /** Effort levels it takes; empty: effort is not sent (common on other vendors' models). */
  efforts: Effort[];
  /** The compatible endpoint serving it; absent for the Claude subscription. */
  endpoint?: string;
}

/** A gateway that speaks the Anthropic Messages API: another vendor's models, a proxy, a local server. */
export interface Endpoint {
  id: string;
  name: string;
  /** ANTHROPIC_BASE_URL */
  url: string;
  /** The token stays on the server; the UI only learns whether one is set. */
  keySet?: boolean;
  models: EndpointModel[];
}

export interface EndpointModel {
  /** The model name the endpoint expects (ANTHROPIC_MODEL). */
  name: string;
  /** Send thinking and the effort level (only if the endpoint understands them); off turns thinking off. */
  effort: boolean;
  /** Last connection test from Settings. */
  test?: { ok: boolean; at: number; message: string };
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  branch: string | null;
  lastActive: number;
}

export interface SessionSummary {
  id: string;
  workspaceId: string;
  title: string;
  firstPrompt: string;
  branch: string | null;
  createdAt: number;
  lastActive: number;
  tag: string | null;
  /** A Claude Code process is running for it. */
  live: boolean;
  state: SessionState;
  forkedFrom: string | null;
  tokens: number;
  /** Not created on the server yet: no message has been sent. */
  draft?: boolean;
  /** Started by a job run; kept out of the normal session lists. */
  jobId?: string;
  /** Created by another session's create_session call. */
  createdBy?: SessionRef;
  /** Branch of its own git worktree, when the creating session asked for one. */
  worktree?: string;
  /** Its worktree was removed: the session can be read but not resumed. */
  worktreeGone?: boolean;
  /** When Claude Code's transcript last matched what Code Agent shows (its modification time). */
  transcriptAt?: number;
  /** Working directory when it is not the workspace folder (the worktree's checkout). */
  cwd?: string;
  /** Messages from other sessions that arrived while the user was elsewhere. */
  peerUnread?: number;
  /** Waiting for a free slot: the running-session limit is reached and no running session is idle. */
  waiting?: boolean;
  /**
   * What Claude Code waits on the user for, oldest first: the same list the session's docked panel
   * works through, so the inbox shows every session's requests whether or not it was opened here.
   */
  requests?: RequestBrief[];
}

/** One waiting request in a few words, for the inbox. */
export interface RequestBrief {
  id: string;
  kind: PendingRequest['kind'];
  title: string;
  detail?: string;
  since: number;
}

/** A session in the same workspace, as other sessions and the composer refer to it. */
export interface SessionRef {
  sessionId: string;
  title: string;
}

/** Where a message from another session came from (SDK user message origin { kind: 'peer' }). */
export interface PeerOrigin extends SessionRef {
  /** receipt: sent automatically when the session finished handling a message that asked for one. */
  kind: 'message' | 'receipt';
}

/** A call to one of the workspace tools every session gets (in-process MCP server "workspace"). */
export interface PeerCall {
  op: 'list' | 'read' | 'status' | 'send' | 'create';
  target?: SessionRef;
  /** For send / create: what happened to the message. */
  delivery?: 'delivered' | 'queued' | 'held' | 'handled' | 'rejected';
  message?: string;
  rows?: NestedRow[];
  worktree?: string;
}

/** A message between sessions waiting for the user's release. */
export interface HeldMessage {
  id: string;
  from: SessionRef;
  to: SessionRef;
  text: string;
  /** mode: sender and receiver differ in permission class; hops: chain limit reached; policy: "always hold". */
  reason: 'mode' | 'hops' | 'policy';
  since: number;
}

export interface PeerSettings {
  /** parity: deliver when both sessions bypass permissions or both don't; otherwise hold. */
  inbound: 'parity' | 'accept' | 'hold';
  /** Messages in a chain without a human message in between before the next one is held. */
  maxHops: number;
}

// ------------------------------------------------------------------ transcript

export interface Attachment {
  id: string;
  kind: 'image' | 'file' | 'paste';
  name: string;
  /** Size label, e.g. "182 KB" or "214 行". */
  meta: string;
  /** Paste text or data URL for images. */
  content?: string;
}

export type ToolStatus = 'running' | 'ok' | 'error' | 'waiting' | 'denied';

export type ToolOutput =
  | { type: 'diff'; lines: string[] }
  | { type: 'code'; lines: string[] }
  | { type: 'text'; text: string };

export interface NestedRow {
  icon: string;
  text: string;
  right?: string;
  mono?: boolean;
}

export interface AgentRun {
  agentType: string;
  task: string;
  model: string;
  summary?: string;
  rows: NestedRow[];
  tokens: number;
  toolCalls: number;
  background?: boolean;
}

export interface ToolItem {
  kind: 'tool';
  id: string;
  tool: string;
  /** One-line detail after the tool name (path, command…). */
  detail: string;
  status: ToolStatus;
  /** Why the call was allowed, e.g. "已由你批准". */
  provenance?: string;
  output?: ToolOutput;
  seconds?: number;
  right?: string;
  /** Running in the background. */
  background?: boolean;
  agent?: AgentRun;
  /** Long-running and can be moved to the background. */
  backgroundable?: boolean;
  denialMessage?: string;
  /** Workspace tool call (list / read / status / send / create sessions). */
  peer?: PeerCall;
  /** Short result lines shown in the card body. */
  rows?: NestedRow[];
  /** The file a file tool worked on (and the lines it read), for the file preview. */
  file?: { path: string; from?: number; to?: number };
}

export interface PlanDoc {
  title: string;
  summary: string;
  steps: string[];
  files: string[];
  risks: string[];
  /** The plan as Claude wrote it; shown in full when present. */
  markdown?: string;
}

export type BannerKind =
  | 'crash' | 'apiRetry' | 'rateLimit' | 'modelFallback' | 'startupFailure'
  | 'workerShutdown' | 'denials' | 'notLoggedIn' | 'endpointRejected';

export type Item =
  | {
    kind: 'user'; id: string; text: string; attachments: Attachment[]; ts: number; files?: number; from?: PeerOrigin; refs?: SessionRef[];
    /** Put into the conversation by Code Agent itself, e.g. "代码审核 · 第 1 轮". */
    fromApp?: string;
  }
  | { kind: 'text'; id: string; text: string; streaming?: boolean; aborted?: boolean }
  | { kind: 'thinking'; id: string; text: string; seconds: number; streaming?: boolean }
  | ToolItem
  | { kind: 'toolgroup'; id: string; label: string; tools: ToolItem[] }
  | { kind: 'plan'; id: string; version: number; plan: PlanDoc; status: 'pending' | 'approved' | 'revised' }
  | { kind: 'footer'; id: string; turn: number; seconds: number; toolCalls: number; tokens: number; stopReason: string }
  | { kind: 'banner'; id: string; banner: BannerKind; detail?: string; resolved?: boolean }
  | { kind: 'divider'; id: string; label: string }
  | { kind: 'notice'; id: string; tone: 'good' | 'info' | 'warn'; text: string; action?: string }
  /** A step of a code review ticket; rendered from the ticket so it stays current. */
  | { kind: 'review'; id: string; ticketId: string; round: number; what: 'check' | 'verdict' }
  /** Board changes made by the recorder or by Claude's board tools; can be undone. */
  | { kind: 'board'; id: string; by: 'recorder' | 'agent'; changes: Array<{ itemId: string; action: 'created' | 'updated'; text: string }>; model?: string; undone?: boolean };

// ------------------------------------------------------------------ requests

export interface Question {
  header: string;
  question: string;
  multiSelect: boolean;
  options: Array<{ label: string; description: string; preview?: string }>;
}

export type PendingRequest =
  | {
    kind: 'approval';
    id: string;
    toolItemId: string;
    tool: string;
    title: string;
    reason: string;
    command?: string;
    description?: string;
    diff?: { path: string; lines: string[] };
    agent?: string;
    /** Claude Code's suggestions for not being asked again, as it gave them and in its order. */
    suggestions: SuggestedUpdate[];
    defaultToNo?: boolean;
    /** What Claude Code said about this ask, as it said it. */
    decisionReason?: string;
    /** The path outside the working directories that made Claude Code ask. */
    blockedPath?: string;
    since: number;
  }
  | { kind: 'question'; id: string; toolItemId: string; questions: Question[]; since: number }
  | {
    /** An MCP server asks the user for input during a tool call (form) or to finish a flow in the browser (url). */
    kind: 'elicitation';
    id: string;
    toolItemId: string;
    server: string;
    source: string;
    tool: string;
    mode: 'form' | 'url';
    /** Shown verbatim: server text is not translated. */
    message: string;
    fields?: ElicitationField[];
    url?: string;
    since: number;
  }
  | { kind: 'plan'; id: string; planItemId: string; since: number };

/** Where "allow and don't ask again" keeps the rule. Maps to the SDK's session / localSettings / userSettings. */
export type RuleDestination = 'session' | 'workspace' | 'global';

/** A permission update Claude Code suggests with an ask (the SDK's PermissionUpdate; rules as `Tool(spec)` text). */
export type SuggestedUpdate =
  | { type: 'addRules' | 'replaceRules' | 'removeRules'; rules: string[]; behavior: 'allow' | 'deny' | 'ask'; destination: string }
  | { type: 'addDirectories' | 'removeDirectories'; directories: string[]; destination: string }
  | { type: 'setMode'; mode: string; destination: string };

/** What "allow, and don't ask again" applies: the suggested updates the user kept, rules as edited. */
export interface AlwaysAllow {
  updates: SuggestedUpdate[];
  /** Where the rules and directories are kept; a mode change is for the session. */
  destination: RuleDestination;
}

export type ApprovalAnswer =
  | { behavior: 'allow'; always?: AlwaysAllow }
  | { behavior: 'deny'; message?: string; interrupt?: boolean };

export interface QuestionAnswer {
  answers: Record<string, string>;
  notes?: Record<string, string>;
  response?: string;
}

export interface ElicitationField {
  key: string;
  title: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  default?: string | number | boolean;
  description?: string;
  multiline?: boolean;
}

export type ElicitationAnswer =
  | { action: 'accept'; content: Record<string, string | number | boolean> }
  | { action: 'decline' }
  | { action: 'cancel' };

export type PlanAnswer = { approve: true; mode: PermissionMode } | { approve: false; feedback: string };

// ------------------------------------------------------------------ side panels

export interface Task {
  id: string;
  subject: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  blockedBy?: string;
}

export interface BgTask {
  id: string;
  kind: 'agent' | 'bash' | 'workflow' | 'monitor';
  name: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  summary?: string;
  startedAt: number;
  endedAt?: number;
  tokens?: number;
  parent?: string;
  /** File Claude Code wrote the task's output to. */
  outputFile?: string;
}

export interface FileChange {
  path: string;
  kind: 'created' | 'modified';
  add: number;
  del: number;
  diff: string[];
  /** User message uuid after which the change was made. */
  afterUserId: string;
}

export interface ContextUsage {
  model: string;
  max: number;
  categories: Array<{ name: string; tokens: number; kind: 'used' | 'buffer' | 'free' }>;
  deferred: { tools: number; tokens: number };
  memoryFiles: Array<{ path: string; tokens: number }>;
  mcp: Array<{ server: string; detail: string; tokens: number }>;
  precise: boolean;
}

export interface RawEvent {
  seq: number;
  ts: number;
  type: string;
  summary: string;
  json: unknown;
}

export interface QueuedMessage {
  id: string;
  text: string;
  priority: 'now' | 'next' | 'later';
  /** Sent by another session. */
  from?: PeerOrigin;
}

export type TransientStatus =
  | { kind: 'working'; label: string }
  | { kind: 'compacting'; progress: number }
  | { kind: 'retry'; attempt: number; max: number; seconds: number; reason?: string };

export interface SessionRuntime {
  id: string;
  items: Item[];
  state: SessionState;
  model: string;
  effort: Effort;
  mode: PermissionMode;
  request: PendingRequest | null;
  queue: QueuedMessage[];
  tasks: Task[];
  background: BgTask[];
  changes: FileChange[];
  context: ContextUsage;
  events: RawEvent[];
  stderr: string[];
  status: TransientStatus | null;
  /** Saved session opened without a running process. */
  readOnly: boolean;
  turn: number;
  tokens: number;
  info?: SessionInfo;
  /** Sent to the web app: the items before the ones it has (a transcript comes a page at a time). */
  earlier?: EarlierItems;
}

/** What comes before the loaded part of a transcript: how many items, and its prompts. */
export interface EarlierItems {
  items: number;
  users: Array<{ id: string; text: string; ts: number }>;
}

/** Events the backend pushes to the UI for one session. */
export type SessionEvent =
  | { t: 'item.add'; item: Item; after?: string }
  | { t: 'item.patch'; id: string; patch: Partial<Item> }
  | { t: 'item.append'; id: string; text: string }
  | { t: 'item.remove'; id: string }
  | { t: 'items.reset'; items: Item[] }
  | { t: 'state'; state: SessionState }
  | { t: 'request'; request: PendingRequest | null }
  | { t: 'queue'; queue: QueuedMessage[] }
  | { t: 'tasks'; tasks: Task[] }
  | { t: 'background'; background: BgTask[] }
  | { t: 'changes'; changes: FileChange[] }
  | { t: 'context'; context: ContextUsage }
  | { t: 'raw'; type: string; summary: string; json: unknown }
  | { t: 'stderr'; line: string }
  | { t: 'status'; status: TransientStatus | null }
  | { t: 'settings'; patch: Partial<Pick<SessionRuntime, 'model' | 'effort' | 'mode' | 'readOnly' | 'turn' | 'tokens' | 'info'>> };

// ------------------------------------------------------------------ settings

export interface Profile {
  id: string;
  name: string;
  desc: string;
  isDefault?: boolean;
  model: string;
  effort: Effort;
  mode: PermissionMode;
  prompts: 'host' | 'none';
  /** Built-in tools Claude can use; the others are hidden from it (SDK `tools`). */
  tools: string[];
  questionPreviews: boolean;
  sources: { user: boolean; project: boolean; local: boolean };
  promptMode: 'preset' | 'append' | 'custom' | 'minimal';
  promptText: string;
  responseLanguage: string;
  features: Record<string, boolean>;
  /** Claude Code output style ('default' = none). */
  outputStyle?: string;
  /** Replaces the default workflow of plan mode (SDK planModeInstructions). */
  planInstructions?: string;
}

/**
 * A permission rule in Claude Code's own settings files:
 * global = ~/.claude/settings.json, workspace = <workspace>/.claude/settings.local.json (this machine only),
 * repo = <workspace>/.claude/settings.json (committed with the repository; read-only here).
 */
export interface PermissionRule {
  id: string;
  behavior: 'allow' | 'ask' | 'deny';
  rule: string;
  scope: 'global' | 'workspace' | 'repo';
  workspaceId?: string;
}

/**
 * A directory outside the workspace Claude may use like the workspace itself (Claude Code
 * `additionalDirectories`): reads need no approval, edits follow the permission mode.
 * global / workspace are saved in settings files; session lasts as long as the session's process.
 */
export interface ExtraDir {
  id: string;
  path: string;
  scope: 'global' | 'workspace' | 'session';
  workspaceId?: string;
  sessionId?: string;
}

export interface EnvVar {
  id: string;
  key: string;
  value: string;
  note: string;
}

export interface Prefs {
  uiLanguage: 'auto' | 'zh-CN' | 'en';
  responseLanguage: 'ui' | 'conversation' | 'custom';
  responseLanguageCustom: string;
  numberStyle: 'intl' | 'cn';
  showRawSdkText: boolean;
  /** System notifications while the Code Agent tab is in the background. */
  browserNotifications: boolean;
  notifyRequests: boolean;
  notifyTurnDone: boolean;
  notifyBackground: boolean;
}

// ------------------------------------------------------------------ extensions

/** Where an extension is configured. global / workspace / repo map to Claude Code's user, local and project scopes. */
export type ExtScope = 'global' | 'workspace' | 'repo' | 'plugin';

export type McpStatus = 'connected' | 'pending' | 'failed' | 'needs-auth' | 'disabled';

export interface McpTool {
  name: string;
  desc: string;
  annotations: Array<'readOnly' | 'destructive' | 'openWorld'>;
  tokens: number;
}

export interface McpServer {
  id: string;
  name: string;
  type: 'stdio' | 'http' | 'sse';
  scope: ExtScope;
  workspaceId?: string;
  plugin?: string;
  command?: string;
  args?: string[];
  env?: Array<{ key: string; value: string }>;
  url?: string;
  headers?: Array<{ key: string; value: string }>;
  timeout: number;
  status: McpStatus;
  error?: string;
  version?: string;
  instructionsTokens: number;
  tools: McpTool[];
  prompts: Array<{ name: string; desc: string }>;
  /** Running sessions where the user switched this server off. */
  offIn: string[];
}

/** Subagent definitions: files in the config dir, a workspace's .claude/agents, plugins, or built in. */
export interface AgentFile {
  id: string;
  name: string;
  /** When Claude should hand work to it. */
  description: string;
  /** Tool names it may use; empty = the session's tools. */
  tools: string[];
  /** 'inherit' or a model alias / id. */
  model: string;
  source: 'builtin' | 'global' | 'workspace' | 'plugin';
  workspaceId?: string;
  plugin?: string;
  /** Display path. */
  path: string;
  /** Its system prompt (the file's body). */
  prompt: string;
  enabled: boolean;
}

/** A file Claude reads at the start of every session (CLAUDE.md, rules) or its auto memory. */
export interface InstructionFile {
  id: string;
  scope: 'global' | 'workspace';
  kind: 'claude' | 'local' | 'rule' | 'memory';
  name: string;
  path: string;
  exists: boolean;
  lines: number;
  /** The first heading or line. */
  summary: string;
}

/** A git worktree Code Agent made for a session (create_session with worktree). */
export interface WorktreeInfo {
  path: string;
  workspaceId: string;
  branch: string;
  base: string;
  /** Commits on the branch that the base does not have. */
  ahead: number;
  /** Uncommitted changes (git status lines). */
  changed: string[];
  sessions: Array<{ id: string; title: string; live: boolean }>;
}

export interface OutputStyle {
  name: string;
  description: string;
  source: 'builtin' | 'global' | 'workspace';
}

/** What the session's Claude Code process reports about itself (inspector 信息). */
export interface SessionInfo {
  version?: string;
  pid?: number;
  cwd?: string;
  /** The model id the API is called with. */
  apiModel?: string;
  outputStyle?: string;
  tools?: number;
  agents?: string[];
  mcp?: Array<{ name: string; status: string }>;
  /** When the running process started and how many processes the session has had. */
  startedAt?: number;
  starts?: number;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: 'bundled' | 'global' | 'workspace' | 'plugin';
  workspaceId?: string;
  plugin?: string;
  /** Who may invoke it: you with /name, Claude on its own, or both. */
  invocable: 'both' | 'user' | 'model';
  enabled: boolean;
  path: string;
  content: string;
}

export interface CommandFile {
  id: string;
  name: string;
  desc: string;
  argHint: string;
  source: 'global' | 'workspace' | 'plugin';
  workspaceId?: string;
  plugin?: string;
  path: string;
  content: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  path: string;
  status: 'loaded' | 'error' | 'loading';
  error?: string;
  version?: string;
  contents: { skills: number; commands: number; agents: number; mcp: number; hooks: number };
  enabled: boolean;
  /** Load its skills and hooks but not its MCP servers. */
  skipMcp: boolean;
}

export type HookAction =
  | 'allow' | 'deny' | 'ask' | 'defer' | 'rewrite'
  | 'context' | 'block' | 'title' | 'rewriteOutput'
  | 'log' | 'notify' | 'webhook';

export interface HookRule {
  id: string;
  name: string;
  event: string;
  /** Tool name or pattern (Edit|Write, mcp__.*); empty matches everything. */
  matcher: string;
  cond?: { field: string; op: 'eq' | 'contains' | 'glob' | 'regex'; value: string };
  action: HookAction;
  /** Reason, context to add, title, URL… depending on the action. */
  text: string;
  timeout: number;
  async: boolean;
  enabled: boolean;
  scope: 'global' | 'workspace';
  workspaceId?: string;
}

/** A hook defined in a settings file; read-only here. */
export interface FileHook {
  id: string;
  event: string;
  type: 'command' | 'http' | 'mcp_tool' | 'prompt' | 'agent';
  matcher: string;
  detail: string;
  source: string;
}

export interface HookLogEntry {
  id: string;
  ts: number;
  event: string;
  rule: string;
  target: string;
  outcome: 'good' | 'crit' | 'info' | 'warn';
  result: string;
  ms: number;
  detail?: string;
}

// ------------------------------------------------------------------ jobs

export interface JobSchedule {
  kind: 'manual' | 'daily' | 'weekly' | 'hourly' | 'cron';
  /** HH:MM for daily and weekly. */
  time: string;
  /** 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  everyHours: number;
  cron: string;
  enabled: boolean;
  /** Values for the prompt's {{variables}} on scheduled runs. */
  vars: Record<string, string>;
  /** What to do about runs missed while the Code Agent service was not running. */
  missed: 'skip' | 'runOnce';
}

/** A reusable task whose answer must match a JSON Schema; run by hand or on a schedule. */
export interface JobTemplate {
  id: string;
  name: string;
  workspaceId: string;
  prompt: string;
  /** JSON Schema text. */
  schema: string;
  model: string;
  effort: Effort;
  mode: PermissionMode;
  schedule: JobSchedule;
  notify: 'never' | 'failure' | 'always';
  /** Scheduled runs missed while the service was down. */
  missedRuns?: number;
}

export interface JobRun {
  id: string;
  jobId: string;
  trigger: 'manual' | 'schedule';
  startedAt: number;
  endedAt?: number;
  vars: Record<string, string>;
  /** queued: waiting for a free slot under the running-session limit. */
  status: 'queued' | 'running' | 'success' | 'invalid' | 'error';
  error?: string;
  output?: unknown;
  turns: number;
  tokens: number;
  sessionId?: string;
}

// ------------------------------------------------------------------ code review

export type ReviewSeverity = 'blocker' | 'major' | 'minor';

/** A reviewer finding; ids are R1, R2… within a ticket. */
export interface ReviewFinding {
  id: string;
  round: number;
  severity: ReviewSeverity;
  file: string;
  line?: number;
  title: string;
  detail: string;
  /**
   * open: waiting for the author (also when a later reviewer did not accept the fix or the dispute);
   * fixed / disputed: the author's answer; verified: a later reviewer confirmed the fix; upheld: the
   * reviewer accepted the dispute.
   */
  status: 'open' | 'fixed' | 'disputed' | 'verified' | 'upheld';
  /** The author's latest answer. */
  response?: string;
  /** The reviewer's latest word on it after the first round. */
  reviewerNote?: string;
  closedIn?: number;
}

/** One run of the workspace's check commands, done by Code Agent rather than Claude. */
export interface ReviewCheck {
  attempt: number;
  ok: boolean | null;
  commands: Array<{ cmd: string; ok: boolean | null; output: string[]; seconds: number }>;
}

export interface ReviewRound {
  n: number;
  /** global: the whole change since the base; incremental: only what changed since the last round. */
  scope: 'global' | 'incremental';
  snapshot: string;
  range: string;
  diff: { files: number; add: number; del: number };
  checks: ReviewCheck[];
  reviewer?: { model: string; seconds: number; tokens: number; toolCalls: number; summary: string };
  verdict?: 'pass' | 'changes_requested';
  /** Findings first raised in this round. */
  raised: string[];
  /** This round's reviewer on earlier findings. */
  rulings: Array<{ id: string; status: 'verified' | 'upheld' | 'open'; note: string }>;
  /** The author's answers to this round's verdict. */
  answers: Array<{ id: string; status: 'fixed' | 'disputed'; text: string }>;
  /** Files the author changed in this round: after a failed check, or to answer the verdict. */
  authorFiles: Array<{ path: string; add: number; del: number; diff: string[]; phase: 'check' | 'fix' }>;
  startedAt: number;
}

export interface ReviewTicket {
  id: string;
  sessionId: string;
  status: 'checking' | 'reviewing' | 'fixing' | 'passed' | 'needs_decision' | 'checks_failed' | 'stopped' | 'accepted';
  /** Commit the review compares against. */
  base: string;
  maxRounds: number;
  rounds: ReviewRound[];
  findings: ReviewFinding[];
  checks: string[];
  model: string;
  effort: Effort;
  startedAt: number;
  endedAt?: number;
  tokens: number;
  /** How it ended, in words, when the user decided. */
  note?: string;
}

/**
 * The 评审 profile: what the code-reviewer subagent runs with (an SDK AgentDefinition). Read, Glob,
 * Grep and read-only commands are always on; Code Agent's hook refuses any other command it runs.
 */
export interface ReviewProfile {
  model: string;
  effort: Effort;
  /** Optional extra tools: WebFetch, WebSearch, Skill, Agent. */
  tools: string[];
  /** Load CLAUDE.md files (AgentDefinition.omitClaudeMd, inverted). */
  claudeMd: boolean;
  /** Appended to Code Agent's built-in review instructions. */
  extraPrompt: string;
}

// ------------------------------------------------------------------ board

export type BoardKind = 'feature' | 'issue' | 'note';

export type BoardStatus =
  | 'todo' | 'doing' | 'done' | 'dropped'
  | 'open' | 'confirmed' | 'fixing' | 'fixed' | 'wontfix'
  | 'active' | 'outdated';

/** Where an item came from. auto: the recorder after a turn; agent: Claude's board tools; review: an unresolved review finding. */
export interface BoardSource {
  kind: 'manual' | 'auto' | 'agent' | 'import' | 'review';
  sessionId?: string;
  /** External id (GitHub #311), or the review finding. */
  ref?: string;
  url?: string;
}

/** A workspace board item: F-3 (feature), I-12 (issue), N-4 (note). Kept in Code Agent's data directory. */
export interface BoardItem {
  id: string;
  workspaceId: string;
  kind: BoardKind;
  title: string;
  body: string;
  status: BoardStatus;
  priority: 'high' | 'normal' | 'low';
  tasks: Array<{ id: string; text: string; done: boolean }>;
  decisions: Array<{ id: string; text: string; outcome?: string }>;
  source: BoardSource;
  /** Recorded automatically; the user has not confirmed it yet. */
  unconfirmed?: boolean;
  /** Sessions that worked on it or mentioned it. */
  sessions: string[];
  log: Array<{ ts: number; text: string; sessionId?: string; auto?: boolean }>;
  createdAt: number;
  updatedAt: number;
}

export interface BoardSettings {
  /** After each turn, a cheap model records decisions, confirmed issues and finished work. */
  recorder: boolean;
  /** Model and effort for the recorder and for import runs. */
  recorderModel: string;
  recorderEffort: Effort;
  /** Give new sessions the titles and ids of the features in progress. */
  startContext: boolean;
}

// ------------------------------------------------------------------ app state the server keeps

/**
 * Where models come from: the user's own Claude Code login (Claude subscription) and any number of
 * compatible endpoints. Both can be used side by side; each session, review, job and background run
 * picks a model, and with it the service.
 */
export interface Provider {
  /** Claude Code's config directory: ~/.claude, $CLAUDE_CONFIG_DIR, or a folder chosen here. */
  configDir: 'default' | 'env' | 'custom';
  customDir: string;
  /** The Claude Code binary that ships with the Agent SDK, or `claude` found on PATH. */
  executable: 'bundled' | 'system';
  loggedIn: boolean;
  plan: string;
  /** ANTHROPIC_API_KEY or another credential variable is set and would take precedence over the subscription. */
  envConflict: boolean;
  /** The user chose to start Claude Code without that variable. */
  ignoreEnvKey?: boolean;
  /** Which credential variable is set in the server's environment. */
  envVar?: string;
  /** $CLAUDE_CONFIG_DIR of the server process, if set. */
  envConfigDir?: string;
  endpoints: Endpoint[];
  /** Last check of the login: account e-mail and when it was checked. */
  account?: string;
  checkedAt?: number;
  error?: string;
}

export interface McpBehavior {
  strict: boolean;
  /** Load the connectors of the claude.ai account (only with a Claude subscription login). */
  claudeAiConnectors?: boolean;
  toolSearch: 'auto' | 'on' | 'off';
  firstTurnWait: number;
}

export interface RuntimeSettings {
  debugLog: boolean;
  otel: boolean;
  otelEndpoint: string;
  otelMetrics: boolean;
  otelLogs: boolean;
  otelTraces: boolean;
  otelPrompts: boolean;
  otelTools: boolean;
}

/** Plan limits (Claude subscription) and the token ledger kept by Code Agent. */
export interface UsageData {
  /** null when the plan does not report limits (compatible endpoint) or they were never fetched. */
  fiveHour: { utilization: number; resetsAt: number | null } | null;
  weekly: { utilization: number; resetsAt: number | null } | null;
  checkedAt: number | null;
  /** Tokens per local day (YYYY-MM-DD), keyed by `${workspaceId}	${model family}` (opus, sonnet, haiku, fable, other). */
  days: Record<string, Record<string, number>>;
  /** Input tokens per day, and how many of them were read from the prompt cache. */
  cache?: Record<string, { input: number; cacheRead: number }>;
}

/** A slash command offered in the composer. */
export interface CommandInfo {
  name: string;
  hint: string;
  origin: string;
  icon: string;
}

/** Everything the server keeps for the app and pushes to the UI; the UI may write the writable ones. */
export interface AppSlices {
  workspaces: Workspace[];
  prefs: Prefs;
  profiles: Profile[];
  rules: PermissionRule[];
  dirs: ExtraDir[];
  mcp: McpServer[];
  mcpBehavior: McpBehavior;
  skills: SkillInfo[];
  agents: AgentFile[];
  commandFiles: CommandFile[];
  plugins: PluginInfo[];
  hookRules: HookRule[];
  fileHooks: FileHook[];
  hookLog: HookLogEntry[];
  jobs: JobTemplate[];
  jobRuns: JobRun[];
  peer: PeerSettings;
  maxRunning: number;
  board: BoardItem[];
  boardSettings: BoardSettings;
  reviews: ReviewTicket[];
  reviewChecks: Record<string, string[]>;
  reviewProfile: ReviewProfile;
  reviewed: Record<string, number>;
  held: HeldMessage[];
  provider: Provider;
  env: EnvVar[];
  runtime: RuntimeSettings;
  models: ModelInfo[];
  usage: UsageData;
}

/** Slices only the server changes. */
export const READONLY_SLICES = ['fileHooks', 'jobRuns', 'reviews', 'reviewed', 'held', 'models', 'usage', 'agents'] as const;

export type SliceKey = keyof AppSlices;

/** Something the server wants the user to notice (toast, system notification). */
export interface NotifyMessage {
  kind: 'request' | 'turnDone' | 'background';
  title: string;
  body?: string;
  tone?: 'info' | 'good' | 'warn' | 'crit';
  sid?: string;
  /** Page to open; defaults to the session. */
  path?: string;
  action?: string;
}

/** Server → UI over the WebSocket. */
export type ServerMessage =
  /** user: the computer's user name. */
  | { t: 'hello'; slices: AppSlices; sessions: SessionSummary[]; version: string; user: string }
  | { t: 'app'; patch: Partial<AppSlices> }
  | { t: 'session.upsert'; s: SessionSummary }
  | { t: 'session.remove'; id: string }
  | { t: 'ev'; sid: string; ev: SessionEvent }
  | { t: 'notify'; n: NotifyMessage }
  | { t: 'toast'; text: string; tone: 'info' | 'good' | 'warn' | 'crit' }
  | { t: 'ret'; id: number; result?: unknown; error?: string };

/** UI → server. */
export type ClientMessage = { t: 'call'; id: number; method: string; args: unknown[] };
