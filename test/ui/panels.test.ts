// What the panels show and do in the browser: home's workspace cards and adding a folder, session
// states in the lists, a question's option previews, and the inspector's file preview, changes and
// event list, the board check, pictures (FR-WS-01, FR-WS-05, FR-SES-12, FR-ASK-03, FR-FILE-01, FR-FILE-02,
// FR-OBS-01, FR-OUT-01).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { setupUi, noPageErrors, type UiEnv } from '../harness/ui';
import { M2 } from '../harness/env';
import { say, use, shell, sleepCmd, hang } from '../harness/fake-model';
import { until } from '../harness/client';
import type { Page } from '../harness/browser';

let env: UiEnv;
before(async () => { env = await setupUi({ files: { 'a.txt': 'one\ntwo\nthree\nfour\n' } }); });
after(() => env?.close());

/** A 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Open an inspector tab by its rail label. */
const tab = (p: Page, label: string) => p.eval(`[...document.querySelectorAll('.ins-rail-btn')].find((b) => b.querySelector('span')?.textContent.trim() === ${JSON.stringify(label)}).click()`);

test('home: a card per workspace with its branch, sessions and what runs; the folder picker adds one (FR-WS-05, FR-WS-01)', async () => {
  env.model.script(/首页卡片/, [shell(sleepCmd(20)), [say('好')]]);
  const sid = await env.start('首页卡片', { mode: 'bypassPermissions' });
  await until(() => env.c.sessions.get(sid)?.state === 'running', 'running');
  const p = await env.page('/');
  await p.waitEl('.ws-card', '1 个运行中');
  const card = await p.text('.ws-card');
  assert.match(card, new RegExp(env.world.git(env.repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()), 'the branch');
  assert.match(card, /\d+ 个会话/);
  assert.match(card, /活动于/);
  await env.c.call('stop', sid);

  const plain = env.world.repo('picked', { 'x.txt': 'x' }, { git: false });
  await p.click('button.ws-switch');
  await p.click('.menu-item', '打开文件夹…');
  await p.waitEl('.modal .folder-tree .folder-row');
  await p.fill('.modal input.mono', plain);
  await p.click('.modal .btn.primary', '添加为工作区');
  await until(() => env.c.slices.workspaces.some((w) => w.path === path.resolve(plain)), 'added');
  await p.goto('/');
  await p.waitEl('.ws-card', '非 Git 仓库');
  noPageErrors(p);
  await p.close();
});

test('a session\'s state shows in the sessions list: running, waiting for you, idle (FR-SES-12)', async () => {
  const outside = env.world.repo('elsewhere', { 'o.txt': 'o' }, { git: false });
  // A slowly streamed answer keeps it running for a while; then a read outside the workspace asks.
  env.model.script(/状态显示/, [[say('先说一段比较长的话，'.repeat(12)), use('Read', { file_path: path.join(outside, 'o.txt') })], [say('好')]], { slow: 60 });
  const sid = await env.start('状态显示');
  const p = await env.page('/sessions');
  const row = `[...document.querySelectorAll('.srow')].find((r) => r.textContent.includes('状态显示'))`;
  await p.waitFor(`${row}?.querySelector('.srow-state')?.textContent.includes('运行中')`, 'running in the list');
  await p.waitFor(`${row}?.querySelector('.srow-state')?.textContent.includes('等你处理')`, 'waiting in the list', 30_000);
  const r = await env.request(sid, 'approval');
  await env.c.call('respondApproval', sid, r.id, { behavior: 'allow' });
  await env.turns(sid);
  await p.waitFor(`${row}?.querySelector('.srow-state')?.textContent.includes('空闲')`, 'idle in the list');
  noPageErrors(p);
  await p.close();
});

test('question options with previews show them side by side, in a sandboxed frame (FR-ASK-03)', async () => {
  const ask = { questions: [{ header: '布局', question: '列表页用哪种布局？', multiSelect: false, options: [
    { label: '表格', description: '密集', preview: '<table><tr><td id="cell">订单表格</td></tr></table>' },
    { label: '卡片', description: '宽松', preview: '<div>订单卡片</div>' },
  ] }] };
  env.model.script(/预览布局/, [[use('AskUserQuestion', ask)], [say('好')]]);
  const sid = await env.start('预览布局');
  await env.request(sid, 'question');
  const p = await env.page(`/s/${sid}`);
  await p.waitEl('.q-preview iframe');
  assert.equal(await p.eval(`document.querySelector('.q-preview iframe').getAttribute('sandbox')`), '', 'no scripts, no same origin');
  assert.match(await p.eval<string>(`document.querySelector('.q-preview iframe').srcdoc`), /订单表格/);
  await p.hover('.q-opt', '卡片');
  await p.waitFor(`document.querySelector('.q-preview iframe')?.srcdoc.includes('订单卡片')`, 'the hovered option\'s preview');
  await p.click('.q-opt', '表格');
  await p.click('.dpanel-foot .btn', '提交回答');
  await env.turns(sid);
  noPageErrors(p);
  await p.close();
});

test('inspector: a file path in the conversation opens the file with the lines read marked; changes list the diff (FR-FILE-02, FR-FILE-01)', async () => {
  env.model.script(/看看文件/, [[use('Read', { file_path: '{cwd}/a.txt', offset: 2, limit: 2 })], [use('Edit', { file_path: '{cwd}/a.txt', old_string: 'four', new_string: 'FOUR' })], [say('看完也改了')]]);
  const sid = await env.start('看看文件', { mode: 'acceptEdits' });
  await env.turns(sid);
  const p = await env.page(`/s/${sid}`);
  await p.click('.steps .steps-head');
  await p.waitEl('.steps-body .detail.link');
  await p.click('.steps-body .detail.link');
  await p.waitEl('.file-view .fl');
  assert.deepEqual(await p.eval(`[...document.querySelectorAll('.file-view .fl.mark .ln')].map((e) => e.textContent)`), ['2', '3']);
  assert.match(await p.text('.file-view'), /FOUR/, 'the file as it is now');
  await p.click('.btn', '在变更里看');
  await p.waitEl('.change-head', 'a.txt');
  assert.match(await p.text('.ins-body'), /\+1/);
  assert.match(await p.eval<string>(`document.querySelector('.change').textContent`), /FOUR/, 'the diff is open');
  noPageErrors(p);
  await p.close();
});

test('inspector: the event list shows Claude Code\'s messages; filter by kind, search, open one as JSON (FR-OBS-01)', async () => {
  env.model.script(/事件列表/, [[say('事件来了')]]);
  const sid = await env.start('事件列表');
  await env.turns(sid);
  const p = await env.page(`/s/${sid}`);
  await p.waitEl('.ins-rail-btn');
  await tab(p, '事件');
  await p.waitEl('.ev-row .ty', 'assistant');
  const types = () => p.eval<string[]>(`[...document.querySelectorAll('.ev-row .ty')].map((e) => e.textContent)`);
  assert.ok((await types()).some((x) => x.startsWith('system')), 'the init message');
  await p.click('.ev-filters button', 'system');
  await p.waitFor(`![...document.querySelectorAll('.ev-row .ty')].some((e) => e.textContent.startsWith('system'))`, 'system hidden');
  await p.click('.ev-filters button', 'system');
  await p.fill('.ins-body input.input', 'result');
  await p.waitFor(`[...document.querySelectorAll('.ev-row .ty')].every((e) => /result/.test(e.textContent + e.nextElementSibling?.textContent))`, 'searched');
  await p.click('.ev-row');
  await p.waitEl('.ev-json pre');
  assert.match(await p.text('.ev-json pre'), /"type": "result"/);
  noPageErrors(p);
  await p.close();
});

test('inspector: the info tab shows what Code Agent put in the system prompt (FR-SES-17)', async () => {
  env.model.script(/^信息页提示词$/, [[say('好')]]);
  const sid = await env.start('信息页提示词');
  await env.turns(sid);
  const p = await env.page(`/s/${sid}`);
  await p.waitEl('.ins-rail-btn');
  await tab(p, '信息');
  await p.waitEl('.session-prompt h4', '附加的系统提示词');
  assert.match(await p.text('.session-prompt pre'), /Always respond to the user in/);
  noPageErrors(p);
  await p.close();
});

test('the board check floats over the chat while it runs: shrink, settings, stop (custom feature 看板)', async () => {
  await env.c.call('setState', { boardSettings: { ...env.c.slices.boardSettings, recorder: true, recorderModel: M2 } });
  env.model.failModel('model-two', hang);
  env.model.script(/^悬浮分析$/, [[say('这一轮说了足够多的内容，后台识别会来检查它要不要更新看板。')]]);
  const sid = await env.start('悬浮分析');
  await env.turns(sid);
  const p = await env.page(`/s/${sid}`);
  await p.waitEl('.board-check', 'model-two 正在分析本轮对话是否需要更新看板');
  await p.click('.board-check .btn[title="缩小"]');
  await p.waitEl('.board-check.small', '看板分析中');
  await p.click('.board-check.small');
  await p.waitEl('.board-check-foot');
  await p.click('.board-check .btn[title="看板设置"]');
  await p.waitEl('.modal', '每轮对话结束后自动记录');
  await p.click('.modal .btn', '完成');
  await p.click('.board-check-foot .btn', '停止分析');
  await p.gone('.board-check');
  assert.equal(env.c.slices.boardSettings.recorder, true, 'only this check stopped');
  env.model.failModel('model-two', null);
  await env.c.call('setState', { boardSettings: { ...env.c.slices.boardSettings, recorder: false } });
  noPageErrors(p);
  await p.close();
});

test('pictures show in the chat: yours, a tool\'s and one Claude points to; a click shows it full size (FR-OUT-01, FR-IN-04)', async () => {
  writeFileSync(path.join(env.repo, 'diagram.png'), PNG);
  env.model.script(/^看图/, [[use('Read', { file_path: '{cwd}/diagram.png' })], [say('这是示意图：![示意图](diagram.png)')]]);
  const sid = await env.start('看图', { send: { attachments: [{ id: 'img1', kind: 'image', name: 'shot.png', meta: '1 KB', content: `data:image/png;base64,${PNG.toString('base64')}` }] } });
  await env.turns(sid);
  const p = await env.page(`/s/${sid}`);
  await p.waitEl('.umsg .atts img.thumb');
  await p.waitFor(`[...document.querySelectorAll('.atext img.thumb')].some((i) => i.src.includes('/files?sid=') && i.complete && i.naturalWidth > 0)`, 'the picture Claude points to, loaded');
  await p.click('.steps .steps-head');
  await p.waitEl('.steps-body .thumbs img.thumb');
  await p.click('.umsg .atts img.thumb');
  await p.waitEl('.img-view img');
  await p.press('Escape');
  await p.gone('.img-view');
  noPageErrors(p);
  await p.close();
});
