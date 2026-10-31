// Sending while Claude works: queue order and priorities, editing the queue, interrupting, context-only
// and verbatim messages, attachments and @-references (FR-IN-02/04/06/07/08/09).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { setup, finished, type Env } from '../harness/env';
import { say, shell, sleepCmd, type Req } from '../harness/fake-model';
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

test('messages sent during a turn wait, then go in order; "next" goes before "later" (FR-IN-06)', async () => {
  env.model.script(/^排队[一二三]/, [[say('好')]]);
  const sid = await busy('忙一会儿');
  await env.c.call('send', sid, '排队一', { priority: 'later' });
  await env.c.call('send', sid, '排队二', { priority: 'later' });
  await env.c.call('send', sid, '排队三', { priority: 'next' });
  const q = (await env.rt(sid)).queue.map((m) => m.text);
  assert.deepEqual(q, ['排队三', '排队一', '排队二']);
  await env.turns(sid, 4);
  assert.deepEqual(users((await env.rt(sid)).items), ['忙一会儿', '排队三', '排队一', '排队二']);
});

test('"insert now" reaches Claude at once; the running command goes on in the background (FR-IN-06, FR-BG-03)', async () => {
  const sid = await busy('插入测试', 8);
  // Claude Code moves a command to the background only once it has registered it as a task.
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'tool' && i.status === 'running' && i.backgroundable), 'a backgroundable command', 15_000);
  await env.c.call('send', sid, '顺便看看日志', { priority: 'now' });
  await until(() => env.model.requests.some((r) => r.tools.length && /顺便看看日志/.test(JSON.stringify(r.body.messages)) && /running in background/.test(JSON.stringify(r.body.messages))), 'the inserted message with the backgrounded command');
  const rt = await env.rt(sid);
  assert.equal(rt.queue.length, 0);
  assert.ok(rt.background.some((b) => b.kind === 'bash' && b.status === 'running'), 'the command keeps running in the background');
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
