/**
 * Peer sessions: every session in a workspace can list, read, check, message and create the
 * others through the in-process MCP server "workspace". Messages go in over streaming input with
 * origin { kind: 'peer' }. Claude Code's own rule decides delivery: only senders of the same
 * permission class (bypass / prompting) are delivered unasked; a long chain without a human
 * message is held; held messages wait for the user in the inbox.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSdkMcpServer, tool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Effort, HeldMessage, NestedRow, PeerCall, PeerOrigin, PermissionMode, SessionRef, SessionSummary, ToolItem } from '@code-agent/shared/types';
import { emptyRuntime } from '@code-agent/shared/runtime';
import { app, update } from './state';
import { broadcast, register } from './hub';
import { WORKTREES_DIR } from './paths';
import { addItem, allSummaries, findItem, initRuntime, patchItem, patchSummary, raw, rt, summary, upsert } from './sessions/registry';
import { addContext, decorateTool, findToolUse, inTurn, live, onSendTurn, onTurnEnd, sendTurn, startProcess, type Outgoing } from './sessions/live';
import { addPromptPart, addSessionServers, workspaceOf } from './sessions/options';
import { acquire } from './sessions/slots';
import { enqueue, pumpQueue } from './sessions/ops';

const run = promisify(execFile);

/** Hops of the message that started each session's current turn; the user's own message resets it. */
const chainHops = new Map<string, number>();

export function humanTurn(sid: string) {
  chainHops.set(sid, 0);
}

onSendTurn((sid, m) => {
  if (m.meta?.hops !== undefined) chainHops.set(sid, m.meta.hops);
  else if (!m.from && !m.fromApp) chainHops.set(sid, 0);
});

interface Envelope {
  from: string;
  to: string;
  text: string;
  kind: PeerOrigin['kind'];
  hops: number;
  /** Send the sender a receipt when the receiver has handled it. */
  notify: boolean;
  /** The sender's tool call, updated as the message moves along. */
  toolId?: string;
}

const heldEnv = new Map<string, Envelope>();

const ref = (s: SessionSummary): SessionRef => ({ sessionId: s.id, title: s.title });
const modeClass = (sid: string) => (rt(sid)?.mode === 'bypassPermissions' ? 'bypass' as const : 'prompting' as const);
const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);

function stateLabel(s: SessionSummary): string {
  if (s.waiting) return '排队等空位';
  if (!s.live) return '已保存';
  if (s.state === 'running') return '运行中';
  if (s.state === 'requires_action') return '等用户处理';
  return '空闲';
}

function patchPeer(sid: string, toolId: string | undefined, p: Partial<PeerCall>) {
  if (!toolId) return;
  const t = findItem(sid, toolId) as ToolItem | undefined;
  if (t?.peer) patchItem(sid, toolId, { peer: { ...t.peer, ...p } });
}

// ------------------------------------------------------------------ delivery

function deliver(env: Envelope): 'delivered' | 'queued' | 'held' {
  const from = summary(env.from);
  const to = summary(env.to);
  if (!from || !to) return 'held';
  const reason: HeldMessage['reason'] | null = app.peer.inbound === 'hold' ? 'policy'
    : app.peer.inbound === 'parity' && modeClass(env.from) !== modeClass(env.to) ? 'mode'
      : env.kind === 'message' && env.hops > app.peer.maxHops ? 'hops' : null;
  if (reason) {
    hold(env, reason);
    return 'held';
  }
  return handOver(env);
}

function hold(env: Envelope, reason: HeldMessage['reason']) {
  const from = summary(env.from)!;
  const to = summary(env.to)!;
  const id = randomUUID();
  heldEnv.set(id, env);
  update('held', (h) => [...h, { id, from: ref(from), to: ref(to), text: env.text, reason, since: Date.now() }]);
  raw(env.from, 'system/peer_held', `→ ${to.title} · ${reason}`, { to: env.to, reason });
  broadcast({ t: 'notify', n: { kind: 'request', title: '有会话消息等你放行', body: `「${from.title}」发给「${to.title}」`, tone: 'warn', action: '查看', path: '#inbox' } });
}

function outgoing(env: Envelope): Outgoing {
  const from = summary(env.from)!;
  return {
    text: env.text,
    from: { ...ref(from), kind: env.kind },
    origin: { kind: 'peer', from: env.from, fromMode: modeClass(env.from), name: from.title, fromSession: env.from },
    meta: { hops: env.hops, ...(env.notify ? { receiptTo: env.from, senderToolId: env.toolId } : {}) },
  };
}

/** Start a turn in an idle receiver; queue it behind a busy one; resume a saved one first. */
function handOver(env: Envelope): 'delivered' | 'queued' {
  const to = summary(env.to)!;
  patchSummary(env.to, { peerUnread: (to.peerUnread ?? 0) + 1 });
  if (!live(env.to)) {
    enqueue(env.to, outgoing(env), 'later');
    void acquire(env.to, () => startProcess(env.to, { resume: !to.draft }), () => {
      if (pumpQueue(env.to)) patchPeer(env.from, env.toolId, { delivery: 'delivered' });
    }).then((started) => {
      if (!started) patchPeer(env.from, env.toolId, { delivery: 'queued' });
    });
    return 'queued';
  }
  const r = rt(env.to)!;
  if (inTurn(env.to) || r.request || r.queue.length) {
    enqueue(env.to, outgoing(env), 'later');
    return 'queued';
  }
  sendTurn(env.to, outgoing(env));
  return 'delivered';
}

onSendTurn((sid, m) => {
  // A queued peer message has started its turn: tell the sender's card.
  if (m.from && m.meta?.senderToolId) patchPeer(m.from.sessionId, m.meta.senderToolId, { delivery: 'delivered' });
  void sid;
});

/** When a session finishes a turn that handled a message asking for a receipt, tell the sender. */
onTurnEnd((sid, info) => {
  const to = info.meta?.receiptTo;
  if (!to || !summary(to)) return;
  patchPeer(to, info.meta?.senderToolId, { delivery: 'handled' });
  const me = summary(sid)!;
  // i18n-ignore: the prompt Claude reads.
  const gist = info.text ? short(info.text.replace(/\s+/g, ' '), 300) : '（这一轮没有文字回复）';
  deliver({
    from: sid, to, kind: 'receipt', hops: chainHops.get(sid) ?? 0, notify: false,
    // i18n-ignore: the prompt Claude reads.
    text: `会话「${me.title}」处理完了你的消息${info.ok ? '' : '（这一轮出错结束）'}。最后的回复：${gist}\n需要更多内容时用 read_session("${sid}")。`,
  });
});

/**
 * The held message's envelope; after a server restart only the list entry is left, which still
 * says who sent what to whom (the receipt and the sender's card are not followed any more).
 */
function takeHeld(id: string): Envelope | undefined {
  const h = app.held.find((x) => x.id === id);
  const env = heldEnv.get(id) ?? (h ? { from: h.from.sessionId, to: h.to.sessionId, text: h.text, kind: 'message' as const, hops: 0, notify: false } : undefined);
  heldEnv.delete(id);
  update('held', (all) => all.filter((x) => x.id !== id));
  return env;
}

function releaseHeld(id: string) {
  const env = takeHeld(id);
  if (!env || !summary(env.to) || !summary(env.from)) return;
  // Letting it through counts as the user's go-ahead: the chain starts over.
  patchPeer(env.from, env.toolId, { delivery: handOver({ ...env, hops: 0 }) });
}

function rejectHeld(id: string) {
  const env = takeHeld(id);
  if (!env || !rt(env.from)) return;
  const toTitle = summary(env.to)?.title ?? '';
  patchPeer(env.from, env.toolId, { delivery: 'rejected' });
  addItem(env.from, { kind: 'notice', id: randomUUID(), tone: 'warn', text: `你没有放行发给「${toTitle}」的消息，Claude 会在下一轮知道这件事。` });
  if (live(env.from)) addContext(env.from, { text: `The user did not let your message to session "${toTitle}" (${env.to}) through. Do not resend it unless the user asks.`, hidden: true });
}

// ------------------------------------------------------------------ create_session

const RANK: Record<PermissionMode, number> = { plan: 0, dontAsk: 0, default: 1, acceptEdits: 2, bypassPermissions: 3 };
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'task';
}

async function makeWorktree(wsPath: string, wsName: string, title: string): Promise<{ branch: string; dir: string }> {
  const id = randomUUID().slice(0, 6);
  const branch = `ca/${slug(title)}-${id}`;
  const dir = path.join(WORKTREES_DIR, slug(wsName), `${slug(title)}-${id}`);
  await run('git', ['worktree', 'add', '-b', branch, dir, 'HEAD'], { cwd: wsPath, windowsHide: true });
  return { branch, dir };
}

async function createSession(fromSid: string, a: { title: string; message: string; model?: string; effort?: Effort; mode?: PermissionMode; worktree?: boolean; notify?: boolean }, toolId?: string) {
  const from = summary(fromSid)!;
  const r = rt(fromSid)!;
  const ws = workspaceOf(fromSid);
  if (!ws) throw new Error('workspace not found');
  let wt: { branch: string; dir: string } | undefined;
  if (a.worktree) wt = await makeWorktree(ws.path, ws.name, a.title);
  const id = randomUUID();
  const now = Date.now();
  upsert({
    id, workspaceId: from.workspaceId, title: a.title, firstPrompt: a.message, branch: wt?.branch ?? from.branch, createdAt: now, lastActive: now,
    tag: null, live: false, state: 'idle', forkedFrom: null, tokens: 0, createdBy: ref(from), ...(wt ? { worktree: wt.branch, cwd: wt.dir } : {}),
  });
  // Never more permissive or more effortful than the creator.
  const mode = a.mode && RANK[a.mode] <= RANK[r.mode] ? a.mode : r.mode;
  const effort = a.effort && EFFORTS.indexOf(a.effort) <= EFFORTS.indexOf(r.effort) ? a.effort : r.effort;
  const model = a.model && app.models.some((m) => m.id === a.model) ? a.model : r.model;
  initRuntime(emptyRuntime(id, { model, effort, mode }));
  const env: Envelope = { from: fromSid, to: id, text: a.message, kind: 'message', hops: (chainHops.get(fromSid) ?? 0) + 1, notify: a.notify !== false, toolId };
  enqueue(id, outgoing(env), 'next');
  const started = await acquire(id, () => startProcess(id, { resume: false }), () => void pumpQueue(id));
  return { id, started, worktree: wt?.branch };
}

// ------------------------------------------------------------------ reading other sessions

function others(sid: string): SessionSummary[] {
  const me = summary(sid);
  return allSummaries().filter((s) => s.workspaceId === me?.workspaceId && s.id !== sid && !s.draft && !s.jobId).sort((a, b) => b.lastActive - a.lastActive);
}

function lastReply(sid: string): string {
  const items = rt(sid)?.items ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'text') return it.text;
  }
  return '';
}

/** One line per transcript entry: user and assistant text, one line per tool call. */
function condensed(sid: string): string[] {
  const out: string[] = [];
  for (const it of rt(sid)?.items ?? []) {
    if (it.kind === 'user') out.push(`[${it.from ? `session "${it.from.title}"` : it.fromApp ? `Code Agent · ${it.fromApp}` : 'user'}] ${it.text}`);
    else if (it.kind === 'text') out.push(`[claude] ${it.text}`);
    else if (it.kind === 'tool') out.push(`[tool] ${it.tool} ${it.detail}${it.right ? ` → ${it.right}` : ''}${it.status === 'error' || it.status === 'denied' ? ` (${it.status})` : ''}`);
    else if (it.kind === 'toolgroup') out.push(`[tools] ${it.label}: ${it.tools.map((x) => `${x.tool} ${x.detail}`).join('; ')}`);
    else if (it.kind === 'plan') out.push(`[plan v${it.version}, ${it.status}] ${it.plan.title}`);
    else if (it.kind === 'footer') out.push(`--- turn ${it.turn} ended (${it.stopReason}) ---`);
  }
  return out;
}

function statusLines(target: string): string[] {
  const s = summary(target)!;
  const r = rt(target);
  const lines = [`state: ${stateLabel(s)}${r?.turn ? ` · turn ${r.turn}` : ''}${s.worktree ? ` · worktree branch ${s.worktree}` : ''}`];
  if (r?.tasks.length) {
    const doing = r.tasks.find((x) => x.status === 'in_progress');
    lines.push(`tasks: ${r.tasks.filter((x) => x.status === 'completed').length}/${r.tasks.length} done${doing ? ` · now: ${doing.activeForm ?? doing.subject}` : ''}`);
  }
  const bg = r?.background.filter((b) => b.status === 'running') ?? [];
  if (bg.length) lines.push(`background: ${bg.map((b) => b.name).join(', ')}`);
  if (r?.request) lines.push('waiting for the user to answer a request');
  if (r?.queue.length) lines.push(`queued messages: ${r.queue.length}`);
  if (r?.changes.length) lines.push(`files changed: ${[...new Set(r.changes.map((c) => c.path))].join(', ')}`);
  const used = r?.context.categories.filter((c) => c.kind === 'used').reduce((a, c) => a + c.tokens, 0) ?? 0;
  if (r?.context.max) lines.push(`context: ${Math.round((used / r.context.max) * 100)}% used`);
  return lines;
}

async function loaded(target: string) {
  if (!rt(target)) await import('./sessions/history').then((h) => h.importTranscript(target));
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

function target(sid: string, id: string): SessionSummary {
  const s = summary(id);
  if (!s || s.workspaceId !== summary(sid)?.workspaceId) throw new Error(`No session ${id} in this workspace. Use list_sessions.`);
  return s;
}

function workspaceServer(sid: string): McpServerConfig {
  const own = (name: string, pred: (i: Record<string, unknown>) => boolean = () => true) => findToolUse(sid, `mcp__workspace__${name}`, pred);
  return createSdkMcpServer({
    name: 'workspace',
    version: '1.0.0',
    instructions: 'Tools for the other Claude Code sessions in this workspace (run by Code Agent) and for the workspace board.',
    alwaysLoad: true,
    tools: [
      tool('list_sessions', 'List the other sessions in this workspace: id, title, state, who created it, last activity and the start of its last reply.', {}, async () => {
        const list = others(sid);
        const rows: NestedRow[] = list.slice(0, 12).map((s) => ({ icon: 'chat', text: s.title, right: stateLabel(s) }));
        patchPeer(sid, own('list_sessions'), { rows });
        if (!list.length) return text('There are no other sessions in this workspace.');
        return text(list.map((s) => `- ${s.id} "${s.title}" · ${stateLabel(s)}${s.createdBy ? ` · created by "${s.createdBy.title}"` : ''} · last active ${new Date(s.lastActive).toISOString()}${lastReply(s.id) ? ` · last reply: ${short(lastReply(s.id).replace(/\s+/g, ' '), 120)}` : ''}`).join('\n'));
      }, { annotations: { readOnlyHint: true } }),
      tool('read_session', 'Read another session\'s conversation, condensed: user and assistant text and one line per tool call (no tool output). Pages from the end by default.', {
        session_id: z.string(), from: z.number().int().min(0).optional().describe('Index of the first entry; default: the last `limit` entries'),
        limit: z.number().int().min(1).max(200).optional(), query: z.string().optional().describe('Only entries containing this text'),
      }, async (a) => {
        const s = target(sid, a.session_id);
        await loaded(s.id);
        let entries = condensed(s.id).map((l, i) => ({ i, l }));
        if (a.query) entries = entries.filter((e) => e.l.toLowerCase().includes(a.query!.toLowerCase()));
        const limit = a.limit ?? 30;
        const page = a.from !== undefined ? entries.slice(a.from, a.from + limit) : entries.slice(-limit);
        patchPeer(sid, own('read_session', (i) => i.session_id === a.session_id), {
          rows: page.slice(-5).map((e) => ({ icon: e.l.startsWith('[claude]') ? 'spark' : e.l.startsWith('[tool') ? 'terminal' : 'user', text: short(e.l, 90) })),
        });
        return text(`Session "${s.title}" (${stateLabel(s)}), ${entries.length} entries${a.query ? ` matching "${a.query}"` : ''}; showing ${page.length}:\n${page.map((e) => `${e.i}. ${short(e.l, 2000)}`).join('\n')}`);
      }, { annotations: { readOnlyHint: true } }),
      tool('session_status', 'What another session is doing now: state, task list, background work, pending requests, files changed, context use.', {
        session_id: z.string(),
      }, async (a) => {
        const s = target(sid, a.session_id);
        await loaded(s.id);
        const lines = statusLines(s.id);
        patchPeer(sid, own('session_status', (i) => i.session_id === a.session_id), { rows: lines.map((l) => ({ icon: 'info', text: l })) });
        return text(`Session "${s.title}":\n${lines.join('\n')}`);
      }, { annotations: { readOnlyHint: true } }),
      tool('send_to_session', 'Send a message to another session of this workspace. A busy session gets it after its current turn; a saved one is resumed. With notify (default true) you get a receipt with its reply when it has handled the message.', {
        session_id: z.string(), message: z.string(), notify: z.boolean().optional(),
      }, async (a) => {
        const s = target(sid, a.session_id);
        const toolId = own('send_to_session', (i) => i.session_id === a.session_id);
        const res = deliver({ from: sid, to: s.id, text: a.message, kind: 'message', hops: (chainHops.get(sid) ?? 0) + 1, notify: a.notify !== false, toolId });
        patchPeer(sid, toolId, { delivery: res });
        const what = res === 'delivered' ? 'delivered; it is working on it now' : res === 'queued' ? 'queued; it will get it when it is free' : 'held for the user to approve (different permission class, or too many messages without a human in between)';
        return text(`Message to "${s.title}" ${what}.${a.notify !== false && res !== 'held' ? ' You will receive a receipt when it has handled it; keep working meanwhile.' : ''}`);
      }),
      tool('create_session', 'Create a new session in this workspace for a substantial piece of work the user may want to follow or join. Its first message is yours. Use worktree: true when it will edit files in parallel with other sessions. Built-in subagents are better for short side tasks.', {
        title: z.string().describe('Short title shown in the session list'), message: z.string().describe('The complete task for the new session'),
        model: z.string().optional(), effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
        mode: z.enum(['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']).optional(),
        worktree: z.boolean().optional(), notify: z.boolean().optional(),
      }, async (a) => {
        const toolId = own('create_session', (i) => i.title === a.title);
        try {
          const res = await createSession(sid, a, toolId);
          patchPeer(sid, toolId, { target: { sessionId: res.id, title: a.title }, delivery: res.started ? 'delivered' : 'queued', ...(res.worktree ? { worktree: res.worktree } : {}) });
          return text(`Created session "${a.title}" (id ${res.id})${res.worktree ? ` on its own git worktree, branch ${res.worktree}` : ''}. ${res.started ? 'It is working on your message.' : 'It waits for a free slot (running-session limit).'}${a.notify !== false ? ' You will receive a receipt when it finishes its first turn.' : ''}`);
        } catch (e) {
          patchPeer(sid, toolId, { delivery: 'rejected' });
          return { ...text(`Could not create the session: ${e instanceof Error ? e.message : String(e)}`), isError: true };
        }
      }),
      ...toolFactories.flatMap((f) => f(sid)),
    ],
  });
}

/** More tools on the same server (code review, board), added by their modules. */
type ToolFactory = (sid: string) => Array<ReturnType<typeof tool<any>>>;
const toolFactories: ToolFactory[] = [];
export function addWorkspaceTools(fn: ToolFactory) {
  toolFactories.push(fn);
}

addSessionServers((sid) => ({ workspace: workspaceServer(sid) }));

const OPS: Record<string, PeerCall['op']> = { list_sessions: 'list', read_session: 'read', session_status: 'status', send_to_session: 'send', create_session: 'create' };

decorateTool((_sid, name, input, item) => {
  const m = /^mcp__workspace__(\w+)$/.exec(name);
  const op = m && OPS[m[1]];
  if (!op) return;
  const id = typeof input.session_id === 'string' ? input.session_id : undefined;
  const s = id ? summary(id) : undefined;
  item.peer = {
    op, ...(s ? { target: ref(s) } : {}),
    ...(op === 'send' || op === 'create' ? { message: String(input.message ?? '') } : {}),
  };
  if (op === 'create') item.detail = String(input.title ?? '');
  item.provenance = undefined;
});

addPromptPart(() => [
  'You are one of possibly several Claude Code sessions in this workspace, run by Code Agent. The `workspace` MCP tools let you list the other sessions, read their conversations, check their status, send them messages and create new sessions.',
  'Messages from other sessions arrive as peer messages; answer them like a colleague would. Receipts tell you when a session you messaged has handled it.',
  'Use create_session for substantial parallel work the user may want to follow (worktree: true when it edits files alongside others); use built-in subagents for short side tasks.',
].join(' '));

register({
  releaseHeld,
  rejectHeld,
});

export { createSession };
