// The approval panel and the inbox in the browser (FR-PERM-03..07, FR-NTF-01).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setupUi, noPageErrors, type UiEnv } from '../harness/ui';
import { say, use } from '../harness/fake-model';
import { sleep, until } from '../harness/client';
import type { Item } from '@code-agent/shared/types';

let env: UiEnv;
let out: string;
before(async () => {
  env = await setupUi({ files: { 'a.txt': 'one\n' } });
  out = env.world.repo('outside', { 'x.txt': 'x\n', 'y.txt': 'y\n' }, { git: false });
});
after(() => env?.close());

const readOut = (f: string) => use('Read', { file_path: path.join(out, f) });
async function asking(tag: string, reads = ['x.txt']) {
  env.model.script(new RegExp(tag), [reads.map(readOut), [say('读完了')]]);
  const sid = await env.start(tag);
  await env.request(sid, 'approval');
  return sid;
}
const card = async (sid: string) => (await env.rt(sid)).items.flatMap((i) => (i.kind === 'tool' ? [i] : i.kind === 'toolgroup' ? i.tools : [])).find((t) => t.tool === 'Read') as Extract<Item, { kind: 'tool' }>;

test('the panel shows what Claude Code asks and why; the raw text on request; allow once (FR-PERM-03)', async () => {
  const sid = await asking('面板一');
  const p = await env.page(`/s/${sid}`);
  await p.waitEl('.dpanel.approval');
  assert.match(await p.text('.dpanel-head b'), /允许读取 .*x\.txt？/);
  assert.match(await p.text('.dpanel-body .row.ink2'), /Path is outside allowed working directories/);
  await p.click('.dpanel .link-btn', 'SDK 原文');
  assert.match(await p.text('.dpanel pre.code-block'), /"decisionReason"/);
  await p.click('.dpanel-foot .btn', '允许');
  await p.gone('.dpanel.approval');
  await until(async () => (await card(sid)).status === 'ok', 'read went through');
  noPageErrors(p);
  await p.close();
});

test('"allow, and don\'t ask again" lists Claude Code\'s suggestions, checked and editable; a bad rule blocks the button (FR-PERM-04)', async () => {
  const sid = await asking('面板二');
  const p = await env.page(`/s/${sid}`);
  await p.click('.dpanel .opt', '允许，且以后不再询问');
  await p.waitEl('.always-line');
  assert.equal((await p.texts('.always-line')).length, 1);
  assert.equal(await p.has('.always-line.off'), false, 'checked by default');
  assert.match(await p.value('.always-line input.input') ?? '', /^Read\(\/\/.*outside\/\*\*\)$/);
  assert.match(await p.text('.dpanel .always .select-btn'), /本会话/, 'kept for the session by default');
  const good = (await p.value('.always-line input.input'))!;
  await p.fill('.always-line input.input', 'Read(');
  await p.waitEl('.always-line input.invalid');
  assert.equal(await p.eval<boolean>(`__find('.dpanel-foot .btn', '允许并记住').disabled`), true);
  await p.fill('.always-line input.input', good);
  await p.click('.dpanel-foot .btn', '允许并记住');
  await p.gone('.dpanel.approval');
  await until(async () => (await card(sid)).provenance === '已由你批准，以后不再询问', 'kept');
  noPageErrors(p);
  await p.close();
});

test('deny with a note (FR-PERM-04)', async () => {
  const sid = await asking('面板三');
  const p = await env.page(`/s/${sid}`);
  await p.click('.dpanel .opt', '拒绝，并告诉 Claude 该怎么做');
  await p.type('.dpanel .extra input', '不用读外面的文件');
  await p.click('.dpanel-foot .btn', '拒绝并发送说明');
  await p.gone('.dpanel.approval');
  await until(async () => (await card(sid)).denialMessage === '不用读外面的文件', 'denied with the note');
  noPageErrors(p);
  await p.close();
});

test('stopping the turn from the panel with nothing queued: a message queued in a later turn asks nothing and goes out (review R1)', async () => {
  const sid = await asking('面板上停下');
  const p = await env.page(`/s/${sid}`);
  await p.click('.dpanel-foot .btn', '拒绝并停止本轮');
  await p.gone('.dpanel.approval');
  await until(async () => (await env.rt(sid)).state === 'idle', 'stopped');
  // A later turn that streams for a while, so a message sent meanwhile queues.
  env.model.script(/下一轮慢慢说/, [[say('这一轮慢慢说完。'.repeat(60))]], { slow: 300 });
  await p.type('.c-input', '下一轮慢慢说');
  await p.press('Enter');
  await p.waitEl('.c-right .btn', '中断');
  await p.type('.c-input', '排着的消息');
  await p.press('Enter');
  await p.waitEl('.queue', '排着的消息');
  await sleep(300);
  assert.equal(await p.eval('!!document.querySelector(".receipt")'), false, 'nothing was interrupted');
  await until(() => env.model.sent(/排着的消息/).length > 0, 'the queued message went out', 60_000);
  noPageErrors(p);
  await p.close();
});

test('two requests at once: the page says so, the second follows the first (FR-PERM-06)', async () => {
  const sid = await asking('面板四', ['x.txt', 'y.txt']);
  await until(() => env.c.sessions.get(sid)?.requests?.length === 2, 'both listed');
  const p = await env.page(`/s/${sid}`);
  await p.waitEl('.more-requests', 'Claude 同时提出了 2 个请求');
  const first = await p.text('.dpanel-head b');
  await p.click('.dpanel-foot .btn', '允许');
  await p.waitFor(`document.querySelector('.dpanel-head b')?.textContent !== ${JSON.stringify(first)}`, 'the second request');
  await p.gone('.more-requests');
  await p.click('.dpanel-foot .btn', '允许');
  await p.gone('.dpanel.approval');
  noPageErrors(p);
  await p.close();
});

test('the inbox lists every session\'s requests; a click opens the session; the tab title counts them (FR-PERM-06, FR-NTF-01)', async () => {
  const a = await asking('收件箱甲');
  const b = await asking('收件箱乙');
  const p = await env.page('/');
  await p.waitFor(`document.querySelector('.top-icon .badge')?.textContent === '2'`, 'badge 2');
  assert.match(await p.eval<string>('document.title'), /^\(2\) /);
  await p.click('.top-icon');
  await p.waitEl('.inbox .inbox-item');
  assert.equal((await p.texts('.inbox .inbox-item')).length, 2);
  await p.click('.inbox .inbox-item', '收件箱乙');
  await p.waitFor(`location.pathname === '/s/${b}'`, 'navigated to the session');
  await p.waitEl('.dpanel.approval');
  await p.click('.dpanel-foot .btn', '允许');
  await p.waitFor(`document.querySelector('.top-icon .badge')?.textContent === '1'`, 'badge 1');
  await env.c.call('respondApproval', a, (await env.rt(a)).request!.id, { behavior: 'allow' });
  await p.gone('.top-icon .badge');
  noPageErrors(p);
  await p.close();
});

test('a reload shows the waiting request again; answered in one tab it leaves the other (FR-SES-14, FR-PERM-07)', async () => {
  const sid = await asking('两个页面');
  const one = await env.page(`/s/${sid}`);
  const two = await env.page(`/s/${sid}`);
  await one.waitEl('.dpanel.approval');
  await one.reload();
  await one.waitEl('.dpanel.approval');
  await two.waitEl('.dpanel.approval');
  await one.click('.dpanel-foot .btn', '允许');
  await two.gone('.dpanel.approval');
  noPageErrors(one, two);
  await one.close();
  await two.close();
});

test('switching to "skip permission checks" asks first (FR-PERM-02)', async () => {
  env.model.script(/模式确认/, [[say('好')]]);
  const sid = await env.start('模式确认');
  await env.turns(sid);
  const p = await env.page(`/s/${sid}`);
  await p.click('.c-row2 .select-btn', '默认模式');
  await p.click('.menu-item', '跳过权限检查');
  await p.waitEl('.modal', '切换到「跳过权限检查」？');
  await p.click('.modal .btn', '取消');
  await p.gone('.modal');
  assert.equal((await env.rt(sid)).mode, 'default');
  await p.click('.c-row2 .select-btn', '默认模式');
  await p.click('.menu-item', '跳过权限检查');
  await p.click('.modal .btn', '切换');
  await until(async () => (await env.rt(sid)).mode === 'bypassPermissions', 'mode switched');
  noPageErrors(p);
  await p.close();
});
