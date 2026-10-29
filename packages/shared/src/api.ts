/** The operations the server offers the UI (called over the WebSocket). */
import type {
  ApprovalAnswer, Attachment, BoardItem, BoardKind, BoardSource, CommandInfo, Effort, ElicitationAnswer, PermissionMode, PlanAnswer,
  QuestionAnswer, QueuedMessage, SessionRef, SessionRuntime, AppSlices, Workspace,
} from './types';
import type { FsNode } from './catalog';

export interface SendOptions {
  attachments?: Attachment[];
  priority?: 'now' | 'next' | 'later';
  /** Add to the conversation without starting a turn. */
  contextOnly?: boolean;
  /** Send `/…` as plain text instead of running a command. */
  verbatim?: boolean;
  /** Sessions @-mentioned in the message. */
  refs?: SessionRef[];
}

export interface DryRun {
  canRewind: boolean;
  error?: string;
  files: Array<{ path: string; what: 'deleted' | 'restored'; add: number; del: number }>;
  insertions: number;
  deletions: number;
  skippedLinks: number;
}

export interface ImportRow {
  key: string;
  ref: string;
  url?: string;
  kind: BoardKind;
  title: string;
  body: string;
  /** 'create', 'skip', or the id of the item to merge into. */
  action: string;
  reason: string;
}

export type ImportSource = 'paste' | 'file' | 'github' | 'jira';

export interface ServerApi {
  setState(patch: Partial<AppSlices>): void;
  addWorkspace(path: string): Workspace;
  removeWorkspace(id: string): void;
  listDir(path: string | null): FsNode[];
  listFiles(workspaceId: string): FsNode[];
  listCommands(sid: string): CommandInfo[];

  createDraft(workspaceId: string, id: string): void;
  openSession(sid: string): SessionRuntime | null;
  send(sid: string, text: string, opts?: SendOptions): void;
  updateQueued(sid: string, id: string, p: Partial<QueuedMessage>): void;
  removeQueued(sid: string, id?: string): void;
  interrupt(sid: string): QueuedMessage[];
  runQueued(sid: string): void;
  respondApproval(sid: string, requestId: string, a: ApprovalAnswer): void;
  respondQuestion(sid: string, requestId: string, a: QuestionAnswer): void;
  respondPlan(sid: string, requestId: string, a: PlanAnswer): void;
  respondElicitation(sid: string, requestId: string, a: ElicitationAnswer): void;
  openElicitationUrl(sid: string, requestId: string): void;
  setModel(sid: string, model: string): void;
  setEffort(sid: string, effort: Effort): void;
  setMode(sid: string, mode: PermissionMode): void;
  stop(sid: string): void;
  resume(sid: string): boolean;
  backgroundTool(sid: string, toolId: string): void;
  backgroundAll(sid: string): void;
  stopTask(sid: string, taskId: string): void;
  /** The end of a background task's output file. */
  taskOutput(sid: string, taskId: string): string;
  dryRun(sid: string, userId: string): DryRun;
  rewind(sid: string, userId: string, fork: boolean): string | null;
  forkAt(sid: string, beforeUserId?: string): string;
  compact(sid: string, instructions: string): void;
  clearConversation(sid: string): void;
  preciseCount(sid: string): void;
  rename(sid: string, title: string): void;
  tag(sid: string, value: string | null): void;
  remove(sid: string): void;
  markRead(sid: string): void;
  exportMarkdown(sid: string): string;
  /** Sessions whose transcript contains the words, with a snippet of where. */
  searchSessions(query: string): Array<{ sessionId: string; snippet: string }>;
  retryBanner(sid: string, itemId: string): void;

  releaseHeld(id: string): void;
  rejectHeld(id: string): void;
  cancelWaiting(sid: string): void;
  pumpSlots(): void;

  runJob(jobId: string, vars: Record<string, string>, trigger: 'manual' | 'schedule'): string;
  catchUpJob(jobId: string): string;

  startReview(sid: string, checks: string[], opts: { model?: string; effort?: Effort }): string | null;
  stopReview(sid: string): void;
  decideReview(sid: string, choice: 'accept' | 'more' | 'takeover'): void;
  reviewMarkdown(ticketId: string): string;
  /** Check commands that fit the workspace (from package.json, Cargo.toml…), for its first review. */
  suggestChecks(workspaceId: string): string[];

  createItem(wsId: string, p: Partial<BoardItem> & Pick<BoardItem, 'kind' | 'title'>, source: BoardSource): BoardItem;
  updateItem(wsId: string, id: string, p: Partial<BoardItem>, logText?: string): void;
  deleteItem(wsId: string, id: string): void;
  confirmItem(wsId: string, id: string): void;
  undoBoardRecord(sid: string, cardId: string): void;
  findingToBoard(ticketId: string, findingId: string): string | null;
  importPreview(wsId: string, source: ImportSource, input: string): ImportRow[];
  applyImport(wsId: string, rows: ImportRow[]): string[];
  boardMarkdown(wsId: string): string;

  checkLogin(): void;
  /** Save (or with an empty key, remove) a compatible endpoint's token; it stays on the server. */
  setEndpointKey(endpointId: string, key: string): void;
  /** Send one short prompt to a model to see whether its service answers. */
  testModel(modelId: string): { ok: boolean; message: string };
  refreshUsage(): void;
  refreshMcp(): void;
  testMcp(id: string): void;
  toggleMcpInSession(sid: string, server: string, on: boolean): void;
  reconnectMcpInSession(sid: string, server: string): void;
  /** Set a header (http) or environment variable (stdio) of a server, e.g. an access token. */
  setMcpHeader(id: string, key: string, value: string): void;
  refreshExtensions(): void;
  /** Reload skills or plugins in running sessions; resolves with how many. */
  reloadInSessions(kind: 'skills' | 'plugins', workspaceId?: string): number;
}

/** What the UI holds: every method returns a promise. */
export type ClientApi = { [K in keyof ServerApi]: (...args: Parameters<ServerApi[K]>) => Promise<Awaited<ReturnType<ServerApi[K]>>> };
