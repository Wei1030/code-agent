/**
 * Workspace board: features F-n, issues I-n and notes N-n, kept in Code Agent's data directory.
 * Claude reaches it through board tools on the "workspace" MCP server. After each turn a recorder —
 * a cheap model with structured output, run in the background — records what the turn settled:
 * decisions, confirmed issues, finished work. Its changes are applied directly, marked unconfirmed,
 * and can be undone from the transcript. Imports normalise outside lists the same way.
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { BoardItem, BoardKind, BoardSource, BoardStatus, Item } from '@code-agent/shared/types';
import type { ImportRow, ImportSource } from '@code-agent/shared/api';
import { CLOSED, FIRST_STATUS, PREFIX, STATUSES, STATUS_LABEL } from '@code-agent/shared/board';
import { EFFORT_LABEL } from '@code-agent/shared/catalog';
import { app, set } from './state';
import { register } from './hub';
import { load, save } from './store';
import { addItem, patchItem, rt, summary } from './sessions/registry';
import { addHook, onTurnEnd } from './sessions/live';
import { addPromptPart } from './sessions/options';
import { addWorkspaceTools } from './peer';
import { oneShot } from './oneshot';

const run = promisify(execFile);

const all = () => app.board;
const wsOf = (sid: string) => summary(sid)?.workspaceId ?? '';

function findBoardItem(wsId: string, id: string): BoardItem | undefined {
  return all().find((x) => x.workspaceId === wsId && x.id === id);
}

function nextId(wsId: string, kind: BoardKind): string {
  const p = PREFIX[kind];
  const n = all().filter((x) => x.workspaceId === wsId && x.id.startsWith(`${p}-`)).reduce((m, x) => Math.max(m, Number(x.id.slice(2)) || 0), 0);
  return `${p}-${n + 1}`;
}

function put(item: BoardItem) {
  const same = (x: BoardItem) => x.workspaceId === item.workspaceId && x.id === item.id;
  set('board', all().some(same) ? all().map((x) => (same(x) ? item : x)) : [...all(), item]);
}

function createItem(wsId: string, p: Partial<BoardItem> & Pick<BoardItem, 'kind' | 'title'>, source: BoardSource, logText = '新建'): BoardItem {
  const now = Date.now();
  const item: BoardItem = {
    body: '', status: FIRST_STATUS[p.kind], priority: 'normal', tasks: [], decisions: [], sessions: source.sessionId ? [source.sessionId] : [],
    createdAt: now, updatedAt: now, ...p, id: nextId(wsId, p.kind), workspaceId: wsId, source,
    log: [{ ts: now, text: logText, sessionId: source.sessionId, auto: source.kind === 'auto' }],
  };
  put(item);
  return item;
}

function updateItem(wsId: string, id: string, p: Partial<BoardItem>, logText?: string, by: { sessionId?: string; auto?: boolean } = {}) {
  const cur = findBoardItem(wsId, id);
  if (!cur) return;
  const sessions = by.sessionId && !cur.sessions.includes(by.sessionId) ? [...cur.sessions, by.sessionId] : cur.sessions;
  const log = logText ? [...cur.log, { ts: Date.now(), text: logText, sessionId: by.sessionId, auto: by.auto }] : cur.log;
  put({ ...cur, ...p, id: cur.id, workspaceId: cur.workspaceId, sessions, log, updatedAt: Date.now() });
}

function deleteItem(wsId: string, id: string) {
  set('board', all().filter((x) => !(x.workspaceId === wsId && x.id === id)));
}

// ------------------------------------------------------------------ undoable changes shown in the transcript

interface Before { wsId: string; id: string; before: BoardItem | null }
const undoLog = load<Record<string, Before[]>>('board-undo', {});

function tracker() {
  const before: Before[] = [];
  return {
    before,
    create(wsId: string, p: Partial<BoardItem> & Pick<BoardItem, 'kind' | 'title'>, source: BoardSource, logText?: string) {
      const it = createItem(wsId, { ...p, unconfirmed: source.kind === 'auto' ? true : p.unconfirmed }, source, logText);
      before.push({ wsId, id: it.id, before: null });
      return it;
    },
    update(wsId: string, id: string, p: Partial<BoardItem>, logText: string, by: { sessionId?: string; auto?: boolean }) {
      const cur = findBoardItem(wsId, id);
      if (!cur) return false;
      if (!before.some((b) => b.wsId === wsId && b.id === id)) before.push({ wsId, id, before: cur });
      updateItem(wsId, id, { ...p, unconfirmed: by.auto ? true : cur.unconfirmed }, logText, by);
      return true;
    },
  };
}

function card(sid: string, by: 'recorder' | 'agent', tr: ReturnType<typeof tracker>, changes: Array<{ itemId: string; action: 'created' | 'updated'; text: string }>, model?: string) {
  if (!changes.length) return;
  const id = randomUUID();
  undoLog[id] = tr.before;
  save('board-undo', () => undoLog);
  addItem(sid, { kind: 'board', id, by, changes, ...(model ? { model } : {}) });
}

function undoBoardRecord(sid: string, cardId: string) {
  const list = undoLog[cardId];
  if (!list) return;
  for (const b of [...list].reverse()) {
    if (b.before) put(b.before);
    else deleteItem(b.wsId, b.id);
  }
  delete undoLog[cardId];
  save('board-undo', () => undoLog);
  patchItem(sid, cardId, { undone: true });
}

// ------------------------------------------------------------------ Claude's board tools

const brief = (x: BoardItem) => `${x.id} [${x.kind} · ${STATUS_LABEL[x.status]}${x.priority !== 'normal' ? ` · ${x.priority}` : ''}] ${x.title}`;

function full(x: BoardItem): string {
  return [
    brief(x),
    x.body,
    x.tasks.length ? `Tasks:\n${x.tasks.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}`).join('\n')}` : '',
    x.decisions.length ? `Decisions:\n${x.decisions.map((d) => `- ${d.text} → ${d.outcome ?? 'open'}`).join('\n')}` : '',
    x.source.ref ? `Source: ${x.source.ref}${x.source.url ? ` ${x.source.url}` : ''}` : '',
  ].filter(Boolean).join('\n\n');
}

function matches(x: BoardItem, q: string): boolean {
  const hay = `${x.id} ${x.title} ${x.body} ${x.tasks.map((t) => t.text).join(' ')}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

const STATUS_ENUM = ['todo', 'doing', 'done', 'dropped', 'open', 'confirmed', 'fixing', 'fixed', 'wontfix', 'active', 'outdated'] as const;

addWorkspaceTools((sid) => [
  tool('board_search', 'Search the workspace board (features F-n, issues I-n, notes N-n). Empty query lists open items.', {
    query: z.string().optional(), kind: z.enum(['feature', 'issue', 'note']).optional(), include_closed: z.boolean().optional(),
  }, async (a) => {
    const ws = wsOf(sid);
    const list = all().filter((x) => x.workspaceId === ws && (!a.kind || x.kind === a.kind) && (a.include_closed || !CLOSED.includes(x.status)) && (!a.query || matches(x, a.query)));
    return { content: [{ type: 'text' as const, text: list.length ? list.slice(0, 50).map(brief).join('\n') : 'No matching board items.' }] };
  }, { annotations: { readOnlyHint: true } }),
  tool('board_get', 'Read one board item in full.', { id: z.string() }, async (a) => {
    const x = findBoardItem(wsOf(sid), a.id.toUpperCase());
    return { content: [{ type: 'text' as const, text: x ? full(x) : `No item ${a.id}.` }], ...(x ? {} : { isError: true }) };
  }, { annotations: { readOnlyHint: true } }),
  tool('board_create', 'Create a board item when the user asks you to record something (a feature to build, a confirmed issue, a note on a decision). Search first to avoid duplicates.', {
    kind: z.enum(['feature', 'issue', 'note']), title: z.string(), body: z.string().optional(), priority: z.enum(['high', 'normal', 'low']).optional(),
    tasks: z.array(z.string()).optional(),
  }, async (a) => {
    const ws = wsOf(sid);
    const tr = tracker();
    const it = tr.create(ws, { kind: a.kind, title: a.title, body: a.body ?? '', priority: a.priority ?? 'normal', tasks: (a.tasks ?? []).map((t) => ({ id: randomUUID().slice(0, 8), text: t, done: false })) }, { kind: 'agent', sessionId: sid }, 'Claude 新建');
    card(sid, 'agent', tr, [{ itemId: it.id, action: 'created', text: a.kind === 'feature' ? '新功能' : a.kind === 'issue' ? '新问题' : '新笔记' }]);
    return { content: [{ type: 'text' as const, text: `Created ${it.id}. Cite it by id from now on.` }] };
  }),
  tool('board_update', 'Update a board item: status, title, body, priority, tasks, decisions.', {
    id: z.string(), status: z.enum(STATUS_ENUM).optional(), title: z.string().optional(), body: z.string().optional(), priority: z.enum(['high', 'normal', 'low']).optional(),
    add_tasks: z.array(z.string()).optional(), complete_tasks: z.array(z.string()).optional().describe('Task texts (or their start) to mark done'),
    add_decisions: z.array(z.object({ text: z.string(), outcome: z.string().optional() })).optional(), note: z.string().optional().describe('What changed, for the item log'),
  }, async (a) => {
    const ws = wsOf(sid);
    const cur = findBoardItem(ws, a.id.toUpperCase());
    if (!cur) return { content: [{ type: 'text' as const, text: `No item ${a.id}.` }], isError: true };
    if (a.status && !STATUSES[cur.kind].includes(a.status)) return { content: [{ type: 'text' as const, text: `Status ${a.status} does not apply to a ${cur.kind}; use one of ${STATUSES[cur.kind].join(', ')}.` }], isError: true };
    const tasks = [...cur.tasks.map((t) => (a.complete_tasks?.some((c) => t.text.startsWith(c) || c.startsWith(t.text)) ? { ...t, done: true } : t)), ...(a.add_tasks ?? []).map((t) => ({ id: randomUUID().slice(0, 8), text: t, done: false }))];
    const decisions = [...cur.decisions, ...(a.add_decisions ?? []).map((d) => ({ id: randomUUID().slice(0, 8), ...d }))];
    const p: Partial<BoardItem> = { tasks, decisions, ...(a.status ? { status: a.status } : {}), ...(a.title ? { title: a.title } : {}), ...(a.body !== undefined ? { body: a.body } : {}), ...(a.priority ? { priority: a.priority } : {}) };
    const text = a.note ?? (a.status ? `状态 → ${STATUS_LABEL[a.status]}` : '已更新');
    const tr = tracker();
    tr.update(ws, cur.id, p, `Claude：${text}`, { sessionId: sid });
    card(sid, 'agent', tr, [{ itemId: cur.id, action: 'updated', text }]);
    return { content: [{ type: 'text' as const, text: `Updated ${cur.id}.` }] };
  }),
]);

addPromptPart(() => 'This workspace has a board of features (F-n), issues (I-n) and notes (N-n) kept by Code Agent. Use board_search / board_get when the user mentions an id or past decisions; create or update items only when the user asks or work on an item is finished. Cite items by id (e.g. F-3) so the user can click them.');

// New sessions hear which features are in progress (when the user turned that on).
addHook('SessionStart', (sid, input) => {
  if (!app.boardSettings.startContext || input.source !== 'startup') return undefined;
  const ws = wsOf(sid);
  const doing = all().filter((x) => x.workspaceId === ws && (x.status === 'doing' || x.status === 'fixing' || (x.kind === 'issue' && x.status === 'confirmed')));
  if (!doing.length) return undefined;
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `Work in progress on the workspace board:\n${doing.slice(0, 15).map(brief).join('\n')}` } };
});

// ------------------------------------------------------------------ recorder

function recorderLabel() {
  const s = app.boardSettings;
  return `后台识别 · ${app.models.find((m) => m.id === s.recorderModel)?.label ?? s.recorderModel} · 思考${EFFORT_LABEL[s.recorderEffort] ?? s.recorderEffort}`;
}

/** The turn that just ended, condensed: user text, Claude's text, one line per tool call. */
function turnText(sid: string, userId: string): string {
  const items = rt(sid)?.items ?? [];
  const start = Math.max(0, items.findIndex((x) => x.id === userId));
  const lines: string[] = [];
  for (const it of items.slice(start) as Item[]) {
    if (it.kind === 'user') lines.push(`USER${it.from ? ` (from session "${it.from.title}")` : it.fromApp ? ` (Code Agent: ${it.fromApp})` : ''}: ${it.text}`);
    else if (it.kind === 'text') lines.push(`CLAUDE: ${it.text}`);
    else if (it.kind === 'tool') lines.push(`TOOL ${it.tool} ${it.detail}${it.right ? ` → ${it.right}` : ''}${it.status === 'error' ? ' (failed)' : ''}`);
    else if (it.kind === 'toolgroup') lines.push(`TOOLS ${it.label}`);
    else if (it.kind === 'plan') lines.push(`PLAN (${it.status}): ${it.plan.markdown ?? it.plan.title}`);
  }
  const text = lines.join('\n');
  return text.length > 24_000 ? `${text.slice(0, 12_000)}\n…\n${text.slice(-12_000)}` : text;
}

interface RecorderOps {
  operations: Array<{
    op: 'create' | 'update';
    id?: string;
    kind?: BoardKind;
    title?: string;
    body?: string;
    status?: BoardStatus;
    priority?: 'high' | 'normal' | 'low';
    tasks?: string[];
    complete_tasks?: string[];
    decisions?: Array<{ text: string; outcome?: string }>;
    note: string;
  }>;
}

const RECORDER_SCHEMA = {
  type: 'object', required: ['operations'], additionalProperties: false,
  properties: {
    operations: {
      type: 'array', maxItems: 6,
      items: {
        type: 'object', required: ['op', 'note'], additionalProperties: false,
        properties: {
          op: { type: 'string', enum: ['create', 'update'] }, id: { type: 'string', description: 'For update: the existing item id' },
          kind: { type: 'string', enum: ['feature', 'issue', 'note'] }, title: { type: 'string' }, body: { type: 'string' },
          status: { type: 'string', enum: [...STATUS_ENUM] }, priority: { type: 'string', enum: ['high', 'normal', 'low'] },
          tasks: { type: 'array', items: { type: 'string' } }, complete_tasks: { type: 'array', items: { type: 'string' } },
          decisions: { type: 'array', items: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, outcome: { type: 'string' } } } },
          note: { type: 'string', description: 'Short Chinese description of the change, shown to the user' },
        },
      },
    },
  },
};

function candidates(ws: string, text: string): BoardItem[] {
  const items = all().filter((x) => x.workspaceId === ws);
  if (items.length <= 40) return items;
  const words = new Set(text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []);
  const score = (x: BoardItem) => [...`${x.id} ${x.title}`.toLowerCase().matchAll(/[\p{L}\p{N}_-]{2,}/gu)].filter((m) => words.has(m[0])).length + (text.includes(x.id) ? 10 : 0) + (CLOSED.includes(x.status) ? 0 : 1);
  return items.sort((a, b) => score(b) - score(a)).slice(0, 40);
}

async function recordTurn(sid: string, userId: string) {
  const ws = wsOf(sid);
  const turn = turnText(sid, userId);
  if (!ws || turn.length < 40) return;
  const s = app.boardSettings;
  const known = candidates(ws, turn);
  const prompt = [
    'You keep a software project\'s board up to date. Read the conversation turn below and record only what it SETTLED:',
    '- a decision the user made (note, or a decision on a feature),',
    '- a defect that was confirmed (issue) or fixed (update the issue to fixed),',
    '- a feature that was agreed on (feature, with tasks if a plan was given) or finished (update to done).',
    'Do not record questions, guesses, routine reads or anything not settled. Prefer updating an existing item over creating a duplicate. Most turns need no operation at all: then return an empty list.',
    'Write titles, bodies and notes in Simplified Chinese.',
    `Existing items:\n${known.length ? known.map(brief).join('\n') : '(none)'}`,
    `Turn:\n${turn}`,
  ].join('\n\n');
  let ops: RecorderOps;
  try {
    ops = await oneShot<RecorderOps>({ prompt, schema: RECORDER_SCHEMA, model: s.recorderModel, effort: s.recorderEffort, workspaceId: ws });
  } catch (e) {
    console.error('[board] recorder failed:', e instanceof Error ? e.message : e);
    return;
  }
  if (!summary(sid)) return;
  const tr = tracker();
  const changes: Array<{ itemId: string; action: 'created' | 'updated'; text: string }> = [];
  for (const o of ops.operations ?? []) {
    if (o.op === 'create' && o.kind && o.title) {
      const status = o.status && STATUSES[o.kind].includes(o.status) ? o.status : FIRST_STATUS[o.kind];
      const it = tr.create(ws, {
        kind: o.kind, title: o.title, body: o.body ?? '', status, priority: o.priority ?? 'normal',
        tasks: (o.tasks ?? []).map((t) => ({ id: randomUUID().slice(0, 8), text: t, done: false })),
        decisions: (o.decisions ?? []).map((d) => ({ id: randomUUID().slice(0, 8), ...d })),
      }, { kind: 'auto', sessionId: sid }, `自动记录：${o.note}`);
      changes.push({ itemId: it.id, action: 'created', text: o.note });
    } else if (o.op === 'update' && o.id) {
      const cur = findBoardItem(ws, o.id.toUpperCase());
      if (!cur) continue;
      const status = o.status && STATUSES[cur.kind].includes(o.status) ? o.status : undefined;
      const tasks = [...cur.tasks.map((t) => (o.complete_tasks?.some((c) => t.text.startsWith(c) || c.startsWith(t.text)) ? { ...t, done: true } : t)), ...(o.tasks ?? []).map((t) => ({ id: randomUUID().slice(0, 8), text: t, done: false }))];
      const decisions = [...cur.decisions, ...(o.decisions ?? []).map((d) => ({ id: randomUUID().slice(0, 8), ...d }))];
      if (tr.update(ws, cur.id, { tasks, decisions, ...(status ? { status } : {}), ...(o.body ? { body: o.body } : {}) }, `自动记录：${o.note}`, { sessionId: sid, auto: true })) {
        changes.push({ itemId: cur.id, action: 'updated', text: o.note });
      }
    }
  }
  card(sid, 'recorder', tr, changes, recorderLabel());
}

onTurnEnd((sid, info) => {
  const sum = summary(sid);
  if (!app.boardSettings.recorder || !info.ok || info.interrupted || !sum || sum.jobId) return;
  // In the background: it never holds up the session.
  setTimeout(() => void recordTurn(sid, info.userId), 500);
});

// ------------------------------------------------------------------ review findings

function findingToBoard(ticketId: string, findingId: string): string | null {
  const t = app.reviews.find((x) => x.id === ticketId);
  const f = t?.findings.find((x) => x.id === findingId);
  if (!t || !f) return null;
  const ws = wsOf(t.sessionId);
  const ref = `${ticketId}:${findingId}`;
  const existing = all().find((x) => x.workspaceId === ws && x.source.ref === ref);
  if (existing) return existing.id;
  return createItem(ws, {
    kind: 'issue', title: f.title, body: `${f.detail}\n位置：${f.file}${f.line ? `:${f.line}` : ''}`, priority: f.severity === 'minor' ? 'low' : 'normal',
  }, { kind: 'review', sessionId: t.sessionId, ref }, `来自代码审核意见 ${f.id}（审核结束时没有解决）`).id;
}

// ------------------------------------------------------------------ import

const IMPORT_SCHEMA = {
  type: 'object', required: ['rows'], additionalProperties: false,
  properties: {
    rows: {
      type: 'array', maxItems: 60,
      items: {
        type: 'object', required: ['ref', 'kind', 'title', 'body', 'action', 'reason'], additionalProperties: false,
        properties: {
          ref: { type: 'string', description: 'External id (GitHub #12, PROJ-34) or the line it came from' }, url: { type: 'string' },
          kind: { type: 'string', enum: ['feature', 'issue', 'note'] }, title: { type: 'string' }, body: { type: 'string' },
          action: { type: 'string', description: '"create", "skip", or the id of the existing board item it duplicates (merge)' },
          reason: { type: 'string', description: 'Short Chinese reason for the action' },
        },
      },
    },
  },
};

function importPrompt(wsId: string, what: string, material: string): string {
  const items = all().filter((x) => x.workspaceId === wsId);
  return [
    `Turn ${what} into board items for a software project: feature (something to build), issue (a defect or problem), note (a decision or background).`,
    'For each entry decide the action: "create"; the id of an existing item that is the same thing (it will be merged); or "skip" for noise, typos, duplicates within the list or things already done. Keep external ids and URLs in ref and url.',
    'Titles short and specific; titles, bodies and reasons in Simplified Chinese (keep code identifiers as they are).',
    `Existing board items:\n${items.length ? items.map(brief).join('\n') : '(none)'}`,
    `Material:\n${material.length > 40_000 ? `${material.slice(0, 40_000)}\n…` : material}`,
  ].join('\n\n');
}

async function importPreview(wsId: string, source: ImportSource, input: string): Promise<ImportRow[]> {
  const ws = app.workspaces.find((w) => w.id === wsId);
  if (!ws) throw new Error('工作区不存在');
  const s = app.boardSettings;
  let material = input;
  let what = 'the pasted list';
  if (source === 'file') what = 'the contents of a file (Markdown, CSV, JSON or text)';
  if (source === 'github') {
    const { repo, query } = JSON.parse(input || '{}') as { repo?: string; query?: string };
    const args = ['issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,body,url,labels', ...(repo ? ['--repo', repo] : []), ...(query && query !== 'is:open' ? ['--search', query] : [])];
    try {
      const { stdout } = await run('gh', args, { cwd: ws.path, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
      const issues = JSON.parse(stdout) as Array<{ number: number; title: string; body: string; url: string; labels: Array<{ name: string }> }>;
      if (!issues.length) return [];
      material = issues.map((i) => `GitHub #${i.number} ${i.url}\nTitle: ${i.title}\nLabels: ${i.labels.map((l) => l.name).join(', ')}\n${(i.body ?? '').slice(0, 800)}`).join('\n\n---\n\n');
      what = 'GitHub issues (keep "GitHub #<number>" as ref and the issue URL as url)';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(/ENOENT|not recognized|not found/i.test(msg) ? '没有找到 gh 命令：先安装 GitHub CLI 并在终端里运行 gh auth login。' : `gh 读取失败：${msg.split('\n')[0]}`);
    }
  }
  if (source === 'jira') {
    const servers = app.mcp.filter((m) => /jira|atlassian/i.test(m.name) && m.status === 'connected' && (m.scope !== 'workspace' || m.workspaceId === wsId));
    if (!servers.length) throw new Error('没有已连接的 Jira（Atlassian）MCP 服务器。');
    const res = await oneShot<{ rows: ImportRow[] }>({
      prompt: `${importPrompt(wsId, 'Jira issues', '(fetch them yourself)')}\n\nUse the Jira MCP tools to search with this JQL and read the results: ${input}\nUse the Jira key (e.g. PROJ-12) as ref and the issue's browse URL as url.`,
      schema: IMPORT_SCHEMA, model: s.recorderModel, effort: s.recorderEffort, cwd: ws.path, withSettings: true,
      allowedTools: servers.map((m) => `mcp__${m.name}`), workspaceId: wsId, timeoutMs: 300_000,
    });
    return normalize(wsId, res.rows, 'jira');
  }
  const res = await oneShot<{ rows: ImportRow[] }>({ prompt: importPrompt(wsId, what, material), schema: IMPORT_SCHEMA, model: s.recorderModel, effort: s.recorderEffort, workspaceId: wsId });
  return normalize(wsId, res.rows, source);
}

function normalize(wsId: string, rows: ImportRow[], source: ImportSource): ImportRow[] {
  return rows.map((r, i) => {
    const merge = r.action !== 'create' && r.action !== 'skip' ? findBoardItem(wsId, r.action.toUpperCase()) : undefined;
    // Something imported before from the same source is merged into it.
    const same = r.ref ? all().find((x) => x.workspaceId === wsId && x.source.kind === 'import' && x.source.ref === r.ref) : undefined;
    return {
      ...r, key: `${source}-${i}`, ref: r.ref || `第 ${i + 1} 条`,
      action: same ? same.id : merge ? merge.id : r.action === 'skip' ? 'skip' : 'create',
      reason: same ? `看板上的 ${same.id} 就是从它导入的` : r.reason,
    };
  });
}

function applyImport(wsId: string, rows: ImportRow[]): string[] {
  const created: string[] = [];
  for (const r of rows) {
    if (r.action === 'skip') continue;
    if (r.action === 'create') created.push(createItem(wsId, { kind: r.kind, title: r.title, body: r.body }, { kind: 'import', ref: r.ref, url: r.url }, `从 ${r.ref} 导入`).id);
    else updateItem(wsId, r.action, {}, `合并了 ${r.ref}：${r.title}`);
  }
  return created;
}

function boardMarkdown(wsId: string): string {
  const ws = app.workspaces.find((w) => w.id === wsId);
  const lines = [`# 看板 · ${ws?.name ?? ''}`, ''];
  for (const [kind, title] of [['feature', '功能'], ['issue', '问题'], ['note', '笔记']] as const) {
    const list = all().filter((x) => x.workspaceId === wsId && x.kind === kind);
    if (!list.length) continue;
    lines.push(`## ${title}`, '');
    for (const it of list) {
      lines.push(`### ${it.id} ${it.title}（${STATUS_LABEL[it.status]}）`, '');
      if (it.body) lines.push(it.body, '');
      for (const t of it.tasks) lines.push(`- [${t.done ? 'x' : ' '}] ${t.text}`);
      for (const d of it.decisions) lines.push(`- 决定：${d.text} → ${d.outcome ?? '待定'}`);
      if (it.source.url) lines.push(`- 来源：[${it.source.ref ?? it.source.url}](${it.source.url})`);
      if (it.tasks.length || it.decisions.length || it.source.url) lines.push('');
    }
  }
  return lines.join('\n');
}

register({
  createItem: (wsId, p, source) => createItem(wsId, p, source),
  updateItem: (wsId, id, p, logText) => updateItem(wsId, id, p, logText),
  deleteItem,
  confirmItem: (wsId, id) => updateItem(wsId, id, { unconfirmed: false }, '已确认'),
  undoBoardRecord,
  findingToBoard,
  importPreview,
  applyImport,
  boardMarkdown,
});
