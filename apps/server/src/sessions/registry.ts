/**
 * Every session Code Agent knows: summaries (sessions.json, pushed to the UI) and runtimes (the
 * transcript and side panels, sessions/<id>.json, loaded when a session is opened). Session events
 * change the runtime here exactly as they change it in the UI.
 */
import path from 'node:path';
import type { Item, SessionEvent, SessionRuntime, SessionSummary } from '@code-agent/shared/types';
import { emptyRuntime, reduce } from '@code-agent/shared/runtime';
import { broadcast } from '../hub';
import { load, remove as removeFile, save } from '../store';
import { SESSIONS_DIR } from '../paths';

const summaries = new Map<string, SessionSummary>(
  load<SessionSummary[]>('sessions.json', []).map((s) => [s.id, { ...s, live: false, state: 'idle', waiting: false }]),
);
const runtimes = new Map<string, SessionRuntime>();
let rawSeq = 0;

function saveIndex() {
  save('sessions.json', () => [...summaries.values()].filter((s) => !s.draft));
}

export function summary(id: string): SessionSummary | undefined {
  return summaries.get(id);
}

export function allSummaries(): SessionSummary[] {
  return [...summaries.values()];
}

export function upsert(s: SessionSummary) {
  summaries.set(s.id, s);
  saveIndex();
  broadcast({ t: 'session.upsert', s });
}

export function patchSummary(id: string, p: Partial<SessionSummary>) {
  const s = summaries.get(id);
  if (!s) return;
  const next = { ...s, ...p };
  if (Object.entries(p).every(([k, v]) => (s as unknown as Record<string, unknown>)[k] === v)) return;
  summaries.set(id, next);
  saveIndex();
  broadcast({ t: 'session.upsert', s: next });
}

export function dropSession(id: string) {
  summaries.delete(id);
  runtimes.delete(id);
  saveIndex();
  removeFile(path.join(SESSIONS_DIR, `${id}.json`));
  broadcast({ t: 'session.remove', id });
}

/** What is saved of a runtime: no raw events, stderr or transient status. */
function savedRuntime(r: SessionRuntime): Partial<SessionRuntime> {
  return {
    id: r.id, items: r.items, model: r.model, effort: r.effort, mode: r.mode, tasks: r.tasks, background: r.background,
    changes: r.changes, context: r.context, turn: r.turn, tokens: r.tokens, queue: r.queue,
  };
}

function persist(id: string) {
  save(path.join(SESSIONS_DIR, `${id}.json`), () => {
    const r = runtimes.get(id);
    return r ? savedRuntime(r) : {};
  }, 800);
}

/** The runtime, loaded from disk if needed; undefined when the session has none yet. */
export function rt(id: string): SessionRuntime | undefined {
  let r = runtimes.get(id);
  if (r) return r;
  const savedRt = load<Partial<SessionRuntime> | null>(path.join(SESSIONS_DIR, `${id}.json`), null);
  if (!savedRt) return undefined;
  const sum = summaries.get(id);
  // A turn cut off by a restart is no longer running.
  const items = (savedRt.items ?? []).map((it) => closeOpen(it));
  r = emptyRuntime(id, { ...savedRt, items, state: 'idle', request: null, status: null, readOnly: !sum?.live });
  r.background = r.background.map((b) => (b.status === 'running' ? { ...b, status: 'stopped' as const } : b));
  runtimes.set(id, r);
  return r;
}

function closeOpen(it: Item): Item {
  if ((it.kind === 'text' || it.kind === 'thinking') && it.streaming) return { ...it, streaming: false };
  if (it.kind === 'tool' && (it.status === 'running' || it.status === 'waiting')) return { ...it, status: 'error', right: '已中断' };
  if (it.kind === 'toolgroup') return { ...it, tools: it.tools.map((t) => closeOpen(t) as typeof t) };
  return it;
}

export function initRuntime(r: SessionRuntime) {
  runtimes.set(r.id, r);
  persist(r.id);
}

/** Apply a session event here and in every connected UI. */
export function emit(id: string, ev: SessionEvent) {
  const r = runtimes.get(id) ?? rt(id);
  if (!r) return;
  if (ev.t === 'raw') rawSeq += 1;
  runtimes.set(id, reduce(r, ev, rawSeq));
  broadcast({ t: 'ev', sid: id, ev });
  if (ev.t !== 'raw' && ev.t !== 'stderr' && ev.t !== 'status') persist(id);
  if (ev.t === 'state') patchSummary(id, { state: ev.state, lastActive: Date.now() });
  if (ev.t === 'settings' && ev.patch.tokens !== undefined) patchSummary(id, { tokens: ev.patch.tokens });
}

export function addItem(id: string, item: Item, after?: string) {
  emit(id, { t: 'item.add', item, after });
}

export function patchItem(id: string, itemId: string, p: Record<string, unknown>) {
  emit(id, { t: 'item.patch', id: itemId, patch: p as Partial<Item> });
}

export function raw(id: string, type: string, summaryText: string, json: unknown) {
  emit(id, { t: 'raw', type, summary: summaryText, json });
}

export function findItem(id: string, itemId: string): Item | undefined {
  const r = runtimes.get(id);
  if (!r) return undefined;
  for (const it of r.items) {
    if (it.id === itemId) return it;
    if (it.kind === 'toolgroup') {
      const t = it.tools.find((x) => x.id === itemId);
      if (t) return t;
    }
  }
  return undefined;
}
