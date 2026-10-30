// Losing and regaining the connection, toasts and system notifications (FR-SES-14, FR-NTF-01).
// The operating system's own notification popup cannot be checked; what the app asks the browser
// to show, when, and where a click leads can.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setupUi, noPageErrors, type UiEnv } from '../harness/ui';
import { say, use } from '../harness/fake-model';
import { sleep } from '../harness/client';

let env: UiEnv;
let out: string;
before(async () => {
  env = await setupUi();
  out = env.world.repo('outside', { 'x.txt': 'x\n' }, { git: false });
});
after(() => env?.close());

async function asking(tag: string) {
  env.model.script(new RegExp(tag), [[use('Read', { file_path: path.join(out, 'x.txt') })], [say('好')]]);
  return env.start(tag);
}
const notes = (p: import('../harness/browser').Page) => p.eval<Array<{ title: string; body?: string }>>(`window.__notifications.map((n) => ({ title: n.title, body: n.opts.body }))`);

test('offline: a bar says so and the session goes on; back online a request made meanwhile shows (FR-SES-14)', async () => {
  env.model.script(/断线前/, [[say('好')]]);
  const sid = await env.start('断线前');
  await env.turns(sid);
  const p = await env.page(`/s/${sid}`);
  await p.cutConnection(true);
  await p.waitEl('.conn-bar.offline', '连接已断开');
  env.model.script(/断线期间/, [[use('Read', { file_path: path.join(out, 'x.txt') })], [say('好')]]);
  await env.c.call('send', sid, '断线期间', {});
  await env.request(sid, 'approval');
  await sleep(500);
  assert.equal(await p.has('.dpanel.approval'), false, 'nothing arrives while offline');
  await p.online();
  await p.waitEl('.conn-bar', '已重连', 20_000);
  await p.waitEl('.dpanel.approval');
  await p.gone('.conn-bar', undefined, 10_000);
  noPageErrors(p);
  await p.close();
});

test('a request in another session: a toast with 去处理, a system notification while the tab is in the background (FR-NTF-01)', async () => {
  const p = await env.page('/settings/general');
  await sleep(2600); // requests already open when a page loads are not announced
  await p.away(true);
  const sid = await asking('后台时的请求');
  await p.waitFor(`window.__notifications.length > 0`, 'a system notification');
  const [n] = await notes(p);
  assert.match(n.title, /「后台时的请求」等你处理/);
  await p.away(false);
  await p.waitEl('.toast', '后台时的请求');
  await p.click('.toast button', '去处理');
  await p.waitFor(`location.pathname === '/s/${sid}'`, 'the toast leads to the session');
  noPageErrors(p);
  await p.close();
});

test('no toast for the session being looked at; none when the reminder is off (FR-NTF-01)', async () => {
  env.model.script(/正在看的会话/, [[say('好')]]);
  const sid = await env.start('正在看的会话');
  await env.turns(sid);
  const p = await env.page(`/s/${sid}`);
  await sleep(2600);
  env.model.script(/当前会话的请求/, [[use('Read', { file_path: path.join(out, 'x.txt') })], [say('好')]]);
  await env.c.call('send', sid, '当前会话的请求', {});
  await p.waitEl('.dpanel.approval');
  await sleep(500);
  assert.equal(await p.has('.toast'), false);

  await env.c.call('setState', { prefs: { ...env.c.slices.prefs, notifyRequests: false } });
  await p.goto('/');
  await sleep(2600);
  await asking('提醒关掉了');
  await sleep(4000);
  assert.equal(await p.has('.toast', '提醒关掉了'), false);
  await env.c.call('setState', { prefs: { ...env.c.slices.prefs, notifyRequests: true } });
  noPageErrors(p);
  await p.close();
});

test('a finished turn while the tab is in the background (FR-NTF-01)', async () => {
  const p = await env.page('/');
  await sleep(2600);
  await p.away(true);
  env.model.script(/后台完成/, [[say('做完了')]]);
  await env.start('后台完成');
  await p.waitFor(`window.__notifications.some((n) => /后台完成/.test(n.title))`, 'turn-done notification');
  assert.match((await notes(p)).at(-1)!.title, /「后台完成」这一轮已完成/);
  await p.away(false);
  noPageErrors(p);
  await p.close();
});

test('system notifications switched on by default ask the browser for permission (issue 10-30#2)', { todo: 'issue 10-30#2: the permission is asked only when the switch is turned on by hand' }, async () => {
  const p = await env.page('/');
  await p.eval(`localStorage.setItem('__perm', 'default')`);
  await p.reload();
  await sleep(3000);
  assert.ok(await p.eval<number>('window.__permissionAsked') > 0, 'the browser was asked');
  await p.eval(`localStorage.removeItem('__perm')`);
  await p.close();
});
