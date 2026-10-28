/**
 * Workspace board. Items live in Code Agent's data directory (here: the store), not in the repo.
 * Claude reaches them through four tools on the in-process MCP server "board" (search, get, create,
 * update). After each turn a recorder — a cheap model with structured output — reads the turn and
 * records what was settled: decisions, confirmed issues, finished work. Its changes are applied
 * directly, marked unconfirmed, and can be undone from the transcript.
 */
import type { BoardItem, BoardKind, BoardSource } from '../api/types';
import { useApp } from '../store/app';
import { uid } from '../lib/util';
import { addItem, finishTool, newTool, patch, raw, rt, sleep, streamText, type Run } from './engine';
import { EFFORT_LABEL, MODELS } from './data';
import { CLOSED, FIRST_STATUS, KIND_ICON, PREFIX, STATUS_LABEL } from '../lib/board';
import { footer } from './scenarios';

const all = () => useApp.getState().board;
const wsOf = (sid: string) => useApp.getState().sessions.find((s) => s.id === sid)?.workspaceId ?? '';

export function findItem(wsId: string, id: string): BoardItem | undefined {
  return all().find((x) => x.workspaceId === wsId && x.id === id);
}

function nextId(wsId: string, kind: BoardKind): string {
  const p = PREFIX[kind];
  const n = all().filter((x) => x.workspaceId === wsId && x.id.startsWith(`${p}-`)).reduce((m, x) => Math.max(m, Number(x.id.slice(2)) || 0), 0);
  return `${p}-${n + 1}`;
}

function put(item: BoardItem) {
  const app = useApp.getState();
  const same = (x: BoardItem) => x.workspaceId === item.workspaceId && x.id === item.id;
  app.set({ board: app.board.some(same) ? app.board.map((x) => (same(x) ? item : x)) : [...app.board, item] });
}

// ------------------------------------------------------------------ editing

export function createItem(wsId: string, p: Partial<BoardItem> & Pick<BoardItem, 'kind' | 'title'>, source: BoardSource, logText = '新建'): BoardItem {
  const now = Date.now();
  const item: BoardItem = {
    body: '', status: FIRST_STATUS[p.kind], priority: 'normal', tasks: [], decisions: [], sessions: source.sessionId ? [source.sessionId] : [],
    createdAt: now, updatedAt: now, ...p, id: nextId(wsId, p.kind), workspaceId: wsId, source,
    log: [{ ts: now, text: logText, sessionId: source.sessionId, auto: source.kind === 'auto' }],
  };
  put(item);
  return item;
}

export function updateItem(wsId: string, id: string, p: Partial<BoardItem>, logText?: string, by: { sessionId?: string; auto?: boolean } = {}) {
  const cur = findItem(wsId, id);
  if (!cur) return;
  const sessions = by.sessionId && !cur.sessions.includes(by.sessionId) ? [...cur.sessions, by.sessionId] : cur.sessions;
  const log = logText ? [...cur.log, { ts: Date.now(), text: logText, sessionId: by.sessionId, auto: by.auto }] : cur.log;
  put({ ...cur, ...p, sessions, log, updatedAt: Date.now() });
}

export function deleteItem(wsId: string, id: string) {
  const app = useApp.getState();
  app.set({ board: app.board.filter((x) => !(x.workspaceId === wsId && x.id === id)) });
}

export function confirmItem(wsId: string, id: string) {
  updateItem(wsId, id, { unconfirmed: false });
}

// ------------------------------------------------------------------ changes shown in the transcript, undoable

interface Before { wsId: string; id: string; before: BoardItem | null }
const undoLog = new Map<string, Before[]>();

/** Collects changes so the transcript card can undo them together. */
function tracker() {
  const before: Before[] = [];
  return {
    before,
    create(wsId: string, p: Partial<BoardItem> & Pick<BoardItem, 'kind' | 'title'>, source: BoardSource, logText?: string) {
      const it = createItem(wsId, p, source, logText);
      before.push({ wsId, id: it.id, before: null });
      return it;
    },
    update(wsId: string, id: string, p: Partial<BoardItem>, logText: string, by: { sessionId?: string; auto?: boolean }) {
      const cur = findItem(wsId, id);
      if (!cur) return;
      if (!before.some((b) => b.wsId === wsId && b.id === id)) before.push({ wsId, id, before: cur });
      updateItem(wsId, id, { ...p, unconfirmed: by.auto ? true : cur.unconfirmed }, logText, by);
    },
  };
}

function card(sid: string, by: 'recorder' | 'agent', tr: ReturnType<typeof tracker>, changes: Array<{ itemId: string; action: 'created' | 'updated'; text: string }>, model?: string) {
  if (!changes.length) return;
  const id = uid('bd');
  undoLog.set(id, tr.before);
  addItem(sid, { kind: 'board', id, by, changes, model });
}

export function undoBoardRecord(sid: string, cardId: string) {
  const list = undoLog.get(cardId);
  if (!list) return;
  for (const b of [...list].reverse()) {
    if (b.before) put(b.before);
    else deleteItem(b.wsId, b.id);
  }
  undoLog.delete(cardId);
  patch(sid, cardId, { undone: true });
}

// ------------------------------------------------------------------ recorder

export type TurnFacts =
  | { kind: 'fix' }
  | { kind: 'decision'; answers: string[] }
  | { kind: 'plan'; steps: string[] }
  | { kind: 'spawn' };

/** After a turn the recorder reads it in the background (it never holds up the session) and records what was settled. */
export function recordTurn(sid: string, facts: TurnFacts) {
  const settings = useApp.getState().boardSettings;
  if (!settings.recorder) return;
  const model = `${MODELS.find((m) => m.id === settings.recorderModel)?.label ?? settings.recorderModel} · 思考${EFFORT_LABEL[settings.recorderEffort]}`;
  setTimeout(() => {
    if (!rt(sid)) return;
    const wsId = wsOf(sid);
    const by = { sessionId: sid, auto: true };
    const tr = tracker();
    const changes: Array<{ itemId: string; action: 'created' | 'updated'; text: string }> = [];
    const open = (kind: BoardKind, re: RegExp) => all().find((x) => x.workspaceId === wsId && x.kind === kind && re.test(x.title) && !CLOSED.includes(x.status));

    if (facts.kind === 'fix') {
      const why = '原因：两个测试共用一个没清理的模块级计时器。已改用注入的时钟，并随购物车一起释放；结账测试连续通过。';
      const hit = open('issue', /结账测试|计时器|checkout/i);
      if (hit) {
        tr.update(wsId, hit.id, { status: 'fixed' }, `已修复。${why}`, by);
        changes.push({ itemId: hit.id, action: 'updated', text: `${STATUS_LABEL[hit.status]} → 已修复` });
      } else {
        const it = tr.create(wsId, { kind: 'issue', title: '结账测试偶发失败：计时器在测试之间泄漏', body: why, status: 'fixed', unconfirmed: true }, { kind: 'auto', sessionId: sid }, '从对话中记录');
        changes.push({ itemId: it.id, action: 'created', text: '新问题 · 已修复' });
      }
    }
    if (facts.kind === 'decision' && facts.answers.length) {
      const f = open('feature', /限流/);
      const [store, scope] = facts.answers;
      if (f) {
        const decisions = f.decisions.map((d) => (/存在哪里/.test(d.text) && store ? { ...d, outcome: store } : /维度/.test(d.text) && scope ? { ...d, outcome: scope } : d));
        tr.update(wsId, f.id, { decisions }, `决定：计数器 → ${store}${scope ? `；范围 → ${scope}` : ''}`, by);
        changes.push({ itemId: f.id, action: 'updated', text: `记下 ${scope ? 2 : 1} 个决定` });
      } else {
        const it = tr.create(wsId, {
          kind: 'feature', title: '订单接口限流', status: 'doing', unconfirmed: true,
          decisions: [{ id: uid('d'), text: '计数器存在哪里？', outcome: store }, ...(scope ? [{ id: uid('d'), text: '按什么维度计数？', outcome: scope }] : [])],
        }, { kind: 'auto', sessionId: sid }, '从对话中记录');
        changes.push({ itemId: it.id, action: 'created', text: '新功能，含 2 个决定' });
      }
    }
    if (facts.kind === 'plan') {
      const f = open('feature', /限流/);
      if (f) {
        const have = new Set(f.tasks.map((x) => x.text));
        const add = facts.steps.filter((s) => !have.has(s)).map((text) => ({ id: uid('t'), text, done: false }));
        tr.update(wsId, f.id, { tasks: [...f.tasks, ...add], status: 'doing' }, `按批准的计划补了 ${add.length} 个任务`, by);
        changes.push({ itemId: f.id, action: 'updated', text: `补了 ${add.length} 个任务` });
      }
    }
    if (facts.kind === 'spawn') {
      const kids = useApp.getState().sessions.filter((s) => s.createdBy?.sessionId === sid).map((s) => s.id);
      const it = tr.create(wsId, {
        kind: 'feature', title: '订单导出支持 CSV 和 Excel', status: 'doing', unconfirmed: true, sessions: [sid, ...kids],
        body: '共用接口 GET /orders/export?format=csv|xlsx，CSV 和 Excel 分别由两个会话实现。',
        tasks: [
          { id: uid('t'), text: '共用导出接口 GET /orders/export', done: true },
          { id: uid('t'), text: 'CSV 导出（会话「订单导出 · CSV」）', done: false },
          { id: uid('t'), text: 'Excel 导出（会话「订单导出 · Excel」，分支 agent/order-export-xlsx）', done: false },
        ],
      }, { kind: 'auto', sessionId: sid }, '从对话中记录');
      changes.push({ itemId: it.id, action: 'created', text: '新功能，含 3 个任务' });
    }
    card(sid, 'recorder', tr, changes, model);
    raw(sid, 'code_agent/recorder', `${model} · ${changes.length} 处修改`, { changes });
  }, 1500);
}

// ------------------------------------------------------------------ Claude's board tools

/** The user asks Claude to note something: it searches the board first, then creates an item. */
export async function scenarioBoard(run: Run) {
  const sid = run.sid;
  const wsId = wsOf(sid);
  const t0 = Date.now();
  await streamText(run, '我先查一下看板上有没有相关的条目。');
  const hits = all().filter((x) => x.workspaceId === wsId && /限流|429/.test(x.title + x.body));
  const s1 = newTool(sid, 'mcp__board__board_search', '"限流 429"', {
    rows: hits.length ? hits.map((h) => ({ icon: KIND_ICON[h.kind], text: `${h.id} ${h.title}`, right: STATUS_LABEL[h.status] })) : [{ icon: 'info', text: '没有匹配的条目' }],
  });
  await sleep(run, 500);
  finishTool(sid, s1, { seconds: 0.1 });
  const rel = hits.find((h) => h.kind === 'feature' && !CLOSED.includes(h.status));
  await streamText(run, rel ? `看板上已经有 ${rel.id}（${rel.title}），但「上线后监控 429 比例」还没有记。我新建一个功能条目，在里面关联 ${rel.id}。` : '看板上还没有相关条目，我新建一个。');
  const tr = tracker();
  const it = tr.create(wsId, {
    kind: 'feature', title: '限流上线后监控 429 比例',
    body: `${rel ? `关联 ${rel.id}。` : ''}上线后一周内每天看一次 429 的比例；超过 2% 就调高限额，或改成按用户计数。`,
    tasks: [{ id: uid('t'), text: '在监控面板加 429 比例图', done: false }, { id: uid('t'), text: '上线一周后复盘', done: false }],
  }, { kind: 'agent', sessionId: sid }, 'Claude 用看板工具新建');
  const c1 = newTool(sid, 'mcp__board__board_create', `feature · ${it.title}`, { rows: [{ icon: 'check', text: `已创建 ${it.id}：${it.title}` }] });
  await sleep(run, 400);
  finishTool(sid, c1, { seconds: 0.1 });
  card(sid, 'agent', tr, [{ itemId: it.id, action: 'created', text: '新功能' }]);
  await streamText(run, `已记为 ${it.id}${rel ? `，和 ${rel.id} 关联` : ''}。之后讨论到它时我会写编号，点编号就能跳到看板。`);
  footer(sid, 2, (Date.now() - t0) / 1000);
}

// ------------------------------------------------------------------ review findings

/** An unresolved review finding becomes a board issue (once). Returns the item id. */
export function findingToBoard(ticketId: string, findingId: string): string | null {
  const t = useApp.getState().reviews.find((x) => x.id === ticketId);
  const f = t?.findings.find((x) => x.id === findingId);
  if (!t || !f) return null;
  const wsId = wsOf(t.sessionId);
  const ref = `${ticketId}:${findingId}`;
  const existing = all().find((x) => x.workspaceId === wsId && x.source.ref === ref);
  if (existing) return existing.id;
  const it = createItem(wsId, {
    kind: 'issue', title: f.title, body: `${f.detail}\n位置：${f.file}${f.line ? `:${f.line}` : ''}`, priority: f.severity === 'minor' ? 'low' : 'normal',
  }, { kind: 'review', sessionId: t.sessionId, ref }, `来自代码审核意见 ${f.id}（审核结束时没有解决）`);
  return it.id;
}

// ------------------------------------------------------------------ import

export interface ImportRow {
  key: string;
  ref: string;
  url?: string;
  kind: BoardKind;
  title: string;
  body: string;
  /** 'create', 'skip', or the id of the item to merge into. */
  action: string;
  reason: string;
}

const GITHUB = [
  { n: 311, title: '购物车过期时 GET /checkout/:id 返回 500', en: 'Checkout returns 500 when cart expired', kind: 'issue' as const },
  { n: 318, title: '订单导出为 CSV', en: 'Export orders as CSV', kind: 'feature' as const },
  { n: 320, title: '限流返回 429 时没有带 Retry-After', en: 'Rate limit 429 without Retry-After', kind: 'issue' as const },
  { n: 322, title: 'README 里的拼写错误', en: 'Typo in README', kind: 'issue' as const },
  { n: 325, title: '订单导出 CSV', en: 'CSV export for orders', kind: 'feature' as const },
];

/** What an import run proposes: Claude reads the source, normalizes each entry and checks the board for duplicates. */
export function importPreview(wsId: string, source: 'paste' | 'file' | 'github' | 'jira', input: string): ImportRow[] {
  const ws = all().filter((x) => x.workspaceId === wsId);
  const similar = (title: string) => ws.find((x) => [...title].some((_, i) => i + 4 <= title.length && x.title.includes(title.slice(i, i + 4))));
  if (source === 'github') {
    const repo = input.trim() || 'acme/shop-api';
    return GITHUB.map((g) => {
      const ref = `GitHub #${g.n}`;
      const same = ws.find((x) => x.source.ref === ref);
      const like = g.kind === 'feature' ? ws.find((x) => x.kind === 'feature' && /订单导出|CSV/.test(x.title)) : undefined;
      const row: ImportRow = { key: ref, ref, url: `https://github.com/${repo}/issues/${g.n}`, kind: g.kind, title: g.title, body: `原标题：${g.en}`, action: 'create', reason: g.kind === 'feature' ? '新的功能请求' : '新的问题' };
      if (same) return { ...row, action: same.id, reason: `看板上的 ${same.id} 就是从这个 issue 导入的` };
      if (g.n === 322) return { ...row, action: 'skip', reason: '文档里的小错字，不需要进看板' };
      if (g.n === 325) return { ...row, action: 'skip', reason: '和 #318 重复' };
      if (like) return { ...row, action: like.id, reason: `和 ${like.id}（${like.title}）是同一件事` };
      if (g.n === 320) return { ...row, reason: '和 F-2（订单接口限流）有关，单独记为问题' };
      return row;
    });
  }
  return input.split('\n').map((l) => l.replace(/^\s*([-*•]|\d+[.)、])\s*/, '').trim()).filter(Boolean).slice(0, 20).map((raw, i) => {
    // Jira lines start with the issue key.
    const key = source === 'jira' ? /^([A-Z][A-Z0-9]+-\d+)\s+(.*)$/.exec(raw) : null;
    const line = key ? key[2] : raw;
    const kind: BoardKind = /修复|bug|错误|失败|报错|异常|崩溃/i.test(line) ? 'issue' : /支持|增加|新增|实现|需要/.test(line) ? 'feature' : 'note';
    const dup = similar(line);
    return {
      key: `${source}-${i}`, ref: key ? key[1] : source === 'file' ? `文件第 ${i + 1} 行` : `粘贴第 ${i + 1} 行`, url: key ? `https://acme.atlassian.net/browse/${key[1]}` : undefined,
      kind, title: line.length > 40 ? `${line.slice(0, 40)}…` : line, body: line,
      action: dup ? dup.id : 'create', reason: dup ? `和 ${dup.id}（${dup.title}）相似` : kind === 'issue' ? '描述的是一个缺陷' : kind === 'feature' ? '描述的是要做的事' : '背景信息',
    };
  });
}

export function applyImport(wsId: string, rows: ImportRow[]): string[] {
  const created: string[] = [];
  for (const r of rows) {
    if (r.action === 'skip') continue;
    if (r.action === 'create') {
      created.push(createItem(wsId, { kind: r.kind, title: r.title, body: r.body }, { kind: 'import', ref: r.ref, url: r.url }, `从 ${r.ref} 导入`).id);
    } else {
      updateItem(wsId, r.action, {}, `合并了 ${r.ref}：${r.title}`);
    }
  }
  return created;
}

export function boardMarkdown(wsId: string): string {
  const ws = useApp.getState().workspaces.find((w) => w.id === wsId);
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
      if (it.tasks.length || it.decisions.length) lines.push('');
    }
  }
  return lines.join('\n');
}
