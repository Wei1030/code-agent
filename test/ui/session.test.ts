// The session page in the browser: collapsed steps, paging, the inspector, renaming, the composer's
// palettes, attachments, send options, the queue and the interrupt receipt, drafts.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupUi, noPageErrors, type UiEnv } from '../harness/ui';
import { say, think, use, shell, sleepCmd } from '../harness/fake-model';
import { until, sleep } from '../harness/client';
import type { Page } from '../harness/browser';

let env: UiEnv;
before(async () => { env = await setupUi({ files: { 'a.txt': 'one\n', 'src/app.js': 'x\n' } }); });
after(() => env?.close());

async function done(tag: string, steps: Parameters<UiEnv['model']['script']>[1]) {
  env.model.script(new RegExp(tag), steps);
  const sid = await env.start(tag);
  await env.turns(sid);
  return sid;
}
/** Open the send-options menu next to the main button. */
const sendMenu = (p: Page) => p.eval(`[...document.querySelectorAll('.c-right .split button')].at(-1).click()`);

test('thinking and tool calls between answers fold into one line, opened on click (FR-OUT-02/03/04)', async () => {
  const sid = await done('折叠行', [[think('想一想'), use('Read', { file_path: '{cwd}/a.txt' })], [use('Grep', { pattern: 'x', path: '{cwd}/src' })], [say('看完了')]]);
  const p = await env.page(`/s/${sid}`);
  await p.waitEl('.steps .steps-head');
  assert.equal(await p.has('.steps.open'), false, 'collapsed');
  assert.match(await p.text('.steps .steps-head'), /思考 1 次 · 工具调用 2 次/);
  assert.equal(await p.has('.steps-body'), false);
  await p.click('.steps .steps-head');
  await p.waitEl('.steps.open .steps-body');
  await p.waitEl('.steps-body .thinking');
  assert.ok(await p.has('.transcript *', '看完了'), 'the answer stays outside the line');
  noPageErrors(p);
  await p.close();
});

test('the inspector starts closed; a rail icon opens its tab, a second click closes it', async () => {
  const sid = await done('检查器', [[say('好')]]);
  const p = await env.page(`/s/${sid}`);
  await p.waitEl('.ins-rail-btn');
  assert.equal(await p.has('.ins-rail-btn.on'), false);
  await p.click('.ins-rail-btn', '任务');
  await p.waitEl('.ins-rail-btn.on');
  await p.click('.ins-rail-btn.on');
  await p.gone('.ins-rail-btn.on');
  noPageErrors(p);
  await p.close();
});

test('a long conversation shows its end; scrolling to the top loads earlier turns (FR-SES-06)', async () => {
  env.model.script(/^长对话 \d+$/, [[say('答')]]);
  const sid = await env.start('长对话 1');
  await env.turns(sid);
  for (let i = 2; i <= 45; i++) {
    await env.c.call('send', sid, `长对话 ${i}`, {});
    await env.turns(sid, i);
  }
  const p = await env.page(`/s/${sid}`);
  // "长对话 1" alone, not 长对话 10…19.
  const first = `[...document.querySelectorAll('.transcript *')].some((e) => !e.children.length && /长对话 1(?!\\d)/.test(e.textContent))`;
  await p.waitEl('.transcript *', '长对话 45');
  assert.equal(await p.eval(first), false, 'the first turn is not loaded yet');
  await p.waitEl('.earlier-line');
  for (let k = 0; k < 4 && !(await p.eval(first)); k++) {
    await p.eval(`(() => { const t = document.querySelector('.transcript'); t.scrollTop = 0; t.dispatchEvent(new Event('scroll')); })()`);
    await sleep(800);
  }
  await p.waitFor(first, 'the first turn after scrolling up');
  noPageErrors(p);
  await p.close();
});

test('rename in the header: Enter saves, Escape cancels, Enter while composing does neither (FR-SES-08, FR-I18N-07)', async () => {
  const sid = await done('改标题', [[say('好')]]);
  const p = await env.page(`/s/${sid}`);
  await p.click('.edit[title="重命名"]');
  await p.waitFor(`!!document.activeElement && document.activeElement.tagName === 'INPUT'`, 'rename field focused');
  await p.eval(`document.activeElement.classList.add('__rename')`);
  await p.fill('.__rename', '');
  await p.imeEnter('.__rename', 'xin', '新');
  assert.equal(env.c.sessions.get(sid)?.title, '改标题', 'not saved while composing');
  await p.type('.__rename', '标题');
  await p.press('Enter');
  await until(() => env.c.sessions.get(sid)?.title === '新标题', 'saved');
  await p.click('.edit[title="重命名"]');
  await p.waitFor(`!!document.activeElement && document.activeElement.tagName === 'INPUT'`, 'rename field focused');
  await p.eval(`document.activeElement.classList.add('__rename2')`);
  await p.type('.__rename2', '不要');
  await p.press('Escape');
  await sleep(300);
  assert.equal(env.c.sessions.get(sid)?.title, '新标题');
  noPageErrors(p);
  await p.close();
});

test('"/" lists commands and filters; "@" lists files and sessions; picking inserts (FR-IN-03, FR-IN-05)', async () => {
  const sid = await done('面板测试', [[say('好')]]);
  const p = await env.page(`/s/${sid}`);
  await p.type('.c-input', '/');
  await p.waitEl('.palette', '/compact');
  await p.type('.c-input', 'comp');
  await p.waitFor(`[...document.querySelectorAll('.palette .pi')].every((e) => e.textContent.includes('comp'))`, 'filtered');
  await p.press('Enter');
  assert.match(await p.value('.c-input') ?? '', /^\/compact /);
  await p.fill('.c-input', '');
  await p.type('.c-input', '看看 @');
  await p.waitEl('.palette', 'a.txt');
  assert.ok(await p.has('.palette', '折叠行'), 'sessions of the workspace are listed');
  await p.type('.c-input', 'a.t');
  await p.waitEl('.palette .pi', 'a.txt');
  await p.press('Enter');
  assert.match(await p.value('.c-input') ?? '', /@a\.txt /);
  await p.fill('.c-input', '');
  noPageErrors(p);
  await p.close();
});

test('pasting a long text makes a chip; it goes with the message (FR-IN-04)', async () => {
  const sid = await done('粘贴测试', [[say('好')]]);
  env.model.script(/这段日志/, [[say('收到日志')]]);
  const p = await env.page(`/s/${sid}`);
  await p.focus('.c-input');
  const text = Array.from({ length: 20 }, (_, i) => `log line ${i}`).join('\n');
  await p.eval(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)}); document.querySelector('.c-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  await p.waitEl('.c-att', '20 行');
  await p.type('.c-input', '这段日志');
  await p.press('Enter');
  await until(() => env.model.sent(/这段日志/).some((r) => /log line 19/.test(JSON.stringify(r.body.messages))), 'pasted text sent');
  noPageErrors(p);
  await p.close();
});

test('send options: "context only" adds without a turn (FR-IN-08)', async () => {
  const sid = await done('发送选项', [[say('好')]]);
  const p = await env.page(`/s/${sid}`);
  await p.type('.c-input', '这是背景资料');
  await sendMenu(p);
  await p.click('.menu-item', '仅作为上下文');
  await p.waitEl('.transcript *', '已作为上下文添加，未开始新一轮。');
  noPageErrors(p);
  await p.close();
});

test('while Claude works a message queues; interrupting offers to keep or cancel the queue (FR-IN-06, FR-IN-07)', async () => {
  env.model.script(/忙着呢/, [shell(sleepCmd(30)), [say('完成')]]);
  const sid = await env.start('忙着呢', { mode: 'bypassPermissions' });
  const p = await env.page(`/s/${sid}`);
  await p.waitEl('.c-right .btn', '中断');
  await p.type('.c-input', '等会儿再说的事');
  await p.press('Enter');
  await p.waitEl('.queue', '等会儿再说的事');
  await p.click('.c-right .btn', '中断');
  await p.waitEl('.receipt', '1 条排队消息');
  await p.click('.receipt .btn', '取消排队消息');
  await p.gone('.queue');
  await sleep(1000);
  assert.equal(env.model.sent(/等会儿再说的事/).length, 0);
  noPageErrors(p);
  await p.close();
});

test('saving a working session from the sessions list asks first, though it was never opened in the page (FR-SES-13)', async () => {
  env.model.script(/列表里保存/, [shell(sleepCmd(30)), [say('完成')]]);
  const sid = await env.start('列表里保存', { mode: 'bypassPermissions' });
  await until(() => env.c.sessions.get(sid)?.state === 'running', 'running');
  const p = await env.page('/sessions');
  const row = `[...document.querySelectorAll('.srow')].find((r) => r.textContent.includes('列表里保存'))`;
  await p.waitFor(`!!${row}`, 'the row');
  await p.eval(`${row}.querySelector('button[title^="保存并结束"]').click()`);
  await p.waitEl('.modal', '正在进行的这一轮');
  await p.click('.modal .btn', '取消');
  await sleep(500);
  assert.equal(env.c.sessions.get(sid)?.live, true, 'cancelled, still running');
  noPageErrors(p);
  await p.close();
  await env.c.call('stop', sid);
});

test('unsent text is kept per session across a reload (FR-IN-01)', async () => {
  const sid = await done('草稿保留', [[say('好')]]);
  const p = await env.page(`/s/${sid}`);
  await p.type('.c-input', '还没写完的话');
  await sleep(300);
  await p.reload();
  await p.waitFor(`document.querySelector('.c-input')?.value === '还没写完的话'`, 'draft back');
  noPageErrors(p);
  await p.close();
});
