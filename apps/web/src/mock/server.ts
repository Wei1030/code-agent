/**
 * Mocked backend. Exposes the same operations the real Node server will offer; every call
 * mutates in-memory data and pushes session events into the store.
 */
import type {
  ApprovalAnswer, Attachment, BannerKind, Effort, ElicitationAnswer, Item, PermissionMode, PlanAnswer, QuestionAnswer,
  QueuedMessage, SessionRef,
} from '../api/types';
import { useApp } from '../store/app';
import { emptyRuntime, useSessions } from '../store/sessions';
import { uid } from '../lib/util';
import { baseContext, genericTranscript, MODELS, WORKSPACES } from './data';
import { JOB_OUTPUTS } from './jobs';
import { fillVars } from '../lib/schedule';
import {
  addItem, answer, cancelRun, currentRun, emit, isRunning, onAfterTurn, raw, rt, runHooks, startRun, streamText,
  userItem,
} from './engine';
import {
  bootAuth, bootDocs, bootFlaky, footer, pickScenario, scenarioAck,
  scenarioCommand, scenarioElicitForm, scenarioElicitUrl, scenarioFix, scenarioHighRisk, scenarioJob, scenarioOutside, scenarioPlan, scenarioQuestion, scenarioSubagents, seedFlaky,
} from './scenarios';
import { humanTurn, scenarioAskPeer, scenarioRefs, scenarioSpawn, takeQueued } from './peer';

export { mockHeld, mockPeerMessage, rejectHeld, releaseHeld } from './peer';

const MODEL_ID: Record<string, string> = { opus: 'claude-opus-5-5', fable: 'claude-fable-5-1', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5' };

export function initRaw(sid: string) {
  const r = rt(sid)!;
  raw(sid, 'system/init', `${MODEL_ID[r.model] ?? r.model} · 23 个工具 · 2 个 MCP · ${r.mode}`, {
    model: MODEL_ID[r.model], permissionMode: r.mode, claude_code_version: '2.1.302', tools: 23, mcp_servers: [{ name: 'github', status: 'connected' }, { name: 'postgres', status: 'connected' }],
  });
  emit(sid, { t: 'stderr', line: `[${new Date().toISOString()}] claude-code 2.1.302 started (pid ${3000 + Math.floor(Math.random() * 5000)})` });
}

/** Make sure a session has runtime state (loads saved transcripts read-only). */
export function openSession(sid: string) {
  if (useSessions.getState().runtimes[sid]) return;
  const sum = useApp.getState().sessions.find((s) => s.id === sid);
  if (!sum) return;
  const items = genericTranscript(sum);
  useSessions.getState().init(emptyRuntime(sid, {
    items, readOnly: !sum.live, state: 'idle', turn: 1, tokens: sum.tokens,
    context: baseContext('claude-opus-5-5', 42_000),
  }));
}

/** New, empty session in a workspace. Nothing is created on the server until the first message. */
export function createDraft(workspaceId: string): string {
  const app = useApp.getState();
  const ws = app.workspaces.find((w) => w.id === workspaceId) ?? app.workspaces[0];
  // One unsent session per workspace is enough: reuse it.
  const unsent = app.sessions.find((s) => s.workspaceId === ws.id && s.draft);
  if (unsent) {
    app.set({ currentWorkspaceId: ws.id });
    return unsent.id;
  }
  const def = app.profiles.find((p) => p.isDefault) ?? app.profiles[0];
  const id = uid('s');
  app.upsertSession({
    id, workspaceId: ws.id, title: '新会话', firstPrompt: '', branch: ws.branch, createdAt: Date.now(), lastActive: Date.now(),
    tag: null, live: false, state: 'idle', forkedFrom: null, tokens: 0, draft: true,
  });
  useSessions.getState().init(emptyRuntime(id, { model: def.model, effort: def.effort, mode: def.mode }));
  app.set({ currentWorkspaceId: ws.id });
  return id;
}

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 18 ? `${t.slice(0, 18)}…` : t || '新会话';
}

export interface SendOptions {
  attachments?: Attachment[];
  priority?: 'now' | 'next' | 'later';
  contextOnly?: boolean;
  verbatim?: boolean;
  /** Sessions @-mentioned in the message. */
  refs?: SessionRef[];
}

/** Send a user message. While a turn runs, it is queued (or steers the turn with priority "now"). */
export function send(sid: string, text: string, opts: SendOptions = {}) {
  const app = useApp.getState();
  const sum = app.sessions.find((s) => s.id === sid);
  const r = rt(sid);
  if (!sum || !r) return;
  if (sum.draft) {
    app.patchSession(sid, { draft: false, live: true, title: titleFrom(text), firstPrompt: text, createdAt: Date.now() });
    initRaw(sid);
  }
  app.patchSession(sid, { lastActive: Date.now() });
  if (!opts.contextOnly) humanTurn(sid);

  if (opts.contextOnly) {
    userItem(sid, text, opts.attachments);
    addItem(sid, { kind: 'notice', id: uid('note'), tone: 'info', text: '已作为上下文添加，未开始新一轮。' });
    return;
  }
  if (r.request?.kind === 'question') {
    // A free-form message answers the pending question in the user's own words.
    userItem(sid, text, opts.attachments);
    answer(sid, r.request.id, { answers: {}, response: text });
    return;
  }
  if (!opts.verbatim && text.startsWith('/') && !isRunning(sid)) {
    runCommand(sid, text.trim());
    return;
  }
  if (isRunning(sid)) {
    const priority = opts.priority ?? 'next';
    if (priority === 'now') {
      userItem(sid, text, opts.attachments);
      currentRun(sid)?.steer.push(text);
      return;
    }
    emit(sid, { t: 'queue', queue: [...r.queue, { id: uid('q'), text, priority }] });
    return;
  }
  const refs = opts.refs?.length ? opts.refs : undefined;
  userItem(sid, text, opts.attachments, { refs });
  runHooks(sid, 'UserPromptSubmit', { prompt: text }, text.length > 24 ? `${text.slice(0, 24)}…` : text);
  void startRun(sid, refs ? (run) => scenarioRefs(run, refs, text) : pickScenario(text, r.mode));
}

function runCommand(sid: string, cmd: string) {
  const name = cmd.split(/\s+/)[0];
  userItem(sid, cmd);
  if (name === '/compact') {
    void compact(sid, cmd.slice(name.length).trim());
    return;
  }
  if (name === '/clear') {
    clearConversation(sid);
    return;
  }
  if (name === '/context') {
    useApp.getState().setInspector({ open: true, tab: 'context' });
    addItem(sid, { kind: 'notice', id: uid('note'), tone: 'info', text: '上下文用量已在右侧「上下文」中打开。' });
    return;
  }
  if (name === '/usage') {
    addItem(sid, { kind: 'notice', id: uid('note'), tone: 'info', text: '5 小时窗口已用 62% · 本周已用 41%。', action: '打开用量' });
    return;
  }
  void startRun(sid, (run) => scenarioCommand(run, cmd));
}

onAfterTurn((sid) => {
  const r = rt(sid);
  if (!r || r.queue.length === 0 || r.request) return;
  const [first, ...rest] = r.queue;
  emit(sid, { t: 'queue', queue: rest });
  if (takeQueued(first.id)) return;
  humanTurn(sid);
  userItem(sid, first.text);
  void startRun(sid, (run) => scenarioAck(run, first.text));
});

export function updateQueued(sid: string, id: string, p: Partial<QueuedMessage>) {
  const r = rt(sid);
  if (!r) return;
  const q = r.queue.find((x) => x.id === id);
  if (!q) return;
  if (p.priority === 'now' && isRunning(sid)) {
    emit(sid, { t: 'queue', queue: r.queue.filter((x) => x.id !== id) });
    userItem(sid, q.text);
    currentRun(sid)?.steer.push(q.text);
    return;
  }
  emit(sid, { t: 'queue', queue: r.queue.map((x) => (x.id === id ? { ...x, ...p } : x)) });
}

export function removeQueued(sid: string, id?: string) {
  const r = rt(sid);
  if (!r) return;
  emit(sid, { t: 'queue', queue: id ? r.queue.filter((x) => x.id !== id) : [] });
}

/** Interrupt the running turn. Returns the messages that are still queued. */
export function interrupt(sid: string): QueuedMessage[] {
  const r = rt(sid);
  if (!r) return [];
  const was = cancelRun(sid);
  if (!was) return [];
  // Close streaming items and running tools.
  for (const it of rt(sid)!.items) {
    if ((it.kind === 'text' || it.kind === 'thinking') && it.streaming) emit(sid, { t: 'item.patch', id: it.id, patch: { streaming: false, aborted: it.kind === 'text' } });
    if (it.kind === 'tool' && (it.status === 'running' || it.status === 'waiting') && !it.background) emit(sid, { t: 'item.patch', id: it.id, patch: { status: 'error', right: '已中断', backgroundable: false } });
  }
  addItem(sid, { kind: 'footer', id: uid('ft'), turn: r.turn + 1, seconds: 0, toolCalls: 0, tokens: 0, stopReason: 'interrupted' });
  emit(sid, { t: 'settings', patch: { turn: r.turn + 1 } });
  emit(sid, { t: 'state', state: 'idle' });
  emit(sid, { t: 'status', status: null });
  raw(sid, 'control_response', 'interrupt · 已中断', { still_queued: r.queue.map((q) => q.id) });
  return rt(sid)!.queue;
}

/** After an interrupt the user decided to keep queued messages: run them now. */
export function runQueued(sid: string) {
  const r = rt(sid);
  if (!r || r.queue.length === 0 || isRunning(sid)) return;
  const [first, ...rest] = r.queue;
  emit(sid, { t: 'queue', queue: rest });
  if (takeQueued(first.id)) return;
  userItem(sid, first.text);
  void startRun(sid, (run) => scenarioAck(run, first.text));
}

export function respondApproval(sid: string, requestId: string, a: ApprovalAnswer) {
  answer(sid, requestId, a);
}
export function respondQuestion(sid: string, requestId: string, a: QuestionAnswer) {
  answer(sid, requestId, a);
}
export function respondPlan(sid: string, requestId: string, a: PlanAnswer) {
  answer(sid, requestId, a);
}
export function respondElicitation(sid: string, requestId: string, a: ElicitationAnswer) {
  answer(sid, requestId, a);
}

/** URL-mode elicitation: the user opened the page; the mock "server" reports completion shortly after. */
export function openElicitationUrl(sid: string, requestId: string) {
  setTimeout(() => answer(sid, requestId, { action: 'accept', content: {} }), 2500);
}

export function setModel(sid: string, model: string) {
  const r = rt(sid);
  if (!r) return;
  const info = MODELS.find((m) => m.id === model);
  const effort = info && !info.efforts.includes(r.effort) ? info.efforts[info.efforts.length - 1] : r.effort;
  emit(sid, { t: 'settings', patch: { model, effort } });
  emit(sid, { t: 'context', context: { ...r.context, model: MODEL_ID[model] ?? model } });
  raw(sid, 'control_request', `set_model · ${MODEL_ID[model] ?? model}`, {});
}
export function setEffort(sid: string, effort: Effort) {
  emit(sid, { t: 'settings', patch: { effort } });
  raw(sid, 'control_request', `apply_flag_settings · effortLevel=${effort}`, {});
}
export function setMode(sid: string, mode: PermissionMode) {
  emit(sid, { t: 'settings', patch: { mode } });
  raw(sid, 'control_request', `set_permission_mode · ${mode}`, {});
}

/** Work that ends when the session's Claude Code process is stopped. */
export interface RunningWork {
  turn: boolean;
  request: boolean;
  background: string[];
  queued: number;
}

export function runningWork(sid: string): RunningWork {
  const r = rt(sid);
  if (!r) return { turn: false, request: false, background: [], queued: 0 };
  return {
    turn: isRunning(sid) && !r.request,
    request: !!r.request,
    background: r.background.filter((b) => b.status === 'running').map((b) => b.name),
    queued: r.queue.length,
  };
}

/**
 * The session to open for a workspace: the most recently active running session, else an unsent
 * new session, else the most recent saved one. Null when the workspace has no sessions.
 */
export function latestSession(workspaceId: string): string | null {
  const list = useApp.getState().sessions.filter((s) => s.workspaceId === workspaceId && !s.jobId);
  const newest = (xs: typeof list) => (xs.length ? xs.reduce((a, b) => (b.lastActive > a.lastActive ? b : a)).id : null);
  return newest(list.filter((s) => s.live && !s.draft)) ?? newest(list.filter((s) => s.draft)) ?? newest(list);
}

/** End the Claude Code process; the session becomes a saved, read-only session. Running work is killed. */
export function stop(sid: string) {
  cancelRun(sid);
  useApp.getState().set({ dirs: useApp.getState().dirs.filter((d) => d.sessionId !== sid) });
  const r = rt(sid);
  if (r?.request) emit(sid, { t: 'request', request: null });
  if (r?.background.some((b) => b.status === 'running')) {
    emit(sid, { t: 'background', background: r.background.map((b) => (b.status === 'running' ? { ...b, status: 'stopped', endedAt: Date.now() } : b)) });
  }
  emit(sid, { t: 'settings', patch: { readOnly: true } });
  emit(sid, { t: 'state', state: 'idle' });
  emit(sid, { t: 'queue', queue: [] });
  useApp.getState().patchSession(sid, { live: false, state: 'idle' });
  emit(sid, { t: 'stderr', line: `[${new Date().toISOString()}] process exited (code 0)` });
}

export function resume(sid: string) {
  openSession(sid);
  emit(sid, { t: 'settings', patch: { readOnly: false } });
  useApp.getState().patchSession(sid, { live: true, state: 'idle', lastActive: Date.now() });
  initRaw(sid);
}

export function backgroundTool(sid: string, toolId: string) {
  const run = currentRun(sid);
  if (run) run.backgrounded.add(toolId);
}

export function backgroundAll(sid: string) {
  const r = rt(sid);
  const run = currentRun(sid);
  if (!r || !run) return;
  r.items.forEach((it) => {
    if (it.kind === 'tool' && it.backgroundable && it.status === 'running') run.backgrounded.add(it.id);
  });
}

export function stopTask(sid: string, taskId: string) {
  const r = rt(sid);
  if (!r) return;
  emit(sid, { t: 'background', background: r.background.map((b) => (b.id === taskId ? { ...b, status: 'stopped', endedAt: Date.now() } : b)) });
  addItem(sid, { kind: 'notice', id: uid('note'), tone: 'warn', text: `已停止后台任务：${r.background.find((b) => b.id === taskId)?.name ?? ''}` });
  raw(sid, 'system/task_notification', 'stopped', { task_id: taskId, status: 'stopped' });
}

// ------------------------------------------------------------------ checkpoints, fork

export interface DryRun {
  canRewind: boolean;
  files: Array<{ path: string; what: 'deleted' | 'restored'; add: number; del: number }>;
  insertions: number;
  deletions: number;
  skippedLinks: number;
}

function userIndex(sid: string, userId: string) {
  return rt(sid)!.items.findIndex((it) => it.id === userId);
}

export function dryRun(sid: string, userId: string): DryRun {
  const r = rt(sid)!;
  const idx = userIndex(sid, userId);
  const affected = r.changes.filter((c) => {
    const ci = r.items.findIndex((it) => it.id === c.afterUserId);
    return ci >= idx;
  });
  const files = affected.map((c) => ({ path: c.path, what: c.kind === 'created' ? 'deleted' as const : 'restored' as const, add: c.kind === 'created' ? 0 : c.del, del: c.add }));
  return {
    canRewind: true,
    files,
    insertions: files.reduce((a, f) => a + f.add, 0),
    deletions: files.reduce((a, f) => a + f.del, 0),
    skippedLinks: files.length ? 1 : 0,
  };
}

/** Rewind files to before a user message; optionally fork the conversation there. Returns the fork id. */
export function rewind(sid: string, userId: string, fork: boolean): string | null {
  const r = rt(sid)!;
  const idx = userIndex(sid, userId);
  const keep = r.changes.filter((c) => r.items.findIndex((it) => it.id === c.afterUserId) < idx);
  const n = r.items.slice(0, idx + 1).filter((x) => x.kind === 'user').length;
  emit(sid, { t: 'changes', changes: keep });
  raw(sid, 'control_request', `rewind_files · ${userId}`, { user_message_id: userId });
  if (!fork) {
    addItem(sid, { kind: 'notice', id: uid('note'), tone: 'info', text: `文件已回退到消息 #${n} 之前。对话保持不变。` });
    return null;
  }
  return forkAt(sid, userId, `（回退后分叉）`);
}

/** Fork a session. With `beforeUserId`, the fork ends just before that message. */
export function forkAt(sid: string, beforeUserId?: string, suffix = '（分叉）'): string {
  const app = useApp.getState();
  const sum = app.sessions.find((s) => s.id === sid)!;
  openSession(sid);
  const r = rt(sid)!;
  const idx = beforeUserId ? userIndex(sid, beforeUserId) : r.items.length;
  const id = uid('s');
  const items: Item[] = r.items.slice(0, idx).map((it) => ({ ...it }));
  app.upsertSession({
    ...sum, id, title: `${sum.title}${suffix}`, live: true, state: 'idle', forkedFrom: sum.title, createdAt: Date.now(), lastActive: Date.now(), draft: false,
  });
  useSessions.getState().init(emptyRuntime(id, {
    items, model: r.model, effort: r.effort, mode: r.mode, context: r.context, turn: r.turn, tokens: r.tokens,
    changes: [], readOnly: false,
  }));
  initRaw(id);
  return id;
}

// ------------------------------------------------------------------ context

export async function compact(sid: string, instructions: string) {
  if (isRunning(sid)) return;
  await startRun(sid, async (run) => {
    for (let p = 0; p <= 100; p += 10) {
      emit(sid, { t: 'status', status: { kind: 'compacting', progress: p } });
      await new Promise((res) => setTimeout(res, 160));
      if (run.cancelled) return;
    }
    const r = rt(sid)!;
    const before = r.context.categories.find((c) => c.name === '消息')?.tokens ?? 0;
    addItem(sid, { kind: 'divider', id: uid('div'), label: `对话已压缩 · 手动 · 压缩前 ${Math.round((before + 30_000) / 1000)}k${instructions ? ` · 说明：${instructions.slice(0, 20)}` : ''}` });
    emit(sid, { t: 'context', context: baseContext(r.context.model, Math.round(before * 0.25)) });
    raw(sid, 'system/compact_boundary', `manual · pre_tokens ${before + 30_000}`, { compact_metadata: { trigger: 'manual', pre_tokens: before + 30_000 } });
  });
}

export function clearConversation(sid: string) {
  cancelRun(sid);
  const r = rt(sid)!;
  emit(sid, { t: 'items.reset', items: [{ kind: 'divider', id: uid('div'), label: '对话已清空 · 从这里重新开始' }] });
  emit(sid, { t: 'tasks', tasks: [] });
  emit(sid, { t: 'context', context: baseContext(r.context.model, 1200) });
  emit(sid, { t: 'state', state: 'idle' });
  raw(sid, 'conversation_reset', '/clear', {});
}

export async function preciseCount(sid: string): Promise<void> {
  await new Promise((res) => setTimeout(res, 900));
  const r = rt(sid)!;
  emit(sid, { t: 'context', context: { ...r.context, precise: true, categories: r.context.categories.map((c) => ({ ...c, tokens: Math.round(c.tokens * (0.96 + Math.random() * 0.08)) })) } });
}

// ------------------------------------------------------------------ session management

export function rename(sid: string, title: string) {
  useApp.getState().patchSession(sid, { title });
}
export function tag(sid: string, value: string | null) {
  useApp.getState().patchSession(sid, { tag: value });
}
export function remove(sid: string) {
  cancelRun(sid);
  useSessions.getState().drop(sid);
  useApp.getState().removeSession(sid);
}

export function exportMarkdown(sid: string): string {
  openSession(sid);
  const sum = useApp.getState().sessions.find((s) => s.id === sid)!;
  const lines = [`# ${sum.title}`, ''];
  for (const it of rt(sid)!.items) {
    if (it.kind === 'user') lines.push(`**你：** ${it.text}`, '');
    else if (it.kind === 'text') lines.push(it.text, '');
    else if (it.kind === 'tool') lines.push(`> ${it.tool} \`${it.detail}\``, '');
    else if (it.kind === 'toolgroup') lines.push(`> ${it.label}`, '');
    else if (it.kind === 'footer') lines.push(`---`, `第 ${it.turn} 轮 · ${it.tokens} tokens`, '');
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ jobs

/**
 * Run a job: a single-message session in the job's workspace with outputFormat set to its schema.
 * The real server's scheduler calls this at the scheduled times. Returns the run id.
 */
export function runJob(jobId: string, vars: Record<string, string>, trigger: 'manual' | 'schedule'): string {
  const app = useApp.getState();
  const job = app.jobs.find((j) => j.id === jobId)!;
  const ws = app.workspaces.find((w) => w.id === job.workspaceId) ?? app.workspaces[0];
  const prompt = fillVars(job.prompt, vars);
  const sid = uid('s');
  const runId = uid('run');
  const started = Date.now();
  app.upsertSession({
    id: sid, workspaceId: ws.id, title: `作业 · ${job.name}`, firstPrompt: prompt, branch: ws.branch, createdAt: started, lastActive: started,
    tag: '作业', live: true, state: 'running', forkedFrom: null, tokens: 0, jobId,
  });
  useSessions.getState().init(emptyRuntime(sid, { model: job.model, effort: job.effort, mode: job.mode }));
  initRaw(sid);
  userItem(sid, prompt);
  app.set({ jobRuns: [{ id: runId, jobId, trigger, startedAt: started, vars, status: 'running', turns: 0, tokens: 0, sessionId: sid }, ...app.jobRuns] });
  void startRun(sid, async (run) => {
    const ok = await scenarioJob(run, jobId);
    const r = rt(sid);
    const patchRun = {
      endedAt: Date.now(), status: ok ? 'success' as const : 'invalid' as const, output: ok ? JOB_OUTPUTS[jobId] ?? { summary: '已完成。' } : undefined,
      error: ok ? undefined : '重试 3 次后仍没有符合结构的输出（error_max_structured_output_retries）',
      turns: r?.turn ?? 1, tokens: r?.tokens ?? 0,
    };
    useApp.getState().set({ jobRuns: useApp.getState().jobRuns.map((x) => (x.id === runId ? { ...x, ...patchRun } : x)) });
    // One message per run: the process ends; the session stays saved and can be resumed.
    setTimeout(() => stop(sid), 0);
    const notify = job.notify === 'always' || (job.notify === 'failure' && !ok);
    if (notify && window.location.pathname !== '/jobs') {
      useApp.getState().toast(ok ? `作业「${job.name}」已完成` : `作业「${job.name}」失败：没有符合结构的输出`, ok ? 'good' : 'warn', {
        label: '查看', run: () => { window.history.pushState({}, '', '/jobs'); window.dispatchEvent(new PopStateEvent('popstate')); },
      });
    }
  });
  return runId;
}

/** Mock console: a scheduled job comes due. */
export function fireScheduledJob() {
  const app = useApp.getState();
  const job = app.jobs.find((j) => j.schedule.kind !== 'manual' && j.schedule.enabled);
  if (!job) { app.toast('没有启用定时的作业', 'warn'); return; }
  runJob(job.id, job.schedule.vars, 'schedule');
  app.toast(`定时作业「${job.name}」开始运行`, 'info');
}

/** Run once for the scheduled runs missed while the service was down. */
export function catchUpJob(jobId: string) {
  const app = useApp.getState();
  const job = app.jobs.find((j) => j.id === jobId)!;
  app.set({ jobs: app.jobs.map((j) => (j.id === jobId ? { ...j, missedRuns: 0 } : j)) });
  return runJob(jobId, job.schedule.vars, 'schedule');
}

// ------------------------------------------------------------------ mock console

export type Scenario = 'fix' | 'question' | 'plan' | 'subagents' | 'highRisk' | 'outside' | 'elicitForm' | 'elicitUrl' | 'spawn' | 'askPeer';

export function runScenario(sid: string, s: Scenario) {
  if (isRunning(sid)) return;
  const sum = useApp.getState().sessions.find((x) => x.id === sid);
  if (sum?.draft) useApp.getState().patchSession(sid, { draft: false, live: true, title: '模拟场景' });
  const text = { fix: 'CI 上结账测试偶尔失败，帮我修复。', question: '给 /orders 接口加上限流，有选择就问我。', plan: '用 Redis 给 /orders 限流，先出计划。', subagents: '找出所有用到 CartTimer 的地方，同时在后台跑 e2e。', highRisk: '把旧的构建目录删掉。', outside: '金额是负数时显示不对，问题可能在共享库 shared-lib 里。', elicitForm: '在预发环境执行 orders 表的迁移。', elicitUrl: '在 jira 里建一个跟进任务：限流上线后观察 429 比例。', spawn: '订单导出要支持 CSV 和 Excel，拆成几个会话并行做。', askPeer: '看看其他会话里鉴权重构进展到哪了，我们的订单接口依赖它。' }[s];
  humanTurn(sid);
  userItem(sid, text);
  const fn = { fix: scenarioFix, question: scenarioQuestion, plan: scenarioPlan, subagents: scenarioSubagents, highRisk: scenarioHighRisk, outside: scenarioOutside, elicitForm: scenarioElicitForm, elicitUrl: scenarioElicitUrl, spawn: scenarioSpawn, askPeer: scenarioAskPeer }[s];
  void startRun(sid, fn);
}

export function injectBanner(sid: string, banner: BannerKind) {
  const app = useApp.getState();
  if (banner === 'apiRetry') {
    void startRun(sid, async (run) => {
      for (let attempt = 2; attempt <= 3; attempt++) {
        for (let sec = 6; sec > 0; sec--) {
          emit(sid, { t: 'status', status: { kind: 'retry', attempt, max: 10, seconds: sec } });
          await new Promise((res) => setTimeout(res, 1000));
          if (run.cancelled) return;
        }
      }
      emit(sid, { t: 'status', status: null });
      await streamText(run, '（重试成功）请求已恢复，继续处理。');
      footer(sid, 0, 14);
    });
    return;
  }
  if (banner === 'modelFallback') {
    addItem(sid, { kind: 'notice', id: uid('note'), tone: 'info', text: 'Opus 5.5 拒绝了这个请求，已改用 Sonnet 5 重试。下面的回复来自回退模型。' });
    return;
  }
  if (banner === 'crash' || banner === 'workerShutdown') {
    cancelRun(sid);
    emit(sid, { t: 'stderr', line: banner === 'crash' ? 'Error: ECONNRESET at TLSSocket.onConnectEnd' : 'worker shutting down: update installed' });
    emit(sid, { t: 'stderr', line: `[${new Date().toISOString()}] process exited (code ${banner === 'crash' ? 1 : 0})` });
    emit(sid, { t: 'settings', patch: { readOnly: true } });
    app.patchSession(sid, { live: false, state: 'idle' });
  }
  if (banner === 'notLoggedIn') app.setProvider({ loggedIn: false });
  addItem(sid, { kind: 'banner', id: uid('ban'), banner });
}

export function connectionDrop() {
  const app = useApp.getState();
  app.set({ connection: 'offline' });
  setTimeout(() => {
    useApp.getState().set({ connection: 'restored' });
    setTimeout(() => useApp.getState().set({ connection: 'online' }), 2500);
  }, 3500);
}

export function retryBanner(sid: string, itemId: string) {
  emit(sid, { t: 'item.patch', id: itemId, patch: { resolved: true } });
}

// ------------------------------------------------------------------ boot

let booted = false;

/** Seed live sessions with running work so the app has something to look at. */
export function boot() {
  if (booted) return;
  booted = true;
  const init = useSessions.getState().init;

  init(emptyRuntime('s-flaky', { items: seedFlaky(), turn: 1, tokens: 412_000, context: baseContext('claude-opus-5-5', 52_000) }));
  initRaw('s-flaky');
  void startRun('s-flaky', bootFlaky);

  init(emptyRuntime('s-auth', { mode: 'acceptEdits', model: 'sonnet', effort: 'max', turn: 2, tokens: 980_000, context: baseContext('claude-sonnet-5', 81_000),
    items: [
      { kind: 'user', id: 'auth-u1', text: '把鉴权中间件拆成独立模块，并补上测试。', attachments: [], ts: Date.now() - 40 * 60_000 },
      { kind: 'text', id: 'auth-t1', text: '已拆分完成，测试通过。' },
      { kind: 'footer', id: 'auth-f1', turn: 1, seconds: 312, toolCalls: 31, tokens: 640_000, stopReason: 'end_turn' },
      { kind: 'user', id: 'auth-u2', text: '找出所有用到 CartTimer 的地方，同时在后台跑一遍 e2e 测试。', attachments: [], ts: Date.now() - 60_000 },
    ] }));
  initRaw('s-auth');
  void startRun('s-auth', bootAuth);

  init(emptyRuntime('s-docs', { turn: 0, tokens: 160_000,
    items: [{ kind: 'user', id: 'docs-u1', text: '给 /orders 接口加上限流。', attachments: [], ts: Date.now() - 14 * 60_000 }] }));
  initRaw('s-docs');
  void startRun('s-docs', bootDocs);
}

export function resetSampleData(empty: boolean) {
  const app = useApp.getState();
  app.set({ workspaces: empty ? [] : WORKSPACES });
}

