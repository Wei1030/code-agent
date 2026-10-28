/**
 * Sessions started outside Code Agent (the claude CLI, other tools) in a workspace folder: listed
 * as saved sessions, their transcript rebuilt from Claude Code's session file when opened.
 */
import { randomUUID } from 'node:crypto';
import { getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { Item, SessionRuntime, ToolItem } from '@code-agent/shared/types';
import { emptyRuntime } from '@code-agent/shared/runtime';
import { app } from '../state';
import { allSummaries, initRuntime, summary, upsert } from './registry';
import { cwdOf } from './options';
import { toolDetail, toolName, toolResult } from './describe';

/** Add the workspace folders' Claude Code sessions we do not know yet. */
export async function scanExternal() {
  const known = new Set(allSummaries().map((s) => s.id));
  for (const ws of app.workspaces) {
    let list;
    try {
      list = await listSessions({ dir: ws.path, limit: 200 });
    } catch {
      continue;
    }
    for (const s of list) {
      if (known.has(s.sessionId)) continue;
      const title = s.customTitle ?? s.summary ?? s.firstPrompt ?? '会话';
      upsert({
        id: s.sessionId, workspaceId: ws.id, title: title.length > 40 ? `${title.slice(0, 40)}…` : title, firstPrompt: s.firstPrompt ?? '',
        branch: s.gitBranch ?? null, createdAt: s.createdAt ?? s.lastModified, lastActive: s.lastModified, tag: s.tag ?? '外部', live: false,
        state: 'idle', forkedFrom: null, tokens: 0,
      });
    }
  }
}

type Block = { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean };

/** Rebuild a transcript from Claude Code's session file. */
export async function importTranscript(sid: string): Promise<SessionRuntime | undefined> {
  const sum = summary(sid);
  if (!sum) return undefined;
  const cwd = cwdOf(sid);
  let msgs;
  try {
    msgs = await getSessionMessages(sid, { dir: cwd });
  } catch {
    return undefined;
  }
  const items: Item[] = [];
  const tools = new Map<string, { item: ToolItem; name: string; input: Record<string, unknown> }>();
  for (const m of msgs) {
    if (m.parent_tool_use_id) continue;
    const msg = m.message as { content?: unknown } | undefined;
    const content = msg?.content;
    if (m.type === 'user') {
      if (typeof content === 'string') {
        if (!content.startsWith('<')) items.push({ kind: 'user', id: m.uuid, text: content, attachments: [], ts: 0 });
        continue;
      }
      for (const b of (Array.isArray(content) ? content : []) as Block[]) {
        if (b.type === 'text' && b.text && !b.text.startsWith('<')) items.push({ kind: 'user', id: m.uuid, text: b.text, attachments: [], ts: 0 });
        if (b.type === 'tool_result' && b.tool_use_id) {
          const t = tools.get(b.tool_use_id);
          if (!t) continue;
          const r = toolResult(t.name, t.input, b.content, undefined, !!b.is_error, cwd);
          Object.assign(t.item, { status: b.is_error ? 'error' : 'ok', ...(r.output ? { output: r.output } : {}), ...(r.right ? { right: r.right } : {}) });
        }
      }
    } else if (m.type === 'assistant') {
      for (const b of (Array.isArray(content) ? content : []) as Block[]) {
        if (b.type === 'text' && b.text?.trim()) items.push({ kind: 'text', id: randomUUID(), text: b.text });
        else if (b.type === 'thinking' && b.thinking?.trim()) items.push({ kind: 'thinking', id: randomUUID(), text: b.thinking, seconds: 0 });
        else if (b.type === 'tool_use' && b.id && b.name) {
          const item: ToolItem = { kind: 'tool', id: b.id, tool: toolName(b.name), detail: toolDetail(b.name, b.input ?? {}, cwd), status: 'ok' };
          tools.set(b.id, { item, name: b.name, input: b.input ?? {} });
          items.push(item);
        }
      }
    }
  }
  const prof = app.profiles[0];
  const r = emptyRuntime(sid, { items, model: prof.model, effort: prof.effort, mode: prof.mode, readOnly: true, turn: items.filter((x) => x.kind === 'user').length });
  initRuntime(r);
  return r;
}
