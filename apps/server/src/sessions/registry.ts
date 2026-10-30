/**
 * Every session Code Agent knows: summaries (pushed to the UI) and runtimes (the transcript and side
 * panels, loaded when a session is opened), both kept in the database: a transcript is one row per
 * item, and only items that changed are written. Session events change the runtime here exactly as
 * they change it in the UI.
 */
import type { Item, SessionEvent, SessionRuntime, SessionSummary } from '@code-agent/shared/types';
import { emptyRuntime, reduce } from '@code-agent/shared/runtime';
import { broadcast } from '../hub';
import { db, later, tx } from '../store';

const summaries = new Map<string, SessionSummary>(
  (db.prepare('SELECT summary FROM sessions').all() as Array<{ summary: string }>)
    .map((r) => JSON.parse(r.summary) as SessionSummary)
    .map((s) => [s.id, { ...s, live: false, state: 'idle', waiting: false, requests: undefined }]),
);
const runtimes = new Map<string, SessionRuntime>();
let rawSeq = 0;

const putSummary = db.prepare('INSERT INTO sessions (id, summary, last_active) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET summary = excluded.summary, last_active = excluded.last_active');
const delSession = db.prepare('DELETE FROM sessions WHERE id = ?');
const putMeta = db.prepare('INSERT INTO runtimes (id, meta) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET meta = excluded.meta');
const putRow = db.prepare('INSERT INTO items (session, seq, id, data) VALUES (?, ?, ?, ?) ON CONFLICT(session, seq) DO UPDATE SET id = excluded.id, data = excluded.data');
const delRows = db.prepare('DELETE FROM items WHERE session = ?');
const putText = db.prepare('INSERT INTO item_text (session, item, text) VALUES (?, ?, ?)');
const delText = db.prepare('DELETE FROM item_text WHERE session = ? AND item = ?');
const delAllText = db.prepare('DELETE FROM item_text WHERE session = ?');
const hasSession = db.prepare('SELECT 1 FROM sessions WHERE id = ?');

function saveSummary(id: string) {
  later(`sum:${id}`, () => {
    const s = summaries.get(id);
    // Unsent sessions are not kept.
    if (!s || s.draft) return;
    putSummary.run(id, JSON.stringify(s), s.lastActive);
  }, 300);
}

export function summary(id: string): SessionSummary | undefined {
  return summaries.get(id);
}

export function allSummaries(): SessionSummary[] {
  return [...summaries.values()];
}

export function upsert(s: SessionSummary) {
  summaries.set(s.id, s);
  saveSummary(s.id);
  broadcast({ t: 'session.upsert', s });
}

export function patchSummary(id: string, p: Partial<SessionSummary>) {
  const s = summaries.get(id);
  if (!s) return;
  const next = { ...s, ...p };
  if (Object.entries(p).every(([k, v]) => (s as unknown as Record<string, unknown>)[k] === v)) return;
  summaries.set(id, next);
  saveSummary(id);
  broadcast({ t: 'session.upsert', s: next });
}

export function dropSession(id: string) {
  summaries.delete(id);
  runtimes.delete(id);
  saved.delete(id);
  tx(() => {
    delAllText.run(id);
    delSession.run(id);
  });
  broadcast({ t: 'session.remove', id });
}

// ------------------------------------------------------------------ transcripts

/** Items as last written per session (by identity: an item the reducer did not touch keeps its object). */
const saved = new Map<string, Item[]>();
/** Sessions whose items were inserted, removed or replaced: rewrite them all. */
const reshaped = new Set<string>();

/** Text worth finding again: what the user and Claude wrote, plans, tool calls. */
function searchable(it: Item): string {
  if (it.kind === 'user' || it.kind === 'text') return it.text;
  if (it.kind === 'plan') return it.plan.markdown ?? `${it.plan.title}\n${it.plan.summary}`;
  if (it.kind === 'tool') return `${it.tool} ${it.detail}`;
  return '';
}

function writeItem(id: string, seq: number, it: Item) {
  putRow.run(id, seq, it.id, JSON.stringify(it));
  delText.run(id, it.id);
  const text = searchable(it);
  if (text.trim()) putText.run(id, it.id, text);
}

function writeRuntime(id: string) {
  const r = runtimes.get(id);
  const sum = summaries.get(id);
  if (!r || !sum || sum.draft) return;
  tx(() => {
    if (!hasSession.get(id)) putSummary.run(id, JSON.stringify(sum), sum.lastActive);
    // No raw events, stderr or transient state: those belong to the running process.
    const meta = { model: r.model, effort: r.effort, mode: r.mode, tasks: r.tasks, background: r.background, changes: r.changes, context: r.context, turn: r.turn, tokens: r.tokens, queue: r.queue };
    const { items } = r;
    putMeta.run(id, JSON.stringify(meta));
    const before = saved.get(id) ?? [];
    if (reshaped.has(id) || items.length < before.length) {
      delRows.run(id);
      delAllText.run(id);
      items.forEach((it, i) => writeItem(id, i, it));
    } else {
      items.forEach((it, i) => {
        if (before[i] !== it) writeItem(id, i, it);
      });
    }
  });
  reshaped.delete(id);
  saved.set(id, r.items);
}

function persist(id: string) {
  later(`rt:${id}`, () => writeRuntime(id), 600);
}

/** The runtime, loaded from the database if needed; undefined when the session has none yet. */
export function rt(id: string): SessionRuntime | undefined {
  let r = runtimes.get(id);
  if (r) return r;
  const meta = db.prepare('SELECT meta FROM runtimes WHERE id = ?').get(id) as { meta: string } | undefined;
  if (!meta) return undefined;
  const sum = summaries.get(id);
  const rows = db.prepare('SELECT data FROM items WHERE session = ? ORDER BY seq').all(id) as Array<{ data: string }>;
  // A turn cut off by a restart is no longer running.
  const items = rows.map((x) => closeOpen(JSON.parse(x.data) as Item));
  r = emptyRuntime(id, { ...(JSON.parse(meta.meta) as Partial<SessionRuntime>), items, state: 'idle', request: null, status: null, boardCheck: null, readOnly: !sum?.live });
  r.background = r.background.map((b) => (b.status === 'running' ? { ...b, status: 'stopped' as const } : b));
  runtimes.set(id, r);
  saved.set(id, items);
  // Items closed above differ from the rows: write them back once.
  reshaped.add(id);
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
  reshaped.add(r.id);
  persist(r.id);
}

/** Sessions whose transcript mentions `query` (full-text, newest first), with where it was found. */
export function searchTranscripts(query: string, limit = 50): Array<{ session: string; item: string; snippet: string }> {
  const q = query.trim();
  if (!q) return [];
  const rows = q.length >= 3
    ? db.prepare(`SELECT session, item, snippet(item_text, 2, '[', ']', '…', 12) AS snippet FROM item_text WHERE item_text MATCH ? LIMIT ?`).all(`"${q.replace(/"/g, '""')}"`, limit * 4)
    : db.prepare(`SELECT session, item, substr(text, max(1, instr(lower(text), lower(?)) - 30), 80) AS snippet FROM item_text WHERE instr(lower(text), lower(?)) > 0 LIMIT ?`).all(q, q, limit * 4);
  return rows as Array<{ session: string; item: string; snippet: string }>;
}

/** Apply a session event here and in every connected UI. */
export function emit(id: string, ev: SessionEvent) {
  const r = runtimes.get(id) ?? rt(id);
  if (!r) return;
  if (ev.t === 'raw') rawSeq += 1;
  runtimes.set(id, reduce(r, ev, rawSeq));
  if (ev.t === 'items.reset' || ev.t === 'item.remove' || (ev.t === 'item.add' && ev.after)) reshaped.add(id);
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
