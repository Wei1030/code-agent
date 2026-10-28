/**
 * Types shared by the UI and the (currently mocked) backend.
 * The real server will translate SDK messages into these UI events.
 */

export type SessionState = 'idle' | 'running' | 'requires_action';

/** Permission modes offered in the UI. `auto` is left out: it only works with Claude models. */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelInfo {
  id: string;
  label: string;
  desc: string;
  efforts: Effort[];
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
}

export interface PlanDoc {
  title: string;
  summary: string;
  steps: string[];
  files: string[];
  risks: string[];
}

export type BannerKind =
  | 'crash' | 'apiRetry' | 'rateLimit' | 'modelFallback' | 'startupFailure'
  | 'workerShutdown' | 'denials' | 'notLoggedIn';

export type Item =
  | { kind: 'user'; id: string; text: string; attachments: Attachment[]; ts: number; files?: number }
  | { kind: 'text'; id: string; text: string; streaming?: boolean; aborted?: boolean }
  | { kind: 'thinking'; id: string; text: string; seconds: number; streaming?: boolean }
  | ToolItem
  | { kind: 'toolgroup'; id: string; label: string; tools: ToolItem[] }
  | { kind: 'plan'; id: string; version: number; plan: PlanDoc; status: 'pending' | 'approved' | 'revised' }
  | { kind: 'footer'; id: string; turn: number; seconds: number; toolCalls: number; tokens: number; stopReason: string }
  | { kind: 'banner'; id: string; banner: BannerKind; detail?: string; resolved?: boolean }
  | { kind: 'divider'; id: string; label: string }
  | { kind: 'notice'; id: string; tone: 'good' | 'info' | 'warn'; text: string; action?: string };

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
    suggestions: string[];
    defaultToNo?: boolean;
    /** The file is outside the workspace and its extra directories; `candidates` are directories that would cover it. */
    outside?: { path: string; candidates: string[] };
    since: number;
  }
  | { kind: 'question'; id: string; toolItemId: string; questions: Question[]; since: number }
  | { kind: 'plan'; id: string; planItemId: string; since: number };

/** Where "allow and don't ask again" keeps the rule. Maps to the SDK's session / localSettings / userSettings. */
export type RuleDestination = 'session' | 'workspace' | 'global';

export type ApprovalAnswer =
  | { behavior: 'allow'; command?: string; remember?: { rule: string; destination: RuleDestination }; addDir?: { dir: string; destination: RuleDestination } }
  | { behavior: 'deny'; message?: string; interrupt?: boolean };

export interface QuestionAnswer {
  answers: Record<string, string>;
  notes?: Record<string, string>;
  response?: string;
}

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
}

export type TransientStatus =
  | { kind: 'working'; label: string }
  | { kind: 'compacting'; progress: number }
  | { kind: 'retry'; attempt: number; max: number; seconds: number };

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
  | { t: 'settings'; patch: Partial<Pick<SessionRuntime, 'model' | 'effort' | 'mode' | 'readOnly' | 'turn' | 'tokens'>> };

// ------------------------------------------------------------------ settings

export interface Profile {
  id: string;
  name: string;
  desc: string;
  isDefault?: boolean;
  allowBypass: boolean;
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

export type ProviderKind = 'subscription' | 'compatible';

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
  browserNotifications: boolean;
}
