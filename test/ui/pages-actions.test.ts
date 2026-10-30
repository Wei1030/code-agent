// What the extension and settings pages do when used: the board's new item and status, a job run
// by hand, a hook rule made and tried, a permission rule added, an MCP server added; in a session
// the rewind and code-review dialogs, cancelling a wake-up, the queue of a session waiting for a
// running slot; held messages and a review decision in the inbox.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setupUi, noPageErrors, type UiEnv } from '../harness/ui';
import { say, use, shell, sleepCmd } from '../harness/fake-model';
import { until, sleep } from '../harness/client';

let env: UiEnv;
before(async () => {
  env = await setupUi({ files: { 'a.txt': 'one\n', 'package.json': { name: 'x', scripts: { test: 'node -e "process.exit(0)"' } } } });
  env.model.structured((schema) => (schema?.properties?.verdict ? { output: { verdict: 'pass', summary: '没问题', findings: [], rulings: [] } } : schema?.properties?.risk ? { output: { risk: 'low' } } : undefined));
});
after(() => env?.close());

test('board: a new item from the dialog, then its status changed (custom feature 看板)', async () => {
  const p = await env.page(`/board?ws=${env.ws}`);
  await p.click('.btn', '新建');
  await p.waitEl('.modal');
  await p.type('.modal input', '列表分页');
  await p.click('.modal .btn.primary', '新建');
  await until(() => env.c.slices.board.find((b) => b.title === '列表分页'), 'created');
  await p.waitEl('.board-detail');
  await p.click('.board-detail .select-btn', '待开始');
  await p.click('.menu-item', '进行中');
  await until(() => env.c.slices.board.find((b) => b.title === '列表分页')?.status === 'doing', 'status changed');
  noPageErrors(p);
  await p.close();
});

test('jobs: a job run by hand shows its result (FR-JOB-02)', async () => {
  await env.c.call('setState', { jobs: [{ id: 'j1', name: '风险评估', workspaceId: env.ws, prompt: '评估风险', schema: JSON.stringify({ type: 'object', required: ['risk'], properties: { risk: { type: 'string' } } }), model: env.c.slices.models[0].id, effort: 'low', mode: 'dontAsk', schedule: { kind: 'manual', time: '09:00', weekdays: [1], everyHours: 6, cron: '', enabled: true, vars: {}, missed: 'skip' }, notify: 'never' }] });
  const p = await env.page('/jobs');
  await p.click('.btn', '运行作业');
  await p.waitEl('.status.good', '输出有效', 60_000);
  assert.match(await p.eval<string>(`document.body.innerText`), /"risk": "low"/);
  noPageErrors(p);
  await p.close();
});

test('hooks: a new rule saved, and tried on a sample input in the page (FR-HOOK-01)', async () => {
  const p = await env.page('/hooks');
  await p.click('.hook-ev', 'PreToolUse');
  await p.click('.btn', '新建规则');
  await p.click('.btn', '运行');
  await p.waitFor(`/permissionDecision|不匹配/.test(document.body.innerText)`, 'a test result');
  await p.click('.btn.primary', '保存');
  await until(() => env.c.slices.hookRules.length === 1, 'saved');
  noPageErrors(p);
  await p.close();
});

test('permission rules: added with the structured editor, written to the settings file (FR-PERM-08)', async () => {
  const p = await env.page('/settings/permissions');
  await p.click('button', '所有工作区');
  await p.waitEl('.settings-main', '添加规则');
  const field = `[...document.querySelectorAll('.settings-main input.input')].find((e) => e.offsetParent && !e.placeholder.includes('src'))`;
  await p.eval(`(${field}).classList.add('__rule')`);
  await p.type('.__rule', 'npm run lint');
  await p.click('.settings-main .btn', '添加');
  const allow = () => JSON.parse(readFileSync(path.join(env.world.config, 'settings.json'), 'utf8')).permissions?.allow as string[] | undefined;
  await until(() => allow()?.includes('PowerShell(npm run lint *)'), 'written');
  assert.ok(allow()!.includes('Bash(npm run lint *)'), 'for Bash and PowerShell (issue 10-30#15)');
  assert.equal(await p.eval(`[...document.querySelectorAll('.rule-row')].filter((r) => r.textContent.includes('npm run lint')).length`), 1, 'shown as one rule');
  noPageErrors(p);
  await p.close();
});

test('MCP: a server added from the dialog is written by Claude Code\'s command (FR-MCP-01)', async () => {
  const p = await env.page('/mcp');
  await p.click('.btn', '添加服务器');
  await p.waitEl('.modal');
  await p.type('.modal input.input', 'notes');
  await p.eval(`(() => { const t = [...document.querySelectorAll('.modal textarea, .modal input')].find((e) => /命令|command/i.test(e.closest('.field')?.textContent ?? '')); t.classList.add('__cmd'); })()`);
  await p.fill('.__cmd', `node ${path.join(import.meta.dirname, '..', 'harness', 'mcp', 'tracker.mjs')}`);
  await p.click('.modal .btn.primary', '添加');
  await until(() => existsSync(path.join(env.world.home, '.claude.json')) && JSON.parse(readFileSync(path.join(env.world.home, '.claude.json'), 'utf8')).mcpServers?.notes, 'written', 60_000);
  noPageErrors(p);
  await p.close();
});

test('session: the rewind dialog previews and puts the file back; 提交审核 runs a review to its pass (FR-CKPT-03, 代码审核)', async () => {
  env.model.script(/改 a\.txt/, [[use('Edit', { file_path: '{cwd}/a.txt', old_string: 'one', new_string: 'two' })], [say('改好了')]]);
  const sid = await env.start('改 a.txt', { mode: 'acceptEdits' });
  await env.turns(sid);
  const p = await env.page(`/s/${sid}`);
  await p.click('.btn', '提交审核');
  await p.waitEl('.modal', '验证命令');
  await p.click('.modal .btn.primary');
  await until(() => env.c.slices.reviews.some((r) => r.sessionId === sid && r.status === 'passed'), 'review passed', 90_000);
  await p.waitEl('.transcript *', '审核结论');
  await p.click('.ins-rail-btn', '检查点');
  await p.click('.btn', '回退到这里');
  await p.waitEl('.modal', 'a.txt');
  await p.click('.modal .btn.primary');
  await until(() => readFileSync(path.join(env.repo, 'a.txt'), 'utf8') === 'one\n', 'file back');
  noPageErrors(p);
  await p.close();
});

test('inbox: a held message released from it (会话协作)', async () => {
  await env.c.call('setState', { peer: { ...env.c.slices.peer, inbound: 'hold' } });
  env.model.script(/^收件人$/, [[say('在')]]);
  const to = await env.start('收件人');
  await env.turns(to);
  env.model.script(/发件人/, [[use('mcp__workspace__send_to_session', { session_id: to, message: '请看一下', notify: false })], [say('发了')]]);
  await env.start('发件人');
  await until(() => env.c.slices.held.length > 0, 'held');
  const p = await env.page('/');
  await p.click('.top-icon');
  await p.waitEl('.inbox .inbox-item.held', '请看一下');
  env.model.script(/请看一下/, [[say('看了')]]);
  await p.click('.inbox .btn', '放行');
  await until(() => env.c.slices.held.length === 0, 'released');
  await sleep(300);
  noPageErrors(p);
  await p.close();
  await env.c.call('setState', { peer: { ...env.c.slices.peer, inbound: 'parity' } });
});

test('cancelling a wake-up the process holds asks first, then ends the process (issue 10-31#6)', async () => {
  env.model.script(/^等会儿再看$/, [[use('ScheduleWakeup', { delaySeconds: 600, reason: '等构建跑完', prompt: '看看构建', noop: false })], [say('先睡一会儿')]]);
  const sid = await env.start('等会儿再看');
  await env.turns(sid);
  await until(() => env.c.sessions.get(sid)?.resume?.by === 'cli', 'planned');
  const p = await env.page(`/s/${sid}`);
  await p.click('.readonly-bar.waiting .btn', '取消预约');
  await p.waitEl('.modal', '结束这个会话的 Claude Code 进程');
  assert.equal(env.c.sessions.get(sid)?.live, true, 'nothing ended before the answer');
  await p.click('.modal .btn', '结束进程并取消');
  await until(() => !env.c.sessions.get(sid)?.resume && env.c.sessions.get(sid)?.live === false, 'cancelled, the process ended');
  noPageErrors(p);
  await p.close();
});

test('a session waiting for a running slot shows the messages it will send (issue 10-31#7)', async () => {
  const max = env.c.slices.maxRunning;
  await env.c.call('setState', { maxRunning: 1 });
  env.model.script(/^占着唯一的名额$/, [shell(sleepCmd(60)), [say('完')]]);
  const busy = await env.start('占着唯一的名额', { mode: 'bypassPermissions' });
  await until(async () => (await env.rt(busy)).items.some((i) => i.kind === 'tool' && i.status === 'running'), 'busy');
  const sid = await env.start('等名额时的第一条');
  await until(() => env.c.sessions.get(sid)?.waiting === true, 'waiting');
  const p = await env.page(`/s/${sid}`);
  await p.waitEl('.queue', '等名额时的第一条');
  await p.waitEl('.readonly-bar.waiting', '排队等待空位');
  noPageErrors(p);
  await p.close();
  await env.c.call('cancelWaiting', sid);
  await env.c.call('stop', busy);
  await env.c.call('setState', { maxRunning: max });
});
