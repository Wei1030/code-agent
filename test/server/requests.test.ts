// Questions, plan review and MCP elicitations: the docked requests other than approvals
// (FR-ASK-01..05, FR-PLAN-01/02/03, FR-MCP-06, FR-TOOL-08, FR-TOOL-10).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { setup, type Env } from '../harness/env';
import { say, use, plan } from '../harness/fake-model';
import { until } from '../harness/client';
import type { Item, PendingRequest } from '@code-agent/shared/types';

let env: Env;
before(async () => {
  env = await setup();
  env.world.mcp('tracker', env.world.tracker());
});
after(() => env?.close());

const QUESTIONS = { questions: [
  { header: '数据库', question: '用哪种数据库？', multiSelect: false, options: [{ label: 'SQLite', description: '单文件' }, { label: 'PostgreSQL', description: '要单独部署' }] },
  { header: '范围', question: '要迁移哪些表？', multiSelect: true, options: [{ label: '订单', description: 'orders' }, { label: '用户', description: 'users' }] },
] };
/** The last tool result Claude Code sent to the model after a prompt. */
const lastToolResult = (rx: RegExp) => JSON.stringify(env.model.sent(rx).at(-1)!.body.messages.findLast((m: any) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result')));
const planItems = async (sid: string) => (await env.rt(sid)).items.filter((i): i is Extract<Item, { kind: 'plan' }> => i.kind === 'plan');

test('a question: steps, single and multiple choice, notes; Claude gets the answers (FR-ASK-01/02/04)', async () => {
  env.model.script(/选数据库/, [[use('AskUserQuestion', QUESTIONS)], [say('按你的选择来')]]);
  const sid = await env.start('选数据库');
  const r = (await env.request(sid, 'question')) as Extract<PendingRequest, { kind: 'question' }>;
  assert.equal(r.questions.length, 2);
  assert.equal(r.questions[1].multiSelect, true);
  assert.deepEqual(env.c.sessions.get(sid)?.requests?.map((q) => q.title), ['Claude 有问题要问你']);
  await env.c.call('respondQuestion', sid, r.id, { answers: { '用哪种数据库？': 'SQLite', '要迁移哪些表？': '订单, 用户' }, notes: { '用哪种数据库？': '先用着，以后再换' } });
  await env.turns(sid);
  const res = lastToolResult(/选数据库/);
  assert.match(res, /SQLite/);
  assert.match(res, /订单, 用户/);
  const card = (await env.rt(sid)).items.find((i) => i.kind === 'tool' && i.tool === 'AskUserQuestion') as Extract<Item, { kind: 'tool' }>;
  assert.equal(card.status, 'ok');
});

test('a message typed while a question waits answers it in the user\'s own words (FR-ASK-02)', async () => {
  env.model.script(/再选一次/, [[use('AskUserQuestion', QUESTIONS)], [say('明白')]]);
  const sid = await env.start('再选一次');
  await env.request(sid, 'question');
  await env.c.call('send', sid, '都不要，先保持内存存储', {});
  await env.turns(sid);
  assert.match(lastToolResult(/再选一次/), /先保持内存存储/);
});

test('options with previews: HTML by default, Markdown when the profile turns HTML previews off (FR-ASK-03, FR-CFG-09)', async () => {
  const ask = (preview: string) => ({ questions: [{ header: '布局', question: '列表页用哪种布局？', multiSelect: false, options: [{ label: '表格', description: '密集', preview }, { label: '卡片', description: '宽松', preview }] }] });
  const tool = (rx: RegExp) => JSON.stringify(env.model.sent(rx)[0].body.tools.find((t: { name: string }) => t.name === 'AskUserQuestion'));
  env.model.script(/HTML 预览/, [[use('AskUserQuestion', ask('<table><tr><td>订单</td></tr></table>'))], [say('好')]]);
  let sid = await env.start('HTML 预览');
  let r = (await env.request(sid, 'question')) as Extract<PendingRequest, { kind: 'question' }>;
  assert.equal(r.questions[0].options[0].preview, '<table><tr><td>订单</td></tr></table>');
  assert.match(tool(/HTML 预览/), /HTML/);
  await env.c.call('respondQuestion', sid, r.id, { answers: { '列表页用哪种布局？': '表格' }, notes: {} });
  await env.turns(sid);

  const prev = env.c.slices.profiles;
  await env.c.call('setState', { profiles: prev.map((p) => ({ ...p, questionPreviews: false })) });
  env.model.script(/Markdown 预览/, [[use('AskUserQuestion', ask('| 订单 |\n|---|'))], [say('好')]]);
  sid = await env.start('Markdown 预览');
  r = (await env.request(sid, 'question')) as Extract<PendingRequest, { kind: 'question' }>;
  assert.equal(r.questions[0].options[1].preview, '| 订单 |\n|---|');
  assert.notEqual(tool(/Markdown 预览/), tool(/HTML 预览/), 'Claude Code is told the other format');
  await env.c.call('respondQuestion', sid, r.id, { answers: { '列表页用哪种布局？': '卡片' }, notes: {} });
  await env.turns(sid);
  await env.c.call('setState', { profiles: prev });
});

test('without the question tool in the profile Claude does not get it (FR-ASK-05)', async () => {
  const prev = env.c.slices.profiles;
  await env.c.call('setState', { profiles: prev.map((p) => ({ ...p, tools: p.tools.filter((t) => t !== 'AskUserQuestion') })) });
  env.model.script(/没有提问工具/, [[say('好')]]);
  const sid = await env.start('没有提问工具');
  await env.turns(sid);
  assert.ok(!env.model.sent(/没有提问工具/)[0].tools.includes('AskUserQuestion'));
  await env.c.call('setState', { profiles: prev });
});

const PLAN = (v: number) => plan(`# 迁移计划 v${v}\n\n## 步骤\n1. 建表\n2. 改 \`src/db.js\`\n`);

test('plan review: revise with feedback, then approve with accept-edits (FR-PLAN-01, FR-PLAN-03)', async () => {
  env.model.script(/做个计划/, [...PLAN(1), ...PLAN(2), [say('开始实施')]]);
  const sid = await env.start('做个计划', { mode: 'plan' });
  let r = await env.request(sid, 'plan');
  let plans = await planItems(sid);
  assert.deepEqual(plans.map((p) => [p.version, p.status]), [[1, 'pending']]);
  assert.match(plans[0].plan.markdown ?? '', /迁移计划 v1/);
  await env.c.call('respondPlan', sid, r.id, { approve: false, feedback: '先写测试再改代码' });
  r = await until(async () => { const x = (await env.rt(sid)).request; return x && x.id !== r.id && x.kind === 'plan' ? x : null; }, 'second plan');
  assert.ok(env.model.sent(/做个计划/).some((x) => JSON.stringify(x.body.messages).includes('先写测试再改代码')), 'Claude got the feedback');
  assert.equal((await env.rt(sid)).mode, 'plan', 'still planning');
  await env.c.call('respondPlan', sid, r.id, { approve: true, mode: 'acceptEdits' });
  await env.turns(sid);
  plans = await planItems(sid);
  assert.deepEqual(plans.map((p) => [p.version, p.status]), [[1, 'revised'], [2, 'approved']]);
  assert.equal((await env.rt(sid)).mode, 'acceptEdits');
});

test('the profile\'s plan-mode instructions reach Claude Code (FR-PLAN-02)', async () => {
  const prev = env.c.slices.profiles;
  await env.c.call('setState', { profiles: prev.map((p) => ({ ...p, planInstructions: '计划里必须写回滚方式XYZ' })) });
  env.model.script(/计划说明/, [[say('好')]]);
  const sid = await env.start('计划说明', { mode: 'plan' });
  await env.turns(sid);
  assert.match(JSON.stringify(env.model.sent(/计划说明/)[0].body), /计划里必须写回滚方式XYZ/);
  await env.c.call('setState', { profiles: prev });
});

test('an MCP form elicitation: fields from the schema; accept, decline and cancel reach the server (FR-MCP-06)', async () => {
  env.model.script(/记一个缺陷/, [[use('mcp__tracker__create_issue', { title: '导出金额错' })], [say('好')]]);
  const sid = await env.start('记一个缺陷', { mode: 'bypassPermissions' });
  const r = (await env.request(sid, 'elicitation')) as Extract<PendingRequest, { kind: 'elicitation' }>;
  assert.equal(r.mode, 'form');
  assert.equal(r.server, 'tracker');
  assert.match(r.message, /导出金额错/);
  const f = Object.fromEntries((r.fields ?? []).map((x) => [x.key, x]));
  assert.deepEqual(f.priority.options, ['高', '中', '低']);
  assert.equal(f.priority.required, true);
  assert.equal(f.estimate.type, 'number');
  assert.equal(f.estimate.min, 1);
  assert.equal(f.notify.type, 'boolean');
  await env.c.call('respondElicitation', sid, r.id, { action: 'accept', content: { priority: '高', estimate: 3, notify: false } });
  await env.turns(sid);
  assert.match(lastToolResult(/记一个缺陷/), /已创建：优先级 高，预估 3 天，通知 false/);

  for (const action of ['decline', 'cancel'] as const) {
    env.model.script(new RegExp(`再记一个${action}`), [[use('mcp__tracker__create_issue', { title: action })], [say('好')]]);
    const s2 = await env.start(`再记一个${action}`, { mode: 'bypassPermissions' });
    const r2 = await env.request(s2, 'elicitation');
    await env.c.call('respondElicitation', s2, r2.id, { action });
    await env.turns(s2);
    assert.match(lastToolResult(new RegExp(`再记一个${action}`)), new RegExp(`没有创建（${action}）`));
  }
});

test('an MCP elicitation that opens a page continues once the user went there (FR-MCP-06)', async () => {
  env.model.script(/登录缺陷系统/, [[use('mcp__tracker__login', {})], [say('好')]]);
  const sid = await env.start('登录缺陷系统', { mode: 'bypassPermissions' });
  const r = (await env.request(sid, 'elicitation')) as Extract<PendingRequest, { kind: 'elicitation' }>;
  assert.equal(r.mode, 'url');
  assert.equal(r.url, 'https://example.com/login?code=42');
  await env.c.call('openElicitationUrl', sid, r.id);
  await env.turns(sid);
  assert.match(lastToolResult(/登录缺陷系统/), /已登录/);
});
