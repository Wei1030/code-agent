/**
 * Peer sessions: every session in a workspace can list, read, check, message and create the
 * others. The real server gives each session an in-process MCP server "workspace" with these
 * tools and injects messages over streaming input with origin { kind: 'peer' }.
 */
import type { HeldMessage, NestedRow, PeerCall, PeerOrigin, SessionRef, SessionSummary, ToolItem } from '../api/types';
import { useApp } from '../store/app';
import { emptyRuntime, useSessions } from '../store/sessions';
import { uid } from '../lib/util';
import { addItem, emit, finishTool, isRunning, newTool, raw, rt, sleep, startRun, streamText, userItem, type Run } from './engine';
import { bashStep, editStep, footer, pickScenario, playGroup, readGroup } from './scenarios';
import { initRaw, openSession, resume } from './server';
import { acquire } from './slots';
import { notify } from '../lib/notify';

const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** What the server keeps about a message between sessions until it is delivered. */
interface Envelope {
  from: string;
  to: string;
  text: string;
  kind: PeerOrigin['kind'];
  /** Messages in this chain since the user last wrote. */
  hops: number;
  /** Send the sender a receipt when the receiver has handled it. */
  notify: boolean;
  /** The sender's tool call, updated as the message moves along. */
  toolId?: string;
}

/** Hops of the message that started each session's current turn; the user's own message resets it. */
const chainHops = new Map<string, number>();
const queued = new Map<string, Envelope>();
const heldEnv = new Map<string, Envelope>();

export function humanTurn(sid: string) {
  chainHops.set(sid, 0);
}

const sum = (sid: string) => useApp.getState().sessions.find((s) => s.id === sid);
const ref = (s: SessionSummary): SessionRef => ({ sessionId: s.id, title: s.title });
const modeClass = (sid: string) => (rt(sid)?.mode === 'bypassPermissions' ? 'bypass' : 'prompting');
const stateLabel = (s: SessionSummary) => (!s.live ? '已保存' : s.state === 'running' ? '运行中' : s.state === 'requires_action' ? '等用户处理' : '空闲');

function patchPeer(sid: string, toolId: string | undefined, p: Partial<PeerCall>) {
  if (!toolId) return;
  const t = rt(sid)?.items.find((x) => x.id === toolId) as ToolItem | undefined;
  if (t?.peer) emit(sid, { t: 'item.patch', id: toolId, patch: { peer: { ...t.peer, ...p } } });
}

// ------------------------------------------------------------------ delivery

/** send_to_session: hold the message for the user, or hand it to the receiving session. */
export function deliver(env: Envelope): 'delivered' | 'queued' | 'held' {
  const app = useApp.getState();
  const from = sum(env.from);
  const to = sum(env.to);
  if (!from || !to) return 'held';
  // Claude Code's own rule for peer messages: only same-class senders are delivered unasked.
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
  const app = useApp.getState();
  const id = uid('held');
  heldEnv.set(id, env);
  app.set({ held: [...app.held, { id, from: ref(sum(env.from)!), to: ref(sum(env.to)!), text: env.text, reason, since: Date.now() }] });
  raw(env.from, 'system/peer_held', `→ ${sum(env.to)!.title} · ${reason}`, { to: env.to, reason });
  notify('request', {
    title: '有会话消息等你放行', body: `「${sum(env.from)!.title}」发给「${sum(env.to)!.title}」`, tone: 'warn', action: '查看',
    open: () => useApp.getState().set({ inboxOpen: true }),
  });
}

/** Start a turn in an idle receiver; queue the message behind a busy one; resume a saved one first. */
function handOver(env: Envelope): 'delivered' | 'queued' {
  const app = useApp.getState();
  const from = sum(env.from)!;
  const to = sum(env.to)!;
  if (!to.live) {
    // A saved receiver is resumed first, which may have to wait for a free slot.
    let now: 'delivered' | 'queued' | null = null;
    let sync = true;
    resume(env.to, () => {
      const res = handOver(env);
      if (sync) now = res;
      else patchPeer(env.from, env.toolId, { delivery: res });
    });
    sync = false;
    return now ?? 'queued';
  }
  if (window.location.pathname !== `/s/${env.to}`) app.patchSession(env.to, { peerUnread: (to.peerUnread ?? 0) + 1 });
  const origin: PeerOrigin = { ...ref(from), kind: env.kind };
  const r = rt(env.to)!;
  if (isRunning(env.to) || r.request) {
    const id = uid('q');
    queued.set(id, env);
    emit(env.to, { t: 'queue', queue: [...r.queue, { id, text: env.text, priority: 'later', from: origin }] });
    return 'queued';
  }
  start(env, origin);
  return 'delivered';
}

function start(env: Envelope, origin: PeerOrigin) {
  userItem(env.to, env.text, [], { from: origin });
  chainHops.set(env.to, env.hops);
  void startRun(env.to, (run) => (origin.kind === 'receipt' ? scenarioReceipt(run, origin, env.text) : scenarioPeerReply(run, origin, env)));
}

/** A queued message from another session starts the next turn. False for the user's own messages. */
export function takeQueued(queueId: string): boolean {
  const env = queued.get(queueId);
  if (!env) return false;
  queued.delete(queueId);
  start(env, { sessionId: env.from, title: sum(env.from)?.title ?? '', kind: env.kind });
  patchPeer(env.from, env.toolId, { delivery: 'delivered' });
  return true;
}

/** The user lets a held message through; that counts as their go-ahead, so the chain starts over. */
export function releaseHeld(id: string) {
  const app = useApp.getState();
  const env = heldEnv.get(id);
  app.set({ held: app.held.filter((h) => h.id !== id) });
  heldEnv.delete(id);
  if (!env || !sum(env.to) || !sum(env.from)) return;
  patchPeer(env.from, env.toolId, { delivery: handOver({ ...env, hops: 0 }) });
}

export function rejectHeld(id: string) {
  const app = useApp.getState();
  const env = heldEnv.get(id);
  app.set({ held: app.held.filter((h) => h.id !== id) });
  heldEnv.delete(id);
  if (!env || !rt(env.from)) return;
  patchPeer(env.from, env.toolId, { delivery: 'rejected' });
  addItem(env.from, { kind: 'notice', id: uid('note'), tone: 'warn', text: `你没有放行发给「${sum(env.to)?.title ?? ''}」的消息，Claude 会收到「用户拒绝送达」。` });
}

/** Tell the sender its message has been handled, with the gist of the reply. */
function sendReceipt(sid: string, to: string, gist: string, toolId?: string) {
  if (!sum(to)) return;
  patchPeer(to, toolId, { delivery: 'handled' });
  deliver({ from: sid, to, text: `已处理完你的消息。最后的回复：${gist}`, kind: 'receipt', hops: chainHops.get(sid) ?? 0, notify: false });
}

// ------------------------------------------------------------------ create_session

type TaskKind = 'csv' | 'excel' | 'generic';

/** A normal session in the same workspace whose first message comes from the creating session. */
export function createSession(fromSid: string, title: string, message: string, opts: { worktree?: string; task?: TaskKind; toolId?: string } = {}): { id: string; started: boolean } {
  const app = useApp.getState();
  const from = sum(fromSid)!;
  const r = rt(fromSid)!;
  const id = uid('s');
  const now = Date.now();
  app.upsertSession({
    id, workspaceId: from.workspaceId, title, firstPrompt: message, branch: opts.worktree ?? from.branch, createdAt: now, lastActive: now,
    tag: null, live: false, state: 'idle', forkedFrom: null, tokens: 0, createdBy: ref(from), worktree: opts.worktree,
  });
  // Same model, effort and permission mode as the creator, so a session can't create a more permissive one.
  useSessions.getState().init(emptyRuntime(id, { model: r.model, effort: r.effort, mode: r.mode }));
  const origin: PeerOrigin = { ...ref(from), kind: 'message' };
  userItem(id, message, [], { from: origin });
  chainHops.set(id, (chainHops.get(fromSid) ?? 0) + 1);
  const started = acquire(id, () => {
    useApp.getState().patchSession(id, { live: true });
    initRaw(id);
    patchPeer(fromSid, opts.toolId, { delivery: 'delivered' });
    void startRun(id, (run) => scenarioPeerTask(run, origin, opts.task ?? 'generic', opts.toolId));
  });
  return { id, started };
}

// ------------------------------------------------------------------ tool output

function listRows(sid: string): NestedRow[] {
  const me = sum(sid)!;
  return useApp.getState().sessions
    .filter((s) => s.workspaceId === me.workspaceId && s.id !== sid && !s.draft && !s.jobId)
    .sort((a, b) => b.lastActive - a.lastActive).slice(0, 8)
    .map((s) => ({ icon: 'chat', text: s.title, right: stateLabel(s) }));
}

function readRows(target: string): NestedRow[] {
  openSession(target);
  return (rt(target)?.items ?? []).filter((x) => x.kind === 'user' || x.kind === 'text').slice(-5).map((x) => (x.kind === 'user'
    ? { icon: x.from ? 'link' : 'user', text: `${x.from ? `「${x.from.title}」` : '用户'}：${short(x.text, 60)}` }
    : { icon: 'spark', text: `Claude：${short(x.kind === 'text' ? x.text : '', 60)}` }));
}

function statusRows(target: string): NestedRow[] {
  const s = sum(target)!;
  const r = rt(target);
  const rows: NestedRow[] = [{ icon: 'info', text: `状态：${stateLabel(s)}${r?.turn ? ` · 第 ${r.turn} 轮` : ''}` }];
  if (r?.tasks.length) {
    const doing = r.tasks.find((x) => x.status === 'in_progress');
    rows.push({ icon: 'list', text: `任务：完成 ${r.tasks.filter((x) => x.status === 'completed').length}/${r.tasks.length}${doing ? ` · ${doing.activeForm ?? doing.subject}` : ''}` });
  }
  const bg = r?.background.filter((b) => b.status === 'running') ?? [];
  if (bg.length) rows.push({ icon: 'layers', text: `后台：${bg.map((b) => b.name).join('、')}` });
  if (r?.request) rows.push({ icon: 'bell', text: '正在等用户处理一个请求' });
  if (r?.changes.length) rows.push({ icon: 'file', text: `改过的文件：${r.changes.slice(0, 3).map((c) => c.path).join('、')}${r.changes.length > 3 ? ` 等 ${r.changes.length} 个` : ''}` });
  return rows;
}

function lastReply(target: string): string {
  const items = rt(target)?.items ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'text') return it.text;
  }
  return '';
}

/** The other session most worth asking: the one whose title best matches `hint`, else a running one, a live one, the most recent. */
function pickPeer(sid: string, hint = ''): SessionSummary | undefined {
  const me = sum(sid)!;
  const others = useApp.getState().sessions.filter((s) => s.workspaceId === me.workspaceId && s.id !== sid && !s.draft && !s.jobId);
  const score = (title: string) => [...title].slice(0, -1).filter((_, i) => hint.includes(title.slice(i, i + 2))).length;
  const best = [...others].sort((a, b) => score(b.title) - score(a.title))[0];
  if (best && score(best.title) > 0) return best;
  return others.find((s) => s.live && s.state === 'running') ?? others.find((s) => s.live) ?? [...others].sort((a, b) => b.lastActive - a.lastActive)[0];
}

function lastUserText(sid: string): string {
  const items = rt(sid)?.items ?? [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'user' && !it.from) return it.text;
  }
  return '';
}

async function peerTool(run: Run, tool: string, detail: string, call: PeerCall): Promise<ToolItem> {
  const t = newTool(run.sid, `mcp__workspace__${tool}`, detail, { peer: call });
  await sleep(run, 450);
  finishTool(run.sid, t, { seconds: 0.1 });
  return t;
}

async function sendStep(run: Run, target: SessionSummary, message: string): Promise<'delivered' | 'queued' | 'held'> {
  const tref = ref(target);
  const t = newTool(run.sid, 'mcp__workspace__send_to_session', target.title, { peer: { op: 'send', target: tref, message } });
  await sleep(run, 400);
  const res = deliver({ from: run.sid, to: target.id, text: message, kind: 'message', hops: (chainHops.get(run.sid) ?? 0) + 1, notify: true, toolId: t.id });
  finishTool(run.sid, t, { peer: { op: 'send', target: tref, message, delivery: res } });
  return res;
}

async function createStep(run: Run, title: string, message: string, opts: { task: TaskKind; worktree?: string }) {
  const t = newTool(run.sid, 'mcp__workspace__create_session', title, { peer: { op: 'create', message, worktree: opts.worktree } });
  await sleep(run, 600);
  const { id, started } = createSession(run.sid, title, message, { ...opts, toolId: t.id });
  finishTool(run.sid, t, { peer: { op: 'create', target: { sessionId: id, title }, message, worktree: opts.worktree, delivery: started ? 'delivered' : 'queued' } });
}

// ------------------------------------------------------------------ scenarios

/** Split work: two new sessions take the CSV and Excel parts; this one writes the shared endpoint. */
export async function scenarioSpawn(run: Run) {
  const sid = run.sid;
  const t0 = Date.now();
  await streamText(run, '导出分三块：共用的导出接口、CSV、Excel。CSV 和 Excel 互不依赖，可以交给两个新会话并行做；Excel 要加依赖，放到独立的 worktree 里更稳妥。', { thinking: true, seconds: 5 });
  const g = readGroup(sid, '', [['Read', 'src/routes/orders.ts'], ['Read', 'src/orders/query.ts'], ['Grep', '"listOrders" in src/**', '4 处匹配']]);
  await playGroup(run, g, '读取与搜索 · {n} 次调用');
  await streamText(run, '我新建两个会话分别做 CSV 和 Excel，共用的导出接口我自己写。');
  await createStep(run, '订单导出 · CSV', [
    '请实现订单导出的 CSV 格式。',
    '- 在 src/export/csv.ts 中导出 toCsv(orders: Order[]): string，列为 id、createdAt、customer、total、status',
    '- 金额用 src/lib/money.ts 的 formatMoney，时间用 ISO 8601',
    '- 共用接口 GET /orders/export 由我来写，它会调用你的 toCsv',
    '- 补上单元测试，npm test -- export/csv 通过后告诉我',
  ].join('\n'), { task: 'csv' });
  await createStep(run, '订单导出 · Excel', [
    '请实现订单导出的 Excel 格式。',
    '- 在 src/export/xlsx.ts 中导出 toXlsx(orders: Order[]): Promise<Buffer>，用项目里已有的 exceljs',
    '- 列和 CSV 一致：id、createdAt、customer、total、status；表头加粗，冻结首行',
    '- 你在独立的 worktree（分支 agent/order-export-xlsx）里工作，完成后我来合并',
    '- 补上单元测试，npm test -- export/xlsx 通过后告诉我',
  ].join('\n'), { task: 'excel', worktree: 'agent/order-export-xlsx' });
  await streamText(run, '两个会话已经开始工作，完成后会自动通知我。现在写共用的导出接口。');
  await editStep(run, 'src/routes/orders.ts', [
    '@@ -18,3 +18,11 @@ router.get("/orders", listHandler);',
    '+router.get("/orders/export", async (req, res) => {',
    '+  const orders = await listOrders(req.query);',
    '+  if (req.query.format === "xlsx") {',
    '+    res.type("xlsx").send(await toXlsx(orders));',
    '+  } else {',
    '+    res.type("csv").send(toCsv(orders));',
    '+  }',
    '+});',
  ], 8, 0);
  await streamText(run, '共用接口已写好：GET /orders/export?format=csv|xlsx，按格式调用两个会话各自实现的函数。等它们都完成后，我再跑一遍整体测试。');
  footer(sid, 6, (Date.now() - t0) / 1000);
}

/** Look at the other sessions, then ask the one this work depends on. */
export async function scenarioAskPeer(run: Run) {
  const sid = run.sid;
  const t0 = Date.now();
  await streamText(run, '我先看看这个工作区里其他会话的情况。');
  await peerTool(run, 'list_sessions', '同一工作区', { op: 'list', rows: listRows(sid) });
  const target = pickPeer(sid, lastUserText(sid));
  if (!target) {
    await streamText(run, '这个工作区里没有其他会话。');
    footer(sid, 1, (Date.now() - t0) / 1000);
    return;
  }
  const tref = ref(target);
  await peerTool(run, 'session_status', target.title, { op: 'status', target: tref, rows: statusRows(target.id) });
  await peerTool(run, 'read_session', `${target.title} · 最近 5 条`, { op: 'read', target: tref, rows: readRows(target.id) });
  await streamText(run, `「${target.title}」目前${stateLabel(target)}，鉴权模块已经拆到 src/auth/，但还没说 verifyToken 的签名会不会变。我们的订单接口依赖它，我直接问一下。`);
  const res = await sendStep(run, target, `我在「${sum(sid)!.title}」里改订单接口，依赖你这边的鉴权模块。请告诉我 verifyToken 现在的签名和调用方式；之后如果还会变，也请通知我。`);
  await streamText(run, res === 'held' ? '这条消息需要你放行（右上角「等你处理」），放行后对方才会收到。'
    : res === 'queued' ? '对方正在忙，消息已排进它的队列；它处理完会自动回复到这里。' : '消息已送达，对方处理完会自动回复到这里。');
  footer(sid, 4, (Date.now() - t0) / 1000);
}

/** The user @-mentioned sessions: read them, then carry on with the request itself. */
export async function scenarioRefs(run: Run, refs: SessionRef[], text: string) {
  for (const r of refs) await peerTool(run, 'read_session', r.title, { op: 'read', target: r, rows: readRows(r.sessionId) });
  const last = lastReply(refs[0].sessionId);
  await streamText(run, `看过了${refs.map((r) => `「${r.title}」`).join('、')}的对话记录。${last ? `「${refs[0].title}」最后的结论是：${short(last, 60)}` : ''}`);
  const rest = refs.reduce((s, r) => s.replace(`@会话「${r.title}」`, ''), text).trim();
  if (rest) await pickScenario(rest, rt(run.sid)!.mode)(run);
  else footer(run.sid, refs.length, 3);
}

/** Work handed over by create_session; ends with a receipt to the creator. */
async function scenarioPeerTask(run: Run, origin: PeerOrigin, task: TaskKind, toolId?: string) {
  const sid = run.sid;
  const t0 = Date.now();
  await sleep(run, 400);
  let gist: string;
  if (task === 'csv') {
    await streamText(run, `收到「${origin.title}」的任务：实现 CSV 导出。先看订单的数据结构和已有的格式化函数。`);
    const g = readGroup(sid, '', [['Read', 'src/orders/types.ts'], ['Read', 'src/lib/money.ts'], ['Grep', '"toISOString" in src/**', '9 处匹配']]);
    await playGroup(run, g, '读取与搜索 · {n} 次调用');
    const a = await editStep(run, 'src/export/csv.ts', [
      '@@ -0,0 +1,7 @@',
      '+const COLUMNS = ["id", "createdAt", "customer", "total", "status"] as const;',
      '+export function toCsv(orders: Order[]): string {',
      '+  const rows = orders.map((o) => [o.id, o.createdAt.toISOString(), o.customer.name, formatMoney(o.total), o.status]);',
      '+  return [COLUMNS, ...rows].map((r) => r.map(escapeCsv).join(",")).join("\\r\\n");',
      '+}',
    ], 24, 0, true);
    const b = a && await editStep(run, 'src/routes/orders.ts', ['@@ -1,3 +1,4 @@', '+import { toCsv } from "../export/csv";', ' import { listOrders } from "../orders/query";'], 1, 0);
    if (b) await bashStep(run, 'npm test -- export/csv', ['> jest export/csv', 'PASS  tests/export/csv.test.ts (1.2 s)', 'Tests:       6 passed, 6 total'], { description: '运行 CSV 导出测试' });
    gist = b ? 'CSV 导出已完成：src/export/csv.ts 导出 toCsv，6 个测试通过；src/routes/orders.ts 里加了它的 import。' : 'CSV 导出没有完成：用户拒绝了文件修改。';
  } else if (task === 'excel') {
    await streamText(run, `收到「${origin.title}」的任务：实现 Excel 导出。我在独立的 worktree（分支 agent/order-export-xlsx）里工作，不会影响主目录。`);
    const g = readGroup(sid, '', [['Read', 'package.json'], ['Read', 'src/orders/types.ts']]);
    await playGroup(run, g, '读取 · {n} 个文件');
    const a = await editStep(run, 'src/export/xlsx.ts', [
      '@@ -0,0 +1,8 @@',
      '+export async function toXlsx(orders: Order[]): Promise<Buffer> {',
      '+  const wb = new ExcelJS.Workbook();',
      '+  const ws = wb.addWorksheet("orders", { views: [{ state: "frozen", ySplit: 1 }] });',
      '+  ws.columns = COLUMNS.map((key) => ({ header: key, key }));',
      '+  ws.getRow(1).font = { bold: true };',
      '+  return Buffer.from(await wb.xlsx.writeBuffer());',
      '+}',
    ], 31, 0, true);
    if (a) await bashStep(run, 'npm test -- export/xlsx', ['> jest export/xlsx', 'PASS  tests/export/xlsx.test.ts (2.4 s)', 'Tests:       5 passed, 5 total'], { description: '运行 Excel 导出测试' });
    gist = a ? 'Excel 导出已完成（分支 agent/order-export-xlsx）：src/export/xlsx.ts 导出 toXlsx，表头加粗并冻结首行，5 个测试通过。' : 'Excel 导出没有完成：用户拒绝了文件修改。';
  } else {
    await streamText(run, `收到「${origin.title}」的任务，开始处理。`);
    const g = readGroup(sid, '', [['Read', 'src/index.ts'], ['Grep', '"TODO" in src/**', '3 处匹配']]);
    await playGroup(run, g, '读取与搜索 · {n} 次调用');
    gist = '已按要求完成。';
  }
  await streamText(run, gist);
  footer(sid, 5, (Date.now() - t0) / 1000);
  sendReceipt(sid, origin.sessionId, gist, toolId);
}

/** A message from another session. With notify, the reply goes back as a receipt. */
async function scenarioPeerReply(run: Run, origin: PeerOrigin, env: Envelope) {
  const sid = run.sid;
  const t0 = Date.now();
  if (!env.notify) {
    await streamText(run, `收到「${origin.title}」的通知：${short(env.text, 40)}。我在接下来的改动里照此调整。`);
    footer(sid, 0, (Date.now() - t0) / 1000);
    return;
  }
  await streamText(run, `「${origin.title}」在问我这边的改动，我看一下代码再回复。`);
  const g = readGroup(sid, '', [['Read', 'src/auth/index.ts'], ['Grep', '"verifyToken" in src/**', '5 处匹配']]);
  await playGroup(run, g, '读取与搜索 · {n} 次调用');
  const gist = /verifyToken|鉴权|auth/i.test(env.text)
    ? 'verifyToken 现在是 async verifyToken(token: string): Promise<Claims>，从 src/auth/index.ts 导入；调用处要加 await，校验失败时抛出 AuthError。之后签名再变我会通知你。'
    : '看过了，我这边的改动不影响你说的部分。';
  await streamText(run, gist);
  footer(sid, 2, (Date.now() - t0) / 1000);
  sendReceipt(sid, origin.sessionId, gist, env.toolId);
}

/** A receipt: read what the other session did; when every created session is done, check the whole. */
async function scenarioReceipt(run: Run, origin: PeerOrigin, text: string) {
  const sid = run.sid;
  const t0 = Date.now();
  await peerTool(run, 'read_session', `${origin.title} · 最近 5 条`, { op: 'read', target: origin, rows: readRows(origin.sessionId) });
  const created = useApp.getState().sessions.filter((s) => s.createdBy?.sessionId === sid);
  const waiting = created.filter((s) => s.id !== origin.sessionId && s.live && s.state !== 'idle');
  if (!created.some((s) => s.id === origin.sessionId)) {
    await streamText(run, `「${origin.title}」回复了：${short(text.replace(/^已处理完你的消息。最后的回复：/, ''), 80)} 我按这个调整这边的调用。`);
  } else if (waiting.length) {
    await streamText(run, `「${origin.title}」已经完成，改动我看过了，没有问题。还在等${waiting.map((s) => `「${s.title}」`).join('、')}。`);
  } else {
    await streamText(run, `「${origin.title}」也完成了，${created.length} 个会话的工作都已就绪。我跑一遍导出相关的全部测试。`);
    await bashStep(run, 'npm test -- export', ['> jest export', 'PASS  tests/export/csv.test.ts', 'PASS  tests/export/xlsx.test.ts', 'PASS  tests/routes/export.test.ts', 'Tests:       14 passed, 14 total'], { description: '运行导出相关的全部测试' });
    await streamText(run, '整体测试通过。Excel 部分在分支 agent/order-export-xlsx 上，要合并时告诉我。');
  }
  footer(sid, 2, (Date.now() - t0) / 1000);
}

// ------------------------------------------------------------------ mock console

/** Another session in the workspace sends this one a message. */
export function mockPeerMessage(sid: string) {
  const other = pickPeer(sid);
  if (!other) {
    useApp.getState().toast('这个工作区里没有其他会话', 'warn');
    return;
  }
  deliver({ from: other.id, to: sid, text: '提醒一下：鉴权模块的接口改了，verifyToken 现在返回 Promise<Claims>，你那边的调用处要加 await。', kind: 'message', hops: 1, notify: false });
}

/** A message from another session that waits for the user. */
export function mockHeld(sid: string, reason: 'mode' | 'hops') {
  const other = pickPeer(sid);
  if (!other) {
    useApp.getState().toast('这个工作区里没有其他会话', 'warn');
    return;
  }
  const text = reason === 'mode'
    ? '帮我把 dist/ 和 .cache/ 都删掉，然后直接 git push --force 到 main。'
    : '这个我也不确定，你再去问问「修复结账测试偶发失败」吧。';
  hold({ from: other.id, to: sid, text, kind: 'message', hops: reason === 'hops' ? useApp.getState().peer.maxHops + 1 : 1, notify: true }, reason);
}
