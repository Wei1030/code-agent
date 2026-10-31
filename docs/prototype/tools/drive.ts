// Brings the demo Code Agent into the states the prototype shows: settings, workspaces, sessions in
// every state (finished, running, waiting for an approval / answer / plan / elicitation, with a
// subagent and a background task, peer sessions, a review loop), board items, jobs and hook rules.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { until } from '../../../test/harness/client';
import { finished } from '../../../test/harness/env';
import type { Client } from '../../../test/harness/client';
import type { FakeModel } from '../../../test/harness/fake-model';
import type { World } from '../../../test/harness/world';
import { cli } from '../../../test/harness/cli';
import type { BoardItem, Effort, PermissionMode } from '@code-agent/shared/types';

export const EP = 'ep-demo';
export const PRO = `ep:${EP}:demo-pro`;
export const LITE = `ep:${EP}:demo-lite`;

export type Ids = Record<string, string>;

export async function drive(c: Client, model: FakeModel, world: World & { repos: Record<string, string> }, log = console.log): Promise<Ids> {
  const repos = world.repos;
  const ids: Ids = {};
  const s = () => c.slices;
  const rt = async (sid: string) => (await c.call('openSession', sid))!;

  // ------------------------------------------------------------------ settings
  await c.call('setState', { provider: { ...s().provider, endpoints: [
    { id: EP, name: '演示服务', url: model.url, models: [{ name: 'demo-pro', effort: true }, { name: 'demo-lite', effort: false }] },
    { id: 'ep-old', name: '旧网关', url: model.url, models: [{ name: 'expired-1', effort: false }] },
  ] } });
  await c.call('setEndpointKey', EP, 'demo-token-2c41');
  await c.call('setEndpointKey', 'ep-old', 'old-token');
  await until(() => s().models?.some((m) => m.id === PRO), 'endpoint models', 15_000);
  await c.call('setState', {
    // The demo asks for approvals, so its screens can show them.
    profiles: s().profiles.map((p) => ({ ...p, model: PRO, effort: 'high' as Effort, mode: 'default' as const })),
    reviewProfile: { ...s().reviewProfile, model: PRO, effort: 'high', extraPrompt: '金额计算和参数校验要特别注意边界值。' },
    boardSettings: { ...s().boardSettings, recorder: true, recorderModel: LITE, recorderEffort: 'low' },
    maxRunning: 40,
    runtime: { ...s().runtime, debugLog: true },
    env: [{ id: 'env-1', key: 'NODE_OPTIONS', value: '--max-old-space-size=4096', note: '大仓库跑测试时内存不够' }],
  });

  // ------------------------------------------------------------------ workspaces
  // A session started in the claude CLI before the folder is added: it is listed as 外部.
  ids.external = (await cli(world, model, repos['shop-api'], '命令行里看一下 db.js 是怎么存数据的')).sessionId;
  const docs = await c.call('addWorkspace', repos['docs-site']);
  const web = await c.call('addWorkspace', repos['web-console']);
  const shop = await c.call('addWorkspace', repos['shop-api']);
  Object.assign(ids, { docs: docs.id, web: web.id, shop: shop.id });

  // Sessions meant to finish get their approvals granted, as a user would.
  const approve = new Set<string>();
  c.on((m) => {
    if (m.t === 'ev' && m.ev.t === 'request' && m.ev.request?.kind === 'approval' && approve.has(m.sid)) {
      void c.call('respondApproval', m.sid, m.ev.request.id, { behavior: 'allow' }).catch(() => undefined);
    }
  });
  async function session(ws: string, text: string, o: { mode?: PermissionMode; model?: string; wait?: boolean } = {}) {
    const sid = randomUUID();
    if (!o.wait) approve.add(sid);
    await c.call('createDraft', ws, sid);
    if (o.model) await c.call('setModel', sid, o.model);
    if (o.mode) await c.call('setMode', sid, o.mode);
    await c.call('send', sid, text, {});
    return sid;
  }
  const done = (sid: string, n = 1, ms = 120_000) => until(() => finished(c, sid) >= n, `turn ${n} of ${sid}`, ms);
  const request = (sid: string, kind: string) => until(async () => (await rt(sid)).request?.kind === kind, `${kind} in ${sid}`, 120_000);

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
  ids.ticket = (await c.call('startReview', ids.validate, ['npm test'], {}))!;
  await until(() => ['passed', 'needs_decision', 'checks_failed', 'stopped', 'accepted'].includes(s().reviews?.find((t) => t.id === ids.ticket)?.status ?? ''), 'review end', 300_000);
  log('review', s().reviews.find((t) => t.id === ids.ticket)?.status);

  // peer sessions: one creates another on its own worktree and gets a receipt
  ids.peer = await session(shop.id, 'web-console 要对接新的下单错误码。开一个会话在独立工作树里处理，处理完告诉我结果。', { mode: 'acceptEdits' });
  await done(ids.peer, 2, 180_000);
  ids.child = [...c.sessions.values()].find((x) => x.title === '对接下单错误码')?.id ?? '';
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
  await until(async () => (await rt(ids.running)).items.some((x) => x.kind === 'tool' && x.status === 'running' && /bench/.test(x.detail ?? '')), 'long command', 120_000);
  log('long command running');

  // an endpoint that refuses the token
  ids.rejected = await session(docs.id, '给快速开始补一段 curl 示例', { model: 'ep:ep-old:expired-1' });
  await until(async () => (await rt(ids.rejected)).items.some((x) => x.kind === 'banner'), 'endpoint banner', 60_000);

  // ------------------------------------------------------------------ board, jobs, hooks
  const item = (p: Partial<BoardItem> & Pick<BoardItem, 'kind' | 'title'>) => c.call('createItem', shop.id, p, { kind: 'manual' }).catch((e: Error) => log('board', e.message));
  await item({ kind: 'feature', title: '订单列表分页', body: 'listOrders 支持 cursor + limit，按创建时间倒序。前端订单页同步改成无限滚动。', status: 'doing', priority: 'normal', tasks: [{ id: 't1', text: '后端 cursor 分页', done: true }, { id: 't2', text: '前端无限滚动', done: false }], decisions: [{ id: 'd1', text: '分页方式：cursor 还是 offset？', outcome: 'cursor，避免翻页时数据重复' }] });
  await item({ kind: 'feature', title: '订单迁移到 SQLite', body: '用 node:sqlite 替换内存存储，接口不变。计划见会话「规划一下：把订单从内存存储迁到 SQLite」。', status: 'todo', priority: 'high', tasks: [], decisions: [{ id: 'd2', text: 'id 格式变成数字后前端是否兼容？' }] });
  await item({ kind: 'issue', title: '导出 CSV 时金额单位错误', body: 'total 列是分，表头写的是元。', status: 'confirmed', priority: 'high' });
  await item({ kind: 'issue', title: '取消已发货订单时报错信息不清楚', body: '返回 cannot cancel a shipped order，前端直接显示英文。', status: 'open', priority: 'normal' });
  await item({ kind: 'note', title: '金额统一用「分」为单位的整数', body: '所有接口和数据库字段都按分存储，展示时再换算。', status: 'active', priority: 'normal' });

  const job = { id: 'job-weekly', name: '每周变更摘要', workspaceId: shop.id, prompt: '总结 {{since}} 以来合入的提交：做了什么、风险高低、需要跟进的事。', schema: JSON.stringify({ type: 'object', required: ['summary', 'risk', 'followups'], properties: { summary: { type: 'string' }, risk: { type: 'string', enum: ['low', 'medium', 'high'] }, followups: { type: 'array', items: { type: 'string' } } } }, null, 2), model: LITE, effort: 'low' as Effort, mode: 'dontAsk' as PermissionMode, schedule: { kind: 'weekly' as const, time: '09:00', weekdays: [1], everyHours: 6, cron: '', enabled: true, vars: { since: '上周一' }, missed: 'runOnce' as const }, notify: 'failure' as const };
  const job2 = { ...job, id: 'job-deps', name: '依赖安全检查', prompt: '检查 package.json 的依赖有没有已知漏洞，列出需要升级的包。', schedule: { ...job.schedule, kind: 'daily' as const, time: '08:30', vars: {} }, notify: 'always' as const };
  await c.call('setState', { jobs: [job, job2] });
  await c.call('runJob', job.id, { since: '上周一' }, 'manual');
  await until(() => s().jobRuns?.some((r) => r.jobId === job.id && ['success', 'invalid', 'error'].includes(r.status)), 'job run', 120_000);

  await c.call('setState', { hookRules: [
    { id: 'h1', name: '禁止改迁移脚本', event: 'PreToolUse', matcher: 'Edit|Write', cond: { field: 'tool_input.file_path', op: 'glob', value: '**/migrations/**' }, action: 'deny', text: '迁移脚本只能由人修改', timeout: 30, async: false, enabled: true, scope: 'global' },
    { id: 'h2', name: '提交前提醒跑测试', event: 'UserPromptSubmit', matcher: '', cond: { field: 'prompt', op: 'contains', value: '提交' }, action: 'context', text: '提交前先跑 npm test。', timeout: 30, async: false, enabled: true, scope: 'workspace', workspaceId: shop.id },
    { id: 'h3', name: '回合结束通知', event: 'Stop', matcher: '', action: 'notify', text: '{{session}} 完成了一轮', timeout: 30, async: true, enabled: false, scope: 'global' },
  ] });
  log('board, jobs and hooks set');

  // ------------------------------------------------------------------ states of the screens added in v0.4
  // Two requests at once: reads of two files outside the workspace.
  ids.twoAsks = await session(shop.id, '对照一下设计稿和接口约定，看看下单接口有没有遗漏。', { wait: true });
  await until(() => (c.sessions.get(ids.twoAsks)?.requests?.length ?? 0) === 2, 'two requests', 120_000);
  // A question whose options have previews; an MCP server asking to sign in on a page.
  ids.preview = await session(shop.id, '订单列表页用哪种布局？给我看看样子。', { wait: true });
  await request(ids.preview, 'question');
  ids.signin = await session(shop.id, '把缺陷单同步到 Jira。');
  await request(ids.signin, 'elicitation');
  log('more requests waiting');

  // A review whose checks keep failing: it waits for the user's decision.
  const failing = (await c.call('startReview', ids.peer, ['node -e "process.exit(1)"'], {}))!;
  await until(() => s().reviews.find((t) => t.id === failing)?.status === 'checks_failed', 'checks failed', 240_000);
  // A change ready for a review that a screen starts.
  ids.reviewRun = await session(shop.id, '给 users.js 加上邮箱格式校验', { mode: 'acceptEdits' });
  await done(ids.reviewRun);

  // A message to another session held for the user.
  await c.call('setState', { peer: { ...s().peer, inbound: 'hold' } });
  ids.sender = await session(shop.id, `把错误码的结论告诉提问的那个会话。会话 ID：${ids.question}`);
  await until(() => s().held.length > 0, 'held message', 60_000);
  await done(ids.sender);
  await c.call('setState', { peer: { ...s().peer, inbound: 'parity' } });

  // A hook rule that fires (for its log), a job that missed runs.
  await c.call('send', ids.bg, '提交前还要注意什么？', {});
  await done(ids.bg, 2);
  await c.call('setState', { jobs: s().jobs.map((j) => (j.id === 'job-weekly' ? { ...j, missedRuns: 2 } : j)) });

  // A long conversation (it comes a page at a time), compacted at the end.
  ids.long = await session(web.id, '第 1 问：先列出订单页要的组件');
  await done(ids.long);
  for (let i = 2; i <= 90; i++) {
    await c.call('send', ids.long, `第 ${i} 问：接着说`, {});
    await done(ids.long, i);
  }
  await c.call('compact', ids.long, '保留组件清单和已经定下的分页方式');
  await until(async () => (await rt(ids.long)).items.some((x) => x.kind === 'divider' && /压缩/.test(x.label)), 'compacted', 60_000);
  log('long conversation done');

  // A session continued in the claude CLI after it was saved here.
  await c.call('stop', ids.docsStart);
  await until(() => c.sessions.get(ids.docsStart)?.live === false, 'saved');
  await cli(world, model, repos['docs-site'], '命令行里接着问：curl 示例放在哪一节？', { resume: ids.docsStart });

  // Claude Code ending unexpectedly.
  ids.crash = await session(web.id, '看看 App.tsx 还缺什么');
  await done(ids.crash);
  const pid = (await rt(ids.crash)).info?.pid;
  if (pid) execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  await until(async () => (await rt(ids.crash)).items.some((x) => x.kind === 'banner'), 'crash banner', 30_000);

  // Claude scheduled a wake-up and waits for it.
  ids.wake = await session(web.id, '夜间构建跑完之后帮我看一下结果');
  await done(ids.wake);
  await until(() => c.sessions.get(ids.wake)?.resume?.kind === 'wake', 'wake-up planned');
  log('extra states done');
  return ids;
}
