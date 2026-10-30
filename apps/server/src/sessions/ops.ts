/** Session operations the UI calls: create, send, queue, answer, switch settings, save, resume, fork, rewind… */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { deleteSession, forkSession, getSessionMessages, renameSession, tagSession } from '@anthropic-ai/claude-agent-sdk';
import type { CommandInfo, QueuedMessage, SessionRef, SessionSummary } from '@code-agent/shared/types';
import type { DryRun, SendOptions } from '@code-agent/shared/api';
import { emptyRuntime } from '@code-agent/shared/runtime';
import { register } from '../hub';
import { app } from '../state';
import { addItem, allSummaries, dropSession, emit, initRuntime, patchItem, patchSummary, rt, searchTranscripts, summary, upsert } from './registry';
import { addContext, answerRequest, closeProcess, inTurn, interruptTurn, live, onTurnEnd, refreshContext, sendTurn, startProcess, steer, type Outgoing } from './live';
import { acquire, cancelWaiting, isWaiting, pump } from './slots';
import { cwdOf } from './options';
import { lastPage, pageBefore } from './page';
import { oneProcess, resolveModel, validModel } from '../models';

/** Full messages behind the queue entries the UI shows. */
const queued = new Map<string, Outgoing>();

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 24 ? `${t.slice(0, 24)}…` : t || '新会话';
}

export function enqueue(sid: string, m: Outgoing, priority: QueuedMessage['priority'] = 'next', id = randomUUID()) {
  const r = rt(sid)!;
  queued.set(id, m);
  const entry: QueuedMessage = { id, text: m.shown ?? m.text, priority, ...(m.from ? { from: m.from } : {}) };
  // "next" goes before every "later".
  const queue = priority === 'next' ? [...r.queue.filter((q) => q.priority !== 'later'), entry, ...r.queue.filter((q) => q.priority === 'later')] : [...r.queue, entry];
  emit(sid, { t: 'queue', queue });
  return id;
}

/** Things that keep queued messages waiting although no turn runs (a review running its checks…). */
const blockers: Array<(sid: string) => boolean> = [];
export function addQueueBlocker(fn: (sid: string) => boolean) {
  blockers.push(fn);
}

/** Send the next queued message when the session is free. */
export function pumpQueue(sid: string): boolean {
  const r = rt(sid);
  const l = live(sid);
  if (!r || !l || l.turn || r.request || !r.queue.length || blockers.some((f) => f(sid))) return false;
  const [first, ...rest] = r.queue;
  emit(sid, { t: 'queue', queue: rest });
  const m = queued.get(first.id) ?? { text: first.text };
  queued.delete(first.id);
  sendTurn(sid, m);
  return true;
}

onTurnEnd((sid) => {
  // Give other turn-end handlers (reviews, receipts) a moment to queue their messages first.
  setTimeout(() => pumpQueue(sid), 0);
});

// i18n-ignore: the prompt Claude reads.
function refsBlock(refs: SessionRef[]): string {
  const lines = refs.map((r) => {
    const s = summary(r.sessionId);
    const state = !s ? '未知' : s.waiting ? '排队中' : !s.live ? '已保存' : s.state === 'running' ? '正在工作' : s.state === 'requires_action' ? '等待用户处理' : '空闲';
    const last = rt(r.sessionId)?.items.slice().reverse().find((x) => x.kind === 'text');
    return `- "${r.title}" (session id ${r.sessionId}), ${state}${last && last.kind === 'text' ? `; last reply: ${last.text.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`;
  });
  return `\n\n<referenced-sessions>\nThe user referred to these sessions of this workspace:\n${lines.join('\n')}\nUse read_session / session_status / send_to_session from the workspace tools for more.\n</referenced-sessions>`;
}

async function usageNotice(sid: string) {
  const l = live(sid);
  try {
    const u = await l!.q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    const { recordLimits } = await import('../usage');
    recordLimits(u);
    const f = app.usage.fiveHour;
    const w = app.usage.weekly;
    addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'info', text: f || w ? `5 小时窗口已用 ${f?.utilization ?? '—'}% · 本周已用 ${w?.utilization ?? '—'}%。` : '当前登录方式没有套餐限额。', action: '打开用量' });
  } catch (e) {
    addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'warn', text: `读取用量失败：${e instanceof Error ? e.message : String(e)}` });
  }
}

export async function send(sid: string, text: string, opts: SendOptions = {}) {
  const sum = summary(sid);
  const r = rt(sid);
  if (!sum || !r) throw new Error('会话不存在');
  const refs = opts.refs?.length ? opts.refs : undefined;
  const m: Outgoing = {
    text: refs ? text + refsBlock(refs) : text, shown: refs ? text : undefined, attachments: opts.attachments, refs, verbatim: opts.verbatim,
  };
  if (sum.draft) {
    patchSummary(sid, { draft: false, title: titleFrom(text), firstPrompt: text, createdAt: Date.now(), lastActive: Date.now() });
    enqueue(sid, m, 'next');
    await acquire(sid, () => startProcess(sid, { resume: false }), () => pumpQueue(sid));
    return;
  }
  if (sum.waiting || isWaiting(sid)) {
    enqueue(sid, m, 'later');
    return;
  }
  if (!live(sid)) throw new Error('会话已保存，先恢复会话再发送');
  patchSummary(sid, { lastActive: Date.now() });
  await import('../peer').then((p) => p.humanTurn(sid));
  if (opts.contextOnly) {
    addContext(sid, m);
    addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'info', text: '已作为上下文添加，未开始新一轮。' });
    return;
  }
  if (r.request?.kind === 'question') {
    // A free-form message answers the pending question in the user's own words.
    addItem(sid, { kind: 'user', id: randomUUID(), text, attachments: [], ts: Date.now() });
    answerRequest(sid, r.request.id, { answers: {}, response: text });
    return;
  }
  const cmd = !opts.verbatim && text.trim().startsWith('/') ? text.trim().split(/\s+/)[0] : null;
  if (cmd && !inTurn(sid) && (cmd === '/context' || cmd === '/usage')) {
    addItem(sid, { kind: 'user', id: randomUUID(), text, attachments: [], ts: Date.now() });
    if (cmd === '/context') {
      await refreshContext(sid, true);
      addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'info', text: '上下文用量已在右侧「上下文」中打开。' });
    } else await usageNotice(sid);
    return;
  }
  if (inTurn(sid)) {
    const priority = opts.priority ?? 'next';
    if (priority === 'now') steer(sid, m);
    else enqueue(sid, m, priority);
    return;
  }
  sendTurn(sid, m);
}

function commandsFor(sid: string): CommandInfo[] {
  const l = live(sid);
  const list = l?.commands.length ? l.commands : lastCommands.get(summary(sid)?.workspaceId ?? '') ?? [];
  if (l?.commands.length) lastCommands.set(summary(sid)?.workspaceId ?? '', l.commands);
  return list.map((c) => ({
    name: `/${c.name}`, hint: c.description + (c.argumentHint ? ` ${c.argumentHint}` : ''), origin: c.builtin ? '内置' : '技能 / 命令', icon: c.builtin ? 'slash' : 'spark',
  }));
}
const lastCommands = new Map<string, NonNullable<ReturnType<typeof live>>['commands']>();

async function forkAt(sid: string, beforeUserId?: string): Promise<string> {
  const sum = summary(sid);
  const r = rt(sid);
  if (!sum || !r) throw new Error('会话不存在');
  const dir = cwdOf(sid);
  const idx = beforeUserId ? r.items.findIndex((x) => x.id === beforeUserId) : r.items.length;
  const title = `${sum.title}（分叉）`;
  let newId: string;
  let resumable = true;
  if (beforeUserId) {
    const msgs = await getSessionMessages(sid, { dir });
    const at = msgs.findIndex((x) => x.uuid === beforeUserId);
    const prev = at > 0 ? msgs[at - 1] : undefined;
    if (prev) newId = (await forkSession(sid, { dir, upToMessageId: prev.uuid, title })).sessionId;
    else {
      // Forking before the first message is a new, empty conversation.
      newId = randomUUID();
      resumable = false;
    }
  } else {
    newId = (await forkSession(sid, { dir, title })).sessionId;
  }
  const s: SessionSummary = {
    ...sum, id: newId, title, live: false, state: 'idle', forkedFrom: sum.title, createdAt: Date.now(), lastActive: Date.now(), draft: !resumable,
    peerUnread: 0, waiting: false, jobId: undefined, createdBy: undefined,
  };
  upsert(s);
  initRuntime(emptyRuntime(newId, {
    items: r.items.slice(0, Math.max(0, idx)).map((it) => ({ ...it })), model: r.model, effort: r.effort, mode: r.mode, context: r.context,
    turn: r.turn, tokens: r.tokens, readOnly: false,
  }));
  if (resumable) void acquire(newId, () => startProcess(newId, { resume: true }));
  return newId;
}

// i18n-ignore: an exported file.
function exportMarkdown(sid: string): string {
  const sum = summary(sid)!;
  const out = [`# ${sum.title}`, ''];
  for (const it of rt(sid)?.items ?? []) {
    if (it.kind === 'user') out.push(`**${it.from ? `会话「${it.from.title}」` : it.fromApp ? `Code Agent · ${it.fromApp}` : '你'}：** ${it.text}`, '');
    else if (it.kind === 'text') out.push(it.text, '');
    else if (it.kind === 'tool') out.push(`> ${it.tool} \`${it.detail}\`${it.right ? ` · ${it.right}` : ''}`, '');
    else if (it.kind === 'toolgroup') out.push(`> ${it.label}`, '');
    else if (it.kind === 'plan') out.push(it.plan.markdown ?? `## ${it.plan.title}`, '');
    else if (it.kind === 'footer') out.push('---', `第 ${it.turn} 轮 · ${it.tokens} tokens`, '');
  }
  return out.join('\n');
}

register({
  createDraft: (workspaceId, id) => {
    if (summary(id)) return;
    const ws = app.workspaces.find((w) => w.id === workspaceId);
    if (!ws) throw new Error('工作区不存在');
    const prof = app.profiles.find((p) => p.isDefault) ?? app.profiles[0];
    const now = Date.now();
    upsert({ id, workspaceId, title: '新会话', firstPrompt: '', branch: ws.branch, createdAt: now, lastActive: now, tag: null, live: false, state: 'idle', forkedFrom: null, tokens: 0, draft: true });
    initRuntime(emptyRuntime(id, { model: validModel(prof.model), effort: prof.effort, mode: prof.mode }));
  },
  openSession: async (sid) => {
    const h = await import('./history');
    if (!rt(sid)) await h.importTranscript(sid);
    else await h.syncTranscript(sid);
    const r = rt(sid);
    return r ? lastPage(r) : null;
  },
  earlierItems: (sid, beforeId) => pageBefore(rt(sid)?.items ?? [], beforeId),
  send,
  updateQueued: (sid, id, p) => {
    const r = rt(sid);
    const q = r?.queue.find((x) => x.id === id);
    if (!r || !q) return;
    if (p.priority === 'now' && inTurn(sid)) {
      emit(sid, { t: 'queue', queue: r.queue.filter((x) => x.id !== id) });
      const m = queued.get(id) ?? { text: q.text };
      queued.delete(id);
      steer(sid, p.text !== undefined ? { ...m, text: p.text, shown: undefined } : m);
      return;
    }
    if (p.text !== undefined) {
      const m = queued.get(id);
      if (m) queued.set(id, { ...m, text: p.text, shown: undefined });
    }
    emit(sid, { t: 'queue', queue: r.queue.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  },
  removeQueued: (sid, id) => {
    const r = rt(sid);
    if (!r) return;
    for (const q of r.queue) if (!id || q.id === id) queued.delete(q.id);
    emit(sid, { t: 'queue', queue: id ? r.queue.filter((x) => x.id !== id) : [] });
  },
  interrupt: async (sid) => {
    await interruptTurn(sid);
    return rt(sid)?.queue ?? [];
  },
  runQueued: (sid) => void pumpQueue(sid),
  respondApproval: (sid, id, a) => void answerRequest(sid, id, a),
  respondQuestion: (sid, id, a) => void answerRequest(sid, id, a),
  respondPlan: (sid, id, a) => void answerRequest(sid, id, a),
  respondElicitation: (sid, id, a) => void answerRequest(sid, id, a),
  openElicitationUrl: (sid, id) => void answerRequest(sid, id, { action: 'accept', content: {} }),
  setModel: async (sid, model) => {
    const r = rt(sid);
    if (!r) return;
    const info = app.models.find((m) => m.id === model);
    const effort = info?.efforts.length && !info.efforts.includes(r.effort) ? info.efforts[info.efforts.length - 1] : r.effort;
    const l = live(sid);
    if (l && !oneProcess(r.model, model)) {
      // Another process environment: restart and pick the conversation up again.
      // Restarting would cut short what is still going on.
      if (inTurn(sid) || r.request || r.queue.length) throw new Error('这一轮结束后才能换到这个模型');
      if (r.background.some((b) => b.status === 'running')) throw new Error('后台任务还在运行：等它们完成，或在「后台」里停止后，才能换到这个模型');
      emit(sid, { t: 'settings', patch: { model, effort } });
      addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'info', text: `已换到 ${info?.label ?? model}（${info?.desc ?? ''}），Claude Code 重新启动后接着这段对话。` });
      await closeProcess(sid);
      await startProcess(sid, { resume: true });
      return;
    }
    emit(sid, { t: 'settings', patch: { model, effort } });
    if (l) {
      const name = resolveModel(model).name;
      await l.q.setModel(name);
      if (effort !== r.effort && resolveModel(model).effort) await l.q.applyFlagSettings({ effortLevel: effort });
      emit(sid, { t: 'raw', type: 'control_request', summary: `set_model · ${name}`, json: { subtype: 'set_model', model: name } });
    }
  },
  setEffort: async (sid, effort) => {
    emit(sid, { t: 'settings', patch: { effort } });
    const l = live(sid);
    const r = rt(sid);
    if (l && r && resolveModel(r.model).effort) {
      await l.q.applyFlagSettings({ effortLevel: effort });
      emit(sid, { t: 'raw', type: 'control_request', summary: `apply_flag_settings · effortLevel=${effort}`, json: { effortLevel: effort } });
    }
  },
  setMode: async (sid, mode) => {
    emit(sid, { t: 'settings', patch: { mode } });
    const l = live(sid);
    if (l) {
      await l.q.setPermissionMode(mode);
      emit(sid, { t: 'raw', type: 'control_request', summary: `set_permission_mode · ${mode}`, json: { mode } });
    }
  },
  stop: async (sid) => {
    cancelWaiting(sid);
    await closeProcess(sid);
  },
  resume: async (sid, model) => {
    if (live(sid)) return true;
    if (!rt(sid)) await import('./history').then((h) => h.importTranscript(sid));
    if (model && app.models.some((m) => m.id === model) && model !== rt(sid)?.model) emit(sid, { t: 'settings', patch: { model } });
    return acquire(sid, () => startProcess(sid, { resume: true }));
  },
  backgroundTool: async (sid, toolId) => {
    await live(sid)?.q.backgroundTasks(toolId);
  },
  backgroundAll: async (sid) => {
    await live(sid)?.q.backgroundTasks();
  },
  stopTask: async (sid, taskId) => {
    const r = rt(sid);
    await live(sid)?.q.stopTask(taskId);
    addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'warn', text: `已停止后台任务：${r?.background.find((b) => b.id === taskId)?.name ?? ''}` });
  },
  taskOutput: async (sid, taskId) => {
    const b = rt(sid)?.background.find((x) => x.id === taskId);
    if (!b?.outputFile) return b?.status === 'running' ? '任务还在运行，结束后可以查看输出。' : '这个任务没有输出文件。';
    try {
      const text = await readFile(b.outputFile, 'utf8');
      const lines = text.split(/\r?\n/);
      return lines.length > 400 ? [`…（前 ${lines.length - 400} 行省略）`, ...lines.slice(-400)].join('\n') : text;
    } catch (e) {
      return `读不到输出文件 ${b.outputFile}：${e instanceof Error ? e.message : String(e)}`;
    }
  },
  dryRun: async (sid, userId): Promise<DryRun> => {
    const l = live(sid);
    const r = rt(sid)!;
    if (!l) return { canRewind: false, error: '会话没有在运行，先恢复会话。', files: [], insertions: 0, deletions: 0, skippedLinks: 0 };
    const res = await l.q.rewindFiles(userId, { dryRun: true });
    const idx = r.items.findIndex((x) => x.id === userId);
    const after = r.changes.filter((c) => r.items.findIndex((x) => x.id === c.afterUserId) >= idx);
    const files = (res.filesChanged ?? after.map((c) => c.path)).map((p) => {
      const c = after.find((x) => p.replace(/\\/g, '/').endsWith(x.path));
      return { path: c?.path ?? p, what: c?.kind === 'created' ? 'deleted' as const : 'restored' as const, add: c ? (c.kind === 'created' ? 0 : c.del) : 0, del: c?.add ?? 0 };
    });
    return { canRewind: res.canRewind, error: res.error, files, insertions: res.insertions ?? 0, deletions: res.deletions ?? 0, skippedLinks: res.skippedLinks ?? 0 };
  },
  rewind: async (sid, userId, fork) => {
    const l = live(sid);
    const r = rt(sid)!;
    if (!l) throw new Error('会话没有在运行，先恢复会话。');
    const res = await l.q.rewindFiles(userId);
    if (!res.canRewind) throw new Error(res.error ?? '无法回退');
    const idx = r.items.findIndex((x) => x.id === userId);
    emit(sid, { t: 'changes', changes: r.changes.filter((c) => r.items.findIndex((x) => x.id === c.afterUserId) < idx) });
    const n = r.items.slice(0, idx + 1).filter((x) => x.kind === 'user').length;
    if (!fork) {
      addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'info', text: `文件已回退到消息 #${n} 之前。对话保持不变。` });
      return null;
    }
    return forkAt(sid, userId);
  },
  forkAt: (sid, before) => forkAt(sid, before),
  compact: (sid, instructions) => send(sid, `/compact${instructions ? ` ${instructions}` : ''}`),
  clearConversation: (sid) => send(sid, '/clear'),
  preciseCount: (sid) => refreshContext(sid, true),
  rename: async (sid, title) => {
    patchSummary(sid, { title });
    await renameSession(sid, title, { dir: cwdOf(sid) }).catch(() => undefined);
  },
  tag: async (sid, value) => {
    patchSummary(sid, { tag: value });
    await tagSession(sid, value, { dir: cwdOf(sid) }).catch(() => undefined);
  },
  remove: async (sid) => {
    cancelWaiting(sid);
    const dir = cwdOf(sid);
    const wasDraft = summary(sid)?.draft;
    await closeProcess(sid);
    dropSession(sid);
    if (!wasDraft) await deleteSession(sid, { dir }).catch(() => undefined);
    void pump();
  },
  markRead: (sid) => patchSummary(sid, { peerUnread: 0 }),
  exportMarkdown,
  searchSessions: (query) => {
    const seen = new Map<string, string>();
    for (const h of searchTranscripts(query, 100)) if (!seen.has(h.session) && summary(h.session)) seen.set(h.session, h.snippet.replace(/\s+/g, ' '));
    return [...seen].slice(0, 100).map(([sessionId, snippet]) => ({ sessionId, snippet }));
  },
  retryBanner: (sid, itemId) => patchItem(sid, itemId, { resolved: true }),
  listCommands: (sid) => commandsFor(sid),
  cancelWaiting: (sid) => cancelWaiting(sid),
  pumpSlots: () => pump(),
});

/** Sessions created before a restart are saved now. */
export function sessionsOnBoot() {
  for (const s of allSummaries()) if (s.live || s.waiting) patchSummary(s.id, { live: false, waiting: false, state: 'idle' });
}
