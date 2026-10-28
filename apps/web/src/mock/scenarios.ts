/** Scripted agent turns used by the mock backend. */
import type { Item, PlanAnswer, QuestionAnswer, Task, ToolItem } from '../api/types';
import { useApp } from '../store/app';
import { uid } from '../lib/util';
import { baseContext } from './data';
import {
  addItem, authorize, Cancelled, emit, finishTool, lastUserId, newTool, patch, planItem, raw, rt, sleep,
  streamText, userItem, waitFor, type Run,
} from './engine';

const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function setTasks(sid: string, tasks: Task[]) {
  emit(sid, { t: 'tasks', tasks });
}

/** Deliver messages the user queued for "after the current tool calls", and steering messages. */
export async function checkpoint(run: Run) {
  const r = rt(run.sid);
  if (!r) return;
  const nexts = r.queue.filter((q) => q.priority === 'next');
  if (nexts.length) {
    emit(run.sid, { t: 'queue', queue: r.queue.filter((q) => q.priority !== 'next') });
    for (const q of nexts) {
      userItem(run.sid, q.text);
      await streamText(run, `收到：「${short(q.text)}」。我会在接下来的步骤里一并处理。`);
    }
  }
  while (run.steer.length) {
    const s = run.steer.shift()!;
    await streamText(run, `好的，按你刚才的要求调整：${short(s, 30)}`);
  }
}

function addChange(sid: string, path: string, kind: 'created' | 'modified', add: number, del: number, diff: string[]) {
  const r = rt(sid)!;
  emit(sid, { t: 'changes', changes: [...r.changes, { path, kind, add, del, diff, afterUserId: lastUserId(sid) }] });
}

async function editStep(run: Run, path: string, diff: string[], add: number, del: number, created = false): Promise<boolean> {
  const t = newTool(run.sid, created ? 'Write' : 'Edit', path, { right: created ? `+${add}` : `+${add} −${del}` });
  const auth = await authorize(run, t, { diff: { path, lines: diff } });
  if (!auth) {
    await streamText(run, `好的，我不修改 ${path}。${rt(run.sid)?.items.find((x) => x.id === t.id && x.kind === 'tool' && (x as ToolItem).denialMessage) ? '按你的说明换一种做法。' : '如果需要，我可以先把改动方案写出来给你看。'}`);
    return false;
  }
  await sleep(run, 500);
  finishTool(run.sid, t, { provenance: auth.provenance, output: { type: 'diff', lines: diff }, seconds: 0.4, right: created ? `+${add}` : `+${add} −${del}` });
  addChange(run.sid, path, created ? 'created' : 'modified', add, del, diff);
  return true;
}

/** Run a Bash command whose output arrives line by line; it can be moved to the background. */
export async function bashStep(run: Run, command: string, lines: string[], opts: {
  description?: string; agent?: string; lineMs?: number; title?: string; reason?: string; defaultToNo?: boolean; bgSummary?: string;
} = {}): Promise<'ok' | 'denied' | 'background'> {
  const t = newTool(run.sid, 'Bash', command, { backgroundable: true });
  const auth = await authorize(run, t, { command, description: opts.description, agent: opts.agent, title: opts.title, reason: opts.reason, defaultToNo: opts.defaultToNo });
  if (!auth) {
    const denied = rt(run.sid)?.items.find((x) => x.id === t.id) as ToolItem | undefined;
    await streamText(run, denied?.denialMessage ? `明白，按你的说明处理：${short(denied.denialMessage, 40)}` : '这条命令没有执行。我换个办法继续。');
    return 'denied';
  }
  patch(run.sid, t.id, { provenance: auth.provenance });
  const started = Date.now();
  const out: string[] = [];
  for (const line of lines) {
    await sleep(run, opts.lineMs ?? 550);
    if (run.backgrounded.has(t.id) || run.steer.length) {
      moveToBackground(run.sid, t, command, opts.bgSummary ?? '后台继续运行中', out);
      await checkpoint(run);
      return 'background';
    }
    out.push(line);
    patch(run.sid, t.id, { output: { type: 'code', lines: out.slice(-6) }, right: `${((Date.now() - started) / 1000).toFixed(1)} 秒` });
    raw(run.sid, 'tool_progress', `Bash · ${((Date.now() - started) / 1000).toFixed(1)} 秒`, { tool_name: 'Bash', elapsed_time_seconds: (Date.now() - started) / 1000 });
  }
  finishTool(run.sid, t, { output: { type: 'code', lines: out.slice(-6) }, seconds: (Date.now() - started) / 1000, right: `${((Date.now() - started) / 1000).toFixed(1)} 秒`, backgroundable: false });
  return 'ok';
}

export function moveToBackground(sid: string, t: ToolItem, name: string, summary: string, out: string[] = []) {
  const taskId = uid('task');
  patch(sid, t.id, { background: true, backgroundable: false, right: '已转入后台', output: out.length ? { type: 'code', lines: out.slice(-4) } : undefined });
  const r = rt(sid)!;
  emit(sid, { t: 'background', background: [...r.background, { id: taskId, kind: 'bash', name, status: 'running', summary, startedAt: Date.now() }] });
  raw(sid, 'system/task_started', `Bash · ${name}`, { task_id: taskId });
  setTimeout(() => finishBackground(sid, taskId, t.id, `后台任务已完成：${short(name, 30)}`), 9000);
}

export function finishBackground(sid: string, taskId: string, toolId: string | null, text: string, failed = false) {
  const r = rt(sid);
  if (!r) return;
  const task = r.background.find((b) => b.id === taskId);
  if (!task || task.status !== 'running') return;
  emit(sid, { t: 'background', background: r.background.map((b) => (b.id === taskId ? { ...b, status: failed ? 'failed' : 'completed', endedAt: Date.now() } : b)) });
  if (toolId) patch(sid, toolId, { status: failed ? 'error' : 'ok', right: failed ? '失败' : '后台完成' });
  addItem(sid, { kind: 'notice', id: uid('note'), tone: failed ? 'warn' : 'good', text, action: '查看输出' });
  raw(sid, 'system/task_notification', `${failed ? 'failed' : 'completed'} · ${task.name}`, { task_id: taskId, status: failed ? 'failed' : 'completed' });
  // Real implementation: also a browser notification when the tab is hidden. The mock only toasts,
  // and only when the user is looking at another page.
  if (window.location.pathname === `/s/${sid}`) return;
  const title = useApp.getState().sessions.find((x) => x.id === sid)?.title ?? '';
  useApp.getState().toast(`「${title}」${text}`, failed ? 'warn' : 'good', {
    label: '打开',
    run: () => { window.history.pushState({}, '', `/s/${sid}`); window.dispatchEvent(new PopStateEvent('popstate')); },
  });
}

function readGroup(sid: string, label: string, tools: Array<[string, string, string?]>): { id: string; tools: ToolItem[] } {
  const id = uid('grp');
  const list: ToolItem[] = tools.map(([tool, detail, right]) => ({ kind: 'tool', id: uid('tool'), tool, detail, status: 'ok', right, seconds: 0.3 }));
  addItem(sid, { kind: 'toolgroup', id, label, tools: [] });
  return { id, tools: list };
}

async function playGroup(run: Run, g: { id: string; tools: ToolItem[] }, label: string) {
  const shown: ToolItem[] = [];
  for (const t of g.tools) {
    await sleep(run, 260);
    shown.push(t);
    patch(run.sid, g.id, { tools: [...shown], label: `${label.replace('{n}', String(shown.length))}` });
    raw(run.sid, 'assistant', `tool_use ${t.tool} ${t.detail}`.slice(0, 80), {});
  }
}

export function footer(sid: string, toolCalls: number, seconds: number, stop = 'end_turn') {
  const r = rt(sid)!;
  const turn = r.turn + 1;
  const tok = 40_000 + Math.round(Math.random() * 60_000);
  addItem(sid, { kind: 'footer', id: uid('ft'), turn, seconds, toolCalls, tokens: tok, stopReason: stop });
  emit(sid, { t: 'settings', patch: { turn, tokens: r.tokens + tok } });
  const msgs = r.context.categories.find((c) => c.name === '消息')?.tokens ?? 0;
  const ctx = baseContext(r.context.model, Math.min(150_000, msgs + 9000 + Math.round(Math.random() * 6000)));
  emit(sid, { t: 'context', context: { ...ctx, precise: false } });
  raw(sid, 'result/success', `${seconds.toFixed(0)} 秒 · ${toolCalls} 次工具调用 · ${tok} tokens`, { subtype: 'success', num_turns: toolCalls, stop_reason: stop, usage: { input_tokens: tok } });
  const app = useApp.getState();
  const sum = app.sessions.find((x) => x.id === sid);
  if (sum) app.patchSession(sid, { tokens: sum.tokens + tok, lastActive: Date.now() });
}

// ------------------------------------------------------------------ scenarios

export async function scenarioFix(run: Run) {
  const sid = run.sid;
  const t0 = Date.now();
  await streamText(run, '日志显示 cart.timer 超时——可能有计时器在测试之间泄漏。先看测试和计时器的实现。', { thinking: true, seconds: 6 });
  await streamText(run, '我先看看结账测试套件和计时器相关的代码。');
  setTasks(sid, [
    { id: 't1', subject: '在本地复现失败', activeForm: '正在本地复现失败', status: 'in_progress' },
    { id: 't2', subject: '定位购物车计时器的竞态', status: 'pending' },
    { id: 't3', subject: '修复并添加回归测试', status: 'pending', blockedBy: '#2' },
    { id: 't4', subject: '把结账测试连续跑 20 次', status: 'pending' },
  ]);
  const g = readGroup(sid, '', [
    ['Read', 'src/cart/timer.ts'], ['Read', 'tests/checkout/timer.test.ts'], ['Grep', '"setTimeout" in src/**', '7 处匹配'],
    ['Read', 'src/cart/cart.ts'], ['Grep', '"CartTimer" in tests/**', '3 处匹配'], ['Read', 'tests/helpers/clock.ts'],
  ]);
  await playGroup(run, g, '读取与搜索 · {n} 次调用');
  patch(sid, g.id, { label: '读取 4 个文件 · 搜索 2 个模式 · 1.8 秒' });
  await checkpoint(run);
  setTasks(sid, [
    { id: 't1', subject: '在本地复现失败', status: 'completed' },
    { id: 't2', subject: '定位购物车计时器的竞态', activeForm: '正在定位购物车计时器的竞态', status: 'in_progress' },
    { id: 't3', subject: '修复并添加回归测试', status: 'pending', blockedBy: '#2' },
    { id: 't4', subject: '把结账测试连续跑 20 次', status: 'pending' },
  ]);
  await streamText(run, '找到了：两个测试共用一个模块级计时器，前一个测试没有清理它。我把它改成注入的时钟，并在购物车释放时清理。');
  const edited = await editStep(run, 'src/cart/timer.ts', [
    '@@ -41,6 +41,7 @@ export function startTimer(cart: Cart) {',
    '   const ttl = cart.ttlMs ?? DEFAULT_TTL;',
    '-  const id = setTimeout(() => expire(cart), ttl);',
    '+  const id = timers.setTimeout(() => expire(cart), ttl);',
    '+  cart.onDispose(() => timers.clearTimeout(id));',
  ], 2, 1);
  await checkpoint(run);
  setTasks(sid, [
    { id: 't1', subject: '在本地复现失败', status: 'completed' },
    { id: 't2', subject: '定位购物车计时器的竞态', status: 'completed' },
    { id: 't3', subject: '修复并添加回归测试', status: edited ? 'completed' : 'pending' },
    { id: 't4', subject: '把结账测试连续跑 20 次', activeForm: '正在连续运行结账测试', status: 'in_progress' },
  ]);
  const res = await bashStep(run, 'npm test -- checkout --randomize', [
    '> shop-api@3.2.0 test', '> jest checkout --randomize', 'PASS  tests/checkout/cart.test.ts (8.2 s)',
    'PASS  tests/checkout/timer.test.ts (2.1 s)', 'PASS  tests/checkout/pay.test.ts (5.9 s)', 'Tests:       41 passed, 41 total',
  ], { description: '随机顺序运行结账测试', bgSummary: '正在运行 jest checkout' });
  setTasks(sid, [
    { id: 't1', subject: '在本地复现失败', status: 'completed' },
    { id: 't2', subject: '定位购物车计时器的竞态', status: 'completed' },
    { id: 't3', subject: '修复并添加回归测试', status: 'completed' },
    { id: 't4', subject: '把结账测试连续跑 20 次', status: res === 'ok' ? 'completed' : 'in_progress' },
  ]);
  await streamText(run, res === 'background'
    ? '测试已经在后台运行，完成后会通知你。修复本身已经完成：计时器改用注入的时钟，并随购物车一起释放。'
    : '两个测试共用了一个从未清理的模块级计时器，导致后一个测试读到过期的时间。现在计时器改用注入的时钟，并随购物车一起释放，测试连续通过。');
  footer(sid, 9, (Date.now() - t0) / 1000);
  emit(sid, { t: 'suggestion', text: '运行完整测试套件，确认修复有效' });
}

export async function scenarioGeneric(run: Run, text: string) {
  const sid = run.sid;
  const t0 = Date.now();
  await streamText(run, `用户想要：${short(text, 40)}。先读相关代码再动手。`, { thinking: true, seconds: 3 });
  await streamText(run, '好的，我先看一下相关文件。');
  const g = readGroup(sid, '', [['Read', 'src/index.ts'], ['Grep', '"export function" in src/**', '23 处匹配'], ['Read', 'src/routes/orders.ts']]);
  await playGroup(run, g, '读取与搜索 · {n} 次调用');
  patch(sid, g.id, { label: '读取 2 个文件 · 搜索 1 个模式 · 0.9 秒' });
  await checkpoint(run);
  await editStep(run, 'src/routes/orders.ts', [
    '@@ -12,4 +12,6 @@ router.post("/orders", async (req, res) => {',
    '   const order = await createOrder(req.body);',
    '+  logger.info({ orderId: order.id }, "order created");',
    '+  metrics.increment("orders.created");',
    '   res.status(201).json(order);',
  ], 2, 0);
  await checkpoint(run);
  await streamText(run, '改好了：在创建订单后补充了日志和指标。需要的话我可以继续补测试。');
  footer(sid, 4, (Date.now() - t0) / 1000);
  emit(sid, { t: 'suggestion', text: '为这个改动补一个单元测试' });
}

const REDIS_PREVIEW = `<div style="font:13px system-ui;padding:12px"><div style="display:flex;gap:18px;align-items:center">
<div>${['API #1', 'API #2', 'API #3'].map((n) => `<div style="border:1px solid #cbd0d8;border-radius:6px;padding:6px 14px;margin:6px 0">${n}</div>`).join('')}</div>
<div style="font-size:20px;color:#888">→</div><div style="border:1px solid #b9c6f8;background:#e8edff;border-radius:6px;padding:10px 16px"><b>Redis</b><br><span style="color:#555">INCR + EXPIRE</span></div></div>
<pre style="color:#4b5563;margin-top:12px">limit: 100 req / min per API key\nwindow: sliding, 60 s\non limit: 429 + Retry-After</pre></div>`;
const MEMORY_PREVIEW = `<div style="font:13px system-ui;padding:12px"><div style="display:flex;gap:10px">${['API #1', 'API #2'].map((n) => `<div style="border:1px solid #cbd0d8;border-radius:6px;padding:8px"><b>${n}</b><br><span style="color:#555">本地计数器</span></div>`).join('')}</div><p style="color:#b45309">每个实例各自计数：3 个实例时实际上限变成 300 次/分钟</p></div>`;

export async function scenarioQuestion(run: Run) {
  const sid = run.sid;
  const t0 = Date.now();
  await streamText(run, '有几个选择会影响设计：');
  const t = newTool(sid, 'AskUserQuestion', '2 个问题', { status: 'waiting', right: '等待回答' });
  const ans = await waitFor<QuestionAnswer>(run, {
    kind: 'question', id: uid('req'), toolItemId: t.id, since: Date.now(),
    questions: [
      {
        header: '存储', question: '限流计数器存放在哪里？', multiSelect: false, options: [
          { label: 'Redis（推荐）', description: '多实例共享；使用现有的 Redis。', preview: REDIS_PREVIEW },
          { label: '内存', description: '最简单；但限额只对单个实例生效。', preview: MEMORY_PREVIEW },
          { label: 'PostgreSQL', description: '不需新基础设施；每个请求多一次写入。' },
        ],
      },
      {
        header: '范围', question: '对哪些请求限流？', multiSelect: true, options: [
          { label: '按 API Key', description: '每个调用方单独计数。' },
          { label: '按 IP', description: '未登录的请求也能限制。' },
          { label: '只限写操作', description: 'GET 请求不受影响。' },
        ],
      },
    ],
  });
  const summary = ans.response ? `自由回答：${short(ans.response, 30)}` : Object.entries(ans.answers).map(([q, a]) => `${short(q, 8)}：${a}`).join(' · ');
  finishTool(sid, t, { detail: summary, right: '已回答' });
  await streamText(run, ans.response ? `明白了：「${short(ans.response, 40)}」。我按这个思路来。` : `明白了，按你的选择来：${Object.values(ans.answers).join('；')}。`);
  const g = readGroup(sid, '', [['Read', 'src/routes/orders.ts'], ['Read', 'config/limits.yaml']]);
  await playGroup(run, g, '读取 · {n} 个文件');
  await streamText(run, '下一步我会写出具体实现。要先看计划的话，把权限模式切到「规划模式」再让我继续。');
  footer(sid, 3, (Date.now() - t0) / 1000);
  emit(sid, { t: 'suggestion', text: '先出计划，我审过之后再改代码' });
}

const PLAN_V1 = {
  title: '为 POST /orders 添加限流',
  summary: '按 API Key 的滑动窗口限流（100 次/分钟），基于现有 Redis，超限返回 429 和 Retry-After。',
  steps: [
    '在 src/middleware/rate-limit.ts 中实现 RateLimiter（INCR + EXPIRE）',
    '从 config/limits.yaml 读取限额，默认 100 次/分钟',
    '只在 POST /orders 上挂载该中间件',
    '用假 Redis 写单元测试，再加一个集成测试',
    '在 docs/api/orders.md 中说明 429 响应',
  ],
  files: ['src/middleware/rate-limit.ts  新增', 'src/routes/orders.ts', 'config/limits.yaml  新增', 'tests/rate-limit.test.ts  新增', 'docs/api/orders.md'],
  risks: ['Redis 故障会阻塞下单——改为放行并记录告警日志。', '共用 NAT 的客户端只有共用同一 API Key 时才共享限额（可接受）。'],
};

export async function scenarioPlan(run: Run) {
  const sid = run.sid;
  const t0 = Date.now();
  if (rt(sid)!.mode !== 'plan') {
    const ep = newTool(sid, 'EnterPlanMode', '进入规划模式');
    await sleep(run, 300);
    finishTool(sid, ep, { right: '已切换' });
    emit(sid, { t: 'settings', patch: { mode: 'plan' } });
  }
  await streamText(run, '先摸清 /orders 的调用链和现有的 Redis 用法，再给出计划。', { thinking: true, seconds: 5 });
  const g = readGroup(sid, '', [
    ['Read', 'src/routes/orders.ts'], ['Read', 'src/index.ts'], ['Grep', '"redis" in src/**', '6 处匹配'], ['Read', 'src/lib/redis.ts'], ['Read', 'config/default.yaml'],
  ]);
  await playGroup(run, g, '读取与搜索 · {n} 次调用');
  patch(sid, g.id, { label: '读取 9 个文件 · 搜索 3 个模式 · 1 个子代理（Explore）· 48 秒' });
  let version = 1;
  let plan = PLAN_V1;
  for (;;) {
    const pid = planItem(sid, version, plan);
    const ans = await waitFor<PlanAnswer>(run, { kind: 'plan', id: uid('req'), planItemId: pid, since: Date.now() });
    if (ans.approve) {
      patch(sid, pid, { status: 'approved' });
      emit(sid, { t: 'settings', patch: { mode: ans.mode } });
      addItem(sid, { kind: 'notice', id: uid('note'), tone: 'info', text: `计划 v${version} 已批准 · 权限模式切换为「${ans.mode === 'acceptEdits' ? '自动接受编辑' : '编辑前询问'}」` });
      break;
    }
    patch(sid, pid, { status: 'revised' });
    addItem(sid, { kind: 'notice', id: uid('note'), tone: 'info', text: `你的意见：${ans.feedback || '（无）'}` });
    await streamText(run, '根据意见调整计划。', { thinking: true, seconds: 3 });
    version += 1;
    plan = { ...plan, summary: `${plan.summary}（已按意见调整：${short(ans.feedback || '无', 20)}）`, steps: [...plan.steps.slice(0, 4), `按你的意见补充：${short(ans.feedback || '无', 30)}`, plan.steps[4]] };
  }
  await streamText(run, '开始实现。');
  await editStep(run, 'src/middleware/rate-limit.ts', [
    '@@ -0,0 +1,8 @@',
    '+export function rateLimit(opts: LimitOptions) {',
    '+  return async (req, res, next) => {',
    '+    const key = `rl:${req.apiKey}:${window()}`;',
    '+    const n = await redis.incr(key);',
    '+    if (n === 1) await redis.expire(key, 60);',
    '+    if (n > opts.limit) return res.status(429).set("Retry-After", "60").end();',
    '+    next();',
  ], 64, 0, true);
  await checkpoint(run);
  await editStep(run, 'src/routes/orders.ts', [
    '@@ -3,6 +3,7 @@ import { createOrder } from "../orders";',
    '+import { rateLimit } from "../middleware/rate-limit";',
    '-router.post("/orders", handler);',
    '+router.post("/orders", rateLimit(limits.orders), handler);',
  ], 3, 1);
  await checkpoint(run);
  await bashStep(run, 'npm test -- rate-limit', ['> jest rate-limit', 'PASS  tests/rate-limit.test.ts (3.4 s)', 'Tests:       12 passed, 12 total'], { description: '运行限流测试' });
  await streamText(run, 'POST /orders 的限流已上线，补充了单元测试；文档的 429 说明也已加上。');
  footer(sid, 14, (Date.now() - t0) / 1000);
  emit(sid, { t: 'suggestion', text: '把限额改成从环境变量读取' });
}

export async function scenarioSubagents(run: Run) {
  const sid = run.sid;
  const t0 = Date.now();
  await streamText(run, '我让一个子代理去梳理调用点，同时在后台启动 e2e 测试。');
  const agentRows = [
    { icon: 'file', text: 'Read src/cart/timer.ts', right: '✓', mono: true },
    { icon: 'search', text: 'Grep "CartTimer" in src/**', right: '7 处匹配', mono: true },
    { icon: 'file', text: 'Read src/checkout/session.ts', right: '✓', mono: true },
    { icon: 'file', text: 'Read tests/helpers.ts', right: '✓', mono: true },
    { icon: 'chat', text: '调用点：session.ts:41、cart.ts:88、tests/helpers.ts:12。helpers 里还有第二个计时器实例。' },
  ];
  const ag = newTool(sid, 'Agent', 'Explore · 查找 CartTimer 的所有用法', {
    right: 'haiku', agent: { agentType: 'Explore', task: '查找 CartTimer 的所有用法', model: 'haiku', summary: '正在启动…', rows: [], tokens: 0, toolCalls: 0 },
  });
  raw(sid, 'system/task_started', 'Explore · 查找 CartTimer 的所有用法', { task_type: 'local_agent' });
  // Background test runner.
  const bgAgent = newTool(sid, 'Agent', 'test-runner · 运行 e2e 测试', {
    right: '后台', background: true, agent: { agentType: 'test-runner', task: '运行 e2e 测试', model: 'haiku', summary: '正在运行 jest 第 1/4 组…', rows: [], tokens: 0, toolCalls: 0, background: true },
  });
  const bgId = uid('task');
  const r0 = rt(sid)!;
  emit(sid, { t: 'background', background: [...r0.background, { id: bgId, kind: 'agent', name: 'test-runner', status: 'running', summary: '正在运行 jest 第 1/4 组…', startedAt: Date.now(), tokens: 12_000 }] });
  let shard = 1;
  const tick = setInterval(() => {
    const r = rt(sid);
    const task = r?.background.find((b) => b.id === bgId);
    if (!r || !task || task.status !== 'running') return clearInterval(tick);
    shard += 1;
    if (shard > 4) {
      clearInterval(tick);
      finishBackground(sid, bgId, bgAgent.id, '后台任务已完成：e2e 4 组全部通过（168 个测试，3分02秒）');
      return;
    }
    emit(sid, { t: 'background', background: r.background.map((b) => (b.id === bgId ? { ...b, summary: `正在运行 jest 第 ${shard}/4 组…`, tokens: (b.tokens ?? 0) + 9000 } : b)) });
  }, 6000);
  const rows: typeof agentRows = [];
  const summaries = ['正在扫描 src/cart 和 tests —— 已读 6 个文件', '已读 14 个文件，找到 3 处调用', '正在检查 helpers 中的第二个计时器实例', '已完成：3 处调用 + 1 个多余实例'];
  for (let i = 0; i < agentRows.length; i++) {
    await sleep(run, 800);
    rows.push(agentRows[i]);
    patch(sid, ag.id, { agent: { agentType: 'Explore', task: '查找 CartTimer 的所有用法', model: 'haiku', summary: summaries[Math.min(i, summaries.length - 1)], rows: [...rows], tokens: 3000 * (i + 1), toolCalls: i + 1 } });
    raw(sid, 'system/task_progress', summaries[Math.min(i, summaries.length - 1)], { summary: summaries[Math.min(i, summaries.length - 1)] });
  }
  finishTool(sid, ag, { right: '0:38 · haiku', agent: { agentType: 'Explore', task: '查找 CartTimer 的所有用法', model: 'haiku', summary: summaries[3], rows, tokens: 18_200, toolCalls: 9 } });
  await checkpoint(run);
  await bashStep(run, 'npm run build -- --watch', [
    'webpack 5.97 compiled successfully in 2310 ms', 'watching for file changes…', 'change detected: src/cart/timer.ts',
    'webpack 5.97 compiled successfully in 640 ms', 'watching for file changes…', 'change detected: src/checkout/session.ts',
    'webpack 5.97 compiled successfully in 702 ms', 'watching for file changes…',
  ], { lineMs: 1200, description: '监听模式构建', bgSummary: 'webpack 监听模式' });
  await streamText(run, '有两处调用各自创建了计时器，我现在把它们改为使用共享的时钟。e2e 测试在后台继续跑，完成后会通知你。');
  footer(sid, 11, (Date.now() - t0) / 1000);
}

export async function scenarioHighRisk(run: Run) {
  const sid = run.sid;
  const t0 = Date.now();
  await streamText(run, '旧的构建目录占了 3 GB，我来删除它。');
  await bashStep(run, 'rm -r ~/projects/old-build', ['removed 18,204 files'], {
    title: '删除工作区外的文件？', defaultToNo: true, description: '删除旧的构建产物',
    reason: 'Claude Code 判定这是关键路径：目标位于工作区之外。默认焦点在「拒绝」，没有一键批准，也不提供「始终允许」。',
  });
  await streamText(run, '处理完毕。');
  footer(sid, 1, (Date.now() - t0) / 1000);
}

export async function scenarioCommand(run: Run, cmd: string) {
  const t0 = Date.now();
  await streamText(run, `已运行 ${cmd}。（模拟：这里会显示该命令或技能的实际输出。）`);
  footer(run.sid, 0, (Date.now() - t0) / 1000);
}

/** Continue after a queued or steering message without a full scenario. */
export async function scenarioAck(run: Run, text: string) {
  const t0 = Date.now();
  await streamText(run, `好的，处理你的消息：「${short(text, 40)}」。`);
  await streamText(run, '（模拟回复）已完成。');
  footer(run.sid, 0, (Date.now() - t0) / 1000);
}

export function pickScenario(text: string, mode: string): (run: Run) => Promise<void> {
  if (mode === 'plan' || /计划|规划|plan/i.test(text)) return scenarioPlan;
  if (/提问|选项|选择|问我|问题/.test(text)) return scenarioQuestion;
  if (/子代理|后台|subagent|并行/i.test(text)) return scenarioSubagents;
  if (/删除|rm /.test(text)) return scenarioHighRisk;
  if (/修复|测试|bug|失败/i.test(text)) return scenarioFix;
  return (run) => scenarioGeneric(run, text);
}

/** Seed transcript for a live session that is waiting for an approval. */
export function seedFlaky(): Item[] {
  return [
    { kind: 'user', id: 'flaky-u1', text: 'CI 上结账测试偶尔失败，帮我找到原因并修复——CI 日志在附件里。', attachments: [{ id: 'a1', kind: 'image', name: 'ci-log.png', meta: '182 KB' }], ts: Date.now() - 25 * 60_000 },
    { kind: 'thinking', id: 'flaky-th1', text: '日志显示 cart.timer 超时——可能有计时器在测试之间泄漏。', seconds: 6 },
    { kind: 'text', id: 'flaky-t1', text: '我先看看结账测试套件和计时器相关的代码。' },
    { kind: 'toolgroup', id: 'flaky-g1', label: '读取 4 个文件 · 搜索 2 个模式 · 1.8 秒', tools: [
      { kind: 'tool', id: 'flaky-r1', tool: 'Read', detail: 'src/cart/timer.ts', status: 'ok', seconds: 0.2 },
      { kind: 'tool', id: 'flaky-r2', tool: 'Grep', detail: '"setTimeout" in src/**', status: 'ok', right: '7 处匹配', seconds: 0.4 },
      { kind: 'tool', id: 'flaky-r3', tool: 'Read', detail: 'tests/checkout/timer.test.ts', status: 'ok', seconds: 0.2 },
    ] },
    { kind: 'tool', id: 'flaky-e1', tool: 'Edit', detail: 'src/cart/timer.ts', status: 'ok', provenance: '已由你批准', right: '+2 −1', seconds: 0.4, output: { type: 'diff', lines: [
      '@@ -41,6 +41,7 @@ export function startTimer(cart: Cart) {', '   const ttl = cart.ttlMs ?? DEFAULT_TTL;',
      '-  const id = setTimeout(() => expire(cart), ttl);', '+  const id = timers.setTimeout(() => expire(cart), ttl);', '+  cart.onDispose(() => timers.clearTimeout(id));',
    ] } },
    { kind: 'footer', id: 'flaky-f1', turn: 1, seconds: 72, toolCalls: 14, tokens: 210_000, stopReason: 'end_turn' },
    { kind: 'user', id: 'flaky-u2', text: '干净检出后测试还是失败。清理缓存再试一次。', attachments: [], ts: Date.now() - 3 * 60_000 },
  ];
}

export async function bootFlaky(run: Run) {
  await streamText(run, 'jest 缓存里有过期的转换结果。我来清理缓存并重新安装依赖。', { speed: 1 });
  const res = await bashStep(run, 'rm -r node_modules/.cache && npm ci', ['removed node_modules/.cache', 'added 812 packages in 21s', '> jest checkout', 'Tests:       41 passed, 41 total'], {
    description: '清理构建缓存并重新安装依赖', agent: 'test-runner',
  });
  if (res === 'ok') await streamText(run, '缓存清理后测试全部通过。');
  footer(run.sid, 2, 30);
}

export async function bootDocs(run: Run) {
  await scenarioQuestion(run);
}

export async function bootAuth(run: Run) {
  await scenarioSubagents(run);
}

export { Cancelled };
