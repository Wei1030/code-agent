/**
 * Code review. Nothing starts until the user clicks 提交审核; then Code Agent loops on its own until
 * the reviewer passes the change, the round limit is reached, or the user stops it. Each round:
 * snapshot the working tree into a hidden ref, run the workspace's check commands (Code Agent runs
 * them, not Claude), then have the author session run the read-only code-reviewer subagent with the
 * round's prompt (a PreToolUse hook pins the prompt; the verdict comes back through submit_review).
 * Rounds 1–3 look at the whole change, later rounds only at what changed since the previous round.
 */
import type { NestedRow, ReviewCheck, ReviewFinding, ReviewRound, ReviewTicket } from '../api/types';
import { useApp } from '../store/app';
import { uid } from '../lib/util';
import { notify } from '../lib/notify';
import {
  addItem, Cancelled, cancelRun, emit, finishTool, isRunning, lastUserId, newTool, patch, rt, sleep, startRun, streamText, userItem, type Run,
} from './engine';
import { editStep, footer } from './scenarios';

const GLOBAL_ROUNDS = 3;
const MAX_CHECK_ATTEMPTS = 3;

type ScriptName = 'pass' | 'stuck';

interface Edit { path: string; diff: string[]; add: number; del: number; created?: boolean }

/** What the mock reviewer and author do in one round. Finding ids are given out in order: F1, F2… */
interface RoundScript {
  /** Outcome of each check attempt; a failure goes back to the author, who applies `checkFix`. */
  checks?: Array<'ok' | 'fail'>;
  checkFail?: string[];
  checkFix?: { text: string; edit: Edit };
  rows: Array<[icon: string, text: string, right?: string]>;
  summary: string;
  updates?: Array<{ id: string; status: 'verified' | 'upheld' | 'open'; note: string }>;
  raise?: Array<Pick<ReviewFinding, 'severity' | 'file' | 'line' | 'title' | 'detail'>>;
  pass: boolean;
  /** The author's answer to a rejection. */
  fix?: { intro: string; edits: Edit[]; responses: Array<{ id: string; status: 'fixed' | 'disputed'; text: string }> };
}

const SESSION_F1: Edit = {
  path: 'src/checkout/session.ts', add: 3, del: 1,
  diff: ['@@ -38,6 +38,8 @@ export async function resumeSession(id: string) {', '   const s = await load(id);', '-  startTimer(s.cart);', '+  s.previousCart?.dispose();', '+  startTimer(s.cart);'],
};
const TEST_F2: Edit = {
  path: 'tests/checkout/timer.test.ts', add: 18, del: 0,
  diff: ['@@ -60,0 +61,18 @@', '+it("clears the timer when the cart is disposed", () => {', '+  const cart = makeCart();', '+  startTimer(cart);', '+  cart.dispose();', '+  expect(clock.pending()).toBe(0);', '+});', '+it("does not start a second timer on resume", async () => { /* … */ });'],
};
const SESSION_F4: Edit = {
  path: 'src/checkout/session.ts', add: 2, del: 1,
  diff: ['@@ -50,4 +50,5 @@', '-  s.previousCart?.dispose();', '+  if (s.previousCart && !s.previousCart.expired) s.previousCart.dispose();', '+  if (s.cart.expired) return gone();'],
};

const ROUND1: RoundScript = {
  rows: [['terminal', 'git diff {base}..r1 --stat', '{files} 个文件'], ['file', 'Read src/cart/timer.ts'], ['search', 'Grep "startTimer(" in src/**', '4 处匹配'],
    ['file', 'Read src/checkout/session.ts'], ['file', 'Read tests/checkout/timer.test.ts']],
  summary: '计时器随购物车释放的思路是对的，但有一个调用方没跟上，测试也缺了关键用例。',
  raise: [
    { severity: 'major', file: 'src/checkout/session.ts', line: 41, title: '恢复会话时会再次调用 startTimer，旧计时器没有先清理', detail: '这次修改让计时器随购物车释放，但 resumeSession 没有释放旧购物车就重新 startTimer。同一个购物车会挂两个计时器，过期回调执行两次。' },
    { severity: 'major', file: 'tests/checkout/timer.test.ts', title: '没有测试覆盖「购物车释放后计时器被清理」', detail: '这是这次修复的核心行为，没有回归测试，之后容易再坏。' },
    { severity: 'minor', file: 'src/cart/timer.ts', line: 44, title: '购物车释放后再注册 onDispose 会静默失败', detail: '建议这种情况下记一条警告日志。' },
  ],
  pass: false,
  fix: {
    intro: '逐条处理：F1、F2 我来改；F3 我有不同意见。',
    edits: [SESSION_F1, TEST_F2],
    responses: [
      { id: 'F1', status: 'fixed', text: 'resumeSession 先释放旧购物车，再启动新计时器' },
      { id: 'F2', status: 'fixed', text: '新增 2 个用例：释放后计时器被清理；恢复会话不会重复计时' },
      { id: 'F3', status: 'disputed', text: 'dispose 之后不会再调用 startTimer，这个分支走不到；加日志只会制造噪音' },
    ],
  },
};

const ROUND2: RoundScript = {
  rows: [['terminal', 'git diff {base}..r2 --stat', '{files} 个文件'], ['file', 'Read src/checkout/session.ts'], ['file', 'Read tests/checkout/timer.test.ts'],
    ['search', 'Grep "dispose(" in src/**', '6 处匹配']],
  summary: 'F1、F2 已修好，F3 的异议成立。但 F1 的修法在购物车已过期时会出问题。',
  updates: [
    { id: 'F1', status: 'verified', note: '已确认：resumeSession 先释放旧购物车' },
    { id: 'F2', status: 'verified', note: '已确认：两个新用例覆盖了释放和恢复' },
    { id: 'F3', status: 'upheld', note: '异议成立：dispose 之后确实不会再调用 startTimer' },
  ],
  raise: [
    { severity: 'major', file: 'src/checkout/session.ts', line: 52, title: '购物车已过期时，恢复会话会抛异常，原来是返回 410', detail: '新加的释放逻辑会对已过期的购物车再调用一次 dispose，抛出 AlreadyDisposedError，GET /checkout/:id 从 410 变成了 500。' },
  ],
  pass: false,
  fix: {
    intro: 'F4 是我上一轮改出来的问题，修掉。',
    edits: [SESSION_F4],
    responses: [{ id: 'F4', status: 'fixed', text: '已过期的购物车不再重复释放，恢复时直接返回 410' }],
  },
};

const SCRIPTS: Record<ScriptName, RoundScript[]> = {
  pass: [ROUND1, ROUND2, {
    checks: ['fail', 'ok'],
    checkFail: ['> jest', 'FAIL tests/checkout/resume.test.ts', '  ✕ returns 410 for an expired cart (12 ms)', '    Expected: 410', '    Received: 200', 'Tests:       1 failed, 43 passed, 44 total'],
    checkFix: { text: '过期判断写反了，改过来。', edit: { path: 'src/checkout/session.ts', add: 1, del: 1, diff: ['@@ -51,1 +51,1 @@', '-  if (s.cart.expired) return gone();', '+  if (!s.cart.isActive()) return gone();'] } },
    rows: [['terminal', 'git diff {base}..r3 --stat', '{files} 个文件'], ['file', 'Read src/checkout/session.ts'], ['file', 'Read tests/checkout/resume.test.ts']],
    summary: '没有阻断或重要问题，可以合入。',
    updates: [{ id: 'F4', status: 'verified', note: '已确认：过期的购物车返回 410，不再重复释放' }],
    raise: [{ severity: 'minor', file: 'src/checkout/session.ts', line: 50, title: '日志里 “expird” 拼错了', detail: '不影响行为。' }],
    pass: true,
  }],
  stuck: [ROUND1, ROUND2, {
    rows: [['terminal', 'git diff {base}..r3 --stat', '{files} 个文件'], ['file', 'Read src/checkout/session.ts'], ['search', 'Grep "resumeSession(" in src/**', '3 处匹配']],
    summary: 'F4 已修好，但恢复会话还有并发问题。',
    updates: [{ id: 'F4', status: 'verified', note: '已确认：过期的购物车返回 410' }],
    raise: [{ severity: 'major', file: 'src/checkout/session.ts', line: 38, title: '同一个会话被并发恢复两次时，仍会挂两个计时器', detail: '两个请求同时进入 resumeSession，都看到旧购物车还没释放，于是各自 startTimer。' }],
    pass: false,
    fix: {
      intro: 'F5 的问题存在，加一把会话级的锁。',
      edits: [{ path: 'src/checkout/session.ts', add: 6, del: 2, diff: ['@@ -36,3 +36,7 @@', '+const locks = new Map<string, Promise<void>>();', '+export async function resumeSession(id: string) {', '+  await locks.get(id);', '+  const done = withLock(locks, id);'] }],
      responses: [{ id: 'F5', status: 'fixed', text: '按会话 id 加锁，同一会话的恢复串行执行' }],
    },
  }, {
    rows: [['terminal', 'git diff r3..r4', '{files} 个文件'], ['file', 'Read src/checkout/session.ts'], ['search', 'Grep "checkout.instances" in config/**', '1 处匹配']],
    summary: '锁只在单个进程里有效，F5 没有真正解决。',
    updates: [{ id: 'F5', status: 'open', note: '锁只在单个进程内有效；多实例部署时，两个实例仍会同时恢复同一个会话' }],
    pass: false,
    fix: {
      intro: '这一点我有不同意见。',
      edits: [],
      responses: [{ id: 'F5', status: 'disputed', text: '多实例之间由网关按会话 id 做粘性路由，同一个会话只会到一个实例' }],
    },
  }, {
    rows: [['terminal', 'git diff r4..r5', '没有代码修改'], ['file', 'Read config/gateway.yaml'], ['search', 'Grep "sticky" in config/**', '1 处匹配']],
    summary: '异议不成立，F5 仍未解决。',
    updates: [{ id: 'F5', status: 'open', note: '异议不成立：config/gateway.yaml 里粘性路由默认是关闭的' }],
    pass: false,
    fix: {
      intro: '按第 5 轮的意见，改用 Redis 锁，跨实例也能串行。',
      edits: [{ path: 'src/checkout/session.ts', add: 8, del: 6, diff: ['@@ -36,7 +36,9 @@', '-const locks = new Map<string, Promise<void>>();', '+const lock = redisLock({ ttlMs: 5000 });', '+export async function resumeSession(id: string) {', '+  return lock.run(`resume:${id}`, async () => {'] }],
      responses: [{ id: 'F5', status: 'fixed', text: '改用 Redis 锁，多个实例之间也串行' }],
    },
  }, {
    rows: [['terminal', 'git diff r5..r6', '{files} 个文件'], ['file', 'Read src/checkout/session.ts'], ['file', 'Read src/lib/redis-lock.ts']],
    summary: 'F5 已解决，可以合入。',
    updates: [{ id: 'F5', status: 'verified', note: '已确认：Redis 锁让多个实例之间的恢复串行执行' }],
    pass: true,
  }],
};

const GENERIC: RoundScript = { rows: [['terminal', 'git diff --stat', '{files} 个文件']], summary: '没有发现问题。', pass: true };

const scripts = new Map<string, ScriptName>();
/** Index into the session's file changes where each round's snapshot was taken (index 0 = base). */
const snaps = new Map<string, number[]>();
const stopping = new Set<string>();

// ------------------------------------------------------------------ ticket state

const get = (id: string) => useApp.getState().reviews.find((t) => t.id === id)!;
const sumOf = (sid: string) => useApp.getState().sessions.find((s) => s.id === sid);

function update(id: string, fn: (t: ReviewTicket) => ReviewTicket) {
  const app = useApp.getState();
  app.set({ reviews: app.reviews.map((t) => (t.id === id ? fn(t) : t)) });
}
function setRound(id: string, n: number, fn: (r: ReviewRound) => ReviewRound) {
  update(id, (t) => ({ ...t, rounds: t.rounds.map((r) => (r.n === n ? fn(r) : r)) }));
}
function setFinding(id: string, fid: string, p: Partial<ReviewFinding>) {
  update(id, (t) => ({ ...t, findings: t.findings.map((f) => (f.id === fid ? { ...f, ...p } : f)) }));
}

export function activeTicket(sid: string): ReviewTicket | undefined {
  return useApp.getState().reviews.find((t) => t.sessionId === sid && ['checking', 'reviewing', 'fixing', 'needs_decision', 'checks_failed'].includes(t.status));
}

/** Files, insertions and deletions in the session's changes between two indexes. */
function diffOf(sid: string, from: number, to?: number) {
  const list = (rt(sid)?.changes ?? []).slice(from, to);
  return { files: new Set(list.map((c) => c.path)).size, add: list.reduce((a, c) => a + c.add, 0), del: list.reduce((a, c) => a + c.del, 0) };
}

const scriptFor = (id: string, n: number) => SCRIPTS[scripts.get(id) ?? 'pass'][n - 1] ?? GENERIC;

// ------------------------------------------------------------------ the loop

/** Start a review of the session's unreviewed changes. Empty `checks` skips the checks. */
export function startReview(sid: string, checks: string[], script: ScriptName = 'pass'): string | null {
  const app = useApp.getState();
  const sum = sumOf(sid);
  if (!sum || isRunning(sid) || activeTicket(sid)) return null;
  app.set({ reviewChecks: { ...app.reviewChecks, [sum.workspaceId]: checks } });
  const id = uid('rv');
  const base = Math.random().toString(16).slice(2, 9);
  // The reviewer runs with the 评审 profile as it is now.
  const { model, effort } = app.reviewProfile;
  app.set({ reviews: [{ id, sessionId: sid, status: 'checking', base, maxRounds: 5, rounds: [], findings: [], checks, model, effort, startedAt: Date.now(), tokens: 0 }, ...app.reviews] });
  scripts.set(id, script);
  snaps.set(id, [app.reviewed[sid] ?? 0]);
  void startRun(sid, (run) => loop(run, id, 1, false));
  return id;
}

async function loop(run: Run, id: string, from: number, fixFirst: boolean) {
  const sid = run.sid;
  try {
    if (fixFirst) {
      userItem(sid, `你追加了审核轮数（最多 ${get(id).maxRounds} 轮）。请按第 ${from - 1} 轮的意见修改；不同意的写明理由，然后结束这一轮。`, [], { fromApp: '代码审核 · 追加轮次' });
      await fixPhase(run, id, from - 1);
    }
    for (let n = from; n <= get(id).maxRounds; n++) {
      const at = rt(sid)!.changes.length;
      const base = snaps.get(id)![0];
      const prev = snaps.get(id)![n - 1] ?? base;
      snaps.set(id, [...snaps.get(id)!.slice(0, n), at]);
      const scope = n <= GLOBAL_ROUNDS ? 'global' : 'incremental';
      const t = get(id);
      update(id, (x) => ({ ...x, status: 'checking', rounds: [...x.rounds, {
        n, scope, snapshot: `refs/code-agent/review/${id.slice(-6)}/r${n}`, range: scope === 'global' ? `${t.base}..r${n}` : `r${n - 1}..r${n}`,
        diff: scope === 'global' ? diffOf(sid, base, at) : diffOf(sid, prev, at), checks: [], raised: [], rulings: [], answers: [], authorFiles: [], startedAt: Date.now(),
      }] }));
      const skip = get(id).checks.length === 0;
      addItem(sid, { kind: 'divider', id: uid('div'), label: `代码审核 · 第 ${n} 轮 · ${scope === 'global' ? '全局审核' : `增量审核（只看第 ${n - 1} 轮之后的修改）`}${skip ? ' · 跳过验证' : ''}` });
      if (!skip && !(await checkPhase(run, id, n))) return;
      if (await reviewPhase(run, id, n)) return;
      if (n < get(id).maxRounds) {
        await fixPhase(run, id, n);
      } else {
        await streamText(run, `这是最后一轮，还有 ${get(id).findings.filter((f) => f.status === 'open').length} 条意见没解决。我先不改，等你决定。`);
        footer(sid, 1, 3);
      }
    }
    update(id, (x) => ({ ...x, status: 'needs_decision' }));
    notify('request', { sid, title: `「${sumOf(sid)?.title ?? ''}」的代码审核需要你决定`, body: `${get(id).maxRounds} 轮后仍未通过`, tone: 'warn', action: '去处理' });
  } catch (e) {
    if (e instanceof Cancelled) {
      const by = stopping.has(id) ? '你停止了审核' : '你中断了这一轮，审核随之停止';
      stopping.delete(id);
      update(id, (x) => ({ ...x, status: 'stopped', endedAt: Date.now(), note: by }));
      addItem(sid, { kind: 'notice', id: uid('note'), tone: 'warn', text: `代码审核已停止：${by}。审核记录保留在右侧「审核」里。`, action: '查看审核记录' });
    }
    throw e;
  }
}

function checkOutput(cmd: string, ok: boolean, n: number, fail?: string[]): string[] {
  if (!ok) return fail ?? [`> ${cmd}`, 'exit 1'];
  if (/test/.test(cmd)) return ['> jest', `Tests:       ${40 + n} passed, ${40 + n} total`];
  if (/typecheck|tsc/.test(cmd)) return ['> tsc --noEmit'];
  return [`> ${cmd}`, 'exit 0'];
}

/** Code Agent runs the checks; a failure goes back to the author, who fixes it, then they run again. */
async function checkPhase(run: Run, id: string, n: number): Promise<boolean> {
  const sid = run.sid;
  const s = scriptFor(id, n);
  const cmds = get(id).checks;
  addItem(sid, { kind: 'review', id: uid('rv'), ticketId: id, round: n, what: 'check' });
  for (let attempt = 1; attempt <= MAX_CHECK_ATTEMPTS; attempt++) {
    const fails = (s.checks?.[attempt - 1] ?? 'ok') === 'fail';
    // The failing command is the last test command, else the last command.
    const testAt = cmds.findLastIndex((c) => /test/.test(c));
    const failAt = fails ? (testAt >= 0 ? testAt : cmds.length - 1) : -1;
    const check: ReviewCheck = { attempt, ok: null, commands: cmds.map((cmd) => ({ cmd, ok: null, output: [], seconds: 0 })) };
    setRound(id, n, (r) => ({ ...r, checks: [...r.checks, check] }));
    let ok = true;
    for (let i = 0; i < cmds.length; i++) {
      await sleep(run, 700);
      const good = i !== failAt;
      const seconds = /test/.test(cmds[i]) ? 6.8 : 2.1;
      setRound(id, n, (r) => ({ ...r, checks: r.checks.map((c) => (c.attempt !== attempt ? c : { ...c, commands: c.commands.map((x, j) => (j === i ? { ...x, ok: good, output: checkOutput(x.cmd, good, n, s.checkFail), seconds } : x)) })) }));
      if (!good) { ok = false; break; }
    }
    setRound(id, n, (r) => ({ ...r, checks: r.checks.map((c) => (c.attempt === attempt ? { ...c, ok } : c)) }));
    if (ok) return true;
    if (attempt === MAX_CHECK_ATTEMPTS) {
      update(id, (x) => ({ ...x, status: 'checks_failed' }));
      notify('request', { sid, title: `「${sumOf(sid)?.title ?? ''}」的代码审核需要你决定`, body: `验证连续 ${MAX_CHECK_ATTEMPTS} 次没有通过`, tone: 'warn' });
      return false;
    }
    const failed = cmds[failAt] ?? cmds[cmds.length - 1];
    userItem(sid, `验证没有通过（第 ${attempt} 次）：${failed} 失败。\n${(s.checkFail ?? []).slice(1, 5).join('\n')}\n请修复后结束这一轮，Code Agent 会重新验证。`, [], { fromApp: `代码审核 · 第 ${n} 轮 · 验证` });
    const t0 = Date.now();
    const before = rt(sid)!.changes.length;
    if (s.checkFix) {
      await streamText(run, s.checkFix.text);
      await editStep(run, s.checkFix.edit.path, s.checkFix.edit.diff, s.checkFix.edit.add, s.checkFix.edit.del);
    }
    recordFiles(id, n, sid, before, 'check');
    footer(sid, 1, (Date.now() - t0) / 1000);
  }
  return false;
}

/** The author runs the code-reviewer subagent; the verdict arrives through submit_review. True when it passes. */
async function reviewPhase(run: Run, id: string, n: number): Promise<boolean> {
  const sid = run.sid;
  const s = scriptFor(id, n);
  const t = get(id);
  const round = t.rounds[n - 1];
  const sum = sumOf(sid);
  const last = n === t.maxRounds;
  update(id, (x) => ({ ...x, status: 'reviewing' }));
  const goal = (sum?.firstPrompt ?? '').slice(0, 40);
  userItem(sid, [
    `请用 code-reviewer 子代理做第 ${n} 轮${round.scope === 'global' ? '全局' : '增量'}审核。范围：${round.range}，${round.diff.files} 个文件 +${round.diff.add} −${round.diff.del}。改动目标：${goal}`,
    n > 1 ? '之前各轮的意见和你的答复，Code Agent 会附在给审核子代理的提示里。' : '',
    last ? '这是最后一轮：如果被打回，先不要修改，等用户决定。' : '拿到结论后：通过就结束；打回就逐条修改，不同意的写明理由，然后结束这一轮。',
  ].filter(Boolean).join('\n'), [], { fromApp: `代码审核 · 第 ${n} 轮` });
  const t0 = Date.now();
  await streamText(run, '好的，我请审核子代理来看。');
  const task = `第 ${n} 轮${round.scope === 'global' ? '全局' : '增量'}审核`;
  const model = t.model;
  const ag = newTool(sid, 'Agent', `code-reviewer · ${task}`, {
    right: model, provenance: '评审方案 · 只读 · 提示词由 Code Agent 固定',
    agent: { agentType: 'code-reviewer', task, model, summary: '正在读取改动…', rows: [], tokens: 0, toolCalls: 0 },
  });
  const rows: NestedRow[] = [];
  const fill = (x: string) => x.replace('{base}', t.base).replace('{files}', String(round.diff.files));
  for (const [icon, text, right] of s.rows) {
    await sleep(run, 650);
    rows.push({ icon, text: fill(text), right: right && fill(right), mono: icon !== 'chat' });
    patch(sid, ag.id, { agent: { agentType: 'code-reviewer', task, model, summary: `已调用 ${rows.length} 次工具`, rows: [...rows], tokens: 6000 * rows.length, toolCalls: rows.length } });
  }
  await sleep(run, 500);
  const raise = s.raise ?? [];
  const reopened = (s.updates ?? []).filter((u) => u.status === 'open').length;
  rows.push({ icon: 'check', text: 'submit_review', right: s.pass ? `通过${raise.length ? ` · ${raise.length} 条次要` : ''}` : `打回 · ${raise.length + reopened} 条`, mono: true });
  const tokens = 9000 * rows.length + 12_000;
  const seconds = (Date.now() - t0) / 1000;
  finishTool(sid, ag, { right: `${Math.round(seconds)} 秒 · ${model}`, agent: { agentType: 'code-reviewer', task, model, summary: s.summary, rows, tokens, toolCalls: rows.length } });

  // Record the verdict.
  const start = get(id).findings.length;
  const added: ReviewFinding[] = raise.map((f, i) => ({ ...f, id: `F${start + i + 1}`, round: n, status: 'open' }));
  update(id, (x) => ({ ...x, tokens: x.tokens + tokens, findings: [...x.findings, ...added] }));
  for (const u of s.updates ?? []) setFinding(id, u.id, { status: u.status, reviewerNote: u.note, closedIn: u.status === 'verified' || u.status === 'upheld' ? n : undefined });
  setRound(id, n, (r) => ({ ...r, verdict: s.pass ? 'pass' : 'changes_requested', raised: added.map((f) => f.id), rulings: s.updates ?? [], reviewer: { model, seconds, tokens, toolCalls: rows.length, summary: s.summary } }));
  addItem(sid, { kind: 'review', id: uid('rv'), ticketId: id, round: n, what: 'verdict' });

  if (!s.pass) return false;
  const minors = get(id).findings.filter((f) => f.status === 'open');
  await streamText(run, minors.length ? `审核通过。还有 ${minors.length} 条次要意见（${minors.map((f) => f.id).join('、')}）没有改，记在审核记录里。` : '审核通过。');
  footer(sid, 1, seconds);
  finish(id, 'passed', '');
  addItem(sid, { kind: 'notice', id: uid('note'), tone: 'good', text: `代码审核通过（第 ${n} 轮）。`, action: '查看审核记录' });
  notify('background', { sid, title: `「${sum?.title ?? ''}」代码审核通过`, body: `第 ${n} 轮通过`, tone: 'good' });
  return true;
}

/** The author fixes or disputes each open finding, answering through respond_findings. */
async function fixPhase(run: Run, id: string, n: number) {
  const sid = run.sid;
  const s = scriptFor(id, n);
  if (!s.fix) return;
  const t0 = Date.now();
  update(id, (x) => ({ ...x, status: 'fixing' }));
  const before = rt(sid)!.changes.length;
  await streamText(run, s.fix.intro);
  for (const e of s.fix.edits) await editStep(run, e.path, e.diff, e.add, e.del, e.created);
  const tool = newTool(sid, 'mcp__review__respond_findings', `${s.fix.responses.length} 条`, {
    rows: s.fix.responses.map((r) => ({ icon: r.status === 'fixed' ? 'check' : 'chat', text: `${r.id} ${r.status === 'fixed' ? '已修改' : '有异议'}：${r.text}` })),
  });
  await sleep(run, 300);
  finishTool(sid, tool, { seconds: 0.1 });
  for (const r of s.fix.responses) setFinding(id, r.id, { status: r.status, response: r.text });
  setRound(id, n, (r) => ({ ...r, answers: [...r.answers, ...s.fix!.responses] }));
  recordFiles(id, n, sid, before, 'fix');
  await streamText(run, '这一轮的意见处理完了。');
  footer(sid, s.fix.edits.length + 1, (Date.now() - t0) / 1000);
}

/** The author's file changes since `before`, attached to round n. */
function recordFiles(id: string, n: number, sid: string, before: number, phase: 'check' | 'fix') {
  const files = (rt(sid)?.changes ?? []).slice(before).map((c) => ({ path: c.path, add: c.add, del: c.del, diff: c.diff, phase }));
  if (files.length) setRound(id, n, (r) => ({ ...r, authorFiles: [...r.authorFiles, ...files] }));
}

function finish(id: string, status: ReviewTicket['status'], note: string) {
  const t = get(id);
  update(id, (x) => ({ ...x, status, endedAt: Date.now(), note: note || x.note }));
  if (status === 'passed' || status === 'accepted') {
    const app = useApp.getState();
    app.set({ reviewed: { ...app.reviewed, [t.sessionId]: rt(t.sessionId)?.changes.length ?? 0 } });
  }
}

// ------------------------------------------------------------------ the user's controls

export function stopReview(sid: string) {
  const t = activeTicket(sid);
  if (!t) return;
  if (isRunning(sid)) {
    stopping.add(t.id);
    cancelRun(sid);
    return;
  }
  finish(t.id, 'stopped', '你停止了审核');
  addItem(sid, { kind: 'notice', id: uid('note'), tone: 'warn', text: '代码审核已停止。审核记录保留在右侧「审核」里。', action: '查看审核记录' });
}

/** After the round limit: accept the change as it is, allow two more rounds, or take over. */
export function decideReview(sid: string, choice: 'accept' | 'more' | 'takeover') {
  const t = activeTicket(sid);
  if (!t || isRunning(sid)) return;
  const open = t.findings.filter((f) => f.status === 'open' || f.status === 'disputed');
  if (choice === 'more') {
    update(t.id, (x) => ({ ...x, maxRounds: x.maxRounds + 2, status: 'fixing' }));
    void startRun(sid, (run) => loop(run, t.id, t.rounds.length + 1, true));
    return;
  }
  const note = choice === 'accept' ? `你接受了现状${open.length ? `，${open.map((f) => f.id).join('、')} 没有解决` : ''}` : '由你接手处理剩下的意见';
  finish(t.id, choice === 'accept' ? 'accepted' : 'stopped', note);
  addItem(sid, { kind: 'notice', id: uid('note'), tone: 'info', text: `代码审核结束：${note}。`, action: '查看审核记录' });
}

/** Mock console: a review on the current session; adds a sample change when there is nothing to review. */
export function mockReview(sid: string, script: ScriptName) {
  const r = rt(sid);
  const sum = sumOf(sid);
  if (!r || !sum || isRunning(sid)) {
    useApp.getState().toast('这个会话正在运行，等这一轮结束再试', 'warn');
    return;
  }
  if (r.changes.length <= (useApp.getState().reviewed[sid] ?? 0)) {
    const diff = ['@@ -41,6 +41,7 @@', '-  const id = setTimeout(() => expire(cart), ttl);', '+  const id = timers.setTimeout(() => expire(cart), ttl);', '+  cart.onDispose(() => timers.clearTimeout(id));'];
    addItem(sid, { kind: 'tool', id: uid('tool'), tool: 'Edit', detail: 'src/cart/timer.ts', status: 'ok', provenance: '已由你批准', right: '+2 −1', output: { type: 'diff', lines: diff } });
    emit(sid, { t: 'changes', changes: [...r.changes, { path: 'src/cart/timer.ts', kind: 'modified', add: 2, del: 1, diff, afterUserId: lastUserId(sid) }] });
  }
  startReview(sid, useApp.getState().reviewChecks[sum.workspaceId] ?? ['npm test'], script);
}

export function reviewMarkdown(id: string): string {
  const t = get(id);
  const sum = sumOf(t.sessionId);
  const sev = { blocker: '阻断', major: '重要', minor: '次要' };
  const rule = { verified: '已确认修复', upheld: '异议成立', open: '未解决' };
  const lines = [
    `# 代码审核 · ${sum?.title ?? ''}`, '',
    `- 基准：${t.base}`, `- 轮数：${t.rounds.length}/${t.maxRounds}`, `- 结果：${t.status}${t.note ? `（${t.note}）` : ''}`,
    `- 验证命令：${t.checks.length ? t.checks.join('；') : '跳过验证'}`, '',
  ];
  for (const r of t.rounds) {
    lines.push(`## 第 ${r.n} 轮 · ${r.scope === 'global' ? '全局' : '增量'} · ${r.range}`, '');
    lines.push(`- 审核范围：${r.diff.files} 个文件 +${r.diff.add} −${r.diff.del}`);
    lines.push(`- 验证：${t.checks.length === 0 ? '跳过' : r.checks.map((c) => `第 ${c.attempt} 次${c.ok ? '通过' : '失败'}`).join('，') || '—'}`);
    lines.push(`- 结论：${r.verdict === 'pass' ? '通过' : r.verdict === 'changes_requested' ? '打回' : '—'}${r.reviewer ? `（${r.reviewer.summary}）` : ''}`, '');
    const raised = t.findings.filter((f) => r.raised.includes(f.id));
    if (raised.length) {
      lines.push('### 新意见', '');
      for (const f of raised) lines.push(`- **${f.id}** [${sev[f.severity]}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.title}`, `  ${f.detail}`);
      lines.push('');
    }
    if (r.rulings.length) {
      lines.push('### 对之前意见的结论', '');
      for (const u of r.rulings) lines.push(`- **${u.id}** ${rule[u.status]}：${u.note}`);
      lines.push('');
    }
    if (r.answers.length) {
      lines.push('### 作者的答复', '');
      for (const x of r.answers) lines.push(`- **${x.id}** ${x.status === 'fixed' ? '已修改' : '有异议'}：${x.text}`);
      lines.push('');
    }
    if (r.authorFiles.length) {
      lines.push('### 作者修改的文件', '');
      for (const f of r.authorFiles) lines.push(`- ${f.path} +${f.add} −${f.del}（${f.phase === 'check' ? '验证没通过后修复' : '按意见修改'}）`);
      lines.push('');
    }
  }
  return lines.join('\n');
}
