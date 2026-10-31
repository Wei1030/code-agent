/**
 * Peer sessions: every session in a workspace can list, read, check, message and create the
 * others, and search the workspace's conversations (its own too), through the in-process MCP
 * server "workspace". Messages go in over streaming input with
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
import type { Effort, HeldMessage, Item, NestedRow, PeerCall, PeerOrigin, PermissionMode, SessionRef, SessionSummary, ToolItem } from '@code-agent/shared/types';
import { emptyRuntime } from '@code-agent/shared/runtime';
import { app, update } from './state';
import { broadcast, register } from './hub';
import { WORKTREES_DIR } from './paths';
import { addItem, allSummaries, findItem, initRuntime, patchItem, patchSummary, raw, rt, searchTranscripts, summary, upsert } from './sessions/registry';
import { addContext, decorateTool, findToolUse, inTurn, live, onSendTurn, onTurnEnd, sendTurn, startProcess, type Outgoing } from './sessions/live';
import { addSessionServers, workspaceOf } from './sessions/options';
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

// ------------------------------------------------------------------ reading sessions and their history

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

/** Longest line read_session shows of an entry; read_entry has the rest. */
const LINE = 2000;
/** Most of an entry read_entry returns at once. */
const ENTRY = 20_000;

/** A transcript entry as read_session shows it; `more` when read_entry has more to show. */
interface Line { id: string; text: string; more: boolean }

const who = (it: Extract<Item, { kind: 'user' }>) => (it.from ? `session "${it.from.title}"` : it.fromApp ? `Code Agent · ${it.fromApp}` : 'user');
const toolLine = (t: ToolItem) => `${t.tool} ${t.detail}${t.right ? ` → ${t.right}` : ''}${t.status === 'error' || t.status === 'denied' ? ` (${t.status})` : ''}`;
const toolMore = (t: ToolItem) => !!(t.output || t.agent || t.denialMessage || t.rows?.length || t.images?.length);
const lineIcon = (text: string) => (text.startsWith('[claude]') ? 'spark' : text.startsWith('[tool') ? 'terminal' : text.startsWith('[plan') ? 'file' : 'user');

/** One line per transcript entry: user and assistant text, one line per tool call. */
function condensed(sid: string): Line[] {
  const out: Line[] = [];
  const add = (id: string, text: string, more = false) => out.push({ id, text, more: more || text.length > LINE });
  for (const it of rt(sid)?.items ?? []) {
    if (it.kind === 'user') add(it.id, `[${who(it)}] ${it.text}`);
    else if (it.kind === 'text') add(it.id, `[claude] ${it.text}`);
    else if (it.kind === 'tool') add(it.id, `[tool] ${toolLine(it)}`, toolMore(it));
    else if (it.kind === 'toolgroup') add(it.id, `[tools] ${it.label}: ${it.tools.map((x) => `${x.tool} ${x.detail}`).join('; ')}`, it.tools.some(toolMore));
    else if (it.kind === 'plan') add(it.id, `[plan v${it.version}, ${it.status}] ${it.plan.title}`, true);
    else if (it.kind === 'footer') add(it.id, `--- turn ${it.turn} ended (${it.stopReason}) ---`);
  }
  return out;
}

function toolText(t: ToolItem): string {
  const out = [`[tool] ${toolLine(t)}`];
  if (t.denialMessage) out.push(`Denied: ${t.denialMessage}`);
  if (t.agent) out.push(`Subagent ${t.agent.agentType}: ${t.agent.task}`, ...(t.agent.summary ? [t.agent.summary] : []), ...t.agent.rows.map((r) => `- ${r.text}`));
  if (t.rows?.length) out.push(...t.rows.map((r) => `- ${r.text}${r.right ? ` (${r.right})` : ''}`));
  if (t.output) out.push(`Output:\n${t.output.type === 'text' ? t.output.text : t.output.lines.join('\n')}`);
  else if (!t.agent) out.push('(no output kept)');
  if (t.images?.length) out.push(`(${t.images.length} image(s), not shown here)`);
  return out.join('\n');
}

/** An entry in full: a message, a plan, or a tool call with what Code Agent kept of its result. */
function entryText(it: Item): string {
  if (it.kind === 'user') return `[${who(it)}] ${it.text}`;
  if (it.kind === 'text') return `[claude] ${it.text}`;
  if (it.kind === 'plan') return `[plan v${it.version}, ${it.status}] ${it.plan.title}\n\n${it.plan.markdown ?? [it.plan.summary, ...it.plan.steps.map((s, i) => `${i + 1}. ${s}`)].join('\n')}`;
  if (it.kind === 'tool') return toolText(it);
  if (it.kind === 'toolgroup') return [`[tools] ${it.label}`, ...it.tools.map(toolText)].join('\n\n');
  if (it.kind === 'footer') return `--- turn ${it.turn} ended (${it.stopReason}): ${it.toolCalls} tool calls, ${it.seconds}s ---`;
  return `[${it.kind}]${'text' in it ? ` ${it.text}` : ''}`;
}

/** The top-level entry an id names: itself, or the tool group holding the tool call. */
function topEntry(sid: string, id: string): string | undefined {
  return rt(sid)?.items.find((it) => it.id === id || (it.kind === 'toolgroup' && it.tools.some((t) => t.id === id)))?.id;
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
    instructions: 'Tools for the Claude Code sessions in this workspace (run by Code Agent) and their history, and for the workspace board.',
    alwaysLoad: true,
    tools: [
      tool('list_sessions', 'List the other sessions in this workspace: id, title, state, who created it, last activity and the start of its last reply.', {}, async () => {
        const list = others(sid);
        const rows: NestedRow[] = list.slice(0, 12).map((s) => ({ icon: 'chat', text: s.title, right: stateLabel(s) }));
        patchPeer(sid, own('list_sessions'), { rows });
        if (!list.length) return text('There are no other sessions in this workspace.');
        return text(list.map((s) => `- ${s.id} "${s.title}" · ${stateLabel(s)}${s.createdBy ? ` · created by "${s.createdBy.title}"` : ''} · last active ${new Date(s.lastActive).toISOString()}${lastReply(s.id) ? ` · last reply: ${short(lastReply(s.id).replace(/\s+/g, ' '), 120)}` : ''}`).join('\n'));
      }, { annotations: { readOnlyHint: true } }),
      tool('read_session', 'Read a session\'s conversation (this one too), condensed: user and assistant text and one line per tool call, without tool output. Pages from the end by default; `around` shows the entries around a search_history hit. An entry with more to read (tool output, long text, a plan) ends with its entry id: read it with read_entry.', {
        session_id: z.string(), from: z.number().int().min(0).optional().describe('Index of the first entry to show; default: the last `limit` entries'),
        around: z.string().optional().describe('An entry id (from search_history): show the entries around it'),
        limit: z.number().int().min(1).max(200).optional(),
      }, async (a) => {
        const s = target(sid, a.session_id);
        await loaded(s.id);
        const lines = condensed(s.id);
        const limit = a.limit ?? 30;
        let start = a.from ?? Math.max(0, lines.length - limit);
        if (a.around) {
          const top = topEntry(s.id, a.around);
          const at = lines.findIndex((l) => l.id === top);
          if (at < 0) return { ...text(`No entry ${a.around} in session "${s.title}".`), isError: true };
          start = Math.max(0, at - Math.floor(limit / 2));
        }
        const page = lines.slice(start, start + limit);
        patchPeer(sid, own('read_session', (i) => i.session_id === a.session_id), {
          rows: page.slice(-5).map((l) => ({ icon: lineIcon(l.text), text: short(l.text, 90) })),
        });
        const shown = page.length ? `entries ${start}–${start + page.length - 1}` : 'nothing';
        return text(`Session "${s.title}" (${stateLabel(s)}), ${lines.length} entries; showing ${shown}:\n${page.map((l, i) => `${start + i}. ${short(l.text, LINE)}${l.more ? ` (entry ${l.id})` : ''}`).join('\n')}`);
      }, { annotations: { readOnlyHint: true } }),
      tool('search_history', 'Search the conversations of this workspace\'s sessions, this one included: what the user and Claude wrote, plans, and tool calls by name and main argument (tool output is not searched). The most recently active sessions first, their latest entries first. Read around a hit with read_session(around), or the entry in full with read_entry.', {
        query: z.string().describe('Text to find, in any case'), session_id: z.string().optional().describe('Only this session'),
        limit: z.number().int().min(1).max(50).optional(),
      }, async (a) => {
        const scope = a.session_id ? [target(sid, a.session_id)] : [summary(sid), ...others(sid)].filter((s): s is SessionSummary => !!s);
        const hits = searchTranscripts(a.query, a.limit ?? 20, scope.map((s) => s.id));
        const flat = (s: string) => s.replace(/\s+/g, ' ');
        patchPeer(sid, own('search_history', (i) => i.query === a.query), {
          rows: hits.slice(0, 5).map((h) => ({ icon: 'chat', text: short(flat(h.snippet), 90), right: summary(h.session)?.title })),
        });
        if (!hits.length) return text(`Nothing in the conversations of this workspace matches "${a.query}".`);
        const groups = new Map<string, typeof hits>();
        for (const h of hits) groups.set(h.session, [...(groups.get(h.session) ?? []), h]);
        return text([...groups].map(([id, hs]) => `Session "${summary(id)?.title}"${id === sid ? ' (this session)' : ''} ${id}:\n${hs.map((h) => `- entry ${h.item}: ${flat(h.snippet)}`).join('\n')}`).join('\n\n'));
      }, { annotations: { readOnlyHint: true } }),
      tool('read_entry', 'Read one entry of a session\'s conversation in full: a message, a plan, or a tool call with the output Code Agent kept (long output is shortened; file contents are not kept). Entry ids come from search_history and read_session.', {
        session_id: z.string(), entry_id: z.string(),
        from_char: z.number().int().min(0).optional().describe('Go on reading a long entry from this character'),
      }, async (a) => {
        const s = target(sid, a.session_id);
        await loaded(s.id);
        const it = findItem(s.id, a.entry_id);
        if (!it) return { ...text(`No entry ${a.entry_id} in session "${s.title}".`), isError: true };
        const full = entryText(it);
        const from = a.from_char ?? 0;
        const part = full.slice(from, from + ENTRY);
        const rest = full.length - from - part.length;
        patchPeer(sid, own('read_entry', (i) => i.entry_id === a.entry_id), { rows: [{ icon: lineIcon(full), text: short(full.split('\n')[0], 90) }] });
        return text(`${part}${rest > 0 ? `\n… ${rest} more characters: read_entry with from_char ${from + part.length}` : ''}`);
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
      tool('create_session', 'Create a new session in this workspace for a substantial piece of work the user may want to follow or join. Its first message is yours. Use worktree: true when it will edit files in parallel with other sessions. Built-in subagents are better for short side tasks. Leave effort unset unless the user asked for one: the new session then thinks as hard as this one.', {
        title: z.string().describe('Short title shown in the session list'), message: z.string().describe('The complete task for the new session'),
        model: z.string().optional(), effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional().describe('Only when the user asked for an effort'),
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

const OPS: Record<string, PeerCall['op']> = {
  list_sessions: 'list', read_session: 'read', session_status: 'status', send_to_session: 'send', create_session: 'create', search_history: 'search', read_entry: 'entry',
};

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
  if (op === 'search') item.detail = String(input.query ?? '');
  item.provenance = undefined;
});

register({
  releaseHeld,
  rejectHeld,
});

export { createSession };
