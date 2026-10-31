// Sending while Claude works: queue order and priorities, editing the queue, interrupting, context-only
// and verbatim messages, attachments and @-references (FR-IN-02/04/06/07/08/09).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { setup, finished, type Env } from '../harness/env';
import { say, shell, sleepCmd, use, type Req } from '../harness/fake-model';
import { until, sleep } from '../harness/client';
import type { Item } from '@code-agent/shared/types';

let env: Env;
before(async () => { env = await setup(); });
after(() => env?.close());

const prompts = (rx: RegExp) => env.model.sent(rx).map((r) => r.prompt);
const users = (items: Item[]) => items.filter((i): i is Extract<Item, { kind: 'user' }> => i.kind === 'user').map((u) => u.text);
/** A session busy for a few seconds running a command (no approval in bypass mode). */
async function busy(tag: string, seconds = 4) {
  env.model.script(new RegExp(tag), [shell(sleepCmd(seconds)), [say(`${tag} 完成`)]]);
  const sid = await env.start(tag, { mode: 'bypassPermissions' });
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'tool' && i.status === 'running'), 'command running');
  return sid;
}

test('messages sent during a turn, saying nothing or "later", wait for it to end, then go in order as turns of their own (FR-IN-06)', async () => {
  env.model.script(/^排队[一二]/, [[say('好')]]);
  const sid = await busy('忙一会儿');
  await env.c.call('send', sid, '排队一', {});
  await env.c.call('send', sid, '排队二', { priority: 'later' });
  assert.deepEqual((await env.rt(sid)).queue.map((m) => [m.text, m.priority, !!m.sent]), [['排队一', 'later', false], ['排队二', 'later', false]]);
  await env.turns(sid, 3);
  assert.deepEqual(users((await env.rt(sid)).items), ['忙一会儿', '排队一', '排队二']);
});

test('"after tools" goes to Claude at once and is read in the same turn when the running command ends, shown there (FR-IN-06)', async () => {
  const sid = await busy('工具后测试', 5);
  await env.c.call('send', sid, '工具后读这句', { priority: 'next' });
  assert.deepEqual((await env.rt(sid)).queue.map((m) => [m.text, m.sent]), [['工具后读这句', true]], 'handed over: it can no longer change');
  await env.c.call('removeQueued', sid, (await env.rt(sid)).queue[0].id);
  assert.equal((await env.rt(sid)).queue.length, 1, 'not withdrawn: Claude Code holds it');
  await env.turns(sid);
  // The request after the command carries its result and then the message, in the turn that ran it.
  const req = env.model.sent(/工具后测试/).find((r) => /工具后读这句/.test(JSON.stringify(r.body.messages)));
  assert.ok(req, 'Claude read it');
  const body = JSON.stringify(req!.body.messages);
  assert.ok(body.indexOf('tool_result') < body.indexOf('工具后读这句'), 'after the command\'s result');
  const items = (await env.rt(sid)).items;
  assert.deepEqual(items.filter((i) => i.kind === 'user' || i.kind === 'tool' || i.kind === 'footer').map((i) => (i.kind === 'user' ? i.text : i.kind)), ['工具后测试', 'tool', '工具后读这句', 'footer'], 'shown after the command, in one turn');
  assert.deepEqual((await env.rt(sid)).queue, []);
});

test('"insert now" reaches Claude at once; the running command goes on in the background (FR-IN-06, FR-BG-03)', async () => {
  const sid = await busy('插入测试', 8);
  // Claude Code moves a command to the background only once it has registered it as a task.
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'tool' && i.status === 'running' && i.backgroundable), 'a backgroundable command', 15_000);
  await env.c.call('send', sid, '顺便看看日志', { priority: 'now' });
  await until(() => env.model.requests.some((r) => r.tools.length && /顺便看看日志/.test(JSON.stringify(r.body.messages)) && /running in background|manually backgrounded/.test(JSON.stringify(r.body.messages))), 'the inserted message with the backgrounded command');
  const rt = await env.rt(sid);
  assert.equal(rt.queue.length, 0);
  assert.ok(rt.background.some((b) => b.kind === 'bash' && b.status === 'running'), 'the command keeps running in the background');
});

const reached = (text: string) => env.model.requests.some((r) => r.body.messages && JSON.stringify(r.body.messages).includes(text));

test('an interrupt takes back an "after tools" message Claude has not read: it waits with the queue for the user\'s choice (FR-IN-07, review R1)', async () => {
  const sid = await busy('中断收回', 15);
  env.model.script(/^收回的话$/, [[say('收回的话 读到了')]]);
  await env.c.call('send', sid, '收回的话', { priority: 'next' });
  assert.equal((await env.rt(sid)).queue[0].sent, true);
  const left = await env.c.call('interrupt', sid);
  assert.deepEqual(left.map((m) => m.text), ['收回的话'], 'counted on the interrupt receipt');
  await env.turns(sid);
  await sleep(3000);
  assert.ok(!reached('收回的话'), 'Claude does not run it by itself');
  assert.deepEqual((await env.rt(sid)).queue.map((m) => [m.text, !!m.sent]), [['收回的话', false]], 'it waits, and can change again');
  await env.c.call('runQueued', sid);
  await until(() => reached('收回的话'), 'it runs once the user says so');
});

test('denying a tool call and stopping takes back an "after tools" message too: it waits for the user\'s choice (review R7)', async () => {
  env.model.script(/^要审批的命令$/, [shell(sleepCmd(2)), [say('不该走到这里')]]);
  env.model.script(/^拒绝后收回的话$/, [[say('拒绝后收回的话 读到了')]]);
  // The tests' profile asks before running a command.
  const sid = await env.start('要审批的命令');
  const req = await until(async () => (await env.rt(sid)).request, 'the command asks for approval');
  await env.c.call('send', sid, '拒绝后收回的话', { priority: 'next' });
  assert.equal((await env.rt(sid)).queue[0]?.sent, true);
  await env.c.call('respondApproval', sid, req.id, { behavior: 'deny', interrupt: true });
  await env.turns(sid);
  await sleep(3000);
  assert.ok(!reached('拒绝后收回的话'), 'Claude does not run it by itself');
  assert.deepEqual((await env.rt(sid)).queue.map((m) => [m.text, !!m.sent]), [['拒绝后收回的话', false]], 'it waits, and can change again');
  assert.equal(((await env.rt(sid)).items.find((i) => i.kind === 'footer') as { stopReason?: string }).stopReason, 'interrupted');
  assert.equal((await env.rt(sid)).queueHeld, true, 'the page asks whether to run it');
  await env.c.call('runQueued', sid);
  await until(() => reached('拒绝后收回的话'), 'it runs once the user says so');
  assert.ok(!(await env.rt(sid)).queueHeld, 'a turn started: nothing is held any more');
});

test('denying a subagent\'s tool call and stopping stops that subagent only: the turn goes on and ends as usual (review R10)', async () => {
  // The subagent goes to the background; the turn goes on writing slowly while the subagent asks.
  env.model.script(/^派子代理后接着说$/, [[use('Agent', { description: '要审批的子代理', subagent_type: 'general-purpose', prompt: '子任务：跑个要审批的命令' })], [say('主线程还在说，'.repeat(60))]], { slow: 50 });
  env.model.script(/子任务：跑个要审批的命令/, [shell(sleepCmd(1)), [say('子代理完了')]]);
  const sid = await env.start('派子代理后接着说');
  const req = await until(async () => { const r = (await env.rt(sid)).request; return r?.kind === 'approval' && r.agent ? r : undefined; }, 'the subagent asks', 30_000);
  assert.ok((await env.rt(sid)).background.some((b) => b.kind === 'agent'), 'the subagent runs in the background');
  await env.c.call('respondApproval', sid, req.id, { behavior: 'deny', interrupt: true });
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'footer'), 'the turn ends', 60_000);
  const footer = (await env.rt(sid)).items.find((i) => i.kind === 'footer') as { stopReason?: string };
  assert.notEqual(footer.stopReason, 'interrupted', 'the turn was not stopped');
  assert.ok(!(await env.rt(sid)).queueHeld, 'nothing to ask about the queue');
});

test('denying a foreground subagent\'s tool call and stopping stops the turn: an "after tools" message is taken back (review R11)', async () => {
  // A foreground subagent shares the turn's stop: denying and stopping its request stops the turn.
  env.model.script(/^等前台子代理$/, [[use('Agent', { description: '前台子代理', subagent_type: 'general-purpose', prompt: '子任务：前台跑个要审批的命令', run_in_background: false })], [say('不该走到这里')]]);
  env.model.script(/子任务：前台跑个要审批的命令/, [shell(sleepCmd(1)), [say('子代理完了')]]);
  env.model.script(/^前台停下后收回的话$/, [[say('前台停下后收回的话 读到了')]]);
  const sid = await env.start('等前台子代理');
  const req = await until(async () => { const r = (await env.rt(sid)).request; return r?.kind === 'approval' && r.agent ? r : undefined; }, 'the subagent asks', 30_000);
  assert.ok(!(await env.rt(sid)).background.some((b) => b.kind === 'agent'), 'a foreground subagent');
  await env.c.call('send', sid, '前台停下后收回的话', { priority: 'next' });
  assert.equal((await env.rt(sid)).queue[0]?.sent, true);
  await env.c.call('respondApproval', sid, req.id, { behavior: 'deny', interrupt: true });
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'footer'), 'the turn ends', 60_000);
  await sleep(3000);
  assert.equal(((await env.rt(sid)).items.find((i) => i.kind === 'footer') as { stopReason?: string }).stopReason, 'interrupted');
  assert.ok(!reached('前台停下后收回的话'), 'Claude does not run it by itself');
  assert.deepEqual((await env.rt(sid)).queue.map((m) => [m.text, !!m.sent]), [['前台停下后收回的话', false]], 'it waits for the user\'s choice');
  assert.equal((await env.rt(sid)).queueHeld, true);
});

test('a foreground subagent moved to the background while its request waits: denying and stopping it then stops that subagent only (review R12)', async () => {
  env.model.script(/^前台转后台再拒绝$/, [[use('Agent', { description: '先在前台的子代理', subagent_type: 'general-purpose', prompt: '子任务：转后台前要审批', run_in_background: false })], [say('主线程接着说，'.repeat(60))]], { slow: 50 });
  env.model.script(/子任务：转后台前要审批/, [shell(sleepCmd(1)), [say('子代理完了')]]);
  const sid = await env.start('前台转后台再拒绝');
  const req = await until(async () => { const r = (await env.rt(sid)).request; return r?.kind === 'approval' && r.agent ? r : undefined; }, 'the subagent asks', 30_000);
  assert.ok(!(await env.rt(sid)).background.some((b) => b.kind === 'agent'), 'in the foreground when it asks');
  await env.c.call('backgroundAll', sid);
  await until(async () => (await env.rt(sid)).background.some((b) => b.kind === 'agent'), 'the subagent went to the background while its request waits', 15_000);
  await env.c.call('respondApproval', sid, req.id, { behavior: 'deny', interrupt: true });
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'footer'), 'the turn ends', 60_000);
  assert.notEqual(((await env.rt(sid)).items.find((i) => i.kind === 'footer') as { stopReason?: string }).stopReason, 'interrupted', 'the turn goes on and ends as usual');
  assert.ok(!(await env.rt(sid)).queueHeld, 'nothing to ask about the queue');
});

test('an interrupt with nothing queued holds nothing: a message queued while the process restarts asks nothing and goes out (review I-3)', async () => {
  env.model.script(/^停下时没排队$/, [shell(sleepCmd(30)), [say('不该走到这里')]]);
  env.model.script(/^重启时排的$/, [[say('重启时排的 读到了')]]);
  const sid = await env.start('停下时没排队', { mode: 'bypassPermissions' });
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'tool' && i.status === 'running'), 'the command runs');
  await env.c.call('interrupt', sid);
  await until(async () => (await env.rt(sid)).state === 'idle', 'stopped');
  assert.ok(!(await env.rt(sid)).queueHeld, 'nothing waits, so nothing is held');
  // Another endpoint's model: the process restarts, and a message sent meanwhile queues.
  const switching = env.c.call('setModel', sid, 'ep:ep-test:model-two');
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'notice' && /已换到/.test(i.text)), 'restarting');
  await env.c.call('send', sid, '重启时排的', {});
  assert.ok(!(await env.rt(sid)).queueHeld);
  await switching;
  await until(() => reached('重启时排的'), 'it goes out once the process runs');
});

test('a turn that starts while a background subagent\'s request waits lets go of what the interrupt held (review I-3)', async () => {
  // The main thread writes slowly after starting a subagent in the background, which asks only later.
  env.model.script(/^停下后子代理才问$/, [[use('Agent', { description: '晚点才问的子代理', subagent_type: 'general-purpose', prompt: '子任务：过一会儿才要审批' })], [say('主线程慢慢说，'.repeat(60))]], { slow: 100 });
  env.model.script(/子任务：过一会儿才要审批/, [(r) => [say('子代理先想一想，'.repeat(60)), ...shell(sleepCmd(1))(r)], [say('子代理完了')]], { slow: 100 });
  env.model.script(/^新的一轮$/, [[say('新的一轮 读到了')]]);
  const sid = await env.start('停下后子代理才问');
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'text' && i.streaming), 'the main thread writing');
  await env.c.call('send', sid, '停下时排着的', { priority: 'later' });
  await env.c.call('interrupt', sid);
  await until(async () => (await env.rt(sid)).queueHeld, 'the queue waits for the user');
  await until(async () => { const r = (await env.rt(sid)).request; return r?.kind === 'approval' && r.agent; }, 'the subagent asks after the stop', 30_000);
  assert.equal((await env.rt(sid)).state, 'requires_action');
  await env.c.call('send', sid, '新的一轮', {});
  await until(async () => !(await env.rt(sid)).queueHeld, 'a turn started: nothing is held any more');
});

test('"after tools" still unread when the turn ends goes first, as its own turn; the queue waits for it (review R2)', async () => {
  env.model.script(/^慢慢说完$/, [[say('这一段说得很慢，'.repeat(30))]], { slow: 40 });
  env.model.script(/^工具后补一句$/, [[say('补一句 读到了')]]);
  env.model.script(/^下一轮的话$/, [[say('下一轮 读到了')]]);
  const sid = await env.start('慢慢说完');
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'text' && i.streaming), 'the last reply streaming');
  await env.c.call('send', sid, '下一轮的话', { priority: 'later' });
  await env.c.call('send', sid, '工具后补一句', { priority: 'next' });
  await env.turns(sid, 3);
  const items = (await env.rt(sid)).items;
  assert.deepEqual(items.filter((i) => i.kind === 'user' || i.kind === 'footer').map((i) => (i.kind === 'user' ? i.text : i.kind)), ['慢慢说完', 'footer', '工具后补一句', 'footer', '下一轮的话', 'footer'], 'each its own turn, in order');
  const after = (text: string) => items.findIndex((i) => i.kind === 'user' && i.text === text);
  assert.ok(items.findIndex((i) => i.kind === 'text' && /补一句 读到了/.test(i.text)) > after('工具后补一句'), 'its reply in its own turn');
  assert.ok(items.findIndex((i) => i.kind === 'text' && /下一轮 读到了/.test(i.text)) > after('下一轮的话'));
});

test('insert now with background tasks switched off still reaches Claude, once the command ends (review R3)', async () => {
  const before = env.c.slices.env;
  await env.c.call('setState', { env: [...before, { id: 'nobg', key: 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS', value: '1', note: '' }] });
  const sid = await busy('关了后台', 4);
  await env.c.call('setState', { env: before });
  await env.c.call('send', sid, '关了后台也要读到', { priority: 'now' });
  await until(() => reached('关了后台也要读到'), 'reaches Claude', 30_000);
  assert.ok((await env.rt(sid)).stderr.some((l) => /没能把运行中的工作转入后台/.test(l)), 'why it waited is in the log');
});

test('insert now a second into a command, before Claude Code makes it a task: it goes to the background once it is one (review R4)', async () => {
  const sid = await busy('刚开始的命令', 30);
  // Running, but Claude Code makes a command a task only after two or three seconds.
  await sleep(1000);
  const t0 = Date.now();
  await env.c.call('send', sid, '命令刚开始时插入的话', { priority: 'now' });
  await until(() => env.model.requests.some((r) => /命令刚开始时插入的话/.test(JSON.stringify(r.body.messages)) && /running in background|manually backgrounded/.test(JSON.stringify(r.body.messages))), 'read with the command in the background', 20_000);
  assert.ok(Date.now() - t0 < 10_000, 'without waiting for the 30-second command');
  assert.ok((await env.rt(sid)).background.some((b) => b.kind === 'bash' && b.status === 'running'), 'the command goes on in the background');
});

test('queued messages can be edited, re-prioritised and removed', async () => {
  const sid = await busy('编辑队列', 5);
  await env.c.call('send', sid, '原来的话', { priority: 'later' });
  await env.c.call('send', sid, '要删的话', { priority: 'later' });
  let q = (await env.rt(sid)).queue;
  await env.c.call('updateQueued', sid, q[0].id, { text: '改过的话' });
  await env.c.call('removeQueued', sid, q[1].id);
  q = (await env.rt(sid)).queue;
  assert.deepEqual(q.map((m) => m.text), ['改过的话']);
  env.model.script(/改过的话/, [[say('收到改过的')]]);
  await env.turns(sid, 2);
  assert.deepEqual(users((await env.rt(sid)).items).slice(-1), ['改过的话']);
  assert.equal(prompts(/要删的话/).length, 0);
});

test('after an interrupt the queued messages wait for the user\'s choice (FR-IN-07, issue 10-30#5)', async () => {
  const sid = await busy('中断测试', 20);
  await env.c.call('send', sid, '中断后的消息', { priority: 'later' });
  const left = await env.c.call('interrupt', sid);
  assert.deepEqual(left.map((m) => m.text), ['中断后的消息']);
  await env.turns(sid);
  await sleep(1500);
  assert.equal(prompts(/中断后的消息/).length, 0, 'nothing is sent before the user says so');
  assert.deepEqual((await env.rt(sid)).queue.map((m) => m.text), ['中断后的消息']);
  env.model.script(/中断后的消息/, [[say('现在才处理')]]);
  const done = finished(env.c, sid);
  await env.c.call('runQueued', sid);
  await env.turns(sid, done + 1);
  assert.ok(prompts(/中断后的消息/).length > 0, '保留并执行 sends it');
  assert.equal((await env.rt(sid)).queue.length, 0);
});

test('cancelling the queue after an interrupt drops every message (FR-IN-07)', async () => {
  const sid = await busy('中断取消', 20);
  await env.c.call('send', sid, '不要了一', { priority: 'later' });
  await env.c.call('send', sid, '不要了二', { priority: 'later' });
  await env.c.call('interrupt', sid);
  await env.c.call('removeQueued', sid);
  await env.turns(sid);
  await sleep(1500);
  assert.equal(prompts(/不要了/).length, 0);
  assert.equal((await env.rt(sid)).queue.length, 0);
});

test('"context only" adds to the conversation without a turn; Claude reads it next time (FR-IN-08)', async () => {
  env.model.script(/上下文一/, [[say('好')]]);
  const sid = await env.start('上下文一');
  await env.turns(sid);
  const before = env.model.requests.length;
  await env.c.call('send', sid, '附上日志：ERROR 42 at checkout', { contextOnly: true });
  await sleep(1500);
  assert.equal(env.model.requests.length, before, 'no request to the model');
  assert.ok((await env.rt(sid)).items.some((i) => i.kind === 'notice' && /未开始新一轮/.test(i.text)));
  env.model.script(/看看刚才的日志/, [[say('看到了 ERROR 42')]]);
  await env.c.call('send', sid, '看看刚才的日志', {});
  await env.turns(sid, 2);
  assert.match(JSON.stringify(env.model.sent(/看看刚才的日志/)[0].body.messages), /ERROR 42 at checkout/);
});

test('"send as is" passes a slash text to Claude instead of running a command (FR-IN-09)', async () => {
  env.model.script(/\/deploy-now/, [[say('这只是文字')]]);
  const sid = await env.start('/deploy-now 生产环境', { send: { verbatim: true } });
  await env.turns(sid);
  assert.ok(env.model.sent(/\/deploy-now 生产环境/).length > 0);
});

test('attachments: an image goes as an image, a text file with its content, a binary by name (FR-IN-02, FR-IN-04)', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  env.model.script(/看附件/, [[say('看到了')]]);
  const sid = await env.start('看附件', { send: { attachments: [
    { id: 'a1', kind: 'image', name: 'dot.png', meta: '1 KB', content: png },
    { id: 'a2', kind: 'file', name: 'config.yml', meta: '1 KB', content: 'port: 8080\n' },
    { id: 'a3', kind: 'file', name: 'app.exe', meta: '2 MB · 二进制，只发送文件名' },
    { id: 'a4', kind: 'paste', name: '粘贴的文本', meta: '20 行', content: Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') },
  ] } });
  await env.turns(sid);
  const req: Req = env.model.sent(/看附件/)[0];
  const content = req.body.messages.filter((m: any) => m.role === 'user').flatMap((m: any) => (Array.isArray(m.content) ? m.content : []));
  assert.ok(content.some((b: any) => b.type === 'image'), 'image block');
  const all = JSON.stringify(content);
  assert.match(all, /port: 8080/);
  assert.match(all, /config\.yml/);
  assert.match(all, /app\.exe/);
  assert.match(all, /line 19/);
  const u = (await env.rt(sid)).items.find((i) => i.kind === 'user') as Extract<Item, { kind: 'user' }>;
  assert.equal(u.attachments.length, 4, 'the transcript lists the attachments');
});

test('an @-referenced session reaches Claude as a block; the transcript shows the plain text', async () => {
  env.model.script(/被引用的会话/, [[say('我是被引用的那个，结论是用 SQLite。')]]);
  const other = await env.start('被引用的会话');
  await env.turns(other);
  env.model.script(/参考一下/, [[say('看到了')]]);
  const sid = await env.start('参考一下 @会话「被引用的会话」', { send: { refs: [{ sessionId: other, title: '被引用的会话' }] } });
  await env.turns(sid);
  const sent = JSON.stringify(env.model.sent(/参考一下/)[0].body.messages);
  assert.match(sent, /referenced-sessions/);
  assert.match(sent, /用 SQLite/);
  assert.deepEqual(users((await env.rt(sid)).items), ['参考一下 @会话「被引用的会话」']);
});

test('/context is answered by Code Agent without asking the model', async () => {
  env.model.script(/本地命令前/, [[say('好')]]);
  const sid = await env.start('本地命令前');
  await env.turns(sid);
  const n = env.model.requests.length;
  await env.c.call('send', sid, '/context', {});
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'notice' && /上下文用量/.test(i.text)), 'context notice');
  assert.equal(env.model.requests.filter((r, k) => k >= n && r.tools.length > 0).length, 0);
});
