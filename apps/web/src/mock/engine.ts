/**
 * Mock session engine: plays scripted agent turns into the session store, waits for the user's
 * answers to approvals / questions / plan reviews, and honours interrupts and queued messages.
 */
import type {
  ApprovalAnswer, Attachment, Item, PendingRequest, PermissionMode, PermissionRule, PlanAnswer, PlanDoc, QuestionAnswer,
  SessionEvent, SessionRuntime, SessionState, ToolItem,
} from '../api/types';
import { evaluate } from '../lib/rules';
import { useApp } from '../store/app';
import { useSessions } from '../store/sessions';
import { uid, uuid } from '../lib/util';

export class Cancelled extends Error {}

export interface Run {
  sid: string;
  cancelled: boolean;
  /** Tool call moved to the background by the user. */
  backgrounded: Set<string>;
  /** Messages the user sent with priority "now" during this run. */
  steer: string[];
  wake: Array<() => void>;
}

const runs = new Map<string, Run>();
const waiters = new Map<string, (answer: unknown) => void>();

export function rt(sid: string): SessionRuntime | undefined {
  return useSessions.getState().runtimes[sid];
}

export function emit(sid: string, ev: SessionEvent) {
  useSessions.getState().apply(sid, ev);
  if (ev.t === 'state') syncSummary(sid, ev.state);
}

function syncSummary(sid: string, state: SessionState) {
  const app = useApp.getState();
  const sum = app.sessions.find((s) => s.id === sid);
  if (sum) app.patchSession(sid, { state, lastActive: Date.now() });
}

export function raw(sid: string, type: string, summary: string, json: unknown = {}) {
  emit(sid, { t: 'raw', type, summary, json: { type: type.split('/')[0], ...(type.includes('/') ? { subtype: type.split('/')[1] } : {}), session_id: sid, ...((json as object) ?? {}) } });
}

export function currentRun(sid: string): Run | undefined {
  return runs.get(sid);
}

export function isRunning(sid: string): boolean {
  return runs.has(sid);
}

function check(run: Run) {
  if (run.cancelled) throw new Cancelled();
}

export function sleep(run: Run, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      run.wake = run.wake.filter((w) => w !== cancel);
      if (run.cancelled) reject(new Cancelled());
      else resolve();
    }, ms);
    const cancel = () => {
      clearTimeout(timer);
      reject(new Cancelled());
    };
    run.wake.push(cancel);
  });
}

/** Start a scripted run; resolves when it ends (normally, by error or by interrupt). */
export async function startRun(sid: string, body: (run: Run) => Promise<void>): Promise<void> {
  const run: Run = { sid, cancelled: false, backgrounded: new Set(), steer: [], wake: [] };
  runs.set(sid, run);
  emit(sid, { t: 'state', state: 'running' });
  try {
    await body(run);
  } catch (e) {
    if (!(e instanceof Cancelled)) throw e;
  } finally {
    if (runs.get(sid) === run) runs.delete(sid);
    const r = rt(sid);
    if (r && !r.request) emit(sid, { t: 'state', state: 'idle' });
    emit(sid, { t: 'status', status: null });
  }
  // A queued message waiting for the end of the turn starts the next one.
  if (!run.cancelled) afterTurn(sid);
}

let afterTurnHook: (sid: string) => void = () => {};
export function onAfterTurn(fn: (sid: string) => void) {
  afterTurnHook = fn;
}
function afterTurn(sid: string) {
  afterTurnHook(sid);
}

export function cancelRun(sid: string): boolean {
  const run = runs.get(sid);
  if (!run) return false;
  run.cancelled = true;
  run.wake.forEach((w) => w());
  run.wake = [];
  // Settle open requests as cancelled.
  const r = rt(sid);
  if (r?.request) {
    waiters.delete(r.request.id);
    emit(sid, { t: 'request', request: null });
  }
  runs.delete(sid);
  return true;
}

// ------------------------------------------------------------------ building blocks

export function addItem(sid: string, item: Item, after?: string) {
  emit(sid, { t: 'item.add', item, after });
}

export function patch(sid: string, id: string, p: Record<string, unknown>) {
  emit(sid, { t: 'item.patch', id, patch: p as Partial<Item> });
}

/** Stream text into a new text item, character group by group. */
export async function streamText(run: Run, text: string, opts: { thinking?: boolean; seconds?: number; speed?: number } = {}): Promise<string> {
  const id = uid(opts.thinking ? 'th' : 'txt');
  const item: Item = opts.thinking
    ? { kind: 'thinking', id, text: '', seconds: opts.seconds ?? 4, streaming: true }
    : { kind: 'text', id, text: '', streaming: true };
  addItem(run.sid, item);
  const chunks = text.match(/.{1,3}/gsu) ?? [text];
  const delay = opts.speed ?? 28;
  try {
    for (const c of chunks) {
      await sleep(run, delay);
      emit(run.sid, { t: 'item.append', id, text: c });
    }
  } catch (e) {
    if (e instanceof Cancelled) patch(run.sid, id, { streaming: false, aborted: !opts.thinking });
    throw e;
  }
  patch(run.sid, id, { streaming: false });
  raw(run.sid, 'assistant', opts.thinking ? `思考（${opts.seconds ?? 4} 秒）` : `文本（${text.length} 字）`, {
    message: { role: 'assistant', content: [{ type: opts.thinking ? 'thinking' : 'text', [opts.thinking ? 'thinking' : 'text']: text }] },
  });
  return id;
}

export function setStatusWorking(sid: string, label: string | null) {
  emit(sid, { t: 'status', status: label ? { kind: 'working', label } : null });
}

/** Ask the user; resolves with their answer. Leaves the session in requires_action meanwhile. */
export function waitFor<T>(run: Run, req: PendingRequest): Promise<T> {
  check(run);
  emit(run.sid, { t: 'request', request: req });
  emit(run.sid, { t: 'state', state: 'requires_action' });
  raw(run.sid, 'control_request', req.kind === 'approval' ? `can_use_tool · ${req.tool}` : req.kind === 'question' ? 'can_use_tool · AskUserQuestion' : 'can_use_tool · ExitPlanMode', { request_id: req.id });
  return new Promise<T>((resolve, reject) => {
    waiters.set(req.id, (a) => {
      emit(run.sid, { t: 'request', request: null });
      emit(run.sid, { t: 'state', state: 'running' });
      resolve(a as T);
    });
    run.wake.push(() => reject(new Cancelled()));
  });
}

export function answer(sid: string, requestId: string, a: ApprovalAnswer | QuestionAnswer | PlanAnswer): boolean {
  const w = waiters.get(requestId);
  if (!w) return false;
  waiters.delete(requestId);
  raw(sid, 'control_response', `request_id ${requestId}`, { response: a });
  w(a);
  return true;
}

// ------------------------------------------------------------------ permissions

export type Decision = { allowed: true; provenance: string } | { allowed: false; reason: 'deny-rule' | 'dont-ask'; rule?: string } | { ask: true };

/** Rules "remembered" for one session only; they live as long as its process. */
const sessionRules = new Map<string, string[]>();

/** Rules that apply to a session: global, its workspace (local + repository) and session-only ones. */
export function rulesFor(sid: string): PermissionRule[] {
  const app = useApp.getState();
  const ws = app.sessions.find((s) => s.id === sid)?.workspaceId;
  const own = (sessionRules.get(sid) ?? []).map((rule, i) => ({ id: `session-${i}`, behavior: 'allow' as const, rule, scope: 'workspace' as const }));
  return [...app.rules.filter((r) => r.scope === 'global' || r.workspaceId === ws), ...own];
}

export function decide(sid: string, mode: PermissionMode, tool: string, command?: string): Decision | { ask: true } {
  const o = evaluate(rulesFor(sid), tool, command ?? '');
  if (o.kind === 'deny') return { allowed: false, reason: 'deny-rule', rule: o.rule.rule };
  if (o.kind === 'ask') return mode === 'dontAsk' ? { allowed: false, reason: 'dont-ask' } : { ask: true };
  if (mode === 'bypassPermissions') return { allowed: true, provenance: '模式：跳过权限检查' };
  const isEdit = tool === 'Edit' || tool === 'Write';
  if (mode === 'acceptEdits' && isEdit) return { allowed: true, provenance: '模式：自动接受编辑' };
  if (o.kind === 'allow') return { allowed: true, provenance: `规则 ${o.rule.rule}` };
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return { allowed: true, provenance: '只读操作' };
  if (mode === 'dontAsk') return { allowed: false, reason: 'dont-ask' };
  return { ask: true };
}

/**
 * Run the permission flow for a tool item. Returns the provenance when allowed, or null when
 * denied (the item is marked denied and Claude is told why).
 */
export async function authorize(run: Run, tool: ToolItem, opts: {
  command?: string; description?: string; diff?: { path: string; lines: string[] }; agent?: string;
  reason?: string; title?: string; defaultToNo?: boolean;
}): Promise<{ provenance: string; command?: string } | null> {
  const r = rt(run.sid)!;
  const d = opts.defaultToNo ? { ask: true as const } : decide(run.sid, r.mode, tool.tool, opts.command);
  if ('allowed' in d && d.allowed) return { provenance: d.provenance };
  if ('allowed' in d && !d.allowed) {
    const why = d.reason === 'deny-rule' ? `被拒绝规则 ${d.rule} 拦截` : '「不询问」模式下未预先授权';
    patch(run.sid, tool.id, { status: 'denied', provenance: why });
    raw(run.sid, 'system/permission_denied', `${tool.tool} · ${why}`, { tool_name: tool.tool });
    return null;
  }
  patch(run.sid, tool.id, { status: 'waiting', right: '等待审批' });
  const reqId = uid('req');
  const rule = opts.command ? suggestRule(opts.command) : tool.tool === 'Edit' || tool.tool === 'Write' ? `Edit(${dirOf(opts.diff?.path)})` : tool.tool;
  const a = await waitFor<ApprovalAnswer>(run, {
    kind: 'approval', id: reqId, toolItemId: tool.id, tool: tool.tool,
    title: opts.title ?? (opts.command ? '允许执行这条命令？' : `允许修改 ${opts.diff?.path ?? '文件'}？`),
    reason: opts.reason ?? (opts.command ? '没有匹配这条命令的允许规则；当前会话对未授权的操作会先询问。' : '当前会话在编辑文件前会先询问。'),
    command: opts.command, description: opts.description, diff: opts.diff, agent: opts.agent,
    suggestions: opts.defaultToNo ? [] : [rule, opts.command ? `Bash(${opts.command.split(' ')[0]} *)` : 'Edit'],
    defaultToNo: opts.defaultToNo, since: Date.now(),
  });
  if (a.behavior === 'deny') {
    patch(run.sid, tool.id, { status: 'denied', right: undefined, provenance: '已被你拒绝', denialMessage: a.message });
    if (a.interrupt) {
      cancelRun(run.sid);
      throw new Cancelled();
    }
    return null;
  }
  if (a.remember) {
    const { rule: remembered, destination } = a.remember;
    if (destination === 'session') sessionRules.set(run.sid, [...(sessionRules.get(run.sid) ?? []), remembered]);
    else {
      const app = useApp.getState();
      const workspaceId = app.sessions.find((s) => s.id === run.sid)?.workspaceId;
      app.set({ rules: [...app.rules, { id: uid('rule'), behavior: 'allow', rule: remembered, scope: destination, workspaceId: destination === 'workspace' ? workspaceId : undefined }] });
    }
  }
  const edited = a.command && a.command !== opts.command;
  if (edited) patch(run.sid, tool.id, { detail: a.command });
  patch(run.sid, tool.id, { status: 'running', right: undefined });
  return { provenance: a.remember ? `已记住：${a.remember.rule}` : edited ? '已由你修改后批准' : '已由你批准', command: a.command };
}

function dirOf(path?: string): string {
  if (!path) return '/**';
  const parts = path.split('/');
  parts.pop();
  return `/${parts.join('/')}/**`;
}

function suggestRule(command: string): string {
  const words = command.split(' ');
  return words.length > 2 ? `Bash(${words.slice(0, 2).join(' ')} *)` : `Bash(${command})`;
}

// ------------------------------------------------------------------ helpers for scripts

export function userItem(sid: string, text: string, attachments: Attachment[] = []): string {
  const id = uuid();
  addItem(sid, { kind: 'user', id, text, attachments, ts: Date.now() });
  raw(sid, 'user', text.slice(0, 60), { uuid: id, message: { role: 'user', content: text } });
  return id;
}

export function lastUserId(sid: string): string {
  const items = rt(sid)?.items ?? [];
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'user') return items[i].id;
  return '';
}

export function newTool(sid: string, tool: string, detail: string, extra: Partial<ToolItem> = {}): ToolItem {
  const t: ToolItem = { kind: 'tool', id: uid('tool'), tool, detail, status: 'running', ...extra };
  addItem(sid, t);
  raw(sid, 'assistant', `tool_use ${tool} ${detail}`.slice(0, 80), { message: { content: [{ type: 'tool_use', name: tool, id: t.id }] } });
  return t;
}

export function finishTool(sid: string, t: ToolItem, p: Partial<ToolItem>) {
  patch(sid, t.id, { status: 'ok', ...p });
  raw(sid, 'user', `tool_result（${t.tool}）`, { message: { content: [{ type: 'tool_result', tool_use_id: t.id }] } });
  raw(sid, 'system/hook_response', 'PostToolUse · 审计日志 · ok', { hook_event_name: 'PostToolUse', outcome: 'success' });
}

export function setPlanStatus(sid: string, itemId: string, status: 'pending' | 'approved' | 'revised') {
  patch(sid, itemId, { status });
}

export function planItem(sid: string, version: number, plan: PlanDoc): string {
  const id = uid('plan');
  addItem(sid, { kind: 'plan', id, version, plan, status: 'pending' });
  return id;
}
