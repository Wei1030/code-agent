// Hook rules in real sessions: each action, conditions, scope, switching off, editing without a
// restart, settings-file hooks (FR-HOOK-01..06, issue 10-30#8).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setup, type Env } from '../harness/env';
import { say, use } from '../harness/fake-model';
import { until, sleep } from '../harness/client';
import type { HookRule, Item } from '@code-agent/shared/types';

let env: Env;
let hook: http.Server;
let hookUrl = '';
/** What the webhook receiver got, and what it answers. */
const received: Array<{ url: string; body: any }> = [];
let reply: (body: any) => object = () => ({});
before(async () => {
  env = await setup({ files: { 'src/app.js': 'x\n', 'migrations/001.sql': 'create table t();\n' } });
  hook = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      received.push({ url: req.url ?? '', body });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply(body)));
    });
  });
  await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
  hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}`;
});
after(async () => { hook?.close(); await env?.close(); });

let n = 0;
const rule = (p: Partial<HookRule>): HookRule => ({ id: `h${++n}`, name: `规则${n}`, event: 'PreToolUse', matcher: '', action: 'deny', text: '', timeout: 10, async: false, enabled: true, scope: 'global', ...p });
const setRules = (rules: HookRule[]) => env.c.call('setState', { hookRules: rules });
type Tool = Extract<Item, { kind: 'tool' }>;
const card = async (sid: string, tool: string) => (await env.rt(sid)).items.flatMap((i) => (i.kind === 'tool' ? [i] : i.kind === 'toolgroup' ? i.tools : [])).find((t) => t.tool === tool) as Tool;

test('deny on PreToolUse with a path condition: the edit is refused and says by which rule (FR-HOOK-01, FR-HOOK-02)', async () => {
  await setRules([rule({ name: '迁移脚本只读', matcher: 'Edit|Write', cond: { field: 'tool_input.file_path', op: 'glob', value: '**/migrations/**' }, text: '迁移脚本只能由人修改' })]);
  env.model.script(/改迁移/, [[use('Edit', { file_path: '{cwd}/migrations/001.sql', old_string: 'create', new_string: 'CREATE' })], [use('Edit', { file_path: '{cwd}/src/app.js', old_string: 'x', new_string: 'y' })], [say('好')]]);
  const sid = await env.start('改迁移', { mode: 'acceptEdits' });
  await env.turns(sid);
  const cards = (await env.rt(sid)).items.filter((i): i is Tool => i.kind === 'tool' && i.tool === 'Edit');
  assert.equal(cards[0].status, 'denied');
  assert.match(cards[0].provenance ?? '', /被钩子「迁移脚本只读」拒绝/);
  assert.equal(cards[1].status, 'ok', 'the condition did not match the other file');
  assert.match(JSON.stringify(env.model.sent(/改迁移/).at(-1)!.body.messages), /迁移脚本只能由人修改/, 'Claude was told why');
  assert.ok(env.c.slices.hookLog.some((l) => l.rule === '迁移脚本只读' && l.outcome === 'crit'));
});

test('context and title on UserPromptSubmit; a notification on Stop (FR-HOOK-02)', async () => {
  await setRules([
    rule({ event: 'UserPromptSubmit', action: 'context', text: '分支命名规则 feat/<issue>-<slug>' }),
    rule({ event: 'UserPromptSubmit', action: 'title', text: '由钩子起的标题' }),
    rule({ name: '结束提醒', event: 'Stop', action: 'notify', text: '一轮结束了', async: true }),
  ]);
  env.model.script(/补充上下文/, [[say('好')]]);
  const sid = await env.start('补充上下文');
  await env.turns(sid);
  assert.match(JSON.stringify(env.model.sent(/补充上下文/)[0].body.messages), /分支命名规则 feat/);
  await until(() => env.c.sessions.get(sid)?.title === '由钩子起的标题', 'title set');
  await until(() => env.c.notices.some((x) => x.title === '钩子「结束提醒」' && x.body === '一轮结束了'), 'notified');
});

test('a webhook gets the event; its JSON answer is the hook\'s output (FR-HOOK-02, issue 10-30#8)', async () => {
  received.length = 0;
  reply = () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '网关说不行' } });
  await setRules([rule({ name: '问网关', matcher: 'Write', action: 'webhook', text: `${hookUrl}/pre` })]);
  env.model.script(/走网关/, [[use('Write', { file_path: '{cwd}/new.txt', content: 'x' })], [say('好')]]);
  const sid = await env.start('走网关', { mode: 'acceptEdits' });
  await env.turns(sid);
  const got = received.find((r) => r.url === '/pre');
  assert.ok(got, 'posted');
  assert.equal(got!.body.tool_name, 'Write');
  assert.equal(got!.body.session_title, '走网关');
  assert.equal((await card(sid, 'Write')).status, 'denied', 'the answer was used');
  assert.equal(existsSync(path.join(env.repo, 'new.txt')), false);
  reply = () => ({});
});

test('"log to file" writes a line per event to the file it names (FR-HOOK-02, issue 10-30#8)', async () => {
  const file = path.join(env.world.root, 'audit', 'tools.log');
  await setRules([rule({ name: '审计', event: 'PostToolUse', matcher: '', action: 'log', text: file })]);
  env.model.script(/记日志/, [[use('Read', { file_path: '{cwd}/src/app.js' })], [say('好')]]);
  const sid = await env.start('记日志');
  await env.turns(sid);
  await until(() => existsSync(file), 'log file written');
  assert.match(readFileSync(file, 'utf8'), /Read/);
});

test('a rule of another workspace, or switched off, does not run; edits apply to running sessions (FR-HOOK-01, FR-HOOK-06)', async () => {
  const other = (await env.c.call('addWorkspace', env.world.repo('other'))).id;
  await setRules([
    rule({ name: '别的工作区', scope: 'workspace', workspaceId: other, matcher: 'Read', text: '不该拦' }),
    rule({ name: '关掉的', enabled: false, matcher: 'Read', text: '不该拦' }),
  ]);
  env.model.script(/^范围一$/, [[use('Read', { file_path: '{cwd}/src/app.js' })], [say('好')]]);
  env.model.script(/^范围二$/, [[use('Read', { file_path: '{cwd}/src/app.js' })], [say('好')]]);
  const sid = await env.start('范围一');
  await env.turns(sid);
  assert.equal((await card(sid, 'Read')).status, 'ok');
  await setRules([rule({ name: '现在拦', matcher: 'Read', text: '运行中改的规则' })]);
  await sleep(300);
  await env.c.call('send', sid, '范围二', {});
  await env.turns(sid, 2);
  const reads = (await env.rt(sid)).items.flatMap((i) => (i.kind === 'tool' ? [i] : i.kind === 'toolgroup' ? i.tools : [])).filter((t) => t.tool === 'Read');
  assert.equal(reads.at(-1)!.status, 'denied', 'the new rule applies without a restart');
  await setRules([]);
});

test('hooks in settings files are listed read-only and their runs are logged (FR-HOOK-05, FR-HOOK-04)', async () => {
  env.world.write(path.join(env.world.config, 'settings.json'), { hooks: { PostToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'node -e "process.exit(0)"' }] }] } });
  await env.c.call('refreshExtensions');
  await until(() => env.c.slices.fileHooks.some((h) => h.event === 'PostToolUse' && /node -e/.test(JSON.stringify(h))), 'listed', 30_000);
  env.model.script(/文件钩子/, [[use('Read', { file_path: '{cwd}/src/app.js' })], [say('好')]]);
  const sid = await env.start('文件钩子');
  await env.turns(sid);
  await until(() => env.c.slices.hookLog.some((l) => l.event === 'PostToolUse' && /已执行|退出码/.test(l.result)), 'its run logged', 30_000);
});
