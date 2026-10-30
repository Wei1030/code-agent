/**
 * Sessions started outside Code Agent (the claude CLI, other tools) in a workspace folder: listed
 * as saved sessions, their transcript rebuilt from Claude Code's session file when opened. A saved
 * session continued outside Code Agent (`claude --resume`) gets the new turns added when it is
 * opened or resumed here.
 */
import { randomUUID } from 'node:crypto';
import { getSessionInfo, getSessionMessages, listSessions, type SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Item, SessionRuntime, ToolItem } from '@code-agent/shared/types';
import { emptyRuntime } from '@code-agent/shared/runtime';
import { app } from '../state';
import { addItem, emit, initRuntime, patchSummary, rt, summary, upsert } from './registry';
import { cwdOf } from './options';
import { toolDetail, toolName, toolResult } from './describe';
import { CONTEXT_MARK, live, onProcessEnd } from './live';

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Add the workspace folders' Claude Code sessions we do not know yet. Known ones continued
 * outside Code Agent since move up the list and take a title given there.
 */
export async function scanExternal() {
  for (const ws of app.workspaces) {
    let list;
    try {
      list = await listSessions({ dir: ws.path, limit: 200 });
    } catch {
      continue;
    }
    for (const s of list) {
      const known = summary(s.sessionId);
      if (known) {
        if (known.live || known.draft || s.lastModified <= (known.transcriptAt ?? known.lastActive)) continue;
        const title = s.customTitle ? short(s.customTitle, 40) : known.title;
        patchSummary(s.sessionId, { lastActive: Math.max(known.lastActive, s.lastModified), ...(title !== known.title ? { title } : {}) });
        continue;
      }
      upsert({
        id: s.sessionId, workspaceId: ws.id, title: short(s.customTitle ?? s.summary ?? s.firstPrompt ?? '会话', 40), firstPrompt: s.firstPrompt ?? '',
        branch: s.gitBranch ?? null, createdAt: s.createdAt ?? s.lastModified, lastActive: s.lastModified, tag: s.tag ?? '外部', live: false,
        state: 'idle', forkedFrom: null, tokens: 0,
      });
    }
  }
}

type Block = { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean };

const contentOf = (m: SessionMessage) => (m.message as { content?: unknown } | undefined)?.content;

/** What the user wrote, for a message that is a prompt: not a tool result, a command's output or a reminder. */
function promptText(m: SessionMessage): string | undefined {
  if (m.type !== 'user' || m.parent_tool_use_id) return undefined;
  const content = contentOf(m);
  const texts = typeof content === 'string' ? [content] : Array.isArray(content) ? (content as Block[]).filter((b) => b.type === 'text' && b.text).map((b) => b.text!) : [];
  const text = texts.filter((x) => !x.startsWith('<')).join('\n\n');
  return text.trim() ? text : undefined;
}

/**
 * The message a compacted conversation starts over with: Claude Code's summary of what came
 * before, always opening with these words. (The compaction's own system message comes back
 * without its kind.)
 */
const SUMMARY_START = 'This session is being continued from a previous conversation';
const isSummary = (m: SessionMessage) => !!promptText(m)?.startsWith(SUMMARY_START);

/** An item read from a transcript has the id of what it shows there, so reading it again finds it. */
const blockId = (m: SessionMessage, i: number) => `${m.uuid}:${i}`;

/** The ids a transcript message has among the items: a prompt's, its blocks', its tool calls'. */
function idsOf(m: SessionMessage): string[] {
  const content = contentOf(m);
  const blocks = (Array.isArray(content) ? content : []) as Block[];
  return [m.uuid, ...blocks.map((b, i) => (b.type === 'tool_use' && b.id ? b.id : blockId(m, i)))];
}

/** Every item id, the calls in a tool group too. */
function itemIds(items: Item[]): Set<string> {
  const ids = new Set<string>();
  for (const it of items) {
    ids.add(it.id);
    if (it.kind === 'toolgroup') for (const t of it.tools) ids.add(t.id);
  }
  return ids;
}

/** Items for a stretch of transcript; tool results fill in the calls they answer. A compaction becomes a divider. */
function toItems(msgs: SessionMessage[], cwd: string): Item[] {
  const items: Item[] = [];
  const tools = new Map<string, { item: ToolItem; name: string; input: Record<string, unknown> }>();
  for (const m of msgs) {
    if (m.parent_tool_use_id) continue;
    if (isSummary(m)) {
      items.push({ kind: 'divider', id: randomUUID(), label: '对话已压缩' });
      continue;
    }
    if (m.type === 'user') {
      const text = promptText(m);
      // Context Code Agent added without showing it.
      if (text !== undefined && !text.startsWith(CONTEXT_MARK)) items.push({ kind: 'user', id: m.uuid, text, attachments: [], ts: 0 });
      const content = contentOf(m);
      for (const b of (Array.isArray(content) ? content : []) as Block[]) {
        if (b.type !== 'tool_result' || !b.tool_use_id) continue;
        const t = tools.get(b.tool_use_id);
        if (!t) continue;
        const r = toolResult(t.name, t.input, b.content, undefined, !!b.is_error, cwd);
        Object.assign(t.item, { status: b.is_error ? 'error' : 'ok', ...(r.output ? { output: r.output } : {}), ...(r.right ? { right: r.right } : {}), ...(r.images ? { images: r.images } : {}) });
      }
    } else if (m.type === 'assistant') {
      const content = contentOf(m);
      ((Array.isArray(content) ? content : []) as Block[]).forEach((b, i) => {
        if (b.type === 'text' && b.text?.trim()) items.push({ kind: 'text', id: blockId(m, i), text: b.text });
        else if (b.type === 'thinking' && b.thinking?.trim()) items.push({ kind: 'thinking', id: blockId(m, i), text: b.thinking, seconds: 0 });
        else if (b.type === 'tool_use' && b.id && b.name) {
          const item: ToolItem = { kind: 'tool', id: b.id, tool: toolName(b.name), detail: toolDetail(b.name, b.input ?? {}, cwd), status: 'ok' };
          tools.set(b.id, { item, name: b.name, input: b.input ?? {} });
          items.push(item);
        }
      });
    }
  }
  return items;
}

/** Rebuild a transcript from Claude Code's session file. */
export async function importTranscript(sid: string): Promise<SessionRuntime | undefined> {
  const sum = summary(sid);
  if (!sum) return undefined;
  const cwd = cwdOf(sid);
  let msgs;
  let info;
  try {
    [msgs, info] = await Promise.all([getSessionMessages(sid, { dir: cwd }), getSessionInfo(sid, { dir: cwd })]);
  } catch {
    return undefined;
  }
  const items = toItems(msgs, cwd);
  const prof = app.profiles[0];
  const r = emptyRuntime(sid, { items, model: prof.model, effort: prof.effort, mode: prof.mode, readOnly: true, turn: items.filter((x) => x.kind === 'user').length });
  initRuntime(r);
  if (info) patchSummary(sid, { transcriptAt: info.lastModified });
  return r;
}

/**
 * What of a transcript Code Agent has not shown yet. Items keep the ids of what they show in the
 * transcript (prompts Code Agent sent, tool calls, and everything read from a transcript before),
 * so the last of them still in the conversation Claude Code has (the chain from its latest
 * message; after a compaction only what follows it) is where the two are in step: the rest of
 * that turn is shown already, and what follows from the next prompt is new. A label says where
 * it comes from, and names the prompt the conversation went back to when items after the anchor
 * left it there. With none of them left, the conversation was compacted there: what follows the
 * summary from the next prompt on is new, and what was said before it only lives on in that summary
 * (Claude Code keeps the last few messages from before a compaction after the summary).
 */
export function unseen(items: Item[], msgs: SessionMessage[]): { label: string; msgs: SessionMessage[] } | undefined {
  const known = itemIds(items);
  const isNew = (m: SessionMessage) => !known.has(m.uuid) && !promptText(m)?.startsWith(CONTEXT_MARK);
  let anchor = -1;
  for (let i = msgs.length - 1; i >= 0 && anchor < 0; i--) if (idsOf(msgs[i]).some((id) => known.has(id))) anchor = i;
  if (anchor >= 0) {
    const from = msgs.findIndex((m, i) => i > anchor && promptText(m) !== undefined && isNew(m));
    if (from < 0) return undefined;
    const ids = new Set(idsOf(msgs[anchor]));
    const at = items.findIndex((x) => ids.has(x.id) || (x.kind === 'toolgroup' && x.tools.some((t) => ids.has(t.id))));
    // Prompts after the anchor that are not in the conversation any more; commands (/compact and
    // the like) are not kept as messages of their own.
    const onChain = new Set(msgs.map((m) => m.uuid));
    const rewound = items.slice(at + 1).some((x) => x.kind === 'user' && !x.text.startsWith('/') && !onChain.has(x.id));
    const prompt = items.slice(0, at + 1).reverse().find((x) => x.kind === 'user');
    const label = rewound && prompt?.kind === 'user' ? `在 Claude Code 里回退到「${short(prompt.text.replace(/\s+/g, ' '), 30)}」之后继续` : '以下是在 Claude Code 里继续的内容';
    return { label, msgs: msgs.slice(from) };
  }
  let summaryAt = -1;
  for (let i = msgs.length - 1; i >= 0 && summaryAt < 0; i--) if (isSummary(msgs[i])) summaryAt = i;
  const from = summaryAt < 0 ? -1 : msgs.findIndex((m, i) => i > summaryAt && promptText(m) !== undefined && isNew(m));
  if (from < 0) return undefined;
  return { label: '以下是在 Claude Code 里继续的内容；对话在那里压缩过，压缩前的部分只剩摘要', msgs: msgs.slice(from) };
}

const syncing = new Map<string, Promise<void>>();

/** Add what was said in a saved session outside Code Agent since Code Agent last had its transcript. */
export function syncTranscript(sid: string): Promise<void> {
  let p = syncing.get(sid);
  if (!p) {
    p = sync(sid).catch(() => undefined).finally(() => syncing.delete(sid));
    syncing.set(sid, p);
  }
  return p;
}

async function sync(sid: string) {
  const sum = summary(sid);
  const r = rt(sid);
  if (!sum || !r || sum.draft || live(sid)) return;
  const cwd = cwdOf(sid);
  const info = await getSessionInfo(sid, { dir: cwd });
  if (!info || info.lastModified <= (sum.transcriptAt ?? 0)) return;
  const part = unseen(r.items, await getSessionMessages(sid, { dir: cwd }));
  if (part) {
    const have = itemIds(r.items);
    const items = toItems(part.msgs, cwd).filter((x) => !have.has(x.id));
    if (items.length) {
      addItem(sid, { kind: 'divider', id: randomUUID(), label: part.label });
      for (const it of items) addItem(sid, it);
      emit(sid, { t: 'settings', patch: { turn: r.turn + items.filter((x) => x.kind === 'user').length } });
    }
  }
  const title = info.customTitle ? short(info.customTitle, 40) : sum.title;
  patchSummary(sid, { transcriptAt: info.lastModified, lastActive: Math.max(sum.lastActive, info.lastModified), ...(title !== sum.title ? { title } : {}) });
}

/** Code Agent's own process wrote the transcript last: what it has is what Code Agent shows. */
onProcessEnd((sid) => {
  if (summary(sid)?.draft) return;
  void getSessionInfo(sid, { dir: cwdOf(sid) }).then((info) => info && patchSummary(sid, { transcriptAt: info.lastModified }), () => undefined);
});
