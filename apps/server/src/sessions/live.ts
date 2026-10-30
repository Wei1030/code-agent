/**
 * Running sessions: one Claude Code process per session, fed through streaming input. SDK messages
 * become transcript items and side-panel state (see ../../../../packages/shared/src/types.ts for
 * what the UI shows); approvals, questions, plans and MCP elicitations wait for the user.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { query, type HookCallbackMatcher, type HookEvent, type HookJSONOutput, type Options, type Query, type SDKMessage, type SDKUserMessage, type SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentRun, Attachment, BgTask, FileChange, Item, PeerOrigin, PendingRequest, RequestBrief, SessionRef, Task, ToolItem,
} from '@code-agent/shared/types';
import { app, update } from '../state';
import { broadcast } from '../hub';
import { addItem, emit, findItem, patchItem, patchSummary, raw, rt, summary } from './registry';
import { InputQueue } from './input';
import { agentRow, READ_ONLY, toolDetail, toolName, toolResult } from './describe';
import { buildOptions } from './options';
import { contextFrom } from './context';
import { recordUsage, recordLimit } from '../usage';
import { configDir } from '../claude/files';
import { apiErrorText } from '@code-agent/shared/catalog';
import { defaultModel, isClaudeModel, pointlessRetry } from '../models';

type Input = Record<string, unknown>;

interface ToolTrack {
  name: string;
  input: Input;
  startedAt: number;
  /** Agent tool_use id this call runs under; null on the main thread. */
  parent: string | null;
  /** Group the item sits in. */
  group?: string;
}

interface StreamItem {
  itemId: string;
  type: 'text' | 'thinking';
  startedAt: number;
  done: boolean;
}

interface Turn {
  userId: string;
  startedAt: number;
  toolCalls: number;
  interrupted: boolean;
  /** What the message that started the turn carried (peer chain, receipt…). */
  meta?: TurnMeta;
}

/** Bookkeeping that travels with a message into the turn it starts. */
export interface TurnMeta {
  /** Peer messages in this chain since a human wrote. */
  hops?: number;
  /** Send this session a receipt when the turn is done. */
  receiptTo?: string;
  /** The sender's tool call to mark as handled. */
  senderToolId?: string;
}

export interface Live {
  sid: string;
  q: Query;
  input: InputQueue;
  cwd: string;
  closing: boolean;
  turn: Turn | null;
  pending: Map<string, (a: unknown) => void>;
  /** What Claude Code waits on the user for, oldest first: it can ask several things at once (parallel calls, subagents). */
  asks: PendingRequest[];
  tools: Map<string, ToolTrack>;
  streams: Map<string, StreamItem[]>;
  /** The group still open (reads, or task-list updates) while no text or other tool came since. */
  group: { id: string; key: GroupKey; tools: ToolItem[] } | null;
  taskTypes: Map<string, string>;
  /** Tool calls a Code Agent hook denied, with the reason shown on the card. */
  denied: Map<string, string>;
  /** Background task id by the tool_use id that started it. */
  taskByTool: Map<string, string>;
  /** API message being streamed and its blocks by index. */
  curMsg: string;
  streamIdx: Map<number, StreamItem>;
  commands: SlashCommand[];
  /** The model id the process was started with; it decides the service. */
  model: string;
  ready: Promise<void>;
  /** Called once when the process has ended. */
  ended: Promise<void>;
  /** The process id Claude Code reported once it started. */
  pid?: number;
  /** The usage limit refusing this process's requests, as its last rate_limit_event said. */
  rejection?: { rateLimitType?: string; resetsAt?: number };
}

const lives = new Map<string, Live>();

export function live(sid: string): Live | undefined {
  return lives.get(sid);
}

export function liveIds(): string[] {
  return [...lives.keys()];
}

/** A turn is running or a request waits for the user. */
export function inTurn(sid: string): boolean {
  return !!lives.get(sid)?.turn;
}

// ------------------------------------------------------------------ extension points

export interface TurnInfo {
  ok: boolean;
  interrupted: boolean;
  /** The final answer text (or empty on errors). */
  text: string;
  userId: string;
  structured?: unknown;
  meta?: TurnMeta;
  /** The result's subtype (success, error_max_structured_output_retries…) and errors. */
  subtype?: string;
  errors?: string[];
  turns?: number;
}
type TurnEndFn = (sid: string, info: TurnInfo) => void;
const turnEndFns: TurnEndFn[] = [];
/** Runs after every finished turn (queue, peer receipts, reviews, the board recorder…). */
export function onTurnEnd(fn: TurnEndFn) {
  turnEndFns.push(fn);
}

type Decorator = (sid: string, name: string, input: Input, item: ToolItem) => void;
const decorators: Decorator[] = [];
/** Adjust how a tool call is shown when it starts (peer cards, review steps…). */
export function decorateTool(fn: Decorator) {
  decorators.push(fn);
}

const sendFns: Array<(sid: string, m: Outgoing) => void> = [];
/** Runs when a message starts a turn. */
export function onSendTurn(fn: (sid: string, m: Outgoing) => void) {
  sendFns.push(fn);
}

const processEndFns: Array<(sid: string) => void> = [];
export function onProcessEnd(fn: (sid: string) => void) {
  processEndFns.push(fn);
}

type ResultFn = (sid: string, name: string, input: Input, text: string, isError: boolean) => Partial<ToolItem> | void;
const resultFns: ResultFn[] = [];
/** Runs when a main-thread tool call returns; what it returns goes onto the call's card. */
export function onToolResult(fn: ResultFn) {
  resultFns.push(fn);
}

type SelfTurnFn = (sid: string) => { text: string; fromApp: string } | void;
const selfTurnFns: SelfTurnFn[] = [];
/**
 * Runs when Claude Code starts a turn by itself (a wake-up, a background task reporting back). A
 * message returned is shown as what started the turn: Claude Code does not echo it.
 */
export function onSelfTurn(fn: SelfTurnFn) {
  selfTurnFns.push(fn);
}

const limitFns: Array<(sid: string, rejection: Live['rejection']) => void> = [];
/** Runs when the usage limit refused a turn, with the limit's type and reset when Claude Code named them. */
export function onLimitRefusal(fn: (sid: string, rejection: Live['rejection']) => void) {
  limitFns.push(fn);
}

type HookFn = (sid: string, input: Record<string, unknown>) => Promise<HookJSONOutput | undefined> | HookJSONOutput | undefined;
const hookFns = new Map<HookEvent, HookFn[]>();
/** A hook Code Agent runs for every session: the user's hook rules. */
export function addHook(event: HookEvent, fn: HookFn) {
  hookFns.set(event, [...(hookFns.get(event) ?? []), fn]);
}

function hooksFor(sid: string): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const out: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
  for (const [event, fns] of hookFns) {
    out[event] = [{
      hooks: [async (input) => {
        let merged: HookJSONOutput | undefined;
        for (const fn of fns) {
          const r = await fn(sid, input as unknown as Record<string, unknown>);
          if (!r) continue;
          merged = merged ? mergeHook(merged, r) : r;
          // The first permission decision wins.
          if (event === 'PreToolUse' && (r as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision) break;
        }
        return merged ?? {};
      }],
    }];
  }
  return out;
}

function mergeHook(a: HookJSONOutput, b: HookJSONOutput): HookJSONOutput {
  const sa = (a as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput;
  const sb = (b as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput;
  const ctx = [sa?.additionalContext, sb?.additionalContext].filter(Boolean).join('\n\n');
  return { ...a, ...b, ...(sa || sb ? { hookSpecificOutput: { ...sa, ...sb, ...(ctx ? { additionalContext: ctx } : {}) } } : {}) } as HookJSONOutput;
}

// ------------------------------------------------------------------ process

export interface StartOptions {
  resume: boolean;
  /** Extra SDK options (jobs: outputFormat, fork…). */
  extra?: Partial<Options>;
}

/** Start the session's Claude Code process. Resolves once it is initialized (or failed). */
export async function startProcess(sid: string, so: StartOptions): Promise<void> {
  if (lives.has(sid)) return;
  // Turns taken in the claude CLI since show before this process adds its own.
  if (so.resume) {
    await import('./history').then((h) => h.syncTranscript(sid));
    if (lives.has(sid)) return;
  }
  const sum = summary(sid);
  const r = rt(sid);
  if (!sum || !r) throw new Error(`no session ${sid}`);
  if (sum.cwd && !existsSync(sum.cwd)) throw new Error(sum.worktreeGone ? '这个会话的工作树已经删除，无法再恢复；对话记录仍可查看。' : `会话的工作目录不存在：${sum.cwd}`);
  if (!isClaudeModel(r.model) && !app.models.some((m) => m.id === r.model)) {
    // The model (or its endpoint) was deleted since: carry on with the default model.
    const next = defaultModel();
    addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'warn', text: `模型 ${r.model.replace(/^ep:[^:]+:/, '')} 已经删除，改用 ${app.models.find((m) => m.id === next)?.label ?? next} 继续。` });
    emit(sid, { t: 'settings', patch: { model: next } });
  }
  const input = new InputQueue();
  let l!: Live;
  const opts = buildOptions(sid, {
    resume: so.resume,
    canUseTool: (name, inp, o) => import('./requests').then((m) => m.canUseTool(l, name, inp, o)),
    onElicitation: (req, o) => import('./requests').then((m) => m.onElicitation(l, req, o)),
    hooks: hooksFor(sid),
    stderr: (line) => emit(sid, { t: 'stderr', line: line.replace(/\s+$/, '') }),
    extra: so.extra,
  });
  const q = query({ prompt: input, options: opts.options });
  let endedResolve!: () => void;
  l = {
    sid, q, input, cwd: opts.cwd, closing: false, turn: null, pending: new Map(), asks: [], tools: new Map(), streams: new Map(), group: null,
    taskTypes: new Map(), denied: new Map(), taskByTool: new Map(), curMsg: '', streamIdx: new Map(), commands: [], model: r.model, ready: Promise.resolve(), ended: new Promise((res) => (endedResolve = res)),
  };
  lives.set(sid, l);
  patchSummary(sid, { live: true, draft: false, waiting: false, lastActive: Date.now() });
  emit(sid, { t: 'settings', patch: { readOnly: false } });
  emit(sid, { t: 'status', status: { kind: 'working', label: '正在启动 Claude Code…' } });
  emit(sid, { t: 'stderr', line: `[${new Date().toISOString()}] Claude Code 启动中（${so.resume ? '恢复会话' : '新会话'}，工作目录 ${opts.cwd}）` });
  void pump(l).finally(() => endedResolve());
  const starts = (r.info?.starts ?? 0) + 1;
  // Claude Code keeps the system prompt of a session's first start; a resumed one shows that one.
  emit(sid, { t: 'settings', patch: { info: { ...r.info, startedAt: Date.now(), starts, ...(so.resume ? {} : { prompt: opts.prompt }) } } });
  l.ready = q.initializationResult().then((init) => {
    l.commands = init.commands ?? [];
    const pid = (init as { pid?: number }).pid;
    l.pid = pid;
    if (pid) emit(sid, { t: 'settings', patch: { info: { ...rt(sid)?.info, pid } } });
    void q.supportedAgents().then((list) => import('../ext/agents').then((m) => m.noteAgents(list))).catch(() => undefined);
    raw(sid, 'control_response/initialize', `Claude Code ${init.claude_code_version ?? ''} · ${l.commands.length} 个命令`, { claude_code_version: init.claude_code_version, pid: (init as { pid?: number }).pid, models: init.models?.length });
    // Only a process on the Claude subscription knows the login and Claude's models.
    if (isClaudeModel(l.model)) void import('../provider').then((m) => m.noteInit(init));
  }).catch((e: unknown) => {
    emit(sid, { t: 'stderr', line: `初始化失败：${e instanceof Error ? e.message : String(e)}` });
  });
  await l.ready;
  if (!l.turn && rt(sid)?.status?.kind === 'working') emit(sid, { t: 'status', status: null });
}

async function pump(l: Live) {
  const { sid } = l;
  let crashed: string | null = null;
  try {
    for await (const m of l.q) {
      try {
        handle(l, m);
      } catch (e) {
        console.error(`[live ${sid}] cannot handle ${m.type}:`, e);
      }
    }
  } catch (e) {
    if (!l.closing) crashed = e instanceof Error ? e.message : String(e);
  }
  lives.delete(sid);
  for (const [, resolve] of l.pending) resolve({ behavior: 'deny', message: 'The session was closed.', interrupt: true });
  l.pending.clear();
  const r = rt(sid);
  closeOpenItems(l, crashed ? '进程已退出' : '已中断');
  if (r?.background.some((b) => b.status === 'running')) {
    emit(sid, { t: 'background', background: rt(sid)!.background.map((b) => (b.status === 'running' ? { ...b, status: 'stopped' as const, endedAt: Date.now() } : b)) });
  }
  emit(sid, { t: 'status', status: null });
  emit(sid, { t: 'state', state: 'idle' });
  emit(sid, { t: 'settings', patch: { readOnly: true } });
  emit(sid, { t: 'stderr', line: `[${new Date().toISOString()}] 进程已结束${crashed ? `：${crashed}` : ''}` });
  patchSummary(sid, { live: false, state: 'idle' });
  // Session-only extra directories end with the process.
  if (app.dirs.some((d) => d.sessionId === sid)) update('dirs', (ds) => ds.filter((d) => d.sessionId !== sid));
  if (crashed) {
    const notLoggedIn = /login|auth|401|credential/i.test(crashed);
    addItem(sid, { kind: 'banner', id: randomUUID(), banner: notLoggedIn ? 'notLoggedIn' : 'crash', detail: crashed });
  }
  for (const fn of processEndFns) fn(sid);
}

/** End the process; the session is saved and can be resumed. */
const run = promisify(execFile);

/**
 * On Windows what a command started outlives Claude Code when its process is closed: the shells
 * end, not the programs they ran (issue 10-30#16). While it still runs, end the process trees under
 * it, when a turn or a background task may have commands going.
 */
async function endCommands(l: Live) {
  const r = rt(l.sid);
  // Only this process's own id: the one saved from an earlier process may belong to another by now.
  const pid = l.pid;
  if (process.platform !== 'win32' || !pid || (!l.turn && !r?.background.some((b) => b.status === 'running'))) return;
  const kids = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").ProcessId`], { windowsHide: true })
    .then((o) => o.stdout.split(/\s+/).filter(Boolean), () => [] as string[]);
  await Promise.all(kids.map((k) => run('taskkill', ['/pid', k, '/T', '/F'], { windowsHide: true }).catch(() => undefined)));
}

export async function closeProcess(sid: string) {
  const l = lives.get(sid);
  if (!l) return;
  l.closing = true;
  await endCommands(l);
  l.input.close();
  try {
    l.q.close();
  } catch {
    // already gone
  }
  await Promise.race([l.ended, new Promise((r) => setTimeout(r, 5000))]);
}

// ------------------------------------------------------------------ sending

export interface Outgoing {
  text: string;
  attachments?: Attachment[];
  /** Shown in the transcript instead of `text` (e.g. without the context block for @ sessions). */
  shown?: string;
  from?: PeerOrigin;
  refs?: SessionRef[];
  fromApp?: string;
  /** Not shown in the transcript at all. */
  hidden?: boolean;
  priority?: 'now' | 'next' | 'later';
  verbatim?: boolean;
  /** Peer origin for the model. */
  origin?: SDKUserMessage['origin'];
  meta?: TurnMeta;
}

function contentOf(m: Outgoing): SDKUserMessage['message']['content'] {
  const blocks: Array<Record<string, unknown>> = [];
  if (m.text) blocks.push({ type: 'text', text: m.text });
  for (const a of m.attachments ?? []) {
    const mm = a.content?.startsWith('data:') ? /^data:([^;]+);base64,(.*)$/s.exec(a.content) : null;
    if (mm && a.kind === 'image') {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mm[1], data: mm[2] } });
    } else if (mm && mm[1] === 'application/pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: mm[2] }, title: a.name });
    } else if (!a.content) {
      // i18n-ignore: the prompt Claude reads.
      blocks.push({ type: 'text', text: `（附件 ${a.name} 没有发送内容：${a.meta}）` });
    } else {
      blocks.push({ type: 'text', text: a.kind === 'paste' ? a.content : `<file name="${a.name}">\n${a.content}\n</file>` });
    }
  }
  return (blocks.length === 1 && blocks[0].type === 'text' ? m.text : blocks) as SDKUserMessage['message']['content'];
}

function userMessage(m: Outgoing, uuid: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: contentOf(m) },
    parent_tool_use_id: null,
    uuid: uuid as SDKUserMessage['uuid'],
    ...(m.priority ? { priority: m.priority } : {}),
    ...(m.origin ? { origin: m.origin } : {}),
    ...(m.verbatim || m.fromApp || m.from ? { client_composed: true as const } : {}),
  };
}

function showUser(sid: string, m: Outgoing, id: string) {
  if (m.hidden) return;
  addItem(sid, {
    kind: 'user', id, text: m.shown ?? m.text, attachments: (m.attachments ?? []).map((a) => ({ ...a, content: a.kind === 'image' ? a.content : undefined })),
    ts: Date.now(), ...(m.from ? { from: m.from } : {}), ...(m.refs?.length ? { refs: m.refs } : {}), ...(m.fromApp ? { fromApp: m.fromApp } : {}),
  });
}

/** Start a turn with a message. The session must be live and idle. */
export function sendTurn(sid: string, m: Outgoing): string {
  const l = lives.get(sid);
  if (!l) throw new Error('会话没有在运行');
  const id = randomUUID();
  showUser(sid, m, id);
  l.turn = { userId: id, startedAt: Date.now(), toolCalls: 0, interrupted: false, meta: m.meta };
  for (const fn of sendFns) fn(sid, m);
  l.group = null;
  emit(sid, { t: 'state', state: l.asks.length ? 'requires_action' : 'running' });
  emit(sid, { t: 'status', status: { kind: 'working', label: '正在思考' } });
  patchSummary(sid, { lastActive: Date.now() });
  l.input.push(userMessage(m, id));
  raw(sid, 'user', m.from ? `来自会话「${m.from.title}」` : m.fromApp ? `Code Agent · ${m.fromApp}` : (m.shown ?? m.text).slice(0, 60), { uuid: id, priority: m.priority, origin: m.origin });
  return id;
}

/** Put a message into the running turn (priority "now"). */
export function steer(sid: string, m: Outgoing) {
  const l = lives.get(sid);
  if (!l?.turn) return sendTurn(sid, m);
  const id = randomUUID();
  showUser(sid, m, id);
  l.group = null;
  l.input.push(userMessage({ ...m, priority: 'now' }, id));
  raw(sid, 'user', `插入本轮：${(m.shown ?? m.text).slice(0, 50)}`, { uuid: id, priority: 'now' });
  return id;
}

/**
 * How context Code Agent adds without showing it starts (addContext with hidden): a transcript
 * read back later knows it is not something the user wrote.
 */
export const CONTEXT_MARK = '[Code Agent]';

/** Add a message to the conversation without starting a turn. */
export function addContext(sid: string, m: Outgoing) {
  const l = lives.get(sid);
  if (!l) throw new Error('会话没有在运行');
  const id = randomUUID();
  if (m.hidden && !m.text.startsWith(CONTEXT_MARK)) m = { ...m, text: `${CONTEXT_MARK} ${m.text}` };
  showUser(sid, m, id);
  l.input.push({ ...userMessage(m, id), shouldQuery: false });
}

export async function interruptTurn(sid: string) {
  const l = lives.get(sid);
  if (!l?.turn) return;
  l.turn.interrupted = true;
  for (const [, resolve] of l.pending) resolve({ behavior: 'deny', message: 'The user interrupted.', interrupt: true });
  l.pending.clear();
  try {
    await l.q.interrupt();
  } catch (e) {
    emit(sid, { t: 'stderr', line: `中断失败：${e instanceof Error ? e.message : String(e)}` });
  }
  closeOpenItems(l, '已中断');
}

function closeOpenItems(l: Live, right: string) {
  const r = rt(l.sid);
  if (!r) return;
  // A call still waiting for the user (a background subagent's, after the turn ended) stays open.
  const waiting = new Set(l.asks.map((a) => ('toolItemId' in a ? a.toolItemId : '')));
  for (const it of r.items) {
    if (waiting.has(it.id)) continue;
    if ((it.kind === 'text' || it.kind === 'thinking') && it.streaming) patchItem(l.sid, it.id, { streaming: false, ...(it.kind === 'text' ? { aborted: true } : {}) });
    if (it.kind === 'tool' && (it.status === 'running' || it.status === 'waiting') && !it.background) patchItem(l.sid, it.id, { status: 'error', right, backgroundable: false });
    if (it.kind === 'toolgroup') for (const t of it.tools) if (t.status === 'running') patchItem(l.sid, t.id, { status: 'error', right });
  }
}

// ------------------------------------------------------------------ requests

/** The docked panel shows the oldest request, the inbox all of them; the session waits on the user while any does. */
function showAsks(l: Live) {
  const head = l.asks[0] ?? null;
  emit(l.sid, { t: 'request', request: head });
  emit(l.sid, { t: 'state', state: head ? 'requires_action' : l.turn ? 'running' : 'idle' });
  patchSummary(l.sid, { requests: l.asks.length ? l.asks.map(brief) : undefined });
}

function brief(r: PendingRequest): RequestBrief {
  if (r.kind === 'approval') return { id: r.id, kind: r.kind, title: r.title, detail: [r.tool, r.command ?? r.diff?.path ?? r.blockedPath].filter(Boolean).join(' · '), since: r.since };
  if (r.kind === 'question') return { id: r.id, kind: r.kind, title: 'Claude 有问题要问你', detail: r.questions[0]?.question, since: r.since };
  if (r.kind === 'elicitation') return { id: r.id, kind: r.kind, title: `${r.server} 需要你提供信息`, detail: r.message, since: r.since };
  return { id: r.id, kind: r.kind, title: '计划等你审阅', since: r.since };
}

export function waitForUser<T>(l: Live, req: PendingRequest): Promise<T> {
  l.asks.push(req);
  showAsks(l);
  const sum = summary(l.sid);
  if (sum && !sum.jobId) {
    broadcast({ t: 'notify', n: {
      kind: 'request', sid: l.sid, title: `「${sum.title}」等你处理`, tone: 'warn', action: '去处理',
      body: req.kind === 'approval' ? (req.command ? `${req.title} ${req.command}` : req.title)
        : req.kind === 'question' ? req.questions[0]?.question : req.kind === 'elicitation' ? `${req.server} 需要你提供信息` : '计划等你审阅',
    } });
  }
  return new Promise<T>((resolve) => {
    l.pending.set(req.id, (a) => {
      l.asks = l.asks.filter((x) => x.id !== req.id);
      showAsks(l);
      resolve(a as T);
    });
  });
}

export function answerRequest(sid: string, requestId: string, a: unknown): boolean {
  const l = lives.get(sid);
  const fn = l?.pending.get(requestId);
  if (!l || !fn) return false;
  l.pending.delete(requestId);
  raw(sid, 'control_response', `回复 ${requestId.slice(0, 8)}`, { request_id: requestId, response: a });
  fn(a);
  return true;
}

/** A Code Agent hook denied this tool call: show it as denied, with why. */
export function markDenied(sid: string, toolUseId: string, why: string) {
  const l = lives.get(sid);
  if (!l || !toolUseId) return;
  l.denied.set(toolUseId, why);
  if (findItem(sid, toolUseId)) patchItem(sid, toolUseId, { status: 'denied', provenance: why, right: undefined });
}

/** The tool_use id of the latest call of `name` (main thread) that matches, for tools that need to patch their own card. */
export function findToolUse(sid: string, name: string, pred: (input: Input) => boolean = () => true): string | undefined {
  const l = lives.get(sid);
  if (!l) return undefined;
  let found: string | undefined;
  for (const [id, t] of l.tools) if (t.name === name && !t.parent && pred(t.input)) found = id;
  return found;
}

// ------------------------------------------------------------------ messages → items

function ensureTurn(l: Live) {
  if (l.turn) return;
  // Claude Code started a turn by itself (a background task finished, a wake-up…).
  l.turn = { userId: lastUserId(l.sid), startedAt: Date.now(), toolCalls: 0, interrupted: false };
  for (const fn of selfTurnFns) {
    const said = fn(l.sid);
    if (!said) continue;
    const id = randomUUID();
    addItem(l.sid, { kind: 'user', id, text: said.text, attachments: [], ts: Date.now(), fromApp: said.fromApp });
    l.turn.userId = id;
  }
  // A request still waiting (a background subagent's) keeps the session waiting on the user.
  emit(l.sid, { t: 'state', state: l.asks.length ? 'requires_action' : 'running' });
}

function lastUserId(sid: string): string {
  const items = rt(sid)?.items ?? [];
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'user') return items[i].id;
  return '';
}

function handle(l: Live, m: SDKMessage) {
  const { sid } = l;
  switch (m.type) {
    case 'stream_event':
      if (m.parent_tool_use_id) return;
      onStream(l, m.event as unknown as StreamEvent);
      return;
    case 'assistant':
      rawAssistant(sid, m);
      if (m.parent_tool_use_id) onSubagentAssistant(l, m.parent_tool_use_id, m.message.content as unknown as Block[]);
      else {
        ensureTurn(l);
        if (m.error) onAssistantError(l, m.error);
        onAssistant(l, m.message.id, m.message.content as unknown as Block[]);
      }
      return;
    case 'user':
      if ('isReplay' in m && m.isReplay) return;
      onToolResults(l, m.message.content as unknown, m.tool_use_result, m.parent_tool_use_id);
      raw(sid, 'user', 'tool_result', { parent_tool_use_id: m.parent_tool_use_id, content: summarizeContent(m.message.content) });
      return;
    case 'result':
      onResult(l, m);
      return;
    case 'system':
      onSystem(l, m as unknown as { subtype: string } & Record<string, unknown>);
      return;
    case 'tool_progress':
      return;
    case 'rate_limit_event':
      recordLimit(m.rate_limit_info);
      l.rejection = m.rate_limit_info.status === 'rejected' ? { rateLimitType: m.rate_limit_info.rateLimitType, resetsAt: m.rate_limit_info.resetsAt } : undefined;
      if (m.rate_limit_info.status === 'rejected') {
        addItem(sid, { kind: 'banner', id: randomUUID(), banner: 'rateLimit', detail: m.rate_limit_info.resetsAt ? new Date(m.rate_limit_info.resetsAt * 1000).toLocaleString() : undefined });
      }
      raw(sid, 'rate_limit_event', `${m.rate_limit_info.rateLimitType ?? ''} · ${m.rate_limit_info.status}`, m);
      return;
    case 'auth_status':
      raw(sid, 'auth_status', m.error ?? (m.isAuthenticating ? '正在认证' : '认证完成'), m);
      if (m.error) addItem(sid, { kind: 'banner', id: randomUUID(), banner: 'notLoggedIn', detail: m.error });
      return;
    case 'tool_use_summary':
      raw(sid, 'tool_use_summary', m.summary, m);
      return;
    case 'prompt_suggestion':
      return;
    case 'conversation_reset':
      raw(sid, 'conversation_reset', m.trigger ?? '', m);
      if (m.trigger === 'clear') {
        emit(sid, { t: 'items.reset', items: [{ kind: 'divider', id: randomUUID(), label: '对话已清空 · 从这里重新开始' }] });
        emit(sid, { t: 'tasks', tasks: [] });
      }
      return;
    default:
      raw(sid, String((m as { type: string }).type), '', m);
  }
}

function summarizeContent(c: unknown): unknown {
  if (!Array.isArray(c)) return c;
  return c.map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'tool_result'
    ? { type: 'tool_result', tool_use_id: (b as { tool_use_id: string }).tool_use_id, is_error: (b as { is_error?: boolean }).is_error }
    : b));
}

function rawAssistant(sid: string, m: Extract<SDKMessage, { type: 'assistant' }>) {
  const blocks = (m.message.content as unknown as Block[]).map((b) => (b.type === 'text' ? `文本（${b.text?.length ?? 0} 字）` : b.type === 'thinking' ? '思考' : b.type === 'tool_use' ? `tool_use ${b.name}` : b.type));
  raw(sid, 'assistant', `${m.parent_tool_use_id ? '子代理 · ' : ''}${blocks.join(' · ')}`.slice(0, 120), m);
}

interface Block {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Input;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

type StreamEvent =
  | { type: 'message_start'; message: { id: string } }
  | { type: 'content_block_start'; index: number; content_block: { type: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string; thinking?: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta' | 'message_stop' };

function onStream(l: Live, ev: StreamEvent) {
  const { sid } = l;
  if (ev.type === 'message_start') {
    l.curMsg = ev.message.id;
    l.streamIdx = new Map();
    ensureTurn(l);
    emit(sid, { t: 'status', status: { kind: 'working', label: '正在生成' } });
    return;
  }
  if (ev.type === 'content_block_start') {
    const t = ev.content_block.type;
    if (t !== 'text' && t !== 'thinking') return;
    const itemId = randomUUID();
    closeGroup(l);
    addItem(sid, t === 'text' ? { kind: 'text', id: itemId, text: '', streaming: true } : { kind: 'thinking', id: itemId, text: '', seconds: 0, streaming: true });
    const si: StreamItem = { itemId, type: t, startedAt: Date.now(), done: false };
    l.streams.set(l.curMsg, [...(l.streams.get(l.curMsg) ?? []), si]);
    l.streamIdx.set(ev.index, si);
    return;
  }
  if (ev.type === 'content_block_delta') {
    const si = l.streamIdx.get(ev.index);
    if (!si) return;
    const text = ev.delta.type === 'text_delta' ? ev.delta.text : ev.delta.type === 'thinking_delta' ? ev.delta.thinking : undefined;
    if (text) emit(sid, { t: 'item.append', id: si.itemId, text });
    return;
  }
  if (ev.type === 'content_block_stop') {
    const si = l.streamIdx.get(ev.index);
    if (si?.type === 'thinking') patchItem(sid, si.itemId, { seconds: Math.max(1, Math.round((Date.now() - si.startedAt) / 1000)) });
  }
}

/** The stream item a finished block of this message completes, in order of type. */
function takeStreamed(l: Live, msgId: string, type: 'text' | 'thinking'): StreamItem | undefined {
  const list = l.streams.get(msgId);
  const si = list?.find((x) => x.type === type && !x.done);
  if (si) si.done = true;
  return si;
}

function closeGroup(l: Live) {
  l.group = null;
}

function onAssistant(l: Live, msgId: string, blocks: Block[]) {
  const { sid } = l;
  for (const b of blocks) {
    if (b.type === 'text') {
      const si = takeStreamed(l, msgId, 'text');
      if (si) patchItem(sid, si.itemId, { text: b.text ?? '', streaming: false });
      else if (b.text?.trim()) {
        closeGroup(l);
        addItem(sid, { kind: 'text', id: randomUUID(), text: b.text });
      }
    } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
      const si = takeStreamed(l, msgId, 'thinking');
      const text = b.thinking ?? '';
      if (si) patchItem(sid, si.itemId, { text: text || (findItem(sid, si.itemId) as { text?: string } | undefined)?.text || '', streaming: false });
      else if (text.trim()) addItem(sid, { kind: 'thinking', id: randomUUID(), text, seconds: 0 });
    } else if (b.type === 'tool_use' && b.id && b.name) {
      onToolUse(l, b.id, b.name, b.input ?? {});
    }
  }
}

function onToolUse(l: Live, id: string, name: string, input: Input) {
  const { sid } = l;
  if (l.tools.has(id)) return;
  l.tools.set(id, { name, input, startedAt: Date.now(), parent: null });
  if (l.turn) l.turn.toolCalls += 1;
  emit(sid, { t: 'status', status: { kind: 'working', label: `正在使用 ${toolName(name)}` } });
  if (name === 'TodoWrite') {
    const todos = (input.todos as Array<{ content: string; status: Task['status']; activeForm?: string }> | undefined) ?? [];
    emit(sid, { t: 'tasks', tasks: todos.map((t, i) => ({ id: String(i + 1), subject: t.content, activeForm: t.activeForm, status: t.status })) });
  }
  if (name === 'TaskUpdate') {
    const tid = String(input.taskId ?? '');
    const r = rt(sid)!;
    if (input.status === 'deleted') emit(sid, { t: 'tasks', tasks: r.tasks.filter((t) => t.id !== tid) });
    else emit(sid, { t: 'tasks', tasks: r.tasks.map((t) => (t.id === tid ? { ...t, ...(input.status ? { status: input.status as Task['status'] } : {}), ...(input.subject ? { subject: String(input.subject) } : {}), ...(input.activeForm ? { activeForm: String(input.activeForm) } : {}) } : t)) });
  }
  if (name === 'ExitPlanMode' || name === 'AskUserQuestion') {
    // Shown as a plan card or question panel through the permission request.
    return;
  }
  // backgroundable comes with task_started: before Claude Code registers the call as a task it
  // cannot be moved to the background.
  const item: ToolItem = { kind: 'tool', id, tool: toolName(name), detail: toolDetail(name, input, l.cwd), status: 'running' };
  if (name === 'Agent' || name === 'Task') {
    const agent: AgentRun = {
      agentType: String(input.subagent_type ?? 'general-purpose'), task: String(input.prompt ?? input.description ?? '').slice(0, 400),
      model: String(input.model ?? 'inherit'), rows: [], tokens: 0, toolCalls: 0, background: !!input.run_in_background,
    };
    item.agent = agent;
    item.background = !!input.run_in_background;
  }
  if ((name === 'Bash' || name === 'PowerShell') && input.run_in_background) item.background = true;
  // File tools link to the file preview, Read with the lines it read.
  const fp = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : undefined;
  if (fp && FILE_TOOLS.has(name)) {
    const from = typeof input.offset === 'number' && input.offset > 0 ? input.offset : undefined;
    const lim = typeof input.limit === 'number' ? input.limit : undefined;
    item.file = { path: fp, ...(from || lim ? { from: from ?? 1, to: (from ?? 1) + (lim ?? 2000) - 1 } : {}) };
  }
  for (const d of decorators) d(sid, name, input, item);
  // Consecutive read-only calls share one group, and so do consecutive task-list updates.
  const key = groupKey(name);
  if (key) {
    if (l.group && l.group.key !== key) closeGroup(l);
    if (l.group) {
      l.group.tools = [...l.group.tools, item];
      l.tools.get(id)!.group = l.group.id;
      patchItem(sid, l.group.id, { tools: l.group.tools, label: groupLabel(l.group.tools) });
      return;
    }
    const prev = rt(sid)!.items.at(-1);
    if (prev?.kind === 'tool' && groupKey(prev.tool) === key && l.tools.has(prev.id)) {
      // Turn the previous call into a group.
      const gid = randomUUID();
      const tools = [prev, item];
      emit(sid, { t: 'item.remove', id: prev.id });
      addItem(sid, { kind: 'toolgroup', id: gid, label: groupLabel(tools), tools });
      l.group = { id: gid, key, tools };
      l.tools.get(prev.id)!.group = gid;
      l.tools.get(id)!.group = gid;
      return;
    }
    addItem(sid, item);
    return;
  }
  closeGroup(l);
  addItem(sid, item);
}

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
type GroupKey = 'read' | 'tasks';
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite']);
const groupKey = (tool: string): GroupKey | null => (READ_ONLY.has(tool) ? 'read' : TASK_TOOLS.has(tool) ? 'tasks' : null);

function groupLabel(tools: ToolItem[]): string {
  if (TASK_TOOLS.has(tools[0].tool)) {
    const created = tools.filter((t) => t.tool === 'TaskCreate').length;
    const updated = tools.filter((t) => t.tool === 'TaskUpdate' || t.tool === 'TodoWrite').length;
    return ['任务清单', created ? `新建 ${created} 项` : '', updated ? `更新 ${updated} 次` : ''].filter(Boolean).join(' · ');
  }
  const reads = tools.filter((t) => t.tool === 'Read').length;
  const searches = tools.length - reads;
  return [reads ? `读取 ${reads} 个文件` : '', searches ? `搜索 ${searches} 次` : ''].filter(Boolean).join(' · ');
}

function patchTool(l: Live, id: string, p: Partial<ToolItem>) {
  const t = l.tools.get(id);
  if (t?.group && l.group?.id === t.group) {
    l.group.tools = l.group.tools.map((x) => (x.id === id ? { ...x, ...p } : x));
  }
  patchItem(l.sid, id, p);
}

function onToolResults(l: Live, content: unknown, structured: unknown, parent: string | null) {
  if (!Array.isArray(content)) return;
  for (const b of content as Block[]) {
    if (b.type !== 'tool_result' || !b.tool_use_id) continue;
    const track = l.tools.get(b.tool_use_id);
    if (!track) continue;
    if (parent || track.parent) {
      // A subagent's own tool call finished; nothing to show beyond its row.
      continue;
    }
    const isError = !!b.is_error;
    const seconds = Math.round((Date.now() - track.startedAt) / 100) / 10;
    if (track.name === 'TaskCreate' && !isError) {
      const task = (structured as { task?: { id?: string; subject?: string } } | undefined)?.task;
      if (task?.id) emit(l.sid, { t: 'tasks', tasks: [...rt(l.sid)!.tasks, { id: String(task.id), subject: String(task.subject ?? track.input.subject ?? ''), activeForm: track.input.activeForm as string | undefined, status: 'pending' }] });
    }
    if (track.name === 'ExitPlanMode' || track.name === 'AskUserQuestion') continue;
    const r = toolResult(track.name, track.input, b.content, structured, isError, l.cwd);
    const item = findItem(l.sid, b.tool_use_id) as ToolItem | undefined;
    if (!item) continue;
    const hookWhy = l.denied.get(b.tool_use_id);
    const denied = item.status === 'denied' || !!hookWhy;
    const p: Partial<ToolItem> = {
      status: denied ? 'denied' : isError ? 'error' : 'ok', seconds, backgroundable: false,
      // Neither a rule we know nor the user allowed it: Claude Code decided it needs no approval.
      ...(hookWhy ? { provenance: hookWhy, right: undefined } : !item.provenance && !denied && !track.name.startsWith('mcp__workspace__') ? { provenance: '无需审批' } : {}),
      ...(r.output ? { output: r.output } : {}), ...(r.right !== undefined ? { right: r.right } : {}), ...(r.images ? { images: r.images } : {}),
    };
    if (item.agent) {
      const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? (b.content as Block[]).map((x) => x.text ?? '').join('\n') : '';
      // An agent started in the background answers with instructions meant for the model only.
      const launched = /^Async agent launched/i.test(text.trim());
      p.agent = { ...item.agent, summary: item.agent.summary ?? (text && !launched ? text.slice(0, 300) : undefined) };
      if ((launched || /running in the background|在后台/i.test(text)) && !isError) {
        p.status = 'running';
        p.background = true;
        p.right = '后台运行';
        if (launched) p.output = undefined;
      }
    }
    if ((track.name === 'Bash' || track.name === 'PowerShell') && (structured as { backgroundTaskId?: string } | undefined)?.backgroundTaskId) {
      p.status = 'running';
      p.background = true;
      p.right = '后台运行';
    }
    // A foreground task (subagent or command) ends with its result; one that went to the background goes on.
    const task = l.taskByTool.get(b.tool_use_id);
    if (task && !p.background) {
      const cur = rt(l.sid)!.background.find((x) => x.id === task);
      if (cur?.status === 'running') upsertBg(l.sid, { ...cur, status: isError ? 'failed' : 'completed', endedAt: Date.now() });
    }
    const said = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? (b.content as Block[]).map((x) => x.text ?? '').join('\n') : '';
    for (const fn of resultFns) Object.assign(p, fn(l.sid, track.name, track.input, said, isError) ?? {});
    patchTool(l, b.tool_use_id, p);
    if (r.change && !isError) addChange(l, r.change);
  }
}

function addChange(l: Live, c: { path: string; kind: 'created' | 'modified'; diff: string[]; add: number; del: number }) {
  // Claude Code's own files (plans written in plan mode…) are not changes to the project.
  const abs = path.resolve(l.cwd, c.path).toLowerCase();
  if (abs.startsWith(path.resolve(configDir()).toLowerCase() + path.sep)) return;
  const r = rt(l.sid)!;
  const afterUserId = l.turn?.userId ?? lastUserId(l.sid);
  const i = r.changes.findIndex((x) => x.path === c.path && x.afterUserId === afterUserId);
  let changes: FileChange[];
  if (i >= 0) {
    const old = r.changes[i];
    changes = r.changes.map((x, j) => (j === i ? { ...old, add: old.add + c.add, del: old.del + c.del, diff: [...old.diff, ...c.diff] } : x));
  } else {
    changes = [...r.changes, { path: c.path, kind: c.kind, add: c.add, del: c.del, diff: c.diff, afterUserId }];
  }
  emit(l.sid, { t: 'changes', changes });
}

function onSubagentAssistant(l: Live, parentId: string, blocks: Block[]) {
  const item = findItem(l.sid, parentId) as ToolItem | undefined;
  if (!item?.agent) return;
  let agent = item.agent;
  for (const b of blocks) {
    if (b.type === 'tool_use' && b.id && b.name) {
      l.tools.set(b.id, { name: b.name, input: b.input ?? {}, startedAt: Date.now(), parent: parentId });
      agent = { ...agent, rows: [...agent.rows, agentRow(b.name, b.input ?? {}, l.cwd)].slice(-40), toolCalls: agent.toolCalls + 1 };
    } else if (b.type === 'text' && b.text?.trim()) {
      agent = { ...agent, summary: b.text.trim().slice(0, 300) };
    }
  }
  patchItem(l.sid, parentId, { agent });
}

function onAssistantError(l: Live, error: string) {
  if (error === 'authentication_failed' || error === 'oauth_org_not_allowed') {
    addItem(l.sid, { kind: 'banner', id: randomUUID(), banner: 'notLoggedIn', detail: error });
  } else if (error === 'rate_limit') {
    addItem(l.sid, { kind: 'banner', id: randomUUID(), banner: 'rateLimit' });
    for (const fn of limitFns) fn(l.sid, l.rejection);
  }
}

function onResult(l: Live, m: Extract<SDKMessage, { type: 'result' }>) {
  const { sid } = l;
  const r = rt(sid);
  if (!r) return;
  const u = m.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  recordUsage(m.modelUsage as Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>, summary(sid)?.workspaceId);
  const turn = l.turn;
  const interrupted = !!turn?.interrupted || m.terminal_reason === 'aborted_streaming' || m.terminal_reason === 'aborted_tools';
  const startup = m.subtype !== 'success' ? m.startup_failure_reason : undefined;
  raw(sid, `result/${m.subtype}`, `${(m.duration_ms / 1000).toFixed(1)} 秒 · ${m.num_turns} 轮 API · ${tokens} tokens · ${m.stop_reason ?? m.terminal_reason ?? ''}`, m);
  if (startup) {
    addItem(sid, { kind: 'banner', id: randomUUID(), banner: 'startupFailure', detail: startup });
  } else if (m.subtype !== 'success' && !interrupted) {
    const errs = (m as { errors?: string[] }).errors ?? [];
    if (errs.length) addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'warn', text: `这一轮出错结束：${errs.join('；').slice(0, 400)}` });
  }
  if (m.permission_denials?.length && !interrupted) {
    const n = m.permission_denials.length;
    if (r.mode === 'dontAsk' || n >= 3) addItem(sid, { kind: 'banner', id: randomUUID(), banner: 'denials', detail: String(n) });
  }
  closeOpenItems(l, interrupted ? '已中断' : '未完成');
  // Local commands and compaction make no API turn: no footer, the turn count stays.
  const silent = m.num_turns === 0 && !tokens && !interrupted;
  const turnNo = silent ? r.turn : r.turn + 1;
  if (!silent) {
    addItem(sid, {
      kind: 'footer', id: randomUUID(), turn: turnNo, seconds: Math.round(m.duration_ms / 100) / 10, toolCalls: turn?.toolCalls ?? 0, tokens,
      stopReason: interrupted ? 'interrupted' : m.subtype === 'success' ? (m.stop_reason ?? 'end_turn') : m.subtype,
    });
  }
  emit(sid, { t: 'settings', patch: { turn: turnNo, tokens: r.tokens + tokens } });
  l.turn = null;
  l.group = null;
  l.streams.clear();
  emit(sid, { t: 'status', status: null });
  if (!l.asks.length) emit(sid, { t: 'state', state: 'idle' });
  void refreshContext(sid);
  void l.q.mcpServerStatus().then((list) => import('../ext/mcp').then((m) => m.noteSessionMcp(summary(sid)?.workspaceId ?? '', list))).catch(() => undefined);
  const lastText = [...rt(sid)!.items].reverse().find((x): x is Extract<Item, { kind: 'text' }> => x.kind === 'text');
  const sum = summary(sid);
  if (sum && !sum.jobId && !interrupted) {
    broadcast({ t: 'notify', n: {
      kind: 'turnDone', sid, title: m.subtype === 'success' ? `「${sum.title}」这一轮已完成` : `「${sum.title}」这一轮已结束`, tone: m.subtype === 'success' ? 'good' : 'warn',
      body: lastText ? lastText.text.replace(/\s+/g, ' ').slice(0, 60) : undefined,
    } });
  }
  const info: TurnInfo = { ok: m.subtype === 'success', interrupted, text: m.subtype === 'success' ? m.result : '', userId: turn?.userId ?? '', structured: (m as { structured_output?: unknown }).structured_output, meta: turn?.meta,
    subtype: m.subtype, errors: (m as { errors?: string[] }).errors, turns: m.num_turns };
  for (const fn of turnEndFns) {
    try {
      fn(sid, info);
    } catch (e) {
      console.error('[live] turn-end handler failed:', e);
    }
  }
}

export async function refreshContext(sid: string, precise = false) {
  const l = lives.get(sid);
  if (!l) return;
  try {
    const c = await l.q.getContextUsage({ detail: precise ? 'full' : 'summary' });
    emit(sid, { t: 'context', context: contextFrom(c, precise) });
  } catch (e) {
    emit(sid, { t: 'stderr', line: `上下文用量读取失败：${e instanceof Error ? e.message : String(e)}` });
  }
}

function onSystem(l: Live, m: { subtype: string } & Record<string, unknown>) {
  const { sid } = l;
  const s = m.subtype;
  switch (s) {
    case 'init': {
      const tools = (m.tools as string[] | undefined)?.length ?? 0;
      const mcp = (m.mcp_servers as Array<{ name: string; status: string }> | undefined) ?? [];
      raw(sid, 'system/init', `${String(m.model)} · ${tools} 个工具 · ${mcp.length} 个 MCP · ${String(m.permissionMode)}`, m);
      emit(sid, { t: 'settings', patch: { info: {
        ...rt(sid)?.info, version: String(m.claude_code_version ?? ''), cwd: String(m.cwd ?? ''), apiModel: String(m.model ?? ''),
        outputStyle: String(m.output_style ?? ''), tools, agents: (m.agents as string[] | undefined) ?? [], mcp: mcp.map((x) => ({ name: x.name, status: x.status })),
      } } });
      emit(sid, { t: 'context', context: { ...rt(sid)!.context, model: String(m.model ?? '') } });
      return;
    }
    case 'status': {
      const st = m.status as string | null;
      if (st === 'compacting') emit(sid, { t: 'status', status: { kind: 'compacting', progress: 50 } });
      else if (l.turn) emit(sid, { t: 'status', status: { kind: 'working', label: st === 'requesting' ? '正在请求' : '正在思考' } });
      if (typeof m.permissionMode === 'string' && m.permissionMode !== rt(sid)?.mode && m.permissionMode !== 'auto') {
        emit(sid, { t: 'settings', patch: { mode: m.permissionMode as never } });
      }
      raw(sid, 'system/status', String(st ?? '空闲'), m);
      return;
    }
    case 'api_retry': {
      const status = typeof m.error_status === 'number' ? m.error_status : null;
      raw(sid, 'system/api_retry', `第 ${String(m.attempt)} 次重试 · ${status ?? '无响应'} ${String(m.error)}`, m);
      const rejected = pointlessRetry(l.model, { error: m.error, error_status: m.error_status });
      if (rejected && l.turn && !l.turn.interrupted) {
        const ep = app.provider.endpoints.find((e) => l.model.startsWith(`ep:${e.id}:`));
        addItem(sid, { kind: 'banner', id: randomUUID(), banner: 'endpointRejected', detail: `${ep?.name || ep?.url || '兼容端点'} · ${rejected}` });
        void interruptTurn(sid);
        return;
      }
      emit(sid, { t: 'status', status: { kind: 'retry', attempt: Number(m.attempt), max: Number(m.max_retries), seconds: Math.round(Number(m.retry_delay_ms) / 1000), reason: apiErrorText(String(m.error), status) } });
      return;
    }
    case 'compact_boundary': {
      const md = m.compact_metadata as { trigger: string; pre_tokens: number; post_tokens?: number };
      addItem(sid, { kind: 'divider', id: randomUUID(), label: `对话已压缩 · ${md.trigger === 'manual' ? '手动' : '自动'} · 压缩前 ${Math.round(md.pre_tokens / 1000)}k${md.post_tokens ? ` · 压缩后 ${Math.round(md.post_tokens / 1000)}k` : ''}` });
      emit(sid, { t: 'status', status: null });
      raw(sid, 'system/compact_boundary', `${md.trigger} · pre_tokens ${md.pre_tokens}`, m);
      return;
    }
    case 'task_started': {
      const taskId = String(m.task_id);
      if (m.subagent_type) l.taskTypes.set(taskId, String(m.subagent_type));
      const kind: BgTask['kind'] = m.task_type === 'local_bash' ? 'bash' : m.task_type === 'local_workflow' ? 'workflow' : m.task_type === 'monitor' ? 'monitor' : 'agent';
      if (m.tool_use_id) {
        l.taskByTool.set(String(m.tool_use_id), taskId);
        const card = findItem(sid, String(m.tool_use_id));
        if (card?.kind === 'tool' && card.status === 'running' && !card.background && m.is_backgrounded !== true) patchItem(sid, card.id, { backgroundable: true });
      }
      if (m.is_backgrounded === true || kind === 'bash' || kind === 'monitor') {
        upsertBg(sid, { id: taskId, kind, name: String(m.description ?? ''), status: 'running', startedAt: Date.now(), parent: m.parent_task_id as string | undefined });
      }
      raw(sid, 'system/task_started', String(m.description ?? ''), m);
      return;
    }
    case 'task_updated': {
      const p = m.patch as { status?: string; is_backgrounded?: boolean; description?: string };
      const taskId = String(m.task_id);
      const cur = rt(sid)!.background.find((b) => b.id === taskId);
      if (p.is_backgrounded && !cur) upsertBg(sid, { id: taskId, kind: 'agent', name: p.description ?? '', status: 'running', startedAt: Date.now() });
      if (p.status && cur) {
        const st = p.status === 'completed' ? 'completed' : p.status === 'failed' ? 'failed' : p.status === 'killed' ? 'stopped' : 'running';
        upsertBg(sid, { ...cur, status: st, ...(st !== 'running' ? { endedAt: Date.now() } : {}) });
      }
      raw(sid, 'system/task_updated', `${taskId} · ${p.status ?? ''}`, m);
      return;
    }
    case 'task_progress': {
      const toolUse = m.tool_use_id as string | undefined;
      const usage = m.usage as { total_tokens: number; tool_uses: number };
      if (toolUse) {
        const item = findItem(sid, toolUse) as ToolItem | undefined;
        if (item?.agent) patchItem(sid, toolUse, { agent: { ...item.agent, tokens: usage.total_tokens, toolCalls: Math.max(item.agent.toolCalls, usage.tool_uses), ...(m.summary ? { summary: String(m.summary) } : {}) } });
      }
      const cur = rt(sid)!.background.find((b) => b.id === m.task_id);
      if (cur) upsertBg(sid, { ...cur, tokens: usage.total_tokens, ...(m.summary ? { summary: String(m.summary) } : {}) });
      raw(sid, 'system/task_progress', `${String(m.description ?? '')} · ${usage.tool_uses} 次工具调用`, m);
      return;
    }
    case 'task_notification': {
      const taskId = String(m.task_id);
      const st = m.status === 'completed' ? 'completed' : m.status === 'failed' ? 'failed' : 'stopped';
      const cur = rt(sid)!.background.find((b) => b.id === taskId);
      if (cur) upsertBg(sid, { ...cur, status: st, summary: String(m.summary ?? cur.summary ?? ''), endedAt: Date.now(), ...(m.output_file ? { outputFile: String(m.output_file) } : {}) });
      const toolUse = m.tool_use_id as string | undefined;
      if (toolUse) {
        const item = findItem(sid, toolUse) as ToolItem | undefined;
        if (item?.background) patchItem(sid, toolUse, { status: st === 'completed' ? 'ok' : 'error', right: st === 'completed' ? '后台已完成' : st === 'failed' ? '后台失败' : '已停止' });
      }
      raw(sid, 'system/task_notification', `${String(m.summary ?? '')} · ${st}`, m);
      const sum = summary(sid);
      if (cur && sum && !sum.jobId) {
        broadcast({ t: 'notify', n: { kind: 'background', sid, title: st === 'completed' ? `后台任务已完成：${cur.name}` : st === 'failed' ? `后台任务失败：${cur.name}` : `后台任务已停止：${cur.name}`, tone: st === 'completed' ? 'good' : 'warn', action: '查看' } });
      }
      return;
    }
    case 'background_tasks_changed':
      raw(sid, 'system/background_tasks_changed', `${(m.tasks as unknown[]).length} 个后台任务`, m);
      return;
    case 'permission_denied': {
      const id = String(m.tool_use_id);
      const why = String(m.decision_reason ?? m.message ?? '');
      if (findItem(sid, id)) patchItem(sid, id, { status: 'denied', provenance: denialText(String(m.decision_reason_type ?? ''), why), right: undefined });
      raw(sid, 'system/permission_denied', `${String(m.tool_name)} · ${why}`, m);
      return;
    }
    case 'model_refusal_fallback':
      addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'info', text: `${String(m.original_model)} 拒绝了这个请求，已改用 ${String(m.fallback_model)} 重试。下面的回复来自回退模型。` });
      raw(sid, 'system/model_refusal_fallback', `${String(m.original_model)} → ${String(m.fallback_model)}`, m);
      return;
    case 'model_refusal_no_fallback':
      addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'warn', text: `${String(m.original_model)} 拒绝了这个请求：${String(m.content ?? '')}` });
      raw(sid, 'system/model_refusal_no_fallback', String(m.original_model), m);
      return;
    case 'worker_shutting_down':
      addItem(sid, { kind: 'banner', id: randomUUID(), banner: 'workerShutdown', detail: String(m.reason ?? '') });
      return;
    case 'local_command_output':
      addItem(sid, { kind: 'text', id: randomUUID(), text: String(m.content ?? '') });
      raw(sid, 'system/local_command_output', String(m.content ?? '').slice(0, 80), m);
      return;
    case 'informational':
      if (m.level === 'warning' || m.level === 'notice') addItem(sid, { kind: 'notice', id: randomUUID(), tone: m.level === 'warning' ? 'warn' : 'info', text: String(m.content ?? '') });
      raw(sid, 'system/informational', String(m.content ?? '').slice(0, 80), m);
      return;
    case 'notification':
      raw(sid, 'system/notification', String(m.text ?? ''), m);
      return;
    case 'elicitation_complete': {
      const req = rt(sid)?.request;
      if (req?.kind === 'elicitation') answerRequest(sid, req.id, { action: 'accept', content: {} });
      raw(sid, 'system/elicitation_complete', String(m.mcp_server_name ?? ''), m);
      return;
    }
    case 'hook_response':
    case 'hook_started':
    case 'hook_progress':
      void import('../ext/hooks').then((h) => h.noteFileHook(sid, m));
      raw(sid, `system/${s}`, `${String(m.hook_event ?? m.hook_event_name ?? '')} · ${String(m.hook_name ?? '')}`, m);
      return;
    case 'session_state_changed':
      if (m.state === 'running' && !l.turn) ensureTurn(l);
      raw(sid, 'system/session_state_changed', String(m.state), m);
      return;
    default:
      raw(sid, `system/${s}`, '', m);
  }
}

function denialText(type: string, why: string): string {
  if (type === 'rule') return `被拒绝规则拦截${why ? `：${why}` : ''}`;
  if (type === 'mode') return '「不询问」模式下未预先授权';
  if (type === 'hook') return `被钩子拒绝${why ? `：${why}` : ''}`;
  return why ? `已拒绝：${why.slice(0, 80)}` : '已拒绝';
}

function upsertBg(sid: string, b: BgTask) {
  const r = rt(sid)!;
  const i = r.background.findIndex((x) => x.id === b.id);
  emit(sid, { t: 'background', background: i < 0 ? [...r.background, b] : r.background.map((x) => (x.id === b.id ? b : x)) });
}
