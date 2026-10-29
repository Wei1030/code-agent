// Brings the demo Code Agent into the states the prototype shows: settings, workspaces, sessions in
// every state (finished, running, waiting for an approval / answer / plan / elicitation, with a
// subagent and a background task, peer sessions, a review loop), board items and a job run.
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

export const EP = 'ep-demo';
export const PRO = `ep:${EP}:demo-pro`;
export const LITE = `ep:${EP}:demo-lite`;

/** Returns the ids later steps and screens refer to. */
export async function drive(c, DEMO, log = console.log) {
  const ids = {};
  const s = () => c.state.slices;
  const rt = (sid) => c.call('openSession', sid);
  const turns = (sid) => c.state.footers.get(sid) ?? 0;

  // ------------------------------------------------------------------ settings
  await c.call('setState', { provider: { ...s().provider, configDir: 'custom', customDir: path.join(DEMO, 'claude-config'), endpoints: [
    { id: EP, name: '演示服务', url: `http://127.0.0.1:${process.env.DEMO_LLM_PORT ?? 18090}`, models: [{ name: 'demo-pro', effort: true }, { name: 'demo-lite', effort: false }] },
    { id: 'ep-old', name: '旧网关', url: `http://127.0.0.1:${process.env.DEMO_LLM_PORT ?? 18090}`, models: [{ name: 'expired-1', effort: false }] },
  ] } });
  await c.call('setEndpointKey', EP, 'demo-token-2c41');
  await c.call('setEndpointKey', 'ep-old', 'old-token');
  await c.wait(() => s().models?.some((m) => m.id === PRO), 15_000, 'endpoint models');
  await c.call('setState', {
    profiles: s().profiles.map((p) => ({ ...p, model: PRO, effort: 'high' })),
    reviewProfile: { ...s().reviewProfile, model: PRO, effort: 'high', extraPrompt: '金额计算和参数校验要特别注意边界值。' },
    boardSettings: { ...s().boardSettings, recorderModel: LITE, recorderEffort: 'low' },
    maxRunning: 16,
    runtime: { ...s().runtime, debugLog: true },
    env: [{ id: 'env-1', key: 'NODE_OPTIONS', value: '--max-old-space-size=4096', note: '大仓库跑测试时内存不够' }],
  });

  // ------------------------------------------------------------------ workspaces
  const docs = await c.call('addWorkspace', path.join(DEMO, 'repos', 'docs-site'));
  const web = await c.call('addWorkspace', path.join(DEMO, 'repos', 'web-console'));
  const shop = await c.call('addWorkspace', path.join(DEMO, 'repos', 'shop-api'));
  Object.assign(ids, { docs: docs.id, web: web.id, shop: shop.id });

  // Sessions meant to finish get their approvals granted, as a user would.
  const approve = new Set();
  c.on((m) => {
    if (m.t === 'ev' && m.ev.t === 'request' && m.ev.request?.kind === 'approval' && approve.has(m.sid)) {
      void c.call('respondApproval', m.sid, m.ev.request.id, { behavior: 'allow' }).catch(() => {});
    }
  });

  async function session(ws, text, { mode, model, wait } = {}) {
    const sid = randomUUID();
    if (!wait) approve.add(sid);
    await c.call('createDraft', ws, sid);
    if (model) await c.call('setModel', sid, model);
    if (mode) await c.call('setMode', sid, mode);
    await c.call('send', sid, text);
    return sid;
  }
  const done = (sid, n = 1, ms = 120_000) => c.wait(() => turns(sid) >= n, ms, `turn ${n} of ${sid}`);
  const request = (sid, kind) => c.wait(async () => (await rt(sid)).request?.kind === kind, 120_000, `${kind} in ${sid}`);

  // ------------------------------------------------------------------ finished sessions in the other workspaces
  ids.webPaging = await session(web.id, '订单列表加分页，先看看现在 listOrders 怎么返回的');
  await done(ids.webPaging);
  ids.webRefund = await session(web.id, '帮我想一下退款审核页怎么布局');
  await done(ids.webRefund);
  await c.call('stop', ids.webPaging);
  await c.call('stop', ids.webRefund);
  ids.docsStart = await session(docs.id, '看看快速开始文档缺什么');
  await done(ids.docsStart);
  log('other workspaces done');

  // ------------------------------------------------------------------ shop-api: the main piece of work and its review
  ids.validate = await session(shop.id, '下单接口缺少参数校验：数量必须是正整数、单价不能为负、商品列表不能为空。请加上校验和对应的测试。', { mode: 'acceptEdits' });
  await done(ids.validate);
  log('validate done');
  ids.ticket = await c.call('startReview', ids.validate, ['npm test'], {});
  await c.wait(() => ['passed', 'needs_decision', 'checks_failed', 'stopped', 'accepted'].includes(s().reviews?.find((t) => t.id === ids.ticket)?.status), 300_000, 'review end');
  log('review', s().reviews.find((t) => t.id === ids.ticket)?.status);

  // peer sessions: one creates another on its own worktree and gets a receipt
  ids.peer = await session(shop.id, 'web-console 要对接新的下单错误码。开一个会话在独立工作树里处理，处理完告诉我结果。', { mode: 'acceptEdits' });
  await done(ids.peer, 2, 180_000);
  ids.child = [...c.state.sessions.values()].find((x) => x.title === '对接下单错误码')?.id;
  log('peer done', ids.child);

  // a subagent and a background task
  ids.bg = await session(shop.id, '压测一下下单性能，同时梳理 src 的模块结构。', { mode: 'acceptEdits' });
  await done(ids.bg, 1, 180_000);
  log('background running');

  // waiting states
  ids.approval = await session(shop.id, '接入 express：先安装依赖，再把 server.js 改成 express 路由。', { wait: true });
  await request(ids.approval, 'approval');
  ids.question = await session(shop.id, '订单数据要持久化，帮我选个数据库方案。', { wait: true });
  await request(ids.question, 'question');
  ids.plan = await session(shop.id, '规划一下：把订单从内存存储迁到 SQLite，先别动代码。', { mode: 'plan', wait: true });
  await request(ids.plan, 'plan');
  // Its tool call is approved; the elicitation that follows waits.
  ids.elicit = await session(shop.id, '在缺陷系统里记一个缺陷：导出 CSV 时金额单位错误。');
  await request(ids.elicit, 'elicitation');
  log('requests waiting');

  // a long command, still running
  ids.running = await session(shop.id, '跑一遍完整的回归测试。', { mode: 'acceptEdits' });
  await c.wait(async () => (await rt(ids.running)).items.some((x) => x.kind === 'tool' && x.status === 'running' && /bench/.test(x.detail ?? '')), 120_000, 'long command');
  log('long command running');

  // an endpoint that refuses the token
  ids.rejected = await session(docs.id, '给快速开始补一段 curl 示例', { model: 'ep:ep-old:expired-1' });
  await c.wait(async () => (await rt(ids.rejected)).items.some((x) => x.kind === 'banner'), 60_000, 'endpoint banner');

  // ------------------------------------------------------------------ board, jobs, hooks
  const item = (p) => c.call('createItem', shop.id, p, { kind: 'manual' });
  await item({ kind: 'feature', title: '订单列表分页', body: 'listOrders 支持 cursor + limit，按创建时间倒序。前端订单页同步改成无限滚动。', status: 'doing', priority: 'normal', tasks: [{ id: 't1', text: '后端 cursor 分页', done: true }, { id: 't2', text: '前端无限滚动', done: false }], decisions: [{ id: 'd1', text: '分页方式：cursor 还是 offset？', outcome: 'cursor，避免翻页时数据重复' }] }).catch((e) => log('board', e.message));
  await item({ kind: 'feature', title: '订单迁移到 SQLite', body: '用 node:sqlite 替换内存存储，接口不变。计划见会话「规划一下：把订单从内存存储迁到 SQLite」。', status: 'todo', priority: 'high', tasks: [], decisions: [{ id: 'd2', text: 'id 格式变成数字后前端是否兼容？' }] }).catch((e) => log('board', e.message));
  await item({ kind: 'issue', title: '导出 CSV 时金额单位错误', body: 'total 列是分，表头写的是元。', status: 'confirmed', priority: 'high' }).catch((e) => log('board', e.message));
  await item({ kind: 'issue', title: '取消已发货订单时报错信息不清楚', body: '返回 cannot cancel a shipped order，前端直接显示英文。', status: 'open', priority: 'normal' }).catch((e) => log('board', e.message));
  await item({ kind: 'note', title: '金额统一用「分」为单位的整数', body: '所有接口和数据库字段都按分存储，展示时再换算。', status: 'active', priority: 'normal' }).catch((e) => log('board', e.message));

  const job = { id: 'job-weekly', name: '每周变更摘要', workspaceId: shop.id, prompt: '总结 {{since}} 以来合入的提交：做了什么、风险高低、需要跟进的事。', schema: JSON.stringify({ type: 'object', required: ['summary', 'risk', 'followups'], properties: { summary: { type: 'string' }, risk: { type: 'string', enum: ['low', 'medium', 'high'] }, followups: { type: 'array', items: { type: 'string' } } } }, null, 2), model: LITE, effort: 'low', mode: 'dontAsk', schedule: { kind: 'weekly', time: '09:00', weekdays: [1], everyHours: 6, cron: '', enabled: true, vars: { since: '上周一' }, missed: 'runOnce' }, notify: 'failure' };
  const job2 = { ...job, id: 'job-deps', name: '依赖安全检查', prompt: '检查 package.json 的依赖有没有已知漏洞，列出需要升级的包。', schedule: { ...job.schedule, kind: 'daily', time: '08:30', vars: {} }, notify: 'always' };
  await c.call('setState', { jobs: [job, job2] });
  await c.call('runJob', job.id, { since: '上周一' }, 'manual');
  await c.wait(() => s().jobRuns?.some((r) => r.jobId === job.id && ['success', 'invalid', 'error'].includes(r.status)), 120_000, 'job run');

  await c.call('setState', { hookRules: [
    { id: 'h1', name: '禁止改迁移脚本', event: 'PreToolUse', matcher: 'Edit|Write', cond: { field: 'file_path', op: 'glob', value: '**/migrations/**' }, action: 'deny', text: '迁移脚本只能由人修改', timeout: 30, async: false, enabled: true, scope: 'global' },
    { id: 'h2', name: '会话开始时附上分支信息', event: 'SessionStart', matcher: '', action: 'context', text: '当前分支的命名规则：feat/<issue>-<slug>', timeout: 30, async: false, enabled: true, scope: 'workspace', workspaceId: shop.id },
    { id: 'h3', name: '回合结束通知', event: 'Stop', matcher: '', action: 'notify', text: '{{session}} 完成了一轮', timeout: 30, async: true, enabled: false, scope: 'global' },
  ] });
  if (process.env.DEMO_IDS) appendFileSync(process.env.DEMO_IDS, JSON.stringify(ids) + '\n');
  return ids;
}
